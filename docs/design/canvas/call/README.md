# The call, rethought

The design canvas the call was rebuilt from (round 4, 6 November 2026), copied in so the next design of the call can start
from it. [The design](../../../superpowers/specs/2026-11-06-in-call-rethought-design.md) says in words what it decided.
Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't follow it.

## What's here

| File | What it is |
|---|---|
| `nc.js` | The model: the people, every moment a journey shows (`STEPS`), what each press does (`act`), what's drawn (`view`), the toasts (`TOAST`) and the seven journeys (`JOURNEYS`). Every string the call says is here. |
| `Call.dc.html` | The call at one moment: `#step=<name>&hot=<press>` in the address shows any moment, and alone every control works. |
| `Thing.dc.html` | What's open, inside its frame: a board, the workspace or a screen, as the presenter, a follower or someone on their own. |
| `Strip.dc.html`, `J-*.dc.html` | Each journey as numbered frames, from what's pressed to what happens. |
| `Main.dc.html` | Play the call: each journey a step at a time, with whatever you press doing what it would. |
| `Idea.dc.html` | The three places and the four rules on one board. |
| `Where.dc.html` | Every control in the call before the rebuild, and where it went. |
| `Before.dc.html` | Today's call beside the same moment rethought. Its screenshots of the old call stay on the published canvas, not here. |
| `Sizes.dc.html` | One moment at 1920 and 1024 wide, in the light theme and on a phone. |
| `icons.js`, `tokens.css`, `call.css`, `Faces.dc.html` | The flattened Lucide icons, the Blue Hour tokens, the canvas's styles and the faces in the arch. |

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and open a
board:

```sh
cd docs/design/canvas/call && python3 -m http.server 8794
# http://127.0.0.1:8794/Main.dc.html, or Call.dc.html#step=boardOn&hot=frame.next:retro
```
