# Feature Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement #144 and give future agents an explicit, enforced ownership map.

**Architecture:** Feature code and integration coverage live with their owner. App/router/client entry points compose coherent modules, while existing shared infrastructure and deployment entry paths stay stable.

**Tech Stack:** pnpm, Turborepo, strict TypeScript, React/TanStack Start, Hono, Postgres, S3-compatible storage, Node/Vitest integration flows.

**Spec:** `docs/superpowers/specs/2026-11-06-feature-structure-design.md`; target map `docs/engineering/folder-ownership.md`.

## Global Constraints

- Preserve behavior, wire schemas/exports, persisted formats/key labels, migrations and all data.
- Integration tests only. Retain every existing assertion, recursive discovery, privacy/logging/type checks and shared fixtures.
- No compatibility forwarding files, generic utility buckets, folder barrels, new dependencies or arbitrary file-size caps.
- Preserve worker/deployment entry paths, query/API/LiveStore ownership and strict TypeScript.
- Source domains may be implemented concurrently; only their named owner edits them. Root coordinates cross-domain import repairs and final checks.

## Review Focus

- Owner/room refusal, privacy and physical deletion: existing denial/leakage/deletion integration suites must still pass.
- Call rejoin, capture cleanup and room switching: preserve effect/cleanup ordering and exercise existing call/media/notes flows.
- Server middleware phase ordering and limits: feature route registration must preserve public/authenticated/receipt placement.
- Lazy workspace editor/document imports and worker URLs: preserve lazy loading and verify production bundles.
- Moved integration suites: preserve names/assertions and update timing keys; compare Vitest discovery and CI shard plans.

---

### Task 1: Record ownership and establish the baseline

**Files:** design and target documents above; `.env` (ignored local test settings only).
**Interfaces:** produces the target map all source tasks consume; no runtime changes.
- [x] Read #144, current source/exports, privacy/logging rules and all relevant discovery/build paths.
- [x] Record target map and explicit ongoing rules before moving source.
- [x] Verify unmodified source using existing real integration tests on a dedicated test database/bucket; record baseline failures separately.

### Task 2: Organize and deepen the web features

**Files:** `apps/web/src/features/{call,calls}/**`, `apps/web/src/routes/call.$code.tsx`, direct consumers of moved files.
**Interfaces:** preserve public component props and session/LiveStore behavior; introduce explicit room, recorder, screen capture and shortcut hooks and caption presentation in the owning subfeatures.
- [x] Move to the target subfeatures and update every direct consumer, including existing Storybook imports.
- [x] Split local media from notes recording; extract real lifecycle behavior from the call route while preserving effect and cleanup order.
- [x] Reduce the route to composition, keep `call` versus `calls` ownership clear, and verify type/build checks.

### Task 3: Organize server features and HTTP composition

**Files:** `apps/api/src/features/**`, `apps/api/src/http/**`, `apps/api/src/app.ts`, production consumers of `modules/*`; root later moves integration suites and repairs their imports.
**Interfaces:** feature registrars receive explicit shared request context/dependencies and preserve the public/authenticated/receipt registration phases; call internals expose coherent state, MLS and notes behavior to the lifecycle implementation.
- [x] Move the 47 flat modules into the documented feature owners, deleting `src/modules`.
- [x] Extract HTTP handlers with their limits and authorization placement; keep app-level infrastructure shared.
- [x] Extract call persistence/state, MLS and insight/notes responsibilities without changing SQL, records, schemas or key labels.
- [x] Preserve stable server/CLI/document-worker entries and verify typing/building.

### Task 4: Organize contracts and HTTP implementations

**Files:** `packages/api/src/**`, `packages/api-http/src/**`, `packages/api/package.json` export target only.
**Interfaces:** existing `AlcoveApi`, root contract exports, `@alcove/api/retire`, and HTTP root exports remain unchanged; feature factories return the existing feature interface (`AlcoveApi['calls']`, etc.).
- [x] Relocate feature contract modules; split central types/live/wire/API declarations by owner using unchanged declarations/defaults/refinements.
- [x] Extract shared request/parse/NDJSON transport and feature factories; move the active HTTP call session and its crypto lifecycle together.
- [x] Preserve lazy document loading, direct internal imports and deliberate package exports; delete obsolete source paths.

