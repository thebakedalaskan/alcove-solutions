# Home, under the horizon

The design canvas Home's lower half was rebuilt from (12 November 2026), copied in so the next design of it can start from
here. [The design](../../../superpowers/specs/2026-11-12-home-widgets-design.md) says in words what it decided. Storybook is
the record of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't follow it.

The sky is the app's, unchanged but for the row of people to ring, which is gone. Under the horizon sit three widgets, the
way the big apps build a home: For you (To answer and Follow-ups as tabs), Upcoming (a calendar by day, which is the way to
connect Google Calendar until it's connected) and Recent notes (a row of cards, each with its own small sunset).

It starts from the kit in [canvas/](../../canvas.md#the-kit-docsdesigncanvas): `home.css`, `pages.css`, `home.js`,
`scene.js`, `appdata.js`, `tokens.js`, `Faces.dc.html`, `SkyArt.dc.html`, `Visitors.dc.html` and `Overlays.dc.html` are
the kit's (the glitter under the sun is drawn shorter in `home.js`, as the app draws it), and `Side.dc.html` is the side
panel as the app draws it now.

## What's here

| File | What it is |
|---|---|
| `water.js` | The model: the made-up day, every state as a step (`AH.HW.STEPS`), what each press does, the journeys (`AH.HW.JOURNEYS`) and the States board's rows (`AH.HW.STATES`). |
| `water.css` | The widgets (`wg-`), For you's empty drawing (`fy-art`), Upcoming (`up-`), the note cards (`nc-`), Google's page drawn as a stand-in (`hw-g`) and the side panel (`sb-`). |
| `Main.dc.html` | Home, every control working. `step` picks a state, `mode` the theme, `scroll` how far down a frame starts. |
| `States.dc.html` | Every state, by what it's for, then the light theme and whole pages. |
| `Journeys.dc.html` | Each journey as numbered frames, from what's pressed to what happens. |

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and open a
board:

```sh
cd docs/design/canvas/home && python3 -m http.server 8796
# http://127.0.0.1:8796/Main.dc.html#step=first, or #mode=light&step=today
```
