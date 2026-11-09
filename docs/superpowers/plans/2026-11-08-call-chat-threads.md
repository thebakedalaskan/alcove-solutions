# Call chat replies implementation plan

> **For agentic workers:** Use the existing issue #87 scope and implement in its isolated branch. User authorized autonomous execution, review, merge and deployment.

**Goal:** Thread room and private call messages without changing their audience or losing drafts.

**Architecture:** Extend the existing encrypted chat payload and #86 direct-message payload with one nullable thread reference. Derive displayed threads from the existing LiveStores. Keep local draft/navigation state separate from authoritative message delivery.

**Tech Stack:** Strict TypeScript, zod, Hono, existing MLS/direct-message encryption, React, @alcove/ui, Vitest API integration flows.

**Spec:** `docs/superpowers/specs/2026-11-08-call-chat-threads-design.md`

## Global constraints

- Integration tests only through the real API and HTTP client; no unit, component or browser tests.
- Existing stored encrypted payloads parse with a defaulted null thread. No historical migration/header/key change.
- Root/parent references cannot expand a room/private audience; retry cannot move a draft.
- Keep folder ownership, strict types, privacy logging and Storybook contracts intact.

## Review focus

- Replies to replies stay under the original and keep specific parent context.
- A late joiner sees an unavailable-original placeholder without recovered old text.
- Concurrent or ambiguously acknowledged sends never duplicate or escape the thread.
- Room/recipient changes preserve drafts under the original unavailable audience.
- Focused visible replies alone clear read state; relevant authors/participants receive scoped attention.

### Task 1: Encrypted room threads

Files: `packages/api/src/calls/session.ts`, `packages/api-http/src/calls/session.ts`, colocated `apps/api/src/features/calls/threads.integration.test.ts`, contract exports and every existing producer.

- [x] Add real three-client flow for original → reply → reply-to-reply, concurrent replies, inherited room and encrypted metadata; observe failure before implementation.
- [x] Add nullable defaulted thread reference and public reply operation; validate readable current-audience parents and keep one root.
- [x] Preserve parent/root through outbox acknowledgement/retry; show failed sends in original destination.
- [x] Verify late join/reconnect and cross-room refusal, retained ciphertext privacy and call-end cleanup.

### Task 2: Private threads

Files: #86's direct-message contract, encrypted payload owner, lifecycle and integration suite.

- [x] Integrate reviewed #86 first; add real recipient-only thread/retry/room-revocation flow and observe failure.
- [x] Preserve exact conversation identities, generation and original room; validate private parent/root and keep content out of shared snapshots.
- [x] Verify third-party/host denials, departure and call-end cleanup.

### Task 3: Conversation presentation

Files: `apps/web/src/features/call/layout/Panel.tsx`, focused thread/composer owners, `packages/ui/src/styles/call.css`, Storybook stand-in and journeys.

- [x] Extract coherent chat presentation only where needed; add Reply, root counts/unread state, thread view/back, unavailable original and per-audience/thread drafts.
- [x] Preserve scroll/focus; show pending/failed/retry and audience labels. Mark only visible focused messages read.
- [x] Add scoped reply preferences/local attention without OS delivery duplication.
- [x] Extend stand-in and actual-call states/journeys; check phone/wide, light/dark and keyboard manually.

### Task 4: Review and release

- [x] Run all guards, typechecks, builds and meaningful integration flows on unique test database.
- [x] Independently review complete diff against every #87 criterion and fix findings.
- [ ] Create separate PR with upgrade/validation notes, pass required CI, merge, deploy and verify matching public web/API release.

## Verification checkpoint

- Room: six real multi-client flows passed (11.37s after canonical ordering review); four private flows passed (7.52s). Additional real preference save/read/isolation flow passed.
- Independent protocol review found and fixed accepted/lost acknowledgements across a room move and canonical ordering. Generation fences prevent re-encrypting older replies.
- Manual CUA: wide room thread and separate drafts through room/private detours, phone private light, unavailable-original phone dark, keyboard Reply→composer focus, failed Retry→one retained confirmed reply, generic relevant alert→exact thread/message. Current viewport overrides reset.
- UI and client source review and the complete repository check are pending. This checkpoint is not a release claim.

## UI review follow-up

- Separated permission to send/retry from already-authorized readable private history. A departed peer leaves its retained history readable, and viewing it clears its unread count.
- Unavailable originals no longer offer a composer action that targets an inaccessible parent. Manual phone verification sent a confirmed reply via its readable parent instead.
- Retained replies from departed authors continue to count until read; fresh alerts separately check current eligibility.
- Toast actions recheck the exact captured session and call ID as well as generation, room and readable message.
- Root/parent and read lookups use maps/sets. Alert/sound baselines observe all confirmed incoming IDs, preventing a viewer’s first participation from alerting about recent old replies.
- Fresh full-package typechecks pass. Final independent re-review, production build and release checks remain pending.

- Final caller trace: `CallPage` keys `InCall` by call and exact connection identity, explicitly separating draft/scroll/audience memory across calls and replacement connections. Independent reviewer agreed with the boundary; same-connection reconnect retains memory.

- Visible mention-span reads derive from the displayed authorized unread messages, independently of fresh-alert candidates. This prevents retained old-room/private mentions from being excluded from both span and generic read observers.

## Final local verification

- Full repository run: 46/47 suites, 1,253/1,254 tests passed in 36m30s. Its sole failure was the existing reload fixture accepting the old two-person call snapshot before the separate call-state store had replaced the identity.
- Strengthened that fixture’s wait to require the exact replacement identity, leaving the final participant equality assertion unchanged. No production behavior changed for this fixture correction.
- With released main #192 integrated, all five affected/related suites passed: 109/109 tests (all 65 calls, six room-thread, four private-thread, 11 screen and 23 Drive export flows), 258.18s on isolated `alcove_test_87` after the full process exited.
- API protocol, UI/alerts/read lifecycle, exact call/connection boundary and retained mention-span read follow-ups have independent source sign-off. Final actual-head CI is required before merge; deployment remains pending.
