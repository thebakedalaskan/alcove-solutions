/* Query keys and fetchers. Screens read data through these, never through `api` directly. */
import type { MeetingInput, MeetingNotesSetting, NoteKind, Preferences } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const qk = {
  session: ['session'] as const,
  prefs: ['prefs'] as const,
  passkeys: ['passkeys'] as const,
  calendars: ['calendars'] as const,
  setup: ['setup'] as const,
  upcoming: ['meetings', 'upcoming'] as const,
  past: ['meetings', 'past'] as const,
  meeting: (id: string) => ['meetings', id] as const,
  byCode: (code: string) => ['meetings', 'code', code] as const,
  notes: (kind?: NoteKind, text?: string) => ['notes', 'list', kind ?? 'all', text ?? ''] as const,
  note: (id: string) => ['notes', id] as const,
  openActions: ['notes', 'actions'] as const,
  balance: ['credits', 'balance'] as const,
  history: ['credits', 'history'] as const,
  packs: ['credits', 'packs'] as const,
  week: ['stats', 'week'] as const
};

export const q = {
  session: () => queryOptions({ queryKey: qk.session, queryFn: () => api.auth.getSession(), staleTime: 60_000 }),
  prefs: () => queryOptions({ queryKey: qk.prefs, queryFn: () => api.account.preferences() }),
  passkeys: () => queryOptions({ queryKey: qk.passkeys, queryFn: () => api.account.passkeys() }),
  calendars: () => queryOptions({ queryKey: qk.calendars, queryFn: () => api.account.calendars() }),
  setup: () => queryOptions({ queryKey: qk.setup, queryFn: () => api.account.setupSteps() }),
  upcoming: () => queryOptions({ queryKey: qk.upcoming, queryFn: () => api.meetings.upcoming() }),
  past: () => queryOptions({ queryKey: qk.past, queryFn: () => api.meetings.past() }),
  meeting: (id: string) => queryOptions({ queryKey: qk.meeting(id), queryFn: () => api.meetings.get(id) }),
  byCode: (code: string) => queryOptions({ queryKey: qk.byCode(code), queryFn: () => api.meetings.byCode(code) }),
  notes: (kind?: NoteKind, text?: string) => queryOptions({ queryKey: qk.notes(kind, text), queryFn: () => api.notes.list({ kind, text }), placeholderData: (prev) => prev }),
  note: (id: string) => queryOptions({ queryKey: qk.note(id), queryFn: () => api.notes.get(id) }),
  openActions: () => queryOptions({ queryKey: qk.openActions, queryFn: () => api.notes.openActions() }),
  balance: () => queryOptions({ queryKey: qk.balance, queryFn: () => api.credits.balance() }),
  history: () => queryOptions({ queryKey: qk.history, queryFn: () => api.credits.history() }),
  packs: () => queryOptions({ queryKey: qk.packs, queryFn: () => api.credits.packs(), staleTime: Infinity }),
  week: () => queryOptions({ queryKey: qk.week, queryFn: () => api.stats.week() })
};

/* ---------- mutations ---------- */

export function useSaveMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string | undefined; input: MeetingInput }) => (id ? api.meetings.update(id, input) : api.meetings.create(input)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['meetings'] }); void qc.invalidateQueries({ queryKey: qk.week }); }
  });
}
export function useMeetingNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: MeetingNotesSetting }) => api.meetings.setNotes(id, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] })
  });
}
export function useCancelMeeting() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.meetings.cancel(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }) });
}
export function useActionDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; actionId: string; done: boolean }) => api.notes.setActionDone(v.noteId, v.actionId, v.done),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] })
  });
}
export function usePreferences() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Partial<Preferences>) => api.account.updatePreferences(p), onSuccess: (d) => qc.setQueryData(qk.prefs, d) });
}
export function usePurchase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (packId: string) => api.credits.purchase(packId), onSuccess: () => qc.invalidateQueries({ queryKey: ['credits'] }) });
}
/** After sign-in, sign-out or a scenario switch everything cached is stale. */
export function useResetCache() {
  const qc = useQueryClient();
  return () => qc.resetQueries();
}
