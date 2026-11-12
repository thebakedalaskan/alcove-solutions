/*
 * The palette's list, worked out from what's typed: its rows in order with the groups and calls around them, the rows ↑
 * and ↓ move through, and the row lit until the pointer or the keys light another. Pure: Palette.tsx keeps what's typed,
 * the token and the lit row; Results.tsx and Answered.tsx draw this, and Preview.tsx shows the lit row.
 *
 * Before anything's typed: the people you have most calls with, then your recent notes, the newest lit. Typing (two
 * letters or more, or anything with someone's token) lists Ask first, then the people whose names have the words, what
 * was said call by call, the notes that have the words only in what was written about them, and See all at the end.
 * A question lights Ask; anything else lights the first thing found.
 */
import { MAX_SEARCH_TEXT, isAcceptedFollowUp, namesIn, searchOf, type Note, type NoteAction, type NoteDecision, type NoteFound, type NoteSaid, type Person, type RoomRef, type Team, type TranscriptLine } from '@alcove/api';
import type { Cite } from '~/features/notes/answer';
import { byTime, heardAt } from '~/features/notes/list/parts';
import { callName } from '~/lib/people';
import { plural } from '~/lib/words';

/** People offered as arches before anything's typed. */
const PICKS = 5;
/** Notes listed before anything's typed. */
const RECENT = 5;
/** People whose names have the words, at most. */
const NAMED = 3;
/** Calls under What was said, at most: their moments count into See all, which has the rest. */
const CALLS = 8;
/**
 * Notes found only by what was written about them, at most. Where the transcripts weren't kept, every note a search finds is
 * one of these, so the rest wait in See all too.
 */
const WRITTEN = 5;

/**
 * What the row at the end of a search says: See all, with what Notes will show, when the list left moments or notes out;
 * otherwise Open, since everything found is already here.
 */
function allLabel(counts: Counts, hiddenMoments: number, notesLeftOut: boolean): string {
  if (hiddenMoments > 0 || notesLeftOut) return `See all ${counts.moments ? plural(counts.moments, 'moment') : plural(counts.notes, 'note')} in Notes`;
  return `Open ${counts.moments + counts.notes === 1 ? 'it' : 'these'} in Notes`;
}

/** Someone you have notes with, as search offers them. */
export interface Someone {
  person: Person;
  /** Their title on your team, when they're on it. */
  title: string | undefined;
  /** Calls you have the notes of together (a recording in the room isn't a call). */
  calls: number;
  /** Notes you have together, calls or not. */
  notes: number;
  /** When your newest note with them started. */
  last: string;
}

/**
 * Everyone in your notes but you, named and titled as your team has them, the people you have most calls with first.
 * Someone on your team you have no notes with has nothing to find, so isn't offered. One pass over your notes, which come
 * newest first, so the first note someone's in is their newest.
 */
export function peopleOf(notes: NoteFound[], team: Team | null | undefined, me: string | undefined): Someone[] {
  const mine = me?.toLowerCase();
  const found = new Map<string, Omit<Someone, 'title'>>();
  for (const n of notes) {
    for (const p of n.people) {
      const key = p.email.toLowerCase();
      if (key === mine) continue;
      const known = found.get(key);
      if (!known) { found.set(key, { person: p, calls: n.kind === 'call' ? 1 : 0, notes: 1, last: n.startedAt }); continue; }
      // Someone known only by their address in one note may have a name in another.
      if (known.person.name === known.person.email) known.person = p;
      if (n.kind === 'call') known.calls++;
      known.notes++;
    }
  }
  const members = new Map((team?.members ?? []).map((m) => [m.person.email.toLowerCase(), m] as const));
  return [...found].map(([key, s]): Someone => {
    const member = members.get(key);
    // Known only by their address in your notes, but by name on your team.
    const named = member && s.person.name === s.person.email ? { ...s.person, name: member.person.name } : s.person;
    return { ...s, person: named, title: member?.title };
  }).sort((a, b) => b.calls - a.calls || b.notes - a.notes || a.person.name.localeCompare(b.person.name));
}

/** "4 calls together", or the notes together when none of them is a call. */
export const together = (s: Someone): string => (s.calls ? `${plural(s.calls, 'call')} together` : `${plural(s.notes, 'note')} together`);

