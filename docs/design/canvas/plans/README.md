# Plans and checkout

The design canvas that Plans, checkout, Settings › Plan, the side panel's foot and the doors were built from (12 November
2026). It's kept here so the next design of them can start from it.
[The design](../../../superpowers/specs/2026-11-12-plans-frontend-design.md) says in words what it decided and what the
build changed. Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built)), and these boards
don't follow it. Three things the boards show weren't built: Team and its people, 24 months (Pro sells up to 12), and the
amount sent becoming extra days (more than asked stays in the balance).

It's the app's kit (`appdata.js`, `home.css`, `home.js`, `pages.css`, `scene.js`, `tokens.js`, the parts and Settings) with a
`plans` moment added to the scene, and the plans' own files beside it.

## What's here

| File | What it is |
|---|---|
| `data-plans.js` | `AH.PL`: the plans and their prices, the lengths and what they save, the networks with their marks and minimums, every checkout state (`CO`), the call when notes run out (`CALL`), Settings › Plan's states (`SET`), the side panel's foot by plan (`FOOT`, `foot()`), every step the journeys show (`STEPS`) and the journeys themselves (`JOURNEYS`). |
| `page-plans.css` | The Plans page and its cards (`pl-`), checkout (`pl-co`), the summary's arched window (`pl-win`), paying in motion (`pm-`, slowed by `--pm`), Pro in the side panel (`sd-pro`), Settings › Plan (`st2`), the call (`oc-`) and the doors (`dr-`, `dq-`). |
| `marks.js` | The stablecoin and network marks, copied from `packages/ui/src/marks`. |
| `Plans.dc.html` | Plans, with checkout over it: `step` is `plans`, `plansMonth`, `plansHotPro`, `plansPro`, `plansEnding` or any checkout state. |
| `Checkout.dc.html` | The checkout window alone, in any state: `co` is `coChoose`, `coNet`, `coSend`, `coSeen`, `coDone`, `coShort`, `coOver`, `coExpired`, `coExtend`, `coHours` and the rest in `CO`. |
| `PayMotion.dc.html` | Paying, in motion: the window from waiting to done, on repeat, with slow motion. |
| `Settings.dc.html` | Settings › Plan in each state: `step` is `plFree`, `plLow`, `plOut`, `plWaiting`, `plPro`, `plEnding`, `plExtended`, `plEnded` and the rest in `SET`. |
| `CallOut.dc.html` | A call when the organizer's notes run out: `callOut`, `callGuest`, `callCo`, `callCoSend`, `callBack`, `callHours`. |
| `Home.dc.html`, `Side.dc.html` | Home and the side panel, with the foot for `plan`: `free`, `low`, `out`, `waiting`, `pro`, `ending`, `extended`, `ended` or `team` (`FOOT`). |
| `Doors.dc.html` | Where checkout shows, and why: each door as a small picture with what it says. |
| `StepsPlans.dc.html` | Every journey, one row each, as numbered frames. |

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and open a
board:

```sh
cd docs/design/canvas/plans && python3 -m http.server 8796
# http://127.0.0.1:8796/Plans.dc.html#mode=dark, or Checkout.dc.html#co=coSend
```
