# Shared presenter timer sequences implementation plan

**Goal:** Implement [issue #84](https://github.com/thebakedalaskan/the-privacy-suite/issues/84): reusable, host-controlled presenter agendas with a synchronized timer for every admitted participant.

**Architecture:** The call owns a sealed sequence and server-clock anchors, independent of its boards and workspace. Existing locked call mutations serialize commands; a timer revision refuses stale controls. Named presets belong to the signed-in account, are sealed independently and only change by an explicit save. Applying a preset copies definitions into a fresh call sequence.

**Stack:** Existing zod contracts, Hono/Postgres, HTTP client LiveStore, React and the Alcove UI kit. No new dependencies.

**Authorization:** The user requested implementation, testing, PR, merge and deployment. Use the repository's dedicated account and signing configuration. Preserve required checks and branch protection.

## Constraints

- Integration tests only, through the real API/client, Postgres and object store.
- No unit/component/browser tests. Verify UI manually using the real rendered application and Storybook.
- Strict typing, existing ownership and backend boundaries; no compatibility shims.
- Existing stored call records open with a default absent sequence. New storage uses an additive migration and sealed records.
- Only the current authorized host/organizer controls timers. Waiting participants learn no sequence details; admitted guests may read.
- Countdown comes from durable clock anchors, never decrementing a local counter. Expiry does not advance, mute anyone or end the call.
- Active segment edits are refused while editing future slots preserves the active clock. Stale concurrent controls do not advance twice.
- Presets contain definitions only, never elapsed/running/overrun state. Presets stay private to their account.
- Reuse the existing panel/popover/top-bar language and shared design tokens, with keyboard focus, phone/wide layouts and both themes.

## Task 1: Contract, server and client

Owners: `packages/api/src/calls/timers.ts`, call state/session/API contracts and exports; `packages/api-http/src/calls`; `apps/api/src/features/calls` and an additive migration.

- [x] Define sequence, segment, preset and command schemas; default the new stored call field.
- [x] Write public API integration flows for definitions, presets, transitions, permissions, stale commands, late joining/reconnect and upgrade behavior; observe failure before implementation.
- [x] Implement sealed presets with explicit account access and physical deletion, and locked timer mutations with server-clock anchors.
- [x] Parse every response in the HTTP client and expose whole snapshots via the existing session.
- [x] Extend privacy canaries and account-deletion verification.
- [x] Run feature integration coverage and server/client/contract type checks.

## Task 2: Call UI and reusable presets

Owners: `apps/web/src/features/call/layout`, shared visuals in `packages/ui`, stand-in API and call stories in `apps/storybook`.

- [x] Show compact current/next countdown outside working content; open a detailed panel from existing call controls.
- [x] Add host sequence editing, duration choices and custom duration, presenter assignment, duplicate/remove/reorder and planned duration.
- [x] Add start/pause/resume/restart/add time/skip/advance with explicit overrun state and local warnings.
- [x] Add preset selection/save/update/rename/duplicate/delete, with intentional save and fresh application.
- [x] Make presets available before the call through the existing entry flow.
- [x] Update Storybook states and journeys for host, guest, empty, paused, warning and overrun.
- [x] Check keyboard, small/wide screens, themes, board/workspace and sharing views; sound disabled must preserve all visual warnings.

## Task 3: Review and release

- [x] Update product/engineering documentation to describe actual behavior and stored-data upgrade.
- [ ] Run structure/type/test/migration policies and the complete integration suite and production builds.
- [x] Independent review of host access, concurrency, stored-data safety, privacy, lifecycle and UI behavior; fix material findings.
- [ ] Commit with the dedicated identity, push, open a PR closing #84 and wait for every required check.
- [ ] Merge without bypassing protection; follow the production deployment to completion and verify its revision and health.

## Review focus

1. Repeated or simultaneous Next presses must never skip a presenter twice.
2. Removing/reordering future slots must preserve the active timer and its presenter.
3. Organizer/host handoff, guest access and lost host connections must follow existing call access.
4. Long names, custom seconds, invalid durations and empty sequences must have useful validation.
5. Applying, updating or deleting a saved preset must not alter an already-running call copy.

## Progress

- Started from `origin/main` at `fd9a22775ea18b661196890fb0f9a42bd5f44910` on `codex/presenter-timer-sequences`.
- Dependencies installed from the frozen lockfile. Existing Docker services are healthy.
- Baseline structure/test/type/migration policies and all package typechecks/builds passed in a clean native checkout. The source checkout contains older nested worktrees that are left untouched.
- Seven timer flows and existing deletion/privacy groups passed: 14 affected integration tests in the clean checkout.
- Independent review findings on operation receipt retention, Unicode payload bounds, clock anchors and conflict recovery were fixed. Manual review covered phone/light/dark, editor and control keyboard focus, background countdown, overrun with sound off and board focus. Full integration CI remains the release gate.
