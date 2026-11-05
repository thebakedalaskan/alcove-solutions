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

Blocks are flat: `doc` is `title block+`, so handles, drag and links are simple. Lists are flat lines with an `indent`
attr. Every block has a stable `id` attr (a plugin re-issues duplicates after a split or paste). The Yjs root fragment
is named `content`; comments are the root map `comments`, each thread a `Y.Map` with a `Y.Array` of replies.

Every kind of line is one node, `line`, with a `kind`: absent for plain text, or `heading` (`level` 1–3), `bullet`,
`numbered`, `todo` (`done`), `quote`, `callout` (`icon`). `indent` is on list lines. Each of these is absent until it means
something, so turning a line into another kind is an attribute change that merges with anyone typing in it. The other
blocks are `toggle`, `divider`, `code`, `table` (prosemirror-tables), `gallery`, `file`, `video`, `doclink`, `live` (`what`:
decided or follow-ups, plus the lines it last showed), `moment` (a quoted transcript line). Inline: `mention`, `dateChip`,
`docref`, and `hardBreak` for ⇧↵. Marks: `bold`, `italic`, `strike`, `inlineCode` (ProseMirror won't let a mark and a node
share the name `code`), `link`, `highlight`, `comment`. A `toggle` holds a `toggleSummary` and a `toggleBody`, both inline
text, so it stays one flat block. A photo's caption is an attribute of its own on the `gallery`, `cap:<mediaId>`, so two
people captioning two photos don't write over each other. `docref` and `doclink` store only the document's ID, and its
name is looked up for each reader, so a tag never names a document to someone who can't open it.

y-prosemirror deletes, for everyone, what it can't make a node or mark from, and removes from an element what its node
doesn't carry. So nothing read from a document is refused, and a tab left open across a deploy damages nothing:
`unsupported` stands in for an unknown block or one that doesn't fit where it is, `unsupportedInline` for an unknown tag,
and unknown marks and attributes are learned as they're met and written back as they came.

The server makes every document with its title and first line, each with an empty text in it: one fixed Yjs update under a
fixed client ID, `DOC_SEED` in `@alcove/api`, so a document's first `sync` always has them and the editor never seeds. Mount
the editor after that.

A block's element is never deleted. Yjs has no move, and what lands in a deleted element is lost on every replica, so a
move, a join, a delete and a turn into something structural retire the element instead: what the browser can see is
deleted, attributes that say anything go with it, `gone` says which block took the words ('' if none did), and it gets a
new `id`. A retired element that holds nothing isn't on the page, and readers skip it: no words, no tags, dates or line
breaks, and no attribute written since it left, for toggles and tables as for lines. That rule and `retire` work on Yjs
alone, in `@alcove/api/retire`, so the editor and the server read one rule, and the server can retire a block too. That's
a separate entry of the package, because importing the contract doesn't load Yjs. An edit that reaches a retired element
later, from someone who hadn't heard, however long they were offline and whether or not they reloaded, is in a live
element, so Yjs keeps it on every browser and on the server, and the block is back on the page holding just those words,
where it was. Nothing has to notice for that to be true.

A text is never deleted either, for the same reason: only the words in it. y-prosemirror spares a text only when it's alone
in its line, so `write.ts` is its `updateYFragment` with that one rule added. A line's two sides are read as one run of
letters, with anything that isn't text as one letter, and only the stretch that differs is written. Where the change started
comes from where the caret was: comparing can't tell which of two same letters is new, and a letter typed in front of the
same letter would otherwise be recorded after it, which comes apart when a move copies only the old letters. Taking out a tag touches
no words, and leaves the texts either side next to each other. A line can hold any number of texts, side by side
or empty, and all of that reads the same to ProseMirror. A new line starts with an empty text in it, and whatever isn't
text has one either side, so nobody has to make a text while someone else may be making the same one: y-prosemirror's
reader merges two made side by side by deleting one.

