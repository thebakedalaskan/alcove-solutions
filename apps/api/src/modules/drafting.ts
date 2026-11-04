/*
 * What Alcove asks the notes model, and how its replies are checked before anything is kept:
 * writing a call's notes from its transcript and what was on its shared screens, reading a frame of a
 * shared screen, answering a question about a call (finished or still going), and catching someone up
 * during a call. Each goes to NEAR AI Cloud through inference.ts and accepts only the JSON shapes below;
 * anything else is refused (docs: notes-and-inference › Prompts).
 */
import {
  firstName, type ActionItem, type AnswerPart, type CaptureGap, type CatchUp, type CatchUpItem, type Chapter, type Decision, type InferenceEvidence, type NoteKind, type Person, type Question,
  type ScreenMoment, type ScreenRef, type Speaker, type TranscriptLine
} from '@alcove/api';
import { z } from 'zod';
import type { Config } from '../config';
import { id128 } from '../crypto';
import { UnavailableError } from '../errors';
import { complete, completeJson, jpegPart } from '../inference';
import type { NoteManifest } from './notes';
import type { Reading } from './screens';

/** What the notes model writes into a note (shared screens described, too), and the verified model that wrote it. */
export interface Written { summary: string; decisions: Decision[]; questions: Question[]; actions: ActionItem[]; chapters: Chapter[]; suggestedQuestions: string[]; screens: ScreenMoment[]; evidence: InferenceEvidence }

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
  /** The written summary, for questions after the notes are written. */
  summary?: string | undefined;
  /** The meeting is still going on. */
  live?: boolean | undefined;
}
/** A finished note, as the model reads it. */
export const briefOf = (m: NoteManifest, organizer: Person, people: Person[]): Brief =>
  ({ title: m.title, kind: m.kind, organizer, people, seconds: m.duration, lines: m.transcript ?? [], gaps: m.gaps, screens: m.screens, summary: m.summary });

/** About 30,000 tokens of transcript; longer calls keep their beginning and end. */
const MAX_TRANSCRIPT_CHARS = 120_000;

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Who said it, as the model reads it: on one line, and marked when it's a guest, who named themselves. */
const saidBy = (s: Speaker) => `${oneLine(s.name)}${s.person && !s.person.email ? ' (guest)' : ''}`;

/**
 * Where nothing was captured, as the model reads it: a line of its own starting "--", which says how long and that
 * nothing said then was recorded, so the model never writes as if the meeting ran on through it.
 */
function gapLine(g: CaptureGap, now: number): string {
  const ms = (g.to ? Date.parse(g.to) : now) - Date.parse(g.from);
  const long = ms < 60_000 ? 'less than a minute' : `${Math.round(ms / 60_000)} min`;
  if (g.kind === 'offline') {
    return g.to ? `-- at ${mmss(g.at)} the organizer's browser was out of the call for ${long}: nothing said then was recorded --`
      : `-- at ${mmss(g.at)} the organizer's browser left the call, ${long} ago: nothing said since was recorded --`;
  }
  const kind = g.kind === 'paused' ? 'paused' : 'off';
  return g.to ? `-- at ${mmss(g.at)} notes were ${kind} for ${long}: nothing said then was recorded --`
    : `-- at ${mmss(g.at)} notes went ${kind}, ${long} ago: nothing said since was recorded --`;
}
/**
 * How much of a screen's text is kept: what the notes model reads among the lines, and what the note shows. The
 * note keeps every frame's reading, and every edit copies the note, so it stays short.
 */
const SCREEN_TEXT_CHARS = 700;
const LEGIBLE: Record<ScreenMoment['legible'], string> = { clear: 'clear', partly: 'partly legible', unreadable: 'unreadable', unread: 'not read' };
/**
 * A shared screen as the model reads it, numbered from 1: "[mm:ss] [screen N from Name, clear] Title. Reads: … Parts:
 * (1) … (2) …", with only what was read on it.
 */
