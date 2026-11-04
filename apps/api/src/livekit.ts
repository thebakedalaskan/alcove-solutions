/*
 * LiveKit (group calls). The only module that holds the LiveKit API key and secret, as inference.ts is for
 * NEAR AI. LiveKit carries media, presence and nudges; the API decides who may join and keeps the call.
 */
import { AccessToken, DataPacket_Kind, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import { AuthError } from './errors';
import type { Config } from './config';
import { log } from './log';

const llog = log.child({ component: 'livekit' });

export interface LiveKit {
  /** True when LiveKit's server API answers with our credentials. */
  reachable(): Promise<boolean>;
  /** Creates the room if it doesn't exist yet (creating an existing room is a no-op). */
  ensureRoom(roomName: string): Promise<void>;
  /** Who is connected to the room now; empty when the room doesn't exist. */
  participants(roomName: string): Promise<{ identity: string; name: string }[]>;
  /** A join token for one identity in one room. No admin rights: host powers stay in the API. */
  token(t: { roomName: string; identity: string }): Promise<string>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
  /** Mutes one published track. Never unmutes: remote unmute stays off. */
  muteTrack(roomName: string, identity: string, trackSid: string): Promise<void>;
  /** Sends a reliable data message to everyone in the room on `topic`. */
  sendData(roomName: string, data: Uint8Array, topic: string): Promise<void>;
  /** Disconnects everyone. A room that's already gone is fine. */
  deleteRoom(roomName: string): Promise<void>;
  /** Which of these rooms LiveKit still has. */
  existingRooms(names: string[]): Promise<Set<string>>;
  /** Checks a webhook's signature (a JWT from our key over the body's SHA-256) and reads the event. */
  verifyWebhook(body: string, authorization: string | undefined): Promise<LiveKitEvent>;
}

export interface LiveKitEvent { event: string; roomName: string | null; identity: string | null }

/** Seconds LiveKit keeps an empty room, and keeps a room after the last person leaves. */
/** Join tokens only need to last until the browser connects; LiveKit refreshes them for connected participants itself. */
const TOKEN_TTL_SECONDS = 120;
export const ROOM_EMPTY_TIMEOUT = 300;
export const ROOM_DEPARTURE_TIMEOUT = 20;

/** LiveKit's server API: LIVEKIT_URL with ws → http and wss → https. */
export const apiUrl = (cfg: Config): string => cfg.LIVEKIT_URL.replace(/^ws/, 'http');

export function createLiveKit(cfg: Config): LiveKit {
  const rooms = new RoomServiceClient(apiUrl(cfg), cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET);
  const webhooks = new WebhookReceiver(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET);
  return {
    async reachable() {
      try {
        await rooms.listRooms([]);
        return true;
      } catch (e) {
        llog.warn('LiveKit is not reachable', { err: e });
        return false;
      }
    },
    async ensureRoom(roomName) {
      await rooms.createRoom({ name: roomName, emptyTimeout: ROOM_EMPTY_TIMEOUT, departureTimeout: ROOM_DEPARTURE_TIMEOUT });
    },
    async participants(roomName) {
      if (!(await rooms.listRooms([roomName])).length) return [];
      return (await rooms.listParticipants(roomName)).map((p) => ({ identity: p.identity, name: p.name }));
    },
    async token({ roomName, identity }) {
      const t = new AccessToken(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET, { identity, ttl: TOKEN_TTL_SECONDS });
      t.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: false });
      return t.toJwt();
    },
    async removeParticipant(roomName, identity) {
      await rooms.removeParticipant(roomName, identity);
    },
    async muteTrack(roomName, identity, trackSid) {
      await rooms.mutePublishedTrack(roomName, identity, trackSid, true);
    },
    async sendData(roomName, data, topic) {
      await rooms.sendData(roomName, data, DataPacket_Kind.RELIABLE, { topic });
    },
    async deleteRoom(roomName) {
      if ((await rooms.listRooms([roomName])).length) await rooms.deleteRoom(roomName);
    },
    async existingRooms(names) {
      if (!names.length) return new Set();
      return new Set((await rooms.listRooms(names)).map((r) => r.name));
    },
    async verifyWebhook(body, authorization) {
      const ev = await webhooks.receive(body, authorization).catch((e: unknown) => { throw new AuthError('Webhook signature is not valid.', { cause: e, level: 'warn' }); });
      return { event: ev.event, roomName: ev.room?.name ?? null, identity: ev.participant?.identity ?? null };
    }
  };
}
