# Your menu, at the top right

The design canvas your menu was built from (12 November 2026), copied in so the next design of it can start from here.
[The design](../../../superpowers/specs/2026-11-12-you-menu-design.md) says in words what it decided. Storybook is the record
of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't follow it.

Your face at the top right of every page was a link straight to Settings. Here it opens a menu: you standing on the horizon
in the last of the light (Settings' own moment, in small), then Pause notifications, the theme as three small evenings,
Settings, the tour and Sign out, which asks in place when something on this device would be lost. On a phone it's a sheet.
It's drawn over Home as the app has it now, and leads to Settings and to the signed-out page.

It starts from [home/](../home/README.md): `home.css`, `pages.css`, `home.js`, `scene.js`, `appdata.js`, `tokens.js`,
`water.js`, `water.css` and the parts are that canvas's, and `page-settings.css` and `Scene.dc.html` are the kit's, for
Settings.

## What's here

| File | What it is |
|---|---|
| `account.js` | The model: you, the pause's lengths, every state as a step (`AH.AM.STEPS`), what each press does, the journeys (`AH.AM.JOURNEYS`, `AH.AM.PHONE_JOURNEYS`) and the States board's rows (`AH.AM.STATES`), with Settings' sign-out words. |
| `account.css` | Your face and its paused bell, the popover and its caret, the head's small evening, the rows, the pause's lengths, the theme's evenings, the sign-out question and the phone's sheet (`am-`). |
| `Menu.dc.html` | The menu by itself, a part: the head, then its rows or the sign-out question. |
| `Main.dc.html` | Home with your menu at its top right, every control working, and Settings and the signed-out page it leads to. `step` picks a state, `mode` the theme; the menu's own Theme changes it too. |
| `States.dc.html` | Every state: the menu, pausing, signing out, where it leads, and on a phone. |
| `Journeys.dc.html` | Each journey as numbered frames, from what's pressed to what happens. |

The canvas showed **⌘,** beside Settings. It wasn't built: browsers keep that key for their own settings.

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and open
a board:

```sh
cd docs/design/canvas/you-menu && python3 -m http.server 8797
# http://127.0.0.1:8797/Main.dc.html#step=amOpen, or #mode=light&step=amPaused
```
