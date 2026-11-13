/*
 * What a call that happened shows of itself in a list, and of what was said in it: who else has its notes, how it came to
 * you, what it says before its notes are written, and the lines a search or an answer points at. Calls and the palette both
 * list calls this way.
 */
import type { Note, NoteSaid, NoteSummary, Person, TranscriptLine } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import { receivedLine } from '~/features/notes/meta';
import { sameEmail } from '~/lib/people';

/** Everyone who has a note but you. */
export const othersIn = (people: Person[], me: string | undefined): Person[] => people.filter((p) => !me || !sameEmail(p, { email: me }));

/** How a call came to you, or where it was, when that's worth saying beside its name. */
export function howOf(n: NoteSummary, me: string | undefined): { icon: IconName; text: string } | undefined {
  if (n.received) return { icon: n.received.role === 'shared' ? 'share' : 'video', text: receivedLine(n.received) };
  const alone = !othersIn(n.people, me).length;
  if (n.kind === 'room') return { icon: 'mic', text: alone ? 'In the room, only you' : 'In the room' };
  return alone ? { icon: 'lock', text: 'Only you' } : undefined;
}

/** What a call says before its summary exists, or when nothing was said. */
export const noSummary = (n: { kind: NoteSummary['kind']; status: NoteSummary['status'] }) =>
  n.status === 'recording' ? 'Recording now.'
    : n.status === 'pending' ? 'The summary, decisions and follow-ups show here once they’re written.'
      : n.kind === 'room' ? 'Nothing was said while recording.' : 'Nothing was said while notes were on.';

/** What was said in a call that a search or an answer points at: the lines, what fits it best first, and how many there are in all. */
export interface Said { lines: NoteSaid[]; count: number }
/** Lines in the order they were said. */
export const byTime = (lines: NoteSaid[]): NoteSaid[] => [...lines].sort((a, b) => a.at - b.at);

/**
 * The transcript line said at second `at`, in the main room or a breakout room's (saying which), as far as the reader has
 * what was said. A cite is a whole second read from a line's own mark, so a line further off is another line.
 */
export function heardAt(note: Note | undefined, at: number): TranscriptLine | undefined {
  const heard = note ? [...(note.transcript ?? []), ...note.rooms.flatMap((r) => r.transcript.map((l) => ({ ...l, room: { id: r.id, name: r.name } })))] : [];
  return heard.filter((l) => Math.abs(l.at - at) < 1).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
}

/** The line an answer cites at second `at`, as `heardAt` finds it: with no line there, it's only a moment. */
export function citedLine(note: Note | undefined, noteId: string, at: number): NoteSaid {
  const line = heardAt(note, at);
  return { id: `${noteId}@${at}`, at, text: line?.text ?? '', ...(line?.speaker ? { speaker: line.speaker } : {}), ...(line?.room ? { room: line.room } : {}) };
}