function screenLine(m: ScreenMoment, n: number): string {
  const from = m.presenter ? ` from ${saidBy(m.presenter)}` : '';
  const reads = m.text.trim() ? ` Reads: ${clip(m.text.replace(/\s*\n\s*/g, ' / ').trim(), SCREEN_TEXT_CHARS)}` : '';
  const parts = m.regions.length ? ` Parts: ${m.regions.map((r, i) => `(${i + 1}) ${oneLine(r.label)}`).join(' ')}` : '';
  return `[${mmss(m.at)}] [screen ${n}${from}, ${LEGIBLE[m.legible]}] ${oneLine(m.title) || 'Untitled'}.${reads}${parts}`;
}
/**
 * The transcript as the model reads it: "[mm:ss] Name: words", or "[mm:ss] words" when nobody can tell who spoke, with
 * a "--" line where nothing was captured and a "[screen N" line where a shared screen changed.
 */
function transcriptText(lines: TranscriptLine[], gaps: CaptureGap[] = [], screens: ScreenMoment[] = []): string {
  const now = Date.now();
  const all: string[] = [];
  let g = 0;
  let sc = 0;
  for (const l of lines) {
    for (; g < gaps.length && (gaps[g]?.at ?? 0) <= l.at; g++) { const gap = gaps[g]; if (gap) all.push(gapLine(gap, now)); }
    for (; sc < screens.length && (screens[sc]?.at ?? 0) <= l.at; sc++) { const m = screens[sc]; if (m) all.push(screenLine(m, sc + 1)); }
    all.push(`[${mmss(l.at)}] ${l.speaker ? `${saidBy(l.speaker)}: ` : ''}${oneLine(l.text)}`);
  }
  for (const gap of gaps.slice(g)) all.push(gapLine(gap, now));
  for (; sc < screens.length; sc++) { const m = screens[sc]; if (m) all.push(screenLine(m, sc + 1)); }
  const text = all.join('\n');
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  for (let i = 0, j = all.length - 1; i <= j && used < MAX_TRANSCRIPT_CHARS;) {
    const front = all[i] ?? '';
    head.push(front); used += front.length + 1; i++;
    const back = all[j] ?? '';
    if (i <= j) { tail.unshift(back); used += back.length + 1; j--; }
  }
  return [...head, `[… ${all.length - head.length - tail.length} lines left out …]`, ...tail].join('\n');
}

/** A person as the model needs them: their name, or the name part of an address nobody named. */
const called = (p: Person) => (p.name === p.email ? p.email.split('@')[0] ?? p.name : p.name);

function about(b: Brief): string {
  const invited = b.people.length ? b.people.map(called).join(', ') : 'nobody else';
  return [
    `Meeting: ${b.title}`,
    `Kind: ${b.kind === 'room' ? 'an in-person meeting, recorded on one device in the room' : 'a video call'}`,
    `Organizer: ${b.organizer.name}`,
    `Invited: ${invited}`,
    b.live ? `Going on for: ${Math.max(1, Math.round(b.seconds / 60))} minutes so far` : `Length: ${Math.max(1, Math.round(b.seconds / 60))} minutes`
  ].join('\n');
}
/** Seconds the model may point at: within what was recorded. */
const moment = (b: Brief) => {
  const last = Math.max(b.seconds, b.lines.at(-1)?.at ?? 0);
  return (s: number): number | undefined => (Number.isFinite(s) && s >= 0 && s <= last + 1 ? Math.round(s) : undefined);
};
const issues = (e: z.ZodError) => e.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.code}`).join('; ');

const NOTES_PROMPT = `You write the notes for a meeting from its transcript. Reply with a single JSON object and nothing else, in this shape:
{"summary": string, "decisions": [{"text": string, "at": number, "screen": number | null, "part": number | null, "sure": boolean}], "questions": [{"text": string, "at": number, "screen": number | null, "part": number | null, "sure": boolean}], "actions": [{"text": string, "owner": string | null, "due": string | null, "at": number, "screen": number | null, "part": number | null, "sure": boolean}], "chapters": [{"at": number, "title": string, "summary": string, "screen": number | null, "part": number | null, "sure": boolean}], "suggestedQuestions": [string], "screens": [{"n": number, "description": string}]}

summary: two to four plain sentences on what the meeting was about and where it landed. Start with the substance, not "The meeting" or "In this call".
decisions: what the people agreed or settled, one short sentence each, with the second it was settled. An empty list if nothing was decided; something only suggested is not a decision.
questions: what someone asked that the meeting didn't answer or settle by its end, one short question each, with the second it was asked. An empty list if every question was answered.
actions: what someone said they, or someone else, would do. text starts with a verb, like "Send the new screens". owner is that person's name as the transcript gives it, or null if it doesn't say. due is when, as it was said ("Wednesday", "end of March"), or null. at is the second it came up.
Every at is read from the transcript's [mm:ss] marks.
chapters: the parts of the meeting in order, two to six of them (one for a short meeting). at is the second the part starts, read from the transcript's [mm:ss] marks. title is two to five words; summary is one short sentence.
suggestedQuestions: three short questions someone might ask about this meeting afterwards.

