#!/usr/bin/env node
/** Objective ownership rules. See docs/engineering/folder-ownership.md; no file-size budgets. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript-parser');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', 'dist', '.output', '.turbo', '.tanstack', '.nitro', 'storybook-static']);
const problems = [];
const posix = (path) => path.split(sep).join('/');
const under = (path, parent) => path.startsWith(`${parent}/`);
const source = /\.(?:ts|tsx|mts|cts)$/;
const callHomes = {
  call: new Set(['session', 'media', 'screen-sharing', 'layout', 'notes', 'rooms', 'workspace', 'boards', 'playback']),
  calls: new Set(['flow', 'scheduling', 'lobby', 'ringing', 'list'])
};
const serverHomes = new Set(['account', 'agents', 'meetings', 'calls', 'notes', 'recordings', 'workspaces', 'billing']);
// Stable infrastructure and deployment entries, not a home for another feature implementation.
const serverRoot = new Set([
  'app.ts', 'callPass.ts', 'config.ts', 'context.ts', 'crypto.ts', 'db.ts', 'demo.ts', 'dstack-images.ts',
  'errors.ts', 'evidence.ts', 'google.ts', 'identity.ts', 'inference.ts', 'limits-cli.ts', 'limits.ts',
  'livekit.ts', 'log.ts', 'maintenance.ts', 'mediaToken.ts', 'migrate-cli.ts', 'migrate.ts', 'objects.ts',
  'ohttp.ts', 'owners.ts', 'roots.ts', 'server.ts', 'sessions.ts', 'tee.ts', 'vault.ts', 'zones.ts'
]);
const contractRoot = new Set(['index.ts', 'client.ts', 'errors.ts', 'format.ts', 'search.ts']);
const sourceHomes = {
  'apps/api/src': new Set(['features', 'http', 'integration', 'live', 'testing']),
  'packages/api/src': new Set(['identity', 'agents', 'meetings', 'calls', 'notes', 'recordings', 'workspaces', 'trust', 'credits', 'telemetry', 'shared']),
  'packages/api-http/src': new Set(['transport', 'account', 'agents', 'meetings', 'calls', 'notes', 'recordings', 'workspaces'])
};
const owned = [
  'apps/api/src/features', 'apps/web/src/features/call', 'apps/web/src/features/calls',
  'packages/api/src', 'packages/api-http/src'
];
const packageEntries = new Set(['packages/api/src/index.ts', 'packages/api-http/src/index.ts']);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const path = resolve(dir, name);
    return statSync(path).isDirectory() ? files(path) : [posix(relative(root, path))];
  });
}

function location(path) {
  for (const [prefix, homes] of Object.entries(sourceHomes)) {
    if (!under(path, prefix)) continue;
    const parts = path.slice(prefix.length + 1).split('/');
    if (parts.length > 1 && !homes.has(parts[0])) problems.push(`${path}: use a documented source owner; do not recreate a flat modules or services bucket`);
  }
  for (const [feature, homes] of Object.entries(callHomes)) {
    const prefix = `apps/web/src/features/${feature}`;
    if (!under(path, prefix)) continue;
    const parts = path.slice(prefix.length + 1).split('/');
    if (parts.length < 2 || !homes.has(parts[0])) {
      problems.push(`${path}: choose an owned ${feature} subfeature from folder-ownership.md; do not grow the flat feature root`);
    }
  }
  if (under(path, 'apps/api/src/modules')) problems.push(`${path}: the old modules bucket is retired; use src/features/<owner>`);
  if (under(path, 'apps/api/src/features')) {
    const parts = path.slice('apps/api/src/features/'.length).split('/');
    if (parts.length < 2 || !serverHomes.has(parts[0])) problems.push(`${path}: choose a documented server feature owner`);
  }
  if (dirname(path) === 'apps/api/src' && !serverRoot.has(path.split('/').at(-1))) {
    problems.push(`${path}: feature implementation and integration coverage belong in features/<owner>; cross-feature suites belong in integration`);
  }
  if (dirname(path) === 'packages/api/src' && !contractRoot.has(path.split('/').at(-1))) {
    problems.push(`${path}: put feature contracts in their owning folder; shared root entries are deliberate`);
  }
  if (dirname(path) === 'packages/api-http/src' && !packageEntries.has(path)) {
    problems.push(`${path}: HTTP implementations belong to a feature or transport, not the composition root`);
  }
  if (owned.some((parent) => under(path, parent))) {
    if (path.split('/').some((part) => /^(?:utils|common|misc|helpers)$/.test(part))) {
      problems.push(`${path}: name a concrete responsibility instead of a miscellaneous helper bucket`);
    }
    if (/\/index\.[cm]?tsx?$/.test(path) && !packageEntries.has(path)) {
      problems.push(`${path}: import owning files directly; only deliberate package entry points use index files`);
    }
  }
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

for (const path of [...files(resolve(root, 'apps')), ...files(resolve(root, 'packages'))].filter((path) => source.test(path) && !path.endsWith('routeTree.gen.ts'))) {
  location(path);
  const text = readFileSync(resolve(root, path), 'utf8');
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (pos, message) => {
    const at = sf.getLineAndCharacterOfPosition(pos);
    problems.push(`${path}:${at.line + 1}:${at.character + 1}: ${message}`);
  };
  const visit = (node) => {
    const spec = moduleName(node);
    if (spec !== undefined) imports(path, spec, report, node.getStart(sf));
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && (!node.exportClause || ts.isNamespaceExport(node.exportClause)) && owned.some((parent) => under(path, parent)) && !packageEntries.has(path)) {
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
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (problems.length) {
  console.error(`Structure policy violations (${problems.length}; see docs/engineering/folder-ownership.md):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('Structure policy OK: feature ownership, composition entries and package direction.');
