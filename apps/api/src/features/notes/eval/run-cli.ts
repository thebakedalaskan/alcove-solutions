/*
 * The notes eval: `pnpm --filter @alcove/server eval:notes` has `draft` write notes for every made-up meeting in
 * cases.ts on the real notes model, several times each, has a stronger model judge each run, and scores them. It
 * measures; it isn't a test, and it never runs in CI. It costs real money (about three dollars for the whole set at
 * five runs, mostly the judge reading the long cases) and needs NEAR_AI_API_KEY and an Anthropic API key (ANTHROPIC_API_KEY, or
 * `ant auth login`).
 *
 *   --runs N        runs of each case (default 5)
 *   --case ID       only this case (repeatable), from any suite
 *   --suite NAME    "default" (cases.ts and the held-back cases), or "missing" (missing-cases.ts alone)
 *   --label NAME    a name for this run's folder, such as "baseline" or "thinking-on"
 *   --concurrency N runs at a time (default 4)
 *   --out DIR       where results go (default .evals/notes at the repository's root, which git ignores)
 *   --model ID      the notes model, by NEAR AI's ID (default: NEAR_AI_NOTES_MODEL, as the product uses); see notesModel.
 *                   The report's cost line prices each request at what NEAR AI lists for its model (evalMeter).
 *
 * What becomes of a run (score.ts, Outcome): when the notes service doesn't answer, or answers with a status other than
 * 200, the run waits and tries again, as production waits these out; after ATTEMPTS tries it's "not run" and left out of
 * the scores. When the model answers but its reply can't be used as notes, that's the model's failure: it isn't tried
 * again (production asks again in a brief style; the eval measures the first try), and it counts as an unusable reply.
 *
 * Each run's folder holds, per case and run, the full record: every request to the notes model as it was sent and its
 * reply as it came back, the notes as `draft` returned them, the judge's request and answer, and the score. Beside them,
 * report.md and summary.json (every run's scores, which eval:notes:compare reads to pair two evals case by case). The
 * held-back cases (heldout.ts) are run too when their file is there, but their records go beside that file, and the
 * report gives only their numbers.
 */
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { errorMessage, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import { loadEnv, type Config } from '../../../platform/config';
import { b64u, sha, utf8 } from '../../../keys/crypto';
import { verified } from '../../../inference/evidence';
import { defaultModel, ready, type ChatModel, type Exchange, type Meter, type Usage } from '../../../inference/inference';
import { priceOf } from '../../../inference/models';
import { configureLogging, flushLogs } from '../../../platform/log';
import { draft, type Written } from '../writing/drafting';
import { briefOf, lineAt, linesOf, problemsIn, styleOf } from './brief';
import type { EvalCase } from './cases';
import { EVERY_CASE, HELD, HELDOUT_FILE, HELDOUT_RUNS, isHeld } from './heldout';
import { judge, judgeCost, JUDGE, type Judged, type JudgeExchange, type NoteItem, type NoteProse, type Verdict } from './judge';
import { MISSING_CASES } from './missing-cases';
import { median, scoreRun, summarise, type Outcome, type RunRow, type RunScore, type Summary } from './score';

/** Tries at a run's notes while the service, not the model, fails. Before each new try, a pause of about 10 s, then 30 s. */
const ATTEMPTS = 3;
const pauseBefore = (attempt: number) => 10_000 * 3 ** (attempt - 2) * (0.5 + Math.random());

const say = (text: string) => { process.stdout.write(text); };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');

const args = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    case: { type: 'string', multiple: true },
    suite: { type: 'string', default: 'default' },
    label: { type: 'string', default: 'run' },
    concurrency: { type: 'string', default: '4' },
    out: { type: 'string', default: join(ROOT, '.evals', 'notes') },
    model: { type: 'string' }
  }
}).values;

/**
 * The settings the eval sends with: the environment's, with no keys. The product's loadConfig opens the server's keys from
 * the database; nothing the eval calls (`draft`, NEAR AI's evidence and prices) reads one, so the eval holds none and
 * needs no database.
 */
const keyless = (): Config => ({ ...loadEnv(), KMASTER: '', KSERVICE: '', INDEX_KEY: '', PHOTO_KEY: '', LEGACY_KMASTER: undefined });

