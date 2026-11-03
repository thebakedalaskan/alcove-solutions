# Privacy, keys and sessions

[Docs home](../README.md) · [System architecture](system-architecture.md) · [Data and storage](data-and-storage.md) · [Deployment and acceptance](deployment-and-acceptance.md)

**Goal.** Readable content (names, emails, titles, guests, chat, audio, notes) exists only in the browsers
of the people it belongs to and inside the API process while it works on it. The database, object store,
logs and network edge see ciphertext, opaque IDs, keyed hashes, sizes and timing.

**Trust model.** The API process is the trusted plaintext endpoint (`C01`). It holds the master key
`KMASTER`, which opens every account's root key, so it can open any account at any time without that person
being present. That is how invited people read an organizer's notes, and how background work will run. It
also means that whoever runs the process, or can read `KMASTER`, can read everything. "Alcove can't read
your notes" holds only when `KMASTER` is released to nothing but an attested confidential VM running the
expected server image. That is a production requirement, not the current state: locally `KMASTER` is a value
in `.env` read by an ordinary Node process ([Production requirements](#production-requirements)). Inside the
process, modules are not a security boundary: any code can reach `cfg.KMASTER`.

**Sign-in is a stand-in.** Until Google, Microsoft and OIDC single sign-on are connected,
`apps/api/src/demo.ts` decides who someone is: Google and Microsoft always sign in Art Vandelay, and SSO
signs in whoever's work email is typed. Nothing is verified, so anyone can sign in as any address and read
whatever that account can, including notes shared with it. Don't use a build with demo sign-in for real data.

## Key inventory

| Key | How it's made | Where it lives |
| --- | --- | --- |
| `KMASTER` | 32 random bytes, base64url (43 characters), from the environment | `.env` locally; in production, released only to the attested confidential VM. Wraps every root key and keys the blind indexes. |
| `ownerId` | 32 random bytes, base64url (43 characters), made when the account is created | Clear, as the account's opaque ID |
| `Kowner` (account root) | 32 random bytes, made when the account is created | Only wrapped: `owners.root_envelope`, a key envelope (scope `owner-root`) under `HKDF(KMASTER, salt=ownerId, "alcove/owner-root/v1")`. Opened for each request, never cached. |
| Root check | `HMAC(HKDF(Kowner, salt=ownerId, "alcove/root-check/v1"), ownerId)` | `owners.root_check`; proves an opened root is this account's, so a wrong key never opens an empty vault |
| `Kwrap` | `HKDF(Kowner, salt=ownerId, "alcove/owner-wrap/v1")` | Derived per request; wraps revision and recording keys |
| `Krecord` | 32 random bytes per item revision | `revisions.key_envelope`, wrapped under `Kwrap` with scope `revision:<id>` |
| `Krec` | 32 random bytes per recording | `recordings.key_envelope`, wrapped under `Kwrap` with scope `recording:<id>` |
| State keys | `HKDF(Kowner, salt=ownerId, "alcove/state/v1/<scope>")`, scopes `call:<id>` (call state) and `job:<noteId>` (notes jobs) | Derived per request |
| Operation keys | `HKDF(Kowner, salt=ownerId, "alcove/operation-commit/v1")` and `"…/operation-result/v1"` | Derived per request |
| Index key | `HKDF(KMASTER, "alcove/index/v1")` | Derived per use; keys the [blind indexes](#blind-indexes) |
| `Kservice` | 32 bytes from `KSERVICE` | Derives the billing key `HKDF(Kservice, "alcove/service/accounting/v1")`; cannot open owner content |

All derivations are HKDF-SHA-256 with 32-byte outputs. `salt=ownerId` means the ID's 32 decoded bytes; the
index and billing keys use an empty salt.

## Records and envelopes

A **record** is `{header, nonce, ciphertext}`: XChaCha20-Poly1305, a random 24-byte nonce, associated data
`JCS(header)`. Every header carries `v`, `kind` and `ownerId` plus the record's exact location, and opening a
record recomputes the expected header, so a record copied to another row, owner or object fails to open.

| Kind | Sealed under | Header binds |
| --- | --- | --- |
| `manifest` | `Krecord` | item, revision |
| `audio` | `Krec` | recording, segment, seq, object |
| `call-state` | state key `call:<id>` | call |
| `job` | state key `job:<noteId>` | note |
| `operation-result` | operation-result key | operation |
| `billing` | billing key | owner |

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
| `subject` | The sign-in provider's account ID | `identities.subject_index` (primary key) | Finding the account at sign-in |
| `email` | The email address, trimmed and lower-cased | `identities.email_index`, `note_access.email_index` | Whether an address is on Alcove (people search, team directory); who else may read a note |

The hash is deterministic, so equal values show the same person across rows and accounts (see
[What is still visible](#what-is-still-visible)), and anyone holding `KMASTER` can test a guessed address.

## Accounts and sign-in

1. **Sign in.** `POST /v1/auth/sign-in` with `{provider, email?}`, where `provider` is `google`, `microsoft`
   or `sso`; at most 30 attempts a minute per client address. Today `demo.ts` turns the request into an
   identity (subject, email, name, photo URL). Real OAuth and OIDC will supply a verified one.
2. **The first sign-in with a subject creates the account**, in one transaction serialised on the subject
   index: the `owners` row with a fresh `ownerId`, `Kowner`, root envelope and root check; the `identities`
   row; the sealed profile (name, email, photo URL, notes default `on`); and the billing account with 10,000
   welcome credits. Later sign-ins with the same subject open the same account. After every sign-in a session
   opens and, when nothing is upcoming, the demo calendar is placed: five sealed meetings, the first about 12
   minutes later.
3. **Every request opens the account's keys** (`openOwner` in `apps/api/src/owners.ts`): it reads
   `root_envelope` and `root_check`, unwraps `Kowner` under `KMASTER`, checks the root check (`IntegrityError`
   on a mismatch) and derives `Kwrap`. The request works on its own copies (`Owner.root`, `Owner.wrapKey`).
   Nothing is cached between requests. Reading someone else's note opens their account the same way, after
   the access check.

## Sessions

- **Cookie.** `alcove_session`, or `__Host-alcove_session` when `WEB_ORIGIN` is HTTPS: HttpOnly,
  `SameSite=Strict`, path `/`, `Secure` over HTTPS, max-age 30 days. The value is a random 32-byte ID in
  base64url (43 characters), and the browser holds the only copy.
- **Stored as a hash.** The `sessions` table keeps the ID's SHA-256, the owner, the provider, and when the
  session was created, last seen and expires. A copy of the database can't be turned into a working cookie.
- **Limits.** A session ends after 14 days unused or 30 days in all. Last seen is refreshed at most once a
  minute. An ended session is deleted when its cookie is next presented, and maintenance sweeps the rest every
  5 minutes.
- **Several per account.** Each browser has its own session; signing out (`POST /v1/session/sign-out`)
  deletes only that one. Sessions live in Postgres, so they survive restarts and work on any API instance.
- **Refusals.** No cookie, or an unknown or ended one: `401 unauthenticated` (a stale cookie is also
  cleared), and the app goes back to the welcome screen.
- **Never logged.** Session IDs are bearer secrets; logs identify a session by its `ownerId`.

## Who can read a note

A note lives in its organizer's vault, sealed under their keys. `note_access` lists who else may read it,
one row per person: `(owner_id, note_item_id, email_index, role)`.

- **Invited.** When a call with notes ends, every address invited to the call gets a row with role `invited`.
  Until then nobody invited can find the note.
- **Shared.** Anyone who can read a note can share it on by email once the call has ended or the room
  recording has stopped (`POST /v1/notes/:id/share`). Each new address gets a row with role `shared` and joins
  the note's sealed `shared` list; addresses that already have the note are skipped.
- **The check.** `locate` in `apps/api/src/modules/notes.ts` looks in the caller's own vault first. Otherwise it
  needs a `note_access` row for that note and the caller's email index, taken from their profile email; only
  then does it open the organizer's keys and read the note. The note, its audio, its progress stream, its
  follow-ups and sharing all go through this check. Anyone else gets `404 not-found`, the same answer as for a
  note that doesn't exist.
- **Follow-ups** are one list for everyone who has the note: ticking one writes a new revision in the
  organizer's vault.
- **Removing.** Deleting your own note deletes it for everyone ([Deletion](#deletion)). Removing someone
  else's note deletes only your own `note_access` row.

Access follows the email address, so it is only as strong as sign-in: whoever signs in with an address can
read every note given to it.

## Requests

- **Origin and content type.** Every state-changing request under `/v1` must carry `Origin: WEB_ORIGIN`
  (`403 forbidden` otherwise) and a JSON or audio body (`400 invalid` otherwise). This blocks blind cross-site
  POSTs that `SameSite=Strict` would still allow from sibling ports or subdomains. CORS answers only
  `WEB_ORIGIN`, with credentials.
- **Idempotency.** Signed-in mutations carry `x-alcove-operation` (Id128). The receipt stores an HMAC
  commitment of method, path and exact body bytes, plus the JSON response sealed under the operation-result
  key. A retry gets the same response; a different request under the same ID is `409 conflict`. Receipts may
  hold copies of responses, so they are purged after 24 hours and whenever the owner deletes a note or cancels
  a meeting.
- **Rate limits.** Sign-in: 30 a minute per client address (the first `x-forwarded-for` entry). Browser
  reports: 60 a minute. The counters live in each API process.
- **No content in URLs.** Note search, people search and sharing send their terms in POST bodies. Logs hold
  IDs, codes, states, counts and timings: never content, emails, bodies, keys, session IDs or call codes. The
  privacy test checks the debug-level log for canaries and session cookies
  ([Logging and errors](logging-and-errors.md)).

## What is still visible

| Where | Visible |
| --- | --- |
| Postgres | Opaque IDs; item kinds (`profile`, `meeting`, `note`); revision, call and recording times; per-piece duration, size and codec; operation method and time; stored bytes; each session's provider and its created, last-seen and expiry times; when each sign-in identity was last used |
| Keyed hashes | Equal hashes show the same person. Joining `note_access` to `identities` shows which accounts received which notes from which organizers, and whether by invitation or by sharing. For addresses without an account it still shows the same address receiving several notes. |
| Object store | Object count, sizes and timing: a recording writes about one object every 5 seconds |
| Ciphertext lengths | Not padded, so title, guest list and transcript lengths leak approximately |
| The API process | Everything, for every account: it holds `KMASTER` |

## Deletion

- **Deleting your own note** removes, in one transaction: every revision, the recording and its pieces, its
  notes job, every `note_access` row (so everyone loses it), the link from its meeting, and the owner's
  operation receipts; stored bytes go down to match. Then the audio objects are deleted; failures are queued in
  `object_gc` and retried.
- **Removing someone else's note** deletes only your own `note_access` row. The organizer and everyone else
  keep it.
- **Cancelling a meeting** deletes it with every revision and its calls (including chat), and the owner's
  receipts. Its notes stay. A live call can't be cancelled.
- **Discarding a room recording** deletes its note in the same way as deleting your own note.
- **Maintenance** (every 5 minutes) removes ended sessions and receipts older than 24 hours, retries
  `object_gc`, and removes objects older than 24 hours that no recording piece references.

## Divergences from the original spec, and decisions

| Original spec | Now | Decision |
| --- | --- | --- |
| A native Ed25519 owner key on one desktop proves who the owner is | Sign-in with Google, Microsoft or OIDC SSO (demo stand-ins today); a random `ownerId` | Spec updated (this page). Real sign-in is required before production. |
| `Kowner` kept natively, never stored server-side | Made by the server, stored wrapped under `KMASTER`, opened for each request | Accepted only with `KMASTER` released solely to the attested VM |
| Attestation + HPKE channel with sequenced frames | Plain REST over TLS with a cookie session | **Required before production** |
| Strict JSON (reject duplicate keys and unknown fields), U64 decimal strings | zod parsing (drops unknown fields), JS numbers for credits | To do |
| Service-side wrap of `Krec` with 24-hour / 7-day disposal | Any work, including someone else's read and the future notes worker, opens the owner's keys through `KMASTER`; no separate wrap or disposal window | Accepted with `KMASTER` custody |
| Encrypted manifest binding all chunks; rollback detection | Not implemented: a database writer could roll a head back or drop trailing pieces | To do (version-bound associated data and an encrypted piece list) |
| Billing keyed by a random account ID plus `owner_tag` | Keyed by `owner_id` | To do before payments |
| Provider secrets never in environment variables | `KMASTER`, `KSERVICE` and the NEAR AI key are environment variables | Accepted locally. In production `KMASTER` comes only from the attested VM's key release. |

## Production requirements

1. **Attested confidential compute that alone can use `KMASTER`.** Run the API in a confidential VM and release
   `KMASTER` only to that VM after attestation (a key-release policy bound to the measured image), so no
   operator, host or deploy pipeline can read it. The client verifies attestation before sending anything,
   over an HPKE-style channel bound to it. Because a web app's code comes from the server, also pin the
   client: a signed native shell or extension, or published build hashes with a strict CSP.
2. **Real sign-in.** Google and Microsoft OAuth and OIDC SSO that return a verified subject and email,
   replacing `demo.ts`. Access to notes follows the verified email.
3. **End-to-end encrypted call media** once calls are multi-party, following Proton Meet's open-source model:
   - Client-generated group keys (MLS-style), never created by the server.
   - Per-frame encryption (SFrame / WebRTC encoded transforms) through an SFU that holds no keys.
   - Key rotation when people join or leave.
   - The notes service joins as an attested participant, only while notes are on.
4. **Key rotation:** `KMASTER` (re-wrapping every root envelope and recomputing every blind index, which needs
   the subjects and emails the indexes hide), `Kowner` on suspected compromise, and `Kservice`; use
   `keyVersion`.
5. **Deletion guarantees:** account deletion (not built yet) and expiry windows across backups.
6. **Hygiene:** strict parsing, logs without content, rate limits at the edge.
