# Call chat threads

Room chat and private conversations use one `ChatView`, its conversation-scoped `ChatDraft`, and the stateless
`ChatMessage`, `ChatThreadLine` and `ChatThreadHead` in the UI kit (`components/call-chat.tsx`). A reply contains one
canonical original (`root`) and the message being answered (`replyTo`). Threads are flat, as Slack's are: the thread's
composer answers its original (or, where the original is unavailable, its latest readable reply), and there is no
"Replying to" strip. Main chat renders originals, with each thread's line (repliers' faces, count, last reply or new),
and replies sent to everyone too (`broadcast`), which say what they answered and open their thread. Other replies render
only inside their thread. A readable reply whose original is unavailable gets a placeholder and an entry in main chat,
without reconstructing its original text.

Thread links, and whether a room reply was also sent to everyone, are inside the encrypted MLS text or the
recipient-only AES-GCM payload; only a reply can be broadcast, and private threads have no broadcast. They are never database
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
`thread: null` through their stored schema default, and older MLS text acquires `broadcast: false`. Existing `call_mls.party = NULL` rows keep their original
history rules; new sender metadata uses the existing nullable column. Older sealed profiles acquire
`sounds.replies = true` and `notifications.replyAlerts = true` through defaults; their other choices survive.
The next profile save writes the current shape. Private thread rows follow private-message deletion and shared
note/export exclusion exactly; ending the call physically deletes them.

Real API suites cover concurrent canonical replies, replies sent to everyone, unavailable originals, failed and ambiguous sends, room
moves, generation changes, read state, malicious references, pair-only encryption, host exclusion and cleanup.
Storybook records room/private threads, failed retry, unavailable originals and journey 6.31 at phone/wide
widths and both themes. It demonstrates the flows without assertions or a browser test runner.