/**
 * Who pays for the eval's requests to the notes model: nobody. `draft` takes a Meter, which in the product holds and
 * charges someone's allowance (features/billing/meter/meter.ts); this one holds nothing and refuses nothing. It adds up
 * what each answered request would cost at the price NEAR AI lists for its model (inference/models.ts), worked out as the
 * product's meter does. A request never answered adds nothing, having no tokens to count; a model NEAR AI doesn't price
 * is named in `unpriced`.
 */
function evalMeter(cfg: Config): { meter: Meter; usd: () => number; unpriced: () => string[] } {
  let micro = 0;
  const unpriced = new Set<string>();
  const meter: Meter = {
    begin: async (model) => ({
      used: async (u: Usage) => {
        const p = await priceOf(cfg, model);
        if (!p) { unpriced.add(model); return; }
        micro += (Math.max(0, u.input - u.cached) * p.input + u.cached * p.cached + u.output * p.output) / 1e6;
      },
      unsent: async () => {},
      lost: async () => {}
    })
  };
  return { meter, usd: () => micro / 1e6, unpriced: () => [...unpriced] };
}

/** As much of NEAR AI's two public lists as `--model` reads (models.ts reads them for the product); the rest is ignored. */
const CatalogEntry = z.object({
  id: z.string().min(1),
  supported_sampling_parameters: z.array(z.string()).nullish().catch(null),
  supported_features: z.array(z.string()).nullish().catch(null)
});
const Catalog = z.object({ data: z.array(z.unknown()) });
const Registry = z.object({ endpoints: z.array(z.unknown()) });
const Listed = z.object({ models: z.array(z.string()) });
const Endpoint = z.object({ domain: z.string().regex(/^[A-Za-z0-9.-]+(?::\d+)?$/), models: z.array(z.string()) });

async function listed(url: string, apiKey: string | undefined): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`--model: ${url} answered ${res.status}`);
  const body: unknown = await res.json();
  return body;
}

/**
 * The notes model `--model` names, and how every notes request reaches it, found the way models.ts finds the models the
 * product offers, but without its limits on what's offered (the price cap, taking images, being marked ready), so any
 * model in NEAR AI's catalog can be measured. A model NEAR AI's registry names is private: sealed to its own endpoint,
 * once its evidence checks out, as the product sends it. Any other goes unencrypted through NEAR AI's gateway, with the
 * temperature and JSON mode its catalog entry says its provider takes. An ID not in the catalog, a private model with no
 * endpoint that can be used, or evidence that doesn't check out stops the eval before anything is sent: it never falls
 * back to the default. Only the notes model changes; the judge is the judge.
 */
async function notesModel(cfg: Config, id: string): Promise<ChatModel> {
  if (!ready(cfg)) throw new Error('NEAR_AI_API_KEY isn’t set, so the notes model can’t be reached');
  if (id === cfg.NEAR_AI_NOTES_MODEL) return defaultModel(cfg);
  const [catalog, registry] = await Promise.all([
    listed(`${cfg.NEAR_AI_BASE_URL.replace(/\/$/, '')}/models`, cfg.NEAR_AI_API_KEY),
    listed(cfg.NEAR_AI_ENDPOINTS_URL, undefined)
  ]);
  const c = Catalog.safeParse(catalog);
  const r = Registry.safeParse(registry);
  if (!c.success || !r.success) throw new Error('--model: NEAR AI’s lists of models came back in a shape the eval doesn’t know');
  const entry = c.data.data.flatMap((x) => { const e = CatalogEntry.safeParse(x); return e.success && e.data.id === id ? [e.data] : []; })[0];
  if (!entry) throw new Error(`--model: NEAR AI’s catalog has no model "${id}"`);
  const scheme = new URL(cfg.NEAR_AI_ENDPOINTS_URL).protocol;
  const named = r.data.endpoints.some((x) => { const l = Listed.safeParse(x); return l.success && l.data.models.includes(id); });
  const host = r.data.endpoints.flatMap((x) => { const e = Endpoint.safeParse(x); return e.success && e.data.models.includes(id) ? [`${scheme}//${e.data.domain}`] : []; })[0];
  if (named && !host) throw new Error(`--model: NEAR AI runs "${id}" privately but lists no endpoint for it that can be used, so it isn't sent unencrypted instead`);
  if (host) {
    await verified(cfg, id, 'notes');
    return { model: id, private: true, url: host };
  }
  const features = entry.supported_features ?? [];
  return { model: id, private: false, temperature: (entry.supported_sampling_parameters ?? []).includes('temperature'), json: features.includes('json_mode') || features.includes('structured_outputs') };
}

