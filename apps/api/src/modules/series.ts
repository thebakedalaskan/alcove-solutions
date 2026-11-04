/*
 * Series (docs: notes-and-inference › Series): calls that follow on from each other, and what
 * carries over between them. A series is a random ID in its organizer's meetings, sealed with the
 * rest of each manifest; every occurrence of one recurring Google Calendar event held in Alcove
 * shares one, and so does a call scheduled as the next one.
 *
 * What carries over (confirmed decisions, open questions, follow-ups) is read from the notes the
 * person asking has, each time they ask: the organizer's own, or the ones given to them by
 * invitation or sharing, found by their email's index at that moment, from the newest 24 calls.
 * Being invited to one call in a series opens nothing from the others. Room recordings have no call,
 * so they're never in one. Nothing derived is kept, so a deleted note or a removed grant drops out at
 * once, and an answer written while one went isn't sent.
 */
import type { CarriedAction, CarriedDecision, CarriedQuestion, Person, Series, SeriesAnswerPart, SeriesNote, TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { ConflictError, UnavailableError, notFound } from '../errors';
import { completeJson } from '../inference';
import { log } from '../log';
import { listItems, type Loaded } from '../vault';
import { me } from './account';
import { all as allMeetings, toMeeting, type MeetingManifest } from './meetings';
import { NoteManifest, goneSince, seriesOf, sharedWithMe, type Located } from './notes';
import { personOf } from './portraits';

const slog = log.child({ component: 'series' });

/** Open through this many later calls, a question or follow-up is stale. */
const STALE_AFTER = 2;
/** A series shows its newest calls, at most this many; it says how many older ones there are. */
const MAX_SHOWN = 24;

/** The calls of a series whose notes you can open now, newest first, and its calls if it's your series. */
interface Found { sources: Located[]; own: Loaded<MeetingManifest>[] }

/**
 * Everyone finds a series' notes the same way: the notes they have whose call is in it, once the
 * call has ended. A call reopened after it ended has a note for each time, and each counts.
 */
async function find(o: Owner, seriesId: string): Promise<Found> {
  const own = (await allMeetings(o)).filter((m) => m.manifest.seriesId === seriesId);
  const sources: Located[] = [];
  if (own.length) {
    const calls = new Set(own.map((m) => m.itemId));
    for (const note of await listItems(o, o.pool, 'note', NoteManifest)) {
      const { meetingId, status } = note.manifest;
      if (meetingId && calls.has(meetingId) && status !== 'recording') sources.push({ owner: o, note, mine: true });
    }
  } else {
    // Someone else's series: only the notes given to you, and only those whose call is in it.
    const seriesOfCall = new Map<string, Promise<string | undefined>>();
    for (const l of await sharedWithMe(o)) {
      const meetingId = l.note.manifest.meetingId;
      if (!meetingId || l.note.manifest.status === 'recording') continue;
      const key = `${l.owner.ownerId}/${meetingId}`;
      const known = seriesOfCall.get(key) ?? seriesOf(l);
      seriesOfCall.set(key, known);
      if ((await known) === seriesId) sources.push(l);
    }
  }
  sources.sort((a, b) => b.note.manifest.startedAt.localeCompare(a.note.manifest.startedAt));
  return { sources, own };
}

/** When a follow-up was last ticked, if it was. */
const doneAt = (a: { changes: { what: string; at: string }[] }) => [...a.changes].reverse().find((c) => c.what === 'done')?.at;

/** A series as the person asking sees it: what carries over from the newest calls whose notes they have. */
export async function get(o: Owner, seriesId: string): Promise<Series> {
  const { sources: found, own } = await find(o, seriesId);
  const sources = found.slice(0, MAX_SHOWN);
  const first = sources[0];
  if (!own.length && !first) throw notFound('That series', { seriesId });
  const isOrganizer = own.length > 0;
  const organizer = await me(isOrganizer || !first ? o : first.owner);
  const now = Date.now();
  const next = own
    .filter((m) => m.manifest.status !== 'ended' && new Date(m.manifest.endsAt).getTime() > now - 60 * 60_000)
    .sort((a, b) => a.manifest.startsAt.localeCompare(b.manifest.startsAt))[0];
  const latest = [...own].sort((a, b) => b.manifest.startsAt.localeCompare(a.manifest.startsAt))[0];

  // Ticked since the latest call started: worth saying at the next one. (A call's notes join its
  // series when it ends, so every call here has ended.)
  const since = first?.note.manifest.startedAt ?? '';
  const decisions: CarriedDecision[] = [];
  const questions: CarriedQuestion[] = [];
  const actions: CarriedAction[] = [];
  sources.forEach((s, later) => {
    const m = s.note.manifest;
    if (m.status !== 'ready') return;
    const noteId = s.note.itemId;
    const stale = later >= STALE_AFTER;
    for (const d of m.decisions) if (d.state !== 'rejected') decisions.push({ ...d, noteId });
    for (const q of m.questions) if (q.state === 'open') questions.push({ ...q, noteId, later, stale });
    for (const a of m.actions) if (!a.done || (doneAt(a) ?? '') >= since) actions.push({ ...a, noteId, later, stale: !a.done && stale });
  });
  const notes = sources.map((s): SeriesNote => {
    const m = s.note.manifest;
    return {
      id: s.note.itemId, title: m.title, startedAt: m.startedAt, duration: m.duration, status: m.status,
      ...(s.mine ? (m.meetingId ? { meetingId: m.meetingId } : {}) : { from: organizer })
    };
  });
  const older = found.length - sources.length;
  slog.debug('series read', { seriesId, organizer: isOrganizer, notes: notes.length, older, decisions: decisions.length, questions: questions.length, actions: actions.length });
  return {
    id: seriesId, title: next?.manifest.title ?? first?.note.manifest.title ?? latest?.manifest.title ?? 'Untitled call',
    organizer, isOrganizer, ...(next ? { next: await toMeeting(o, next) } : {}),
    recurring: own.some((m) => !!m.manifest.recurringEventId), notes, older, decisions, questions, actions
  };
}

/* ---------- asking across a series ---------- */

/** At most this many calls are read for an answer, newest first; past that, the oldest stay out. */
const MAX_CALLS = 12;
/** About 30,000 tokens of notes and transcript altogether; the newest calls' transcripts come first. */
const MAX_CHARS = 120_000;

const ASK_PROMPT = `You answer a question about a series of meetings, using only the notes and transcripts of the meetings below, which are the ones the person asking has notes from. Reply with a single JSON object and nothing else: {"answer": string, "sources": [{"meeting": number, "at": number | null}]}

answer: plain and direct, at most four sentences, unless the question asks for a draft or a list, which can be longer. "I", "me" and "my" in the question mean the person asking. When it matters which meeting something comes from, say so by its date. If the meetings below don't cover it, say so plainly; never guess about meetings that aren't here.
sources: where the answer comes from: the meeting's number as given below, and the second in its transcript, read from its [mm:ss] marks, or null when it comes from the meeting's notes rather than a moment. At most four, the most relevant first. An empty list if there are none.`;

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mark = (at: number | undefined) => (at === undefined ? '' : `[${mmss(at)}] `);
/** A person as the model needs them: their name, or the name part of an address nobody named (never the address). */
const called = (p: Person) => (p.name === p.email ? p.email.split('@')[0] ?? p.name : p.name);
/** The day a call was on where the asker is: "Tuesday 3 November 2026". `timeZone` was checked when the question came in. */
const day = (iso: string, timeZone: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone });
const STATE = { proposed: 'not confirmed yet', confirmed: 'confirmed', superseded: 'no longer holds', rejected: 'not decided' } as const;

