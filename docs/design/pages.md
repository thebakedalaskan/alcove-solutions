# The evening, page by page

How each page is designed and why, so a new page or a change to one fits. Every page here follows
[principles.md](principles.md). What each page does, feature by feature, is in
[docs/product/user-flows.md](../product/user-flows.md); this is how it looks. Each page as it's built, in every state, is in
Storybook (`apps/storybook`, `stories/pages/`); the board it was designed as is in [canvas/](canvas/) (see
[canvas.md](canvas.md)). In the paths below, `routes/` and `features/` are under `apps/web/src`, and
`components/` and `styles/` are under `packages/ui/src`.

## The frame

Every signed-in page sits in the same frame (`apps/web/src/features/shell/`, `packages/ui/src/styles/shell.css`).

- **The side panel**, on the left, is dark in both themes. From the top:
  - the logo, and a button to hide the panel
  - Start a call (N), tinted, never filled
  - the places, each with a count: Home (what's waiting on you), Notes, Record (recordings waiting to upload) and Team
    (people on Alcove), with Team hidden for someone on their own
  - Up next, the next call with Join (not on Home, which already offers it)
  - pinned notes and groups
  - at the foot, the confidential-compute check and the minutes of notes left
- **The page** scrolls under a rounded edge. Search ("Search or ask", ⌘K opens the palette) and you (your arch, which opens
  Settings) sit at its top right on every page, outside the page itself, so moving between pages leaves them alone. A page's
  title keeps clear of them with `--top-room`.
- **On a phone** (860px and narrower) a top bar takes the panel's place: the logo, search, Start a call as a plus, and you.
  A tab bar sits at the bottom: Home, Notes, Record (standing up out of the bar as a small night recorder with its red
  light), Team and Settings.
- **The palette** drops from the top. It finds notes and asks them, and it never opens over another window.

## Home

`routes/_app/home.tsx`, `features/home/`, `styles/home.css` (`hm-`). Moment: `home`. Board: `Home.dc.html`.

Home is for starting a call and for what's yours. It's nearly all sky.

- **The sky.** The date, small, at the top left. In the middle, Start a call (Newsreader), then:
  - Start now (filled), Schedule, and an icon button that copies a link for a new call
  - up to three people to ring, each a chip with their arch, then a plus
  - from 5 minutes before a call with someone else on it, and while it's going, a slim line above the title with its faces,
    its name, "Starts in 4 min" or "Happening now", and Join (J), which takes the filled button
- **The sun** sits half risen under the buttons and lifts a little when you point at Start now.
- **The water,** 72px under the horizon:
  - **For you**, two thirds wide: tiles for what's yours to answer. A decision is rose, with Confirm. A follow-up is horizon,
    with I'll do it. Something shared with you is warm. Decisions and follow-ups carry their moment chip. An answered tile
    says what you chose, with Undo. Under the tiles, your follow-ups as a real checklist, with moment chips and due days in
    a fixed column.
  - **Beside it**: Coming up, one line per call, where a calendar meeting has a menu; then Recent notes. A card to connect a
    calendar appears when it's needed.
- **First day:** Get set up tiles take For you's place. Start your first call is the title.

## Notes

`routes/_app/notes.index.tsx`, `features/notes/list/`, `styles/notes.css` (`nt-`). Moment: `notes`. Board: `Notes.dc.html`.

The sun has just set: a band of sky with the search in the middle, where Home has Start a call.

- **The sky.** Notes at the top left. In the middle, the search line, set in Newsreader because it's the page's hero:
  "Search everything said, or ask". ⌘K focuses it here, so the top search pill is hidden on this page. Under it, people to
  filter by, then All, Calls, In the room and Shared with you.
- **The water.** The list, grouped by day. Each row has:
  - faces, or an empty arch with a microphone or camera in it for a note nobody else has
  - the title, with where it came from: From Maya's call, In the room, only you, Shared by Noor
  - the summary
  - chips: 1 to confirm (rose), 2 follow-ups (horizon)
  - the time, and a pin if it's pinned
- **From 1241px wide** the picked note's preview sits beside the list. Narrower, a note opens on its own page. The preview has:
  - its state (Ready, Still recording, Being written), pin, Share, more, and Open notes (filled)
  - the summary
  - up to three decisions left to confirm, with Confirm and It wasn't decided
  - follow-ups to tick
  - the confidential-compute line
- **Search finds the words.** A matching row quotes its best line and who said it, with a chip for each moment in time order.
  The preview lists those moments above the summary.
- **Asking** (Ask, or Enter): the answer takes over the list, which narrows to what it cites, even with a filter on, because a
  question goes across every note.
- **Nothing found** each has its own empty state: "Nothing matches" a search (with Clear search, and Search all notes when a
  filter is on), nothing with someone, nothing shared with you yet, nothing recorded in the room yet, and a search that failed.
- **First day:** there's nothing to search, so No notes yet and Start a call take the middle.
- **On a phone** the page scrolls as one.

## A note

`routes/_app/notes.$noteId.tsx`, `features/notes/`, `styles/note.css` (`nd-`). Moment: `note`. Board: `Note.dc.html`.

A slim band of sky, and the horizon is the call.

- **The head.** Notes / the title (Newsreader). Pin, Share and more beside search. Under it: when; one set of faces, everyone
  with the notes, then how you got them if they're someone else's; and "Written in confidential compute · hardware verified
  11:58", which opens what was checked.
- **The line** runs along the horizon:
  - Play and the time, then chapters standing on the line
  - what was decided (rose) and what's to do (horizon) marked on it
  - the sun as the playhead, and the light under the line showing when people spoke
  - gaps where notes were off
  - while recording, the line ends in a recording-coloured edge
  - it sticks to the top as you read
- **The water.** The summary, larger. Then the boards open in the call, when there were any: the call's as a wide card with
  a picture of all of it, each breakout room's as a card beside the others' (a stack on a phone), each opening its board in one
  click, and the follow-ups from the board. Then Decided (rose, with how many are left to confirm), Still open, and Follow-ups
  (horizon, with how many are yours). Every row uses one set of columns:
  - the kind's icon, or a tick box for a follow-up
  - the words, with who said or proposed it
  - the moment chip
  - one column for the action (Confirm, It was answered, I'll do it), or the owner and the day it's due
  - a menu: Who it's for, Due, Reword and It wasn't decided, then What was said and Changes
  - Propose a decision and Add a follow-up sit at the foot of their lists
- **Under that,** the transcript, with a key for the dotted words a transcript isn't sure of, and each breakout room's notes.
- **Beside it,** Your notes, the only panel, because it's yours alone. You can write, bookmark a line or keep an answer. Then
  Added by people and Who has these notes. A call in a series shows its series. The organizer of a call in no series gets
  Meet again. A room recording gets neither.
- **At the bottom,** "Ask about this call" stays in reach. It's marked Only you.
- **States, each with its own look:**
  - recording, being written, written again (Write the notes again), unwritten, nothing said
  - no transcript or recording, rooms, disputed, the example note
  - a note that's been deleted, or removed from your notes
  - pinning stops at 8 notes

## A series

`routes/_app/notes.series.$seriesId.tsx`, `features/series/`, `styles/note.css` (`nd-series`). Moment: `note`. Board:
`Series.dc.html`.

The same design as a note. The line holds the series' calls, standing on the horizon, with the sun on the latest. Beside the
lists sit the calls so far and, for the organizer, the next call, with Join, Change this call, or Schedule next week's call.
What's still open says how long it's been open ("Still open 2 calls later"). When a later call may have answered something,
you choose: It was answered or It's still open.

## Team

`routes/_app/team.tsx`, `features/team/`, `styles/team.css` (`tp-`). Moment: `team`. Board: `Team.dc.html`.

The sun is low and to the left, behind the people.

- **The sky.** The company's name (Newsreader) and Invite people (filled). Everyone stands in their arch on the horizon,
  with you in the middle:
  - someone not on Alcove yet is a dashed arch with their initial
  - the sun stands in an empty arch, or just past the end of the line
  - past 13 people the far ones recede, with the sun behind them, and step forward when you point at them; "All N people"
    finds anyone
- **A person's popover** opens from their arch, with a caret, and is a sheet on a phone. It has:
  - their name and title, and when you're next or last in a call together, or how many meetings are coming up
  - Ring (filled), which goes straight to the lobby
  - Schedule, which opens at When
  - Notes you both have
  - for someone not on Alcove, Invite or Remind in place of Ring
- **The water:**
  - **Groups** are tiles with the name, "4 people · 7 calls", faces, and a camera to start the group's call. A group opens in
    place to rename it, add or remove people, or delete it, with undo. New group is a tile of dashed arches.
  - **Not on Alcove yet** lists each person with their title and meetings coming up, and Invite, or Invited with Remind.
    "Invite all N" sits on the heading when more than one is left.
  - **Shared with groups** lists the notes shared with a group, who shared them and when.
- Every number on the page is real: a group's calls are calls everyone in it was on. Someone on their own has no Team page.
- The first day, loading, a failed load and offline each have their own look.

## Record

`routes/_app/record.tsx`, `routes/record.live.tsx`, `features/record/`, `styles/record.css` (`rec-`). Moment: `record`.
Board: `Record.dc.html`.

Night, in both themes, with the recorder for a sun. The page is scoped `.dark` and the document goes with it, so search, the
phone's bars and anything that opens stay night.

- **The sky.** Record at the top left. In the middle, the recording's name, a field set in Newsreader whose placeholder is
  "Notes from the room" (Enter starts recording), then:
  - Start recording (filled, with a red light and R)
  - the microphone as a chip you can change, and Check the level
  - a reminder to let everyone in the room know before you start
- **The recorder** stands on the horizon: a dark disc with the last of the light on its rim.
- **The water:**
  - **On this device** lists what's kept here, by state:
    - Recording now (`rec`)
    - Uploading, with a moving bar
    - Waiting to upload, or waiting for a connection
    - Can't upload yet, or can't upload, with the reason in `caution`
    - Can't be read here

    Each row's menu has Upload now and Delete from this device.
  - **Recorded before** shows each recording's mark (drawn from its ID), the title, the summary, follow-ups, and when and
    how long. "Only you" shows when nobody else has it. "In Notes" sits on the heading.
- **The stage** (`/record/live`) is the same scene over the whole window:
  - the title, the time, Pause and Finish and write notes (filled)
  - the recorder fills with red as you record, and the microphone's level runs across the water
  - three fading lines of what's being said. Scroll up to read back; Latest returns to the newest line
  - a status pill says what it's doing
  - in the first moments it says it's listening and reminds you to tell the room
  - offline, it says the recording is saved on this device
  - if Finish fails, it says so, and Finish can be pressed again
- Record works with no connection. It's the one page that does.

## Settings

`routes/_app/settings.tsx`, `features/settings/`, `components/settings.tsx`, `styles/settings.css` (`set-`). Moment:
`settings`. Board: `Settings.dc.html`.

The last of the light, with you in it, then one page. Change one thing and leave.

- **The band.** You stand on the horizon in your arch, with your name (Newsreader) and address. Take the tour and Sign out
  sit at the right.
- **The page.** One long sheet with a sticky index beside it: Profile, Notes, Recording, Calendar, Devices, Notifications,
  Appearance, Plan and credits, Privacy. A small sun on the index follows the part in view. At 1000px and narrower the index
  becomes a strip.
- **No cards.** Below the horizon the water goes still and becomes the page. Every row is a label, with help under it, then
  a control on one axis, so the eye runs straight down. Saved appears just left of that axis, where you pressed. Nothing is
  filled at rest.
- **Sign out** signs you out at once. Only when recordings haven't uploaded does it ask first: the sky grows to hold the
  question, it says they'll be deleted, and Stay signed in is the filled answer.
- **Delete account** opens in place, with what goes beside what stays. The shared demo account can't be deleted, and says so.

## Starting and scheduling a call

`features/calls/`, `styles/flow.css` (`cf-`), with the lobby and ringing in `styles/ringing.css` (`rg-`).

One modal, one question at a time, and a sheet on a phone.
- It opens on Start now (↵) or Schedule for later (S).
- Scheduling asks Who, then When, then Details.
  - When opens on three times that work, with the best already picked. Pick another time opens the week.
  - Documents steps out of Details and comes back to it.
- Back keeps everything picked.
- Starting floods the screen into the night of the call.
- Ringing someone puts a card on their screen on any page, over a modal if one is open.

## A call

`routes/call.$code.tsx`, `features/call/`, `styles/call.css`. The call's panels are `features/call/layout/Panel.tsx`, styled with
`ic-` classes.

Always night, in both themes, on the stage tokens. People are in arches, never circles, and whoever speaks gets the `speak`
ring. The camera appears only here and on the join screen.

## A board

`features/workspace/BoardPane.tsx`, beside the list, drawing `features/board/` (`BoardSurface`, `mode` `page`, `pageRead`
for someone who can only look, or `pagePhone` on a phone), `styles/board.css` (`bz-`, `bd-`, `bp`, `bpg-`). The board was
designed as the whiteboards canvas's page and its States board, and on a phone as its phone board.

- The board fills where a document would be, on the ground, under the workspace's head, which says where it is (the
  workspace and its folders) and holds the list's button. Its tools are the call's dock turned on its side, made day.
- Its bar is the page's head: the name, with everything about the board itself under it (Rename in its place, Saved in,
  Who can add to it, Copy link); the seal; Undo and Redo; how near you are and the map; More (the downloads and Night
  board); and at the end the faces of whoever else is on it and Start a call here, the one primary button.
