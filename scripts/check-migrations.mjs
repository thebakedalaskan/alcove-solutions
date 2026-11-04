#!/usr/bin/env node
/**
 * Enforces AGENTS.md › Stored data survives every deploy: migrations only move forward.
 *   - A migration that's on the base branch never changes, and is never deleted or renamed: production has
 *     applied it, and the API refuses a database whose applied migrations differ from the repository's.
 *   - New migrations are named NNNN_lowercase_words.sql and numbered after every migration on the base branch.
 * The base is the pull request's target branch in CI, the previous commit on a push to main, and origin/main
 * locally. Locally, with no base to compare with, it says so and passes; in CI it fails.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const DIR = 'apps/api/migrations';
const NAME = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let base;
try {
  const target = process.env.GITHUB_BASE_REF;
  if (target) base = git('merge-base', 'HEAD', `origin/${target}`);
  else if (process.env.GITHUB_EVENT_NAME === 'push') base = git('rev-parse', 'HEAD^1');
  else base = git('merge-base', 'HEAD', 'origin/main');
} catch {
  if (process.env.CI) {
    console.error('Migration policy: no base commit to compare with. Check out with full history (fetch-depth: 0).');
    process.exit(1);
  }
  console.log('Migration policy skipped: no origin/main to compare with (git fetch origin main).');
  process.exit(0);
}

const problems = [];
const merged = new Map(
  git('ls-tree', base, '--', `${DIR}/`).split('\n').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    return [path.slice(DIR.length + 1), meta.split(' ')[2]];
  }).filter(([name]) => name.endsWith('.sql'))
);
const files = readdirSync(join(root, DIR)).filter((f) => f.endsWith('.sql')).sort();
const short = base.slice(0, 10);

for (const [name, blob] of merged) {
  if (!files.includes(name)) problems.push(`${DIR}/${name} was deleted or renamed. Production has applied it, so it stays as it is: restore it (git checkout ${short} -- ${DIR}/${name}).`);
  else if (git('hash-object', `${DIR}/${name}`) !== blob) problems.push(`${DIR}/${name} changed after it was merged. Production has applied it, so it never changes: restore it (git checkout ${short} -- ${DIR}/${name}) and make the change in a new migration.`);
}
const last = Math.max(0, ...[...merged.keys()].map((f) => Number(NAME.exec(f)?.[1] ?? 0)));
const numbers = new Map();
for (const f of files) {
  const m = NAME.exec(f);
  if (!m) { problems.push(`${DIR}/${f}: name migrations NNNN_lowercase_words.sql.`); continue; }
  const n = Number(m[1]);
  if (numbers.has(n)) problems.push(`${DIR}/${f}: ${m[1]} is already ${numbers.get(n)}; number it after ${String(last).padStart(4, '0')}.`);
  numbers.set(n, f);
  if (!merged.has(f) && n <= last) problems.push(`${DIR}/${f}: number it after ${String(last).padStart(4, '0')}, the last migration on the base branch (main moved on: renumber yours).`);
}

if (problems.length) {
  console.error('Migration policy violations (see AGENTS.md › Stored data survives every deploy):\n' + problems.map((x) => `  - ${x}`).join('\n'));
  process.exit(1);
}
console.log(`Migration policy OK: ${files.length} migration${files.length === 1 ? '' : 's'}, ${files.length - merged.size} new since ${short}.`);
