# Follow-ups people accept

## The experience

People can discuss and edit their call's TODOs without an AI changing the checklist beneath them. The model proposes; a person decides what becomes a task. The same review is available after the call. This design follows the approved in-conversation Follow-ups mockup.

- Follow-ups opens on one stable shared checklist. Manual additions and document TODOs are actual tasks. People can change a task's words, owner and due date through the existing permission rules.
- A quiet count below the checklist offers suggestions from the conversation. Suggestions are not unfinished tasks, inbox commitments or work carried into the next call.
- Review expands in place. It shows a new task with Add / Dismiss, or a proposed change to an existing task with Apply change / Dismiss and the previous and proposed values.
- Opening review fixes its batch. Further suggestions wait behind a count; they do not replace rows, move controls or steal typing focus. A proposal resolved by another person says so. A changed proposal cannot silently be accepted as the words the reviewer saw.
- Adding records a task; “I'll do it” accepts responsibility. Promoting a proposal never claims somebody else's agreement. Manual creation permits an owner and date instead of assuming the person typing owns the task.
- An accepted task keeps its identity and people's words through subsequent model refreshes and the final notes. A dismissed proposal stays dismissed when the same source material is processed again. The model may suggest changes; it cannot apply them.
- After the call, the note has the same stable Follow-ups and optional suggestion review. Leaving the call never forces review. Pending suggestions survive writing failures and notes written again.

## Data and authority

Keep actual tasks and pending suggestions separate on the public wire: LiveNotes.suggestions, CallFollowUps.suggestions, Note.suggestions and each RoomNote.suggestions. Actual task arrays contain accepted tasks only. Internally existing sealed follow-up records retain review decisions, source evidence, proposal revisions and change targets. Review supports accept/dismiss with an exact proposal ID and revision; a change also verifies its base task under the storage lock. Repeated same decisions are safe; opposing or stale decisions conflict. Accepting a change retains its target's task ID and records the resolved proposal separately.

Continue the established transcript/room/view and document access checks. An invited reader can review only suggestions they may change. A restricted guest cannot gain task mutation rights or see another room's/private document's contents. Nothing new goes to logs or plaintext storage.

Old stored actions remain accepted by default. Newly inferred actions are explicitly suggested, including actions inferred from board text. Manual tasks are explicitly accepted. No database reset, renamed record header, or legacy wire fallback.

## Scope and verification

Update the contract, server, HTTP client, both call surfaces, saved notes, Storybook stand-in/scenarios/journeys and user/engineering docs together. Preserve evidence, ownership consent, physical deletion and audit history. Use real API/client integration flows against Postgres and the object store. Cover promotion, dismissal, proposed changes, stale/concurrent review, refresh and end-call handover, writer retries, access boundaries and previous-release stored records. Verify typing, structure, test policy, build and the full integration suite. Inspect light/dark and narrow/wide UI without adding browser or component tests.
