# Upcoming, redesigned

The design canvas Home's Upcoming was rebuilt from (13 November 2026), copied in so the next design of it can start from
here. Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't
follow it.

A calendar can be full and Upcoming still say "Nothing in the next 7 days": when every event in the week has only you on
it, none of them is a call, and Upcoming doesn't list those. Just after connecting, that reads as broken. Now Upcoming says
why it's empty, and counts those events instead of leaving them out without a word:

- **A week with other people in it** lists calls and meetings as before. The end of the foot counts the events with only
  you on them ("6 with only you", with a small square of hatching), and pressing it shows them, one slim, quiet line each
  in its day, then hides them again.
- **A week with only your own events** says "No meetings with other people in the next 7 days", how many events it isn't
  showing, and Show them, over a week of hatched blocks.
- **A week with nothing at all** says "Nothing on your calendar in the next 7 days", so a calendar that was read and is
  clear can't be mistaken for one that didn't load.

The hatch is the hatching scheduling's week gives the time you're busy: your own time.

It starts from [home/](../home/README.md), Home under the horizon, with the widget pulled out into a part of its own.

## What's here

| File | What it is |
|---|---|
| `water.js` | The model, `home/`'s with Upcoming's states added: `week` (mixed, own or clear), `solo` (the events with only you shown), `before` (how Upcoming read before, to compare), `calLoad` (the calendar didn't load), steps starting `up`, the journeys and the States board's rows, and `AH.HW.frames()`, which lays out both boards' frames. |
| `water.css` | `home/`'s styles, with the hatch (`up-hatch`), the slim rows (`up-e.is-solo`), the foot's count (`up-solo`), the two new empty states (`up-empty`, `up-art.is-own`, `up-art.is-clear`) and the widget alone in a frame (`up-alone`, `uw-box`). |
| `Upcoming.dc.html` | The widget as a part. Home hands it its model (`u`); alone, it works out its own from `step` and `mode`, at its width on Home. |
| `Main.dc.html` | Home, every control working, with the part where Upcoming was. |
| `States.dc.html` | Every state of the widget at its real size, in both themes, with what Upcoming said before beside the redesign, then on Home and on a phone. |
| `Journeys.dc.html` | Connecting a calendar with only your own events on it, then showing and hiding them, a week with nothing on it, and a phone row. |

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and open a
board:

```sh
cd docs/design/canvas/upcoming && python3 -m http.server 8797
# http://127.0.0.1:8797/Upcoming.dc.html#step=upOwnWeek, or Main.dc.html#mode=light&step=upSolo
```
