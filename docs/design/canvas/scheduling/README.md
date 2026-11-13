# Scheduling a call, rethought

The design canvas the scheduler on the Calls page was rebuilt from (13 November 2026), copied in so the next design of it
can start from here. [The design](../../../superpowers/specs/2026-11-13-scheduling-rethought-design.md) says in words what
it decided, and wins where the two differ: it keeps everything the scheduler did that the canvas doesn't draw (moving a
call, proposing a time, Meet again, what the notes keep, bringing documents, no calendar, a failed save). Storybook is the
record of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't follow it.

What testers said about the scheduler it replaced, and what changes, is on the Changes board. In short: a time is picked
from the start (the soonest you're free) and follows the people you add until you pick one yourself; the week fills the
Calls page with the call's editor beside it on one sheet; pressing anywhere moves the call and keeps its length; the call
can be dragged to any day, and held at the week's edge into the next; the day is a scroll box of all 24 hours; every
block says its time first; and letting a guest pick is off until you turn it on, with numbered times that never re-sort.

It starts from the Calls and Drive canvas, which isn't in the repo: `home.css`, `home.js`, `scene.js`, `page-cd.css`,
`Faces` and `Side` are that canvas's, and `pages.css`, `appdata.js`, `tokens.js`, `Scene` and `Visitors` are the kit's.

## What's here

| File | What it is |
|---|---|
| `sched.js` | The model, `AH.SK`: a made-up week from Monday 9 November 2026 with now at Thursday 11:10, your calendar and everyone else's busy time, the soonest free half hour (`soonestFrom`), the times offered to a guest (`offerFrom`), how long a call is once it stops at midnight (`lenAt`), every state as a step (`STEPS`), the journeys (`JOURNEYS`) and what testers said (`CHANGES`). |
| `sched.css` | The page around them (`sk-`), the week (`wx-`), the call's editor (`ce-`) and the Blocks board (`kb-`). |
| `Main.dc.html` | The Calls page while a call is made, every control working: the week beside the editor, the people to add, the day's month, the start and end lists, how it repeats, pressing, dragging and the grip, letting Jonas pick, Schedule, and the Calls page's own week it comes back to. `step` picks a state, `mode` the theme. |
| `Steps.dc.html` | Eight journeys as numbered frames of `Main`: it opens ready, drag it to any day or week, add people, pressing keeps the length, the day scrolls, the week says which days it shows, letting Jonas pick, and Schedule. |
| `Changes.dc.html` | What testers said, what the scheduler does now, and the journey that shows it. |
| `Blocks.dc.html` | The week's blocks before and now, from 15 minutes to an hour and a half: one of your calls, the call being made, and the outline under the pointer. |

## Where the app differs

- Dates: the canvas writes them month first ("Nov 12 – Nov 18", "Thu, Nov 12"); the app writes them as it does
  everywhere, day first ("12 – 18 Nov", "Thu 12 Nov").
- Now: the canvas's is Thursday 12 November 2026 at 11:10; the app uses the clock.
- The canvas draws a new call only. Moving a call, asking to move one, Meet again, what the notes keep, Everyone joins
  muted, an agenda's library, no calendar and a failed save are in the design and the app, not on these boards.
- The ring round the next control to press is the canvas's own, to show a journey, and its toast stands in for the
  app's.

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and
open a board:

```sh
cd docs/design/canvas/scheduling && python3 -m http.server 8797
# http://127.0.0.1:8797/Main.dc.html#step=withPriyaKofi, or #mode=light&step=pickSecond
```
