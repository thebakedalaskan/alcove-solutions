/*
 * Scoring one run's notes against its case, summing runs up with a mean and a 95% confidence interval, and pairing two
 * evals case by case.
 *
 * A run gets two things, kept apart:
 *  - quality, from 0 to 1: F1 of the expected items the notes found (recall) against how much of what they listed is
 *    expected or acceptable (precision). F1 stays low unless both are high, so notes can't score well by listing little.
 *  - violations: a `never` item stated, or the wrong language. Those are the mistakes that make notes untrustworthy, so
 *    they're counted run by run as a gate a change mustn't fail, not averaged into quality where they'd swamp it.
 * Owners, due dates and line citations are reported beside quality, each over the expected items the notes found.
 *
 * Counting a note item:
 *  - in its expected item's own list (an expected decision written as a decision; a follow-up marked `alsoAs` may also
 *    be written as an open question), or an acceptable extra: correct;
 *    each part of an expected item the notes split up counts, and the item counts as found once;
 *  - a repeat of an earlier item (the judge's `same_as`): an extra, unless it's in its expected item's own list and the
 *    earlier one isn't: then it counts, and the earlier one is the item in the wrong list;
 *  - in the wrong list: an extra if the right list has that item too (taking on a task is a follow-up, so the same task
 *    again as a decision is invented); otherwise only a miss, no worse than leaving it out;
 *  - anything else: invented.
 */
import { z } from 'zod';
import type { EvalCase } from './cases';
import { expectedOf, type ExpectedItem, type Kind, type NoteItem, type Verdict } from './judge';

export interface RunScore {
  quality: number;
  recall: number;
  precision: number;
  owners: number | null;
  dues: number | null;
  cites: number | null;
  /** What went wrong, in words, for the report. */
  violations: string[];
  missed: string[];
  invented: string[];
  wrongList: string[];
  repeated: string[];
  ownerErrors: string[];
  dueErrors: string[];
  citeErrors: string[];
}

const KIND_NAMES: Record<Kind, string> = { decision: 'a decision', question: 'an open question', action: 'a follow-up' };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const rate = (ok: number, of: number): number | null => (of ? ok / of : null);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const inOwnList = (e: ExpectedItem, item: NoteItem) => item.kind === e.kind || item.kind === e.alsoAs;

export function scoreRun(c: EvalCase, items: NoteItem[], verdict: Verdict, lineOf: (mark: string) => number): RunScore {
  const expected = expectedOf(c);
  /** Each expected item the notes found in its own list, by the first note item that states it. */
  const matched = new Map<string, NoteItem>();
  const astray: { e: ExpectedItem; item: NoteItem }[] = [];
  const invented: string[] = [];
  const repeated: string[] = [];
  let correct = 0;
  for (const item of items) {
    const v = verdict.items.find((x) => x.id === item.id);
    const label = v?.match ?? null;
    const e = label ? expected.find((x) => x.id === label) : undefined;
    const extra = label && /^A\d+$/.test(label) ? c.expect.acceptable[Number(label.slice(1)) - 1] : undefined;
    // Decisions are labelled before follow-ups, so a task written as a decision and again as a follow-up has the
    // follow-up called the repeat. The one in its own list is the one that counts; the other is the extra.
    const earlier = v?.same_as ? items.find((x) => x.id === v.same_as) : undefined;
    const ownListOverWrong = e !== undefined && inOwnList(e, item) && earlier !== undefined && !inOwnList(e, earlier);
    if (v?.same_as && !ownListOverWrong) repeated.push(`${item.kind}: "${item.text}" repeats ${v.same_as}`);
    else if (e && !inOwnList(e, item)) astray.push({ e, item });
    else if (e) { if (!matched.has(e.id)) matched.set(e.id, item); correct++; }
    else if (extra !== undefined) correct++;
    else invented.push(`${item.kind}: "${item.text}"`);
  }
  const wrongList = astray.map(({ e, item }) => `"${e.what}" written as ${KIND_NAMES[item.kind]}, not ${KIND_NAMES[e.kind]}${matched.has(e.id) ? ', as well as rightly (counted as invented)' : ''}`);
  const onlyMisses = astray.filter(({ e }) => !matched.has(e.id)).length;
  const missed = expected.filter((e) => !matched.has(e.id) && !astray.some((a) => a.e.id === e.id)).map((e) => `${e.kind}: "${e.what}"`);

  const actions = expected.filter((e) => e.kind === 'action' && matched.has(e.id));
  const ownerErrors = actions.flatMap((e) => {
    const got = matched.get(e.id)?.owner ?? null;
    const ok = e.owner === null ? got === null : got !== null && same(got, e.owner);
    return ok ? [] : [`"${e.what}": owner ${got ?? 'none'}, expected ${e.owner ?? 'none'}`];
  });
  const dueErrors = actions.flatMap((e) => {
    const item = matched.get(e.id);
    // An expected "none" is right only with no due date, which needs no judge; whether two dates agree is the judge's.
    const ok = e.due === null ? (item?.due ?? null) === null : verdict.items.find((x) => x.id === item?.id)?.due_ok === true;
    return ok ? [] : [`"${e.what}": due ${item?.due ?? 'none'}, expected ${e.due ?? 'none'}`];
  });
  const citeErrors = expected.filter((e) => matched.has(e.id)).flatMap((e) => {
    const first = matched.get(e.id)?.lines[0];
    const want = lineOf(e.at);
    return first !== undefined && Math.abs(first - want) <= 1 ? [] : [`"${e.what}": cites ${first === undefined ? 'no line' : `L${first + 1}`}, said at L${want + 1}`];
  });
  const violations = [
    ...verdict.never.filter((n) => n.violated).map((n) => {
      const what = c.expect.never[Number(n.id.slice(1)) - 1] ?? n.id;
      return `${what}${n.where ? ` (in ${n.where})` : ''}`;
    }),
    ...(verdict.language_ok ? [] : ['written in the wrong language'])
  ];

  const recall = expected.length ? matched.size / expected.length : 1;
  const counted = items.length - onlyMisses;
  const precision = counted ? correct / counted : 1;
  const quality = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  return {
    quality, recall, precision,
    owners: rate(actions.length - ownerErrors.length, actions.length),
    dues: rate(actions.length - dueErrors.length, actions.length),
    cites: rate(matched.size - citeErrors.length, matched.size),
    violations, missed, invented, wrongList, repeated, ownerErrors, dueErrors, citeErrors
  };
}

