# Making a design canvas

How to design a page, a flow or a change to how something looks, as a design canvas: live, clickable boards on
claude.ai, laid out with every journey step by step. This is how Home, Notes, a note, Team, Record, Settings and Agents
were designed before they were built. Read [principles.md](principles.md) and [pages.md](pages.md) first.

Make a canvas for anything bigger than a tweak: a new page, a new flow, a redesign of part of a page. Build in the app only
once the canvas has been looked at.

The canvas is for what isn't built yet. What's built is in Storybook ([apps/storybook](../../apps/storybook/README.md),
`pnpm storybook`), which renders the app itself in every state: look there to see a page as it is now, and start a canvas
from it when you're changing one.

## What a canvas is

A canvas is an artifact made from the **Design** artifact type, private to whoever made it until they share it. Its own
files live under `project/`:

- `project/canvas.json`, the index: which boards exist, where each sits, which page of the canvas it's on, and which page
  the canvas opens on.
- One `.dc.html` file per board. Each is a self-contained Design Component page: markup in `<x-dc>`, styles in its head,
  and a script block with `class Component extends DCLogic` whose `renderVals()` returns the values the markup reads.
- Shared `.css` and `.js` files the boards load.

The Design type's own reference (`artifact-type/reference/format.md` and `craft.md`) explains the format in full, but only a
live canvas serves it. What you need day to day:

- **Holes.** `{{a.b}}` is a dotted lookup into what `renderVals()` returns, never an expression: work things out in
  `renderVals()` and return them by name. An attribute that's a whole hole (`onClick="{{pick}}"`, `who="{{f.who}}"`) gets the
  raw value; one with text around a hole gets a string. A hole in text renders inside `<span class="sc-interp">`.
- **Repeats and branches.** `<sc-for list="{{rows}}" as="r">` repeats, with `{{r.x}}` and `{{$index}}` inside.
  `<sc-if value="{{open}}">` branches on a real boolean.
- **Events** are camel-case attributes bound to functions from `renderVals()`: `onClick="{{r.pick}}"`.
- **State.** The board is `class Component extends DCLogic`: `this.props`, `this.state` and `this.setState()`, with React's
  lifecycle (`componentDidMount` and the rest), but no `render()`.
- **Parts.** `<dc-import name="Faces" who="priya,kofi" size="26" hint-size="56px,29px"></dc-import>` mounts another board.
  Its other attributes become props (kebab-case to camelCase). `hint-size` is the box it holds while it loads: give it the
  part's real size, which for `Faces` is about 1.1 times `size` tall.
- **Props.** `data-props` on the script tag is single-quoted JSON declaring each prop's editor and default. Inside it, write
  `&amp;` for `&` and `&#39;` for a single quote.
- **The head.** `<helmet>` holds only the font link and `body{margin:0}`. Everything is markup: never build UI from
  script with `innerHTML`.

## The kit: docs/design/canvas

Never start from a blank canvas. [canvas/](canvas/) is the kit every new design starts from: the boards the app's pages
were designed as. They don't follow the app once it's built (Storybook does), so where a board and the app differ, the app
is right. It holds:

