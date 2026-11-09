# The call, rethought: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the in-call screen as the canvas "The call, rethought" draws it:
- three places;
- one frame for a screen, a board or the workspace;
- Board and Workspace at the top right, opening just for you;
- Present bringing everyone with you, with follow and unfollow;
- Close for you or for everyone;
- a tile only while something is presented.

**Architecture:**
- The server gains a `workspace` kind of presentation, stopping for you or for everyone (with how it ended kept for followers), a guard on boards while one is presented, and the organizer's stop of a screen share. Stored fields ship first, on their own.
- The web app keeps every feature, in new places:
  - a fixed shell: top bar, dock, More and View, one side panel at a time;
  - a stage with the frame and the people beside it;
  - presenting built on the workspace's existing Follow, through presence.

**Tech Stack:** TypeScript (strict), zod, Hono API on Postgres, LiveKit, React 19, TanStack, Tailwind v4, Motion, Storybook (shows, never tests), Vitest integration tests.

**Spec:** `docs/superpowers/specs/2026-11-06-in-call-rethought-design.md`. The canvas is in `docs/design/canvas/call/`; its model `nc.js` holds every string.

**Reference pictures (this session only):** kept in that session's scratch folder:
- `frames/` holds every journey frame at full size, with `FRAMES.md` saying what each shows.
- `steps/` holds every canvas moment.
- `idea.png`, `where.png`, `sizes.png` and `before.png` are the other boards.

## Global Constraints

- Follow AGENTS.md and the scoped `AGENTS.md` files. In particular:
  - **Types:** strict TypeScript: no `any`, no `as`, no `!`, no suppressions. Data from outside is parsed with zod first.
  - **Tests:** integration tests only (`*.integration.test.ts`, the real API over HTTP via `@alcove/api-http`). No unit, component or browser tests. Storybook has no `expect(`.
  - **Compatibility:** none kept. Delete what's replaced: old styles, components, stories and tests of removed behaviour go in the same change.
  - **Logging:** no `console.*`; use the child loggers.
  - **Errors:** the most specific `AppError` with context.
  - **Privacy:** nothing readable in a column, URL, log or error. Every query is scoped by owner.
  - **Stored data:** sealed records written by the previous release must parse. New stored fields get `.default(...)`. Never retype a stored field in place.
- Folder ownership (`docs/engineering/folder-ownership.md`):
  - frame, stage, menus and the side panel in `call/layout/`
  - workspace presenting in `call/workspace/`
  - board presenting and the board picker in `call/boards/`
  - screen-share pieces in `call/screen-sharing/`
  - reusable visuals in `packages/ui`, with `ic-` classes in `styles/call.css`
  - Run `pnpm check:structure`.
- Design (docs/design, AGENTS.md):
  - Colour and contrast:
    - tokens only, no raw hex except on the always-night stage
    - `stage-sun` for what's chosen or pressable on night controls
    - no green
  - Text:
    - sentence case
    - people named or "they"
    - the strings exactly as `docs/design/canvas/call/nc.js` has them
  - **The light theme:** every side panel works in light as well as dark. The stage, the dock and what's shared stay night.
  - **Motion:** `motion/react`, with reduced motion respected.
  - **Where to check:** 390, 1024, 1440 and 1920 wide, dark and light.
- **People:** made-up people only (Vandelay Industries: Art Vandelay, Priya Raman, Kofi Asante, Aiko Tanaka, Maya Chen). Never a real person's name.
- **Worktrees under `/Users` only.** From `/private/tmp`, docker compose kills the shared LiveKit. Each worktree gets its own `TEST_DATABASE_URL` database (task-named) and its own Storybook port.
- Integration tests in a worktree: `node scripts/check-tests.mjs`, then `pnpm exec vitest run <files>` in `apps/api`. Run only the files you touched; CI runs all of them.
- **Commits:** signed, by `thebakedalaskan`. Never push, open PRs or merge; the controller does.

## Review Focus