Anything that takes a block off the page puts an empty stand-in back in ProseMirror, so it stays one node per element, and
the element is retired first in the same Yjs change as whatever else is being written, so nobody hears of a block leaving
without the words that went with it. What that writes is two small attributes on an element that's already there, `id` and
`gone`, and deletes: never new text and never a new element, so the size limit lets it through. A move edits the Yjs elements
directly, because writing back compares by position and would rewrite the text of every block the move passes. A copy is
new content, so a move is refused on a full document, and a join isn't, because it writes no more than it deletes. Only
tidying is left on top. The author's own browser folds words typed as a block left into the block they were meant for,
exactly where they stood and with their marks, in one step. If two people moved one block, every browser retires the same
copy, as soon as it hears or opens the document. And a browser that deleted something while someone else, who hadn't
heard, copied it as they moved the block, deletes it again from the copy: words, a tag, a caption, or the whole block. That's only
done when every letter of the copy can be accounted for, and where the same letters could be either, they're kept.

What can't be kept this way:

- A row or a column someone removes takes what was typed in it offline with it.
- A tick or a change of kind made offline on a block someone moved stays on the retired element, so the moved block keeps
  what it had.
- A deletion only crosses to a copy from the browser that made it, while it still has what it deleted: undo keeps that,
  until a reload. So words deleted offline can come back through a move if that person reloads before they reconnect, or
  closes the tab before they hear of the move. Live, that's the width of one batch.
- A tag dropped into the middle of a text divides it: what's after the tag is written again as a new text. Words being typed
  in that stretch at the time stay before the tag, and if two people do this to one text at once, what's after their tags
  is there twice. Nothing is lost.

A retired element stays in the document. Nothing can say nobody is still offline with an edit for it, so nothing prunes one
in this release. What each costs, after compaction: 85 bytes for Enter then Backspace, 108 for moving a line, 193 for a
toggle, and across 200 clients about 100 per retirement. A table costs every cell it has, because a retired table keeps
them for anyone offline typing in one, and they can't go without losing that: 5 KiB for 10×6 and 21 KiB for 30×8. So a table
moves by moving what it goes past, when that costs less, which makes ⌘⇧↑↓ cost what a line costs, and only a long drag
copies it. A retired table's cells aren't drawn. Every action on a page gets slower with what's retired in it, about
linearly: at 10,000 retired, a keystroke and Enter each take about 12 ms, and at 30,000 about 40 ms. Pruning can be added later without changing
what's stored, because open browsers follow an element going away, and that took 79% of the bytes in a test. It needs an
answer for edits older than whatever it keeps: `KeptUpdate` records when each was made, so a limit of 30 days offline is
possible then.

ProseMirror and Yjs have to hold the same document, because what's written is ProseMirror's document, on every view
update. Whatever goes wrong on the way to the page, `keepInStep` draws it again from Yjs, with a log line, and if that fails
too nothing is written until it works. Whoever is typing doesn't lose their place: the selection stays where it was by
block, or goes to the nearest place there is, and a key that couldn't be written is written again, with a toast if that
fails too. y-prosemirror can't put back a selected tag that's gone, or a selection of every block, so `keepInStep` does.
Someone who can only read never writes, from any path. Text can't be dragged, only blocks: a drag across blocks would be a
rewrite of everything it passes. A table two people left uneven stays as it is while people type in it, because two
browsers each evening it out would go on for ever, and it's evened out by whoever next adds or removes a row or column.

y-prosemirror gives sync, per-user undo and carets, drawn as the canvas draws them: one horizon colour, told apart by face
and name. ⌘Z undoes only your own changes, and follows them into a block someone else moved or joined, or into the block
your words were folded into. If someone else has already taken away what you did last, ⌘Z does nothing, rather than
something older somewhere else. A `live` block is written by whichever editing browser in the call sees new notes, so it
fills in for everyone and stays as it was when the call ends.

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
- **Notes, Follow-ups, Transcript.** Built on what the call already has (`CallState.transcript`, catch-up, `CallState.liveNotes`).
  Live notes are shared: the server keeps the call's latest catch-up sealed and refreshes it at most every 30 s, so
  everyone sees the same list, ticking is shared, and inference runs once instead of once per viewer
  ([Notes and inference › Live notes](../../engineering/notes-and-inference.md#live-notes)).
- **Follow-ups from documents.** A `todo` line with a mention and a date joins the call's follow-ups. The server reads them
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
