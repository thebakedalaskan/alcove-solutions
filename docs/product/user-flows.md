**The same owner uses the desktop workspace, chat, meeting and payment flows.** Every screen state must correspond to an observed backend result. The app must remain useful and truthful when a request is interrupted.

[MVP guide](../README.md) · [Tasks](../delivery/tasks.md) · [Stack and setup](../references/stack-and-provider-setup.md)

## Start and return

The reference desktop client creates or unlocks its local owner keys and authenticates to the approved confidential backend. A fresh verified session is required before content keys are delegated for private processing. Reopening the same installation unlocks its saved identity and fetches encrypted saved state. Account identity, content decryption and wallet approval are distinct authorities.

A failed verification or inaccessible local key produces an actionable blocked state. The app does not upload plaintext to make onboarding succeed. Only the native trusted boundary handles raw private keys; the UI receives authorized display content and opaque operations.

## Create, upload and edit

1. Create a native page, enter rich text, and save. The client shows local draft, saving and accepted revision states.
2. Upload a supported file. Retain its encrypted original and confirm accepted revision before presenting it as saved.
3. Extract/index only inside approved processing. Show processing, ready, unsupported, partial or failed status; a stored file is not automatically searchable text.
4. Reopen the saved revision and edit a native page. Use expected-parent checks so a stale save does not silently replace accepted content.
5. Replace a binary original as a new version. Source citations retain the exact version they referenced.

A network failure keeps the encrypted pending operation. An exact retry returns its original result. Changed content receives a new revision/operation identity. Deleting an item removes it from new retrieval immediately under the app's accepted state; queued work rechecks whether it may still publish.

## Ask chat with selected context

The owner selects saved sources and sends a question. The app checks credit, resolves allowed source revisions, performs protected retrieval and submits a bounded I01 request. Show queued, working, verification/response pending, completed, failed or unknown status accurately.

A successful response includes file/page or transcript time references. The owner can open the exact cited source. Provider output remains untrusted text: citations and permitted structured responses are validated by application code. Chat cannot initiate an external message, purchase, meeting or broader source grant.

Changing the selected source set starts a clean context so previous hidden turns or caches cannot sneak excluded text into a narrower request. Missing/failed indexes produce an honest coverage warning or a bounded permitted scan; they do not fabricate complete search.

## Buy and use prepaid credit

1. Request the configured credit pack for the authenticated owner.
2. Review the exact source asset, amount, merchant/refund route, fees/expiry and resulting service-credit pack.
3. Approve the generated intent in the owner's wallet. Wallet keys remain in the approved client/wallet; the backend receives only the authorized signed payload.
4. Watch the durable pending purchase while the app reconciles the provider's supported outcome.
5. On validated completion, receive one credit and a private receipt. Duplicate polls, callbacks and restarts must not create another credit.
6. Run paid chat/transcription. Reserve a finite cap before dispatch, settle the priced usage once, and show the available/reserved/used amounts.

A failed or pending purchase cannot fund use. An ambiguous paid operation remains pending/unknown until reconciliation; the app does not ask the owner to unknowingly pay again. A balance display is private account state, not a transferable cash wallet.

## Capture and transcribe a meeting

The owner pastes a permitted meeting link, sees the configured duration/cost cap and explicitly starts the attendee. The participant is visible and waits for host admission. UI state distinguishes waiting from actual capture.

After admission, the recorder confirms rendered media samples. It encrypts durable chunks and reports truthful timing/gaps. The owner can stop, which ends capture and leaves the meeting; upload/transcription can finish separately under the bounded job authority. Host removal or admission failure is visible and does not cause an unapproved rejoin loop.

Protected speech processing produces a timed transcript. The owner can open it as a private workspace source, correct text, and ask chat about it. Corrections create a new transcript revision and invalidate old derived retrieval for current queries. The original meeting provider and other participants already know the source call; our privacy covers our captured copy and downstream app processing.

## Complete demo and failure checks

Demonstrate paid document chat and paid meeting transcription using the same owner account and credit balance. Inspect stored content and error/log paths for canary plaintext. Exercise a duplicate payment outcome, interrupted upload, denied meeting admission, absent/silent media, a stopped recording, invalid ciphertext, and a provider timeout with unknown cost.

The engineering pages define exact bodies, limits, types and recovery rules for these states. The app should explain the actual failure and preserve accepted work, without routing content through a less private fallback.
