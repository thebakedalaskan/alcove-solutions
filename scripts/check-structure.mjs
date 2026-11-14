#!/usr/bin/env node
/**
 * The repository's structure rules: who owns which folder, which way code may depend, how many files one folder holds,
 * and how files are named. Why each rule exists, and what to do when one fails, is in docs/engineering/folder-ownership.md
 * and the code-structure skill (.claude/skills/code-structure/SKILL.md). File length is not a rule here.
 *
 *   node scripts/check-structure.mjs              every rule, everywhere
 *   node scripts/check-structure.mjs <path> …     only what's wrong in files under these paths (the check still reads all)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript-parser');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', 'dist', '.output', '.turbo', '.tanstack', '.nitro', 'storybook-static']);
const only = process.argv.slice(2).map((p) => p.replace(/\/$/, ''));
const problems = [];
const posix = (path) => path.split(sep).join('/');
const under = (path, parent) => path.startsWith(`${parent}/`);
const source = /\.(?:ts|tsx|mts|cts)$/;
const counted = /\.(?:ts|tsx|mts|cts|css|mjs)$/;
const isTest = (path) => /\.test\.[cm]?tsx?$/.test(path);
const isStory = (path) => /\.stories\.tsx?$/.test(path);
const problem = (path, message) => problems.push({ path, message });

/** A running call's and the call list's subfeatures: neither root holds source of its own. */
const callHomes = {
  call: new Set(['session', 'media', 'screen-sharing', 'layout', 'stage', 'chat', 'attention', 'timer', 'notes', 'rooms', 'workspace', 'boards', 'playback', 'floating']),
  calls: new Set(['flow', 'scheduling', 'lobby', 'ringing', 'list'])
};
/**
 * The server's features, lowest first. A feature imports only features before it here; a flow that needs one later in
 * the list takes it as an argument from whoever composes it, or is composed above the features (app.ts, start.ts,
 * maintenance.ts and the CLIs). `profile` is who someone is, which everything shows; `account` is an account's whole life
 * (signing in, its sessions, deleting it), which reaches into everything, so it comes last.
 */
const serverOrder = ['profile', 'billing', 'workspaces', 'meetings', 'recordings', 'notes', 'calls', 'agents', 'account'];
const serverHomes = new Set(serverOrder);
/** apps/api/src itself holds only what composes the features and what the build runs. */
const serverRoot = new Set(['app.ts', 'server.ts', 'start.ts', 'maintenance.ts', 'migrate.ts', 'migrate-cli.ts', 'limits-cli.ts', 'feature-flags-cli.ts', 'billing-cli.ts']);
/** Shared server homes: the features build on these, and these never import a feature. */
const serverShared = new Set(['platform', 'keys', 'tee', 'inference', 'providers', 'http', 'live', 'edge']);
const contractRoot = new Set(['index.ts', 'client.ts', 'errors.ts', 'format.ts', 'search.ts']);
const sourceHomes = {
  'apps/api/src': new Set([...serverShared, 'features', 'integration', 'testing']),
  'packages/api/src': new Set(['identity', 'feature-flags', 'agents', 'meetings', 'calls', 'notes', 'recordings', 'workspaces', 'trust', 'plans', 'teams', 'telemetry', 'shared']),
  'packages/api-http/src': new Set(['transport', 'account', 'agents', 'meetings', 'calls', 'notes', 'recordings', 'workspaces', 'trust'])
};
/** The deliberate public entries: the only index files, and the only files that may `export *`. */
const packageEntries = new Set(['packages/api/src/index.ts', 'packages/api-http/src/index.ts', 'packages/ui/src/index.ts', 'packages/board/src/index.ts']);
/** Folders whose files are counted and named by these rules. Routes follow TanStack Router's own naming. */
const sourceRoots = ['apps/api/src', 'apps/web/src', 'apps/storybook/src', 'apps/storybook/stories', 'packages/api/src', 'packages/api-http/src', 'packages/board/src', 'packages/ui/src', 'infra/confidential-space'];
const routes = 'apps/web/src/routes';
/** The most files one folder holds directly. Past it, the folder is a list to scroll, not a map: group what belongs together. */
const MAX_FILES = 20;
/** Files in one folder whose names start with the same word: from this many, that word is a folder of its own. */
const MAX_PREFIX = 4;
/** The most effects one component or hook owns. Past it, lifecycles want hooks of their own, with their own cleanup. */
const MAX_EFFECTS = 10;
/** The most pieces of state (useState, useReducer) one component or hook keeps. Past it, it's several components in one. */
const MAX_STATE = 15;
/** Route files declare a route and render a feature's page; state, effects and refs belong to the feature. */
const ROUTE_HOOKS = new Set(['useState', 'useReducer', 'useRef', 'useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useSyncExternalStore']);

