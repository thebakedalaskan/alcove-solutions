/*
 * What Alcove asks the notes model, and how its replies are checked before anything is kept:
 * writing a call's notes from its transcript, and answering a question about a call. Both send the
 * transcript to NEAR AI Cloud through inference.ts and accept only the JSON shapes below; anything
 * else is refused and tried again (docs: notes-and-inference › Prompts).
 */
import { firstName, type ActionItem, type AnswerPart, type Chapter, type Person, type Speaker, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Config } from '../config';
import { id128 } from '../crypto';
import { UnavailableError } from '../errors';
import { completeJson } from '../inference';
import type { NoteManifest } from './notes';

/** What the notes model writes into a note. */
export interface Written { summary: string; decisions: string[]; actions: ActionItem[]; chapters: Chapter[]; suggestedQuestions: string[] }

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

function about(m: NoteManifest, organizer: Person, people: Person[]): string {
  const invited = people.length ? people.map(called).join(', ') : 'nobody else';
  return [
    `Meeting: ${m.title}`,
    `Kind: ${m.kind === 'room' ? 'an in-person meeting, recorded on one device in the room' : 'a video call'}`,
    `Organizer: ${organizer.name}`,
    `Invited: ${invited}`,
    `Length: ${Math.max(1, Math.round(m.duration / 60))} minutes`
  ].join('\n');
}

const NOTES_PROMPT = `You write the notes for a meeting from its transcript. Reply with a single JSON object and nothing else, in this shape:
{"summary": string, "decisions": [string], "actions": [{"text": string, "owner": string | null, "due": string | null}], "chapters": [{"at": number, "title": string, "summary": string}], "suggestedQuestions": [string]}

summary: two to four plain sentences on what the meeting was about and where it landed. Start with the substance, not "The meeting" or "In this call".
decisions: what the people agreed or settled, one short sentence each. An empty list if nothing was decided.
actions: what someone said they, or someone else, would do. text starts with a verb, like "Send the new screens". owner is that person's name as the transcript gives it, or null if it doesn't say. due is when, as it was said ("Wednesday", "end of March"), or null.
chapters: the parts of the meeting in order, two to six of them (one for a short meeting). at is the second the part starts, read from the transcript's [mm:ss] marks. title is two to five words; summary is one short sentence.
suggestedQuestions: three short questions someone might ask about this meeting afterwards.

Write in the language of the transcript. Use only what the transcript says: never invent names, numbers, dates or decisions. Lines without a name come from a recording in a room, where nobody can tell who spoke.`;

const Draft = z.object({
  summary: z.string().min(1),
  decisions: z.array(z.string()).catch([]),
  actions: z.array(z.object({ text: z.string(), owner: z.string().nullish().catch(null), due: z.string().nullish().catch(null) })).catch([]),
  chapters: z.array(z.object({ at: z.coerce.number(), title: z.string(), summary: z.string().catch('') })).catch([]),
  suggestedQuestions: z.array(z.string()).catch([])
});

/** Words that mean "nobody in particular" when the model gives them as an owner. */
const NOBODY = new Set(['', 'unknown', 'unassigned', 'none', 'n/a', 'someone', 'somebody', 'everyone', 'team', 'the team', 'all', 'null']);

