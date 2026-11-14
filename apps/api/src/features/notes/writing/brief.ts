/*
 * What the notes model is told about a call, whatever it's asked: its brief (who, what kind, how long, what's settled and
 * what's written so far), and the follow-ups it's told of, which it names back by their labels.
 */
import { isAcceptedFollowUp, type ActionItem, type CaptureGap, type Decision, type NoteKind, type Person, type RoomNote, type ScreenMoment, type TranscriptLine } from '@alcove/api';
import { type ChatModel, type Trace } from '../../../inference/inference';
import { type NoteManifest } from '../manifest';
import type { PickWhy } from '../../recordings/screens/reading';
import { oneLine, mmss } from '../../../inference/prompts';

/** A follow-up as the model is told it, to say which of what it writes it is: `id` never goes to it. */
export interface Known { id: string; text: string; owner?: string | undefined }

/** What the model is told about a meeting: who it's with, how long it's been, and what was said. */
export interface Brief {
  title: string;
  kind: NoteKind;
  organizer: Person;
  /** Everyone invited besides the organizer. */
  people: Person[];
  seconds: number;
  lines: TranscriptLine[];
  /** The stretches nothing was captured in, which the transcript marks so the model never runs over them. */
  gaps: CaptureGap[];
  /** What was on shared screens, as it was read, placed among the lines where it appeared. */
  screens?: ScreenMoment[] | undefined;
  /**
   * For writing the notes: each screen's frame on the grey grid (screen-grid.ts) by its ID, to say how it compares with
   * its share's screen before it, and why each was picked, for which of two on one line is shown.
   */
  grids?: ReadonlyMap<string, Uint8Array> | undefined;
  why?: ReadonlyMap<string, PickWhy> | undefined;
  /** The written summary, for questions after the notes are written. */
  summary?: string | undefined;
  /** The full summary (Note.details), for questions after the notes are written. */
  details?: string | undefined;
  /** The meeting is still going on. */
  live?: boolean | undefined;
  /** What people already settled, or added during the call, which the model is told not to list again (settledOf). */
  settled?: string[] | undefined;
  /** Accepted tasks and review receipts, only from this same readable part. */
  followUps?: ActionItem[] | undefined;
  /** What was ticked during the call in the part these notes are for, for the model to say which follow-up each is. */
  ticks?: Known[] | undefined;
  /** What the notes say, for questions once the transcript they were written from has been deleted. */
  written?: Pick<NoteManifest, 'decisions' | 'questions' | 'actions' | 'chapters'> | undefined;
  /** The notes are written and the call wasn't set to keep what they were written from, so the main room's transcript is gone. */
  deleted?: boolean | undefined;
  /** The breakout room these lines were said in, by name, when the notes are that room's own. */
  room?: string | undefined;
  /** Each breakout room's section of a finished note, for questions about it. */
  rooms?: RoomNote[] | undefined;
  /**
   * The boards open for everyone in this part of the call that everyone the notes go to can open (features/notes/worked-on.ts): each
   * one's words, and the stickies in its Actions frames, which the notes make follow-ups of.
   */
  boards?: BriefBoard[] | undefined;
  /** The model chosen for this meeting (models.resolveModel); the default when not given. */
  via?: ChatModel | undefined;
  /** Where each request to the model and its reply go as they happen: only the notes eval (features/notes/eval/run-cli.ts) sets it. */
  trace?: Trace | undefined;
}
/** A board as the notes model reads it. */
export interface BriefBoard { name: string; text: string; followUps: Known[] }
/** A finished note, as the model reads it: the main room's transcript, and each breakout room's section. */
export const briefOf = (m: NoteManifest, organizer: Person, people: Person[]): Brief => ({
  title: m.title, kind: m.kind, organizer, people, seconds: m.duration, lines: m.transcript ?? [], gaps: m.gaps, screens: m.screens, summary: m.summary, details: m.details,
  settled: settledOf(m), followUps: m.actions, written: { decisions: m.decisions, questions: m.questions, actions: m.actions, chapters: m.chapters },
  deleted: !m.keep.transcript && m.writtenAt !== null, rooms: m.rooms
});

/**
 * What isn't part of the notes, said the same way to each prompt that writes them: small talk, and talk about the call itself.
 * Plans that are the meeting's business stay in: "let's meet Thursday about the launch" is a follow-up.
 */
export const SMALL_TALK = `Small talk isn't part of the notes: greetings, how people are, the weather, weekends and plans that have nothing to do with the meeting, and talk about the call itself ("can you hear me?", "you're on mute").`;

/** What people settle in written notes: a part's decisions, open questions and follow-ups. */
export type Settled = Pick<NoteManifest, 'decisions' | 'questions' | 'actions'>;
const DECIDED: Record<Decision['state'], string> = { proposed: 'proposed', confirmed: 'confirmed', rejected: 'said not to be decided', superseded: 'no longer holds' };
/**
 * What people have already settled in a part of notes: each decision, open question and follow-up someone proposed,
 * confirmed, answered, took on, turned down, reworded or otherwise changed, with where it stands, and on notes not written
 * yet what they added during the call. Notes keep these as they are (keepSettled in features/notes/writing/writer.ts), so the model is told
 * not to list them again, even in other words. Any part with its own decisions, questions and follow-ups is listed the same way.
 */
