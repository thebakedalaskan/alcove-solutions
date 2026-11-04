# Privacy, keys and sessions

[Docs home](../README.md) · [System architecture](system-architecture.md) · [Data and storage](data-and-storage.md) · [Deployment and acceptance](deployment-and-acceptance.md)

**Goal.** Readable content (names, emails, titles, guests, chat, audio, transcripts, shared-screen frames,
notes) exists only in
the browsers of the people it belongs to and inside the API process while it works on it. The database,
object store, logs and network edge see ciphertext, opaque IDs, keyed hashes, sizes and timing. NEAR AI
Cloud transcribes speech and writes notes, but only in confidential VMs whose hardware evidence Alcove checks
first, with everything sealed to the key that evidence vouches for
([Notes and inference › Verified private inference](notes-and-inference.md#verified-private-inference)).
One outside service is handed content as it is: Google Calendar carries the calls an organizer schedules
([What is still visible](#what-is-still-visible)).

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
| `ownerId` | 32 random bytes, base64url (43 characters), made when the account is created | Clear, as the account's opaque ID |
| `Kowner` (account root) | 32 random bytes, made when the account is created | Only wrapped: `owners.root_envelope`, a key envelope (scope `owner-root`) under `HKDF(KMASTER, salt=ownerId, "alcove/owner-root/v1")`. Opened for each request or notes job, never cached. |
| Root check | `HMAC(HKDF(Kowner, salt=ownerId, "alcove/root-check/v1"), ownerId)` | `owners.root_check`; proves an opened root is this account's, so a wrong key never opens an empty vault |
| `Kwrap` | `HKDF(Kowner, salt=ownerId, "alcove/owner-wrap/v1")` | Derived per request; wraps revision and recording keys |
| `Krecord` | 32 random bytes per item revision | `revisions.key_envelope`, wrapped under `Kwrap` with scope `revision:<id>` |
| `Krec` | 32 random bytes per recording | `recordings.key_envelope`, wrapped under `Kwrap` with scope `recording:<id>`; seals the recording's audio pieces and its shared-screen frames |
| State keys | `HKDF(Kowner, salt=ownerId, "alcove/state/v1/<scope>")`, scopes `call:<id>` (call state), `call-mls:<id>` (the call's MLS log, sealed again), `call-seat:<id>` (each person's seat in the call, a MAC of their random per-call `person`, never stored), `job:<noteId>` (notes jobs), `transcript:<noteId>` (live transcript clips and caption translations, and the keyed tags that find them) and `screen:<noteId>` (what's known about each shared-screen frame, and the keyed tags that find them) | Derived per request, or per job in the notes worker |
| Operation keys | `HKDF(Kowner, salt=ownerId, "alcove/operation-commit/v1")` and `"…/operation-result/v1"` | Derived per request |
| Index key | `HKDF(KMASTER, "alcove/index/v1")` | Derived per use; keys the [blind indexes](#blind-indexes) |
| Sign-in attempt key | `HKDF(KMASTER, "alcove/sign-in-attempt/v1")` | Derived per use; seals the [Google sign-in attempt](#google-sign-in-and-calendar-access) a browser carries to Google and back |
| `Kservice` | 32 bytes from `KSERVICE` | Derives the billing key `HKDF(Kservice, "alcove/service/accounting/v1")`; cannot open owner content |
| Call MLS keys | Made in each browser in a call (an MLS key package and its private keys for each group it joins, then that group's secrets: one group for the main room and, while breakout rooms are open, one for each room), with each sender's media key per epoch `MLS-Exporter("alcove/call-media/v1", identity, 32)` from its group | Only in the browsers in the call, in memory: each browser holds its own part of the call's, the organizer's every part's. Never sent to the API or LiveKit ([Calls and recordings › End-to-end encryption](calls-and-recordings.md#end-to-end-encryption)) |

All derivations are HKDF-SHA-256 with 32-byte outputs. `salt=ownerId` means the ID's 32 decoded bytes; the
index, sign-in attempt and billing keys use an empty salt.

## Records and envelopes

A **record** is `{header, nonce, ciphertext}`: XChaCha20-Poly1305, a random 24-byte nonce, associated data
`JCS(header)`. Every header carries `v`, `kind` and `ownerId` plus the record's exact location, and opening a
record recomputes the expected header, so a record copied to another row, owner or object fails to open.

| Kind | Sealed under | Header binds |
| --- | --- | --- |
| `manifest` | `Krecord` | item, revision |
| `audio` | `Krec` | recording, segment, seq, object |
| `screen-frame` | `Krec` | recording, frame, object (the JPEG of a shared screen) |
| `screen-frame-info` | state key `screen:<noteId>` | note, frame (whose share, when, its size, what was read on it) |
| `call-state` | state key `call:<id>` | call |
| `call-mls` | state key `call-mls:<id>` | call, place in the call's log, entry kind, and the part of the call's group it belongs to |
| `transcript-clip` | state key `transcript:<noteId>` | note, clip tag |
| `transcript-translation` | state key `transcript:<noteId>` | note, line-and-language tag |
| `job` | state key `job:<noteId>` | note |
| `operation-result` | operation-result key | operation |
| `billing` | billing key | owner |
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
| `email` | The email address, trimmed and lower-cased | `identities.email_index`, `note_access.email_index` | Whether an address is on Alcove (people search, team directory); who else may read a note |
| `call-code` | The call's code from its link | `call_codes.code_hash` | Finding a call for anyone with the link, guests included |

The hash is deterministic, so equal values show the same person across rows and accounts (see
[What is still visible](#what-is-still-visible)), and anyone holding `KMASTER` can test a guessed address.

## Accounts and sign-in

1. **Sign in with Google** (`apps/api/src/google.ts`). `GET /v1/auth/google` redirects to Google's
   authorization endpoint, found by OpenID discovery, with a fresh `state`, `nonce` and PKCE verifier (an
   S256 challenge), the scopes `openid email profile https://www.googleapis.com/auth/calendar.events`,
   `access_type=offline`, `include_granted_scopes=true` and `prompt=select_account`. Google sends the browser
   back to `GET /v1/auth/google/callback` (`$API_URL/v1/auth/google/callback`). The server deletes the
   attempt cookie, checks that the attempt is under 10 minutes old and that `state` matches, swaps the code
   for tokens with the verifier and the client secret, and verifies the ID token with `jose`: RS256 against
   Google's published keys, the issuer, the audience (the client ID) and the expiry, with 60 seconds'
   tolerance. Then it checks the nonce and accepts only `email_verified: true`, because notes are shared by
   email. The identity is `google:<sub>`, the lower-cased email, and Google's name and photo URL. A refusal
   sends the browser to `/welcome?signin=<reason>` (`cancelled`, `expired`, `unverified`, `unavailable`,
   `busy` or `failed`) and signs nobody in. Someone can untick the calendar on Google's consent screen and
   still sign in.
2. **Demo sign-in.** `POST /v1/auth/sign-in` with `{provider, email?}`, where `provider` is `microsoft` or
   `sso`; `demo.ts` turns the request into an identity (Art Vandelay, or `demo:sso:<email>` with a name
   made from the address), marked as a demo (`sample`). Both ways in share one limit: 30 attempts a minute
   per client address.
3. **The first sign-in with a subject creates the account**, in one transaction serialised on the subject
   index: the `owners` row with a fresh `ownerId`, `Kowner`, root envelope and root check; the `identities`
   row; the sealed profile (name, email, photo URL, notes default `on`); and the billing account with 10,000
   welcome credits. Later sign-ins with the same subject open the same account and bring the profile's name,
   email and photo, and the identity's email index, up to date with the provider. After every sign-in a
   session opens; for a demo identity with nothing upcoming, the sample calendar is placed too: five sealed
   meetings, the first about 12 minutes later. A new account lands on `/ready`, which plays the account-creation screen over Home; anyone else lands on `/home`.
4. **Every request opens the account's keys** (`openOwner` in `apps/api/src/owners.ts`): it reads
   `root_envelope` and `root_check`, unwraps `Kowner` under `KMASTER`, checks the root check (`IntegrityError`
   on a mismatch) and derives `Kwrap`. The request works on its own copies (`Owner.root`, `Owner.wrapKey`).
   No key is cached between requests. Reading someone else's note opens their account the same way, after
   the access check, and so does the notes worker for each job.

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

## Google sign-in and calendar access

- **The attempt cookie.** `__Host-alcove_google` when `WEB_ORIGIN` is HTTPS (`alcove_google` otherwise):
  HttpOnly, `SameSite=Lax` (Google's redirect back is a cross-site navigation), path `/`, `Secure` over
  HTTPS, max-age 10 minutes. It holds the `state`, `nonce`, PKCE verifier, expiry, whether this pass asked
  for consent, and where to land, sealed as a `sign-in-attempt` record, so the browser can neither read nor
  change it. The callback deletes it whatever the outcome.
- **The refresh token.** Every Google sign-in saves what Google granted as the account's `connection` item, a
  sealed manifest like any other: the scopes, when, and the refresh token. A new refresh token replaces the
  old one; without one, the old one stays. Google sends a refresh token only the first time someone agrees,
  so when the calendar is granted but no refresh token has ever arrived, the callback signs the person in
  and sends them back to Google once more with `prompt=consent` to get one. The Connect button
  (`GET /v1/auth/google?consent=1`) asks again for the account already signed in.
- **Access tokens** live only in the API process's memory, per account, until a minute before they expire,
  and are renewed from the refresh token. A Calendar call that gets `401` drops the cached token and tries
  once more. When Google answers a renewal with `invalid_grant` (access withdrawn at Google), the refresh
  token and the calendar scope are removed from the connection, and the app offers to connect again.
- **What goes to Google.** Scheduling, changing or cancelling a call while the calendar is connected
  creates, updates or deletes an event on the organizer's primary Google Calendar with `sendUpdates=all`,
  so Google emails everyone invited. The event carries the call's title, time and guests, the join link, a
  line saying whether notes are on, `guestsCanModify: false` and a private extended property
  `alcoveMeeting` with the meeting ID. If Google fails, the call is kept without its calendar event. Calls
  started now don't go on the calendar.
- **What comes from Google.** `GET /v1/calendar` reads the primary calendar's events from an hour ago to a
  week ahead (at most 100) into memory for the response, and never stores them: timed events that weren't
  cancelled or declined, of the default type, and not Alcove's own. `POST /v1/calendar/events/:id/adopt`
  makes one of them an Alcove call, only if the account is its organizer (`403 forbidden` otherwise): the
  call takes the event's title, time and guests, and the event gets the Alcove link above its old
  description, with the update sent to everyone. Adopting the same event twice returns the same call. An
  occurrence of a recurring event carries Google's ID for the whole recurring event (`recurringEventId`):
  adopting one keeps that ID inside the call's sealed manifest, so every occurrence held in Alcove is in one
  series, and the calendar view marks later occurrences with it
  ([Notes and inference › Series](notes-and-inference.md#series)).
- **Never logged:** ID tokens, refresh and access tokens, Google's error descriptions, and Google's event IDs
  (an occurrence's ID begins with its recurring event's, so logged paths, the server's and the browser's,
  show `/v1/calendar/events/:id`, and a refused adopt's error names no event). Only Google's error code
  (such as `invalid_grant`) is.

## Who can read a note

A note lives in its organizer's vault, sealed under their keys. `note_access` lists who else may read it,
one row per person: `(owner_id, note_item_id, email_index, role)`.

- **Invited.** When a call with notes ends, every address invited to the call gets a row with role `invited`.
  Until then nobody invited can find the note.
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
  recording has stopped (`POST /v1/notes/:id/share`). Each new address gets a row with role `shared` and joins
  the note's sealed `shared` list; addresses that already have the note are skipped.
- **The check.** `locate` in `apps/api/src/modules/notes.ts` looks in the caller's own vault first. Otherwise it
  needs a `note_access` row for that note and the caller's email index, taken from their profile email; only
  then does it open the organizer's keys and read the note. The note, its audio, its progress stream, its
  follow-ups, asking about it and sharing all go through this check. Anyone else gets `404 not-found`, the
  same answer as for a note that doesn't exist.
- **The live transcript** is only in the organizer's own call or room recording; nobody else sees it until
  the note is finished and given to them.
- **Decisions, open questions and follow-ups** are one list for everyone who has the note, and every
  change writes a new revision in the organizer's vault with who made it (their name and address, inside
  the sealed manifest) and when. What the notes model wrote is only a proposal: a decision stays
  `proposed` until someone who has the note confirms it (and a confirmed one can later be said to no longer
  hold), a question stays open until someone says it was answered, and a follow-up's owner is a suggestion
  until that person takes it on. Only the person a follow-up is for can take it on (`403 forbidden` for
  anyone else; giving it to yourself is taking it on), and it can only go to someone who has the note.
  Refusals name nobody, so no name reaches a log line.
- **Series.** What carries over from one call to the next is put together on each request from the notes
  the asker can read at that moment, through this same check, and kept nowhere
  ([Notes and inference › Series](notes-and-inference.md#series)). Being in a series opens nothing: someone
  invited to one call sees that call's notes in it and no other, a note deleted or removed is gone from it at
  once, and asking across a series sends the notes model only the calls the asker has. An answer takes a
  while to write, so the check runs again once it's written, for every note it read (and for the one note
  when asking about a note): if any went meanwhile, the answer isn't sent (`409 conflict`). A series ID that
  comes from a request is treated like a note ID: anyone with no notes from it gets `404 not-found`, and
  only the organizer sees its next call.
- **Removing.** Deleting your own note deletes it for everyone ([Deletion](#deletion)). Removing someone
  else's note deletes only your own `note_access` row.

Access follows the email address, so it is only as strong as sign-in: whoever signs in with an address can
read every note given to it. That's why the demo SSO sign-in takes only example addresses (see above).

## Requests

- **Origin and content type.** Every state-changing request under `/v1` must carry `Origin: WEB_ORIGIN`
  (`403 forbidden` otherwise) and a JSON or audio body (`400 invalid` otherwise). This blocks blind cross-site
  POSTs that `SameSite=Strict` would still allow from sibling ports or subdomains. CORS answers only
  `WEB_ORIGIN`, with credentials.
- **Idempotency.** Signed-in mutations carry `x-alcove-operation` (Id128). The receipt stores an HMAC
  commitment of method, path and exact body bytes, plus the JSON response sealed under the operation-result
  key. A retry gets the same response; a different request under the same ID is `409 conflict`. Receipts may
  hold copies of responses, so they are purged after 24 hours and whenever the owner deletes a note or cancels
  a meeting. Note search, asking (about a note, a call so far or a series), catching up, caption
  translations, audio pieces and transcript clips keep no receipt: searching, asking and translating only
  read, pieces and clips are already idempotent by their place in the recording, and their answers carry the
  live transcript, which shouldn't be copied into receipts. Nor do changes to a note's decisions, open
  questions and follow-ups, or sharing it: anyone who has the note can make them, and each answers with the
  whole note, so a receipt kept under someone it was given to would outlive the organizer deleting it. Each
  sets an explicit state (confirmed, answered, done, these addresses added), so a retry changes nothing anyway.
- **Rate limits.** Sign-in, demo and Google together: 30 a minute per client address (the last
  `x-forwarded-for` entry, which Cloud Run's front end appends). Browser reports: 60 a minute per client
  address. A call's card: 600 a minute per client address (every pre-join reads it every 4 s or so while it
  waits); joining by link: 120. Transcript clips: 120 a minute per account, calls and room recordings together.
  Shared-screen frames: 24 a minute per person in a call, and
  30 a minute for saying a share ended. Asking for notes in a call: 10 a minute per person. Questions and catch-ups (about notes, a call so far or a
  series): 20 a minute per account, together (during a call, per connection to it). Opening a moment of a call's
  live transcript from a catch-up: 60 a minute per connection to the call. Over a
  limit the answer is `503 unavailable` ("Too many attempts"); Google sign-in returns to the welcome screen
  with `signin=busy` instead. The counters live in each API process.
- **Sizes.** An audio piece over 2 MiB, a transcript clip over 30 seconds of WAV or a shared-screen frame over
  1 MiB is refused from its `content-length` (`400 invalid`) before the body is read; a frame must also be a
  JPEG between 64 and 4096 pixels a side.
- **No content in URLs.** Note search, people search, sharing and questions send their terms in POST bodies.
  A call's code is in its pages' paths (`/join/<code>`, `/call/<code>`) and in the API paths that read or join
  it (`/v1/calls/<code>/card`, `…/join`, `…/meeting`), never in a query string or a sign-in URL: signing in with
  Google from a join page keeps the call to come back to in the tab's sessionStorage. Alcove's own logs write
  those paths as `/v1/calls/:code`, and Cloud Run's request logs, which keep raw URLs, are excluded from the
  project's log sink for that reason ([Deployment and acceptance](deployment-and-acceptance.md)). Call passes go
  in a header.
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
  the people in the call: nothing records or transcribes it, and the API never sees it.

- **Your view of a call** never leaves the browser. Layout preferences stay in `localStorage` for the account and
  the arrangement of the call you're in stays in `sessionStorage` until you leave it, naming people by their
  random per-call seat and shares by their sharer's random connection ID: no names, addresses or call content ([Calls and recordings › The call
  screen](calls-and-recordings.md#the-call-screen)).
- **Fonts** (Newsreader, Hanken Grotesk, IBM Plex Mono) are served from the app (`packages/ui/src/fonts`, OFL), not a
  font service, so no page load tells anyone else who's visiting.
- **Google profile photos** come through the API: the app gets `/v1/photos/<token>` (`modules/photos.ts`),
  where the token is the provider URL sealed under a key derived from `KMASTER`. It's stable, so the
  browser caches it, and only this server can read it. The API fetches the image from an allowed host
  (`PHOTO_HOSTS`), keeps it in memory for an hour and serves it only to signed-in browsers. Google sees
  the API fetch a photo, not who looked at whom. Guests in a call aren't signed in, so they're shown
  everyone without photos.
- **The Content-Security-Policy** allows nothing outside the app's origin and the API's (requests, audio,
  photos), and the LiveKit host for calls (with `*.livekit.cloud`, where LiveKit Cloud's media servers are). Inline scripts run only by the SHA-256 of what the build produced (`apps/web/scripts/csp.mjs`
  writes the policy at deploy), and nothing may `eval` (the contract configures zod not to compile code at
  runtime). `Permissions-Policy` also opts out of the browser's ad-topics API.
- **No analytics.** The app has no analytics, error-tracking or tag scripts. Cloudflare Pages inserts its
  own Web Analytics beacon into pages when that's on for the project. Every page is served with
  `Cache-Control: no-transform` (`apps/web/public/_headers`), which tells Cloudflare's edge not to rewrite
  it, and the CSP blocks the beacon from loading if it's inserted anyway. Keep Web Analytics switched off
  for the project in Cloudflare (Workers & Pages › alcove-web › Metrics).
- **Diagnostics** go to Alcove's own API only (`POST /v1/telemetry`): warnings and errors with codes,
  request IDs, statuses and timings, scrubbed like every other log line ([Logging](logging-and-errors.md)).

## What is still visible

| Where | Visible |
| --- | --- |
| Postgres | Opaque IDs; item kinds (`profile`, `meeting`, `note`, `connection`, so which accounts connected Google); revision, call and recording times; per-piece duration, size and codec; while a note records, how many clips were transcribed and their sizes; how many shared-screen frames a note keeps, and their sizes; each notes job's state, attempts and lease times; operation method and time; stored bytes; each session's provider and its created, last-seen and expiry times; when each sign-in identity was last used |
| Keyed hashes | Equal hashes show the same person. Joining `note_access` to `identities` shows which accounts received which notes from which organizers, and whether by invitation or by sharing. For addresses without an account it still shows the same address receiving several notes. |
| Object store | Object count, sizes and timing: a recording writes about one object every 5 seconds, and a shared screen one each time it changes (at most every 4 seconds) |
| Ciphertext lengths | Not padded, so title, guest list, transcript and clip lengths leak approximately |
| NEAR AI's models, inside their confidential VMs | Whisper: every transcript clip (the audio) and what was said in it. GLM: for notes, questions and catching up, the transcript, the meeting's title, the organizer's name, the invited people's names (or the part of an address before the @), the length, the summary, the question and the asker's name; for captions, the lines asked for and the language; when shared screens were read, each frame's image, and what it read on them for the notes and answers; asking across a series, the same for up to 12 of the calls in it that the asker has notes from, with their dates (in the asker's time zone), decisions, open questions and follow-ups. Each request is sealed with Oblivious HTTP to the key the model's attestation vouches for, at its own endpoint, after the evidence is checked: Intel TDX, a published dstack OS image measured exactly, NVIDIA confidential GPUs, the measured configuration. The model code inside is NEAR AI's choice and isn't pinned ([Notes and inference › Verified private inference](notes-and-inference.md#verified-private-inference)). |
| NEAR AI's gateway and operators | Alcove's API key on attestation requests, which models are verified when, the size and timing of every sealed request, and the server's address; never the content, the request's parameters or the key inside the seal. A deployment NEAR AI chooses to run in an attested VM on a measured dstack image passes. |
| Intel and NVIDIA | Intel's certification service: which platform (FMSPC) each quote came from, when Alcove verifies. NVIDIA's attestation service: each model's GPU evidence (certificates and measurements). No content. |
| Google | For Google accounts, each sign-in. With the calendar connected, every scheduled call's title, time, guests, join link and whether notes are on, as an ordinary calendar event that Google sends to the guests. |
| Cloudflare | As the web app's host: each page load and file request, with its address, path (such as `/notes/<id>`), time and browser. The API's traffic doesn't pass through it. As the object store (R2): what the object store row shows. |
| LiveKit (Cloud in production) | No media: frames are end-to-end encrypted. Each person's address; room names and identities (random, no names); join and leave times; packet sizes and timing; the audio-level header, so who is speaking when; track kinds and mute state, so who has a camera or screen on; each frame's key index, which travels in the clear (the frame trailer), so whose keys change together: who is in the same part of the call, and who is between two |
| The call's MLS log (`call_mls`) | Sealed MLS messages, while the call runs: how many people asked to join, were added and removed, and how much chat there was, by count and size, for each part of the call (the main room, or a breakout room by its random ID). A room's entries are deleted when it closes, the rest when the call ends |
| The API (calls) | Who's in each call, asking or turned away, and their names, with the addresses of people signed in whom the notes may go to (sealed at rest, opened per request); who sent each chat message, in which part of the call and when, by size; raised hands, spotlight, breakout rooms and who's in which; when notes were turned on, off, paused and resumed, in the call or in one room, and who asked for notes; when shared screens were turned on and off, who sent frames of which share and when, and when shares ended. What's on a shared screen only in memory, and only for the frames presenters' browsers send for the notes from the main room: each is held to seal it as it arrives, and opened again only to send it sealed to the notes model and to show it to the note's people. It's never kept readable. It vouches for who's invited and decides who goes into which room's group: [Calls and recordings › End-to-end encryption](calls-and-recordings.md#end-to-end-encryption) |
| The API process | Everything, for every account: it holds `KMASTER`. It also keeps each account's current Google access token in memory for up to an hour. On Cloud Run, whoever operates the service could read that memory. [In a confidential VM](#moving-to-confidential-computing) the host can't, and the keys go only to builds the app's key policy allows. |

## Deletion

- **Deleting your own note** removes, in one transaction: every revision, the recording and its pieces, its
  shared-screen frames and what was read on them, any transcript clips still there, its notes job, every `note_access` row (so everyone loses it), the link from
  its meeting, and the owner's operation receipts; stored bytes go down to match. Nobody else holds a receipt
  with the note in it: what others can do to a note keeps none ([Requests](#requests)). Then the audio and
  frame objects are deleted; failures are queued in `object_gc` and retried.
- **Removing someone else's note** deletes only your own `note_access` row. The organizer and everyone else
  keep it.
- **Closing a breakout room** deletes its entries in the call's MLS log (so its chat's ciphertext) and what was
  heard in it (its transcript lines and their translations). Nothing said in a room goes into the note.
- **Cancelling a meeting** deletes it with every revision and its calls (including chat), and the owner's
  receipts. With a connected calendar, its Google event is cancelled too, which tells the guests. Its notes
  stay. A live call can't be cancelled.
- **Discarding a room recording** deletes its note in the same way as deleting your own note.
- **Series** have no record of their own: a series is the ID its calls share inside their sealed manifests
  (with Google's ID for a recurring event), so it goes when its calls do. What carries over is never stored,
  so a deleted or removed note leaves every series at once, with nothing derived from it left behind.
- **Google access** stays in the account's `connection` item until the account is deleted (not built yet).
  Withdrawing Alcove's access at Google removes the refresh token the next time Alcove tries to use it.
- **Maintenance** (every 5 minutes) removes ended sessions and receipts older than 24 hours, retries
  `object_gc`, and removes objects older than 24 hours that no recording piece or shared-screen frame
  references.

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
| Strict JSON (reject duplicate keys and unknown fields), U64 decimal strings | zod parsing (drops unknown fields), JS numbers for credits | To do |
| Service-side wrap of `Krec` with 24-hour / 7-day disposal | Any work, including someone else's read and the notes worker, opens the owner's keys through `KMASTER`; no separate wrap or disposal window | Accepted with `KMASTER` custody |
| Protected inference: end-to-end encrypted requests to `I01`, with its attestation checked | Each model's evidence is checked first (Intel TDX quote and collateral, a published dstack OS image by MRTD and RTMR0–2, report data with a fresh nonce, RTMR3 and the measured compose, NVIDIA GPU verdict, the OHTTP key's signature). Every request, speech and chat, goes by Oblivious HTTP sealed to the model's attested key at its own endpoint: NEAR AI's E2EE chat doesn't bind its fields to the client's key, so whoever terminates TLS could replay them, and doesn't cover speech. No plaintext way | Done for what the evidence shows. The model code NEAR AI's compose manager starts isn't pinned, the GPU evidence and model name aren't bound to the VM, and the endpoints are ones NEAR AI calls experimental ([What's left](notes-and-inference.md#whats-left)) |
| Encrypted manifest binding all chunks; rollback detection | Not implemented: a database writer could roll a head back or drop trailing pieces | To do (version-bound associated data and an encrypted piece list) |
| Billing keyed by a random account ID plus `owner_tag` | Keyed by `owner_id` | To do before payments |
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
   the organizer's browser sends everyone's speech it hears to the notes service, outside the media
   encryption (left: an attested notes participant, so no browser sends audio in the clear to the API).
5. **Key rotation:** `KMASTER` (re-wrapping every root envelope and recomputing every blind index, which needs
   the subjects and emails the indexes hide), `Kowner` on suspected compromise, and `Kservice`; use
   `keyVersion`.
6. **Deletion guarantees:** account deletion (not built yet) and expiry windows across backups.
7. **Hygiene:** strict parsing, logs without content, rate limits at the edge.
