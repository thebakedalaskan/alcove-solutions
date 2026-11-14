/*
 * Builders that turn the demo world, written the way the design canvas writes it (who said what at 06:12, a decision
 * someone confirmed), into the contract's own shapes. Everything they return is a type from @alcove/api, so the
 * compiler keeps the world in step with the contract; `parseWorld` (scenarios.ts) also runs it through the schemas.
 */
import {
  ACCEPTED_FOLLOW_UP, DEFAULT_NOTES_CHOICES, type FollowUpTarget, type ActionItem, type Calendar, type CalendarEvent, type Change, type Changer, type Chapter, type InferenceEvidence, type Meeting,
  type Note, type NoteAction, type NoteDecision, type NoteEvidence, type NoteFound, type NoteKind, type NoteQuestion, type NoteStatus, type NoteSummary,
  type NotesSetting, type Person, type Received, type Recipient, type RecipientRole, type Repeat, type RsvpCounts, type ScreenMoment, type ScreenShare, type TranscriptLine
} from '@alcove/api';
import { ART } from './people';

/** A moment in a recording as the canvas writes it, '06:12' or '1:04:30', in seconds. */
export function mmss(t: string): number {
  return t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}
const addMinutes = (isoTime: string, minutes: number) => new Date(Date.parse(isoTime) + minutes * 60_000).toISOString();

/* ---------- notes ---------- */

/** A line of what was said: when, who (a person, or only a name, or nobody in a room recording), and the words. */
export interface Said { id?: string | undefined; at: string; who?: Person | undefined; name?: string | undefined; text: string; unsure?: 'words' | 'speaker' | undefined }
/** Something the notes wrote down, said at `at` (the line said then is what it rests on). */
interface Entry { id: string; text: string; at?: string | undefined }
export interface DecisionSpec extends Entry { state: NoteDecision['state']; by?: Person | undefined }
export interface QuestionSpec extends Entry { answered?: Person | undefined }
/** `board`: written on a board's Actions frame, so it's under Follow-ups from the board. */
export interface ActionSpec extends Entry { owner?: Person | undefined; takenOn?: boolean | undefined; due?: string | undefined; done?: boolean | undefined; board?: boolean | undefined; revision?: string | undefined; target?: FollowUpTarget | undefined; reviewed?: ActionItem['reviewed'] | undefined }
export interface ShareSpec { person: Person; by: Person; group?: string | undefined; at: string }

export interface NoteSpec {
  id: string;
  title: string;
  kind?: NoteKind | undefined;
  status?: NoteStatus | undefined;
  startedAt: string;
  minutes: number;
  organizer: Person;
  /** Everyone invited besides the organizer: they get the notes when the call ends. */
  invited?: readonly Person[] | undefined;
  /** People it was shared with afterwards. */
  shared?: readonly ShareSpec[] | undefined;
  /** The row's one line, and the whole summary. */
  excerpt: string;
  summary?: string | undefined;
  /** The full summary: paragraphs apart by a blank line. Left out, the note is one of the older ones that has none. */
  details?: string | undefined;
  chapters?: readonly (readonly [string, string, string])[] | undefined;
  said?: readonly Said[] | undefined;
  decisions?: readonly DecisionSpec[] | undefined;
  questions?: readonly QuestionSpec[] | undefined;
  actions?: readonly ActionSpec[] | undefined;
  /** AI proposals stay outside the actual checklist until someone adds them. */
  suggestions?: readonly ActionSpec[] | undefined;
  screens?: readonly ScreenMoment[] | undefined;
  /** Shares kept for the notes, which the note's replay plays in step with the audio. */
  shares?: readonly ScreenShare[] | undefined;
  meetingId?: string | undefined;
  seriesId?: string | undefined;
  /** What the call kept: the transcript and the recording, unless it says otherwise. */
  kept?: { transcript: boolean; recording: boolean } | undefined;
}

export const changer = (p: Person, as: RecipientRole | null): Changer => ({ id: p.id, name: p.name, email: p.email, as });

