# Notes in the call, rethought

The design canvas the call's Notes panel was rebuilt from (11 November 2026), copied in so the next design of it can start
from here. [The design](../../../superpowers/specs/2026-11-11-call-notes-panel-design.md) says in words what it decided.
Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't follow it.

It starts from [The call, rethought](../call/README.md): `Call.dc.html`, `Thing.dc.html`, `Faces.dc.html`, `nc.js`,
`call.css`, `tokens.css` and `icons.js` are that canvas's, with the call's Notes side drawn by `Notes.dc.html` and the notes
sign opening `Card.dc.html`.

## What's here

| File | What it is |
|---|---|
| `notes.js` | The notes' model: what was said, what the notes made of it, every moment the journeys show (added to `NC.STEPS`), what each press does (`NC.act`), the panel and card as drawn (`NC.notesView`, `NC.cardView`), the seven journeys (`NC.JOURNEYS`) and every state (`NC.NN_STATES`). |
| `notes.css` | The panel (`nn-`), what's captured (`nk-`), the panel as it was (`nb-`), every state (`ns-`) and the idea board (`ni-`). |
| `Notes.dc.html` | Notes on your side, in any state: `step`, or a whole moment as `m` with `onPress`. Alone, every control works. |
| `Card.dc.html` | What's captured, the card the pill beside Notes and the sign in the top bar both open. |
| `Before.dc.html` | The panel as it was, drawn again with the same call's notes, its seven changes numbered. |
| `Idea.dc.html` | The panel as it was beside the redesign, at the same moment, and what changed. |
| `Main.dc.html` | Play the notes: each journey a step at a time. |
| `States.dc.html` | The panel in every state it can be in, then the card in each of its own. |
| `J-*.dc.html`, `Strip.dc.html` | Each journey as numbered frames, from what's pressed to what happens. |

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and open a
board:

```sh
cd docs/design/canvas/notes && python3 -m http.server 8795
# http://127.0.0.1:8795/Idea.dc.html, or Call.dc.html#step=nCard
```
