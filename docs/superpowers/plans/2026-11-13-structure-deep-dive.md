# Structure deep dive: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding of the 13 Nov 2026 structure review (flat folders, a 42-file import cycle across server features,
shared code living in page folders, oversized components and files, mixed naming) and make `scripts/check-structure.mjs`
enforce the result so the smells can't come back.

**Architecture:** Task 1 moved files mechanically (`scripts/move-files.mjs`) and rewrote the structure check, which now
fails with 159 listed violations. Tasks 2–6 each own one area, run in parallel worktrees and finish when
`node scripts/check-structure.mjs <their paths>` passes with behaviour unchanged. Task 7 writes the guides and merges.

**Tech Stack:** pnpm + Turborepo, Hono on Node, TanStack Start/Router/Query, React 19, Storybook, Vitest integration tests,
the TypeScript compiler API (`typescript-parser`) in the checks.

**Spec:** the review itself: its findings and order are recorded in this plan; the rules are in `scripts/check-structure.mjs`.

## Global Constraints

- Behaviour, markup, wire shapes, stored records, record headers, key labels, SQL and migrations don't change. No migration.
- Integration tests only (`*.integration.test.ts`, real API over HTTP); no unit, component or browser tests; Storybook checks nothing.
- Strict TypeScript: no `any`, no `as` (except `as const`), no `!`, no suppressions. `scripts/check-types.mjs` enforces it.
- No compatibility shims, forwarding files, folder `index.ts` barrels, `export *` outside package entries, or `utils`/`common`/`misc`/`helpers` folders.
- Move files with `node scripts/move-files.mjs <from> <to> …` so imports, CI timing keys and doc paths follow; never by hand.
- Privacy: nothing readable in columns, object names, URLs, logs or errors; every query scoped by `owner_id`; deletion stays physical.
- Logging: `log` from `apps/api/src/platform/log.ts` or `apps/web/src/lib/log.ts`; specific `AppError`s; no `console.*`.
- The rules, as `scripts/check-structure.mjs` states them:
  - server features import only those before them: `profile → billing → workspaces → meetings → recordings → notes → calls → agents → account`;
  - shared server homes (`platform`, `keys`, `tee`, `inference`, `providers`, `http`, `live`, `edge`) never import a feature;
    only `app.ts`, `start.ts`, `server.ts`, `maintenance.ts` and the CLIs compose features;
  - web `lib/` never imports a feature; features never import routes; route files hold no state, effects or refs;
  - no runtime import cycle spans two owners; a component or hook owns at most 10 effects and 15 pieces of state;
  - a folder holds at most 20 files, and no 4 files in it start with a word that isn't the folder's own;
  - kebab-case files in the API, packages and Storybook helpers; PascalCase components and camelCase modules in the web app.
- Never weaken a rule or add an exception to make it pass. If a rule is wrong, stop and say why.

## Review Focus

- Deleting an account still removes every row, receipt and object it owns once sign-in and deletion stop living in `account.ts`.
- Someone seated in a call (host, guest, presenter) can open exactly what they could before, after workspaces stops importing calls.
- A notification still shows once per event across tabs (attention channel, Web Lock, service worker) from its new folder.
- The call screen's lifecycles (connect, reconnect, leave, recorder, floating window, shortcuts) keep their order and cleanup after `InCall.tsx` is split.
- Query keys, invalidation, optimistic writes and the sign-out cache reset are unchanged after queries move into features.

---

### Task 1: Move files and write the checks (done, `9e63c48bd`)

- [x] `scripts/move-files.mjs`: moves files, rewrites imports in every package, CI timing keys and path mentions.
- [x] Move the API root into `platform/`, `keys/`, `tee/`, `inference/`, `providers/`; split `calls`, `notes`, `workspaces`,
      `billing`, `recordings` and `testing`; web `notifications/`, `call/{chat,attention,timer,stage,floating}`, workspace and
      a call's page subfolders; kebab/camel renames.
- [x] Rewrite `scripts/check-structure.mjs` with the rules above. `node scripts/check-structure.mjs` lists 159 violations.

### Task 2: Server dependency direction (`apps/api`, `packages/api`)

