# Storybook: the design system, every page and every journey, in the repo

## Why

There should be one place in the repo to see and iterate on everything Alcove looks like: the foundations (colour, type,
icons, scales, motion, the evening scene), every component in `@alcove/ui` in each of its states, every page in each of its
states, and the journeys between them. It must stay true to the code, so it renders the real components and the real pages,
never copies of them. Today the only such record is the design canvas in `docs/design/canvas/`, which is a hand-made mock-up
and drifts.

## Goals

- `apps/storybook`, a separate app in the monorepo, run with `pnpm storybook`. Editing a component or a page shows up in it
  at once.
- Foundations, components, pages and journeys, in light and dark, at phone and wide sizes.
- Everything Storybook needs lives inside `apps/storybook`: its config, stories, made-up data and the stand-in API. Nothing in
  `apps/web` or `packages/*` knows Storybook exists.
- It uses the shared packages (`@alcove/ui`, and `@alcove/api` for types and schemas) and the app's own pages.

## Non-goals

- No tests. Stories show; they never check. No assertions in stories, no Storybook test runner, no Vitest addon, no visual
  regression service. The integration-tests-only rule stands.
- No hosting for now. It runs locally, and CI builds it so it can't quietly break.
- No mock backend in the app. The stand-in API exists only inside Storybook.

## Decided

- **Storybook itself**, with the React + Vite framework, in `apps/storybook`.
- **The rule changes with it.** AGENTS.md's testing section and `scripts/check-tests.mjs` allow Storybook packages and
  `*.stories.tsx` in `apps/storybook` only. The script goes on refusing them everywhere else, and refuses Storybook's test
  runner, its Vitest addon, Testing Library as a direct dependency, and any `expect` in a story.
- **The UI package is the one home for foundations and foundational components:** tokens, type, icons, colours, scales,
  and the components pages are built from. Anything reusable the app built for itself (for example Team's people picker)
  moves into `packages/ui`, so it gets its own story.
- **Pages run the real app on made-up data.** The app reaches the API only through `apps/web/src/lib/api.ts`. Storybook's
  Vite config points that one import at a stand-in that implements `AlcoveApi` from `@alcove/api`, so the compiler keeps it
  in step with the contract. Each page story mounts the app's real route tree in a memory router at an address.
- **Scenarios** are named made-up worlds the stand-in serves: a busy team, a first day, someone on their own, offline, a note
  being written, a call about to start, a lot of everything. A page story is an address plus a scenario.
- **Journeys** follow `docs/product/user-flows.md`, one story per journey with the same numbering, playing the clicks step by
  step with labelled steps and no assertions. Storybook's interactions panel steps back and forth.
- **Calls:** LiveKit can't run in Storybook, so the stand-in's live stores push scripted snapshots (someone joins, someone
  speaks, notes start). Cameras stay off, so people show in their arches.
- **The demo world** is the canvas's: Vandelay Industries, you are Art Vandelay, every person made up.

## Layout

```
apps/storybook/
  .storybook/main.ts        framework, stories glob, Vite config: the ~/lib/api alias, the app's ~ alias, Tailwind
  .storybook/preview.tsx    the UI package's styles and fonts, light/dark and phone/wide toolbar, providers
  src/api/                  the stand-in AlcoveApi, its live stores, and the scenarios
  src/world/                the demo world's data, typed with the contract's schemas
  src/app.tsx               mounts the real route tree in a memory router for a story
  stories/foundations/      colour, type, icons, scales, motion, the evening scene and what passes through
  stories/components/       one file per @alcove/ui component
  stories/pages/            one file per page, a story per state
  stories/journeys/         one file per user-flows section
```

## Left to the builder

- Storybook's exact version, addons and how the toolbar is wired.
- How the stand-in answers streaming calls (notes progress, NDJSON) and file uploads.
- Which components need moving into `packages/ui`, found by auditing `apps/web/src/features`.
- Foundations stories read token values from `styles.css` at runtime rather than copying them.

## Calls made while writing this (check these)

- **What a journey is.** The canvas's journeys (over 100, with captioned steps) are filed under their `user-flows.md` section,
  and new ones are written for the flows the canvas never drew: sign-in, starting a call, joining, the call and its end.
- **Steps Storybook can't play** (Google sign-in, email, screen sharing, a second device or person) play up to the hand-off,
  and the stand-in scripts the other side: a ring that's answered, a knock, someone joining.
- **Page stories respond to clicks** wherever the stand-in can answer sensibly, not only along journeys. The stand-in keeps
  the server's behaviour simple: it answers from the scenario, and doesn't reimplement search ranking or scheduling.
- **CI builds Storybook and no more.** Journeys find what they click by role and label, as a person would. A journey whose
  button changed shows its failure when it's opened, and gets fixed then.

## Decided after review

- **Calls swap media too.** Besides `~/lib/api`, Storybook's Vite config stands in for `features/call/livekit.ts` with a
  scripted room (people join, unmute, speak, leave), and its preview stubs the browser's media devices, `navigator.onLine`
  and notifications. Nothing in the app changes. Cameras stay off, so people show in their arches.
- **The canvas stays for new ideas.** `docs/design/canvas/` remains where designs are explored before they're built, and
  Storybook becomes the record of what's built. The canvas's page boards no longer have to match the app: the docs
  (`docs/design/README.md`, `canvas.md`, `building.md`) and the `alcove-design` skill change to say a page change updates
  its Storybook scenarios and journeys in the same pull request. Storybook's demo world starts from the canvas's.
- **It lands now.** Branches that change `packages/api` afterwards extend the stand-in and add their stories when they merge,
  and AGENTS.md says so.
