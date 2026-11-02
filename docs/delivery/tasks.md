# MVP tasks

[MVP guide](../README.md) · [Build plan](build-plan.md) · [Engineering architecture](../engineering/system-architecture.md)

35 implementation tasks and 105 acceptance criteria for the desktop MVP. All tasks begin **Backlog / Not run / unassigned**. Assign an owner when work starts and attach actual implementation and observed evidence before marking a task Done. The specifications are plans; no deployed product or completed payment/meeting is implied.

Use the [CSV](tasks.csv) for a tracker import or the [JSON](tasks.json) for structured task data. Specification paths in JSON are repository-relative; links in this page and CSV are relative to this delivery folder.

## Task index

| Task | Work | Lane | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| [MVP-001](#mvp-001) | Create the MVP workspace and isolated local stack | Platform and assurance | P0 | None |
| [MVP-002](#mvp-002) | Lock and build desktop, API and meeting artifacts | Platform and assurance | P0 | [MVP-001](#mvp-001) |
| [MVP-003](#mvp-003) | Generate canonical MVP contracts and protocol vectors | Clients and security | P0 | [MVP-001](#mvp-001) |
| [MVP-004](#mvp-004) | Create native installation keys and the restricted desktop bridge | Clients and security | P0 | [MVP-002](#mvp-002), [MVP-003](#mvp-003) |
| [MVP-005](#mvp-005) | Open and verify the attested owner channel | Clients and security | P0 | [MVP-003](#mvp-003), [MVP-004](#mvp-004) |
| [MVP-006](#mvp-006) | Bootstrap C01 applications and scoped sealed service secrets | Platform and assurance | P0 | [MVP-002](#mvp-002), [MVP-005](#mvp-005) |
| [MVP-007](#mvp-007) | Persist encrypted revisions and transactional document commits | Vault and agent | P0 | [MVP-003](#mvp-003), [MVP-005](#mvp-005) |
| [MVP-008](#mvp-008) | Persist encrypted local drafts and pending operations | Clients and security | P0 | [MVP-004](#mvp-004), [MVP-007](#mvp-007) |
| [MVP-009](#mvp-009) | Deliver upload, file preview and immutable replacement versions | Vault and agent | P0 | [MVP-007](#mvp-007), [MVP-008](#mvp-008) |
| [MVP-010](#mvp-010) | Deliver the persisted rich-text page editor | Vault and agent | P0 | [MVP-007](#mvp-007), [MVP-008](#mvp-008) |
| [MVP-011](#mvp-011) | Extract supported documents in a bounded protected process | Vault and agent | P0 | [MVP-002](#mvp-002), [MVP-009](#mvp-009), [MVP-010](#mvp-010) |
| [MVP-012](#mvp-012) | Retrieve selected sources and open exact citations | Vault and agent | P0 | [MVP-011](#mvp-011) |
| [MVP-013](#mvp-013) | Implement the protected I01 request and response adapter | Vault and agent | P0 | [MVP-002](#mvp-002), [MVP-005](#mvp-005) |
| [MVP-014](#mvp-014) | Implement owner credits, reservation and settlement transactions | Payments and accounting | P0 | [MVP-003](#mvp-003), [MVP-007](#mvp-007) |
| [MVP-015](#mvp-015) | Prepare the real private credit purchase and wallet signature | Payments and accounting | P0 | [MVP-003](#mvp-003), [MVP-005](#mvp-005), [MVP-014](#mvp-014) |
| [MVP-016](#mvp-016) | Submit and reconcile private purchases with one credit | Payments and accounting | P0 | [MVP-015](#mvp-015) |
| [MVP-017](#mvp-017) | Account for operator supplier capacity and uncertain expense | Payments and accounting | P0 | [MVP-006](#mvp-006), [MVP-014](#mvp-014) |
| [MVP-018](#mvp-018) | Deliver one bounded paid contextual chat end to end | Vault and agent | P0 | [MVP-012](#mvp-012), [MVP-013](#mvp-013), [MVP-014](#mvp-014), [MVP-017](#mvp-017) |
| [MVP-019](#mvp-019) | Build and isolate the single-run meeting attendee image | Audio and meetings | P0 | [MVP-002](#mvp-002), [MVP-003](#mvp-003), [MVP-006](#mvp-006) |
| [MVP-020](#mvp-020) | Implement authorized guest admission and stop controls | Audio and meetings | P0 | [MVP-005](#mvp-005), [MVP-014](#mvp-014), [MVP-019](#mvp-019) |
| [MVP-021](#mvp-021) | Capture encrypted meeting audio with truthful timing | Audio and meetings | P0 | [MVP-020](#mvp-020) |
| [MVP-022](#mvp-022) | Transcribe protected audio with checkpointed provenance | Audio and meetings | P0 | [MVP-002](#mvp-002), [MVP-021](#mvp-021) |
| [MVP-023](#mvp-023) | Commit, reopen and query the saved meeting transcript | Vault and agent | P0 | [MVP-007](#mvp-007), [MVP-012](#mvp-012), [MVP-022](#mvp-022) |
| [MVP-024](#mvp-024) | Settle the capped meeting session and recover partial runs | Audio and meetings | P0 | [MVP-017](#mvp-017), [MVP-020](#mvp-020), [MVP-021](#mvp-021), [MVP-022](#mvp-022), [MVP-023](#mvp-023) |
| [MVP-025](#mvp-025) | Deliver credit purchase, balance and usage screens | Payments and accounting | P0 | [MVP-016](#mvp-016), [MVP-018](#mvp-018), [MVP-024](#mvp-024) |
| [MVP-026](#mvp-026) | Unify the desktop library, editor, chat and meeting experience | Clients and security | P0 | [MVP-009](#mvp-009), [MVP-010](#mvp-010), [MVP-018](#mvp-018), [MVP-023](#mvp-023), [MVP-024](#mvp-024), [MVP-025](#mvp-025) |
| [MVP-027](#mvp-027) | Exercise deterministic crash, replay and failure boundaries | Platform and assurance | P0 | [MVP-007](#mvp-007), [MVP-016](#mvp-016), [MVP-018](#mvp-018), [MVP-024](#mvp-024) |
| [MVP-028](#mvp-028) | Configure opaque ingress, least privilege and content-free diagnostics | Platform and assurance | P0 | [MVP-005](#mvp-005), [MVP-007](#mvp-007), [MVP-019](#mvp-019) |
| [MVP-029](#mvp-029) | Deploy the immutable demo candidate to actual C01 | Platform and assurance | P0 | [MVP-006](#mvp-006), [MVP-017](#mvp-017), [MVP-026](#mvp-026), [MVP-027](#mvp-027), [MVP-028](#mvp-028) |
| [MVP-030](#mvp-030) | Package and install the signed reference desktop build | Clients and security | P0 | [MVP-002](#mvp-002), [MVP-026](#mvp-026) |
| [MVP-031](#mvp-031) | Verify encrypted backup, retention and ordinary restore | Platform and assurance | P1 | [MVP-007](#mvp-007), [MVP-016](#mvp-016), [MVP-018](#mvp-018), [MVP-024](#mvp-024), [MVP-028](#mvp-028) |
| [MVP-032](#mvp-032) | Inspect the actual deployment for plaintext canary leaks | Platform and assurance | P0 | [MVP-029](#mvp-029), [MVP-030](#mvp-030), [MVP-031](#mvp-031) |
| [MVP-033](#mvp-033) | Prove a real private purchase and subsequent paid chat | Payments and accounting | P0 | [MVP-016](#mvp-016), [MVP-018](#mvp-018), [MVP-025](#mvp-025), [MVP-029](#mvp-029), [MVP-030](#mvp-030), [MVP-032](#mvp-032) |
| [MVP-034](#mvp-034) | Prove actual authorized meeting audio through saved transcript | Audio and meetings | P0 | [MVP-018](#mvp-018), [MVP-023](#mvp-023), [MVP-024](#mvp-024), [MVP-029](#mvp-029), [MVP-030](#mvp-030), [MVP-032](#mvp-032), [MVP-033](#mvp-033) |
| [MVP-035](#mvp-035) | Complete the installed MVP demo and evidence readback | Platform and assurance | P0 | [MVP-026](#mvp-026), [MVP-030](#mvp-030), [MVP-031](#mvp-031), [MVP-032](#mvp-032), [MVP-033](#mvp-033), [MVP-034](#mvp-034) |

## MVP-001

**Create the MVP workspace and isolated local stack**

Lane: Platform and assurance · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: None.

- [ ] Required repository boundaries and doctor/local lifecycle scripts exist and reject missing prerequisites honestly.
- [ ] Local edge, API and ciphertext stores run under isolated names on loopback with synthetic identities.
- [ ] Local and CI configurations cannot acquire production secrets, call paid suppliers or join real meetings.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-002

**Lock and build desktop, API and meeting artifacts**

Lane: Platform and assurance · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: [MVP-001](#mvp-001).

- [ ] Actual runtime, package, native, browser and model versions are resolved into checked-in locks and source inventories.
- [ ] Three server images and the reference desktop payload have computed artifact digests tied to the source revision.
- [ ] Builds reject missing or mutable inputs and images perform no package, browser or model download at runtime.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-003

**Generate canonical MVP contracts and protocol vectors**

Lane: Clients and security · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/privacy-keys-and-sessions.md)

Dependencies: [MVP-001](#mvp-001).

- [ ] Generated client/server schemas implement the same identifiers, lossless integers, typed failures and finite bounds.
- [ ] Duplicate members, unknown critical fields, malformed sizes and invalid operation bindings reject before execution.
- [ ] Signature, encrypted record and channel vectors cover tampering, wrong binding and replay across the native and API implementations.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-004

**Create native installation keys and the restricted desktop bridge**

Lane: Clients and security · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/privacy-keys-and-sessions.md)

Dependencies: [MVP-002](#mvp-002), [MVP-003](#mvp-003).

- [ ] Reference-platform installation creates its identity and vault key, seals them natively and exports only the public identity for setup.
- [ ] Typed bridge operations enforce origin, window, owner, argument and size checks without arbitrary path, execution or signing access.
- [ ] Lock and same-installation reopen work on the actual reference machine without UI key export or plaintext key files.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-005

**Open and verify the attested owner channel**

Lane: Clients and security · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/privacy-keys-and-sessions.md)

Dependencies: [MVP-003](#mvp-003), [MVP-004](#mvp-004).

- [ ] Client verifies the expected C01 application, accepted code/configuration and endpoint key binding before releasing the vault key.
- [ ] Authenticated operations travel inside the bounded encrypted channel with owner/session/operation binding and expiry.
- [ ] Wrong application/image/key, replay, altered ciphertext and expired sessions fail before content or secret delivery.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-006

**Bootstrap C01 applications and scoped sealed service secrets**

Lane: Platform and assurance · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: [MVP-002](#mvp-002), [MVP-005](#mvp-005).

- [ ] API and meeting applications have separate accepted identities, explicit OS/image policy and verified attested recipients.
- [ ] Trusted bootstrap transfers complete scoped credential sets without plaintext shell arguments, files, logs or infrastructure state.
- [ ] Service credentials survive approved restart under application seals while no persistent owner vault root enters server secret storage.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-007

**Persist encrypted revisions and transactional document commits**

Lane: Vault and agent · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/files-documents-and-storage.md)

Dependencies: [MVP-003](#mvp-003), [MVP-005](#mvp-005).

- [ ] D01 schema stores encrypted private payloads and only documented opaque transactional metadata with restricted roles.
- [ ] Immutable revision insert, expected-parent CAS and operation deduplication yield one durable result under retry and crash.
- [ ] Stale parent preserves the client draft and missing referenced ciphertext is reported unavailable rather than acknowledged as a saved revision.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-008

**Persist encrypted local drafts and pending operations**

Lane: Clients and security · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/files-documents-and-storage.md)

Dependencies: [MVP-004](#mvp-004), [MVP-007](#mvp-007).

- [ ] Native drafts and pending operation bytes are encrypted before local database, journal or temporary-file writes.
- [ ] Restart retries the original immutable operation identity and retains an unresolved edit without silently overwriting it.
- [ ] Locked or missing native seal produces an explicit locked/unavailable state without a plaintext fallback.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-009

**Deliver upload, file preview and immutable replacement versions**

Lane: Vault and agent · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/files-documents-and-storage.md)

Dependencies: [MVP-007](#mvp-007), [MVP-008](#mvp-008).

- [ ] Owner uploads supported text PDF, TXT and Markdown within canonical quotas, reopens the retained original and uses Edit as page for TXT/MD with source provenance.
- [ ] Ciphertext chunk manifests resume safely after interruption and reject changed, reordered or oversized bytes.
- [ ] Safe preview and explicit replacement create immutable versions; filenames or plaintext preview URLs never reach ordinary storage or edge logs.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-010

**Deliver the persisted rich-text page editor**

Lane: Vault and agent · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/files-documents-and-storage.md)

Dependencies: [MVP-007](#mvp-007), [MVP-008](#mvp-008).

- [ ] Owner creates and edits a validated structured page using the supported blocks and saves a full immutable revision.
- [ ] Closing and reopening the application restores the page and encrypted unsaved draft correctly.
- [ ] Stale-parent save returns the documented conflict while preserving both accepted revision and local work.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-011

**Extract supported documents in a bounded protected process**

Lane: Vault and agent · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/files-documents-and-storage.md)

Dependencies: [MVP-002](#mvp-002), [MVP-009](#mvp-009), [MVP-010](#mvp-010).

- [ ] Selected PDF and text parsers run inside C01 without network, general secrets or unbounded CPU/memory/temp access.
- [ ] Extraction stores encrypted chunks tied to exact source revision and page/block locators with canonical size/count limits.
- [ ] Malformed, scanned-without-text, oversized and failed inputs produce explicit coverage/error states without an ordinary-host fallback.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-012

**Retrieve selected sources and open exact citations**

Lane: Vault and agent · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/chat-and-inference.md)

Dependencies: [MVP-011](#mvp-011).

- [ ] Pinned E02 artifacts and lexical retrieval run in the protected runtime and persist encrypted source-scoped index payloads.
- [ ] Only selected permitted revisions enter bounded context and partial/missing extraction is reflected in retrieval results.
- [ ] Citations open the exact retained revision and locator; source deletion invalidates retrieval before dispatch/publication while newer or unavailable sources remain explicit.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-013

**Implement the protected I01 request and response adapter**

Lane: Vault and agent · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/chat-and-inference.md)

Dependencies: [MVP-002](#mvp-002), [MVP-005](#mvp-005).

- [ ] Selected I01 route performs its supported model, attestation/channel/key and response checks without plaintext fallback.
- [ ] Stock request preparation keeps its response-key closure only in protected memory; exact buffered response and verification follow the canonical adapter contract.
- [ ] Malformed proof/output, timeout or crash losing the key cannot trigger a second paid request; answer_lost retains only encrypted evidence for read-only reconciliation.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-014

**Implement owner credits, reservation and settlement transactions**

Lane: Payments and accounting · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/payments-and-usage.md)

Dependencies: [MVP-003](#mvp-003), [MVP-007](#mvp-007).

- [ ] Lossless owner-bound balances, immutable events and unique purchase/action keys preserve the accounting equations.
- [ ] admitAction reserves the maximum atomically; settleAction releases or consumes it once; concurrent requests cannot overspend.
- [ ] Unknown external outcomes retain their documented exposure and reconcileAction cannot create a second charge or silently record zero cost.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-015

**Prepare the real private credit purchase and wallet signature**

Lane: Payments and accounting · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/payments-and-usage.md)

Dependencies: [MVP-003](#mvp-003), [MVP-005](#mvp-005), [MVP-014](#mvp-014).

- [ ] P01 prepares the fixed pack on one configured supported route and durably binds the quote, purchase and original owner.
- [ ] Desktop displays the exact payment details and obtains the documented owner-wallet intent signature without custody of the wallet key.
- [ ] Wrong route, asset, recipient, intent, expiry or changed quote rejects before submission and sensitive provider references remain encrypted.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-016

**Submit and reconcile private purchases with one credit**

Lane: Payments and accounting · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/payments-and-usage.md)

Dependencies: [MVP-015](#mvp-015).

- [ ] Submission persists its identity and send-start state before the external request; ambiguous results use read-only status reconciliation.
- [ ] Authenticated accepted SUCCESS is checked against the original purchase and required actual provider outcome fields.
- [ ] Duplicate, concurrent and restart status observations credit once under unique settlement/purchase constraints; failed or unknown purchases do not credit.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-017

**Account for operator supplier capacity and uncertain expense**

Lane: Payments and accounting · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/payments-and-usage.md)

Dependencies: [MVP-006](#mvp-006), [MVP-014](#mvp-014).

- [ ] Operator can securely record actual manual prefunding and supported balance/report evidence for the dedicated supplier account.
- [ ] Paid admission checks confirmed usable capacity minus committed or unknown exposure and blocks on low or stale capacity.
- [ ] Retail service debit, owner credits and provider expense remain distinct; missing provider cost stays unknown without inventing or changing an owner balance.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-018

**Deliver one bounded paid contextual chat end to end**

Lane: Vault and agent · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/chat-and-inference.md)

Dependencies: [MVP-012](#mvp-012), [MVP-013](#mvp-013), [MVP-014](#mvp-014), [MVP-017](#mvp-017).

- [ ] Selected stored revisions produce a protected cited answer through one admitted bounded I01 request.
- [ ] Encrypted status/history exposes reservation, final debit and useful partial/failure states without leaking prompts or provider credentials.
- [ ] Interrupted or uncertain send preserves its action identity and cannot silently resubmit, double debit or use unselected sources.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-019

**Build and isolate the single-run meeting attendee image**

Lane: Audio and meetings · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/google-meet-and-transcripts.md)

Dependencies: [MVP-002](#mvp-002), [MVP-003](#mvp-003), [MVP-006](#mvp-006).

- [ ] Separate C01 worker boots the locked browser, private display/audio daemon and recorder with the browser sandbox enabled.
- [ ] Worker receives only run-scoped recording/control authority and no owner vault root, historical content or merchant/inference credentials.
- [ ] Browser profile, display and audio temp data remain inside protected bounded scratch with no host mounts, public debugging or plaintext log output.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-020

**Implement authorized guest admission and stop controls**

Lane: Audio and meetings · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/google-meet-and-transcripts.md)

Dependencies: [MVP-005](#mvp-005), [MVP-014](#mvp-014), [MVP-019](#mvp-019).

- [ ] Owner authorizes the pasted meeting URL and session cap, with reservation accepted before the visible guest attempts entry.
- [ ] Guest-enabled host admission, timeout, denied entry and unsupported login/CAPTCHA follow the canonical visible states.
- [ ] Stop and the bounded reconnect path preserve one run identity and distinguish requested stop, confirmed leave and uncertain external state.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-021

**Capture encrypted meeting audio with truthful timing**

Lane: Audio and meetings · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/google-meet-and-transcripts.md)

Dependencies: [MVP-020](#mvp-020).

- [ ] Actual private sink samples produce independent five-second encrypted FLAC chunks with verified sample format, counts and timing.
- [ ] Chunk ordering, partial tail, silence and capture gaps survive interruption and authenticated upload without fabricated coverage.
- [ ] Spool, duration and recording caps stop new capture safely while retaining acknowledged encrypted chunks and explicit partial state.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-022

**Transcribe protected audio with checkpointed provenance**

Lane: Audio and meetings · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/google-meet-and-transcripts.md)

Dependencies: [MVP-002](#mvp-002), [MVP-021](#mvp-021).

- [ ] S02 loads only pinned model artifacts and processes verified recording chunks in constrained C01 subprocesses.
- [ ] Timestamped transcript segments preserve original sample-clock coverage and explicit gaps with bounded checkpoints and deadline.
- [ ] Malformed audio, resource exhaustion and worker restart preserve completed encrypted output and never route audio to an ordinary speech endpoint.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-023

**Commit, reopen and query the saved meeting transcript**

Lane: Vault and agent · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/google-meet-and-transcripts.md)

Dependencies: [MVP-007](#mvp-007), [MVP-012](#mvp-012), [MVP-022](#mvp-022).

- [ ] Canonical recording import commits the recording-key-wrapped artifact metadata using expected revision without a competing storage type.
- [ ] Saved transcript reopens with correct temporal citations, supports text-only revision edits, and cascades audio/key cleanup on deletion with quota released after verified removal.
- [ ] Contextual questions use selected transcript coverage and report missing/gapped audio honestly; summaries require their own admitted chat action.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-024

**Settle the capped meeting session and recover partial runs**

Lane: Audio and meetings · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/google-meet-and-transcripts.md)

Dependencies: [MVP-017](#mvp-017), [MVP-020](#mvp-020), [MVP-021](#mvp-021), [MVP-022](#mvp-022), [MVP-023](#mvp-023).

- [ ] Session reservation precedes join and bounds admitted attendance plus eligible captured-audio usage under the canonical price profile.
- [ ] Stop, denied admission, cap exhaustion and partial transcription settle or reconcile the original action once with documented units.
- [ ] Worker crash or uncertain leave never becomes invented captured audio, a blind replacement run or a zero-cost assertion.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-025

**Deliver credit purchase, balance and usage screens**

Lane: Payments and accounting · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/payments-and-usage.md)

Dependencies: [MVP-016](#mvp-016), [MVP-018](#mvp-018), [MVP-024](#mvp-024).

- [ ] Owner can prepare/sign a pack purchase and see pending, success, failure or uncertain status from the encrypted API.
- [ ] Account view distinguishes available and reserved credits with immutable purchase/debit history and meaningful action states.
- [ ] Repeated refresh/reopen reconciles the original purchase without prompting duplicate payment or exposing private merchant/provider metadata.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-026

**Unify the desktop library, editor, chat and meeting experience**

Lane: Clients and security · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/system-architecture.md)

Dependencies: [MVP-009](#mvp-009), [MVP-010](#mvp-010), [MVP-018](#mvp-018), [MVP-023](#mvp-023), [MVP-024](#mvp-024), [MVP-025](#mvp-025).

- [ ] Installed client supports navigation across the same owner's stored files, native pages, transcripts, contextual chat and credit screens.
- [ ] Empty/loading/locked/conflict/partial/uncertain states preserve user work and link to the relevant source or action.
- [ ] One continuous local synthetic journey completes upload, edit, reopen, cited answer, meeting transcript and payment-to-debit UI paths.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-027

**Exercise deterministic crash, replay and failure boundaries**

Lane: Platform and assurance · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: [MVP-007](#mvp-007), [MVP-016](#mvp-016), [MVP-018](#mvp-018), [MVP-024](#mvp-024).

- [ ] Faults at durable commit, send-start and response milestones preserve original operation/purchase/action identities.
- [ ] Tampered/replayed channels, interrupted uploads, malformed files, duplicate payment status and worker failures produce documented safe states.
- [ ] Evidence distinguishes pass, fail, blocked and skipped with exact fixtures/source/configuration, and fixtures cannot enable live external actions.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-028

**Configure opaque ingress, least privilege and content-free diagnostics**

Lane: Platform and assurance · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: [MVP-005](#mvp-005), [MVP-007](#mvp-007), [MVP-019](#mvp-019).

- [ ] Public paths are limited to canonical runtime/session/channel/health surfaces and bounded ciphertext transport, with private methods inside encryption.
- [ ] D01/O01 roles, bucket privacy, validated TLS, egress allowlists and actual proxy limits match the canonical contracts.
- [ ] Logs, metrics, health checks and diagnostics omit content, meeting URLs, credentials, private payment data and plaintext body snippets.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-029

**Deploy the immutable demo candidate to actual C01**

Lane: Platform and assurance · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: [MVP-006](#mvp-006), [MVP-017](#mvp-017), [MVP-026](#mvp-026), [MVP-027](#mvp-027), [MVP-028](#mvp-028).

- [ ] Actual supported node/OS/application selection and observed API/worker images match the rendered immutable candidate.
- [ ] Wrong application/image/key/debug configuration fails the live negative checks before synthetic content-key or service-secret delivery.
- [ ] Migrations, private object behavior, resource caps, scoped secrets and content-free health pass on the demo environment with recorded evidence.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-030

**Package and install the signed reference desktop build**

Lane: Clients and security · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: [MVP-002](#mvp-002), [MVP-026](#mvp-026).

- [ ] Bundled reference-platform artifact carries the intended signature and matches its recorded payload/build digest.
- [ ] Actual reference machine installs, launches, creates native keys and reopens saved encrypted work using the demo configuration.
- [ ] Selected-file/native-store permissions and restricted bridge/CSP behavior pass without remote application code or unnecessary capture permissions.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-031

**Verify encrypted backup, retention and ordinary restore**

Lane: Platform and assurance · Priority: P1 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: [MVP-007](#mvp-007), [MVP-016](#mvp-016), [MVP-018](#mvp-018), [MVP-024](#mvp-024), [MVP-028](#mvp-028).

- [ ] Backup inventory contains ciphertext application payloads and sealed service envelopes with the declared seven-day expiry.
- [ ] Isolated restore verifies schema, referenced objects and secret-envelope availability without persisting an owner vault root.
- [ ] Uncertain purchase and paid-action states reconcile before paid dispatch resumes; missing artifacts remain unavailable rather than silently reset.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-032

**Inspect the actual deployment for plaintext canary leaks**

Lane: Platform and assurance · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/deployment-and-acceptance.md)

Dependencies: [MVP-029](#mvp-029), [MVP-030](#mvp-030), [MVP-031](#mvp-031).

- [ ] Unique synthetic document, prompt, transcript, meeting URL and secret markers are absent from ordinary logs, D01/O01 exports and backups.
- [ ] Inspection covers actual edge/host temp paths, browser profiles, parser/speech scratch, crash output and diagnostic collection.
- [ ] The evidence records inspected surfaces and encrypted exceptions; any plaintext leak blocks that candidate's demo acceptance.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-033

**Prove a real private purchase and subsequent paid chat**

Lane: Payments and accounting · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/payments-and-usage.md)

Dependencies: [MVP-016](#mvp-016), [MVP-018](#mvp-018), [MVP-025](#mvp-025), [MVP-029](#mvp-029), [MVP-030](#mvp-030), [MVP-032](#mvp-032).

- [ ] Authorized owner executes the real fixed-pack P01 purchase and authenticated actual SUCCESS is bound to the original purchase.
- [ ] Repeated reconciliation and restart produce exactly one credit with the transaction and unique settlement evidence retained privately.
- [ ] One actual protected cited chat reserves then settles its service debit from that credited account, with supplier expense separately recorded or honestly unknown.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-034

**Prove actual authorized meeting audio through saved transcript**

Lane: Audio and meetings · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](../engineering/google-meet-and-transcripts.md)

Dependencies: [MVP-018](#mvp-018), [MVP-023](#mvp-023), [MVP-024](#mvp-024), [MVP-029](#mvp-029), [MVP-030](#mvp-030), [MVP-032](#mvp-032), [MVP-033](#mvp-033).

- [ ] Authorized host admits the visible guest in the recorded qualified meeting configuration and real spoken test phrases are captured.
- [ ] Saved audio-derived transcript has truthful timestamps/gaps and a contextual answer cites an actual transcript interval.
- [ ] Owner stop produces recorded terminal attendance/capture status and bounded settlement with private evidence tied to the actual candidate.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.

## MVP-035

**Complete the installed MVP demo and evidence readback**

Lane: Platform and assurance · Priority: P0 · Status: Backlog · Owner: Unassigned · Evidence: Not run

Specification: [Implementation contract](build-plan.md)

Dependencies: [MVP-026](#mvp-026), [MVP-030](#mvp-030), [MVP-031](#mvp-031), [MVP-032](#mvp-032), [MVP-033](#mvp-033), [MVP-034](#mvp-034).

- [ ] Same installed candidate completes upload/store/view/version, native page create/edit/save/reopen and selected-source contextual chat.
- [ ] Evidence includes the real purchase credited once, a subsequent paid chat debit and an actual authorized meeting transcript/question journey.
- [ ] Redacted report binds desktop/images/source/configuration to every result and leaves missing evidence as Not run, blocked or failed rather than declaring success.

Evidence to attach: source/build version, named checks and observed results. Keep synthetic, real-provider and confidential-deployment evidence distinct.
