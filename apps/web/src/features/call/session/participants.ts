import type { CallParticipant, CallState, Meeting, Person } from '@alcove/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sameEmail } from '~/lib/people';
import { callQueries } from '~/features/calls/list/queries';
import { callKeys } from '~/features/calls/list/queryKeys';

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

/** The current user's own tile in a call. */
export const selfIn = (s: CallState): CallParticipant | undefined => s.participants.find((p) => p.isMe);

/**
 * Who's invited, which only the organizer can read (everyone else learns who's here from the call). Letting someone signed in
 * in from the link, or ringing them, adds them to the invite: the organizer reads it again when someone is here, or rung, and
 * not on it yet.
 */
export function useInvited(code: string, organizer: boolean, told: CallState): Meeting | null | undefined {
  const meeting = useQuery({ ...callQueries.byCode(code), enabled: organizer }).data;
  const qc = useQueryClient();
  const onTheInvite = (who: { email: string }) => (meeting?.guests ?? []).some((g) => sameEmail(g, who));
  const uninvited = organizer && (told.participants.some((p) => !p.isOrganizer && p.person.email && !onTheInvite(p.person)) || told.ringing.some((r) => !onTheInvite(r.person)));
  useEffect(() => { if (uninvited) void qc.invalidateQueries({ queryKey: callKeys.byCode(code) }); }, [uninvited, code, qc]);
  return meeting;
}
