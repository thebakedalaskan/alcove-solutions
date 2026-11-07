# Alcove: rules for agents

Alcove is private video calls with an AI note taker. This repo is a pnpm + Turborepo monorepo.

```
apps/web            TanStack Start app (React 19, Tailwind v4, Motion). SPA mode.
apps/api            The API (@alcove/server): Hono, Postgres, S3-compatible objects, sign-in, crypto.
apps/storybook      Storybook: the foundations, every component, page and journey, the real app on a stand-in API.
packages/ui         The design system: tokens, components, illustrations. Everything visual lives here.
packages/api        The contract: zod schemas, the AlcoveApi interface, wire shapes. No implementation.
packages/api-http   The browser client: REST, NDJSON, audio uploads, live sessions.
packages/board      The shape of a board's Y.Doc and the logic the app and API share. No React.
infra/              Deployment guide and GCP bootstrap. .github/ holds CI, deploy and the branch ruleset.
docs/               Product, engineering and design docs. Keep them true to the code. docs/design/ also holds the design canvas.
```

## Commands

```
pnpm install
pnpm dev            # Postgres + RustFS in Docker, API on :8787, web app on http://localhost:3000
pnpm storybook      # Storybook on http://localhost:6006: no Docker, no API
pnpm migrate        # apply database migrations (the API also does this at start)
pnpm typecheck      # strict-typing guard, then tsc in every package
pnpm test           # test-policy guard, then integration tests
pnpm build
pnpm check          # all of the above
```

## Folder ownership (enforced)

Read [docs/engineering/folder-ownership.md](docs/engineering/folder-ownership.md) before adding or moving code.
It defines the target map, feature owners and the composition rules. Run `pnpm check:structure`; this also runs
in `pnpm typecheck`, `pnpm check` and CI. Scoped `AGENTS.md` files add the rules for each area.

- Pick the feature owner first. Colocate its implementation, private helpers/types and server integration suites.
  Cross-feature/infrastructure suites live in `apps/api/src/integration`; shared fixtures live in `src/testing`.
- `call` is the running call; `calls` is making, scheduling, listing and entering calls. Use their documented
  subfeatures, not a new loose file at either root. Backend behavior lives in `apps/api/src/features/<owner>`.
- Routes, `apps/api/src/app.ts` and the HTTP client entry point compose feature behavior. New HTTP handlers,
  subscriptions, recorders and capture/connection lifecycles belong to the owning feature. Extract a coherent
  responsibility with explicit inputs and cleanup; moving a giant entry point intact does not finish a refactor.
- Import the owning file directly within a package. No folder barrels, old-path re-exports, compatibility shims
  or generic `utils`, `common`, `misc` and `helpers` buckets. Keep deliberate public package entry points.
- Shared infrastructure needs a concrete responsibility and callers in more than one feature. Existing crypto,
  database, logging, ownership, test harness and worker infrastructure stays shared; never duplicate it per feature.
- Every move updates imports, package export targets, worker/assets/build paths, CI timing keys, existing consumers
  and docs in the same change. Delete the old path, preserve test discovery/assertions and all other policy guards.
- For a new feature owner or a changed package responsibility, update the map, scoped rules and structure policy
  together and explain the decision. Do not loosen a guard merely to make a check green. Review responsibilities
  and dependencies, not arbitrary file-size limits.

## No backwards compatibility, no legacy code

When something changes, change it everywhere and delete what it replaced, in the same change. The one
exception is data that's already stored: it survives every deploy (next section).

- **Remove, don't keep.** No compatibility shims, deprecated aliases, fallbacks for an old shape, "kept
  for now" fields, re-exports of moved code, or commented-out code. If nothing should use it any more,
  it's deleted.
- **One shape at a time.** A contract change in `packages/api` updates the server, `@alcove/api-http`,
  the app and Storybook's stand-in API together. Nothing on the wire parses or accepts both the old and the new form.
- **No flags that keep an old flow alive** next to its replacement.
- **Tests follow the same rule.** Integration tests only, never unit tests (see Testing). Delete tests
  for removed behaviour instead of adapting them to keep it alive.

## Stored data survives every deploy (enforced)

Production holds people's accounts, meetings and notes. Nothing resets a database to make room for a
change, in production or locally (`pnpm db:reset` is only for starting your own data over on purpose).

- **Migrations only move forward.** Change the schema with a new file, `apps/api/migrations/NNNN_what_it_does.sql`,
  numbered after the last one. A merged migration never changes and is never deleted or renamed:
  `scripts/check-migrations.mjs` fails CI on it, and the API refuses a database whose applied files differ.
  If main gains a migration before yours merges, renumber yours after it.
