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
  - Start a call (N): a row like the places, its name in line with theirs and its camera in a warm circle. It's never
    filled or shaded, so the place you're on is the one shaded row
  - the places, each with a count: Home (what's waiting on you), Notes, Drive (tags you haven't seen), Record
    (recordings waiting to upload), Team (people on Alcove) and Agents (agents connected), with Team hidden for someone
    on their own. Every count is quiet, in `ink-3` at the row's end
  - Up next, the next call with Join, on Home too, except while Home's own line offers a call (in its last few minutes,
    and while it's going), so there's one Join at a time
  - pinned notes and groups
  - at the foot, the confidential-compute check and the minutes of notes left
- **The page** scrolls under a rounded edge. Search ("Search or ask", ⌘K opens the palette) and you (your arch, which opens
  Settings) sit at its top right on every page, outside the page itself, so moving between pages leaves them alone. A page's
  title sits at its top left, in the same place on every page, and keeps clear of them with `--top-room`.
- **On a phone** (860px and narrower) a top bar takes the panel's place: the logo, search, Start a call as a plus, and you.
  A tab bar sits at the bottom: Home, Notes, Record (standing up out of the bar as a small night recorder with its red
  light), Drive and Team. Settings is you in the top bar, and Agents opens from Settings › Connections, so the bar keeps
  its five.
- **The palette** (`features/shell/Palette.tsx` and `palette/`, the `Palette*` parts, `styles/palette.css` (`pal-`)).
  Board: `Search.dc.html`. It's solid: an opaque window on `surface-raised` with a hairline, over a page dimmed and never
  blurred, and the field that opens it at the top right is solid too.
  - It finds what was said, not just the note. A result is a moment: who said it (their arch), their words with the match
    marked, and the time chip, under its call. A line a decision or follow-up rests on says Decision (`rose`) or Follow-up
    (`horizon`). A name finds the person first, and Enter on them searches only what they said, with them as a token in
    the line. Notes can't list only their lines, so the list then ends with Calls with Maya in Notes, with no count.
  - Ask is a row, not what Enter does: first in the list, lit by itself only for a question. There's no filled Ask button.
    The one filled button in view is the preview's own action (Open at 3:15).
  - From 1100px the lit result shows beside the list: a moment in its transcript, with what was made there; a person; a
    note; or what Ask will do. Narrower, the list is alone; on a phone it takes the screen.
  - While an answer is written, the question waits in the preview's place, so the window keeps its width.
  - The foot says what's private (sealed in `sun-text` while Ask is lit) and the keys, only those that do something now.
    It never opens over another window.
  - Nothing to list is the kit's `EmptyState` with a dashed arch around an icon (`pal-none`): nothing matches; someone in
    the line who said nothing you can read, with Calls with Maya as a quiet button; the first day; a search that didn't
    go through, in `caution`; offline. While a search hasn't answered, the last list stays dimmed, or there are dots.
  - On a phone the line says less ("Search what was said, or ask", and "Search" beside a person), so it fits.

## Home

`routes/_app/home.tsx`, `features/home/`, `styles/home.css` (`hm-`). Moment: `home`. Boards: `Home.dc.html`, and the
water's own in [canvas/home/](canvas/home/README.md).

Home is for starting a call and for what's yours. It's nearly all sky.

- **The sky.** The date, small, at the top left. In the middle, Start a call (Newsreader), then Start now (filled) and
  Schedule, and nothing else: ringing someone starts from Team or from Start a call. From 5 minutes before a call with
  someone else on it, and while it's going, a slim line above the title has its faces, its name, "Starts in 4 min" or
  "Happening now", and Join (J), which takes the filled button.