- More, at the foot of the tools, is the call's: Image, From your workspace, Table, Mind map, Comment and Templates.
- The seal says how it stands: Sealed, Reconnecting, Not saved or View only. Reconnecting and Couldn't save also take the
  one pill at the top of the sheet, ahead of following someone.
- A comment is a pin, the face of whoever started it on the corner of what it's on, one size however near you are; the
  thread opens beside it in the workspace's comment sheet.
- A narrow bar gives way in order: the faces, then Start a call here's words (its camera stays), then zooming and the map.
  The name keeps room to be read.
- On a phone it's the call's phone board on the day round the page: it opens readable on its first frame, there are no
  tools beside it and no map, and + at the bottom right opens the add sheet in the person's own theme.
- In a document a board is a small picture of one with its name on it, which opens it (`wb-board`).

## Welcome

`routes/welcome.tsx`, `features/welcome/`, `styles/welcome.css` and its scenes' `welcome-*.css` (`lp-`). It has no board on
the canvas.

Signed out, before anything else: what Alcove is, told as one evening on the app's own scene. Each part is a `Sky`
(`features/welcome/Sky.tsx`): the evening behind it, a sky as tall as what stands on it, and the water under the horizon.

- **The hero** is Home's sunset. The headline, one line and the ways in sit on the sky: Continue with Google is the one
  filled button, then Microsoft and single sign-on. The sun is half risen under them, lifts when you point at Google, and
  sets as the page scrolls on.
