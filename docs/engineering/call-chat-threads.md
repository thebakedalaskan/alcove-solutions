# Call chat threads

Room chat and private conversations use one `ChatView`, its conversation-scoped `ChatDraft`, and the stateless
`CallChatMessageView` in the UI kit. A reply contains one canonical original (`root`) and the exact message being
answered (`replyTo`). Replying to a reply retains the original root. Main chat renders originals and counts;
replies render only inside their thread. A readable reply whose original is unavailable gets a placeholder and
an entry in main chat, without reconstructing its original text.

Thread links are inside the encrypted MLS text or the recipient-only AES-GCM payload. They are never database
columns, object names, URLs, logs or notification previews. Sender validation requires a confirmed readable
parent with the same room and canonical root. Private validation additionally requires the same two original
connections and call generation. Authenticated incoming private payloads are checked again before delivery is
acknowledged. A reference never grants membership or restores earlier history.

The MLS send response includes the accepted generation and sequence. Both this acknowledgement and a sender's
own log row reconcile the original pending message to its canonical ID. Sender-only rows can cross a room move
for this acknowledgement, authenticated by the exact connection in `call_mls.party`; reconciliation precedes
room filtering and never decrypts a different room. A lost acknowledgement retains the original encrypted
body for deduplication. Retry keeps that body, scope and generation, and refuses a new generation. Private
retries similarly reuse their exact pair-bound envelope and random message ID.

Drafts, scroll position and selected thread live above transient panel mounts. Rooms, private pairs, generations
and thread roots have separate draft memory. Each draft has an edit revision: a delayed rejected submission
restores only its own unchanged draft, including selected identities. Session LiveStores remain the source of
messages and reads. A focused, visible message's end marker records a read; a selected mention must itself be
visible. Covered or inactive call views do not mark messages read.

Reply sounds and local toasts apply only to original authors or people who have participated in that thread;
private threads address only their other recipient. Initial/reconnected history and old cues are baselined away.
The existing sound scheduler handles reply-category volume, quiet mode, coalescing and deduplication. Local
toasts contain no content, and Open reply rechecks current scope and permission. Sounds → Show reply alerts
controls toasts independently of sound and browser notification permission. Persistent counts remain available.
Browser notifications are coordinated by their separate feature.

## Stored data upgrade

There is no SQL migration or key/header change for threading. Older MLS/private text payloads acquire
`thread: null` through their stored schema default. Existing `call_mls.party = NULL` rows keep their original
history rules; new sender metadata uses the existing nullable column. Older sealed profiles acquire
`sounds.replies = true` and `notifications.replyAlerts = true` through defaults; their other choices survive.
The next profile save writes the current shape. Private thread rows follow private-message deletion and shared
note/export exclusion exactly; ending the call physically deletes them.

Real API suites cover concurrent canonical replies, unavailable originals, failed and ambiguous sends, room
moves, generation changes, read state, malicious references, pair-only encryption, host exclusion and cleanup.
Storybook records room/private threads, failed retry, unavailable originals and journey 6.31 at phone/wide
widths and both themes. It demonstrates the flows without assertions or a browser test runner.