A line starting "[mm:ss] [screen N" says what was on a shared screen from then on, as it was read: whose screen, how legible it was, its title, the words read on it, and its numbered parts. A screen that is partly legible, unreadable or not read shows only what its line says: never fill in what couldn't be read.
screens: one entry for each screen N in the transcript, {"n": N, "description": string}: one or two plain sentences on what it shows and what was being said about it then. If it couldn't be read, or nothing said was about it, say only what can be told.
screen: when a decision, question, action or chapter was about something on a screen, the N of that screen, with part: the number of the part meant, if one part is, and sure: true when what was said plainly refers to it ("this chart", "the numbers on the slide"), false when that only seems likely. Otherwise screen is null.

Write in the language of the transcript. Use only what the transcript and its screens say: never invent names, numbers, dates or decisions. Lines without a name come from a recording in a room, where nobody can tell who spoke. A line starting "--" marks a stretch when notes were off or paused and nothing was recorded: never say or guess what happened in it.`;

/** A second the model points at, if it gave one. */
const At = z.coerce.number().nullish().catch(null);
/** The shared screen (numbered from 1), and its part, something is about, and whether that's plain or only likely. */
const OnScreen = { screen: At, part: At, sure: z.boolean().nullish().catch(null) };
const Said = z.union([z.string().transform((text) => ({ text, at: null, screen: null, part: null, sure: null })), z.object({ text: z.string(), at: At, ...OnScreen })]);
const Draft = z.object({
  summary: z.string().min(1),
  decisions: z.array(Said).catch([]),
  questions: z.array(Said).catch([]),
  actions: z.array(z.object({ text: z.string(), owner: z.string().nullish().catch(null), due: z.string().nullish().catch(null), at: At, ...OnScreen })).catch([]),
  chapters: z.array(z.object({ at: z.coerce.number(), title: z.string(), summary: z.string().catch(''), ...OnScreen })).catch([]),
  suggestedQuestions: z.array(z.string()).catch([]),
  screens: z.array(z.object({ n: z.coerce.number(), description: z.string().catch('') })).catch([])
});

/**
 * Where something the model wrote was on a shared screen: one of the screens it was sent (numbered from 1), the part of
 * it when one of its parts was meant, and whether that was plain. Anything else points at nothing.
 */
function onScreen(shown: ScreenMoment[], o: { screen?: number | null | undefined; part?: number | null | undefined; sure?: boolean | null | undefined }): { screen?: ScreenRef } {
  const n = o.screen;
  const m = typeof n === 'number' && Number.isInteger(n) ? shown[n - 1] : undefined;
  if (!m) return {};
  const part = o.part;
  const region = typeof part === 'number' && Number.isInteger(part) && part >= 1 && part <= m.regions.length ? part - 1 : undefined;
  return { screen: { id: m.id, ...(region === undefined ? {} : { region }), sure: o.sure === true } };
}

/** Words that mean "nobody in particular" when the model gives them as an owner. */
const NOBODY = new Set(['', 'unknown', 'unassigned', 'none', 'n/a', 'someone', 'somebody', 'everyone', 'team', 'the team', 'all', 'null']);

/** Writes a note's summary, decisions, open questions, follow-ups, chapters and suggested questions from its transcript. */
export async function draft(cfg: Config, b: Brief): Promise<Written> {
  const shown = b.screens ?? [];
  const { json, evidence } = await complete(cfg, [
    { role: 'system', content: NOTES_PROMPT },
    { role: 'user', content: `${about(b)}\n\nTranscript:\n${transcriptText(b.lines, b.gaps, shown)}` }
  // A full draft can take the model well over a minute (about 24 tokens a second, up to 2,500 of them).
  ], { what: 'notes', maxTokens: 2500, timeoutMs: 180_000 });
  const reply = Draft.safeParse(json);
  if (!reply.success) throw new UnavailableError('The notes came back in the wrong shape.', { context: { what: 'notes', issues: issues(reply.error) } });
  const d = reply.data;
  const everyone = [b.organizer, ...b.people];
  const owner = (name: string | null | undefined): Speaker | undefined => {
    const n = name?.trim() ?? '';
    if (NOBODY.has(fold(n))) return undefined;
    // The model knows people by what it was told they're called: a name, or the name part of an address.
    const p = everyone.find((x) => fold(x.name) === fold(n) || fold(called(x)) === fold(n))
      ?? everyone.find((x) => fold(firstName(called(x))) === fold(firstName(n)));
    // Someone known only by their address is shown by the name the call used for them.
    return p ? { name: p.name === p.email ? clip(n, 80) : p.name, person: p } : { name: clip(n, 80) };
  };
  const last = Math.max(b.seconds, b.lines.at(-1)?.at ?? 0);
  const chapters = d.chapters
    .filter((c) => Number.isFinite(c.at) && c.title.trim())
    .map((c): Chapter => ({ at: Math.round(Math.min(Math.max(0, c.at), last)), title: clip(c.title.trim(), 60), summary: clip(c.summary.trim(), 160), ...onScreen(shown, c) }))
    .sort((a, b) => a.at - b.at)
    .filter((c, i, all) => i === 0 || c.at !== all[i - 1]?.at)
    .slice(0, 8);
  const when = moment(b);
  const said = (s: number | null | undefined) => { const m = s === null || s === undefined ? undefined : when(s); return m === undefined ? {} : { at: m }; };
  return {
    summary: clip(d.summary.trim(), 1500),
    // What the notes heard is only proposed: people who have the notes confirm it, or say it wasn't decided.
    decisions: d.decisions.filter((x) => x.text.trim()).slice(0, 12).map((x): Decision => ({ id: id128(), text: clip(x.text.trim(), 300), ...said(x.at), state: 'proposed', ...onScreen(shown, x), changes: [] })),
    // Open until someone who has the notes says it was answered, here or in a later call.
    questions: d.questions.filter((x) => x.text.trim()).slice(0, 12).map((x): Question => ({ id: id128(), text: clip(x.text.trim(), 300), ...said(x.at), state: 'open', ...onScreen(shown, x), changes: [] })),
    actions: d.actions.filter((a) => a.text.trim()).slice(0, 20).map((a): ActionItem => {
      const who = owner(a.owner);
      const due = a.due?.trim();
      return { id: id128(), text: clip(a.text.trim(), 300), ...(who ? { owner: who } : {}), takenOn: false, ...(due ? { due: clip(due, 40) } : {}), ...said(a.at), done: false, ...onScreen(shown, a), changes: [] };
    }),
    chapters,
    suggestedQuestions: d.suggestedQuestions.map((q) => clip(q.trim(), 120)).filter(Boolean).slice(0, 3),
    // Each screen with what the model said it shows and how it ties in; one it said nothing about keeps its reading alone.
    screens: shown.map((m, i) => ({ ...m, description: clip(d.screens.find((x) => x.n === i + 1)?.description.trim() ?? '', 400) })),
    evidence
  };
}

const ASK_PROMPT = `You answer a question about one meeting, using only its transcript and notes. Reply with a single JSON object and nothing else: {"answer": string, "moments": [number], "screens": [number]}

