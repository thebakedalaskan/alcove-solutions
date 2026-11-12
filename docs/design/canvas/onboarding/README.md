# The tour, renewed

The design canvas the tour of Home was rebuilt from (12 November 2026), copied in so the next design of it can start from
here. Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't
follow it.

The tour kept its look: one card that travels to the real thing, the page dimmed around a cut-out, a ring, an arrow drawn
from the card, a short loop on the dawn sky for each stop, the step dots and Skip tour. What it pointed at had fallen
behind the app: it asked who, when and notes one question at a time where scheduling is now a week on Calls, it pointed at
Notes where Calls now is, and it knew nothing of the Drive, Search or ask, Agents or your menu. Now it stops at Start now
and Schedule, the call Home offers when one is about to start, the example note (Calls once there are notes), Search or
ask, the Drive, Record, Agents, and back at the start. The privacy stop folded into Notes for your calls. The account
being created before it is unchanged, but for its team and privacy rows' words.

It starts from the side panel's canvas in [side-panel/](../side-panel/README.md) (`home.css`, `pages.css`, `water.css`,
`nav.css`, `home.js`, `water.js`, `nav.js`, `scene.js`, `appdata.js`, `tokens.js`, `Panel`, `Faces`, `Overlays`, `SkyArt` and
`Visitors` are that canvas's, with panel B as built), and from your menu's in [you-menu/](../you-menu/README.md) (`Menu`,
`account.css` and `account.js`). `Home` gained the tour's `data-tour` hooks, your menu at the top right, and Calls in the
phone's tab bar.

## What's here

| File | What it is |
|---|---|
| `tour.js` | The model, `AH.TR`: the stops for a day (`stops()`: what each says, the hook it points at, the sides the card tries first, and what changed from the tour before), the old tour's stops (`OLD`), the card's placement and arrow ported from `TourDialog` (`place()`, `arrowFor()`, `layout()`), and the journeys. |
| `tour-art.js` | The art, `AH.ART`: each stop's loop as `view(t)`, `t` seconds in, with its length and the still shown with reduced motion. |
| `tour.css` | The card, the cut-out, the ring and the arrow (`tr-`), the account being created (`cr-`), the art (`ta-`), and the canvas's own controls (`tr-bar`, `tr-chip`). Colours are the app's tokens, scoped to what the tour draws. |
| `Art.dc.html` | The art as a part. `k` picks the stop: `start`, `notes`, `ask`, `drive`, `room`, `agents`, `sun` or `call`. |
| `Main.dc.html` | The first run, every control working: the account created on screen, the arch opening into Home, and the tour over it. Closing it says your menu plays it again, and your menu's Take the tour does. A strip under the app (not part of the design) plays it again from sign-in or just the tour, picks the day (`first`, `today`, or `soon` with a call about to start), the theme, and slow motion. `begin`, `stop`, `at` and `still` draw any moment of it. |
| `Phone.dc.html` | The first run at 390 wide: the card as a sheet along the bottom, standing above the tab bar when it points at it, and no Agents stop. |
| `Stops.dc.html` | Every stop, the tour before beside the tour now: what each points at, what changed, and its card with its art playing. |

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and
open a board:

```sh
cd docs/design/canvas/onboarding && python3 -m http.server 8798
# http://127.0.0.1:8798/Main.dc.html, or Main.dc.html#begin=tour&day=soon&mode=light
```
