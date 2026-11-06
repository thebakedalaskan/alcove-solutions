import type { CallState, Person } from '@alcove/api';

export const SOMEONE: Person = { id: 'someone', name: 'Someone', email: '' };

/** Whether this build runs with the listener service: only then can the server name a listener to leave off the screen. */
const LISTENERS = import.meta.env.VITE_ALCOVE_LISTENERS === 'on';
/** How long after notes go off the listener on its way out of the call's group is still left off the screen. */
const LEAVING_MS = 10_000;

/**
 * The call as shown: everyone the server says is in it, and anyone else in its MLS group (anyone who can
 * hear it) as "Someone". Nobody who holds the call's keys is ever left off the screen, but one, in builds with the
 * listener service: while notes are on or paused (and for a moment after they go off, while the host's browser takes it
 * out of the group), the listener the server names hears the call for its notes, and the call's notes sign says so.
 */
export function asShown(state: CallState, members: string[], self: string, now = Date.now()): CallState {
  const here = new Set(state.participants.map((p) => p.id));
  const leaving = new Map(state.leaving.map((l) => [l.id, l]));
  // Never more than one, and never while notes are unavailable or long off: a listener then, or a second, shows as anyone else would.
  const mode = state.capture.mode;
  const offSince = state.capture.transcript.since ? Date.parse(state.capture.transcript.since) : Number.NaN;
  const hearing = mode === 'on' || mode === 'paused' || (mode === 'off' && now - offSince < LEAVING_MS);
  const listener = LISTENERS && hearing ? members.find((id) => state.listeners.includes(id)) : undefined;
  // A connection on its way out of the group shows as whose it is, and not at all once that person is here again on another.
  const unknown = members.filter((id) => { const l = leaving.get(id); return id !== listener && !here.has(id) && !(l?.now && here.has(l.now)); });
  if (!unknown.length) return state;
  return { ...state, participants: [...state.participants, ...unknown.map((id) => ({ id, seat: leaving.get(id)?.seat ?? id, person: leaving.get(id)?.person ?? { ...SOMEONE, id }, isMe: id === self, isOrganizer: false, hand: false, othersPoint: true }))] };
}