answer: plain and direct, at most four sentences, unless the question asks for a draft such as an email or a list, which can be longer. "I", "me" and "my" in the question mean the person asking. If the meeting is still going on, answer from what has been said so far. If the transcript doesn't cover it, say so plainly. A line starting "--" marks a stretch when nothing was recorded: never say or guess what was said in it. A line starting "[mm:ss] [screen N" says what was on a shared screen from then on, as it was read: never say a screen showed more than its line says.
moments: the seconds the answer comes from, read from the transcript's [mm:ss] marks; at most four, in order. An empty list if there are none.
screens: the N of each shared screen the answer comes from; at most two. An empty list if there are none.`;

const Answer = z.object({ answer: z.string().min(1), moments: z.array(z.coerce.number()).catch([]), screens: z.array(z.coerce.number()).catch([]) });

/** Answers a question about a call, written up or still going, with the moments in the recording it comes from. */
export async function answer(cfg: Config, b: Brief, asker: Person, question: string): Promise<AnswerPart[]> {
  const shown = b.screens ?? [];
  const reply = Answer.safeParse(await completeJson(cfg, [
    { role: 'system', content: ASK_PROMPT },
    { role: 'user', content: `${about(b)}\n\nSummary: ${b.summary || '(none)'}\n\nTranscript:\n${transcriptText(b.lines, b.gaps, shown)}\n\nAsked by: ${called(asker)}\nQuestion: ${question}` }
  ], { what: b.live ? 'ask-live' : 'ask', maxTokens: 1200, timeoutMs: 60_000 }));
  if (!reply.success) throw new UnavailableError('The answer came back in the wrong shape. Try asking again.', { context: { what: 'ask', issues: issues(reply.error) } });
  const at = moment(b);
  const moments = [...new Set(reply.data.moments.flatMap((s) => { const m = at(s); return m === undefined ? [] : [m]; }))].sort((x, y) => x - y).slice(0, 4);
  // Only screens it was sent, each once.
  const screens = [...new Set(reply.data.screens)].flatMap((n) => { const m = Number.isInteger(n) ? shown[n - 1] : undefined; return m ? [m] : []; }).slice(0, 2);
  return [
    { type: 'text', text: reply.data.answer.trim() }, ...moments.map((m): AnswerPart => ({ type: 'cite', at: m })),
    ...screens.map((m): AnswerPart => ({ type: 'screen', id: m.id, at: m.at }))
  ];
}

const CATCH_UP_PROMPT = `You help someone catch up on a meeting that is still going on, from its transcript so far. Reply with a single JSON object and nothing else, in this shape:
{"summary": string, "decided": [{"text": string, "at": number}], "proposed": [{"text": string, "at": number}], "open": [{"text": string, "at": number}], "next": [{"text": string, "owner": string | null, "due": string | null, "at": number}]}

