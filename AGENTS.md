# Alcove: rules for agents

Alcove is private video calls with an AI note taker. This repo is a pnpm + Turborepo monorepo.

```
apps/web            TanStack Start app (React 19, Tailwind v4, Motion). SPA mode for now.
packages/ui         The design system: tokens, components, illustrations. Everything visual lives here.
packages/api        The contract: domain types + the AlcoveApi interface. No implementation.
packages/api-mock   In-browser implementation with seeded data and simulated live calls.
packages/api-http   REST/NDJSON/WebSocket implementation for the real backend.
docs/               Product, engineering and design docs.
```

## Commands

```
pnpm install
pnpm dev            # web app on http://localhost:3000 against the mock backend
pnpm typecheck      # strict-typing guard, then tsc in every package
pnpm test           # test-policy guard, then integration tests
pnpm build
pnpm check          # all of the above
```

## Testing (enforced)

- **Integration tests only.** No unit tests. A test must drive a whole user flow through a public
  boundary (today: the `AlcoveApi` contract), e.g. "sign in → schedule → join → leave → notes written".
  Don't test individual functions, hooks or components in isolation.
- **No browser tests.** No Playwright, Cypress, Puppeteer, WebdriverIO or Vitest browser mode.
- **No component or Storybook tests.** No Storybook, no `*.stories.*`, no Testing Library, no jsdom
  or happy-dom.
- Test files are named `*.integration.test.ts` and run in Node with Vitest.
- `scripts/check-tests.mjs` enforces this and runs first in `pnpm test`. Don't weaken or bypass it.
- When you add a feature, extend `packages/api-mock/src/flows.integration.test.ts` (or add another
  `*.integration.test.ts`) with the flow it enables.

## TypeScript (enforced)

Everything is strictly typed. `scripts/check-types.mjs` runs first in `pnpm typecheck` and `pnpm check` and
fails the build on any of these:

- **No `any`**, explicit or in generics (`any[]`, `Record<string, any>`, `Promise<any>`).
- **No type assertions**: no `x as T`, `x as unknown as T`, `<T>x`. The only exception is `as const`.
- **No non-null assertions** (`x!`). Handle the missing case.
- **No suppressions**: no `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or lint-disable comments.

The compiler is configured to match (`tsconfig.base.json`): `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`,
`noUnusedLocals`, `noUnusedParameters`. Don't loosen these flags.

How to stay within the rules:

- Data from outside the program (HTTP, WebSocket, localStorage, URL search params, `JSON.parse`) is
  `unknown` until a zod schema from `@alcove/api` parses it. The contract types are inferred from
  those schemas; add a schema first, then use `z.infer`.
- Narrow with type guards (`instanceof`, `in`, discriminated unions, `isX(v): v is X`), not casts.
- Use `satisfies` to check a literal against a type without widening it.
- Catch blocks get `unknown`. Use `errorMessage(e)` / `errorCode(e)` from `@alcove/api`.
- Indexing an array or record can be `undefined`: use `find`, a `?? fallback`, or an early return.
- Optional props that may receive `undefined` are typed `prop?: T | undefined`.

See `.claude/skills/strict-typescript/SKILL.md` for worked examples.

## Backend boundary

- The app talks to the backend only through `api` from `apps/web/src/lib/api.ts`, which returns an
  `AlcoveApi`. Never import `@alcove/api-mock` or `@alcove/api-http` anywhere else, except that the
  dev panel may use `mockControls`.
- Screens read data through `apps/web/src/lib/queries.ts` (TanStack Query). Add a query or mutation
  there instead of calling `api` inside a component, except for streaming and live sessions.
- Changing what the backend must provide means changing `packages/api` first, then both
  implementations. Keep both type-checking.
- Live things (calls, room recordings) are `LiveStore`s that push whole snapshots. Read them with
  `useLive()`. Don't mirror their state in React state.
- Switching to the real backend is `VITE_ALCOVE_API=http` plus `VITE_ALCOVE_API_URL`. Nothing else.

## Design system

- Use components from `@alcove/ui` before writing markup. If something is missing and reusable, add it
  to `packages/ui`, not to the app.
- Colours, shadows, fonts and easing come from the tokens in `packages/ui/src/styles.css`
  (`bg-canvas`, `text-ink-2`, `shadow-lift`, `font-display`, `ease-soft` ...). No raw hex in the app,
  except on the always-dark call stage (`stage-*` tokens) and in illustrations.
- Every screen must work in light and dark. Check both.
- The amber lamp (`Mark`, `lamp` tokens) is branding only. Never use it to show state such as
  "recording" or "notes on". Recording state uses `RecDot` / `Chip tone="rec"`.
- Motion: use `motion/react` and the shared helpers (`Stagger`, `CountUp`, `CheckDraw`, `Ring`).
  Respect reduced motion; the global stylesheet already shortens CSS animations.
- Every list or page needs a designed empty state (`EmptyState` + an illustration), not blank space.

## Writing

- UI copy is plain and specific: say what happens, not slogans. No marketing taglines.
- People and pronouns: use names or "they".
