# In-call whiteboards: design

The approved design is the Design canvas <https://claude.ai/artifact/JkR1bitzMxispnPUDjAQrV> (version 11): 17 journeys, a
working board, states, anatomy, every tool, motion, and the main call compared with a room. Build it end to end.
GitHub issue #83 holds the acceptance criteria. This page records the engineering decisions the canvas can't
show. Where it's silent on how something looks or moves, the canvas decides.

The canvas source is the UI spec: `board.css` (styles), `Paper.html` (the board's markup), `Scene.html` (the call around
it, the Board menu, the note and the phone), `paper.js` (what a board draws), `live.js` (how the working board behaves),
`scenes.js` and `journeys.js` (every step, with the motion for each), `content.js` (templates and seed data), and
`States.html`, `Tools.html`, `Motion.html`, `Anatomy.html`, `Compare.html`.

Boards ride on the in-call workspace (`docs/superpowers/specs/2026-11-04-in-call-workspace-design.md`, #81), which is being
built alongside this by another session. The two were agreed between the sessions, so read that spec first; what it decides
isn't repeated here.

## Scope

In: everything in the journeys and reference boards, and everything in #83.

Out: nothing in the canvas. A menu item that does nothing is a dead end, so Table and Mind map under More are built too.

Changed since the canvas's first versions, and final: stickies carry no mark saying who wrote them, so a board doesn't show
or store a sticky's author.

## Rules that shape everything

AGENTS.md applies in full. The ones that bite here: nothing readable in a column, object name, URL, log line or error; a
leakage canary for board text; migrations only add, and sealed records still open; integration tests only, so nothing in
`@alcove/board` gets a test of its own, and it's proved through the real API; no `any`, `as`, `!` or suppressions; `console.*`
is banned; the app reaches the backend only through `api`; colours and motion come from tokens; every list has an empty
state; light and dark, phone and wide all work.

## Architecture in one paragraph

A board is a **workspace item** of kind `board` and a row in `documents`: the same update log, snapshots, versions, access,
restricted flag, trash and `DocSession` as a document. Only its Y.Doc's contents differ. **`@alcove/board`** is a new package
of pure TypeScript with no React: the Y.Doc's shape, connector routing, templates, text extraction and rooms landing. Both the
app and the API import it. The app draws it with **`<BoardSurface>`**, which takes a plain `Y.Doc` and awareness, so it's built
and exercised before the backend exists. In a call the board is one more thing on the stage: a `board` leaf in the panel tree
(`row[board, col[share, people]]`). What belongs to a call rather than to the board (which board is open, its timer, a vote,
ideas from the call) is **`CallState.board`**, sealed in the call's state.

## The board's Y.Doc

Three roots.

- `objects`, a `Y.Map` of id to `Y.Map`, one per object. Ids are 12 random base64url characters from the browser.
- `places`, one shared `Y.Array` of `{ k, x, y, w, h }`: where each object is. Each browser keeps its own run in it: a write puts the places it
  changes, as one block, right after the last entry that browser wrote (a browser's first write goes at the end), and deletes the entries they
  replace. When two browsers write one key at once, the later entry in the list wins. It's its own root because of how Yjs stores what's
  superseded: a `Y.Map` keeps every old value of a key for ever, so a busy board's `x` and `y` would reach the document's structure ceiling
  through churn alone, in about 300 two-second drags, while a run of one browser's deleted entries collapses into one struct. Measured over
  100,000 moves, each heard as it's made, dragging added 2 structs for one person dragging one sticky, 4 for two people each dragging their own
  sticky at the same time, and 3 for two people each dragging their own 200 stickies. Two people dragging the same sticky at the same moment
  added 50,001, one for every two moves (never more than one per move), and two people taking turns of 13 moves on one sticky 3,849. As map
  keys, the same moves added 200,000. Everything a drag changes lives here and nothing else does.
- `comments`, a `Y.Map` of thread id to `Y.Map`, each with a `Y.Array` of replies, as a document's are. A thread names the
  object it's pinned to.

| `k` | Fields beyond `at f`, and a place in `places` | Text |
| --- | --- | --- |
| `note` | `c` colour, `size` `s`/`m`/`l` | `t` |
| `text` | `size` `title`/`heading`/`body` | `t` |
| `shape` | `s` `rect`/`ellipse`/`diamond`/`pill`, `c` colour or none | `t` |
| `frame` | `c` the colour new stickies take inside it, or `''`; `role` `''`/`actions`; `hint` (shown while it's empty); `sub` (beside the title: who was in a room) | `title` |
| `line` | `style` `elbow`/`straight`/`curve`, `from`, `to`: each `{ on, side }` or `{ x, y }` (no `x y w h`) | none |
| `ink` | `tool` `pen`/`marker`, `c`, `pts` flat numbers relative to `x y`, at most 2000 points | none |
| `image` | `media` | none |
| `shot` | `media`, `caption` | none |
| `link` | `item`, a workspace item's id and nothing else | none |
| `table` | `rows`, `cols`: each a `Y.Array` of `{ id, size }` | `cells`, a `Y.Map` of `Y.Text` keyed `<rowId>:<colId>` |
| `node` | a mind map's node: `parent` | `t` |

A `line` has no place. `at` orders objects within a layer (frames, then lines, then everything else); `f` is the frame an object sits in, or `''`. A frame sits in
another only when the other holds its whole box, so dropping one frame beside another never turns a slide into a child.
A frame's order on the board is its order as slides. `x y w h` are board units, absolute: moving a frame moves what's in it, in
one transaction. `t` and `title` are `Y.Text`, so two people typing in one sticky merge. Everything else is last-write-wins per
key, which is what "move" and "recolour" should mean: whoever let go last. Deleting wins over a concurrent edit, and undo brings
the object back.

A `link` stores only an id because a name on the board would reach people who can't open that item: each reader's name for it comes from
their own tree, and someone who can't open it sees that. A table's rows and columns have ids so that inserting one while someone types in a
cell is safe.

What other people's browsers wrote is `unknown` until parsed: `readBoard` runs every object through a zod schema and leaves out
any that don't parse, so one bad object can't take a board down for everyone.

Every write is one `doc.transact(fn, origin)` through a function in `@alcove/board`.

**Undo is a history of plain copies, not Yjs's `UndoManager`.** That manager is built for text. On objects that several people edit at once it
restores or refuses item by item, so a field can end up with no value and an object can vanish for everyone, and working round that means
depending on its internals. So `makeHistory(doc, origin)` keeps a plain copy of every object and thread, updated by every transaction. A change
made under this browser's origin records, for each object it touched, the copy `before` and `after`. Undo walks that step back, and for each
object:

- **I added it** (`before` is nothing): it goes only if it's still exactly as I left it and nothing else points at it. If anyone has typed in it,
  moved it, recoloured it, drawn a line to it or commented on it, it stays.
- **I removed it** (`after` is nothing): it's made again from `before`, words and cells included, unless someone has already brought it back.
- **I changed it:** each field goes back only if it still holds what I set. A field someone has changed since stays theirs. Text is a field: words go
  back only if nobody has typed there since, and through a diff, so carets survive. Tables compare cell by cell.

So undo only ever takes back your own changes, and nobody's work is lost: the only things it removes are what you made that nobody has touched. A
press that can do nothing moves on to the step before it, so a press always does something if it can. A step that can't apply only because its object
is gone stays where it is, so it can still apply once the object comes back. Each stack keeps the last 100 steps. Redo is the same walk the other way. A
step is one transaction, or everything between `begin()` and `end()`: a drag, or all that's typed in one go. "Sort into themes" is one step.

Deleting an object takes the lines attached to it in the same transaction; a line left pointing at nothing by a concurrent delete isn't drawn.

Limits, enforced when writing and parsing: 5000 objects, 2000 points a stroke, 4000 characters of text an object or a table's cell, an
object between 16 and 8000 units a side, within a million units of the origin (so a camera can always fit the board), and tables up to 50 by
50. A board past 5000 says so and refuses more, rather than slowing down for everyone. Two browsers can pass the text and table limits
together, by merging what each did offline. Then the object stays: text shows its first 4000 characters with the `Y.Text` keeping everything,
and a table shows its first 50 rows and columns, so nobody's words are lost.

## Storage, keys and access

Nothing new. A board is a `documents` row, so its records, keys, compaction, versions and physical deletion are the document's
(`document-update`, `document-snapshot`, `document-version`). Its pictures are `workspace_media`, reached through a document: a seat on one
board sees that board's pictures and no others. `documentText` and search
read a board's words with `boardText` from `@alcove/board`. `documentTodos` gives nothing for a board: its follow-ups come from the note writer.

Boards need one thing from `workspaceAccess.ts` beyond documents: **`grantDocumentToCall(d, workspace, documentId, call, { role, place? })`**,
which gives one board to the people in a call or, with `place`, a room's people. Seat entries end with the call. A reader in a
call can be both an account and a seat, and room access is by seat, so a request carrying both a session and a call pass keeps both
identities, and either can grant.

Who can read what:

- **A main board** is an ordinary workspace item, as #83 asks: "Saved in Product" means that workspace's members can open it, by their
  role. On top of that, the call's invited people get `edit` by email, so it stays theirs through the note, and guests get a seat.
- **A saved board brought to a call.** Bringing one needs `edit` on it. If anyone here can't open it, the opener decides in the menu,
  before anything opens. "Let them in for this call" is offered only to someone who may share that board (the workspace's rule, so
  nobody gets past it through a call): it's a policy on the call, not a list, so anyone admitted later gets a seat too, and every seat
  ends with the call. "Open without them" leaves them out, and anyone admitted later who can't open it sees "A board you can't open".
- **A board in a room** is `restricted`, with no creator, because a restricted document opens for its creator and whoever started a
  room's board mustn't keep it after being moved out. Its readers are the seats of whoever is in that room now, kept in step by one
  function, `syncRoomBoards(call)`, run wherever people move. The organizer gets a seat while visiting and loses it on leaving. Being
  organizer gives nothing.
- **When rooms close** room seats go. A room's board stays `restricted`, and the call's invited people get `edit` by email, the same people
  as its sub-note: it's a saved board like any other to them, and workspace members who weren't invited never see it. What lands on the
  main board is readable by whoever can read that board. A saved board opened without someone still takes the frames; they keep their
  room's own board.
- Every change re-checks live streams (the workspace's rule), so someone moved out of a room loses the board at once.

## Pointers and following

One path everywhere: the document's **awareness**, at most every 100 ms, with the browser easing between updates. A browser's
awareness state is `{ at, view, sel, edit, typing }`: where its pointer is, its camera, what's selected, what's being edited, and
whether it's typing. The server adds who it is, so nobody points under another name.

Shared-screen pointers go through LiveKit instead, sealed end to end, and that was considered. Boards can't use it alone: a Shared
board spans rooms, whose keys differ, and a board's page has no call. Two paths for one job isn't worth it while the content
goes through the API anyway. If measurement says the API can't carry pointers, the awareness interface is what changes, not the
surface.

Following reads the followed person's `view`. Go to is one read of the same. Both are by the person's call identity on the awareness
line, which is how a tile finds a pointer. "Whoever is talking glows" comes from the call into the surface as a set of identities.

## The surface

`apps/web/src/features/board/`, loaded lazily so a call without a board pays nothing. `<BoardSurface>` takes `doc`, `awareness`,
`mode` (`call`, `page`, `tile`, `present`, `phone`, `read`), people and handlers for what's outside the board (upload, ideas,
sort into themes, go-to). Everything it draws comes from `@alcove/ui`.

The camera never re-renders objects: panning and zooming write one `transform` through a ref. Objects are DOM, positioned in board
units inside that one transformed layer, with lines and ink in one SVG. Past 500 objects, only those near the view are mounted.
Pointer moves are batched to one frame; another person's move re-renders that object alone, because `readBoard` keeps identity
for anything that didn't change. Text is edited in a `textarea` bound to the object's `Y.Text` by diffing, keeping the caret.

## The call

`CallState` gains `board`, per viewer and per part of the call, sealed in the call's state with `.default(...)`, so a call stored
before this release still opens.

```ts
board: {
  open: { workspaceId, documentId, name, openedBy, canClose, role, seal } | null,  // for the part of the call you're in
  timer: { until, length, text } | null,      // seconds since the call started
  vote: { on, per, left, mine, results, voters } | null,
  ideas: { id, text, said, frame }[],         // while notes are on
}
```

- **Opening.** Anyone invited, with the Board button (O, because B marks a moment). Guests can add but not start one. The board is saved in the call's workspace,
  from `workspaceForCall(d, call)`: the meeting's `workspaceId`, else the organizer's most recently used, else a new one in their
  name. A meeting's manifest gains `workspaceId` (default null), carried to the next call in a series. A new board is named after
  the call, or "<room> board" in a room. It's filled from its template by a server-made Yjs update, so everyone gets the same
  frames and nobody's undo can take them away.
- **Hiding is yours; closing is everyone's.** The dock button hides it for you alone: it drops to a live tile (`mode="tile"`). Closing is
  under its name, for whoever opened it or the organizer, and never deletes.
- **From the workspace list.** Opening a board there moves only you, like any item. "Open for everyone" is the Board button's flow.
- **With a share.** The board is the `board` leaf; a share goes at the top of the column beside it, tiles under it, and the same line
  resizes them, for your view only. Clicking swaps them. `Put on the board` takes the picture this browser is already showing, uploads it
  to the workspace's media and adds a `shot`; the sharer is told. It's the one capture of a screen that doesn't come from the presenter's
  own browser: a person's deliberate picture of what's on their own screen, which they could take anyway, so the docs say so plainly. It
  has nothing to do with notes, so pausing doesn't stop it.
- **Timer and votes** are the call's, not the board's, because they're about this session: a late joiner gets them from `CallState`, and
  a saved board has none. Votes are kept on the server, so nobody's browser holds anyone else's until the end. Each person's dots come
  back as `mine`; `results` is empty until the vote ends, then the counts for everyone at once. Done clears them. Nothing about a vote
  is written to the board.
- **Present** uses the workspace's present state, `{ kind: 'document' | 'board', id, ... }`. Top-level frames are the slides. It changes
  nobody's access.
- **Ideas from the call** run only while notes are on, from the part of the call you're in, at most once a minute while a board is open,
  through `inference.ts`. Each names who said it and the frame it fits. Adding one writes a sticky. Nothing is kept once it's added
  or dismissed.
- **Sort into themes** sends the selected stickies' text through `inference.ts` and applies the answer in one transaction. Someone asked
  for it, about what people wrote, so it works with notes off and on a board's page. While a call is paused nothing goes to the AI, so the
  server refuses and the bar doesn't offer it.

### Rooms

`BreakoutPlan` gains `board: { mode: 'none' | 'each' | 'shared', template }`, the panel's one new row.

- **In each room.** One board per room, made when rooms open, sealed to that room.
- **Started in a room.** The same menu; it says the board is only for this room.
- **Shared.** The main board gets a frame per room and everyone stays on it. The panel and the pill say plainly that it isn't private.
- **When rooms close** the server reads each room's board and writes a frame for it onto the main board in one Yjs update
  (`landBoards`), the frame named for the room with who was there. If there's no main board, one is made. Stickies flow in reading order
  into a two-column grid, as the canvas shows; anything else follows below them, except a `shot`, because what's shared in a room stays in
  the room. It's a copy for looking at together: the room's own board stays whole, saved like any other, and its sub-note links to it.

### After the call

The note carries the boards worked on (the workspace's `workedOn`, with `kind`), each room's in its own sub-note. A board shows as a small
live picture drawn by `mode="read"` from the document, with its name and "Open the board".

The note writer reads boards, as the seal says. When it drafts, it takes `boardText` of each board that was open in the call for everyone
as well as the transcript, and a room's board feeds that room's section. A board opened without someone is left out, because one summary goes
to everyone. Follow-ups from a board are ordinary `ActionItem`s written by the same writer, with `boardFollowUps` (the stickies in frames with
`role: 'actions'`, which templates set) marked in what it's given, so owners, ticking, the inbox and series carry-over all work with nothing
new. A `from: 'board'` field, default null, is what puts them under "Follow-ups from the board".

A board's page has the same surface without the call: no Timer, Vote or Present.

Scheduling a board into a call uses the call-creation work's `documents` on the meeting (`CallDocument`, kind `board`), not a second field.
It comes first in the Board menu and doesn't open by itself, because joining a call never opens a board. "Start a call here" opens the same
start flow with the board attached, and the board opens when the call starts, because that person asked for it.

## Copy

The canvas's words, exactly. Forward-looking per the repo's rule: sealed, Alcove can't read this, confidential compute. Board objects are
**stickies**, never notes: Notes is the AI's word. Engineering docs stay honest about status.

## Keys

M, V and C stay the call's on the board, so nobody turns their camera off by reaching for a tool. That's why Select is Esc. The full list
is in `Tools.html`. Keys sleep while typing in a sticky.

## How it's verified

Integration tests per the repo's rule, driving several browsers through `@alcove/api-http` against real Postgres and object storage, with
`@alcove/board` doing the edits: concurrent objects, attached connectors, undo isolation, audience isolation, late join and reconnect,
persistence, permission denials, revocation, deletion, and the leakage canary. Then every journey, walked in a real browser against the real
stack with several accounts, wide and narrow, light and dark, beside the canvas's frame for that step. Those scripts live outside the repo.
