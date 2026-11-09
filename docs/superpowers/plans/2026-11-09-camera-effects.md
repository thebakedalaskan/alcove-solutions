# Camera effects implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete every camera-effects criterion in #90 without exposing raw camera output when an effect is selected.

**Architecture:** Extend the existing browser preference contract and owned picker, then the existing matte with solid composition and a bounded adaptive frame budget. LocalMedia continues to own the source/processed tracks, forwards performance status, and fails closed. No server or wire behavior changes.

**Tech Stack:** React, TypeScript, zod, MediaPipe, WebGL2, LiveKit processors, existing Storybook synthetic devices.

**Spec:** `docs/superpowers/specs/2026-11-09-camera-effects-design.md`

## Global constraints

- Preserve existing keys, encrypted local pictures, E2EE, strict TypeScript, feature ownership, and integration-only testing.
- Never use a real personal camera/microphone during AFK verification.
- Old blur preferences read with strong strength; no database migration.
- Use stable owned color IDs, not theme-dependent outgoing colors.

## Review focus

- Rapid changes while initialization is pending must not publish raw video, revive a stopped camera, or report stale performance.
- Slow GPU/CPU processing must lower bounded work, remain visibly covered and recover without rapid tier oscillation.
- Full six-image storage, failed replacement, account changes and deletion must retain the original until replacement succeeds.
- Camera-off browsing, unsupported browsers and device/reconnect failures must require deliberate camera/Off choices.
- Prejoin, outgoing and remote media must keep the same processed surface and encryption ownership.

### Task 1: Choices, controls and local replacement

**Files:** `packages/api/src/identity/devices.ts`, its public exports, `packages/ui/src/components/backgrounds.tsx`, `styles/kit.css`, `apps/web/src/features/call/media/backgrounds/{BackgroundOptions,backgrounds}.ts*`, existing blur consumers.

- [x] Run baseline real API/LiveKit calls integration flow with isolated database `alcove_test_90`; record result.
- [x] Add `BackgroundColor` IDs and blur strength default to stored browser preferences; update all consumers together.
- [x] Supply stable Slate/Sand/Rose palette, labelled strength choices, Off, original presets, custom remove/replace and loading/error states in native picker.
- [x] Replace custom images atomically after validation/preparation/sealing, preserving account-generation checks and six-image limit.
- [x] Verify strict typing, structure and type/test policies. Inspect the old preference upgrade and verify the picker manually using synthetic media.

### Task 2: Safe composition and adaptive processing

**Files:** existing `backgrounds/{matte,matteGl,backdrop}.ts`, new `backgrounds/frameBudget.ts`, `media.ts`, `DevicePickers.tsx`.

- [x] Compose stable solid RGB backgrounds locally; use mild/strong blur spread without changing chosen strength during adaptation.
- [x] Bound frame dimensions before upload; drop excess frames; measure processing cost and adapt through three hysteretic tiers.
- [x] Publish quality/support status through LocalMedia; eagerly detect support even with camera off, clearly explain unsupported/pending states, announce reductions and recovery.
- [x] Preserve lifecycle generations, same processed preview/output, fail-closed paths and cleanup; detect GL context loss.
- [x] Run typing/build and existing real API encryption/device/privacy flows. Synthetic manual checks cover cold startup, rapid choice, camera off/on, device switch, failures and bounded processing.

### Task 3: Stories, documentation and review

**Files:** existing BackgroundPicker stories, new call effects journeys/scenarios using actual local media, product user flows and engineering calls documentation.

- [x] Add light/dark/phone, strength/solid/custom/reduced-quality/unsupported stories and numbered interaction journeys without assertions.
- [x] Document device-only persistence, replacement/removal, support, performance feedback and fail-closed behavior.
- [x] Run repository checks and the integration suite using the isolated database; record exact results.
- [x] Obtain independent review, fix material findings and re-run affected verification.
- [ ] Commit/push the issue branch and supply PR body/evidence to the coordinating agent for creation, merge and deployment.

## Execution record

- Browser processing is not tested with unit/browser/component suites: repository policy requires whole public API integration flows. Existing API encryption/device flows run unchanged; browser verification uses the actual synthetic Storybook camera and manual CUA.

- Baseline real API/LiveKit calls suite: 65/65 passed, isolated `alcove_test_90` (114.08 seconds). Final package typing: 7/7 tasks passed; final build: 3/3 tasks passed. Full repository check passed: 44/44 integration suites, 1,235/1,235 tests and 11/11 Turbo tasks, in 30 minutes 46 seconds, using the isolated database.
- Independent source review found and verified two fixed lifecycle gaps: stopped Matte instances could be revived by late wrapper setup; initial support/image preparation could outlive cancellation and block later camera operations. Closed guards, exact resource ownership, cancellable 15-second preparation and immediate pending cancellation now cover these paths. Review also verified atomic replacement, bounded uploads, effect-preserving adaptation and processed preview/output ownership.
- Manual CUA used only Storybook's drawn camera and bundled fixture pictures. Prejoin and in-call blur strengths, stable solids, presets, upload, same-slot replacement, advancing processed frames and same-browser custom-image retention across reloads were verified. Adaptive output reached 960×540 with visible feedback and the selected effect retained.
- Holding the model request and choosing Off canceled preparation promptly. Blocking the model caused camera-off with the explanatory recovery message; choosing Off alone kept the camera off and deliberately turning it on recovered without loading effects. Camera-off background/device browsing kept it off. Phone (390×844), wide, light and dark views were inspected; the phone journey reaches the same controls through More → Audio and video settings. Unsupported guidance was inspected as a component state; actual unsupported hardware and manual two-browser SFU output remain release spot-checks.
- Manual QA exposed and fixed two existing Storybook gaps required to exercise the real pipeline: WASM assets were not served, and stopping the original drawn camera froze its native clones. The stand-in now serves the exact installed WASM and retains its draw timer until the last clone stops. The independent reviewer checked this cleanup too.