/** Student's t at 95%, two-sided, for 1 to 30 degrees of freedom; past that, the normal's 1.96. */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/**
 * The mean of some numbers and a 95% confidence interval for it (Student's t). With one number there is no interval.
 * The interval is how far the mean could plausibly move if the same runs were done again.
 */
export interface Summary { n: number; mean: number; low: number | null; high: number | null }
export function interval(xs: number[]): Summary {
  const n = xs.length;
  if (n === 0) return { n, mean: 0, low: null, high: null };
  const m = mean(xs);
  if (n === 1) return { n, mean: m, low: null, high: null };
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
  const half = (T95[n - 2] ?? 1.96) * sd / Math.sqrt(n);
  return { n, mean: m, low: m - half, high: m + half };
}
/** The middle of some numbers (between the two middle ones for an even count), or null for none. */
export function median(xs: number[]): number | null {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid];
  if (hi === undefined) return null;
  const lo = s.length % 2 ? hi : s[mid - 1] ?? hi;
  return (lo + hi) / 2;
}
/** `interval` for scores, which can't leave 0–1. */
export function summarise(xs: number[]): Summary {
  const s = interval(xs);
  return { ...s, low: s.low === null ? null : Math.max(0, s.low), high: s.high === null ? null : Math.min(1, s.high) };
}

/**
 * What became of a run: scored; an unusable reply (the notes model answered, but its reply couldn't be read as notes:
 * the model's failure, counted as a rate); not run (the notes service failed every try: the plumbing's, left out); or not
 * judged (the notes were written, but no usable verdict came back, or it came from another model: left out).
 */
export const Outcome = z.enum(['scored', 'unusable', 'not-run', 'not-judged']);
export type Outcome = z.infer<typeof Outcome>;

/** One run as summary.json keeps it, and as the comparison reads it back. */
export const RunRow = z.object({
  case: z.string(),
  run: z.number(),
  outcome: Outcome,
  quality: z.number().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  owners: z.number().nullable(),
  dues: z.number().nullable(),
  cites: z.number().nullable(),
  violations: z.number().nullable(),
  /** Tries at the notes model, the last one included. */
  attempts: z.number(),
  /** How long the try that wrote the notes took, and its output tokens. */
  notesMs: z.number().nullable(),
  notesOutputTokens: z.number().nullable()
});
export type RunRow = z.infer<typeof RunRow>;

/** A case's value of something per run, as a mean over the runs that have it: null when none do. */
export type Metric = (rows: RunRow[]) => number | null;
const meanOrNull = (xs: number[]) => (xs.length ? mean(xs) : null);
const numbers = (xs: (number | null)[]) => xs.flatMap((x) => (x === null ? [] : [x]));
export const score = (pick: (r: RunRow) => number | null): Metric => (rows) => meanOrNull(numbers(rows.filter((r) => r.outcome === 'scored').map(pick)));
/** The share of judged runs that broke the case's `never` list or came back in the wrong language. */
export const violationRate: Metric = (rows) => meanOrNull(numbers(rows.filter((r) => r.outcome === 'scored').map((r) => (r.violations === null ? null : r.violations > 0 ? 1 : 0))));
/** The share of the runs that reached the notes model whose reply couldn't be used. */
export const unusableRate: Metric = (rows) => meanOrNull(rows.filter((r) => r.outcome !== 'not-run').map((r) => (r.outcome === 'unusable' ? 1 : 0)));

/**
 * Two evals of the same cases, paired: each case's value in B minus its value in A, then the mean of those differences
 * and its 95% confidence interval. Pairing takes out how hard each case is, which differs a lot by design, so this sees
 * a change the overall intervals, taken across cases, can't.
 */
export interface Paired { a: number; b: number; diff: Summary }
export function paired(a: RunRow[], b: RunRow[], metric: Metric): Paired | null {
  const cases = [...new Set(a.map((r) => r.case))].filter((id) => b.some((r) => r.case === id));
  const pairs = cases.flatMap((id) => {
    const x = metric(a.filter((r) => r.case === id));
    const y = metric(b.filter((r) => r.case === id));
    return x === null || y === null ? [] : [{ x, y }];
  });
  if (!pairs.length) return null;
  return { a: mean(pairs.map((p) => p.x)), b: mean(pairs.map((p) => p.y)), diff: interval(pairs.map((p) => p.y - p.x)) };
}