/** Whether what's typed is searched: two letters or more, or anything at all with someone's token. */
const searching = (text: string, token: Person | undefined): boolean => !!token || text.replace(/\s/g, '').length >= 2;

/**
 * What the search asks for, for what's typed and the token: the words, when they have any to look for, as many as the
 * server takes (MAX_SEARCH_TEXT; a question asked can be longer), and whose lines to look in. Null when there's nothing to
 * ask: under two letters, or a question of small words alone.
 */
export function searchFor(text: string, token: Person | undefined): { text: string | undefined; by: string | undefined } | null {
  const typed = text.trim();
  if (!searching(typed, token)) return null;
  const words = searchOf(typed).terms.length ? typed.slice(0, MAX_SEARCH_TEXT) : undefined;
  if (!words && !token) return null;
  return { text: words, by: token?.email };
}

/** A row: something to light, press and move to with ↑ and ↓. */
export type Row =
  /** Ask "…", while something's typed. */
  | { kind: 'ask'; key: string; text: string }
  /** Someone whose name has the words: Enter makes them the token. */
  | { kind: 'person'; key: string; someone: Someone }
  /** A line of what was said: Enter opens its note there. */
  | { kind: 'moment'; key: string; note: NoteFound; line: NoteSaid }
  /** A note: Enter opens it. */
  | { kind: 'note'; key: string; note: NoteFound }
  /** "3 more in Team standup": Enter opens the rest of that call's moments in place, and lights `reveal`, the first of them. */
  | { kind: 'more'; key: string; note: NoteFound; count: number; reveal: string }
  /** See all, at the end: Enter opens Notes with the words, and with only the notes you both have under someone's token. */
  | { kind: 'all'; key: string; label: string };

/** In a group: a call's head (its sky, its title and its day, over its moments), or a row. */
export type Part = { kind: 'head'; key: string; note: NoteFound } | Row;

/** The list, top to bottom: rows on their own (Ask, See all), and labelled groups. */
export type Section =
  | { kind: 'row'; row: Row }
  | { kind: 'group'; key: string; label: string; count: string | undefined; parts: Part[] };

/** What a search found: its moments, the calls they're in, and the notes with the words only in what was written. */
export interface Counts { moments: number; calls: number; notes: number }
const NONE: Counts = { moments: 0, calls: 0, notes: 0 };

/** What the window lists. */
export interface Listed {
  /**
   * first: you have no notes. offline: no connection. idle: nothing typed. loading: the search hasn't answered, and
   * there's no earlier list to keep. failed: it didn't go through. none: nothing has the words. unsaid: nothing's typed,
   * and the token's person said nothing you can read. results: something has the words.
   */
  state: 'first' | 'offline' | 'idle' | 'loading' | 'failed' | 'none' | 'unsaid' | 'results';
  /** The people to pick before anything's typed, as arches. */
  pick: Someone[];
  sections: Section[];
  /** What ↑ and ↓ move through, top to bottom. */
  rows: Row[];
  /** The row lit until the pointer or the keys light another. */
  lit: string | undefined;
  /** The words searched for, to mark where they show. */
  terms: string[];
  counts: Counts;
  /** The token's first name, with nothing typed: "What Maya said". */
  whose: string | undefined;
}

export interface Looking {
  /** What's in the line now. */
  typed: string;
  /** What the list's search was for (what was typed, once typing paused): its words are the ones marked. */
  searched: string;
  /** Who the search is narrowed to: only what they said. */
  token: Person | undefined;
  /** Your notes, newest first; undefined until they're read. */
  notes: NoteFound[] | undefined;
  /** Everyone you have notes with (peopleOf). */
  people: Someone[];
  /** What the search found, or undefined until it answers. */
  found: NoteFound[] | undefined;
  /** Calls whose other moments are open in place. */
  opened: ReadonlySet<string>;
  offline: boolean;
  /** The search didn't go through. */
  failed: boolean;
}

const momentKey = (n: NoteFound, line: NoteSaid) => `m:${n.id}:${line.id}`;
const sectionOf = (row: Row): Section => ({ kind: 'row', row });
/** The rows of some sections, top to bottom. */
const rowsOf = (sections: Section[]): Row[] => sections.flatMap((s) => (s.kind === 'row' ? [s.row] : s.parts.flatMap((p) => (p.kind === 'head' ? [] : [p]))));

