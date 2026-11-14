/*
 * An eval case as `draft` takes it: the people as Persons, the transcript as TranscriptLines (L1, L2... in order),
 * and the paused stretches as CaptureGaps. Everyone gets a made-up vandelay.example address.
 */
import type { CaptureGap, Person, TranscriptLine } from '@alcove/api';
import type { Brief } from '../writing/brief';
import type { NotesStyle } from '../writing/drafting';
import type { EvalCase } from './cases';

/** When every eval call started, so gaps have real times. */
const STARTED = Date.parse('2026-11-02T15:00:00Z');

/** Seconds from a "mm:ss" mark. */
export function seconds(mark: string): number {
  const m = /^(\d+):(\d\d)$/.exec(mark);
  if (!m) throw new Error(`"${mark}" isn't mm:ss`);
  return Number(m[1] ?? '0') * 60 + Number(m[2] ?? '0');
}

const address = (name: string) => `${name.normalize('NFD').replace(/[^A-Za-z ]/g, '').trim().toLowerCase().replace(/\s+/g, '.')}@vandelay.example`;
const person = (name: string): Person => ({ id: address(name), name, email: address(name) });

export const peopleOf = (c: EvalCase): { organizer: Person; invited: Person[] } => ({ organizer: person(c.organizer), invited: c.invited.map(person) });

const LINE = /^\[(\d+:\d\d)\] (.*)$/;
const UNCLEAR = / \(unclear\)$/;

/** The case's transcript as lines. In a call every line must start with someone's name; in a room none does. */
export function linesOf(c: EvalCase): TranscriptLine[] {
  const { organizer, invited } = peopleOf(c);
  const everyone = [organizer, ...invited];
  return c.transcript.trim().split('\n').map((raw, i): TranscriptLine => {
    const m = LINE.exec(raw.trim());
    if (!m) throw new Error(`${c.id}: line ${i + 1} doesn't start with [mm:ss]`);
    const said = m[2] ?? '';
    const unclear = UNCLEAR.test(said);
    const rest = said.replace(UNCLEAR, '');
    const who = c.kind === 'call' ? everyone.find((p) => rest.startsWith(`${p.name}: `)) : undefined;
    if (c.kind === 'call' && !who) throw new Error(`${c.id}: line ${i + 1} doesn't start with someone in the call`);
    return {
      id: `L${i + 1}`,
      at: seconds(m[1] ?? ''),
      text: who ? rest.slice(who.name.length + 2) : rest,
      ...(who ? { speaker: { name: who.name, person: who } } : {}),
      ...(unclear ? { unsure: { words: true } } : {})
    };
  });
}

/** The index of the line said at `mark`, which every expected item's `at` must name. */
export function lineAt(lines: TranscriptLine[], mark: string): number {
  return lines.findIndex((l) => l.at === seconds(mark));
}

export function briefOf(c: EvalCase): Brief {
  const { organizer, invited } = peopleOf(c);
  const lines = linesOf(c);
  const gaps = c.gaps.map((g): CaptureGap => {
    const at = seconds(g.at);
    return { kind: g.kind, at, from: new Date(STARTED + at * 1000).toISOString(), to: new Date(STARTED + at * 1000 + g.minutes * 60_000).toISOString() };
  });
  return { title: c.title, kind: c.kind, organizer, people: invited, seconds: (lines.at(-1)?.at ?? 0) + 10, lines, gaps };
}

export const styleOf = (c: EvalCase): NotesStyle => ({ language: c.language });

/**
 * What's wrong with a case before any money is spent on it: an expected item at a time no line has, or an owner
 * who isn't in the call.
 */
export function problemsIn(c: EvalCase): string[] {
  let lines: TranscriptLine[];
  try { lines = linesOf(c); } catch (e) { return [e instanceof Error ? e.message : String(e)]; }
  const { organizer, invited } = peopleOf(c);
  const names = new Set([organizer, ...invited].map((p) => p.name));
  const items = [...c.expect.decisions, ...c.expect.questions, ...c.expect.actions];
  return [
    ...items.filter((x) => lineAt(lines, x.at) < 0).map((x) => `${c.id}: no line at ${x.at} for "${x.what}"`),
    ...c.expect.actions.filter((a) => a.owner !== null && !names.has(a.owner)).map((a) => `${c.id}: ${a.owner ?? ''} isn't in the call`)
  ];
}
