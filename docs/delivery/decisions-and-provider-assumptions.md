**Implementation decisions for this MVP.** This page records the chosen build, accepted provider assumptions and practical checks required to demonstrate it. It is not a list of new products or research prerequisites.

[MVP guide](../README.md) · [Roadmap](roadmap.md) · [Stack and setup](../references/stack-and-provider-setup.md)

> **Note (November 2026):** written for the earlier desktop design (documents, chat, a meeting bot). The product is now Alcove, private calls with built-in notes; see [docs/README.md](../README.md). Provider details here (NEAR AI, Phala, 1Click, R2) remain the reference.


## Frozen choices

| Area | Decision |
| --- | --- |
| Product | One personal desktop workspace with native editable pages, supported uploaded files, contextual chat, meeting transcripts and prepaid payment |
| Reference client | One bundled native desktop build with protected keys and a restricted UI bridge; qualify the stated reference environment |
| Backend | C01 approved confidential application runtime with constrained extraction/retrieval/speech processes and a separate capture worker |
| Content keys | Owner root protected locally; active owner delegates it only to approved confidential processing; meeting worker gets recording-scoped keys only |
| Persistence | D01 encrypted records with transactional operation/job/billing state, O01 immutable ciphertext objects, private local state |
| Documents | Native rich-text revisions with expected-parent save; supported text-oriented uploads; binary replacement creates a version |
| Chat | I01 supported protected inference with bounded retrieval, current owner/source checks and useful citations |
| Meetings | Owner-pasted link, explicit approval, visible guest participant and host admission on one qualified route |
| Speech | S02 measured local speech engine inside C01; recordings/transcripts stay in the protected application pipeline |
| Payment | P01 private route for one fixed credit pack, exact wallet approval, trusted supported completion, credit once and capped usage |
| Supplier capacity | Service-owned funded inference account, separate from retail service credit; supported manual funding is acceptable |
| State correctness | Durable transactions, idempotent operations, conservative unknown states and bounded jobs |

## Accepted provider assumptions

C01 provides the selected confidential-compute/key service under its hardware/platform model. I01 provides the selected protected inference interface and the evidence actually available for that route. P01 provides the configured private payment execution and authenticated outcome API. We accept those providers as hackathon dependencies and record their exact setup in References.

The application still validates the supported channel, attestation/key binding, signatures, ciphertext, owner scope, original purchase and provider outcome correctly. A missing additional provider-wide proof does not disable the integration. Invalid required cryptography or a plaintext fallback does.

Ordinary database/object durability and transaction semantics are assumed for the deployed MVP. Correct restarts and retries are required. This project does not claim independent resistance to a malicious rollback of every infrastructure authority, perfect key erasure or hidden activity from every provider.

## Implementation checks to close

| Check | Required practical evidence |
| --- | --- |
| Client/runtime channel | Actual reference client verifies the approved runtime and rejects substituted/invalid channel evidence before releasing content keys |
| File/retrieval path | Save/reopen supported native/uploaded content; no ordinary plaintext copies; allowed sources produce correct locators |
| I01 route | Actual supported protected model call, correct request/response handling, truthful verification state and no fallback |
| P01 route | Real configured private purchase tied to the original owner/invoice and credited once; preserve pending/failed/ambiguous outcomes |
| Cost bounds | Concurrent paid work respects prepaid holds and caps; unknown dispatch/cost does not become a free retry or zero cost |
| Meet route | Visible participant admitted to the selected permitted call; actual audio, correct stop/leave and timed private transcript |
| Deployment | Actual accepted images/secrets/config; ciphertext database/objects; no content in logs, traces, temporary files or crash outputs |

A real integration test may need provider account/partner access, source permissions and a specifically authorized spend budget. These are execution prerequisites. Writing this plan does not perform those actions or authorize arbitrary financial activity.

## Task and decision hygiene

Assign an owner when work starts. Attach exact implementation/build and observed test evidence before moving a task to Done. Keep platform/provider API behavior, local tests, confidential deployment and real payment evidence distinct. Update the linked engineering contract whenever an implementation decision changes; do not leave competing schemas in task comments.
