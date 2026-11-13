#!/usr/bin/env node
/**
 * Enforces strict typing (see AGENTS.md › TypeScript). Parses every source file and rejects:
 *   - `any`, written anywhere
 *   - type assertions (`x as T`, `<T>x`), except `as const`
 *   - non-null assertions (`x!`)
 *   - `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, and lint-disable comments
 *   - `console.*` outside the two loggers (AGENTS.md › Logging): use `log` from apps/api/src/platform/log.ts or apps/web/src/lib/log.ts
 * Uses the TypeScript 6 parser for syntax only; type checking runs on TypeScript 7 (tsc) separately.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript-parser');
const root = new URL('..', import.meta.url).pathname;
// infra holds the deploy's own TypeScript (infra/confidential-space/verify-server.ts), held to the same rules.
const DIRS = ['apps', 'packages', 'infra'];
const SKIP = new Set(['node_modules', 'dist', '.output', '.turbo', '.tanstack', '.nitro']);
const GENERATED = /routeTree\.gen\.ts$/;
const problems = [];
/** The only files that may write to the console: the browser logger's sink. (The API logs through pino.) */
const CONSOLE_OK = new Set(['apps/web/src/lib/log.ts']);

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !GENERATED.test(name)) out.push(p);
  }
  return out;
}

for (const file of DIRS.flatMap((d) => files(join(root, d)))) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (pos, msg) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos);
    problems.push(`${relative(root, file)}:${line + 1}:${character + 1}  ${msg}`);
  };
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const m = /@ts-(ignore|expect-error|nocheck)|eslint-disable|biome-ignore|oxlint-disable/.exec(l);
    if (m) problems.push(`${relative(root, file)}:${i + 1}:${m.index + 1}  "${m[0]}" is not allowed; fix the type instead`);
  });
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node.getStart(), '`any` is not allowed; use a precise type, a generic, or `unknown` with narrowing');
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const t = node.type;
      const isConst = ts.isTypeReferenceNode(t) && t.typeName.getText(sf) === 'const';
      if (!isConst) report(node.getStart(), `type assertion \`${node.getText(sf).slice(0, 60)}\` is not allowed; narrow with a type guard, parse at the boundary, or use \`satisfies\``);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'console' && !CONSOLE_OK.has(relative(root, file)))
      report(node.getStart(), `\`${node.getText(sf)}\` is not allowed; use \`log\` (apps/api/src/platform/log.ts or apps/web/src/lib/log.ts) so it has a level, context and a request ID`);
    if (ts.isNonNullExpression(node)) report(node.getStart(), `non-null assertion \`${node.getText(sf).slice(0, 60)}\` is not allowed; handle the missing case`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (problems.length) {
  console.error(`Strict typing violations (${problems.length}, see AGENTS.md › TypeScript):\n` + problems.map((p) => `  ${p}`).join('\n'));
  process.exit(1);
}
console.log('Strict typing OK: no any, no assertions, no non-null assertions, no suppressions.');
