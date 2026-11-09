# Call Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish #107 mentions across room chat, threads and recipient-only private conversations.

**Architecture:** Reuse the shared composer, encrypted message owners and exact scoped ReplyJump. Private unread mention state is computed by the existing session LiveStore; alerts never create another conversation owner or notification candidate.

**Tech Stack:** TypeScript, zod, React, existing MLS/ECDH encryption, Hono, Postgres and Vitest integration flows.

**Spec:** ../specs/2026-11-09-call-mentions-design.md

## Global Constraints

- Keep all wire callers current; stored additions have defaults. No SQL migration or key/header change.
- Integration tests only through the real API/client, real Postgres and objects; isolated alcove_test_107 database.
- Stable identities and encrypted metadata; no third-party private access, readable content in logs, or public fallback.
- Use existing UI kit, settings and Storybook. Preserve original conversation/thread drafts and keyboard focus.
- User authorized autonomous implementation/review/publish; root owns PR/merge/deploy and decisions.

## Work

- [x] Add a failing private mention flow for same-name guests, whitespace spans, thread replies and read state; implement shared contract schema, private payload/validation and computed unreadMentions; extend denial/retry/reconnect/leakage flows.
- [x] Adapt shared ChatView/ChatComposer to original-pair mentions, preserve draft spans, and reuse exact message/thread navigation and visibility-based read markers.
- [x] Add scoped generic local mention alerts and one sound per confirmed message, with independent local visual/sound preferences and browser-notification coordination.
- [ ] Add states and journey 6.32, check keyboard/phone/themes, run meaningful integration and full checks, request independent review, commit/push and hand root the reviewable PR description.

## Verification checkpoint

- Real API regression suite: 26 chat flows across private messages, room/private threads and mentions passed. The final seven mention flows passed again after integrating root thread fixes (14.56 seconds total; 12.5 seconds measured assertions for the CI timing key).
- Fresh strict package typechecks: 7/7. Production/Storybook builds: 3/3. Structure, test, strict typing and migration policies pass.
- Manual CUA: original-pair keyboard picker, same-name account identity labels, selected draft through room/private detour, failed mention → one delivered retry row, generic private toast without content/focus theft → exact private thread/message, readable departed-peer mention with disabled composer, phone 390×844 and wide 1440×900, light/dark. Temporary viewport override reset.
- The stand-in computed unread state now goes through its concrete direct-message update owner, matching the real LiveStore; manual alert navigation verifies the scenario.
- Root independently reviewed encrypted schema, trimmed spans, pair enforcement, retained counts and retry metadata; no blocking core finding. Final alert/click review and full repository check remain pending.

- Final manual preference pass: local mention alerts and mention sounds independently toggle and save; unread counts remain, and re-enabling never replays the already-observed private mention. Corrected the inherited Settings-axis leak in the compact call Sounds sheet and verified it at wide 1728px and phone 390px. Browser-notification work owns its later shared tabbed wrapper and will replace these scoped sheet rules on integration.

- Delayed room/private sound playback now rechecks the live store’s original generation/place, current membership, read receipt and call phase as well as the global audio gate. A read or departure between scheduling and playback cancels the cue. Fresh typechecks/builds pass after this UI-only correction.
