# The call, rethought: design

Status: approved for build on 2026-11-06. The design is the canvas **The call, rethought** (round 4), copied into
[docs/design/canvas/call/](../../design/canvas/call/README.md) so the build can open it locally. This document says what the
canvas decided, in words, and what the build decided where the canvas and today's call disagree.

## Why

People found the call hard to understand:

- A board had **Present** and the workspace didn't. Presenting a document froze it into sections, nothing like presenting a board.
- There were too many buttons. The dock had sixteen controls in no order.
- Chat was one of six tabs in one panel, so opening it brought the transcript and the rest along.
- Putting a board or the workspace away wasn't obvious. Hide, Minimize, ×, Close for everyone and Stop presenting all did different things.

Four rounds of direction settled it:

1. Present the whole workspace, as you present a board.
2. Everyone follows whoever presents a screen, a board or the workspace. On a board and in the workspace they can unfollow and work alongside.
3. You can open a board or the workspace without presenting it.
4. Presenting can end for you or for everyone.
5. Something gets a tile only while it's presented.
6. Board and Workspace are buttons at the top, next to Notes.

## Goals

- **One model for everything shared.** A screen, a board and the workspace each sit in one frame with one bar. Present and Close work the same way on all three.
- **Three places, each with one job.**
  - The stage: the people and what you have open.
  - The dock: what you do in the call.
  - The top right: what's only yours.
- **Every feature the call has today keeps working.** It moves to its new place and takes the new look. The only exceptions are listed under "What goes".

## Non-goals

- Handing presenting from one person to another.
- Changing a board's tools, the document editor, breakout rooms' mechanics, media or devices.

## Anti-goals

The build fails if any of these happen, even when it technically works:

- A feature from user-flows §6 disappears without being listed under "What goes".
- Someone's screen changes because someone else opened something just for themselves.
- A tile stays for something nobody is presenting.
- Something readable reaches the server, a log or a URL. The privacy rules in AGENTS.md apply unchanged.

## The places

**Top bar.**
- Left: the title, the clock, the notes sign (unchanged, with its popover) and the shield. **Reconnecting** shows here when the connection drops.
- Right, in order:
  - **View ▾**
  - a group of **Board**, **Workspace**, a hairline, **Notes**, **Chat**, a hairline, the faces and the count (which open People)
- **Catch up** and **Reset my view** leave the top bar. Catch up moves to More and Notes › Ask; Reset my view moves into View.
- The turns switcher stays where it is when the window is too narrow to show everything.

**Dock.** It holds, in order:
- the microphone, with its arrow (**M**)
- the camera, with its arrow (**V**)
- a hairline
- **Share**
- **Raise your hand**
- **More**
- a hairline
- **Leave**
- **Show everything**, only while in focus

The microphone and camera menus stay exactly as they are.

**The side.** One panel at a time, on the right, at a fixed width (368 px, or 340 px when the window is under 1200 px). It slides in and the stage gives way. The panels:
- **Notes**:
  - head: "Notes", "This call, in the workspace", **Open** (opens the workspace on these notes), the bookmark (Mark this moment, **B**), the ⋯ menu as today, and ×
  - tabs: **Notes**, **Transcript**, **Ask**
  - The Notes tab is From last time, Decided, Follow-ups, From the rooms and Summary, then **Yours** (only you) with what the Yours tab has today.
- **Chat**: only chat, with reactions.
- **People**: as today, plus **Breakout rooms** for the organizer, which opens the rooms in the side.
- **Your notes**: the presenter's notes beside each board frame.
- **Rooms**: the rooms setup and live views.

Each panel's button at the top right is lit while it's open, and pressing it again closes it. On a phone, a panel is a sheet over the call.

