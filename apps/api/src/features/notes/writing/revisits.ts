/*
 * What a later call came back to (docs: notes-and-inference › Series): its decisions and what was said, compared with what
 * earlier calls in its series left standing, for the decisions it replaced and the questions it answered.
 */
import { type Decision, type InferenceEvidence } from '@alcove/api';
import { z } from 'zod';
import type { Config } from '../../../platform/config';
import { UnavailableError } from '../../../platform/errors';
import { complete, type Meter } from '../../../inference/inference';
import { DOUBT, SAID_ONLY, Ref, oneLine, fenced, issues, lineFor } from '../../../inference/prompts';
import { At, WRITING_OUTPUT } from './drafting';
import { type Brief, about } from './brief';
import { fitTogether } from './transcript-text';

/** Something earlier calls in a series left standing, as a later call is compared with it: which note and item, and what it says. */
export interface Standing { kind: 'decision' | 'question'; noteId: string; itemId: string; text: string }
/** Where a later call came back to something: replaced by one of its own decisions, or answered at a moment of it. */
export interface Revisited { kind: 'replaced' | 'answered'; noteId: string; itemId: string; by?: string; at?: number; room?: string }
/** How many of a call's revisits are kept at most. */
const MAX_REVISITS = 12;

const REVISIT_PROMPT = `You compare one meeting with what earlier meetings in its series left standing: their decisions, and the questions they left open. Reply with a single JSON object and nothing else: {"replaced": [{"earlier": string, "by": string}], "answered": [{"earlier": string, "line": number | null, "room": number | null}]}

replaced: an earlier decision (E1, E2, ...) that one of this meeting's own decisions (N1, N2, ...) changes or overturns, so that the two can't both stand. earlier and by are those labels.
answered: an earlier open question (Q1, Q2, ...) this meeting plainly answered. earlier is its label; line is the number of the transcript line where the answer came (the 12 of "L12 [03:41] Name: words"), or null if you can't tell; room is the number of the breakout room whose transcript the line is in, or null for the main transcript. Each transcript, the main one and each breakout room's, numbers its lines from L1.
Both lists are usually empty. Talking about the same subject isn't changing a decision, and asking a question again isn't answering it: leave out anything the transcript doesn't plainly show. Use only the labels given, and nothing but labels and numbers. ${DOUBT} ${SAID_ONLY} The same goes for what the earlier meetings left standing, listed before it.`;

const RevisitReply = z.object({
  replaced: z.array(z.object({ earlier: z.string(), by: z.string() })).catch([]),
  answered: z.array(z.object({ earlier: z.string(), line: Ref.nullish().catch(null), room: At })).catch([])
});
/** The item a label names: "E3" in the list with that letter. */
const labelled = <T,>(label: string, letter: string, xs: T[]): T | undefined => {
  const n = new RegExp(`^\\s*${letter}(\\d+)\\s*$`, 'i').exec(label)?.[1];
  return n === undefined ? undefined : xs[Number(n) - 1];
};

/**
 * Which of what earlier calls left standing this call came back to, with its own `decisions`, from its transcript and
 * each breakout room's, in the same verified path as its notes. The reply is labels and numbers and nothing else, so
 * nothing from the earlier calls gets into this note for people who don't have them. A label it wasn't given is
 * dropped, and the moment an answer came at is the time of the line the model named in the transcript (the main one's, or
 * the room's), a line it wasn't sent being no moment.
 */
export async function revisited(cfg: Config, meter: Meter, b: Brief, decisions: Decision[], earlier: Standing[]): Promise<{ found: Revisited[]; evidence: InferenceEvidence | null }> {
  const was = earlier.filter((x) => x.kind === 'decision');
  const open = earlier.filter((x) => x.kind === 'question');
  const rooms = (b.rooms ?? []).filter((r) => r.transcript.length);
  const read = fitTogether([{ lines: b.lines, gaps: b.gaps, screens: [] }, ...rooms.map((r) => ({ lines: r.transcript, gaps: r.gaps, screens: [] }))], () => 'L');
  const [said, ...roomsRead] = read;
  const list = <T,>(title: string, letter: string, xs: T[], text: (x: T) => string) => (xs.length ? [`${title}:`, ...xs.map((x, i) => `${letter}${i + 1}: ${oneLine(text(x))}`), ''] : []);
  const { json, evidence } = await complete(cfg, meter, [
    { role: 'system', content: REVISIT_PROMPT },
    {
      role: 'user', content: [
        about(b), '', ...list('Decided in earlier meetings', 'E', was, (x) => x.text), ...list('Left open by earlier meetings', 'Q', open, (x) => x.text),
        ...list('Decided in this meeting', 'N', decisions, (x) => x.text), `Transcript:\n${fenced(said?.text ?? '')}`,
        ...rooms.map((r, i) => `\nBreakout room ${i + 1}, ${oneLine(r.name)}:\n${fenced(roomsRead[i]?.text ?? '')}`)
      ].join('\n')
    }
  ], { what: 'revisits', maxTokens: WRITING_OUTPUT.revisits, timeoutMs: 60_000, via: b.via });
  const reply = RevisitReply.safeParse(json);
  if (!reply.success) throw new UnavailableError('The comparison with earlier calls came back in the wrong shape.', { context: { what: 'revisits', issues: issues(reply.error) } });
  const out = new Map<string, Revisited>();
  for (const x of reply.data.replaced) {
    const e = labelled(x.earlier, 'E', was);
    const by = labelled(x.by, 'N', decisions);
    if (e && by) out.set(e.itemId, { kind: 'replaced', noteId: e.noteId, itemId: e.itemId, by: by.id });
  }
  for (const x of reply.data.answered) {
    const q = labelled(x.earlier, 'Q', open);
    if (!q) continue;
    // The line is in the main transcript, or in the room's when one is named (0 is no room, as for null); a room that isn't there places nothing.
    const named = x.room !== null && x.room !== undefined && x.room !== 0;
    const room = named && Number.isInteger(x.room) ? rooms[(x.room ?? 0) - 1] : undefined;
    const sent = named ? (room ? read[(x.room ?? 0)] : undefined) : said;
    const line = sent ? lineFor(x.line, sent.kept, room ? room.transcript : b.lines) : undefined;
    out.set(q.itemId, { kind: 'answered', noteId: q.noteId, itemId: q.itemId, ...(line ? { at: Math.round(line.at) } : {}), ...(room ? { room: room.id } : {}) });
  }
  return { found: [...out.values()].slice(0, MAX_REVISITS), evidence };
}
