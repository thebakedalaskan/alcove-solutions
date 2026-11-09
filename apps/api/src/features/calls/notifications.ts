import { CALL_TOPIC, type CallChanged } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { maybeOne } from '../../db';
import { log } from '../../log';

const clog = log.child({ component: 'calls' });

/**
 * Tells everyone in the room what changed (the call itself, its MLS log, or both), so they fetch that again, or only the
 * connections in `to` when nobody else's view of the call changed. Nothing else: a change push (`CallChanged`).
 */
export async function tellRoom(o: Pick<Deps, 'livekit'>, roomName: string | null, callId: string, what: { call: boolean; log: boolean }, to?: readonly string[] | undefined): Promise<void> {
  if (!roomName || to?.length === 0) return;
  const n: CallChanged = { v: 1, kind: 'changed', ...what };
  await o.livekit.sendData(roomName, new TextEncoder().encode(JSON.stringify(n)), CALL_TOPIC, to)
    .catch((e: unknown) => clog.warn('room not told about a change', { callId, err: e }));
}

const RoomOf = z.object({ room_name: z.string().nullable() });

/**
 * Tells a call to read itself again when something outside it changed what someone there can open. It needs only where its
 * room is. This one query isn't scoped by owner, because it can't be: a seat in `document_access` names a call, and the call is
 * its organizer's, who's a different owner that nothing in a workspace records. The ID came from that row, never a request,
 * and all this learns is a room's random name, which goes nowhere but the push.
 */
export async function tellCall(d: Pick<Deps, 'pool' | 'livekit'>, callId: string): Promise<void> {
  const r = await maybeOne(d.pool, RoomOf, `SELECT room_name FROM calls WHERE call_id = $1 AND state = 'live'`, [callId]);
  if (r) await tellRoom(d, r.room_name, callId, { call: true, log: false });
}
