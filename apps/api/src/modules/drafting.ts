/*
 * What Alcove asks the notes model, and how its replies are checked before anything is kept:
 * writing a call's notes from its transcript, answering a question about a call (finished or still
 * going), and catching someone up during a call. Each sends the transcript to NEAR AI Cloud through
 * inference.ts and accepts only the JSON shapes below; anything else is refused (docs:
 * notes-and-inference › Prompts).
 */
import { firstName, type ActionItem, type AnswerPart, type CatchUp, type CatchUpItem, type Chapter, type Decision, type InferenceEvidence, type NoteKind, type Person, type Question, type Speaker, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Config } from '../config';
import { id128 } from '../crypto';
import { UnavailableError } from '../errors';
import { complete, completeJson } from '../inference';
import type { NoteManifest } from './notes';

/** What the notes model writes into a note, and the verified model that wrote it. */
export interface Written { summary: string; decisions: Decision[]; questions: Question[]; actions: ActionItem[]; chapters: Chapter[]; suggestedQuestions: string[]; evidence: InferenceEvidence }

/** What the model is told about a meeting: who it's with, how long it's been, and what was said. */
export interface Brief {
  title: string;
  kind: NoteKind;
  organizer: Person;
  /** Everyone invited besides the organizer. */
  people: Person[];
  seconds: number;
  lines: TranscriptLine[];
  /** The written summary, for questions after the notes are written. */
  summary?: string | undefined;
  /** The meeting is still going on. */
  live?: boolean | undefined;
}
/** A finished note, as the model reads it. */
export const briefOf = (m: NoteManifest, organizer: Person, people: Person[]): Brief =>
  ({ title: m.title, kind: m.kind, organizer, people, seconds: m.duration, lines: m.transcript ?? [], summary: m.summary });

