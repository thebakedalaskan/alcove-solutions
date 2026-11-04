/* Query keys, fetchers and mutations. Screens read data through these, never through `api` directly. */
import { errorCode, type ActionPatch, type DecisionPatch, type DemoProvider, type Group, type InstantCallInput, type LinePatch, type MeetingInput, type NoteKind, type NotesSetting, type Patch, type Preferences, type QuestionPatch, type Series } from '@alcove/api';
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { forgetAccount } from '~/features/record/offline';
import { forgetNotified } from '~/features/shell/notified';
import { api } from './api';
import { log } from './log';
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
  inbox: ['notes', 'inbox'] as const,
  /** Everything about series: what carries over changes whenever a note or a call in one does. */
  allSeries: ['series'] as const,
  series: (id: string) => ['series', id] as const,
  callSeries: (code: string) => ['series', 'call', code] as const,
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
/** The check in words: verified only when the server's hardware answer is bound to this browser's request. */
export function trustLine(t: Trust | undefined): string {
  if (t?.tee !== 'dstack') return 'Confidential compute';
  return t.bound ? 'Confidential compute · verified' : 'Confidential compute · not verified';
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
  inbox: () => queryOptions({ queryKey: qk.inbox, queryFn: () => api.notes.inbox() }),
  /** What carries over in a series, from the notes you have; put together fresh each time it's asked for. */
  series: (id: string) => queryOptions({ queryKey: qk.series(id), queryFn: () => api.series.get(id), retry: false }),
  /**
   * What carries over into a call, for someone signed in, by its link: null when nothing can. Read again every minute
   * while it's on screen, and whenever the page comes back into view: a note someone stops having goes from here too,
   * however long the call has been open.
   */
  callSeries: (code: string) => queryOptions({ queryKey: qk.callSeries(code), queryFn: () => api.calls.series(code), retry: false, staleTime: 30_000, refetchInterval: 60_000 }),
  balance: () => queryOptions({ queryKey: qk.balance, queryFn: () => api.credits.balance() }),
  /** Checked when the app opens (the side panel and the call both show it), then every ten minutes. */
  trust: () => queryOptions({ queryKey: qk.trust, queryFn: checkTrust, staleTime: 10 * 60_000, refetchInterval: 10 * 60_000, retry: 1 })
};

/**
 * What carries over into a call, while `on`. A read that fails keeps the last answer, as queries do, which would keep
 * showing what someone may not read any more: once the server says so, there's nothing. A dropped connection changes nothing.
 */
export function useCallSeries(code: string, on: boolean): Series | null {
  const r = useQuery({ ...q.callSeries(code), enabled: on });
  const refused = r.error !== null && ['unauthenticated', 'forbidden', 'not-found'].includes(errorCode(r.error));
  return refused ? null : r.data ?? null;
}

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
/**
 * Signed out (or the account deleted) on this device: whatever it kept for the account goes too, the recordings
 * waiting to upload among it (features/record/offline.ts; anyone else's stay), and its notifications, those showing too.
 */
async function forgetHere(qc: QueryClient) {
  await forgetNotified();
  const owner = qc.getQueryData(q.session().queryKey)?.ownerId;
  if (!owner) return;
  try { await forgetAccount(owner); } catch (e) { log.child({ component: 'account' }).error('couldn’t delete what this device kept for the account', { err: e }); }
}
export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.auth.signOut(), onSuccess: async () => { await forgetHere(qc); qc.clear(); qc.setQueryData(qk.session, null); } });
}
/**
 * Deletes the account for good. Every browser it was signed in on is signed out, this one included. `onDeleted` runs
 * then, even if the screen that asked has gone meanwhile.
 */
export function useDeleteAccount(onDeleted: () => void) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.account.delete(), onSuccess: async () => { await forgetHere(qc); qc.clear(); qc.setQueryData(qk.session, null); onDeleted(); } });
}
/*
 * Changes to preferences show at once and reach the server one at a time, in order (two at once would refuse each
 * other there). Each touches only the fields it changes: its answer, or a refusal putting them back, leaves alone a
 * field a later change has set meanwhile. Once none is left on its way, the preferences are read again.
 */
const PREFS_WRITE = { mutationKey: ['prefs', 'write'], scope: { id: 'prefs' } };
/** `p`, with the fields `take` names copied from `from` (where `from` has them). */
function withFields(p: Preferences, from: Patch<Preferences>, take: (k: keyof Preferences) => boolean): Preferences {
  const f = <K extends keyof Preferences>(k: K): Preferences[K] => (take(k) ? from[k] ?? p[k] : p[k]);
  return {
    notesDefault: f('notesDefault'), notesLanguage: f('notesLanguage'), summaryLength: f('summaryLength'), addToCalendar: f('addToCalendar'),
    showOtherMeetings: f('showOtherMeetings'), recordOffline: f('recordOffline'), notifications: f('notifications'), pinned: f('pinned'), groups: f('groups')
  };
}
const prefsWrite = (qc: QueryClient) => {
  const key = q.prefs().queryKey;
  /** The fields this change set that nothing has changed since. */
  const untouched = (p: Preferences, patch: Patch<Preferences>) => (k: keyof Preferences) => patch[k] !== undefined && p[k] === patch[k];
  return {
    ...PREFS_WRITE,
    show: async (patch: Patch<Preferences>) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData(key);
      qc.setQueryData(key, (p) => p && withFields(p, patch, (k) => patch[k] !== undefined));
      return { before };
    },
    undo: (patch: Patch<Preferences>, before: Preferences | undefined) => { if (before) qc.setQueryData(key, (p) => p && withFields(p, before, untouched(p, patch))); },
    settle: (patch: Patch<Preferences>, d: Preferences) => qc.setQueryData(key, (p) => p && withFields(p, d, untouched(p, patch))),
    reread: () => { if (qc.isMutating({ mutationKey: PREFS_WRITE.mutationKey }) <= 1) void qc.invalidateQueries({ queryKey: key }); }
  };
};
/** Changes some preferences: see above. */
export function usePreferences() {
  const w = prefsWrite(useQueryClient());
  return useMutation({
    mutationKey: w.mutationKey, scope: w.scope,
    mutationFn: (p: Patch<Preferences>) => api.account.updatePreferences(p),
    onMutate: w.show,
    onError: (_e, p, ctx) => w.undo(p, ctx?.before),
    onSuccess: (d, p) => w.settle(p, d),
    onSettled: w.reread
  });
}
/**
 * Sets which notes are pinned, in the order they were pinned (at most MAX_PINS), as a change to preferences (above).
 * A refusal because a note is gone also refreshes the notes.
 */
