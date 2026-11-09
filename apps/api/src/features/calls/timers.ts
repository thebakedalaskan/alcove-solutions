import { type CallTimerControl, type CallTimerSequence, type CallTimerSequenceInput, type CallState } from '@alcove/api';
import { tx } from '../../db';
import { ConflictError } from '../../errors';
import { log } from '../../log';
import { type Viewer } from './participants';
import { stillHosting } from './permissions';
import { load, saveSettled, settle } from './state';
import { nudge } from './notifications';
import { afterClosing } from './room-boards';
import { view } from './read-model';

const tlog = log.child({ component: 'call-timers' });
/** A sequence command is settled under the same row lock as admission and host changes. */
async function change(v: Viewer, callId: string, expectedRevision: number | null, action: string, apply: (current: CallTimerSequence | null, now: number) => CallTimerSequence): Promise<CallState> {
  const o = v.organizer;
  const { room, closed } = await tx(o.pool, async (db) => {
    const { row, state } = await load(o, db, callId, true);
    const context = { callId, action };
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context });
    stillHosting(v, state, context);
    const current = state.timerSequence;
    if ((current?.revision ?? null) !== expectedRevision) throw new ConflictError('The timer has changed. Review it and try again.', { context });
    const timerSequence = apply(current, Date.now());
    const saved = await saveSettled(o, db, callId, state, { ...settle(state, row), timerSequence });
    return { room: row.room_name, closed: saved.closed };
  });
  tlog.info('timer changed', { callId, action });
  return afterClosing({ organizer: o, callId }, closed, async () => {
    await nudge(o, room, callId, { call: true, log: false });
    return view(v, o.pool, callId);
  });
}

export function setSequence(v: Viewer, callId: string, input: CallTimerSequenceInput): Promise<CallState> {
  return change(v, callId, input.expectedRevision, 'sequence', (current) => {
    if (!current || current.status === 'finished') return { revision: (current?.revision ?? -1) + 1, segments: input.segments, activeIndex: 0, status: 'ready', elapsedMs: 0, startedAt: null, addedSeconds: 0 };
    if (current.status !== 'ready') {
      // Slots already presented and the active slot cannot change identity, order, wording or duration beneath a live clock.
      for (let index = 0; index <= current.activeIndex; index++) {
        const before = current.segments[index]; const after = input.segments[index];
        if (!before || !after || before.id !== after.id || before.label !== after.label || before.durationSeconds !== after.durationSeconds || before.presenter !== after.presenter) {
          throw new ConflictError('Only upcoming timer segments can be edited after starting.', { context: { callId, activeIndex: current.activeIndex } });
        }
      }
    }
    return { ...current, revision: current.revision + 1, segments: input.segments };
  });
}

export function control(v: Viewer, callId: string, input: CallTimerControl): Promise<CallState> {
  return change(v, callId, input.expectedRevision, input.action, (current, now) => {
    const context = { callId, action: input.action };
    if (!current) throw new ConflictError('Add timer segments first.', { context });
    const elapsedMs = current.elapsedMs + (current.startedAt === null ? 0 : Math.max(0, now - current.startedAt));
    const next = { ...current, revision: current.revision + 1 };
    if (input.action === 'start' && current.status === 'ready') return { ...next, status: 'running', startedAt: now };
    if (input.action === 'pause' && current.status === 'running') return { ...next, status: 'paused', elapsedMs, startedAt: null };
    if (input.action === 'resume' && current.status === 'paused') return { ...next, status: 'running', startedAt: now };
    if (input.action === 'restart') return { ...next, status: 'running', elapsedMs: 0, startedAt: now, addedSeconds: 0 };
    if (input.action === 'add-time' && current.status !== 'finished') {
      if (current.addedSeconds + input.seconds > 86_400) throw new ConflictError('This segment already has a full day of extra time.', { context });
      return { ...next, addedSeconds: current.addedSeconds + input.seconds };
    }
    if ((input.action === 'advance' || input.action === 'skip') && current.status !== 'finished') {
      if (current.activeIndex + 1 >= current.segments.length) return { ...next, status: 'finished', elapsedMs, startedAt: null };
      return { ...next, activeIndex: current.activeIndex + 1, status: 'running', elapsedMs: 0, startedAt: now, addedSeconds: 0 };
    }
    throw new ConflictError('That timer control is not available right now.', { context: { ...context, state: current.status } });
  });
}