/** Every case `--case` can name: the default suite's, then the ones kept out of it (missing-cases.ts). */
const RUNNABLE: EvalCase[] = [...EVERY_CASE, ...MISSING_CASES];

interface RunRecord {
  case: string;
  run: number;
  outcome: Outcome;
  /** `ms` is how long the try that wrote the notes took; null when none did. `exchanges` holds every try's. */
  notes: { attempts: number; exchanges: Exchange[]; items: NoteItem[]; prose: NoteProse; suggestedQuestions: string[]; error: string | null; ms: number | null };
  judge: { exchange: JudgeExchange | null; verdict: Verdict | null; error: string | null };
  /** Only for a scored run. */
  score: RunScore | null;
}

/** The notes `draft` wrote, as items the judge reads, with the line each points at as an index. */
function itemsOf(w: Written, lines: TranscriptLine[]): { items: NoteItem[]; prose: NoteProse } {
  const at = (ids: string[]) => ids.flatMap((id) => { const i = lines.findIndex((l) => l.id === id); return i < 0 ? [] : [i]; });
  return {
    items: [
      ...w.decisions.map((d, i): NoteItem => ({ id: `D${i + 1}`, kind: 'decision', text: d.text, owner: null, due: null, lines: at(d.lines) })),
      ...w.questions.map((q, i): NoteItem => ({ id: `Q${i + 1}`, kind: 'question', text: q.text, owner: null, due: null, lines: at(q.lines) })),
      ...w.actions.map((a, i): NoteItem => ({ id: `F${i + 1}`, kind: 'action', text: a.text, owner: a.owner?.person?.name ?? a.owner?.name ?? null, due: a.due ?? null, lines: at(a.lines) }))
    ],
    prose: { summary: w.summary, chapters: w.chapters.map((ch) => ({ title: ch.title, summary: ch.summary })) }
  };
}

/**
 * The judge caches what a case's runs share (judge.ts), and a cached copy can be read only once the request writing it
 * has started answering. So a case's first judge call goes alone and its other runs wait for it: sent together, each
 * would write the cache and none would read it.
 */
const firstJudged = new Map<string, Promise<Judged>>();
async function judgeInTurn(client: Anthropic, c: EvalCase, lines: TranscriptLine[], items: NoteItem[], prose: NoteProse): Promise<Judged> {
  const first = firstJudged.get(c.id);
  if (!first) {
    const judged = judge(client, c, lines, items, prose);
    firstJudged.set(c.id, judged);
    return judged;
  }
  await first;
  return judge(client, c, lines, items, prose);
}

async function oneRun(cfg: Config, meter: Meter, client: Anthropic, c: EvalCase, run: number, via: ChatModel | undefined): Promise<RunRecord> {
  const lines = linesOf(c);
  const exchanges: Exchange[] = [];
  let written: Written | null = null;
  let error: string | null = null;
  let ms: number | null = null;
  let attempts = 0;
  let plumbing = false;
  while (!written && attempts < ATTEMPTS) {
    if (attempts) await pause(pauseBefore(attempts + 1));
    attempts++;
    const before = exchanges.length;
    const t0 = performance.now();
    try {
      written = await draft(cfg, meter, { ...briefOf(c), via, trace: (x) => { exchanges.push(x); } }, styleOf(c));
      ms = Math.round(performance.now() - t0);
      error = null;
    } catch (e) {
      error = errorMessage(e);
      // A 200 means the model answered and its reply couldn't be used: the model's, and trying again would hide it. No
      // answer at all, or any other status (busy, failing, turned away), is the plumbing's: wait and try again.
      const last = exchanges.slice(before).at(-1);
      plumbing = last === undefined || last.status !== 200;
      if (!plumbing) break;
    }
  }
  const { items, prose } = written ? itemsOf(written, lines) : { items: [], prose: { summary: '', chapters: [] } };
  const notes = { attempts, exchanges, items, prose, suggestedQuestions: written?.suggestedQuestions ?? [], error, ms };
  if (!written) return { case: c.id, run, outcome: plumbing ? 'not-run' : 'unusable', notes, judge: { exchange: null, verdict: null, error: null }, score: null };
  const judged = await judgeInTurn(client, c, lines, items, prose);
  if (!judged.ok) return { case: c.id, run, outcome: 'not-judged', notes, judge: { exchange: judged.exchange, verdict: null, error: judged.error }, score: null };
  return {
    case: c.id, run, outcome: 'scored', notes,
    judge: { exchange: judged.exchange, verdict: judged.verdict, error: null },
    score: scoreRun(c, items, judged.verdict, (mark) => lineAt(lines, mark))
  };
}

