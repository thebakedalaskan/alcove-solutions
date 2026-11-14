# Folder ownership

Where code lives, which way it may depend, and why. `scripts/check-structure.mjs` enforces every rule here in
`pnpm check:structure`, `pnpm typecheck`, `pnpm check` and CI (`node scripts/check-structure.mjs <path>` shows one area).
The `code-structure` skill (`.claude/skills/code-structure/SKILL.md`) shows the fix for each failure, and scoped
`AGENTS.md` files add each area's own rules. Move and rename files with `node scripts/move-files.mjs <from> <to> …`.

## Why it's shaped this way

- **By feature, not by kind.** Code lives with the behaviour a maintainer changes: its implementation, private helpers,
  types and (on the server) integration suites side by side, so a change and its verification stay in one place
  ("place code as close to where it's relevant as possible": Kent C. Dodds, *Colocation*). Folders are named for what
  they do (`boards/`, `offline/`), never for what their files are (`components/`, `hooks/`, `utils/`).
- **Dependencies point one way.** Shared code sits below features and composition above them (Bulletproof React:
  shared → features → app; Feature-Sliced Design: a layer imports only the layers below it). Until 13 Nov 2026 the
  server's features imported each other freely, and 42 files across seven of them formed one import cycle. The order
  below ended it, and the check keeps it ended.
- **Small folders.** A folder of 30 to 60 files is a list to scroll, not a map. Past 20 files, or once four names start
  with the same word, the folder is hiding a subfolder (Angular's style guide: split a directory once it's hard to
  navigate).
- **No barrels.** Every file is imported from where it lives. Folder `index.ts` re-exports hide ownership and slow
  bundlers (Turborepo, Vite and TkDodo all advise against them). The packages' own entries are the one exception, and
  `@alcove/ui` declares its side effects so bundlers drop what a page doesn't use.
- **Thin composition.** Routes, `app.ts` and the HTTP client's entry only compose. A component or hook owns at most 10
  effects and keeps at most 15 pieces of state; past that it's several lifecycles or components in one.
- **One naming style per area,** so a name says what a file is before it's opened: kebab-case on the server, in the
  packages and in Storybook's helpers; `PascalCase.tsx` for a web component and `camelCase.ts(x)` for anything else.

## The rules

| Rule | Limit |
| --- | --- |
| Server features import only those before them | `profile → billing → workspaces → meetings → recordings → notes → calls → agents → account` |
| Shared server homes never import a feature | `platform`, `keys`, `tee`, `inference`, `providers`, `http`, `live`, `edge` |
| `apps/api/src` holds only composition and build entries | `app.ts`, `server.ts`, `start.ts`, `maintenance.ts`, `migrate.ts`, the CLIs |
| Web `lib/` never imports a feature; features never import routes | |
| No runtime import cycle spans two owners | type-only imports don't count |
| Files in one folder | at most 20 |
| Files in one folder starting with a word that isn't the folder's own | at most 3 |
| Effects in one component or hook (web, UI kit) | at most 10 |
| State hooks (`useState`, `useReducer`) in one component or hook | at most 15 |
| Route files | no `useState`, `useReducer`, `useRef`, `useEffect`, `useLayoutEffect`, `useSyncExternalStore` |
| Index files and `export *` | package entries only |
| `utils`, `common`, `misc`, `helpers` folders | none |
| Folder names | kebab-case |

Tests (`*.integration.test.ts`) sit above everything and may import any feature.

## The server's feature order

Each feature imports only those before it. When code needs something from a feature after it, it takes it as an
argument from the caller, or the piece moves down to the feature that owns its data, or the flow is composed above.

1. **profile**: who someone is (the profile record, `me`, preferences, portraits and photos), which every feature shows.
2. **billing**: plans, the AI allowance (`meter/`), storage, teams and licenses (`teams/`), top-ups (`top-ups/`).
3. **workspaces**: the tree, access, documents (`documents/`), uploads, the library, boards' presenter notes, mentions,
   and a document's live room (`live/`). It knows nothing of calls: calls hands it what it needs about seats.
4. **meetings**: the schedule, invitations, the calendar, repeats, the people directory and the demo company's week.
5. **recordings**: audio, screen frames (`screens/`), transcripts.
6. **notes**: saved notes, additions, writing them (`writing/`), series, personal notes, links, room recordings, Google
   Drive exports (`drive-exports/`).
7. **calls**: the running call: lifecycle, state, joining and hosting at its root; `boards/`, `workspace/`, `notes/`
   (live notes and capture), `chat/`, `attention/`, `ringing/`, `timers/`, `moves/`, `mls/`.
