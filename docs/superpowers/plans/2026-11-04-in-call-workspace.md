# In-call workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved in-call workspace canvas in Alcove, end to end, so it works for real across calls and looks like the canvas.

**Architecture:** A workspace is an owner with its own keys. Its tree is one sealed state; documents are Yjs documents sealed into an append-only log; live traffic is NDJSON down and POST up, relayed between API instances by Postgres `NOTIFY`. The editor is ProseMirror with y-prosemirror. In a call every surface is a panel in a solved tree.

**Tech Stack:** Hono, Postgres, S3-compatible objects, `yjs`, `y-protocols`, `y-prosemirror`, `prosemirror-*`, `prosemirror-tables`, React 19, TanStack Router and Query, Motion, Tailwind v4, Vitest (integration only).

**Spec:** `docs/superpowers/specs/2026-11-04-in-call-workspace-design.md`

## Global Constraints

- AGENTS.md applies to every task. Read it first, and `.claude/skills/strict-typescript/SKILL.md` before writing TypeScript.
- Canvas source, the UI spec for every task: `CANVAS=/private/tmp/claude-501/-Users-benjaminkurrek--superset-worktrees-the-privacy-suite-create-depth-artifact-showing-c9732571/5ccd2617-49e8-452a-bb4a-15d67de25532/scratchpad/canvas`. `$CANVAS/src/` has `ws.css`, `WS.src.html`, `ws-core.js`, `ws-ui.js`, `ws-layout.js`, `ws-journeys.js`, `ws-data.js`. `$CANVAS/project/` is the built canvas, servable with `support.js`. Read it; never copy its fictional data into the app.
- Fidelity: same layout, spacing, type, colours, motion durations and words as the canvas. Port `ws.css` rather than restyling. A difference needs a reason.
- UI copy is the canvas's words, exactly. Use "they" for people. No "coming soon".
- Boards are out of scope: no New board, Board block, B key or Board dock button.
- Every task updates the docs it makes untrue (`docs/engineering/*`, `docs/product/*`) in the same PR.
- Every task that stores data: new record kind and header, a canary in the leakage test, a cross-owner or cross-workspace test for every ID from a request.
- A PR that changes a schema or stored shape says how rows and records from the previous release read afterwards.

## Review Focus

- Two people typing in the same line through a dropped connection: nobody's words are lost, and reload shows the merged text.
- Someone whose access is revoked mid-session: their stream ends, their edits are refused, and presence and follow stop naming the document.
- A document name, folder or person leaking to someone with no access: through the tree, presence, follow, mentions, search text, errors or logs.
- The call itself regressing: shares, pins, spotlight, rooms, captions and the side panel still work with the workspace closed, at every width.
- A stored call or note from the previous release opening after the deploy.

---

## Stage A: start in parallel

### Task A1: Workspaces, tree and access

**Files:**
- Create: `apps/api/migrations/NNNN_workspaces.sql`, `packages/api/src/workspaces.ts`, `apps/api/src/modules/workspaces.ts`, `apps/api/src/modules/workspaceAccess.ts`, `apps/api/src/workspaces.integration.test.ts`
- Modify: `packages/api/src/client.ts`, `packages/api/src/index.ts`, `apps/api/src/app.ts`, `packages/api-http/src/index.ts`, `apps/api/src/modules/account.ts` (deletion), `apps/api/src/maintenance.ts`, `docs/engineering/data-and-storage.md`, `docs/engineering/privacy-keys-and-sessions.md`