1. **A presentation starts while you're typing in a document.** You follow it, and the workspace keeps your place, caret and undo. **Workspace** takes you back to exactly where you were. Covered by a Storybook scenario and journey step in Task 4.
2. **The presenter reloads mid-presentation.** It hides for everyone while they're away and comes back, as today. Followers get no "ended" toast and no tile flicker. Covered by an integration test in Task 2 ("the workspace presented waits through a reload").
3. **Two things are presented at once** (Priya the workspace, Kofi a screen). Someone watching Priya gets Kofi as a tile and a toast with **Show it**. **Show beside** puts it beside. Closing either leaves the other. Covered by a Storybook scenario in Task 4.
4. **Someone with no access, such as a guest**, is told who is presenting and never what. A guest gets no Present, and a picker that says a guest can't start a board. Covered by an integration test in Task 2 and a guest scenario in Task 4.
5. **Widths of 600 to 640 px.** Today's two phone breakpoints disagree. One breakpoint (600) drives the layout and the dock. Covered by a 620-wide walk in Task 3.

---

### Task 1: Stored fields first (its own pull request)

**Files:**
- Modify: `apps/api/src/features/calls/space-state.ts`
- Test: `apps/api/src/features/calls/boards-in-calls.integration.test.ts`, in `what the previous release stored`

**Interfaces:**
- Produces, in `space-state.ts`:
  - `Presenting` gains `key: z.string().default('')` and `since: z.number().default(0)`.
  - New `SpacePresenting = z.object({ place: z.string(), workspaceId: z.string(), key: z.string(), since: z.number(), by: Controller })`.
  - New `PresentEnded = z.object({ place: z.string(), key: z.string(), close: z.boolean(), by: Controller, at: z.number() })`.
  - `CallSpace` gains `space: z.array(SpacePresenting).default([])` and `ended: z.array(PresentEnded).default([])`. `NO_SPACE` gains `space: []` and `ended: []`.
  - Nothing writes them yet.

- [ ] **Step 1: Write the failing test** `it('keeps a presentation the next release writes through a save that doesn’t change it')`:
  - Seal a call state the way the next release writes it, through the harness as the suite's neighbours do. It has:
    - `workspace.space = [{ place: 'main', workspaceId, key: 'k1', since: 1, by }]`
    - `workspace.ended = [{ place: 'main', key: 'k0', close: true, by, at: 2 }]`
    - a board presentation in `present` with `key: 'k2', since: 3`
  - Make a change that saves and touches none of them (raise a hand).
  - Open the sealed state again and expect all three exactly as written.
- [ ] **Step 2: Run it.** Run `pnpm exec vitest run src/features/calls/boards-in-calls.integration.test.ts -t "previous release"` in `apps/api`. Expected: FAIL, with the fields gone after the save.
- [ ] **Step 3: Implement** the schema fields above. Keep the comments in the file's voice.
- [ ] **Step 4: Run it again.** Expected: PASS. Also run `pnpm typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(calls): keep the next release's presenting fields in the call's sealed state`.

### Task 2: Presenting on the server, the client and the stand-in

