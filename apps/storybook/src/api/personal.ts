/* Your own notes on a call, kept in the world by the note they go with. Only ever yours, as in the app. */
import type { PersonalApi, PersonalEntry, PersonalInput, PersonalNotes, SourceMoment } from '@alcove/api';
import { current, nextId } from './state';

const entriesOf = (noteId: string): PersonalEntry[] => current().personal[noteId] ?? [];
const notesOf = (noteId: string): PersonalNotes => structuredClone({ noteId, entries: entriesOf(noteId) });

/** Where a bookmark or a kept answer points, read from the note as it is now. */
function momentOf(noteId: string, point: { kind: 'line'; lineId: string } | { kind: 'screen'; frameId: string } | { kind: 'moment'; at: number }): SourceMoment | null {
  const note = current().notes.find((n) => n.id === noteId);
  if (point.kind === 'moment') return { at: point.at };
  if (point.kind === 'screen') {
    const frame = note?.screens.find((f) => f.id === point.frameId);
    return frame ? { at: frame.at, screen: { id: frame.id, title: frame.title } } : null;
  }
  const line = note?.transcript?.find((l) => l.id === point.lineId);
  return line ? { at: line.at, line: { id: line.id, text: line.text, ...(line.speaker ? { speaker: line.speaker } : {}) } } : null;
}

export function personalFor(noteId: string): PersonalApi {
  const save = (entries: PersonalEntry[]) => { current().personal[noteId] = entries; return Promise.resolve(notesOf(noteId)); };
  return {
    get: () => Promise.resolve(notesOf(noteId)),
    add: (input: PersonalInput) => {
      const base = { id: nextId('own'), at: new Date().toISOString(), shared: null };
      const entry: PersonalEntry = input.kind === 'note' ? { ...base, kind: 'note', text: input.text }
        : input.kind === 'bookmark' ? { ...base, kind: 'bookmark', label: input.label, moment: input.point ? momentOf(noteId, input.point) : null, reach: 'open' }
          : { ...base, kind: 'answer', question: input.question, answer: input.answer, moments: input.points.flatMap((p) => { const m = momentOf(noteId, p); return m ? [m] : []; }) };
      return save([...entriesOf(noteId), entry]);
    },
    edit: (entryId: string, text: string) => save(entriesOf(noteId).map((e): PersonalEntry => (e.id !== entryId ? e : e.kind === 'note' ? { ...e, text } : e.kind === 'bookmark' ? { ...e, label: text } : e))),
    remove: (entryId: string) => save(entriesOf(noteId).filter((e) => e.id !== entryId))
  };
}