**Interfaces:**
- Produces: `api.workspaces` on `AlcoveApi`: `list`, `create`, `rename`, `remove`, `people`, `addPerson`, `setRole`, `removePerson`, `items` (`create`, `rename`, `move`, `duplicate`, `trash`, `restore`, `deleteForever`), `share` (`list`, `set`, `remove`, `restrict`), `live(id): WorkspaceLive`. `WorkspaceLive extends LiveStore<WorkspaceView>` with `tree`, `people here` and a `close()`.
- Produces in `workspaceAccess.ts`: `readerOf(c)`, `workspaceFor(d, reader, workspaceId)`, `requireDocument(reader, workspace, documentId, need: 'read' | 'edit')`. Later tasks use these and nothing else to decide access.
- Produces: `apps/api/src/live/hub.ts`, the per-instance hub with its `LISTEN` connection, used by B1.

- [ ] Tests first in `workspaces.integration.test.ts`: create, list, rename a workspace; members and roles; create, rename, move, reorder, duplicate, trash, restore, delete an item; a cycle is refused; a restricted document is absent from others' trees and `not-found` by ID; a document shared to a non-member shows that document alone; a read member can't change anything; deleting an account leaves no member rows, and an empty workspace goes; two API instances (`h.secondServer()`) see each other's tree changes on the live stream; the leakage test finds no name, folder or email in any column, object or log.
- [ ] Implement until they pass. Run `pnpm check`.
- [ ] Commit in logical steps. Report the migration number and the final contract names.

### Task A2: Call panels

**Files:**
- Create: `apps/web/src/features/call/panels.ts`, `apps/web/src/features/call/Panels.tsx`
- Modify: `apps/web/src/routes/call.$code.tsx`, `apps/web/src/features/call/Stage.tsx`, `stageLayout.ts`, `Panel.tsx`, `ViewMenu.tsx`, `TopBar.tsx`, `view.ts`, `packages/api/src/live.ts` (the prefs schema), `packages/ui/src/styles/call.css`, `packages/ui/src/components/call.tsx`, `docs/engineering/calls-and-recordings.md`

**Interfaces:**
- Produces `panels.ts`, pure: `PanelTree`, `adapt`, `solve(tree, size, facts) -> { rects, dividers, tiles, gave }`, `moveLeaf`, `tearTab`, `swapLeaves`, `dragDivider`, `preset`, `reset`, people modes `tiles | arches | hidden`. Leaves: `people`, `share:<id>`, `g:<group>` (a tabbed group), and `ws` (a slot C1 fills; empty and never shown until then).
- Produces `<PanelHost>` taking a render prop per leaf kind.

- [ ] Port `$CANVAS/src/ws-layout.js` to typed, pure `panels.ts`. Keep its numbers: minimums, give-way order, snap at half, double-click to even.
- [ ] Shares become panels, side-panel tabs can be torn off and dropped back, any panel moves by its handle with the sunrise glow drop preview, and the View menu holds the presets, people modes and Reset my view. Hidden people stand on the horizon beside the dock and whoever talks rises 9 px.
- [ ] Keep every behaviour `Stage.tsx` has: pins, order, big tiles, spotlight, rooms, captions, share looks, pointing, marks, pop-out, self view. A share still takes the stage when nothing else is open, and a share never moves what you have open.
- [ ] No tile remounts when a panel moves: verify a playing video keeps playing.
- [ ] Verify in a real browser with a real call at 1880, 1440, 1100, 820 and 390 px, light and dark, against the canvas's Drag the window and Eight ways to sit boards. Run `pnpm check`.

### Task A3: The editor

**Files:**
- Create: `apps/web/src/features/workspace/editor/` (`schema.ts`, `Editor.tsx`, `plugins/*`, `blocks/*`, `menus/*`), `packages/ui/src/styles/workspace-editor.css`
- Modify: `apps/web/package.json`, `packages/ui/src/styles.css`

**Interfaces:**
- Produces `<Editor doc={Y.Doc} awareness={Awareness} readOnly people={...} onMention onUpload onOpenDocument onComment ... />` and `EditorHandle` with `focusBlock(id)`, `scrollToBlock(id)`, `insertBlocks(blocks, at)`, `selectionBlock()`.
- Consumes a plain `Y.Doc`, so it builds before the backend exists.

