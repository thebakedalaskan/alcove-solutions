# Scheduling a call, rethought: design

The design the scheduler on the Calls page is rebuilt from. It was approved on the design canvas "Scheduling a call"
(claude.ai/artifact/EnNRt8bDU2ApeujxvZxZU8, version 10) after seven rounds with the owner, and its boards are copied into
[docs/design/canvas/scheduling/](../../design/canvas/scheduling/). The canvas is the visual reference (every state and
journey, on made-up data); this document is the reference for behaviour. Where they differ, this document wins: it keeps
everything the scheduler did before that the canvas doesn't draw (moving a call, proposing a time, Meet again, repeats,
what the notes keep, bringing documents, no calendar, a failed save).

## Why

Testers called the scheduler "a complete disaster". Their nine complaints, and the rule that answers each:

| # | What testers said | The rule now |
|---|---|---|
| 1 | The calendar always says "Today". List the days shown instead, e.g. "Nov 9 – Nov 15". | The week's heading is its days, as the app writes dates (day before month): "9 – 15 Nov", "30 Nov – 6 Dec". **Today** shows only once you've moved off this week. |
| 2 | The calendar is frozen until you add people. | The week works from the start: a time is already picked, and pressing or dragging anywhere moves it, with nobody in. |
| 3 | Suggested times are random. Remove them when pick is off; default to the soonest available slot. | No suggested times. The call opens on the soonest free half hour (see [Times](#times)) and follows the people you add until you pick a time yourself. A clash offers **Next free** instead. |
| 4 | In pick mode, select a time by pressing the main part of its widget; the toggle stays separate. | Each offered time is a row: pressing its body makes it the active one; its tick is its own button. |
| 5 | Pick should be off by default. | **Let Jonas pick the time** starts off. |
| 6 | Pick mode is broken: times re-sort, the selection jumps, a new time resets. | Offered times are numbered 1 to 3 and never re-sorted or replaced. The active one stays active until you press another, and the week moves only the active one. Each keeps the time it was given. |
| 7 | A short block shows the names and cuts off the time. Time first, with a buffer at the bottom. | Every block shows its time first: the range when it fits on a line, else the start; a name only when a whole line of it fits; padding at the foot so nothing is cut. |
| 8 | Pressing a new start changes the length (12:00–14:00, press 13:00 → 13:00–14:00). | Pressing anywhere, even inside the call, moves its start and keeps its length (13:00–15:00). Only the end, the grip and the lengths change a length. A call ends on the day it starts: past midnight it stops at 24:00, says so, and gets its length back when moved earlier. |
| 9 | The hours stretch (8–19, then 19–20 when you pick 18:30). Make it a scroll box: 08:00–18:00 by default, scroll to 00:00 and to 23:00 with 23:30 pressable. | The day is a scroll box of all 24 hours that opens on 08:00 to 18:00 (ten hours fill its height). It never grows. Scrolling reaches 00:00 and 24:00, so 23:30 can be pressed. |

Later rounds added: put the call on **any day, any week**, as calendar apps do (drag it sideways, or hold it at the week's
edge to carry it into the next); make it look like the best calendar apps (one sheet, the week filling it, the call's
editor beside it); give the editor two clear edges and one kind of row; leave room between its sections; and say less.

## Layout

While scheduling, the Calls page's sky keeps only its title (no search, no Schedule a call), and one sheet fills the rest
of the page: **the week** on the left, **the editor** on the right (356px; 316px under 1100px wide), on the same surface,
with a hairline between them. Nothing else scrolls but the week's hours and, when it has to, the editor's body.

On a phone (under 860px) there's no week: the editor is the page, one column, its foot pinned above the tabs. Every time
can still be set from the editor's own controls (the day's month, the start and end lists).

## The week

`CallsWeek` (`packages/ui/src/components/calls-week.tsx`, styles in `styles/calls-week.css`, `cw-`) draws both the
Calls page's week (browsing) and the week you schedule on. The canvas's `wx-` styles (sched.css) are its look.

**Its head** (`CallsWeekHead`): the days it shows in Newsreader ("12 – 18 Nov"; across months "30 Nov – 6 Dec"; across
years "28 Dec 2026 – 3 Jan 2027"), then ‹ and › ("The week before", "The week after"), **Today** between them only when
the week shown isn't the current one, and whatever the page puts at the end (List and Week on Calls). No sub-line.

**Which days.** Browsing: Monday to Sunday. Scheduling: seven days from today ("12 – 18 Nov" on a Thursday), so every day
on it can take the call; › goes seven days on, ‹ can't go before today. Every day is as wide as the others (the weekend is
no narrower). With less than about 392px for the days it shows only Monday to Friday of those seven. On a phone, browsing
shows today and the next two days.

