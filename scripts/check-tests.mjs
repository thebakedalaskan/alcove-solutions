#!/usr/bin/env node
/**
 * Enforces the testing policy in AGENTS.md:
 *   - Integration tests only: files must be named *.integration.test.ts(x).
 *   - No unit tests, no *.spec files, no Storybook stories.
 *   - No browser test tooling (Playwright, Cypress, Puppeteer, Storybook, jsdom, happy-dom,
 *     Testing Library, Vitest browser mode).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.git', '.turbo', '.output', 'dist', '.tanstack', '.nitro', 'docs']);
const BANNED_DEPS = [/^@storybook\//, /^storybook$/, /^@playwright\//, /^playwright/, /^cypress/, /^puppeteer/, /^@testing-library\//, /^jsdom$/, /^happy-dom$/, /^@vitest\/browser/, /^webdriverio$/, /^@web\/test-runner/];
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const rel = relative(root, p);
    if (statSync(p).isDirectory()) {
      if (name === '.storybook' || name === '__tests__' || name === 'e2e' || name === 'playwright' || name === 'cypress') problems.push(`${rel}/: directory not allowed (integration tests only, no browser or Storybook tests)`);
      walk(p);
      continue;
    }
    if (/\.stories\.[cm]?[jt]sx?$|\.mdx$/.test(name)) problems.push(`${rel}: Storybook stories are not allowed`);
    if (/\.spec\.[cm]?[jt]sx?$/.test(name)) problems.push(`${rel}: *.spec files are not allowed; write an *.integration.test.ts`);
    if (/\.test\.[cm]?[jt]sx?$/.test(name) && !/\.integration\.test\.[cm]?[jt]sx?$/.test(name)) problems.push(`${rel}: unit tests are not allowed; rename to *.integration.test.ts and test a whole flow`);
    if (name === 'package.json') {
      const pkg = JSON.parse(readFileSync(p, 'utf8'));
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
        if (BANNED_DEPS.some((r) => r.test(dep))) problems.push(`${rel}: dependency "${dep}" is browser/Storybook test tooling and is not allowed`);
      }
    }
    if (/^vitest\.(config|workspace)\.[cm]?[jt]s$/.test(name) && /\bbrowser\s*:/.test(readFileSync(p, 'utf8'))) problems.push(`${rel}: Vitest browser mode is not allowed`);
  }
}
walk(root);
if (problems.length) {
  console.error('Test policy violations (see AGENTS.md › Testing):\n' + problems.map((x) => `  - ${x}`).join('\n'));
  process.exit(1);
}
console.log('Test policy OK: integration tests only.');