function files(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (skip.has(name)) return [];
    const path = resolve(dir, name);
    return statSync(path).isDirectory() ? files(path) : [posix(relative(root, path))];
  });
}

const all = [...files(resolve(root, 'apps')), ...files(resolve(root, 'packages')), ...files(resolve(root, 'infra/confidential-space'))];
const sources = all.filter((path) => source.test(path) && !path.endsWith('routeTree.gen.ts'));
const known = new Set(all);

/** The file an import lands on, or undefined for a package or anything that isn't a source file here. */
function land(from, spec) {
  let base;
  if (spec.startsWith('~/') && (under(from, 'apps/web') || under(from, 'apps/storybook'))) base = `apps/web/src/${spec.slice(2)}`;
  else if (spec.startsWith('.')) base = posix(relative(root, resolve(root, dirname(from), spec)));
  else return undefined;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (known.has(candidate) && source.test(candidate)) return candidate;
  return undefined;
}

/** Who owns a file, for the cycle rule: a feature, a shared home, or a package's top folder. */
function owner(path) {
  const parts = path.split('/');
  if (parts[0] === 'apps') {
    const app = parts[1];
    const at = parts[2] === 'src' || parts[2] === 'stories' ? 3 : 2;
    if (parts[at] === 'features' && parts.length > at + 2) return `${app}:${parts[at + 1]}`;
    return parts.length > at + 1 ? `${app}:${parts[at]}` : `${app}:root`;
  }
  if (parts[0] === 'packages') return parts.length > 4 ? `${parts[1]}:${parts[3]}` : `${parts[1]}:root`;
  return parts.slice(0, 2).join('/');
}
const serverFeature = (path) => (under(path, 'apps/api/src/features') ? path.split('/')[4] : undefined);
const serverHome = (path) => (under(path, 'apps/api/src') && path.split('/').length > 4 ? path.split('/')[3] : undefined);
const webFeature = (path) => (under(path, 'apps/web/src/features') ? path.split('/')[4] : undefined);

function location(path) {
  for (const [prefix, homes] of Object.entries(sourceHomes)) {
    if (!under(path, prefix)) continue;
    const parts = path.slice(prefix.length + 1).split('/');
    if (parts.length > 1 && !homes.has(parts[0])) problem(path, 'use a documented source owner; do not recreate a flat modules or services bucket');
  }
  for (const [feature, homes] of Object.entries(callHomes)) {
    const prefix = `apps/web/src/features/${feature}`;
    if (!under(path, prefix)) continue;
    const parts = path.slice(prefix.length + 1).split('/');
    if (parts.length < 2 || !homes.has(parts[0])) problem(path, `choose an owned ${feature} subfeature from folder-ownership.md; do not grow the flat feature root`);
  }
  if (under(path, 'apps/api/src/modules')) problem(path, 'the old modules bucket is retired; use src/features/<owner>');
  if (under(path, 'apps/api/src/features')) {
    const parts = path.slice('apps/api/src/features/'.length).split('/');
    if (parts.length < 2 || !serverHomes.has(parts[0])) problem(path, 'choose a documented server feature owner');
  }
  if (dirname(path) === 'apps/api/src' && !serverRoot.has(path.split('/').at(-1))) {
    problem(path, 'apps/api/src holds only composition and build entries; shared code goes in platform, keys, tee, inference, providers, http, live or edge, and feature code in features/<owner>');
  }
  if (dirname(path) === 'packages/api/src' && !contractRoot.has(path.split('/').at(-1))) problem(path, 'put feature contracts in their owning folder; shared root entries are deliberate');
  if (dirname(path) === 'packages/api-http/src' && path !== 'packages/api-http/src/index.ts') problem(path, 'HTTP implementations belong to a feature or transport, not the composition root');
  if (path.split('/').some((part) => /^(?:utils|common|misc|helpers|shared-utils)$/.test(part))) problem(path, 'name a concrete responsibility instead of a miscellaneous helper bucket');
  if (/\/index\.[cm]?tsx?$/.test(path) && !packageEntries.has(path) && !under(path, routes)) problem(path, 'import owning files directly; only deliberate package entry points use index files');
}

