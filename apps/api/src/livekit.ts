/*
 * LiveKit (group calls). The only module that holds the LiveKit API key and secret, as inference.ts is for
 * NEAR AI. LiveKit carries media, presence and nudges; the API decides who may join and keeps the call.
 */
import type { RoomMetadata } from '@alcove/api';
import { AccessToken, DataPacket_Kind, RoomServiceClient } from 'livekit-server-sdk';
import type { Config } from './config';
import { log } from './log';

const llog = log.child({ component: 'livekit' });

export interface LiveKit {
  /** True when LiveKit's server API answers with our credentials. */
  reachable(): Promise<boolean>;
  /** Creates the room if it doesn't exist yet (creating an existing room is a no-op). */
  ensureRoom(roomName: string): Promise<void>;
  /** Whether LiveKit still has this room. */
  roomExists(roomName: string): Promise<boolean>;
  /** Who is connected to the room now; empty when the room doesn't exist. */
  participants(roomName: string): Promise<{ identity: string; name: string }[]>;
  /** A join token for one identity in one room. No admin rights: host powers stay in the API. */
  token(t: { roomName: string; identity: string; name: string }): Promise<string>;
  /** Room metadata is server-only, so clients can trust it for who hosts, notes and lock. */
  setMetadata(roomName: string, m: RoomMetadata): Promise<void>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
  /** Sends a reliable data message to everyone in the room on `topic`. */
  sendData(roomName: string, data: Uint8Array, topic: string): Promise<void>;
}

/** Seconds LiveKit keeps an empty room, and keeps a room after the last person leaves. */
export const ROOM_EMPTY_TIMEOUT = 300;
export const ROOM_DEPARTURE_TIMEOUT = 20;

/** LiveKit's server API: LIVEKIT_URL with ws → http and wss → https. */
export const apiUrl = (cfg: Config): string => cfg.LIVEKIT_URL.replace(/^ws/, 'http');

export function createLiveKit(cfg: Config): LiveKit {
  const rooms = new RoomServiceClient(apiUrl(cfg), cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET);
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
    async roomExists(roomName) {
      return (await rooms.listRooms([roomName])).length > 0;
    },
    async participants(roomName) {
      if (!(await rooms.listRooms([roomName])).length) return [];
      return (await rooms.listParticipants(roomName)).map((p) => ({ identity: p.identity, name: p.name }));
    },
    async token({ roomName, identity, name }) {
      const t = new AccessToken(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET, { identity, name, ttl: cfg.CALL_TOKEN_TTL_SECONDS });
      t.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true });
      return t.toJwt();
    },
    async setMetadata(roomName, m) {
      await rooms.updateRoomMetadata(roomName, JSON.stringify(m));
    },
    async removeParticipant(roomName, identity) {
      await rooms.removeParticipant(roomName, identity);
    },
    async sendData(roomName, data, topic) {
      await rooms.sendData(roomName, data, DataPacket_Kind.RELIABLE, { topic });
    }
  };
}
