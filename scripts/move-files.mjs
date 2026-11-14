#!/usr/bin/env node
/**
 * Moves files and rewrites everything that reaches them, so a folder can be split in one step.
 *
 *   node scripts/move-files.mjs <from> <to> [<from> <to> …]
 *   node scripts/move-files.mjs --map <moves.json>      a JSON list of [from, to] pairs, from the repository root
 *   add --dry to see what would change without changing anything
 *
 * A `from` that's a folder moves everything in it. For every tracked file the script:
 * - rewrites imports, re-exports, `import()`, `import type` and `require()` that reach a moved file, keeping their form:
 *   relative stays relative, `~/` (the web app's alias, which Storybook shares) stays `~/`, and no extension is added;
 * - rewrites a moved file's own relative imports, CSS `@import` and `@source`, and any other relative path string with an
 *   extension that names a moved file (Storybook's module replacements, a worker's `new URL(…, import.meta.url)`);
 * - renames moved test files' keys in scripts/ci-test-times.json;
 * - replaces mentions of a moved file's path in docs, AGENTS.md, skills, comments, JSON and YAML: the full path, and every
 *   shorter form (`features/calls/boards.ts`, `calls/boards.ts`) that only that file's path ends with.
 * Plans and specs under docs/superpowers/ and the old move map are records of their time, and are left as they are.
 * It lists what it couldn't decide. Run `pnpm check:structure` and `pnpm typecheck` after.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript-parser');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const fail = (message) => {
  console.error(`move-files: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const rest = args.filter((a) => a !== '--dry');
/** @type {[string, string][]} */
let pairs = [];
if (rest[0] === '--map') {
  if (!rest[1]) fail('--map needs a file');
  pairs = JSON.parse(readFileSync(resolve(process.cwd(), rest[1]), 'utf8'));
} else {
  if (rest.length === 0 || rest.length % 2 !== 0) fail('give <from> <to> pairs, or --map <moves.json>');
  for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
}