- **The previous release keeps working.** The deploy migrates while the previous API is still serving, so a
  migration only adds: tables, columns that are nullable or have a default, indexes. To drop, rename or
  retype a column, stop using it in one release and remove it in a later migration. Each file runs once in
  one transaction (so no `CREATE INDEX CONCURRENTLY`); keep it quick, since its locks hold up requests.
- **Sealed records still open.** Records written by the previous release (manifests, call state, transcripts,
  everything read with `openJson`, including contract schemas a record embeds) must parse with the new schema.
  A field added to a stored schema gets `.default(...)`: older records take the default and are written in the
  new shape the next time they're saved. Removing a field is safe, because zod ignores unknown keys (never make
  a stored schema `.strict()`). Never rename or retype a stored field in place: add a new field with a default,
  and if older records' values must carry over, convert them where the schema reads them (`z.preprocess`).
  Record headers and key-derivation labels never change for data that exists.
- **Say how it upgrades.** Tests start from an empty database, so they can't show an upgrade works. A pull
  request that changes the schema or a stored shape names its migration and says how rows and records written
  by the previous release read afterwards; review checks it.

## Testing (enforced)

- **Integration tests only.** No unit tests. A test must drive a whole user flow through a public
  boundary: the real API over HTTP via `@alcove/api-http`, against real Postgres and the object store,
  e.g. "create account → schedule → join → record → leave → note saved".
  Don't test individual functions, hooks or components in isolation.
- **No browser tests.** No Playwright, Cypress, Puppeteer, WebdriverIO or Vitest browser mode.
- **No component tests.** No Testing Library, no jsdom or happy-dom.
- **Storybook shows; it never tests.** It lives in `apps/storybook` alone: its packages, its `.storybook/` and
  `*.stories.tsx` are allowed there and nowhere else. No Storybook test runner, Vitest addon or Chromatic, no Testing
  Library as a dependency, and no `expect(` in its source: a journey plays its steps with Storybook's `userEvent` and
  checks nothing.
- Test files are named `*.integration.test.ts` and run in Node with Vitest.
- `scripts/check-tests.mjs` enforces this and runs first in `pnpm test`. Don't weaken or bypass it.
- CI splits the integration tests across ten runners (`scripts/ci-tests.mjs`) and fails unless every test ran once.
  Keep test files independent of each other: each runs on whichever runner its timing puts it on.
- When you add a feature, extend its colocated `apps/api/src/features/<owner>/*.integration.test.ts`
  (or `apps/api/src/integration/flows.integration.test.ts` for a cross-feature flow). Tests sign in through the real API
  (`api.auth.signIn` on a `h.browser()` from `apps/api/src/testing/harness.ts`); never stub out
  sessions or key checks.

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
  `AlcoveApi`. Never import `@alcove/api-http` anywhere else in the app. There is no mock backend.
- Screens read data through `apps/web/src/lib/queries.ts` (TanStack Query). Add a query or mutation
  there instead of calling `api` inside a component, except for streaming and live sessions.
- Changing what the backend must provide means changing `packages/api` first, then the server and
  `@alcove/api-http`. Every response is parsed with the contract's schemas on the client.
- Storybook's stand-in (`apps/storybook/src/api`) implements `AlcoveApi` too, so a contract change doesn't compile until
  it's extended: give it the new method or data, a scenario where it shows, and the stories that show it, in the same
  pull request. A branch that changes `packages/api` extends it when it merges.
- Live things (calls, room recordings) are `LiveStore`s that push whole snapshots. Read them with
  `useLive()`. Don't mirror their state in React state.
- The app reaches the API at `/api` (Vite proxy locally) or `VITE_ALCOVE_API_URL` in production.

## Privacy (enforced by review and tests)

Read `docs/engineering/privacy-keys-and-sessions.md` before touching anything that stores data.

- Nothing readable goes into a database column, object name, URL, log line or error message. Titles,
  names, guests, chat, labels, audio and notes are sealed records (`crypto.ts`) with headers that bind
  the owner and exact location.
- New stored data gets a new record kind and header, and a canary in the leakage test.
- Every query is scoped by `owner_id`; add a cross-owner test for every new ID that comes from a request.
- Use the request's owner (`Owner.root`, `Owner.wrapKey`, opened per request from `KMASTER`); keys are never kept between requests.
- Deleting must be physical: rows, receipts and objects (queue failed object deletes in `object_gc`).
- Secrets never go in code or committed files. Local values live in `.env` (gitignored).

