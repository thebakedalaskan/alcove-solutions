# Data and storage

[Docs home](../README.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md) · [Calls and recordings](calls-and-recordings.md)

Postgres (`D01`) holds ciphertext plus the minimum clear projection: opaque IDs, keyed hashes, relationships,
states, timestamps, byte counts and sequence numbers. The object store (`O01`: RustFS locally, Cloudflare R2 in
production) holds immutable ciphertext objects under random IDs (`o/<Id128>`). The authoritative schema is
`apps/api/migrations/`, applied in order (`0001_init.sql`, then each file after it); this page explains the
result, and [Changing what's stored](#changing-whats-stored) how it changes without losing anyone's data.

## Tables

| Table | Clear columns | Ciphertext or keyed hash |
| --- | --- | --- |
| `owners` | `owner_id`, `stored_bytes`, `version`, `created_at` | `root_envelope` (`Kowner` under `KMASTER`), `root_check` (HMAC) |
| `identities` | owner, created and last used | `subject_index` (primary key), `email_index` (the provider's current email, updated at each sign-in) |
| `sessions` | owner, provider (`google`, `microsoft`, `sso`), created, last seen, expiry | `session_hash` (SHA-256 of the cookie's ID) |
| `items` | owner, item ID, `kind` (`profile`, `meeting`, `note`, `connection`), current revision, `deleted_at`, `version` | — |
| `revisions` | owner, item, revision, parent revision, `created_at` | `key_envelope`, `manifest_ciphertext` |
| `operations` | owner, operation ID, method, completion time | `request_commitment` (HMAC), `result_ciphertext` |
| `transcript_clips` | owner, note item, when it was heard (so a live view, and the next clip's language and prompt, read only the newest clips; the recording's pieces already show when it was recorded) | `clip_tag` (keyed hash of the clip's segment, start and speaker), `clip_ciphertext` (its segment; in a call, the participant ID of whose speech it was; its transcript lines, each with when it starts and ends, the participant ID of who said it, the breakout room it was said in, if any, while rooms were open who may read it, when it was said, and whether Whisper was unsure of its words; the evidence of the verified model that heard them; the language Whisper picked for it when sure, and whether it asked Whisper what its speaker speaks. A breakout room's clips stay until the call ends, when every clip moves into the note) |
| `transcript_translations` | owner, note item | `line_tag` (keyed hash of the line and the caption language), `translation_ciphertext` (the line in that language) |
| `content_jobs` | owner, job, revision, kind (`notes`), state (`queued`/`writing`), lease, attempt | `job_ciphertext` (the note and recording IDs) |
| `calls` | owner, call, meeting item, `live`/`ended`, start and end, `version`, LiveKit room name (random), the LiveKit identity (random) of the connection that hosts (`host_identity`, `host_joined_at` and `host_left_at`, named before hand-off and kept so: the organizer's connection, or a stand-in's while the organizer is away), when that connection joined and left, locked | `state_ciphertext` (what the call captures: notes off, on or paused, every change with who made it and when, what the host's browser says it can't capture now, the stretches it was out of the call while notes were on, and asks for notes; which connection hosts, when each hosted, and how long a host who let go to move to another device has for its new device to come in; who joined (with the addresses of people signed in whom the notes may go to), when each connection was let in and when it left, whose hand is up, who was removed, spotlight, breakout rooms, who's in which, where each person was before their last move and when they moved, the rooms' messages, each room's MLS epoch and when the organizer paused it or carried on there, when the recording's current segment began, each room's scribes (which connection, from when until when) and everyone who was in it, which the rooms' sections of the note are made from when the call ends, and which stay in the ended call's state, like the rest of it, until its meeting is deleted, whether pointing at shared screens is on and who doesn't let others point at what they share, notices, each for everyone, one room, one connection or everyone but one), and where its MLS groups have got to (counters only: the generation, which starts new groups whenever the connection that hosts changes; the main room's epoch, as the API takes one commit per epoch, in order; and the last seq in its log) |
| `call_codes` | owner, meeting item | `code_hash` (keyed hash of the call code, so anyone with the link finds the call) |
| `call_moves` | owner, call, move, when it runs out | `secret_hash` (SHA-256 of the move's current secret: the code in the new device's link, then the claim that replaces it), `body_ciphertext` (who's moving, the stage, whether their microphone and camera are on, and the new device's identity, key package and kind, sealed under the call's moves key). Deleted when it runs out, and when the call ends |
| `call_mls` | owner, call, `seq`, MLS group generation, kind (`keypackage`, `commit`, `welcome`, `message`), the random identity a key package came from or a welcome is for, the part of the call whose group an entry belongs to (`grp`: `main` or a breakout room's random ID; none for a key package), epoch | `body_ciphertext` (an MLS message, which the API can't read, sealed again under the call's state key, bound to its place in the log and its part of the call). A breakout room's entries are deleted when it closes; the rest when the call ends, and when a new generation starts (waiting people's key packages carry over) |
| `recordings` | owner, recording, note item, `recording`/`paused`/`stopped`, start (the recording's own, for one made without a connection and uploaded later) and end, `version` | `key_envelope` (`Krec`) |
| `recording_pieces` | owner, recording, segment, seq, where the piece starts in its segment (`at_ms`), object ID, ciphertext SHA-256 and length, duration, codec | (the object) |
| `screen_frames` | owner, note item, frame ID, object ID, ciphertext SHA-256 and length | `frame_tag` (keyed hash of the share and the image's digest, so a retried frame is kept once), `info_ciphertext` (whose share, when, the segment, the frame's size, and what the notes model read on it), and the object (the JPEG, sealed under the recording's key) |
| `note_access` | owner (the organizer), note item, role (`invited`/`shared`), created | `email_index` |
| `personal_notes` | owner (the author), the note's organizer and item: one row for each person and note | `body_ciphertext` (everything they keep on it: what they wrote, bookmarks and what they point at, kept questions and answers, and which of it was added to the shared notes), sealed under the author's own keys. Replaced with each change, with no earlier versions |
| `note_additions` | owner (the note's organizer), note item, addition ID, when it was added | `author_index` (keyed hash of who added it, so deleting their account finds their additions on anyone's notes), `body_ciphertext` (the words, who added it, and the lines or shared screens it points at), sealed under the organizer's keys |
| `billing_accounts` | owner, `version` | `state_ciphertext` (balance and history, under `Kservice`) |
| `object_gc` | object ID, owner, queued time, attempts, last error | — |

The migration runner adds `schema_migrations`, which records each applied file by name.

Constraints: checked domains `alcove_id128` (22 characters) and `alcove_owner_id` (43 characters), composite
owner-scoped foreign keys, and deferred item-head and parent-revision constraints. Deleting an owner cascades to
everything it owns; deleting an item cascades to its revisions, its calls, its recording and pieces, its
transcript clips, its `note_access` rows, everyone's `personal_notes` on it and its `note_additions`. The `note_access` rows that give an account other people's notes
belong to those notes' organizers, so deleting the account deletes them by its email index, unless another
account still signs in with that address. `object_gc` keeps a plain owner ID with no foreign key, so a failed
object delete is still retried after its account is gone.

## Manifests (encrypted)

| Item kind | Manifest fields |
| --- | --- |
| `profile` | name, email, photo URL, whether it's a demo account (`sample`), preferences (notes default, notes language, summary length, calendar and offline-recording switches, notification choices, pinned note IDs (at most eight, only notes the person has; pins to notes they no longer have are dropped when preferences are read), and groups (a name and up to 50 email addresses each; sharing notes with one carries only its name into the note)), colleagues invited to Alcove |
| `meeting` | title, start, end, guests (email addresses), notes (`on`/`off`), code, status (`scheduled`/`live`/`ended`), duration, note ID (the latest, when it was held more than once; each note names its meeting), when it's on a calendar the Google Calendar event ID and link and whether the event was the organizer's own before it became an Alcove call (adopted), the series it's in (`seriesId`), for an occurrence of a recurring Google event, that event's ID (`recurringEventId`), and which guests were added by being let in from the call's link (`addedFromLink`), once any were |
| `note` | kind (`call`/`room`), title, start, duration, meeting ID, recording ID, status (`recording`/`pending`/`ready`), invited emails, when the call ended or the recording stopped (when everyone invited got the note), everyone it was shared with afterwards (each address with who shared it: their account ID, name and email as they were then; the name of their group, when it went to one; and when), summary, decisions (text, time, state `proposed`/`confirmed`/`rejected`/`superseded`, the IDs of the lines it rests on and of any that cut against it, who disputes it, changes), open questions (text, time, state `open`/`answered`, the lines it rests on, changes), action items (text, owner when known, whether they took it on, due date as said, done, the lines it rests on, changes; a change says who, how they had the note, when, and what it was before), chapters, gaps (each stretch of the call with notes off or paused: when, and where it falls in the recording), screens (each shared-screen frame kept: where it falls in the recording and until when, whose share, its size, how legible it was, its title, text (up to 700 characters), regions and what the notes say it shows; the image is in `screen_frames`), transcript (lines with time, speaker when known, the breakout room by name when said in one, text, what the transcript couldn't vouch for (`unsure`: its words, or who said them), and corrections (`changes`: who changed its words or speaker or said it was heard right, when, and what it was before; the first and the latest 19); null while recording), each breakout room's section (its name, everyone who was in it, when it was open, its gaps, its lines with what the transcript couldn't vouch for and their corrections, and its summary, decisions, open questions, follow-ups and chapters), when the notes last read the transcript to write them (`writtenAt`), suggested questions, breakout rooms (kept with the note, so its chapters include them every time the notes are written) |
| `connection` | provider (`google`), the Google refresh token, the scopes granted, when it was connected |

Every save writes a full new revision with a fresh `Krecord` and compare-and-set on the item head
(`409 conflict` if someone else saved first). Reads decrypt the head revision; listing decrypts every live
item of a kind. Earlier revisions stay until the item is deleted: correcting a transcript line or changing a
decision never erases what was there before.

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
- **Someone's own notes** are a sealed record for each person and note, written whole under an advisory lock on the
  two, so one person's changes take turns without waiting on any row. They hold pointers, never what's pointed at, and
  what's in them is read for that person each time
  ([Notes and inference › Your own notes](notes-and-inference.md#your-own-notes)).
- **Finding people.** Sign-in looks up `identities` by subject index; people search and the team directory
  check `identities.email_index`; shared notes are found through `note_access.email_index`
  ([Privacy › Blind indexes](privacy-keys-and-sessions.md#blind-indexes)).
- **Who has a note** is its organizer and everyone with a `note_access` row for it. The note's manifest says how
  each of them got it (invited, or shared by whom, with which group, when), and each reader is told their own
  way as `received`. Every reader's list of notes also carries each share to a group (`groupShares`: who, the
  group's name, the latest time), worked out from the same recipients. Someone who removed the note from theirs
  has no row, so isn't listed, and a share to a group nobody still holds drops out; sharing with them again gives
  it back.
- **Deleting** is physical, whether it's a note, a meeting or a whole account: rows, receipts and objects
  (see [Privacy › Deletion](privacy-keys-and-sessions.md#deletion)). A deleted account leaves no row keyed by
  its ID, except an `object_gc` entry until maintenance deletes an object the store refused.
- **Credits used this month** are summed from the sealed billing history when the balance is read
  (`GET /v1/credits`): nothing about usage is stored in the clear ([Payments and usage](payments-and-usage.md)).

## What's kept, and for how long

One fixed behaviour, with no settings ([Notes and inference › What's kept, and for how long](notes-and-inference.md#whats-kept-and-for-how-long)):

- **Speech clips** are never stored: each lives in the API process's memory while it's transcribed.
- **`transcript_clips` and `transcript_translations`** last while the recording runs and are deleted in the
  transaction that stops it; the lines move into the note.
- **`call_mls`** lasts while the call runs and is deleted when it ends.
- **The recording** (`recording_pieces` and their objects), **shared-screen frames** (`screen_frames` and their
  objects), **the note and every revision of it** (transcript, notes, corrections and who made them) are kept
  until the organizer deletes the note. Then everything goes in
  one transaction, and the objects after it (failed deletes retried from `object_gc`).
- **Questions, answers and catch-ups** are never stored, unless someone keeps an answer in their own notes.
- **Someone's own notes** (`personal_notes`) last while they have the note: they go with the note, when they remove it
  from theirs, with their account, and at the end of the call if they were taken off the invite.
- **What's added to the shared notes** (`note_additions`) lasts until it's taken back, the note goes or its author's
  account is deleted. It stays when its author removes the note.

## Operations

```
pnpm db:up      # Postgres 17 + RustFS in Docker
pnpm migrate    # apply new migrations (the API also applies them at start)
pnpm db:reset   # drop your local data and start over (never needed for a schema change)
pnpm db:down
```

Production runs migrations as the Cloud Run job `alcove-migrate` before each deploy, while the previous API
is still serving. Cloud SQL keeps a backup a day for a week, with point-in-time recovery over the same week.

## Changing what's stored

Data survives every deploy (AGENTS.md › Stored data survives every deploy), so both of the shapes it's stored
in move forward without a reset:

- **Tables.** Each change is a new migration, `apps/api/migrations/NNNN_what_it_does.sql`. The API and the
  migration job apply the files a database hasn't had, in order, each once and in its own transaction, under
  an advisory lock so two runs never interleave. They keep each applied file's checksum and refuse a database
  whose applied files were since edited or removed; `scripts/check-migrations.mjs` stops that in CI first. Because
  the previous release is still serving while its successor migrates, a migration only adds (tables, nullable
  or defaulted columns, indexes); dropping, renaming or retyping a column waits for a release that no longer
  uses it.
- **Sealed records.** The API can't change ciphertext from a migration: only the owner's keys, opened per
  request, read it. So a record's shape evolves where it's read. A field added to a stored schema gets a zod
  `.default(...)`, older records take it when they open and are sealed in the new shape the next time they're
  saved; a removed field is ignored when older records open. A field is never renamed or retyped in place, and
  a record's header and its key's derivation label never change while data under them exists.
