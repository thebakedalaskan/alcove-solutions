import type { AlcoveApi, Note } from '@alcove/api';

/** A person reviews the initial batch through the public API before a flow exercises actual-task behavior. */
export async function acceptNoteSuggestions(api: AlcoveApi, noteId: string): Promise<Note> {
  let note = await api.notes.get(noteId);
  const batch = [...note.suggestions, ...note.rooms.flatMap((room) => room.suggestions)];
  for (const suggestion of batch) note = await api.notes.reviewAction(noteId, { id: suggestion.id, revision: suggestion.revision, decision: 'accept' });
  return note;
}
