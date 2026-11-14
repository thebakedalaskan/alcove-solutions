/*
 * Searching and asking, simply: what a search of your notes finds, as the API finds it, and the answers the stand-in writes
 * about one note or across them, a few words at a time, with where they come from. It doesn't rank as the API does: it's
 * enough for the pages to show what they show.
 */
import { AlcoveApiError, searchOf, termsIn, termsSaid, type AnswerPart, type Note, type NoteFound, type NoteKind, type NoteSaid, type TranscriptLine } from '@alcove/api';
import { foundOf } from '../../world/build';
import type { World } from '../../world/world';
import { me, nextId } from '../state';

/**
 * A question about your notes is paid from your own notes (apps/api/src/features/billing/meter/meter.ts): once this period's have
 * run out, the server refuses it before anything is written, in its own words.
 */
export function mayAsk(w: World): void {
  if (w.plan.notes.stopped || w.plan.notes.minutesLeft <= 0) {
    throw new AlcoveApiError('plan-limit', 'Your notes for this period have run out. They start again when your plan renews.', { requestId: nextId('sb-req') });
  }
}

/** Lines of what was said a found note shows, at most, as the API has it. */
const SAID_SHOWN = 10;
/** Everything said in a note: the main room, then each breakout room's lines, which say which room. */
const saidIn = (n: Note): TranscriptLine[] => [...(n.transcript ?? []), ...n.rooms.flatMap((r) => r.transcript.map((l) => ({ ...l, room: { id: r.id, name: r.name } })))];
/** What a line became in its part of the call: what a decision that isn't rejected rests on, or else a follow-up. */
function madeOf(n: Note, line: TranscriptLine): NoteSaid['made'] {
  const part = line.room ? n.rooms.find((r) => r.id === line.room?.id) : n;
  if (part?.decisions.some((d) => d.state !== 'rejected' && d.lines.includes(line.id))) return 'decision';
  return part?.actions.some((a) => a.lines.includes(line.id)) ? 'follow-up' : undefined;
}

/**
 * What a search finds, as the API finds it: a note has a word in its title, summary, decisions, follow-ups or anything
 * said, or when the word starts a name of someone who spoke in it. With `by` (an address) only their lines count.
 */
export function found(w: World, kind: NoteKind | undefined, text: string | undefined, by: string | undefined): NoteFound[] {
  const notes = w.notes.filter((n) => !kind || n.kind === kind);
  const { terms, question } = searchOf(text ?? '');
  const whose = by?.trim().toLowerCase();
  if (!terms.length && !whose) return notes.map(foundOf);
  return notes.flatMap((n) => {
    const all = saidIn(n);
    const lines = whose ? all.filter((l) => l.speaker?.person?.email.toLowerCase() === whose) : all;
    if (whose && !lines.length) return [];
    const words = whose ? '' : [n.title, n.excerpt, n.summary, ...[n, ...n.rooms].flatMap((p) => [...p.decisions, ...p.actions].map((e) => e.text))].join(' ');
    const has = terms.filter((t) => termsIn(words, [t]) || lines.some((l) => termsSaid(l, [t]))).length;
    if (terms.length && (question ? has === 0 : has < terms.length)) return [];
    const matched = lines.flatMap((line) => { const k = terms.length ? termsSaid(line, terms) : 1; return k ? [{ line, k }] : []; });
    const said = matched.sort((a, b) => b.k - a.k || a.line.at - b.line.at).slice(0, SAID_SHOWN).map(({ line }): NoteSaid => {
      const made = madeOf(n, line);
      return { id: line.id, at: line.at, text: line.text, ...(line.speaker ? { speaker: line.speaker } : {}), ...(line.room ? { room: line.room } : {}), ...(made ? { made } : {}) };
    });
    return [{ ...foundOf(n), said, saidCount: matched.length }];
  });
}

/** An answer about one note: what it decided, what's yours, a follow-up to send, or what was said about it. */
export function answerAbout(n: Note, question: string): AnswerPart[] {
  const q = question.toLowerCase();
  const cite = (at: number | undefined): AnswerPart[] => (at === undefined ? [] : [{ type: 'cite', noteId: n.id, at }]);
  if (/decid/.test(q)) {
    const ds = n.decisions.filter((d) => d.state !== 'rejected');
    if (!ds.length) return [{ type: 'text', text: 'Nothing was decided in this call.' }];
    return [{ type: 'text', text: ds.map((d) => `${d.text}${d.state === 'proposed' ? ' Nobody has confirmed it yet.' : ''}`).join(' ') }, ...ds.flatMap((d) => cite(d.at))];
  }
  if (/\b(i|me|my)\b.*\b(do|need)|what do i/.test(q)) {
    const mine = n.actions.filter((a) => a.owner?.person?.email === me().email && !a.done);
    if (!mine.length) return [{ type: 'text', text: 'Nothing from this call is yours to do.' }];
    return [{ type: 'text', text: mine.map((a) => `${a.text}${a.due ? `, ${a.due.toLowerCase()}` : ''}.`).join(' ') }, ...mine.flatMap((a) => cite(a.at))];
  }
  if (/draft|follow-up|follow up/.test(q)) {
    const open = n.actions.filter((a) => !a.done).map((a) => `${a.owner?.name.split(' ')[0] ?? 'Someone'}: ${a.text.toLowerCase()}${a.due ? ` by ${a.due}` : ''}.`);
    return [{ type: 'text', text: `Thanks, all. ${n.summary} ${open.join(' ')}`.trim() }, ...n.decisions.flatMap((d) => cite(d.at))];
  }
  const { terms } = searchOf(question);
  const lines = (n.transcript ?? []).filter((l) => termsIn(l.text, terms) > 0).slice(0, 3);
  if (!lines.length) return [{ type: 'text', text: `The call didn’t get to that. ${n.excerpt}` }];
  return [{ type: 'text', text: lines.map((l) => `${l.speaker ? `${l.speaker.name.split(' ')[0]} said: ` : ''}“${l.text}”`).join(' ') }, ...lines.flatMap((l) => cite(l.at))];
}

/** An answer across every note: what the notes that match say, citing where. */
export function answerAcross(w: World, question: string): AnswerPart[] {
  const hits = found(w, undefined, question, undefined).filter((n) => n.status === 'ready');
  if (!w.notes.some((n) => n.status === 'ready')) return [{ type: 'text', text: 'There are no written notes to answer from yet.' }];
  if (!hits.length) return [{ type: 'text', text: 'None of your notes say anything about that.' }];
  const top = hits.slice(0, 3);
  return [
    { type: 'text', text: top.map((n) => `${n.title}: ${n.excerpt}`).join(' ') },
    ...top.flatMap((n): AnswerPart[] => (n.said.length ? n.said.slice(0, 2).map((l): AnswerPart => ({ type: 'cite', noteId: n.id, at: l.at })) : [{ type: 'cite', noteId: n.id, at: 0 }]))
  ];
}
/** Text arrives a few words at a time, as the model writes it; the cites come after. */
export function asWritten(parts: AnswerPart[]): AnswerPart[] {
  return parts.flatMap((p) => (p.type !== 'text' ? [p] : (p.text.match(/\S+\s*/g) ?? [p.text]).reduce<string[][]>((out, word, i) => {
    if (i % 4 === 0) out.push([]);
    out.at(-1)?.push(word);
    return out;
  }, []).map((ws): AnswerPart => ({ type: 'text', text: ws.join('') }))));
}