export function settledOf(m: Settled): string[] {
  return [
    ...m.decisions.filter((x) => x.changes.length).map((x) => `Decision (${DECIDED[x.state]}): ${oneLine(x.text)}`),
    ...m.questions.filter((x) => x.changes.length).map((x) => `Question (${x.state === 'answered' ? 'answered' : 'still open'}): ${oneLine(x.text)}`),
    ...m.actions.filter((x) => isAcceptedFollowUp(x)).map((x) => {
      const where = [x.owner ? `for ${oneLine(x.owner.name)}` : 'nobody has it', x.takenOn ? 'taken on' : '', x.done ? 'done' : ''].filter(Boolean).join(', ');
      return `Follow-up (${where}): ${oneLine(x.text)}`;
    })
  ];
}

/**
 * A breakout room's section, as the model reads it to write that room's notes: the call's title and organizer, the
 * people who were in the room, how long it was open, what was said there alone, and when they're written again, what
 * was settled in the room's notes before.
 */
export const roomBriefOf = (m: NoteManifest, room: RoomNote, organizer: Person): Brief => ({
  title: m.title, kind: m.kind, organizer, people: room.people.flatMap((x) => (x.person && x.person.id !== organizer.id ? [x.person] : [])),
  seconds: Math.max(0, room.to - room.from), lines: room.transcript, gaps: room.gaps, room: room.name, settled: settledOf(room), followUps: room.actions
});

/** A person as the model needs them: their name, or the name part of an address nobody named. */
export const called = (p: Person) => (p.name === p.email ? p.email.split('@')[0] ?? p.name : p.name);

export function about(b: Brief): string {
  const invited = b.people.length ? b.people.map(called).join(', ') : 'nobody else';
  return [
    `Meeting: ${b.title}`,
    `Kind: ${b.kind === 'room' ? 'an in-person meeting, recorded on one device in the room' : 'a video call'}`,
    ...(b.room ? [`Part: the breakout room “${oneLine(b.room)}”, where some of the call talked on their own. Write the notes of this room alone, from what was said in it.`] : []),
    `Organizer: ${b.organizer.name}`,
    `Invited: ${invited}`,
    b.live ? `Going on for: ${Math.max(1, Math.round(b.seconds / 60))} minutes so far` : `Length: ${Math.max(1, Math.round(b.seconds / 60))} minutes`
  ].join('\n');
}

/**
 * What the model is told of things it's to recognise, one to a line, by a short label as lines are: a long ID copied
 * wrong would read as something new.
 */
export const listed = (letter: string, xs: Known[]) => xs.map((x, i) => `${letter}${i + 1} ${x.owner ? `(${oneLine(x.owner)}) ` : ''}${oneLine(x.text)}`).join('\n');
/**
 * Reads back the labels `listed` gave, in the order the model used them: the ID a label stands for, once. A label it
 * wasn't given is nothing, and one it used already stays with whatever used it first.
 */
export function labelsOf(letter: string, xs: Known[]): (label: string) => string | undefined {
  const left = new Map(xs.map((x, i) => [`${letter}${i + 1}`, x.id]));
  return (label) => { const key = label.trim().toUpperCase(); const id = left.get(key); left.delete(key); return id; };
}

/** Words that mean "nobody in particular" when the model gives them as an owner. */
export const NOBODY = new Set(['', 'unknown', 'unassigned', 'none', 'n/a', 'someone', 'somebody', 'everyone', 'team', 'the team', 'all', 'null']);
const mark = (s: number | undefined) => (s === undefined ? '' : `[${mmss(s)}] `);

/** How a decision stands, as a question across notes reads it. */
const STANDING: Record<Decision['state'], string> = { proposed: 'not confirmed', confirmed: 'confirmed', superseded: 'no longer holds', rejected: 'not decided' };

/**
 * A note's decisions and follow-ups as a model reads them. A decision someone said wasn't made isn't one, one nobody has
 * confirmed is only what the notes heard, and one a later one replaced no longer holds. Each on one line, whatever people
 * typed: nothing in them can pass for another line of the notes or a transcript.
 */
export const decidedLines = (decisions: Decision[]) => decisions.filter((d) => d.state !== 'rejected').map((d) => `- ${mark(d.at)}${oneLine(d.text)} (${STANDING[d.state]})`);
export const followUpLines = (actions: ActionItem[]) =>
  actions.filter(isAcceptedFollowUp).map((a) => `- ${mark(a.at)}${oneLine(a.text)} (${[a.owner ? `${oneLine(a.owner.name)}, ${a.takenOn ? 'took it on' : 'suggested'}` : 'nobody yet', ...(a.due ? [`due ${oneLine(a.due)}`] : []), ...(a.done ? ['done'] : [])].join(', ')})`);

/** What written notes say, past their summary, as a question reads them once the transcript is gone. */
export function writtenText(w: NonNullable<Brief['written']>): string {
  const section = (title: string, lines: string[]) => (lines.length ? [`${title}:`, ...lines] : []);
  return [
    ...section('Decisions', decidedLines(w.decisions)),
    ...section('Open questions', w.questions.filter((q) => q.state === 'open').map((q) => `- ${mark(q.at)}${oneLine(q.text)}`)),
    ...section('Follow-ups', followUpLines(w.actions)),
    ...section('Parts of the meeting', w.chapters.map((c) => `- ${mark(c.at)}${oneLine(c.title)}: ${oneLine(c.summary)}`))
  ].join('\n') || '(none)';
}

/** What each breakout room's notes sum up, as a question across notes reads them: a room's decisions and follow-ups are among the note's. */
export const roomSummaries = (b: Brief) => (b.rooms ?? []).filter((r) => r.summary).map((r) => `Breakout room “${oneLine(r.name)}”: ${oneLine(r.summary)}`);
