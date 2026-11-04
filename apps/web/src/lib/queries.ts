/* Query keys, fetchers and mutations. Screens read data through these, never through `api` directly. */
import { errorCode, type ActionPatch, type DecisionPatch, type DemoProvider, type InstantCallInput, type MeetingInput, type NoteKind, type NotesSetting, type Patch, type Preferences, type QuestionPatch } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { weekOn } from './time';

export const qk = {
  session: ['session'] as const,
  prefs: ['prefs'] as const,
  team: ['team'] as const,
  people: (query: string) => ['people', query] as const,
  meetings: ['meetings'] as const,
  upcoming: ['meetings', 'upcoming'] as const,
  byCode: (code: string) => ['meetings', 'code', code] as const,
  card: (code: string) => ['calls', 'card', code] as const,
  calendar: ['meetings', 'calendar'] as const,
  notes: ['notes'] as const,
  noteList: (kind?: NoteKind, text?: string) => ['notes', 'list', kind ?? 'all', text ?? ''] as const,
  note: (id: string) => ['notes', 'one', id] as const,
  openActions: ['notes', 'actions'] as const,
  /** Everything about series: what carries over changes whenever a note or a call in one does. */
  allSeries: ['series'] as const,
  series: (id: string) => ['series', id] as const,
  balance: ['credits'] as const,
  trust: ['trust'] as const
};

/** What the API says it runs on, and whether its answer is bound to the nonce this browser sent. */
export interface Trust { tee: 'none' | 'dstack'; bound: boolean; at: number }
async function checkTrust(): Promise<Trust> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const a = await api.trust.attestation(nonce);
  if (a.tee === 'none') return { tee: 'none', bound: false, at: Date.now() };
  // The quote's report data must be SHA-512 of this request's nonce and the running commit.
  const want = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(`alcove-attestation/v1\n${nonce}\n${a.build.commit}`));
  const hex = Array.from(new Uint8Array(want), (b) => b.toString(16).padStart(2, '0')).join('');
  return { tee: 'dstack', bound: a.nonce === nonce && a.reportData.toLowerCase() === hex && a.quote.length > 0, at: Date.now() };
}

export const q = {
  session: () => queryOptions({ queryKey: qk.session, queryFn: () => api.auth.getSession(), staleTime: 60_000 }),
  prefs: () => queryOptions({ queryKey: qk.prefs, queryFn: () => api.account.preferences() }),
  team: () => queryOptions({ queryKey: qk.team, queryFn: () => api.people.team(), staleTime: 5 * 60_000 }),
  people: (query: string) => queryOptions({ queryKey: qk.people(query), queryFn: () => api.people.search(query), staleTime: 30_000, placeholderData: (prev) => prev }),
  upcoming: () => queryOptions({ queryKey: qk.upcoming, queryFn: () => api.meetings.upcoming(), refetchInterval: 60_000 }),
  byCode: (code: string) => queryOptions({ queryKey: qk.byCode(code), queryFn: () => api.meetings.byCode(code) }),
  /**
   * A call link's title and organizer, what the call captures and whether it can be joined yet, for anyone (no
   * account needed), and for someone signed in where they stand (signing in starts the cache over, so it's read again).
   * Read again every 3 to 5 seconds while waiting for the organizer, so joining opens soon after they arrive, and now
   * and then after that (capture changing, a lock); a little apart, so many people waiting don't read it in step. After
   * a refusal (too many reads from one address) or a failed read it waits 20 seconds or more; a code that leads nowhere
   * isn't asked again.
   */
  card: (code: string) => queryOptions({
    queryKey: qk.card(code), queryFn: () => api.calls.card(code),
    refetchInterval: (query) => {
      const failed = query.state.error ? errorCode(query.state.error) : null;
      if (failed === 'not-found') return false;
      const d = query.state.data;
      const base = failed ? 20_000 : d?.ended ? 30_000 : d?.hostHere ? 10_000 : 3_000;
      // How far apart from other browsers, by the milliseconds of when this one last heard back. It's asked for on every
      // render and must stay the same until the next answer: a new value restarts the wait, so a random one never ends.
      const apart = ((query.state.dataUpdatedAt + query.state.errorUpdatedAt) % 997) / 997;
      return Math.round(base * (1 + apart / 1.5));
    }
  }),
  /** Someone's other calendar events; refreshed every few minutes, since they change outside Alcove. */
  calendar: () => queryOptions({ queryKey: qk.calendar, queryFn: () => api.calendar.get(), staleTime: 60_000, refetchInterval: 3 * 60_000, retry: false }),
  notes: (kind?: NoteKind, text?: string) => queryOptions({ queryKey: qk.noteList(kind, text), queryFn: () => api.notes.list({ kind, text }), placeholderData: (prev) => prev }),
  note: (id: string) => queryOptions({ queryKey: qk.note(id), queryFn: () => api.notes.get(id) }),
  openActions: () => queryOptions({ queryKey: qk.openActions, queryFn: () => api.notes.openActions() }),
  /** What carries over in a series, from the notes you have; put together fresh each time it's asked for. */
  series: (id: string) => queryOptions({ queryKey: qk.series(id), queryFn: () => api.series.get(id), retry: false }),
  balance: () => queryOptions({ queryKey: qk.balance, queryFn: () => api.credits.balance() }),
  /** Checked once a call opens, then every ten minutes. */
  trust: () => queryOptions({ queryKey: qk.trust, queryFn: checkTrust, staleTime: 10 * 60_000, refetchInterval: 10 * 60_000, retry: 1 })
};

