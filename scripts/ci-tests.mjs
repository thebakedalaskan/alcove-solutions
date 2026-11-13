#!/usr/bin/env node
/**
 * CI's integration tests, split across runners so the suite takes minutes rather than half an hour.
 *
 *   node scripts/ci-tests.mjs plan <shard> <of>   What one runner runs, as JSON.
 *   node scripts/ci-tests.mjs run <shard> <of>    Runs it, writing the full test list and vitest's JSON reports to $REPORTS.
 *   node scripts/ci-tests.mjs check <dir>         Fails unless every test vitest lists ran exactly once, and passed.
 *   node scripts/ci-tests.mjs flakes <dir>        Several runs' reports (a folder each, named …-<run>-<shard>): what
 *                                                 failed in one run and passed in another.
 *   node scripts/ci-tests.mjs times <dir>         Rewrites scripts/ci-test-times.json from one run's reports.
 *
 * A runner runs LANES test files at once. Each lane has a database of its own (TEST_DATABASE_URL with _<lane> on its
 * name), and so a bucket of its own, which the harness names after the database; LiveKit's rooms have random names, so
 * the lanes share it. Files and parts of files are packed onto the runners' lanes by how long they took
 * (scripts/ci-test-times.json), longest first, each onto the least loaded lane; a runner then runs its share longest
 * first, each lane taking the next as it finishes. A file longer than SPLIT seconds is split at its top-level describe
 * blocks, and a block longer than SPLIT at its tests (the timings list those blocks' tests): every part but the last runs
 * with `-t` naming its blocks or tests, and the last runs everything else in the file. So a new or renamed block or test,
 * or a test outside any block, always runs somewhere, and `check` proves it against the list vitest itself finds.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as util from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps/api');
const TIMES = join(root, 'scripts/ci-test-times.json');
/** Test files a runner runs at once. A GitHub runner has four cores; the tests mostly wait, on timers and on each other. */
const LANES = 3;
/** A file longer than this, in seconds, is split into parts about this long; so is a describe block longer than this. */
const SPLIT = 90;
/** Seconds for a file the timings don't know yet, and for a block they don't know in a file they do. */
const NEW_FILE = 30;
const NEW_BLOCK = 5;
/** What starting vitest and the harness costs each run of a file or a part of one, in seconds. */
const START = 4;
const inActions = process.env['GITHUB_ACTIONS'] === 'true';

/** A path from a runner, as the file under apps/api it names: src/….integration.test.ts. */
const underApi = (p) => {
  const s = String(p).split('\\').join('/');
  const at = s.lastIndexOf('/apps/api/');
  return at >= 0 ? s.slice(at + '/apps/api/'.length) : s;
};
const testFiles = () => readdirSync(join(api, 'src'), { recursive: true })
  .map((f) => `src/${String(f).split('\\').join('/')}`)
  .filter((f) => f.endsWith('.integration.test.ts'))
  .sort();