/** A run as summary.json keeps it. */
function rowOf(r: RunRecord): RunRow {
  const s = r.score;
  return {
    case: r.case, run: r.run, outcome: r.outcome,
    quality: s?.quality ?? null, recall: s?.recall ?? null, precision: s?.precision ?? null,
    owners: s?.owners ?? null, dues: s?.dues ?? null, cites: s?.cites ?? null,
    violations: s ? s.violations.length : null,
    attempts: r.notes.attempts,
    notesMs: r.notes.ms,
    // `draft` asks once a try, so the last exchange is the one that wrote the notes.
    notesOutputTokens: r.notes.ms === null ? null : r.notes.exchanges.at(-1)?.outputTokens ?? null
  };
}

/** Runs `jobs` with at most `n` at a time, in order of starting. */
async function pool<T>(jobs: (() => Promise<T>)[], n: number, done: (t: T) => void): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (!job) return;
      const t = await job();
      out.push(t);
      done(t);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  return out;
}

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const ci = (s: Summary) => (s.n === 0 ? '–' : s.low === null || s.high === null ? `${pct(s.mean)}` : `${pct(s.mean)} [${pct(s.low)}–${pct(s.high)}]`);
const meanOf = (xs: (number | null)[]) => { const ys = xs.flatMap((x) => (x === null ? [] : [x])); return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null; };
const of = (rs: RunRecord[], o: Outcome) => rs.filter((r) => r.outcome === o).length;

/** Each problem with how many of the runs had it, most often first. */
function tally(scores: RunScore[], pick: (s: RunScore) => string[]): string[] {
  const counts = new Map<string, number>();
  for (const s of scores) for (const p of new Set(pick(s))) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([p, k]) => `${p} (${k}/${scores.length} runs)`);
}