/* ---------- account ---------- */

/** Where the browser goes to sign in with Google; it comes back to /ready, /home or /welcome?signin=… */
/** Where Google sign-in starts. `next: '/move'` comes back to a move to this device that was waiting for it. */
export const googleSignInUrl = (next?: '/move' | undefined) => api.auth.signInUrl('google', next ? { next } : undefined);

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
/** A call changed or went: Home's calls, and any series it's the next call of, catch up. */
const callsChanged = (qc: QueryClient) => { void qc.invalidateQueries({ queryKey: qk.meetings }); void qc.invalidateQueries({ queryKey: qk.allSeries }); };
export function useUpdateCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; input: Patch<MeetingInput> }) => api.meetings.update(v.id, v.input), onSuccess: () => callsChanged(qc) });
}
/** Makes one of your own calendar events an Alcove call; an occurrence of a recurring event joins its series. */
export function useAdoptEvent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { eventId: string; notes?: NotesSetting | undefined }) => api.calendar.adopt(v.eventId, v.notes), onSuccess: () => callsChanged(qc) });
}
/** Where the browser goes to give Alcove access to Google Calendar. */
export const calendarConnectUrl = () => api.calendar.connectUrl();
export function useCancelCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.meetings.cancel(id), onSuccess: () => callsChanged(qc) });
}
export function useStartNow() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: InstantCallInput) => api.calls.startNow(input), onSuccess: () => qc.invalidateQueries({ queryKey: qk.meetings }) });
}
/** Schedules the next call after a call (starting its series if it isn't in one): the same clock time here, a week on. */
export function useScheduleNext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { meetingId: string }) => api.meetings.scheduleNext(v.meetingId, weekOn((await api.meetings.get(v.meetingId)).startsAt)),
    // The call's notes say which series they're in now.
    onSuccess: () => { callsChanged(qc); void qc.invalidateQueries({ queryKey: qk.notes }); }
  });
}

/* ---------- notes ---------- */

/** A note changed: its page shows the answer, and lists and series that read it catch up. */
function changed(qc: QueryClient, n: { id: string }) {
  qc.setQueryData(qk.note(n.id), n);
  void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
  void qc.invalidateQueries({ queryKey: qk.allSeries });
}
/** Confirms, rejects, reopens, rewords or supersedes a decision; the answer is the note as it is now. */
export function useUpdateDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; decisionId: string; patch: DecisionPatch }) => api.notes.updateDecision(v.noteId, v.decisionId, v.patch),
    onSuccess: (n) => changed(qc, n)
  });
}
/** Says an open question was answered, reopens or rewords it; the answer is the note as it is now. */
export function useUpdateQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; questionId: string; patch: QuestionPatch }) => api.notes.updateQuestion(v.noteId, v.questionId, v.patch),
    onSuccess: (n) => changed(qc, n)
  });
}
/** Takes on, gives, dates, rewords or ticks a follow-up; the answer is the note as it is now. */
export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; actionId: string; patch: ActionPatch }) => api.notes.updateAction(v.noteId, v.actionId, v.patch),
    onSuccess: (n) => { changed(qc, n); void qc.invalidateQueries({ queryKey: qk.openActions }); }
  });
}
export function useShareNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; emails: string[] }) => api.notes.share(v.id, v.emails),
    onSuccess: (n) => changed(qc, n)
  });
}
export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notes.delete(id),
    // The note itself stays cached until its page lets go of it, so the page can say what was deleted.
    onSuccess: () => {
      for (const key of [['notes', 'list'], qk.openActions, qk.meetings, qk.allSeries]) void qc.invalidateQueries({ queryKey: key });
    }
  });
}