- **On its water,** the note a call leaves (`NoteScene`). It writes itself, then its call runs along its own horizon with
  the sun as the playhead, visiting each decision and follow-up.
- **The call** is a night window on the water, in both themes (`CallTour`). Its seven steps scroll past the call, which
  stays in view: Documents and boards, Captions in your language, Set your status, Breakout rooms, A quiet nudge, Private
  messages and threads, and Arrange it your way. Notes have the part above, so the call doesn't show them. The call loops
  the scene of the step being read, the one on the reading line half way down the window, with a pointer that shows every
  click; moving to another step carries it straight into that step's scene. Under 1080px the call sticks at the top and
  the reading line is under it.
- **Find a time** is the Team moment (`TeamScene`): the team stands on the horizon with the sun low past the end of the
  line. Picking people lays their busy hours out across the week, with the times everyone is free.
- **Your agent** (`AgentScene`) books a call over MCP, beside the tools it can use.
- **Recording in the room** is Record's night, inset on the water (`RecordScene`): the recorder stands on the horizon,
  records offline and sets, then the session notes rise. **What Alcove can see** (`SealedScene`) sits on its water.
- **The last ask** is morning on the same sea: the sun comes up as the page reaches it. The footer sits on the water.
- The nav is fixed over the sky. It turns night over the night windows, and its Get started is tinted, like the side
  panel's Start a call. The logo appears once, in the nav.

## Not yet on the canvas

These screens follow the same rules but have no section here and no board yet:
- the join screen (`routes/join.$code.tsx`) and the organizer's lobby
- a guest picking a time (`features/calls/scheduling/PickTime.tsx`)
- a scheduled call's card
- sign-in's other ways in, on the join and move pages (`features/welcome/WaysIn.tsx`)
- onboarding: arrival and the tour (`features/onboarding/`)
- moving a call to another device (`routes/move.tsx`)
- the offline page (`features/shell/OfflinePage.tsx`)

Redesign one the way the pages above were, with a board and its journeys (see [canvas.md](canvas.md)).