summary: one or two plain sentences on where the conversation is now.
decided: what the people agreed or settled.
proposed: what someone suggested that hasn't been agreed yet. Something only suggested is never decided.
open: questions that were asked and haven't been answered yet.
next: what someone said they, or someone else, would do. owner is that person's name as the transcript gives it, or null if it doesn't say; due is when, as it was said ("Friday"), or null.
Each item is one short sentence, and at is the second it was said, read from the transcript's [mm:ss] marks. Use an empty list when there's nothing. Write in the language of the transcript, and use only what it says: never invent names, numbers or decisions. A line starting "--" marks a stretch when nothing was recorded: never say or guess what happened in it.`;

const Items = z.array(z.object({
  text: z.string(), at: z.coerce.number().nullish().catch(null), owner: z.string().nullish().catch(null), due: z.string().nullish().catch(null)
})).catch([]);
const CatchUpReply = z.object({ summary: z.string().catch(''), decided: Items, proposed: Items, open: Items, next: Items });
type Sorted = Pick<CatchUp, 'summary' | 'decided' | 'proposed' | 'open' | 'next'>;

/** Where a call in progress has got to, sorted into decided, proposed, still open, and what's next. */
export async function catchUp(cfg: Config, b: Brief): Promise<Sorted> {
  const reply = CatchUpReply.safeParse(await completeJson(cfg, [
    { role: 'system', content: CATCH_UP_PROMPT },
    { role: 'user', content: `${about({ ...b, live: true })}\n\nTranscript so far:\n${transcriptText(b.lines, b.gaps)}` }
  ], { what: 'catch-up', maxTokens: 1500, timeoutMs: 60_000 }));
  if (!reply.success) throw new UnavailableError('The catch-up came back in the wrong shape. Try again.', { context: { what: 'catch-up', issues: issues(reply.error) } });
  const at = moment(b);
  const items = (xs: z.infer<typeof Items>, todo = false): CatchUpItem[] => xs.filter((x) => x.text.trim()).slice(0, 8).map((x) => {
    const m = x.at === null || x.at === undefined ? undefined : at(x.at);
    const owner = x.owner?.trim() ?? '';
    const due = x.due?.trim() ?? '';
    return {
      text: clip(x.text.trim(), 300), ...(m === undefined ? {} : { at: m }),
      ...(todo && owner && !NOBODY.has(fold(owner)) ? { owner: clip(owner, 80) } : {}), ...(todo && due ? { due: clip(due, 40) } : {})
    };
  });
  const d = reply.data;
  return { summary: clip(d.summary.trim(), 600), decided: items(d.decided), proposed: items(d.proposed), open: items(d.open), next: items(d.next, true) };
}

const TRANSLATE_PROMPT = `You translate live captions of a meeting. You get a JSON object with the language to translate into and the lines, each with an id. Reply with a single JSON object and nothing else: {"lines": [{"id": string, "text": string}]}

