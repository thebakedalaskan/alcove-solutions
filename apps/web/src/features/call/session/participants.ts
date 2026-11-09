import type { CallState, Person } from '@alcove/api';

export const SOMEONE: Person = { id: 'someone', name: 'Someone', email: '' };

/**
 * The call as shown: everyone the server says is in it, and anyone else in its MLS group (anyone who can
 * hear it) as "Someone". Nobody who holds the call's keys is ever left off the screen.
 */
export function asShown(state: CallState, members: string[], self: string): CallState {
  const here = new Set(state.participants.map((p) => p.id));
  const leaving = new Map(state.leaving.map((l) => [l.id, l]));
  // A connection on its way out of the group shows as whose it is, and not at all once that person is here again on another.
  const unknown = members.filter((id) => { const l = leaving.get(id); return !here.has(id) && !(l?.now && here.has(l.now)); });
  if (!unknown.length) return state;
  return { ...state, participants: [...state.participants, ...unknown.map((id) => ({ id, seat: leaving.get(id)?.seat ?? id, person: leaving.get(id)?.person ?? { ...SOMEONE, id }, isMe: id === self, isOrganizer: false, hand: false, status: null, othersPoint: true }))] };
}
