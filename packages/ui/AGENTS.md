# The UI kit: rules for agents

`@alcove/ui` is the design system: tokens, components and illustrations. Read the root [AGENTS.md](../../AGENTS.md) first,
its Design system section above all, which names every component and the rules of the look. This file says where things
live in the kit and how to add one.

## What the kit is

- **Visual and stateless.** A component takes plain data and handlers and draws them. What it holds is only how it's being
  used: open or shut, what's pointed at, a timer it starts and stops itself. What's in a call, a note or a list is the app's.
- **No data, no app.** Nothing here fetches or subscribes to anything; the one thing the kit keeps is the theme someone
  chose, which `ThemeProvider` keeps in local storage. No `@alcove/api-http`, no router (a part that goes somewhere takes
  the app's own link through a prop) and nothing from `apps/`: the structure check fails a package that imports an app.
  From `@alcove/api` the kit takes the contract's types, constants and pure helpers (`CallReaction`, `BACKGROUND_COLORS`,
  `firstName`).

## Where things are

`src/` holds the entry (`index.ts`), the tokens with every stylesheet's import (`styles.css`), `fonts.css`, `css-vars.ts`
(so `style` takes `--x` without casts) and `assets.d.ts`, then a folder per area. Each area folder holds its components
(`.tsx`) and the stylesheets they use (`.css`) side by side. The classes each folder's stylesheets use are in brackets.

- `foundation/`: what every area builds on. `cn`, `Icon`, the primitives (`Button`, `Chip`, `Notice`, `Tabs`, `Switch`…),
  overlays (`Popover`, `Select`, `Sheet`, `Tooltip`, `Modal`), toasts, motion, themes, people in the arch, the mark and
  the logo, illustrations and `EmptyState`, emoji, `MonthGrid`, `QrCode`, a menu's settled press, the tab's attention
  icon, and the app's cards, widgets and fields (`app.tsx`). `kit.css` (`ac-`).
- `evening/`: the scene behind every page (`Horizon`, `Evening`) and the cove the welcome page looks out of (`Cove`,
  `SailOut`) (`hz-`, `dusk`, `cv-`).
- `shell/`: the frame around every page. The side panel's parts, `shell.css` (`sb-`, `shell`, `tabbar`, `ph-`), and
  `app.css` for what the pages share inside it: their heads, groups, the people picker, what carries over (`head`, `grp`,
  `pick-`, `carry-`).
- `you/`: your menu, which your face at the top right opens (`ym-`).
- `palette/`: Search or ask (`pal-`).
- `home/`: Home's own styles (`hm-`).
- `call/`: the running call. The stage, its tiles, dock, frames and Share (`call.tsx`, `call.css`: `ic-`, with `pj-`
  before joining and `mv-` moving to another device), the page a call leaves you on (`co-`), the timer (`ac-call-timer`,
  `ac-timer-`), Chat and its questions (`ch-`), reactions, what a call captures (`ac-capture-`, `ac-notes-sign`), Notes in
  a call (`nn-`, `nk-`) and catching up (`cu-`), camera backgrounds (`ac-bgm-`, `ac-bgpick-`) and the floating call.
- `calls/`: making, scheduling, listing and entering calls. Calls (`cs-`), the week (`cw-`), the scheduler's editor
  (`sc-`), Start a call (`cf-`), and the lobby, ringing and picking a time (`rg-`).
- `notes/`: a call's page and what shows a note. The page (`note.css`: `cd-`), the transcript line (`nd-`), the notes
  panel and note cards (in `kit.css`), what a note shares with the rest (`library.css`: `ent-`, `scr-`, `proof-`), shared
  screens (`ac-screen`, `ac-shot-`), follow-ups (`ac-follow-`) and your own notes (`own-`).
