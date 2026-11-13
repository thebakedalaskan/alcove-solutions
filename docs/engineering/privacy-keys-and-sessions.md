# Privacy, keys and sessions

[Docs home](../README.md) · [System architecture](system-architecture.md) · [Data and storage](data-and-storage.md) · [Deployment and acceptance](deployment-and-acceptance.md)

**Goal.** Readable content (names, emails, titles, guests, chat, audio, transcripts, shared screens,
notes, files in a workspace) exists only in
the browsers of the people it belongs to and inside the API process while it works on it. The database,
object store, logs and network edge see ciphertext, opaque IDs, keyed hashes, sizes and timing. NEAR AI
Cloud transcribes speech and writes notes, but only in confidential VMs whose hardware evidence Alcove checks
first, with everything sealed to the key that evidence vouches for
([Notes and inference › Verified private inference](notes-and-inference.md#verified-private-inference)).
Google Calendar carries the calls an organizer schedules. With separate, explicit consent, Google Drive receives
readable copies of selected finalized call artifacts in a chosen folder; that folder's permissions apply to those
copies ([Drive exports](drive-exports.md), [What is still visible](#what-is-still-visible)).

**Trust model.** The API process is the trusted plaintext endpoint (`C01`). It holds the master key
`KMASTER`, which opens every account's root key, so it can open any account at any time without that person
being present. That is how invited people read an organizer's notes, and how the notes worker writes notes
after a call. It also means that whoever runs the process, or can read `KMASTER`, can read everything.
"Alcove can't read your notes" holds only when `KMASTER` is released to nothing but an attested
confidential VM running the expected server image. That is a production requirement, not the current
state: locally `KMASTER` is a value in `.env` read by an ordinary Node process
([Production requirements](#production-requirements)). Inference is verified before anything is sent:
NEAR AI's models get content only sealed to keys that their attested VMs, booted from published dstack images,
vouch for. What runs in those VMs is NEAR AI's choice and isn't pinned to a reviewable build
([Notes and inference › What's left](notes-and-inference.md#whats-left)). Inside the process, modules are not
a security boundary: any code can reach `cfg.KMASTER`.

**Sign-in is real only for Google.** Google sign-in is OpenID Connect with checked ID tokens and verified
emails ([Accounts and sign-in](#accounts-and-sign-in)). Microsoft and single sign-on are still stand-ins in
`apps/api/src/demo.ts`: Microsoft always signs in Art Vandelay, and SSO signs in whoever's work email is
typed. Nothing checks those addresses, so SSO accepts only addresses no real person can have: domains
reserved for examples (`example.com`, `.net` and `.org`, and anything under `.example`, `.test`,
`.invalid` or `.localhost`) and the demo company's `vandelay.industries`. Any other address is refused, so
nobody can sign in as someone who uses Alcove with Google and read the notes given to them.

## Key inventory

| Key | How it's made | Where it lives |
| --- | --- | --- |
| `KMASTER` | 32 random bytes, base64url (43 characters), from the environment | `.env` locally; in production, released only to the attested confidential VM. Wraps every root key and keys the blind indexes. |
| `ownerId` | 32 random bytes, base64url (43 characters), made when the account or [workspace](#who-can-open-a-workspace) is created | Clear, as the account's opaque ID; a workspace's stays on the server, behind its `workspace_id` |
| `Kowner` (account or workspace root) | 32 random bytes, made when the account or workspace is created | Only wrapped: `owners.root_envelope`, a key envelope (scope `owner-root`) under `HKDF(KMASTER, salt=ownerId, "alcove/owner-root/v1")`. Opened for each request or notes job, never cached. |
| Root check | `HMAC(HKDF(Kowner, salt=ownerId, "alcove/root-check/v1"), ownerId)` | `owners.root_check`; proves an opened root is this account's, so a wrong key never opens an empty vault |
| `Kwrap` | `HKDF(Kowner, salt=ownerId, "alcove/owner-wrap/v1")` | Derived per request; wraps revision and recording keys |
| `Krecord` | 32 random bytes per item revision | `revisions.key_envelope`, wrapped under `Kwrap` with scope `revision:<id>` |
| `Krec` | 32 random bytes per recording | `recordings.key_envelope`, wrapped under `Kwrap` with scope `recording:<id>`; seals the recording's audio pieces, its kept shares' video and the frames taken from it |
| State keys | `HKDF(Kowner, salt=ownerId, "alcove/state/v1/<scope>")`, scopes `document-clients:<id>` (who each Yjs client in a document belongs to, as keyed hashes), `document-deletes:<id>` (a keyed hash of what each row of its log deletes, so the same deletes again cost nothing), `call:<id>` (call state), `call-attention:<id>` (ordered hands, explicit questions, votes, nudges for their one recipient, statuses and audience-bound notification cues), `call-mls:<id>` (the call's MLS log, sealed again), `call-seat:<id>` (each person's seat in the call, a MAC of their random per-call `person`, never stored), `call-move:<id>` (moves to other devices in a call), `call-notes:<id>` (the call's shared live notes), `ring:<meetingId>` (rings in a call), `meeting-answers:<meetingId>` (what people invited to a call answered, and the times they asked to move it to), `job:<noteId>` (notes jobs), `transcript:<noteId>` (live transcript clips and caption translations, and the keyed tags that find them), `screen-share:<recordingId>` (whose each share in a call was) and `screen:<noteId>` (what's known about each shared-screen frame, and the keyed tags that find them), `note-additions:<noteId>` (what people added to the shared notes), `note-links:<noteId>` (who made each link to a note's notes, and when). Under the author's own `Kowner`, never the organizer's: `personal:<noteId>` (their own notes on a note), `presenter-notes:<documentId>` (what they kept beside a whole document or board with an earlier release, which nothing opens now), `presenter-frame-notes:<boardId>` (what they keep beside each frame of a board, and the keyed hash that says which frame) and `promotion:<noteId>` (the seal on a preview of adding to the shared notes, and on the box for writing straight into them); and, under a workspace's root, `workspace` (its name, tree and line on what it's for, who its people and shares are, and carets and presence on their way between instances), `workspace-person` (what someone's known by in it, a keyed hash of how access knows them), `document:<id>` (what a document or board holds) and `media:<id>` (a file: what's said about it, and its pieces) | Derived per request, or per job in the notes worker |
| Operation keys | `HKDF(Kowner, salt=ownerId, "alcove/operation-commit/v1")` and `"…/operation-result/v1"` | Derived per request |
| Index key | `HKDF(KMASTER, "alcove/index/v1")` | Derived per use; keys the [blind indexes](#blind-indexes) |
| Sign-in attempt key | `HKDF(KMASTER, "alcove/sign-in-attempt/v1")` | Derived per use; seals the [Google sign-in attempt](#google-sign-in-and-calendar-access) a browser carries to Google and back |
| Media token key | `HKDF(KMASTER, "alcove/media-token/v1")` | Derived per use; signs the token in [a file's URL](#files) |
| `Kservice` | 32 bytes from `KSERVICE` | Derives the accounting key `HKDF(Kservice, "alcove/service/accounting/v1")`, which seals plans, AI meters and top-ups; cannot open owner content |
| Device keys | 256-bit AES-GCM, made in the browser the first time a room recording, an edit, or a camera background picture is kept there (`crypto.subtle.generateKey`, not extractable): one for each, so an old tab holding one database never has to give way to another's | That browser's IndexedDB (`alcove-offline`, `alcove-edits`, `alcove-backgrounds`), never sent anywhere; seal what [this device keeps](#on-this-device), and each is deleted with the last of what it seals |
| Call MLS keys | Made in each browser in a call (an MLS key package and its private keys for each group it joins, then that group's secrets: one group for the main room and, while breakout rooms are open, one for each room), with each sender's media key per epoch `MLS-Exporter("alcove/call-media/v1", identity, 32)` from its group | Only in the browsers in the call, in memory: each browser holds its own part of the call's, the host's (the organizer's, or a stand-in's while the organizer is away) every part's. Never sent to the API or LiveKit ([Calls and recordings › End-to-end encryption](calls-and-recordings.md#end-to-end-encryption)) |
| Call data keys | `HKDF(media key, "alcove/call-data/v1")` for each sender and epoch: seal what browsers send each other through LiveKit (pointers and marks on shared screens, React's emoji (`react/1`), `board-shot/1`, telling someone a picture of their share went on the board, and `codecs/1`, a browser saying it can't decode VP9) | Only in the browsers in the call, in memory ([Calls and recordings › Pointing at shared screens](calls-and-recordings.md#how-it-travels)) |

All derivations are HKDF-SHA-256 with 32-byte outputs. `salt=ownerId` means the ID's 32 decoded bytes; the
index, sign-in attempt, media token and accounting keys use an empty salt.

## Records and envelopes

A **record** is `{header, nonce, ciphertext}`: XChaCha20-Poly1305, a random 24-byte nonce, associated data
`JCS(header)`. Every header carries `v`, `kind` and `ownerId` plus the record's exact location, and opening a
record recomputes the expected header, so a record copied to another row, owner or object fails to open.

A **binary record** is the same record for bytes too big to carry as text, kept as bytes: a 32-bit length, `JCS(header)`, the
nonce, then the ciphertext. The seal, the header and the check are the same, and the XChaCha20-Poly1305 is too, byte for byte:
HChaCha20 makes the key from the nonce and OpenSSL's ChaCha20-Poly1305 does the rest (`sealBinary` in `crypto.ts`), because a
piece of a file is sealed on the one core every call runs on. A `media-piece` is one, and nothing else is yet.

| Kind | Sealed under | Header binds |
| --- | --- | --- |
| `manifest` | `Krecord` | item, revision |
| `audio` | `Krec` | recording, segment, seq, object |
| `screen-share` | state key `screen-share:<recordingId>` | recording, share (whose it was) |
| `screen-video` | `Krec` | recording, share, segment, seq, object (a piece of a kept share's video, as the presenter's browser sent it) |
| `screen-video-chunk` | `Krec` | recording, share, segment, chunk, how many chunks, object (at most 4 MiB of a share's joined video) |
| `screen-video-stage` | Fresh random key per join, never stored | recording, share, segment, stage, object and chunk (temporary bounded chunks used to remux and index; deleted on completion, with the key wiped) |
| `screen-frame` | `Krec` | recording, frame, object (a JPEG taken from a share's video) |
| `screen-frame-info` | state key `screen:<noteId>` | note, frame (whose share, when, its size, why it was picked, what was read on it) |
| `call-state` | state key `call:<id>` | call |
| `timer-preset` | the account’s state key `timer-preset:<id>` | owner and preset (an earlier release's timer presets, which nothing opens now; a later migration drops their table) |
| `call-attention` | state key `call-attention:<id>` | call (hands, question text/authors/votes, nudges, statuses, original room audiences and cues) |
| `call-mls` | state key `call-mls:<id>` | call, place in the call's log, entry kind, and the part of the call's group it belongs to |
| `call-move` | state key `call-move:<id>` | call, move |
| `call-notes` | state key `call-notes:<id>` | call, part of the call (`main`, or a breakout room's random ID), view (`all`, or a digest of the lines it can't read) |
| `call-notes-lines` | state key `call-notes:<id>` | the same (the lines that row read, and the lines it left out) |
| `meeting-answer` | state key `meeting-answers:<meetingId>` | meeting, and the hash of the address of whoever answered |
| `meeting-proposal` | state key `meeting-answers:<meetingId>` | meeting, and the hash of the address of whoever asked to move it (the time they asked for) |
| `call-ring` | state key `ring:<meetingId>` | meeting, ring (whom it's for and what they said) |
| `transcript-clip` | state key `transcript:<noteId>` | note, clip tag |
| `transcript-translation` | state key `transcript:<noteId>` | note, line-and-language tag |
| `personal-notes` | the author's state key `personal:<noteId>` | the author (`ownerId`), the note and its organizer |
| `note-addition` | state key `note-additions:<noteId>` | note, addition |
| `note-link` | state key `note-links:<noteId>` | note, link (who made it, and when) |
| `job` | state key `job:<noteId>` | note |
| `drive-export` | state key `drive:<scope>` under the exporting account | connection, call or export job's exact scope; credentials, destinations and private export metadata |
| `drive-oauth-attempt` | sign-in attempt key | independent Drive authorization attempt; the sealed body binds the owner, state, PKCE verifier and expiry |
| `workspace-state` | state key `workspace` | workspace (its name, its tree and the line on what it's for) |
| `workspace-member` | state key `workspace` | workspace, member (who someone in it is) |
| `document-access` | state key `workspace` | workspace, document, entry (who a document is shared with) |
| `document-update` | state key `document:<id>` | workspace, document, `seq` (one Yjs update and who sent it) |
| `document-snapshot` | state key `document:<id>` | workspace, document, the `seq` it reaches (the state to there) |
| `document-editors` | state key `document:<id>` | workspace, document, the `seq` it reaches (who has edited since the last version) |
| `document-version` | state key `document:<id>` | workspace, document, version, which part of it (who and why, or 256 KiB of the state, with which part and of how many, so a version can't be cut short or reordered) |
| `document-awareness` | state key `workspace` | workspace, document (a caret on its way between instances, never stored) |
| `workspace-presence` | state key `workspace` | workspace (where someone is, on its way between instances, never stored) |
| `workspace-media` | state key `media:<id>` | workspace, file (its name, type, size and dimensions) |
| `media-piece` | state key `media:<id>` | workspace, file, seq, object (a piece of the file, as a binary record) |
| `media-preview` | state key `media:<id>` | workspace, file, object (a picture's small JPEG preview, as a binary record) |
| `workspace-mention` | state key `workspace` | workspace, document, tag (who tagged someone and on which line, until they've heard) |
| `agent-grant` | state key `agent:<grantId>` | owner, grant (an agent connection's name, kind, permissions and OAuth client) |
| `agent-code` | state key `agent:<grantId>` | owner, grant, the code's hash (what an OAuth code was issued for) |
| `agent-operation` | state key `agent-operations:<grantId>` | owner, grant, operation (the ID a creation an agent may retry made) |
| `agent-activity` | the account's state key `agent-activity` | owner, row (what one tool call did: the tool, the note or call it was about by ID, and how many it found) |
| `agent-client`, `agent-authorization` | the agents service key | an OAuth client, or a consent request waiting on someone; the owner is empty |
| `operation-result` | operation-result key | operation |
| `billing` | accounting key | owner (the credits account of before plans: no longer read) |
| `plan-account` | accounting key | owner (the plan, the balance in dollars and its history, any grace, the months of Pro bought, renewing, the notices about Pro and the owner's team's licenses, and more notes bought for a period) |
| `team-name` | state key `team` under the team's own owner | team (its name) |
| `team-member` | state key `team` under the team's own owner | team, member (their name and address, as their account has them: a sign-in that brings new ones seals them again) |
| `team-billing` | accounting key | team's owner, team (its unconsumed licenses and what each cost, auto-purchase, the alerts its admin has had, its pool as last reckoned and its grace), opened without anyone signed in so upkeep can reckon the pool |
| `ai-meter` | accounting key | owner (the period's AI allowance in dollars, what's been spent by kind, what requests in flight and live calls hold, and when it ran out) |
| `deposit` | accounting key | owner, deposit (a top-up's route, address, amounts and the provider's quote, and what it was opened to buy and how that went), opened without anyone signed in so the watcher can add it |
| `sign-in-attempt` | sign-in attempt key | provider (`google`); the owner is empty, as nobody is signed in yet |

- **Key envelope:** `{v, ownerId, scopeId, keyVersion, nonce, ciphertext}` with the header as associated data.
  Scopes are `owner-root`, `revision:<id>` and `recording:<id>`. An envelope cannot be moved between owners
  or scopes.
- **Keys are never used once wiped.** Every seal and open refuses an all-zero or wrong-length key with an
  `InternalError`, so a wiped key can't quietly produce ciphertext anyone can open. Revision and recording
  keys are zeroed after use. Zeroing in JavaScript is best-effort: the runtime may keep copies the code can't
  reach.
- **Comparisons** of MACs, digests and root checks are constant-time.

## Blind indexes

People are found by keyed hashes, never by a stored name or address:

```
index(purpose, value) = HMAC-SHA-256(HKDF(KMASTER, "alcove/index/v1"), purpose ‖ 0x00 ‖ value)
```

| Purpose | Value | Stored in | Used for |
| --- | --- | --- | --- |
| `subject` | The sign-in provider's account ID (`google:<sub>` for Google) | `identities.subject_index` (primary key) | Finding the account at sign-in |
| `email` | The email address, trimmed and lower-cased | `identities.email_index`, `note_access.email_index`, `workspace_members.email_index`, `workspace_authors.email_index`, `document_access.principal_index`, `workspace_mentions.principal_index`, `workspace_calls.organizer_index` | Whether an address is on Alcove (people search, team and who on it uses Alcove); who else may read a note; who's in a workspace, and who a document is shared with; whose call a workspace is open to, which counts while they can edit there |
| `invite` | The email address, trimmed and lower-cased | `meeting_access.email_index` | Who's invited to a call. A purpose of its own, so these rows can't be joined to `identities` without `KMASTER` |
| `call-code` | The call's code from its link | `call_codes.code_hash` | Finding a call for anyone with the link, guests included |
| `ring` | The email address, trimmed and lower-cased | `call_rings.email_index` | Finding the rings for someone signed in. Its own purpose, so a row joins to no other table without `KMASTER` |
| `addition-author` | The account's owner ID | `note_additions.author_index` | Taking everything an account added to the shared notes out of everyone's notes when it's deleted |
| `note-link-maker` | The account's owner ID | `note_links.maker_index` | Taking out the links an account made to a note when it removes the note from theirs, and every link it made when it's deleted |
| `call-seat` | A call's ID and someone's seat in it | `document_access.principal_index` | Who a document is shared with in a call. Only the API can work one out, from a call pass; it's different in every call |
| `call-workspace` | A call's ID and the ID of a workspace it uses | `workspace_calls.call_index` | Which workspaces a call [opens to everyone in it](#who-can-open-a-workspace). Everyone let in carries the one for the workspace the call uses now, worked out by the API from their pass and the call's state; it's different for every call and workspace, and the same for everyone in a call, so it's what the call opens to them and never who they are |
| `upload-guest` | The person a guest's call pass names, random for each person in each call | `media_guest_upload_days.guest_index` | Counting what a guest uploads in a day, on every instance and after a restart. It can't be matched to a call, a seat or a name |

The hash is deterministic, so equal values show the same person across rows and accounts (see
[What is still visible](#what-is-still-visible)), and anyone holding `KMASTER` can test a guessed address.

## Accounts and sign-in

1. **Sign in with Google** (`apps/api/src/google.ts`). `GET /v1/auth/google` redirects to Google's
   authorization endpoint, found by OpenID discovery, with a fresh `state`, `nonce` and PKCE verifier (an
   S256 challenge), the scopes `openid email profile` and `prompt=select_account`. Google sends the browser
   back to `GET /v1/auth/google/callback` (`$API_URL/v1/auth/google/callback`). The server deletes the
   attempt cookie, checks that the attempt is under 10 minutes old and that `state` matches, swaps the code
   for tokens with the verifier and the client secret, and verifies the ID token with `jose`: RS256 against
   Google's published keys, the issuer, the audience (the client ID) and the expiry, with 60 seconds'
   tolerance. Then it checks the nonce and accepts only `email_verified: true`, because notes are shared by
   email. The identity is `google:<sub>`, the lower-cased email, and Google's name and photo URL. A refusal
   sends the browser to `/welcome?signin=<reason>` (`cancelled`, `expired`, `unverified`, `unavailable`,
   `busy` or `failed`) and signs nobody in. Welcome opens Google in a popup, keeping the page and its
   animations running in the original tab. That attempt includes a random UUID `popup` channel; success
   returns the popup to `/welcome?popup=<id>&next=<path>`, and refusals to
   `/welcome?popup=<id>&signin=<reason>`. The completion page tells the original tab through a same-origin
   `BroadcastChannel`, with only the destination or refusal. The original tab verifies its session with
   the API before leaving Welcome. No tokens or personal information enter the completion URL or channel.
   A blocked popup falls back to the same-tab redirect. Calendar and Drive access each have their own consent flow.
2. **Demo sign-in.** `POST /v1/auth/sign-in` with `{provider, email?}`, where `provider` is `microsoft` or
   `sso`; `demo.ts` turns the request into an identity (Art Vandelay, or `demo:sso:<email>` with a name
   made from the address), marked as a demo (`sample`). Both ways in share one limit: 30 attempts a minute
   per client address.
3. **The first sign-in with a subject creates the account**, in one transaction serialised on the subject
   index: the `owners` row with a fresh `ownerId`, `Kowner`, root envelope and root check; the `identities`
   row; the sealed profile (name, email, photo URL, notes default `on`); and its plan account (`plan_accounts`, sealed under
   `Kservice`), on Free with a balance of nothing. Later sign-ins with the same subject open the same account and bring the profile's name,
   email and photo, the identity's email index, and the name and address their team shows (`teams.ts › memberChanged`)
   up to date with the provider. After every sign-in a
   session opens; for a demo identity with nothing upcoming, the sample calendar is placed too: five sealed
   meetings, the first about 12 minutes later. A new account lands on `/ready`, which plays the account-creation screen over Home; anyone else lands on `/home`.
   Signed in from the welcome page, Home opens by sailing out of the welcome page's cove: as a way in is pressed, where the
   cove stood on screen waits in that tab's sessionStorage (`alcove.sail-out`, `SailOutStoredSchema`: a time and geometry,
   no names, nothing typed) for ten minutes at most, and Home takes it once.
4. **Every request opens the account's keys** (`openOwner` in `apps/api/src/owners.ts`): it reads
   `root_envelope` and `root_check`, unwraps `Kowner` under `KMASTER`, checks the root check (`IntegrityError`
   on a mismatch) and derives `Kwrap`. The request works on its own copies (`Owner.root`, `Owner.wrapKey`).
   No key is cached between requests. Reading someone else's note opens their account the same way, after
   the access check, and so does the notes worker for each job.

## Sessions

### Delegated agents

Agent credentials are separate from browser sessions. A person explicitly grants scopes through OAuth consent or
the Agents page, and changes them there later; the delegation cannot exceed their current note/meeting access. Opaque bearer values are stored only as
SHA-256 hashes. Grant labels and scopes are sealed under the owner's state key `agent:<grantId>` with the record
header `agent-grant` binding owner and grant; changing the scopes seals the same record again. OAuth clients and anonymous consent requests are sealed under
`serviceKey(KSERVICE, 'agents')` with `agent-client` and `agent-authorization` headers binding their IDs. Codes are
hashed and their binding metadata is sealed under the grant key with an `agent-code` header binding owner, grant
and code hash. Operation results contain only created IDs, sealed under `agent-operations:<grantId>` with an
`agent-operation` header binding owner, grant and operation; arguments are represented by a keyed commitment.
What an agent did, one row for each tool call it completed, keeps the tool, the note or call it was about by ID and how
many it found, sealed under the owner's state key `agent-activity` with an `agent-activity` header binding owner and
row; a title is read only when its owner lists it, from what they can open then. It goes with its connection, after 30
days, and past each connection's newest 1,000 ([Agents and MCP › What your agents did](agents-and-mcp.md#what-your-agents-did)).

Tokens never enter browser storage or general response receipts. Consent identifies the server's current account
and binds approval to that owner; a cookie change in another tab cannot authorize a different account silently.
Disconnect physically deletes the grant and its credentials/codes/operations/activity; account deletion cascades all of them.
Expiry and OAuth refresh replay also end access. Signing out leaves independent agent delegations in place.

The agent receives readable content allowed by its scopes. Its own provider can process or retain that content;
Alcove's confidential inference does not extend to an external agent. Write-only results never include a full note,
transcript or meeting. See [Agents and MCP](agents-and-mcp.md) for the complete boundary and expiry policy.

- **Cookie.** `alcove_session`, or `__Host-alcove_session` when `WEB_ORIGIN` is HTTPS: HttpOnly,
  `SameSite=Strict`, path `/`, `Secure` over HTTPS, max-age 30 days. The value is a random 32-byte ID in
  base64url (43 characters), and the browser holds the only copy.
- **Stored as a hash.** The `sessions` table keeps the ID's SHA-256, the owner, the provider, and when the
  session was created, last seen and expires. A copy of the database can't be turned into a working cookie.
- **Limits.** A session ends after 14 days unused or 30 days in all. Last seen is refreshed at most once a
  minute. The tab that notifies reads Alcove every minute, hidden or not, and that counts as use: left open in a
  browser that allows notifications, a session isn't unused, and it ends at the 30 days. An ended session is deleted when its cookie is next presented, and maintenance sweeps the rest every
  5 minutes.
- **Never from a QR code.** Moving a call to another device makes no session: the organizer and invited people
  move only to a device already signed in to their account (signed in the usual way, there and then if need be),
  and a guest's new device gets a call pass like any other
  ([Calls and recordings › Moving to another device](calls-and-recordings.md#moving-to-another-device)).
- **Several per account.** Each browser has its own session; signing out (`POST /v1/session/sign-out`)
  deletes only that one, and deleting the account deletes them all ([Deletion](#deletion)). Sessions live in
  Postgres, so they survive restarts and work on any API instance.
- **Refusals.** No cookie, or an unknown or ended one: `401 unauthenticated` (a stale cookie is also
  cleared), and the app goes back to the welcome screen.
- **Never logged.** Session IDs are bearer secrets; logs identify a session by its `ownerId`.

## Google sign-in and calendar access

- **The attempt cookie.** `__Host-alcove_google` when `WEB_ORIGIN` is HTTPS (`alcove_google` otherwise):
  HttpOnly, `SameSite=Lax` (Google's redirect back is a cross-site navigation), path `/`, `Secure` over
  HTTPS, max-age 10 minutes. It holds the `state`, `nonce`, PKCE verifier, expiry, whether this pass asked
  for Calendar consent, where signing in lands (`next`), where Calendar consent goes back to (`back: '/home'` when it
  was started on Home), and a popup channel UUID (null when there is no popup), sealed as a `sign-in-attempt` record,
  so the browser can neither read nor change it. Older attempt records without a popup channel still open with a null
  default, and older Calendar consent records without `back` go back to Calendar settings.
  The callback uses the sealed channel only when its `state` matches, never a channel supplied on the
  callback URL. An expired matching attempt may deliver its refusal to that channel, but cannot sign in.
  The callback deletes the cookie only when the state matches, so an older tab cannot erase a newer attempt.
- **Connecting Calendar.** **Connect Google Calendar** (in Home's Upcoming, Settings, scheduling's Details and a series)
  goes straight to `GET /v1/auth/google?consent=1` (`&back=/home` from Home, as `?next=` says where signing in lands), with no page in between. It asks Google for
  identity, `calendar.events.owned` and `calendar.events.freebusy` scopes, offline access and explicit account selection
  and consent; Google's consent screen is where the person decides. Connections with the earlier `calendar.events` grant
  can still use Calendar.
  The sealed attempt binds the owner and session hash, and where to come back to. The callback requires that session to
  remain open and the Google identity to match the owner. It returns with the result to Home (`/home?calendar=<result>`,
  which Home reads and takes out of the address) when the consent was started there, and to Calendar settings
  (`/settings?calendar=<result>#calendar`) otherwise, including for any other `back` value and for attempts sealed by the
  previous release. Only the sealed attempt says where it returns, never the callback's address.
- **The refresh token.** Calendar consent saves the scopes, time and refresh token as a sealed
  `connection` item. An existing refresh token can be reused if Google grants Calendar access again
  without sending a new one. Ordinary sign-in leaves the Calendar connection alone.
- **Disconnecting.** `DELETE /v1/calendar` deletes the `connection` item and its revisions from the database
  (no flag, no tombstone) and drops the cached access token. This disconnects Calendar in Alcove while keeping
  separate Drive access usable. The account holder can remove Alcove's full app grant in their Google Account.
  A Google account with no connection then reads as
  `needsAccess`, and Connect asks again. Calls scheduled earlier keep their event ids, but with no connection
  nothing is sent to Google when they change or are cancelled.
- **Keeping calls off the calendar.** The `addToCalendar` preference (default on) is read from the sealed
  profile when a call is scheduled. Off, the call is never placed on Google, so it has no event to update or cancel.
- **Access tokens** live only in the API process's memory, per account, until a minute before they expire,
  and are renewed from the refresh token; a renewal that finishes after its account was deleted isn't kept. A Calendar call that gets `401` drops the cached token and tries
  once more. When Google answers a renewal with `invalid_grant` (access withdrawn at Google), the refresh
  token and the calendar scope are removed from the connection, and the app offers to connect again.
- **What goes to Google.** Scheduling, changing or cancelling a call while the calendar is connected
  creates, updates or deletes an event on the organizer's primary Google Calendar with `sendUpdates=all`,
  so Google emails everyone invited. The event carries the call's title, time and guests, the join link, a
  line saying whether notes are on, `guestsCanModify: false` and a private extended property
  `alcoveMeeting` with the meeting ID. If Google fails, the call is kept without its calendar event. Calls
  started now don't go on the calendar, and neither does a call offering times until one is picked: each time it
  offers is held on the organizer's calendar instead, as an event of theirs that invites nobody (`sendUpdates=none`),
  named "Hold: " and the call's title, with the call's link and a private extended property `alcoveHold` with the
  meeting ID. Their event IDs are sealed in the call's manifest (`holds`), they take the call's new name when it's
  renamed, and they're deleted, telling nobody, when someone picks (the call's own event takes the picked one's place,
  with its invitations), when the call is cancelled, and when the account is deleted. If Google fails, the call offers
  its times all the same, and anything held so far comes off again. Changing only
  what the event doesn't show (what the notes keep, joining muted, documents) sends Google nothing. A series that
  repeats is one recurring event, so everyone gets one invitation and not one per call: it also carries how the
  calls repeat and the organizer's time zone, its link is the series' own, and the private property holds the
  series' ID. A change to one call goes to its occurrence. Fixing up occurrences right after a change everyone has
  heard about (a call moved or cancelled on its own, when a new recurring event takes over) is sent with
  `sendUpdates=none`, so nobody gets an email for each. If Google fails, the calls are kept, and each step that
  didn't reach the calendar is logged ([Notes and inference › Series](notes-and-inference.md#series)).
- **What comes from Google.** `GET /v1/calendar` reads the primary calendar's events from an hour ago to a
  week ahead (at most 100), or with `from` and `to` any stretch of at most 31 days, past ones included (at most 250),
  as the scheduler and the Calls page's week ask for each week they show, into memory for the response, and never
  stores them: timed events that weren't cancelled or declined, of the default type, and not Alcove's own (its calls'
  events and the times it holds). Only your own calendar is read this way: other people's are only ever busy times
  (below). Someone invited to an Alcove call has their own
  copy of its event, without the private property, so it's read as theirs: its location under the web app's
  `/join/` says which call it is (`alcoveCode`) and joins it. When the organizer opens a call that's on the
  calendar (`GET /v1/meetings/:id`), the event's `attendees[].responseStatus` is read too, for anyone with no answer
  in Alcove: at that moment, for each person's answer and the counts in that response, and stored nowhere. If Google
  doesn't answer within 3 seconds, the answers are Alcove's alone. `POST /v1/calendar/events/:id/adopt`
  makes one of them an Alcove call, only if the account is its organizer (`403 forbidden` otherwise): the
  call takes the event's title, time and guests, and the event gets the Alcove link above its old
  description, with the update sent to everyone. Adopting the same event twice returns the same call. An
  occurrence of a recurring event carries Google's ID for the whole recurring event (`recurringEventId`):
  adopting one keeps that ID inside the call's sealed manifest, so every occurrence held in Alcove is in one
  series, and the calendar view marks later occurrences with it
  ([Notes and inference › Series](notes-and-inference.md#series)). The meeting also records that its event
  was adopted, so deleting the account leaves the event where it is ([Deletion](#deletion)).
- **When people are busy.** `POST /v1/calendar/busy`, with the addresses in the body, at most 300 of them and 31 days,
  60 a minute per account. Your own busy times come from your primary calendar's events (those not cancelled,
  declined or marked free) and your own calls; other people's from Google's `freeBusy`, 50 calendars at a time,
  which needs the `calendar.events.freebusy` scope and says only when, never what. A person's `busy` is null when it
  can't be read: Google answers with an error for that calendar (a private one does), or `403` for the whole request,
  as it does for a connection from before that scope was asked for, which still reads its own events. With no
  calendar connected, your own calls are all there is and everyone is null. The answer goes to the browser and
  nowhere else: nothing is stored, it keeps no receipt ([Requests](#requests)), and logs have how many people and
  how many were readable, never who or when. Demo accounts read a made-up week from `apps/api/src/demo.ts`, the same
  on every read: the company's for anyone at it, in working hours where the browser says it is, and null for
  anyone outside it.
- **Never logged:** ID tokens, refresh and access tokens, Google's error descriptions, and Google's event IDs
  (an occurrence's ID begins with its recurring event's, so logged paths, the server's and the browser's,
  show `/v1/calendar/events/:id`, and a refused adopt's error names no event). Only Google's error code
  (such as `invalid_grant`) is.

## Who can see a call

A call lives in its organizer's vault, sealed under their keys. `meeting_access` lists everyone on its invite,
one row per person: `(owner_id, meeting_item_id, email_index, answer_ciphertext)`, with the address as the hash of
purpose `invite`.

- **The rows follow the guests.** They change in the transaction that changes the guests: scheduling, changing a
  call, starting one now, moving an event to Alcove, the next call in a series, and someone being let in from the
  link or removed. People who stay keep their answers; someone taken off goes, answer and all. Each call in a series
  has its own rows, by its own guests, so being invited to one call in a series opens only that one.
- **Calls from before this table** have no rows, and their guests are sealed, so no migration can fill them in.
  The organizer's next read of Upcoming does: any call it lists whose rows don't match its guests is put right
  there, with their keys. Until then someone invited to one has its link and calendar event, as before.
- **The check.** `locateInvited` in `apps/api/src/features/meetings/access.ts` needs a row for that call and the caller's
  invite index, taken from their profile email; only then does it open the organizer's keys and read the call.
  Reading a call someone's invited to and answering it both go through this check. Anyone else gets `404 not-found`,
  the same answer as for a call that doesn't exist, and so does the organizer answering their own call. Changing or
  cancelling a call is the organizer's alone: those read only their own vault.
- **Demo sign-ins.** Nothing checks a demo sign-in's address, so one never sees a real organizer's call, however
  its address came to be invited. It's the rule notes follow ([Who can read a note](#who-can-read-a-note)). And
  nothing checks who a demo organizer is, so what they write doesn't land on a real account's Home either; their
  link still works for anyone they send it to. Demo accounts see each other's calls.
- **How far it reaches.** Anyone can invite any address, so what lands on someone's Home is bounded: Upcoming lists
  other people's calls only for the next 90 days, though a call further out can still be opened and answered, and an
  account makes at most 30 calls a minute, however it makes them.
- **What the organizer sees:** everyone invited, what each of them answered (`answers`), and the times any of them
  have asked to move the call to (`proposals`), from their rows, which only the organizer's keys open.
- **What someone invited sees:** the call as the organizer scheduled it, the organizer, how everyone has answered, as
  counts, their own answer and the time they asked for, if they did, and what was [brought to it](#brought-to-a-call). Up to 25 people invited they see who, with their addresses;
  past that, only how many. They don't get the call's note, its calendar link, or a series' own link, unless the call is
  on a calendar, whose invitation carries that link. They see how a series repeats; the rest of the series is its
  organizer's.
- **Answering** (`POST /v1/meetings/:id/answer`) seals the answer into the person's row under the organizer's keys,
  bound to that call and that person's hash, so it can't be moved to another row. It's padded, so all three answers
  are the same length. It keeps no receipt: the response is the organizer's call, which a receipt under the person
  invited would hold after the call was cancelled. Google Calendar doesn't hear about it.
- **Asking to move it** (`POST /v1/meetings/:id/propose`) goes through the same check and seals the time asked for into
  the person's row, beside their answer, as a `meeting-proposal` record bound to the call and their hash; a moment as
  `toISOString` writes one, so every request is the same length. Asking again replaces it. Only a call that hasn't
  started and has a time of its own can be asked, to a time still to come. It keeps no receipt, for the same reason, and
  Google Calendar doesn't hear about it. The organizer answers (`POST /v1/meetings/:id/proposals/answer`, the address
  in the body): **Move it** changes the call's time as Change the time does, so a connected calendar tells everyone, and
  **Keep** lets go of that request. Any change that moves a call clears every request on it, since they were asked of
  the time it had; someone taken off the invite takes theirs with their row, and deleting their account clears it with
  their answer.
- **A call that's over.** Once a call has ended, or it's an hour past its time (for a call offering times, its last
  one), it leaves everyone's Upcoming. Ending it deletes its rows in the same transaction, and a call nobody held loses
  them the first time its organizer or someone invited reads it after that, so an address with no account leaves no
  row behind. Its notes go by `note_access`, which this doesn't touch. If its organizer then moves it or starts it
  again, the rows come back, without the answers that went with them.
- **A call offering times** can be settled by anyone with its link, with no account (`POST /v1/calls/:code/pick`):
  the link is what decides, as it is for the card. The first pick wins, under the call's lock.

### Attention during a call

Explicit Q&A, its votes and pinned question are visible only in their room to the people present when
submitted. Moving into a room later gives no access to earlier questions, counts or pins; the same check runs
under the call lock for votes and moderation. Every attention mutation names the room the sender was viewing, so a delayed
submission is refused after a move. A signed-in account has one vote per question across its devices; an unsigned guest
has one vote per stable call person. The principal is fixed in the sealed participant record when joining, so omitting
a cookie, signing out or sending another account's cookie cannot create another vote or change authorship. Reloads and device
moves preserve that principal. Older active calls without it use their sealed account address or guest person consistently,
including when another browser joins that account during the upgrade. Host powers do not open another room's questions. Pinning an authorized question replaces the room's previous pin, and
unpinning clears the room's pin, without revealing questions outside the host's original audience. Raised hands
are different: the host sees every room's raised hands, so someone in a breakout room can ask the host for help, and can
lower one by its entry ID, so an older press can't lower a newer raise. Everyone else sees their room's hands. Reloads and
device moves keep the order they went up in; intentional departure, removal and moving rooms clear the hand.

A question can be asked anonymously. Its record then keeps nothing that says who asked: in place of the asking connection's
ID it keeps a placeholder that matches no connection (`anonymous_` and a random ID; connection IDs are `p_…`), and only the
asker's attention principal (`voter`) says it's theirs. So only their reads say `own`, and only they can post it again (a
retried post) or take it back; nobody's read names who asked, whoever hosts included, and no cue, log line or error does.
Taking a question back, named or anonymous, removes it from the sealed record in the same save: nothing of it is kept, its
votes included. Anonymity fails closed across a deploy: the release before it, which may still serve while the deploy runs
or after a rollback, opens the record (it ignores the flag it doesn't know) and drops `anonymous` when it saves, but it finds
nobody by the placeholder, so it names nobody either. This release reads a placeholder as anonymous again and writes the flag
back on its next save. Questions sealed before anonymity have no flag and their asker's real connection, and read as named.

A nudge is for one person. Someone let in names another person in their own room by participant ID, and one of four kinds
(`muted`, `cant-hear`, `slow-down`, `louder`); only that person's reads carry it, in the room it was sent in, as one note
for each kind with how many sent it within a minute of the first, and who sent it while that's one person. The same sender
again within that minute changes nothing. Nobody else's read carries any of it, whoever hosts included, and no cue, log line
or error says who nudged whom or what. It's refused for anyone not let in, and for a recipient who isn't in the sender's
room now, was removed, or is the sender; a participant ID from another call is not in this one, and that call's pass opens
nothing here. A status is someone's own (`away`, `listening` or `phone`, with an end time 2, 5 or 10 minutes from when it was
set, or none): everyone in the call reads it on that person's participant, kept under their stable reader through reloads
and room moves, until its time runs out, they clear it, or they leave on purpose. A nudge's push to read the call again goes
to its recipient's connections alone; a status's goes to everyone. Nudges are limited to 20 a minute and status changes to
30 a minute, per person in a call.

`call_attention` holds one sealed record per call, scoped by its organizer and call IDs. Its new `call-attention` header and
key bind it to that exact owner and call. Questions are at most 1,000 characters, with 200 per call, 200 votes per question,
200 hands, 200 nudge notes and 500 statuses. A nudge note is kept for a minute after it last changed, and goes when its
recipient leaves on purpose or changes rooms; a status goes when its time runs out on the server clock. Both also go once
their person's latest connection has been out of the call for two minutes without leaving on purpose (it dropped, or its tab
closed): a reload's new connection, on its way back in, keeps them, and a later change to the call lets the rest go. At most 64 typed cues from the last minute are retained; admissions are host-only, and hand cues also reach the host
across rooms. Other cues retain their original room audience. A waiting browser renews its sealed admission heartbeat at
most every 15 seconds; 90 seconds without it expires the request, including for a delayed MLS approval under the call lock.

All attention is live-only: ending the call deletes its record in the same transaction, and deleting the meeting or account
cascades it. No Q&A is copied into notes, receipts or logs. Migration `0018_call_attention.sql` only adds the table. Older
sealed call records still open: admission heartbeats default to zero, using the original join time until renewed, and old
raised-hand flags become queue entries on the next save, in the old participant order (the earlier release kept no raise
time). Stable entry IDs avoid changes between reads during that conversion; subsequent saves omit the replaced flags.
Attention records sealed before nudges and statuses open with neither (both default to empty), and the quiet feedback
signals they kept are ignored and gone from the next save. No table changed for either.

## Who can read a note

A note lives in its organizer's vault, sealed under their keys. `note_access` lists who else may read it,
one row per person: `(owner_id, note_item_id, email_index, role)`.

- **Invited.** When a call with notes ends, every address invited to the call gets a row with role `invited`,
  and the note records, sealed, when the call ended. Until then nobody invited can find the note.
- **Let in from the link.** Someone signed in whom the organizer lets in during the call is added to the
  invite then, so they get an `invited` row too. Letting them in is the organizer's grant: only someone who
  asked counts, and the organizer sees their address before deciding (their toast opens People rather than
  letting them in). Only accounts the notes may go to are added: a real one (Google), or any when the
  organizer's own account is a demo one. Demo sign-ins check nobody, and Microsoft's is one account everyone
  trying Alcove shares, so on a real organizer's call they ask by name and get nothing. An earlier pass brings
  someone back only as the same account. Removing them from the call takes them off the invite again, in any
  run of the call, once no other connection of theirs is still in it. A guest with only a typed name is never
  added: joining a call, or having been in it, opens no note and no transcript
  ([Calls and recordings › Group calls](calls-and-recordings.md#group-calls)).
- **Shared.** Anyone who can read a note can share it on by email once the call has ended or the room
  recording has stopped (`POST /v1/notes/:id/share`), up to 50 addresses at a time, with the name of one of
  their groups when they picked one. Each new address gets a row with role `shared` and joins the note's sealed
  `shared` list with who shared it, the group's name and when; addresses that have the note are skipped. A
  group itself (its name and addresses) is sealed in its owner's profile: the app sends its addresses and name,
  and the server never looks a group up. Everyone who has the note sees how each person got it, and each reader
  is told their own way: invited to the organizer's call, or shared by whom and with which group.
- **Visible to the team.** A note's organizer, while live-licensed on a team, can make it visible to that team
  (`PUT /v1/notes/:id/team`, [Plans and usage › Team](plans-and-usage.md#team)): a `team_notes` row, `(owner_id,
  note_item_id, team_id)`, IDs only. Anyone live-licensed on that team, checked at every request, can then read it and
  ask about it, and Ask across notes reads it; nobody else, and not someone on the team without a license. It's read
  only: nothing gives them a `note_access` row, they aren't listed among who has it, and every change, share, link,
  addition, their own notes on it and Drive exports are refused (`403 forbidden`, one sentence that names nobody). A
  transcript set to go once the notes are written stays the organizer's, as for everyone else. It stays visible after
  the organizer leaves the team, until they say otherwise; the row goes with the note (it cascades from the item), with
  the organizer's account, and with the team.
- **By a link.** Anyone who can read a call's notes can make a link to them once the call has ended or the recording has
  stopped (`POST /v1/notes/:id/links`, `apps/api/src/features/notes/links.ts`). The link reads nothing by itself: opened
  by an account that's signed in (`POST /v1/note-links/claim`, the secret in the body), it gives that account the notes
  as sharing by address does, with a `note_access` row with role `shared`, and the note's sealed `shared` list says who
  made the link, that it was a link, and when. So every reader is still an account the note lists ("By Priya's link" in
  who has it, "From Priya's link" for the reader), and can lose. Being listed shows that account's name and address to
  everyone with the notes, so the page never claims by itself: it names the account it would open as, says everyone with
  the notes will see it, and claims only when they press Open the notes, after reading who's signed in again (another tab
  may have changed it). A link posted somewhere, or opened by another page with `window.open`, puts nobody on the list.
  Signed out, the page asks them to sign in first, and then asks the same, including after a Google sign-in that took the
  whole tab; someone who joined a call as a guest, by name, gets nothing from the call itself and can open a link only by
  signing in. The
  same rule as letting someone in from a call's link decides which accounts it may go to: a real one, or any when the
  organizer's own account is a demo one (`403 forbidden` otherwise). Its secret (128 random bits) is only ever in the
  link's fragment (`<web app>/link#<secret>`), which browsers never send, and in that POST body; only its SHA-256 is
  stored, beside who made it and when, sealed under the organizer's keys (`note-link`). It runs out after seven days.
  Whoever made it, or the organizer, can revoke it, and it stops when its maker no longer has the notes: removing them
  from theirs, or deleting their account, deletes their links, found by a keyed hash (`note-link-maker`). One that's run
  out, been revoked or never was is `404 not-found`, all alike, so a guess learns nothing. Whoever it already gave the
  notes to keeps them. Everyone with the notes sees the links that still work, who made each and until when. Anyone else
  gets `404 not-found` for a note's links, as for the note.
- **The check.** `locate` in `apps/api/src/features/notes/service.ts` looks in the caller's own vault first. Otherwise it
  needs a `note_access` row for that note and the caller's email index, taken from their profile email; only
  then does it open the organizer's keys and read the note. The note, its audio, its progress stream, its
  follow-ups, asking about it and sharing all go through this check. Anyone else gets `404 not-found`, the
  same answer as for a note that doesn't exist. A note whose organizer deletes their account while it's being
  read is not found either, and drops out of lists and the inbox: it's never a signed-out answer for the reader.
- **The live transcript** is only in the organizer's own call or room recording; nobody else sees it until
  the note is finished and given to them.
- **Live notes** follow the reading rule the live transcript follows, in what the notes model reads and not only in what's
  shown: everyone who may read the same lines shares notes written from those lines and no others, so a guest with the
  link, or someone who came late into a breakout room, gets notes written only from what they were there for. What's
  written can say anything that run read, whichever lines it cites, so nothing written from a line stays in front of, or
  goes back to the model for, anyone who can't read it. Only people who get the notes can tick or add a follow-up, in the
  notes everyone shares, and what's added is only for them
  ([Notes and inference › Live notes](notes-and-inference.md#live-notes)).
- **Ideas from the call** for its board follow the same rule: they're picked only from what everyone in that part of the call
  may read, by someone who may read all of it, and each is shown only to someone who may read every line its look read, who can
  add to the board, while notes are on there. They're sealed in the call's state with the rest of it, under `call:<id>`, with what
  was said, by whom and when, and go once added, when the board closes, when its room closes and when the call ends. A room's
  stay in the room, and a room on the one board every room shares has none, since not everyone on that board may read the room
  ([Calls and recordings › A board in a call](calls-and-recordings.md#a-board-in-a-call)).
- **Sort into themes** sends what the stickies picked say to the notes model, for someone who can edit that board, and keeps
  nothing of it or of the answer: the browser writes the themes into the board, which is sealed like any document. The
  request's body is never logged; its log line says how many stickies and themes.
- **Boards in the notes.** The note keeps which boards were open in the call, sealed with it, and tells each reader only of
  those they can open now, by the names they have now. The notes read a board, its words and its Actions frame's stickies,
  only when everyone the note went to can open it then, everyone it's been shared with since included, because one summary
  goes to all of them: a board someone couldn't open, or was let into for the call alone, never reaches the notes model for
  that note, and what the notes say can't carry it to anyone it wasn't open to, not even when they're written again after the
  note was shared with someone the board isn't open to. The read is the server's, through the board's own workspace, as it
  reads a document for a call's follow-ups; it goes sealed to the verified notes model and back as notes and follow-ups sealed
  in the note, and its log line says how many boards were open and how many were read
  ([Notes and inference › Boards in the notes](notes-and-inference.md#boards-in-the-notes)). Sharing the note afterwards
  shares what the notes say of a board with the rest of them, by someone's choice, as it shares the summary; the board itself
  stays as open as its workspace has it.
- **Breakout rooms' sections** are part of the note: everyone who can read it reads every room's, whichever room
  they were in, while during the call a room's talk is read only there
  ([Notes and inference › Breakout rooms](notes-and-inference.md#breakout-rooms)). In a call set not to keep its
  transcript, a room's lines are the organizer's alone for as long as they're there, like the main room's.
- **Decisions, open questions and follow-ups** are one list for everyone who has the note, and every
  change writes a new revision in the organizer's vault with who made it (their account, name and address, how they
  had the note, inside the sealed manifest) and when. What the notes model wrote is only a proposal: a decision stays
  `proposed` until the organizer or someone invited confirms it (and a confirmed one can later be said to no longer
  hold), a question stays open until someone says it was answered, and a follow-up's owner and due date are
  suggestions until that person takes it on. Having the note lets someone in; what they can do then is one rule
  (`packages/api/src/notes/grants.ts`, [Notes and inference › Decisions and follow-ups](notes-and-inference.md#decisions-and-follow-ups)):
  anyone adds, the organizer and people invited agree, and only the organizer or the person concerned takes away. Only the person a follow-up is for can take
  it on (`403 forbidden` for anyone else; giving it to yourself is taking it on, when it's yours to give), and it can
  only go to someone who has the note now (read under the note's lock, so someone who removed it isn't given one).
  Entries keep the IDs of the lines they rest on; what those lines say reaches a reader only with the note, worked out
  for each reader on each request and stored nowhere. Everything anyone adds goes in sealed with the note, and in
  through an explicit request with its exact words, so nothing private to someone can reach it unless they send it. The inbox, and a question across
  your notes (`POST /v1/notes/ask`), are read per request from the notes you have, your own and ones reached
  through your `note_access` rows; neither keeps anything, and a question names no note, so it can't reach
  anyone else's. Refusals name nobody, so no name reaches a log line.
- **A transcript the call won't keep** is the organizer's alone until the notes are written and it's deleted, by
  every path that reads one: the note, search, asking about it, asking across notes and across a series. Everyone
  else who has the note gets the notes. If they can't be written it stays that way until they are.
- **The transcript** of a written note can be corrected: by the organizer, any line, its words and who said it;
  by anyone else who has the note, the words of their own lines (`403 forbidden` otherwise). Each correction is
  a new revision with who made it and when, and only the organizer has the notes written again from it
  ([Notes and inference › Correcting the transcript](notes-and-inference.md#correcting-the-transcript)).
- **Your own notes** on a note aren't part of it, and having the note doesn't reach them. They're sealed under their
  author's keys, read only by a request with that author's session, and there's no route that names anyone else's:
  the organizer and everyone else who has the note get `404 not-found` for an entry that isn't theirs. What a bookmark
  or a kept answer points at goes through the rules above each time it's read. Something leaves them only when its
  author adds it to the shared notes, after a preview that says who reads it; from then on it's part of the note
  ([Notes and inference › Your own notes](notes-and-inference.md#your-own-notes)).
- **Series.** What carries over from one call to the next is put together on each request from the notes
  the asker can read at that moment, through this same check, and kept nowhere
  ([Notes and inference › Series](notes-and-inference.md#series)). Being in a series opens nothing: someone
  invited to one call sees that call's notes in it and no other, a note deleted or removed is gone from it at
  once, and asking across a series sends the notes model only the calls the asker has. An answer takes a
  while to write, so the check runs again once it's written, for every note it read (the calls of a series,
  the one note when asking about a note, the notes sent when asking across all your notes): if any went
  meanwhile, the answer isn't sent (`409 conflict`). A series ID that comes from a request is treated like a
  note ID: anyone with no notes from it gets `404 not-found`, and only the organizer sees its next call.
  The same goes in a call and at its pre-join: what carries over comes from the notes the account signed in has, found
  by the call's link, so being invited to the call, or in it, adds nothing; a guest has no account, so nothing to read
  (`401 unauthenticated`), and someone with no notes from the series gets `null`, the same as for a call outside one.
  A source's link opens the note through this same check. A later call's `revisits` are read from the later note and
  only for items of notes the reader has, so what a later call did shows only to someone with both notes now
  ([Notes and inference › Series](notes-and-inference.md#series)). Personal material never comes into any of it: only a
  note's own decisions, questions, follow-ups, summary and transcript are read, the call's and its breakout rooms'.
- **Reviewing follow-ups.** Model-generated tasks and changes are pending suggestions, separate from the accepted checklist.
  Review decisions, proposal revisions, change targets and suppression evidence stay inside existing sealed call-notes records
  and note manifests, with the same owner/location headers. No readable review data goes to columns, object names, URLs or logs.
  A review checks the caller's existing access and mutation rights and compares the proposal revision and target under the lock.
  It cannot widen a guest's transcript view, expose a private document, or consent to responsibility on another person's behalf.
  Accepted tasks and review outcomes survive call end and notes written again. Previous-release stored tasks open as accepted
  through defaulted metadata; there is no database reset, SQL migration or changed record header. Physical deletion removes
  the containing records and revisions as before.
- **Removing.** Deleting your own note deletes it for everyone ([Deletion](#deletion)). Removing someone
  else's note deletes your own `note_access` row, which also takes you off the list of who has it, and your own
  notes on it; sharing with you again gives the note back, and nothing else. Deleting your account does both, for
  every note you have.

Access follows the email address, so it is only as strong as sign-in: whoever signs in with an address can
read every note given to it. That's why the demo SSO sign-in takes only example addresses (see above).

## Who can open a workspace

`apps/api/src/features/workspaces/access.ts` decides, and nothing else does. Every route asks it first.

- **A reader** is an account, known by the email index of its profile's address; or someone in a call, known by the
  `call-seat` index of their seat, from their call pass, for as long as they're let in and the call is going on. Signed in
  and in a call, a request with both is both: it has what each gives it, the stronger where they overlap. Neither:
  `401 unauthenticated`, whatever it asked for. While the call uses a workspace, someone in it carries the `call-workspace`
  index of the call and that workspace too, from the call's state as it is at that request (`Who.calls`), which says what
  the call opens to them and nothing of who they are: everyone in the call carries the same one. So nothing that asks
  whether two readers are one person goes by it: not who's who in presence (`isMe`, and with it an address), not whose a
  caret or a Yjs client is, and not whether someone has a document open.
- **A workspace role** (`admin`, `edit`, `read`) applies to everything in the workspace. `read` changes nothing. `edit`
  changes the tree. Only an `admin` renames or deletes the workspace, says what it's for (its line, which anyone in it reads
  and nobody outside it is told of), or changes its people, and a workspace always keeps one.
- **Restricted.** A restricted document or board opens only for its creator, while they're in the workspace or a call it's
  open to (below), and the people it's shared with. Nobody else's tree shows it, and being an admin or in a call doesn't
  open it. Something with no creator (`by` null) gives nobody the creator's rule, and opens only through `document_access`,
  and so does something made by a guest without an account, who has no address to be known by. Whoever restricts
  something they didn't make keeps it as its creator does, or they'd be locked out of it, for as long as it's restricted and
  they're in the workspace or such a call: it's kept on the item, so there's no entry to outlive either. A copy of
  something restricted is restricted to whoever made the copy. When nobody can open one any more because someone was taken
  out, by an admin or by a call's invite, it goes to the workspace's admins, still restricted; when it's because they left,
  or an entry or a seat ended, it goes to Trash, and to nobody else
  ([Data and storage › Workspaces](data-and-storage.md#workspaces)). Deleting an account deletes what only it can open by
  then.
- **Shared.** `document_access` opens one document for anyone, at `edit` or `read`. Someone outside the workspace sees that
  document alone: no folders (its `parent` reads null), no name or head count for the workspace, and no address of anyone.
  People in a workspace who can edit a document say who it's shared with; someone outside it can't, even with `edit`, and
  neither a seat nor a call gives a say: someone who can only edit through either works on it in the call and can't share it.
  One request gives it to up to 100 people, all of them or none, as does one call to `grant` on the server, to any number. An entry for an address lasts until
  it's removed. An entry for a seat ends with the call: it's deleted when the call ends or that person is taken out of
  it, the pass stops opening it the moment either happens, and maintenance sweeps up any left by a process that stopped.
  Someone who also has it through their account keeps what that gives them.
- **A team's workspace.** Made by someone live-licensed on a team, a workspace is that team's (`workspaces.team_id`), and
  `team_access` says who's in it: `added`, only its members, as any workspace; or `team`, also everyone live-licensed on
  the team, to edit, without a member row. That's worked out with the rest, from the reader's addresses: an address that
  signs in to an account live-licensed on the workspace's team (`identities` joined to `team_members`, `licensedBy`). It
  lasts only as long as the license: a remembered yes ends at `licensed_until`, and someone leaving or taken off the team,
  or the team deleted, moves the team's workspaces on (`version`), so nothing remembered outlasts it. A workspace made in
  a call, and a call's home made for an organizer on a team, is `added`; only its admins open it to the team, and only one
  live-licensed on that team. It's the team's only while whoever pays for it is on the team, since that's how it counts
  against the team's pool: when they leave it, are taken off it or delete their account, the team's workspaces they pay for
  stop being the team's at once (`teams.ts › leftWith`), and one that comes to be paid for by someone off the team, or by
  nobody, does as its payer is settled (`storage.ts › offTeams`). Each stays with its own people, and nobody is in it through
  the team any more. Deleting the team makes its workspaces nobody's team's.
- **A call opens the workspace it uses** to everyone let in to it, guests without an account too, for as long as they're
  in the call: its home, unless the organizer switched to another. A row in `workspace_calls` says so, under the
  `call-workspace` index of the call and the workspace, which is what everyone in the call carries while the call uses that
  workspace. It's written in the workspace's own transaction, with nothing of the call held (`openForCall`): the first time
  anyone opens Workspace in the call, for the workspace it uses (their answer already says it's open, and everyone else is
  told), which is also how a call that began under the release before gets one; when the call goes back to its home
  because the workspace it viewed was deleted; and before the organizer's switch to another workspace applies. A board made
  in the call settles its home without opening it: until someone opens Workspace, the board gives its seats and no more. A
  workspace made in the call gets its row in the transaction that makes it (`openToCall`). Each is
  logged with the call's and the workspace's IDs, and so is a row not written because the organizer can't edit there. A
  row counts only while the call's organizer can still edit there, as an admin or with `edit` (`organizer_index`, their
  email index), because a call adds to a workspace on its organizer's word alone; a new address from their provider moves
  it to the new one ([A new address](#who-can-open-a-workspace)). It counts only while the organizer pays for the
  workspace, too: its payer (`workspaces.payer_owner_id`) is the account the call is kept in. What anyone in a call adds
  to a workspace, or asks AI to do there, is its payer's ([Plans and usage › Storage](plans-and-usage.md#storage)), so a
  call never opens one someone else pays for to everyone in it, guests included: that one opens only for its own people.
  Both are asked on every read (`holdersOf`), so a call stops opening a workspace the moment either stops holding. A switch moves no row: what each person carries names the
  call and the workspace it uses, so the workspace it used closes to everyone who had it only through the call at their
  next request, and the streams they have open there close at once, because that workspace is told the call moved on
  (`callMovedOn`). The rows go when the call ends, when its organizer's account is deleted, and maintenance sweeps up any
  whose call isn't live.
- **What the call gives** is what a member who can edit has, short of anything restricted. Someone it opens a workspace
  to gets the tree as its people see it, folders and the workspace's name, without its head count
  (`WorkspaceTree.inCall`, with `role` null), and every folder, document and board in it that isn't restricted, to open
  and edit. They can make things, rename, move, duplicate, send to Trash and bring back (`requireRole(w, 'change')`),
  work on documents and boards, and add files to them, and a member who can only read can do as much while they're in
  the call. It's no place in the workspace, so it gives no say in who has what: sharing and restricting
  (`requireSharing`, which goes by membership and lasting entries alone), its people and their roles, deleting something
  or a file for good, and renaming or deleting the workspace stay with its people, as their roles allow. Someone the
  call alone opens it to knows it's there, so what's only for its people is refused them (`403`, "Only people in this
  workspace can do that."), not hidden. Restricted documents and boards stay closed to it.
- **A call's home.** A workspace made as a call's home has the organizer as its admin, and as its payer whoever's action
  made it, and the people invited in it, to edit: the same people who get the call's notes. Someone let in from the link who goes on the invite is let in too, and
  taken out again when they're taken off it, as is someone taken off a scheduled call or a series. Only someone the invite
  put there is ever taken out, and only while nobody has changed their place by hand; someone an admin took out, or who
  left, is never put back by the invite. A guest without an account is never put in it: they have what the call opens to
  everyone in it while they're there (above), and anything shared with their seat. A home the organizer chose keeps its own
  people. Making one ready before the call (an agenda, a board, a document for files) makes it as the person asking, who
  has to be able to change it; a note says where its call's home is (`Note.home`) only to a reader who's in that workspace
  now, worked out on each read and never stored.
- **Downloads from a call's page** (the transcript as text, the notes as Markdown, the recording, each shared screen's video)
  are put together in the browser from what the page has already opened, and saved on that device; nothing is sent
  anywhere, and the logs say the note's ID, the kind and how many bytes, never a name or a word of it.
- **Who a document names.** Tags, quotes and follow-up lines name people by an ID the server keys under the workspace's own
  keys, never by an address or a plain hash of one, so reading a document says nothing about anyone's address and a guess
  can't be checked against it offline ([Data and storage › Workspaces](data-and-storage.md#workspaces)).
- **A call's folder** shows its pages only to whoever may read them now, worked out on every read of the tree: while the
  call's on, whoever's in it (their pass is for that call), who read its live pages as anywhere in the call; after it, its
  organizer and whoever has its note by the note's own rows, so taking the note out of your notes, or deleting it, takes
  the pages too. Nothing of the call or the note is in the workspace, so the pages open only through the call or the note,
  which ask again. Everyone else in the workspace sees the folder and what people put in it, as they would any folder.
- **Nothing else opens anything.** Being a call's organizer gives nothing by itself, and joining a call gives only what the
  call opens to everyone in it (above), once they're let in: someone waiting to be let in gets nothing. What a call says of
  its workspace is worked out here on every read, for each person, and nothing about who can open what is copied into it.
  Someone who can open nothing is told that it's private and nothing that names anything: not which workspace, not a
  document, a folder or anyone's whereabouts, which, for the workspace a call uses, happens only once its organizer can't
  edit there any more. That something's being presented, by whom, and which presentation it is (a random key that
  names nothing), is said to everyone in that part of the call, as is how the last one there ended, for its presenter or for
  everyone; what it is only to those who can open it: which workspace to someone something in it opens for, which board to
  someone who can open that board. A refusal to open a board while someone else presents one names nobody. A video playing
  isn't said to anyone who can't open its document. A board
  open in the call is said to everyone in that part of it, and by whom, with nothing that names it for anyone who can't open
  it. What they try reads the same as for something that doesn't exist. Its vote is told only to those who can open it, and
  nothing someone who can't tries says whether one is on; each person is told their own votes and nobody a count until it
  ends; a vote being cast tells nobody else
  ([Calls and recordings › A board's vote](calls-and-recordings.md#a-boards-vote)).
- **A call adds and lets in only as far as the workspace says.** A call opens a workspace to everyone in it, and anyone
  invited can make a board in the call's home, only while its organizer can edit there
  ([Calls and recordings › A board in a call](calls-and-recordings.md#a-board-in-a-call)). Letting everyone into a saved
  board needs the right to share it, asked again for everyone who comes later: whoever here can't edit it gets a seat to
  edit it, and each seat ends with the call. A board the call made goes on being given to whoever comes only until it's
  restricted or the organizer can't edit there. A seat on a board opens it for anyone only while the call's organizer pays
  for its workspace (`payer_owner_id`), as a call opens a workspace only then, asked on every read (`holdersOf`): what anyone
  adds to a board, or asks AI to do on it, is its workspace's payer's. In a workspace someone else pays for, the call seats
  nobody on the boards it makes there and nobody can let everyone in on a saved one, and a seat given there opens only for
  the workspace's own people, its members and a team's licensed people. What the call gives by address there goes only to its
  own people too (`givenByCall`): a board it makes, to those invited who are; one kept as the call ends for someone let in from
  the link, only if they are; a room's board as rooms close, to the organizer and those invited who are.
  A breakout room's board is restricted with nobody as its creator: only the seats of whoever is in that room open it, the
  organizer's only while visiting, and someone moved out loses it at once. When rooms close its seats go and everyone invited
  has it by address; a workspace member who wasn't invited never does, nor do the workspace's admins: nothing strands a room's
  board until its call has kept it for everyone invited. What the call writes on a board it didn't make itself, a frame for
  each room on a board they share or the rooms' boards coming back, it writes only while whoever opened that board can still
  edit it, asked again with the board's workspace held as it's written: otherwise they go on a new board in the call's home,
  and never onto a board only someone outside the call can read
  ([Calls and recordings › Boards in breakout rooms](calls-and-recordings.md#boards-in-breakout-rooms)).
- **What a board links to is named by each reader.** **From your workspace** offers only the board's own workspace, so links
  stay within what the board's readers can reach. A card keeps the item's ID and nothing else,
  so a name on the board never reaches someone who can't open the item: each browser names it from its own tree of the
  board's workspace, read with that person's own access (the call's pass, in a call), and anyone that tree doesn't have it for
  sees "A document you can't open". A picture from **Image** is one of the board's files, uploaded and read through the board
  like a picture of a share. **Download as an image** and **as a PDF** are drawn in the browser from that person's own view of
  the board, every link named as they'd see it and nothing from comments, and saved there: the API never sees one. A comment
  written in a call names its writer by the ID the board's workspace keys their address under, never the address.
- **In Trash**, something stays readable to whoever could open it, and anyone who can edit it can bring it back; nothing
  else can change it until then (`409 conflict`).
- **Through a folder**, nobody reaches further than they could directly: sending a folder to Trash, or deleting it, takes
  only what they could send or delete by itself. Anything they can only read, or can't see, moves out.
- **A new address.** Access follows the address, so when a sign-in brings an account a new one, everything under the old
  hash moves to the new one in that transaction, keeping the stronger role where the new address already had something.
  While another account still signs in with the old address, what's under it stays that account's. What they've written in a
  document stays theirs too: a Yjs client is tagged by their account as well as their address, and its address tag moves to
  the new address in the same transaction, for clients from before the account was counted, so open tabs and words kept
  offline carry on.
- **Working on a document** takes `edit`, and that's settled before anything of an update is read: an update from someone who can only read is `403 forbidden`, and one to something in
  Trash `409 conflict`, each under the workspace's lock, so nothing lands after someone is taken out. Saying where you are in
  a document takes only being able to open it. Versions are for anyone who can open it, and restoring one for anyone who can edit it.
- **Who someone is** to the others comes from the server, never from their browser: a caret carries a keyed hash, their name and
  their connection to a call, and nobody can use another person's caret. Who's where is worked out for each reader:
  [Data and storage › Live traffic](data-and-storage.md#live-traffic). Nobody is told the ID of a document they can't open,
  or of a person outside the workspace who isn't in something with them.
- **Refusals never say what exists.** Someone with no access gets the same `404 not-found` for a real ID and a made-up one:
  a workspace, an item, a person, an entry, wherever it comes in, as a parent or a sibling too. Someone who can see
  something and may not do this to it gets `403 forbidden`. What's only for people in the workspace doesn't exist for
  anyone outside it, whatever they hold in it, except someone a call opens it to, who knows it's there and is refused
  (`403`).
- **Losing access** ends a stream with a `closed` line: every change to who has what reaches every instance
  ([Data and storage › Live traffic](data-and-storage.md#live-traffic)), and each stream looks again. A change that's being
  made is checked under the workspace's lock, so nothing gets in after someone is taken out. What being in a call gives
  ends at once too, though the rows it matched stay for everyone else: someone leaving a call (once no connection of theirs
  is in it) or being taken out of it tells every workspace the call is open to, and every one that gave their seat
  something, that the seat ended (`seatEnded`); the call moving on from a workspace tells that workspace (`callMovedOn`).
  Each is a notice naming the seat's or the call's keyed hash (`look:`), and every stream that carries it works out who
  its reader is again then, not at its next ping: someone it was all they had gets `closed`, a document's says `access`, and
  they leave who's here. The call ending deletes its rows, which tells every workspace it was open to.

### Files

A file in a workspace ([Data and storage › Media](data-and-storage.md#media)) is reached through a document that has it, and
only that way, because what someone can open of a workspace needn't be all of it: a seat covers one document, and a call
opens everything but what's restricted. Whoever can open one of those documents, however they can, reads the file, in
Trash too. Adding one, or reusing one in another document, takes `edit` on that document, and reusing one takes being able
to reach it already: an ID someone remembers or was told opens nothing. Deleting one takes `edit` on a document that has
it, beyond a seat in a call or what a call opens, and on every other document that has it, whether they can open it or
not, and takes it from all of them: reusing a picture doesn't make it theirs to delete, and nobody's file goes from a
document they were never shown. A document they can't open refuses in the same words as one they can only read, so the
refusal names neither. What a workspace keeps and
what each person uploads in a day are limited, the same for everyone: an account's day is counted in `media_upload_days` and a
guest's in `media_guest_upload_days`, under the `upload-guest` blind index of the person their pass names, a number a day
([Data and storage › Media](data-and-storage.md#media)). `list` shows a reader what they can reach, and through which documents, and never a document they can't open.

A picture or a player can't send a header and a guest has no cookie, so reading a file takes a URL with a token in it. The token
is signed, as a call pass is, and lasts 12 hours. It says who's asking (an account's ID, a seat in a call, or both) and what
for (one workspace, document and file), by opaque IDs and nothing else, and it decides nothing:

- **Every request asks again**, each `Range` included: who's asking and whether they can open the document, in
  `features/workspaces/access.ts`, and whether the document still has the file. An answer sends at most 16 MiB, and a read of a
  whole file asks again every four pieces, so a read can't outlast access by much. Someone who lost the document gets the same
  `not-found` on their next request as a URL nobody made, and so does an expired, changed or unsigned token. If they're given
  the document back, the same URL works again.
- **An account counts only with its own session.** The browser's cookie comes with the request, and it has to be that
  account's and live. So a URL is nothing in anyone else's browser, or none, and it stops the moment that session ends.
- **Nothing counts against anyone until they've shown they're who it names,** so a leaked URL can't spend their reads.
- **A seat counts while someone's in it**: the call is going on, whoever has the seat is let in, and they weren't taken out.
  That's what a pass says, read from the call each time, so leaving the call stops the URL even while their `document_access`
  row waits for the call to end. What the call opens counts with the seat, for the workspace the call uses at that request,
  so a file someone reaches only through the call stops reading once they leave or the call moves on to another workspace.
  For a guest the URL is all there is, so within those limits, for 12 hours, anyone who holds it reads that one file. A
  seat is named by what the call already calls it (`CallParticipant.seat`). Nothing of a call pass goes in a URL, and a
  pass reads no file by itself.

Anything off the list of what can be shown in place only downloads, what a file is served as comes from its sealed info and
never the request, and every answer says `nosniff` and `no-store`, with a Content-Security-Policy that lets nothing run if one is
opened by itself, and an `ETag` that's a digest of its sealed info, so it names the file without saying anything about it. Its URL never reaches a log: paths show `/v1/media/:token`, and the [scrubber](logging-and-errors.md#privacy-rules-for-logs)
takes a token out of anything that quotes a file's URL, a browser's report of a picture that failed among them.

### The Drive

`features/workspaces/drive.ts` reads across what someone can open for the Drive's page, and `access.ts` still decides.

- **A card's preview** (`GET /v1/workspaces/:id/previews?items=…`, up to 24 IDs in the query, which no log line holds) is a
  document's first four lines with words, each cut at a word to 120 characters, and how many pictures, videos and which kind
  of file it holds. Only for a document the reader can open now, out of Trash: a board, a folder, something they can't open,
  something in Trash, a made-up ID and another workspace's ID are all left out alike, and a workspace they can't open is
  `404 not-found` as anywhere. It's read in a worker from the document as it is, on the reader's own turn, and if who has
  what changed while it was read it's asked again, so nothing goes to someone who lost it on the way. The answer goes to the
  browser and nowhere else: `no-store`, no receipt (it's a GET), nothing of it in a log line (`previews read` says how many
  were asked and read). A call's pass reads previews as it reads the tree.
- **One Trash** (`GET /v1/trash`, an account only) is what's in Trash in every workspace someone's in or has something in,
  as each tree shows it to them (someone outside a workspace sees only what's shared with them, with no folder), with when
  it goes for good. It names nothing they couldn't open, and restoring is the item's own `restore`, which asks again.

### Brought to a call

`features/workspaces/library.ts` shows what's in workspaces to people with calls, and `features/workspaces/access.ts` still
decides.

- **The library** (`GET /v1/documents`) is what someone can bring: everything they can open with their account, by
  workspace, as each tree shows it to them, without folders or what's in Trash. A workspace with nothing to bring isn't
  listed. Someone outside a workspace who was given something sees that, with no name for the workspace. A seat in a call,
  and what a call opens, add nothing: each ends with the call, and the call being brought to is another one.
- **On a call**, everyone who can read it is told each document's kind and whose it is, by first name, and its name only
  if they can open it, worked out on every read. That's the one thing anyone is told about something they can't open, and
  the organizer is the one telling them: they could reach it when they brought it. It opens nothing, and it's a first name
  and never an address, the same whether its maker is still in the workspace or has deleted their account. Something
  nobody in particular made says nobody's name.
- **What it's called.** The ID a call keeps says which workspace and which item, so only someone who can open it is told
  that. Anyone else is told a name keyed to them and worked out for that call (`closedDocumentKey`, nothing stored): the
  same on every read, but no use for telling whether two people, two calls or two entries mean the same thing or the same
  workspace. An organizer who's lost something they brought sends that name back with the rest of the list, and it means
  what the call keeps on that call alone. Once someone can open it, they're told the real ID.
- **Refusals.** An ID in a request is only ever compared with the organizer's library. It reaches no workspace, so a
  made-up one, a real one they can't open, a folder and something in Trash are all refused alike (`400 invalid`), in the
  same time, and nothing anyone guessed gets onto a call, where it would say whose it is.
- **Losing something.** A document the organizer loses after bringing it stays on the call, with no name for them either,
  until they take it off, and it doesn't stop them changing the call. No request can add it again: not to this call once
  it's off, and not to any other. But what a call keeps is carried on as it stands, without being checked again: the next
  call in a series, the calls a repeat adds, and a change to this and later calls all take the list as it is, so a document
  the organizer has lost can reach later calls in that series. Nobody learns more from that. It's an ID they could reach
  when they brought it, and on every call each person is told only what this section says, read from the workspace at that
  moment, so a name still goes only to someone who can open it. Something in Trash or gone isn't listed for anyone, and
  restored, it's back. A workspace that can't be read leaves its documents off the call and is logged by its ID, and the
  call opens as usual.
- **Guests** reach none of it: a call pass reads no library and no meeting, and a call's card doesn't say what was brought.
  In the call, a guest is told what was brought that they can open, as anyone there is (`CallWorkspace.documents`): what
  isn't restricted in the workspace the call uses, while they're in the call, and what's shared with their seat.

## Requests

- **Origin and content type.** Every state-changing request under `/v1` must carry `Origin: WEB_ORIGIN`
  (`403 forbidden` otherwise) and a JSON or audio body (`400 invalid` otherwise), or for a piece of a shared screen's video WebM or MP4, and
  for a piece of a file bytes (`application/octet-stream`), on those routes alone. This blocks blind cross-site
  POSTs that `SameSite=Strict` would still allow from sibling ports or subdomains. CORS answers only
  `WEB_ORIGIN`, with credentials.
- **Idempotency.** Signed-in mutations carry `x-alcove-operation` (Id128). The receipt stores an HMAC
  commitment of method, path and exact body bytes, plus the JSON response sealed under the operation-result
  key. A retry gets the same response; a different request under the same ID is `409 conflict`. Receipts may
  hold copies of responses, so they are purged after 24 hours and whenever the owner deletes a note or cancels
  a meeting, or a transcript their call didn't keep goes. Note search, asking (about a note, across your notes, a call so far or a series, during a call too), catching up,
  watching a call's live notes, caption translations, reading who's busy, audio pieces and transcript clips keep no receipt: searching, asking,
  translating and reading who's busy only read, watching says nothing but that someone's there, pieces and clips are already idempotent by their place in the
  recording, and their answers carry the live transcript, which shouldn't be copied into receipts. Nor do proposing or changing a note's decisions, open
  questions, follow-ups and transcript lines, saying the notes got a later call wrong, having it written again, or sharing it: anyone who has the note can make them, and each answers with the
  whole note, so a receipt kept under someone it was given to would outlive the organizer deleting it. Each
  sets an explicit state (confirmed, answered, done, these words proposed, these addresses added), so a retry changes nothing anyway.
  Answering a ring keeps none, for the same reason, and because a receipt's clear method and time would say an
  account was rung for a day after the ring had gone.
  Your own notes and what's added to the shared notes keep none either, so nothing you delete or take back stays
  in a receipt for a day; the app doesn't resend them, and doing so can add an entry twice, never lose one. Making,
  revoking and opening a link to notes keep none: making one answers with its secret, and opening one again changes nothing.
  Deleting the account keeps none either: its receipts go with it, and a retry finds the session gone
  (`401 unauthenticated`).
  What's for people in a workspace keeps a receipt, because a retry mustn't make a second workspace, item or copy, and
  every one of those answers is only an ID or a yes: a receipt filed under someone in a workspace outlives whatever it
  was about, so it can't hold a name. A call's answer does hold the names of what was brought to it, so its receipt keeps
  the call without them: a retry gets `documents` empty, and the next read has them. What a guest in a call can reach of a workspace keeps none: renaming an item,
  which happens as a title is typed, restoring one, reading, and everything to do with files. Each sets an explicit state
  or, for a piece of a file, is kept by its place, and a guest has no account to file a receipt under. So a guest's making,
  moving, duplicating and sending something to Trash keep none either, where anyone signed in keeps one: the browser never
  sends one of those twice. Nor does anything about a document's content: an update that arrives twice changes nothing,
  and a receipt would hold a copy of it. Starting an upload
  twice leaves one nobody finishes, which maintenance takes.
- **Rate limits.** Sign-in, demo and Google together: 30 a minute per client address (the last
  `x-forwarded-for` entry, which Cloud Run's front end appends). Browser reports: 60 a minute per client
  address. A call's card: 600 a minute per client address (every pre-join reads it every 4 s or so while it
  waits); joining by link: 120; picking one of the times a call offers: 30. Transcript clips: 240 a minute per account, calls and room recordings together,
  and 40 a minute for each voice in a call.
  Pieces of a shared screen's video: 60 a minute per person in a call, and
  30 a minute for starting and ending shares. Asking for notes in a call: 10 a minute per person. Saying whether others may
  point at what you share: 20 a minute per person. Ticking follow-ups in a call: 60 a minute per person. Saying you're
  watching a call's live notes: 120 a minute per connection to the call, with at most one refresh every 30 seconds for
  each part of the call, however many are watching. Questions and catch-ups (about a note, across your notes, a call so far or a
  series): 20 a minute per account, together (during a call, per connection to it, and asking about earlier calls per
  account); a guest's in a call, which the organizer pays for, 6 a minute each. What carries over into a call: 60 a minute per account. Opening a moment of a call's
  live transcript from a catch-up: 60 a minute per connection to the call. Ringing: 20 a minute per organizer, 30 answers a minute per person, and 30 openings of the stream of rings a minute per account. Changes to a workspace's tree and people: 600 a
  minute per person, opening its stream 120, making a workspace 20 per account, and reading your list of them, the tags
  waiting for you, your library or changing what a call brings 120 together, since each opens every workspace you're in.
  Tagging someone, and saying you've heard: 240 a minute per person. Document
  updates: 1,200 a minute per person, and 64 MiB of them; carets 1,800; saying where you are 600; opening a document's stream
  240; reading a version 60; reading everything you can open for search 12; what documents say at the top, for the Drive's cards, 600 documents. Pieces of a file: 600 a minute per person, and what a file can be, what an account can store and what each person uploads in a day, which change without a deploy ([Deployment › Changing a limit](deployment-and-acceptance.md#changing-a-limit)). Files read: 240 a minute per person, an account or a seat, counting each URL asked for and each piece opened. Moving to another device: 12 new codes a minute per person; opening a link 30 a minute and checking on a move 240 a minute per client address; and for each move, by its secret's hash, 240 checks and 60 changes a minute. Making, revoking and opening links to notes count with changes to notes: 120 a minute per account. Over a
  limit the answer is `503 unavailable` ("Too many attempts"); Google sign-in returns to the welcome screen
  with `signin=busy` instead. The counters live in each API process.
- **Sizes.** An audio piece over 2 MiB, a transcript clip over 30 seconds of WAV, a piece of a shared screen's
  video over 4 MiB or a piece of a file over 4 MiB is refused from its `content-length` (`400 invalid`) before the body is read; a video
  piece must also be WebM or MP4, and a file's piece exactly its own length. A file can be at most what
  its payer's plan allows (`plan.free.file_bytes`, 512 MiB unless it's changed), and never more than 4 GiB. A document update is at most what a
  document can hold, 16 MiB, and a caret 4 KiB. At 150,000 items on its page or 16 MiB, a document takes only what doesn't
  add to the page, and anything but deletes stops at twice that or at 450,000 structs in all. Too much is `413 too-large`,
  and what no honest client sends `400 invalid`: neither lets go of anything a browser holds.
- **No content in URLs.** Note search (its words, and the address of someone whose lines it looks in), people search, sharing and questions send their terms in POST bodies, as adding
  someone to a workspace and sharing a document do their addresses; after that they're a `member_id` or an `access_id`.
  A call's code is in its pages' paths (`/join/<code>`, `/call/<code>`) and in the API paths that read or join
  it (`/v1/calls/<code>/card`, `…/join`, `…/pick`, `…/meeting`), never in a query string or a sign-in URL: signing in with
  Google from a join page keeps the call to come back to in the tab's sessionStorage. Alcove's own logs write
  those paths as `/v1/calls/:code`, and Cloud Run's request logs, which keep raw URLs, are excluded from the
  project's log sink for that reason ([Deployment and acceptance](deployment-and-acceptance.md)). Call passes go
  in a header. A file's token is in the path it's read from (`/v1/media/<token>`), which Alcove's logs write as
  `/v1/media/:token` and Cloud Run's stay out of the same way; it holds opaque IDs and a signature, and [reads nothing by
  itself](#files).
  A move's code travels in a link's fragment, which browsers never send, and then in POST bodies, like the claim
  that replaces it; only their SHA-256 is stored. So does a link to a call's notes: its secret is in the fragment and
  the POST that opens it, and only its SHA-256 is stored. While someone signs in with Google from it, it waits in that
  tab's sessionStorage, for ten minutes at most, never in a URL.
  Logs hold IDs, codes, states, counts and timings: never content, emails, bodies, keys, session IDs, call
  codes, Google event IDs or the Google callback's query. The privacy test checks the debug-level log for canaries, session and
  sign-in attempt cookies, and Google refresh tokens ([Logging and errors](logging-and-errors.md)).

## What leaves the browser

Only requests to Alcove itself: the web app's own origin and the API, with one exception: calls. Nothing
third-party loads.

- **Calls** connect to LiveKit (LiveKit Cloud in production) for their audio, video and screens, which are
  end-to-end encrypted in the browser with keys only the people in the call have: LiveKit forwards frames it
  can't read. It sees each person's address, when they're in which room (by random identity, never a name),
  packet sizes and timing, and who has a camera or screen on ([Calls and recordings › End-to-end
  encryption](calls-and-recordings.md#end-to-end-encryption)). What people share (a screen and its sound) reaches only
  the people in the call: nothing transcribes it, and the API sees only the video a presenter's own browser records of
  a share they put in the notes ([Shared screens](calls-and-recordings.md#shared-screens)).
  Pointers and marks on a shared screen go from browser to browser through LiveKit, sealed with keys from the sender's
  media key: LiveKit sees only that someone sent data, when and how big, and the API never gets them ([Calls and
  recordings › Pointing at shared screens](calls-and-recordings.md#pointing-at-shared-screens)).
  One thing takes a picture of someone else's share: **Put on the board**. Anyone who can edit the board open in the call
  can put a picture of a share on it, from their own browser, whether or not the share is in the notes. It's the frame their
  browser shows, as a JPEG, uploaded to the board's workspace as one of the board's files, sealed like any of them, named by
  its caption, and reached only through the board. The sharer is told over LiveKit on `board-shot/1`, sealed with the call
  data keys like pointers and marks, which names the share by its track ID and nothing else ([Calls and recordings › Put on
  the board](calls-and-recordings.md#put-on-the-board)).

- **Your view of a call** never leaves the browser, and nor does what's on your stage or whom you follow. Layout preferences and how
  the people sit beside what's open stay in `localStorage` for the account, and the arrangement of the call you're in (pins,
  order, sizes, your side, where you are in the workspace) stays in `sessionStorage` until you leave it, naming people by their
  random per-call seat: no names, addresses or call content ([Calls and recordings › The call
  screen](calls-and-recordings.md#the-call-screen)). How you zoom into a share, and the earlier pictures of it you can
  step back through, live only in the page's memory: at most 30 pictures and 16 MiB a share, taken from what the
  browser already decrypts and shows, never written to any storage, sent or logged, and gone when the share stops,
  your part of the call changes or you leave ([Looking closer at a share](calls-and-recordings.md#looking-closer-at-a-share)).
- **Browser notifications** (Settings › Notifications) are made in the tab from what it has already loaded and shown
  by the browser on this device only: no push service, nothing new sent to Alcove. The tab hands them to the app's
  service worker (`public/sw.js`) to put up, which also handles a click; it holds nothing of them but the
  notification itself, which carries where it leads (a call's code or a note's ID). A development build has no
  worker, and the page shows them itself. They can say a call's or note's title, a follow-up and who shared or
  asked, and the device's notification centre keeps them until they're dismissed or someone signs out here. Which ones
  have been shown is [kept on this device](#on-this-device) for the account (`alcove.notified.<ownerId>`,
  `NotifiedStoredSchema`), and anything over a day old goes the next time one shows: for each, a key made of its kind and the IDs it's about (a call's ID and start time, a
  note's ID, a follow-up's note ID, its own ID and its due day, an ask's ID) and when it showed. No titles, names
  or text. The Web Locks that pick the one tab that notifies (`alcove.notify`) and mark a
  note's page as on screen (`alcove.onScreen.<noteId>`) stay inside this browser.
- **Fonts** (Newsreader, Hanken Grotesk, IBM Plex Mono) are served from the app (`packages/ui/src/fonts`, OFL), not a
  font service, so no page load tells anyone else who's visiting.
- **Google profile photos** come through the API: the app gets `/v1/photos/<token>` (`features/account/photos.ts`),
  where the token is the provider URL sealed under a key derived from `KMASTER`. It's stable, so the
  browser caches it, and only this server can read it. The API fetches the image from an allowed host
  (`PHOTO_HOSTS`), keeps it in memory for an hour and serves it only to signed-in browsers. Google sees
  the API fetch a photo, not who looked at whom. Guests in a call aren't signed in, so they're shown
  everyone without photos.
- **The Content-Security-Policy** allows nothing outside the app's origin and the API's (requests, audio,
  photos, files, and the hidden frame a file downloads in), `blob:` for a picture read into the page and for what's played from it, and the LiveKit host for calls (with `*.livekit.cloud`, where LiveKit Cloud's media servers are). Inline scripts run only by the SHA-256 of what the build produced (`apps/web/scripts/csp.mjs`
  writes the policy at deploy), and nothing may `eval` (the contract configures zod not to compile code at
  runtime). `Permissions-Policy` also opts out of the browser's ad-topics API.
- **No analytics.** The app has no analytics, error-tracking or tag scripts. Cloudflare Pages inserts its
  own Web Analytics beacon into pages when that's on for the project. Every page is served with
  `Cache-Control: no-transform` (`apps/web/public/_headers`), which tells Cloudflare's edge not to rewrite
  it, and the CSP blocks the beacon from loading if it's inserted anyway. Keep Web Analytics switched off
  for the project in Cloudflare (Workers & Pages › alcove-web › Metrics).
- **Diagnostics** go to Alcove's own API only (`POST /v1/telemetry`): warnings and errors with codes,
  request IDs, statuses and timings, scrubbed like every other log line ([Logging](logging-and-errors.md)).

## On this device

What the browser keeps so Alcove works without a connection ([Calls and recordings › Recording without a
connection](calls-and-recordings.md#recording-without-a-connection)), and so each notification shows once:

- **That it's signed in** (`localStorage` `alcove.signedIn`, `SignedInHereSchema`): the account's opaque ID, when
  its session ends at the latest, and whether it records without a connection. Never a name, an address or the
  session cookie (which stays `HttpOnly`). It follows the session as the app reads it and goes when the session
  does: signing out, a 401, deleting the account. Offline, it's what lets someone signed in here open Record and
  record; nothing else opens offline. It isn't a credential: every request still needs the session cookie.
- **Room recordings waiting to upload** (IndexedDB `alcove-offline`, `KeptRecordingSchema`, `KeptPieceSchema`,
  `KeptClipSchema`): the name, every audio piece and every speech clip are sealed with AES-GCM under the [device
  key](#key-inventory), a fresh 12-byte IV each, with the item's place (kind, recording, segment and `seq` or start)
  bound in as additional data, so nothing can be read, or moved to another recording, without the key. In the
  clear: random IDs, the account's ID, when it started, lengths, sizes, the codec, whether Alcove has a copy (its
  recording ID), and Alcove's refusal message if it gave one. The key can't be exported, but it sits in the same
  browser profile as what it seals: this protects against reading the files, not against someone using that
  browser profile signed in as the account.
- **Edits waiting to reach Alcove** (IndexedDB `alcove-edits`, `KeptEditSchema`): each Yjs update a document's session
  hasn't had confirmed, sealed with AES-GCM under the [device key](#key-inventory), a fresh 12-byte IV each, with the
  account, workspace, document, order and when it was made bound in as additional data. In the clear: those IDs, the
  order, the time and the size. It's deleted once Alcove has the update, or when someone chooses **Discard** for it, never
  because a document refused it or went; signing out, or deleting the account, on this browser deletes what's kept for
  it, and the key with the last of anyone's.
- **Pictures to show behind your camera** (IndexedDB `alcove-backgrounds`, `KeptBackgroundSchema`): each one you add,
  made into a 1920×1080 JPEG in the browser and sealed with AES-GCM under its own [device key](#key-inventory), a
  fresh 12-byte IV each, with the account, the picture's ID and when it was added bound in. In the clear: those
  IDs, the time and the size. They're never sent: only the camera picture with you in front of one reaches a call,
  end-to-end encrypted like any other. Removing one deletes it; signing out, or deleting the account, on this
  browser deletes all of the account's, and the key with the last of anyone's. Pending preparation, encryption and
  decryption are fenced by opaque account tokens and the database's deletion revision: they cannot save a picture or
  refill its decrypted cache after cleanup, including after another sign-in. The device store retains only opaque
  revision and access markers after deletion. `alcove.account-state.<ownerId>` in localStorage holds revocation and
  activation nonces and a signed-out flag, never picture content; unavailable coordination storage leaves pictures
  closed. A fresh authenticated session can reopen access, while a session response started before revocation cannot.
  Existing JPEG records, keys and their authenticated headers read unchanged; no database version upgrade is needed.
- **Where you were in your workspaces** (`localStorage` `alcove.workspace.<ownerId>`, `WorkspacePlacesSchema`): the IDs of
  the workspace and documents last open, what was opened recently in each, the folders left open, and whether the list is
  hidden. Nothing readable. Signing out, or deleting the account, on this browser deletes it.
- **What Find looks through** is in the tab's memory and nowhere else: the words of what you can open, for this session
  ([In a browser](data-and-storage.md#in-a-browser)). Signing out or in lets go of it, and so does losing what it's from.
  What's typed into Find never leaves the browser.
- **Which notifications have shown** (`localStorage` `alcove.notified.<ownerId>`, `NotifiedStoredSchema`): a key of
  each one's kind and IDs and when it showed, for a day, with no titles, names or text. Signing out, or deleting the
  account, on this browser deletes all of them, and closes the notifications still showing, so no title stays in
  the device's notification centre.
- **That the hour-left toast was said** (`localStorage` `alcove.hour-left.<ownerId>`): the end of the plan's period it was
  said for, so it shows once a period. Nothing else. Signing out, or deleting the account, on this browser deletes it.
- Each recording belongs to the account it was made under: only that account lists or uploads it. Before any
  upload the app asks Alcove who's signed in, and names the recording's account when it starts it there, so the
  server refuses (`403`) a session of any other account and makes nothing: a browser that changed hands never
  uploads one person's recording into another's account, or deletes it.
- **Deleted** after the recording has stopped on Alcove (never before, so an upload cut off part way loses
  nothing), when it's discarded, and when its account signs out or is deleted on this browser (`forgetAccount`):
  only that account's go, and the key goes with the last recording here. Another account's stay, sealed, as do
  recordings of an account whose session simply ended, until that account signs in again here, and upload then.

## What is still visible

| Where | Visible |
| --- | --- |
| Postgres | Opaque IDs; item kinds (`profile`, `meeting`, `note`, `connection`, `series`, so which accounts connected Google, and how many series that repeat an account has, though not which calls are in one: that's sealed in each call); while a change to a series goes through, that one is; revision, call and recording times (a room recording uploaded later shows when it really started); that someone in a call is moving to another device, and when the move runs out; how many links each note has working, and when each runs out; while a call runs, how many people its organizer rang, and for each when the ring started and when it stops: so also that someone said "in a little while" (a ring still to come) or answered at all (a ring that stopped early), and when, though never how, and never who; per-piece start, duration, size and codec; while a note records, how many clips were transcribed and their sizes; while a call runs, which parts of it have live notes, how many views of each, when they were last refreshed, and the size of each; when each share in a call started and ended and whether it went in the notes; the place, length, size and type of each piece and chunk of a kept share's video; how many shared-screen frames a note keeps, and their sizes; each notes job's state, attempts and lease times; which accounts have their own notes on which notes (one row each, so not how many, or of what), and how many additions a note has and when each was made; operation method and time; stored bytes; each session's provider and its created, last-seen and expiry times; when each sign-in identity was last used; when each of an account's agents completed a tool call, and which agent (a row each, for 30 days at most), never which tool or what it was about |
| Keyed hashes | Equal hashes show the same person. Joining `note_access` to `identities` shows which accounts received which notes from which organizers, and whether by invitation or by sharing. For addresses without an account it still shows the same address receiving several notes. `note_additions.author_index` shows which additions are the same person's, across notes and organizers, and `note_links.maker_index` which links are the same person's. It matches no other column, but comparing the notes those additions are on with `note_access` can narrow down who it is. `call_rings` joins to nothing but itself: the same hash in two rows is the same address rung twice, and its rows last as long as the call. `meeting_access` shows how many people are invited to each call that isn't over, whether each has answered (never what), and the same address on several organizers' calls; its hashes have their own purpose, so it can't be joined to `identities` or `note_access` without `KMASTER`. Joining `workspace_members` and `document_access` the same way shows who's in which workspaces and who has how many of a workspace's documents, at what role; `workspace_authors` shows who has had their name on something in one, or made it, even after leaving. `workspace_calls.organizer_index` is an email index too, so it shows whose call a workspace is open to, while the call goes on; its `call_index` matches nothing else. |
| Workspaces | That a workspace exists, how many people and documents it has and when each came, each one's role, that a document is shared and whether with an address or a seat in which call, how often it changes (`version`), when the oldest thing in its Trash went there, and that someone was tagged in a document and when, until they've heard. How many files it has, when each came, how big each is, and which documents share one. Never a name, a folder, how the tree is arranged, or what a file is called or is. `presenter_notes`, which nothing writes now, shows which accounts kept notes on which documents with an earlier release, and so that those accounts could open them: one row each, of a size, and never what they say. `presenter_frame_notes` shows the same for boards, and how many frames of each someone keeps notes beside, never which frames or what they say. Which calls use which workspaces, and what was worked on in them, is sealed in the meeting, the call and the note, except while a call goes on: then `workspace_calls` shows, by the call's ID, each workspace it has opened to everyone in it, and since when, until it ends |
| Documents | When each update was made and roughly how big it was and how many pieces it held, until it compacts, so when a document was being worked on and how hard; how big its state and versions are, how many versions it has and when each was kept; how many Yjs clients have written to it, which is about how many sessions, and how much each wrote, with nothing to link two clients to each other or to anyone. A board started from a template has the server's client for it, 2, with how much the template wrote, so which template it started from, and the row stays if a version from before it takes the board's place. Never a word, a title, a mention or a comment, nor anything on a board. Carets and presence pass through Postgres's notice queue sealed, as notices of a size and at a time, each naming the workspace and, for a caret, the document |
| Plans and money | Which account pays for each workspace (`workspaces.payer_owner_id`), so which account made each shared workspace, or organized a call it's the home of; how many bytes each account stores (`owners.stored_bytes`, and those of the workspaces it pays for); when upkeep next looks at each plan account (`plan_accounts.due_at`: a grace ending, or Pro about to end or ending, so roughly when an account's Pro ends); and that a top-up exists, whose it is, its state and when it's next checked. Never a balance, an allowance, what was spent or on which kind of request, a history, an amount, an address or a quote: those are sealed under `Kservice`'s accounting key, which can't open owner content, and the API process opens them for any account because it holds `KSERVICE` |
| Object store | Object count, sizes and timing: a recording writes about one object every 5 seconds, a share kept for the notes about one every 5 seconds while it's going, then one per 4 MiB of its joined video once the call is over, and a file one for every 4 MiB |
| Uploads | How many bytes each account uploaded to workspaces each day, today and yesterday, and each guest in a call, under a blind index that can't be matched to the call, the seat or a name. A file's row says which workspace it's in, how big it is and when it came, and not who uploaded it, but on a quiet day an account's bytes can be matched to one file's size and time, which shows that account uploaded it. And the service's limits, which are numbers and nothing of anyone's |
| A file's URL | Readable by anyone who sees it, but only opaque IDs: the account or the call, seat and organizer asking, the workspace, document and file, and when it runs out. Alcove keeps it out of its logs, but a browser shows it to whoever opens a file by itself |
| Ciphertext lengths | Not padded, so title, guest list, transcript, clip and own-notes lengths leak approximately. An answer to an invitation is padded: its length would say which of three words it is |
| NEAR AI's models, inside their confidential VMs | Whisper: every transcript clip (the audio) and what was said in it. The model (the default, `deepseek-ai/DeepSeek-V4.1-Flash-1017`, or another private one the organizer or asker chose): what someone selected in a document, when they ask Alcove to shorten it or turn it into a checklist, and nothing else about it; for notes, the full summary written after them (with the notes just written), live notes, questions and catching up, the transcript, the meeting's title, the organizer's name, the invited people's names (or the part of an address before the @), the length, the summary, the question and the asker's name; for live notes and notes, also what people ticked and added to the follow-ups during the call; for captions, the lines asked for and the language; for shares kept for the notes, each frame taken from them (with the frame from five seconds earlier, when what was said was about a change) and the lines said around it and what was read on them for the notes and answers; asking across a series, the same for up to 12 of the calls in it that the asker has notes from, their breakout rooms' too, with their dates (in the asker's time zone), decisions, open questions and follow-ups; comparing a call with earlier ones in its series, what those left standing (the organizer's notes: decisions and open questions), with this call's decisions and transcripts. Each request is sealed with Oblivious HTTP to the key the model's attestation vouches for, at its own endpoint, after the evidence is checked: Intel TDX, a published dstack OS image measured exactly, NVIDIA confidential GPUs, the measured configuration. The model code inside is NEAR AI's choice and isn't pinned ([Notes and inference › Verified private inference](notes-and-inference.md#verified-private-inference)). |
| NEAR AI's gateway, and whoever runs a model it offers outside its enclaves | Only when an organizer (or someone asking) chose an unencrypted model: what that model is sent in place of the row above (the same transcript, summary, question and screen frames, and names), in the clear to NEAR AI's gateway over TLS, with Alcove's API key, and to whatever runs the model. Nothing verifies it, so Alcove can't say who can read it or whether it's kept. The note records that it happened (`unencrypted`) and the choice carries a warning wherever it's made. Speech never goes this way ([Notes and inference › Choosing the model](notes-and-inference.md#choosing-the-model)). |
| NEAR AI's gateway and operators | Alcove's API key on attestation requests, which models are verified when, the size and timing of every sealed request, and the server's address; never the content, the request's parameters or the key inside the seal. A deployment NEAR AI chooses to run in an attested VM on a measured dstack image passes. |
| Intel and NVIDIA | Intel's certification service: which platform (FMSPC) each quote came from, when Alcove verifies. NVIDIA's attestation service: each model's GPU evidence (certificates and measurements). No content. |
| Google | For Google accounts, each sign-in. With the calendar connected, every scheduled call's title, time, guests, join link and whether notes are on, as an ordinary calendar event that Google sends to the guests, and whose availability is asked for when finding a time, by address. |
| Cloudflare | As the web app's host: each page load and file request, with its address, path (such as `/calls/<id>`), time and browser. The API's traffic doesn't pass through it. As the object store (R2): what the object store row shows. |
| LiveKit (Cloud in production) | No media: frames are end-to-end encrypted. Each person's address; room names and identities (random, no names); join and leave times; packet sizes and timing; the audio-level header, so who is speaking when; track kinds and mute state, so who has a camera or screen on; each frame's key index, which travels in the clear (the frame trailer), so whose keys change together: who is in the same part of the call, and who is between two; the size and timing of the sealed data browsers send each other, so roughly when someone points at a shared screen, never where, reacts (`react/1`), never with what, or puts a picture of someone's share on a board (`board-shot/1`), never which; and, from a small packet every 10 s, whose browser can't decode VP9 (`codecs/1`: Safari or iOS before 16) |
| The call's MLS log (`call_mls`) | Sealed MLS messages, while the call runs: how many people asked to join, were added and removed, and how much chat there was, by count and size, for each part of the call (the main room, or a breakout room by its random ID). A room's entries are deleted when it closes, the rest when the call ends |
| The API (calls) | Who's in each call, asking or turned away, and their names, with the addresses of people signed in whom the notes may go to (sealed at rest, opened per request); whom the organizer rang and how each answered (sealed the same way), and, in memory for as long as a tab holds a stream of rings, which accounts are listening, by owner ID and the hash of their address; who sent each chat message, in which part of the call and when, by size; raised hands, who nudged whom and how (sealed, for a minute), each person's status, spotlight, breakout rooms, who's in which and whose browser is each room's scribe; whether pointing at shared screens is on, and who doesn't let others point at what they share (never a pointer or a mark); when notes were turned on, off, paused and resumed, in the call or in one room, and who asked for notes; who shared their screen and when, whether each share went in the notes, and when it ended. What's on a shared screen only in memory, and only for the shares presenters put in the notes from the main room: each piece of video is held to seal it as it arrives, and opened again only to join it into one video after the call, take frames from it for the vision model, and play it to the note's people. It's never kept readable. It vouches for who's invited and decides who goes into which room's group: [Calls and recordings › End-to-end encryption](calls-and-recordings.md#end-to-end-encryption) |
| The API process | Everything, for every account: it holds `KMASTER`. That includes what's in documents, which it opens to send, compact and search, and carets and who's where, which it holds in memory while they're current, as it does what calls show of a workspace's tree (names, and who can open them), kept by the workspace's version until it moves on. It also keeps each account's current Google access token in memory for up to an hour. On Cloud Run, whoever operates the service could read that memory. [In a confidential VM](#moving-to-confidential-computing) the host can't, and the keys go only to builds the app's key policy allows. |

## Deletion

- **Deleting your own note** is refused while its call is live (`409 conflict`: the call is still writing to it, and
  the note page says so). Otherwise it removes, in one transaction: every revision, the recording and its pieces, its
  shared screens (their rows, video and frames, and what was read on them), any transcript clips still there, its notes job, every `note_access` row (so everyone loses it), everyone's own notes on it, everything added to it, the link from
  its meeting, and the owner's operation receipts; stored bytes go down to match. Nobody else holds a receipt
  with the note in it: what others can do to a note keeps none ([Requests](#requests)). Then the audio and
  shared-screen objects are deleted; failures are queued in `object_gc` and retried. Until then every revision stays:
  correcting a transcript line deletes nothing, and what it said before stays in earlier revisions and in the
  line's history ([Notes and inference › What's kept, and for how long](notes-and-inference.md#whats-kept-and-for-how-long)).
- **A call set not to keep its recording** deletes the audio when it ends: the pieces in the transaction that ends
  it, once the note has what was worked out from them, then their objects, with failures queued in `object_gc`. Stored
  bytes go down to match. A piece on its way then is refused, and its object deleted, and the notes worker purges
  again when it finishes the note. The recording's row and key stay, for the shared-screen frames they seal.
- **A call set not to keep its transcript** deletes it once the notes are written, the main room's and every breakout
  room's, in the transaction that writes them first: the new revision has none, every earlier revision of the note goes
  with its key, and so do the owner's receipts. If a part's notes can't be written, its lines stay until they are, in
  the head revision alone, and only the organizer reads them.
- **Removing someone else's note** deletes your own `note_access` row and your own notes on it, in one
  transaction. The organizer and everyone else keep the note, and what you added to the shared notes stays with it
  until the organizer takes it out, or you delete your account.
- **Your own notes** are one record, replaced with each change, so an entry you delete is gone with no earlier version
  left, and the last one takes the row with it. Postgres keeps a replaced row's old version until it's vacuumed, as it
  does for everything else that changes.
- **Taking something back from the shared notes** deletes its row. It's kept out of the note's manifest for this reason:
  a new revision would leave the words in an old one. Your own entry stays yours.
- **Being taken off the invite** when you're removed from a call: at the end of the call, in the transaction that gives
  everyone else the note, the own notes of anyone who didn't end up with it are deleted, found by the keyed hash of
  their address.
- **Closing a breakout room** deletes its entries in the call's MLS log (so its chat's ciphertext). What was said
  in it stays sealed until the call ends, then moves into the note as the room's section, and the live rows are
  deleted with the rest of the call's; deleting the note deletes every room's section with it.
- **Ending a call** deletes its rings, its `meeting_access` rows, so everyone's answers, and its live notes
  (`call_notes`), once what was ticked is in the note, in the transaction that ends it. A ring also goes when its person
  is let into the call and when the organizer stops it. Maintenance deletes any live notes left by a call a release from
  before them ended. Deleting a meeting or an account takes a live call's rows with the call.
- **Cancelling a meeting** deletes it with every revision, its `meeting_access` rows (so everyone's answers) and its
  calls (including chat, and any rings), and the owner's receipts. With a connected calendar, its Google event is
  cancelled too, which tells the guests, and the times it held while it offered them come off, telling nobody. Its notes stay. A live call can't be cancelled. Backing out of a call started
  now cancels it, unless its link was copied, and starting a new one deletes the same way any of the account's that
  nobody joined and that are over a day old.
- **Discarding a room recording** deletes its note in the same way as deleting your own note. What this browser
  kept of it is deleted at once; a copy on Alcove it couldn't reach is deleted once there's a connection.
- **Signing out, or deleting the account, in a browser** deletes everything that browser [kept](#on-this-device)
  for the account, recordings waiting to upload among it, and the device key if no other account has any there. It
  also forgets which notifications have shown there, and closes the ones still showing. Every other tab open there hears
  it at once (`BroadcastChannel` `alcove-account`, carrying the account's ID and whether it was deleted), keeps nothing
  more for the account until it signs in there again, and goes to the welcome page.
  Settings' **Sign out** says first how many of the account's recordings here haven't uploaded, and whether anything
  written here hasn't reached Alcove, which it can copy (only that account's own words, as plain text), and signs out
  only once that's chosen.
- **Deleting your account** (`DELETE /v1/account`) removes, in one transaction: its meetings, with their calls
  (chat, call links, MLS logs, live notes, moves to another device and rings included), live ones too; every note it organized, each the way deleting your
  own note does (shared-screen frames included), so everyone loses it; its `note_access` rows as a reader (found by its profile address's email index), so it's off every
  note other people gave it, unless another account still signs in with that address; what it answered on other
  people's calls, on the same condition (the invites stay: they're those organizers', who put the address on them); the
  rings to its address in other people's calls; its place on a team, and the team it's the admin of, with that team's
  own owner row, members, invites and `team_notes` (the admin of a team anyone else is on is refused first, `409
  conflict`, with nothing done); and its `owners` row,
  from which everything else keyed by the account cascades: its identity (subject and email indexes), every
  session in every browser, its profile (pins and groups with it), its Google connection (the refresh token),
  its receipts, notes jobs, plan account, AI meter, top-ups and what it uploaded each day. Then the API drops the Google access token it held in memory,
  closes the LiveKit rooms of its calls still going (which takes everyone out of them, as ending a call does),
  and deletes the audio and shared-screen objects; failures are queued in `object_gc`, which keeps only the object's ID and
  the deleted account's ID until maintenance deletes it. Only then is Google asked to revoke the refresh token,
  best effort, with 3 seconds of its own, so a slow Google never holds up the objects.
  Before the transaction, every call Upcoming lists that is on Google Calendar is cancelled there, as Cancel
  call does, so its guests are told: one still to come, one whose time has come but hasn't begun, and one
  under way. A meeting the account made in Google Calendar and then moved to Alcove (adopted) is left alone:
  the event is the person's own, so it stays on the calendar as it was, Alcove link and all, and that link
  stops working. The times held for a call still waiting for a guest to pick come off too, telling nobody. The
  cancelling is best effort too, and Google has 10 seconds for it in all: it stops at the
  first timeout or network failure, or when the 10 seconds are up, and a warning counts the calls not
  cancelled and carries the error (no tokens, addresses or content). Then the deletion goes ahead. The shared
  demo account (Art Vandelay) can't be deleted: it answers `forbidden`. Locks are taken calls first, then
  recordings, then the account, the order ending a call or a recording takes them in, so one ending at the same
  moment finishes first or waits; a second deletion at the same moment finds nothing left and ends there,
  even one that reads the account only after the first has committed. That ordering does not cover every overlap: a
  single-note delete, a room recording discard, or cancelling an ended meeting in another tab at the same
  instant as a deletion can still deadlock. Postgres aborts one of the two transactions, and retrying works.
  Nothing is half-deleted, but when the aborted one is the deletion, the guests of its calls may already have
  been told those calls are cancelled, because that happens before the transaction. Treat this whole class as
  rare. Its own notes on anyone's notes go with its `owners` row. Notes it shared on stay with their organizers and
  whoever has them, and those notes still say it shared them: the sharer's name sits sealed in the organizer's note,
  and deleting an account writes into no other vault. What it added to other people's shared notes is its own words, so
  those rows go, in the same transaction: found by `note_additions.author_index`, so opening nobody's keys, and whether
  or not it still has the note or the entry they came from. That runs after the `owners` row goes: taking its own notes
  with it waits for an addition being written, which is then there to delete, and any that gets there later fails on the
  missing account. Signing in again with the same account starts a new one, empty, on Free.
- **Deleting a workspace** deletes its `owners` row, and everything of it goes with that: its state, people, documents,
  what they hold, and who they were shared with. Its files' objects are queued in `object_gc` in the same transaction and
  deleted straight after it. Deleting something from one for good deletes it from the state and its `documents` row, for
  everyone, its updates, snapshot and versions with that row, and any file nothing else has with it: rows, stored bytes and, the
  same way, objects. Text someone deletes from a document stays in the log until it compacts and in the versions that hold it,
  and isn't sent to anyone who opens the document after. Everyone's presenter notes on a document, or beside a board's frames, go with its `documents` row,
  by a foreign key, whichever account they're under.
- **Deleting a file** from a workspace takes it from every document that has it, for everyone: rows and stored bytes in one
  transaction, and its objects as above. It's refused for someone who can't edit every one of those documents, whether they
  can open it or not, in words that name none of them, and for someone who can edit the document only through a seat in a
  call, or what a call opens. Taking its block out of a document deletes nothing: a version may still show it.
- **Deleting your account** takes its presenter notes with its `owners` row, and also reaches every workspace its
  address still appears in, including ones it left: it comes out of them and off every document given to its address,
  unless another account still signs in with that address, and everything its calls gave people's seats ends. What its
  calls opened to everyone in them opens nothing from then on, as there's no call left to be in, and maintenance deletes
  those rows. A workspace left with nobody in it is deleted, even if people outside it have documents from it. One left
  with no admin makes its longest-standing person its admin. A restricted document only the account could open goes, in
  Trash or not, with any file nothing else has; anything else left with nobody to open it goes to Trash; and what it
  made keeps its name and loses its address, so signing in again with that address brings none of it back. Every row is
  touched under its workspace's lock, the order every change takes, workspace by workspace in order of owner and after
  the account's, so it can't deadlock with a change, or with someone else leaving at the same moment. Files that go are
  queued in `object_gc` in the transaction, and deleted before Google is asked to revoke anything.
- **Series** that follow on from each other have no record of their own: a series is the ID its calls share inside
  their sealed manifests (with Google's ID for a recurring event), so it goes when its calls do. One scheduled to
  repeat has a sealed `series` item, deleted with its link in the transaction that deletes its last call, however
  that call goes, and with the account. Its recurring event goes from Google then too, once, so everyone hears once.
  Deleting an account withdraws the events of every series with a call still to come; what's only in the past stays
  there, as a call that's been held does. What carries over is never stored, so a deleted or removed note leaves
  every series at once, with nothing derived from it left behind. What a later call came back to is kept in that call's
  sealed note, as random IDs and a moment: it says nothing of what the earlier call said, it's deleted with the later
  note, and once the earlier note has gone it's never shown.
- **Google access** stays in the account's `connection` item until it's disconnected or the account is deleted.
  Either way Alcove asks Google to revoke the grant, best effort, so the refresh token stops working there too.
  Withdrawing Alcove's access at Google removes the refresh token the next time Alcove tries to use it.
- **Moves to other devices** run out within minutes and upkeep deletes them; a call's go when it ends.
- **Links to a call's notes** go when they're revoked, once they've run out (upkeep), with the note (by a foreign key),
  and when their maker removes the note from theirs or deletes their account, in that transaction, found by
  `note_links.maker_index` with nobody's keys opened. Whoever a link gave the notes to keeps them, as with sharing by
  address.
- **Maintenance** (every 5 minutes) removes ended sessions and receipts older than 24 hours, retries
  `object_gc`, removes objects older than 24 hours that no recording piece, piece or chunk of shared-screen video, frame or piece of a file
  references, removes rings a day after they ran out, in a call that went on that long, deletes for good what's been in
  a workspace's Trash for 30 days, ends seats, and what calls opened to everyone in them, whose call is over, removes live
  notes of calls that have ended, and takes away what an upload left when its browser went, a day on.

## Moving to confidential computing

On Cloud Run, `KMASTER` and `KSERVICE` come from Secret Manager, so whoever operates the service, Google
Cloud included, could open any account. The API is built to move into a confidential VM (Intel TDX under
Phala's [dstack](https://github.com/Dstack-TEE/dstack)) without changing anything it stores. Postgres and
the object store stay outside: they hold only sealed records, opaque IDs and timing
([What is still visible](#what-is-still-visible)). The keys, and every plaintext, would exist only in the VM.
Calls' media never reaches the VM at all: it's end-to-end encrypted between the browsers in the call.

What's in the code (`apps/api/src/tee.ts`, `apps/api/src/config.ts`):

- **Keys from the TEE.** With `TEE=dstack`, both keys come from dstack's key service through the guest
  agent's Unix socket (`DSTACK_SOCKET`, by default `/var/run/dstack.sock`; never a network address, so
  they can't come from outside the VM): `GetKey` for the paths
  `alcove/kmaster/v1` and `alcove/kservice/v1`. The key service derives them from the app's identity and
  gives them only to a VM whose measured OS and compose the app's key policy allows, so they never exist
  in an environment variable, a secret manager or the deploy pipeline. The API refuses to start inside a
  TEE with keys in its environment, because whoever set them would hold them too. `TEE=none`, the
  default, takes both from the environment, as today.
- **Attestation.** `GET /v1/attestation?nonce=<64 hex characters>` says what's running, to anyone, without
  signing in (30 requests a minute per address). Outside a TEE it says so: `{ tee: 'none', nonce, build }`.
  Inside one it returns a fresh TDX quote whose report data is
  `SHA-512("alcove-attestation/v1\n" + nonce + "\n" + commit)`, the event log for replaying the VM's
  runtime measurements, and the dstack app ID, instance ID, compose hash and OS image hash. The nonce
  stops a recorded quote being replayed; the commit stops one build's quote vouching for another.
- **A build that names its commit.** The deploy builds the image with `ALCOVE_COMMIT`, which `/health` and
  the attestation report. Base images are pinned by digest and the install is frozen, so a commit always
  builds from the same inputs, and the image a VM runs traces back to one commit.
- **Keyless migrations.** The migration job gets only `DATABASE_URL` (`migrate-cli.ts` reads nothing else):
  migrations shape tables and never open records, so nothing outside the API needs the keys.
- **Logs that can leave.** Log lines carry IDs, codes, states, counts and timings, never content, and a
  scrubber removes addresses and credentials from every string ([Logging](logging-and-errors.md)), so the
  log stream can go from the VM to a collector.

How a client checks the server (the app doesn't do this yet):

1. Make 32 random bytes and ask for `/v1/attestation?nonce=<hex>`.
2. Verify the quote: its signature chain to Intel, its TCB status (for example with `dcap-qvl`), and that
   its report data is `SHA-512("alcove-attestation/v1\n" + nonce + "\n" + commit)`.
3. Replay the event log: it must reproduce the quote's RTMR3, and its `compose-hash` event must match the
   compose hash returned, which is the published compose hashed as dstack does it (`getComposeHash` in
   `@phala/dstack-sdk`). That compose must run the image built from `commit`, named by digest.
4. Only then send anything, to the code at that commit.

Moving, in order:

1. **A dstack compose for the API**: the image by digest, `TEE=dstack`, the guest agent's socket mounted,
   and the other secrets (`DATABASE_URL`, the object store's credentials, `NEAR_AI_API_KEY`, the Google
   client, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`) as dstack's encrypted environment variables, which only the VM can decrypt, with `allowed_envs`
   naming exactly those. Encrypted variables aren't measured, so `TEE`, `DSTACK_SOCKET` and
   `ALCOVE_COMMIT` must come only from the measured compose and image, never from `allowed_envs`. Keep the
   VM's logs private (`public_logs: false`) and forward the JSON log stream to the collector.
2. **Deploy to Phala Cloud** with a key policy that allows only reviewed compose hashes. Each release then
   changes the allowed hash explicitly, where anyone can see it.
3. **Reset storage.** Keys from the TEE differ from today's, so nothing sealed under the old `KMASTER`
   opens: reset the database and object store, and delete `alcove-kmaster` and `alcove-kservice` from
   Secret Manager.
4. **Bind the connection.** Terminate TLS inside the VM (dstack's gateway passing TLS through, with a key
   from `GetTlsKey`) and add the certificate's hash to the report data. Until then an attestation shows
   what runs, not that your connection reaches it.
5. **Check it in the client** before signing in or sending audio, and pin the client itself (published build
   hashes, or a signed shell or extension), because the web app's code comes from a server.
6. **Private inference** is verified: NEAR AI gets content only sealed to the keys of models whose evidence
   checked out ([Notes and inference › Verified private inference](notes-and-inference.md#verified-private-inference)).
   The model code those VMs run isn't pinned yet.

## Divergences from the original spec, and decisions

| Original spec | Now | Decision |
| --- | --- | --- |
| A native Ed25519 owner key on one desktop proves who the owner is | Sign-in with Google (OpenID Connect); Microsoft and SSO are demo stand-ins; a random `ownerId` | Spec updated (this page). Real Microsoft and SSO sign-in are required before production. |
| `Kowner` kept natively, never stored server-side | Made by the server, stored wrapped under `KMASTER`, opened for each request | Accepted only with `KMASTER` released solely to the attested VM |
| Attestation + HPKE channel with sequenced frames | Plain REST over TLS with a cookie session. Inside a TEE, `/v1/attestation` returns a TDX quote binding a nonce and the build; nothing binds it to the connection yet, and the app doesn't check it | **Required before production** ([steps](#moving-to-confidential-computing)) |
| Strict JSON (reject duplicate keys and unknown fields), U64 decimal strings | zod parsing (drops unknown fields), JS numbers for money (micro-USD) and sizes | To do |
| Service-side wrap of `Krec` with 24-hour / 7-day disposal | Any work, including someone else's read and the notes worker, opens the owner's keys through `KMASTER`; no separate wrap or disposal window | Accepted with `KMASTER` custody |
| Protected inference: end-to-end encrypted requests to `I01`, with its attestation checked | Each model's evidence is checked first (Intel TDX quote and collateral, a published dstack OS image by MRTD and RTMR0–2, report data with a fresh nonce, RTMR3 and the measured compose, NVIDIA GPU verdict, the OHTTP key's signature). Every request, speech and chat, goes by Oblivious HTTP sealed to the model's attested key at its own endpoint: NEAR AI's E2EE chat doesn't bind its fields to the client's key, so whoever terminates TLS could replay them, and doesn't cover speech. The one plaintext way is a model chosen on purpose that NEAR AI doesn't run in an enclave: it's reached through the gateway over TLS, shown as "Unencrypted" wherever it's picked, and recorded on the note. Speech has none | Done for what the evidence shows. The model code NEAR AI's compose manager starts isn't pinned, the GPU evidence and model name aren't bound to the VM, and the endpoints are ones NEAR AI calls experimental ([What's left](notes-and-inference.md#whats-left)) |
| Encrypted manifest binding all chunks; rollback detection | Not implemented: a database writer could roll a head back or drop trailing pieces | To do (version-bound associated data and an encrypted piece list) |
| Plan accounts, AI meters and top-ups keyed by a random account ID plus `owner_tag` | Keyed by `owner_id` | To do before payments |
| Guests (#17): joining a call grants no notes, and a shareable link alone is not authorization to read owner content | Notes can be shared by a link (#259), which reads nothing by itself: opened by a signed-in account the notes may go to, it gives that account the notes as shared by its maker, listed in who has them, for seven days or until revoked. No URL reads a note | The product owner chose this over a public link anyone could read (which would need an unauthenticated way to open the organizer's keys) and over notes for guests only through the call's own sign-in |
| Provider secrets never in environment variables | Outside a TEE, `KMASTER`, `KSERVICE`, the NEAR AI key and the Google client secret are environment variables (Secret Manager on Cloud Run). With `TEE=dstack` both keys come only from the TEE's key service and are refused from the environment | Accepted locally. In production `KMASTER` comes only from the attested VM's key release, and provider secrets are dstack encrypted environment variables. |

## Production requirements

1. **Attested confidential compute that alone can use `KMASTER`.** Run the API in a confidential VM and release
   `KMASTER` only to that VM after attestation (a key-release policy bound to the measured image), so no
   operator, host or deploy pipeline can read it. The client verifies attestation before sending anything,
   over an HPKE-style channel bound to it. Because a web app's code comes from the server, also pin the
   client: a signed native shell or extension, or published build hashes with a strict CSP. The API side
   is ready ([Moving to confidential computing](#moving-to-confidential-computing)): keys from dstack's key
   service, attestation with a nonce, a build that names its commit. Left: deploying it, binding TLS to
   the quote, and checking it in the client.
2. **Real sign-in for every provider.** Google is done. Microsoft OAuth and OIDC SSO must return a verified
   subject and email, and `demo.ts` must go, because access to notes follows the email.
3. **Verified private inference.** Speech and transcripts go to NEAR AI only sealed (Oblivious HTTP) to the
   keys of models whose attestation checked out, on published dstack OS images measured exactly, with no
   plaintext fallback. Left: pinning the model code NEAR AI's compose manager starts to builds with published
   provenance, binding the GPU evidence and the model's name to the VM, and endpoints NEAR AI supports as more
   than experimental ([Notes and inference › What's left](notes-and-inference.md#whats-left)).
4. **End-to-end encrypted call media.** Done ([Calls and recordings › End-to-end
   encryption](calls-and-recordings.md#end-to-end-encryption)): MLS keys made in browsers, frames encrypted
   before they reach an SFU that holds no keys, new keys with every join and leave. While notes are on,
   the host's browser sends what it hears in the main room to the notes service, outside the media encryption:
   everyone's speech as clips to transcribe, and the recording, which mixes their voices; each breakout room's scribe
   sends its room's speech as clips (left: an attested notes participant, so no browser sends audio in the clear to
   the API).
5. **Key rotation:** `KMASTER` (re-wrapping every root envelope and recomputing every blind index, which needs
   the subjects and emails the indexes hide), `Kowner` on suspected compromise, and `Kservice`; use
   `keyVersion`.
6. **Deletion guarantees:** expiry windows across backups. Deleting a note, a meeting or an account removes it
   from the live database and object store only.
7. **Hygiene:** strict parsing, logs without content, rate limits at the edge.