/** What the palette lists for what's typed, the token, what was found and what you have. */
export function listOf(l: Looking): Listed {
  const typed = l.typed.trim();
  const question = searchOf(typed).question;
  const { terms } = searchOf(l.searched);
  const whose = l.token && !terms.length ? callName(l.token) : undefined;
  const empty: Omit<Listed, 'state'> = { pick: [], sections: [], rows: [], lit: undefined, terms, counts: NONE, whose };
  if (l.notes && !l.notes.length) return { ...empty, state: 'first' };
  if (l.offline) return { ...empty, state: 'offline' };

  if (!searching(typed, l.token)) {
    const recent = (l.notes ?? []).slice(0, RECENT).map((note): Row => ({ kind: 'note', key: `recent:${note.id}`, note }));
    return {
      ...empty, state: 'idle', terms: [], pick: l.people.slice(0, PICKS), rows: recent, lit: recent[0]?.key,
      sections: recent.length ? [{ kind: 'group', key: 'recent', label: 'Recent notes', count: undefined, parts: recent }] : []
    };
  }

  const ask: Section[] = typed ? [sectionOf({ kind: 'ask', key: 'ask', text: typed })] : [];
  const looked = searchOf(typed).terms;
  const named = !l.token && !question && looked.length ? l.people.filter((s) => namesIn(s.person.name, looked) === looked.length).slice(0, NAMED) : [];
  const people: Section[] = named.length ? [{ kind: 'group', key: 'people', label: 'People', count: undefined, parts: named.map((someone): Row => ({ kind: 'person', key: `person:${someone.person.email}`, someone })) }] : [];
  const lit = (sections: Section[]) => {
    const rows = rowsOf(sections);
    const found = rows.find((r) => r.kind !== 'ask');
    return question || !found ? rows[0]?.key : found.key;
  };
  if (l.failed || !l.found) {
    const sections = [...ask, ...people];
    return { ...empty, state: l.failed ? 'failed' : 'loading', sections, rows: rowsOf(sections), lit: lit(sections) };
  }

  /*
   * What was said, call by call, newest first as the search lists them, eight calls at most: three moments of the first
   * call and two of the others (three each when there are only two calls). The moments not shown count into See all.
   */
  const calls = l.found.filter((n) => n.said.length > 0);
  const written = l.token ? [] : l.found.filter((n) => !n.said.length);
  let hidden = 0;
  const said: Part[] = calls.flatMap((note, i): Part[] => {
    if (i >= CALLS) { hidden += note.saidCount; return []; }
    const limit = calls.length > 2 && i > 0 ? 2 : 3;
    // The lines that fit the words best are the ones shown, in the order they were said.
    const shown = l.opened.has(note.id) ? note.said : note.said.slice(0, limit);
    const rest = byTime(note.said.filter((line) => !shown.includes(line)));
    hidden += note.saidCount - shown.length;
    const [next] = rest;
    return [
      { kind: 'head', key: `head:${note.id}`, note },
      ...byTime(shown).map((line): Row => ({ kind: 'moment', key: momentKey(note, line), note, line })),
      ...(next ? [{ kind: 'more', key: `more:${note.id}`, note, count: rest.length, reveal: momentKey(note, next) } satisfies Row] : [])
    ];
  });
  const counts: Counts = { moments: calls.reduce((n, note) => n + note.saidCount, 0), calls: calls.length, notes: written.length };
  const things = counts.moments + counts.notes;
  const sections: Section[] = [
    ...ask,
    ...people,
    ...(calls.length ? [{
      kind: 'group', key: 'said', parts: said,
      label: whose ? `What ${whose} said` : searchOf(l.searched).question ? 'Moments with these words' : 'What was said',
      count: `${plural(counts.moments, 'moment')} in ${plural(counts.calls, 'call')}`
    } satisfies Section] : []),
    ...(written.length ? [{
      kind: 'group', key: 'notes', label: 'Notes', count: written.length > 1 ? plural(written.length, 'note') : undefined,
      parts: written.slice(0, WRITTEN).map((note): Row => ({ kind: 'note', key: `note:${note.id}`, note }))
    } satisfies Section] : []),
    // Notes can't list only someone's lines: under their token it lists the notes you both have, so it says that, with no count.
    ...(things ? [sectionOf({ kind: 'all', key: 'all', label: l.token ? `Calls with ${callName(l.token)} in Notes` : allLabel(counts, hidden, written.length > WRITTEN) })] : [])
  ];
  const state = calls.length || written.length || named.length ? 'results' : l.token && !typed ? 'unsaid' : 'none';
  return { ...empty, state, sections, rows: rowsOf(sections), lit: lit(sections), counts };
}

