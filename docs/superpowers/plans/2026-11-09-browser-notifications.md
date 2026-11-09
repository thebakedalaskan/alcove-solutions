# Browser notifications implementation plan

**Goal:** Complete every #88 criterion using the existing preferences, public call authority and in-app unread/action state.

**Owners:** contracts in packages/api/identity and calls; derived call candidates in api-http/calls; permission/delivery/receipts/destinations in web/features/shell; running-call projection/intent composition in call/session and layout; shared reusable visuals in ui; profile integration coverage in api/features/account and call flows in api/features/calls.

- [ ] Add real API preference flow showing explicit new-account opt-in, saved categories, global disable without lost choices, isolation, and old sealed-profile defaults.
- [ ] Extend stored preferences additively, new-account defaults, stand-in data, Settings and guest/in-call controls.
- [ ] Add content-free candidate contract/projection from authorized snapshots; integrate final #86/#87/#107 sources and real multi-client scope/recipient/reconciliation tests.
- [ ] Replace independent browser-notification delivery paths with one fenced lifecycle owner, atomic receipts, burst grouping, freshness and cross-tab focused-view suppression.
- [ ] Make every existing/new OS preview generic and every click destination exact, validated and unavailable-safe; update the service worker and page routing together.
- [ ] Coordinate silent OS notifications with existing sound output and close handled, disabled, signed-out, removed and revoked notifications.
- [ ] Update stand-in, scenarios, numbered journeys and engineering/product docs; inspect phone/wide, both themes, keyboard and manual permission/background/click flows without actual personal capture.
- [ ] Run isolated DB88 integration flows, full policy/type/build/check; obtain independent source review, fix findings and rerun affected checks.
- [ ] Merge current main, preserve stored data/identity hooks, commit/push and provide PR body/evidence to root for PR, merge and deploy.

Use TEST_DATABASE_URL ending in alcove_test_88. No unit, browser or component suites. Manual CUA may use native notifications only with the already-authorized development flow; no personal camera/mic.
