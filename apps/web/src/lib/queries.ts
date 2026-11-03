/* Query keys, fetchers and mutations. Screens read data through these, never through `api` directly. */
import type { ActionPatch, DecisionPatch, DemoProvider, InstantCallInput, MeetingInput, NoteKind, NotesSetting, Patch, Preferences } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const qk = {
  session: ['session'] as const,
  prefs: ['prefs'] as const,
  team: ['team'] as const,
  people: (query: string) => ['people', query] as const,
  meetings: ['meetings'] as const,
  upcoming: ['meetings', 'upcoming'] as const,
  byCode: (code: string) => ['meetings', 'code', code] as const,
  calendar: ['meetings', 'calendar'] as const,
  notes: ['notes'] as const,
  noteList: (kind?: NoteKind, text?: string) => ['notes', 'list', kind ?? 'all', text ?? ''] as const,
  note: (id: string) => ['notes', 'one', id] as const,
  openActions: ['notes', 'actions'] as const,
  balance: ['credits'] as const
};

export const q = {
  session: () => queryOptions({ queryKey: qk.session, queryFn: () => api.auth.getSession(), staleTime: 60_000 }),
  prefs: () => queryOptions({ queryKey: qk.prefs, queryFn: () => api.account.preferences() }),
  team: () => queryOptions({ queryKey: qk.team, queryFn: () => api.people.team(), staleTime: 5 * 60_000 }),
  people: (query: string) => queryOptions({ queryKey: qk.people(query), queryFn: () => api.people.search(query), staleTime: 30_000, placeholderData: (prev) => prev }),
  upcoming: () => queryOptions({ queryKey: qk.upcoming, queryFn: () => api.meetings.upcoming(), refetchInterval: 60_000 }),
  byCode: (code: string) => queryOptions({ queryKey: qk.byCode(code), queryFn: () => api.meetings.byCode(code) }),
  /** Someone's other calendar events; refreshed every few minutes, since they change outside Alcove. */
  calendar: () => queryOptions({ queryKey: qk.calendar, queryFn: () => api.calendar.get(), staleTime: 60_000, refetchInterval: 3 * 60_000, retry: false }),
  notes: (kind?: NoteKind, text?: string) => queryOptions({ queryKey: qk.noteList(kind, text), queryFn: () => api.notes.list({ kind, text }), placeholderData: (prev) => prev }),
  note: (id: string) => queryOptions({ queryKey: qk.note(id), queryFn: () => api.notes.get(id) }),
  openActions: () => queryOptions({ queryKey: qk.openActions, queryFn: () => api.notes.openActions() }),
  balance: () => queryOptions({ queryKey: qk.balance, queryFn: () => api.credits.balance() })
};

/* ---------- account ---------- */

/** Where the browser goes to sign in with Google; it comes back to /ready, /home or /welcome?signin=… */
export const googleSignInUrl = () => api.auth.signInUrl('google');

/** Signing in or out changes whose data everything is, so the cache starts over. */
export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { provider: DemoProvider; email?: string | undefined }) => api.auth.signIn(v.provider, { email: v.email }),
    onSuccess: (r) => { qc.clear(); qc.setQueryData(qk.session, r.session); }
  });
}
export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.auth.signOut(), onSuccess: () => { qc.clear(); qc.setQueryData(qk.session, null); } });
}
export function usePreferences() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Patch<Preferences>) => api.account.updatePreferences(p), onSuccess: (d) => qc.setQueryData(qk.prefs, d) });
}
export function useInviteTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (emails: string[]) => api.people.inviteToTeam(emails), onSuccess: (t) => qc.setQueryData(qk.team, t) });
}

/* ---------- calls ---------- */

export function useScheduleCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: MeetingInput) => api.meetings.create(input), onSuccess: () => qc.invalidateQueries({ queryKey: qk.meetings }) });
}
export function useUpdateCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; input: Patch<MeetingInput> }) => api.meetings.update(v.id, v.input), onSuccess: () => qc.invalidateQueries({ queryKey: qk.meetings }) });
}
/** Makes one of your own calendar events an Alcove call. */
export function useAdoptEvent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { eventId: string; notes?: NotesSetting | undefined }) => api.calendar.adopt(v.eventId, v.notes), onSuccess: () => qc.invalidateQueries({ queryKey: qk.meetings }) });
}
/** Where the browser goes to give Alcove access to Google Calendar. */
export const calendarConnectUrl = () => api.calendar.connectUrl();
export function useCancelCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.meetings.cancel(id), onSuccess: () => qc.invalidateQueries({ queryKey: qk.meetings }) });
}
export function useStartNow() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: InstantCallInput) => api.calls.startNow(input), onSuccess: () => qc.invalidateQueries({ queryKey: qk.meetings }) });
}

/* ---------- notes ---------- */

/** Confirms, rejects, reopens or rewords a decision; the answer is the note as it is now. */
export function useUpdateDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; decisionId: string; patch: DecisionPatch }) => api.notes.updateDecision(v.noteId, v.decisionId, v.patch),
    onSuccess: (n) => { qc.setQueryData(qk.note(n.id), n); void qc.invalidateQueries({ queryKey: ['notes', 'list'] }); }
  });
}
/** Takes on, gives, dates, rewords or ticks a follow-up; the answer is the note as it is now. */
export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; actionId: string; patch: ActionPatch }) => api.notes.updateAction(v.noteId, v.actionId, v.patch),
    onSuccess: (n) => { qc.setQueryData(qk.note(n.id), n); void qc.invalidateQueries({ queryKey: ['notes', 'list'] }); void qc.invalidateQueries({ queryKey: qk.openActions }); }
  });
}
export function useShareNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; emails: string[] }) => api.notes.share(v.id, v.emails),
    onSuccess: (n) => { qc.setQueryData(qk.note(n.id), n); void qc.invalidateQueries({ queryKey: ['notes', 'list'] }); }
  });
}
export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notes.delete(id),
    // The note itself stays cached until its page lets go of it, so the page can say what was deleted.
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notes', 'list'] }); void qc.invalidateQueries({ queryKey: qk.openActions }); void qc.invalidateQueries({ queryKey: qk.meetings }); }
  });
}