function report(label: string, meta: Record<string, string | number>, records: RunRecord[]): { text: string; summary: unknown } {
  const cases = RUNNABLE.filter((c) => records.some((r) => r.case === c.id));
  const rows = cases.map((c) => {
    const rs = records.filter((r) => r.case === c.id);
    const scores = rs.flatMap((r) => (r.score ? [r.score] : []));
    return { c, rs, scores, quality: summarise(scores.map((s) => s.quality)) };
  });
  const overall = summarise(rows.filter((r) => r.scores.length).map((r) => r.quality.mean));
  const scored = records.flatMap((r) => (r.score ? [r.score] : []));
  const reached = records.length - of(records, 'not-run');
  const wrote = records.flatMap((r) => (r.notes.ms === null ? [] : [r.notes.ms]));
  const notesMs = median(wrote);
  const notesOut = meanOf(records.map((r) => rowOf(r).notesOutputTokens));
  const lines = [
    `# Notes eval: ${label}`,
    '',
    ...Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`),
    '',
    `**Quality: ${ci(overall)}**: F1 of the expected items the notes found against how much of what they listed was expected, the mean of the ${overall.n} cases' means. The interval is across cases that differ on purpose, so don't judge a change by whether two evals' intervals overlap: compare them with \`eval:notes:compare\`, which pairs them case by case.`,
    '',
    `**Violations: ${scored.filter((s) => s.violations.length).length} of ${scored.length} judged runs** stated something on a case's never list or came back in the wrong language. A change shouldn't add any.`,
    '',
    `**Unusable replies: ${of(records, 'unusable')} of ${reached}** runs that reached the notes model. Not run (the service failed all ${ATTEMPTS} tries): ${of(records, 'not-run')}. Needed another try: ${records.filter((r) => r.notes.attempts > 1).length}. Not judged: ${of(records, 'not-judged')}.`,
    '',
    `**Notes model:** ${notesMs === null ? '–' : `${(notesMs / 1000).toFixed(1)} s`} to write a run's notes (median), ${notesOut === null ? '–' : Math.round(notesOut)} output tokens (mean).`,
    '',
    '| Case | Quality [95% CI] | Recall | Precision | Owners | Dues | Cites | Violations | Unusable | Not run | Not judged |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(({ c, rs, scores, quality }) => `| ${c.id}${isHeld(c.id) ? ' (held back)' : ''} | ${ci(quality)} | ${pct(meanOf(scores.map((s) => s.recall)))} | ${pct(meanOf(scores.map((s) => s.precision)))} | ${pct(meanOf(scores.map((s) => s.owners)))} | ${pct(meanOf(scores.map((s) => s.dues)))} | ${pct(meanOf(scores.map((s) => s.cites)))} | ${scores.filter((s) => s.violations.length).length}/${scores.length} | ${of(rs, 'unusable')}/${rs.length - of(rs, 'not-run')} | ${of(rs, 'not-run')}/${rs.length} | ${of(rs, 'not-judged')}/${rs.length} |`),
    '',
    '## What went wrong',
    ''
  ];
  for (const { c, scores, rs } of rows) {
    if (isHeld(c.id)) {
      lines.push(`### ${c.id} (held back)`, '', 'What went wrong is in its records, beside the held-back cases, not here.', '');
      continue;
    }
    const problems = [
      ...tally(scores, (s) => s.violations).map((p) => `- **violation:** ${p}`),
      ...rs.flatMap((r) => (r.outcome === 'unusable' ? [`- **unusable reply** on run ${r.run}: ${r.notes.error ?? 'unknown'}${r.notes.exchanges.at(-1)?.finish === 'length' ? ' (cut off at its max_tokens)' : ''}`] : [])),
      ...tally(scores, (s) => s.missed).map((p) => `- missed ${p}`),
      ...tally(scores, (s) => s.invented).map((p) => `- invented ${p}`),
      ...tally(scores, (s) => s.wrongList).map((p) => `- wrong list: ${p}`),
      ...tally(scores, (s) => s.repeated).map((p) => `- repeated: ${p}`),
      ...tally(scores, (s) => s.ownerErrors).map((p) => `- owner: ${p}`),
      ...tally(scores, (s) => s.dueErrors).map((p) => `- due: ${p}`),
      ...tally(scores, (s) => s.citeErrors).map((p) => `- cite: ${p}`),
      ...rs.flatMap((r) => (r.outcome === 'not-run' ? [`- not run (run ${r.run}, ${r.notes.attempts} tries): ${r.notes.error ?? 'unknown'}`] : [])),
      ...rs.flatMap((r) => (r.outcome === 'not-judged' ? [`- not judged (run ${r.run}): ${r.judge.error ?? 'unknown'}`] : []))
    ];
    lines.push(`### ${c.id}`, '', c.checks, '', ...(problems.length ? problems : ['Nothing.']), '');
  }
  const summary = {
    meta: { label, ...meta },
    overall,
    cases: rows.map(({ c, scores, quality }) => ({
      id: c.id, quality,
      recall: meanOf(scores.map((s) => s.recall)), precision: meanOf(scores.map((s) => s.precision)), owners: meanOf(scores.map((s) => s.owners)),
      dues: meanOf(scores.map((s) => s.dues)), cites: meanOf(scores.map((s) => s.cites))
    })),
    runs: records.map(rowOf)
  };
  return { text: lines.join('\n'), summary };
}

/** The system message a request sent, for its fingerprint. */
const systemOf = (x: Exchange) => x.sent.messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const distinct = (xs: string[]) => [...new Set(xs)].join(' | ') || 'none sent';

