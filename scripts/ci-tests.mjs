#!/usr/bin/env node
/**
 * CI's integration tests, split across runners so the suite takes minutes rather than half an hour.
 *
 *   node scripts/ci-tests.mjs plan <shard> <of>   What one runner runs, as JSON.
 *   node scripts/ci-tests.mjs run <shard> <of>    Runs it, writing the full test list and vitest's JSON reports to $REPORTS.
 *   node scripts/ci-tests.mjs check <dir>         Fails unless every test vitest lists ran exactly once, and passed.
 *   node scripts/ci-tests.mjs times <dir>         Rewrites scripts/ci-test-times.json from a run's reports.
 *
 * Within a runner, test files still run one at a time (they share its database). Files are packed onto runners by how long
 * they took (scripts/ci-test-times.json), longest first, each onto the least loaded runner. A file longer than SPLIT
 * seconds is split at its top-level describe blocks: every part but the last runs with `-t` naming its blocks, and the
 * last runs everything else in the file. So a new or renamed block, or a test outside any block, always runs somewhere,
 * and `check` proves it against the list vitest itself finds.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps/api');
const TIMES = join(root, 'scripts/ci-test-times.json');
/** A file longer than this, in seconds, is split at its describe blocks into parts about this long. */
const SPLIT = 90;
/** Seconds for a file the timings don't know yet, and for a block they don't know in a file they do. */
const NEW_FILE = 30;
const NEW_BLOCK = 5;
/** What starting vitest and the harness again costs a part, in seconds. */
const START = 4;

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

/** Everything to run, each a whole file or a part of one, with how long it should take. */
function units() {
  const times = existsSync(TIMES) ? JSON.parse(readFileSync(TIMES, 'utf8')) : {};
  const out = [];
  for (const file of testFiles()) {
    const known = times[file];
    const seconds = known?.seconds ?? NEW_FILE;
    if (seconds <= SPLIT) { out.push({ file, seconds }); continue; }
    const groups = known?.groups ?? {};
    const parts = [];
    let names = [], sum = 0;
    for (const name of blocks(file)) {
      const s = groups[name] ?? NEW_BLOCK;
      if (names.length && sum + s > SPLIT) { parts.push({ names, seconds: sum }); names = []; sum = 0; }
      names.push(name); sum += s;
    }
    if (names.length) parts.push({ names, seconds: sum });
    if (parts.length < 2) { out.push({ file, seconds }); continue; }
    const named = parts.slice(0, -1);
    for (const p of named) out.push({ file, seconds: p.seconds + START, pattern: `^(?:${p.names.map(escape).join('|')}) > ` });
    const rest = seconds - named.reduce((s, p) => s + p.seconds, 0);
    out.push({ file, seconds: Math.max(rest, parts.at(-1).seconds) + START, pattern: `^(?!(?:${named.flatMap((p) => p.names).map(escape).join('|')}) > )` });
  }
  return out;
}

/** The runners' shares: longest first, each onto the least loaded runner. */
function plan(of) {
  const shards = Array.from({ length: of }, () => ({ seconds: 0, units: [] }));
  const key = (u) => `${u.file} ${u.pattern ?? ''}`;
  for (const u of units().sort((a, b) => b.seconds - a.seconds || key(a).localeCompare(key(b)))) {
    const s = shards.reduce((least, x) => (x.seconds < least.seconds ? x : least));
    s.units.push(u);
    s.seconds += u.seconds;
  }
  return shards;
}

/** One runner's vitest runs: its whole files together, then each part on its own. */
function runs(shard) {
  const whole = shard.units.filter((u) => !u.pattern).map((u) => u.file).sort();
  return [...(whole.length ? [{ files: whole }] : []), ...shard.units.filter((u) => u.pattern).map((u) => ({ files: [u.file], pattern: u.pattern }))];
}

