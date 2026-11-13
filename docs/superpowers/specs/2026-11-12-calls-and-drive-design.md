# Calls, a call, the Drive and a workspace: design

The design these four screens are built from. It was approved on the design canvas "Calls and Drive"
(claude.ai/artifact/LU2x4qNX6CFpVXkCqtyfDu, version 24), after three rounds of independent design review and research on
how Notion, Google Drive, Google Calendar, Outlook, Calendly, Fantastical, Granola, Fathom, Otter and Meet handle the same
jobs. The canvas source (every state and journey, with the made-up data) is the visual reference; this document is the
reference for behaviour.

## Why

Notes and the Drive were "a very weird experience" that "looks awful". A call has notes and makes files, so Notes becomes
**Calls**: the place for everything about calls, past and future, with the calendar connected and scheduling built in.
Opening a call shows everything about that call. The Drive keeps every workspace, and any workspace opens full screen in
Alcove's own evening, not as stock Notion.

Things the owner rejected along the way, which must not come back:

- people filter chips under the search; a per-row mini timeline of the call
- file names and attachments on Calls rows (rows show only what waits on you: "1 to confirm", "1 follow-up")
- made-up example rows in an empty list; explaining sentences inside a tree
- a split view of the list beside the whole call; calls as cards
- "Move to a workspace" (every call already has its own workspace)
- scheduling in a small stepped window with rows of time chips
- the play controls above the video (they sit under it)

## 1. Calls

`/calls`. The Drive's frame: the page title and the search on a short sky, **Schedule a call** (the page's one filled
button), and a split below: a rail on the left, a sheet on the right.

**The rail**
- All calls; Coming up, with how many; Past calls, with In the room and Shared with you nested under it.
- Series: each call that repeats, with its next call ("Thu 09:00").
- At the foot, Google Calendar and "Connected", opening Settings at Google Calendar. With no calendar connected the foot
  is empty, and a line at the top of the list offers **Connect**. No sentences inside the rail.

**All calls** (the default): later today and tomorrow, then **Show N more coming up** under the last row (it opens Coming
up), then past calls by day (Earlier today, Yesterday, Earlier this week, Last week).

**Coming up**: Waiting for a time first (a call whose guest is picking), then each day (Later today, Tomorrow, then the
date). Alcove calls and, with Google Calendar connected, the meetings with someone else on them. A List / Week switch sits
at the sheet's top right; Week keeps Coming up lit in the rail.

**A row ahead**: faces (an outlined calendar arch for a calendar meeting, a clock arch for one waiting for a time); the
name, and its series or "From your calendar · Google Meet"; who's on it ("Ines, Aiko and you"); then only what matters:
- an invitation to you: "Kofi invited you" in rose, and **Yes / Maybe / No** as three equal buttons; once answered,
  "You're going · Change"
- a request to move: "Aiko asks to move it to 11:00" in rose, with **Move it** and **Keep 10:00**
- other people's answers, quietly ("Aiko hasn't answered")
- "No notes" only on a call that won't write notes
- the time (sun-text) and the length; and a **⋯** menu in a fixed column

**Row menus**
- your call: Change the time, Copy link, Cancel this call
- your call in a series: Change the time (asks this call or this and later ones), Skip this one, Copy link, Cancel the
  series
- an invitation: Propose another time, Copy link
- a calendar meeting: Open in Google Calendar, Use Alcove instead
- a call waiting for a guest: Copy the link for Jonas, Cancel this call
- a past call: Meet again (opens scheduling with the same people and name), Share the notes

**Past rows**: as today's list (faces, name, tag, gist, chips only for what waits on you, time and length), opening the
call. The gist is the same one the call's page leads with, and never states a decision that still waits to be confirmed.

**Week**: Monday to Sunday, 08:00 to 19:00, weekdays wide and the weekend narrow. Past calls filled; Alcove calls ahead
with a sun edge; calendar meetings outlined; an invitation dashed in rose; times held for a guest dashed; a rose diamond
on a past call with a decision to confirm, a blue dot for a follow-up. The sun on a line marks now. Last week, Today, Next
week. A key under it. On a phone it shows today and the next two days. Pressing a past call opens it; dragging across a
free time starts scheduling at that time.