/** One naming style per area, so a name says what a file is before it's opened. */
function naming(path) {
  if (!sourceRoots.some((r) => under(path, r)) || under(path, routes) || /\.d\.ts$/.test(path) || path.endsWith('.gen.ts')) return;
  const name = path.split('/').at(-1);
  const folders = path.split('/').slice(0, -1);
  const rootDepth = sourceRoots.find((r) => under(path, r)).split('/').length;
  for (const folder of folders.slice(rootDepth)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folder)) {
      problem(path, `folder "${folder}": folders are kebab-case (lowercase words joined by hyphens)`);
      return;
    }
  }
  if (!counted.test(name)) return;
  if (under(path, 'apps/web/src')) {
    if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[a-z][a-z0-9]*)*\.(?:ts|tsx|css)$/.test(name)) problem(path, `"${name}": in the web app a component file is PascalCase.tsx and any other file camelCase (no hyphens)`);
    else if (/^[A-Z]/.test(name) && !name.endsWith('.tsx')) problem(path, `"${name}": a PascalCase file holds a component, so it's .tsx; anything else is camelCase`);
    return;
  }
  if (under(path, 'apps/storybook/stories')) {
    if (isStory(path) && !/^(?:[A-Z][A-Za-z0-9]*|\d{2}[a-z]?-[a-z0-9]+(?:-[a-z0-9]+)*)\.stories\.tsx$/.test(name)) problem(path, `"${name}": a story file is named for what it shows, PascalCase, or for a journey, NN-kebab-case`);
    if (!isStory(path) && !/^[a-z0-9]+(?:-[a-z0-9]+)*\.[cm]?tsx?$/.test(name)) problem(path, `"${name}": Storybook's helper files are kebab-case`);
    return;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)*\.(?:[cm]?tsx?|css|mjs)$/.test(name)) problem(path, `"${name}": files here are kebab-case (lowercase words joined by hyphens)`);
}

/** Includes static imports, re-exports, dynamic imports, import types and require calls. */
function moduleName(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier.text;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) return node.argument.literal.text;
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
    const first = node.arguments[0];
    if (first && ts.isStringLiteralLike(first)) return first.text;
  }
  return undefined;
}

/** Whether an import brings in types alone, which tie compiling together but not running. */
function typeOnly(node) {
  if (ts.isImportTypeNode(node)) return true;
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const named = clause.namedBindings;
    return !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
  }
  if (ts.isExportDeclaration(node)) return node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly));
  return false;
}

function imports(path, spec, report, pos) {
  const target = spec.startsWith('~/') && under(path, 'apps/web/src')
    ? `apps/web/src/${spec.slice(2)}`
    : spec.startsWith('.') ? posix(relative(root, resolve(root, dirname(path), spec))) : spec;
  const fromContract = under(path, 'packages/api/src');
  const fromClient = under(path, 'packages/api-http/src');
  const fromUi = under(path, 'packages/ui/src');
  const fromBoard = under(path, 'packages/board/src');
  const appTarget = target.startsWith('apps/') || /(?:^|\/)apps\//.test(target) || /^@alcove\/(?:server|web|storybook)(?:\/|$)/.test(target);
  if ((fromContract || fromClient || fromUi || fromBoard) && appTarget) report(pos, 'packages cannot depend on app internals');
  if (fromContract && (target.startsWith('@alcove/api-http') || target.startsWith('@alcove/ui') || target.startsWith('packages/api-http/') || target.startsWith('packages/ui/'))) {
    report(pos, 'contracts cannot depend on HTTP implementations or visuals');
  }
  if (fromClient && (target.startsWith('@alcove/ui') || target.startsWith('packages/ui/'))) report(pos, 'the HTTP client cannot depend on visuals');
  if (under(path, 'apps/web/src') && (target.startsWith('apps/api/') || /^@alcove\/server(?:\/|$)/.test(target) || target.startsWith('packages/api-http/') || (spec.startsWith('@alcove/api-http') && path !== 'apps/web/src/lib/api.ts'))) {
    report(pos, 'web backend access goes through src/lib/api.ts and the contract/query layers');
  }
  if (path === 'apps/web/src/routes/call.$code.tsx' && target !== '@tanstack/react-router' && !target.startsWith('apps/web/src/features/call/session/')) {
    report(pos, 'the call route delegates to its session page; media, capture and presentation imports belong in the feature');
  }
}

