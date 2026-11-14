/*
 * LiveKit (group calls). The only module that holds the LiveKit API key and secret, as inference.ts is for
 * NEAR AI. LiveKit carries media, presence, the server's change pushes and what browsers send each other (pointers and marks on
 * shared screens, encrypted end to end like media); the API decides who may join and keeps the call.
 */
import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import { AuthError } from '../platform/errors';
import type { Config } from '../platform/config';
import { log } from '../platform/log';

const llog = log.child({ component: 'livekit' });
/**
 * How far LiveKit's clock may be from this server's, in seconds, when a webhook's token is checked. LiveKit's SDK allows 10,
 * and Confidential Space's VMs ran up to 9.5 s behind on 2026-11-13, drifting about a second a day (gcp.ts logs it as
 * `clock offset`).
 */
const CLOCK_SKEW_S = 60;

export interface LiveKit {
  /** True when LiveKit's server API answers with our credentials. */
  reachable(): Promise<boolean>;
  /** Creates the room if it doesn't exist yet (creating an existing room is a no-op). */
  ensureRoom(roomName: string): Promise<void>;
  /** Who is connected to the room now; empty when the room doesn't exist. */
  participants(roomName: string): Promise<{ identity: string; name: string }[]>;
  /**
   * The screens being shared in the room now: who shares each (identity) and its track ID. LiveKit sees which tracks
   * are screens, never what's on them (their media is end-to-end encrypted). Cameras aren't listed.
   */
  screenShares(roomName: string): Promise<{ identity: string; sid: string }[]>;
  /**
   * What everyone shares in the room now, the picture and its sound: whose each track is (identity), its ID, and whether it's
   * muted. LiveKit sees which tracks are shares, never what's in them.
   */
  sharing(roomName: string): Promise<{ identity: string; sid: string; muted: boolean }[]>;
  /**
   * A join token for one identity in one room. No admin rights: host powers stay in the API. It may send data: browsers
   * send each other pointers and marks on shared screens, encrypted end to end with their own media keys. The API is
   * never in the room, so it never receives them, and browsers take the call's change pushes only from the server.
   */
  token(t: { roomName: string; identity: string }): Promise<string>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
  /** Mutes one published track, a microphone or a share. Never unmutes: remote unmute stays off. */
  muteTrack(roomName: string, identity: string, trackSid: string): Promise<void>;
  /** Sends a reliable data message on `topic` to everyone in the room, or only to the connections in `to`. */
  sendData(roomName: string, data: Uint8Array, topic: string, to?: readonly string[] | undefined): Promise<void>;
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
    async screenShares(roomName) {
      if (!(await rooms.listRooms([roomName])).length) return [];
      return (await rooms.listParticipants(roomName)).flatMap((p) => p.tracks.filter((t) => t.source === TrackSource.SCREEN_SHARE).map((t) => ({ identity: p.identity, sid: t.sid })));
    },
    async sharing(roomName) {
      if (!(await rooms.listRooms([roomName])).length) return [];
      const shares = new Set([TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]);
      return (await rooms.listParticipants(roomName)).flatMap((p) => p.tracks.filter((t) => shares.has(t.source)).map((t) => ({ identity: p.identity, sid: t.sid, muted: t.muted })));
    },
    async token({ roomName, identity }) {
      const t = new AccessToken(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET, { identity, ttl: TOKEN_TTL_SECONDS });
      t.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
      return t.toJwt();
    },
    async removeParticipant(roomName, identity) {
      await rooms.removeParticipant(roomName, identity);
    },
    async muteTrack(roomName, identity, trackSid) {
      await rooms.mutePublishedTrack(roomName, identity, trackSid, true);
    },
    async sendData(roomName, data, topic, to) {
      await rooms.sendData(roomName, data, DataPacket_Kind.RELIABLE, { topic, ...(to ? { destinationIdentities: [...to] } : {}) });
    },
    async deleteRoom(roomName) {
      if ((await rooms.listRooms([roomName])).length) await rooms.deleteRoom(roomName);
    },
    async existingRooms(names) {
      if (!names.length) return new Set();
      return new Set((await rooms.listRooms(names)).map((r) => r.name));
    },
    async verifyWebhook(body, authorization) {
      const ev = await webhooks.receive(body, authorization, false, CLOCK_SKEW_S).catch((e: unknown) => { throw new AuthError('Webhook signature is not valid.', { cause: e, level: 'warn' }); });
      return { event: ev.event, roomName: ev.room?.name ?? null, identity: ev.participant?.identity ?? null };
    }
  };
}