- [ ] Schema per the spec. Every text block, inline node and mark; `/` menu with typed filtering and keys; the shortcuts (`#`, `##`, `###`, `-`, `1.`, `[]`, `>`, `---`); the format bar; hover handles (plus adds below, dots drag or open the block menu); drag with the landing line; Tab indent; ⌘B, ⌘I, ⌘Z, ⇧↵; carets with face and name; the block menu (turn into, duplicate, copy link, delete).
- [ ] Media, `live` and `moment` blocks render from attrs with handlers supplied by props, so C3 and C4 only wire them.
- [ ] Verify with two editors on one Y.Doc through a relay in a scratch page outside the repo, in light and dark, against the canvas's Every block board and the Write together journey. Don't commit the scratch page. Run `pnpm typecheck` and `pnpm build`.

### Task A4: The workspace kit

**Files:**
- Create: `packages/ui/src/styles/workspace.css`, `packages/ui/src/components/workspace.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/src/styles.css`, `packages/ui/src/components/icon.tsx`, AGENTS.md (component list)

**Interfaces:**
- Produces stateless components taking data and handlers: `WsList`, `WsRow`, `WsSection`, `WsDocHead`, `WsSaveState`, `WsMenu`, `WsPopover`, `WsToast`, `WsFollowBar`, `WsPresentStrip`, `WsPlayBar`, `WsNoAccess`, `WsEmpty`, `WsTemplates`, `WsNotesPage`, `WsFollowUps`, `WsTranscript`, `WsShareSheet`, `WsSwitchSheet`, `WsFind`, `WsHistory`, `WsCommentThread`, and the rest of `WS.src.html`'s surfaces.

- [ ] Port `$CANVAS/src/ws.css` to `workspace.css` (the app's rules, not the canvas's board styles), tokens unchanged, classes kept. Add the canvas's extra icons to `Icon`.
- [ ] Port each surface of `WS.src.html` to a stateless React component with the same markup and classes. No data fetching, no fictional data.
- [ ] Render each in a scratch page outside the repo beside the canvas, light and dark. Run `pnpm typecheck` and `pnpm build`.

## Stage B: after A1 merges

### Task B1: Live documents

**Files:** create `packages/api/src/documents.ts`, `apps/api/src/modules/documents.ts`, `packages/api-http/src/documents.ts`, `apps/api/src/documents.integration.test.ts`; modify `apps/api/src/app.ts`, `packages/api/src/client.ts`, `docs/engineering/*`.

**Interfaces:**
- Produces `api.workspaces.document(workspaceId, documentId, opts?: { keep?: KeptUpdates }): DocSession` where `DocSession extends LiveStore<DocStatus>` has `doc: Y.Doc`, `awareness`, `close()`.
- Produces `versions`, `version`, `searchText` on `api.workspaces`, and server helpers `readDocument`, `writeDocument`, `documentTodos`, `documentText`.

- [ ] Tests first: two browsers edit one document at once and converge; edits survive a reload and an API restart; a client offline for a while merges on return; a read-only reader's update is refused; a stream ends when access is revoked; awareness carries the server's identity, never a forged one; compaction keeps content and removes covered rows; two instances relay updates and awareness; versions list and read back; the leakage test finds no text, title, mention or comment.
- [ ] Implement. Run `pnpm check`.

### Task B2: Media

**Files:** create `apps/api/src/modules/media.ts`, `apps/api/src/media.integration.test.ts`; modify the contract, `apps/api/src/app.ts`, `packages/api-http/src/index.ts`, `docs/engineering/*`.

**Interfaces:**
- Produces `api.workspaces.media`: `upload(workspaceId, file, { onProgress })`, `url(workspaceId, mediaId)`, `list`, `remove`. Pieces of 4 MiB, sealed under the media key, served with `Range`, `nosniff` and `no-store`.
- Allowed: images JPEG, PNG, WebP, GIF, AVIF; video MP4, WebM; audio MP3, M4A, WebM, Ogg; other files served as attachments. At most 512 MiB a file.

