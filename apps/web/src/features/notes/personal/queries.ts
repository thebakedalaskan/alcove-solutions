/*
 * Your own notes on a note, and what goes from them into the shared notes: what adding an entry would do, who reads what's
 * written straight into them, and the changes. Never anyone else's: signing in starts the cache over.
 */
import type { PersonalInput, PersonalNotes, PromoteBody, SharedWrite } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';
import { noteChanged, noteGone } from '../queries';
import { noteKeys } from '../queryKeys';

export const personalQueries = {
  personal: (id: string) => queryOptions({ queryKey: noteKeys.personal(id), queryFn: () => api.notes.personal(id).get(), retry: false }),
  /** What adding an entry to the shared notes would do, read fresh each time it's opened: the people who'd get it can change. */
  addition: (id: string, entryId: string) => queryOptions({ queryKey: noteKeys.addition(id, entryId), queryFn: () => api.notes.previewAddition(id, entryId), staleTime: 0, gcTime: 0, retry: false }),
  /** Who reads what's written straight into the shared notes, and the seal that holds it to them: read fresh each time the box shows. */
  sharedAudience: (id: string) => queryOptions({ queryKey: noteKeys.sharedAudience(id), queryFn: () => api.notes.sharedAudience(id), staleTime: 0, gcTime: 0, retry: false })
};

/** Changes your own notes on a note; the answer is all of them as they are now. */
export function useOwnNotes(noteId: string) {
  const qc = useQueryClient();
  const own = api.notes.personal(noteId);
  const done = { onSuccess: (p: PersonalNotes) => { qc.setQueryData(noteKeys.personal(noteId), p); }, onError: (e: unknown) => noteGone(qc, e) };
  return {
    add: useMutation({ mutationFn: (input: PersonalInput) => own.add(input), ...done }),
    edit: useMutation({ mutationFn: (v: { entryId: string; text: string }) => own.edit(v.entryId, v.text), ...done }),
    remove: useMutation({ mutationFn: (entryId: string) => own.remove(entryId), ...done })
  };
}
/** Adds one of your own entries to the shared notes, as previewed. The answer is the note, for everyone; your own notes say where the copy is. */
export function useAddToShared(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { entryId: string; body: PromoteBody }) => api.notes.addToShared(noteId, v.entryId, v.body),
    onSuccess: (n) => Promise.all([noteChanged(qc, n), qc.invalidateQueries({ queryKey: noteKeys.personal(noteId) })]),
    onError: (e) => noteGone(qc, e)
  });
}
/** Writes straight into the shared notes, for everyone with them, with the seal of who the box said reads it. The answer is the note. */
export function useWriteShared(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SharedWrite) => api.notes.writeShared(noteId, body),
    onSuccess: (n) => noteChanged(qc, n),
    onError: (e) => noteGone(qc, e)
  });
}
/** Takes something out of the shared notes, for everyone. */
export function useTakeBack(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (additionId: string) => api.notes.takeBack(noteId, additionId),
    onSuccess: (n) => Promise.all([noteChanged(qc, n), qc.invalidateQueries({ queryKey: noteKeys.personal(noteId) })]),
    onError: (e) => noteGone(qc, e)
  });
}