const vitest = (args) => spawnSync(join(api, 'node_modules/.bin/vitest'), args, { cwd: api, stdio: 'inherit', env: process.env }).status ?? 1;
const which = (args) => {
  const [shard, of] = args.map(Number);
  if (!(of >= 1 && shard >= 1 && shard <= of)) { console.error('Expected <shard> <of>, as in 3 10'); process.exit(2); }
  return [shard, of];
};
const json = (dir, prefix) => readdirSync(dir, { recursive: true }).map(String).filter((f) => f.split('/').at(-1)?.startsWith(prefix) && f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
/** Each test a report says ran, as file, its full name, status and milliseconds. */
const results = (reports) => reports.flatMap((r) => (r.testResults ?? []).flatMap((f) => (f.assertionResults ?? []).map((t) => ({
  file: underApi(f.name), name: [...(t.ancestorTitles ?? []), t.title].join(' > '), status: t.status, ms: t.duration ?? 0
}))));

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'plan': {
    const [shard, of] = which(args);
    const s = plan(of)[shard - 1];
    console.log(JSON.stringify({ shard, of, seconds: Math.round(s.seconds), runs: runs(s) }, null, 2));
    break;
  }
  case 'run': {
    const [shard, of] = which(args);
    const out = resolve(process.env['REPORTS'] ?? join(root, 'ci-reports'));
    mkdirSync(out, { recursive: true });
    // Everything vitest finds to run, for the check that each test ran once.
    if (vitest(['list', `--json=${join(out, `list-${shard}.json`)}`]) !== 0) process.exit(1);
    const mine = runs(plan(of)[shard - 1]);
    let failed = 0;
    mine.forEach((r, i) => {
      console.log(`\n▶ ${shard}/${of}, run ${i + 1} of ${mine.length}: ${r.files.join(' ')}${r.pattern ? `  -t ${r.pattern}` : ''}\n`);
      const status = vitest(['run', ...r.files, ...(r.pattern ? ['-t', r.pattern] : []), '--reporter=default', '--reporter=json', `--outputFile.json=${join(out, `shard-${shard}-${i + 1}.json`)}`]);
      if (status !== 0) failed += 1;
    });
    process.exit(failed ? 1 : 0);
  }
  case 'check': {
    const dir = resolve(args[0] ?? 'reports');
    const lists = json(dir, 'list-');
    if (!lists.length) { console.error(`No test list in ${dir}: no runner got as far as listing the tests.`); process.exit(1); }
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
    for (const t of results(json(dir, 'shard-'))) {
      if (t.status !== 'passed' && t.status !== 'failed') continue;
      const k = `${t.file} › ${t.name}`;
      const template = exact.has(k) ? undefined : templates.find((x) => x.file === t.file && x.re.test(t.name));
      if (!exact.has(k) && !template) unknown.push(k);
      if (template) template.runs += 1;
      ran.set(k, (ran.get(k) ?? 0) + 1);
      if (t.status === 'failed') failed.push(k);
    }
    const missing = [...[...exact].filter((k) => !ran.has(k)), ...templates.filter((x) => !x.runs).map((x) => x.key)];
    const twice = [...ran].filter(([, n]) => n > 1).map(([k]) => k);
    const show = (title, ks) => { if (ks.length) console.error(`${title} (${ks.length}):\n${ks.slice(0, 40).map((k) => `  ${k}`).join('\n')}`); };
    show('Listed but never run', missing);
    show('Failed', failed);
    show('Ran more than once', twice);
    show('Ran but not listed', unknown);
    if (missing.length || failed.length) process.exit(1);
    console.log(`All ${ran.size} integration tests ran, each once, and passed (${listed.size} as vitest lists them, an each's cases counted as one).`);
    break;
  }
  case 'times': {
    const dir = resolve(args[0] ?? 'reports');
    const times = {};
    for (const t of results(json(dir, 'shard-'))) {
      const f = (times[t.file] ??= { seconds: 0, groups: {} });
      const top = t.name.includes(' > ') ? t.name.split(' > ')[0] : '(top level)';
      f.seconds += t.ms / 1000;
      f.groups[top] = (f.groups[top] ?? 0) + t.ms / 1000;
    }
    const round = (n) => Math.round(n * 10) / 10;
    const sorted = Object.fromEntries(Object.keys(times).sort().map((f) => [f, { seconds: round(times[f].seconds), groups: Object.fromEntries(Object.entries(times[f].groups).map(([g, s]) => [g, round(s)])) }]));
    writeFileSync(TIMES, `${JSON.stringify(sorted, null, 1)}\n`);
    console.log(`Wrote the timings of ${Object.keys(sorted).length} files to scripts/ci-test-times.json.`);
    break;
  }
  default:
    console.error('Usage: node scripts/ci-tests.mjs plan|run <shard> <of>, or check|times <reports dir>');
    process.exit(2);
}
