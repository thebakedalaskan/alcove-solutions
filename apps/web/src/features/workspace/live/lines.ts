/* Reading the call for its live pages and what a document takes from it. Nothing here keeps anything. */
import { firstName, notesAreOn, type CallState, type Person, type TranscriptLine } from '@alcove/api';
import { captureHere } from '~/lib/capture';
import { hm } from '~/lib/time';
import type { LiveLine, MomentLine } from '../editor/types';

/** What's captured where you are. */
export const modeHere = (s: CallState) => captureHere(s.capture).mode;
/** Notes are being written where you are. */
export const notesOnHere = (s: CallState): boolean => notesAreOn(modeHere(s));

/** A moment as a time of day, from seconds since the call started, which is how the notes say when. */
export const clockAt = (s: Pick<CallState, 'startedAt'>, seconds: number): string => hm(new Date(Date.parse(s.startedAt) + seconds * 1000));

/** When a transcript line was said. A line counts seconds of recording, so what wasn't recorded before it goes back in. */
function lineMoment(s: CallState, at: number): Date {
  const skipped = captureHere(s.capture).gaps.reduce((ms, g) => (g.at <= at && g.to ? ms + Date.parse(g.to) - Date.parse(g.from) : ms), 0);
  return new Date(Date.parse(s.startedAt) + at * 1000 + skipped);
}
/** The same as a time of day. */
export const lineClock = (s: CallState, at: number): string => hm(lineMoment(s, at));

/** Two names that could be one person: the notes know people by what was said, which is often only a first name. */
export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase() || firstName(a).toLowerCase() === firstName(b).toLowerCase();

/** Someone in the call, from a name in the notes: exactly, or else by first name. */
export function personNamed(s: CallState, name: string | undefined): Person | undefined {
  if (!name) return undefined;
  const people = s.participants.map((p) => p.person);
  return people.find((p) => p.name === name) ?? people.find((p) => sameName(p.name, name));
}

/** Someone as a document tags them. A workspace knows people by their address, and an organizer's ID in the call isn't that. */
export const asInDocuments = (p: Person): Person => ({ ...p, id: p.email.toLowerCase() || p.id });

/** Who said a line. A breakout room's stand-in has no name to give. */
export const speakerOf = (l: TranscriptLine): { person: Pick<Person, 'name'> & Partial<Person>; name: string } => {
  const name = l.speaker?.name ?? 'Someone';
  return { person: l.speaker?.person ?? { name }, name };
};

/** A line of the transcript as a quote keeps it: when it was said, for each reader to read in their own time. */
export const momentOf = (s: CallState, l: TranscriptLine): MomentLine => ({
  id: l.id, person: l.speaker?.person ? asInDocuments(l.speaker.person) : null, name: l.speaker?.name ?? 'Someone', at: lineMoment(s, l.at).toISOString(), text: l.text, note: s.notes.noteId
});

/** The last few lines, newest first, for Quote what was said. */
export const recentLines = (s: CallState): MomentLine[] => s.transcript.slice(-4).reverse().map((l) => momentOf(s, l));

/**
 * Whether this browser may write what a `live` block shows. A document's `live` block follows the notes everyone shares in
 * the main room: a room has notes of its own, a guest isn't sent what people added, and notes written for what someone may
 * read of the call aren't everyone's. Any of those writing would only fight the people who have the real ones.
 */
export const writesLiveBlocks = (s: CallState): boolean => s.capture.room === null && s.role !== 'guest' && s.liveNotes.notes?.read.whileHere !== true;

/**
 * What `live` blocks show now. The same in every browser with the same notes, wherever in the world it is, which is what lets
 * one that finds it's already there leave it: a moment and words as they were said, not how they read here.
 */
export function liveLinesOf(s: CallState): { decided: LiveLine[]; followUps: LiveLine[] } {
  const n = s.liveNotes.notes;
  const moment = (seconds: number) => new Date(Date.parse(s.startedAt) + seconds * 1000).toISOString();
  const said = [
    ...(n?.next ?? []).map((f) => ({ ...f, when: f.evidence[0]?.said ?? 0 })),
    ...s.liveNotes.added.map((f) => ({ ...f, when: f.at }))
  ].sort((a, b) => a.when - b.when);
  return {
    decided: (n?.decided ?? []).map((d) => ({ text: d.text, at: moment(d.evidence[0]?.said ?? 0) })),
    followUps: said.map((f) => {
      const who = personNamed(s, f.owner);
      return { text: f.text, at: moment(f.when), person: who ? asInDocuments(who).id : null, name: f.owner ?? '', due: f.due ?? '' };
    })
  };
}
