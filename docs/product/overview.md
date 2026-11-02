**Personal confidential workspace with integrated chat and private paid usage.** The owner should be able to work with their own material as naturally as a document drive: create a page, upload a file, ask questions and return later to saved work. Meeting transcripts become another private source in the same workspace.

[MVP guide](../README.md) · [Tasks](../delivery/tasks.md) · [Stack and setup](../references/stack-and-provider-setup.md)

## Product goals

- Make creating, editing, organizing and revisiting documents useful in one desktop client.
- Let chat use the owner's selected pages/files/transcripts and provide inspectable citations.
- Turn one authorized meeting into an accurate, timed private transcript that is searchable by chat.
- Complete a real P01 prepaid purchase and show correct metered usage from that balance.
- Keep content, keys and private billing state out of ordinary application hosting, storage and logs.

## Supported experience

Native rich-text pages have a defined editable document format and immutable saved revisions. Supported text-oriented uploaded files retain their originals and derived text with source locators. Replacing an uploaded binary creates a version; the app is not a general binary document editor. The engineering limits define the accepted formats, maximum sizes and parser behavior.

Chat is grounded in selected saved sources and private conversation history. The owner can inspect which file/page/transcript range supports an answer. Chat cannot silently expand its source selection, send content to an unapproved service or grant itself capture/payment authority. A narrow selection determines what the current job may use.

For the meeting route, the owner supplies a meeting link, approves its bounded capture, and admits the visible guest participant in a supported test meeting. The app distinguishes waiting, recording actual samples, processing, partial, stopped and ready states. It saves timed text privately and lets the owner edit transcript text without overwriting the original media/time lineage.

The payment product is one configured prepaid credit pack. The owner approves the exact private payment, sees pending or completed status, receives one credit and uses it for priced chat/transcription. The account view separates available, reserved, used and pending quantities. A provider service account is funded separately from the customer's retail credits.

## Trust and confidentiality

Approved desktop software and approved confidential application, capture, speech and inference endpoints intentionally handle plaintext. We trust the selected providers for their documented primitives and use them correctly. Ordinary edge/database/object/log/support paths must receive ciphertext or safe bounded operational metadata.

Provider-internal proof gaps do not prevent the hackathon implementation. Invalid application cryptography, incorrect owner binding, leaked content/keys, invented payment success or broken retries do. The public explanation describes the accepted endpoints and metadata honestly.

## Definition of done

All five capabilities—workspace, contextual chat, authorized meeting transcript, real private purchase, and application privacy checks—work together on the reference desktop installation and deployed confidential backend. Demonstrate the complete sequence in Start Here and attach the actual evidence in the task tracker.

There is one personal owner per vault and one supported installed client for the demo. Additional client platforms, sharing, independent agent memory and alternate financial products are not part of this build.

## Document map

[User flows](user-flows.md) defines owner decisions and failure behavior. [System architecture](../engineering/system-architecture.md) connects the actual components. [Build plan](../delivery/build-plan.md) turns the requirements into implementation slices.
