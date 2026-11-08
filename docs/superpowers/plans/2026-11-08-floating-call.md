# Floating call implementation

Issue: https://github.com/thebakedalaskan/the-privacy-suite/issues/109

## Scope and constraints

Build manual Document Picture-in-Picture and opt-in browser-driven automatic opening, using the existing call session, allowed media feeds, control actions, recording and audio ownership. Keep normal call controls available on unsupported browsers. The compact window shows a settled speaker or selected live screen, connection/device states, hand/admission/new-chat counts, microphone, camera, hand, Leave and Return. Never show personal notes or message bodies. Call-chat mentions do not exist: #107 owns recipient/read semantics; label current unread messages Chat, document the dependent acceptance criterion, and do not close #109 as fully satisfied while it remains.

Follow root/scoped rules: feature ownership, strict TypeScript, no assertions/any, privacy, integration-only tests and Storybook journeys without assertions. Browser window/presentation behavior is checked manually through the actual UI; do not introduce prohibited unit, component or browser tests. No database/wire changes needed for the core view. Add any browser-local preference to a contract schema with a default so saved preferences still read. Preserve sealed schemas, encryption and room filtering.

## Task 1: call-owned floating window and compact presentation

- Build in `apps/web/src/features/call/session` with a small explicit lifecycle owner and presentation composer; stateless reusable visual parts/styles belong in `packages/ui`.
- Share actual `InCall` media snapshots and microphone/camera/hand/departure callbacks. Add pending/error handling shared by both views as needed, without a second session/LocalMedia/room/capture owner.
- Reuse `FeedVideo` (muted); audio remains in `CallRoom`. Do not mount `ShareSurface` twice (single-view zoom/history owner).
- Reuse/deepen the existing `screen-sharing/popOut.ts` stylesheet/CSP/font/window capability with a concrete call-window owner. Coordinate with `ShareLooks.popped`: opening one PiP mode must reconcile the other; browser-driven auto opening must not unexpectedly replace an existing share window.
- Explicit `Open floating call` entry in View or equivalent call chrome. Unsupported/blocked state accessible and normal call unchanged. Start compact, allow browser resizing, keyboard labels and visible focus, preserve stage/night and current theme where appropriate.
- Dedicated child-document portal destinations for overlays/tooltip/errors, no focus leaking to main tab except explicit Return or a requested full-view action. Use existing departure confirmation/flush/handoff; leave window open if departure fails. Child close never leaves the call, parent/terminal cleanup always closes child, reject late request results after cleanup, transient reconnect retains view.
- Auto preference off by default and browser-local per account, with `.default(false)` on stored schema addition; no camera/microphone/capture requests for eligibility. Register Media Session `enterpictureinpicture` safely only when appropriate, unregister only owned handlers, preserve existing shared-video play/pause/metadata. Native event invokes request; do not call from arbitrary blur/visibility events. Close auto-opened presentation when meeting visible, distinguish manual opening where possible; no focus stealing/reopen loops.
- Counts reflect authorized/current room scope. Generic unread-chat counting must not acknowledge while main chat is hidden. Expose counts and full-view navigation without private text.
- Verify structure/types/build; use existing API integration flows for preserved boundaries; no new fake control/session tests.

## Task 2: evidence, stories and documentation

- Extend actual compact component stories for speaker/share/avatar, devices off/error/pending, reconnect, attention, compact sizes and both themes. Extend real call scenarios/journeys for opening/closing/return, failures and controls where browser gesture support allows. Browser-only native behavior documented for manual verification, not faked as proven.
- Document behavior, supported API/browser versions versus actually verified coverage, manual/auto preference and permissions, original-call dependency, share capture privacy and #107 dependency in product/engineering docs. New UI component inventory in root guidance if added.
- Run repository `pnpm check` against real local services; reuse canonical compose to avoid replacing another worktree's LiveKit mount. Run affected call/hosting/moves flows first as baseline and after implementation. Full suite/build at final branch head.
- Manual UI verification with actual native PiP and second participant where possible: one participant/audio/capture owner, mic/camera/hand synchronization, screen changes, close/reopen/return, reconnect, end/leave failure, sharing output, local preferences, automatic browser eligibility. Record actual evidence and limitations.

## Task 3: review, integrate and deploy

- Fresh independent review of final diff for lifecycle, privacy/room filtering, async races, shared controls, portal destinations, stored defaults and regression scope. Fix findings and rerun relevant checks.
- Commit with repository-scoped identity, push dedicated branch, create reviewable PR with exact validation and dependent mention criterion. Never use default GitHub account/credential. Dedicated SSH key supports push; GitHub UI account may be used for PR/merge if connector unavailable.
- Wait for required CI; merge via normal protected-branch PR flow without weakening policy. Follow CI/main deployment workflow to success, confirm deployed commit/web assets/API health and a production smoke. Report what actually merged/deployed/verified and any remaining dependency.

## Progress

- 2026-11-08: design based on issue and main f365c0fc; isolated branch codex/floating-call created.
- Task 1 implemented: call-owned native window, shared controls and inline departure, room-scoped attention, defaulted local auto preference, no second media/capture owner. Hand acknowledgement and failed-departure liveness received real integration regressions with observed red/green results.
- Task 2 implemented: 27 compact states, 10 real-call scenarios, journey 6.22 and product/engineering documentation. Native Chrome 156/macOS 27.2 evidence and unexercised combinations are recorded in `docs/engineering/floating-call.md`. Affected baseline: 89 passed; host-control/departure regressions: 15 passed. Full repository check remains in progress at this checkpoint; final typecheck/build tasks and policy guards passed.
- Task 3 underway: independent review has no remaining source findings; signed commit e6b62e37 pushed and PR #181 opened. Required CI, merge and deployment remain to be verified. The #107-dependent mention criterion stays open.
