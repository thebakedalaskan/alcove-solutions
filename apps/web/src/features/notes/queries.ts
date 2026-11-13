/*
 * The notes' data: your notes and searches of them, one note, and the inbox, with the changes a reader makes to a note
 * (decisions, follow-ups, questions, the transcript, writing it again, deleting it). Your own notes on a note
 * (./personal/queries.ts), sharing one (./sharing/queries.ts) and series (./series/queries.ts) have their own.
 */
import { errorCode, type ActionProposal, type DecisionProposal, type FollowUpReview, type LinePatch, type NoteKind, type QuestionPatch } from '@alcove/api';
import { queryOptions, useMutation, useMutationState, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { accountKeys } from '~/features/account/queryKeys';
import { callKeys } from '~/features/calls/list/queryKeys';
import { api } from '~/lib/api';
import { readInbox, readNote, refreshChangedNote, updateActionOptions, updateDecisionOptions } from '~/lib/queryWrites';
import { noteKeys } from './queryKeys';

/** The keys the note's reversible writes (lib/queryWrites.ts) project over, and whose session owns them. */
const writeKeys = { session: accountKeys.session, note: noteKeys.note, inbox: noteKeys.inbox, allSeries: noteKeys.allSeries };

export const noteQueries = {
  /**
   * Your notes, newest first, or what a search finds: notes with the words, and the lines that have them. `by` is someone's
   * address: only what they said counts. The words and the address travel in the request's body, never its address.
   */
  notes: (kind?: NoteKind, text?: string, by?: string) => queryOptions({ queryKey: noteKeys.noteList(kind, text, by), queryFn: () => api.notes.list({ kind, text, by }), placeholderData: (prev) => prev }),
  note: (id: string) => queryOptions({ queryKey: noteKeys.note(id), queryFn: ({ client }) => readNote(api, client, id) }),
  inbox: () => queryOptions({ queryKey: noteKeys.inbox, queryFn: ({ client }) => readInbox(api, client) })
};

/**
 * Whether a list of notes' key (`noteKeys.noteList`) is a search: it has words, or someone whose lines it looks in. The plain
 * list of your notes isn't one, so it's never what a search shows while its answer is on the way.
 */
export const isNoteSearch = (key: ReturnType<typeof noteKeys.noteList>): boolean => key[3] !== '' || key[4] !== '';

/** A write's whole-note answer may predate a newer command. Read it afresh through the projection owner. */
export function noteChanged(qc: QueryClient, n: { id: string }) {
  return refreshChangedNote(api, qc, writeKeys, n.id);
}
/**
 * A note that was deleted or removed meanwhile: its notes and inbox items go from the lists. One that changed since it
 * was read refused what was asked of it, so it's read again, and the person sees what it says now.
 */
export const noteGone = (qc: QueryClient, e: unknown) => {
  const code = errorCode(e);
  if (code === 'conflict') for (const queryKey of [noteKeys.notes, noteKeys.allSeries]) void qc.invalidateQueries({ queryKey });
  if (code !== 'not-found') return;
  void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
  void qc.invalidateQueries({ queryKey: noteKeys.inbox });
};
/** Adds a decision the notes didn't hear, in the reader's words; the answer is the note as it is now. */
export function useProposeDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; proposal: DecisionProposal }) => api.notes.proposeDecision(v.noteId, v.proposal),
    onSuccess: (n) => noteChanged(qc, n),
    onError: (e) => noteGone(qc, e)
  });
}
/** Adds a follow-up the notes didn't hear; the answer is the note as it is now. */
export function useProposeAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; proposal: ActionProposal }) => api.notes.proposeAction(v.noteId, v.proposal),
    onSuccess: (n) => noteChanged(qc, n),
    onError: (e) => noteGone(qc, e)
  });
}
/** Adds or dismisses precisely the conversation suggestion the reader reviewed. */
export function useReviewAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; review: FollowUpReview }) => api.notes.reviewAction(v.noteId, v.review),
    onSuccess: (n) => noteChanged(qc, n),
    onError: (e) => noteGone(qc, e)
  });
}
/** Confirms, rejects, disputes, reopens, rewords or supersedes a decision; the answer is the note as it is now. */
export function useUpdateDecision() {
  const qc = useQueryClient();
  return useMutation({
    ...updateDecisionOptions(api, qc, writeKeys),
    onError: (e) => noteGone(qc, e)
  });
}
/** Says an open question was answered, reopens or rewords it; the answer is the note as it is now. */
export function useUpdateQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; questionId: string; patch: QuestionPatch }) => api.notes.updateQuestion(v.noteId, v.questionId, v.patch),
    onSuccess: (n) => noteChanged(qc, n)
  });
}
/** Says the notes got it wrong, a later call didn't replace that decision or answer that question, or takes that back. */
export function useUpdateRevisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; revisitId: string; dismissed: boolean }) => api.notes.updateRevisit(v.noteId, v.revisitId, { dismissed: v.dismissed }),
    onSuccess: (n) => noteChanged(qc, n)
  });
}
/** Takes on, turns down, gives, dates, rewords or ticks a follow-up; the answer is the note as it is now. */
export function useUpdateAction() {
  const qc = useQueryClient();
  const options = updateActionOptions(api, qc, writeKeys);
  return useMutation({ ...options, onError: (e, v, ctx, context) => {
    options.onError?.(e, v, ctx, context);
    noteGone(qc, e);
  } });
}
/** Pending checkboxes are announced by their own row, including writes started from another view. */
export function usePendingActions() {
  const pending = useMutationState({ filters: { mutationKey: ['notes', 'action'], status: 'pending' }, select: (mutation) => {
    const v = mutation.state.variables;
    return v && typeof v === 'object' && 'noteId' in v && typeof v.noteId === 'string' && 'actionId' in v && typeof v.actionId === 'string' ? `${v.noteId}:${v.actionId}` : null;
  } });
  return new Set(pending.filter((key) => key !== null));
}
/** Corrects a transcript line's words or speaker, or says it's right as heard; the answer is the note as it is now. */
export function useCorrectLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; lineId: string; patch: LinePatch }) => api.notes.correctLine(v.noteId, v.lineId, v.patch),
    onSuccess: (n) => noteChanged(qc, n)
  });
}
/** The organizer has the notes written again from the transcript as it is now; the note answers pending until they are. */
export function useRewriteNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; model?: string | null | undefined }) => api.notes.rewrite(v.noteId, { model: v.model }),
    onSuccess: (n) => noteChanged(qc, n)
  });
}
/** Stops writing the notes again: they stay as they were. */
export function useCancelRewrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.notes.cancelRewrite(noteId),
    onSuccess: (n) => noteChanged(qc, n)
  });
}
/**
 * Reads a note again, for what can't ask through here: the browser's audio element fetches for itself and can't say
 * why it failed, or how much more has been recorded. A session that's over shows up here, where the query layer deals
 * with it. Gives back the note as it is now.
 */
export function useRecheckNote(id: string) {
  const qc = useQueryClient();
  return useCallback(async () => {
    await qc.refetchQueries({ queryKey: noteKeys.note(id), exact: true }, { throwOnError: true });
    return qc.getQueryData(noteQueries.note(id).queryKey);
  }, [qc, id]);
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notes.delete(id),
    // The note itself stays cached until its page lets go of it, so the page can say what was deleted.
    onSuccess: () => {
      for (const key of [['notes', 'list'], noteKeys.inbox, callKeys.meetings, noteKeys.allSeries]) void qc.invalidateQueries({ queryKey: key });
    }
  });
}