## Logging and errors (enforced)

Read `docs/engineering/logging-and-errors.md`.

- No `console.*` anywhere except the browser logger's sink; `scripts/check-types.mjs` fails the build.
  Server code uses `log` from `apps/api/src/log.ts`, app code `log` from `apps/web/src/lib/log.ts`.
- Make a child logger per module (`log.child({ component: 'calls' })`) and log events with structured
  context: IDs, codes, states, counts, sizes, durations. Never content, request bodies, keys or session IDs.
- Throw the most specific `AppError` subclass from `apps/api/src/errors.ts` with `context` (and `cause`
  when wrapping). Don't throw bare `Error`s from request paths; don't catch and swallow without a log line.
- Pick the level by meaning: debug for traces, info for events and ordinary refusals, warn for handled
  problems, error when we failed.
- When you add a flow, make sure a failure in it can be found by request ID, and keep the privacy test's
  log check passing.

## Design system

Before you design or restyle anything, read [docs/design/](docs/design/README.md): the principles behind the look, how each
page is designed, how to make a design canvas from the kit in `docs/design/canvas/`, and how to build one into the app.

- Storybook (`apps/storybook`, `pnpm storybook`) is the record of what's built: every foundation, component, page and
  journey, rendered by the real code on made-up data. A change to a component or a page updates its stories in the same
  pull request: a page's scenarios (states) and its journeys, numbered as `docs/product/user-flows.md` is. The design
  canvas is for new ideas, and its boards don't have to follow the app.