**The hours.** A scroll box holding 00:00 to 24:00. Ten hours fill its height (an hour's height is the box's height less
the day row, over ten, measured as the box resizes), and it opens scrolled to 08:00, so 08:00 to 18:00 is what you see
first. It never grows to fit anything. The day row (weekday and date, today's date in a filled sun-text circle) stays at
the top as the hours scroll. Hour labels sit in a gutter on the left. Now is a sun-text tag in the gutter ("11:10") and a
line across today with a dot at its start.

**Blocks** (your calls and meetings, and in browsing everything the week has today: past calls, Alcove calls, the
calendar's meetings, invitations, holds, a call just scheduled):
- Time first: "10:30 – 11:30" when the range fits on one line (about 64px at 11px), else "10:30"; a name under it only
  when a whole line of it fits, clamped to the lines there's room for; a block too short for a line shows its start
  small, and a sliver shows nothing. Padding at the bottom so text never touches the edge.
- Overlapping blocks stand side by side in lanes, never on top of each other.
- Finished ones fade. Browsing, the kinds keep their marks (past filled, Alcove calls a sun edge, the calendar's
  meetings outlined, an invitation dashed in rose, a hold dashed, a call just scheduled lit, a rose diamond or blue dot
  for what waits on you) and the key under the week names them. Scheduling, your own blocks are neutral and there's no
  key: only the call is coloured.

**Scheduling, the week also draws:**
- The hours outside 09:00–17:00 on weekdays, and the weekend all day, faintly greyed.
- Everyone else's busy time, merged into hatched bands, each labelled with whose it is ("Priya, Kofi") at the first spot
  in it no block covers. Never what it is.
- The past under a veil (below the blocks), so it reads as gone.
- **The call**: a solid sun block, "11:30 – 12:15" with its name under it when there's room, a grip along its bottom
  edge, and a caution ring when it clashes. Moving a call, where it is now is a dashed block ("Now 10:00").
- **Letting a guest pick**: the offered times as numbered blocks, 1 to 3. The active one is solid with its grip; the
  others are outlined; one left out is dashed and faded.
- Pointing at a free half hour (with a mouse) shows a dashed outline of the call there, its time, and who's free
  ("All 3 free", "Kofi busy", "Free on your calendar").
- When the call is above or below what's in view, a pill at the top or bottom of the box says where ("↑ 07:00 – 07:45")
  and scrolls to it when pressed.

**Pressing and dragging, scheduling** (a press is a pointer that moves less than about 5px):
- **Press** any free time, or anywhere inside the call: the call starts at that half hour and keeps its length.
- **Drag the call's body**: it follows the pointer to any time on any day, in quarter hours, and lands where it's let go.
  Held at the left or right edge of the days (about 18px) for 650ms, the week turns back or on and keeps turning every
  650ms while it's held; the call goes with it. Never into the past.
- **Drag the grip**: the end moves in quarter hours, at least a quarter hour after the start, at most 24:00.
- **Drag across free time** (starting outside the call): the call takes that stretch, in quarter hours, at least 15
  minutes.
- **Letting a guest pick**: pressing an offered time that isn't active makes it active (it doesn't move); pressing or
  dragging anywhere else moves the active one.
- While dragging, the call follows the pointer exactly; once let go it glides to its place (about 160ms; still with
  reduced motion).
- A finger scrolls the week; it doesn't drag (pressing still moves the call).

**Browsing**, pressing a call opens it; pressing a free time, or dragging across one, starts scheduling there (as now).

**From the keyboard**: every half hour is a button, reached with the arrow keys (one tab stop), Home and End for the
day's first and last. Enter or Space moves the call there (browsing: starts scheduling there). Shift with ↑ or ↓, on the
call's first half hour, moves its end a quarter hour. Each half hour's label says the day, the time and who's free; a
status line tells a screen reader where the call went and where it ends.

**When the call moves from outside the week** (the day's month, the start list, Next free, a re-picked soonest time),
the week turns to its week and scrolls it into view.

## The editor

The kit's scheduler parts (`packages/ui/src/components/scheduler.tsx`, styles in `styles/scheduler.css`, `sc-`) draw
it; the canvas's `ce-` styles (sched.css) are its look. A property list with two edges: the outer edge holds the kicker,
the title, the hairlines and the foot; the inner edge is where every value starts. Each row is an icon in an 18px column
and its value; a row that carries on the one above (a status, a note) has no icon and starts on the inner edge. Anything
pressable keeps its text on the edge and lets its hover reach 10px past it. Sections are 18px apart with a hairline.

Top to bottom:

1. **The top**, pinned: the kicker (**New call**, **Move a call**, **Ask to move a call**) and × ("Close, back to Calls").
2. **The title**, Newsreader 24px. A new call: an input, "Add a title" while empty, named "Call with Priya and Kofi" as
   people are added until you type your own; Enter schedules. Moving or asking: the call's name, fixed, and once the time
   has changed, "Was Thu 5 Nov, 10:00 – 10:45", struck through, under it.
3. **Who** (people icon): one field of tokens (an arch, a first name, ×), "Add people", then "Add someone" once someone's
   in. Pressing or typing opens the people under it as a popover: **Often with you** (on your own, **People you've met**),
   then **Add someone else**, then **People and groups** while typing. Rows have a centred 40px face column (a group shows
   two of its faces; its line says how many), the name, what they do or their address, and +. Everything `PeopleField`
   does stays: groups, the company, a pasted list as one token, flags for what a paste couldn't read, Backspace twice,
   the 300-person limit. Moving or asking, the people are fixed tokens with their answers.
   - **One guest from outside**, whose calendar can't be read: a switch, **Let Jonas pick the time**, with "You can't see
     Jonas's calendar." under its title, inside it (one hover, one focus ring). Off by default. Their token says where
     they are once you've said: pressing the place on it ("Where?" until then) lists the places (`places.ts`), and the
     offered times then say "12:30 for Jonas".
   - **Several people, some from outside**: a line under the field, "You can't see Jonas's calendar." ("the calendars of
     Jonas and Ines" for more).
4. **When**, one time:
   - **The day** (calendar icon): "Thu 12 Nov" with "Today" or "Tomorrow" quietly after it and a chevron. It opens a month
     (`MonthGrid`): Monday first, days gone greyed, today marked, the call's day filled. A day picked keeps the clock time;
     if that time has gone, the call goes to the next half hour at least 10 minutes off.
   - **The time** (clock icon): the start, a dash, the end, and the length quietly after them ("45 min"). The start and
     end can be typed, as now (24-hour, to 5 minutes, Enter or leaving the field), and pressing one opens its list in
     quarter hours, scrolled to the one picked: starts from 00:00 to 23:45, those gone greyed; ends from a quarter hour
     after the start to 24:00, each with the length it makes ("1 h 30 min"). A start keeps the length; an end sets it. An
     end can't pass midnight.
   - **A status line**, under the time, only when it says something: once people whose calendars you can see are in
     ("The soonest time you're all free", then once you've picked one yourself "You're all free", with ", outside working
     hours" when it is), or on a clash, in caution ("Priya is busy then", "You have Design review then"), with **Next free:
     16:00** ("Next free: Fri 10:00" on another day) in horizon, which moves the call there. Moving a call that someone has
     asked to move: "Aiko asked for Fri 11:00" with **Move it there**. While calendars are read: "Reading calendars…".
   - "It stops at midnight: a call ends on the day it starts." under the time, when it does.
   - **How it repeats** (repeat icon): "Doesn't repeat" or "Every Thursday · 4 calls", quiet, with a chevron. It opens a
     menu: Doesn't repeat, Every Thursday, Every 2 weeks on Thursday, Every month on the first Thursday, Days you pick (the
     day letters, in place), and Ends after [4] calls once it repeats. Moving a series' later calls, it can't be turned off.
   - Moving a call in a series, **This call** and **This and later calls** sit at the top of When.
   - With no calendar connected: "Only your Alcove calls are known without a calendar." with **Connect Google Calendar**
     (opens Google in a new tab, keeps the draft).
5. **When**, letting a guest pick:
   - The offered times as rows (calendar icon on the first): a number in a circle, the day ("Today", "Tomorrow", "Mon 16
     Nov"), the time "11:30 – 12:15", and at the end "12:30 for Jonas" (once you've said where Jonas is) or, when it clashes
     with something of yours, a caution mark and its name; then the tick. The active row has a sun ring and tint, its
     number filled. A row left out is struck through and faded. Two at least stay ticked ("Offer at least two times").
   - "Press the week to move time 2." under them.
   - The length (clock icon): "45 min each", opening the lengths (30 min, 45 min, 1 h, 1 h 30 min, 2 h, and the current
     one). One length for all of them.
6. **Details**:
   - **Notes** (notes icon, in rec while on): a switch; its tooltip says "Everyone invited gets the notes". While on,
     **What the notes keep** (quiet, with a chevron) opens in place: Keep the transcript, Keep the recording, Read shared
     screens and Where they go, each a switch row with its line inside, then the sealed line (confidential compute, or
     the model outside a secure enclave). The no-notes-left door (`NoNotesLeftDoor`) sits under Notes as now.
   - **Everyone joins muted**, past 25 people, on.
   - **Add an agenda** (document icon): opens the library (Bring's search and list, as now) as a popover; what's picked is
     listed under it, each with ×, up to 12.
7. **The foot**, after the content (pinned to the bottom when the editor has to scroll): one line on what will happen,
   then **Cancel** (quiet, closes) and the one filled button. Lines: "You'll get a link to share." / "Google Calendar
   invites Priya and Kofi." / "Priya and Kofi get an invitation." / "Without a calendar, nobody is told. Share the link
   yourself." / "Your calendar holds the times until Jonas picks." / "You get a link to send to Jonas." / moving, "Google
   Calendar tells Ines and Aiko." or "Nobody else is invited." / asking, "Kofi sees it, and can move the call there."
   Buttons: **Schedule**, **Schedule 4 calls**, **Send Jonas the times**, **Move to tomorrow 15:30** (**Move** until the
   time changes), **Ask to move it to tomorrow 15:30** (**Ask to move it** until then). Moving, **Cancel this call** sits in
   the foot in caution and asks once, in place. A failed save stays above the foot with its reference.

Only one popover is open at a time; Escape or pressing outside closes it, and focus goes back to what opened it.

## Times

All in `features/calls/scheduling/times.ts`, from what `useTimes` reads (your calendar and Alcove calls, and the calendars
of the people invited that can be read, 15 days ahead):

- **The soonest free half hour**: the first time on the hour or half hour, at least 10 minutes from now, on a weekday,
  from 09:00 with the call over by 17:00 (local), when you and everyone whose calendar can be read are free. If nothing in
  15 days suits everyone, the soonest you're free; failing that, the next working half hour.
- **A new call** opens on it, and moves to the new soonest time whenever who's invited changes or the calendars are read,
  until you set a time or a length yourself (the week, the day, the start or end, the lengths, Next free). From then on
  it stays where you put it.
- **Next free**, on a clash: the soonest free half hour from the clashing time on, for everyone the clash is about.
- **Letting a guest pick** turns on with three times: the time you had, then the same time on each of the next two
  weekdays you're free then (or the soonest you're free that day). Off again, the call keeps the active time. Adding or
  removing someone while picking turns picking off the same way.
- **The length**: 45 minutes to start. A call ends on the day it starts: a time whose end would pass 24:00 stops there,
  and the length it should have is kept, so moving it earlier gives it back. 5 minutes to 10 hours, as the server allows.
- **Moving or asking**: the scheduler opens with the call where it is. Nothing moves until you move it.

## Kept, as it was

Everything in docs/product/user-flows.md flow 4 that this document doesn't change: the ways in (Schedule a call, Home,
Team, Start a call's Schedule for later, dragging on Calls' week, Meet again, Change the time, Propose another time),
the address (`/calls?schedule=new|move|again`, who never in it), toasts and Undo, holds on Google Calendar for offered
times, the one-guest rule for picking, the 300-person limit, a call that can't move (started, offering, gone), and the
error that stays above the foot.

## Gone

The three time cards (`TimeCard`, `TimeCardWaiting`, `TimeCards`) and suggested times on the week; the week's growing
hours; a typed end that runs into the next day; the scheduler column on the left with its section headings; ← Calls (×
and Cancel close it); the week's sub-line and "This week" heading; the narrow weekend.
