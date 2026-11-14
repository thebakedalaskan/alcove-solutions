/*
 * Compares two notes evals case by case: `pnpm --filter @alcove/server eval:notes:compare <A> <B>`, where A and B are
 * eval folders (a path, or a folder's name under .evals/notes). A is the one to beat, usually the baseline.
 *
 * For each measure it takes each case's value in B minus its value in A, then the mean of those differences with a 95%
 * confidence interval (score.ts, `paired`). When the interval includes 0, the eval hasn't shown a difference. To see what
 * no difference looks like, run the same setup twice and compare the two: a change has to beat that.
 *
 * When the held-back cases (heldout.ts) are among those compared, it also compares the cases in the repository and the
 * held-back ones apart: a change that helps the first and not the second fits the cases it was tuned on, not meetings.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMessage } from '@alcove/api';
import { z } from 'zod';
import { EVERY_CASE, isHeld } from './heldout';
import { median, paired, RunRow, score, unusableRate, violationRate, type Metric, type Paired } from './score';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const say = (text: string) => { process.stdout.write(text); };

/** What the comparison reads from an eval's summary.json. */
const Saved = z.object({ meta: z.record(z.string(), z.union([z.string(), z.number()])), runs: z.array(RunRow) });
type Saved = z.infer<typeof Saved>;

async function load(where: string): Promise<{ folder: string; saved: Saved }> {
  // pnpm runs this in apps/api, so a relative path is taken from where the command was typed (INIT_CWD).
  const tries = [isAbsolute(where) ? where : resolve(process.env['INIT_CWD'] ?? process.cwd(), where), join(ROOT, '.evals', 'notes', where)];
  const folder = tries.find((f) => existsSync(join(f, 'summary.json')));
  if (!folder) throw new Error(`no summary.json in ${tries.join(' or ')}`);
  const raw: unknown = JSON.parse(await readFile(join(folder, 'summary.json'), 'utf8'));
  const saved = Saved.safeParse(raw);
  if (!saved.success) throw new Error(`${folder}/summary.json isn't one this version can read (an eval from before every run was kept in it?): ${saved.error.issues[0]?.message ?? ''}`);
  return { folder, saved: saved.data };
}

const MEASURES: { name: string; metric: Metric; lowerIsBetter: boolean }[] = [
  { name: 'Quality (F1)', metric: score((r) => r.quality), lowerIsBetter: false },
  { name: 'Recall', metric: score((r) => r.recall), lowerIsBetter: false },
  { name: 'Precision', metric: score((r) => r.precision), lowerIsBetter: false },
  { name: 'Owners', metric: score((r) => r.owners), lowerIsBetter: false },
  { name: 'Dues', metric: score((r) => r.dues), lowerIsBetter: false },
  { name: 'Cites', metric: score((r) => r.cites), lowerIsBetter: false },
  { name: 'Runs with a violation', metric: violationRate, lowerIsBetter: true },
  { name: 'Unusable replies', metric: unusableRate, lowerIsBetter: true }
];

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const pts = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(x * 100).toFixed(1)}`;
const diffText = (p: Paired) => `${pts(p.diff.mean)}${p.diff.low === null || p.diff.high === null ? '' : ` [${pts(p.diff.low)}, ${pts(p.diff.high)}]`}`;
function reading(p: Paired, lowerIsBetter: boolean): string {
  const { low, high } = p.diff;
  if (low === null || high === null) return 'one case only: no interval';
  if (low <= 0 && high >= 0) return 'no difference shown';
  return (low > 0) !== lowerIsBetter ? 'better in B' : 'worse in B';
}
const caseOrder = (id: string) => { const i = EVERY_CASE.findIndex((c) => c.id === id); return i < 0 ? EVERY_CASE.length : i; };

function measures(A: RunRow[], B: RunRow[]): string[] {
  return [
    '| Measure | A | B | B − A [95% CI] | Reading |',
    '| --- | --- | --- | --- | --- |',
    ...MEASURES.map(({ name, metric, lowerIsBetter }) => {
      const p = paired(A, B, metric);
      return p ? `| ${name} | ${pct(p.a)} | ${pct(p.b)} | ${diffText(p)} | ${reading(p, lowerIsBetter)} |` : `| ${name} | – | – | – | no case has a value in both |`;
    })
  ];
}

/** The same comparison over the repository's cases and over the held-back ones, when both are there. */
function apart(A: RunRow[], B: RunRow[], both: string[]): string[] {
  const held = both.filter(isHeld);
  const open = both.filter((id) => !isHeld(id));
  if (!held.length || !open.length) return [];
  const only = (rows: RunRow[], ids: string[]) => rows.filter((r) => ids.includes(r.case));
  return [
    `### The ${open.length} cases in the repository`,
    '',
    ...measures(only(A, open), only(B, open)),
    '',
    `### The ${held.length} held-back cases`,
    '',
    ...measures(only(A, held), only(B, held)),
    '',
    'A change that does better on the first and not on the second fits the cases it was tuned on.',
    ''
  ];
}

