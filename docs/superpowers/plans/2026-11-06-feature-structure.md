# Feature Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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
- [ ] Verify unmodified source using existing real integration tests on a dedicated test database/bucket; record baseline failures separately.

### Task 2: Organize and deepen the web features

**Files:** `apps/web/src/features/{call,calls}/**`, `apps/web/src/routes/call.$code.tsx`, direct consumers of moved files.
**Interfaces:** preserve public component props and session/LiveStore behavior; introduce explicit room, recorder, screen capture and shortcut hooks and caption presentation in the owning subfeatures.
- [ ] Move to the target subfeatures and update every direct consumer, including existing Storybook imports.
- [ ] Split local media from notes recording; extract real lifecycle behavior from the call route while preserving effect and cleanup order.
- [ ] Reduce the route to composition, keep `call` versus `calls` ownership clear, and verify type/build checks.

### Task 3: Organize server features and HTTP composition

**Files:** `apps/api/src/features/**`, `apps/api/src/http/**`, `apps/api/src/app.ts`, production consumers of `modules/*`; root later moves integration suites and repairs their imports.
**Interfaces:** feature registrars receive explicit shared request context/dependencies and preserve the public/authenticated/receipt registration phases; call internals expose coherent state, MLS and notes behavior to the lifecycle implementation.
- [ ] Move the 47 flat modules into the documented feature owners, deleting `src/modules`.
- [ ] Extract HTTP handlers with their limits and authorization placement; keep app-level infrastructure shared.
- [ ] Extract call persistence/state, MLS and insight/notes responsibilities without changing SQL, records, schemas or key labels.
- [ ] Preserve stable server/CLI/document-worker entries and verify typing/building.

### Task 4: Organize contracts and HTTP implementations

**Files:** `packages/api/src/**`, `packages/api-http/src/**`, `packages/api/package.json` export target only.
**Interfaces:** existing `AlcoveApi`, root contract exports, `@alcove/api/retire`, and HTTP root exports remain unchanged; feature factories return the existing feature interface (`AlcoveApi['calls']`, etc.).
- [ ] Relocate feature contract modules; split central types/live/wire/API declarations by owner using unchanged declarations/defaults/refinements.
- [ ] Extract shared request/parse/NDJSON transport and feature factories; move the active HTTP call session and its crypto lifecycle together.
- [ ] Preserve lazy document loading, direct internal imports and deliberate package exports; delete obsolete source paths.

### Task 5: Colocate coverage and enforce the map

**Files:** `apps/api/src/**/*.integration.test.ts`, `scripts/ci-test-times.json`, `AGENTS.md`, scoped `AGENTS.md`, `scripts/check-structure.mjs`, `package.json`, `.github/workflows/ci.yml`, `docs/engineering/folder-move-map.md`, affected docs.
**Interfaces:** `pnpm check:structure` rejects forbidden source homes, runtime package dependencies, unintended barrels and behavior in composition entries; existing test/typing guards stay unchanged.
- [ ] Move feature suites next to their owner; cross-feature/infrastructure suites go to `src/integration`. Rewrite imports and timing-map keys without changing assertions.
- [ ] Add explicit root/scoped agent rules and structure guard. Prove the guard fails on temporary forbidden paths/imports/entry behavior, remove probes, then prove it passes.
- [ ] Wire the guard to local typecheck/check and CI policy; retain recursive existing checks.
- [ ] Update every affected source-path reference and publish exact moved/extracted-file inventory.

### Task 6: Verify, review and preserve the result

- [ ] Run `pnpm check` on the completed stage against the dedicated real Postgres/object-store fixtures; preserve full test output outside source.
- [ ] Compare baseline and final test discovery, confirm shard planning covers all suites and no historical migration/wire/store change exists.
- [ ] Review production build/worker outputs and affected call/workspace composition; report any manual/device verification that cannot be performed here.
- [ ] Obtain independent branch review, resolve material findings and rerun checks justified by fixes.
- [ ] Commit the verified stages with a moved/extracted-file map; report branch, result and remaining limits. Do not merge, deploy or close #144.