export function usePins() {
  const qc = useQueryClient();
  const w = prefsWrite(qc);
  return useMutation({
    mutationKey: w.mutationKey, scope: w.scope,
    mutationFn: (pinned: string[]) => api.account.updatePreferences({ pinned }),
    onMutate: (pinned) => w.show({ pinned }),
    onError: (e, pinned, ctx) => {
      w.undo({ pinned }, ctx?.before);
      if (errorCode(e) === 'not-found') void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
    },
    onSuccess: (d, pinned) => w.settle({ pinned }, d),
    onSettled: w.reread
  });
}
/**
 * Saves your groups, all of them in order, as a change to preferences (above): it shows at once, so a second change
 * builds on the first, and it waits its turn behind every other change to them. If the server refuses one, only the
 * groups go back, unless a later change has set them meanwhile.
 */
export function useGroups() {
  const w = prefsWrite(useQueryClient());
  return useMutation({
    mutationKey: w.mutationKey, scope: w.scope,
    mutationFn: (groups: Group[]) => api.account.updatePreferences({ groups }),
    onMutate: (groups) => w.show({ groups }),
    onError: (_e, groups, ctx) => w.undo({ groups }, ctx?.before),
    onSuccess: (d, groups) => w.settle({ groups }, d),
    onSettled: w.reread
  });
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
/** Forgets the Google connection; the calendar then asks for access again. */
export function useDisconnectCalendar() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.calendar.disconnect(), onSuccess: (cal) => { qc.setQueryData(qk.calendar, cal); } });
}
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
/** A note that was deleted or removed meanwhile: its notes and inbox items go from the lists. */
const gone = (qc: QueryClient, e: unknown) => {
  if (errorCode(e) !== 'not-found') return;
  void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
  void qc.invalidateQueries({ queryKey: qk.inbox });
};
/** Confirms, rejects, reopens, rewords or supersedes a decision; the answer is the note as it is now. */
export function useUpdateDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; decisionId: string; patch: DecisionPatch }) => api.notes.updateDecision(v.noteId, v.decisionId, v.patch),
    onSuccess: (n) => { changed(qc, n); void qc.invalidateQueries({ queryKey: qk.inbox }); },
    onError: (e) => gone(qc, e)
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
/** Says the notes got it wrong: a later call didn't replace that decision or answer that question. */
export function useDismissRevisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; revisitId: string }) => api.notes.dismissRevisit(v.noteId, v.revisitId),
    onSuccess: (n) => changed(qc, n)
  });
}
/** Takes on, gives, dates, rewords or ticks a follow-up; the answer is the note as it is now. */
export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; actionId: string; patch: ActionPatch }) => api.notes.updateAction(v.noteId, v.actionId, v.patch),
    onSuccess: (n) => { changed(qc, n); void qc.invalidateQueries({ queryKey: qk.inbox }); },
    onError: (e) => gone(qc, e)
  });
}
/** Corrects a transcript line's words or speaker, or says it's right as heard; the answer is the note as it is now. */
export function useCorrectLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; lineId: string; patch: LinePatch }) => api.notes.correctLine(v.noteId, v.lineId, v.patch),
    onSuccess: (n) => changed(qc, n)
  });
}
/** The organizer has the notes written again from the transcript as it is now; the note answers pending until they are. */
export function useRewriteNotes() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (noteId: string) => api.notes.rewrite(noteId), onSuccess: (n) => changed(qc, n) });
}
/**
 * Shares a note with people, by address, and with one of your groups, under its name (everyone it reaches sees that
 * it came to them as that group): the group first, then anyone else. The answer is the note as it is now.
 */
export function useShareNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; emails: string[]; group?: Group | undefined }) => {
      const viaGroup = v.group && await api.notes.share(v.id, { emails: v.group.emails, group: v.group.name });
      return viaGroup && !v.emails.length ? viaGroup : api.notes.share(v.id, { emails: v.emails });
    },
    onSuccess: (n) => changed(qc, n),
    // A group's share may have gone through before the rest failed: the note is read again either way.
    onError: (_e, v) => { void qc.invalidateQueries({ queryKey: qk.note(v.id) }); }
  });
}
export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notes.delete(id),
    // The note itself stays cached until its page lets go of it, so the page can say what was deleted.
    onSuccess: () => {
      for (const key of [['notes', 'list'], qk.inbox, qk.meetings, qk.allSeries]) void qc.invalidateQueries({ queryKey: key });
    }
  });
}