**The stage.**
- With nothing open, the people fill it as today: Auto, Speaker or Grid; pins, spotlight, volume and the tile menu are unchanged.
- With something open, it sits in **the frame**, and the people sit beside it as View says (**Beside what's shared**):
  - **Tiles** is a column on the right, about 300, 248, 216 or 176 px wide as the stage narrows.
  - **Arches** is a row over the frame, which is also what happens when the stage is under 760 px.
  - **Hidden** puts the people on the horizon by the dock, as ⇧P does today.

  *Since 9 Nov (#197) there are no modes: the stage lays itself out (a grid; since 11 Nov nobody leads it for doing most
  of the talking), and beside what's open the people are a column, or a row of arches under 760 px. Hiding
  them is ⇧P or Hide the people, the people's own button at the top of their column (#226), and the first tile you
  point at says it can be dragged (#227). The calls docs (`docs/engineering/calls-and-recordings.md`, Your view) say
  what's built.*
- A presented thing that isn't on your stage is a tile among the people. The tile shows a live miniature, its name, "{First} is presenting", and **Join** ("Open" when it's yours). Pressing it puts it on your stage, following.

**The frame's bar.** On the left: the presenter's face (or the kind's icon when nobody presents), then the name as a menu ▾, then a line of meta:
- "Open just for you"
- "You’re presenting · {n} following"
- "You’re presenting · a tab with sound" (a screen)
- "{First} is presenting"

On the right, only what applies:
- "Following {First}" with **Unfollow**, or **Follow {First}** with "{First} is in {where}"
- **Present**, on a board or the workspace open just for you
- focus ("Fill your window with it" / "Leave focus", ⌘⇧F)
- **Stop sharing**, on your own screen
- **Close**, everywhere else. While you present a board or the workspace it has a ▾ and asks "For you" or "For everyone".

The name menu holds the kind's own commands:
- **A board:** Rename, Open where it’s saved, Who can add to it, Copy link, Download as an image, Night board, Download as a PDF.
- **The workspace:** Switch workspace (organizer), Find in the workspace (⌘K), Who’s in it, Copy link.
- **Your screen:** Others can point at it, Clear marks, Change what you share.
- **Someone's screen:**
  - Point at it (L), Freeze the picture (F), Earlier picture (,), Zoom
  - Mute its sound for you, Open in its own window, Put on the board, Show beside
- **The organizer**, after a line, on someone else's: **Close it for everyone** (a board or the workspace), or **Stop it for everyone** (a screen).

A board keeps its own controls inside the frame: the seal, Timer, Vote, More, the pill, the rail, zoom and the phone's +. A presented board puts its pager at its foot for the presenter: ‹ "1 of 3" with the frame's name › and the notes button.

## The rules

1. **Board and Workspace open on your stage, just for you.** Nobody else's screen changes.
   - **Board** opens the board picker under it:
     - head: "Open a board" / "Only you see it until you present it."
     - **In this call**, if the call has a board: its name and who brought it, or "{First} is presenting it"
     - **New**: Blank, Retro, Ideas, Flow
     - **Your team’s boards**, as today's Board menu lists them
     - foot: "Sealed. Alcove can’t read boards."
   - **Workspace** opens the workspace where you left it. **W** and **O** do the same as the buttons.
   - Pressing a lit Board or Workspace button closes it, as Close does.
2. **Your stage holds one thing.** Opening something puts away what was there:
   - something presented becomes its tile
   - something open just for you closes; the workspace keeps your place, caret and undo, as today
   - The one exception is **Show beside**, which puts a second presented thing beside the first, as two screens sit today.
3. **Present brings everyone with you.**
   - **Present** is on the bar of a board or the workspace you have open. **Share** in the dock offers Your screen, A board and The workspace, which present straight away.
   - A presentation that starts takes the stage of everyone who isn't already watching another presentation: they follow it, with a toast. For someone watching another, it comes in as a tile, with a toast and **Show it**.
   - There is one presented board or workspace at a time in each part of the call; screens are as many as today (four).
4. **Following.**
   - On a board, a follower sees the presenter's frame. In the workspace, they see the presenter's page and line. This uses the workspace's existing Follow, through presence: nothing new goes to the server.
   - **Unfollow**, or a click, scroll or keystroke in it, gives you your own view to work alongside. **Follow {First}** brings you back.
   - A screen can't be unfollowed; Close is for you.
5. **Close is for you.**
   - On something open just for you, Close closes it.
   - On someone else's presentation, it closes for you, and it becomes a tile while they present. The toast says "Closed for you. While {First} presents, its tile takes you back."
   - While you present a board or the workspace, Close asks:
     - **For you**: "Everyone else keeps it open, on their own." Everyone following stays in it, working on their own.
     - **For everyone**: "It closes for everyone in the call."
   - Your own screen has **Stop sharing**.
   - When a presentation ends, its tile goes.
6. **The board in the call.** The call keeps "the board in this part of the call" on the server, as it does today, because timers, votes, ideas from the call, breakout rooms and the note's worked-on list hang on it.
   - Making a new board (from the picker or Share) makes it the board in the call, as today, but opens it only for whoever made it.
   - Opening a saved board just for you doesn't touch the call.
   - **Presenting** a board brings it into the call first. If some people here can't open it, the question today's Board menu asks comes first: "Let them in for this call" or "Present without them".
   - A breakout room's board, and the board the rooms come back to, open on everyone's stage there, as today.
   - Timer, Vote and ideas from the call show on the board that's in the call, not on a saved board you opened yourself.
   - Nobody can make or bring in a board while someone else presents one here. The picker says "{First} is presenting a board. You can start one once they stop."
7. **The organizer** can close anyone's presented board or workspace for everyone, and stop anyone's screen share for everyone, from its name menu.
   - Stopping a share is new. The share's tracks are muted through LiveKit, and a notice says who stopped it.
   - The organizer's toast: "You stopped {First}’s share for everyone. {First} is told it was you."
8. **Focus** fills your window with what's in the frame, as Just the document does today. ⌘⇧F, **Show everything** or Esc brings it all back.
9. **View**: "Your view" / "Only your screen changes."
   - **The people**: Auto, Speaker, Grid
   - **Beside what’s shared**: Tiles, Arches, Hidden
   - **See yourself**: In the grid, In a corner, Hidden
   - **Reset my view**

   *View and its modes went on 9 Nov (#197): See yourself is in your own tile's ⋯, Reset layout in More, and hiding the
   people beside what's open is ⇧P or Hide the people at the top of their column (#226).*
10. **More**, the same on every screen:
    - **Turn on captions** (and off), with the language on the captions themselves
    - **Mark this moment** (Only you, **B**)
    - **Catch up on what you missed**
    - **Breakout rooms** (organizer)
    - a line
    - **Audio and video settings**
    - **Video quality**
    - **Move to another device**
    - **Keyboard shortcuts**
    - On a phone, it starts with a grid of **Board**, **Workspace**, **Notes**, **Chat** and **People**, then **Raise your hand** and **Your view**.
    - Captions have no key: **C** stays Chat.
11. **On a phone** (under 600 px):
    - Top: the title, the notes sign, Chat (with its count) and the faces.
    - Dock: microphone, camera, Share, More, Leave.
    - What's open fills the screen under a row of arches.
    - Share's Your screen says "Sharing a screen needs a computer".
    - The board on a phone has no Present, as today.
    - Close's question opens as a sheet.

## What goes

Each is replaced, and the canvas shows the replacement:

- **Arranging panels:** moving them, tearing tabs off, the drop glow, the four layouts and the two ready-made layouts. What's open is always in the middle, and your side always on the right.
- **Presenting a document section by section:** the preview, Back and Next, the strip, and the document presenter's notes. Presenting the workspace with everyone following replaces it.
- **A board opening for everyone**, and the hidden board's tile.
- **The dock's** Board, Workspace, Notes, Chat, Captions, Breakout rooms and Mark this moment buttons. Each is at the top right, in More, or both.

## The server

- **Presenting the workspace.** A new kind of presentation: `workspace`. It names the workspace everyone views, and nothing more; where the presenter is comes from presence.
  - Someone who can't open the workspace is told who's presenting, never what.
  - It ends as presentations end today: the presenter leaving for good, being removed or moved, the room closing, the workspace switching, or the call ending.
- **Ending.** Stopping says whether it's for the presenter or for everyone (`close`).
  - The call keeps how the last presentation in each part ended, until another starts, so followers know whether to keep it open.
  - Stopping a board's presentation for everyone also closes the board in the call, for the presenter or the organizer.
- **Presentation kinds** are `workspace` and `board`. Presenting a document by sections goes.
- **A board** can't be made or brought into a part of the call while someone else presents one there (409).
- **The organizer** stops anyone's screen share (`share-stop`).
- **Stored data.**
  - The call's sealed `call-state` record gains two fields with defaults, shipped on their own first so the release before the build keeps them through the deploy:
    - `workspace.space`: the workspace presented in each part
    - `workspace.ended`: how the last presentation ended in each part
  - A document presentation stored before this release reads as over.
  - No SQL migration.

## Copy

The exact strings are in the canvas's model, `docs/design/canvas/call/nc.js`: STEPS, TOAST, `view` and JOURNEYS. Where this document quotes a string, it quotes that file. Use the shared toast builders (`wsToast`) for new toasts. Every string is sentence case, and people are named or "they".

## Journeys

The canvas's seven journeys are the acceptance walk, and they become Storybook journeys numbered under 6:

1. Open the workspace, then present it
2. Open a board, then present it
3. When someone else presents
4. Share your screen
5. Notes, the transcript and chat, apart
6. Everything else
7. On a phone