async function main(): Promise<void> {
  const [whereA, whereB, ...rest] = process.argv.slice(2);
  if (!whereA || !whereB || rest.length) throw new Error('usage: eval:notes:compare <A> <B>  (eval folders; A is the one to beat)');
  const a = await load(whereA);
  const b = await load(whereB);
  const A = a.saved.runs;
  const B = b.saved.runs;
  const idsA = new Set(A.map((r) => r.case));
  const idsB = new Set(B.map((r) => r.case));
  const both = [...idsA].filter((id) => idsB.has(id)).sort((x, y) => caseOrder(x) - caseOrder(y));
  const onlyA = [...idsA].filter((id) => !idsB.has(id));
  const onlyB = [...idsB].filter((id) => !idsA.has(id));

  const keys = [...new Set([...Object.keys(a.saved.meta), ...Object.keys(b.saved.meta)])].filter((k) => k !== 'date' && k !== 'tokens');
  const metaA = (k: string) => String(a.saved.meta[k] ?? '–');
  const metaB = (k: string) => String(b.saved.meta[k] ?? '–');
  const warnings = [
    ...(metaA('judge model') !== metaB('judge model') || metaA('judge effort') !== metaB('judge effort') ? ['**The two were judged by different models or at different effort, so their scores can’t be compared.**'] : []),
    ...(onlyA.length || onlyB.length ? [`Only the ${both.length} cases both have are compared${onlyA.length ? `; only in A: ${onlyA.join(', ')}` : ''}${onlyB.length ? `; only in B: ${onlyB.join(', ')}` : ''}.`] : [])
  ];

  const lines = [
    `# Notes eval: ${metaB('label')} (B) against ${metaA('label')} (A)`,
    '',
    `A: ${a.folder}`,
    `B: ${b.folder}`,
    '',
    ...(warnings.length ? [...warnings, ''] : []),
    '| | A | B |',
    '| --- | --- | --- |',
    ...keys.map((k) => `| ${k}${metaA(k) === metaB(k) ? '' : ' (differs)'} | ${metaA(k)} | ${metaB(k)} |`),
    '',
    `Each case's value in B minus its value in A, averaged over the ${both.length} cases, in percentage points with a 95% interval. When the interval includes 0, the eval hasn't shown a difference.`,
    '',
    ...measures(A, B),
    '',
    ...apart(A, B, both),
    `**Notes model:** A ${seconds(A)} and B ${seconds(B)} to write a run's notes (median); A ${tokens(A)} and B ${tokens(B)} output tokens (mean). Runs not run: A ${count(A, 'not-run')}, B ${count(B, 'not-run')}; not judged: A ${count(A, 'not-judged')}, B ${count(B, 'not-judged')}.`,
    '',
    '## By case',
    '',
    '| Case | Quality A | Quality B | B − A | Violations A | Violations B | Unusable A | Unusable B |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...both.map((id) => {
      const x = A.filter((r) => r.case === id);
      const y = B.filter((r) => r.case === id);
      const qa = score((r) => r.quality)(x);
      const qb = score((r) => r.quality)(y);
      return `| ${id}${isHeld(id) ? ' (held back)' : ''} | ${pct(qa)} | ${pct(qb)} | ${qa === null || qb === null ? '–' : pts(qb - qa)} | ${violated(x)} | ${violated(y)} | ${unusable(x)} | ${unusable(y)} |`;
    }),
    '',
    'A single case moving says little on its own: read its runs (the per-run files in each folder) before acting on it.'
  ];
  say(`${lines.join('\n')}\n`);
}

const count = (rows: RunRow[], outcome: RunRow['outcome']) => rows.filter((r) => r.outcome === outcome).length;
const violated = (rows: RunRow[]) => { const judged = rows.filter((r) => r.outcome === 'scored'); return `${judged.filter((r) => (r.violations ?? 0) > 0).length}/${judged.length}`; };
const unusable = (rows: RunRow[]) => `${count(rows, 'unusable')}/${rows.length - count(rows, 'not-run')}`;
function seconds(rows: RunRow[]): string {
  const m = median(rows.flatMap((r) => (r.notesMs === null ? [] : [r.notesMs])));
  return m === null ? '–' : `${(m / 1000).toFixed(1)} s`;
}
function tokens(rows: RunRow[]): string {
  const xs = rows.flatMap((r) => (r.notesOutputTokens === null ? [] : [r.notesOutputTokens]));
  return xs.length ? `${Math.round(xs.reduce((s, x) => s + x, 0) / xs.length)}` : '–';
}

main().catch((e: unknown) => { process.stderr.write(`${errorMessage(e)}\n`); process.exitCode = 1; });