async function main(): Promise<void> {
  configureLogging({ level: 'warn', format: 'pretty', service: 'alcove-eval' });
  const runs = Number(args.runs);
  const concurrency = Number(args.concurrency);
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('--runs and --concurrency take a whole number, 1 or more');
  if (args.suite !== 'default' && args.suite !== 'missing') throw new Error('--suite takes default or missing');
  const suite = args.suite === 'missing' ? MISSING_CASES : EVERY_CASE;
  const chosen = args.case?.length ? RUNNABLE.filter((c) => args.case?.includes(c.id)) : suite;
  const unknown = (args.case ?? []).filter((id) => !RUNNABLE.some((c) => c.id === id));
  if (unknown.length) throw new Error(`no such case: ${unknown.join(', ')}`);
  // Mistakes in a case would cost a run and score it wrong, so they're found before anything is sent.
  const problems = chosen.flatMap(problemsIn);
  if (problems.length) throw new Error(`cases need fixing first:\n${problems.join('\n')}`);

  const cfg = keyless();
  if (!cfg.NEAR_AI_API_KEY) throw new Error('NEAR_AI_API_KEY isn’t set, so the notes model can’t be reached');
  const via = args.model === undefined ? undefined : await notesModel(cfg, args.model);
  const client = new Anthropic();
  const billed = evalMeter(cfg);

  const git = (cmd: string) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
  const date = new Date().toISOString();
  const folder = join(args.out, `${date.replace(/[:.]/g, '-').slice(0, 19)}-${args.label}`);
  const commit = `${git('git rev-parse --short HEAD')}${git('git status --porcelain') ? ' (with uncommitted changes)' : ''}`;
  say(`Notes eval "${args.label}": ${chosen.length} cases × ${runs} runs, ${concurrency} at a time.${via ? ` Notes model: ${via.model}, ${via.private ? 'private' : 'unencrypted'}.` : ''}\n`);

  const jobs = chosen.flatMap((c) => Array.from({ length: runs }, (_, i) => async () => {
    const r = await oneRun(cfg, billed.meter, client, c, i + 1, via);
    const dir = isHeld(c.id) ? join(HELDOUT_RUNS, basename(folder), c.id) : join(folder, c.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `run-${i + 1}.json`), JSON.stringify(r, null, 2));
    return r;
  }));
  let finished = 0;
  const records = await pool(jobs, concurrency, (r) => {
    finished++;
    const violations = r.score?.violations.length ?? 0;
    const how = r.outcome === 'scored' ? `${pct(r.score?.quality ?? null)}${violations ? `, ${violations} violation${violations > 1 ? 's' : ''}` : ''}`
      : r.outcome === 'not-judged' ? `not judged: ${r.judge.error ?? 'unknown'}`
      : `${r.outcome === 'unusable' ? 'unusable reply' : 'not run'}: ${r.notes.error ?? 'unknown'}`;
    say(`  [${finished}/${jobs.length}] ${r.case} run ${r.run}: ${how}\n`);
  });

  // Every try's tokens, and the judge's whenever it answered, since all of them are paid for.
  const sent = records.flatMap((r) => r.notes.exchanges);
  const judged = records.flatMap((r) => (r.judge.exchange ? [r.judge.exchange] : []));
  const notesIn = sent.reduce((a, x) => a + (x.promptTokens ?? 0), 0);
  const notesOut = sent.reduce((a, x) => a + (x.outputTokens ?? 0), 0);
  const judgeTokens = (pick: (x: JudgeExchange) => number) => judged.reduce((a, x) => a + pick(x), 0);
  const judgeUsd = judgeCost(judged);
  const notesUsd = billed.usd();
  const unpriced = billed.unpriced();
  const held = chosen.filter((c) => isHeld(c.id)).length;
  const meta = {
    date,
    commit,
    // What the notes model was sent, read from the requests themselves: two evals that show the same fingerprint and
    // settings asked the same thing, committed or not.
    'notes model': distinct(sent.map((x) => x.model)),
    'notes prompt': distinct(sent.map((x) => b64u(sha(utf8(systemOf(x)))).slice(0, 12))),
    'notes settings': distinct(sent.map((x) => JSON.stringify(x.sent.settings))),
    'judge model': JUDGE.model,
    'judge effort': JUDGE.effort,
    'runs per case': runs,
    cases: chosen.length,
    'held-back cases': held ? `${held} (${HELDOUT_FILE})` : HELD.cases.length ? 'none chosen' : `none (no ${HELDOUT_FILE})`,
    tokens: `notes ${notesIn} in / ${notesOut} out; judge ${judgeTokens((x) => x.inputTokens)} in, ${judgeTokens((x) => x.cacheWriteTokens)} written to the cache, ${judgeTokens((x) => x.cacheReadTokens)} read from it, ${judgeTokens((x) => x.outputTokens)} out`,
    cost: `about $${(judgeUsd + notesUsd).toFixed(2)}: the judge $${judgeUsd.toFixed(2)} (Anthropic), the notes model $${notesUsd.toFixed(2)} (NEAR AI${unpriced.length ? `; not counted, as NEAR AI lists no price: ${unpriced.join(', ')}` : ''})`,
    // What the evals of a night spent on Anthropic's key, added up by the overnight loop.
    'judge cost (USD)': Number(judgeUsd.toFixed(4))
  };
  const { text, summary } = report(args.label, meta, records);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'report.md'), `${text}\n`);
  await writeFile(join(folder, 'summary.json'), JSON.stringify(summary, null, 2));
  say(`\n${text}\n\nEverything is in ${folder}\n`);
}

main()
  .catch((e: unknown) => { process.stderr.write(`${errorMessage(e)}\n`); process.exitCode = 1; })
  .finally(() => flushLogs());
