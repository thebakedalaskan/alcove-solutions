# MVP build plan

[MVP guide](../README.md) · [Tasks](tasks.md) · [Stack and setup](../references/stack-and-provider-setup.md)

Build one coherent desktop product: upload and reopen files; create, edit and reopen native pages; ask cited questions about selected documents and transcripts; authorize one visible guest attendee in a qualified meeting; purchase a real prepaid credit pack and spend it on bounded protected chat. The implementation contracts are the seven engineering pages. The build tasks attached to this plan describe only that product. Every task's implementation evidence begins **Not run**.

The build is organized into working slices rather than a separate platform programme. Client, API and transactional storage are built together; an early synthetic end-to-end path makes protocol and UI mistakes visible before provider qualification. Real C01 verification, real payment and real meeting audio remain explicit final evidence requirements. A fixture can prove a failure path but cannot complete a provider-dependent acceptance criterion.

## 1. Establish a reproducible, bounded foundation

Start with the repository layout and operational scripts in [Deployment and Acceptance](../engineering/deployment-and-acceptance.md). Add strict schemas and typed error/result contracts once in `packages/contracts`; reject unknown critical fields and enforce identical integer, identifier, frame, file and request bounds across the native client, edge and API. The schema package owns generated types; individual services must not invent similar-looking versions.

Resolve the researched build candidates into an actual dependency lock, native toolchain inventory, model hashes and three immutable server images. Keep synthetic and demo provider configurations visibly distinct. The first local run should start ordinary ciphertext stores, the API, an opaque edge and the desktop shell with synthetic provider adapters. It must show missing prerequisites honestly and never acquire live credentials automatically.

Create the installation identity and native sealed vault key, restricted typed bridge and encrypted local draft/journal before putting user text into the UI. Implement the page-02 attested session with synthetic negative vectors, then actual C01 evidence. Wrong application/image/key binding or replay must fail before releasing a content key. The owner public identity is pinned during single-owner setup; no additional account-enrollment product flow is needed.

## 2. Make files and native pages useful

Implement D01 immutable revisions and expected-parent compare-and-swap, plus O01 opaque ciphertext objects and bounded resumable upload. A save's success means the canonical revision and referenced objects are durable; a repeated operation returns the same result. A stale parent preserves the local edit and offers the explicit conflict resolution from page 03. Store the original uploaded file and keep replacement versions immutable.

Deliver the library slice with text PDF, TXT and Markdown upload, safe preview, version selection and reopen after app restart. TXT/MD offers **Edit as page**, creating a native page with retained original-file provenance. Then add the native structured-document editor: create a page, edit supported blocks, save the full validated document, reopen it and navigate its revision history. Validate the same structured schema across the UI, native boundary and API. Verify actual selected-file access and local encrypted drafts on the reference desktop.

Protected extraction follows the same revision identity. Run bounded parsers and selected embedding artifacts inside C01; write encrypted extracted chunks and source locators. Build source-scoped lexical and E02 retrieval, preserve exact revision/page/block/time references and open citations to those sources. Unsupported, incomplete or failed extraction is visible. Retrieval must not quietly draw from an unselected item or invent a source when none is available.

## 3. Connect credits to a real paid answer

Build accounting before enabling paid dispatch. Use lossless credit/cost quantities, owner-bound account identity, append-only financial events and transactional uniqueness for purchases and action settlement. Implement reserve, send-start, settle and read-only reconciliation under page 06. File operations and indexing remain usable without a credit purchase; bounded chat and meeting work require admission.

In parallel, implement P01 purchase preparation for the fixed configured route and pack. The desktop displays the exact quote and invokes the owner's wallet for the documented intent signature. Preserve the purchase/quote/deposit/correlation identifiers required by the actual provider, without inventing upstream fields. Submit only the bound signed request, then reconcile authenticated status. Credit the original owner's account once on the accepted successful outcome, including repeated notifications, process restart and two concurrent lookups.

Implement the protected I01 adapter with the selected documented verification and encrypted response handling, then connect it to retrieval, one bounded action, reservation and settlement. Use the stock request preparation API with its response-key closure only in protected memory. A crash losing that key produces `answer_lost`; stored encrypted request/response evidence supports read-only reconciliation and cannot restore the lost answer. A provider timeout after send-start stays uncertain; the app cannot automatically buy a second answer. Operator supplier prefunding and available-capacity records are separate from owner credits. The UI shows purchase status, available/reserved credits and charged usage without exposing merchant secrets or confusing supplier expense with retail debit.

The completed slice produces a cited answer from a selected stored revision, visibly reserves the maximum, settles its supported actual usage and retains a useful explicit error on failure. Synthetic provider receipts prove local state transitions; the real purchase and paid answer are exercised later against the same built candidate.

## 4. Add the single meeting route

Build the separate meeting-worker image with the locked browser, private display/audio sink and native recorder. The owner pastes the meeting URL, confirms authorization and cap, and starts the visible attendee. The initial supported environment is an authorized guest-enabled meeting whose host admits the attendee. CAPTCHA, login demand, denied entry or unsupported source behavior produces a visible failure; it must not trigger a hidden account or service workaround.

Reserve the bounded session/audio amount before join. Capture actual rendered audio into independent encrypted five-second chunks with sample-clock and gap metadata. Protect browser-profile/temp paths inside the guest and grant only recording-scoped keys. Check interruption, admission timeout, reconnect bound and stop/leave behavior. A process heartbeat or joined screen alone cannot establish capture.

Run S02 speech in a constrained subprocess inside the separate C01 meeting worker, preserving chunk coverage and timestamped provenance. Commit the transcript through the canonical recording import path, then reuse ordinary document revision, retrieval and chat behavior. A summary is a separately admitted chat action. The final meeting slice must support reopen and contextual questions over the saved transcript, including explicit gaps or partial results when capture was incomplete.

## 5. Package, deploy and prove the product

Finish coherent navigation, empty/loading/error states and reference-platform signing. Add focused crash/replay/fault tests around durable commits and paid send-start; add ordinary-storage canary checks with distinctive synthetic file, prompt, transcript and meeting URL values. Verify logs, databases, objects, backups and temp/crash paths in the actual configuration. Build an ordinary encrypted backup and isolated restore check with the declared retention; reconcile uncertain payments before reenabling paid dispatch after restore.

Deploy the exact images to actual C01, verify the application and endpoint key, seal scoped service secrets, apply migrations and inspect private O01 access. Operator procurement must leave enough supplier capacity for the bounded demonstration. These operations require the real access and action authorization associated with implementation; writing this plan has performed none of them.

The final evidence order is explicit: install the signed reference client; demonstrate file and page persistence; execute the authorized real prepaid purchase; observe one credit even after repeated reconciliation; execute and settle an actual protected cited chat; join the authorized real meeting and obtain its actual audio-derived transcript; ask a cited question about that transcript; stop and confirm the recorded terminal state. Retain private receipt/audio evidence under encryption and a redacted result manifest tied to source, image, configuration and desktop hashes.

The backlog dependency graph permits independent work on the document UI, payment adapter and meeting image after their shared contracts exist. Integrations depend on those finished slices, and final demo acceptance depends on both real payment and real meeting evidence. No task is marked complete because another task's synthetic test passed. No owner, date or completion status is assigned by this planning document.
