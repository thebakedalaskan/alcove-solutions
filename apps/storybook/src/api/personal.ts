/* Your own notes on a call, kept in the world by the note they go with. Only ever yours, as in the app. */
import type { PersonalApi, PersonalEntry, PersonalInput, PersonalNotes, PersonalPoint, SourceMoment, TranscriptLine } from '@alcove/api';
import { current, nextId } from './state';

const entriesOf = (noteId: string): PersonalEntry[] => current().personal[noteId] ?? [];
const notesOf = (noteId: string): PersonalNotes => structuredClone({ noteId, entries: entriesOf(noteId) });
const said = (line: TranscriptLine): SourceMoment => ({ at: line.at, line: { id: line.id, text: line.text, ...(line.speaker ? { speaker: line.speaker } : {}) } });

/** Where a bookmark or a kept answer points, read from the note as it is now, or from the call's transcript while it's on. */
function momentOf(noteId: string, point: PersonalPoint, live: (() => TranscriptLine[]) | undefined): SourceMoment | null {
  const note = current().notes.find((n) => n.id === noteId);
  if (point.kind === 'moment') return { at: point.at };
  if (point.kind === 'screen') {
    const frame = note?.screens.find((f) => f.id === point.frameId);
    return frame ? { at: frame.at, screen: { id: frame.id, title: frame.title } } : null;
  }
  const line = (live ? live() : note?.transcript ?? []).find((l) => l.id === point.lineId);
  return line ? said(line) : null;
}

/**
 * Your own notes on the note `noteId`. In a call, `live` is its transcript so far: a line is bookmarked from it, and Mark this
 * moment opens at the line just said, as the server reads them.
 */
export function personalFor(noteId: string, live?: (() => TranscriptLine[]) | undefined): PersonalApi {
  const save = (entries: PersonalEntry[]) => { current().personal[noteId] = entries; return Promise.resolve(notesOf(noteId)); };
  /** A bookmark of `point`, or of now in a call. */
  const bookmark = (base: Pick<PersonalEntry, 'id' | 'at' | 'shared'>, label: string, point: PersonalPoint | null): PersonalEntry => {
    if (point) return { ...base, kind: 'bookmark', label, target: point.kind, moment: momentOf(noteId, point, live), reach: 'open' };
    const now = live?.().at(-1);
    return now ? { ...base, kind: 'bookmark', label, target: 'moment', moment: said(now), reach: 'open' } : { ...base, kind: 'bookmark', label, target: 'moment', moment: null, reach: 'none' };
  };
  return {
    get: () => Promise.resolve(notesOf(noteId)),
    add: (input: PersonalInput) => {
      const base = { id: nextId('own'), at: new Date().toISOString(), shared: null };
      // A line or a screen already bookmarked changes nothing, as on the server.
      const point = input.kind === 'bookmark' ? input.point : null;
      const of = point?.kind === 'line' ? point.lineId : point?.kind === 'screen' ? point.frameId : null;
      if (point && of !== null && entriesOf(noteId).some((e) => e.kind === 'bookmark' && e.target === point.kind && (e.moment?.line?.id ?? e.moment?.screen?.id) === of)) return Promise.resolve(notesOf(noteId));
      const entry: PersonalEntry = input.kind === 'note' ? { ...base, kind: 'note', text: input.text }
        : input.kind === 'bookmark' ? bookmark(base, input.label, input.point)
          : { ...base, kind: 'answer', question: input.question, answer: input.answer, moments: input.points.flatMap((p) => { const m = momentOf(noteId, p, live); return m ? [m] : []; }) };
      return save([...entriesOf(noteId), entry]);
    },
    edit: (entryId: string, text: string) => save(entriesOf(noteId).map((e): PersonalEntry => (e.id !== entryId ? e : e.kind === 'note' ? { ...e, text } : e.kind === 'bookmark' ? { ...e, label: text } : e))),
    remove: (entryId: string) => save(entriesOf(noteId).filter((e) => e.id !== entryId))
  };
}