/** Dependency direction: which way one owner may reach another. Tests sit above everything and are exempt. */
function direction(from, to, report, pos) {
  if (isTest(from)) return;
  const a = serverFeature(from);
  const b = serverFeature(to);
  if (a && b && a !== b && serverOrder.indexOf(b) > serverOrder.indexOf(a)) {
    report(pos, `the ${a} feature may not import ${b}: a server feature imports only those before it (${serverOrder.join(' → ')}); take what you need from ${b} as an argument, or move the shared piece down to the feature that owns its data`);
  }
  const home = serverHome(from);
  if (home && serverShared.has(home) && b) report(pos, `${home}/ is shared and never imports a feature (here ${b}); have the feature pass it in, or compose it in app.ts or start.ts`);
  if (under(from, 'apps/web/src/lib') && under(to, 'apps/web/src/features')) report(pos, `lib/ is shared by every feature and never imports one (here ${webFeature(to)}); move this to the feature, or pass it in`);
  if (under(from, 'apps/web/src/features') && under(to, routes)) report(pos, 'features never import route files; routes compose features');
}

const edges = new Map();
const addEdge = (from, to) => {
  if (!edges.has(from)) edges.set(from, new Set());
  edges.get(from).add(to);
};

for (const path of sources) {
  location(path);
  naming(path);
  const text = readFileSync(resolve(root, path), 'utf8');
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (pos, message) => {
    const at = sf.getLineAndCharacterOfPosition(pos);
    problem(path, `${at.line + 1}:${at.character + 1}: ${message}`);
  };
  const effects = new Map();
  const isRoute = under(path, routes);
  const visit = (node, fn) => {
    let within = fn;
    if (ts.isFunctionDeclaration(node) || ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent))) {
      const name = node.name?.text ?? (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : undefined);
      if (name && /^(?:use[A-Z]|[A-Z])/.test(name)) within = { name, pos: node.getStart(sf) };
    }
    const spec = moduleName(node);
    if (spec !== undefined) {
      imports(path, spec, report, node.getStart(sf));
      const to = land(path, spec);
      if (to) {
        direction(path, to, report, node.getStart(sf));
        if (!typeOnly(node) && !isTest(path)) addEdge(path, to);
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && (!node.exportClause || ts.isNamespaceExport(node.exportClause)) && !packageEntries.has(path)) {
      report(node.getStart(sf), 'wildcard re-export trees hide ownership; import the owning file directly and keep only deliberate package exports');
    }
    if (path === 'apps/api/src/app.ts' && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'app' && /^(?:get|post|put|patch|delete|options|head|all|on)$/.test(node.expression.name.text)) {
      report(node.getStart(sf), 'register HTTP handlers in the owning feature; app.ts composes registrars and shared middleware');
    }
    if (path === 'packages/api-http/src/index.ts' && (ts.isClassDeclaration(node) || (ts.isFunctionDeclaration(node) && node.name?.text !== 'createHttpApi'))) {
      report(node.getStart(sf), 'keep transport/session/feature behavior in its owner; index.ts only composes createHttpApi and public exports');
    }
    if (path === 'packages/api-http/src/index.ts' && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isNewExpression(node))) {
      report(node.getStart(sf), 'the client composition entry cannot own inline callbacks, methods or session resources; use an imported feature factory');
    }
    if (path === 'apps/web/src/routes/call.$code.tsx' && ts.isNewExpression(node)) report(node.getStart(sf), 'construct session resources in the owning feature, not the route');
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const called = node.expression.text;
      if (isRoute && ROUTE_HOOKS.has(called)) report(node.getStart(sf), `${called} in a route file: a route declares itself and renders its feature's page; state, effects and refs live in the feature`);
      if (within && (called === 'useEffect' || called === 'useLayoutEffect' || called === 'useState' || called === 'useReducer')) {
        const key = `${within.name}@${within.pos}`;
        const seen = effects.get(key) ?? { ...within, count: 0, state: 0 };
        if (called === 'useState' || called === 'useReducer') seen.state++;
        else seen.count++;
        effects.set(key, seen);
      }
    }
    ts.forEachChild(node, (child) => visit(child, within));
  };
  visit(sf, undefined);
  if (under(path, 'apps/web/src') || under(path, 'packages/ui/src')) {
    for (const fn of effects.values()) {
      if (fn.count > MAX_EFFECTS) report(fn.pos, `${fn.name} owns ${fn.count} effects (at most ${MAX_EFFECTS}): give each lifecycle a hook of its own, beside the subfeature it belongs to, with explicit inputs and cleanup`);
      if (fn.state > MAX_STATE) report(fn.pos, `${fn.name} keeps ${fn.state} pieces of state (at most ${MAX_STATE}): it's several components in one; give each part of the screen a component, with the state it alone uses, in the subfeature it belongs to`);
    }
  }
}

