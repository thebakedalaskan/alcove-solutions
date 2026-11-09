# Immediate actions and ordered writes

TanStack Query and the existing LiveStores remain authoritative. Reversible writes project private commands held only in
memory for their current session/workspace. Nothing is persisted as a plaintext queue.

| Representative flow | Before | Current behavior and latency removed |
| --- | --- | --- |
| Call panels, menus, navigation, selections, personal layout | Already local. | Remain immediate, with no backend request gating opening/selection. |
| Mic, camera, speaker, effects | LocalMedia owns real device/processed tracks, pending transitions and failures. | Preserve those real transitions and processed preview/publication parity. An icon never substitutes for muting a track. |
| Invitation Yes/Maybe/No | Optimistic answer, but an old refusal restored an entire old meeting. | Select immediately with Saving. Ordered requests and field-scoped settlement preserve later choices and unrelated meeting fields. |
| Chat, replies and private drafts | The chat owner has stable encrypted message IDs, a local outbox and session drafts. | Preserve that owner, audience/thread identity and explicit failed-message retry; no second outbox or draft store. |
| Note preview/Home follow-up completion | Preview waited for the API; Home had its own checkbox rollback. | Project the same done command into note/inbox immediately, with row-local Saving. Order rapid ticks. Home retains completed rows for this visit and rereads their note after an ambiguous failure. |
| Workspace container name | Waited for write, refetch and stream. | Requested name shows in list/breadcrumbs with Saving. Stream resumes ownership after acknowledgement. Refusal retains input with Edit name and deliberate Enter retry (journey 12.1). |
| Workspace item names/moves | An answered overlay could expire and expose an older pending name. | Existing owner publishes projected items through LiveStore, orders writes, protects newer overlays and revokes queued work when closed. |
| Settings, pins, groups | Optimistic/serial, but value equality confused A→B→A and rollback could restore a failed intermediate value. | Immutable commands own fields by identity. Saving/Saved/Couldn’t confirm refer only to the row’s latest request. Later choices remain usable (journey 11.23). |
| Protected outcomes | Need real authorization and success. | Admission/access, agreed consent, completed deletion, shared capture/recording, attestation and completed external sends/exports stay confirmed. Physical workspace deletion keeps its row until the API succeeds. |

`apps/web/src/lib/queryWrites.ts` exports the exact production mutation options consumed by `queries.ts` and real HTTP
integration flows. Temporary confirmed baselines plus ordered patches are rendered through QueryClient. Failure removes
only its command; success touches only its fields. Authoritative reads retain pending projections. Read generations prevent
canceled older fetch work from changing a newer baseline. Unrelated cache fields survive settlement.

Protected note writes never publish their returned whole-note snapshots: an older decision acknowledgement can arrive after
a newer follow-up tick. Their shared confirmation path cancels an obsolete detail read and awaits a fresh `readNote` result,
which preserves any still-pending fields. Decision/consent feedback remains pending through that confirmation; note lists,
series and inbox are invalidated as before. The same path serves proposals, questions, corrections, sharing and rewriting.

Dispatch belongs to QueryClient, so optimistic React rerenders replacing options cannot lose a request. Inputs, including
nested preferences, are captured before any await. Per-resource session tails preserve request order even when the first
request is held before server receipt. These active promises can reject after cache clearing, rather than stranding a paused
mutation. Session Query identity and creation time fence queued dispatch and cache settlement; dispatch also checks the real
server session before using its cookie. Clearing the session releases registries and prevents old work repopulating it.

Sound and notification controls name only their requested leaves. A pending hand-sound change therefore preserves an
authoritatively read question-sound choice, including when its older acknowledgement succeeds. Repeated values retain their
individual command identity. At serialized dispatch, grouped writes read current authoritative preferences, combine them
with the immutable leaf intent, recheck the original cached and actual server session, and send the existing complete-group
PATCH. The extra read prevents a failed earlier switch from being carried into a queued later switch. Pins and groups own
their complete arrays. Concurrent clients continue to use the API's existing whole-group replacement semantics.

Reversible writes use `networkMode: 'always'` and no automatic retry. A missing acknowledgement causes scoped failure and an
authoritative reread; retry needs another user action. Existing HTTP operation receipts and chat ciphertext IDs retain their
idempotency boundaries. No sensitive protected operation is queued indefinitely or shown as completed in advance.

`apps/api/src/integration/optimistic.integration.test.ts` signs in through `h.browser().api`, drives production options with
QueryClient/MutationObserver, and exercises real HTTP/Postgres/object storage. It checks persisted state and projected cache
order under lost acknowledgements, repeats, two refusals/retry, other actors, account switches, pre-dispatch delay, reused
variables, canceled reads, a delayed decision after a newer confirmed follow-up, independent grouped switches, grouped
A→B→A, refused earlier leaves, a replaced cookie session after materialization, real workspace streams and options replacement during optimistic publication. No unit, hook,
component or browser test suite is added. Storybook shows pending/failure phone/wide and light/dark states plus numbered
journeys. Hardware verification remains with its owning media feature; this change claims no new physical-device coverage.

The server test/typecheck Turbo tasks explicitly include the imported web `queryWrites.ts` and workspace `changes.ts`;
integration test caching stays disabled. CI's scope includes those owners, their `queries.ts`/workspace `actions.ts`
composition and router mutation defaults, so changing only their web sources still runs all integration shards. Keep these
inputs/scope paths current when a real-client integration flow starts importing another production web owner.
