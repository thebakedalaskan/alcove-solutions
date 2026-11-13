# Plans and checkout

The design canvas that Plans, checkout, Settings › Plan, the side panel's foot and the doors were built from (12 November
2026). It's kept here so the next design of them can start from it.
[The design](../../../superpowers/specs/2026-11-12-plans-frontend-design.md) says in words what it decided and what the
build changed. Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built)), and these boards
don't follow it. Team is drawn as the server sells it: licenses, one person for 30 days each, bought by the team's admin and
taken as each person next opens Alcove (12 November, the second round).

It's the app's kit (`appdata.js`, `home.css`, `home.js`, `pages.css`, `scene.js`, `tokens.js`, the parts and Settings) with a
`plans` moment added to the scene, and the plans' own files beside it.

The side panel in `Home.dc.html` and `Side.dc.html` is the one before the calmer panel (#283), and its foot (`FOOT`) is
drawn on it. The build keeps #283's panel with the foot as the board has it: on Free, the notes left over a meter, opening
Settings at your plan, then Free's row, the panel's way into Plans: **Free plan · See plans**, which opens Plans, **Get
Pro** (checkout) once notes are low or out, or **Team** on a team without a license, under "No team license yet" and who
has been told; on Pro or Team, the plan's small sun and its line (until when, ending, low or out); a payment on its way in
the row's place; and a notice line above it only while one shows. Plans is reached from Free's row, Settings › Plan's
**See plans**, checkout's **Compare plans** and the doors. [The frame](../../pages.md#the-frame) says what was built.

## What's here

| File | What it is |
|---|---|
| `data-plans.js` | `AH.PL`: the plans and their prices, the lengths and what they save, the networks with their marks and minimums, every checkout state (`CO`), the call when notes run out (`CALL`), Settings › Plan's states (`SET`), the side panel's foot by plan (`FOOT`, `foot()`), every step the journeys show (`STEPS`) and the journeys themselves (`JOURNEYS`). |
| `page-plans.css` | The Plans page and its cards (`pl-`), checkout (`pl-co`), the summary's arched window (`pl-win`), paying in motion (`pm-`, slowed by `--pm`), Pro in the side panel (`sd-pro`), Settings › Plan (`st2`), the call (`oc-`) and the doors (`dr-`, `dq-`). |
| `marks.js` | The stablecoin and network marks, copied from `packages/ui/src/marks`. |
| `Plans.dc.html` | Plans, with checkout over it: `step` is `plans`, `plansMonth`, `plansHotPro`, `plansPro`, `plansEnding` or any checkout state. |
| `Checkout.dc.html` | The checkout window alone, in any state: `co` is `coChoose`, `coNet`, `coSend`, `coSeen`, `coDone`, `coShort`, `coOver`, `coExpired`, `coExtend`, `coHours`, Team's `coTeamNew`, `coTeamSend`, `coTeamDoneLink`, `coTeamMore` and `coTeamMoreBal`, and the rest in `CO`. |
| `PayMotion.dc.html` | Paying, in motion: the window from waiting to done, on repeat, with slow motion. |
| `Settings.dc.html` | Settings › Plan in each state: `step` is `plFree`, `plLow`, `plOut`, `plWaiting`, `plPro`, `plEnding`, `plExtended`, `plEnded`, Team's `plTeam`, `plTeamLow` and `plTeamWait`, and the rest in `SET`. |
| `CallOut.dc.html` | A call when the organizer's notes run out: `callOut`, `callGuest`, `callCo`, `callCoSend`, `callBack`, `callHours`. |
| `Home.dc.html`, `Side.dc.html` | Home and the side panel, with the foot for `plan`: `free`, `low`, `out`, `waiting`, `pro`, `ending`, `extended`, `ended` or `team` (`FOOT`). |
| `TeamPlan.dc.html` | Team, on a plan: the team on the horizon, each person under their license, the admin's Licenses and Invite people, Remove asked in place, and the notes visible to the team. `step` is `teamAdmin`, `teamAdminLink`, `teamAdminRemove`, `teamAdminMore`, `teamMember` or `teamWait`. |
| `Join.dc.html` | Joining a team by its link: one card on the evening. `step` is `join`, `joinSignIn`, `joinDone`, `joinNoLicense`, `joinUsed` or `joinOther`. |
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
