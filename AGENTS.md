# Alcove: rules for agents

Alcove is a meeting superapp with confidential AI: end-to-end encrypted calls, breakout rooms, whiteboards, a workspace
for every call, notes, scheduling, recording and AI agents over MCP. This repo is a pnpm + Turborepo monorepo.

```
apps/web            TanStack Start app (React 19, Tailwind v4, Motion). SPA mode.
apps/api            The API (@alcove/server): Hono, Postgres, S3-compatible objects, sign-in, crypto.
apps/storybook      Storybook: the foundations, every component, page and journey, the real app on a stand-in API.
packages/ui         The design system: tokens, components, illustrations. Everything visual lives here.
packages/api        The contract: zod schemas, the AlcoveApi interface, wire shapes. No implementation.
packages/api-http   The browser client: REST, NDJSON, audio uploads, live sessions.
packages/board      The shape of a board's Y.Doc and the logic the app and API share. No React.
infra/              Deployment guide and GCP bootstrap; confidential-space/ sets up, builds, signs and deploys the image to
                    Confidential Space (and is a small workspace package, for verify-server.ts). .github/ holds CI,
                    deploy, the monthly image refresh and the branch ruleset.
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

## Folder ownership and structure (enforced)

Read [docs/engineering/folder-ownership.md](docs/engineering/folder-ownership.md) before adding or moving code: it maps
every owner and says why each rule exists. `scripts/check-structure.mjs` enforces the rules below in `pnpm check:structure`,
`pnpm typecheck`, `pnpm check` and CI (`node scripts/check-structure.mjs <path>` shows one area). The `code-structure`
skill (`.claude/skills/code-structure/SKILL.md`) shows the fix for each failure. Scoped `AGENTS.md` files add each area's rules.

- **Pick the owner first.** Code lives with the feature whose behaviour it is, beside its private helpers, types and
  (on the server) integration suites. A helper one feature uses belongs to that feature, whatever its name sounds like.
  Cross-feature suites live in `apps/api/src/integration`; shared fixtures in `apps/api/src/testing`.
- **Dependencies point one way.** Server features import only those before them: `profile → billing → workspaces →
  meetings → recordings → notes → calls → agents → account → operator`. Shared homes (`platform`, `keys`, `tee`,
  `inference`, `providers`, `http`, `live`, `edge`) never import a feature; `app.ts`, `start.ts`, `maintenance.ts` and
  the CLIs compose them. In the web app `lib/` never imports a feature, and features never import routes. No runtime
  import cycle spans two owners. When code needs something from above, it takes it as an argument, or the piece moves
  down to the owner of its data.
- **Folders stay small.** At most 20 files in a folder, and no 4 files starting with a word that isn't the folder's own:
  that word is a subfolder (`drive-*.ts` → `drive-exports/`). Split along what changes together and record the new
  subfolder in the map. `call` is the running call and `calls` is making, scheduling, listing and entering calls; neither
  root holds loose files, only their documented subfeatures.
- **Composition stays thin.** A route file declares the route and renders its feature's page: no state, effects or refs.
  `apps/api/src/app.ts` composes registrars; the HTTP client's `index.ts` composes feature factories. A component or hook
  owns at most 10 effects and keeps at most 15 pieces of state: each lifecycle gets a hook with explicit inputs and
  cleanup, and each part of the screen a component, in the subfeature it belongs to. Moving a giant entry point intact
  does not finish a refactor.
- **Names say what a file is.** The API, packages and Storybook helpers use kebab-case files; the web app uses
  `PascalCase.tsx` for a component and `camelCase.ts(x)` for anything else; every folder is kebab-case.
- **No buckets, no barrels.** Import the owning file directly. No folder `index.ts`, no `export *` outside a package's
  entry, no `utils`, `common`, `misc` or `helpers` folders, no forwarding file at an old path. Shared code needs a
  concrete responsibility and callers in more than one feature; never duplicate shared infrastructure per feature.
- **Moves are whole.** Move and rename with `node scripts/move-files.mjs <from> <to> …`: it rewrites imports in every
  package, CI timing keys and doc paths, and lists what it can't decide (worker and build paths). Renaming source never
  renames record kinds, key labels, tables, wire fields or routes.
- **Change a rule only with the decision.** A new owner, a changed dependency direction or a new shared home updates the
  map, the scoped rules and the check together, and says why. Never loosen a rule to get a green check.

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
- CI splits the integration tests across ten runners, three files at once on each (`scripts/ci-tests.mjs`), and fails
  unless every test ran once. Keep test files independent of each other, and the tests of a long `describe` block too
  (it can be split between runners): each runs wherever its timing puts it, beside other files that each have their own
  database and bucket. What a test reads of Postgres's shared views, such as `pg_stat_activity`, it scopes to its own
  database (`datname = current_database()`). The nightly Flake finder (`.github/workflows/flakes.yml`) runs the suite
  three times over and lists what failed in one run and passed in another.
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
- Screens read data through TanStack Query, from their feature's `queries.ts`: keys, `queryOptions`, hooks and mutations
  live with the feature whose data they read, and `apps/web/src/lib` keeps only the query client and the cache plumbing
  every feature shares. Add a query or mutation there instead of calling `api` inside a component, except for streaming
  and live sessions.
- Changing what the backend must provide means changing `packages/api` first, then the server and
  `@alcove/api-http`. Every response is parsed with the contract's schemas on the client.
- Storybook's stand-in (`apps/storybook/src/api`) implements `AlcoveApi` too, so a contract change doesn't compile until
  it's extended: give it the new method or data, a scenario where it shows, and the stories that show it, in the same
  pull request. A branch that changes `packages/api` extends it when it merges.
- Live things (calls, room recordings) are `LiveStore`s that push whole snapshots. Read them with
  `useLive()`. Don't mirror their state in React state.
- The app reaches the API at `/api` (Vite proxy locally) or `VITE_ALCOVE_API_URL` in production, where the API serves the
  web app itself, from the same signed image in Confidential Space (`infra/confidential-space/README.md`).

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
  Server code uses `log` from `apps/api/src/platform/log.ts`, app code `log` from `apps/web/src/lib/log.ts`.
- Make a child logger per module (`log.child({ component: 'calls' })`) and log events with structured
  context: IDs, codes, states, counts, sizes, durations. Never content, request bodies, keys or session IDs.
- Throw the most specific `AppError` subclass from `apps/api/src/platform/errors.ts` with `context` (and `cause`
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
  (the badge that opens what was checked), `Notice` (with an × when it can be dismissed), `useToast` (a toast, from the `ToastProvider` at the app's root),
  `Avatar` and `Faces` (the arch), `GhostArch` (an empty arch where a person will be), `PickList` (people to find and press
  in a popover: one, or several with ticks), `CallTile`, `FloatingCall` (the compact call's picture, controls and attention, with no media ownership), `CallDock` with `DockButton` (its `word` is said beside the icon,
  for Share, the one control the dock names), `CallTopGroup`, `CallTopButton` and `CallTopRule` (the top right's group, its
  buttons and hairlines), `CallTimerButton`, `CallTimerCard`, `CallTimerLength` and `CallTimerRun` (the call's one countdown for everyone: its button, and Timer for everyone, the popover it opens, with the lengths to start one, then Pause, +1 min and Stop),
  `CallMoreGrid` and `CallMoreTile` (More's grid on a phone), `CallMenuChips` (equal choices in a row inside a call's menu, such as Back in), `ChatTabs`, `ChatMessage` (Slack-like, with the bar of reactions, Reply in thread and Message privately over its corner),
  `ChatThreadLine`, `ChatThreadHead`, `ChatDivider` and `ChatLock` (Chat in a call: its conversations as tabs, threads in place, a private
  conversation's lock line), `CallQuestion` (a room's question, with its votes), `CallBanner` (what's said about the whole call until it's closed, its `actions` under the words),
  `CallFrame` (one frame for a screen, a board or the workspace, with its bar, which says who can edit a board or the workspace), `PresentedTile` (something presented that isn't on your stage, with Join),
  `CloseAsk` (Close's question: for you or for everyone), `PresentAsk` (Present's question when some people here can't open
  the board), `FramePager` (a board's presenter steps through its frames at the frame's foot, with their notes), Share's
  steps in one popover over the dock (`ShareKinds`, then `ShareScreenStep`, the `BoardPicker`, or `ShareStopStep` (Close's
  question, in Share), with `ShareStepHead`'s way back), `VolumeControl` (how loud someone is for you, said
  beside their name by `volumeTag`), `LeaveAsk` and `LeaveChoices` (Leave's question for whoever hosts: End for
  everyone, or leave it going with someone hosting; `LeaveChoices` are its rows, for the floating call's own window),
  `CallOver` (the page a call leaves you on: what happened, who, the notes, the next step, on its own night cove),
  `RingArch` and `RingAddArch` (who to ring), `WaitArch`, `WaitTile`, `RingReply` and `RingAgain` (someone rung, waiting on
  the stage), `RingCard` in a `RingShelf` (being rung, on any page, over a modal), `KnockCard` (someone asking to join),
  `LinkRow` (a link with Copy), `GuestCard`, `TimeChoice` and `DoneTick` (a public page with one card), `Caption`, `Emoji` (the 8 bundled Fluent Emoji), `Reactions` and `ReactionAdd` (reactions under a chat message), `ReactPicker` (the eight emoji to press), `ReactionBurst` (emoji rising out of the foot of the call and fading at their peak, from React in the dock), `NotesPanel`, `TranscriptLine` (with `Unsure` and `UnsureKey` for what a transcript isn't sure of), `Card`, `Widget` (one card on a page's water: its head with an icon tile, the title, then `end` (tabs, a quiet button at its end), its body, and Show N more at its foot while its list is longer than it shows, with `footEnd` at that foot's end (Upcoming's count of events with only you on them); `bare` without the card, as Recent notes on Home; `id` for a link to name it, and `landed` while one just did: a ring that fades), `NoteCard` (a note in a row of cards: its own small sunset as the cover, from `coverFor`, the people standing on the cover's edge or a microphone's arch, its title as the link that takes the whole card), `Fold`, `ShowMore` (Show 4 more under a list), `ReadMore` (more prose behind a quiet button: a note's full summary), `Evening` (a page on the evening: `Horizon`, the scene behind it, set by `moment`), `Cove` (the land the welcome page looks out of, a `Horizon`'s `land`; `restingBox` and `useCoveFit` measure where the words it keeps clear of rest and draw it again when they move, for anything that draws one) and `SailOut` (signing in, out of that cove to Home, or onto the plans in its place, whose sun sits lower: `sink`), `SidebarNav` (with `NavCount`, a place whose count is a link of its own: Home's, to For you), your menu's parts (what your face at the top right opens, in `you/you.tsx`, stateless: `YouButton` (your face, the button that opens it; `until`, while notifications are paused, puts a crossed-out bell on it and says until when in its label and tooltip), `YouMenu` (you on the horizon in the last of the light, then its rows, which ↓ and ↑ move between; `sheet` in the phone's Sheet), `YouRow` (an icon, its words and what ends it; `expanded` turns its chevron), `YouLink` (the same row as a link, which `link` renders as the app's router link: Settings), `YouRule` (a hairline between its groups), `YouPause` (Pause notifications: its choices in place under it, or paused until when, with Resume), `YouTheme` (the three small evenings) and `YouAsk` (Sign out asking in place of the rows)), the palette's parts (Search or ask, in `palette/palette.tsx`, stateless: `PaletteLine` with `PaletteToken`, then `PaletteBody` holding the list and the preview beside it, then `PaletteFoot`; each row is the app's own link or option with `paletteRow(kind, lit)` and a row part inside: `PaletteAskLine`, `PalettePersonLine`, `PaletteMomentLine` under a `PaletteCallHead`, `PaletteMoreLine`, `PaletteNoteLine` (with `PalettePin` for Pin a note) and `PaletteAllLine`, in a `PaletteGroup`, with `PalettePeople` before anything's typed; the preview is `PalettePreview` with `PalettePreviewHead`, `PaletteMade`, `PaletteExcerpt` and `PaletteExcerptLine`, `PaletteSummary`, `PalettePersonPreview`, `PaletteAskPreview` or `PaletteAllPreview`; `PaletteAnswer` and `PaletteBack` in place of the list, and `PaletteWaiting` while a search has no list yet; with nothing to list, the kit's `EmptyState` with the palette's dashed arch, `pal-none`), `Field`, `CopyField` (a long value to copy exactly), `CryptoMark` (a stablecoin or network logo), `Select` (a listbox; an option can carry a `mark`, `note` and `tag`), `MonthGrid` (a month to pick a day from, from the keyboard too, in `foundation/calendar.tsx`), `Unencrypted` (the badge for a model outside a secure enclave), `Tabs`,
  `Segmented`, `SettingsGroup`, `SettingsPanel`, `SettingRow` and `SettingFact` (Settings: a group's heading over panels, each row a label with its control at the panel's edge; `sub` rows nest under a connection), `SettingTile` (a connection's mark on a row, as on Agents' row), `SettingNote` (a notice inside a panel, with what to do about it at its end when it has an `action`, and × when it has `onDismiss`), `SettingStep` (something opened in place inside a panel: its title and help, then what to do), `SettingFoot` (the foot of something opened in place), `SettingPayments` and `PaymentRow` (payments at a panel's foot, each with Receipt), `AlertTable` (what reaches you: each event once, with an Alert and a Sound tick), `SoundLevel` (silence, volume, play), `SunLine` (time left, on a row's hairline), `SunMark` (a paid plan's small sun in the side panel's icon column, half set while it's ending), `ThemePreview` (a small evening in a theme's own colours; `small`, the window alone, named by its tooltip), `MicLevel`, `RecorderSun` (the recorder on
  the horizon, moved with the microphone by `useVoice`), `RecMeter`, `RecPrint`, `TourDialog`, `Coachmark`,
  `EmptyState`, `EmptyRows` and `EmptyWeek` (small drawings of rows and a week not filled in yet, for a widget with nothing in it yet; `EmptyWeek`'s `blocks` hatches the week as your own time, or leaves it clear), `Hatch` (a small square of hatching: a calendar event with only you on it), `SmallSunset` (Home's small sunset, for all caught up), `Modal` (several questions go one at a time inside one modal; no window ever opens over another),
  `ThemeScope` (one theme for a part of a page, such as your side of a call, so what opens from it takes that theme too),
  `BackgroundModal` (Background's window: a big live preview of you beside the choices) with `BackgroundPicker` (what shows behind someone on camera, in groups: Blur, Pictures, Colours and Yours, with `SCENE_PICTURES`), and `Fit` with `useSceneLoop` for scenes drawn at a design size that play while on screen.
  For starting and scheduling a call: `FlowView`, `FlowHead`, `FlowBody`, `FlowFoot`, `FlowNote`, `SwitchLine`,
  `NotesSwitches` (whether a call writes notes, and what they keep: `KeepSwitches`, which the organizer's lobby opens
  alone under What the notes keep), `ScopeBar` (this call, or this and later calls),
  `WayCard`, `PersonToken` (with `state` and `place`), `QuadFaces`, `Flood` and `useSmoothHeight`,
  with `NoNotesLeft` (no notes left this period where a call with notes starts or is scheduled: until when, in caution, the
  ways on under it). Start a call asks Start now or Schedule for later, and scheduling happens on Calls: one sheet, the week
  on the left and the call's editor on the right. The week is `CallsWeek` with `CallsWeekHead` (in
  `calls/calls-week.tsx`: the week on Calls and the week a call is scheduled on; its head is the days it shows, with
  the arrows and Today; the day is a scroll box of 24 hours that opens on 08:00, blocks say their time first and stand side
  by side, busy time is hatched and says whose, the call is a sun block to press, drag to any day and lengthen by its grip,
  offered times are numbered, and a phone shows three days). The editor's parts are in `calls/scheduler.tsx`, all
  stateless: `SchedPanel` (the column: its pinned top with the kicker and ×, the body, and the foot after it, pinned to the
  bottom when the body scrolls), `SchedTitle` (the call's name, large), `SchedGroup` (a section, a hairline apart),
  `SchedName` (a call being moved, by name, with where it was struck through once it moves), `SchedRow` (an icon and its
  value), `SchedLine` (a line that carries on the row above, in caution with its action on a clash), `SchedNote` (a note on
  the inner edge that holds more than words), `SchedValue` (a bold value to press, with a quiet word after it and a
  chevron), `SchedQuiet` (a quiet value that opens a menu), `SchedSwitch` (a switch row, its line inside), `SchedChoice`
  (a choice with its line, such as where the notes go), `SchedField` with `SchedPersonOption`, `SchedListHead` and
  `SchedListNote` (Who's field of tokens, and the people to add under it), `SchedOffer` (a time offered to a guest:
  pressed, it's the one the week moves; its tick is its own button), `SchedTimes` (a list of times, the picked one marked
  and in view, those gone greyed, each end with the length it makes), `SchedPop` (what opens under a field without taking
  its focus), `SchedDoc` (a document the call brings, with ×), `SchedFoot` (what will happen, Cancel and the one filled
  button) and `SchedAsk` (a question asked once in the foot: Cancel this call?).
  Calls' parts are in `calls/calls.tsx`: `SkyBar` and `SkySearch` (the page's title, search and its one filled
  button on a short sky), `PlaceTree` with `PlaceHead`, `PlaceRow`, `PlaceFoot` and `PlaceChips` (the rail of places,
  chips on a phone), `CallsSheet` and `SheetHead`, `CallsGroup` and `CallsMore` (a day's calls, and Show N more),
  `CallRow` with `CallReply`, `CallAnswered` and `CallChip` (a call in a list: answers in place, chips only for what waits
  on you), `MomentChip` (▶ a moment that plays), `RowMenu` and `RowAsk` (a row's ⋯ menu, and a question asked in place),
  `CallsAnswer` (Ask's answer across every call) and `CarryRow` (what a series carries over). `FileCard` and `Thumb`
  (in `drive/files.tsx`) show a file as a large preview: a document's first lines, a board, a PDF, photos, or a
  shared screen with play, on a call's page and in the Drive.
  For plans: `PlanCards` and `PlanCard` (the plans side by side, their rows lined up by subgrid; `lifted` for Pro's raised
  card with its warm edge, `waiting` while the prices come), `PlanHere` ("Your plan", nothing to press; `quiet` for Free's
  line on another plan), `PlanCycle` (Monthly / Yearly · 20% off on the sky), `PlanSunset` (the last sliver of the sun,
  drawn through `Evening`'s and `Horizon`'s `sky`), `EveryPlan` and `PayingLine`. Checkout, one window over any page, is in
  `plans/checkout.tsx`: `CheckoutWindow` (on `Modal`, in your theme over a call; `receipt` for the receipt alone) with
  `CheckoutPanel`, `CheckoutSteps`, `MonthsPicker`, `HoursPicker`, `NetworkPicker`, `TeamName` (a team being started, its name
  in a box with its label inside), `LicensesPicker` (how many of Team's licenses, Another number up to the most one purchase
  buys, and How long, Monthly / Yearly · 20% off on `Segmented`, over them while a year is offered: its `term`), `LicensesLeft` (the team's people, how many licenses are left and who's waiting), `PlanWindow` (what you're buying
  under its own small evening, whose sun rises with the payment), `CheckoutSummary`, `PayStatus`, `PayAmount`, `PayAddress`
  (the QR code with the USDC mark, the address with its ends in bold), `PayArrived`, `PayTrack` (checkout's Pay step and
  Settings' Add money follow a payment with these, through the app's `features/plans/paying.tsx`), `CheckoutDone` (`invite`
  for a team just started), `CheckoutAsk`,
  `CheckoutNote`, `CheckoutBig`, `CheckoutLine`, `PaymentReceipt` (one payment as paper, alone on the page when printed) and
  `ReceiptWindow` (a receipt over Settings).
  Team on a plan and joining a team by its link are in `plans/team-plan.tsx`: `TeamLine` (the team on the horizon, each
  under their license), `TeamSection`, `TeamRows`, `TeamPersonRow`, `TeamAsk` (Remove, Leave or Delete asked in place, and Make a new link in a company's Invite people),
  `TeamFoot`, `TeamNotesList` (what's visible to the team), `LicensesCard`, `TeamInvite` (a one-time link with Copy; `bare` for
  under checkout Done's heading), `TeamStartRow` (a quiet Start a team on a company's page), `JoinCard` and `JoinEvening`.
  The workspace kit is in `workspace/`, every part stateless, taking plain data and handlers: `WsPane` holds
  `WsList` (`WsListHead`, or `WsListTools` in a call, where the frame's bar names the workspace; `WsSection` with `add` and `flash`,
  `WsRow` with the kinds `place` and `call` and their `tag` and `out`, `WsRenameRow`, `WsDropLine`, `WsTrashRow`; the rows
  themselves are `WsTree`) and `WsDoc` (`WsDocHead` with `WsPath` (the path, also on `WsBar`: whole steps leave from its
  start when it's long, and each step before the page is a button that shows where it is),
  `WsSaveState`, `WsFollowBar`, `WsOfflineBar`, `WsUnsavedBar` (with `WsRescue` for what didn't reach Alcove), `WsGoneBar`,
  `WsReadOnlyBar`, `WsVersionBar`, `WsVersionFailed`, `WsScroll`, `WsPage`, `WsDocBy`, `WsTemplates`, `WsTail`, `WsTrash`,
  `WsEmpty`, `WsPickDocument`, `WsCantOpen`, `WsUnavailable`, `WsOfflineEmpty`, `WsNoAccess`, `WsLostSpace`), with
  `WsHistory` beside it. `WsPane`'s `beside` is one document beside the Drive's tree. A workspace full screen is `WsFrame`
  (in `workspace/frame.tsx`): `WsSide` (its side panel, with `WsMark` and `WsSpaceField`; who can open it, at its foot,
  ends in Share and opens who's in it, its `share`), `WsBar` (its top bar, with `hereLine`), and its Home's `WsHomeBand`,
  `WsAbout`, `WsPeopleLine` and `WsHomeSection`, with `WsDocMeta` over a document.
  Anything that opens sits on `WsPopover` (a sheet on a phone by itself, and it hands focus back): `WsMenu` and its
  `WsNewMenu`, `WsRowMenu`, `WsDocMenu`, `WsMovePicker`, `WsSpacePicker`, `WsAskMenu`, `WsAskAnswer`; `WsPersonCard`, `WsMentionPrompt`,
  `WsCommentCompose`, `WsCommentThread`, `WsShareSheet` (its `onBack` when it opens in place of a menu's rows), `WsSwitchSheet`, `WsNameSheet`, `WsDeleteAsk`, `WsDiscardAsk`, `WsUploadPicker`. The call's
  own pages are `WsNotesPage`, `WsFollowUps`, `WsTranscript` and `WsNotesOff`. Over the call: `WsFind`, `WsKeyboard`,
  `WsPlayBar`, `WsToasts` (say them with `wsToast`, which has every toast's words), `WsDragGhost`, `WsKeyboardBar`. `WsFade`
  swaps what's inside in place.
  The board's parts are in `board/board.tsx`, and take data and handlers with no idea of Yjs: `BoardLayout`, `BoardSheet` and
  `BoardWorld` (`moveBoardCamera` writes its one transform), `BoardRail`, `BoardBar`, `BoardPill`, `BoardPop`, `BoardFlyout`,
  `BoardSelectionBar`, `BoardSelectionBox`, `BoardDots`, `BoardMarquee`, `BoardGuide`, `BoardFrame`, `BoardSticky`, `BoardText`, `BoardShape`,
  `BoardPicture`, `BoardPointer`, `BoardComment`, `BoardLines` with `BoardLine` and `BoardStroke`, `BoardEdit`, `BoardHeard`, `BoardTray`,
  `BoardMap`, `BoardPicker` (the board picker, under Board at the top right of a call and as Share's A board: in this call,
  new, your team's boards), `BoardEmpty`, `BoardLost` (the way back to everything when nothing on the board is in view), `BoardPageActions`, `BoardNoAccess`, `BoardPhoneAdd` and `BoardPhoneSheet`. What's on a
  board is `memo`ised and takes no handlers: `data-id`, `data-h` and `data-p` say what was pressed, for one listener on the sheet.
  Agents' parts are in `agents/agents.tsx`, stateless: an agent is an `AgentWindow` (a square with a rounded top, its mark
  by kind: solid, dashed, asking or allowed, with a caution dot or a tick), standing in an `AgentLine` as an `AgentPlace` (its
  name and line under it, and the popover it opens), with `AgentGap` and `AgentWaitingPlace` (an empty window breathing while
  the line loads). A popover is `AgentPopHead`, `AgentPopLine`, `AgentWell` (an address, a command, a token or a question in a
  quiet well, with copy), one `AgentAction` or `AgentLink`, `AgentWaiting`, `AgentPopMore` (a foot row that leads on),
  `AgentPopFoot`, `AgentAsked` (asked in place: Disconnect Claude?) and `AgentSaved`. The question an agent asks is
  `AgentLevels` (each part of Alcove a level to lower, as a menu, and switches) with `AgentPair` (the agent and you on the
  horizon, joined while it asks); on the water, `AgentDay` and `AgentDid` (what your agents did), `AgentNone` (one row where
  the first will be, an empty dashed window for its mark: nothing yet, or Try again) and `AgentQuestion` (a thing to ask,
  with the mark of the row it will make, and who can). `AgentPermissions` (what an agent can do, as chips), `AgentDisclosure` and
  `AgentConsentFrame` (the sheet `/connect` signs you in on) sit beside them.
  A row's menu is an `IconButton` as the anchor of a `Popover` with a `tip`.
- A popup closes on a press or focus outside it, but never for a browser extension's own UI (`extensionUi` in
  `foundation/overlay.tsx`): a password manager's menu takes focus as it opens over a field, as 1Password's does, and that
  isn't the person leaving. Every Radix layer in the kit asks it in `onInteractOutside` (`stayForExtensions` where that's
  all it asks), and so does a popup with its own press handler (`extensionUi(e.target)`). One that closes as its field
  loses focus takes its blur handler from `useCloseOnLeave`, which waits while focus is in an extension's UI and closes
  on the next press, focus or Escape anywhere else, as the scheduler's Who field and the editor's link field do. A field
  for finding people or naming something (a group, a call, a workspace), not signing in, carries `data-1p-ignore`, so
  1Password doesn't offer to fill it; a guest's own name in the lobby doesn't, since filling it helps. In a `Modal` or
  `Sheet`, Radix's focus trap still takes focus back from an extension's menu over a field, which is one more reason the
  attribute matters there.
- Colours, shadows, radii, fonts and easing come from the tokens in `packages/ui/src/styles.css`: light
  values on `:root`, dark on `.dark` and the night surfaces, `.stage` and `.ac-stage`, with the whole document going dark while a `.stage` or Record (`.rec`) is up so what's portalled out of it stays night (`.light` and `.dark` on any element scope one theme to that part of a page), with Tailwind utilities on the same names (`bg-ground`,
  `bg-surface`, `bg-frame`, `text-ink-2`, `bg-sun`, `text-sun-text`, `shadow-2`, `rounded-lg`,
  `font-display`, `ease-out` ...). Component classes carry the `ac-` prefix and live in
  `packages/ui/src/foundation/kit.css`; the frame around every screen (side panel, the page's rounded edge, search and
  you at its top right, phone top bar and tab bar) in `shell/shell.css`; your menu, which your face there opens, in `you/you.css` (`ym-`); the palette Search or ask opens in `palette/palette.css` (`pal-`); the evening behind each page in `evening/horizon.css` (`dusk` the page, `dusk-top` and `dusk-title` its head, `hz-` the scene); the cove the welcome page looks out of, and signing in sailing out of it, in `evening/cove.css` (`cv-`); Home in `home/home.css` (`hm-`); the Team page in
  `team/team.css` (its classes start with `tp-`); Calls in `calls/calls.css` (`cs-`); the Drive in `drive/drive.css` (`dv-`); a call's page in `notes/note.css` (`cd-`, with the
  transcript line still `nd-l`); a file's large preview in `drive/files.css` (`fc-`);
  Settings in `settings/settings.css` (its classes start with `set-`); Agents in `agents/agents.css` (`ag-`, beside the
  `ac-agent-` chips and consent sheet); Plans in `plans/plans.css` (`pl-`); checkout in `plans/checkout.css` (`ck-`); the doors into checkout in `plans/plan-doors.css` (`pd-`); Team on a plan in `plans/team-plan.css` (`tq-` the page, `tj-` joining); Record in `record/record.css` (its classes
  start with `rec-`); Start a call in `calls/flow.css` (`cf-`); the scheduler in `calls/scheduler.css` (`sc-`); the week,
  on Calls and while scheduling, in `calls/calls-week.css` (`cw-`); the organizer's
  lobby, ringing and the page for picking a time in `calls/ringing.css` (`rg-`); the workspace in `workspace/workspace.css`
  (`wt-` the list, `wd-` a document, `wm-` menus, `wv-` popovers, `wh-` history, `wl-` the call's live
  pages, `wf-` full screen), with a document's own look full screen in `workspace/workspace-editor.css`; the board in `board/board.css` (`bz-` the board and its rail, `bd-` the sheet and its chrome, `bf-` frames,
  `bo-` objects, `bc-` pointers, `bs-` selection, `bx-` the bar on what's selected, `bfly-` a tool's options, `bp-` small menus, `bpg-` its own page, `bl-` the
  board picker, `pc-` the phone's add sheet; its tokens are `--bd-*`, `--bf-*`, `--note-*`, and `--line-ink` and `--line-rose` beside the existing
  `--line` and `--line-control`; `.bt`, `.bi`, `.bm`, `.swatch`, `.c-*` and `.k-*` are unscoped there, so those names are taken); the welcome
  page in `welcome/welcome.css`, with its scenes in `welcome/welcome-note.css`, `welcome/welcome-call.css`, `welcome/welcome-team.css` and
  `welcome/welcome-night.css`, and its Plans in `welcome/welcome-plans.css` (`lp-`); the other screens in `shell/app.css` and `call/call.css`; the call's timer in `call/call-timer.css`; Chat in a call in `call/call-chat.css` (`ch-`); Notes in a call in `call/call-notes.css` (`nn-` the panel, `nk-` what's captured); the page a call leaves you on in `call/call-over.css` (`co-`).
  Truncate to one or two lines with `ac-clamp-1` / `ac-clamp-2` (left-aligned): unlike `nowrap`, long text
  can't make a column wider than the screen.
  No raw hex in the app, except on the always-night call stage and in illustrations.
- Icons come from Lucide through `Icon` in `@alcove/ui` (one stroke family, 1.8 stroke). Add a name to its map
  rather than drawing an SVG; use an icon button with a tooltip, not a text label, for tile and toolbar actions.
- Every screen must work in light and dark. Check both, and check phone and wide screens.
- `sun` is the only colour you can press: primary buttons are a solid `sun` fill with `on-sun` text and no
  shadow, one per view. It's navy by day and cream by night, so it never glows against the page. The side panel's
  Start a call is a row like the places under it, its camera in a warm circle, so the page's own action is the one filled
  button in view and the place you're on is the one shaded row. The warmth lives in `sun-text` and `sun-soft`.
  `rec` only ever means notes or recording (`NotesSign`, `RecDot`). Problems use `caution`,
  information and focus use `horizon`, and a decision waiting on someone uses `rose`. The mark (`Mark`, `Logo`) is branding, never state. No green.
  One named exception, the approved plans canvas's look (`docs/design/canvas/plans/`): the side panel's notes-left meter
  (`.sb-meter`) runs from `rose` through `sun-text` to `gold`, the logo's own sky, and means only how much is left.
- Type: Newsreader (`font-display`) for page-level headings, a board's name and its frame titles, and nothing
  else; Hanken Grotesk for everything you read and operate, times and data included (`tabular-nums`, or `ac-mono`,
  keeps digits in step), and IBM Plex Mono only for code and hashes. Labels and eyebrows are sentence case, never
  uppercase. Fonts are served from `packages/ui/src/fonts`. Named exceptions, the approved plans canvas's look: Newsreader
  for the side panel's plan name (`.sb-pro b`), checkout's headlines (`CheckoutBig`, `.ck-big`, in Add money's payment
  too), a receipt's title (`PaymentReceipt`) and the plans' prices (`.pl-price` on Plans, `.lp-plan-price` on the welcome
  page). Nothing else.
- The call is always night, but for your side in it, which takes your theme: the stage uses `stage`, `stage-tile`,
  `stage-raised`, `stage-ink`, `stage-ink-2`, `stage-sun` for what's chosen on night controls whatever theme is round them,
  and whoever speaks gets the `speak` ring. People appear in the arch, never a circle.
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
