# Call attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver issue #85 end to end, then merge, deploy and verify production.

**Architecture:** Calls own ordered interactions and audience-filtered snapshots. The HTTP live client rejects old revisions and recovers missed updates; a local output-only scheduler consumes fresh cues. Stateless UI and Storybook show the same live contract.

**Tech Stack:** TypeScript, zod, Hono, Postgres, TanStack/React, Web Audio, Vitest integration flows.

**Spec:** docs/superpowers/specs/2026-11-08-call-attention-design.md

## Global constraints

- Integration tests only through real API/client/Postgres/object store; no unit/component/browser tests.
- No any, assertions except as const, non-null assertions or suppressions.
- New stored fields default; merged migrations unchanged; additive migrations only.
- Content sealed with owner/location binding; queries owner scoped; new data gets leakage coverage.
- Contract changes update server, browser client, app and Storybook together.
- Preserve dedicated repository identity; never use the default GitHub account.
- User already approved the design and build/merge/deploy; proceed autonomously within that scope.

## Review focus

- Cross-room question IDs and moderator authority: mutations must enforce the same audience as reads.
- A duplicate vote from a second browser must not increase the account's total.
- Old responses and reconnect snapshots must not regress queues or replay sound.
- A withdrawn/expired admission or older hand entry must not act on a new request.
- Blocked audio and rapid failed microphone changes must not emit later success sounds.

## Tasks

### Task 1: Interaction contract and authority

**Files:** packages/api/src/calls/{attention,state,session,wire}.ts, packages/api/src/index.ts; apps/api/src/features/calls/attention*.ts and integration suites; additive migration and crypto record registration as required.

**Interface:** CallState.revision and attention {place,hands,questions,signals,cues,latest,serverNow}; methods setHand(up), postQuestion(id,text), voteQuestion(id,on), resolveQuestion(id,status), pinQuestion(id|null), lowerHand(entryId), clearHands(), setFeedback(kind|null). Feedback kinds: cant-hear, slow-down, yes, no, need-break. All actions resolve after authoritative state.

- [x] Write failing whole-call integration flows for queue order, stale entry, Q&A votes/moderation/audience, feedback expiry and admission races.
- [x] Implement focused calls-owned storage/read/action behavior with bounded sealed records, stable identities, current authority and typed cues; document upgrade/retention.
- [x] Run integration flows and policy/type checks; review the task and fix findings.

### Task 2: Live transport integration

**Files:** packages/api-http/src/calls/session.ts and call transport paths.

**Interface:** Implement Task 1's CallSession methods through the action boundary; ignore older revisions, refresh state periodically and keep admission action confirmation authoritative.

- [x] Drive Task 1 flows through the real client and confirm missing methods/behavior fail.
- [x] Implement typed methods, ordering and recovery, including reset on room/generation change.
- [x] Run affected real flows and typecheck; review ordering and cleanup.

### Task 3: Persistent interaction controls

**Files:** packages/ui components/styles/public exports; apps/web/src/features/call/layout, session/InCall.tsx; apps/storybook call stand-in/fixtures/stories.

**Interface:** Task 1 attention snapshot and methods; stateless controls expose handlers and plain data. InCall composes feature-owned behavior.

- [x] Implement accessible queue/Q&A/feedback controls with counts available while sharing or focused, safe host actions, stable sorting, tile indicators and admission reuse.
- [x] Extend ScriptedCall and scenarios/journeys for the new states and actions, phone/wide and light/dark.
- [x] Typecheck/build and inspect representative real rendered layouts; review behavior against the spec.

### Task 4: Output-only audio and preferences

**Files:** identity sound/preferences schemas, account defaults, web shared output and call/media scheduler/hook, settings UI, RingSound, boardRun, Storybook preferences, sound documentation.

**Interface:** Typed Task 1 cues plus successful local device changes, chosen speaker and remembered sound preferences. Hook exposes preview and settings integration to Task 3.

- [x] Extend real account preference flow for save/reload/default upgrades.
- [x] Implement original cues, one scheduler, freshness/dedup/burst policy, quiet mode, master/category controls and previews; integrate existing rings/timers without recording connections.
- [x] Run affected integration checks, typecheck and build; manually inspect playback/device failure behavior and review.

### Task 5: Full verification and release

- [ ] Complete docs/product and engineering updates plus any migration upgrade notes.
- [ ] Run pnpm check against real dependencies and independent code review; resolve substantive findings and rerun affected checks.
- [ ] Open a reviewable PR with exact validation/upgrade details under the repository identity, wait for required CI and merge.
- [ ] Follow production deployment to success, verify deployed commit/health and representative public surfaces, then report observed results and any material limits.
