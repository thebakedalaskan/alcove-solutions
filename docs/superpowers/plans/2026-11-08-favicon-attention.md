# Favicon attention and chat mentions

**Goal:** Implement #108, including the chat mention prerequisite from #107 requested in this chat.

**Architecture:** Mentions are spans addressed to MLS identities inside encrypted chat. Read receipts are opaque message IDs in the existing sealed call state, scoped to the viewer. The favicon projects authorized unread document/chat mentions and current host admission requests; action takes priority over information. It never depends on notification permission.

## Tasks

1. Extend the call contract, MLS client and Storybook stand-in with validated mention spans and `readChat`. Existing encrypted payloads default missing mentions to `[]`; existing stored call records default missing read markers to `{}`. Do not change encryption headers, labels or migrations.
2. Add public HTTP/client integration flows for targeted mentions, forbidden recipients, read isolation and reconnects. Extend existing multiple-client workspace tag and host admission coverage. Run affected suites against real Postgres and object storage.
3. Add an accessible @ picker, selected/sent mention rendering and exact-message navigation to Chat. Mark only messages actually visible in a focused visible tab as read. Offer only current MLS members. Keep failed sends and drafts from producing attention.
4. Add shared design-system icon rendering and the root favicon lifecycle. Publish only generic counts from active authorized call sources to sibling tabs; expire abandoned publishers, request fresh snapshots on startup, and clear on sign-out/removal/permission loss. Poll authorized document notices in background with account-keyed query data.
5. Show icon states and mention journeys in Storybook. Run policy/type/test/build checks, inspect rendered icons at small sizes in both themes, review the complete diff, then commit, push and open the PR.

## Review focus

- Forged/out-of-room recipients never produce an alert or expand readership.
- Focusing a tab never clears a pending admission; another host's decision clears it through current state.
- Read receipts survive refresh and are never returned to another viewer.
- Cross-tab snapshots contain only random IDs, bounded counts and state; account transitions cannot reuse old results.
- Icon generation races restore the normal icon after clear, unmount or sign-out, including when OS notifications are denied.

Threads and private conversations have no implementation on this base branch; mention audiences follow the existing main/breakout conversations.
