# Call mentions

Issue #107 completes the existing room mention composer for room replies and recipient-only private conversations. Selected spans carry stable connection identities inside the existing encrypted text; names remain display text. Private mention choices are exactly the two original connections, and the receiver validates that audience again after authenticated decryption. Leading whitespace is removed together with its span offset, matching room sends.

The existing ChatView/ChatComposer and ReplyJump own rendering, drafts, thread navigation and exact-message focus. Mentioning someone never changes membership. Private history remains bound to the original active connection; its floating window shares the same LiveStore, reconnect reauthorizes that connection, and replacement tabs inherit neither keys nor history. Room reads retain existing account-scoped cross-tab receipts.

DirectMessagesState computes unreadMentions from retained confirmed private messages, the original recipient identity and unread state while that connection is reauthorized. Departed peers and old rooms keep readable counts and navigation; current room/generation/peer checks apply separately to fresh events. Read, removal and authorization loss reconcile the counts immediately. Local generic alerts and sounds use their own preferences, baseline initial/reconnected history and deduplicate by original message ID. The separate browser-notification feature retains one private-message candidate and its scoped destination, with no private previews or second mention notification.

Stored encrypted private text gains mentions.default([]). Existing profile records gain local mentionAlerts and sound mentions through defaults. There is no SQL migration, new key purpose, record-header change or readable routing metadata.

Verification uses real API/client flows, Postgres and the object store: matching guest names, whitespace spans, threaded mentions, self mentions, failure/retry deduplication, forged peer references, room/revocation changes, reconnect/read behavior and leakage/deletion. Storybook and manual keyboard/phone/light/dark checks exercise the same components on made-up people.
