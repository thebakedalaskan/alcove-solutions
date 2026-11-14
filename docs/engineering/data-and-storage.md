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
| `owners` | `owner_id`, `stored_bytes` (what's stored sealed for it: an account's call audio, shared screens and room recordings, or a workspace's files; an account's storage is its own and those of the workspaces it pays for, [Plans and usage](plans-and-usage.md#storage)), `version`, `created_at`, `series_turn_until` (set only while a change to one of the account's series goes through, so changes take turns; [below](#writes-reads-and-deletes)) | `root_envelope_v2` (`Kowner` under `KMASTER`; null on rows from before the TEE until they're wrapped again, migration `0029_tee_keys.sql`), `root_envelope` (`Kowner` under the old master, while one is held; null on accounts made after it's retired), `root_check` (HMAC). An account or a [workspace](#workspaces) ([Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing)) |
| `identities` | owner, created and last used | `subject_index` (primary key), `email_index` (the provider's current email, updated at each sign-in) |
| `sessions` | owner, provider (`google`, `microsoft`, `sso`), created, last seen, expiry | `session_hash` (SHA-256 of the cookie's ID) |
| `items` | owner, item ID, `kind` (`profile`, `meeting`, `note`, `connection`, `series`), current revision, `deleted_at`, `version` | — |
| `revisions` | owner, item, revision, parent revision, `created_at` | `key_envelope`, `manifest_ciphertext` |
| `operations` | owner, operation ID, method, completion time | `request_commitment` (HMAC), `result_ciphertext` |
| `transcript_clips` | owner, note item, when it was heard (so a live view, and the next clip's language and prompt, read only the newest clips; the recording's pieces already show when it was recorded) | `clip_tag` (keyed hash of the clip's segment, start and speaker), `clip_ciphertext` (its segment; in a call, the participant ID of whose speech it was; its transcript lines, each with when it starts and ends, the participant ID of who said it, the breakout room it was said in, if any, while rooms were open who may read it, when it was said, and whether Whisper was unsure of its words; the evidence of the verified model that heard them; the language Whisper picked for it when sure, and whether it asked Whisper what its speaker speaks. A breakout room's clips stay until the call ends, when every clip moves into the note) |
| `transcript_translations` | owner, note item | `line_tag` (keyed hash of the line and the caption language), `translation_ciphertext` (the line in that language) |
| `content_jobs` | owner, job, revision, kind (`notes`), state (`queued`/`writing`), lease, attempt | `job_ciphertext` (the note and recording IDs, and how far it has got with the shared screens: the frames picked to look at, each with its second, why and the second of the frame before it that it is compared with, and those not to take again, and the verifications its requests went to so far (`evidence`, empty by default), and `was`, the AI model the note had before a rewrite (`{model}`; `null` by default, as on first notes and older jobs, which then leave the model as it is)) |
| `calls` | owner, call, meeting item, `live`/`ended`, start and end, `version`, LiveKit room name (random), the LiveKit identity (random) of the connection that hosts (`host_identity`, `host_joined_at` and `host_left_at`, named before hand-off and kept so: the organizer's connection, or a stand-in's while the organizer is away), when that connection joined and left, locked | `state_ciphertext` (what the call captures: notes off, on or paused, every change with who made it and when, what the host's browser says it can't capture now, the stretches it was out of the call while notes were on, and asks for notes; which connection hosts, when each hosted, and how long a host who let go to move to another device has for its new device to come in; who joined (with the addresses of people signed in whom the notes may go to), when each connection was let in and when it left, whose hand is up, who was removed, spotlight, breakout rooms, who's in which, where each person was before their last move and when they moved, the rooms' messages, each room's MLS epoch and when the organizer paused it or carried on there, when the recording's current segment began, each room's scribes (which connection, from when until when) and everyone who was in it, which the rooms' sections of the note are made from when the call ends, and which stay in the ended call's state, like the rest of it, until its meeting is deleted, whether pointing at shared screens is on and who doesn't let others point at what they share, the latest 200 shares (whose, whether each goes in the notes, when it started and ended), every time a share kept for the notes started or stopped going, the AI model chosen for the notes (`model`), notices, each for everyone, one room, one connection or everyone but one), and where its MLS groups have got to (counters only: the generation, which starts new groups whenever the connection that hosts changes; the main room's epoch, as the API takes one commit per epoch, in order; and the last seq in its log) |
| `call_notes` | owner, call, part of the call (`place`: `main` or a breakout room's random ID), `view` (`all`, or a digest of the random IDs of the lines this view can't read), how many of the note's clips the last refresh counted, when the last refresh began (`looked_at`), and until when one is under way (`lease_until`) | `notes_ciphertext` (that view's live notes as a catch-up gives them, what they read, who may read all of it, each follow-up's ID, the lines behind it, and who ticked it and when, and on `all` what people added by hand; null until the first are written or added) and `lines_ciphertext` (the IDs of the lines it read and when each was said, and when each line it left out was said and who may read it), sealed under the call's notes key, bound to the call, the part and the view. Deleted when the call ends |
| `call_codes` | owner, the item the code leads to (a meeting, or for a series' own link its `series` item) | `code_hash` (keyed hash of the code, so anyone with the link finds the call) |
| `call_moves` | owner, call, move, when it runs out | `secret_hash` (SHA-256 of the move's current secret: the code in the new device's link, then the claim that replaces it), `body_ciphertext` (who's moving, the stage, whether their microphone and camera are on, and the new device's identity, key package and kind, sealed under the call's moves key). Deleted when it runs out, and when the call ends |
| `call_rings` | owner (the organizer), ring, meeting item, when the ring next shows (`deliver_at`), when it stops (`expires_at`) | `email_index` (keyed hash of the address rung, its own purpose), `ring_ciphertext` (the address and what they said, sealed under the call's rings key). Deleted when the person is let in, when the organizer stops ringing them, when the call ends, and a day after it ran out |
| `call_mls` | owner, call, `seq`, MLS group generation, kind (`keypackage`, `commit`, `welcome`, `message`), the random identity a key package came from or a welcome is for, the part of the call whose group an entry belongs to (`grp`: `main` or a breakout room's random ID; none for a key package), epoch | `body_ciphertext` (an MLS message, which the API can't read, sealed again under the call's state key, bound to its place in the log and its part of the call). A breakout room's entries are deleted when it closes; the rest when the call ends, and when a new generation starts (waiting people's key packages carry over) |
| `recordings` | owner, recording, note item, `recording`/`paused`/`stopped`, start (the recording's own, for one made without a connection and uploaded later) and end, `version` | `key_envelope` (`Krec`) |
| `recording_pieces` | owner, recording, segment, seq, where the piece starts in its segment (`at_ms`), object ID, ciphertext SHA-256 and length, duration, codec | (the object) |
| `screen_shares` | owner, recording, share ID (random), whether its presenter put it in the notes (`keep`), when it started and ended (ms into the call, and the recording's segment then) | `meta_ciphertext` (the presenter's participant ID, and who they are as the notes name speakers) |
| `screen_pieces` | owner, recording, share, segment, seq, where the piece starts in its segment (`at_ms`), duration, object ID, ciphertext SHA-256 and length, type | (the object: a piece of a kept share's video, sealed under the recording's key). Deleted once joined into `screen_videos` |
| `screen_videos` | owner, recording, share, segment, chunk, object ID, ciphertext SHA-256 and length, the chunk's plaintext length, the video's length, how many chunks, where it starts in its segment (`at_ms`), duration, type | (the object: at most 4 MiB of the joined video, sealed under the recording's key) |
| `screen_frames` | owner, note item, frame ID, object ID, ciphertext SHA-256 and length | `frame_tag` (keyed hash of the share and the image's digest, so the same image is kept once), `info_ciphertext` (whose share, when, the segment, the frame's size, the moment picked (to a tenth of a second) and why (`reference`, `change`, `question`, `topic`, the share's `start`, or `before`, a frame taken to compare a change with), the words that picked it, what the vision model read on it (how legible it was, its title, its text, what it shows (`shows`) and what changed since the frame before it (`changed`), and its regions), how much it matters, which model read it, and the frame on a 48 × 27 grey grid (`grid`, base64; null on rows from before it was kept) for telling whether the screen changed), and the object (the JPEG, sealed under the recording's key) |
| `note_access` | owner (the organizer), note item, role (`invited`/`shared`), created | `email_index` |
| `meeting_access` | owner (the organizer), meeting item | `email_index` (keyed hash of the address, with a purpose of its own), `answer_ciphertext` (whether they're coming, padded to one length, under the meeting's answers key; null until they answer), `proposal_ciphertext` (the time they've asked to move the call to, under the same key; null until they ask, and again once the organizer answers or the call moves; migration `0028_meeting_proposals.sql`) |
| `personal_notes` | owner (the author), the note's organizer and item: one row for each person and note | `body_ciphertext` (everything they keep on it: what they wrote, bookmarks and what they point at, kept questions and answers, and which of it was added to the shared notes), sealed under the author's own keys. Replaced with each change, with no earlier versions |
| `note_additions` | owner (the note's organizer), note item, addition ID, when it was added | `author_index` (keyed hash of who added it, so deleting their account finds their additions on anyone's notes), `body_ciphertext` (the words, who added it, and the lines or shared screens it points at), sealed under the organizer's keys |
| `note_links` | owner (the note's organizer), note item, link ID, when it runs out | `secret_hash` (SHA-256 of the link's secret, which is only ever in the link's fragment and a POST body), `maker_index` (keyed hash of who made it, so removing the note from theirs or deleting their account finds their links), `body_ciphertext` (who made it, as they were, and when), sealed under the organizer's keys. Deleted when it's revoked, once it's run out (upkeep), with the note, and with its maker's access or account (migration `0025_note_links.sql`) |
| `billing_accounts` | owner, `version` | `state_ciphertext` (the credits balance and history of before plans, under `Kservice`). No longer read: it goes in a later release |
| `plan_accounts` | owner, `version`, when upkeep next looks at it (`due_at`: a grace ending, Pro's end to be told, Pro ending) | `state_ciphertext` (a `plan-account` record under `Kservice`'s accounting key: the balance in micro-USD and its history, where Free's periods count from, whether the account hasn't been shown the plans yet, the grace it's in, if any, the months of Pro bought and what each cost, whether renewing is on, the latest 20 notices about its plan (and for a workspace whose payment moved to it, that workspace's ID, never its name) and whether each was dismissed, and which end of Pro upkeep has reminded about, a week before and again a day before, and handled). Migration `0031_plans.sql` ([Plans and usage](plans-and-usage.md)) |
| `ai_meters` | owner (nothing counts its changes: that would count the account's AI requests) | `state_ciphertext` (an `ai-meter` record under the same key: the period's AI allowance in dollars, what's been spent and on which kinds of request, the requests in flight and live calls' notes that hold some of it, and when it ran out). Kept apart from `plan_accounts` so the many small charges of a live call never wait behind a purchase |
| `teams` | `team_id` (the public handle, Id128), its own owner row (its key seals its name and who's on it, as a workspace's does), `admin_owner_id` (whoever made it), `version`, when upkeep next looks at it (`due_at`: a license ending, its pool's grace ending), created. Migration `0033_teams.sql` ([Plans and usage › Team](plans-and-usage.md#team)) | `name_ciphertext` (a `team-name` record under the team's state key `team`), `billing_ciphertext` (a `team-billing` record under `Kservice`'s accounting key: the unconsumed licenses and what each cost, auto-purchase and what a license last cost the team, whether the admin has been told licenses are low or gone, and the pool as last reckoned with its grace) |
| `team_members` | `member_id` (what the API calls them), team, `account_owner_id` (unique: one team for each account), role (`admin`/`member`), when their license runs (`licensed_from`, `licensed_until`), when they last needed one and none was there (`wanted_at`), created | `person_ciphertext` (a `team-member` record under the team's key: their name and address, as their account has them, so a sign-in that brings a new name or address changes it) |
| `team_invites` | `secret_sha256` (SHA-256 of a one-time link's secret, which is only ever in the link's fragment and a POST body), team, `expires_at`, created. Deleted when used, and by upkeep once expired | — |
| `invite_links` | `secret_sha256` (SHA-256 of an account's own invite link's secret, which is worked out from its root key and never stored: [Privacy › Invite links](privacy-keys-and-sessions.md#invite-links)), owner (unique: one link for each account, deleted with it), created, updated. Migration `0037_invite_links.sql` | `from_ciphertext` (an `invite-link-from` record under the key the link's secret makes: who it's from, their name, address and photo) |
| `invite_link_joins` | the link (`secret_sha256`), when they joined: an account made from the link that said so, once for each link. Deleted with the link, and with the joiner's account | `joiner_index` (blind index `invite-joiner` of the joiner's account ID), `who_ciphertext` (an `invite-link-join` record under the link's key: their name, address and photo then) |
| `team_notes` | owner (the note's organizer), note item, team, created: a note its organizer made visible to their team. Stays after they leave it; goes with the note or the team | — |
| `deposits` | owner, deposit, provider (`oneclick`), state (`waiting`/`arriving`/`short`/`credited`/`held`/`failed`/`expired`/`cancelled`), created, when to check next (`check_after`), last checked, when to give up | `record_ciphertext` (a `deposit` record under `Kservice`'s accounting key, below) |
| `workspaces` | owner, `workspace_id` (the public handle, Id128), `version`, when the oldest thing in its Trash went there (`trash_since`), created, `payer_owner_id` (the account its files count against, and whose plan pays for its AI: its longest-standing admin with an account, so whoever made it, and for a call's home its organizer, whoever's action made it; null while none of its admins has an account), `payer_grace_until` and `payer_grace_bytes` (while payment moved from someone who left it runs its grace: until when, and what it held then), migration `0032_workspace_payers.sql`, filled by `0034_workspace_payers_backfill.sql`; `team_id` and `team_access` (`team`: every licensed member; `added`: only the people added; both null on any other workspace), migration `0033_teams.sql` | `state_ciphertext` (its name, tree and line on what it's for: [Workspaces](#workspaces)) |
| `workspace_members` | owner (the workspace), `member_id` (what the API calls them), role (`admin`/`edit`/`read`), created | `email_index`, `person_ciphertext` (their address, their name if the workspace was made by them, and whether a call's invite put them there and nobody has changed their place by hand since: older records read as not) |
| `documents` | owner (the workspace), `document_id`, `next_seq`, what it comes to in bytes, items and depth of nesting at its snapshot and since (`snapshot_bytes`, `bytes_since_snapshot`, `snapshot_items`, `items_since_snapshot`, `snapshot_nesting`, `nesting_since_snapshot`), how many of its items aren't on its page (`snapshot_retired_items`), `updates_since_snapshot`, how far the newest version reaches and when it was kept (`version_seq`, `version_at`), until when something's restoring it (`held_until`) or it stays closed because it wouldn't open (`closed_until`), created. One row for each document or board in the tree; a folder has none | — |
| `document_updates` | owner (the workspace), document, `seq`, how much it adds in `bytes`, `items` and `nesting`, `deletes_tag` (a keyed hash of what it deletes, so the same deletes again cost no row), created | `update_ciphertext` (one Yjs update and who sent it: [Documents](#documents)) |
| `document_clients` | owner (the workspace), document, `client_id` (a Yjs client: a random number), `next_clock` (how far it's written). Kept as long as the document | `people`: keyed hashes of who it belongs to, by every way access knows them and by their account, each bound to this client and document, so no two rows can be linked. Empty for what the server wrote |
| `document_snapshots` | owner (the workspace), document, `through_seq`. One row a document | `snapshot_ciphertext` (its Yjs state through that seq), `editors_ciphertext` (who has edited it since the last version) |
| `document_versions` | owner (the workspace), document, `version_id`, `bytes`, how many `parts`, created | `info_ciphertext` (who changed it, the call it was kept in, why it was kept) |
| `document_version_parts` | owner (the workspace), document, version, `part` | `state_ciphertext` (256 KiB of its whole Yjs state) |
| `document_access` | owner (the workspace), document, `access_id` (what the API calls the entry), `kind` (`email`/`seat`), role (`edit`/`read`), `call_id` (a seat's call), created | `principal_index` (an email index, or the `call-seat` index), `person_ciphertext` (the address, or the name in the seat) |
| `workspace_calls` | owner (the workspace), `call_id`, created: a call that opens the workspace to everyone in it while it uses it, one row for each workspace a call has used, until the call ends or its organizer's account is deleted ([Privacy › Who can open a workspace](privacy-keys-and-sessions.md#who-can-open-a-workspace); migration `0026_workspace_calls.sql`) | `call_index` (the `call-workspace` index of the call and this workspace, which everyone in the call carries while the call uses it), `organizer_index` (the email index of the call's organizer, moved with a new address from their provider: the row counts only while they can edit here, and the workspace's payer is the account the call is kept in) |
| `presenter_notes` | owner (the account), the document's workspace (`workspace_owner_id`) and `document_id`: one row for each person and document or board they kept notes beside with an earlier release. Nothing reads or writes it now | `body_ciphertext` ([Presenter notes](#presenter-notes)) |
| `timer_presets` | owner (the account), `preset_id`, created: timer presets an earlier release kept. Nothing reads or writes it now. Its rows stay, unread, while the previous release may still serve (during a deploy, or after a rollback, when it can still write one); a later migration drops the table, rows and all, once that release is gone. Deleting an account deletes its rows meanwhile | `ciphertext` (a preset's name, segments and presenters, sealed under the account's own keys) |
| `presenter_frame_notes` | owner (the account), the board's workspace (`workspace_owner_id`), `document_id` (the board) and `frame_index` (a keyed hash of the frame under the account's key): one row for each person and frame they keep notes beside | `body_ciphertext` (the frame and what's kept beside it, [Presenter notes](#presenter-notes)) |
| `workspace_authors` | owner (the workspace), whether this address made the workspace (`made_workspace`) | `email_index`: every address whose name is on something in the workspace, so deleting that account can reach it after it has left |
| `workspace_media` | owner (the workspace), `media_id`, `state` (`uploading`/`ready`), what its pieces take up so far (`bytes`), how many pieces the whole file comes to (`pieces`), created | `info_ciphertext` (its name, type, size and dimensions: [Media](#media)) |
| `workspace_media_pieces` | owner, media, `seq`, object ID, the object's SHA-256 and length | (the object: a sealed piece of the file) |
| `workspace_media_previews` | owner, media, object ID, the object's SHA-256 and length. At most one a file, and none for a picture from before previews (0016) | (the object: a sealed small JPEG of the picture) |
| `workspace_media_uses` | owner, media, document: which documents and boards have a file | — |
| `media_upload_days` | owner (an account), `day` (UTC), `bytes`: what it uploaded to workspaces that day, for the limit on a day ([Media](#media)) | — |
| `media_guest_upload_days` | `guest_index`, `day` (UTC), `bytes`: what a guest in a call uploaded that day, for the same limit ([Media](#media)) | `guest_index`, a blind index of the person the guest's pass names |
| `media_others_days` | the payer (an account), the uploader (an account), `day` (UTC), `bytes`: what someone signed in added that day to another account's storage, for `media.others_day_bytes` ([Media](#media)); migration `0032_workspace_payers.sql` | — |
| `media_guest_payer_days` | the payer (an account), `day` (UTC), `bytes`: what guests in its calls added that day to its storage between them, for `media.guests_day_bytes`; migration `0032_workspace_payers.sql` | — |
| `service_limits` | `name`, `value`, `updated_at`: a limit changed while the service runs, which overrides its default ([Deployment › Changing a limit](deployment-and-acceptance.md#changing-a-limit)). Numbers only | — |
| `feature_flags_everyone` | `name`, `updated_at`: a feature flag switched on for everyone ([Feature flags](feature-flags.md)) | — |
| `feature_flag_groups` | `name`, created: a hand-picked group for feature flags, an operator's label such as `staff` | — |
| `feature_flag_group_members` | group, `email_index`, created: who's in a group | `email_index`, the blind index of their address, with flags' own purpose (`flag-email`), so it joins to no other table |
| `feature_flag_group_grants` | `feature_flag`, group, created: a feature flag switched on for a group's members | — |
| `feature_flag_person_grants` | `feature_flag`, `email_index`, created: a feature flag switched on for one person | `email_index`, the blind index of their address, with flags' own purpose (`flag-email`) |
| `object_gc` | object ID, owner, queued time, attempts, last error | — |
| `server_keys` | `id` (`master` or `bundle`: two rows at most), created, updated | `record`: for `master`, the TEE's master as Cloud KMS wrapped it; for `bundle`, the server keys the TEE runs with (the index and photo token keys, `KSERVICE` and the old master until it's retired), sealed under that master as a record of kind `server-keys` ([Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing), migration `0029_tee_keys.sql`) |
| `tls_certificates` | `id` (`current`: one row at most), `chain_pem` (the certificate the edge serves, chain and all, as the ACME CA issued it: it names the TLS hosts and the TLS key's public half), `not_after`, updated. A certificate is public, and Certificate Transparency logs publish it anyway, so it's kept in the clear ([System architecture › The edge](system-architecture.md#the-edge), migration `0030_tls_certificates.sql`) | — |
| `operator_nonces` | `nonce` (16 random bytes, base64url), `key_id` (the signing key's fingerprint), `seen_at`: each signed operator request's nonce, so a request is used once on any instance; upkeep deletes one after 10 minutes (`apps/api/src/http/operator.ts`, migration `0035_operator.sql`) | — |
| `operator_credits` | `key_id`, created: each credit support made through the operator route, so a ticket adds money to an account by its ID once, and a key's credits in a UTC day are counted on any instance (two at most) | `digest`: a keyed hash of the account's ID and the ticket's reference, or, for a credit by a top-up's reference, of the top-up. No amount and no account ID are kept (migration `0035_operator.sql`) |
| `operator_grants` | `key_id`, created: each plan support gave an account through the operator route, as Alcove ([Plans and usage › Support](plans-and-usage.md#support)), so a ticket gives an account a plan once, and a key's grants in a UTC day are counted on any instance (five at most) | `digest`: a keyed hash of the account's ID and the ticket's reference. No account ID, kind, months or licenses are kept (migration `0036_operator_grants.sql`) |

The migration runner adds `schema_migrations`, which records each applied file by name.

Constraints: checked domains `alcove_id128` (22 characters) and `alcove_owner_id` (43 characters), composite
owner-scoped foreign keys, and deferred item-head and parent-revision constraints. Deleting an owner cascades to
everything it owns; deleting an item cascades to its revisions, its calls, its recording and pieces, its
transcript clips, its `note_access` or `meeting_access` rows, everyone's `personal_notes` on it, its `note_additions` and `note_links`, and a
meeting's rings go with it. The `note_access` rows that give an account other people's notes belong to those notes'
organizers, so deleting the account deletes them by its email index, unless another account still signs in with that
address; on the same condition, what it answered and asked in `meeting_access` is cleared, and the invite stays with its
organizer. The `call_rings` rows to its address, in other people's calls, go by their own hash and without that
exception. `object_gc` keeps a plain owner ID with no foreign key, so a failed object delete is still retried after its
account is gone. A workspace's tables hang off its `workspaces` row, which
hangs off its `owners` row, so deleting that owner deletes all of it; `document_access` and `workspace_media_uses` rows go
with their document, and a file's pieces and uses with its `workspace_media` row. `document_access.call_id` and
`workspace_calls.call_id` have no foreign key, because a call belongs to its organizer, a different owner.
`presenter_notes` and `presenter_frame_notes` belong to both an account and a document, so they go with either: by
`owner_id`, or by their foreign key to `documents`.

## Manifests (encrypted)

| Item kind | Manifest fields |
| --- | --- |
| `profile` | name, email, photo URL, whether it's a demo account (`sample`), preferences (notes default, notes language, the summary length an earlier release let people choose (still written as it was, unread, because the release before opens a profile only with it, and still sent with the preferences, which its app reads only with it; both go in the next release), calendar and offline-recording switches, notification choices, pinned note IDs (at most eight, only notes the person has; pins to notes they no longer have are dropped when preferences are read), groups (a name and up to 50 email addresses each; sharing notes with one carries only its name into the note), and the AI model chosen by default (`model`, null for the default model; profiles written before hold it as `screenModel`, read as `model`)), colleagues invited to Alcove |
| `meeting` | title, start, end, guests (email addresses), notes (`on`/`off`), code, status (`scheduled`/`live`/`ended`), the workspace it uses and its agenda there (`workspaceId`, `agenda`: IDs only), duration, note ID (the latest, when it was held more than once; each note names its meeting), when it's on a calendar the Google Calendar event ID and link, whether the event was the organizer's own before it became an Alcove call (adopted), and for a call in a series that repeats, the recurring event it's an occurrence of (`master`), the series it's in (`seriesId`), when that series repeats its link's code (`seriesCode`), for an occurrence of a recurring Google event, that event's ID (`recurringEventId`), which guests were added by being let in from the call's link (`addedFromLink`), once any were, whether it was started now rather than scheduled (`instant`), what the notes keep (`choices`), whether everyone joins muted (`joinMuted`), the documents brought to it by ID, the times offered, until someone picks one (`offer`: the start and end are then those of the first), and while Google is being asked for its event, until when it's claimed for that (`placing`) |
| `note` | kind (`call`/`room`), title, start, duration, meeting ID, recording ID, status (`recording`/`pending`/`ready`), what was worked on in the call (`workedOn`: document IDs, `kind` and who, and for a board open for everyone the part of the call it was open in, `open`, null in a note stored before boards were noted; read for each person by what they can open), invited emails, when the call ended or the recording stopped (when everyone invited got the note), everyone it was shared with afterwards (each address with who shared it: their account ID, name and email as they were then; the name of their group, when it went to one; and when), summary, full summary (`details`; empty until written), decisions (text, time, state `proposed`/`confirmed`/`rejected`/`superseded`, the IDs of the lines it rests on and of any that cut against it, who disputes it, changes), open questions (text, time, state `open`/`answered`, the lines it rests on, changes), action items (text, owner when known, whether they took it on, due date as said, done, the lines it rests on, where it was written down when that's a board's Actions frame (`from`, null otherwise and in a note stored before), changes; a change says who (account, name and address), how they had the note, when, and what it was before), chapters, gaps (each stretch of the call with notes off or paused: when, and where it falls in the recording), screens (each shared-screen frame the note shows, key ones only and at most one a transcript line: where it falls in the recording and until when, the transcript line it's attached to (`line`; null on notes saved before frames were attached to lines), whose share and which, its size, how legible it was, its title, text (up to 700 characters), what it shows (`shows`, up to 300) and what changed on it (`changed`, up to 200), regions, how much it matters, the words that picked it and what the notes say it shows; the image is in `screen_frames`), the AI model chosen for the note (`model`, null for the default model; read from `screenModel` in older notes), the unencrypted work done on it (`unencrypted`: each model's ID, whether it wrote the notes or read the screens, and when; empty if none), transcript (lines with time, speaker when known, the breakout room by name when said in one, text, what the transcript couldn't vouch for (`unsure`: its words, or who said them), and corrections (`changes`: who changed its words or speaker or said it was heard right, when, and what it was before; the first and the latest 19); null while recording), each breakout room's section (its name, everyone who was in it, when it was open, its gaps, its lines with what the transcript couldn't vouch for and their corrections, and its summary, decisions, open questions, follow-ups and chapters), when the notes last read the transcript to write them (`writtenAt`), suggested questions, breakout rooms (kept with the note, so its chapters include them every time the notes are written), and follow-ups ticked during the call whose notes aren't written yet (`ticked`: each one's ID, words, owner and due date, the IDs of the lines behind it, the room it was in, who ticked it and when; empty in a note stored before calls kept them), what its call was set to keep (`keep`: the transcript and the recording) the seconds of audio recorded (`recorded`, saved when the recording stops, null before then and on a note stopped before it was saved), each segment's seconds of audio by index (`segmentSeconds`, saved then too, so shared screens keep their place once audio the call didn't keep is deleted; empty in a note stored before), and what this call came back to from earlier ones in its series (`revisits`: a decision it replaced, by this note's decision, or a question it answered, at a moment and breakout room; each names the earlier note and item by their IDs, and says who said the notes got it wrong, when someone did) |
| `connection` | provider (`google`), the Google refresh token, the scopes granted, when it was connected |
| `series` | a series that was scheduled to repeat: title (the one its calls last got together), how it repeats (`repeat`: the rule, the last day and the organizer's time zone), its link's code, and the recurring Google Calendar event that carries its latest calls, when there is one. Its item ID is the `seriesId` its calls share |

Every save writes a full new revision with a fresh `Krecord` and compare-and-set on the item head
(`409 conflict` if someone else saved first). Reads decrypt the head revision; listing decrypts every live
item of a kind. Earlier revisions stay until the item is deleted: correcting a transcript line or changing a
decision never erases what was there before. The one exception is a note whose call was set not to keep its
transcript: writing its notes deletes every earlier revision, which hold it (`pruneRevisions` in `apps/api/src/keys/vault.ts`).

## Workspaces

A workspace is an **owner**: a row in `owners` with its own root key and a `workspaces` row, so sealing, `owner_id`
scoping and deleting work as they do for an account. It has no `identities` row, session, profile, plan, balance or receipts:
nobody signs in as one, and nothing that reads an account's tables finds it. Nothing lists `owners`. Its `owner_id` stays
on the server; everything outside knows it by `workspace_id`.

Its name and tree are one record, `workspace-state`, under the workspace's key: `name`; `items`, a map of ID to an item's
`kind` (`document`, `board` or `folder`), `name`, `parent`, `pos`, who made it (`by`: their name and address as they were,
or null when nobody in particular did), `createdAt`, `editedAt`, `trashedAt`, `trashedBy`, `restricted`, `restrictedBy` (the
address of whoever restricted it, when that wasn't its creator) and `call` (on a call's folder only: whose call it is, by
the organizer's owner and address and the call's ID, when it started, whether it's over, and its note's ID once it is); and
`madeFor`, on a workspace made as a call's home: the call's title, when it started, its meeting and series, and `out`, the
addresses taken out of it by hand or that left it, which its invite never puts back (older records take `[]`); and `about`,
the line on what the workspace is for, which its Home says under its name: one line of up to 200 characters, set by an
admin and read by anyone in it, never by anyone outside it (older records take `''`, nothing said). Older records
take `null` for `call` and `madeFor`. To the tree `kind` is only data: a document and a board
are alike, each a row in `documents` that what it holds hangs off, and nothing here looks inside. A call's folder holds no
content of its own: its pages read the call and its note through their own access
([Calls and recordings › The call's home](calls-and-recordings.md#the-calls-home)), and nothing of either is copied here. A tree is small (at most 5,000 items, and folders at most 32 deep, though nothing that walks one
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
with, would be nobody's. When that's because someone was taken out, by an admin or by a call's invite, it's given to the
workspace's admins, to edit, and stays restricted: nobody's words are lost to a change of people nobody made to that document.
When it's because someone left by themselves, or an entry was removed, or a seat ended, it goes to Trash: nobody who could
decide its fate can see it, so it isn't deleted then, and it isn't given to anyone. If its creator comes back within 30 days
they find it there and can restore it. Otherwise it goes as anything in Trash does.

**People.** `workspace_members` and `document_access` find people by keyed hash and seal who they are beside it, in the
same row, so taking someone out takes their address with them. `workspace_authors` keeps the hash of every address whose
name is on something here, which is how deleting an account finds a workspace it left long ago. When a sign-in brings an
account a new address, everything under the old hash moves to the new one in that sign-in's transaction, and its name on
what it made follows. A workspace holds at most 1,000 people, a document is shared with at most 500, and an address can
have made at most 100 workspaces by hand: a home made for a call doesn't count. Who can do what is in
[Privacy › Who can open a workspace](privacy-keys-and-sessions.md#who-can-open-a-workspace).

### Tags

**Who a document names.** A tag, a quote of what was said and a follow-up line carry someone's ID, which everyone with the
document reads, so it's never their address or anything made from it alone. Each is the ID a member has in that workspace,
`HMAC(state key "workspace-person", their address's keyed hash)` under the workspace's own keys, whether they're in it or
not: `POST /v1/workspaces/:id/ids` (`api.workspaces.ids`) gives them for a list of addresses, to anyone in the workspace for
any address, and to someone here only through a call for the people who've been in that call, and leaves out the rest. So
nobody can check a guessed address against an ID in a document without asking the server, as someone who's allowed to, and
the same person has different IDs in different workspaces. Someone in a call with no address is named by their seat, which
is already a keyed hash. What was written before IDs were keyed, an address on a quote or a plain hash of one on a tag, still
finds its face and tells someone a to-do is theirs: the app works those out to read them, and never writes them.

Someone tagged in a document hears about it, on the workspace's stream if they're here, and whenever they're next here if
they aren't. `POST /v1/workspaces/:id/documents/:doc/mentions` (`api.workspaces.mention`) names them by address, or by their seat
in the call you're both in, and the line. It takes someone who can edit that document, and it gives nobody anything: whoever
can't open the document isn't told and nothing's kept, and the answer is the same either way, so tagging can't be used to ask
who has what. Everything happens under the workspace's lock, so nothing's told after either of them loses it.

What's told waits in `workspace_mentions`: the document, the keyed hash access knows them by (their address's if they're
signed in, even when tagged by their seat, so it reaches them after the call), and a sealed `workspace-mention` record of who
tagged them, by name and face, and the line. A notice (`told:<hash>`) wakes only that person's streams, which read what's
waiting, ask access whether they can open each document now, and write the complete authorized set in a `mentions` line.
Opening a stream does the same, so
a tag is heard on arrival, as often as it takes until someone says they've seen it: `DELETE /v1/workspaces/:id/mentions/:id`
(`WorkspaceLive.seen`), which only they can do. Reading a tag publishes the same private notice, so every open stream replaces
its unread set, including with an empty set. Tree changes recompute it too, so losing a document removes its tags.
`GET /v1/mentions` (`api.workspaces.mentions`) is the same across all their
workspaces, with what each document's called, for the side panel's count and the browser's notification.

Nobody hears of a tag in something they can't open now, however long it waited. A tag in something they've lost is deleted when
it's next read, and having it back doesn't bring that back; one in Trash waits to see whether it comes back. Tags go with their
document, when someone's taken out of the workspace, with their account, and after 30 days; 200 wait for one person in one
workspace, the newest. The name of a document is never in the record or on the line: it comes from the reader's own tree.

### Documents

What a document or board holds is a Yjs document: a CRDT, so people can type at once, offline or not, and always end up
with the same thing. Browsers exchange binary updates through the API, which seals each and keeps it. Only
`apps/api/src/features/workspaces/documents/text.ts` and `documentOps.ts` know what's inside one, and they go by `kind`, so a board says
its own words, through `@alcove/board`, which is what knows a board's Y.Doc; everything else below is the same for anything
that holds a Y.Doc. A document's blocks are the root fragment `content`, its comment threads the root map `comments`, and
the editor's schema decides the rest. A board's are its root maps `objects` and `comments` and its list `places`
(`packages/board/src/shape.ts`): a comment thread there is pinned to an object (`on`), stays when it's `resolved`, and each
reply keeps who wrote it, `by` (what they're known by in the workspace, which finds their face) and `name`; a reply from
before replies said who wrote them reads as nobody's. A document links a board by its ID alone, in a `board` block, so its
name reaches only whoever's own list has it.

Yjs trusts what it's given, and what's in a document comes from browsers. So nothing here is taken on trust: an update is
checked before it's stored ([what gets in](#what-gets-into-a-document)), a document is only ever opened in a worker
([opening one](#opening-a-document)), and nothing is deleted until what replaces it is proved to open.

- **Starting.** A new document has its title and first line before anyone opens it, each with an empty text in it: the
  seed, one fixed Yjs update that browsers and the API share (`DOC_SEED` in `@alcove/api`), is written as its snapshot when
  the item is made. A browser that can only read never has to write, two people opening a new document find one title, and
  two people typing there first type in the same text. A board starts with nothing. Its template, when it's started from
  one, is the server's: `writeDocument(w, id, 'boardTemplate', { kind, template, seed })`, with the board's id as the seed,
  puts it on as an update like anyone's, so everyone gets the same frames and nobody's undo can take them away, and only on a
  board nobody has put anything on yet. `kind` has to be what the tree says the item is, as for every operation that takes one,
  or it's refused (`invalid`), so a board's frames never go on a document whatever its caller says. A call's new board is filled
  this way at the end of making it, before the call's row says it's open (`fillBoard`): nobody can know of it until then, so
  whoever opens it finds its template on. It's written as the Yjs client kept for it, `SERVER_CLIENT.template`, 2 on every board.
  What makes it land once is that the server writes only as clients the log hasn't had (`requireNewClients`, below): the first
  fill takes client 2, and every later one finds it taken. So the board itself says whether it has had its template: asking
  again changes nothing, nor does a second ask at the same moment or one after a compaction, a copy of a board carries its
  template and can't have another, and a board put back to before its template doesn't get it back by itself or by asking. Two
  fills worked out at once needn't be the same bytes (a board that had something on it and lost it again hangs the template
  off what it lost), and they don't have to be: only one is ever written. A
  copy starts from the seed under the workspace's lock, and what the original holds becomes its first update afterwards,
  outside it, one document at a time, with a document's title changed to say what the tree calls the copy. A copy holds only
  each map key's last value, since nobody can be behind it. If the workers stay busy it waits about 15 seconds and then
  fails, and the copy is deleted for good, so nobody's left with a blank one that looks like the real thing. A document whose records
  won't open still leaves its copy as it started, and the rest are made all the same.
- **Updates** go up as bytes (`application/octet-stream`), as big as a document can be, and are sealed and appended in one
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
  changed, and before a restore. A document keeps up to 64 MiB of them, the oldest going past that, and always its newest.
  Nothing goes for being one of many: an old version is often the last to hold words deleted since, and telling which would
  mean opening every one, so only the byte budget prunes. Nothing that changes nothing makes a version.
- **Restoring** makes the document what it was, for everyone, as one update like any other. Yjs only moves forward, so going
  back means writing again what was deleted and taking out what was added: what happened since the version is replayed onto
  it and undone, which works for anything a Y.Doc holds, roots included. A block added since is emptied and left, not deleted,
  the way the editor retires one (`@alcove/api/retire`), so words someone typed in it offline bring it back when they arrive.
  What it says now is kept as a version first, and nothing lands between that and the restore: a mark on the row (`held_until`)
  turns updates away with `503` until it's done, and browsers try again, so whatever's undone is in a version. It's a mark and
  not the row's lock because a big document takes a while, and everyone typing would each hold a connection. A restore that
  would leave the document past its limit is refused. The tree's name follows the title, because a browser renames only what
  it types. What's new in it is written as a client the log hasn't had, as everything the server changes is (below), and what
  a version holds that's no longer there goes back as it was written, under whoever wrote it.
- **Size.** What's on a document's page stops at 150,000 items (`MAX_DOC_ITEMS`, `DOC_ITEMS_MAX`), about 37,500 lines, or
  16 MiB. An item is one Yjs struct that isn't deleted and isn't in a retired block, so a line is about four, and a page someone
  emptied has room again. One rule holds at the limit: an update goes in if it doesn't add to what's on the page, counting what
  it adds against what it deletes and retires. So deletes, a block leaving the page, joins and moves all go through, whole, and
  nothing ever needs sending apart; anything that adds is `413 too-large`, and the browser's status says `failed`, `too-large`.
  Bytes go the same way, by what's said on the page, since a move adds a little structure every time. Typing on at the end of
  a line adds bytes and not items, as Yjs merges it into what's there. The figures on the row are the most the page could come
  to, so most updates are judged on those alone; one they can't settle is weighed exactly, by a worker that opens the document
  and applies it (`weigh`). Nobody's words are lost: they stay in the browser that typed them.
- **What it can hold.** Everything a document holds costs memory, on the page or not, so there are ceilings past which only
  deletes are taken: 300,000 items on the page and 32 MiB, which only two updates racing come near, and 450,000 structs in all.
  That third counts what Yjs has to keep: tombstones, retired blocks, and every value a map key has ever had. A value that's
  been overwritten stays a struct for good, at about 350 bytes of memory and 10 stored, and these don't merge across keys, so
  1,000,000 writes to the keys of 5,000 objects left 1,090,000 structs, 95,000 of them live. No compaction can let them go: a
  browser that's behind holds part of a key's chain and needs the rest to find what's current, and given a state without it,
  the key comes back empty. Only a copy, which has nobody behind it, starts without them. So a store that writes the same
  things over and over keeps them in a list, not in map keys: one shared `Y.Array` of entries, where each write deletes the old
  entry and pushes a new one (y-utility's `YKeyValue`). What's deleted there merges, at most one struct a batch: the same
  1,000,000 writes left 2 structs with one person, and about 5,000 with people taking turns. A document that does reach a
  ceiling still opens, and loses nothing, and carries on in a duplicate.

  Measured through the real pool with production's worker limits, with the heaviest kind of item, a nested map, on the page:
  150,000 of them with history up to 450,000 structs folds, opens and copies in 400 MiB, so a document at its limits has more
  than a third of the big worker's 640 MiB (`DOC_HEAP_MB`) to spare. At both ceilings at once, 300,000 on the page and 450,000
  in all, it folds in 640 and not in 480; 600,000 still folds, and 750,000 doesn't, which is why the ceiling is where it is.
  A real block holds about 650 to 1,000 bytes an item once it's open.
- **Reading it on the server.** Nothing on the event loop opens a document, so other modules ask by name: `readDocument(w, id,
  'todos', { kind })`, and `writeDocument(w, id, 'retitle', { name }, { by, callId, holding })`, which goes through the same log,
  so what the server writes reaches browsers as an update. `apps/api/src/features/workspaces/documents/ops.ts` holds what can be asked: a
  plain function of the document and plain data, one line each, which a worker can import. Every change the server makes
  goes through `writeDocument`, or `restoreVersion` to put a version back, and both write it only as Yjs clients the log
  hasn't had, asked under the row's lock in the transaction that appends it (`requireNewClients`): two updates that say
  different things under one client and clock would leave browsers disagreeing for good, and nothing would tell anyone. A
  change that finds a client of its taken by then is worked out again on what's there now, in three tries at most, then `409`
  (`ClientTakenError`): a random client gets past that at once, and a fixed one finds what was written as it, which is how a
  template lands once. A fixed client the log had already when the change was worked out, in a row that won't open or from
  before a version took a board's place, would be the same every time, so that's refused for good, at once. "Already" is judged
  against where the log the change was worked out on ended, read from that log itself, so an update that landed while it was
  being read is something to work the change out again on, not a reason to refuse it. A restore's client is chosen as it's
  asked for, outside the worker, so the check is the one place it's settled. The server's own
  clients are 1 to 15 (`SERVER_CLIENT` in `@alcove/api`: 1 the seed, 2 a board's template, the rest kept), and what the server
  works on otherwise writes as a random client outside them. What starts a log isn't a change: the seed, a copy and words
  rescued into a new document hold what they hold, and the new document is the server's from there. `searchText` streams everything
  someone can open as blocks of words, one document a line, for searching in their browser, and stops as soon as they can't
  read what's next. A board is one block, `board`, of every word on it (`boardText`): stickies, shapes and text, frames' titles
  and who was in a room, tables' cells and pictures' captions, frame by frame in reading order, and never a frame's hint or a
  comment. Text is one element, `line`, with a `kind`; a block is retired instead of deleted, so an edit landing in one
  is never lost. `isGone` in `@alcove/api/retire` is the one rule for what's on the page, for the editor and the server alike:
  a retired block still holding something reads like any other.
- **A known limit in Yjs.** Undoing the delete of an element that holds text two people typed into at once can write an item
  whose left origin is to the right of its right origin (`redoItem`). It applies, states agree, and nothing can tell, but a word
  comes out scrambled, the same for everyone: 25 runs in about 13,000 random ones, and none in over 12,000 where no element
  was deleted. `proveOpens` can't see it. Blocks are retired and never deleted, which avoids it for them. Table rows and a board's
  objects are deleted, so they could reach it, by reasoning rather than a run. It's upstream, and nothing here can catch it.
- **What comes from a call** is a document's own content, written by a browser in the call, so it's sealed and versioned like
  anything else. A `live` block holds the lines it shows, with `call`, the call that fills it in: a later call leaves it alone, and
  after its call it's a block like any other. A `moment` is a quote: who said it, the words, `at` (an ISO time, which each reader
  reads in their own zone), `line`, its transcript line, and `note`, the note it can be heard from. Neither holds a key to anything:
  whether someone can hear a quote is whether they can read that note.
- **What won't open** stops only itself. A row that won't apply or won't decrypt is left out and logged, and the document
  is served without it. One that can't be opened at all, in the time or memory a worker has, is marked closed for five
  minutes (`closed_until`, so a restart doesn't try again, and neither does a tab), with a warning naming the IDs: its
  stream says `closed`, `unavailable`, as its only line. The same goes for what the server does itself: `readDocument`,
  `writeDocument` and compaction cost no worker on a closed document, and any of them that proves too much, out of a worker's
  time or memory, closes it, so a poll can't keep a worker on one however many people are polling. A worker that only says a
  job failed closes nothing: a compaction that won't pass a row it can't read is one, and the document opens without that row. Its versions still read, and restoring one replaces what won't open
  and ends everyone's stream, since there's nothing to merge with. Every client it has had keeps its row, as the server's, at
  what the version holds of it, so nothing is written as one again, by the server or anyone: what other versions hold under it
  stays the one thing it ever said, a board's template among them, and anything still in a browser from before is refused.
  Updates to it are still taken: nothing's refused for a
  document that may only be slow. What the server does to it for itself, reading, writing, compacting and searching it, costs
  no worker while it's closed, and a job of those that runs out of time or memory closes it too. One that fails closes
  nothing: a fold won't go past a row it can't read, and the document still opens without that row.

### What gets into a document

`apps/api/src/features/workspaces/documents/firewall.ts` reads every update before it's stored, byte by byte, and builds nothing from it.
It goes by Yjs's structs and never by what a document means, so a board goes through the same door as a page. Whoever can't
write there hears so first, before anything of it is read. Refused means a reason in the log and no row, and a browser hears
which kind it was: `400 invalid` for what no honest client could send, and `413 too-large` for what's only too much, which
taking something out can change.

What can be told from the update alone is checked with nothing held, in a worker past 32 KiB:

- Nothing of zero length, no `Skip`, no sub-documents, nothing after the end, values at most 64 deep, and only JSON that
  Yjs can write back. Yjs's own decoder lets several of these past, and a zero-length struct applies, then makes a snapshot
  nobody can read. A `GC` is fine as long as it holds something: a browser sends one when something's made and deleted in
  one transaction.
- As many structs as a document can hold, from any number of clients, so nothing fits in a document and not in an update, and
  1,024 items with the same left neighbour, which is what makes Yjs's conflict scan quadratic. The cap can't be on a shared
  right neighbour: every key typed mid-line shares one. These, and types nested too deep in one update, are `too-large`.
- Everything in it can be placed: it's worked through as Yjs would, and anything that waits for what it can't ever have is
  refused, because Yjs would carry it pending for ever, in every snapshot.
- Nothing written as one of the server's own clients, 1 to 15 (`server-client`, `400`), whether or not the server has
  written as it yet: what's written as one is fixed, so anything else there would say two things at one clock, or take a
  template's place before it came. A browser's are random 32-bit numbers outside them. Words rescued into a new document
  (`POST …/adopt`) may hold the seed's, and only as far as the seed goes, as they start a log on top of it: anything else
  written as one of the server's clients is refused there too, on a document or a board, so no rescue takes a template's
  place or a client kept for later. The app's rescue writes its own words as a random client (`randomClient`).

What depends on the log is checked under the document's lock, against `document_clients`, without opening the document:

- Structs only for clients this person owns. The first to write as a client has it, and a person is known by every way
  access knows them, and by their account, so someone who signs in during a call keeps theirs, and so does someone whose
  address changes, in an open tab or with words kept offline. A client's row takes on whatever else its writer goes by each
  time they write, so a row from before accounts were counted carries forward. Nobody can write as someone else, which is
  what a forged clock would need: Yjs would believe it, and everything that client wrote next would vanish.
- Clocks carry on from where a client got to, with no gap, or go over what's there, as a retry does. An update whose structs
  are all here already is a retry, or something a browser rebuilt: only its deletes are kept, and none of its structs are
  counted again. Deletes the log has had since its snapshot, known by a keyed hash, are nothing: no row, and no version.
- Origins, right origins and parents are clocks that exist, or arrive with this. That's anything before or after what the
  update brings of a client, too: two tabs share a store, so an old part of a client can go with something built on a later
  part, which the log has by now. Deletes reach only clocks that exist.
- A running count of items and of how deep types nest: deleting a type recurses into it, in every browser, so nesting stops
  at 1,024. Depth can't be seen from an update, so it's counted as if everything nested below the deepest thing there, and a
  compaction, which walks the document, puts the figure right.

### Opening a document

Yjs has no limit on what opening a document can cost, and a shape that takes minutes can't always be told from one that
doesn't without the whole document. So every Y.Doc on the server is in a worker thread (`live/doc-pool.ts`, `features/workspaces/documents/work.ts`):
loading, merging, compacting, encoding a `sync`, restoring, searching, and anything `readDocument` or `writeDocument` asks.
Sealed rows go in with the document's key, which is wiped when the job ends, and sealed bytes and plain data come out, so big
records are opened and sealed there too.

There are 2 workers (`DOC_WORKERS`), each job has 20 seconds (`DOC_WORK_MS`), and the first worker, which takes documents past
256 KiB or 25,000 items one at a time, has 640 MiB (`DOC_HEAP_MB`) and the others 96. An update past 4 MiB is sealed and read
there too, since it goes through a few copies as text. A worker that runs out of either fails that one job. It's replaced when
it's next needed, and the event loop never noticed. A worker with nothing to do for 30 seconds goes, which gives its memory
back, and one that's held a big document goes after a second.

People take turns. Each has a line of their own, or a workspace for what nobody in particular asked for, and a free worker
goes to the next person in turn with nothing running, so someone opening a document waits behind one job, however much anyone
else has asked for. What a lock is waiting on goes first. A document that takes a second or more is treated as big for ten
minutes, whatever its size says, so slow documents stay off the other workers. At most 256 jobs and 128 MiB can wait, and of
that 32 jobs (`DOC_WAITING_PER_PERSON`) and 32 MiB for one person: past either, the browser is told to try again. Searching
honours a document being closed, and one that takes more than a worker has is closed for everyone, as it is for opening it.

What's on its way to browsers is counted before anything's opened, and stays counted until the last of it has left or the
reader has: a document opening, each line of its stream, a version, a search. At most 64 MiB on an instance
(`DOC_SENDING_MB`), and a quarter of that for one person or one address, past which opening a big document waits for the
browser to try again, and a stream with a line there isn't room for is let go of, for its browser to open it again from where
it got to. Someone with nothing on its way is held back only by the instance's limit, and with nothing at all on its way
anything goes, however big. Anything under 256 KiB always goes, so nobody's unread streams hold up anyone's ordinary document.
Everything big goes in pieces of 64 KiB, each only once the last has left: a write is over when the connection has it, not the
browser, so written whole it would sit in memory for as long as nobody read it. A reader who hasn't taken a piece within a ping,
or takes something big slower than 128 KiB a second, is let go of. At most 128 MiB of updates can be coming in at once, past
what's small enough to be typing.

### Presenter notes

What someone keeps beside each frame of a board for presenting it, a slide's own notes: one `presenter_frame_notes` row for
each account, board and frame, sealed under the account's own keys (state key `presenter-frame-notes:<boardId>`, record kind
`presenter-frame-notes`, whose header binds the account, the workspace, the board and the frame), so nobody else who can open
the board can read them. Which frame a row is for is a keyed hash of the frame's ID under that key (`frame_index`), and the
frame's ID is inside the record, so nothing a browser named is kept in the clear, and a frame's record put in another frame's
row doesn't open. `GET /v1/workspaces/:id/documents/:board/presenter-notes/frames` answers them all, by frame, for anyone who
can open the board and has an account: someone in a call by its link has nowhere to keep them (`403`). `POST` there with
`{ frame, text }` keeps one frame's, and empty text deletes its row. Only a board has frames: the same for a document is `404`.
At most 4,000 characters beside a frame, and notes beside 500 frames of a board: past that a new frame is refused (`409`), and
two at once can take it one past. Notes beside a frame that's been taken off the board stay with the board, and go with it.

Earlier releases also kept notes beside a whole document or board: one `presenter_notes` row for each account and document,
sealed the same way (state key `presenter-notes:<documentId>`, record kind `presenter-notes`, whose header binds the account,
the workspace and the document). Nothing reads or writes them now. The rows already there go with their account or their
document, by the table's foreign keys, as they always did; a later release can drop the table.

### In a browser

`DocSession` (`packages/api-http`) owns the `Y.Doc` and runs the same in a browser and in Node. Edits gather for 150 ms and go
one request at a time, the oldest first, as much as fits in one; a retry only ever repeats what the API may not have.
Nothing typed is let go of until the API has it, and with a `keep` store (the app's is sealed under the device key) that
survives a reload: what's kept is applied when the session starts and sent when there's a connection. The stream picks up from
the last `seq` it heard, however it ended, and never moves on from what this browser sent, only from what the stream
said. Being able to only read, or it going to Trash, stops sending until an `access` line says otherwise. It never writes as
one of the server's own clients, which the API turns away: it starts on a client of its own (`randomClient`), and whatever puts
it on one, it moves to another before a word is written, the same move it makes when it's stuck (below), which a client nothing
was written as doesn't count towards.

A refusal never lets go of anything. What's refused stays in memory and in `keep`, through reloads, and the status says so:
`unsent` is true until Alcove has everything or someone chooses to let it go, and `saved` only ever means that.
`unsentCopy()` gives the words this browser wrote that Alcove hasn't taken, and nothing else, as plain paragraphs: what's on the
page in page order, a paragraph to a line, then what Yjs has nowhere to put, read from what it's holding, in the order it was
written. It reads them by the clocks the waiting updates bring, so nothing anyone else wrote, nothing that went, and nothing
deleted is in it: a new document made of it can't carry what someone can't open any more, or deleted. The app makes that
document with `saveCopy` (`POST …/adopt`, which needs an account, as making that document does, accepts only a document
nobody's written to, and judges what it's given like
anything from a browser), then calls `discardUnsaved(token)`, the only thing that forgets what Alcove doesn't have: what the
copy holds that can't reach this document, refused, with the session over, or with only reading allowed now, and nothing written since, nothing that can still
go, and nothing another tab keeps. It closes the session, whose `Y.Doc` still holds what was let go of; opened again, what's
still kept goes, or comes back to be saved if it was written on what was let go of. A document that's deleted while someone
has unsent words works the same way.

An update that's refused can't hold up what's behind it. A client's clocks have to reach the API in order, so everything
written as that client is stuck with it: the session moves to a new client, and what's written next goes as usual, unless it
builds on what's stuck, which waits too. It only moves four times in one stretch, as a client costs the API a row for good:
after that what's written waits with the rest, without a request for each batch. What's stuck is worked out afresh in a scratch
document, a second after anything changes, then after 3, 6, 12, 24 and every 30 seconds, and as soon as `edit` access returns:
nothing's keeping what was deleted for undo there, so a paste that's been undone or cut down is a small thing now, and goes in
place of everything that was waiting, whole: a change is never split, so a move can't arrive as a delete. Of what's deleted it
says only what Alcove may not have, never all that's ever been deleted. That holds through a reload. Only what was in what went
is let go of: anything Yjs couldn't place stays, and says `rejected`, and nothing's written for it until something changes, as
does anything Alcove refuses outright. A browser shouldn't ever see that, and what doesn't depend on it carries on regardless.

A `503` isn't the connection. A restore turns updates away with it while it runs, and being rate limited does too, so whoever's
typing stays `saving` and it's tried again. Only if Alcove goes on saying so for 30 seconds does the status go to `offline`.

`KeptUpdate` says when each edit was made (`at`). Nothing reads that yet: retired blocks can't be pruned while someone may
still be offline with words for one, and nothing in this release prunes them or limits how long someone can stay offline.
`document()` is async, because Yjs loads with the first document someone opens and stays out of everything else.

Find looks through what `searchText` sends, in this tab's memory (`features/workspace/find/words.ts`), so nothing typed into it leaves
the browser. It's read as Find opens, if anything in the tree was edited since, at most every 6 seconds, and it stays until the
session ends: it's never stored. What's on the page is read from the editor instead, so what was just typed is found. Whatever
leaves someone's tree or goes to Trash goes from there as the tree says so, all of it does on a change of role or when the
workspace's stream closes, and all of it on signing out or in. A guest's goes when they leave the workspace.

History reads a version into a `Y.Doc` of its own that nothing's connected to (`editor/version.ts`), and compares it with the row
below it, by each block's ID and what it serializes to, to tint what changed. A version shows what was stored: a photo, video
or file block still uploading or failed when it was kept loses what didn't arrive, and goes if nothing did. A version's `callId`
is the call that kept it. The first edit of a call keeps what was there before it, so for a document that was there before the
call started (by the call's start, from the call you're in or the note that covers it), History treats the oldest version of a
call as the work before it; a document made in the call keeps all its versions under the call. A call has no name in the
document: a row takes one from the only note of yours whose time covers it, or says **During a call**.
Whoever restores says so in their awareness state for 8 seconds (`restored`, in `DocCaretStateSchema`), beside who the server says
they are, so everyone with the document open can be told by name. Nothing is stored for it.

### Media

A file is anything someone puts in a document or on a board: a picture, video, audio or anything else. It belongs to the
workspace, as a row in `workspace_media`, and is reached only through a document that has it, a row in
`workspace_media_uses`, because what someone can open of a workspace needn't be all of it: a seat reaches that document's
files and no others, and what a call opens reaches none in what's restricted
([Privacy › Files](privacy-keys-and-sessions.md#files)). The API seals uploads, as it seals everything: a file reaches the
process readable and is sealed there (`apps/api/src/features/workspaces/uploads/media.ts`).

- **What's kept.** A `workspace-media` record: its name, type, size, and its width and height where the browser knew them.
  And its bytes, in pieces of exactly 4 MiB but the last, each a `media-piece` binary record in an object under a random name,
  a couple of hundred bytes over its own size ([Privacy › Records](privacy-keys-and-sessions.md#records-and-envelopes)). All of
  it is sealed under the file's own state key, `media:<id>`. At most what the plan of whoever the workspace counts against
  allows, 512 MiB on Free, unless that's changed (below).
- **Its type.** What a browser calls a file is kept only if it can be shown in place: JPEG, PNG, WebP, GIF and AVIF
  pictures, MP4 and WebM video, and MP3, M4A, WebM and Ogg audio, by any of the names browsers use for them. Anything else is
  kept as `application/octet-stream`, and only ever downloads, under the name it came with. SVG and HTML are in that group:
  nothing shown in place can run.
- **Going up.** `POST /v1/workspaces/:id/documents/:doc/media` says what's coming, for someone with `edit` on the document,
  and makes the row and its use. Each piece goes to `…/media/:media/pieces/:seq` as bytes, exactly its own length: sealed,
  written to the object store, read back and checked (length and SHA-256), and only then recorded, under the workspace's
  lock with access asked again, so someone who lost the document while a piece was on its way keeps nothing and its object
  goes. A piece is kept by its place in the file, so sending it again changes nothing. `…/finish` makes the file readable
  once every piece is there; until then nobody can read, list or reuse it. Every piece counts towards the workspace's
  `stored_bytes`, once, however many documents have the file, and so towards its payer's storage (below).
- **A picture's preview.** The browser uploading a photo makes a small JPEG of it, at most 320 pixels on its longer side and
  128 KiB (`MEDIA_PREVIEW_PIXELS`, `MAX_MEDIA_PREVIEW_BYTES`), and sends it once the photo is finished, to `POST …/media/:media/preview`
  as `image/jpeg`. It's a `media-preview` binary record, sealed under the file's own key, in one object under a random name, a
  row in `workspace_media_previews`, and it counts with the file towards `stored_bytes`. Only someone who can edit a document
  with the file keeps one, only of a finished picture, and only once: the first kept stays. `GET …/preview` reads it for anyone
  who can read the picture there, and says `204` when it has none. The photo picker draws every photo from its preview; a photo
  from before previews has none, so the picker reads it whole once, decodes it at the small size and keeps that for as long as
  the workspace is on screen. A preview goes with its file, its object queued in `object_gc` in the same transaction, and with
  its workspace. A preview that doesn't get there doesn't fail the upload.
- **Going wrong.** The client tries a piece again: for up to 5 minutes through a lost connection or a busy server, which
  pass by themselves, picking up as soon as the browser says it's back online, so a Wi-Fi handover doesn't start 500 MiB
  over; and 3 times more after a failure on the server. Past that, or if the browser gives up, it takes back what got there
  (`DELETE …/media/:media`). An upload whose browser went stays `uploading` until maintenance takes it, a day on.
- **What can be kept.** What a file and what's stored can be is the plan's of whoever the workspace counts against
  (`workspaces.payer_owner_id`), and what one person uploads in a day is the same for everyone. All are limits, which change
  without a deploy and are in force everywhere within 30 seconds
  ([Deployment › Changing a limit](deployment-and-acceptance.md#changing-a-limit)): a file, 512 MiB on Free; storage, 10 GiB
  on Free, counted for each account, not each workspace: the account's own `stored_bytes` (its calls' audio and shared
  screens, its room recordings) and every workspace it pays for, a call's own included, whoever added the files, guests
  too ([Plans and usage › Storage](plans-and-usage.md#storage)); and what one person uploads in a day
  (UTC), in every workspace together, 20 GiB. They're the same for everyone, guests in a call included. Each is checked when
  an upload starts, with the whole file, and again on every piece, so uploads going at once pass one by the pieces on their
  way and no more. A file over the limit is refused as `400 invalid`, with how big one can be, "This file is bigger than 512
  MiB, the most a file can be here.", because only the server knows; a payer with no room left with `402 plan-limit`, "Your
  storage is full. Delete something, or move to a plan with more room."; and a day used up with
  `409 conflict`, "That’s all you can upload today. You can upload more tomorrow." A file size or a day at zero refuses
  everything with "Files can’t be uploaded right now." Anyone but whoever pays (and, on Team, the people licensed on the same
  team) adds at most `media.others_day_bytes` (2 GiB) a day to that account's storage, guests in its calls
  `media.guests_day_bytes` (256 MiB) between them, `409 conflict`, "That’s all you can add today to the storage this workspace
  counts against. You can add more tomorrow."; and nobody else reaches into the last `media.payer_reserve_bytes` (1 GiB) of
  it, kept for the payer's own notes and recordings: `402 plan-limit`, "This workspace can’t take more files now: the rest of
  the storage it counts against is kept for notes and recordings." (once it's full, "This workspace can’t take more files:
  the storage it counts against is full."), never saying whose it is or what's left. Every refusal logs the limit by its name
  and the sizes. A workspace that counts against nobody (none of its admins has an
  account) takes no files: `409 conflict`, "Files can’t be added until one of this workspace’s admins signs in to Alcove."
  Lowering a limit refuses what comes next and deletes nothing. An account's day is counted in `media_upload_days` as its pieces are kept, and
  a guest's, who has no account, in `media_guest_upload_days`, by a blind index of the person their pass names: either way every
  instance counts the same day, and a restart forgets nothing. A piece
  that takes an account's storage or someone's day past 80% of its limit logs it at warn, once each time it's crossed.
- **Reuse.** `attach` puts a file in another document of the workspace, for someone who can edit that document and can
  already reach the file, and a copy of a document has what the original has, in the transaction that makes it. It's still one
  file: nothing more is stored.
- **Reading.** `GET …/media/:media/token` gives whoever can open the document a token, and `GET /v1/media/:token` reads the
  file, because a picture or a player can't send a header ([Privacy › Files](privacy-keys-and-sessions.md#files)). Pieces are
  read in order, each digest checked before it's opened, with `Range`, `nosniff`, `no-store` and the type from the sealed
  info, never the request. `GET /v1/media/:token?download` (`url`'s `download`) serves it as an attachment under its name,
  whatever its type, so a picture or a film saves rather than opening: the arrow on a file and **Download** in a photo's or a
  video's menu read it so, each file in a hidden frame of its own, half a second apart (`saveFile` in
  `apps/web/src/features/workspace/uploads/DocumentMedia.tsx`; the app's policy has the API's origin in `frame-src`). The page itself
  never follows the link: the API is on an origin of its own, where a link's `download` doesn't count, so the page would
  navigate, which the browser takes for leaving it until the answer turns out to be a download, and a call on the page
  would go. Each frame goes five minutes later, when the browser has long had its download. An answer to a player's range sends at
  most four pieces (16 MiB), stopping where a piece does, and says so with its `Content-Range`: a browser asks again for
  the rest, and access is asked about again each time. Every answer has a strong `ETag`, a digest of the file's sealed
  info, which never changes and says nothing about it. A download that stopped (cut at `MEDIA_READ_MS`, or a connection
  lost) asks for the rest with it (`If-Range`), and a download's range is answered as far as it asked, past four pieces
  without a length, so it picks up where it was; against anything but that `ETag` the range doesn't count, and the whole
  file comes again. Read without a
  range, a file over 16 MiB streams without a length, a limit kept from Cloud Run, which refused an HTTP/1 response that said it was over 32
  MiB, and asks again every four pieces. The first piece is read before anything is sent, so its failure is an ordinary
  answer; a later one breaks the connection, so a file that couldn't be read is never taken for whole.
- **Pictures.** A board or a document shows a picture through `api.workspaces.media.picture`, which reads it into an object
  URL: at most 4 at once for a browser, trying again for minutes when the server's busy. A room of people opening the same
  board at once would otherwise overrun what the process takes on, and an `<img>` can't try again. Video and audio use the URL,
  which a player reads by range.
- **In a document** (`apps/web/src/features/workspace/uploads/uploads.ts`). Files go into a document as blocks: photos a browser can
  read as one `gallery`, a film it can play as a `video`, anything else as a `file`, however they come: dropped, pasted, or
  chosen from **/** → Photos, Video or File, so a picture chosen from File is a photo. A picture that can't be shown (HEIC,
  SVG, TIFF, or one this browser can't read) is a `file` when it's chosen from File, which is asked for a file
  (`prepare`'s `file`); however else it comes, only **Add as a file**, below, makes it one. The block holds the space at once, with each
  file's name and, for a picture or a film, its size in pixels, and says how far it's got (`up`) as pieces go, so everyone sees
  it fill. The block carries the upload's own token (`upload`, random, nothing about the file in it), and the upload follows
  the block by that, not its ID: cut and pasted, the block has a new ID and the upload goes on into it; undone, it has 15
  seconds to come back with redo before the upload's let go of. The token goes when the upload's done, and retiring a block
  takes it away like any other attribute. Only the browser sending writes to the block, and always through one session of its
  own for that document, so leaving the document or the workspace doesn't stop it. Two sessions writing the same attribute
  without having heard each other could leave the older value standing, which is why it's never the page's. Nothing is stored
  until the block has reached that session, which is to say Alcove has it: a block a full document turns away, or that never
  gets there in a minute, holds no file anywhere, and the page offers Try again. The session closes only once everything it
  wrote has reached Alcove, however long the connection is away, and until then the upload still says it's on and closing the
  tab asks first. As each file is stored its ID goes into the block, and a photo's caption, an attribute of its own
  (`cap:<id>`), starts as the file's name without its extension. A photo used again from the picker keeps the caption it has
  elsewhere in the document, and otherwise starts with none. `@` in a caption tags someone as in a comment: the words say
  `@First`, and who that is goes beside them in `tags:<id>`, a list of `{ id, name }`, so the words are still the caption for
  anything that reads only `cap:<id>` (search, the notes, copying out, an older release), and a caption from before tags has no
  list and reads as it always did. A tag counts while its `@First` is still in the words. Whoever's newly tagged is told through
  `mention`, with the gallery's block, or asked about first if they can't open the document, as for a tag in a line. A film's first frame goes first, as a picture of its own
  named `<title> (first frame).jpg`, which the picker never offers as a photo, so there's something to see while the film goes;
  one whose film never arrives is deleted with its block. A photo the browser can't read, dropped, pasted or chosen from
  Photos, isn't sent at all: its block says which file, and the browser that has it offers **Add as a file**, which puts it
  in as a file in the block's place. What the API
  refuses goes into the block as failed, and the refusal's own words to whoever sent it. That browser says in the document's
  awareness which uploads it's sending (their tokens, nothing else), so a block that says it's uploading with nobody saying so
  for 20 seconds shows as failed. The browser that sent one that failed offers Try again for ten minutes, while it still has the
  file; that opens the document's session for uploads again.
- **Shown in a document.** Every picture, a film's frame included, goes through `picture`, read once for as long as anything
  shows it, kept a minute after so a block redrawn or scrolled back to isn't read again, and let go of with `revokeObjectURL`
  (`apps/web/src/features/workspace/uploads/pictures.ts`). A block pasted or dropped from another document, or sent there with Move
  to…, has its files attached there first, and its pictures wait for that. A picture that's `not-found` shows as deleted; a file
  or a film does when the workspace's list of files, read after the block was first seen, no longer has it through that
  document, or a player or a download is refused it. Taking a block out (Delete) leaves its file; Delete for good, from the
  block's menu, is `remove`. A version in History draws from the same (`useMediaView` in
  `DocumentMedia.tsx`), so a file deleted for good since shows as deleted there too.
- **What a process takes on.** Every call runs in the same one process, so what a file can hold there is limited
  (`MEDIA_LIMITS` in `features/workspaces/uploads/media.ts`). At most 16 pieces are coming in at once, 4 for any one person, counted from before
  their bodies are read; past that they're refused with `503 unavailable` and the client tries again. A piece has to keep
  coming: one that brings less than 256 KiB in 10 seconds, stopped or only trickling, is cut, and the client tries again. At
  most 32 reads are open, 8 for any one person, from when they start until their response has gone, whether it finished or the
  browser left. A piece goes out in slices of 256 KiB and the next is opened only when the last has gone, so a reader who stops
  holds one piece at most. A read past that waits in line, holding nothing: at most 48 of them, 24 for one person, for 10
  seconds, and then it's refused too. A read that waited asks who's asking again, and opens nothing if its browser has gone.
- **A read that stops.** While someone's in line, a read that has taken nothing for 5 seconds gives way to them, the longest
  stopped first, and someone at their own limit gets one of their own back. Being cut costs a paused video nothing: it asks
  again from where it got to when it plays. With nobody in line a stopped read is left alone. Every read ends at 280 seconds
  (`MEDIA_READ_MS`) whatever it's doing, well inside the load balancer's idle timeout, so nothing holds a place for good.
- **The core.** Reading and writing share one budget, however many people are doing it. 4 pieces are in hand at once, and
  their sealing, opening and hashing take turns, one at a time, each followed by a pause of seven times what it took: an eighth
  of the core, and about a third of what a piece costs the process, so a call keeps more than half of it. A piece's cost is
  timed, so this holds on a slower core. Past that, pieces wait, and reads run into the limits above. Each piece opened also
  counts against someone's 240 reads a minute, because a byte costs a whole piece.
- **Going away.** Taking a block out of a document leaves its file there, for a version or for reuse: a use goes only when
  its document is deleted for good, so a version or something in Trash keeps its pictures. A file nothing uses any more goes
  in the same transaction: its rows go, stored bytes fall to match, and its objects are queued in `object_gc` there too, so
  a process that stops straight after the commit strands nothing. They're deleted straight after it, and what the store
  refuses stays queued for maintenance. Use rows only change under the workspace's lock: adding one shares the lock and
  taking one away holds it alone, so a file can't be given out as it goes.
- **Deleting one.** `DELETE …/media/:media` deletes a file for good, the same way, for anyone who can edit a document that has
  it: every use goes with it. They have to be able to edit every document that has it, whether they can open it or not, or
  it's `forbidden`: reusing a picture doesn't make it yours to delete, and nobody's file goes from a document you were never
  shown. One you can't open is refused in the same words as one you can only read, "This file is also in a document you can’t
  edit.", so it names neither. Someone who can edit the document only through a seat in a call is refused too, as `forbidden`:
  a seat is for working on it in the call, and taking the file's block out of it still works. A version or another document
  that still shows it gets `not-found` from then on, as for any file that isn't there, and the app shows it as removed.

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
  an instance can take at once, and rings and calls need them too. Past the address or the instance's limit, the next is
  refused with `503 unavailable`, decided before anything is read, and the browser tries again by itself.
- **A stream the browser closed.** On Cloud Run the API never heard that a browser closed a stream: it was reached over
  HTTP/1, which didn't pass a client's disconnect on to the container, and a ping every 25 seconds never backed up a front
  end that kept reading. The edge in the TEE sees a disconnect, but a load balancer can still hold a connection open. So a closed stream would hold its place for its 280 seconds, and someone opening pages one after
  another filled their eight within minutes (115 refusals in one call on 11 Nov). Now the browser says so: it names each
  stream it opens, 22 characters of base64url it makes up, in `x-alcove-stream` (`LIVE_STREAM_HEADER`, never in a URL),
  and when it stops reading one for any reason but the API ending it or turning it away (it closed the page or the board,
  gave up on a quiet or hanging try, or the page went), it sends `POST …/live/end` with that name, as a keepalive request
  so it goes as the page does. The API ends that stream of the asker's at once and gives its place back (`hub.end`, scoped
  to the person, so naming someone else's ends nothing, and the answer is the same either way). A name is never logged.
  It takes an account, as every route past the sign-in check does, and keeps no receipt: a guest's call pass alone is
  refused with `401` before anything's read, so a guest's places come back by the rule below, or when the API lets go.
  It reaches only the instance that has the stream; with more than one instance, one asked elsewhere waits for the rule
  below.
- **At a person's limit,** the next of that kind ends their oldest stream of it to make room, as rings do: the one likeliest
  to be a tab that went without anyone hearing, such as one whose page crashed. It just ends, as on the clock, so a tab
  that's still there opens another at once. Only a stream open for 20 seconds makes room (`LIVE_MAKE_ROOM_MS`), and room is
  made for each person, for each kind, at most once in those 20 seconds: until then the next is refused with `503`, the tab
  that just gave up its place included, and its browser tries again, later each time. So someone with more tabs than places
  takes turns slowly, one stream every 20 seconds or so, rather than round and round, each tab opened again ending the next
  oldest and every one of them a document worker's sync.
- **A workspace's stream** (`GET /v1/workspaces/:id/live`). Lines: `tree`, whole, first and whenever what this reader sees
  changes; `presence`, everyone here that they can know of, whole, whenever that changes; `mentions`, their authorized unread tags, whole
  ([Tags](#tags)); `access`, when their role changes, just before the `tree` that shows it; `ping`, every 25 seconds; `closed`, when
  they can't open it any more, and it ends. Every stream of a workspace on an instance shares one subscription and one
  read of each change, for the streams behind it: `version` moves on with every change to the tree or to who has what, and
  a notice that finds nobody behind stops at that one small query. The read takes the state and what those readers have,
  under keys opened for it and not kept. Each stream then works out what its reader sees, and sends nothing if that's what
  they last saw, which it knows from a hash: a stream holds no tree, because a copy for each is what runs an instance out of
  memory. A slow browser skips to the latest.
- **A document's stream** (`GET /v1/workspaces/:id/documents/:doc/live?after=<seq>`). First `sync`: what this browser
  doesn't have as one update, the `seq` that reaches, and what they can do. Then `update`, in order; `awareness`; `access`,
  when their role changes or it goes to Trash or comes back; `ping`; and `closed`, saying why it's over: `access`, `deleted`,
  `session` or `unavailable`. Up: `POST …/updates`, `POST …/awareness`, and, with an account, `POST …/adopt` for a new document's first state ([In a browser](#in-a-browser)). A notice is `<document>:<seq>`, and each is read once on
  each instance, by the document's room, which keeps the lines not everyone has been told, each made once. Rows are read before
  how far the snapshot reaches, and it's the rows that say what a compaction took: seqs have no gaps until one makes them, and
  anyone who hadn't been told what's gone starts again from where they got to. A stream keeps only its place: nothing of
  the document stays with it once its `sync` is written, so 500 of them cost little. A stream that falls more than 256
  updates or 1 MiB behind is let go of, and its browser picks up from its last `seq`. Hearing that the hub missed something
  reads again from there too. Someone who loses a document hears nothing written after that: a change to who has what
  that was heard first is settled before the update behind it is read.
- **Carets** (awareness, which also carries the IDs of the blocks a browser is uploading into) are never stored. A browser's state goes up at most every 100 ms and travels through a notice sealed
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
  what is checked against everyone here. A notice carries the workspace's version it was checked at, and one checked before
  a change an instance has already checked everyone against is checked again before anyone hears of it: what someone said
  just as their access went never brings them back. What each reader is told is worked out for them: where someone is if they can open
  it, otherwise `elsewhere`, with the document and block null. Someone outside the workspace hears of nobody who isn't in something
  they can open or in a call with them, and an address goes only between people in the workspace. Who's who (`isMe`) goes by
  someone's address or seat, never by what a call opens to everyone in it, which travels in the notice beside them (`calls`,
  empty from an instance a release behind) and counts only for what they can open. `callIdentity` goes
  only to people in that call, so a tile can show where someone is, and so does `page`: which of the call's own pages they're
  on (Notes, Follow-ups or the Transcript), which anyone else hears of only as `elsewhere`. Only a browser in a call can be on
  its pages: a `page` from anyone else is dropped. Streams work out who's here at most five times a second.
  Whoever moved last comes last, so of someone's windows the one in use can be told from one left open. Following someone
  is all in the browser, from this: nobody is told, and a document you can't open reaches you only as `elsewhere`, so nothing
  in the app has its name to show.
- **Who's reading is checked again** at every ping, on the clock, however busy the workspace is, from the session and pass
  the stream came with. For a session it's one indexed read and nothing of the workspace; a pass takes the call's state,
  and only people in a call have one. A session or pass that ended ends it within 25 seconds at most. A notice about the
  workspace does it at once, and so do these, though the rows they matched stay for everyone else: someone leaving a call
  or taken out of it, which is told to every workspace the call is open to and every one that gave their seat something,
  and a call moving on from a workspace, which is told to that workspace. Each is `look:` and the keyed hash of the seat,
  or of the call there, and only the streams carrying it look again (the way a tag's `told:` reaches only its person's), as
  at a ping; whatever someone in it is here as forgets it, and the next read settles who that leaves here. A stream that
  finds nothing left for its reader first asks who they are now, because a new address from their provider moves what they
  have to another hash.
- **Letting go.** A stream ends without `closed` when the API lets go (after 280 seconds, well inside the load balancer's
  idle timeout, so it's never cut), its browser says it closed it, its person needs its place, or its instance shuts
  down. The browser opens it again: quietly when it just ended, showing `reconnecting` when it failed, keeping what it last
  showed either way. A line that can't be written within a ping ends a stream too, which is how one whose browser went as it
  opened is let go of. A browser that hears nothing for a minute takes the connection for dead, and says it closed it.
- **Trying again.** After a failure a session waits 0.5, 1, 2, 4, 8, then 10 seconds between tries, starting over after
  any try that lasted a second. Asked to (`DocSession.retry`, `WorkspaceLive.retry`: Try now, in the app), it tries at once,
  cutting a wait short and giving up a try that's hanging; a try given up this way doesn't count as a failure. When there's
  only reason to think it would connect now (the browser comes back online, the tab comes back into view, or, in a call,
  the workspace or the board is opened again: `wake`), it cuts a wait short and nothing more: a try that's under way carries
  on, because a first open waits its turn for a document worker (two on an instance, shared by everyone, up to 20 seconds
  a job), and giving it up wastes that job and puts it at the back again, so someone switching tabs while a big page opens
  could keep it from ever opening. Either way, edits waiting for their own next try go at once.

A top-up is a sealed `deposit` record, header `{ v: 1, kind: 'deposit', ownerId, depositId, keyVersion: '1' }`,
under `Kservice`'s accounting key like the billing state, so the watcher opens it without anyone signed in: the
route (chain, token, decimals, minimum), the deposit address and memo, the expiry, the amount asked and the quote's
`minAmountIn` (token units), the provider's whole signed quote,
what the provider last said arrived while it was open (micro-USD), and once settled what was sent, what reached the treasury and what was refunded (micro-USD), what it added to the balance in dollars (`addedMicroUsd`, micro-USD)
and the provider's reference, whether it was logged that the provider couldn't answer past its deadline
(`unanswered`, default false), and why the provider's last finished answer wasn't added (`doubt`, default null)
([Plans and usage › How a top-up works](plans-and-usage.md#how-a-top-up-works)). A record from before plans also holds the credits it
promised and their rate, which are ignored and kept by every save (the record is read loose), and one a release before plans
settled has no `addedMicroUsd`: upkeep adds it again as dollars, once, whenever it was settled. No column holds anything
readable.

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
  `inference` holds the transcript's verification and only what wrote the current notes (one per model and task;
  task `screens` is the model that read shared screens), replaced each time the notes are written. Older notes may
  still hold several, and the app shows the latest per task.
- **Caption translations** are sealed under the same transcript key, one row per line and language, and are
  deleted with the transcript clips when the recording stops.
- **Live notes** are sealed in `call_notes`, one row for each view of each part of the call that has had some, opened with
  every read of the call and written at most every 30 seconds and with each tick or follow-up added. A refresh is claimed and
  saved under the row's lock and runs with nothing held, so the model's answer never holds up the call. When the call ends,
  what was ticked and what people added move into the note's manifest and the rows go, in the same transaction
  ([Notes and inference › Live notes](notes-and-inference.md#live-notes)).
- **Shared screens' video.** Each share started while the call's recording exists gets a `screen_shares` row.
  A piece of a kept share's video is sealed under the recording's `Krec` (record kind `screen-video`, binding the
  recording, share, segment, piece and object), written to the object store, read back and checked, and only
  then recorded in `screen_pieces`; a piece sent again is stored once, and one whose row doesn't commit queues its
  object for deletion. Once the call is over and the share's tail has passed (a timer set as the call ends, and maintenance as a backstop; no notes service is needed) each share's pieces in each segment are joined into one
  video, with backpressure into temporary encrypted object-store chunks under a fresh per-join key while it is indexed, then sealed in chunks of at most 4 MiB (`screen-video-chunk`, binding the chunk and the count) into
  `screen_videos`, and the pieces' rows are deleted with the chunks' rows written, then their objects. Replay
  (`GET /v1/notes/:id/screen/:share/:segment`) opens only the chunks a range needs, with `nosniff` and `no-store`
  ([Calls and recordings › Shared screens](calls-and-recordings.md#shared-screens)).
- **Shared-screen frames** are taken from that video at the moments the notes worker picks, sealed under `Krec`
  (`screen-frame`), read back and checked, and recorded in `screen_frames` with their grey grid; the same image
  again is kept once. What was read on each is written into its row (a frame taken only to compare a change with is never read, only sent
  with the frame after it), and the key frames the note shows go into the note's `screens`. Every other frame (not
  shown, judged supporting or unrelated, a frame before a change, or no longer picked) only goes into what the notes
  say, and is deleted in the transaction that saves the notes (its object once that commits), unless the
  saved note still shows it
  ([Notes and inference › Shared screens](notes-and-inference.md#shared-screens)).
- **How records written before read.** None of this needed a migration. A frame's reading without `shows` or `changed`
  reads with both empty, and a frame, or a pick kept in a notes job, whose why is `fill` reads as `start`; a pick without
  the second of its frame before reads as having none. A note's manifest without `details` reads with an empty full
  summary, and a screen without `shows` or `changed` with both empty, so an old note shows no "Full summary" button until
  its notes are written again, which writes one. A note whose screens came from the presenter's browser, before video was
  kept, counts each of its frames as key when its notes are written again, so they show as before; one that isn't written
  again shows the screens it kept, whatever they were judged.
- **Notes jobs** are inserted `queued` by the stopping transaction, claimed with a lease by the notes worker,
  and deleted when the note is finished ([Notes and inference](notes-and-inference.md#the-notes-worker)).
- **Google Calendar events** are read from Google whenever the app asks (`GET /v1/calendar`, the coming week or any
  stretch of up to 31 days) and never stored. An Alcove call's event ID and link are kept in its meeting manifest, and
  for an occurrence of a recurring event, the recurring event's ID. A call offering times keeps the IDs of the events
  holding them on its organizer's calendar (`holds`, `[]` for calls from before them), until someone picks or it's
  cancelled. A series that repeats is one recurring event: each call keeps its
  occurrence's ID and which recurring event that is, and the series keeps the event that carries its latest calls.
- **Busy times** (`POST /v1/calendar/busy`) are read when the app asks, from Google, from the account's own calls,
  or for a demo account from `apps/api/src/features/meetings/demo-week.ts`, and go nowhere else: no row, no receipt, and in the logs only
  how many ([Privacy › Google sign-in and calendar access](privacy-keys-and-sessions.md#google-sign-in-and-calendar-access)).
- **Documents** brought to a call are IDs in its meeting manifest, and nothing else about them is kept: a name, whether
  it's still there and who can open it are read from its workspace each time the call is
  ([Privacy › Brought to a call](privacy-keys-and-sessions.md#brought-to-a-call)). An item's own ID doesn't say which
  workspace it's in, so the ID a call keeps names both, `<workspace_id>.<item ID>`, 45 characters; to the wire it's one
  opaque ID (`IDSchema` puts no limit on an ID). That's only for someone who can open it: anyone else is told a name
  worked out for them and that call, which nothing stores. A call stored with the old demo catalog's IDs (`vandelay.…`, `own.…`)
  still opens, with those not listed: they look like nothing else, so they find nothing, and they stay in the manifest
  until the organizer next changes what's brought.
- **The workspace a call uses** is in its meeting manifest (`workspaceId`), with its `agenda`, as IDs. What goes on in it
  during the call is in the call's sealed state (`workspace`: which workspace everyone views, what's presented and playing,
  what's been worked on and by whom, and the next agenda while it's being made), and goes when the call ends: what was
  worked on into the note, if there is one, and nowhere else. That the call opens it to everyone in it is a row in
  `workspace_calls`, written when someone in the call opens Workspace, when it goes back to its home, or when the organizer
  switches to another, which goes then too
  ([Calls and recordings › The call's workspace](calls-and-recordings.md#the-calls-workspace)).
- **The call's timer** lives in the call's sealed state (`timer`), separate from its boards and workspace: one countdown's
  ID, revision, length with time added, whether it's paused, and its clock on the server, numbers only. Call state from the
  previous release kept an agenda of named segments (`timerSequence`) instead: it reads as the segment it was on, and the
  next save writes `timer` without the agenda's names. Older call state reads as no timer. The timer presets an earlier
  release kept in `timer_presets` are gone: nothing reads or writes them, and a later migration drops the table once the
  previous release no longer serves. See
  [The call's timer](call-timer.md).
- **A board in a call** is a document in a workspace like any other. The call's sealed state says which is open in each part
  of the call and which boards it lets everyone into (`board`): where each is, who opened or decided it by their name, address and
  seat, and the seats and addresses each has been worked out for, and nothing about what's on it. An open board's entry keeps its
  vote (which frame, how many votes each, who started it, whether it's ended, and which stickies each person voted for, by
  their account or their person in the call), only as IDs. It also lists each board made for a breakout room, by room, and
  whether everyone invited has it by address yet (`rooms`), and what's coming back from rooms that have closed (`landing`),
  with how many tries at landing it have failed (`tries`). Open rooms keep what they were opened with to work on
  (`breakouts.open.board`), and a room's board keeps its call
  as an item (`StoredItem.room`) until the call has kept it for everyone invited, so it isn't stranded meanwhile; then the mark
  goes, and it's a restricted board like any other. It all goes when the call ends. A call stored before boards were kept reads
  as having none, an open board stored before votes reads as having none, and one stored with a board timer, which boards no
  longer have, keeps it only until it's next saved, unread; rooms open from before rooms had boards
  read as having none to work on, a landing stored before its tries were counted reads as having failed none, and an item from
  before reads as nobody's room's ([Calls and recordings › A board in a call](calls-and-recordings.md#a-board-in-a-call),
  [A board's vote](calls-and-recordings.md#a-boards-vote)).
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
- **Files in a workspace** are in [Media](#media).
- **Deleting** is physical, whether it's a note, a meeting or a whole account: rows, receipts and objects
  (see [Privacy › Deletion](privacy-keys-and-sessions.md#deletion)). A deleted account leaves no row keyed by
  its ID, except an `object_gc` entry until maintenance deletes an object the store refused.
- **Top-ups** are inserted `waiting` when opened and change state only under a row lock, adding to the balance
  (`plan_accounts`) in the same transaction; `credited` and `held` never change again. Received amounts for open deposits never decrease,
  even when overlapping provider checks finish out of order. Cancelled, failed and expired deposits remain watched
  for 30 days after their address expires, so late settlements are still added. The watcher claims due ones with a lease
  longer than a worst-case pass (about 17 minutes, `check_after`) and schedules their next check by age; the long tail
  thins from hourly to every six hours, then daily. Only after the tail ends is `check_after` set to `infinity`.
- **What a plan has used** is read from sealed state when `GET /v1/plan` is asked, and nothing about usage is stored in
  the clear: the AI allowance left and what it has spent are in `ai_meters`, and storage is the sizes the account already
  keeps, its own `stored_bytes` and those of the workspaces it pays for ([Plans and usage](plans-and-usage.md)).

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
- **The recording** (`recording_pieces` and their objects), **shared screens** (`screen_shares`, `screen_pieces`,
  `screen_videos` and `screen_frames`, and their objects), **the note and every revision of it** (transcript, notes, corrections and who made them) are kept
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
- **A link to a call's notes** (`note_links`) lasts until it's revoked or runs out (seven days), the note goes, or its
  maker removes the note from theirs or deletes their account. Whoever it gave the notes to keeps them, as with sharing by
  address.
- **What's in a workspace's Trash** stays 30 days, unless someone deletes it for good first.
- **A document's log** lasts until it compacts, past 200 updates or 1 MiB; what was deleted goes then. **Its versions** last
  until the document does, or until newer ones push them out past 64 MiB.
- **Carets and presence** are never stored: they're in Postgres's notice queue for as long as it takes to deliver them, sealed,
  and in the API process's memory.
- **A tag** lasts until its person has heard, for at most 30 days, and goes before that with its document or their access.
- **A file in a workspace** stays until someone deletes it or every document that has it is deleted for good, Trash
  included, and an upload nobody finished for a day. A limit going down never deletes one.
- **`media_upload_days`**, **`media_guest_upload_days`**, **`media_others_days`** and **`media_guest_payer_days`** keep today and
  yesterday: upkeep deletes anything older. An account's rows, as payer or as uploader, also go with the account.
- **`service_limits`** keeps a value until someone changes or deletes it. A value for `media.file_bytes` or `media.workspace_bytes`,
  which are gone, is ignored with a warning.
- **`plan_accounts` and `ai_meters`** go with the account. A period's AI allowance doesn't carry over: the next period's replaces
  it, with what the last one spent, by kind, logged as it closes.
- **Teams.** A member's `team_members` row goes when they leave, are taken off, or delete their account, and the team's
  workspaces they pay for stop being the team's then (`team_id` and `team_access` go null; each stays with its own people).
  A team goes, with its members, invites and `team_notes`, when its admin deletes it (once nobody else is on it) or deletes
  their account then; until then deleting the admin's account is refused. `team_invites` go when used, and upkeep deletes
  expired ones.
- **Feature flags** keep a flag on, a group, a member or a grant until someone switches or deletes it with `feature-flags`. Deleting a
  group deletes its members and grants; deleting an account deletes its address from every group and grant, unless another
  account signs in with that address too.
- **Seats** in `document_access`, and what a call opens to everyone in it (`workspace_calls`), last while their call does.
- **What a call keeps of its workspace** (which workspace everyone views, what's presented and playing, what's been worked
  on) lasts while the call does. What was worked on goes into its note, and a call with notes off keeps only the versions.
  Asking Alcove about a selection keeps nothing.
- **Presenter notes** beside a board's frames last until their author empties them, or the board, the workspace or the account
  goes. The `presenter_notes` rows earlier releases kept last until the document, the workspace or the account goes.

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
