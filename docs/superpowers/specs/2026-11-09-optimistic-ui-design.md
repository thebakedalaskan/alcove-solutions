# Immediate, ordered UI actions

Complete #173 across named representative call, chat, notes, workspace and settings flows. Reversible requested state appears immediately; protected outcomes remain pending until the existing backend confirms them.

- Existing menus, selections, panels and personal layouts remain local. Media controls act on actual tracks and confirm the real result.
- RSVP, a follow-up checkbox, workspace-container rename and preference changes use the existing TanStack Query layer to project pending commands over confirmed data. Pending, saved and failure feedback remains explicit. No separate application-state framework or persisted plaintext queue.
- A command owns only its requested fields. Older responses/failures cannot erase newer choices, restore an intermediate failed optimistic value, or overwrite unrelated changes. Rereads retain pending projections and final settlement reconciles authoritative server state.
- Commands are fenced to their account before queueing, before HTTP dispatch and before cache settlement. Old queued account work must never use a new account’s cookie/session.
- Existing call chat failed-message retry, ciphertext/local identity reconciliation and per-draft revisions remain authoritative. Verify rapid sends, delayed acknowledgements, navigation and recoverable draft behavior after integrating the chat work.
- Admission/access grants, completed deletion, shared capture/recording, attestation and external sends/exports retain real authorization and confirmed outcomes. No optimistic completed security outcome.
- Validation drives the EXACT production side-effect-free mutation-options factories via QueryClient/MutationObserver, while signing in and making real API/client HTTP writes/reads against Postgres/object storage. Assert persisted backend results and projected/rollback/cache order. No mocked server, cache-only isolated test, hook mount, DOM or browser-test suite.
- Keep strict types, encryption/room/owner boundaries, request IDs, privacy-safe logs, accessible feedback and existing light/dark/phone layout. Manual media verification uses synthetic devices while the user is away.