### Task 5: Colocate coverage and enforce the map

**Files:** `apps/api/src/**/*.integration.test.ts`, `scripts/ci-test-times.json`, `AGENTS.md`, scoped `AGENTS.md`, `scripts/check-structure.mjs`, `package.json`, `.github/workflows/ci.yml`, `docs/engineering/folder-move-map.md`, affected docs.
**Interfaces:** `pnpm check:structure` rejects forbidden source homes, runtime package dependencies, unintended barrels and behavior in composition entries; existing test/typing guards stay unchanged.
- [x] Move feature suites next to their owner; cross-feature/infrastructure suites go to `src/integration`. Rewrite imports and timing-map keys without changing assertions.
- [x] Add explicit root/scoped agent rules and structure guard. Prove the guard fails on temporary forbidden paths/imports/entry behavior, remove probes, then prove it passes.
- [x] Wire the guard to local typecheck/check and CI policy; retain recursive existing checks.
- [x] Update every affected source-path reference and publish exact moved/extracted-file inventory.

### Task 6: Verify, review and preserve the result

- [x] Run `pnpm check` on the completed stage against the dedicated real Postgres/object-store fixtures; preserve full test output outside source.
- [x] Compare baseline and final test discovery, confirm shard planning covers all suites and no historical migration/wire/store change exists.
- [x] Review production build/worker outputs and affected call/workspace composition; report any manual/device verification that cannot be performed here.
- [x] Obtain independent branch review, resolve material findings and rerun checks justified by fixes.
- [x] Commit the verified stages with a moved/extracted-file map; report branch, result and remaining limits. Do not merge, deploy or close #144.


## Verification results

- Source implementation and independent review are complete. All reported material review findings were fixed: coordinated capture protocols stay inside notes; structure checks reject inline client behavior, app package aliases and undocumented source buckets.
- Full refactored `pnpm check` passed: all 11 tasks succeeded, including all type checks/builds and 38 integration suites / 1,133 tests. Integration duration was 1,951.50 seconds; total command time was 32m32.14s. The final stricter structure guard also passed separately after the documentation/policy audit.
- Unmodified baseline integration run passed: 38 suites, 1,133 tests, 1,966.69 seconds, on its own database/bucket. The initial local attempt had missing throwaway keys; local test configuration was corrected before behavioral baseline validation.
- All 1,132 Vitest-listed cases across 38 suites are preserved exactly, with 47 unique CI shard units assigning every listed case exactly once. All 37 existing timing entries moved with their suites; the remaining suite keeps its previous default estimate.
- Independent AST comparison preserved all 212 calls declarations, 196 ordered HTTP registrations, 46 other moved server modules, and 973 contract declarations (341 schemas and 15 feature interfaces), with zero changes in behavior expressions. All 736 contract export names and 443 runtime contract exports remain available.
- The moved migration suite's fixture path was reproduced failing in both flows, corrected for its new depth, and verified passing (2/2).
- Structure policy passed 22 temporary negative probes and the clean fixture, without adding isolated tests or dependencies. Existing test/type/privacy guards, historical migrations and lockfile are unchanged.
- Manual browser checks passed demo sign-in, workspace/document creation, saved-content reopen, camera/mic-off call join, in-call workspace and explicit end-call cleanup. A separate loopback hostname avoided cookies from other local apps. Camera/microphone capture and multiple simultaneous browser participants were not exercised manually. Temporary preview servers were stopped afterwards.

## Merge integration stage

The user authorized merging. Main advanced to `b7f61754221b34b160dc4a524de9138859cb89ad` with camera backgrounds, Google popup sign-in and scoped agent MCP. Preserve each feature while applying the amended ownership map before moving its newly introduced files. Resolve the combined branch, update scoped rules and guard owners, verify integration/type/build checks again and merge through the required pull request checks. GitHub connection currently needs reauthentication; the repository guard prohibits using the default account.