**A series**: its name, how it repeats and how many calls; Change the series; Next (the next call's row); So far (rows
led by their date, not the repeated name), with All N calls; and What carries over (still-open questions and follow-ups,
each with its moment chip).

**Search and Ask** stay as #273 built them; a name ("Priya") lists calls with them, coming up first.

**Empty and first day**: one empty state on the sheet: the dashed arch, "No calls yet", one line, **Connect Google
Calendar** and **Start a call now**. No made-up rows.

**Phone**: the rail becomes chips (All, Coming up, Past, Series); List / Week as icons; Schedule is the top bar's +.

## 2. Scheduling

On the Calls page, not in a window. **Schedule a call** (or Schedule for later in Start a call, or dragging on the week,
or Meet again, or Change the time) swaps the rail for the scheduler, and the sheet becomes the week.

**The scheduler, top to bottom**
- ← Calls (closes it, keeping nothing)
- the name, large (Newsreader), ready to type over: "Call with Priya and Kofi" once people are in
- **Who**: a field of tokens (arch, first name, ×) and "Add people, a group or an email". With nobody yet, Often with
  you lists people and groups (Leads, Product); after the first person, **Add someone else** brings the list back without
  the people already in. Groups add everyone in them. An outside guest's token says where they are ("Berlin, 1 h
  ahead"), and a line says their calendar can't be read.
- **When**: one line on who's free ("All 3 of you are free at these times", "You and Priya are both free…"); three
  suggested times as cards, soonest first on different days, the best one picked; the picked time as it will read
  ("Tomorrow, 11:00 – 11:45") with its start and end to type; 30 min / 45 min / 1 h; **Doesn't repeat**, which opens in
  place (Every Thursday, Every 2 weeks on Thursday, Every month on the first Thursday, Days you pick; Ends after N calls).
- **Details**: Notes (a switch; "Everyone invited gets them"), and Bring (an agenda or documents, added as chips).
- The foot: what will happen ("Google Calendar invites Priya and Kofi.") and **Schedule**. With nobody yet the button is
  dimmed and the line says "Add who it's with, or skip that and share a link".

**The week while scheduling**: your own calls dimmed; other people's busy time as hatching, never what it is (the key
names whose: "Priya and Kofi busy"); hours outside the working day greyed; the suggested times glowing in sun; the call
being made as a solid sun block with a grip to drag its end; pointing at a free time shows "15:30 · All 3 free", and
pressing it picks it. The sheet's line under "This week" says whose busy time is shaded.

**Let a guest pick** (someone outside the company): the cards become ticks (all three ticked), each with the guest's own
time ("12:00 for Jonas"); **Let Jonas pick** is on; the button reads **Send Jonas the times** and the foot says the times
are held on your calendar until he picks, and the others clear then. The call then waits in Coming up under Waiting for
a time, and the held times show dashed on the week.

**No calendar**: the When line is replaced by a note (open working hours; Connect Google Calendar), and the foot says
nobody is told without a calendar, so share the link.

**Move a call** (Change the time on your call): "Move Hiring sync", "Was tomorrow, 10:00 – 10:45" struck through; Who as
read-only tokens with their answers ("Going", "No answer yet"); When as above; the week shows where it is now dashed and
where it's going solid; **Move to tomorrow 15:30**; "Google Calendar tells Ines and Aiko."; Cancel this call (caution)
at the foot.

**After**: the scheduler closes, the week (or list) shows the call marked "Just scheduled", and a toast says what
happened, with Undo.

**Phone**: the scheduler fills the screen as one column (no week), and the foot with Schedule stays pinned above the tabs.

## 3. A call

`/calls/<id>`. Its title (Newsreader) and one meta line: when; faces and names; the series (a link to it); "Written in
confidential compute". Share, Download (an icon opening a menu) and More at the top right. Below, two halves.

**Left: the player** (it never scrolls)
- The stage, always night: people in their arches with whoever is speaking lit, and the words as a caption; when a
  screen was shared at that moment, the screen plays there with whose it is and the speaker small in the corner. A room
  recording shows a microphone arch. Captions hide while the Transcript tab is open.