/** What the private models did for a note, checked a few minutes after the call: what a note’s model evidence shows. A third read the shared screens, when there are any. */
export function inferenceAt(verifiedAt: string, screens: boolean): InferenceEvidence[] {
  const hex = (seed: string) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'.charAt((seed.charCodeAt(i % seed.length) * (i + 7)) % 16)).join('');
  const gateway = { status: 'UpToDate', os: 'dstack-0.5.12', compose: hex('gateway') };
  const one = (model: string, task: InferenceEvidence['task']): InferenceEvidence => ({
    model, task, verifiedAt, key: hex(`${model}key`), tdx: { status: 'UpToDate', quote: hex(`${model}quote`) }, os: 'dstack-nvidia-0.5.12',
    gpu: { count: 1, arch: 'HOPPER' }, compose: hex(`${model}compose`), gateway
  });
  return [one('openai/whisper-large-v3', 'transcript'), one('z-ai/glm-5.3-flash', 'notes'), ...(screens ? [one('z-ai/glm-5.3-flash', 'screens')] : [])];
}

/** A note as `me` reads it (you, unless a scenario says otherwise). */
export function writeNote(s: NoteSpec, me: Person = ART): Note {
  const kind = s.kind ?? 'call';
  const status = s.status ?? 'ready';
  const ended = addMinutes(s.startedAt, s.minutes);
  const written = status === 'ready' ? addMinutes(ended, 2) : null;
  const roleOf = (p: Person): RecipientRole => (p.email === s.organizer.email ? 'organizer' : s.shared?.some((x) => x.person.email === p.email) ? 'shared' : 'invited');
  const transcript: TranscriptLine[] = (s.said ?? []).map((l, i) => ({
    id: l.id ?? `${s.id}-l${i + 1}`,
    at: mmss(l.at),
    ...(kind === 'call' && (l.who || l.name) ? { speaker: { name: l.who?.name ?? l.name ?? '', ...(l.who ? { person: l.who } : {}) } } : {}),
    text: l.text,
    ...(l.unsure ? { unsure: l.unsure === 'words' ? { words: true } : { speaker: true } } : {})
  }));
  const kept = s.kept ?? { transcript: true, recording: true };
  // The transcript as it can still be read: a call set not to keep it lost it once its notes were written.
  const readable = kept.transcript || status !== 'ready' ? transcript : [];
  const groundsOf = (e: Entry): string[] => {
    if (e.at === undefined) return [];
    const at = mmss(e.at);
    const line = transcript.find((l) => l.at === at);
    return line ? [line.id] : [];
  };
  /*
   * What backs an entry, as the API has it (backing.ts): read from the transcript as it can be read now. With none kept,
   * what an entry pointed at is out of reach, which isn't nothing having backed it.
   */
  const evidenceOf = (e: Entry, lines: string[]): NoteEvidence => {
    const moments = readable.filter((l) => lines.includes(l.id))
      .map((l) => ({ kind: 'line' as const, id: l.id, at: l.at, ...(l.speaker ? { speaker: l.speaker } : {}), text: l.text, against: false, corrected: false, ...(l.unsure ? { unsure: l.unsure } : {}) }));
    const missing = readable.length > 0 || (!lines.length && e.at === undefined);
    return { moments, flags: moments.length ? (moments.every((m) => m.unsure) ? ['unsure'] : []) : missing ? ['missing'] : [] };
  };
  const settled = written ?? ended;
  const decisions: NoteDecision[] = (s.decisions ?? []).map((d) => {
    const lines = groundsOf(d);
    const changes: Change[] = d.by && d.state !== 'proposed' ? [{ by: changer(d.by, roleOf(d.by)), at: addMinutes(settled, 9), what: d.state }] : [];
    return { id: d.id, text: d.text, ...(d.at ? { at: mmss(d.at) } : {}), state: d.state, lines, against: [], disputes: [], changes, evidence: evidenceOf(d, lines) };
  });
  const questions: NoteQuestion[] = (s.questions ?? []).map((q) => {
    const lines = groundsOf(q);
    const changes: Change[] = q.answered ? [{ by: changer(q.answered, roleOf(q.answered)), at: addMinutes(settled, 20), what: 'answered' }] : [];
    return { id: q.id, text: q.text, ...(q.at ? { at: mmss(q.at) } : {}), state: q.answered ? 'answered' : 'open', lines, against: [], changes, evidence: evidenceOf(q, lines) };
  });
  const makeActions = (specs: readonly ActionSpec[], review: 'accepted' | 'suggested'): NoteAction[] => specs.map((a) => {
    const lines = groundsOf(a);
    const owner = a.owner;
    const changes: Change[] = [];
    if (owner && a.takenOn) changes.push({ by: changer(owner, roleOf(owner)), at: addMinutes(settled, 11), what: 'took-on' });
    if (owner && a.takenOn && a.due) changes.push({ by: changer(owner, roleOf(owner)), at: addMinutes(settled, 11), what: 'due', after: a.due });
    if (owner && a.done) changes.push({ by: changer(owner, roleOf(owner)), at: addMinutes(settled, 60), what: 'done' });
    const item: ActionItem = {
      ...ACCEPTED_FOLLOW_UP, review, revision: a.revision ?? `${a.id}-v1`, changeOf: a.target?.id ?? null, target: a.target ?? null, reviewed: a.reviewed ?? null,
      id: a.id, text: a.text, ...(owner ? { owner: { name: owner.name, person: owner } } : {}), takenOn: a.takenOn ?? false, ...(a.due ? { due: a.due } : {}),
      ...(a.at ? { at: mmss(a.at) } : {}), done: a.done ?? false, lines, against: [], changes, from: a.board ? 'board' : null
    };
    // What's backed by a board needn't be backed by anything said, as the API has it (backing.ts).
    const evidence = evidenceOf(a, lines);
    return { ...item, evidence: a.board ? { ...evidence, flags: evidence.flags.filter((f) => f !== 'missing') } : evidence };
  });
  const actions = makeActions(s.actions ?? [], 'accepted');
  const suggestions = makeActions(s.suggestions ?? [], 'suggested');
  const recipients: Recipient[] = [
    { person: s.organizer, role: 'organizer' },
    ...(s.invited ?? []).map((person): Recipient => ({ person, role: 'invited', at: ended })),
    ...(s.shared ?? []).map((x): Recipient => ({ person: x.person, role: 'shared', by: x.by, ...(x.group ? { group: x.group } : {}), at: x.at }))
  ];
  const mine = s.organizer.email === me.email;
  const sharedToMe = s.shared?.find((x) => x.person.email === me.email);
  const received: Received | undefined = mine ? undefined
    : sharedToMe ? { role: 'shared', by: sharedToMe.by, ...(sharedToMe.group ? { group: sharedToMe.group } : {}), at: sharedToMe.at }
      : { role: 'invited', by: s.organizer, at: ended };
  const seconds = s.minutes * 60;
  return {
    id: s.id, kind, status, title: s.title, startedAt: s.startedAt, duration: status === 'recording' ? 0 : seconds,
    people: recipients.map((r) => r.person),
    sharedWith: (s.shared ?? []).map((x) => x.person.email),
    excerpt: status === 'ready' ? s.excerpt : '',
    openActions: status === 'ready' ? actions.filter((a) => !a.done).length : 0, totalActions: status === 'ready' ? actions.length : 0,
    ...(s.meetingId ? { meetingId: s.meetingId } : {}),
    ...(received ? { received } : {}),
    groupShares: (s.shared ?? []).flatMap((x) => (x.group ? [{ by: x.by, group: x.group, at: x.at }] : [])).filter((g, i, all) => all.findIndex((o) => o.by.email === g.by.email && o.group === g.group) === i),
    recipients,
    teamVisible: false,
    workedOn: [],
    summary: status === 'ready' ? s.summary ?? s.excerpt : '',
    details: status === 'ready' && s.summary ? s.details ?? '' : '',
    decisions: status === 'ready' ? decisions : [],
    questions: status === 'ready' ? questions : [],
    actions: status === 'ready' ? actions : [],
    suggestions,
    chapters: status === 'ready' ? (s.chapters ?? []).map(([at, title, summary]): Chapter => ({ at: mmss(at), title, summary })) : [],
    gaps: [],
    screens: status === 'ready' ? [...(s.screens ?? [])] : [],
    shares: status === 'ready' ? [...(s.shares ?? [])] : [],
    model: null,
    unencrypted: [],
    transcript: status === 'recording' ? null : readable,
    rooms: [],
    additions: [],
    writtenAt: written,
    writingAgain: false,
    suggestedQuestions: status === 'ready' ? ['What did we decide?', 'What do I need to do?', 'Draft a follow-up'] : [],
    audio: kept.recording && status !== 'recording' ? [{ index: 0, seconds, pieces: Math.ceil(seconds / 5), mimeType: 'audio/webm;codecs=opus' }] : [],
    kept,
    inference: written ? inferenceAt(addMinutes(ended, 1), (s.screens?.length ?? 0) > 0 || (s.shares?.length ?? 0) > 0) : [],
    ...(s.seriesId ? { seriesId: s.seriesId } : {}),
    home: null
  };
}