| File | What it is |
|---|---|
| `canvas.json` | The index: boards, canvas pages, order, titles, and the page it opens on |
| `tokens.js` | Every palette's values in OKLCH, by role. Blue Hour is the live palette |
| `home.js` | `window.AH`, the helpers every board uses (below), plus Home's own data and journeys |
| `scene.js` | `AH.scene(moment, pal, mode)`, each moment's sky, sun, glitter, stars and clouds, and `AH.page(c, id, opts)`, the starting point for every page board |
| `appdata.js` | `AH.D`, the demo world every page shares: you (Art Vandelay), Vandelay Industries, its people, groups and notes. All made up |
| `home.css` | The shared classes: buttons, panels, tiles, checklists, rows, the shell, the side panel, the phone bars and the journey frames |
| `pages.css` | The page frame (`pg-`), the scene (`sc-`), the evening board (`ev-`), the moving board (`lb-`), and what passes through (`hz-` and `lf-`), generated from the app |
| `Side`, `Faces`, `Overlays`, `Scene`, `Visitors`, `SkyArt` `.dc.html` | Parts: the side panel, people in arches, what opens over a page (the palette, toasts, the call modal, a call's card, the lobby, and stand-in pages), the scene, what passes through, Home's sunset drawing |
| `Home`, `Notes`, `Note`, `Team`, `Record`, `Settings`, `Agents` `.dc.html` | One board per page, each interactive at 1440×900 in both themes, with its own `page-<name>.css` and `data-<name>.js` (Home's are in `home.css` and `home.js`). `Agents` draws every state of the page through `#step=`, the question an agent asks included, and its catalogue, copy, levels and journeys are in `data-agents.js` |
| `Search.dc.html` | The palette (Search or ask) over Home, interactive: type anything, and `data-search.js` searches the demo world's notes, people and transcripts. It imports Home, and opens Notes and a note from what you pick |
| `Series.dc.html` | A series. For now it's a still: it uses a note's files, its buttons aren't wired, and it has no steps or journey board |
| `Steps<Page>.dc.html` | Every journey of a page, one row each (`StepsPage` is Home's). `StepsAgents` draws some frames from `Settings`, where the way to Agents starts |
| `App.dc.html` | Walk the app: every page in one prototype, wired together |
| `Evening.dc.html` | The moments of the evening side by side |
| `Life.dc.html` | Everything that moves, each on its own tile, on repeat |
| `tools/` | `sync-life.py`, which copies what passes through from the app's scene onto the canvas, and `Visitors.template.html`, the board it fills in, where the canvas's shorter waits are set |
| `call/` | The call, rethought: the in-call screen the call was rebuilt from, with its own model (`nc.js`), boards and seven journeys; its [README](canvas/call/README.md) says what each board is |
| `notes/` | Notes in the call, rethought: the panel and the card (what's captured) the call's Notes was rebuilt from, with its own model (`notes.js`, on a copy of `call/`'s), boards and seven journeys; its [README](canvas/notes/README.md) says what each board is |
| `after/` | After the call: the page a call leaves you on, on the call's night over a cove, with its own model (`after.js`), every state, a player and seven journeys; its [README](canvas/after/README.md) says what each board is |
| `call-access/` | The call's workspace and boards, open to everyone in it: the design the build followed (11 November 2026), the call at any of its moments and four journeys; its [README](canvas/call-access/README.md) says what each board is |
| `home/` | Home, under the horizon: the three widgets Home's lower half was rebuilt from (For you, Upcoming and Recent notes), with its own model (`water.js`, on a copy of the kit's `home.js`), boards for Home and every state, and eight journeys and a phone row; its [README](canvas/home/README.md) says what each board is |
| `upcoming/` | Upcoming, redesigned: Home's Upcoming when the calendar holds events with only you on them (counted at its foot, shown slim and hatched when asked) or nothing at all, with the widget as a part of its own (`Upcoming.dc.html`) beside Home, every state of it at its real size in both themes, four journeys and a phone row, on a copy of `home/`'s model; its [README](canvas/upcoming/README.md) says what each board is |
| `you-menu/` | Your menu, at the top right: what your face opens (you on a small evening, Pause notifications, Theme, Settings, the tour, Sign out asking in place), drawn over `home/`'s Home with its own model (`account.js`), the menu as a part, every state, six journeys and a phone row; its [README](canvas/you-menu/README.md) says what each board is |
| `side-panel/` | The side panel, calmer: today's panel beside three directions (A just tidy, B two groups, C a rail) at their real size, B on Home with every control working, B in every state and its journeys, with its own model (`nav.js`, beside Home's canvas files); its [README](canvas/side-panel/README.md) says what each board is |
| `onboarding/` | The tour, renewed: the account created on screen, the arch opening into Home and the tour over it, every control working (the card, cut-out, arrow and art loops as before, pointed at Start now and Schedule, the call about to start, the example note or Calls, Search or ask, the Drive, Record and Agents), on a phone, and every stop before and now, with its own model (`tour.js`) and art (`tour-art.js`); its [README](canvas/onboarding/README.md) says what each board is |
| `plans/` | Plans and checkout: the Plans page, the checkout window and paying in motion, Settings › Plan, the side panel's foot, the call when notes run out and every other place checkout opens from, on a copy of the kit with a `plans` moment; its [README](canvas/plans/README.md) says what each board is |
| `scheduling/` | Scheduling a call, rethought: the Calls page while a call is made, the week filling it and the call's editor beside it, every control working (a time picked from the start, pressing and dragging into any day and week, the grip, adding people, a clash and Next free, letting a guest pick), what testers said and what changed, blocks time first at every length, and eight journeys, with its own model (`sched.js`, on the Calls and Drive canvas's files); its [README](canvas/scheduling/README.md) says what each board is |

`window.AH` has, among others:

- `AH.vm(c, layout, defaults)`, the shell's whole view model (side panel, places, toasts, step state)
- `AH.page(c, id, opts)`, that model set up for page `id`, with its scene
- `AH.scene(moment, pal, mode)`, a moment's drawing, for the `Scene` part
- `AH.rootStyle(pal, mode, hour)`, the tokens as CSS custom properties for a board's root
- `AH.ok([L, C, h], alpha)`, an OKLCH colour string
- `AH.hash()`, the `#key=value` overrides in the address (`#mode=light&step=open`)
- `AH.assign()`, a shallow merge
- `AH.I`, icon paths by name
- `AH.PALS` and `AH.D`

### The shared classes

- **Buttons:** `b` with `b-press` (the one filled button), `b-tint`, `b-line` or `b-quiet`, and `b-lg` or `b-sm`.
- **Panels:** `pn` with its head `pn-h`.
- **Tiles** (for you, decisions, follow-ups): `ft` with `ft-h`, `ft-i` (icon), `ft-k` (kind), `ft-m` (the moment chip),
  `ft-t` (text), `ft-a` (actions), `ft-yes`.
- **Checklists:** `cl`, `cl-r`, `ck`, `cl-t`, `cl-d`. **Rows:** `nr`.
- **The shell:** `ah sh` on the root, `sh-frame`, `sh-panel`, `ah-scroll`, `sh-bar` (the phone's top bar), `phone-tabs`.
- **The top right:** `.find` and `.me`.
- **Journey frames:** `fl`, `fl-r`, `fl-h`, `fl-s`, `fl-f`, `fl-c`, `fl-box`, `fl-in`.

The canvas's names map to the app's tokens like this (`--notes` is `rose`, `--focus` is `horizon`, `--now` is `sun-text`);
the full table is in [building.md](building.md).

Some of the kit is left over from exploring Home's options: three more palettes in `tokens.js`, Home's `take`, `art`, `fy`
and `pal` props, `AH.JOURNEYS`, and the `dk-` and Broadsheet rules in `home.css`. Nothing live uses them, so don't build on
them. One quirk: Home's side panel counts what's waiting differently from the other boards, so its count can differ from
theirs.

## Start a canvas

1. **Copy the kit** to a working folder outside the repo, as `<root>/project/`. For example, a session's scratch folder:
   `cp -R docs/design/canvas <root>/project`.
2. **Create the canvas.** With the Artifact tool, run `quickstart` with `intent: "design"`; it names the Design type.
   - Then publish with that `type_url` and a `title` (what the design is called, such as "Billing"), and no files. The
     reply carries the new canvas's `url`.
   - Pass `design_systems: false` on the quickstart: Alcove's look comes from the kit, not from a published design system.
3. **Get the runtime** for previewing on your own machine. Every canvas serves the Design type's runtime at
   `artifact-type/dc-runtime.js`. Read it with the Artifact tool (`action: "read"`, your canvas's `url`, that `path`) and
   save it as `<root>/project/support.js`.
   - Every board's head loads `./support.js`.
   - Never commit or publish it: it's the type's file, not ours, and the kit's `.gitignore` leaves it out.
4. **Preview it:** run `python3 -m http.server 4181 --bind 127.0.0.1` in `<root>/project`, then open
   `http://127.0.0.1:4181/Notes.dc.html#mode=dark`.
5. **Trim the kit** to the boards your design needs.
   - Every `.dc.html` file in `project/` shows as a board, so delete the files you don't need as well as their `canvas.json`
     entries.
   - Keep everything the kept boards import. Every page needs `Side`, `Faces`, `Overlays`, `Scene` and `Visitors`; Home
     imports `SkyArt` rather than `Scene`; Notes imports `Note`.
   - Keep `canvas.json`'s own keys: `v`, `title`, `createdOnFiles` and `designSystems`.

## Make a page board

Copy the page board closest to yours (`Settings.dc.html` for a page of rows, `Notes.dc.html` for a list and a preview,
`Team.dc.html` for people) and rename it. Keep this skeleton:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Billing</title>
<script src="./support.js"></script>
<link rel="stylesheet" href="home.css">
<link rel="stylesheet" href="pages.css">
<link rel="stylesheet" href="page-billing.css">
<script src="tokens.js"></script>
<script src="home.js"></script>
<script src="scene.js"></script>
<script src="appdata.js"></script>
<script src="data-billing.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..700&amp;family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&amp;display=swap">
<style>body{margin:0}</style>
</helmet>
<div class="ah sh bl" data-mode="{{mode}}" style="{{shellStyle}}">
<div class="sh-frame">
<dc-import name="Side" s="{{side}}" hint-size="256px,100%"></dc-import>
<main class="sh-panel">
<div class="ah-scroll">
<div class="pg-stage">
<dc-import name="Scene" a="{{scene}}" hint-size="100%,100%"></dc-import>
<div class="sh-bar"><!-- the phone's top bar, copied from another page --></div>
<div class="pg-in">
<!-- the page: its one job on the sky, the rest on the water -->
</div>
</div>
</div>
</main>
</div>
<nav class="phone-tabs" aria-label="Main"><!-- copied from another page --></nav>
<dc-import name="Overlays" ov="{{ov}}" hint-size="0px,0px"></dc-import>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"go":{"editor":null,"default":null},"mode":{"editor":"enum","options":["dark","light"],"default":"dark"},"step":{"editor":null,"default":"page"},"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {
  renderVals() {
    var AH = window.AH, v = AH.page(this, 'billing');
    /* ...this page's values, from data-billing.js and v.st, the state for the current step... */
    return v;
  }
}
</script>
</body>
</html>
```

- **Which place it lights.** `AH.page(c, id)` lights the side panel's place for `id`: `home`, `notes` (and `note`),
  `drive`, `record`, `team` or `agents`; `settings` lights Settings on the phone's tab bar. Any other id lights nothing
  until you add it to `IDS` in `scene.js`, and a new place to the side panel to `places` in `AH.page`, beside it (Home's
  own board keeps its side panel in `home.js`).
- **Its own prefix.** Give the page a class prefix (`bl-` here) and put its styles in `page-<name>.css`. Set its horizon
  there: `.bl .pg-stage { --hz: 136px; }`. Choose the height from what the page is for (see the table in
  [principles.md](principles.md#one-evening)), using `--vh` for the window's height (the journey frames set it).
- **Its moment.** Pass a moment to `AH.page` (`AH.page(this, 'billing', { moment: 'settings' })`), or add one to `scene.js`
  if no existing moment fits. A moment added only to `scene.js` gets Home's visitors on the canvas, so add it to the app's
  `Horizon` too (see [building.md](building.md#put-the-page-on-the-evening)) and run the sync tool.
- **Its data.** Put the page's data in `data-<name>.js` under a short name of its own, keyed by the same ids as `AH.D`. The
  kit uses `AH.NT` for Notes, `AH.TM` for Team, `AH.RC` for Record, `AH.ST3` for Settings, `AH.NOTE` for a note, `AH.SR`
  for search and `AH.AG` for Agents.
  - Use the demo world's people and notes, so every page tells one story.
  - Every person and every call is made up. Never write a real person's name, the user's included, or copy a real calendar
    or a real call. You are Art Vandelay.
  - The demo day is Wednesday 4 November. Art's account has 10 hours of notes this month: 3 h 34 min used and 6 h 26 min
    left, as the side panel and Settings say.
  - The canvas's demo company isn't quite the app's demo account (`apps/api/src/demo.ts`): some people sit in other teams.
    When you compare a board with the app, those differences aren't bugs.
- **Every control does what it would do,** through state: a click sets state, and `renderVals()` draws from it.
  - Popovers, menus and modals open over the page they belong to.
  - In-place steps (a row opening, a question in the sky) happen in place.
- **Every state is a step.** Name each state (`blFirst`, `blOffline`, `blShareOpen`, `blSaved`...) and reach it through the
  `step` prop, or `#step=` in the address. That's what the journey board draws.
  - Steps live in the shared `AH.STEPS`, so prefix yours with the page's own letters and add them the way `data-team.js` does:
    `Object.assign(AH.STEPS, { blFirst: { ... }, blOffline: { ... } })`.
  - Home also takes a `scene` prop (`today`, `soon`, `first`) for which day it shows.
  - Include:
    - the first day, with nothing in it yet
    - loading, offline and errors
    - a lot of content, and long names
- **`go`.** Declare `"go":{"editor":null,"default":null}` in `data-props` and call `v.go('notes')` to move between pages. In
  `App.dc.html` that walks the prototype; alone, it shows a toast.
- **Give it a way in.** Draw how people reach the page, and wire it:
  - A place in the side panel is only for somewhere people go often. Most pages are reached from another page: a row in
    Settings, a link on a list's heading, an item in a menu.
  - To add the page to `App.dc.html`, give it a route in `ROUTES`, an `sc-if` that imports the board, and the board's CSS
    and data in App's head.
- **Empty states.** The canvas has no `EmptyArch`. Draw an empty state as Notes' are drawn: a dashed arch with an icon, a
  title and one line (see its first day and its Nothing steps).
- **Popovers and sheets.** A popover opens from what was pressed, with a caret, over the page it belongs to. On a phone it
  becomes a sheet with a scrim. A popover opened from the sky can't rise above the sky's own stacking on a phone, so drop the
  sky's `z-index` there (`z-index: auto`), as Team's `.tm-sky` does.
- **Phone.** Phone rules go in `@container page (max-width: 860px)`. The phone's top bar and tab bar are already in the
  shell: copy them from another page.

## Make the journeys

A design shows how you get to each state, not only the states: what each click does, whether it opens a modal, a popover or
a page. Each page gets a `Steps<Page>.dc.html` board.

- **One row per journey,** in the order someone would meet them. Number the frames from the thing clicked to the result.
- **Caption every frame** with the click and what happens, plainly: "Click Share. A popover opens under it." "It's kept. Saved
  shows in the row."
- **A phone row comes last.**
- **Journeys are data** in the page's data file. The kit keeps them beside each page's data: `AH.JOURNEYS_HOME`,
  `AH.JOURNEYS_TEAM` with `AH.JOURNEYS_TEAM_PHONE`, `AH.JOURNEYS_NOTE` with `AH.JOURNEYS_NOTE_PHONE`, `AH.RC.JOURNEYS`,
  `AH.ST3.JOURNEYS`, `AH.SR.JOURNEYS`, `AH.AG.JOURNEYS` with `AH.AG.JOURNEYS_PHONE`, and inline in `StepsNotes.dc.html`.
  For a new page:

  ```js
  AH.JOURNEYS_BILLING = [
    { name: 'Change the plan', frames: [
      { step: 'planHot', t: 'Click Change plan.' },
      { step: 'planOpen', t: 'The plans open in place, with yours ticked.' },
      { step: 'planSaved', t: 'Click Team. The row says Saved.' }
    ] }
  ];
  ```

- **The phone row** is marked `phone: true`, and its frames get the `is-phone` class, as `StepsPage.dc.html` does.
- **The board** maps that data to rows, the way `StepsTeam.dc.html` does: each frame is
  `<div class="fl-box"><div class="fl-in"><dc-import name="Billing" mode="dark" step="{{f.step}}" hint-size="1440px,900px"></dc-import></div></div>`.
  - A frame is the page at 1440×900, drawn at half size (720×450).
  - A phone frame is 390×844, drawn at 0.641 (250×541).
- **Frames are stills.** Animation is off inside `.fl-in`, so anything that only exists mid-animation needs a step of its
  own.
- **Size it right.** The board's width is set by hand on `.fl`: 128px plus 720px for each frame in the longest row plus 44px
  between frames (phone frames are 250px). Use 4668px, six frames, like the other journey boards. Then measure the real
  height in the browser, and set both its `$preview` and its `canvas.json` entry to them.

## The scene on a board

`Scene` draws a moment from `AH.scene()`. What passes through (gulls, fish, a whale's tail, ships, a balloon, shooting stars) is
`Visitors.dc.html` plus a block in `pages.css`. Both are generated from the app's own `horizon.tsx` and `horizon.css`: the same
shapes, moments and motion.
- Only the waits differ. On the canvas something passes every few seconds and ships cross three times faster, so you can
  see them without waiting. Those waits are set in `tools/Visitors.template.html`.
- Never edit `Visitors.dc.html` or the generated block in `pages.css` by hand.
- The rest of the scene (`scene.js` and the `sc-` rules in `pages.css`) is drawn by hand to match the app, and its stars
  twinkle faster than the app's. Keep it in step when the app's scene changes.

After any change to the app's scene, run this from the repo root:

```sh
python3 docs/design/canvas/tools/sync-life.py . docs/design/canvas
```

Then check `Life.dc.html`. Its tiles name each visitor and where it appears, so update that text if those changed.

## canvas.json

```json
{
  "boards": {
    "Billing.dc.html": { "x": 0, "y": 1180, "w": 1440, "h": 900, "title": "Billing", "page": "app", "expand": "fill", "is_interactive": true },
    "StepsBilling.dc.html": { "x": 0, "y": 0, "w": 4668, "h": 6200, "title": "Billing, every journey step by step", "page": "steps-billing" }
  },
  "pages": [{ "id": "app", "name": "The app" }, { "id": "steps-billing", "name": "Billing step by step" }],
  "order": ["Billing.dc.html", "StepsBilling.dc.html"],
  "notes": { "app-title": { "x": 0, "y": -300, "text": "The app", "kind": "title1", "maxW": 3080, "page": "app" } },
  "launch": { "view": "canvas", "page": "app" }
}
```

- Every `.dc.html` on the canvas shows as a board, whether it's imported or not, so list each one.
- Parts go on a Parts page.
- Leave 80px between boards in a row, and 120px between rows. A row with a title needs room for it: put the title 300px
  above the row, with at least 80px clear of the row before.
- `order` lists every board, back to front.
- An interactive page gets `"expand": "fill"` and `"is_interactive": true`.
- A `title1` note titles a row of boards, never a single one. Leave at least 223px above the row for it.

## Traps

Each of these fails silently:

1. `style="{{a}}; --x: {{b}}"` is rejected. Work out the whole string in `renderVals()` and pass one value.
2. A hole in text is wrapped in `<span class="sc-interp">`, so a bare `span` selector (`.bl-big span`) restyles your values
   too. Style by class.
3. `sc-if` needs a real boolean. The string `'false'` is true. The kit passes strings to `aria-` attributes; don't copy them
   into an `sc-if`.
4. Don't set `display: block` on a clamped element (`.clamp1`, `.clamp2`): it cancels the clamp.
5. `{{a + b}}` and `{{f()}}` don't work. Compute it and expose it by name.
6. `@container` can't style its own container. Set per-width custom properties on a descendant instead.
7. `backdrop-filter` under `transform: scale` draws a ghost. The kit uses it in a few places and turns it off inside journey
   frames (`.fl-in * { backdrop-filter: none }`). If you add it, check a frame.
8. An imported board renders inside `div.sc-host`, which is `display: contents`. Give it `display: block` where it must take
   up room, as `.fl-in > .sc-host` does.
9. An imported board doesn't bring its own head. Whatever imports it loads its CSS and scripts: `App.dc.html` loads every
   page's.
10. Keep `<script src="./support.js"></script>` exactly as it is in every head.
11. Close every element and quote every attribute. Never self-close a `<dc-import>`.
12. Put key handlers on the board's root (`onKeyDown`), as the Design type asks, not on the window. Notes, Record and Team
    still listen on the window for their shortcuts.
13. Set the `hint-*` attributes on every `sc-if`, `sc-for` and `dc-import`, so the board lays out while it loads.
    `Note.dc.html` predates this.

## Check it before you show it

The Design type's own instructions say not to check your work. In this project you always check: nothing is shown until it
has been looked at. With the preview running, screenshot each board with a small script you keep outside the repo. The repo
doesn't allow browser tooling as a dependency, so install `playwright-core` in your scratch folder:

```js
// dc.mjs <board-with-hash> <width> <height> <out.png> [port]: screenshots one board, and prints any errors.
import { chromium } from 'playwright-core';
const [path, w, h, out, port = '4181'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${port}/${path}`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1600);
await p.screenshot({ path: out });
if (errors.length) console.log(errors.slice(0, 5));
await b.close();
```

Run it as `node dc.mjs 'Billing.dc.html#mode=light&step=first' 1440 900 out.png`, then look at every screenshot yourself.

**What to check:**
- Dark and light.
- 1440×900, the boards' own size, then every width in the [checklist](principles.md#before-you-show-anything).
- Every step, and every journey frame.
- No overlap, no clipping, no horizontal scroll.
- No errors, except two known ones: an SVG attribute filled by a hole (`d="{{I.x}}"`, `viewBox`) warns when it's read before
  its value arrives, and Python's server answers the favicon with a 404.
- Text contrast of 4.5:1, measured on the screenshot. The sky and the sea are gradients, so sample the pixels behind the
  text rather than trusting the CSS. In the light theme, `ink-3` doesn't reach 4.5:1 on the sky or the sea, so meta text
  out on the scene uses `ink-2` (as Team's `--tm-soft` does), and warm `now` text there is kept large or put on an icon.
- The [principles](principles.md#before-you-show-anything) checklist.

To see something that passes through, mid-flight, pause the page's animations and set their time:
`for (const a of document.getAnimations()) { a.pause(); a.currentTime = 4000; }`.

## Publish as you go

Publish each time a part is ready, rather than once at the end. With the Artifact tool, publish to your canvas's `url` with:

- `root`, the folder that holds `project/`
- `file_path`, `<root>/project/canvas.json`
- `files`, mapping each file you changed: `{ "project/Billing.dc.html": "project/Billing.dc.html" }`. A file you leave out
  stays as it is, and `null` removes one.

Send `canvas.json` whenever the boards or their sizes change. Never send `support.js`.

- Before changing a canvas made in another session, read `project/canvas.json` and every file you'll replace, or list them
  with `scope: "files"`.
- The canvas is private until its owner shares it from its Share menu.
- When you tell someone it's updated, say what changed on the canvas, not how you published it.

## Once it's built

- **Storybook is the record, not the canvas.** The build's pull request gives the page its stories in `apps/storybook`:
  each state a board drew as a scenario, and each journey row as a journey (see [building.md](building.md)). From then on,
  a change to the page changes its stories, and its boards don't have to follow.
- **Copy the boards in.** The build's pull request copies the design's boards into `docs/design/canvas/`, with their
  `canvas.json` entries and their real sizes, so the next design can start from them.
- **Old directions don't stay.** Once a direction is chosen, the canvas keeps only the canonical pages. Rounds of options,
  colour studies and rejected layouts come off it.