/** About 30,000 tokens of transcript; longer calls keep their beginning and end. */
const MAX_TRANSCRIPT_CHARS = 120_000;

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The transcript as the model reads it: "[mm:ss] Name: words", or "[mm:ss] words" when nobody can tell who spoke. */
function transcriptText(lines: TranscriptLine[]): string {
  const all = lines.map((l) => `[${mmss(l.at)}] ${l.speaker ? `${l.speaker.name}: ` : ''}${l.text}`);
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
{"summary": string, "decisions": [{"text": string, "at": number}], "questions": [{"text": string, "at": number}], "actions": [{"text": string, "owner": string | null, "due": string | null, "at": number}], "chapters": [{"at": number, "title": string, "summary": string}], "suggestedQuestions": [string]}

summary: two to four plain sentences on what the meeting was about and where it landed. Start with the substance, not "The meeting" or "In this call".
decisions: what the people agreed or settled, one short sentence each, with the second it was settled. An empty list if nothing was decided; something only suggested is not a decision.
questions: what someone asked that the meeting didn't answer or settle by its end, one short question each, with the second it was asked. An empty list if every question was answered.
actions: what someone said they, or someone else, would do. text starts with a verb, like "Send the new screens". owner is that person's name as the transcript gives it, or null if it doesn't say. due is when, as it was said ("Wednesday", "end of March"), or null. at is the second it came up.
Every at is read from the transcript's [mm:ss] marks.
chapters: the parts of the meeting in order, two to six of them (one for a short meeting). at is the second the part starts, read from the transcript's [mm:ss] marks. title is two to five words; summary is one short sentence.
suggestedQuestions: three short questions someone might ask about this meeting afterwards.

Write in the language of the transcript. Use only what the transcript says: never invent names, numbers, dates or decisions. Lines without a name come from a recording in a room, where nobody can tell who spoke.`;

/** A second the model points at, if it gave one. */
const At = z.coerce.number().nullish().catch(null);
const Draft = z.object({
  summary: z.string().min(1),
  decisions: z.array(z.union([z.string().transform((text) => ({ text, at: null })), z.object({ text: z.string(), at: At })])).catch([]),
  questions: z.array(z.union([z.string().transform((text) => ({ text, at: null })), z.object({ text: z.string(), at: At })])).catch([]),
  actions: z.array(z.object({ text: z.string(), owner: z.string().nullish().catch(null), due: z.string().nullish().catch(null), at: At })).catch([]),
  chapters: z.array(z.object({ at: z.coerce.number(), title: z.string(), summary: z.string().catch('') })).catch([]),
  suggestedQuestions: z.array(z.string()).catch([])
});

/** Words that mean "nobody in particular" when the model gives them as an owner. */
const NOBODY = new Set(['', 'unknown', 'unassigned', 'none', 'n/a', 'someone', 'somebody', 'everyone', 'team', 'the team', 'all', 'null']);

/** Writes a note's summary, decisions, open questions, follow-ups, chapters and suggested questions from its transcript. */
export async function draft(cfg: Config, b: Brief): Promise<Written> {
  const { json, evidence } = await complete(cfg, [
    { role: 'system', content: NOTES_PROMPT },
    { role: 'user', content: `${about(b)}\n\nTranscript:\n${transcriptText(b.lines)}` }
  ], { what: 'notes', maxTokens: 2500 });
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
    .map((c) => ({ at: Math.round(Math.min(Math.max(0, c.at), last)), title: clip(c.title.trim(), 60), summary: clip(c.summary.trim(), 160) }))
    .sort((a, b) => a.at - b.at)
    .filter((c, i, all) => i === 0 || c.at !== all[i - 1]?.at)
    .slice(0, 8);
  const when = moment(b);
  const said = (s: number | null | undefined) => { const m = s === null || s === undefined ? undefined : when(s); return m === undefined ? {} : { at: m }; };
  return {
    summary: clip(d.summary.trim(), 1500),
    // What the notes heard is only proposed: people who have the notes confirm it, or say it wasn't decided.
    decisions: d.decisions.filter((x) => x.text.trim()).slice(0, 12).map((x): Decision => ({ id: id128(), text: clip(x.text.trim(), 300), ...said(x.at), state: 'proposed', changes: [] })),
    // Open until someone who has the notes says it was answered, here or in a later call.
    questions: d.questions.filter((x) => x.text.trim()).slice(0, 12).map((x): Question => ({ id: id128(), text: clip(x.text.trim(), 300), ...said(x.at), state: 'open', changes: [] })),
    actions: d.actions.filter((a) => a.text.trim()).slice(0, 20).map((a): ActionItem => {
      const who = owner(a.owner);
      const due = a.due?.trim();
      return { id: id128(), text: clip(a.text.trim(), 300), ...(who ? { owner: who } : {}), takenOn: false, ...(due ? { due: clip(due, 40) } : {}), ...said(a.at), done: false, changes: [] };
    }),
    chapters,
    suggestedQuestions: d.suggestedQuestions.map((q) => clip(q.trim(), 120)).filter(Boolean).slice(0, 3),
    evidence
  };
}

const ASK_PROMPT = `You answer a question about one meeting, using only its transcript and notes. Reply with a single JSON object and nothing else: {"answer": string, "moments": [number]}

answer: plain and direct, at most four sentences, unless the question asks for a draft such as an email or a list, which can be longer. "I", "me" and "my" in the question mean the person asking. If the meeting is still going on, answer from what has been said so far. If the transcript doesn't cover it, say so plainly.
moments: the seconds the answer comes from, read from the transcript's [mm:ss] marks; at most four, in order. An empty list if there are none.`;

const Answer = z.object({ answer: z.string().min(1), moments: z.array(z.coerce.number()).catch([]) });

/** Answers a question about a call, written up or still going, with the moments in the recording it comes from. */
export async function answer(cfg: Config, b: Brief, asker: Person, question: string): Promise<AnswerPart[]> {
  const reply = Answer.safeParse(await completeJson(cfg, [
    { role: 'system', content: ASK_PROMPT },
    { role: 'user', content: `${about(b)}\n\nSummary: ${b.summary || '(none)'}\n\nTranscript:\n${transcriptText(b.lines)}\n\nAsked by: ${called(asker)}\nQuestion: ${question}` }
  ], { what: b.live ? 'ask-live' : 'ask', maxTokens: 1200, timeoutMs: 60_000 }));
  if (!reply.success) throw new UnavailableError('The answer came back in the wrong shape. Try asking again.', { context: { what: 'ask', issues: issues(reply.error) } });
  const at = moment(b);
  const moments = [...new Set(reply.data.moments.flatMap((s) => { const m = at(s); return m === undefined ? [] : [m]; }))].sort((x, y) => x - y).slice(0, 4);
  return [{ type: 'text', text: reply.data.answer.trim() }, ...moments.map((m): AnswerPart => ({ type: 'cite', at: m }))];
}

const CATCH_UP_PROMPT = `You help someone catch up on a meeting that is still going on, from its transcript so far. Reply with a single JSON object and nothing else, in this shape:
{"summary": string, "decided": [{"text": string, "at": number}], "proposed": [{"text": string, "at": number}], "open": [{"text": string, "at": number}], "next": [{"text": string, "owner": string | null, "due": string | null, "at": number}]}

summary: one or two plain sentences on where the conversation is now.
decided: what the people agreed or settled.
proposed: what someone suggested that hasn't been agreed yet. Something only suggested is never decided.
open: questions that were asked and haven't been answered yet.
next: what someone said they, or someone else, would do. owner is that person's name as the transcript gives it, or null if it doesn't say; due is when, as it was said ("Friday"), or null.
Each item is one short sentence, and at is the second it was said, read from the transcript's [mm:ss] marks. Use an empty list when there's nothing. Write in the language of the transcript, and use only what it says: never invent names, numbers or decisions.`;

const Items = z.array(z.object({
  text: z.string(), at: z.coerce.number().nullish().catch(null), owner: z.string().nullish().catch(null), due: z.string().nullish().catch(null)
})).catch([]);
const CatchUpReply = z.object({ summary: z.string().catch(''), decided: Items, proposed: Items, open: Items, next: Items });
type Sorted = Pick<CatchUp, 'summary' | 'decided' | 'proposed' | 'open' | 'next'>;

/** Where a call in progress has got to, sorted into decided, proposed, still open, and what's next. */
export async function catchUp(cfg: Config, b: Brief): Promise<Sorted> {
  const reply = CatchUpReply.safeParse(await completeJson(cfg, [
    { role: 'system', content: CATCH_UP_PROMPT },
    { role: 'user', content: `${about({ ...b, live: true })}\n\nTranscript so far:\n${transcriptText(b.lines)}` }
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