- **The sun** sits half risen under the buttons and lifts a little when you point at Start now.
- **The water,** 72px under the horizon, holds three widgets, the way the big apps build a home: For you beside Upcoming
  (7 parts to 5), then Recent notes across the width, 20px apart. At 1320px and narrower they stack in that order. A
  widget is one card (`surface`, a hairline ring, a soft shadow): a head with its icon in a small tile and its title in
  15px semibold, then the body, and a foot with Show N more only when a list is longer than it shows.
  - **For you** has two tabs in its head, To answer and Follow-ups, each with a count in a pill: rose under To answer
    and horizon under Follow-ups while that tab is on, neutral otherwise. A 2px ink line along the head's foot marks the
    tab you're on.
    - **A row to answer** is one grid: the kind in a circle (a rose diamond for a decision, a dashed horizon box for a
      follow-up that isn't yours yet, a warm share icon for notes shared with you), the words in up to two lines, the
      faces of whoever was on the call (a microphone arch for a room recording) in a fixed column, and the answer in a
      fixed column at the right, a tinted pill (Confirm, Keep it confirmed, I'll do it, Read) with the × beside it. Read
      keeps the ×'s room, so the pills line up. There's no moment chip and no second line: the words open the moment,
      the call's name is the row's tooltip, and what backs it and what to be careful of sit behind a small mark after
      the words.
    - **Answered,** a row stays where it is: its words go to `ink-2`, its circle to an outline, and the answer column
      says what happened in a word or two (Confirmed, Not decided, Disputed, In your follow-ups, Not yours), with Undo
      or It's mine.
    - **A follow-up** is the box to tick, the words on one line, the call it came from in `ink-2`, and the day at the
      right: Today in `sun-text`, late in `caution`.
    - **Empty,** the body's middle has a picture over a title and one line (the kit's `EmptyState`, in the widget's
      type). With nothing in either tab once notes are written, the picture is Home's own small sunset, and only then:
      You're all caught up. Otherwise it's a small drawing of rows not filled in yet (a rose diamond, a dashed box, bars
      and pills, on a faint panel), with boxes to tick under Follow-ups: before your first notes, Nothing to answer yet
      (or whose notes are being written) and No follow-ups yet; after them, when only the other tab has something,
      Nothing to answer (your follow-ups are in the next tab) or No follow-ups.
  - **Upcoming** is a calendar by day, with a quiet icon button at the right of its head that opens Settings at Google
    Calendar. Each day is a date block (the day small, Today in `sun-text`, then the date's number large and tabular)
    beside its calls, and a call whose time is still being picked goes last, under Soon. A row has the time (tabular,
    `ink-2`), the title on one line, and under it a calendar mark for a meeting from your calendar or a clock for a call
    whose time is being picked, then up to three small faces. At the right, only what needs saying: In 4 min in
    `sun-text` in its last few minutes and Now while it's going, Answer as a rose pill, or Use Alcove, a line button
    with the camera.
    - **Not connected** and with nothing to show, the body is a small drawing of a week (three days, tinted blocks), See
      what's coming up and one line, Connect Google Calendar (a line button with the calendar mark), and under it, small
      in `ink-3`, what Alcove does with the calendar. With calls to show, the connect is a row at the widget's foot
      instead: a dashed calendar circle, one line and Connect.
    - **Back from Google** with a problem, the connect gives way to a `caution` circle, what went wrong, one line and
      Try again. A calendar that doesn't load says so the same way.
    - **While the calendar is on its way,** calls already ahead show, with a quiet row at the foot saying so; with none,
      the body is a few faint bars.
  - **Recent notes** has no card: its icon tile and its title, with View all at the right. Under them, a sideways row of
    cards that scrolls with no scrollbar. Each card's cover is the note's own small sunset (a sky, a sun on a band of
    sea, two glints), picked from its id, with the people's faces (two at most) standing on its lower edge, or a
    microphone arch for a room recording. Under the cover, the title in up to two lines, then when and how long. A note
    being written says so with the moving dots, and its cover breathes slowly.
- **On a phone,** For you's tabs sit on their own line under its title, its rows drop the faces and the ×, and the note
  cards scroll sideways.
- **First day:** Start your first call is the title. For you shows its first-day empty states, Upcoming its connect
  until a calendar is connected, and Recent notes the example note's card, with an Example tag on its cover, then a
  dashed card where notes from your calls will land. There's no list of things to set up: the first day is these states.
- **Signed in from the welcome page,** Home opens by sailing out of the welcome page's cove (see [Welcome](#welcome)).

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
- **The shared screens,** when a share went in the notes, stand on the sky over the line, so the line runs along their foot
  as their seek bar, one seek bar under the picture. The sky grows to hold them, so the line still sits on the horizon.
  The stage is night in both themes, as wide as the note's column under it and at most about half the window tall (then
  narrower, keeping its shape), and it keeps its size whatever it shows: the share playing (chips to switch when two
  overlap), that it's loading or couldn't be played, or, where no share in the notes covers the moment, when screens were
  shared, to go there in one press. As you read on, it scrolls away above the line, which sticks clear of it. Its corner
  fills the screen with it.
- **The water.** The summary, larger. Then the boards open in the call, when there were any, sized by the column they're in:
  the call's as a card with a picture of all of it, beside its words where the card is 600px wide and above them where it
  isn't, and each breakout room's as a card beside the others', two or three across as there's room (a stack in a narrow
  column), its picture in the call card's shape; each opens its board in one click. Then the follow-ups from the board. Then Decided (rose, with how many are left to confirm), Still open, and Follow-ups
  (horizon, with how many are yours). Every row uses one set of columns:
  - the kind's icon, or a tick box for a follow-up
  - the words, with who said or proposed it
  - the moment chip
  - one column for the action (Confirm, It was answered, I'll do it), or the owner and the day it's due
  - a menu: Who it's for, Due, Reword and It wasn't decided, then What was said and Changes
  - Propose a decision and Add a follow-up sit at the foot of their lists
- **Under that,** the transcript, with a key for the dotted words a transcript isn't sure of, and each breakout room's notes.
  Pressing a line's words does what pressing its time does: it goes to that moment and plays from there. Testers asked for
  the line to go to its moment (#247), and playing from it too was taken from the issue's suggestion, so the words and the
  time never do two different things. A press on the words waits a quarter of a second, so a double or triple click
  selects them to copy instead; the time goes at once. On a phone, where one line at a time shows its tools, the line you
  pressed keeps them while the call plays on past it, until you press another or scroll it out of sight.
- **Beside it,** a column that scrolls by itself under the line, so where you write is in reach however long the note is.
  Your notes first, the only panel, because it's yours alone (Only you): write, bookmark a line or keep an answer. A row's
  kind is its mark (lines of text for what you wrote, a bookmark, a question for a kept answer), and its actions (Add to
  the shared notes, Edit, Delete) show only on hover or focus, always on touch screens. Then Shared notes (Everyone with
  the notes): what people wrote there or added from their own, and once the notes are written a box of its own that says
  who reads it before anything is typed. Then Who has these notes. A call in a series shows its series. The organizer of a
  call in no series gets Meet again. A room recording gets neither. In one column, at 1180px and narrower, Your notes and
  Shared notes come before the transcript, two across, and the rest after it.
- **At the bottom,** "Ask about this call" stays in reach. It's marked Only you. Its suggested questions show above it at the
  end of the note, and while it's pointed at or in use, so nothing covers the note while it's read.
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

- **The sky.** Team at the top left. In the middle, the company's name (Newsreader) and Invite people (filled). Everyone
  stands in their arch on the horizon, with you in the middle:
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

## Agents

`routes/_app/agents.tsx`, `features/agents/`, `components/agents.tsx`, `styles/agents.css` (`ag-`). Moment: `agents`.
Boards: `Agents.dc.html`, with every journey in `StepsAgents.dc.html`.

Team's evening the other way round: the sun is low and to the right, just past the end of the line of agents.

- **The sky.** Agents at the top left. In the middle on the first day, Connect your agent (Newsreader) over one line:
  "Ask it about your calls, and let it book them. It can do only what you allow." The sky is a little taller then. Once
  one is connected, the title is Your agents, with no line.
- **The line.** Agents stand on the horizon as windows, square with rounded tops, as people stand in arches:
  - the connected ones first, solid, with their name and when they were last used under them
  - half a place's gap, then the agents people use that aren't connected yet, dashed, as someone not on Alcove is on Team:
    Claude, ChatGPT, Cursor, VS Code, Claude Code and Codex
  - Another agent, a plug, at the end
  - each has a mark by its kind, a plain icon and never its maker's logo: a key for a token, and a bot for a name Alcove
    doesn't know. The kind comes from the name the agent gives itself, so it's never more than the picture
  - access that ends within three days says so under the name in `caution`, with a `caution` dot on the window
- **A window's popover** opens under it, with a caret, and slides to stay on the page; on a phone it's a sheet. Each has
  one thing to do, and no numbered steps, floating links or lines of facts:
  - **To connect:** Connect Claude, one line of what to do, the address or the command in a quiet mono well when it needs
    one, and one full-width filled button. Pressed, the button gives way to Waiting for Claude, with three dots, and once
    Claude is connected the popover says so, with something to ask it in a well with copy.
  - **Another agent:** the address and Copy address, with a foot row, A script that can't sign in? Create a token →.
    The token's form opens in the same popover, with a way back; made, the token is masked in a well with copy, and the
    address is under it.
  - **A connected agent:** its mark, name and when it was used. While it's ending, a line in `caution` and a full-width
    secondary Keep it 30 more days. Then What it can do, with Saved beside it after a change, as seven chips, and a foot
    with a quiet Disconnect and when its access ends. Disconnect asks in place, and Keep Claude is the filled answer.
- **The question.** When an agent asks to use your Alcove, the sky grows to hold it. In the line's place, the agent's
  window, outlined in `rose` because a decision waits on you, stands with you in your arch, joined by a dashed `rose`
  line with a plug in a `rose` circle. Then Claude wants to use your Alcove (Newsreader, 32 to 44px), a quiet panel with
  a row for each part of Alcove it asked for, its level at the row's right edge opening a menu of levels with what each
  allows, the disclosure, Allow (filled) and Cancel, and one line of fine print. Allowed, the line closes, solid with a
  tick, and the page says it's taking you back.
- **The water:**
  - **What your agents did**, with Only you see this and a lock, grouped by day. Each row is a mark tinted by what was
    done, a sentence with what it was about as a link, a quiet second line, and the time in a fixed column. Reading is
    neutral; a booked call takes `sun-text`, a follow-up `horizon` and a decision `rose`. Show more continues it. Empty,
    it's a dashed window with a bot, Nothing yet, and one line.
  - **Ask your agent**, beside it: four things to ask, each saying which connected agents can do it (with a tick) or what
    it needs, with copy.
- Loading is three dashed windows that breathe. A failed load, being offline and a request that ended each say so on the
  sky, with Try again or Show me how.
- **On a phone** Agents opens from Settings, and its head has a way back there. The line scrolls sideways under the sky,
  and the water follows in one column.

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

The last of the light, with you in it, then seven groups. Change one thing and leave.

- **The band.** You stand on the horizon in your arch, with your name (Newsreader) and address. Take the tour and Sign out
  sit at the right.
- **The index.** It stays beside the page as you scroll, and a small sun on it follows the group in view: You, Calls and
  notes, Audio and video, Notifications, Connections, Plan and credits, Privacy. At 1000px and narrower it becomes a strip
  that stays at the top. A group is found by what it's for, so a setting has one obvious home.
- **Groups of panels.** Each group is a heading over one or two panels (`SettingsGroup`, `SettingsPanel`): `surface`, a
  hairline edge, rows separated by hairlines inside, never a card per row. A panel is a set of things you'd change
  together, which is what makes a long page scannable. Every control sits at the panel's right edge, and Saved appears
  just left of the control you pressed. Help is one short line, only where it's needed; a fact you can't change is the help
  line of the setting it belongs to, not a row of its own. Nothing is filled at rest.
- **What reaches you is said once.** Notifications holds the browser's permission, Sounds (silence, volume, play), Quiet
  mode and the reminder before a call, then one table, `AlertTable`: each thing that can reach you is a row with an Alert
  tick (inside Alcove, and from the browser when Alcove is in another tab) and a Sound tick, empty where that way doesn't
  apply. With sounds off, the Sound column steps back and keeps its ticks. The call's own Settings shows the same pieces
  with the In a call rows.
- **What you set up once folds away.** Connections holds Google Calendar (its two switches nested under it) and Google
  Drive in one panel, and Agents in its own. Drive is one line that says where notes go until Manage opens its folder,
  files, recent exports and Disconnect in place. Agents is one row, since agents are connected and changed on a page of
  their own: the agent tile, who's connected (or what agents are for, while none is), and Open Agents →, or Connect an
  agent → while none is. On a phone it's the way to Agents.
- **Sign out** signs you out at once. Only when recordings haven't uploaded does it ask first: the sky grows to hold the
  question, it says they'll be deleted, and Stay signed in is the filled answer.
- **Delete account** sits apart, in its own panel at the end, and opens in place, with what goes beside what stays. The
  shared demo account can't be deleted, and says so.

## Connecting an agent

`routes/connect.tsx`, `AgentConsentFrame` in `components/agents.tsx`, `styles/agents.css` (`ac-agent-`). Where an agent
sends you to let it in, with its request. Signed in, it hands over to Agents at once (`/agents?request=…`, in its place),
and Agents asks on its sky (see [Agents](#agents)). Signed out, it's one quiet sheet on the theme's ground with the mark
above it: Sign in to connect your agent and the ways in, and then Agents asks. No request, and checking the sign-in or
failing to, use the same sheet. Storybook records its states under **Pages / Connect an agent**, and the journeys under
**Journeys / 14 Agent access**; it has no board of its own on the canvas.


## Starting and scheduling a call

`features/calls/`, `styles/flow.css` (`cf-`), with the lobby and ringing in `styles/ringing.css` (`rg-`).

One modal, one question at a time, and a sheet on a phone.
- It opens on Start now (↵) or Schedule for later (S).
- Scheduling asks Who, then When, then Details.
  - When opens on three times that work, soonest first, with the best already picked. Under them, the time picked reads
    as it will, its start and end there to type, on one line; the lengths sit under it. Pick another time opens the week,
    Monday to Sunday and the whole day.
  - Documents steps out of Details and comes back to it.
- Back keeps everything picked.
- Starting floods the screen into the night of the call.
- Ringing someone puts a card on their screen on any page, over a modal if one is open.

## A call

`routes/call.$code.tsx`, `features/call/` (the shell in `layout/`), `styles/call.css`, styled with `ic-` classes, Chat in
`styles/call-chat.css` (`ch-`), and Notes in `styles/call-notes.css` (`nn-`, and `nk-` for what's captured). Boards:
[canvas/call/](canvas/call/README.md), and Notes' own in [canvas/notes/](canvas/notes/README.md).

Always night, in both themes, on the stage tokens, except your side, which takes your theme. People are in arches, never
circles, and whoever speaks gets the `speak` ring. The camera appears only here and on the join screen.

- **The timer** is one countdown for everyone, beside the call's title and the shield. The host's **Timer** opens **Timer
  for everyone**, a small popover (a sheet on a phone): the length, big and tabular, the usual lengths as chips, a minute
  less or more, and **Start**, its one filled button. Once it runs, the button is the countdown in `stage-sun`, and the same
  popover has Pause, +1 min and a quiet Stop. Its last 30 seconds and over time take `caution` with a warning sign as well
  as the colour. Everyone else reads the same popover, which says only the host can change it. Focus reserves a strip above
  the frame for the timer, keeping the frame’s own title and tools clear.
- **Three places, each with one job.**
  - **The stage** holds the people and what you have open.
  - **The dock** holds what you do in the call: the microphone and camera with their arrows, a hairline, Share, Raise your
    hand, More, a hairline, Leave, and in focus Show everything. Share is the one control it names in words.
  - **The top right** holds what's only yours: one group of Board, Workspace, a hairline, Notes, Chat, a
    hairline, and the faces with the count (and, for whoever hosts, how many are asking to join), which open People. Each is lit while what it opens is open.
- **Your side** is one panel at a time, on the right, at a fixed width (368px, or 340px in a window under 1200px), and the
  stage gives way as it slides in; where that would leave the stage under 480px (a window under 864px), it slides in over
  the stage, which dims behind it, and toasts keep clear of its foot wherever it is: Notes (with the tabs Notes, Transcript,
  Ask and Yours), Chat, People, Your notes beside a presented board, and the rooms. It takes your theme, as a board's sheet
  does unless it's a night board; the stage, the dock, the workspace and screens stay night.
- **Notes** has its head (Notes, a pill, Open as an icon, ×), then its tabs, words with a line under the one you're on.
  The pill says the state once, in a word: Live with a `rec` dot, Paused, Off, Unavailable in caution, or the
  organizer's 2 asked in rose. It opens the card the sign at the top left opens, what's captured: one sentence, the asks,
  what's yours to press, then how the notes are written and who gets them. A bar under the tabs shows only while capture
  isn't simply live, saying what it means with the one thing to do; a hiccup that fixes itself is only the summary's
  time, in caution. Nothing hides behind ⋯, and nothing is said twice, so there's no line about writing and no footer.
  The notes take their colours by kind, as the note does afterwards: the summary first, Decided in rose with diamonds,
  Follow-ups in horizon with boxes, and what the call suggests dashed under them, with Add and ×, two at a time and still
  while you point at them. Every tab but Ask ends in Note to self, with the bookmark beside it, for you alone.
- **The frame.** A screen, a board and the workspace each sit in one frame with one bar. On the left, the presenter's face
  (or the kind's icon while nobody presents), the name as a menu of the kind's own commands, and a line that says whose it
  is. On the right, only what applies: following or Follow, Present, focus, Stop sharing (with Close, on your own screen),
  or Close. Close says before it's pressed what it does, and when it's the last thing on your stage, that the people fill
  it again; on your own screen it puts the screen away for you, a tile with the people, while everyone still sees it. A
  board someone presents keeps every tool for everyone following it: following is a view, not a mode, and anything of your
  own on it takes you off it, from where you are; the presenter keeps theirs too, with the pager at the frame's foot. The
  people stand at the window's right edge, level with it and in the middle of their edge: a column of tiles, or a rail of
  arches once they're smaller and in focus, and a row of arches over it on a stage under 760px. Notes, Chat and People open
  between it and them, and it makes room; the people never move for them. Their one control is the seam left of them: a
  faint grip in the gap until you point at it, when the whole seam lights up. Click it, or drag it right to make the people
  smaller and left to make them bigger, as ⇧P does. Nothing floats over them. A narrow stage and a phone keep their arches,
  and have none.
- **No layouts to choose.** The stage lays itself out, and talking moves nobody: the speak ring says who's talking, and
  only a pin or the organizer's spotlight puts someone on the main stage. You drag a tile to move it and pull its corner
  to make it bigger, and pin from its menu. The first time you point at a tile you can move, a coachmark under it says
  so, once in that browser. Once you've changed it, More has a quiet Reset layout (muted ink, no fill). Testers asked for preset layouts
  and for tiles that snap to drop zones (#227); both stay out, as #178 and #197 decided, because choosing layouts made the
  call hard to understand. What they were missing was a way out of the column and a sign that tiles move, so those were
  built instead.
- **More**, in the dock, is what you do in a call (captions, Mark this moment, catching up, breakout rooms), a hairline,
  then Open floating call, Reset layout while there's a change to put back, Move to another device and Settings. No key
  hints or scope chips in it, and no keyboard shortcuts sheet: the keys still work.
- **Settings** is one modal from More, with its parts as tabs down its left (on `surface`, the pane on `surface-raised`):
  Audio and video (the dock's two menus in one place), Video quality, Notifications, and Call, which only whoever hosts has
  (Lock the call; Pointing at shared screens, the organizer's alone). Notifications is Settings' own: the browser's
  permission, Sounds, Quiet mode and the alert table's In a call rows. Each part has its heading and its rows, Settings'
  own label-and-control rows at the modal's width, and the modal keeps its size as the parts change. On a phone it's a
  sheet, its parts a strip along the top.
- **Share**, in the dock, opens one menu over it, a step at a time: Your screen, A board or The workspace, then the kind of
  screen or the board picker in the same menu, so no window opens over another. While someone else presents a board or the
  workspace, A board and The workspace say who instead. Stop sharing, on a board or the workspace you present, asks for you
  or for everyone in the same menu.
- **Leave** asks only whoever hosts, and only with someone else in the call: a popover over it, as Close's question opens,
  with **End for everyone** and, when someone here can host, **Leave, Priya hosts**, whose **Change** lists who else could
  in the same popover. Anyone else is out at once. Alone, pressing it ends the call; going back a page asks instead, End
  for everyone saying "You're the only one here, so leaving ends the call." However the call is over for you, it eases
  back as its page rises in ([After the call](#after-the-call)).
- **A tile only while it's presented.** Something presented that isn't on your stage is a tile first among the people (a
  screen live, a board drawn small, the workspace with where its presenter is), with who's presenting it and Join.
- **People** opens with Find someone, which narrows every list in it by name: who's asking to join first (for whoever
  hosts, with × and Let in), then who's in the call, hands raised first in the order they went up and each status on its
  row, then ringing and invited. Each row in the call has Message privately and ⋯ in fixed columns, held in place where a
  row has neither. Copy link sits at its foot, over how the call is kept private. The call's own settings (locking it,
  pointing at shared screens) aren't in the list.
- **A person's ⋯**, on their tile and their row, is short and has no key hints. Your own: Set a status (Be right back,
  Listening only, On my phone; Back in 2, 5 or 10 min as chips; I'm back in its heading), Pin for me, See yourself (Grid,
  Corner, Hidden as chips) and whoever hosts' Spotlight for everyone. Someone else's: Pin for me, Message privately, Nudge ▸,
  Volume for you, then whoever hosts' Spotlight, Lower hand, Mute for everyone and Remove from the call. Nudge is a step in
  the same menu, headed "Only Kofi sees it". Tiles move and grow by dragging, so there are no rows for that.
- **A status** sits at a tile's top left for everyone, with the time they're back ("Be right back · 14:37"); Be right back
  dims the tile, and a timed status counts down as a line along its foot (still, with reduced motion). It goes when its time
  runs out, when they talk, or with I'm back.
- **A nudge** reaches only whoever it's for, as a quiet toast on their side ("Kofi can't hear you"), one for the same nudge
  from everyone within a minute ("3 people can't hear you"); You're muted offers Unmute. Whoever sent it is told "Kofi got
  your nudge: Can't hear you". Talking with your microphone muted says "You're talking on mute", with Unmute, in the pills
  at the top of the call.
- **Just you so far**, at the stage's bottom left while you're on your own, has × and stays closed for the rest of the call.
- **Chat** is built like Slack's. Its conversations are tabs along the top: Everyone (the room you're in), Questions with
  how many are open, and a tab for each private conversation with a lock and a dot when something's new; + finds someone in
  the call to talk to privately. Messages sit on the panel without boxes, a run from one person under one arch and name;
  the times of the rest show in the margin as you point. Pointing at a message brings a small bar over its top right corner
  (three reactions, the rest, Reply in thread, Message privately); on a phone a ⋯ or a long press opens the same as a sheet.
  Reactions are pills under the words, yours outlined. A thread opens in place of its conversation with ← and "In Everyone ·
  3 people", the original on top, a hairline with the count, and Also send to Everyone beside Send. A private conversation
  starts with "Only you and Priya can read this." Questions put votes in a column of their own, saying Vote or Voted, and
  say Anonymous with a mask where nobody's told who asked; what whoever hosts or asked can do to a question is in words,
  in the ⋯ at the end of its line, and the list sorts as chosen whenever the pointer is away from it (on a touch screen, a
  couple of seconds after the last touch or scroll). The
  composer is one box: the words, then @, the thread's or question's one choice, and Send, the one filled button.
- **Focus** fills the window with what's in the frame. The bars slide off, the people keep a rail of arches at the right,
  and the dock keeps the microphone, camera, Show everything and Leave.
- **On a phone** (under 600px), the top is the title, the notes sign, Chat and the faces; the dock is the microphone,
  camera, Share, More and Leave; what's open fills the screen under a row of arches; More starts with a grid of Board,
  Workspace, Notes, Chat and People; and your side, Settings, Close's question and Leave's are sheets.

## After the call

`features/call/session/CallOver.tsx` (Rejoin in `rejoin.ts`), drawing `components/call-over.tsx` and
`styles/call-over.css` (`co-`). Moment: `after`. Boards: [canvas/after/](canvas/after/README.md).

When a call is over for you, its own page takes the call's place, on the call's night: the welcome page's cove after dark
(`Cove`, seed 17), in both themes, with stars, a crescent moon high on the right and a rose glow on the horizon, its light
lying on the bay. It's the join page's sibling: the logo once in the middle of the top and what the call runs on at the
top right, but no Home link, since Go to Home is one of its buttons.

- **One column on the sky,** from the top: who was in the call (or who's still in it) in their arches, the title in
  Newsreader ("Team standup has ended", "You left Team standup"), one line, the notes, then the buttons. The cove's land
  keeps clear of the words, as the welcome page's does.
- **One line** says what happened in a few words: "20 min with Priya, Kofi and Maya", "Priya, Kofi and Maya are still in
  it" with how long it's run ticking beside it, "Kofi is hosting until you're back". It never says who ended a call you
  didn't end, since the app can't tell whether whoever hosts did or it ended by itself: that line is the one you'd see had
  you ended it.
- **The notes** are a panel: being written (the step they're at, and who gets them, with their faces), then the summary's
  first lines with what was decided (rose) and the follow-ups (horizon), or, when they take long, that they'll be in
  Notes. While a call you left goes on, one line says how notes were as you left: on with the `rec` dot, paused with the
  pause sign, or off, and that the notes, or what was written, come when it ends. Without notes, it says none were taken.
- **One filled button,** the first: Open the notes (Read the notes once they're written), Rejoin (J) while the call goes
  on, or Go to Home when there's nothing else. J rejoins with the microphone and camera off; the button brings them back
  as they were. While Rejoin says Rejoining…, Go to Home can still be pressed: it's the way out while you wait to be let
  in. Nothing moves on by itself, but signing out in another tab takes the page to the welcome page, as it takes every
  other tab.
- **Its states** are the ways a call is over for you, as
  [user flow 7](../product/user-flows.md#7-end-the-call-and-get-the-notes) lists them. What changes while you're on it
  (the notes being written, a call you left ending) rises in, in place, and when the page turns its title takes the keys.
- **In and out.** The call eases back and fades over half a second as the page rises in over it, about a second in all.
  To Home or the notes, the page fades and the frame settles in, the side panel easing in from the left, in under a
  second. Rejoin brings the call back up in place, at the same address, as the page fades over it. Only opacity and
  transform move, and with reduced motion each is a short fade.
- **On a phone** (under 600px wide) it's the same column, with the buttons across the foot.

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

`routes/welcome.tsx`, `features/welcome/`, `styles/welcome.css` and its scenes' `welcome-*.css` (`lp-`), with the cove in
`components/cove.tsx` and `styles/cove.css` (`cv-`). It has no board on the canvas.

Signed out, before anything else: what Alcove is, told as one evening on the app's own scene. Each part is a `Sky`
(`features/welcome/Sky.tsx`): the evening behind it, a sky as tall as what stands on it, and the water under the horizon.

- **The hero** looks out of a cove at Home's sunset, so it isn't Home's open sea. The headline, one line and the ways in
  sit on the sky: Continue with Google is the one filled button, then Microsoft and single sign-on. The sun is half risen
  under them in the mouth of the bay, lifts when you point at Google and stays up while Google opens, and sets as the page
  scrolls on.
- **The cove** (`Cove`, drawn into the Horizon as its `land`):
  - three headlands a side, far, mid and near, their tops rolling hills with stands of pines and cypresses, each ending
    in a cliff face down to the water with a band on it lit by the sun's rim
  - sea stacks by the mouth of the bay, and every one of them mirrored in the water, the reflection broken by ripples
  - foam at the nearest cliffs' feet, which reach the foot of the window, and ripples in the bay
  - its own colours, light and dark: each headland paler and hazier the further out it stands
  - drawn from plain numbers, so a seed always draws the same cove (the hero's is 5)
  - no cliff, tree or stack within 24px of the words on the sky (the headline, the line, the ways in and the nav), measured
    where they rest, and drawn again when they move or the window changes size. Where the words reach across a narrow
    window, as on a phone, the whole land lies lower, so its hills and trees stay whole instead of being cut flat
  - boats, ships and whatever leaps pass behind the cliffs, and gulls fly in front. What's on the water starts below its
    reflections
- **On its water,** the note a call leaves (`NoteScene`). It writes itself, then its call runs along its own horizon with
  the sun as the playhead, visiting each decision and follow-up.
- **The call** is a night window on the water, in both themes (`CallTour`). Its seven steps scroll past the call, which
  stays in view: Documents and boards, Captions in your language, Set your status, Breakout rooms, A quiet nudge, Private
  messages and threads, and Arrange it your way. Notes have the part above, so the call doesn't show them. The call loops
  the scene of the step being read, the one on the reading line half way down the window, with a pointer that shows every
  click; moving to another step carries it straight into that step's scene. Under 1080px the call sticks at the top and
  the reading line is under it.
  - It's the call as the app draws it, at one size whatever the window: the top bar with Board, Workspace, Notes, Chat
    and the faces at its right, the dock with Share and More, and menus that say what the call's say. Captions and
    breakout rooms open from More, the captions' language from their own button, a status from your own tile's ⋯, and a
    nudge from Kofi's ⋯ as a step in its place. You're talking on mute is said at the top of the call.
  - Arrange it your way has no layouts to pick. Maya's tile is dragged to the front, the others making room, and pulled
    by its corner until she's the bigger one. Kofi's screen takes the room in its frame with everyone in a column beside
    it, and Focus fills the window with it, everyone in a rail of arches at its right. When Kofi stops, Reset layout, in
    More, puts the call back.
- **Find a time** is the Team moment (`TeamScene`): the team stands on the horizon with the sun low past the end of the
  line. Picking people lays their busy hours out across the week, with the times everyone is free.
- **Your agent** (`AgentScene`) books a call over MCP, beside the tools it can use.
- **Recording in the room** is Record's night, inset on the water (`RecordScene`): the recorder stands on the horizon,
  records offline and sets, then the session notes rise. **What Alcove can see** (`SealedScene`) sits on its water.
- **The last ask** is morning on the same sea, in a cove of its own (seed 11): the sun comes up as the page reaches it.
  The footer sits on the water.
- **Signing in sails out of the cove to Home.** Every way in on the page keeps where the hero's cove stands on screen as
  it's pressed (`lib/sailOut.ts`), across the trip to Google and back, and Home plays it once as it opens (`SailOut`,
  `features/home/SailOut.tsx`), in about three and a half seconds:
  1. the cove comes in where it was, its sun where it was, lifted or setting
  2. the headlands go by on either side, nearest first, and the bay's ripples slide away
  3. the horizon comes up to Home's and the sun eases to Home's size, its middle only ever rising
  4. 60% of the way out, Alcove's frame forms round the sea: the side panel slides in, and the page takes its rounded edge
     with the sun where Home's is (a phone has no frame, so the sea stays whole)
  5. Home's parts rise in as the sea clears, leaving the real Home

  A new account has its arrival instead, and with reduced motion Home just opens. It's decorative: it takes no focus, and
  a press, a key or the wheel clears it at once.
- The nav is fixed over the sky. It turns night over the night windows, and its Get started is tinted, leaving the
  filled button to what's on the page. The logo appears once, in the nav.

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
