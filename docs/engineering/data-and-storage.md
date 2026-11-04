# Data and storage

[Docs home](../README.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md) · [Calls and recordings](calls-and-recordings.md)

Postgres (`D01`) holds ciphertext plus the minimum clear projection: opaque IDs, keyed hashes, relationships,
states, timestamps, byte counts and sequence numbers. The object store (`O01`: RustFS locally, Cloudflare R2 in
production) holds immutable ciphertext objects under random IDs (`o/<Id128>`). The authoritative schema is
`apps/api/migrations/0001_init.sql`, edited in place when the schema changes; this page explains it.

## Tables

| Table | Clear columns | Ciphertext or keyed hash |
| --- | --- | --- |
| `owners` | `owner_id`, `stored_bytes`, `version`, `created_at` | `root_envelope` (`Kowner` under `KMASTER`), `root_check` (HMAC) |
| `identities` | owner, created and last used | `subject_index` (primary key), `email_index` (the provider's current email, updated at each sign-in) |
| `sessions` | owner, provider (`google`, `microsoft`, `sso`), created, last seen, expiry | `session_hash` (SHA-256 of the cookie's ID) |
| `items` | owner, item ID, `kind` (`profile`, `meeting`, `note`, `connection`), current revision, `deleted_at`, `version` | — |
| `revisions` | owner, item, revision, parent revision, `created_at` | `key_envelope`, `manifest_ciphertext` |
| `operations` | owner, operation ID, method, completion time | `request_commitment` (HMAC), `result_ciphertext` |
| `transcript_clips` | owner, note item, when it was heard (so a live view, and the next clip's language and prompt, read only the newest clips; the recording's pieces already show when it was recorded) | `clip_tag` (keyed hash of the clip's segment, start and speaker), `clip_ciphertext` (its segment; in a call, the participant ID of whose speech it was; its transcript lines, each with the participant ID of who said it, the breakout room it was said in, if any, and while rooms were open who may read it; the evidence of the verified model that heard them; the language Whisper picked for it when sure, and whether it asked Whisper what its speaker speaks. A breakout room's clips are deleted when it closes) |
| `transcript_translations` | owner, note item | `line_tag` (keyed hash of the line and the caption language), `translation_ciphertext` (the line in that language) |
| `content_jobs` | owner, job, revision, kind (`notes`), state (`queued`/`writing`), lease, attempt | `job_ciphertext` (the note and recording IDs) |
| `calls` | owner, call, meeting item, `live`/`ended`, start and end, `version`, LiveKit room name (random), organizer's LiveKit identity (random), when the organizer's connection joined and left, locked | `state_ciphertext` (what the call captures: notes off, on or paused, every change with who made it and when, what the organizer's browser says it can't capture now, and asks for notes; who joined (with the addresses of people signed in whom the notes may go to) and whose hand is up, who was removed, spotlight, breakout rooms, who's in which, where each person was before their last move and when they moved, the rooms' messages, each room's MLS epoch and when the organizer paused it or carried on there, whether pointing at shared screens is on and who doesn't let others point at what they share, notices, each for everyone or one room), and where its MLS groups have got to (generation, the main room's epoch and the last seq in its log: counters only) |
| `call_codes` | owner, meeting item | `code_hash` (keyed hash of the call code, so anyone with the link finds the call) |
| `call_mls` | owner, call, `seq`, MLS group generation, kind (`keypackage`, `commit`, `welcome`, `message`), the random identity a key package came from or a welcome is for, the part of the call whose group an entry belongs to (`grp`: `main` or a breakout room's random ID; none for a key package), epoch | `body_ciphertext` (an MLS message, which the API can't read, sealed again under the call's state key, bound to its place in the log and its part of the call). A breakout room's entries are deleted when it closes; the rest when the call ends, and when a new generation starts (waiting people's key packages carry over) |
| `recordings` | owner, recording, note item, `recording`/`paused`/`stopped`, start and end, `version` | `key_envelope` (`Krec`) |
| `recording_pieces` | owner, recording, segment, seq, object ID, ciphertext SHA-256 and length, duration, codec | (the object) |
| `screen_frames` | owner, note item, frame ID, object ID, ciphertext SHA-256 and length | `frame_tag` (keyed hash of the share and the image's digest, so a retried frame is kept once), `info_ciphertext` (whose share, when, the segment, the frame's size, and what the notes model read on it), and the object (the JPEG, sealed under the recording's key) |
| `note_access` | owner (the organizer), note item, role (`invited`/`shared`), created | `email_index` |
| `billing_accounts` | owner, `version` | `state_ciphertext` (balance and history, under `Kservice`) |
| `object_gc` | object ID, owner, queued time, attempts, last error | — |

The migration runner adds `schema_migrations`, which records each applied file by name.

Constraints: checked domains `alcove_id128` (22 characters) and `alcove_owner_id` (43 characters), composite
owner-scoped foreign keys, and deferred item-head and parent-revision constraints. Deleting an owner cascades to
everything it owns; deleting an item cascades to its revisions, its calls, its recording and pieces, its
transcript clips and its `note_access` rows.

## Manifests (encrypted)

| Item kind | Manifest fields |
| --- | --- |
| `profile` | name, email, photo URL, whether it's a demo account (`sample`), preferences (`notesDefault`), colleagues invited to Alcove |
| `meeting` | title, start, end, guests (email addresses), notes (`on`/`off`), code, status (`scheduled`/`live`/`ended`), duration, note ID (the latest, when it was held more than once; each note names its meeting), the Google Calendar event ID and link when it's on a calendar, the series it's in (`seriesId`), for an occurrence of a recurring Google event, that event's ID (`recurringEventId`), and which guests were added by being let in from the call's link (`addedFromLink`), once any were |
| `note` | kind (`call`/`room`), title, start, duration, meeting ID, recording ID, status (`recording`/`pending`/`ready`), invited emails, shared emails, summary, decisions (text, time, state `proposed`/`confirmed`/`rejected`/`superseded`, changes), open questions (text, time, state `open`/`answered`, changes), action items (text, owner when known, due date as said, done, changes), chapters, gaps (each stretch of the call with notes off or paused: when, and where it falls in the recording), screens (each shared-screen frame kept: where it falls in the recording and until when, whose share, its size, how legible it was, its title, text (up to 700 characters), regions and what the notes say it shows; the image is in `screen_frames`), transcript (lines with time, speaker when known, the breakout room by name when said in one, and text; null while recording), suggested questions, breakout rooms (kept from the end of the call until the notes are written) |
| `connection` | provider (`google`), the Google refresh token, the scopes granted, when it was connected |

Every save writes a full new revision with a fresh `Krecord` and compare-and-set on the item head
(`409 conflict` if someone else saved first). Reads decrypt the head revision; listing decrypts every live
item of a kind.

## Writes, reads and deletes

- **Audio pieces** are sealed with the recording's `Krec`, written to the object store, read back and checked
  (length and SHA-256), and only then recorded in SQL. A failed or duplicate write queues the object for deletion.
- **Streaming** a segment reads pieces in order, checks each digest, decrypts, and streams. Only for the note's
  organizer or someone with a `note_access` row for it, with an allow-listed content type, `nosniff` and
  `no-store`.
- **Transcript clips** are sealed under the note's transcript key, one row per transcribed clip (its lines,
  none if nothing survived the filter), with the evidence of the verified model it went to. The live call or
  recording state opens them all; stopping moves the lines, and each distinct verification, into the note's
  manifest and deletes the rows in the same transaction. A note's manifest keeps those verifications, and the
  notes model's, as `inference` ([Notes and inference › What a note keeps](notes-and-inference.md#what-a-note-keeps)).
- **Caption translations** are sealed under the same transcript key, one row per line and language, and are
  deleted with the transcript clips when the recording stops.
- **Shared-screen frames** are sealed under the recording's `Krec` like audio pieces, written to the object
  store, read back and checked, and only then recorded in `screen_frames` under a share lock on the recording;
  a duplicate or a frame that arrives once the recording paused or stopped queues its object for deletion. When
  the call ends they become the note's `screens`; the notes worker writes what it read on each into its row,
  then into the note. They stay with the note and go when it's deleted
  ([Calls and recordings › Shared screens](calls-and-recordings.md#shared-screens)).
- **Notes jobs** are inserted `queued` by the stopping transaction, claimed with a lease by the notes worker,
  and deleted when the note is finished ([Notes and inference](notes-and-inference.md#the-notes-worker)).
- **Google Calendar events** are read from Google whenever the app asks (`GET /v1/calendar`) and never
  stored. An Alcove call's event ID and link are kept in its meeting manifest, and for an occurrence of a
  recurring event, the recurring event's ID.
- **Series** aren't stored: a series is read on each request from the meetings that share its ID and the
  notes the reader has ([Notes and inference › Series](notes-and-inference.md#series)).
- **Finding people.** Sign-in looks up `identities` by subject index; people search and the team directory
  check `identities.email_index`; shared notes are found through `note_access.email_index`
  ([Privacy › Blind indexes](privacy-keys-and-sessions.md#blind-indexes)).
- **Deleting** is physical (see [Privacy › Deletion](privacy-keys-and-sessions.md#deletion)).

## Operations

```
pnpm db:up      # Postgres 17 + RustFS in Docker
pnpm migrate    # apply migrations (the API also applies them at start)
pnpm db:reset   # drop local data and start fresh, after the schema changes
pnpm db:down
```

Production runs migrations as the Cloud Run job `alcove-migrate` before each deploy.
