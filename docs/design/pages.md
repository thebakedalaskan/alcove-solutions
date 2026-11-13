# The evening, page by page

How each page is designed and why, so a new page or a change to one fits. Every page here follows
[principles.md](principles.md). What each page does, feature by feature, is in
[docs/product/user-flows.md](../product/user-flows.md); this is how it looks. Each page as it's built, in every state, is in
Storybook (`apps/storybook`, `stories/pages/`); the board it was designed as is in [canvas/](canvas/) (see
[canvas.md](canvas.md)). In the paths below, `routes/` and `features/` are under `apps/web/src`, and
`components/` and `styles/` are under `packages/ui/src`.

## The frame

Every signed-in page sits in the same frame (`apps/web/src/features/shell/`, `packages/ui/src/styles/shell.css`).

- **The side panel**, on the left, is dark in both themes, in two groups: your work at the top, and who works with you
  at the foot. Board: [canvas/side-panel](canvas/side-panel/README.md). From the top:
  - the logo, and a button to hide the panel
  - Start a call (N): a row like the places, its name in line with theirs and its camera in a warm circle. It's never
    filled or shaded, so the place you're on is the one shaded row
  - Home, Calls, Drive and Record. A count says something waits on you there (what's for you on Home, tags you haven't
    seen in the Drive, recordings waiting to upload), quiet, in `ink-3` at the row's end. Nothing counts a total
  - Pinned, once you've pinned something: no heading and no sentence before that. Its pin shows at the end of the heading
    while you point at the list, as an add button does. It scrolls between the places and the foot
  - at the foot, Team (where your groups are, so the panel doesn't list them again) and Agents, with Team hidden for
    someone on their own
  - a call about to start, from 10 minutes before until it ends: one row with a hairline round it, its cover, its name,
    "Starts in 4 min" or "Happening now" in `sun-text`, and Join, never filled. On Home it makes way while Home's own
    line offers the call (its last few minutes, and while it's going), so there's one Join at a time. The rest of the
    day is Home's Upcoming. It comes in under Agents, so the places at the top never move
  - the confidential-compute check, then your plan, as the plans canvas's Side board has it. On Free, notes left over a
    thin meter that runs from rose to the sun's warmth ("About 1 h 26 min of notes left", warm under an hour, caution once
    out), which opens Settings at Plan, and under it Free's row, the side panel's way into Plans: "Free plan · See plans",
    which opens Plans, or "Free plan · Get Pro" (checkout) once notes are low or out, or "Free plan · Team" on a team
    without a license. On Pro or Team, one calm row where Free's notes left are:
    `SunMark` (a 12px half sun on a 16px hairline, in the icon column under the shield), the plan in Newsreader 18px over a
    12.5px line in ink-2, and a chevron, with no box and no glow. The line says what matters most: "Ends in N days ·
    Extend" in sun-text 600 with the sun half set (it opens checkout), "No notes left until 1 Dec" in caution, for a team's
    admin while its licenses run short "2 licenses left · Buy" in sun-text 600 (it opens checkout on Team), "About 40 min
    of notes left" in sun-text, or "Until 4 Nov 2027" on Pro and the team's name on Team. On a team without a license
    you're on your own plan, told so over it: "No team license yet" in caution, and under it who has been told ("Priya has
    been told"), or for an admin "Buy licenses, and one is yours"; on Free the notes left and the meter follow, then Free's
    row with Team. A payment for a plan on its way takes the row's place: dots and "Waiting for N USDC" in
    horizon ("Payment seen, adding licenses" for a team's), and the payment's row with Open. Anything else said (Pro renewed
    or ended, Team replacing Pro, a team's licenses while notes have stopped, a workspace you pay for now, by its name and
    held to two lines) is one short line above the row, and only
    while it shows (until it's dismissed in Settings). On Plans, Pro's or Team's row, or a payment's, is shaded as the place
    you're on, so there's still one shaded row; on Free it's Free's row. Plans is reached from Free's row (See plans),
    Settings › Plan's See plans, checkout's Compare plans and wherever a limit is met
- **The page** scrolls under a rounded edge. Search ("Search or ask", ⌘K opens the palette) and you (your arch, which opens
  your menu) sit at its top right on every page, outside the page itself, so moving between pages leaves them alone. A page's
  title sits at its top left, in the same place on every page, and keeps clear of them with `--top-room`.
- **Your menu** (`features/shell/YouMenu.tsx`, the `You*` parts in `components/you.tsx`, `styles/you.css` (`ym-`)). Canvas:
  [you-menu](canvas/you-menu/README.md). A popover under your arch, aligned to its right edge with a caret, 312px wide:
  - At its top you stand on the horizon in the last of the light, Settings' own moment in small, with your name and address
    beside you. It says whose account the rest is about, so Sign out never needs to.
  - Then **Pause notifications**, whose three lengths open in place under it, each with the time it ends in a column of its
    own; paused, the row says until when, with Resume, and a small crossed-out bell sits on your arch until it ends.
  - **Theme**, the three small evenings Settings draws, small and unnamed. The page changes at once and the menu stays open.
  - A hairline, **Settings** and **Take the tour**, a hairline, **Sign out**. Nothing is filled at rest.
  - Sign out asks in place, in Settings' words, when something on this device would be lost: the rows give way to the
    question, and its one filled button is Stay signed in.
  - On Settings your arch isn't at the top right, since you stand on the horizon there with Take the tour and Sign out.
  - What isn't in it: the minutes of notes left and the confidential-compute check, which the side panel already says.
- **On a phone** (860px and narrower) a top bar takes the panel's place: the logo, search, Start a call as a plus, and you.
  A tab bar sits at the bottom: Home, Calls, Record (standing up out of the bar as a small night recorder with its red
  light), Drive and Team. You in the top bar open the same menu as a sheet from the bottom, with Settings in it, and Agents
  opens from Settings › Connections, so the bar keeps its five.
- **The palette** (`features/shell/Palette.tsx` and `palette/`, the `Palette*` parts, `styles/palette.css` (`pal-`)).
  Board: `Search.dc.html`. It's solid: an opaque window on `surface-raised` with a hairline, over a page dimmed and never
  blurred, and the field that opens it at the top right is solid too.
  - It finds what was said, not just the note. A result is a moment: who said it (their arch), their words with the match
    marked, and the time chip, under its call. A line a decision or follow-up rests on says Decision (`rose`) or Follow-up
    (`horizon`). A name finds the person first, and Enter on them searches only what they said, with them as a token in
    the line. Calls can't list only their lines, so the list then ends with Calls with Maya, with no count.
  - Ask is a row, not what Enter does: first in the list, lit by itself only for a question. There's no filled Ask button.
    The one filled button in view is the preview's own action (Open at 3:15).
  - From 1100px the lit result shows beside the list: a moment in its transcript, with what was made there; a person; a
    note; or what Ask will do. Narrower, the list is alone; on a phone it takes the screen.
  - While an answer is written, the question waits in the preview's place, so the window keeps its width. Asked with no
    notes left this period, the answer's place says "No notes left until 1 December" in caution, with Get Pro or more
    hours (`NoNotesLeft`), which closes the palette and opens checkout; typing again puts it away.
  - The foot says what's private (sealed in `sun-text` while Ask is lit) and the keys, only those that do something now.
    It never opens over another window.
  - Nothing to list is the kit's `EmptyState` with a dashed arch around an icon (`pal-none`): nothing matches; someone in
    the line who said nothing you can read, with Calls with Maya as a quiet button; the first day; a search that didn't
    go through, in `caution`; offline. While a search hasn't answered, the last list stays dimmed, or there are dots.
  - On a phone the line says less ("Search what was said, or ask", and "Search" beside a person), so it fits.

A workspace full screen has a frame of its own in place of this one ([A workspace, full screen](#a-workspace-full-screen)).

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

## Calls

`routes/_app/calls.index.tsx`, `features/calls/list/`, the kit in `components/calls.tsx`, `styles/calls.css` (`cs-`).
Moment: `calls`. Designed in [the Calls and Drive design](../superpowers/specs/2026-11-12-calls-and-drive-design.md).

Every call, ahead and past, in one place. The sun has just set: a short band of sky, then a rail of places beside a sheet.
The page doesn't scroll; the rail and the sheet each do.

- **The sky** (`SkyBar`). Calls at the top left; in the middle the search (`SkySearch`), set in Newsreader because it's the
  page's hero: "Search every call, or ask". ⌘K focuses it here, so the top search pill is hidden on this page. At the right,
  Schedule a call, the one filled button, with you level with it. It opens the scheduler (see
  [Starting and scheduling a call](#starting-and-scheduling-a-call)) in place of the rail and the sheet, and the sky keeps
  only the title and the search, so the scheduler's own button is the one filled.
- **The rail** (`PlaceTree`, `PlaceRow`): All calls; Coming up, with how many; Past calls, with In the room and Shared with
  you under it, with how many; then Series, each with its next call ("Fri 15:00"). At its foot Google Calendar ·
  Connected (`PlaceFoot`), which opens Settings at Google Calendar; with none connected the foot is empty. No sentences in
  the rail. Narrower than 1100px the counts step back and the trails stay.
- **The sheet** (`CallsSheet`, `SheetHead`, `CallsGroup`): the place's name in Newsreader, then its calls in groups, each
  under its name on a hairline, in `sun-text` while they're still to come.
  - **All calls**, the default: later today and tomorrow, then Show N more coming up (`CallsMore`, which opens Coming up),
    then the calls that happened, by day: Earlier today, Yesterday, Earlier this week, Last week, then the date.
  - **Coming up**: Waiting for a time first (a call whose guest is picking), then each day. Alcove calls and, with Google
    Calendar connected, the meetings on it with someone else. List and Week sit at the sheet's top right.
  - **Week** (`CallsWeek`): Monday to Sunday, 08:00 to 19:00, with Last week, Today and Next week. What happened is
    filled, with a rose diamond for a decision to confirm and a blue dot for a follow-up; Alcove calls ahead have a sun
    edge, the calendar's meetings are outlined, an invitation is dashed in rose and a time held for a guest is dashed. The
    sun on a line is now. Pressing a call opens it; pressing or dragging across a free time starts scheduling there. Week
    keeps Coming up lit in the rail.
  - **Past calls**, **In the room** and **Shared with you** list what happened, by day.
  - **A series** (`/calls?series=<id>`): its name, how it repeats and how many calls, and Change the series for its
    organizer. Next, the next call's row (or Schedule next week's call when none is). So far, rows led by their date, with
    All N calls. Then what carries over (`CarryRow`): questions still open, follow-ups to tick, decisions, each with its
    moment chip, and what a later call seems to have settled, to agree with or not in place. Ask across the series is at
    the foot.
- **A row** (`CallRow`) has fixed columns, so things line up down the sheet: who (faces, or an arch: a calendar for a
  meeting from your calendar, a clock for a call waiting for a time, a microphone for the room), the name with only what
  matters under it, when (`sun-text` while it's ahead) and how long, and ⋯ (`RowMenu`). The name is the row's link and
  covers it; what you can press sits above.
  - Ahead: its series or "From your calendar · Google Meet"; who's on it; an invitation ("Kofi invited you", rose) with
    Yes, Maybe and No as equal buttons (`CallReply`), then "You're going" with Change (`CallAnswered`); a request to move
    ("Diego asks to move it to 14:00", rose) with Move it and Keep 11:00; how others answered, quietly; No notes only on a
    call that won't write them; "Just scheduled" or "Moved", lit once.
  - Past: how it came to you (From Maya's call, In the room, only you, Shared by Ines), the gist, and only what waits on you
    (`CallChip`: 1 to confirm in rose, 2 follow-ups in horizon), or that it's still recording or being written.
- **⋯** does what the call's kind allows. Change the time, Propose another time and Meet again open the scheduler; the rest
  ask first in the same popover (`RowAsk`), so no window opens over another:
  - your call: Change the time, Copy link, Cancel this call
  - your call in a series: Change the time (the scheduler asks: this call, or this and later ones), Skip this one, Copy
    link, Cancel the series
  - an invitation: Propose another time (in the scheduler), Copy link
  - a meeting from your calendar: Open in Google Calendar, and Use Alcove instead when it's yours
  - a call waiting for a guest: Copy the link for them, Cancel this call
  - a call that happened: Meet again (scheduling with the same people and name), Share the notes
- **Search finds the words**, as #273 built it: each call quotes the line that has them and who said it, with a chip for
  each moment (`MomentChip`). A name lists the calls with that person, coming up first; from the Team page or the palette
  they're a token in the line. The words and the person never go in the address.
- **Asking** (Enter, or Ask): read in confidential compute, the answer lands at the top of the sheet (`CallsAnswer`) with a
  chip for each moment it comes from, then the calls it read. × or typing puts it away. Asked with no notes left this
  period, the top of the sheet says "No notes left until 1 December" in caution, with Get Pro or more hours
  (`NoNotesLeft`).
- **Empty states**, each its own: No calls yet on the first day, with Connect Google Calendar and Start a call now; nothing
  coming up, past, recorded in the room, shared with you or repeating; no calls with someone; nothing matches; a search
  that didn't go through. Without a calendar, one line at the top of All calls and Coming up offers Connect.
- **On a phone** the page scrolls as one, the sky goes up behind the top bar, the rail becomes chips (All, Coming up, Past,
  Series), List and Week are icons, and Schedule is the top bar's plus.

## A call's page

`routes/_app/calls.$noteId.tsx` and `features/notes/` for a call that happened (`Call.tsx`, with `Stage.tsx`, `Line.tsx`,
`Made.tsx`, `NotesPane.tsx`, `TranscriptPane.tsx` and `Download.tsx`); `routes/_app/calls.upcoming.$meetingId.tsx` and
`features/calls/list/Upcoming.tsx` for a call ahead. `styles/note.css` (`cd-`, and `nd-l` for the kit's transcript line).
Moment: `note`. Board: `Call.dc.html`.

Everything about one call, on a slim band of sky, in two halves: on the left the call itself, which never scrolls; on the
right what came of it, in tabs, each its own scroll area. A series has no page of its own: it's a place on Calls
(`/calls?series=`), and a call in one links there from its line.

- **The head.** The way back (Calls), and at the right Share, Download (an icon, opening a menu) and More. The title in
  Newsreader, then one line: when and how long, the faces and names of who has the notes (pressing them shows who has them
  and how each got them), how you got them if they're someone else's, the series, and Written in confidential compute,
  which opens what was checked and when (or, in caution, Written by an unencrypted model). Search isn't in the head here:
  the page has its own things to do there.
- **The stage** is the call, always night in both themes: everyone in arches, whoever's speaking lit in the low sun's warm,
  and what they say as captions at its foot (hidden while the Transcript is open, since it says the same). When a screen was
  shared and kept, it plays there in step with the audio, with whose it is at the top and the speaker small in the corner;
  chips switch between two that overlap, and it says when one is loading or couldn't be played, with Try again. A room
  recording has a microphone's arch. Full screen fills the screen with the stage and its line.
- **The line,** under the stage (play controls sit under the picture, never over it): play, the time, the chapter you're in
  above the line, the chapters as lengths along it, decisions as rose diamonds on it (hollow until confirmed) and follow-ups
  as blue dots under it, a shared screen as a tinted length with a screen under it, the sun as the playhead, the end, speed,
  captions and full screen. Pressing or dragging along it goes there; a mark goes to its moment. While the call is still
  recording, it ends at a recording-coloured edge.
- **Shared and made in this call,** under the line: each shared screen as a card with its ▶ moment and how long it was up
  (lit while it plays), then what the call worked on that you can open, as the Drive's cards (a document's first lines, a
  board drawn as it is), and Open its workspace. Nothing shared or made says so.
- **The tabs.** Notes, Transcript and Your notes (and Shared in one column). Every ▶ anywhere plays its moment on the stage
  without changing the tab.
  - **Notes:** the gist, with Full summary under it; For you, with what's asked of you and its two answers (Confirm / It
    wasn't decided; I'll do it / Not mine), each saying what happened with Undo, or "Nothing from this call is waiting on
    you"; Decided, Follow-ups (yours first) and Still open, each row once: its kind's mark, its words, one line of who and
    where it stands with its ▶ chip, its buttons, and its menu (on hover or focus where there's a pointer). Propose a
    decision and Add a follow-up at the foot of theirs. Then the shared notes, and How it went: each chapter with what it
    was about, what was shared then, and each breakout room under the chapter it was in.
  - **Transcript:** find, its own download, what was said by chapter, the line being played lit and followed as it plays
    (unless you've scrolled), From the start once you're down it, and which breakout room you were in, with the others.
  - **Your notes:** only you read them; write, bookmark a line or keep an answer.
- **Ask about this call** sits at the foot of the right column, Only you. Its suggestions show at the end of what's read,
  and while it's pointed at or in use.
- **Download** saves on this device: the transcript (text with times), the notes (Markdown), the recording and each shared
  screen. "Opened on this device. Alcove can't read it."
- **More:** pin, copy as text, Meet again, Google Drive (a window with the call's own exports), Write the notes again, then
  Delete notes or Remove from your notes, which asks in the same popover and says what goes.
- **Narrower than 1100px** it's one column: the stage, the line, then the tabs, with what was shared and made as the Shared
  tab, and the page scrolls as one. On a phone the arches shrink and their names go; the line keeps play, the time and the
  end.
- **States, each with its own look:** still recording, being written (each step ticked off), written again, unwritten,
  nothing said, no transcript or recording, breakout rooms, disputed, a room recording, the example, and a call that's
  gone (what went, and Back to Calls).

**Before the call** the same page waits for it. The stage has everyone invited in arches with how each answered (its
organizer sees everyone's, dimming who hasn't answered; anyone else sees their own), and "Join shows here five minutes
before it starts" until Join takes its place, the page's one filled button then. A call offering times says whose pick
it's waiting on, or for its guest, Pick a time. Under it, the link with Copy link. On the right, Are you coming? for
someone invited; the Agenda, with what's brought to the call as cards and Add an agenda (filled while nothing's there),
New board and Upload, each made in the call's workspace and opened there, for everyone invited, before the call and in
it; then Notes: on or off, where they're written, what they keep and who can open them, with Change for the organizer.
Change in the head opens the scheduler; More is the list's menu for a call ahead.

## The Drive

`routes/_app/drive.index.tsx`, `features/drive/`, `styles/drive.css` (`dv-`), with the kit's `FileCard` for every file.
Moment: `drive`. Board: `Drive.dc.html` (the Calls and Drive canvas).

Every workspace you're in and everything in them, from your calls and made on purpose. A slim band of evening, then the
places on the water: a tree on the left, a sheet of large previews on the right. The places are the address's search params
(`?ws=…&folder=…`, `?show=shared|trash`, `?q=…`), so the sky and the tree stay put as you move; a workspace full screen is
its own page.

- **The sky.** Drive at the top left. In the middle, the search, set in Newsreader because it's the page's hero: "Find a
  document, a board or a file". ⌘K comes here, so the top search pill is hidden on this page; it narrows everything by name
  as it's typed, with the workspaces it names first. At the right, **New** (the one filled button), then you. The sides keep
  what they hold and the search takes what's left, so at 1024px it shrinks rather than sliding under New.
- **The tree.** Rows of one height, an icon or a mark in a fixed column, the place you're in the one shaded row, and no
  sentences:
  - Recent; Shared with you, with how many
  - Workspaces, each with a neutral mark (its first letter, or two where two share one, the oldest keeping its own) and a
    `+` on the heading. The one you're in opens to its folders and files, and a folder you're in opens to what's in it
  - From calls: each call's own workspace by the call's name, the next ones first with their time ("17:30", or the day),
    then the latest. The one you're in opens to what the call made. Five, then Show N more. Two with the same name say when
    each was. Its heading's chevron opens Calls
  - Trash, apart at the foot
- **The sheet.** Its head: the place's name in Newsreader, a workspace's mark beside it, a line under it, and its few
  actions at the right. Sections start with a label on a hairline.
  - **Recent**: everything you can open, the most recently edited first, by day (Today, Yesterday, Earlier this week, Last
    week, Earlier), 24 at a time with Show more. Pictures or a list, a switch at the head's right, remembered in this browser.
  - **Shared with you**: what's in workspaces you're not in.
  - **A workspace**: who's in it (their faces, "Priya, Kofi, Ines and you"), **Open full screen**; its folders as tiles with
    how many files each holds; the calls kept in it as rows with when and Open the call; its files. A folder opens in the
    same place under the way back.
  - **A call's own workspace**: the call's name, "This call's own workspace", when and who; **This call**: its Notes,
    Follow-ups and Transcript as cards, each a picture of what it says (the gist with a decision's rose diamond and your
    follow-up's dot; who has what to do; the first lines said), for whoever has its notes; **Made in the call** (For the call,
    before it), ending in the dashed New document, New board and Upload files; and in a series, Earlier calls.
  - **Trash**: across every workspace, a row each with where it was, who moved it and when, the days it has left, and
    Restore for whoever can edit it. Deleting for good is in each workspace's own Trash.
- **A card** is the kit's `FileCard` at its large size. Its picture is what the file is: a document's first lines as it is
  now, from the server's preview, with ticks for its to-dos and a heading it starts with as its page's title; a board's
  stickies; photos with how many; a PDF's page; another file as a page with a paperclip; a video as a screen with play.
  Under it the name with its kind's icon, then where it is and who touched it last ("From Team standup · Kofi, 10:12"): a
  card inside a workspace doesn't say which again. Pressing it opens it beside the tree, in the workspace it lives in, with
  the tree open to it (`DocumentBeside` from `features/workspace/Beside.tsx`: the workspace's own page for it, without its
  list); ⤢ in its head takes it full screen. Its ⋯ has Open, Open full screen, Copy link, Rename (the name typed in the same
  menu; a document's title follows) and Move to Trash, with Undo. A document or a board never moves between workspaces from
  here.
- **New** offers Document, Board, Upload files and Workspace. Where you are says where it goes; on Recent, Shared with you
  or Trash the same menu asks which workspace, the ones you can make things in first, then the latest calls', then New
  workspace, named in place. Files are picked first, then where they go.
- **First day:** the tree is Recent, Shared with you, Workspaces with New workspace under it, and Trash; the sheet is one
  empty state, Nothing here yet, with New document, New board and Upload files, each asking for a workspace to put it in.
- **On a phone** the page scrolls as one, its sky going up behind the top bar. The tree becomes chips at the top of the
  sheet (Recent, Shared with you, Workspaces, From calls, Trash), and Workspaces and From calls are lists of their own. New
  sits beside the search. Cards go two across, and a document opens full screen, as there's no room beside anything.

## A workspace, full screen

`routes/_app/drive.$workspaceId*.tsx`, `features/workspace/` (`Frame.tsx`, `Side.tsx`, `Bar.tsx`, `Home.tsx`, `Origin.tsx`;
the editor and the rest of the workspace as in a call), `components/workspace/frame.tsx`, `styles/workspace.css` (`wf-`)
and `styles/workspace-editor.css`. Moment: `note`, on Home. Board: `Workspace.dc.html` (the Calls and Drive canvas).

Any workspace opens full screen in Alcove's own evening, not as a stock editor: a frame of its own in place of the app's
(`_app.tsx` gives way, keeping its guards and hosts), its side panel beside the page and one bar over the page. The Drive's
**Open full screen**, a card, and a call's **Open its workspace** (`?from=calls`) land here.

- **The side panel**, dark in both themes and full height, like the app's: the logo (Home); the switcher, with the
  workspace's mark (its first letter, or a call's camera in `sun-text` for a call's own workspace) and its menu (your
  workspaces, People, Rename, New workspace, named in place); Search (Find, ⌘K); then the rows, which are the list's own
  (menus, drags, renaming, keys). A workspace made by hand: Home (shaded while you're on it), **Pages** with + on its
  heading (the tree with folders), and **Calls** (each call kept in it, ↗ to its page). A call's own workspace has no Home:
  **The call, today ↗** first, **Made in the call** (**For the call** before it), then a series' **Earlier calls** by day,
  five, then N more. A row made in the last ten minutes says New in `sun-text`. At the foot, on a hairline: Trash, with a
  count only when something's in it, and who can open it beside the seal.
- **The bar**: ← Drive or ← Calls; the path (the workspace's name goes Home, then its folders, then the page in bold);
  Saved; who else is here, their faces and "Priya is here" (the words go under 1100px); Share (a secondary button); ⋯;
  leave full screen; and you. Leaving goes back where it was opened from: the Drive at this workspace, or Calls.
- **Home**: the workspace's name in Newsreader on the evening after sunset (`Horizon`, moment `note`, its clouds and chop
  left out), running up behind the bar, which stays clear until the page scrolls under it, and fading into the page. Then
  the line on what it's for (`WsAbout`: an admin presses it to write it in place, or "Say what this workspace is for"),
  its people (`WsPeopleLine`, which opens People), **Recently edited** as three large `FileCard`s (a document's first lines
  from the server's previews), and **Calls**: the next call kept here, for its organizer, then each one past, as `CallRow`s
  with no menu column and hairlines between. A column of 1000px, centred. With nothing in it, `WsEmpty`.
- **A page** is the editor at 780px: the title in Newsreader, then `WsDocMeta` (the call it came from as a chip that opens
  the call, or For the call before it; who made it; when it was last edited). Outside a call (here and beside the Drive's
  tree) the type is wider; @mentions are plain words in `focus`; to-dos tick in `focus`; dates sit on `sun-soft` in
  `sun-text`; a callout is on a `sun-text` hairline, not in a box; comments are a raised count in the margin, after the
  arches of the first two who commented (in a call it keeps its icon); a quote from a call is a hairline card saying who said
  it, in which call, with its ▶ `MomentChip`; other people's carets are in `focus`, each name a flag above the line (on a
  narrow page, just the caret), and yours has none.
- **On a phone** (860px and under) the side panel and the page take turns under the bar: the workspace's pages under ←
  Drive, and a page under ← and the workspace's name, which goes back to them. Share is in ⋯, and there's no leave full
  screen.
- **Beside the Drive's tree**, a document is `DocumentBeside` (`features/workspace/Beside.tsx`): the same page without the
  frame, its head with ⤢ to go full screen.

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
- **On a team** (`features/team/OnTeam.tsx`, the kit's `components/team-plan.tsx` and `styles/team-plan.css`): the team's
  name in the sky over how many are on it, and its people on the horizon, up to ten, each under their license, opening
  their popover as on a company's line (`PersonPop`). On the water, its people as rows (role and license on each:
  "Licensed until 12 Dec", "License ended", "Waiting for a license"), with Remove for the admin, asked in place under the
  row, and at their foot Leave team for a member or Delete team for the admin once nobody else is on it; then the notes
  made visible to the team, and the company page's groups and what's shared with them, which stay. Beside them, for the
  admin: Licenses (how many are left and who's waiting, Buy licenses, filled while someone waits, which opens checkout on
  Team, and buying one whenever it's needed) and invite links (Make an invite link, then Copy, and Make another). A member
  without a live license is told first, at the top of the water. Not on a team, a quiet Start a team row on a company's
  water opens checkout on Team (`features/team/StartTeam.tsx`).
  - The water is at most 1120px and centred under the team, though other pages run to `--page-max`: the TeamPlan board
    has it so, and it reads as one block under the line, while the page's title, search and you keep the page's width.
  - Where the admin's cards would squeeze the people (the page under 1000px, as at 1024 with the side panel open), they
    fold under the people, side by side, before the notes. On a phone they stand one under another there.
  - On a phone the line wraps, as the board's does, and never slides: its first row stands on the horizon and the rest
    on the water under it, the sun set off to the left.
- **Joining** (`/team/join#…`, `features/team/Join.tsx`) is one card on the team's evening: whose team it is and what
  joining gives you, Join (filled) and Not now; signed out, the ways in first, while the invite waits in the tab.
- Every number on the page is real: a group's calls are calls everyone in it was on. Someone on their own, with no
  company and no team, has no Team page: its address goes Home.
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
- **The water.** Every row on it has the same shape: a mark by kind, the words, and what's at its end in a fixed column.
  - **What your agents did**, with Only you see this and a lock, grouped by day, once an agent is connected. What agents
    did goes with them, so with none connected it has nothing to hold and isn't there. Each row is a mark tinted by what
    was done, a sentence with what it was about as a link, a quiet second line, and the time in a fixed column. Reading is
    neutral; a booked call takes `sun-text`, a follow-up `horizon` and a decision `rose`. Show more continues it. With
    nothing in it yet, it's one row where the first will be (`AgentNone`): an empty dashed window for its mark, Nothing
    yet, and what will show there ("What Claude reads and changes in Alcove shows here, newest first."), never a drawing
    in the middle of the column. While it looks, dots stand in the mark's place; if it doesn't load, the mark is
    `caution`, with Try again at the row's end.
  - **Ask your agent**, beside it (seven parts to five), or on the first day the whole water, two across: four things to
    ask, each with the mark of the row it will make in what your agents did, and copy. Once an agent is connected, a line
    under each says which can do it (with a tick), or what they can't ("Claude can’t book calls").
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
    how long. "Only you" shows when nobody else has it. "In Calls" sits on the heading, opening In the room.
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
  notes, Audio and video, Notifications, Connections, Plan, Privacy. At 1000px and narrower it becomes a strip
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
- **Plan says what you have, then what you pay with.** The first panel: the plan row (Free or Pro with its help, See plans
  quiet and Get Pro or Extend secondary, filled only when notes have stopped (run out, or over Free's storage) or Pro is
  ending), Notes left this period with
  a `SunLine` on the row's own hairline (the sun at the end in a fresh period and moving back as it's used), Storage saying
  what's used of the limit ("2.1 GB of 10 GB", in caution once it's over), and More notes on Free (or on any plan once notes
  are low or out). The AI allowance is kept in dollars and never
  shown: notes left is said as time, as an estimate, with a small "About" before the number. Over the plan's storage, one
  `SettingNote` says until when everything works as before, or that uploads and notes have stopped, with Make room at its end
  (its `action`, under its words on a phone), which opens the Drive. Once they've stopped, the way out is the filled button:
  Get Pro on Free, beside which Make room is secondary, and Make room on Pro or a team, unless Extend (Pro ending) or Buy
  licenses (someone waiting) already is. Pro renewed and Pro ended are `SettingNote`s with × at the top until dismissed, and
  so is a workspace whose payment moved to you because whoever paid left it: by the name you see it by (read from your
  workspaces, never kept with the plan), and the day its files start to count against your storage; ending is said once, in
  warm, in the plan row. The second panel: Balance with Add money, then on Pro
  Renew from balance and Refund. Add money opens a window over Settings (`features/settings/topup.tsx`, the kit's `Sheet`:
  560px, centred over the veiled page, and the width of a phone from its top), a small checkout of its own that shares
  checkout's paying flow: how much and the network, Get an address, then the payment followed with checkout's own parts and
  words (`features/plans/paying.tsx`: the status, the amount to send, the deposit address with its QR code and bold ends,
  the track), with Cancel payment while nothing has arrived, and Done; a payment's Open in Payments opens it again on that
  payment. Renew says, in caution, why it won't renew when it won't, as the server decides it (`pro.renewal`): the balance
  short of a month, or a month costing more than the last did ("A month of Pro costs $24.00 now, more than your last did, so
  it won't renew by itself. Extend to keep it at that price."). Refund asks in place: what goes back, that renewing turns off
  (while it's on), and that Pro ends with the month running now, with Keep them filled (the answer that loses nothing), as a
  team's Refund of its licenses asks. Then Payments (`SettingPayments`, `PaymentRow`): first what's on its way or needs a person, then
  the balance's latest changes, each with Receipt opening `PaymentReceipt`, paper in both themes and alone on the page when
  printed. Buying is checkout's, never this page's. Controls drop under their words on a phone. The code is
  `features/settings/Plan.tsx`, with `features/plans/plan-state.ts`, which the side panel's foot and Plans share.
- **Sign out** signs you out at once. Only when recordings haven't uploaded does it ask first: the sky grows to hold the
  question, it says they'll be deleted, and Stay signed in is the filled answer. Signing out (from here or your menu), the
  page holds until the welcome page replaces it in one step, rather than blanking or emptying first.
- **Delete account** sits apart, in its own panel at the end, and opens in place, with what goes beside what stays. The
  shared demo account can't be deleted, and says so.

## Plans

`routes/_app/plans.tsx`, `features/plans/Plans.tsx`, `components/plans.tsx`, `styles/plans.css` (`pl-`). Moment: `plans`.
Board: `plans/Plans.dc.html`.

The last of the sunset, with the plans on the water: a page you compare on, so mostly water.
- **The sky.** Plans at the top left, search and you at the right. In the middle, Monthly / Yearly · 20% off, Yearly to
  start, only while a year costs less. Under it, the last sliver of the sun, which the page draws on the evening
  (`PlanSunset`, through `Evening`'s `sky`) behind whatever passes through. The horizon is 8px + 262px; on a phone it's
  300px and the sky runs up behind the top bar.
- **The plans** (`PlanCards`, `PlanCard`): light cards whose parts share rows through subgrid, so the names, prices, bill
  lines, buttons and facts line up. Each is at most a third of 1120px, so Free and Pro stand together in the middle, and a
  third card joins when Team is offered. Pro is lifted: raised, a firmer edge, a 2px warm edge on top. A warm chip marks the
  plan you're on (never Free, whose button area says it) or "Ends in N days".
- **One filled button:** Get Pro on Free, Extend only while Pro is ending. Both open checkout over the page. On a team
  license Pro isn't sold: its card says "Not while you’re on your team’s plan", quietly, where the button would be.
- **Team's card:** licenses at $40 a person for 30 days (from the offers), its people at the end of its name's row, its facts
  and its last line. The Yearly switch doesn't change it. Its button is secondary: Start a team, or Buy licenses for its
  admin; a member gets a quiet line saying who buys them. While the prices wait, three waiting cards.
- **Under them:** On every plan, as chips, and the paying line with its wallet.
- **States:** waiting cards, failed with Try again, offline. On a phone the cards stand one under another.
- While you're here, the side panel's plan row is the place you're on: Free's row (Free plan · See plans), Pro's or Team's,
  or a payment's.
- **The first time** (the plan choice, `features/plans/PlanChoice.tsx`): Home opens on Plans once, in its place, while the
  server says the plans haven't been shown (`Plan.choose`): every new account, after its arrival, and once every account from
  before plans. Its head is a short title in the page's own type (`dusk-title`) with one line under it (`pl-lede`), in place
  of Plans: "Choose a plan" and how the plans differ for someone with no notes yet, "Alcove has plans now" and which one
  they're on for someone who has used Alcove. The head and the sky are one block down to the horizon (`pl-lead`), so the
  switch keeps its place over the sun however long the line. The plan you're on leads straight on, quiet, on its card
  (Continue on Free, there even while the prices wait, and beside Try again or offline); Get Pro stays the one filled button,
  and checkout opens over it as it does on Plans. Home follows once something bought is yours and checkout has closed.
  Where it shows is decided in one place, `features/plans/choice.ts`: Home only, never over a deep link, and never twice in a
  tab. Once the plans have been on screen there, or on Plans, the server is told. The tour of Home waits for Home. A new
  account's arrival says "Opening Plans" and opens onto it; signing in from the welcome page sails out of the cove onto it, the
  sun easing down to the plans' last sliver (`PlanSunset` marks its sun `data-sun`, which the sail lands on).

## Checkout

`features/plans/checkout.tsx` (who opens it, and with what), `features/plans/CheckoutHost.tsx` (the window, from choosing to
bought), `features/plans/purchase.ts`, `components/checkout.tsx`, `styles/checkout.css` (`ck-`). Boards:
`plans/Checkout.dc.html`, `plans/PayMotion.dc.html`.

One window over any page, a call included, where it opens in your own theme: at most 944×672, the step on the left and what
you're buying on the right, under its own small evening (`PlanWindow`) whose sun rises as the payment lands.
- **Steps:** Choose, Pay, Done (`CheckoutSteps`). Choose is the lengths (`MonthsPicker`, with its 20% off bracket) or the
  hours (`HoursPicker`), then the network (`NetworkPicker`) only when money is needed; Pay is the status, the amount to send,
  the address with its QR code and the track (`PayStatus`, `PayAmount`, `PayAddress`, `PayTrack`); Done draws its tick
  (`CheckoutDone`), with the receipt (`PaymentReceipt`) in the same window, as paper.
- **One filled button per view:** Get the address, or Buy with your balance; on a phone while paying, Open in wallet.
  Cancel payment asks in the foot (`CheckoutAsk`), with Keep waiting filled, while nothing has arrived. Once part of the
  payment has (Less than asked arrived), the foot has Close alone, though the board's has Cancel payment beside it: the server
  cancels only a payment nothing has reached yet (`deposits.ts` › `cancel`; docs/engineering/plans-and-usage.md, Cancelling
  a top-up), and refuses the rest. What arrived is added to the balance when the payment settles, whether or not the rest
  comes, so there's nothing to cancel: the address waits for the rest until it closes.
- **Closing from Done**, however it's closed, says once in a toast on the page under it what was bought, in the server's
  dates: "You’re on Pro until 4 Nov 2027.", "Pro runs to 10 Nov 2027.", "10 hours of notes added.", "Vandelay Industries is
  on Team.", "6 licenses added to Vandelay Industries.". Not over a call, where notes coming on again say it.
- **Motion** is one move a stage, transform and opacity only: waiting, the sun on its horizon and its glow breathing; seen,
  the sun lifts and the amount counts up; done, it clears the horizon and the sky warms. With reduced motion every stage
  shows at once and only the dots and glints fade.
- **Team:** Start a team names it first (`TeamName`, the company's name to start with); Buy licenses shows the team's
  people and who's waiting (`LicensesLeft`). Both choose with `LicensesPicker` (3, 6, 10 or 25, each saying what it's for,
  and Another number). The summary is Team's window with people on its horizon, and each license runs 30 days from when
  it's taken. The team is made only as you pay, and the app tells Alcove you're here as soon as the licenses are bought, so
  the admin's own license is taken at once. Done has inviting under the receipt (`CheckoutDone`'s `invite`, a bare
  `TeamInvite`) and no renewal reminder. Someone on another's team (a member, or an admin who stopped being one) has nothing
  to buy here: the window has no steps (`CheckoutPanel`'s `step` is null) and says it once, in one note, who buys the
  licenses, after what became of a payment that couldn't buy them (its money is in the balance), with Close.
- **On a phone** it fills the screen, with what you're buying in one line at the top. Its foot keeps only the buttons, but
  offline, why the button waits ("You're offline…") is said on a line over them, as it is beside them on a wider screen.

## Connecting an agent

`routes/connect.tsx`, `AgentConsentFrame` in `components/agents.tsx`, `styles/agents.css` (`ac-agent-`). Where an agent
sends you to let it in, with its request. Signed in, it hands over to Agents at once (`/agents?request=…`, in its place),
and Agents asks on its sky (see [Agents](#agents)). Signed out, it's one quiet sheet on the theme's ground with the mark
above it: Sign in to connect your agent and the ways in, and then Agents asks. No request, and checking the sign-in or
failing to, use the same sheet. Storybook records its states under **Pages / Connect an agent**, and the journeys under
**Journeys / 14 Agent access**; it has no board of its own on the canvas.


## Starting and scheduling a call

`features/calls/flow/` (Start a call) and `features/calls/scheduling/` (the scheduler, on the Calls page),
`styles/flow.css` (`cf-` the modal, `sc-` the scheduler, `cw-` the week), with the lobby and ringing in
`styles/ringing.css` (`rg-`). Designed in the Calls and Drive spec
([§2](../superpowers/specs/2026-11-12-calls-and-drive-design.md#2-scheduling)).

Start a call is one small modal with one question, and a sheet on a phone.
- It opens on Start now (↵) or Schedule for later (S). Starting floods the screen into the night of the call.
- With no notes left this period and notes on, a caution note sits under the ways ("No notes left until 20 November", Get
  Pro, Start without notes). Get Pro opens checkout in the modal's place, since no window opens over another, and the modal
  comes back as it was, with its people, documents and board, once checkout closes. In the scheduler a line under the Notes
  switch says the same, with Get Pro or more hours, for a call that starts before they come back (`NoNotesLeft`).
- Ringing someone puts a card on their screen on any page, over a modal if one is open.

Scheduling isn't in a window. It takes the Calls page's rail, and the sheet becomes the week.
- **The scheduler** is a column where the rail was: ← Calls, the name large in Newsreader and ready to type over, then Who,
  When and Details, each a small heading over a hairline. Who is a field of tokens (an arch, a first name, ×) with the
  people to add listed under it. When is one line on who's free, three times as cards, the time picked as it will read
  with its start and end to type, the lengths, and how it repeats, opening in place. Details is the Notes switch, what
  the notes keep opening under it, and Bring's chips.
- **The foot** holds the column's bottom: what will happen, then the one filled button, which says what it does
  (Schedule, Schedule 6 calls, Send Jonas the times, Move to tomorrow 15:30, Ask to move it to tomorrow 15:30). Moving a
  call, Cancel this call sits above it in caution and asks in place.
- **The week** (`CallsWeek`, `components/calls-week.tsx`) fills the sheet: Monday to Sunday, 08:00 to 19:00, the weekend
  narrow and the hours outside the working day greyed. Your own things are dimmed, other people's busy time is hatched
  (never what it is), the suggested times glow in sun, the call being made is solid sun with a grip on its end, and where
  a call is now is dashed. A line under the heading says whose busy time is shaded, and a key under the week names each
  mark. The Calls page's Week is the same component, browsing.
- **Letting a guest pick**, the cards become tick boxes, each with the guest's own time. **Moving a call**, the title
  says Move, the old time is struck through under it, and who's on it are tokens to read, each with their answer.
  **Proposing another time** is the same, for asking.
- **On a phone** it's one column with no week, and the foot sits above the tabs.

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
  The pill says the state once, in a word: Live with a `rec` dot, Paused, Off, Unavailable or Stopped in caution, or the
  organizer's 2 asked in rose. Stopped by the organizer's plan, a caution bar between the head and the tabs says so, with
  the organizer's ways to more (Get Pro filled, Add 10 hours) and nothing to buy for anyone else; the notes mark where they
  stopped and came back on, in `rec`. It opens the card the sign at the top left opens, what's captured: one sentence, the asks,
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
  pause sign, or off, and that the notes, or what was written, come when it ends. Stopped by the organizer's plan, the line
  says so in caution instead of off ("Your notes for this period have run out. What was said until then is in the
  notes.", or whose, or storage full), and the organizer has the call's ways to more under it (Get Pro, more hours, Make
  room), none filled, from `PlanStop.tsx`. Without notes, it says none were taken.
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
- **Plans** looks out of a cove of its own (seed 8) on the plans moment, the last of the sun on its horizon: Free and Pro as small
  cards on the water, Pro raised with a warm edge, then Start free and Get Pro, which signs in and opens Plans with checkout
  on Pro. Both are secondary, though the Doors board fills Get Pro: the page's one filled button is its way in, and the last
  ask's Continue with Google comes into view with them as the page scrolls on. Its prices are kept beside it, since the
  server's offers need a session.
- **The last ask** is morning on the same sea, in a cove of its own (seed 11): the sun comes up as the page reaches it.
  The footer sits on the water.
- **Signing in sails out of the cove to Home.** Every way in on the page keeps where the hero's cove stands on screen as
  it's pressed (`lib/sailOut.ts`), across the trip to Google and back, and Home plays it once as it opens (`SailOut`,
  `features/home/SailOut.tsx`), in about three and a half seconds (onto the plans instead while they're up in Home's place,
  whose sun is the last sliver, so the sun eases down to it):
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

## A new account's way in: the arrival and the tour

`features/onboarding/` (`Arrival.tsx`, `Tour.tsx` and `art.tsx`), with `TourDialog` in `components/guidance.tsx` and
`styles/onboarding.css` (`cr-` for the account being created, `ta-` for the tour's art). Canvas:
[onboarding](canvas/onboarding/README.md).

- **The arrival** is always night. One arch draws itself, dawn fills it and the sun rises while what came with the account
  arrives a row at a time, each with a check: who signed in, the calendar, the team (or Invite them from Team), and notes
  written in confidential compute. Then "You're in", and the arch opens into Home. The night comes up whole over the
  welcome page before Home loads behind it, so Home is first seen through the opening arch, never through the night.
- **The tour** is one card, 400px wide with a 180px dawn sky at its top, that travels to the real thing on Home. The page
  dims around a cut-out of the target, a ring in `sun` marks it, and an arrow is drawn from the card once it arrives. Under
  640px the card is a sheet along the bottom, standing above the tab bar when it points at it. Each slide is one loop on the
  sky, a title in Newsreader, one line, the step dots, Skip tour and the one filled button, which names the next stop.
- **Its stops follow the app**: Start now and Schedule, the call Home offers when one is about to start, the example note
  (Calls once there are notes), Search or ask, the Drive, Record, Agents (not on a phone), and back at Start now. A stop
  whose target isn't on screen is left out, and nothing is drawn onto the page for the tour.
- **The art** is night on the dawn sky whatever the theme, with the example calls' cast, and you where it's about you.
  Each loop runs a few seconds on one clock and holds a finished frame with reduced motion.

## Not yet on the canvas

These screens follow the same rules but have no section here and no board yet:
- the join screen (`routes/join.$code.tsx`) and the organizer's lobby
- a guest picking a time (`features/calls/scheduling/PickTime.tsx`)
- sign-in's other ways in, on the join and move pages (`features/welcome/WaysIn.tsx`)
- moving a call to another device (`routes/move.tsx`)
- the offline page (`features/shell/OfflinePage.tsx`)

Redesign one the way the pages above were, with a board and its journeys (see [canvas.md](canvas.md)).
