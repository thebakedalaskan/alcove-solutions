/*
 * LiveKit (group calls). The only module that holds the LiveKit API key and secret, as inference.ts is for
 * NEAR AI. LiveKit carries media, presence and nudges; the API decides who may join and keeps the call.
 */
import { RoomServiceClient } from 'livekit-server-sdk';
import type { Config } from './config';
import { log } from './log';

const llog = log.child({ component: 'livekit' });

export interface LiveKit {
  /** True when LiveKit's server API answers with our credentials. */
  reachable(): Promise<boolean>;
}

/** LIVEKIT_API_URL, or LIVEKIT_URL with ws → http and wss → https. */
export const apiUrl = (cfg: Config): string => cfg.LIVEKIT_API_URL ?? cfg.LIVEKIT_URL.replace(/^ws/, 'http');

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
    }
  };
}