/** A file's top-level describe blocks, in order. A name built at run time is left to the file's last part. */
function blocks(file) {
  const names = [];
  for (const m of readFileSync(join(api, file), 'utf8').matchAll(/^describe\((['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,/gm)) {
    const [, quote, raw] = m;
    if (quote === '`' && raw.includes('${')) continue;
    const name = raw.replace(/\\(.)/g, '$1');
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What `-t` matches: every test in a block (its name and ` > `), or one test by its full name. */
const matching = (item) => (item.test ? `${escape(item.test)}$` : `${escape(item.block)} > `);

/** Everything to run, each a whole file or a part of one, with how long it should take. */
function units() {
  const times = existsSync(TIMES) ? JSON.parse(readFileSync(TIMES, 'utf8')) : {};
  const out = [];
  for (const file of testFiles()) {
    const known = times[file];
    const seconds = known?.seconds ?? NEW_FILE;
    if (seconds <= SPLIT) { out.push({ file, seconds: seconds + START }); continue; }
    const groups = known?.groups ?? {};
    const tests = Object.entries(known?.tests ?? {});
    // What can go in a part: whole blocks, and the tests the timings list of a block too long for one.
    const items = blocks(file).flatMap((block) => {
      const mine = (groups[block] ?? 0) > SPLIT ? tests.filter(([name]) => name.startsWith(`${block} > `)) : [];
      return mine.length ? mine.map(([test, s]) => ({ test, seconds: s })) : [{ block, seconds: groups[block] ?? NEW_BLOCK }];
    });
    const parts = [];
    let part = [], sum = 0;
    for (const item of items) {
      if (part.length && sum + item.seconds > SPLIT) { parts.push({ items: part, seconds: sum }); part = []; sum = 0; }
      part.push(item); sum += item.seconds;
    }
    if (part.length) parts.push({ items: part, seconds: sum });
    if (parts.length < 2) { out.push({ file, seconds: seconds + START }); continue; }
    const named = parts.slice(0, -1);
    for (const p of named) out.push({ file, seconds: p.seconds + START, pattern: `^(?:${p.items.map(matching).join('|')})` });
    const rest = seconds - named.reduce((s, p) => s + p.seconds, 0);
    out.push({ file, seconds: Math.max(rest, parts.at(-1).seconds) + START, pattern: `^(?!(?:${named.flatMap((p) => p.items).map(matching).join('|')}))` });
  }
  return out;
}

/** How long `lanes` lanes take over these, each taking the longest left as it finishes. */
function makespan(us, lanes) {
  const busy = Array.from({ length: lanes }, () => 0);
  for (const u of [...us].sort((a, b) => b.seconds - a.seconds)) busy[busy.indexOf(Math.min(...busy))] += u.seconds;
  return Math.max(...busy);
}

/**
 * The runners' shares: longest first, each onto the least loaded lane of all the runners'. Lane i is runner i mod `of`'s,
 * so the longest runs, which work hardest, go one to a runner before any runner gets a second.
 */
function plan(of) {
  const lanes = Array.from({ length: of * LANES }, () => ({ seconds: 0, units: [] }));
  const key = (u) => `${u.file} ${u.pattern ?? ''}`;
  for (const u of units().sort((a, b) => b.seconds - a.seconds || key(a).localeCompare(key(b)))) {
    const l = lanes.reduce((least, x) => (x.seconds < least.seconds ? x : least));
    l.units.push(u);
    l.seconds += u.seconds;
  }
  return Array.from({ length: of }, (_, i) => {
    const mine = lanes.filter((_, j) => j % of === i).flatMap((l) => l.units).sort((a, b) => b.seconds - a.seconds || key(a).localeCompare(key(b)));
    return { seconds: makespan(mine, LANES), units: mine };
  });
}

const which = (args) => {
  const [shard, of] = args.map(Number);
  if (!(of >= 1 && shard >= 1 && shard <= of)) { console.error('Expected <shard> <of>, as in 3 10'); process.exit(2); }
  return [shard, of];
};
const json = (dir, prefix) => readdirSync(dir, { recursive: true }).map(String).filter((f) => f.split('/').at(-1)?.startsWith(prefix) && f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
/** The first line of an error, as a report gives it. */
const firstLine = (s) => String(s ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 300) ?? '';
/** Each test a report says ran, as file, its full name, status, milliseconds and the first line of its error. */
const results = (reports) => reports.flatMap((r) => (r.testResults ?? []).flatMap((f) => (f.assertionResults ?? []).map((t) => ({
  file: underApi(f.name), name: [...(t.ancestorTitles ?? []), t.title].join(' > '), status: t.status, ms: t.duration ?? 0, error: firstLine(t.failureMessages?.[0])
}))));
/** Files a report says failed outside any test (an import, or a hook before every test), with the first line of why. */
const fileErrors = (reports) => reports.flatMap((r) => (r.testResults ?? []).filter((f) => f.status === 'failed' && f.message && !(f.assertionResults ?? []).some((t) => t.status === 'failed'))
  .map((f) => ({ file: underApi(f.name), error: firstLine(f.message) })));

/* ---------- what a run says on GitHub: the job's summary (vitest annotates each failure at its line) ---------- */

const cell = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;');
const summary = (markdown) => { if (process.env['GITHUB_STEP_SUMMARY']) appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${markdown}\n`); };
/** A table of failures: each test's file, its name and the first line of its error. */
function failures(title, rows) {
  if (!rows.length) return;
  summary([`### ${title}`, '', '| File | Test | First line of the error |', '| --- | --- | --- |',
    ...rows.map((f) => `| \`${f.file}\` | ${cell(f.name)} | <code>${cell(f.error || '(no message)')}</code> |`), ''].join('\n'));
}

/* ---------- running a runner's share ---------- */

/** The database the tests run against, as the environment or the repository's .env gives it (as vitest's config reads it). */
function testDatabase() {
  const given = process.env['TEST_DATABASE_URL'] ?? (existsSync(join(root, '.env')) ? util.parseEnv(readFileSync(join(root, '.env'), 'utf8'))['TEST_DATABASE_URL'] : undefined);
  if (!given) { console.error('TEST_DATABASE_URL is not set, in the environment or in .env'); process.exit(2); }
  return given;
}
/** A lane's own database: the test database's name with _<lane>. Its bucket follows (harness.ts). */
const laneDatabase = (base, lane) => { const u = new URL(base); u.pathname = `${u.pathname}_${lane}`; return u.toString(); };

/** Runs vitest under apps/api with `env`, its output into `log`; resolves with its exit code. */
function vitest(args, env, log) {
  return new Promise((done) => {
    const fd = openSync(log, 'w');
    const child = spawn(join(api, 'node_modules/.bin/vitest'), args, { cwd: api, env, stdio: ['ignore', fd, fd] });
    child.on('error', (e) => { closeSync(fd); appendFileSync(log, `\n${e.message}\n`); done(1); });
    child.on('close', (code) => { closeSync(fd); done(code ?? 1); });
  });
}
/** A finished run's output, folded away in the job's log unless it failed. */
function show(title, log, ok) {
  const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
  if (inActions && ok) console.log(`::group::${title}\n${text}\n::endgroup::`);
  else console.log(`\n${title}\n${text}`);
}

async function run(shard, of) {
  const out = resolve(process.env['REPORTS'] ?? join(root, 'ci-reports'));
  mkdirSync(out, { recursive: true });
  const base = testDatabase();
  const share = plan(of)[shard - 1];
  const mine = share.units;
  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
  // Everything vitest finds to run, for the check that each test ran once: listed alongside the tests.
  const listed = vitest(['list', `--json=${join(out, `list-${shard}.json`)}`], process.env, join(out, `list-${shard}.log`));
  const queue = mine.map((u, i) => ({ ...u, n: i + 1 }));
  const failed = [];
  // On GitHub, vitest annotates each failure at its line too; its own summary of every run is left out (this one's is
  // what fails, below).
  const reporters = ['--reporter=default', '--reporter=json', ...(inActions ? ['--reporter=github-actions'] : [])];
  await Promise.all(Array.from({ length: LANES }, async (_, l) => {
    const lane = l + 1;
    const env = { ...process.env, TEST_DATABASE_URL: laneDatabase(base, lane), GITHUB_STEP_SUMMARY: '' };
    for (let u = queue.shift(); u; u = queue.shift()) {
      const what = `${u.file}${u.pattern ? `  -t ${u.pattern}` : ''}`;
      console.log(`▶ ${shard}/${of}, ${u.n} of ${mine.length}, lane ${lane}, at ${elapsed()}: ${what}`);
      const t0 = Date.now();
      const log = join(out, `shard-${shard}-${u.n}.log`);
      const status = await vitest(['run', u.file, ...(u.pattern ? ['-t', u.pattern] : []), ...reporters, `--outputFile.json=${join(out, `shard-${shard}-${u.n}.json`)}`], env, log);
      if (status !== 0) failed.push(u);
      show(`${status === 0 ? '✓' : '✗'} ${shard}/${of}, ${u.n} of ${mine.length}, lane ${lane}, ${Math.round((Date.now() - t0) / 1000)} s (planned ${Math.round(u.seconds)} s): ${what}`, log, status === 0);
    }
  }));
  const listStatus = await listed;
  if (listStatus !== 0) show(`✗ ${shard}/${of}: vitest couldn't list the tests`, join(out, `list-${shard}.log`), false);
  console.log(`\n${shard}/${of}: ${mine.length - failed.length} of ${mine.length} runs passed in ${elapsed()} (planned ${Math.round(share.seconds)} s)`);
  if (failed.length || listStatus !== 0) {
    const reports = json(out, `shard-${shard}-`);
    const rows = results(reports).filter((t) => t.status === 'failed');
    failures(`Integration shard ${shard}/${of}: failed tests`, [...rows, ...fileErrors(reports).map((f) => ({ ...f, name: '(the file, outside any test)' }))]);
    const silent = failed.filter((u) => !existsSync(join(out, `shard-${shard}-${u.n}.json`)));
    if (silent.length) summary(`Runs that wrote no report (see their output in this job's log):\n\n${silent.map((u) => `- \`${u.file}\`${u.pattern ? ` (a part of it)` : ''}`).join('\n')}\n`);
    if (listStatus !== 0) summary('vitest couldn’t list the tests on this runner; see `list` in the log.\n');
    process.exit(1);
  }
}

/* ---------- checking a run, and comparing runs ---------- */

/** What a run's reports say against what vitest lists: what never ran, what failed, ran twice or wasn't listed. */
function tally(dir) {
  const lists = json(dir, 'list-');
  if (!lists.length) return null;
  // vitest lists `it.each` once, under its template (`%i people…`), and runs it as one test a case (`2 people…`), so a
  // listed name with a placeholder is met by any test of its file whose name it matches.
  const SLOT = /(%[sdifjoOc#%]|\$#|\$[A-Za-z_][\w.]*)/;
  const listed = new Map(lists.flat().map((t) => [`${underApi(t.file)} › ${t.name}`, { file: underApi(t.file), name: t.name }]));
  const exact = new Set([...listed].filter(([, t]) => !SLOT.test(t.name)).map(([k]) => k));
  const templates = [...listed].filter(([, t]) => SLOT.test(t.name)).map(([k, t]) => ({
    key: k, file: t.file, runs: 0,
    re: new RegExp(`^${t.name.split(SLOT).map((part, i) => (i % 2 === 0 ? escape(part) : part === '%%' ? '%' : '.+?')).join('')}$`)
  }));
  const ran = new Map();
  const failed = [];
  const unknown = [];
  const reports = json(dir, 'shard-');
  for (const t of results(reports)) {
    if (t.status !== 'passed' && t.status !== 'failed') continue;
    const k = `${t.file} › ${t.name}`;
    const template = exact.has(k) ? undefined : templates.find((x) => x.file === t.file && x.re.test(t.name));
    if (!exact.has(k) && !template) unknown.push(k);
    if (template) template.runs += 1;
    ran.set(k, (ran.get(k) ?? 0) + 1);
    if (t.status === 'failed') failed.push(t);
  }
  const missing = [...[...exact].filter((k) => !ran.has(k)), ...templates.filter((x) => !x.runs).map((x) => x.key)];
  const twice = [...ran].filter(([, n]) => n > 1).map(([k]) => k);
  return { listed, ran, failed, missing, twice, unknown, fileErrors: fileErrors(reports) };
}

/** How long each runner's tests took, by its reports: from its first run starting to its last file ending, in seconds. */
function spans(dir) {
  const by = new Map();
  for (const f of readdirSync(dir, { recursive: true }).map(String)) {
    const m = /(?:^|\/)shard-(\d+)-\d+\.json$/.exec(f);
    if (!m) continue;
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const [from, to] = by.get(m[1]) ?? [Infinity, -Infinity];
    by.set(m[1], [Math.min(from, r.startTime ?? Infinity), Math.max(to, ...(r.testResults ?? []).map((x) => x.endTime ?? -Infinity))]);
  }
  return [...by].map(([s, [from, to]]) => [Number(s), Math.round((to - from) / 1000)]).filter(([, took]) => Number.isFinite(took)).sort((a, b) => a[0] - b[0]);
}

function check(dir) {
  const t = tally(dir);
  if (!t) { console.error(`No test list in ${dir}: no runner got as far as listing the tests.`); summary('No runner got as far as listing the tests.'); process.exit(1); }
  const list = (title, ks) => { if (ks.length) console.error(`${title} (${ks.length}):\n${ks.slice(0, 40).map((k) => `  ${k}`).join('\n')}`); };
  list('Listed but never run', t.missing);
  list('Failed', t.failed.map((f) => `${f.file} › ${f.name}`));
  list('Ran more than once', t.twice);
  list('Ran but not listed', t.unknown);
  failures('Failed tests', [...t.failed, ...t.fileErrors.map((f) => ({ ...f, name: '(the file, outside any test)' }))]);
  if (t.missing.length) summary(`### Listed but never run (${t.missing.length})\n\nA runner that didn't finish, or a test no part of its file named.\n\n${t.missing.slice(0, 40).map((k) => `- ${cell(k)}`).join('\n')}\n`);
  // How long each runner took, to see the plan drift (refresh the timings with `times` when it does).
  const took = spans(dir);
  if (took.length) {
    const line = `Each runner's tests took ${took.map(([s, x]) => `${s}: ${x} s`).join(', ')}.`;
    console.log(line);
    summary(line);
  }
  if (t.missing.length || t.failed.length) process.exit(1);
  const done = `All ${t.ran.size} integration tests ran, each once, and passed (${t.listed.size} as vitest lists them, an each's cases counted as one).`;
  console.log(done);
  summary(done);
}

/** Runs compared: every test that failed in one and passed in another, and every test that failed in all of them. */
function flakes(dir) {
  // A folder per runner of a run, as the flake finder names its artifacts: …-<run>-<shard>.
  const byRun = new Map();
  for (const sub of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const m = /-(\d+)-(\d+)$/.exec(sub.name);
    if (!m) continue;
    const runs = byRun.get(m[1]) ?? [];
    runs.push(join(dir, sub.name));
    byRun.set(m[1], runs);
  }
  if (!byRun.size) { console.error(`No runs' reports in ${dir}`); process.exit(2); }
  const tallies = [...byRun].sort(([a], [b]) => Number(a) - Number(b)).map(([n, dirs]) => {
    const reports = dirs.flatMap((d) => json(d, 'shard-'));
    const lists = dirs.flatMap((d) => json(d, 'list-')).flat();
    const outcomes = new Map(results(reports).filter((t) => t.status === 'passed' || t.status === 'failed').map((t) => [`${t.file} › ${t.name}`, t]));
    return { n, outcomes, listed: new Set(lists.map((t) => `${underApi(t.file)} › ${t.name}`)).size, ran: outcomes.size, fileErrors: fileErrors(reports) };
  });
  const keys = new Set(tallies.flatMap((t) => [...t.outcomes.keys()]));
  const rows = [...keys].sort().map((k) => {
    const seen = tallies.map((t) => t.outcomes.get(k));
    const failedIn = tallies.filter((_, i) => seen[i]?.status === 'failed').map((t) => t.n);
    const passedIn = tallies.filter((_, i) => seen[i]?.status === 'passed').map((t) => t.n);
    const error = seen.find((s) => s?.status === 'failed')?.error ?? '';
    return { k, file: seen.find(Boolean)?.file ?? '', name: seen.find(Boolean)?.name ?? k, failedIn, passedIn, error };
  });
  const flaky = rows.filter((r) => r.failedIn.length && r.passedIn.length);
  const broken = rows.filter((r) => r.failedIn.length && !r.passedIn.length);
  const lines = [`## Flaky tests on ${process.env['GITHUB_SHA']?.slice(0, 9) ?? 'this commit'}`, '',
    `${tallies.length} runs of the integration tests: ${tallies.map((t) => `run ${t.n} ran ${t.ran} tests`).join(', ')}.`, ''];
  if (flaky.length) {
    lines.push(`### Failed in one run and passed in another (${flaky.length})`, '', '| File | Test | Failed in run | Passed in run | First line of the error |', '| --- | --- | --- | --- | --- |',
      ...flaky.map((r) => `| \`${r.file}\` | ${cell(r.name)} | ${r.failedIn.join(', ')} | ${r.passedIn.join(', ')} | <code>${cell(r.error || '(no message)')}</code> |`), '');
  } else lines.push('No test failed in one run and passed in another.', '');
  if (broken.length) {
    lines.push(`### Failed in every run that ran it (${broken.length})`, '', '| File | Test | First line of the error |', '| --- | --- | --- |',
      ...broken.map((r) => `| \`${r.file}\` | ${cell(r.name)} | <code>${cell(r.error || '(no message)')}</code> |`), '');
  }
  const errors = tallies.flatMap((t) => t.fileErrors.map((f) => `- run ${t.n}: \`${f.file}\`: <code>${cell(f.error)}</code>`));
  if (errors.length) lines.push('### Files that failed outside any test', '', ...errors, '');
  const short = tallies.filter((t) => t.listed && t.ran < t.listed);
  if (short.length) lines.push(`Some runs didn't run every test (a runner that didn't finish): ${short.map((t) => `run ${t.n}, ${t.ran} of about ${t.listed}`).join('; ')}.`, '');
  console.log(lines.join('\n'));
  summary(lines.join('\n'));
  if (flaky.length || broken.length || errors.length) process.exit(1);
}

/* ---------- the timings the plan packs by ---------- */

function times(dir) {
  const times = {};
  for (const t of results(json(dir, 'shard-'))) {
    const f = (times[t.file] ??= { seconds: 0, groups: {}, tests: {} });
    const top = t.name.includes(' > ') ? t.name.split(' > ')[0] : '(top level)';
    f.seconds += t.ms / 1000;
    f.groups[top] = (f.groups[top] ?? 0) + t.ms / 1000;
    f.tests[t.name] = (f.tests[t.name] ?? 0) + t.ms / 1000;
  }
  const round = (n) => Math.round(n * 10) / 10;
  const entry = ({ seconds, groups, tests }) => {
    // The tests of a block too long for one part, so the plan can split it between them.
    const long = Object.entries(tests).filter(([name]) => name.includes(' > ') && (groups[name.split(' > ')[0]] ?? 0) > SPLIT);
    return { seconds: round(seconds), groups: Object.fromEntries(Object.entries(groups).map(([g, s]) => [g, round(s)])), ...(long.length ? { tests: Object.fromEntries(long.map(([n, s]) => [n, round(s)])) } : {}) };
  };
  const sorted = Object.fromEntries(Object.keys(times).sort().map((f) => [f, entry(times[f])]));
  writeFileSync(TIMES, `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`Wrote the timings of ${Object.keys(sorted).length} files to scripts/ci-test-times.json.`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'plan': {
    const [shard, of] = which(args);
    const s = plan(of)[shard - 1];
    console.log(JSON.stringify({ shard, of, lanes: LANES, seconds: Math.round(s.seconds), runs: s.units.map((u) => ({ file: u.file, ...(u.pattern ? { pattern: u.pattern } : {}), seconds: Math.round(u.seconds) })) }, null, 2));
    break;
  }
  case 'run': await run(...which(args)); break;
  case 'check': check(resolve(args[0] ?? 'reports')); break;
  case 'flakes': flakes(resolve(args[0] ?? 'runs')); break;
  case 'times': times(resolve(args[0] ?? 'reports')); break;
  default:
    console.error('Usage: node scripts/ci-tests.mjs plan|run <shard> <of>, or check|flakes|times <reports dir>');
    process.exit(2);
}
