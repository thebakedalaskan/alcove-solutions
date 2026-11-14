import { CALL_TIMER_MAX_SECONDS, type CallState, type CallTimer, type CallTimerControl } from '@alcove/api';
import { id128 } from '../../../keys/crypto';
import { tx } from '../../../platform/db';
import { ConflictError } from '../../../platform/errors';
import { log } from '../../../platform/log';
import { type Viewer } from '../participants';
import { stillHosting } from '../permissions';
import { load, saveSettled, settle } from '../state';
import { tellRoom } from '../attention/notifications';
import { afterClosing } from '../boards/room-boards';
import { view } from '../read-model';

const tlog = log.child({ component: 'call-timer' });

/**
 * The host changes the call's timer, under the same row lock as admission and host changes, on the server's clock. A start
 * needs no timer to be running; anything else names the revision it was made against, so a stale press is refused.
 */
export async function control(v: Viewer, callId: string, input: CallTimerControl): Promise<CallState> {
  const o = v.organizer;
  const context = { callId, action: input.action };
  const { room, closed } = await tx(o.pool, async (db) => {
    const { row, state } = await load(o, db, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context });
    stillHosting(v, state, context);
    const timer = next(state.timer, input, Date.now(), context);
    const saved = await saveSettled(o, db, callId, state, { ...settle(state, row), timer });
    return { room: row.room_name, closed: saved.closed };
  });
  tlog.info('timer changed', context);
  return afterClosing({ organizer: o, callId }, closed, async () => {
    await tellRoom(o, room, callId, { call: true, log: false });
    return view(v, o.pool, callId);
  });
}

function next(current: CallTimer | null, input: CallTimerControl, now: number, context: { callId: string; action: string }): CallTimer | null {
  if (input.action === 'start') {
    if (current) throw new ConflictError('A timer is running already. Stop it to start another.', { context });
    return { id: id128(), revision: 0, durationSeconds: input.durationSeconds, status: 'running', elapsedMs: 0, startedAt: now };
  }
  if (!current || current.revision !== input.expectedRevision) throw new ConflictError('The timer has changed. Look at it again and try once more.', { context });
  const elapsedMs = current.elapsedMs + (current.startedAt === null ? 0 : Math.max(0, now - current.startedAt));
  const changed = { ...current, revision: current.revision + 1 };
  switch (input.action) {
    case 'stop': return null;
    case 'pause': if (current.status === 'running') return { ...changed, status: 'paused', elapsedMs, startedAt: null }; break;
    case 'resume': if (current.status === 'paused') return { ...changed, status: 'running', startedAt: now }; break;
    case 'add-time': {
      // Over time, the time added counts from now (to the second it's on): a minute more is a minute left.
      const durationSeconds = Math.max(current.durationSeconds, Math.floor(elapsedMs / 1000)) + input.seconds;
      if (durationSeconds > CALL_TIMER_MAX_SECONDS) throw new ConflictError('A timer runs for a day at most.', { context });
      return { ...changed, durationSeconds };
    }
  }
  throw new ConflictError('That isn’t something the timer can do right now.', { context: { ...context, state: current.status } });
}