/** Writes a note's summary, decisions, follow-ups, chapters and questions from its transcript. */
export async function draft(cfg: Config, m: NoteManifest, organizer: Person, people: Person[]): Promise<Written> {
  const lines = m.transcript ?? [];
  const reply = Draft.safeParse(await completeJson(cfg, [
    { role: 'system', content: NOTES_PROMPT },
    { role: 'user', content: `${about(m, organizer, people)}\n\nTranscript:\n${transcriptText(lines)}` }
  ], { what: 'notes', maxTokens: 2500 }));
  if (!reply.success) throw new UnavailableError('The notes came back in the wrong shape.', { context: { what: 'notes', issues: reply.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.code}`).join('; ') } });
  const d = reply.data;
  const everyone = [organizer, ...people];
  const owner = (name: string | null | undefined): Speaker | undefined => {
    const n = name?.trim() ?? '';
    if (NOBODY.has(fold(n))) return undefined;
    // The model knows people by what it was told they're called: a name, or the name part of an address.
    const p = everyone.find((x) => fold(x.name) === fold(n) || fold(called(x)) === fold(n))
      ?? everyone.find((x) => fold(firstName(called(x))) === fold(firstName(n)));
    // Someone known only by their address is shown by the name the call used for them.
    return p ? { name: p.name === p.email ? clip(n, 80) : p.name, person: p } : { name: clip(n, 80) };
  };
  const last = Math.max(m.duration, lines.at(-1)?.at ?? 0);
  const chapters = d.chapters
    .filter((c) => Number.isFinite(c.at) && c.title.trim())
    .map((c) => ({ at: Math.round(Math.min(Math.max(0, c.at), last)), title: clip(c.title.trim(), 60), summary: clip(c.summary.trim(), 160) }))
    .sort((a, b) => a.at - b.at)
    .filter((c, i, all) => i === 0 || c.at !== all[i - 1]?.at)
    .slice(0, 8);
  return {
    summary: clip(d.summary.trim(), 1500),
    decisions: d.decisions.map((x) => clip(x.trim(), 300)).filter(Boolean).slice(0, 12),
    actions: d.actions.filter((a) => a.text.trim()).slice(0, 20).map((a) => {
      const who = owner(a.owner);
      const due = a.due?.trim();
      return { id: id128(), text: clip(a.text.trim(), 300), ...(who ? { owner: who } : {}), ...(due ? { due: clip(due, 40) } : {}), done: false };
    }),
    chapters,
    suggestedQuestions: d.suggestedQuestions.map((q) => clip(q.trim(), 120)).filter(Boolean).slice(0, 3)
  };
}

const ASK_PROMPT = `You answer a question about one meeting, using only its transcript and notes. Reply with a single JSON object and nothing else: {"answer": string, "moments": [number]}

answer: plain and direct, at most four sentences, unless the question asks for a draft such as an email or a list, which can be longer. "I", "me" and "my" in the question mean the person asking. If the transcript doesn't cover it, say so plainly.
moments: the seconds the answer comes from, read from the transcript's [mm:ss] marks; at most four, in order. An empty list if there are none.`;

const Answer = z.object({ answer: z.string().min(1), moments: z.array(z.coerce.number()).catch([]) });

/** Answers a question about a written note, with the moments in the recording it comes from. */
export async function answer(cfg: Config, m: NoteManifest, organizer: Person, people: Person[], asker: Person, question: string): Promise<AnswerPart[]> {
  const reply = Answer.safeParse(await completeJson(cfg, [
    { role: 'system', content: ASK_PROMPT },
    { role: 'user', content: `${about(m, organizer, people)}\n\nSummary: ${m.summary || '(none)'}\n\nTranscript:\n${transcriptText(m.transcript ?? [])}\n\nAsked by: ${called(asker)}\nQuestion: ${question}` }
  ], { what: 'ask', maxTokens: 1200, timeoutMs: 60_000 }));
  if (!reply.success) throw new UnavailableError('The answer came back in the wrong shape. Try asking again.', { context: { what: 'ask', issues: reply.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.code}`).join('; ') } });
  const last = Math.max(m.duration, m.transcript?.at(-1)?.at ?? 0);
  const moments = [...new Set(reply.data.moments.filter((s) => Number.isFinite(s) && s >= 0 && s <= last + 1).map((s) => Math.round(s)))].sort((a, b) => a - b).slice(0, 4);
  return [{ type: 'text', text: reply.data.answer.trim() }, ...moments.map((at): AnswerPart => ({ type: 'cite', at }))];
}
