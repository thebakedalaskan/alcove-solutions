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
| `owners` | `owner_id`, `stored_bytes`, `version`, `created_at`, `series_turn_until` (set only while a change to one of the account's series goes through, so changes take turns; [below](#writes-reads-and-deletes)) | `root_envelope` (`Kowner` under `KMASTER`), `root_check` (HMAC). An account or a [workspace](#workspaces) |
| `identities` | owner, created and last used | `subject_index` (primary key), `email_index` (the provider's current email, updated at each sign-in) |
| `sessions` | owner, provider (`google`, `microsoft`, `sso`), created, last seen, expiry | `session_hash` (SHA-256 of the cookie's ID) |
| `items` | owner, item ID, `kind` (`profile`, `meeting`, `note`, `connection`, `series`), current revision, `deleted_at`, `version` | — |
| `revisions` | owner, item, revision, parent revision, `created_at` | `key_envelope`, `manifest_ciphertext` |
| `operations` | owner, operation ID, method, completion time | `request_commitment` (HMAC), `result_ciphertext` |
| `transcript_clips` | owner, note item, when it was heard (so a live view, and the next clip's language and prompt, read only the newest clips; the recording's pieces already show when it was recorded) | `clip_tag` (keyed hash of the clip's segment, start and speaker), `clip_ciphertext` (its segment; in a call, the participant ID of whose speech it was; its transcript lines, each with when it starts and ends, the participant ID of who said it, the breakout room it was said in, if any, while rooms were open who may read it, when it was said, and whether Whisper was unsure of its words; the evidence of the verified model that heard them; the language Whisper picked for it when sure, and whether it asked Whisper what its speaker speaks. A breakout room's clips stay until the call ends, when every clip moves into the note) |
| `transcript_translations` | owner, note item | `line_tag` (keyed hash of the line and the caption language), `translation_ciphertext` (the line in that language) |
| `content_jobs` | owner, job, revision, kind (`notes`), state (`queued`/`writing`), lease, attempt | `job_ciphertext` (the note and recording IDs) |
| `calls` | owner, call, meeting item, `live`/`ended`, start and end, `version`, LiveKit room name (random), the LiveKit identity (random) of the connection that hosts (`host_identity`, `host_joined_at` and `host_left_at`, named before hand-off and kept so: the organizer's connection, or a stand-in's while the organizer is away), when that connection joined and left, locked | `state_ciphertext` (what the call captures: notes off, on or paused, every change with who made it and when, what the host's browser says it can't capture now, the stretches it was out of the call while notes were on, and asks for notes; which connection hosts, when each hosted, and how long a host who let go to move to another device has for its new device to come in; who joined (with the addresses of people signed in whom the notes may go to), when each connection was let in and when it left, whose hand is up, who was removed, spotlight, breakout rooms, who's in which, where each person was before their last move and when they moved, the rooms' messages, each room's MLS epoch and when the organizer paused it or carried on there, when the recording's current segment began, each room's scribes (which connection, from when until when) and everyone who was in it, which the rooms' sections of the note are made from when the call ends, and which stay in the ended call's state, like the rest of it, until its meeting is deleted, whether pointing at shared screens is on and who doesn't let others point at what they share, notices, each for everyone, one room, one connection or everyone but one), and where its MLS groups have got to (counters only: the generation, which starts new groups whenever the connection that hosts changes; the main room's epoch, as the API takes one commit per epoch, in order; and the last seq in its log) |
| `call_notes` | owner, call, part of the call (`place`: `main` or a breakout room's random ID), `view` (`all`, or a digest of the random IDs of the lines this view can't read), how many of the note's clips the last refresh counted, when the last refresh began (`looked_at`), and until when one is under way (`lease_until`) | `notes_ciphertext` (that view's live notes as a catch-up gives them, what they read, who may read all of it, and each follow-up's ID, the lines behind it, and who ticked it and when; null until the first are written) and `lines_ciphertext` (the IDs of the lines it read and when each was said, and when each line it left out was said and who may read it), sealed under the call's notes key, bound to the call, the part and the view. Deleted when the call ends |
| `call_codes` | owner, the item the code leads to (a meeting, or for a series' own link its `series` item) | `code_hash` (keyed hash of the code, so anyone with the link finds the call) |
| `call_moves` | owner, call, move, when it runs out | `secret_hash` (SHA-256 of the move's current secret: the code in the new device's link, then the claim that replaces it), `body_ciphertext` (who's moving, the stage, whether their microphone and camera are on, and the new device's identity, key package and kind, sealed under the call's moves key). Deleted when it runs out, and when the call ends |
| `call_rings` | owner (the organizer), ring, meeting item, when the ring next shows (`deliver_at`), when it stops (`expires_at`) | `email_index` (keyed hash of the address rung, its own purpose), `ring_ciphertext` (the address and what they said, sealed under the call's rings key). Deleted when the person is let in, when the organizer stops ringing them, when the call ends, and a day after it ran out |
| `call_mls` | owner, call, `seq`, MLS group generation, kind (`keypackage`, `commit`, `welcome`, `message`), the random identity a key package came from or a welcome is for, the part of the call whose group an entry belongs to (`grp`: `main` or a breakout room's random ID; none for a key package), epoch | `body_ciphertext` (an MLS message, which the API can't read, sealed again under the call's state key, bound to its place in the log and its part of the call). A breakout room's entries are deleted when it closes; the rest when the call ends, and when a new generation starts (waiting people's key packages carry over) |
| `recordings` | owner, recording, note item, `recording`/`paused`/`stopped`, start (the recording's own, for one made without a connection and uploaded later) and end, `version` | `key_envelope` (`Krec`) |
| `recording_pieces` | owner, recording, segment, seq, where the piece starts in its segment (`at_ms`), object ID, ciphertext SHA-256 and length, duration, codec | (the object) |
| `screen_frames` | owner, note item, frame ID, object ID, ciphertext SHA-256 and length | `frame_tag` (keyed hash of the share and the image's digest, so a retried frame is kept once), `info_ciphertext` (whose share, when, the segment, the frame's size, and what the notes model read on it), and the object (the JPEG, sealed under the recording's key) |
| `note_access` | owner (the organizer), note item, role (`invited`/`shared`), created | `email_index` |
| `meeting_access` | owner (the organizer), meeting item | `email_index` (keyed hash of the address, with a purpose of its own), `answer_ciphertext` (whether they're coming, padded to one length, under the meeting's answers key; null until they answer) |
| `personal_notes` | owner (the author), the note's organizer and item: one row for each person and note | `body_ciphertext` (everything they keep on it: what they wrote, bookmarks and what they point at, kept questions and answers, and which of it was added to the shared notes), sealed under the author's own keys. Replaced with each change, with no earlier versions |
| `note_additions` | owner (the note's organizer), note item, addition ID, when it was added | `author_index` (keyed hash of who added it, so deleting their account finds their additions on anyone's notes), `body_ciphertext` (the words, who added it, and the lines or shared screens it points at), sealed under the organizer's keys |
| `billing_accounts` | owner, `version` | `state_ciphertext` (balance and history, under `Kservice`) |
| `workspaces` | owner, `workspace_id` (the public handle, Id128), `version`, when the oldest thing in its Trash went there (`trash_since`), created | `state_ciphertext` (its name and tree: [Workspaces](#workspaces)) |
| `workspace_members` | owner (the workspace), `member_id` (what the API calls them), role (`admin`/`edit`/`read`), created | `email_index`, `person_ciphertext` (their address, and their name if the workspace was made by them) |
| `documents` | owner (the workspace), `document_id`, `next_seq`, what it comes to in bytes, items and depth of nesting at its snapshot and since (`snapshot_bytes`, `bytes_since_snapshot`, `snapshot_items`, `items_since_snapshot`, `snapshot_nesting`, `nesting_since_snapshot`), `updates_since_snapshot`, how far the newest version reaches and when it was kept (`version_seq`, `version_at`), until when something's restoring it (`held_until`) or it stays closed because it wouldn't open (`closed_until`), created. One row for each document or board in the tree; a folder has none | — |
| `document_updates` | owner (the workspace), document, `seq`, how much it adds in `bytes`, `items` and `nesting`, created | `update_ciphertext` (one Yjs update and who sent it: [Documents](#documents)) |
| `document_clients` | owner (the workspace), document, `client_id` (a Yjs client: a random number), `next_clock` (how far it's written). Kept as long as the document | `people`: keyed hashes of who it belongs to, each bound to this client and document, so no two rows can be linked. Empty for what the server wrote |
| `document_snapshots` | owner (the workspace), document, `through_seq`. One row a document | `snapshot_ciphertext` (its Yjs state through that seq), `editors_ciphertext` (who has edited it since the last version) |
| `document_versions` | owner (the workspace), document, `version_id`, `bytes`, how many `parts`, created | `info_ciphertext` (who changed it, the call it was kept in, why it was kept) |
| `document_version_parts` | owner (the workspace), document, version, `part` | `state_ciphertext` (256 KiB of its whole Yjs state) |
| `document_access` | owner (the workspace), document, `access_id` (what the API calls the entry), `kind` (`email`/`seat`), role (`edit`/`read`), `call_id` (a seat's call), created | `principal_index` (an email index, or the `call-seat` index), `person_ciphertext` (the address, or the name in the seat) |
| `presenter_notes` | owner (the account), the document's workspace (`workspace_owner_id`) and `document_id`: one row for each person and document | `body_ciphertext` ([Presenter notes](#presenter-notes)) |
| `workspace_authors` | owner (the workspace), whether this address made the workspace (`made_workspace`) | `email_index`: every address whose name is on something in the workspace, so deleting that account can reach it after it has left |
| `object_gc` | object ID, owner, queued time, attempts, last error | — |

The migration runner adds `schema_migrations`, which records each applied file by name.

Constraints: checked domains `alcove_id128` (22 characters) and `alcove_owner_id` (43 characters), composite
owner-scoped foreign keys, and deferred item-head and parent-revision constraints. Deleting an owner cascades to
everything it owns; deleting an item cascades to its revisions, its calls, its recording and pieces, its
transcript clips, its `note_access` or `meeting_access` rows, everyone's `personal_notes` on it and its `note_additions`, and a
meeting's rings go with it. The `note_access` rows that give an account other people's notes belong to those notes'
organizers, so deleting the account deletes them by its email index, unless another account still signs in with that
address; on the same condition, what it answered in `meeting_access` is cleared, and the invite stays with its
organizer. The `call_rings` rows to its address, in other people's calls, go by their own hash and without that
exception. `object_gc` keeps a plain owner ID with no foreign key, so a failed object delete is still retried after its
account is gone. A workspace's tables hang off its `workspaces` row, which
hangs off its `owners` row, so deleting that owner deletes all of it; `document_access` rows go with their document.
Its `call_id` has no foreign key, because a call belongs to its organizer, a different owner. `presenter_notes` belongs to
both an account and a document, so it goes with either: by `owner_id`, or by its foreign key to `documents`.

## Manifests (encrypted)

| Item kind | Manifest fields |
| --- | --- |
| `profile` | name, email, photo URL, whether it's a demo account (`sample`), the workspace it used last (`recentWorkspace`), preferences (notes default, notes language, summary length, calendar and offline-recording switches, notification choices, pinned note IDs (at most eight, only notes the person has; pins to notes they no longer have are dropped when preferences are read), and groups (a name and up to 50 email addresses each; sharing notes with one carries only its name into the note)), colleagues invited to Alcove |
| `meeting` | title, start, end, guests (email addresses), notes (`on`/`off`), code, status (`scheduled`/`live`/`ended`), the workspace it uses and its agenda there (`workspaceId`, `agenda`: IDs only), duration, note ID (the latest, when it was held more than once; each note names its meeting), when it's on a calendar the Google Calendar event ID and link, whether the event was the organizer's own before it became an Alcove call (adopted), and for a call in a series that repeats, the recurring event it's an occurrence of (`master`), the series it's in (`seriesId`), when that series repeats its link's code (`seriesCode`), for an occurrence of a recurring Google event, that event's ID (`recurringEventId`), which guests were added by being let in from the call's link (`addedFromLink`), once any were, whether it was started now rather than scheduled (`instant`), what the notes keep (`choices`), whether everyone joins muted (`joinMuted`), the documents brought to it by ID, the times offered, until someone picks one (`offer`: the start and end are then those of the first), and while Google is being asked for its event, until when it's claimed for that (`placing`) |
| `note` | kind (`call`/`room`), title, start, duration, meeting ID, recording ID, status (`recording`/`pending`/`ready`), what was worked on in the call (`workedOn`: document IDs, `kind` and who, read for each person by what they can open), invited emails, when the call ended or the recording stopped (when everyone invited got the note), everyone it was shared with afterwards (each address with who shared it: their account ID, name and email as they were then; the name of their group, when it went to one; and when), summary, decisions (text, time, state `proposed`/`confirmed`/`rejected`/`superseded`, the IDs of the lines it rests on and of any that cut against it, who disputes it, changes), open questions (text, time, state `open`/`answered`, the lines it rests on, changes), action items (text, owner when known, whether they took it on, due date as said, done, the lines it rests on, changes; a change says who (account, name and address), how they had the note, when, and what it was before), chapters, gaps (each stretch of the call with notes off or paused: when, and where it falls in the recording), screens (each shared-screen frame kept: where it falls in the recording and until when, whose share, its size, how legible it was, its title, text (up to 700 characters), regions and what the notes say it shows; the image is in `screen_frames`), transcript (lines with time, speaker when known, the breakout room by name when said in one, text, what the transcript couldn't vouch for (`unsure`: its words, or who said them), and corrections (`changes`: who changed its words or speaker or said it was heard right, when, and what it was before; the first and the latest 19); null while recording), each breakout room's section (its name, everyone who was in it, when it was open, its gaps, its lines with what the transcript couldn't vouch for and their corrections, and its summary, decisions, open questions, follow-ups and chapters), when the notes last read the transcript to write them (`writtenAt`), suggested questions, breakout rooms (kept with the note, so its chapters include them every time the notes are written), and follow-ups ticked during the call whose notes aren't written yet (`ticked`: each one's ID, words, owner and due date, the IDs of the lines behind it, the room it was in, who ticked it and when; empty in a note stored before calls kept them), what its call was set to keep (`keep`: the transcript and the recording) the seconds of audio recorded (`recorded`, saved when the recording stops, null before then and on a note stopped before it was saved), and what this call came back to from earlier ones in its series (`revisits`: a decision it replaced, by this note's decision, or a question it answered, at a moment and breakout room; each names the earlier note and item by their IDs, and says who said the notes got it wrong, when someone did) |
| `connection` | provider (`google`), the Google refresh token, the scopes granted, when it was connected |
| `series` | a series that was scheduled to repeat: title (the one its calls last got together), how it repeats (`repeat`: the rule, the last day and the organizer's time zone), its link's code, and the recurring Google Calendar event that carries its latest calls, when there is one. Its item ID is the `seriesId` its calls share |

Every save writes a full new revision with a fresh `Krecord` and compare-and-set on the item head
(`409 conflict` if someone else saved first). Reads decrypt the head revision; listing decrypts every live
item of a kind. Earlier revisions stay until the item is deleted: correcting a transcript line or changing a
decision never erases what was there before. The one exception is a note whose call was set not to keep its
transcript: writing its notes deletes every earlier revision, which hold it (`pruneRevisions` in `apps/api/src/vault.ts`).

## Workspaces

A workspace is an **owner**: a row in `owners` with its own root key and a `workspaces` row, so sealing, `owner_id`
scoping and deleting work as they do for an account. It has no `identities` row, session, profile, credits or receipts:
nobody signs in as one, and nothing that reads an account's tables finds it. Nothing lists `owners`. Its `owner_id` stays
on the server; everything outside knows it by `workspace_id`.

Its name and tree are one record, `workspace-state`, under the workspace's key: `name`, and `items`, a map of ID to an
item's `kind` (`document`, `board` or `folder`), `name`, `parent`, `pos`, who made it (`by`: their name and address as they
were, or null when nobody in particular did), `createdAt`, `editedAt`, `trashedAt`, `trashedBy`, `restricted` and
`restrictedBy` (the address of whoever restricted it, when that wasn't its creator). To the tree `kind` is only data: a document and a board are alike, each a row in `documents` that what it holds hangs off, and
nothing here looks inside. A tree is small (at most 5,000 items, and folders at most 32 deep, though nothing that walks one
relies on that: stored data of any depth reads and clears), so one record is enough, and every change is made
under the `workspaces` row's lock, which also serialises changes to its people and who has what: an access check made
under that lock holds until the change commits. The server filters the state for each reader, so nobody is sent a name
they can't open. `pos` is a fractional position, a base-62 string read as a fraction and sorted as plain text, so
something can always land between two siblings without touching either.

**Trash.** `trashedAt` is set on what was sent there; what's in a folder in Trash is there with it, and comes back with
it, except anything that went to Trash by itself earlier. Something restored whose folder isn't in the tree comes back to
the top. A folder takes only what the person sending it there could send by itself: anything they can only read, or can't
see, moves out to where the folder was, the same for deleting it for good, so nobody decides the fate of something they
can't. That goes through the tree once, however much moves. `trash_since` is when the oldest thing there went, so
maintenance finds what's due without opening every workspace. After 30 days it goes for good, as it does at once by Delete
forever: state, then `documents` rows, and what hangs off them. Each workspace is swept in a transaction of its own, and
one that can't be read is logged by its ID and left for next time, so it can't hold up the others.

**What nobody can open.** A restricted document with no creator or restrictor left in the workspace, and nobody it's shared
with, goes to Trash, whenever that happens: someone taken out, an entry removed, a seat ended. Nobody who could decide its
fate can see it, so it isn't deleted then, and it isn't given to anyone. If its creator comes back within 30 days they
find it there and can restore it. Otherwise it goes as anything in Trash does.

**People.** `workspace_members` and `document_access` find people by keyed hash and seal who they are beside it, in the
same row, so taking someone out takes their address with them. `workspace_authors` keeps the hash of every address whose
name is on something here, which is how deleting an account finds a workspace it left long ago. When a sign-in brings an
account a new address, everything under the old hash moves to the new one in that sign-in's transaction, and its name on
what it made follows. A workspace holds at most 1,000 people, a document is shared with at most 500, and an address can
have made at most 100 workspaces. Who can do what is in
[Privacy › Who can open a workspace](privacy-keys-and-sessions.md#who-can-open-a-workspace).

### Documents

What a document or board holds is a Yjs document: a CRDT, so people can type at once, offline or not, and always end up
with the same thing. Browsers exchange binary updates through the API, which seals each and keeps it. Only
`apps/api/src/modules/documentText.ts` knows what's inside one, and it goes by `kind`, so a board says its own words;
everything else below is the same for anything that holds a Y.Doc. A document's blocks are the root fragment `content`,
its comment threads the root map `comments`, and the editor's schema decides the rest.

Yjs trusts what it's given, and what's in a document comes from browsers. So nothing here is taken on trust: an update is
checked before it's stored ([what gets in](#what-gets-into-a-document)), a document is only ever opened in a worker
([opening one](#opening-a-document)), and nothing is deleted until what replaces it is proved to open.

- **Starting.** A new document has its title and first line before anyone opens it, each with an empty text in it: the
  seed, one fixed Yjs update that browsers and the API share (`DOC_SEED` in `@alcove/api`), is written as its snapshot when
  the item is made. A browser that can only read never has to write, two people opening a new document find one title, and
  two people typing there first type in the same text. A board starts with nothing. A
  copy starts from the seed under the workspace's lock, and what the original holds becomes its first update afterwards,
  outside it, one document at a time, with a document's title changed to say what the tree calls the copy.
- **Updates** go up as bytes (`application/octet-stream`), at most 4 MiB each, and are sealed and appended in one
  transaction, under the workspace's row lock for reading (so nothing lands after someone loses access) and the `documents`
  row's lock. `seq` comes from `next_seq` under that lock, so rows commit in order, and whoever has read past a `seq` has
  missed nothing before it. `pg_notify` goes out on commit. An update that arrives twice is known by its clocks and stored
  once, so a retried request does no harm and nothing keeps a receipt.
- **What's sent to whoever opens it** is a state, not the history: the log goes through a Y.Doc, which keeps only that
  something was deleted, so a word someone took out isn't sent to the next person who opens the document. That's also why
  compaction doesn't use `Y.mergeUpdates`, which keeps deleted content. A browser that's been here before says how far it got
  (`after`) and is sent what it's missing the same way, or nothing at all if nothing changed, or everything if a compaction
  has passed the point it got to. Whichever it is, it merges.
- **Compaction.** Past 200 updates or 1 MiB since the last snapshot, the log folds into `document_snapshots` and the rows
  it covers go. All but the newest update: streams are reading that one. The work happens after the update commits and
  outside any lock, because what's in the log up to a `seq` never changes; the row's lock is taken only to swap the snapshot
  in, and only if the snapshot is still the one it started from, so two instances folding at once write one. What it made is
  opened again in the worker, and has to reach everything the log did, before a row is deleted. A row that won't decrypt stops
  it: that may be a key that's wrong, not a row that's bad, and folding past it could lose it for good. A failure is logged
  with its IDs and tried again a minute later: nothing about compaction can fail an update.
- **Versions.** The first update after ten minutes of editing keeps what was there before it, so a version closes a stretch
  of work: a whole state, which opens whatever happens to the log afterwards, sealed in parts of 256 KiB, with who changed the
  document since the last one. Reading one streams those parts in order, so a reader holds one at a time however slowly they
  take them: 8 reads at once on an instance (`DOC_VERSION_READS`), 60 a minute per person, and whoever hasn't taken a part
  within a ping is let go of. One is kept when a call ends too (`keepVersion`, labelled with the call, for History to group by), unless nothing
  changed, and before a restore. A document keeps its newest 200, and no more than 64 MiB of them, though always its newest.
- **Restoring** makes the document what it was, for everyone, as one update like any other. Yjs only moves forward, so going
  back means writing again what was deleted and taking out what was added: what happened since the version is replayed onto
  it and undone, which works for anything a Y.Doc holds, roots included. A block added since is emptied and left, not deleted,
  the way the editor retires one (`@alcove/api/retire`), so words someone typed in it offline bring it back when they arrive.
  What it says now is kept as a version first, and nothing lands between that and the restore: a mark on the row (`held_until`)
  turns updates away with `503` until it's done, and browsers try again, so whatever's undone is in a version. It's a mark and
  not the row's lock because a big document takes a while, and everyone typing would each hold a connection. A restore that
  would leave the document past its limit is refused. The tree's name follows the title, because a browser renames only what
  it types.
- **Size.** A document stops at 16 MiB or 500,000 items (`DOC_ITEMS_MAX`), whichever comes first: a Y.Doc's memory follows how
  many separate pieces it's made of, about 210 bytes each, whatever they come to in bytes. Past either, what's refused is what
  adds to it: new text and new elements, past what the same update takes out (`413 too-large`, and the browser's status says
  `failed`, `too-large`). So a full document can always be made smaller: deleting words, a block leaving the page, which
  writes two small attributes, and joining two lines all go through. A move adds an element, so it waits with everything else
  that adds one. It isn't free of limits, because a new attribute is an item too: at twice either figure only deletes are taken, which nothing but someone doing it on purpose comes near. These
  figures are what could be there, not what is, so a refusal compacts the document, which finds out, and a browser tries
  again by itself. Nobody's words are lost: they stay in the browser that typed them. Deleting always goes through, but only
  frees what Yjs lets go of: words and items go once what holds them does, and a run typed in one go merges, but items
  deleted one by one inside something that stays are tombstones, and still count. Nothing prunes retired blocks in this
  release either, so a document's size follows what's been written to it: see [In a browser](#in-a-browser) for what's kept with
  an eye to that.
- **Reading it on the server.** Nothing on the event loop opens a document, so other modules ask by name: `readDocument(w, id,
  'todos', { kind })`, and `writeDocument(w, id, 'retitle', { name }, { by, callId, holding })`, which goes through the same log,
  so what the server writes reaches browsers as an update. `apps/api/src/modules/documentOps.ts` holds what can be asked: a
  plain function of the document and plain data, one line each, which a worker can import. `searchText` streams everything
  someone can open as blocks of words, one document a line, for searching in their browser, and stops as soon as they can't
  read what's next. Text is one element, `line`, with a `kind`; a block is retired instead of deleted, so an edit landing in one
  is never lost. `isGone` in `@alcove/api/retire` is the one rule for what's on the page, for the editor and the server alike:
  a retired block still holding something reads like any other.
- **What won't open** stops only itself. A row that won't apply or won't decrypt is left out and logged, and the document
  is served without it. One that can't be opened at all, in the time or memory a worker has, is marked closed for five
  minutes (`closed_until`, so a restart doesn't try again, and neither does a tab), with a warning naming the IDs: its
  stream says `closed`, `unavailable`, as its only line. Its versions still read, and restoring one replaces what won't open
  and ends everyone's stream, since there's nothing to merge with. Updates to it are still taken: nothing's refused for a
  document that may only be slow.

### What gets into a document

`apps/api/src/modules/documentFirewall.ts` reads every update before it's stored, byte by byte, and builds nothing from it.
It goes by Yjs's structs and never by what a document means, so a board goes through the same door as a page. Whoever can't
write there hears so first, before anything of it is read. Refused means `400 invalid`, a reason in the log, and no row.

What can be told from the update alone is checked with nothing held, in a worker past 32 KiB:

- Nothing of zero length, no `Skip`, no sub-documents, nothing after the end, values at most 64 deep, and only JSON that
  Yjs can write back. Yjs's own decoder lets several of these past, and a zero-length struct applies, then makes a snapshot
  nobody can read. A `GC` is fine as long as it holds something: a browser sends one when something's made and deleted in
  one transaction.
- At most 200,000 structs, from 256 clients, and 1,024 items with the same left neighbour, which is what makes Yjs's conflict
  scan quadratic. The cap can't be on a shared right neighbour: every key typed mid-line shares one.
- Everything in it can be placed: it's worked through as Yjs would, and anything that waits for what it can't ever have is
  refused, because Yjs would carry it pending for ever, in every snapshot.

What depends on the log is checked under the document's lock, against `document_clients`, without opening the document:

- Structs only for clients this person owns. The first to write as a client has it, and a person is known by every way
  access knows them, so someone who signs in during a call keeps theirs. Nobody can write as someone else, which is what
  a forged clock would need: Yjs would believe it, and everything that client wrote next would vanish.
- Clocks carry on from where a client got to, with no gap, or go over what's there, as a retry does.
- Origins, right origins and parents are clocks that exist, or arrive with this. Deletes reach only clocks that exist.
- A running count of items and of how deep types nest: deleting a type recurses into it, in every browser, so nesting stops
  at 1,024. Depth can't be seen from an update, so it's counted as if everything nested below the deepest thing there, and a
  compaction, which walks the document, puts the figure right.

### Opening a document

Yjs has no limit on what opening a document can cost, and a shape that takes minutes can't always be told from one that
doesn't without the whole document. So every Y.Doc on the server is in a worker thread (`live/docPool.ts`, `modules/documentWork.ts`):
loading, merging, compacting, encoding a `sync`, restoring, searching, and anything `readDocument` or `writeDocument` asks.
Sealed rows go in with the document's key, which is wiped when the job ends, and sealed bytes and plain data come out, so big
records are opened and sealed there too.

There are 2 workers (`DOC_WORKERS`), each job has 20 seconds (`DOC_WORK_MS`), and the first worker, which takes documents past
256 KiB or 50,000 items one at a time, has 320 MiB (`DOC_HEAP_MB`) and the others 96. A worker that runs out of either fails
that one job. It's replaced when it's next needed, and the event loop never noticed. A worker with nothing to do for 30
seconds goes, which gives its memory back, and one that's held a big document goes after a second. At most 256 jobs and 128 MiB can wait, and at most 64 MiB of states can be on their
way to browsers, known from the row before anything's opened: past either, the browser is told to try again.

### Presenter notes

What someone keeps beside a document for presenting it: one `presenter_notes` row for each account and document, sealed
under the account's own keys (state key `presenter-notes:<documentId>`, record kind `presenter-notes`, whose header binds
the account, the workspace and the document), so nobody else who can open the document can read them, and a record copied to
another row doesn't open. `GET` and `POST /v1/workspaces/:id/documents/:doc/presenter-notes`, for anyone who can open the
document and has an account: someone in a call by its link has nowhere to keep them (`403`). Empty text deletes the row. At
most 20,000 characters.

### In a browser

`DocSession` (`packages/api-http`) owns the `Y.Doc` and runs the same in a browser and in Node. Edits gather for 150 ms and go
one request at a time, the oldest first, as much as fits in one; a retry only ever repeats what the API may not have.
Nothing typed is let go of until the API has it, and with a `keep` store (the app's is sealed under the device key) that
survives a reload: what's kept is applied when the session starts and sent when there's a connection. The stream picks up from
the last `seq` it heard, however it ended, and never moves on from what this browser sent, only from what the stream
said. Being able to only read, or it going to Trash, stops sending until an `access` line says otherwise.

An update that's refused for its size can't hold up what's behind it. A client's clocks have to reach the API in order, so
everything written as that client is stuck with it: the session moves to a new client, and what's written next goes as
usual, unless it builds on what's stuck, which waits too. What's stuck is worked out afresh in a scratch document, a second
after anything changes and every 30 seconds: nothing's keeping what was deleted for undo there, so a paste that's been undone
or cut down is a small thing now, and goes in place of everything that was waiting. That holds through a reload. An update
Alcove refuses outright (`rejected`) is worked out afresh once, in case it's a gap in what was kept, and then let go of: what's on
screen stays for someone to copy, and a reload starts from what Alcove has. A browser shouldn't ever see this.

`KeptUpdate` says when each edit was made (`at`). Nothing reads that yet: retired blocks can't be pruned while someone may
still be offline with words for one, and nothing in this release prunes them or limits how long someone can stay offline.
`document()` is async, because Yjs loads with the first document someone opens and stays out of everything else.

### Live traffic

Live traffic is NDJSON down and `POST` up: a guest authenticates with a header, which a browser's WebSocket can't send,
and this way it runs through the same auth, origin check and tests as everything else.

- **The hub** (`apps/api/src/live/hub.ts`). Anything that changes a workspace calls `publish(db, workspaceId, notice)` in its
  own transaction, so `pg_notify` goes out on commit and not on a rollback. Each API instance runs one hub with one
  `LISTEN` connection of its own, made when someone first subscribes, which hands each notice to whoever subscribed to that
  workspace on this instance, its own notices included. A notice carries IDs or something sealed, never anything
  readable, and at most 7,900 bytes. A connection can go quiet without closing, so the hub asks it something every 15
  seconds and gives it 5 to answer. If it goes, or doesn't answer, it comes back by itself, waiting 250 ms up to 5 seconds,
  and everyone subscribed hears `missed`, because notices sent meanwhile are gone. It needs a direct connection to
  Postgres: `LISTEN` doesn't work through a transaction-mode pooler.
- **How many.** `hub.admit` counts each person's open streams on each instance, with one limit for each kind of stream: 8
  of a workspace and 8 of documents. All of them from one client address stop at 64 (`LIVE_STREAMS_PER_ADDRESS`), because
  accounts are free, which is about 32 people behind one office's address with a workspace and a document open, and everyone's together at 500 an instance (`LIVE_STREAMS_MAX`), because each holds one of the requests
  an instance can take at once, and rings and calls need them too. The next is refused with `503 unavailable` rather
  than closing the oldest, so a stream at work is never taken from anyone, and that's decided before anything is read. The
  browser tries again by itself and gets in when one closes.
- **A workspace's stream** (`GET /v1/workspaces/:id/live`). Lines: `tree`, whole, first and whenever what this reader sees
  changes; `presence`, everyone here that they can know of, whole, whenever that changes; `access`, when their role changes,
  just before the `tree` that shows it; `ping`, every 25 seconds; `closed`, when
  they can't open it any more, and it ends. Every stream of a workspace on an instance shares one subscription and one
  read of each change, for the streams behind it: `version` moves on with every change to the tree or to who has what, and
  a notice that finds nobody behind stops at that one small query. The read takes the state and what those readers have,
  under keys opened for it and not kept. Each stream then works out what its reader sees, and sends nothing if that's what
  they last saw, which it knows from a hash: a stream holds no tree, because a copy for each is what runs an instance out of
  memory. A slow browser skips to the latest.
- **A document's stream** (`GET /v1/workspaces/:id/documents/:doc/live?after=<seq>`). First `sync`: what this browser
  doesn't have as one update, the `seq` that reaches, and what they can do. Then `update`, in order; `awareness`; `access`,
  when their role changes or it goes to Trash or comes back; `ping`; and `closed`, saying why it's over: `access`, `deleted`,
  `session` or `unavailable`. Up: `POST …/updates` and `POST …/awareness`. A notice is `<document>:<seq>`, and each is read once on
  each instance, by the document's room, which keeps the lines not everyone has been told, each made once. Rows are read before
  how far the snapshot reaches, and it's the rows that say what a compaction took: seqs have no gaps until one makes them, and
  anyone who hadn't been told what's gone starts again from where they got to. A stream keeps only its place: nothing of
  the document stays with it once its `sync` is written, so 500 of them cost little. A stream that falls more than 256
  updates or 1 MiB behind is let go of, and its browser picks up from its last `seq`. Hearing that the hub missed something
  reads again from there too. Someone who loses a document hears nothing written after that: a change to who has what
  that was heard first is settled before the update behind it is read.
- **Carets** (awareness) are never stored. A browser's state goes up at most every 100 ms and travels through a notice sealed
  under the workspace's key, at most 4 KiB, and every instance passes it on. It takes having the document open on that
  instance: a stream hears of every change to who has what, so a caret needs no looking up of its own, and opens no tree. Anyone
  else gets the same `404` as for a document that isn't there, except that someone's own caret can always say it's going. The server writes who it is over `user` in the
  state: `{ id, name, callIdentity }`, an `id` that's a keyed hash, the same for that person everywhere in the workspace, and never
  an address. Nothing a browser says about itself survives that, and a client someone else has been using is refused, so
  nobody can take over another person's caret. Nothing keeps carets for whoever arrives, so someone arriving says so, and
  everyone who hears from someone new says where they are.
- **Presence** is never stored either. Opening a workspace's stream puts a browser here; it says where it is (`POST
  /v1/workspaces/:id/presence`) when that changes and every 10 seconds, which travels sealed the same way, and every
  instance keeps what it hears in memory until it's said again. 30 seconds of silence and it's gone (`LIVE_PRESENCE_MS`), or at
  once when the browser says it's leaving. Someone can only be placed in what they can open, and every change to who has
  what is checked against everyone here. What each reader is told is worked out for them: where someone is if they can open
  it, otherwise `elsewhere`, with the document and block null. Someone outside the workspace hears of nobody who isn't in something
  they can open or in a call with them, and an address goes only between people in the workspace. `callIdentity` goes
  only to people in that call, so a tile can show where someone is. Streams work out who's here at most five times a second.
- **Who's reading is checked again** at every ping, on the clock, however busy the workspace is, from the session and pass
  the stream came with. For a session it's one indexed read and nothing of the workspace; a pass takes the call's state,
  and only people in a call have one. A session or pass that ended, a person out of the call, all end it, within 25 seconds
  at most. A notice about the workspace does it at once. A stream that finds nothing left for its reader first asks who
  they are now, because a new address from their provider moves what they have to another hash.
- **Letting go.** A stream ends without `closed` when the API lets go (after 280 seconds, inside Cloud Run's 300-second
  request timeout, so it's never cut) or its instance shuts down. The browser opens it again: quietly when it just ended,
  showing `reconnecting` when it failed, keeping what it last showed either way. A line that can't be written within a ping
  ends a stream too, which is how one whose browser went as it opened is let go of. A browser that hears nothing for a
  minute takes the connection for dead.

## Writes, reads and deletes

- **Audio pieces** are sealed with the recording's `Krec`, written to the object store, read back and checked
  (length and SHA-256), and only then recorded in SQL, holding the recording's row: one that arrives once the
  recording has stopped is refused. A failed, refused or duplicate write queues the object for deletion.
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
- **Live notes** are sealed in `call_notes`, one row for each view of each part of the call that has had some, opened with
  every read of the call and written at most every 30 seconds and with each tick. A refresh is claimed and saved under the row's
  lock and runs with nothing held, so the model's answer never holds up the call. When the call ends, what was ticked
  moves into the note's manifest and the rows go, in the same transaction
  ([Notes and inference › Live notes](notes-and-inference.md#live-notes)).
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
  recurring event, the recurring event's ID. A series that repeats is one recurring event: each call keeps its
  occurrence's ID and which recurring event that is, and the series keeps the event that carries its latest calls.
- **Busy times** (`POST /v1/calendar/busy`) are read when the app asks, from Google, from the account's own calls,
  or for a demo account from `apps/api/src/demo.ts`, and go nowhere else: no row, no receipt, and in the logs only
  how many ([Privacy › Google sign-in and calendar access](privacy-keys-and-sessions.md#google-sign-in-and-calendar-access)).
- **Documents** brought to a call are IDs in its meeting manifest, checked against the organizer's own library when it's
  scheduled, or against what the person bringing one can open in the call. A demo account's library is a catalog in
  `apps/api/src/demo.ts`, and anyone else's is empty until the library reads workspaces.
- **The workspace a call uses** is in its meeting manifest (`workspaceId`), with its `agenda`, as IDs. What goes on in it
  during the call is in the call's sealed state (`workspace`: who's asking, what's presented and playing, and what's been
  worked on and by whom), and goes when the call ends: what was worked on into the note, if there is one, and nowhere else
  ([Calls and recordings › The call's workspace](calls-and-recordings.md#the-calls-workspace)).
- **Series.** What a series carries over isn't stored: it's read on each request from the meetings that share its
  ID and the notes the reader has ([Notes and inference › Series](notes-and-inference.md#series)). What a later call
  came back to is in that later note's manifest (`revisits`), and notes written before it read as having none. One scheduled to
  repeat has a `series` item for what belongs to no single call, and a `call_codes` row of its own, which goes
  when its item does. The item goes in the same transaction as its last call, however that call went. Calls that
  follow on from each other in older ways have no item.
- **Taking turns.** A change to a series goes to Google and back, which is too long to hold a row lock: it would
  stop the account's audio uploads, which update the same `owners` row. So `owners.series_turn_until` says one is
  under way. Each change sets it for two minutes if it's free and clears it when it's done, unless it's no longer the
  time that change set: one that took longer lost its turn, and the next one's stays. A second change waits up to 20
  seconds, and it runs out by itself if the process dies.
- **Someone's own notes** are a sealed record for each person and note, written whole under an advisory lock on the
  two, so one person's changes take turns without waiting on any row. They hold pointers, never what's pointed at, and
  what's in them is read for that person each time
  ([Notes and inference › Your own notes](notes-and-inference.md#your-own-notes)).
- **Finding people.** Sign-in looks up `identities` by subject index; people search and the team directory
  check `identities.email_index`; shared notes are found through `note_access.email_index`
  ([Privacy › Blind indexes](privacy-keys-and-sessions.md#blind-indexes)).
- **Who's invited to a call** is its guests, and `meeting_access` mirrors them by hash so people can find it from
  their own accounts: the rows change in the transaction that changes the guests, and any that don't match (calls
  from before the table) are put right when the organizer reads Upcoming. Upcoming, for someone invited, is those
  rows opened with each organizer's keys, each organizer's read together, for the next 90 days; a call that's over has
  lost its rows, or loses them as they're read
  ([Privacy › Who can see a call](privacy-keys-and-sessions.md#who-can-see-a-call)).
- **Who has a note** is its organizer and everyone with a `note_access` row for it. The note's manifest says how
  each of them got it (invited, or shared by whom, with which group, when), and each reader is told their own
  way as `received`. Every reader's list of notes also carries each share to a group (`groupShares`: who, the
  group's name, the latest time), and the addresses of whoever got it afterwards (`sharedWith`), so a share is never
  counted as having been on the call, both worked out from the same recipients. Someone who removed the note from
  theirs has no row, so isn't listed, and a share to a group nobody still holds drops out; sharing with them again
  gives it back.
- **Deleting** is physical, whether it's a note, a meeting or a whole account: rows, receipts and objects
  (see [Privacy › Deletion](privacy-keys-and-sessions.md#deletion)). A deleted account leaves no row keyed by
  its ID, except an `object_gc` entry until maintenance deletes an object the store refused.
- **Credits used this month** are summed from the sealed billing history when the balance is read
  (`GET /v1/credits`): nothing about usage is stored in the clear ([Payments and usage](payments-and-usage.md)).

## What's kept, and for how long

Everything, unless the call was set not to keep its transcript or its recording ([Notes and inference › What's kept,
and for how long](notes-and-inference.md#whats-kept-and-for-how-long)):

- **Speech clips** are never stored: each lives in the API process's memory while it's transcribed.
- **`transcript_clips` and `transcript_translations`** last while the recording runs and are deleted in the
  transaction that stops it; the lines move into the note.
- **`call_mls`** lasts while the call runs and is deleted when it ends. **`call_notes`** too, once what was ticked is in
  the note, and upkeep deletes any left by a call a release from before them ended.
- **`meeting_access`** lasts until a call is over: its rows go in the transaction that ends it, and for a call nobody
  held, the first time its organizer or someone invited reads it after it's an hour past its time. They go with the
  call too if it's cancelled or its organizer's account is deleted. A call started again has its rows back.
- **`call_rings`** lasts at most as long as the call, and goes sooner when someone rung comes in or the organizer
  stops ringing them. In a call that goes on that long, a ring goes a day after it ran out.
- **The recording** (`recording_pieces` and their objects), **shared-screen frames** (`screen_frames` and their
  objects), **the note and every revision of it** (transcript, notes, corrections and who made them) are kept
  until the organizer deletes the note. Then everything goes in
  one transaction, and the objects after it (failed deletes retried from `object_gc`).
- **A call set not to keep its recording** deletes its `recording_pieces` rows in the transaction that ends the call,
  once the note has what was worked out from them, and the objects after it. The `recordings` row stays, for its key.
- **A call set not to keep its transcript** empties it in the revision that writes the notes for the first time, the
  main room's and every breakout room's, and deletes every earlier revision and the account's receipts in the same
  transaction. A part whose notes can't be written keeps its lines until they are.
- **Questions, answers and catch-ups** are never stored, unless someone keeps an answer in their own notes.
- **Someone's own notes** (`personal_notes`) last while they have the note: they go with the note, when they remove it
  from theirs, with their account, and at the end of the call if they were taken off the invite.
- **What's added to the shared notes** (`note_additions`) lasts until it's taken back, the note goes or its author's
  account is deleted. It stays when its author removes the note.
- **What's in a workspace's Trash** stays 30 days, unless someone deletes it for good first.
- **A document's log** lasts until it compacts, past 200 updates or 1 MiB; what was deleted goes then. **Its versions** last
  until the document does, or until newer ones push them out: the newest 200, up to 64 MiB.
- **Carets and presence** are never stored: they're in Postgres's notice queue for as long as it takes to deliver them, sealed,
  and in the API process's memory.
- **Seats** in `document_access` last while their call does.
- **What a call keeps of its workspace** (who's asking, what's presented and playing, what's been worked on) lasts while the
  call does. What was worked on goes into its note, and a call with notes off keeps only the versions. Asking Alcove about a
  selection keeps nothing.
- **Presenter notes** last until their author empties them, or the document, the workspace or the account goes.

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
