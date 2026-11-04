# In-call whiteboards: design

The approved design is the Design canvas <https://claude.ai/artifact/JkR1bitzMxispnPUDjAQrV> (version 11): 17 journeys, a
working board, states, anatomy, every tool, motion, and the main call compared with a room. Ben's instruction: build it
end to end. GitHub issue #83 holds the acceptance criteria. This page records the engineering decisions the canvas can't
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

Two roots.

- `objects`, a `Y.Map` of id to `Y.Map`, one per object. Ids are 12 random base64url characters from the browser.
- `comments`, a `Y.Map` of thread id to `Y.Map`, each with a `Y.Array` of replies, as a document's are. A thread names the
  object it's pinned to.

| `k` | Fields beyond `x y w h at f` | Text |
| --- | --- | --- |
| `note` | `c` colour, `size` `s`/`m`/`l` | `t` |
| `text` | `size` `title`/`heading`/`body` | `t` |
| `shape` | `s` `rect`/`ellipse`/`diamond`/`pill`, `c` colour or none | `t` |
| `frame` | `c` the colour new stickies take inside it, `role` `''`/`actions`, `hint` (shown while it's empty) | `title` |
| `line` | `style` `elbow`/`straight`/`curve`, `from`, `to`: each `{ on, side }` or `{ x, y }` (no `x y w h`) | none |
| `ink` | `tool` `pen`/`marker`, `c`, `pts` flat numbers relative to `x y`, at most 2000 points | none |
| `image` | `media` | none |
| `shot` | `media`, `caption` | none |
| `table` | `rows`, `cols`: arrays of sizes; cells are `Y.Text` at `r<row>c<col>` | cells |
| `node` | a mind map's node: `parent` | `t` |

`at` orders objects within a layer (frames, then lines, then everything else); `f` is the frame an object sits in, or `''`.
A frame's order on the board is its order as slides. `x y w h` are board units, absolute: moving a frame moves what's in it, in
one transaction. `t` and `title` are `Y.Text`, so two people typing in one sticky merge. Everything else is last-write-wins per
key, which is what "move" and "recolour" should mean: whoever let go last. Deleting wins over a concurrent edit, and undo brings
the object back.

What other people's browsers wrote is `unknown` until parsed: `readBoard` runs every object through a zod schema and leaves out
any that don't parse, so one bad object can't take a board down for everyone.

Every write is one `doc.transact(fn, origin)` through a function in `@alcove/board`, so "Sort into themes" is one undo. Undo is a
`Y.UndoManager` on both roots with this browser's origin alone in `trackedOrigins`, which is exactly "undo only ever takes back
your own changes". Deleting an object takes the lines attached to it in the same transaction; a line left pointing at nothing by
a concurrent delete isn't drawn.

Limits, enforced when writing and parsing: 5000 objects, 2000 points a stroke, 4000 characters of text an object, an object
between 16 and 8000 units a side. A board past 5000 says so and refuses more, rather than slowing down for everyone.

## Storage, keys and access

Nothing new. A board is a `documents` row, so its records, keys, compaction, versions and physical deletion are the document's
(`document-update`, `document-snapshot`, `document-version`). Its pictures are `workspace_media`. `documentText`, `searchText`
and `documentTodos` switch on `kind`; the board case comes from `@alcove/board` (`boardText`, `boardFollowUps`).

Boards need one thing from `access.ts` beyond documents: **`grantDocumentToCall(d, workspace, documentId, call, { role, place? })`**,
which gives one board to the people in a call or, with `place`, a room's people. Seat entries end with the call. A reader in a
call can be both an account and a seat, and room access is by seat, so a request carrying both a session and a call pass is
checked against both.

- **A new board in a call:** the call's invited people get `edit` by email, so it stays theirs through the note. Guests get a seat.
- **A saved board brought to a call:** if anyone here can't open it, the opener decides in the menu, before anything opens: "Let them
  in for this call" (seats only, ending with the call) or "Open without them".
- **A board in a room:** seats of whoever is in that room now, kept in step with the room by one function, `syncRoomBoards(call)`,
  run wherever people move. The organizer gets a seat while visiting and loses it on leaving. Being organizer gives nothing.
- **When rooms close:** room seats go, and the call's invited people get `edit` by email, the same rule as a room's sub-note.
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

- **Opening.** Anyone invited, with the Board button (B). Guests can add but not start one. The board is saved in the call's workspace,
  from `workspaceForCall(d, call)`: the meeting's `workspaceId`, else the organizer's most recently used, else a new one in their
  name. A meeting's manifest gains `workspaceId` (default null), carried to the next call in a series. A new board is named after
  the call, or "<room> board" in a room. It's filled from its template by a server-made Yjs update, so everyone gets the same
  frames and nobody's undo can take them away.
- **Hiding is yours; closing is everyone's.** The dock button hides it for you alone: it drops to a live tile (`mode="tile"`). Closing is
  under its name, for whoever opened it or the organizer, and never deletes.
- **From the workspace list.** Opening a board there moves only you, like any item. "Open for everyone" is the Board button's flow.
- **With a share.** The board is the `board` leaf; a share goes at the top of the column beside it, tiles under it, and the same line
  resizes them, for your view only. Clicking swaps them. `Put on the board` takes the picture this browser is already showing, uploads it
  to the workspace's media and adds a `shot`; the sharer is told.
- **Timer and votes** are the call's, not the board's, because they're about this session: a late joiner gets them from `CallState`, and
  a saved board has none. Votes are kept on the server, so nobody's browser holds anyone else's until the end. Each person's dots come
  back as `mine`; `results` is empty until the vote ends, then the counts for everyone at once. Done clears them. Nothing about a vote
  is written to the board.
- **Present** uses the workspace's present state, `{ kind: 'document' | 'board', id, ... }`. Top-level frames are the slides. It changes
  nobody's access.
- **Ideas from the call** run only while notes are on, from the part of the call you're in, at most once a minute while a board is open,
  through `inference.ts`. Each names who said it and the frame it fits. Adding one writes a sticky. Nothing is kept once it's added
  or dismissed.
- **Sort into themes** sends the selected stickies' text through `inference.ts` and applies the answer in one transaction.

### Rooms

`BreakoutPlan` gains `board: { mode: 'none' | 'each' | 'shared', template }`, the panel's one new row.

- **In each room.** One board per room, made when rooms open, sealed to that room.
- **Started in a room.** The same menu; it says the board is only for this room.
- **Shared.** The main board gets a frame per room and everyone stays on it. The panel and the pill say plainly that it isn't private.
- **When rooms close** the server reads each room's board and writes a frame for it onto the main board in one Yjs update
  (`landBoards`), the frame named for the room with who was there. If there's no main board, one is made. Stickies flow in reading order
  into a two-column grid, as the canvas shows; anything else follows below them. It's a copy for looking at together: the room's own board
  stays whole, saved like any other, and its sub-note links to it.

### After the call

The note carries the boards worked on (the workspace's `workedOn`, with `kind`), each room's in its own sub-note. A board shows as a small
live picture drawn by `mode="read"` from the document, with its name and "Open the board". Follow-ups come from `boardFollowUps`:
the stickies in frames with `role: 'actions'`. Templates set that role.

A board's page has the same surface without the call: no Timer, Vote or Present. "Start a call here" starts a call with the board open.

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