Translate every line, keeping its id. Keep names, numbers and dates exactly. A line already in that language comes back as it is. Translate only: never add, explain or leave out anything.`;

const Translation = z.object({ lines: z.array(z.object({ id: z.string(), text: z.string() })).catch([]) });

/** Live transcript lines in another language, by line ID. Lines the model left out or emptied aren't returned. */
export async function translate(cfg: Config, lines: { id: string; text: string }[], language: string): Promise<Map<string, string>> {
  const reply = Translation.safeParse(await completeJson(cfg, [
    { role: 'system', content: TRANSLATE_PROMPT },
    { role: 'user', content: JSON.stringify({ language, lines }) }
  ], { what: 'translate', maxTokens: 2000, timeoutMs: 30_000 }));
  if (!reply.success) throw new UnavailableError('The captions came back in the wrong shape.', { context: { what: 'translate', issues: issues(reply.error) } });
  const wanted = new Set(lines.map((l) => l.id));
  return new Map(reply.data.lines.filter((l) => wanted.has(l.id) && l.text.trim()).map((l) => [l.id, clip(l.text.trim(), 1000)]));
}

const READ_SCREEN_PROMPT = `You read one frame of a screen someone shared in a meeting. Reply with a single JSON object and nothing else, in this shape:
{"title": string, "text": string, "legible": "clear" | "partly" | "unreadable", "regions": [{"label": string, "box": [number, number, number, number]}]}

title: what it is, in a few words: a slide's heading, a document's or page's name, or the app and what's open in it.
text: the words and numbers you can read on it, exactly as written, top to bottom, one line each, at most 600 characters. Leave out what you can't read; never guess at it or fill it in.
legible: clear if you can read all of it, partly if some of it is too small, blurred or cut off, unreadable if you can't make it out at all.
regions: up to four parts someone might point at while talking, such as a chart, a table, a code block or a paragraph, each with a short label and its box as [left, top, right, bottom], each a fraction of the frame's width or height from 0 to 1. An empty list if nothing stands out.
Describe only what is on the frame. Write in the language on the screen.`;

const ScreenReply = z.object({
  title: z.string().catch(''), text: z.string().catch(''),
  // Saying nothing about how legible it was isn't saying it was clear.
  legible: z.enum(['clear', 'partly', 'unreadable']).catch('partly'),
  regions: z.array(z.object({ label: z.string(), box: z.array(z.coerce.number()).length(4) })).catch([])
});
const unit = (n: number) => Math.min(1, Math.max(0, n));

/**
 * What's on one frame of a shared screen, read by the notes model: the image goes sealed to its verified key, like
 * every request. Only what it could read is kept, with how legible it was; the parts it points at are boxes inside
 * the frame, as fractions of it, and at least a sliver big.
 */
export async function readScreen(cfg: Config, jpeg: Uint8Array): Promise<Reading> {
  const { json } = await complete(cfg, [
    { role: 'system', content: READ_SCREEN_PROMPT },
    { role: 'user', content: [{ type: 'text', text: 'The frame:' }, jpegPart(jpeg)] }
  ], { what: 'read-screen', maxTokens: 1200, timeoutMs: 60_000 });
  const reply = ScreenReply.safeParse(json);
  if (!reply.success) throw new UnavailableError('The screen came back read in the wrong shape.', { context: { what: 'read-screen', issues: issues(reply.error) } });
  const r = reply.data;
  const regions = r.regions.flatMap((g) => {
    const [l = 0, t = 0, rt = 0, b = 0] = g.box.map(unit);
    const label = clip(g.label.trim(), 60);
    return label && rt - l >= 0.02 && b - t >= 0.02 ? [{ label, x: l, y: t, w: Math.round((rt - l) * 1000) / 1000, h: Math.round((b - t) * 1000) / 1000 }] : [];
  }).slice(0, 4);
  return { legible: r.legible, title: clip(r.title.trim(), 120), text: clip(r.text.trim(), SCREEN_TEXT_CHARS), regions };
}