/** Folders: at most MAX_FILES files each, and no word several file names start with that isn't the folder's own. */
const byFolder = new Map();
for (const path of all) {
  if (!counted.test(path) || !sourceRoots.some((r) => under(path, r)) || under(path, routes) || path.endsWith('.gen.ts') || /\.d\.ts$/.test(path)) continue;
  const folder = dirname(path);
  if (!byFolder.has(folder)) byFolder.set(folder, []);
  byFolder.get(folder).push(path);
}
const firstWord = (name) => name.replace(/^\d+[a-z]?-/, '').split(/[-._]|(?<=[a-z0-9])(?=[A-Z])/)[0].toLowerCase();
const singular = (word) => word.replace(/(?:ies)$/, 'y').replace(/(?<!s)s$/, '');
/** Whether two words are one family (share, sharing; ring, ringing): the folder's own word needs no folder of its own. */
const kin = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));
for (const [folder, inside] of byFolder) {
  if (inside.length > MAX_FILES) {
    problem(`${folder}/`, `holds ${inside.length} files (at most ${MAX_FILES}): group the ones that change together into subfolders named for what they do, and record each in folder-ownership.md`);
  }
  const own = folder.split('/').at(-1).replace(/^\d+[a-z]?-/, '').split('-').map(singular);
  const groups = new Map();
  for (const path of inside) {
    if (isTest(path) || isStory(path)) continue;
    const word = singular(firstWord(path.split('/').at(-1)));
    if (word === 'use' || word === 'index' || word.length < 3 || own.some((o) => kin(o, word))) continue;
    if (!groups.has(word)) groups.set(word, []);
    groups.get(word).push(path.split('/').at(-1));
  }
  for (const [word, names] of groups) {
    if (names.length >= MAX_PREFIX) problem(`${folder}/`, `${names.length} files start with "${word}" (${names.join(', ')}): that's a ${word}/ folder, so make it one`);
  }
}

/** Import cycles that cross owners: each tangles two owners into one, whatever the folders say. Runtime imports only. */
const index = new Map();
const low = new Map();
const stack = [];
const onStack = new Set();
const components = [];
let counter = 0;
function strongConnect(v) {
  index.set(v, counter);
  low.set(v, counter);
  counter++;
  stack.push(v);
  onStack.add(v);
  for (const w of edges.get(v) ?? []) {
    if (!index.has(w)) {
      strongConnect(w);
      low.set(v, Math.min(low.get(v), low.get(w)));
    } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const component = [];
    let w;
    do {
      w = stack.pop();
      onStack.delete(w);
      component.push(w);
    } while (w !== v);
    if (component.length > 1) components.push(component);
  }
}
for (const v of edges.keys()) if (!index.has(v)) strongConnect(v);
for (const component of components) {
  const members = new Set(component);
  const owners = [...new Set(component.map(owner))];
  if (owners.length < 2) continue;
  // One concrete loop through an edge between owners, so the fix has somewhere to start.
  let loop = [];
  for (const from of component) {
    const to = [...(edges.get(from) ?? [])].find((t) => members.has(t) && owner(t) !== owner(from));
    if (!to) continue;
    const back = new Map([[to, null]]);
    const queue = [to];
    while (queue.length && !back.has(from)) {
      const at = queue.shift();
      for (const next of edges.get(at) ?? []) {
        if (members.has(next) && !back.has(next)) {
          back.set(next, at);
          queue.push(next);
        }
      }
    }
    const way = [];
    for (let at = from; at !== null && at !== undefined; at = back.get(at)) way.unshift(at);
    loop = [from, ...way];
    break;
  }
  problem(component.sort()[0], `an import cycle of ${component.length} files ties together ${owners.join(', ')}: ${loop.join(' → ')}. Break the edge that points against the dependency direction in folder-ownership.md`);
}

const shown = only.length ? problems.filter((p) => only.some((o) => p.path === o || under(p.path, o) || p.path.startsWith(`${o}/`))) : problems;
if (shown.length) {
  console.error(`Structure policy violations (${shown.length}${only.length ? ` under ${only.join(', ')}; ${problems.length} in all` : ''}; see docs/engineering/folder-ownership.md):\n${shown.map((p) => `  ${p.path}: ${p.message}`).join('\n')}`);
  process.exit(1);
}
console.log(`Structure policy OK${only.length ? ` under ${only.join(', ')}` : ''}: ownership, dependency direction, folder size, naming and composition entries.`);
