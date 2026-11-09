# Immediate, ordered UI actions implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete #173 by making representative reversible actions immediate and deterministic under delay, failure and concurrent input.

**Architecture:** Side-effect-free mutation-options factories live with the concrete web query owner and receive the real API and QueryClient explicitly. Existing hooks compose them. Typed pending commands project onto TanStack Query data; existing LiveStores and session drafts retain their ownership. No new contract-package responsibility or application-state framework.

**Tech stack:** TypeScript, TanStack Query, existing AlcoveApi, real HTTP integration harness and Storybook.

**Spec:** docs/superpowers/specs/2026-11-09-optimistic-ui-design.md

## Constraints and review focus

- Account-switch protection covers both cache callbacks and queued requests before cookie-based dispatch.
- Test exact production options through real API/client flows; no isolated cache-only assertions or React/browser harness.
- Older failure after newer success, repeated same value and multiple failures must preserve the latest valid intent.
- Reads and unrelated concurrent changes must coexist with pending fields.
- Protected access/deletion/capture/export outcomes remain confirmed; local media must operate on actual synthetic tracks in manual checks.

### Task 1: Reversible query-write ownership

**Files:** web lib mutation owner and queries.ts composition; colocated/cross-feature real integration suite; API test-only TanStack Query dependency.

- [x] Write full signed-in HTTP regression flows for RSVP, including an older refused response released after newer success and A→B→A.
- [x] Extract exact production mutation options without browser API construction; observe the original stale rollback failure.
- [x] Implement typed command ownership, narrow settlement and account fences; preserve authoritative reads and confirm persisted results.
- [x] Extend the same seam to preference writes, including serialized dispatch, repeated-value ownership, queued old-account rejection and accurate saved/error feedback.

### Task 2: Notes and workspace representative flows

**Files:** concrete query owner, relevant note/workspace UI; real integration suite.

- [x] Write delayed/refused/out-of-order real API flows for follow-up done and workspace-container rename, with persisted backend and cache-order assertions.
- [x] Show requested state immediately with pending/recovery feedback; settle only owned fields and retain input on failure.
- [x] Audit existing workspace item projection and protected operations. Change only reproduced gaps; retain their real permission/deletion boundaries.

### Task 3: Whole-flow verification and record

**Files:** docs/engineering/immediate-actions.md, relevant Storybook scenarios/journeys, product user flows.

- [ ] Integrate the completed private-chat/thread work and preserve retained failure rows, retryChat identities and per-draft revisions.
- [x] Document all named flow classifications and before/after latency, including already-local controls and deliberately confirmed operations.
- [x] Show delay, failure, retry and rapid input in wide/phone and light/dark Storybook, without assertions.
- [x] Run policies, typecheck/build, affected real integrations and full repository checks against isolated alcove_test_173.
- [ ] Obtain independent review and manual representative-flow checks, fix material findings, commit/push and supply PR/release evidence to root.

Full local check: 45 integration files/1,249 tests passed at main12283d78 plus the initial14-case client suite. The final
confirmed-note response finding was reproduced red, then fixed across all whole-note callbacks; the enlarged15-case
real-client suite passed separately, followed by fresh policy/type/build checks. Final combined-head CI verifies integration
with private-chat/thread changes. Earlier overlapping interrupted test data is discarded and is not completion evidence.