const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const isTracked = new Set(tracked);
const clean = (p) => posix.normalize(p).replace(/^\.\//, '').replace(/\/$/, '');

/** Every file that moves, from its path now to its path after. */
const moves = new Map();
const add = (from, to) => {
  if (moves.has(from)) fail(`${from} is moved twice`);
  moves.set(from, to);
};
for (const [rawFrom, rawTo] of pairs) {
  const from = clean(rawFrom);
  const to = clean(rawTo);
  if (isTracked.has(from)) {
    add(from, to);
    continue;
  }
  const inside = tracked.filter((f) => f.startsWith(`${from}/`));
  if (inside.length === 0) fail(`${from}: no tracked file or folder there`);
  for (const f of inside) add(f, `${to}/${f.slice(from.length + 1)}`);
}
const landing = new Set();
for (const [from, to] of moves) {
  if (from === to) fail(`${from} moves onto itself`);
  if (landing.has(to)) fail(`two files would move to ${to}`);
  landing.add(to);
  if (isTracked.has(to) && !moves.has(to)) fail(`${to} is already there`);
}
const after = (path) => moves.get(path) ?? path;

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const WEB_SRC = 'apps/web/src';
const usesTilde = (importer) => importer.startsWith('apps/web/') || importer.startsWith('apps/storybook/');

/** The tracked file a specifier lands on, and how it was spelled: exactly, without its extension, or as its folder. */
function land(importer, spec) {
  const at = spec.search(/[?#]/);
  const bare = at >= 0 ? spec.slice(0, at) : spec;
  const query = at >= 0 ? spec.slice(at) : '';
  let base;
  if (bare.startsWith('~/') && usesTilde(importer)) base = posix.join(WEB_SRC, bare.slice(2));
  else if (bare === '.' || bare === '..' || bare.startsWith('./') || bare.startsWith('../')) base = posix.normalize(posix.join(posix.dirname(importer), bare));
  else return undefined;
  if (isTracked.has(base)) return { target: base, form: 'exact', query, ext: '' };
  for (const ext of EXTENSIONS) if (isTracked.has(base + ext)) return { target: base + ext, form: 'bare', query, ext };
  for (const ext of EXTENSIONS) if (isTracked.has(`${base}/index${ext}`)) return { target: `${base}/index${ext}`, form: 'folder', query, ext };
  return undefined;
}

/** The specifier spelled from where the importer will be to where the target will be, in the form it had. */
function respell(importer, spec, found) {
  const from = after(importer);
  const to = after(found.target);
  if (from === importer && to === found.target) return spec;
  const path = found.form === 'folder' ? posix.dirname(to) : found.form === 'bare' ? to.slice(0, -found.ext.length) : to;
  if (spec.startsWith('~/') && usesTilde(importer) && path.startsWith(`${WEB_SRC}/`)) return `~/${path.slice(WEB_SRC.length + 1)}${found.query}`;
  let rel = posix.relative(posix.dirname(from), path);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return `${rel}${found.query}`;
}

/** String literals that name modules (or, with an extension, files), with where their text starts and ends. */
function literals(path, text) {
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const seen = new Set();
  const push = (lit, module) => {
    const start = lit.getStart(sf) + 1;
    if (seen.has(start)) return;
    seen.add(start);
    found.push({ start, end: lit.getEnd() - 1, spec: lit.text, module });
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) push(node.moduleSpecifier, true);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) push(node.argument.literal, true);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first)) push(first, true);
    } else if (ts.isStringLiteralLike(node) && /^\.\.?\//.test(node.text) && /\.[a-z]+$/i.test(node.text)) push(node, false);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const contents = new Map();
const rewrites = [];
const unresolved = [];
const urls = [];

for (const path of tracked) {
  if (!CODE.test(path) || path.endsWith('routeTree.gen.ts')) continue;
  const text = read(path);
  const edits = [];
  for (const lit of literals(path, text)) {
    const found = land(path, lit.spec);
    if (!found) {
      if (lit.module && moves.has(path) && /^(?:\.\.?\/|~\/)/.test(lit.spec)) unresolved.push(`${path}: ${lit.spec}`);
      continue;
    }
    if (!lit.module && !moves.has(found.target) && !moves.has(path)) continue;
    const next = respell(path, lit.spec, found);
    if (next !== lit.spec) {
      edits.push({ ...lit, next });
      if (!lit.module) urls.push(`${path}: '${lit.spec}' → '${next}'`);
    }
  }
  if (moves.has(path) && /new URL\(\s*['"]\.{1,2}\//.test(text)) urls.push(`${path}: has new URL(…, import.meta.url); check it still lands where it should`);
  if (edits.length) {
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.next + out.slice(e.end);
    contents.set(path, out);
    rewrites.push(...edits.map((e) => `${path}: ${e.spec} → ${e.next}`));
  }
}

const CSS_REF = /@(import|source)\s+(?:url\(\s*)?(["'])([^"']+)\2/g;
for (const path of tracked.filter((p) => p.endsWith('.css'))) {
  const text = read(path);
  let changed = false;
  const out = text.replace(CSS_REF, (whole, kind, quote, spec) => {
    if (!/^\.\.?\//.test(spec)) return whole;
    const target = posix.normalize(posix.join(posix.dirname(path), spec));
    if (!isTracked.has(target)) {
      if (moves.has(path)) unresolved.push(`${path}: @${kind} ${spec}`);
      return whole;
    }
    const to = after(target);
    if (to === target && !moves.has(path)) return whole;
    let rel = posix.relative(posix.dirname(after(path)), to);
    if (!rel.startsWith('.')) rel = `./${rel}`;
    if (rel === spec) return whole;
    changed = true;
    rewrites.push(`${path}: @${kind} ${spec} → ${rel}`);
    return whole.replace(spec, rel);
  });
  if (changed) contents.set(path, out);
}

const TIMES = 'scripts/ci-test-times.json';
const API = 'apps/api/';
if (isTracked.has(TIMES)) {
  const raw = contents.get(TIMES) ?? read(TIMES);
  const times = JSON.parse(raw);
  let renamed = 0;
  const next = {};
  for (const [key, value] of Object.entries(times)) {
    const moved = moves.get(`${API}${key}`);
    if (moved && moved.startsWith(API)) renamed++;
    next[moved && moved.startsWith(API) ? moved.slice(API.length) : key] = value;
  }
  if (renamed) contents.set(TIMES, `${JSON.stringify(next, null, 1)}${raw.endsWith('\n') ? '\n' : ''}`);
}

/** Every shorter form of a moved path that no other tracked path ends with, longest first, with what it becomes. */
const mentions = new Map();
const endsWith = (form) => tracked.filter((f) => f === form || f.endsWith(`/${form}`)).length;
for (const [from, to] of moves) {
  const old = from.split('/');
  const next = to.split('/');
  let common = 0;
  while (common < old.length - 1 && common < next.length - 1 && old[common] === next[common]) common++;
  for (let i = 0; i <= old.length - 2; i++) {
    const form = old.slice(i).join('/');
    if (i > 0 && endsWith(form) !== 1) continue;
    const replacement = i < common ? next.slice(i).join('/') : next.slice(common).join('/');
    if (!mentions.has(form)) mentions.set(form, replacement);
  }
}
const TEXT = /\.(?:md|mdx|json|ya?ml|[cm]?[jt]sx?|css|sh|toml)$/;
const RECORDS = (path) => path.startsWith('docs/superpowers/') || path === 'docs/engineering/folder-move-map.md' || path === TIMES || path === 'pnpm-lock.yaml' || path.endsWith('routeTree.gen.ts');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forms = [...mentions.keys()].sort((a, b) => b.length - a.length);
const docEdits = [];
if (forms.length) {
  // A full path from the root may follow anything that isn't part of a name (`$TURBO_ROOT$/apps/…`, `../../apps/…`).
  // A shorter form starts a path or follows `./` or `../`; it never starts in the middle of a longer path.
  const full = forms.filter((form) => moves.has(form));
  const short = forms.filter((form) => !moves.has(form));
  const alternatives = [];
  if (full.length) alternatives.push(`(?<![\\w.$-])(?:${full.map(escape).join('|')})(?![\\w/-])`);
  if (short.length) alternatives.push(`(?<![\\w.$-])(?<!(?:^|[^.])\\/)(?:${short.map(escape).join('|')})(?![\\w/-])`);
  const pattern = new RegExp(alternatives.join('|'), 'g');
  for (const path of tracked) {
    if (!TEXT.test(path) || RECORDS(path)) continue;
    const text = contents.get(path) ?? read(path);
    let count = 0;
    const out = text.replace(pattern, (form) => {
      count++;
      return mentions.get(form) ?? form;
    });
    if (count) {
      contents.set(path, out);
      docEdits.push(`${path}: ${count}`);
    }
  }
}

/** A renamed file still named by its old name alone somewhere: words can't say which file a bare name means. */
const renamed = [...moves].filter(([from, to]) => posix.basename(from) !== posix.basename(to));
const leftovers = [];
for (const [from] of renamed) {
  const name = posix.basename(from);
  const bare = new RegExp(`(?<![\\w.$/-])${escape(name)}(?![\\w-])`);
  for (const path of tracked) {
    if (!TEXT.test(path) || RECORDS(path) || moves.has(path) && path === from) continue;
    if (bare.test(contents.get(path) ?? read(path))) leftovers.push(`${path}: ${name}`);
  }
}

console.log(`${dry ? 'Would move' : 'Moving'} ${moves.size} files; ${rewrites.length} imports and paths rewritten; mentions changed in ${docEdits.length} files.`);
if (leftovers.length) console.log(`Old names still mentioned on their own (say which file is meant, by its new name):\n${leftovers.map((l) => `  ${l}`).join('\n')}`);
if (process.env.MOVE_VERBOSE) for (const line of [...rewrites, ...docEdits]) console.log(`  ${line}`);
if (urls.length) console.log(`Check these paths by hand:\n${urls.map((u) => `  ${u}`).join('\n')}`);
if (unresolved.length) console.log(`Not followed (they don't land on a tracked file; check they still resolve):\n${unresolved.map((u) => `  ${u}`).join('\n')}`);
if (dry) process.exit(0);

for (const [from, to] of moves) {
  mkdirSync(dirname(resolve(root, to)), { recursive: true });
  git('mv', from, to);
}
for (const [path, text] of contents) writeFileSync(resolve(root, after(path)), text);