/** What an answer comes from, as rows. */
export interface Cited {
  sections: Section[];
  rows: Row[];
  lit: string | undefined;
  /** The question's words, marked where they show. */
  terms: string[];
}

/**
 * What an answer cites, as rows under "From your notes": each note in the order the answer uses it, with the moments it
 * cites there in the order they were said, as far as the note has been read (`read`). A note cited as a whole (at 0:00)
 * is a note row. A note that's gone isn't shown.
 */
export function citedOf(cites: Cite[], notes: NoteFound[], read: ReadonlyMap<string, Note>, question: string): Cited {
  const order = [...new Set(cites.flatMap((c) => (c.type === 'cite' ? [c.noteId] : [])))];
  let moments = 0;
  let wholes = 0;
  const parts = order.flatMap((id): Part[] => {
    const summary = notes.find((n) => n.id === id);
    if (!summary) return [];
    const at = [...new Set(cites.flatMap((c) => (c.type === 'cite' && c.noteId === id && c.at > 0 ? [c.at] : [])))].sort((a, b) => a - b);
    if (!at.length) { wholes++; return [{ kind: 'note', key: `cited:${id}`, note: summary }]; }
    moments += at.length;
    const note = read.get(id);
    if (!note) return [];
    return [{ kind: 'head', key: `head:${id}`, note: summary }, ...at.map((s): Row => {
      const line = heardAt(note, s);
      const made = line ? madeAt(note, line)?.kind : undefined;
      return {
        kind: 'moment', key: `cite:${id}:${s}`, note: summary,
        line: { id: line?.id ?? `${id}@${s}`, at: s, text: line?.text ?? '', ...(line?.speaker ? { speaker: line.speaker } : {}), ...(line?.room ? { room: line.room } : {}), ...(made ? { made } : {}) }
      };
    })];
  });
  const sections: Section[] = order.length ? [{ kind: 'group', key: 'cited', label: 'From your notes', count: moments ? plural(moments, 'moment') : plural(wholes, 'note'), parts }] : [];
  const rows = rowsOf(sections);
  return { sections, rows, lit: rows[0]?.key, terms: searchOf(question).terms };
}

/** What a line became in its part of the call (a breakout room's line, in that room's section). */
export type Made = { kind: 'decision'; decision: NoteDecision } | { kind: 'follow-up'; action: NoteAction };

/**
 * What a line became, as the search's `made` says: the decision resting on it that isn't rejected, or else the follow-up
 * in the checklist (not one the notes only suggest). `kept`: decisions to show even rejected, such as one said not to be
 * decided here a moment ago.
 */
export function madeAt(note: Note, line: { id: string; room?: RoomRef | undefined }, kept: ReadonlySet<string> = new Set()): Made | undefined {
  const part = line.room ? note.rooms.find((r) => r.id === line.room?.id) : note;
  const decision = part?.decisions.find((d) => d.lines.includes(line.id) && (d.state !== 'rejected' || kept.has(d.id)));
  if (decision) return { kind: 'decision', decision };
  const action = part?.actions.find((a) => isAcceptedFollowUp(a) && a.lines.includes(line.id));
  return action ? { kind: 'follow-up', action } : undefined;
}

/**
 * The transcript around a moment, in the part of the call it was said in: the line before it, the line itself and the
 * three after, as far as there are any, and which one it is. Found by the line's ID, or else by when it was said.
 */
export function around(note: Note, line: { id: string; at: number; room?: RoomRef | undefined }): { lines: TranscriptLine[]; lit: string | undefined } {
  const lines = line.room ? note.rooms.find((r) => r.id === line.room?.id)?.transcript ?? [] : note.transcript ?? [];
  const byId = lines.findIndex((l) => l.id === line.id);
  const i = byId >= 0 ? byId : lines.findLastIndex((l) => l.at <= line.at + 0.5);
  if (i < 0) return { lines: [], lit: undefined };
  return { lines: lines.slice(Math.max(0, i - 1), i + 4), lit: lines[i]?.id };
}