- Use components from `@alcove/ui` before writing markup. If something is missing and reusable, add it
  to `packages/ui`, not to the app. Components: `Button` (primary, secondary, quiet; `buttonClass()` for
  links), `IconButton`, `ProviderButton`, `NotesSign`, `Chip`, `GroupChip`, `SealedBadge` and `SealedButton`
  (the badge that opens what was checked), `Notice`, `Toast`,
  `Avatar` and `Faces` (the arch), `GhostArch` (an empty arch where a person will be), `PickList` (people to find and press
  in a popover: one, or several with ticks), `CallTile`, `CallDock` with `DockButton` (its `word` is said beside the icon,
  for Share, the one control the dock names), `CallTopGroup`, `CallTopButton` and `CallTopRule` (the top right's group, its
  buttons and hairlines), `CallMoreGrid` and `CallMoreTile` (More's grid on a phone), `CallFrame` (one frame for a screen, a
  board or the workspace, with its bar), `PresentedTile` (something presented that isn't on your stage, with Join),
  `CloseAsk` (Close's question: for you or for everyone), `VolumeControl` (how loud someone is for you, said
  beside their name by `volumeTag`),
  `RingArch` and `RingAddArch` (who to ring), `WaitArch`, `WaitTile`, `RingReply` and `RingAgain` (someone rung, waiting on
  the stage), `RingCard` in a `RingShelf` (being rung, on any page, over a modal), `KnockCard` (someone asking to join),
  `LinkRow` (a link with Copy), `GuestCard`, `TimeChoice` and `DoneTick` (a public page with one card), `Caption`, `Emoji` (the 8 bundled Fluent Emoji), `Reactions` and `ReactionAdd` (reactions under a chat message), `NotesPanel`, `TranscriptLine` (with `Unsure` and `UnsureKey` for what a transcript isn't sure of), `Card`, `Fold`, `ShowMore` (Show 4 more under a list), `Evening` (a page on the evening: `Horizon`, the scene behind it, set by `moment`), `Cove` (the land the welcome page looks out of, a `Horizon`'s `land`) and `SailOut` (signing in, out of that cove to Home), `SidebarNav`, `ComposerLine` (the palette's one line), `Field`, `Select` (a listbox), `Tabs`,
  `Segmented`, `SettingsPart`, `SettingRow` and `SettingFact` (Settings' sheet: a heading, then a label and a control on one axis), `SunLine` (time left, on a row's hairline), `ThemePreview` (a small evening in a theme's own colours), `MicLevel`, `RecorderSun` (the recorder on
  the horizon, moved with the microphone by `useVoice`), `RecMeter`, `RecPrint`, `TourDialog`, `Coachmark`,
  `EmptyState`, `Modal` (several questions go one at a time inside one modal; no window ever opens over another),
  `ThemeScope` (one theme for a part of a page, such as your side of a call, so what opens from it takes that theme too),
  `BackgroundPicker` (what shows behind someone on camera, with `SCENE_PICTURES`), and `Fit` with `useSceneLoop` for scenes drawn at a design size that play while on screen.
  For starting and scheduling a call: `FlowView`, `FlowHead`, `FlowSteps`, `FlowBody`, `FlowFoot`, `FlowNote`, `FlowRow`,
  `SwitchLine`, `NotesSwitches` (whether a call writes notes, and what they keep), `ScopeBar` (this call, or this and later
  calls), `WayCard`, `PersonToken`, `QuadFaces`, `TimeCard`, `WeekGrid`, `Flood` and `useSmoothHeight`.
  The workspace kit is in `components/workspace/`, every part stateless, taking plain data and handlers: `WsPane` holds
  `WsList` (`WsListHead`, `WsSection`, `WsRow`, `WsRenameRow`, `WsDropLine`, `WsTrashRow`) and `WsDoc` (`WsDocHead` with
  `WsSaveState`, `WsFollowBar`, `WsOfflineBar`, `WsUnsavedBar` (with `WsRescue` for what didn't reach Alcove), `WsGoneBar`,
  `WsReadOnlyBar`, `WsVersionBar`, `WsVersionFailed`, `WsScroll`, `WsPage`, `WsDocBy`, `WsTemplates`, `WsTail`, `WsTrash`,
  `WsEmpty`, `WsPickDocument`, `WsCantOpen`, `WsUnavailable`, `WsOfflineEmpty`, `WsNoAccess`, `WsLostSpace`), with
  `WsHistory` beside it.
  Anything that opens sits on `WsPopover` (a sheet on a phone by itself, and it hands focus back): `WsMenu` and its
  `WsNewMenu`, `WsRowMenu`, `WsDocMenu`, `WsMovePicker`, `WsSpacePicker`, `WsAskMenu`, `WsAskAnswer`; `WsPersonCard`, `WsMentionPrompt`,
  `WsCommentCompose`, `WsCommentThread`, `WsShareSheet`, `WsSwitchSheet`, `WsDeleteAsk`, `WsDiscardAsk`, `WsUploadPicker`. The call's
  own pages are `WsNotesPage`, `WsFollowUps`, `WsTranscript` and `WsNotesOff`. Over the call: `WsFind`, `WsKeyboard`, `WsKnock`,
  `WsPlayBar`, `WsToasts` (say them with `wsToast`, which has every toast's words), `WsDragGhost`, `WsKeyboardBar`. On the
  note: `WsWorkedOn`. `WsFade` swaps what's inside in place.
  The board's parts are in `components/board.tsx`, and take data and handlers with no idea of Yjs: `BoardLayout`, `BoardSheet` and
  `BoardWorld` (`moveBoardCamera` writes its one transform), `BoardRail`, `BoardBar`, `BoardPill`, `BoardPop`, `BoardFlyout`,
  `BoardSelectionBar`, `BoardSelectionBox`, `BoardDots`, `BoardMarquee`, `BoardGuide`, `BoardFrame`, `BoardSticky`, `BoardText`, `BoardShape`,
  `BoardPicture`, `BoardPointer`, `BoardComment`, `BoardLines` with `BoardLine` and `BoardStroke`, `BoardEdit`, `BoardHeard`, `BoardTray`,
  `BoardMap`, `BoardMenu`, `BoardPicker` (Board's picker at the top of a call: in this call, new, your team's boards), `BoardEmpty`, `BoardTile`, `BoardPageActions`, `BoardNoAccess`, `BoardPhoneAdd` and `BoardPhoneSheet`. What's on a
  board is `memo`ised and takes no handlers: `data-id`, `data-h` and `data-p` say what was pressed, for one listener on the sheet.
  A row's menu is an `IconButton` as the anchor of a `Popover` with a `tip`.
- Colours, shadows, radii, fonts and easing come from the tokens in `packages/ui/src/styles.css`: light
  values on `:root`, dark on `.dark` and the night surfaces, `.stage` and `.ac-stage`, with the whole document going dark while a `.stage` or Record (`.rec`) is up so what's portalled out of it stays night (`.light` and `.dark` on any element scope one theme to that part of a page), with Tailwind utilities on the same names (`bg-ground`,
  `bg-surface`, `bg-frame`, `text-ink-2`, `bg-sun`, `text-sun-text`, `shadow-2`, `rounded-lg`,
  `font-display`, `ease-out` ...). Component classes carry the `ac-` prefix and live in
  `packages/ui/src/styles/kit.css`; the frame around every screen (side panel, the page's rounded edge, search and
  you at its top right, phone top bar and tab bar, palette) in `styles/shell.css`; the evening behind each page in `styles/horizon.css` (`dusk` the page, `hz-` the scene); the cove the welcome page looks out of, and signing in sailing out of it, in `styles/cove.css` (`cv-`); Home in `styles/home.css` (`hm-`); the Team page in
  `styles/team.css` (its classes start with `tp-`); Notes in `styles/notes.css` (`nt-`); the Drive in `styles/drive.css` (`dv-`); a note and a series in `styles/note.css` (`nd-`);
  Settings in `styles/settings.css` (its classes start with `set-`); Record in `styles/record.css` (its classes
  start with `rec-`); starting and scheduling a call in `styles/flow.css` (its classes start with `cf-`); the organizer's
  lobby, ringing and the page for picking a time in `styles/ringing.css` (`rg-`); the workspace in `styles/workspace.css`
  (`wt-` the list, `wd-` a document, `wm-` menus, `wv-` popovers, `wp-` presenting, `wh-` history, `wl-` the call's live
  pages); the board in `styles/board.css` (`bz-` the board and its rail, `bd-` the sheet and its chrome, `bf-` frames,
  `bo-` objects, `bc-` pointers, `bs-` selection, `bx-` the bar on what's selected, `bfly-` a tool's options, `bp-` small menus, `bpg-` its own page, `bl-` the
  Board menu, `pc-` the phone's add sheet; its tokens are `--bd-*`, `--bf-*`, `--note-*`, and `--line-ink` and `--line-rose` beside the existing
  `--line` and `--line-control`; `.bt`, `.bi`, `.bm`, `.swatch`, `.c-*` and `.k-*` are unscoped there, so those names are taken); the welcome
  page in `styles/welcome.css`, with its scenes in `welcome-note.css`, `welcome-call.css`, `welcome-team.css` and
  `welcome-night.css` (`lp-`); the other screens in `styles/app.css` and `call.css`.
  Truncate to one or two lines with `ac-clamp-1` / `ac-clamp-2` (left-aligned): unlike `nowrap`, long text
  can't make a column wider than the screen.
  No raw hex in the app, except on the always-night call stage and in illustrations.
- Icons come from Lucide through `Icon` in `@alcove/ui` (one stroke family, 1.8 stroke). Add a name to its map
  rather than drawing an SVG; use an icon button with a tooltip, not a text label, for tile and toolbar actions.
- Every screen must work in light and dark. Check both, and check phone and wide screens.
- `sun` is the only colour you can press: primary buttons are a solid `sun` fill with `on-sun` text and no
  shadow, one per view. It's navy by day and cream by night, so it never glows against the page. The side panel's
  Start a call is tinted, so the page's own action is the one filled button in view. The warmth lives in `sun-text` and `sun-soft`.
  `rec` only ever means notes or recording (`NotesSign`, `RecDot`). Problems use `caution`,
  information and focus use `horizon`, and a decision waiting on someone uses `rose`. The mark (`Mark`, `Logo`) is branding, never state. No green.
- Type: Newsreader (`font-display`) for page-level headings, a board's name and its frame titles, and nothing
  else; Hanken Grotesk for everything you read and operate, times and data included (`tabular-nums`, or `ac-mono`,
  keeps digits in step), and IBM Plex Mono only for code and hashes. Labels and eyebrows are sentence case, never
  uppercase. Fonts are served from `packages/ui/src/fonts`.
- The call is always night: the stage uses `stage`, `stage-tile`, `stage-raised`, `stage-ink`,
  `stage-ink-2`, `stage-sun` for what's chosen on night controls whatever theme is round them, and whoever speaks gets the `speak` ring. People appear in the arch, never a circle.
- Motion: use `motion/react` and the shared helpers (`CountUp`, `Words`, `CheckDraw`, `Dots`, `Reveal`,
  `RevealGroup`, the `EASE` curves) with the `duration-*` and `ease-*` tokens. Respect reduced motion; the global stylesheet already shortens CSS
  animations.
- Every list or page needs a designed empty state (`EmptyState`, which draws `EmptyArch` by default),
  not blank space.

## Writing

- UI copy is plain and specific: say what happens, not slogans. No marketing taglines.
- People and pronouns: use names or "they".
- Demo data, examples and designs use made-up people only (the demo company is Vandelay Industries). Never write a real
  person's name.
