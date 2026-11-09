# Replies in call conversations

Issue #87 is the approved scope. Replies belong to the original room or private conversation, and never broaden its audience. A message has at most one thread; replying to a reply retains that thread and identifies the specific reply. Thread content stays out of the main message list. An unavailable original is represented honestly without recovering inaccessible content.

The existing encrypted room payload gains a defaulted nullable thread reference for old stored ciphertext. The reference names an existing original and the specific parent. The HTTP client validates outgoing references against readable messages in the current room and derives reply counts from its decrypted messages. Private replies extend #86's independently encrypted payload and preserve its exact sender/recipient connection, generation and room binding.

The conversation view owns local navigation, scroll position and one draft per audience/thread. It uses the existing LiveStores as its message source. The thread header shows the original, its author, audience and a clear return action. Reply controls, unread markers and jumps are keyboard accessible. Failures keep the draft or a retryable message in its original destination. Replies have no public fallback.

Read receipts mark only visible messages in a focused conversation. Relevant authors and participating readers receive quiet, configurable local reply attention; #88 integrates OS notifications afterward. Mentions within replies are completed in #107. Private conversation content never enters shared notes, recording, exports or notification previews.

Validation uses multiple real API clients, Postgres and the object store: parent/root identity, concurrent replies, retry deduplication, room and private-recipient isolation, late join, removal/reconnect, cleanup and ciphertext leakage. Storybook documents actual room/private thread states and journeys without assertions. Manual review covers keyboard focus, drafts/scroll, phone/wide and both themes.
