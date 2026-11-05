# The in-call workspace: design

The approved design is the Design canvas <https://claude.ai/artifact/Gvy2XmrrPebzqdiufjgMyt> (version 5): 21 journeys,
a working prototype, a control map and reference boards. Ben's instruction: build all of it, end to end, and make it
look like the canvas. GitHub issue #81 holds the acceptance criteria. This page records the engineering decisions the
canvas can't show. Where it's silent on how something looks or moves, the canvas decides.

The canvas source is the UI spec: `ws.css` (styles), `WS.dc.html` (markup of every screen and popover), `ws-layout.js`
(the panel engine), `ws-ui.js` and `ws-core.js` (behaviour), `ws-journeys.js` (every journey, step by step, with the
motion for each), `ws-data.js` (blocks, slash menu, templates, seed data).

## Scope

In: everything in the 21 journeys and the reference boards (Every block, Keyboard, What goes where, In the dark, On a
wide screen, What every control does, Drag the window, Eight ways to sit), and everything in #81.

Out: **boards**. The canvas shows a board only as a tree item that opens a placeholder; the real design is the
whiteboards canvas (#83), not built yet. So no "New board", Board block, B key or Board dock button ships here: a
placeholder in the real app would be a dead end. The tree's `kind` is an enum so boards slot in later.

## Rules that shape everything

AGENTS.md applies in full. The ones that bite here: nothing readable in a column, object name, URL, log line or error;
new stored data gets a record kind, a header and a leakage canary; migrations only add, and sealed records still open;
integration tests only (no browser tests, no unit tests); no `any`, `as`, `!` or suppressions; `console.*` is banned;
the app reaches the backend only through `api`; colours and motion come from tokens; every list has an empty state;
light and dark, phone and wide all work.

## Architecture in one paragraph

A workspace is an **owner**: a row in `owners` with its own root key, so sealing, the vault's helpers, object cleanup
and `owner_id` scoping all work as they do for an account. Its name and tree are one sealed state on its `workspaces`
row, changed under a row lock by the server, which filters them per reader. A document's content is a **Yjs** document:
browsers exchange binary updates through the API, which seals each into an append-only log and compacts it into
snapshots. The editor is **ProseMirror with y-prosemirror**. Live traffic is **NDJSON down and POST up**, because a
guest authenticates with a header and browser WebSockets can't send one, and because it runs through the same auth,
origin check and test harness as everything else. API instances relay through Postgres `NOTIFY`, which carries IDs or
sealed payloads only. In a call, every surface is a panel in a tree of rows and columns, solved to pixel rectangles.

## Storage

New tables, in new migrations (renumber after main's latest). Each row is scoped by the workspace's `owner_id`.

| Table | Clear | Sealed or keyed |
| --- | --- | --- |
| `workspaces` | `owner_id` (PK), `workspace_id` (Id128, the public handle, unique), `version`, `created_at` | `state_ciphertext` |
| `workspace_members` | `owner_id`, `role` (`admin`/`edit`/`read`), `created_at` | `email_index` |
| `documents` | `owner_id`, `document_id`, `next_seq`, `updates_since_snapshot`, `bytes_since_snapshot`, `created_at` | none |
| `document_access` | `owner_id`, `document_id`, `role` (`edit`/`read`), `kind` (`email`/`seat`), `call_id` (seat only), `created_at` | `principal_index` (email index, or a MAC of the call seat) |
| `document_updates` | `owner_id`, `document_id`, `seq`, `created_at` | `update_ciphertext` |
| `document_snapshots` | `owner_id`, `document_id`, `through_seq` | `snapshot_ciphertext` |
| `document_versions` | `owner_id`, `document_id`, `version_id`, `created_at` | `info_ciphertext`, `state_ciphertext` |
| `workspace_media` | `owner_id`, `media_id`, `state` (`uploading`/`ready`), `bytes`, `pieces`, `created_at` | `info_ciphertext` (name, type, size, dimensions) |
| `workspace_media_pieces` | `owner_id`, `media_id`, `seq`, `object_id`, `sha256`, `length` | (the object) |
| `presenter_notes` | account `owner_id`, `document_id` | `body_ciphertext` |

Keys and records, by the pattern in `docs/engineering/privacy-keys-and-sessions.md`: state keys
`HKDF(Kowner, salt=ownerId, "alcove/state/v1/<scope>")` with scopes `workspace`, `document:<id>` and `media:<id>`.
Record kinds `workspace-state`, `document-update`, `document-snapshot`, `document-version`, `workspace-media`,
`media-piece`, `presenter-notes`, each with a header binding the workspace, document or media and the exact place (seq,
version or piece), so a record copied elsewhere fails to open.

`WorkspaceState` (sealed): `name`, and `items`, a map of id to `{ kind: 'document'|'folder', name, parent, pos, by,
createdAt, editedAt, trashedAt, restricted }`. `pos` is a fractional index string for sibling order. A move that would
make a cycle is refused. Keep it one record: a workspace's tree is small, and the server serialises changes with the
row lock, so no CRDT is needed for it. It is filtered per reader, so a Yjs tree shared to every member would leak names.

A document's title is the first node of its Yjs document, so it's edited together with carets. The editing browser also
renames the item (debounced 300 ms) so the list follows as you type.

Deleting: a trashed item is deleted for good after 30 days by maintenance, or at once by Delete forever. Everything
goes physically: rows, then objects through `object_gc`. Deleting an account takes it out of `workspace_members` and
`document_access` (by email index, unless another account still signs in with that address); a workspace left with no
members is deleted; a workspace left with no admin gets its longest-standing member as admin.

## Access

Resolved in one module, `apps/api/src/modules/workspaceAccess.ts`, the only place that decides. A reader is an account (email
index) or a guest in a call (seat MAC, from the call pass).

- A workspace member's role applies to every item, except a `restricted` document, which opens only for its creator and
  the people in `document_access`. Nobody else's list shows it. Being a workspace admin doesn't open a restricted document.
- `document_access` opens one document for someone outside the workspace: they see that document alone. Seat entries
  (guests) end with the call.
- Being the organizer gives nothing. Joining a call gives nothing.
- A trashed document stays readable to whoever had it open, read-only, until restored or deleted.
- Refusals never say what exists: someone with no access gets the same `not-found` for a real and a made-up ID.

Every change to membership or access re-checks live streams: a stream that lost access gets a `closed` line and ends.

## Live protocol

`POST` bodies are JSON with base64url binary. Each stream line is a zod-parsed event. All of it keeps no idempotency
receipt (add to `NO_RECEIPT`): Yjs updates are idempotent, and a receipt would hold content.

- `GET /v1/workspaces/:id/live`: the workspace's stream. `tree` (the reader's filtered tree, whole), `presence` (everyone
  here, whole: person, connection, call identity, document, block, typing; the document and block are null, with
  `elsewhere: true`, when the reader can't open that document), `mention`, `access`, `ping` every 25 s.
- `GET /v1/workspaces/:id/documents/:doc/live?after=<seq>`: a document's stream. First `sync` (a merged update and the
  seq it reaches), then `update`, `awareness`, `closed`, `ping`.
- `POST .../documents/:doc/updates`, `POST .../documents/:doc/awareness`, `POST /v1/workspaces/:id/presence`.

An update is sealed and appended in one transaction: `next_seq` is taken under the `documents` row lock and
`pg_notify('alcove_workspace', '<workspace>:<doc>:<seq>')` fires on commit. Each API instance runs one hub with one
dedicated `LISTEN` connection; on a notice it reads the sealed rows once and writes to its subscribers. Awareness and
presence are never stored: a `NOTIFY` carries them sealed under the workspace's state key. A person's identity on an
awareness line is added by the server, so nobody can write under another name.

Compaction: past 200 updates or 1 MiB since the last snapshot, the row is locked, `Y.mergeUpdates` writes a new snapshot
and the covered rows go. A version is kept at most every 10 minutes of editing, when a call ends, and before a restore.

Browser side: `DocSession` in `@alcove/api-http` owns the `Y.Doc` and sends updates batched at 150 ms and awareness at
100 ms. Status is `saved`, `saving`, `offline` or `failed`. It takes a `keep` store, which the app backs with IndexedDB
sealed under the device key (the pattern in `features/record/offline.ts`), so edits made offline survive a reload and
send on return. Node tests use the same class, so concurrent editing is tested through the real API.

## The editor

`apps/web/src/features/workspace/editor/`, loaded lazily so a call without the workspace pays nothing.

Blocks are flat: `doc` is `title block+`, so handles, drag and links are simple. Lists are flat blocks with an `indent`
attr. Every block has a stable `id` attr (a plugin re-issues duplicates after a split or paste). The Yjs root fragment
is named `content`; comments are the root map `comments`, each thread a `Y.Map` with a `Y.Array` of replies.

Blocks: `paragraph`, `heading` (1–3), `bullet`, `numbered`, `todo` (`done`), `toggle`, `quote`, `callout`, `divider`,
`code`, `table` (prosemirror-tables), `gallery`, `file`, `video`, `doclink`, `live` (`what`: decided or follow-ups, plus
the lines it last showed), `moment` (a quoted transcript line). Inline: `mention`, `dateChip`, `docref`, and `hardBreak`
for ⇧↵. Marks: `bold`, `italic`, `strike`, `inlineCode` (ProseMirror won't let a mark and a node share the name `code`),
`link`, `highlight`, `comment`. A `toggle` holds a `toggleSummary` and a `toggleBody`, both inline text, so it stays one
flat block. `docref` and `doclink` store only the document's ID, and its name is looked up for each reader, so a tag
never names a document to someone who can't open it. `unsupported` stands in for a block from a newer release, because
y-prosemirror deletes, for everyone, any element it can't make a node from.

Every document starts from the same seed: its title and first line are one fixed Yjs update under a fixed client ID, so
two browsers opening a new document merge into one title instead of two. Mount the editor after the first `sync`.
Anything the server writes into a new document has to start from that seed, or arrive before the editor mounts.

Yjs has no move, and y-prosemirror compares by position, so a move left to it would rewrite the text of every block it
passes. Moving a block edits the Yjs elements directly. A move or a change of kind deletes the element and inserts a
copy, so whoever typed in the old element while that was in flight puts their own words back into the new one; if two
people moved one block, every browser drops the same copy.

y-prosemirror gives sync, per-user undo (⌘Z undoes only your own changes) and carets, drawn as the canvas draws them:
one horizon colour, told apart by face and name. A `live` block is written by whichever editing browser in the call
sees new notes, so it fills in for everyone and stays as it was when the call ends.

## The call

`CallState` gains `workspace`, per viewer: which workspace, who chose it, whether you can open it, the documents
brought to the call that you can open, and `present` and `play`. All of it is sealed in the call's state with
`.default(...)`, so a call stored before this release still opens. New `CallAction`s set the workspace (organizer, with
at least edit in the target), bring a document, ask for access, grant it, and drive presenting and playing.

- **Choosing a workspace.** A meeting's manifest gains `workspaceId` (default null), carried to the next call in a
  series. With none, the organizer's most recently used workspace, else a new one in their name, made the first time
  anyone opens Workspace.
- **Layout.** `apps/web/src/features/call/panels.ts` is `ws-layout.js` made typed and pure: the tree, `adapt` (the fixed
  give-way order), `solve`, the people modes. It replaces the side panel's fixed place. Tiles stay in one absolutely
  placed layer so video never remounts when a panel moves. The arrangement is kept per account in this browser with a
  zod schema, as `view.ts` keeps its prefs.
- **Notes, Follow-ups, Transcript.** Built on what the call already has (`CallState.transcript`, catch-up, `liveNotes.ts`).
  Live notes become shared: the server keeps the call's latest catch-up sealed and refreshes it at most every 30 s, so
  everyone sees the same list, ticking is shared, and inference runs once instead of once per viewer.
- **Follow-ups from documents.** A `todo` with a mention and a date joins the call's follow-ups. The server reads them
  from the Yjs state of the documents worked on in the call, filtered to what each reader can open. Ticking one sets
  the block's `done` with a server-made Yjs update.
- **After.** The note's manifest gains `workedOn` (document IDs and who, default `[]`), shown only to those who can open
  each. The next call in a series gets a new agenda holding only what was left open.

## Copy

The canvas's words, exactly. Forward-looking per the repo's rule: sealed, Alcove can't read this, confidential compute.
Engineering docs stay honest about status: `docs/engineering/*` says what really happens, including that the API seals
uploads.

## How it's verified

Integration tests per the repo's rule, driving multiple browsers through `@alcove/api-http` against real Postgres and
object storage. Then every journey, walked in a real browser against the real stack with several accounts, screenshotted
wide and narrow, light and dark, beside the canvas's frame for that step. Those scripts live outside the repo.
