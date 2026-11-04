# In-call whiteboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved whiteboards canvas in Alcove, end to end, so it works for real across calls and looks like the canvas.

**Architecture:** A board is a workspace item of kind `board` and a `documents` row, so it shares the workspace's sealed Yjs log, access and `DocSession`. `@alcove/board` holds the Y.Doc's shape and pure logic for both the app and the API. `<BoardSurface>` draws a plain `Y.Doc`. In a call it's a `board` leaf in the panel tree, and what belongs to the call is `CallState.board`.

**Tech Stack:** `yjs` 13, `y-protocols`, React 19, Motion, Tailwind v4, Hono, Postgres, S3-compatible objects, Vitest (integration only).

**Spec:** `docs/superpowers/specs/2026-11-04-in-call-whiteboards-design.md`. Read `docs/superpowers/specs/2026-11-04-in-call-workspace-design.md` too: boards ride on it.

## Global Constraints

- AGENTS.md applies to every task. Read it first, and `.claude/skills/strict-typescript/SKILL.md` before writing TypeScript.
- Canvas source, the UI spec for every task: `CANVAS=/private/tmp/claude-501/-Users-benjaminkurrek--superset-worktrees-the-privacy-suite-create-depth-artifact-showing-446d60ca/e4834bb5-5819-4e08-b444-ba8449bd0c18/scratchpad/wb`. `$CANVAS/src/` has `board.css`, `Paper.html`, `Scene.html`, `paper.js`, `live.js`, `scenes.js`, `journeys.js`, `content.js`, `States.html`, `Tools.html`, `Motion.html`, `Anatomy.html`, `Compare.html`. `$CANVAS/site-live/Sandbox.dc.html` is the working board when served by `$CANVAS/serve.py`. Read it; never copy its fictional data into the app.
- Fidelity: same layout, spacing, type, colours, motion durations and words as the canvas. Port `board.css` rather than restyling. A difference needs a reason.
- UI copy is the canvas's words, exactly. Board objects are stickies, never notes. Use "they" for people. No "coming soon".
- No test files except `*.integration.test.ts` through the real API. `@alcove/board` and the surface get no tests of their own: they're proved by Stage 3's tests and by scratch pages outside the repo, never committed.
- Stickies show and store no author.
- One `yjs` in the tree: match the range the workspace's editor pins.
- Before merging to main, message the workspace session (`create-depth-artifact-showing-c9732571-d6`), and take turns. Renumber a migration after whatever's on main.
- Every task updates the docs it makes untrue (`docs/engineering/*`, `docs/product/*`) in the same PR.
- A PR that changes a schema or stored shape says how rows and records from the previous release read afterwards.

## Review Focus

- Two people typing in one sticky through a dropped connection: nobody's words are lost, nothing is duplicated, and reload shows the merged text.
- Someone moved out of a room, or the organizer leaving one: they lose that board at once, and nothing of it shows.
- Undo after someone else changed the same object, or deleted it: only your own change goes back, and nobody's work is lost.
- A key pressed while typing in a sticky: M, V and C type letters and never touch the microphone or camera.
- Eight people on a board of 500 objects: pan and zoom stay smooth, and pointers don't swamp the API. Measure it.

---

## Stage 1: start now, new files only

### Task 1: `@alcove/board`

