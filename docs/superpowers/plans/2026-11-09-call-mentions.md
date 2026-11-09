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