/** One call as the model reads it, before its transcript: when, who, and what its notes say. */
function notesText(n: number, m: NoteManifest, organizer: Person, timeZone: string): string {
  const invited = m.invited.map((e) => called(personOf(e)));
  const section = (title: string, lines: string[]) => (lines.length ? [`${title}:`, ...lines] : []);
  return [
    `Meeting ${n}: ${m.title}, ${day(m.startedAt, timeZone)}, ${Math.max(1, Math.round(m.duration / 60))} minutes`,
    `Organizer: ${organizer.name}`,
    `Invited: ${invited.length ? invited.join(', ') : 'nobody else'}`,
    `Summary: ${m.summary || '(none)'}`,
    ...section('Decided', m.decisions.filter((d) => d.state !== 'rejected').map((d) => `- ${mark(d.at)}${d.text} (${STATE[d.state]})`)),
    ...section('Still open', m.questions.filter((q) => q.state === 'open').map((q) => `- ${mark(q.at)}${q.text}`)),
    ...section('Follow-ups', m.actions.map((a) => {
      const who = a.owner ? `${a.owner.name}${a.takenOn ? ', took it on' : ', suggested'}` : 'nobody yet';
      return `- ${mark(a.at)}${a.text} (${[who, a.due ? `due ${a.due}` : '', a.done ? 'done' : 'not done'].filter(Boolean).join('; ')})`;
    }))
  ].join('\n');
}

