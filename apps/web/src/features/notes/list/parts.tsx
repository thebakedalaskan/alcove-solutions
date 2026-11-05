/* What the notes list shares: who you have notes with, what a note shows of what was said, and the way to a moment. */
import type { NoteSaid, NoteSummary, Person, RoomRef } from '@alcove/api';
import { Icon, type IconName } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { receivedLine } from '~/features/notes/meta';
import { inNote } from '~/features/notes/parts';
import { sameEmail } from '~/lib/people';
import { position } from '~/lib/time';

/** Someone you have notes with, and how many. */
export interface Known { person: Person; count: number }
/** Everyone else in your notes, the people you have most notes with first. */
export function peopleIn(notes: NoteSummary[], me: string | undefined): Known[] {
  const found = new Map<string, Known>();
  for (const n of notes) {
    for (const p of n.people) {
      if (me && sameEmail(p, { email: me })) continue;
      const key = p.email.toLowerCase();
      const k = found.get(key);
      // Someone known only by their address in one note may have a name in another.
      if (k) found.set(key, { person: k.person.name === k.person.email ? p : k.person, count: k.count + 1 });
      else found.set(key, { person: p, count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name));
}

/** Everyone who has a note but you. */
export const othersIn = (people: Person[], me: string | undefined): Person[] => people.filter((p) => !me || !sameEmail(p, { email: me }));

/** How a note came to you, or where it was made, when that's worth saying. */
export function howOf(n: NoteSummary, me: string | undefined): { icon: IconName; text: string } | undefined {
  if (n.received) return { icon: n.received.role === 'shared' ? 'share' : 'video', text: receivedLine(n.received) };
  const alone = !othersIn(n.people, me).length;
  if (n.kind === 'room') return { icon: 'mic', text: alone ? 'In the room, only you' : 'In the room' };
  return alone ? { icon: 'lock', text: 'Only you' } : undefined;
}

/** What a note says before its summary exists, or when nothing was said. */
export const noSummary = (n: { kind: NoteSummary['kind']; status: NoteSummary['status'] }) =>
  n.status === 'recording' ? 'Recording now.'
    : n.status === 'pending' ? 'The summary, decisions and follow-ups show here once they’re written.'
      : n.kind === 'room' ? 'Nothing was said while recording.' : 'Nothing was said while notes were on.';

/** What was said in a note that a search or an answer points at: the lines, and how many there are in all. */
export interface Said { lines: NoteSaid[]; count: number }

/** A moment in a note: it opens the note there, not playing. */
export function MomentChip({ noteId, noteTitle, at, room, tabIndex }: { noteId: string; noteTitle: string; at: number; room?: RoomRef | undefined; tabIndex?: number | undefined }) {
  const said = `${noteTitle} at ${position(at)}${room ? `, in ${room.name}` : ''}`;
  return (
    <Link to="/notes/$noteId" params={{ noteId }} {...inNote(at, room)} className="hm-moment" aria-label={`Open ${said}`} title={`Open ${said}`} tabIndex={tabIndex}>
      <Icon name="moment" size={13} />{position(at)}
    </Link>
  );
}
