# The call's workspace and boards, open to everyone in it

The design canvas the build followed (11 November 2026): everyone let in to a call can open and edit the workspace the call
uses, and its board, guests too, for as long as they're in the call. Copied in so the next design of the call can start from
it. Storybook is the record of what was built (see [canvas.md](../../canvas.md#once-its-built)); these boards don't follow it.

## What's here

| File | What it is |
|---|---|
| `Main.dc.html` | The call at one moment: `#step=<name>` in the address shows any of its 15 moments (`wsArt` to `boardNoor`), and alone every control goes where it would. Art Vandelay organizes, Priya and Kofi were invited, and Noor Haddad is a guest with no account. |
| `Steps.dc.html` | Every journey, one row each, each frame `Main` at that moment: Art opens the call's workspace, Noor opens it too, Art moves the call to another workspace, and Art opens a board from another workspace. |
| `end.css` | What this design adds to the call's styles: the bar's line saying who can edit, the list's head with only Find and New, This call, a guest's initial, Who's in it, Switch workspace and the questions, and the journey frames. |
| `Faces.dc.html` | The faces in the arch, with Noor added. |
| `icons.js`, `tokens.css`, `call.css` | The flattened Lucide icons, the Blue Hour tokens and the canvas's styles, the same as [call/](../call/README.md)'s, so this folder opens on its own. |
| `canvas.json` | The index: its two pages, The end state and Parts, and its notes: what changes, what goes away, and the calls made. |

## Opening it

Every board loads `./support.js`, the design type's runtime, which isn't kept in the repo. Save the type's
`artifact-type/dc-runtime.js` as `support.js` in this folder (see [canvas.md](../../canvas.md)), then serve the folder and open a
board:

```sh
cd docs/design/canvas/call-access && python3 -m http.server 8795
# http://127.0.0.1:8795/Main.dc.html, or Main.dc.html#step=wsSwitchAsk, or Steps.dc.html
```
