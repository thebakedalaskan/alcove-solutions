# After the call

The design canvas "After the call" (11 November 2026), which the page a call leaves you on was built from, copied in so
the next design of it can start from it. [The design](../../../superpowers/specs/2026-11-11-after-the-call-design.md) says
in words what it decided. Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built));
these boards don't follow it.

## What's here

| File | What it is |
|---|---|
| `after.js` | The model (`window.CE`): the page's ten states (`OVER`), its buttons (`ACTS`), every moment a journey shows (`STEPS`) and the seven journeys (`JOURNEYS`). It also adds to the kit's note and Home what they show here (`AH.NOTE_STEPS`, and Home's `left` and `after` scenes). |
| `Idea.dc.html` | The idea on one board: each way a call is over for you, what its page says and its buttons, then how it behaves. |
| `Over.dc.html` | The page at one moment: `#over=<state>` in the address shows any of its states, and `&phone=1` a phone's. |
| `States.dc.html` | Every state side by side, then four on a phone. |
| `After.dc.html` | One moment of a journey: the call (with Leave's question when it asks), the page, or where its buttons go (the note, Home). `#ce=<step>` shows any moment; live, it plays the moves between them. |
| `Play.dc.html` | Play it: watch each journey a step at a time, or press what's ringed; the arrows step through. |
| `Strip.dc.html`, `J-*.dc.html` | Each journey as numbered frames, from what's pressed to what happens. |
| `after.css` | The canvas's own styles: `ov-` the page, `ce-` a moment of a journey (with Leave's question and the moves between views), `pl-` the player, `sx-` a journey's frames, `sg-` every state, `id-` the idea. |
| `cove.js` | The welcome page's cove (`Cove` in `packages/ui`), ported: `COVE.draw` lays out the land from a seed, clear of the words, and `COVE.sky` the stars and the light on the bay. The page's seed is 17. |
| `home.js`, `Home.dc.html`, `Side.dc.html` | The kit's, with changes. `home.js` exposes `HOME`, so `after.js` can give Home its moments. Home's line at the top names its button (Join, or Rejoin for a call you left), and Home still has the link button beside Start now and Schedule, which the kit's Home no longer has. The side panel's Start a call is a row, as the app has it since #269. |
| `Faces.dc.html`, `call.css`, `call-tokens.css`, `icons.js` | The call canvas's, for the call each journey starts in: its people in the arch (with `figure`, someone filling a tile), its styles, its `tokens.css` under another name, and the flattened Lucide icons. |
| `tokens.js`, `scene.js`, `appdata.js`, `data-note.js`, `home.css`, `pages.css`, `page-note.css`, `Note.dc.html`, `Scene.dc.html`, `Visitors.dc.html`, `SkyArt.dc.html`, `Overlays.dc.html` | The kit's, unchanged, for the note and Home the journeys end on. |
| `canvas.json` | The index: the canvas's four pages (the idea, every state, every journey, and the parts) and where each board sits. |

## Where the build differs

The boards stay as drawn. The review of the build changed a few things they say, and
[user flow 7](../../../product/user-flows.md#7-end-the-call-and-get-the-notes) and
[pages.md › After the call](../../pages.md#after-the-call) say what was built:

- **An end you didn't make names nobody.** The model (`after.js`) and the boards drawn from it say "Priya ended it for
  everyone · 20 min" and "Priya ended it after you left · 34 min". The app can't tell who or what ended a call, so the
  build says "20 min with Priya, Kofi and Maya" and "It ended after you left."
- **The notes as you left them.** A call you left shows only "Notes are on. You get them when it ends." here. The build
  also says notes were paused or off when you left, and that what was written comes when it ends.
- **J rejoins with the microphone and camera off.** Here J goes straight back in as you were, as Rejoin does; in the
  build only the button does.
- **Alone, only pressing Leave ends the call.** The idea board's "Alone in the call, Leave ends it at once" holds for
  pressing Leave. Going back a page alone asks first, with End for everyone.

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and open a
board:

```sh
cd docs/design/canvas/after && python3 -m http.server 8795
# http://127.0.0.1:8795/Play.dc.html, Over.dc.html#over=left, or After.dc.html#ce=hAsk&mode=light
```