**Files:**
- Create: `packages/board/package.json`, `packages/board/tsconfig.json`, `packages/board/src/{index,shape,read,write,geometry,routes,templates,text,land,presence}.ts`
- Modify: `apps/web/package.json`, `apps/api/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces in `shape.ts`: `BOARD_OBJECTS = 'objects'`, `BOARD_COMMENTS = 'comments'`, `BOARD_LIMITS = { objects: 5000, points: 2000, text: 4000, minSide: 16, maxSide: 8000 }`, `STICKY_COLOURS = ['butter','peach','rose','lilac','sky','mist']`, `BoardObject` (a union on `k`, per the spec's table, with text fields read out as plain strings), `Box { x, y, w, h }`, `NewObject`, `BoardView { objects, byId, frames }`, `newId(): string`.
- Produces in `read.ts`: `readBoard(doc: Y.Doc, prev?: BoardView): BoardView` (zod-parses each object, leaves out what doesn't parse, keeps `prev`'s object identity for what didn't change, sorted by layer then `at`); `observeBoard(doc, onChange: () => void): () => void`; `objectText(doc, id, field = 't'): Y.Text | null`.
- Produces in `write.ts`, each one `doc.transact` under `origin: unknown`: `addObject(doc, input: NewObject, origin): string | null` (null past the limit), `moveObjects(doc, moves: { id: string; x: number; y: number }[], origin)` (a frame's contents move with it, and `f` is reassigned by where each object lands), `resizeObject(doc, id, box: Box, origin)`, `setObjects(doc, ids, patch, origin)`, `removeObjects(doc, ids, origin)` (takes attached lines too), `duplicateObjects(doc, ids, by: { x: number; y: number }, origin): string[]`, `tidyObjects(doc, ids, origin)`, `applyThemes(doc, themes: { name: string; ids: string[] }[], origin)`, `addThread(doc, on, text, origin): string`, `addReply(doc, thread, text, origin)`, `makeUndo(doc, origin): Y.UndoManager`.
- Produces in `geometry.ts`: `bounds(boxes: Box[]): Box`, `frameAt(view, x, y): FrameObject | null`, `colourIn(view, frame): StickyColour`, `fit(box, W, H, pad?): Camera` where `Camera { x, y, z }`, `hit(view, x, y): BoardObject | null`, `inside(view, box): BoardObject[]`.
- Produces in `routes.ts`: `route(a: Box, b: Box, style): { d: string; head: string }`, `freeRoute(a: Box, to: [number, number], style)`, `shapePath(s, w, h): string`.
- Produces in `templates.ts`: `TEMPLATES = ['blank','retro','ideas','flow','what-why-next']`, `fillTemplate(doc, name, origin)`.
- Produces in `text.ts`: `boardText(doc): string`, `boardFollowUps(doc): { id: string; text: string }[]`.
- Produces in `land.ts`: `landBoards(main: Y.Doc, rooms: { name: string; who: string[]; doc: Y.Doc }[], origin)`.
- Produces in `presence.ts`: `BoardPresenceSchema`, `BoardPresence { at, view, sel, edit, typing }`, `NO_PRESENCE`.

- [ ] Port from `$CANVAS/src/paper.js` (`bounds`, `fit`, `shapePath`, `route` and its helpers, unchanged numbers) and `live.js` (`frameAt`, `colourIn`, `tidy`, `sortThemes`). Templates and their words come from `content.js`; `retro`'s Actions frame and `what-why-next`'s last frame get `role: 'actions'`. Keep `content.js`'s frame sizes, hints and colours; its stickies are fiction and stay behind.
- [ ] Prove it with a Node script in the scratchpad, outside the repo: two `Y.Doc`s exchanging updates converge on concurrent adds, moves and typing; a malformed object is left out; undo in one doc leaves the other's changes alone; `landBoards` produces the canvas's layout for three rooms.
- [ ] Run `pnpm typecheck`. Commit.

### Task 2: The board kit

**Files:**
- Create: `packages/ui/src/styles/board.css`, `packages/ui/src/components/board.tsx`
- Modify: `packages/ui/src/styles.css`, `packages/ui/src/index.ts`, `packages/ui/src/components/icon.tsx`, AGENTS.md (component list, class prefix, and that frame titles and a board's name use `font-display`)

**Interfaces:**
- Produces stateless components taking data and handlers, with no Yjs: `BoardRail`, `BoardBar`, `BoardPill`, `BoardPop`, `BoardFlyout`, `BoardSelectionBar`, `BoardSelectionBox`, `BoardDots`, `BoardFrame`, `BoardSticky`, `BoardText`, `BoardShape`, `BoardPicture`, `BoardPointer`, `BoardHeard`, `BoardTray`, `BoardMap`, `BoardMenu` (the Board button's menu, with its access step), `BoardEmpty`, `BoardComment`. Report their final props.

- [ ] Port `$CANVAS/src/board.css` to `board.css`: the board's rules only, not the canvas's journey, strip or compare styles. Classes keep their names, except where AGENTS.md's prefixes or a collision says otherwise. `[data-theme="dark"]` becomes `.dark`. Tokens `--bd-*`, `--bf-*`, `--note-*`, `--line-ink` go in `styles.css`, light on `:root`, dark on `.dark`. Raw hex only on what's night.
- [ ] Port each surface of `Paper.html`, and the menu from `Scene.html`, to a stateless component with the same markup and classes. Reuse `PointerTag`, `SharePointer`, `Avatar`, `Faces`, `IconButton`, `Popover`. Add the canvas's extra icons to `Icon`.
- [ ] Render each in a scratch page outside the repo beside the canvas, light and dark. Run `pnpm typecheck` and `pnpm build`. Commit.

### Task 3: The surface

**Files:**
- Create: `apps/web/src/features/board/{BoardSurface.tsx,useBoard.ts,camera.ts,gestures.ts,selection.ts,editing.tsx,keys.ts}`

**Interfaces:**
- Consumes: Task 1 and Task 2.
- Produces: `<BoardSurface doc={Y.Doc} awareness={Awareness} mode="call"|"page"|"tile"|"present"|"phone"|"read" people talking onHandlers />` and `BoardHandle` with `fit()`, `goTo(view)`, `follow(id | null)`, `focusFrame(id)`.

- [ ] Port `$CANVAS/src/live.js`'s pointer, wheel, key and selection behaviour onto `@alcove/board`. Pan and zoom by trackpad, mouse, space-drag and pinch; fit; select, shift-select, marquee, move, resize; double-click for a sticky in the frame's colour; Tab starts the next; Esc finishes; a `textarea` bound to the object's `Y.Text`; undo and redo through `makeUndo`. The camera writes one `transform` through a ref and never re-renders objects. Objects past 500 mount only near the view.
- [ ] Keys sleep while typing. M, V and C are never taken.
- [ ] Verify two surfaces on one `Y.Doc` in a scratch page outside the repo against `$CANVAS/site-live/Sandbox.dc.html`, light and dark, including 500 objects. Run `pnpm typecheck` and `pnpm build`. Commit.

### Task 4: Every tool

**Files:** create `apps/web/src/features/board/tools/*`; modify `BoardSurface.tsx`.

**Interfaces:** consumes Task 3. Produces the tools behind the rail and the bars, and the `moreItems` handlers that later tasks fill.

- [ ] Shape, Text, Line (dots, drop on an object, elbow, straight, curved, re-routing when either end moves, free ends), Pen (pen, highlighter, eraser, smoothing), Frame (draw, title, move with contents, empty hint), the selection bar and flyouts, Tidy, duplicate, delete, zoom and the map, per `Tools.html` and `Anatomy.html`.
- [ ] Verify each against `Tools.html` in the scratch page, two surfaces, undo after each. Run `pnpm typecheck` and `pnpm build`. Commit.

### Task 5: Presence

**Files:** create `apps/web/src/features/board/presence.tsx`, `follow.ts`; modify `BoardSurface.tsx`.

**Interfaces:** consumes Task 3 and `Awareness`. Produces pointers with a face and name, talking glow from `talking`, typing dots, the ring on what someone else is editing, Follow with its ring and pill, and Go to.

- [ ] Publish `BoardPresence` at most every 100 ms and ease between updates. Following stops on scroll, zoom and Esc. A pointer idle for 6 s goes.
- [ ] Verify with two surfaces in the scratch page. Run `pnpm typecheck` and `pnpm build`. Commit.

## Stage 2: after A1 merges

### Task 6: Media (the workspace's Task B2)

As `docs/superpowers/plans/2026-11-04-in-call-workspace.md` Task B2 has it: 4 MiB sealed pieces, `Range`, `nosniff`, `no-store`, its formats, 512 MiB a file. One change, proposed to the workspace session and not yet agreed: media is reached through a document, because a guest's seat covers one document and an `<img>` can't send a header. A `workspace_media_uses` table; `upload(workspaceId, documentId, file, { onProgress })`; `url(workspaceId, documentId, mediaId): Promise<string>` with a short-lived signed token; `attach(workspaceId, documentId, mediaId)` for reuse. Its C3 builds on this, so settle it before starting.

## Stage 3: after B1 merges

### Task 7: Boards are workspace items

**Files:** create `apps/api/src/boards.integration.test.ts`; modify `apps/api/src/modules/documents.ts` (`documentText`, `searchText`, `documentTodos`), `apps/api/src/modules/workspaces.ts`, the leakage test, `packages/api-http` as needed.

- [ ] Tests first, the whole of #83's Validation through the real API, with `@alcove/board` making the edits in several browsers: concurrent stickies converge; a connector stays attached through moves; undo takes back only your own; late join and reconnect get the current board; edits survive a reload and an API restart; a read-only reader's update is refused; revocation ends the stream; a trashed board stays readable and is deleted physically; a template fills once; `boardText` reaches search; the canary finds no board text in any column, object or log.
- [ ] Implement. Run `pnpm check`.

### Task 8: A board's page

After the workspace's B3. New board in the `+` menu and the Board item in `/`, the route, `mode="page"`, saved, reconnecting and couldn't-save states, the read-only and no-access states from `States.html`, Share, offline edits, Rename, Copy link, and comments.

## Stage 4: after A2 merges

Refine these from A2's final contract before starting. Tasks 10 to 14 can run in parallel.

### Task 9: `CallState.board`

Contract, `workspaceForCall` and `grantDocumentToCall` in `access.ts` (tell the workspace session), `workspaceId` on the meeting manifest, opening with a template or a saved board, the access step, closing. Tests: starting, late joiners, reconnects, guests add but can't start, bringing a board needs `edit`, "Let them in" needs the right to share, someone admitted later under each choice, seats ending with the call, a stored call still opens, cross-owner IDs.

### Task 10: The board on the stage

Journeys: start, joining, close. The dock button and B, the Board menu, the `board` leaf, the rise, people to the strip, hide for you, the live tile, the title menu, closed toast, the Keyboard board entry.

### Task 11: With a shared screen

Journey: screen. The preset, the line, the swap, Put on the board with its toast and caption.

### Task 12: Timer and votes

Journey: run. Server-side votes, `mine`, results at the end, the chime. Tests: nobody's browser gets a count before the end; a late joiner gets the timer; a second vote can't start on top of the first.

### Task 13: Rooms

Journeys: setup, in a room, no board, oversee, close, shared. `BreakoutPlan.board`, `syncRoomBoards`, the panel's row, the seals, the organizer's visit, `landBoards` on close, Shared. Tests: a room's board refuses anyone outside it, workspace members and its starter included once they're not in the room; the moved and the visiting lose and gain it at once; landing happens once however many browsers are there; a landed frame holds the room's stickies and no pictures; after close, invited people can open a room's board and uninvited members can't.

### Task 14: The call helps

Journey: help. Ideas while notes are on, the tray, adding, Sort into themes through `inference.ts`. Tests: no ideas with notes off; Sort works with notes off and is refused while paused; a room's ideas stay in the room.

## Stage 5: after the workspace's C5 and C6

### Task 15: Present

Journey: present. Frames as slides, the presenter view, the audience's view, Look around and Back to Art, rooms' frames as slides. Tests: audience isolation, and that presenting changes nobody's access.

### Task 16: After the call

Journeys: close's last steps, notes. Boards on the note and in sub-notes with `mode="read"`; the note writer reading boards; follow-ups as `ActionItem`s with `from: 'board'`; Open the board; a board scheduled into a call through the meeting's `documents` once call creation has merged; Start a call here through its start flow; a board brought to the next call. Tests: a board opened without someone isn't in the summary; a room's board feeds only its section; a stored note still opens.

## Stage 6

### Task 17: More, and the phone

Image, From your workspace, Table, Mind map, Comment, Templates, Download as an image, Download as a PDF, Night board; journey: phone at 390 px.

### Task 18: Every journey, end to end

- [ ] Walk every journey and reference board on the real stack, wide and narrow, light and dark, beside the canvas. Fix every difference.
- [ ] Update `docs/product/user-flows.md`, `docs/product/overview.md`, `docs/engineering/system-architecture.md`. Close #83 with what shipped.
- [ ] Verify production after the last deploy.
