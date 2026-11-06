import { CALL_TOPIC, type CallNudge } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { maybeOne } from '../../db';
import { log } from '../../log';

const clog = log.child({ component: 'calls' });

/** Tells everyone in the room what changed (the call itself, its MLS log, or both), so they fetch that again. Nothing else. */
export async function nudge(o: Pick<Deps, 'livekit'>, roomName: string | null, callId: string, what: { call: boolean; log: boolean }): Promise<void> {
  if (!roomName) return;
  const n: CallNudge = { v: 1, kind: 'changed', ...what };
  await o.livekit.sendData(roomName, new TextEncoder().encode(JSON.stringify(n)), CALL_TOPIC)
    .catch((e: unknown) => clog.warn('room not told about a change', { callId, err: e }));
}

const RoomOf = z.object({ room_name: z.string().nullable() });

/**
 * Tells a call to read itself again when something outside it changed what someone there can open. It needs only where its
 * room is. This one query isn't scoped by owner, because it can't be: a seat in `document_access` names a call, and the call is
 * its organizer's, who's a different owner that nothing in a workspace records. The ID came from that row, never a request,
 * and all this learns is a room's random name, which goes nowhere but the nudge.
 */
export async function nudgeCall(d: Pick<Deps, 'pool' | 'livekit'>, callId: string): Promise<void> {
  const r = await maybeOne(d.pool, RoomOf, `SELECT room_name FROM calls WHERE call_id = $1 AND state = 'live'`, [callId]);
  if (r) await nudge(d, r.room_name, callId, { call: true, log: false });
}
