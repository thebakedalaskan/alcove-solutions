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
| `transcript_clips` | owner, note item | `clip_tag` (keyed hash of the clip's segment and start), `clip_ciphertext` (its transcript lines and the evidence of the verified model that heard them) |
| `transcript_translations` | owner, note item | `line_tag` (keyed hash of the line and the caption language), `translation_ciphertext` (the line in that language) |
| `content_jobs` | owner, job, revision, kind (`notes`), state (`queued`/`writing`), lease, attempt | `job_ciphertext` (the note and recording IDs) |
| `calls` | owner, call, meeting item, `live`/`ended`, start and end, `version` | `state_ciphertext` (mic, camera, hand, presentation, spotlight, breakout rooms and their messages, notes state, chat, notices) |
| `recordings` | owner, recording, note item, `recording`/`paused`/`stopped`, start and end, `version` | `key_envelope` (`Krec`) |
| `recording_pieces` | owner, recording, segment, seq, object ID, ciphertext SHA-256 and length, duration, codec | (the object) |
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
| `meeting` | title, start, end, guests (email addresses), notes (`on`/`off`), code, status (`scheduled`/`live`/`ended`), duration, note ID (the latest, when it was held more than once; each note names its meeting), the Google Calendar event ID and link when it's on a calendar, the series it's in (`seriesId`), and for an occurrence of a recurring Google event, that event's ID (`recurringEventId`) |
| `note` | kind (`call`/`room`), title, start, duration, meeting ID, recording ID, status (`recording`/`pending`/`ready`), invited emails, shared emails, summary, decisions (text, time, state `proposed`/`confirmed`/`rejected`/`superseded`, changes), open questions (text, time, state `open`/`answered`, changes), action items (text, owner when known, due date as said, done, changes), chapters, screens, transcript (lines with time, speaker when known and text; null while recording), suggested questions, breakout rooms (kept from the end of the call until the notes are written) |
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