8. **agents**: grants, OAuth, MCP tools (`mcp/`) and what agents did, across everything below.
9. **account**: an account's whole life: signing in, sessions, deleting it. It reaches into every feature, so it's
   last. Deleting an account calls each feature's delete step from one place.

## Package responsibilities

| Location | Owns |
| --- | --- |
| `apps/api/src` | Composition and build entries only: `app.ts` (middleware and feature registrars, in their phases), `start.ts`, `server.ts`, `maintenance.ts`, `migrate.ts` and the CLIs. esbuild's outputs and the migrations URL depend on these paths. |
| `apps/api/src/platform` | Configuration, the request context (`Deps`, `Owner`), the database, objects, logging, errors, limits, feature flags, time zones. |
| `apps/api/src/keys` | Sealing (`crypto.ts`), owner and server keys, sessions, the vault, signed call passes and media tokens. |
| `apps/api/src/tee`, `inference`, `providers` | Confidential Space and its images; NEAR AI with Oblivious HTTP and model attestation; Google and LiveKit. |
| `apps/api/src/http`, `live`, `edge` | Request infrastructure; the realtime hub and document worker pool (a feature hands it its tasks); TLS, certificates and the web app's files. |
| `apps/api/src/features` | The nine features above, each with its HTTP registration and integration suites. |
| `apps/api/src/integration`, `testing` | Cross-feature suites; the harness and fakes of outside services (`testing/fakes/`). |
| `apps/web/src/routes` | Route declarations: loaders, guards, search schemas, and the feature page each renders. |
| `apps/web/src/features` | Every screen and its data access, by feature (below). |
| `apps/web/src/lib` | What every feature shares: the API client (`api.ts`, the only importer of `@alcove/api-http`), the query client and cross-feature writes (`queryWrites.ts`), feature flags, trust, logging, live stores, keys, time and words. |
| `packages/api/src` | Contracts only, by feature (the call's contracts in subfolders matching the server's); `client.ts` composes `AlcoveApi`. |
| `packages/api-http/src` | The HTTP client, by feature, with `transport/` and `trust/`; `index.ts` composes it. |
| `packages/ui/src` | The design system, by area, each component beside its CSS (see `packages/ui/AGENTS.md`). |
| `packages/board` | A board's Y.Doc shape and the logic the app and API share. |
| `apps/storybook` | Stories by area, journeys by user-flows section, and the stand-in API by feature (see `apps/storybook/README.md`). |

## The web app's features

```text
account/        who's signed in: signing in and out, guards, this device, the you menu
agents/         the Agents page and connecting an agent (/connect)
board/          a board on its own page and in a call: input/, people/, tools/, more/
call/           the running call, only in its subfeatures:
  session/        the call screen (InCall.tsx composes), connection, leaving, the call's page handoff
  media/          devices, LiveKit, tracks, video, backgrounds
  screen-sharing/ what can be shared, a share in its frame, pointing
  layout/         the shell of the call: top bar, panels, your side, Share's steps, reactions
  stage/          what's on your stage, its layout and frames, tiles
  chat/           Chat: conversations, threads, mentions, questions, private messages and their alerts
  attention/      hands, nudges, status, the call's notifications
  timer/          the call's timer
  notes/          the recorder, captions, live notes and catch-up
  rooms/ workspace/ boards/ playback/ floating/
calls/          making, scheduling, listing and entering calls: flow/, scheduling/, lobby/ (joining), ringing/, list/
drive/          the Drive
examples/       the made-up example call and its people, for first-run surfaces
home/           Home
move/           moving a call to another device
notes/          a call's page: follow-ups/, player/, sharing/, personal/, series/, and the parts other pages show
notifications/  delivery, permission, pausing, preferences, sounds, and their controls
onboarding/     a new account's arrival, the tour, sailing out to Home
plans/ record/ settings/ shell/ team/ welcome/
workspace/      a workspace: tree/, document/, find/, uploads/, offline/, sharing/, full-screen/, live/, editor/
```

Each feature's data access is its own `queries.ts` (with `queryKeys.ts`, which imports nothing, so another feature can
invalidate its data without an import cycle).

## Changing the map

A new owner, a changed dependency direction or a new shared home is a decision: change this page, the scoped
`AGENTS.md` and `scripts/check-structure.mjs` together, and say why. Never loosen a rule to get a green check. Renaming
source never renames record kinds, key labels, tables, migrations, wire fields or routes. The 13 Nov 2026 reorganization
is recorded in `docs/superpowers/plans/2026-11-13-structure-deep-dive.md`; the one before it in
`docs/superpowers/plans/2026-11-06-feature-structure.md` and `folder-move-map.md`.

Prefer the codebase knowledge graph for discovery, but check its excluded-directory report: a result with no matches
means nothing when the index skipped a documented home (notably a folder named `media` or `integration`).