- `drive/`: the Drive (`dv-`) and a file as a large preview, `FileCard` and `Thumb` (`fc-`).
- `workspace/`: the workspace kit. The pane and its list, a document, popovers and menus, sheets, playing and history, the
  call's live pages, toasts, full screen (`ws-`, `wt-`, `wd-`, `wm-`, `wv-`, `wp-`, `wh-`, `wl-`, `wf-`), and a
  document's blocks in `workspace-editor.css` (`wb-`).
- `board/`: the board's parts (`bz-`, `bd-`, `bf-`, `bo-`, `bc-`, `bs-`, `bx-`, `bfly-`, `bp-`, `bpg-`, `bl-`, `pc-`).
- `team/`: the Team page, and `PickList`, which began there (`tp-`).
- `plans/`: Plans (`pl-`), checkout (`ck-`), the doors into checkout (`pd-`), and Team on a plan and joining a team
  (`tq-`, `tj-`).
- `settings/`: Settings' parts (`set-`) and Google Drive exports (`ac-drive-`).
- `agents/`: Agents, and what an agent asks for when it connects (`ag-`, `ac-agent-`).
- `record/`: Record and the recorder on its horizon (`rec-`).
- `onboarding/`: the tour and its coachmarks (`ac-tour-`, in `kit.css`), the account being created (`cr-`) and the tour's
  art (`ta-`).
- `welcome/`: the welcome page and its scenes (`lp-`), and `Fit` for a scene drawn at a design size.

Pictures and fonts stay in their own folders: `backgrounds/`, `emoji/` (the emoji's licence), `fonts/` and `marks/`.

## Adding a component

1. **Pick its area:** the folder of the page or flow that shows it. Something several areas build on goes in
   `foundation/`. A new page or flow with no folder yet gets one, named for it (kebab-case), and a line above.
2. **Write it beside its stylesheet.** The component is a kebab-case `.tsx` in that folder; its styles go in the area's
   stylesheet, or a new one beside it, under the area's class prefix or a new one named here and in the root AGENTS.md's
   design system list. Every value comes from the tokens in `styles.css`.
3. **Export it** from `src/index.ts`, in its area's group: `export * from './area/file';`. The entry exports every file
   directly; no folder has an `index.ts` of its own, and nothing else uses `export *`.
4. **Import a new stylesheet** in `styles.css`. The order of the imports is the cascade: a later file wins a tie, so a new
   one goes last unless a stylesheet already there has to win over it, and none moves. `foundation/kit.css` holds the
   `ac-` classes of the foundation and of the components written before the kit had areas, in the order they've always
   cascaded; the four stylesheets imported right after it were its last sections. New styles don't go in `kit.css`.
5. **Show it in Storybook**, in the same change (the root AGENTS.md says how).

## Folder rules

`scripts/check-structure.mjs` enforces these (`node scripts/check-structure.mjs packages/ui`):

- A folder holds at most 20 files, its stylesheets included. Past that, group what changes together into a subfolder
  named for what it shows (`call/chat/`, say), never for what the files are (`components/`, `styles/`, `hooks/`).
- No four files in a folder start with a word that isn't the folder's own. Four `checkout-*` files in `plans/` would be a
  `checkout/` folder, with the prefix dropped inside it; `call-*` files in `call/` are fine.
- Folder and file names are kebab-case. No `utils`, `common`, `misc` or `helpers` folders: name the responsibility.
- Move or rename files only with `node scripts/move-files.mjs <from> <to>`, so imports, `@import`s and the paths docs
  mention follow.

## Bundling

`@alcove/ui` is the one entry for components and `@alcove/ui/styles.css` the one stylesheet. `package.json`'s
`sideEffects` names the stylesheets and `css-vars.ts`, so a bundler drops every other module a page doesn't use, and a page
doesn't load the whole kit. That holds only while modules do no work at import time that anything else relies on: a module
may set up what its own exports use (`workspace/popover.tsx` listens for the last key or pointer press, for its menus),
but anything global another module needs goes in `sideEffects` too.
