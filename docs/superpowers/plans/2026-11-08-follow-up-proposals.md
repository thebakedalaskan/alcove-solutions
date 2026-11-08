# Follow-up Proposals Implementation Plan

> **For agentic workers:** Execute the approved design in this session with parallel owners for backend/contracts, application/UI and Storybook; root coordinates integration, documentation, validation and whole-branch review. Steps use checkbox syntax for tracking.

**Goal:** AI suggests TODOs and changes; people promote or dismiss them during or after calls while the actual checklist stays stable.

**Architecture:** Preserve actual follow-ups independently of changing inference output. Existing sealed records hold proposal revisions, change targets and durable review receipts. Public task arrays stay actual-only, with separate proposal arrays and explicit review mutations.

**Tech Stack:** TypeScript, zod, Hono/Postgres, TanStack Query/React, existing Alcove UI kit and Vitest API integration harness.

**Spec:** `docs/superpowers/specs/2026-11-08-follow-up-proposals-design.md`

## Global Constraints

- The model proposes; a person decides what becomes a task.
- Actual task arrays contain accepted tasks only.
- Adding records a task; “I'll do it” accepts responsibility.
- Old stored actions remain accepted by default. Newly inferred actions are explicitly suggested.
- Preserve existing room/view/document access, sealed storage, strict types and integration-only testing.
- No new dependencies, browser tests, unit tests, resets or legacy wire fallback.

## Review Focus

- Concurrent acceptance and an in-flight refresh produce one actual task and preserve the person's review.
- A change to the target after review opened refuses the stale proposal; ownership consent is never forged.
- A dismissed proposal cannot return after paraphrase, call end, writer retry or rewriting saved notes from the same evidence.
- Partial transcript views and private document access never widen through known-item matching or proposed changes.
- Previous-release records retain their actual tasks; model suggestions never inflate inbox, series or open-task counts.

## Task 1: Contract and durable proposal lifecycle

**Owner:** backend agent. **Files:** `packages/api/src/calls/{catchup,workspace,session,wire}.ts`, `packages/api/src/notes/{entries,schema,wire,client}.ts`, their public exports; `packages/api-http/src/{calls,notes}`; `apps/api/src/features/calls/{live-notes,insights,workspace}.ts`; `apps/api/src/features/notes/{drafting,writer,service,entries}.ts` and directly owning files.

**Interfaces:** Separate wire `suggestions` arrays and actual-only existing task arrays. Shared proposal has id, revision, text, suggested owner/date/evidence and optional target/base snapshot. `CallSession.reviewFollowUp({id,revision,decision:'accept'|'dismiss'})` and `api.notes.reviewAction(noteId, review)` are authoritative review boundaries. Live creation/edit methods include explicit owner and due date; backend validates owner identity.

- [ ] Extend real client/API integration flows with suggested-vs-actual assertions, promotion, dismissal, stale/opposing review, accepted-target changes, access refusals, handover/rewrite and stored-record defaults. Run and observe meaningful failures before implementation.
- [ ] Implement defaulted stored review/proposal metadata, wire parsing and methods, locked/idempotent review, stable accepted task identity and accepted/dismissed evidence suppression. Model output only adds proposals; no auto mutation of actuals.
- [ ] Exclude pending/dismissed proposals from server counts, inbox, series and actual projections; preserve review during final-note writing and failure/retry.
- [ ] Run focused integration suites and API/client typing; report exact commands and results.

## Task 2: Shared review and task editing in the real UI

**Owner:** UI agent. **Files:** reusable stateless editor/review visuals under `packages/ui/src/components`, existing UI styles/exports; `apps/web/src/features/workspace/live/{LivePage,useFollowUps,lines}.tsx` (existing extensions apply); `apps/web/src/features/call/layout/Panel.tsx`; saved-note components and query mutations under their existing owners.

**Interfaces:** Consume Task 1's actual-only lists, proposal arrays and review/create/edit methods. Feature hook owns the fixed review batch; presentation remains in the UI package. Existing saved-note ownership controls continue to implement consent.

- [ ] Compose actual checklist, manual add/edit and quiet suggestion count in both call surfaces and saved notes, with evidence and source navigation.
- [ ] Freeze a review batch on opening, count newer arrivals separately, and keep resolved/stale rows stable with clear feedback and accessible controls.
- [ ] Show Add/Dismiss for new proposals, Apply change/Dismiss with before/after for amendments. Preserve “I'll do it” as separate consent.
- [ ] Check all task list/count consumers use actuals; run UI/web typing/build and inspect narrow/wide light/dark scenarios.

## Task 3: Storybook, documentation and verification

**Owner:** Storybook agent for `apps/storybook/**`; root for docs and validation.

**Interfaces:** Stand-in implements the same Task 1 contract and review behavior; scenarios render Task 2 components with actual/suggested/dismissed/change/after-call states.

- [ ] Update stand-in mutations and fixtures and add numbered journeys for in-call and after-call review, incoming proposals and stale feedback. No test runner/assertions.
- [ ] Update `docs/product/user-flows.md`, `docs/engineering/notes-and-inference.md` and privacy/upgrade documentation to describe the final implementation.
- [ ] Run policy/type/structure/migration guards, complete integration tests and builds. Resolve failures without loosening policies.
- [ ] Obtain fresh whole-branch review covering the spec and five Review Focus conditions; fix material findings and verify fixes.
- [ ] Commit with the repository-scoped identity, push the feature branch, open a PR with behavior/validation/stored-record upgrade details and attach it to the chat.