/** A note as the list has it: its summary, with nothing found in it. */
export function summaryOf(n: Note): NoteSummary {
  return {
    id: n.id, kind: n.kind, status: n.status, title: n.title, startedAt: n.startedAt, duration: n.duration, people: n.people, sharedWith: n.sharedWith,
    excerpt: n.excerpt, openActions: n.openActions, totalActions: n.totalActions, ...(n.meetingId ? { meetingId: n.meetingId } : {}),
    ...(n.received ? { received: n.received } : {}), ...(n.seriesId ? { seriesId: n.seriesId } : {}), groupShares: n.groupShares, teamVisible: n.teamVisible
  };
}
export const foundOf = (n: Note): NoteFound => ({ ...summaryOf(n), said: [], saidCount: 0 });

/* ---------- calls and the calendar ---------- */

export interface CallSpec {
  id: string;
  title: string;
  startsAt: string;
  minutes: number;
  code: string;
  organizer?: Person | undefined;
  guests: readonly Person[];
  notes?: NotesSetting | undefined;
  status?: Meeting['status'] | undefined;
  rsvps?: Partial<RsvpCounts> | undefined;
  seriesId?: string | undefined;
  repeat?: Repeat | undefined;
  noteId?: string | undefined;
}

/** A call as `me` sees it: organized by them unless it says otherwise. */
export function call(s: CallSpec, me: Person = ART): Meeting {
  const organizer = s.organizer ?? me;
  const yes = s.rsvps?.yes ?? 0;
  const maybe = s.rsvps?.maybe ?? 0;
  const no = s.rsvps?.no ?? 0;
  return {
    id: s.id, title: s.title, startsAt: s.startsAt, endsAt: addMinutes(s.startsAt, s.minutes), organizer, isOrganizer: organizer.email === me.email,
    guests: [...s.guests], guestCount: s.guests.length, notes: s.notes ?? 'on', choices: DEFAULT_NOTES_CHOICES, code: s.code, status: s.status ?? 'scheduled',
    instant: false, joinMuted: false, documents: [], workspaceId: null, rsvps: { yes, maybe, no, waiting: Math.max(0, s.guests.length - yes - maybe - no) },
    rsvp: organizer.email === me.email ? null : 'yes',
    calendarUrl: `https://calendar.example.com/events/${s.id}`,
    ...(s.noteId ? { noteId: s.noteId } : {}),
    ...(s.seriesId ? { seriesId: s.seriesId } : {}),
    ...(s.repeat ? { repeat: s.repeat } : {})
  };
}

export interface EventSpec { id: string; title: string; startsAt: string; minutes: number; organizer?: Person | undefined; guests?: readonly Person[] | undefined; meet?: boolean | undefined }
/** One of your own calendar's events: someone else's video link (`meet`), or none. */
export function calendarEvent(s: EventSpec, me: Person = ART): CalendarEvent {
  const organizer = s.organizer ?? me;
  return {
    id: s.id, title: s.title, startsAt: s.startsAt, endsAt: addMinutes(s.startsAt, s.minutes), organizer, isOrganizer: organizer.email === me.email,
    guests: [...(s.guests ?? [])], calendarUrl: `https://calendar.example.com/events/${s.id}`,
    ...(s.meet ? { join: { url: `https://meet.example.com/${s.id}`, label: 'Google Meet' } } : {})
  };
}

export const connected = (events: CalendarEvent[]): Calendar => ({ source: 'google', needsAccess: false, events });
export const notConnected: Calendar = { source: 'google', needsAccess: true, events: [] };