**Files:**
- Contract (`packages/api/src/calls/`): `workspace.ts`, `wire.ts`, `session.ts`
- Server (`apps/api/src/features/calls/`): `workspace.ts`, `workspace-actions.ts`, `boards.ts`, `service.ts`, `space-state.ts`, the LiveKit room service the organizer's mute uses, `read-model.ts`
- Client: `packages/api-http/src/calls/session.ts`
- Storybook stand-in: `apps/storybook/src/api/call.ts` and `apps/storybook/src/api/script.ts`
- Web, only enough to compile: `apps/web/src/features/call/workspace/presenting.ts`, `apps/web/src/features/call/boards/boardPresenting.ts`, `apps/web/src/features/workspace/DocumentPane.tsx`, `apps/web/src/features/workspace/Presentation.tsx`. Task 4 rebuilds them.
- Tests (`apps/api/src/features/calls/`): `callWorkspace.integration.test.ts` (`presenting`), `boards-in-calls.integration.test.ts` (`presenting a board`, `a saved board`, `what the previous release stored`), and the sharing or people suite the organizer's mute lives in
- Docs: `docs/engineering/calls-and-recordings.md` (presenting ~1080–1120, "Presenting a board" ~1433, the call's notices); `docs/engineering/privacy-keys-and-sessions.md:495–502`

**Interfaces:**
- Consumes: the Task 1 fields.
- Produces, in `packages/api/src/calls/workspace.ts`:
  ```ts
  export const PresentKindSchema = z.enum(['workspace', 'board']);
  export const CallPresentSchema = z.object({
    key: z.string().min(1).max(64),      // one presentation, start to end: a new start is a new key
    kind: PresentKindSchema.nullable(),  // null for someone who can't open it
    id: IDSchema.nullable(),             // board: its document; workspace: the workspace everyone views
    name: z.string().nullable(),         // board: its name; workspace: null
    section: z.number().nullable(),      // board: the frame everyone is on; workspace: null
    by: CallSeatSchema, mine: z.boolean(), canControl: z.boolean()
  });
  export const CallPresentEndedSchema = z.object({ key: z.string().min(1).max(64), close: z.boolean(), by: CallSeatSchema });
  // CallWorkspaceSchema gains `ended: CallPresentEndedSchema.nullable()`: the last presentation that ended in your part of
  // the call, until another starts there.
  export const PresentStartSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('workspace') }),
    z.object({ kind: z.literal('board'), id: ItemIdSchema, section: PresentSectionSchema.default(0) })
  ]);
  ```
  - Wire:
    - `{ type: 'present-start', what: PresentStartSchema }`
    - `{ type: 'present-move', section }`, for boards only
    - `{ type: 'present-stop', close: z.boolean().default(false) }`
    - `{ type: 'share-stop', seat }`, for the organizer
  - Session:
    - `startPresenting(what: PresentStart): Promise<void>`
    - `movePresenting(section: number): Promise<void>`
    - `stopPresenting(close: boolean): Promise<void>`
    - `stopShare(seat: string): Promise<void>`
  - Server behaviour:
    - **A `workspace` presentation** is stored in `space`, not `present`, because the previous release can't parse a new kind in `present`. It needs a presenter who can open the workspace everyone views, and is shown as `kind/id` to everyone there who can open it. Anyone else gets nulls and `by`.
    - **One presented board or workspace per part of the call.** A second gets 409 "Someone else is presenting here."
    - **A `document` presentation** stored before reads as over: tidy drops it.
    - **`present-stop`** comes from the presenter or the organizer. It writes `ended` for that place, replacing the last one; a start there clears it. A board stopped with `close: true` also closes the board in the call, as `board-close` does, and for that the presenter counts too.
    - **`board-open`** (new or saved) while someone else presents a board in that place gets 409, with a message naming them by first name.
    - **`share-stop`** is the organizer's only. It mutes the seat's `SCREEN_SHARE` and `SCREEN_SHARE_AUDIO` tracks through the LiveKit room service the organizer's mute uses, and adds a `people` notice, "{Organizer} stopped {First}’s share.". It is 403 for anyone else, and 409 when they share nothing.
    - **Keys** are random base64url ids, never derived from anything readable.

- [ ] **Step 1: Write the failing integration tests.** Put them in `callWorkspace.integration.test.ts` under `describe('presenting the workspace')`, replacing the document `presenting` suite, whose behaviour goes:
  - `it('anyone who can open the workspace presents it, and everyone there is told who; only they see which')`:
    - Expect `present.kind === 'workspace'`, `present.id === workspaceId`, `name === null`, `section === null` for a member.
    - For a guest, expect `kind === null && id === null` and `by.name` set.
    - The presenter's own `mine === true`.
  - `it('allows one presented board or workspace in a part of the call')`: a second start, of either kind, gets 409.
  - `it('ends for the presenter or for everyone, and everyone sees how it ended')`:
    - `stopPresenting(false)` gives `present === null` and `ended` of `{ key: <its key>, close: false }` for everyone there.
    - Starting again clears `ended` and gives a new `key`.
    - `stopPresenting(true)` gives `close: true`.
    - Anyone but the presenter or organizer gets 403.
  - `it('waits through the presenter’s reload, and ends when they leave, are removed, the workspace switches, a room closes or the call ends')`: adapt the document suite's cases (lines ~1252–1375) to `workspace`.
  - `it('reads a document presentation the last release stored as over')`.
  - In `boards-in-calls.integration.test.ts` (`presenting a board`):
    - `it('closing for the presenter keeps the board in the call; closing for everyone closes it, by the presenter or the organizer')`
    - `it('won’t make or bring in a board while someone else presents one here')`, expecting 409 for `openBoard({ template: 'blank' })` and for a saved one
    - Adapt the existing cases to `startPresenting({ kind: 'board', id })` and `stopPresenting(false)`.
  - Where the organizer's mute is tested: `it('the organizer stops anyone’s share for everyone, and nobody else can')`. Expect 403 for someone else, 409 for a seat sharing nothing, and a `people` notice naming both when it stops. The LiveKit mute can only be checked as far as the harness's LiveKit allows; say so in a comment.
- [ ] **Step 2: Run them.** Run each file with `-t`. Expected: they fail to compile or fail on the old contract.
- [ ] **Step 3: Implement the contract**, then the server, then `@alcove/api-http`, then the stand-in.
  - The stand-in mirrors the server: workspace presentations, `ended`, the board guard, and `stopShare` with a notice.
  - It gets script beats `presents-workspace`, `stops-presenting(close)` and `stops-share`.
  - Then make the web compile against the new contract with the least change. The document Present starts a `workspace` presentation for now, and the presentation's strip keeps working on `kind === 'workspace'`. Task 4 replaces all of it.
- [ ] **Step 4: Run the tests** above, `pnpm typecheck`, `node scripts/check-tests.mjs`, and `pnpm --filter @alcove/storybook build`. Expected: all pass.
- [ ] **Step 5: Update the two engineering docs**, so they describe what the code now does.
- [ ] **Step 6: Commit.** Message: `feat(calls): present the whole workspace, end for you or for everyone, and stop anyone's share as organizer`.

### Task 3: The shell: top bar, dock, More, View and one side panel

**Files:**
- In `apps/web/src/features/call/`:
  - `layout/TopBar.tsx`, `layout/ViewMenu.tsx`, `layout/Panel.tsx`, `layout/PanelHost.tsx` (the side part), `layout/panels.ts` (the side groups), `layout/view.ts`
  - create `layout/side.ts`
  - `session/InCall.tsx` (top bar, dock and side wiring only), `session/useCallShortcuts.ts`
  - `notes/Yours.tsx` (placed inside Notes)
- `packages/ui/src/components/call.tsx`, `packages/ui/src/styles/call.css`, `packages/ui/src/styles/kit.css` (the dock and More)
- Stories: `apps/storybook/stories/calls/*.stories.tsx` and `apps/storybook/stories/components/call/CallDock.stories.tsx`, for what changes here

**Interfaces:**
- Produces:
  ```ts
  // apps/web/src/features/call/layout/side.ts
  export type SideView = 'notes' | 'chat' | 'people' | 'rooms' | 'mine';
  export function useSide(opts: { phone: boolean }): { view: SideView | null; open: (v: SideView) => void; toggle: (v: SideView) => void; close: () => void };
  ```
  - `TopBar` props:
    - `board: { on: boolean; onPress: () => void }`
    - `workspace: { on: boolean; count: number; onPress: () => void }`
    - `side: { view: SideView | null; toggle: (v: SideView) => void; unread: number }`
    - The rest as today, without Catch up and Reset my view.
  - The dock holds mic, cam, Share, hand, More, Leave and Show everything, as the spec says.
  - More's rows and the phone grid are as spec rule 10.
  - View's three choices and Reset my view are as spec rule 9.
- Leaves for Task 4: the main area (stage, the workspace and board surfaces, shares), presenting, and the board menu's meaning.
  - For now **Board** opens today's Board menu under it.
  - **Workspace** toggles the workspace as `W` does.

- [ ] **Step 1: Build the side.**
  - One view at a time, on the right, 368 px (340 under 1200), sliding in.
  - **Notes** = head (title, "This call, in the workspace", **Open**, bookmark, ⋯, ×), then the tabs Notes / Transcript / Ask, with Yours at the foot of the Notes tab.
  - **Chat** is alone. **People** gets **Breakout rooms** for the organizer, which opens `rooms` in the side.
  - On a phone it's a sheet.
  - Delete:
    - tearing tabs, moving side groups, the drop glow, the drag ghost and the side handles and their keys;
    - the `notes|yours|transcript|ask|chat|people` tab model, reduced to the views above. Change `CallPanels` and `CallLayout` in `packages/api/src/calls/view.ts` to match, with defaults, since they're parsed from storage.
- [ ] **Step 2: Build the top bar.**
  - View ▾; then Board, Workspace (with its count), a hairline, Notes, Chat (unread), a hairline, the faces.
  - Lit while open, with the tooltips from `nc.js` (`yb`/`ob`).
  - On a phone: the title, the notes sign, Chat and the faces.
- [ ] **Step 3: Build the dock and More.**
  - **Dock:** mic+, cam+, a hairline, Share (its label "Presenting" while you present), Raise your hand, More, a hairline, Leave, and Show everything in focus. Board, Workspace, Notes, Chat, Captions, Breakout rooms and Mark leave the dock.
  - **More:** as spec rule 10, with the phone grid and Keyboard shortcuts (opens the existing key list, or a new small sheet listing `useCallShortcuts`).
  - **Phones:** one breakpoint, 600 px (`PHONE_W`), for both the layout and the dock.
  - Delete Catch up and Reset my view from the top bar, and the caption chevron from the dock. The language stays on the caption.
- [ ] **Step 4: Build View.**
  - **The people:** Auto / Speaker / Grid.
  - **Beside what’s shared:** Tiles / Arches / Hidden. This maps to the existing people placement.
  - **See yourself:** In the grid / In a corner / Hidden.
  - **Reset my view.**
  - Delete the four layouts, the two presets, Document list and Just the document from View, and their code in `view.ts`/`panels.ts` (`TREES`, `preset`, `moveLeaf`, `tearTab`, `dropAt`/`dropBox`/`dropSpots` and anything only they use).
- [ ] **Step 5: Keys.** M, V, C (Chat), B, W, O (Board), ⇧P, ⌘K, ⌘⇧F, Esc, wired to the new controls. Captions have no key.
- [ ] **Step 6: Stories.**
  - Update the call scenario stories, so every story renders and shows the new shell (Notes open, Chat open, People open, More open, View open, phone More).
  - Update `CallDock.stories.tsx` to the new dock.
  - No `expect(`.
- [ ] **Step 7: Verify.**
  - Run `pnpm typecheck`, `pnpm check:structure` and `pnpm --filter @alcove/storybook build`.
  - Screenshot the shell in Storybook at 390, 620, 1024, 1440 and 1920, dark and light, with each popover and side panel open.
  - Compare with `ref/steps/{call,chatOpen,notesOpen,transcriptOpen,askOpen,peopleOpen,moreOpen,viewOpen,pCall,pMore,notesLight}.png`, and fix the differences.
  - Nothing overlaps or overflows, and focus is visible and in order.
- [ ] **Step 8: Commit.** Message: `feat(call): one top right, a six-button dock, More, View and one side panel at a time`.

### Task 4: The stage, the frame and presenting

**Files:**
- `apps/web/src/features/call/layout/`:
  - rework `Stage.tsx`, `stageLayout.ts`, `PanelHost.tsx` (the main area), `panels.ts` (what's left of the main area), `TileMenu.tsx` (Show beside)
  - create `layout/frame.tsx`, the frame's bar wiring and Close's question
  - create `layout/ShareMenu.tsx`: Share › Your screen / A board / The workspace, with the screen and board steps in place
- `apps/web/src/features/call/workspace/`:
  - rework `presenting.ts`, the workspace presentation: start, stop, follow the presenter through `features/workspace/follow.ts`, unfollow, ended
  - rework `WorkspacePanel.tsx`: on your stage, keeping your place
- `apps/web/src/features/call/boards/`:
  - rework `callBoard.ts` (a board open just for you, by document id; the board in the call for timer, vote, ideas and rooms) and `boardPresenting.ts` (the pager at its foot; Your notes in the side, `mine`)
  - replace `BoardMenu.tsx` with the board picker; remove `BoardStage.tsx`'s hidden-board tile
- `apps/web/src/features/call/screen-sharing/`: `ShareSurface.tsx` in the frame, its menu in the name menu, own-share Stop sharing, stopped by the organizer
- `apps/web/src/features/call/session/InCall.tsx`: the main area's composition
- `apps/web/src/features/board/CallBoard.tsx`: its bar inside the frame; Present and Close move to the frame
- `apps/web/src/features/workspace/`:
  - delete `Presentation.tsx` and the document Present in `DocumentPane.tsx`
  - keep `presenterNotes.ts` for boards
- `packages/ui/src/components/`:
  - `call.tsx`: `CallFrame`, `PresentedTile`, `CloseAsk`
  - `board.tsx`: the picker, built on `BoardMenuBody`
  - delete `WsPresentStrip`, `WsPresenterView`, `WsPresentPreview` and their CSS and stories
- Styles: `packages/ui/src/styles/call.css`
- Stories: `apps/storybook/stories/calls/{Board,PresentingBoards,Workspace,Sharing}.stories.tsx` and `apps/storybook/stories/components/workspace/Presenting*`. Remove what's removed and add what's new, with each state as a story.

**Interfaces:**
- Consumes:
  - Task 2's `startPresenting(what)`, `stopPresenting(close)`, `stopShare(seat)`, `CallPresent.key` and `CallWorkspace.ended`
  - Task 3's `useSide`, `SideView` and `TopBar` props
- Produces, in `packages/ui`:
  ```tsx
  CallFrame:
    props { who: Person | null; icon: IconName; name: string; meta: string; nameMenu: ReactNode;
            following: { name: string; on: boolean; where: string; onToggle: () => void } | null;
            onPresent?: () => void; onFocus?: () => void; focused: boolean; onStop?: () => void;
            close: { asks: boolean; open: boolean; onPress: () => void; tip: string } | null; children }
  PresentedTile:
    props { name: string; icon: IconName; sub: string; by: Person; go: 'Join' | 'Open';
            onPress: () => void; children /* the live miniature */ }
  CloseAsk:
    props { title: string; onMe: () => void; onEveryone: () => void; onDismiss: () => void }
    // a Popover on wide screens, a sheet on a phone
  ```
- What it does:
  - [ ] **Step 1: The main area.**
    - With nothing open: the people as today.
    - With something open: one `CallFrame`, two with Show beside, and the people beside it per View (Tiles, Arches or Hidden; arches under 760 px of stage).
    - Presented things not on your stage are `PresentedTile`s among the people.
    - Focus fills the window (⌘⇧F, Show everything, Esc).
    - Delete the workspace/board/share leaves and seats of the panel tree, `apart`, `swapBoard` and the automatic `board` preset, and whatever else only they use.
  - [ ] **Step 2: Opening.**
    - **Board** opens the picker, as spec rule 1. Picking opens the board on your stage just for you:
      - a saved board by its document id, with no call action
      - **New** through `openBoard({ template })`, then open the board in the call
      - Disabled, with "{First} is presenting a board. You can start one once they stop.", while someone else presents a board here.
    - **Workspace** opens the workspace on your stage where you left it.
    - **One thing on your stage**, as spec rule 2.
    - **Notes' Open** opens the workspace on the call's Notes page.
  - [ ] **Step 3: Presenting.**
    - **Present** on the frame does this:
      - **The workspace:** `startPresenting({ kind: 'workspace' })`.
      - **A board:**
        - If it isn't the board in the call, bring it in with `openBoard({ workspaceId, documentId, letIn })`.
        - If some people here can't open it, ask first with `boardCheck`: "Let them in for this call" / "Present without them".
        - Then `startPresenting({ kind: 'board', id })`.
    - **Share in the dock** does the same straight away, with Your screen through the existing `SharePicker` flow, shown as Share's second step.
    - **Followers:**
      - **A board:** the presenter's frame, as today.
      - **The workspace:** follow the presenter through `useFollow`.
      - **Unfollow**, or a click, scroll or key in it, works on your own. **Follow {First}** returns.
    - **When a presentation starts**, the stage follows the rule in spec rule 3, with its toasts from `nc.js`.
    - **The presenter of a board** gets the pager at its foot, and Your notes opens in the side (`mine`).
  - [ ] **Step 4: Closing.**
    - **Close** behaves as spec rule 5: a private thing closes; someone else's presentation becomes a tile while they present.
    - **Your presentation** asks with `CloseAsk`:
      - **For you** is `stopPresenting(false)`, and followers stay in it, working on their own.
      - **For everyone** is `stopPresenting(true)`, and followers close it when `ended.key` matches the presentation they were in.
    - **Your screen** shows Stop sharing.
    - **The organizer's** name menu has "Close it for everyone" (`stopPresenting(true)`) and "Stop it for everyone" (`stopShare(seat)`).
    - **A sharer whose share the organizer stopped** stops it in their browser, with a toast naming who stopped it.
    - **Tiles** go when presenting ends.
    - Pressing a lit Board or Workspace closes it, as Close does.
  - [ ] **Step 5: Shares** sit in the frame:
    - your own: "You’re presenting · a tab with sound" and Stop sharing
    - someone's: Close, which makes it a tile while they share
    - The name menu holds today's share menu items (zoom, freeze, earlier picture, pop out, point, mute its sound, Put on the board, Show beside) and your share's (others can point, Clear marks, Change what you share).
    - Your share bar's status ("Read for the notes", with sound) moves to the meta and the name menu.
    - Up to four shares; two side by side with Show beside.
  - [ ] **Step 6: Delete what's replaced:**
    - document presenting by sections: `Presentation.tsx`, `WsPresentStrip`, `WsPresenterView`, `WsPresentPreview`, document presenter's notes and their stories
    - the hidden board tile
    - the board's own Present and Close for everyone
    - the old Board menu's "opens for everyone" copy
- [ ] **Step 7: Stories.**
  - One story per canvas moment, in a scenario reaching it, using the stand-in's new beats:
    - `ref/steps/*` except the phone duplicates
    - the Review Focus items 1, 3 and 4
  - Update the existing Board, PresentingBoards, Workspace and Sharing stories to the new behaviour.
- [ ] **Step 8: Verify.**
  - Run `pnpm typecheck`, `pnpm check:structure`, `node scripts/check-tests.mjs` and the Storybook build.
  - Walk every story at 390, 1024, 1440 and 1920, dark and light, against `ref/steps/*.png` and `ref/frames/*.png`.
  - Click every menu.
  - No console errors, overlap or overflow.
  - Keyboard: Tab order, ←/→ for the presenter's pager, and Esc.
- [ ] **Step 9: Commit.** Message: `feat(call): one frame for a screen, a board or the workspace; present, follow and close the same way for all three`.

### Task 5: Journeys, scenarios and docs

**Files:**
- Create: `apps/storybook/stories/journeys/06-in-the-call.stories.tsx`, replacing today's 6.x journeys
- Modify:
  - `apps/storybook/stories/journeys/06b-a-board-in-the-call.stories.tsx`, for the journeys whose behaviour changed
  - `docs/product/user-flows.md` §6 (top bar, dock, panels, your view, sharing, the call's workspace items 1 and 5, a board in the call items 1–3, 5, 6, 11 and 14)
  - `docs/design/pages.md` ("A call"), `docs/engineering/calls-and-recordings.md` ("The call screen", 1662–2051), AGENTS.md (the component list: add `CallFrame`, `PresentedTile`, `CloseAsk` and the picker; remove the deleted ones), `docs/design/canvas.md` (point to `canvas/call/`)

**Interfaces:**
- Consumes: Tasks 3–4 as built.

- [ ] **Step 1: The seven canvas journeys.** Write them as Storybook journeys 6.1–6.7, each playing its frames with `userEvent` from the first frame's state. The frames and "did/see" are in `ref/frames/FRAMES.md`.
- [ ] **Step 2: Keep the journeys whose behaviour didn't change.** Board tools, rooms, ideas, timer and vote. Renumber the rest, and delete the ones for removed behaviour.
- [ ] **Step 3: Docs.** Make every doc above say what the code does now.
- [ ] **Step 4: Verify.** Run the Storybook build. Play every journey in Storybook headlessly with playwright, and confirm each reaches its last frame. Run `pnpm check`'s non-Docker parts (typecheck, structure, test policy).
- [ ] **Step 5: Commit.** Message: `docs(call): the rethought call's journeys, scenarios and flows`.

### Task 6: One review of the whole batch

- [ ] **Step 1:** A fresh reviewer (Opus, max effort) reads the batch against the spec, the canvas pictures and `docs/design/building.md`'s review list. It looks for:
  - a feature or state of user-flows §6 that went missing
  - data loss
  - a privacy leak
  - focus or keyboard gaps
  - something deleted that another page uses
  - stored-shape safety
  - the Review Focus items
- [ ] **Step 2:** Fix every must-fix. For each, the implementer proves it fixed with the reviewer's own steps. Fix rounds aren't re-reviewed.

### Task 7: Merge and check production

- [ ] **Step 1:** Open Task 1's pull request alone, wait for CI, merge it, and let it deploy.
- [ ] **Step 2:** Rebase the batch onto main. Open its pull request, saying:
  - what it changes
  - "What goes"
  - how stored calls read afterwards: Task 1's fields, and old document presentations read as over
- [ ] **Step 3:** Wait for Policy, Typecheck, Build and Integration tests, then merge through the API as `thebakedalaskan`.
- [ ] **Step 4:** After the deploy, open a real call in production with two browsers. Walk journeys 1, 3 and 4, then delete any test notes made in the shared demo account.