- [ ] Tests first: upload, read back whole and by range; a reader without the document gets `not-found`; a failed piece retries; deleting queues objects; bytes count towards `stored_bytes`; the leakage test finds no file name or bytes.
- [ ] Implement. Run `pnpm check`.

### Task B3: The workspace in the app

**Files:** create `apps/web/src/features/workspace/*` (outside `editor/`), `apps/web/src/routes/_app/workspace.tsx`, `workspace.$workspaceId.tsx`, `workspace.$workspaceId.$documentId.tsx`; modify `apps/web/src/lib/queries.ts`, `apps/web/src/features/shell/Sidebar.tsx`, `Palette.tsx`.

**Interfaces:**
- Produces `<Workspace mode="page" | "call" />`, the list and document pair used by C1.

- [ ] Journeys: first, files; the Saved, Reconnecting and Couldn't save states, and the moved-to-Trash banner from wrong; templates; Share sheet; workspace people; offline edits sealed in IndexedDB. Everything outside a call first.
- [ ] Walk each in a real browser with two accounts, wide and narrow, light and dark, beside the canvas. Run `pnpm check`.

## Stage C: after A2 and B3 merge, in parallel, at most five at once

### Task C1: The workspace in the call

Journeys: open, share, arrange, focus. Dock button and W, the `ws` leaf, the call's active workspace and This call section, keeping your place, ⌘⇧F, keys sleeping while the caret is in a document. Contract: `CallState.workspace`, `MeetingInput.workspaceId`, the new call actions. Tests: choosing, late joiners and reconnects see the same workspace, a stored call still opens.

### Task C2: Presence, following, tags and comments

Journeys: follow, tag, comment. Faces in rows, on the document and on tiles; follow bar and frame; stop on scroll, typing and Esc; the "can't open" bar; `@` list ordered as the canvas; asking before sharing; mention toast and Go there; threads, margin counts, resolve and reopen. Tests: following never names a document you can't open; a mention reaches someone; tagging never grants access.

### Task C3: Photos, files and video

Journey: photos. Picker, reuse from the workspace, drop and paste, placeholders that hold the space, progress, galleries, captions, the error block with Try again and Delete, file blocks, video blocks. Consumes B2 and the block views from A3.

### Task C4: Notes, follow-ups and transcript

Journeys: live, call, and the notes-off step of wrong. The three live pages, shared live notes on the server, ticking for everyone, todos from documents, `live` and `moment` blocks, Open beside, send to document, Hear it, Ask to turn notes on.

### Task C5: Present and play together

Journeys: present, play. Preview, audience and presenter views, the strip, Work on my own, presenter notes (`presenter_notes`), stopping; shared playback with drift correction, late joiners, autoplay blocked, own volume, stopping on revoke and call end.

### Task C6: Switching, guests and after the call

Journeys: switch, guest, after. Picker and the question it asks, New workspace, private states, Ask Art, the host's prompt, seat access ending with the call, `workedOn` on the note, the document in the app, the next agenda carrying only what's open.

### Task C7: Find, history and Ask Alcove

Journey: find. ⌘K, in-browser search over `searchText`, landing on the line, History grouped by call, restore keeping today's as a version, Ask Alcove on a selection through `inference.ts`, the keyboard list.

### Task C8: On a phone

Journey: phone. The same features at 390 px: arches row, list full width, hold to drag, keyboard bar, sheets, the share switcher.

## Stage D

### Task D1: Every journey, end to end

- [ ] Walk all 21 journeys and the reference boards on the real stack, wide and narrow, light and dark, beside the canvas. Fix every difference.
- [ ] Update `docs/product/user-flows.md`, `docs/product/overview.md`, `docs/engineering/system-architecture.md`. Close #81 with what shipped.
- [ ] Verify production after the last deploy.