**Files:** `apps/api/src/features/**`, `apps/api/src/{http,live,keys}/**`, `apps/api/src/{app,start,maintenance}.ts`,
`packages/api/src/calls/**`.

- [ ] Run `node scripts/check-structure.mjs apps/api packages/api`: 62 violations (47 upward feature imports, 13 shared → feature, the 42-file cycle, `packages/api/src/calls` with 24 files).
- [ ] Remove each upward import by one of: passing the value or function in from the caller; moving the piece down to the feature that owns its data; composing in `app.ts`/`start.ts`/`maintenance.ts` (e.g. what signing in and deleting an account do in other features); moving a shared constant or type down.
- [ ] Split `notes/service.ts`, `notes/writing/drafting.ts` and `workspaces/documents/documents.ts` along their responsibilities, without changing behaviour.
- [ ] Split `packages/api/src/calls` into subfolders matching the server's `calls/` ones.
- [ ] Run the touched integration suites, then every suite under `apps/api/src/features` and `src/integration/{flows,privacy}`. All pass.
- [ ] `npx tsc -p apps/api` and `node scripts/check-types.mjs` pass; commit.

### Task 3: Web data and shared code (`apps/web/src/lib`, query consumers)

- [ ] Run `node scripts/check-structure.mjs apps/web/src/lib`: 12 violations.
- [ ] Split `lib/queries.ts` into `features/<owner>/queries.ts` (keys, `queryOptions`, hooks, mutations beside their feature); `lib/` keeps the client, key helpers and cache plumbing. Keys and invalidation are unchanged.
- [ ] `lib/live.ts` stops importing `call/media` and `record`.
- [ ] Split `home/day.ts`: the calls-ahead model joins `calls/list/ahead.ts`, inbox counts and due dates go to their owners.
- [ ] `npx tsc -p apps/web`, a production build of the web app, and `optimistic.integration.test.ts` pass; commit.

### Task 4: The call, routes and big components (`apps/web/src/features/{call,workspace,board}`, `apps/web/src/routes`)

- [ ] Run `node scripts/check-structure.mjs apps/web/src/routes apps/web/src/features`: 60 violations.
- [ ] Every route file declares the route and renders a page component from its feature; state, effects and refs move there.
- [ ] Split `InCall.tsx` (38 effects), the workspace's `Pane` (16) and `useCallBoard` (11) into lifecycle hooks in the subfeatures that own each lifecycle, keeping effect order and cleanup.
- [ ] Split `features/board` (22 files) into subfolders.
- [ ] `npx tsc -p apps/web`, the web build, and Storybook's call and workspace journeys render; commit.

### Task 5: The UI kit by area (`packages/ui`)

- [ ] Group `components/` and `styles/` into area folders, each component file beside the CSS it uses; `styles.css` imports them.
- [ ] Remove the `components/workspace/index.ts` barrel; `src/index.ts` stays the one entry.
- [ ] Declare `sideEffects` in `packages/ui/package.json` (the CSS and `css-vars.ts`); compare the web build's chunks before and after and record the numbers.
- [ ] Write `packages/ui/AGENTS.md`; point the root AGENTS.md design-system section at the new paths.
- [ ] `node scripts/check-structure.mjs packages/ui` passes, the web app and Storybook build; commit.

### Task 6: Storybook (`apps/storybook`, `docs/product/user-flows.md`)

- [ ] Journeys in one folder per user-flows section, numbers unique and matching `docs/product/user-flows.md`.
- [ ] Story folders of more than 20 files split by area; titles follow folders; the loose `Ws*` stories join `components/workspace/`.
- [ ] Split `src/api/call.ts` (2,046 lines) and the 20-plus-file `src/api` and `src/world` folders; no `index.ts` (point `.storybook/main.ts`'s module replacements at the renamed files).
- [ ] `node scripts/check-structure.mjs apps/storybook` passes and `pnpm --filter @alcove/storybook build` succeeds; commit.

### Task 7: Guides, merge and review

- [ ] `docs/engineering/folder-ownership.md`: the new map, every web feature, the dependency direction and why.
- [ ] Root and scoped `AGENTS.md`, and a `code-structure` skill with worked fixes for each rule.
- [ ] Merge Tasks 2–6; `pnpm check` passes (structure, types, tests, migrations, build); one whole-branch review; pull request.
