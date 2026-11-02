# MVP build guide

**V2 — hackathon MVP.** Build one personal desktop workspace for documents and files, private contextual chat, meeting transcripts and prepaid usage. This is the complete build scope and acceptance target for this project.

## What we are building

| Capability | Required result |
| --- | --- |
| Pages and files | Create/edit rich-text pages, upload supported files, organize them and reopen saved revisions |
| Contextual chat | Ask questions across selected files, pages and meeting transcripts, with source and time citations |
| Meeting transcription | Admit one visible confidential attendee to an authorized meeting, capture actual audio and save a timed private transcript |
| Private payment | Buy the configured P01 credit pack, receive one account credit, and pay for bounded chat/transcription from that balance |
| Application privacy | Readable content stays on the approved desktop client and approved confidential processing endpoints; ordinary storage, logs and edge receive ciphertext |

## Read in this order

1. [Product overview](product/overview.md) and [User flows](product/user-flows.md).
2. [System architecture](engineering/system-architecture.md) and [Privacy, keys and sessions](engineering/privacy-keys-and-sessions.md).
3. [Files, documents and storage](engineering/files-documents-and-storage.md) and [Chat and inference](engineering/chat-and-inference.md).
4. [Meeting transcription](engineering/google-meet-and-transcripts.md) and [Payments and usage](engineering/payments-and-usage.md).
5. [Deployment and acceptance](engineering/deployment-and-acceptance.md), [Build plan](delivery/build-plan.md), and [MVP tasks](delivery/tasks.md).
6. [Stack and provider setup](references/stack-and-provider-setup.md) for concrete implementations; [Source evidence](references/source-evidence.md) for primary links.

## Privacy boundary

I01 inference, C01 confidential compute and P01 private payment are accepted provider boundaries. We use their supported protected interfaces correctly. Their fleet-wide, hardware and network guarantees are accepted assumptions; our application must not introduce plaintext storage, leaked credentials, unsafe fallback or incorrect authorization.

The owner deliberately unlocks selected content into the approved confidential backend for parsing, indexing and chat. The attendee receives only recording-scoped authority. Accounting receives usage quantities and purchase bindings, not document contents. The original meeting provider and participants retain their normal source-call visibility.

The reference demo uses one native desktop installation and one supported guest-enabled meeting route. The detailed supported file types and fixed limits are in the engineering pages. A useful complete workflow is the acceptance bar; universal client/meeting coverage is not required.

## End-to-end demo

Buy a real private credit pack → create a page → upload a supported document → edit/save/reopen → ask a cited question → authorize and admit the attendee → capture actual audio → save a private timed transcript → ask chat a question combining a document and the transcript → inspect the balance/usage receipt and ciphertext storage.

Inspect ordinary database rows, object storage, logs, error reports and temporary-file behavior using known canary content. Reject wrong-owner access and modified ciphertext. Repeated payment notifications/restarts must not duplicate credit; ambiguous paid requests must not be blindly resubmitted or reported free.

## Work status

These are implementation instructions and acceptance tests to perform. Document preparation does not establish implemented code, deployed confidential services, real meeting capture or completed payment. Task owners and dates remain unassigned until the participants choose them. Each completed task needs its actual source/build/test evidence.
