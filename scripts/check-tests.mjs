#!/usr/bin/env node
/**
 * Enforces the testing policy in AGENTS.md:
 *   - Integration tests only: files must be named *.integration.test.ts(x).
 *   - No unit tests, no *.spec files.
 *   - No browser test tooling (Playwright, Cypress, Puppeteer, jsdom, happy-dom, Testing Library, Vitest browser mode).
 *   - Storybook lives in apps/storybook alone, and it only shows: its packages, its `.storybook/` and `*.stories.tsx`
 *     are allowed there and nowhere else. Nothing in it checks anything: no Storybook test runner, Vitest addon or
 *     Chromatic, no Testing Library as a dependency, and no `expect(` in its source.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.git', '.turbo', '.output', 'dist', '.tanstack', '.nitro', 'docs', 'storybook-static']);
/** Where Storybook may be, and its config directory. */
const STORYBOOK = 'apps/storybook';
const STORYBOOK_CONFIG = `${STORYBOOK}/.storybook`;
/** Browser and Storybook test tooling: refused everywhere, apps/storybook included. */
const BANNED_DEPS = [
  /^@playwright\//, /^playwright/, /^cypress/, /^puppeteer/, /^@testing-library\//, /^jsdom$/, /^happy-dom$/, /^@vitest\/browser/, /^webdriverio$/, /^@web\/test-runner/,
  /^@storybook\/test-runner$/, /^@storybook\/addon-vitest$/, /^@storybook\/experimental-addon-test$/, /^chromatic$/, /^@chromatic-com\//
];
/** Storybook itself and its addons: only apps/storybook may depend on them. */
const STORYBOOK_DEP = /(^|[@/-])storybook($|[/-])/;
const problems = [];

const posix = (p) => p.split(sep).join('/');
const inStorybook = (rel) => rel === STORYBOOK || rel.startsWith(`${STORYBOOK}/`);

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const rel = posix(relative(root, p));
    if (statSync(p).isDirectory()) {
      if (name === '.storybook' && rel !== STORYBOOK_CONFIG) problems.push(`${rel}/: Storybook's config lives in ${STORYBOOK_CONFIG}/ only`);
      if (name === '__tests__' || name === 'e2e' || name === 'playwright' || name === 'cypress') problems.push(`${rel}/: directory not allowed (integration tests only, no browser tests)`);
      walk(p);
      continue;
    }
    if (/\.stories\.[cm]?[jt]sx?$/.test(name)) {
      if (!inStorybook(rel)) problems.push(`${rel}: stories live in ${STORYBOOK}/ only`);
      else if (!name.endsWith('.stories.tsx')) problems.push(`${rel}: a story is a *.stories.tsx`);
    }
    if (/\.mdx$/.test(name)) problems.push(`${rel}: MDX isn't used; write a *.stories.tsx in ${STORYBOOK}/`);
    if (inStorybook(rel) && /\.[cm]?[jt]sx?$/.test(name) && /\bexpect\s*\(/.test(readFileSync(p, 'utf8'))) {
      problems.push(`${rel}: stories show, they never check: no expect( (play the steps with userEvent and leave it there)`);
    }
    if (/\.spec\.[cm]?[jt]sx?$/.test(name)) problems.push(`${rel}: *.spec files are not allowed; write an *.integration.test.ts`);
    if (/\.test\.[cm]?[jt]sx?$/.test(name) && !/\.integration\.test\.[cm]?[jt]sx?$/.test(name)) problems.push(`${rel}: unit tests are not allowed; rename to *.integration.test.ts and test a whole flow`);
    if (name === 'package.json') {
      const pkg = JSON.parse(readFileSync(p, 'utf8'));
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies })) {
        if (BANNED_DEPS.some((r) => r.test(dep))) problems.push(`${rel}: dependency "${dep}" is browser or Storybook test tooling and is not allowed`);
        else if (STORYBOOK_DEP.test(dep) && rel !== `${STORYBOOK}/package.json`) problems.push(`${rel}: dependency "${dep}" is Storybook, which only ${STORYBOOK} may depend on`);
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
console.log('Test policy OK: integration tests only, and Storybook only shows.');
