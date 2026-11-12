# The side panel, calmer

The design canvas the side panel was rebuilt from (12 November 2026), copied in so the next design of it can start from
here. Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't
follow it.

The panel had grown to six places with four counts, Up next as a card all day (repeating Home's Upcoming, with a second
Join), Pinned with a sentence while it was empty, Groups (repeating Team's), and the foot. The canvas compares today's
panel with three directions:

- **A · Just tidy**: the same order, with less in it. A count only where something waits on you; the next call only in
  the ten minutes before it, as one row at the foot; Groups left to Team; Pinned only once you pin something.
- **B · Two groups**: A, with Team and Agents moved to the foot, above the check. Your work at the top, who works with
  you at the foot. This is the one that was built.
- **C · A rail**: A, as a rail 76 pixels wide with each place's name under its icon, pinned notes as their arches, and
  the check and the minutes as a shield and a ring.

It starts from Home's canvas in [home/](../home/README.md) (`home.css`, `pages.css`, `water.css`, `home.js`, `water.js`,
`scene.js`, `appdata.js`, `tokens.js`, `Faces`, `Overlays`, `SkyArt` and `Visitors` are that canvas's), with Home's own
side panel swapped for `Panel`.

## What's here

| File | What it is |
|---|---|
| `nav.js` | The model, `AH.NV`: the panel's view for each direction (`panel()`), every state as a step (`STEPS`), Pin a note's rows, B's journeys (`JOURNEYS`) and the States board's rows (`STATES`, `STATES_C`). |
| `nav.css` | The panel (`nv-`): today's, A and B's, and C's rail (`nv-r-`), the call about to start (`nv-now`), Pin a note (`nv-pw-`), and the comparison and states boards. |
| `Panel.dc.html` | The panel as a part. `v` picks the direction (`today`, `a`, `b`, `c`) and `ns` the state. |
| `Main.dc.html` | Today and the three directions side by side, at their real size, with what each changes. |
| `Home.dc.html` | Home with any panel (`v`, `ns`, and Home's own `step`), every control working: Join, Start a call, Pin a note. `HomeLight`, `HomeToday`, `HomeA` and `HomeC` show it in each of the others. |
| `States.dc.html` | B in every state (at rest, the first day, a call in 10 minutes, a call going on, a lot pinned, on your own, offline, notes running low), then C's rail. |
| `Journeys.dc.html` | B's journeys as numbered frames: a call about to start, pinning a note, and what a count means. |

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and
open a board:

```sh
cd docs/design/canvas/side-panel && python3 -m http.server 8797
# http://127.0.0.1:8797/Main.dc.html, or Home.dc.html#v=c&ns=tipNow
```