/** Transcript lines in at most `chars` characters: all of them, or the beginning and end with a marker between. */
function transcriptText(lines: TranscriptLine[], chars: number): string {
  const all = lines.map((l) => `[${mmss(l.at)}] ${l.speaker ? `${l.speaker.name}: ` : ''}${l.text}`);
  if (all.join('\n').length <= chars) return all.join('\n');
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  for (let i = 0, j = all.length - 1; i <= j;) {
    const front = all[i] ?? '';
    if (used + front.length + 1 > chars) break;
    head.push(front); used += front.length + 1; i++;
    const back = all[j] ?? '';
    if (i > j || used + back.length + 1 > chars) break;
    tail.unshift(back); used += back.length + 1; j--;
  }
  return [...head, `[… ${all.length - head.length - tail.length} lines left out …]`, ...tail].join('\n');
}

const Reply = z.object({
  answer: z.string().min(1),
  sources: z.array(z.object({ meeting: z.coerce.number(), at: z.coerce.number().nullish().catch(null) })).catch([])
});

/**
 * Answers a question across the calls in a series whose notes the person asking has, citing the
 * calls (and moments) it comes from. Only those calls are sent to the notes model, with their dates
 * read in the asker's `timeZone`; nothing is kept. The answer goes only if the asker still has every
 * one of those notes once it's written: it may quote any of them.
 */
export async function ask(o: Owner, seriesId: string, question: string, timeZone: string): Promise<SeriesAnswerPart[]> {
  const { sources, own } = await find(o, seriesId);
  if (!own.length && !sources.length) throw notFound('That series', { seriesId });
  const read = sources.filter((s) => s.note.manifest.status === 'ready' && (s.note.manifest.summary || s.note.manifest.transcript?.length)).slice(0, MAX_CALLS);
  if (!read.length) throw new ConflictError('There are no written notes in this series to ask about yet.', { context: { seriesId } });
  const t0 = performance.now();
  const organizer = await me(read[0]?.owner ?? o);
  const blocks = read.map((s, i) => notesText(i + 1, s.note.manifest, organizer, timeZone));
  // What each call's notes say always goes in; transcripts fill what's left, newest call first.
  let room = MAX_CHARS - blocks.reduce((n, b) => n + b.length + 2, 0);
  const calls = read.map((s, i) => {
    const lines = s.note.manifest.transcript ?? [];
    const text = lines.length && room > 200 ? transcriptText(lines, room) : '';
    room -= text.length + 1;
    return `${blocks[i] ?? ''}\nTranscript:\n${text || (lines.length ? '(left out: the transcripts before it filled the space)' : '(nothing was transcribed)')}`;
  });
  const asker = await me(o);
  const reply = Reply.safeParse(await completeJson(o.cfg, [
    { role: 'system', content: ASK_PROMPT },
    { role: 'user', content: `Series: ${read[0]?.note.manifest.title ?? ''}\nMeetings, newest first:\n\n${calls.join('\n\n')}\n\nAsked by: ${called(asker)}\nQuestion: ${question}` }
  ], { what: 'ask-series', maxTokens: 1200, timeoutMs: 60_000 }));
  // Writing it can take up to a minute. A note deleted or taken away meanwhile must not show through the answer.
  const gone = await goneSince(o, read);
  if (gone) {
    throw new ConflictError('Notes from one of these calls were deleted or removed from yours while the answer was being written, so it isn’t shown. Ask again.', {
      context: { seriesId, calls: read.length, gone, ms: Math.round(performance.now() - t0) }
    });
  }
  if (!reply.success) {
    throw new UnavailableError('The answer came back in the wrong shape. Try asking again.', { context: { what: 'ask-series', issues: reply.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.code}`).join('; ') } });
  }
  // A source must be one of the calls sent, and a moment must fall within what that call recorded.
  const cited = new Set<string>();
  const parts: SeriesAnswerPart[] = [];
  for (const x of reply.data.sources) {
    const s = Number.isInteger(x.meeting) ? read[x.meeting - 1] : undefined;
    if (!s) continue;
    const m = s.note.manifest;
    const last = Math.max(m.duration, m.transcript?.at(-1)?.at ?? 0);
    const at = x.at !== null && x.at !== undefined && Number.isFinite(x.at) && x.at >= 0 && x.at <= last + 1 ? Math.round(x.at) : undefined;
    const key = `${s.note.itemId}@${at ?? ''}`;
    if (cited.has(key) || cited.size >= 4) continue;
    cited.add(key);
    parts.push({ type: 'source', noteId: s.note.itemId, title: m.title, startedAt: m.startedAt, ...(at === undefined ? {} : { at }) });
  }
  slog.info('series question answered', { seriesId, calls: read.length, organizer: own.length > 0, cites: parts.length, ms: Math.round(performance.now() - t0) });
  return [{ type: 'text', text: reply.data.answer.trim() }, ...parts];
}
