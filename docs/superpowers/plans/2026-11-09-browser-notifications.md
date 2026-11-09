# Browser notifications implementation plan

**Goal:** Complete every #88 criterion using the existing preferences, public call authority and in-app unread/action state.

**Owners:** contracts in packages/api/identity and calls; derived call candidates in api-http/calls; permission/delivery/receipts/destinations in web/features/shell; running-call projection/intent composition in call/session and layout; shared reusable visuals in ui; profile integration coverage in api/features/account and call flows in api/features/calls.

- [x] Add real API preference flow showing explicit new-account opt-in, saved categories, global disable without lost choices, isolation, and old sealed-profile defaults.
- [x] Extend stored preferences additively, new-account defaults, stand-in data, Settings and guest/in-call controls.
- [x] Add content-free candidate contract/projection from authorized snapshots; integrate final #86/#87/#107 sources and real multi-client scope/recipient/reconciliation tests.
- [x] Replace independent browser-notification delivery paths with one fenced lifecycle owner, atomic receipts, burst grouping, freshness and cross-tab focused-view suppression.
- [x] Make every existing/new OS preview generic and every click destination exact, validated and unavailable-safe; update the service worker and page routing together.
- [x] Coordinate silent OS notifications with existing sound output and close handled, disabled, signed-out, removed and revoked notifications.
- [x] Update stand-in, scenarios, numbered journeys and engineering/product docs; inspect phone/wide, both themes, keyboard and manual permission/background/click flows without actual personal capture.
- [x] Run isolated DB88 integration flows, full policy/type/build/check; obtain independent source review, fix findings and rerun affected checks (the earlier full run’s two fixture failures and final affected checks are recorded below).
- [ ] Merge current main, preserve stored data/identity hooks, commit/push and provide PR body/evidence to root for PR, merge and deploy.

Use TEST_DATABASE_URL ending in alcove_test_88. No unit, browser or component suites. Manual CUA may use native notifications only with the already-authorized development flow; no personal camera/mic.

Verification checkpoint: targeted public API flows9/9 passed before the full run. The isolated full run held API/server/client source fixed and completed50suites:1267passed/2timing-fixture failures in38m31s; policy/types/build tasks passed. The existing reload fixture receives its exact replacement-identity fix from #87 main. The new breakout fixture now waits for both authenticated peer directions before sending. After current main/#107/#173 integration, rerun the combined affected real API suites and final types/build/guards; do not repeat the entire local suite. Final actual-head CI remains the release gate.

Final combined checkpoint7eebd122 includes independently verified actual main107 ancestry and the reviewed173 preference owner. All9 affected real API suites pass (226/226 flows,311.19 seconds), including both previously failing fixtures; fresh7 package type checks,3 builds and all guards pass. Independent173 lifecycle and107 wire/upgrade reviews are clear. Native manual evidence and its OS-centre/new-window limitations remain explicit. Final manual two-tab overlapping failure/independent success and active90-second hint expiry after writer closure both behaved as designed. PR creation, actual-head CI, merge and deployment belong to root.