- Under the stage, the line: play, the time, the chapter you're in above the line, the chapters as lengths, decisions as
  rose diamonds on the line, follow-ups as blue dots just under it, a shared screen as a tinted length of the line, the
  sun as the playhead; then the end time, speed, captions and full screen.
- **Shared and made in this call**: each shared screen (with its moment and length), then what the call made (documents,
  boards, files), with **Open its workspace**.

**Right: tabs** — Notes, Transcript, Your notes (and Shared, below 1100px wide, where the player's cards move into a tab)
- **Notes**: a one-line gist; **For you** (exactly what the Calls row promised: a decision to confirm with **Confirm** /
  It wasn't decided; a follow-up suggested for you with **I'll do it** / Not mine; or "Nothing from this call is waiting on
  you"); then Decided, Follow-ups (suggested ones marked with a blue dot until someone takes them; taken ones a tick box)
  and Still open, each item once with who and a ▶ moment chip; Propose a decision and Add a follow-up; then How it went
  (each chapter with its ▶ chip, a sentence, the shared screen or breakout rooms, each room's gist).
- **Transcript**: Find in the transcript and its own download; grouped by chapter; the line playing highlighted; From
  the start; breakout rooms say which room you were in and name the others.
- **Your notes**: only you; what you wrote and bookmarked, each with its moment.
- **Ask about this call** at the foot, marked Only you.

Every ▶ chip plays that moment on the stage without changing the tab. Confirming or taking a follow-up says so in a toast
with Undo.

**Download**: The transcript (text, with times), The notes, The recording (audio), and each shared screen; "Opened on
this device. Alcove can't read it."

**Before a call**: the stage shows who's invited in arches with their answers ("Accepted", "Invited", "Organizer") and
"Join shows here five minutes before it starts"; under it the call's link with **Copy link**; on the right the agenda
(empty: Add an agenda, New board, Upload) and Notes ("On, written in confidential compute. Only Ines, Aiko and you can
open them.").

**Narrow and phone**: one column: the stage, the line, then the tabs (with Shared).

## 4. The Drive

As the canvas's Drive (which the owner liked): the search on the sky and New; a tree (Recent, Shared with you,
Workspaces with neutral marks, From calls, Trash) beside a sheet of large previews. A workspace shows its folders, its
calls and its files, with **Open full screen**; a call's own workspace shows what it made. Documents open beside the
tree, with ⤢ to go full screen. Previews never cut words mid-way (ellipsis), and a file inside a workspace doesn't repeat
"In Launch". First day: Recent, Shared with you, Workspaces with **+ New workspace**, Trash, and one empty state. At
1024px the search shrinks rather than sliding under New.

## 5. A workspace, full screen

- A dark side panel in both themes, full height, like the app's: the Alcove logo, the workspace switcher, Search, Home,
  Pages (tree with folders), Calls, Trash (a count only when something is in it), and "Priya, Kofi, Ines and you can open
  it" at the foot.
- A top bar: ← Drive or ← Calls, the path, Saved, who else is here ("Priya is here"), Share, More, leave full screen,
  and you at the far right.
- **Home**: the workspace's name on the after-sunset evening, running up behind the top bar and fading into the page;
  one line on what it's for; its people; Recently edited (large previews); its calls as Calls rows.
- **A call's own workspace has no home**: it opens on what the call made, with the call ("The call, today ↗") as the side
  panel's first row, then Made in the call, then Earlier standups for a series.
- **A document**: title (Newsreader); From <call> as a chip; who edited; @mentions as plain coloured text; to-dos with real
  ticks and dates; callouts on a hairline; comments in the margin; quotes from a call with who said it, in which call, and
  a ▶ chip; other people's carets in the focus colour with their name; your own caret with no name.
- **Phone**: one column; back goes to the workspace's pages (← Launch).

## Rules that apply everywhere

Colour by meaning (rose a decision or something waiting on you, horizon a follow-up or information, sun-text time,
`rec` notes and recording, caution a problem; no green). One filled button per view. Each fact once. People in arches.
Newsreader only for page titles and a workspace's name. Sentence case. Light and dark, phone to 1920. Every list has a
designed empty state. Made-up people only.
