# Home, under the horizon: widgets

The design for Home's lower half, decided 12 November 2026. The canvas it was drawn on is copied in at
[docs/design/canvas/home](../../design/canvas/home/README.md): `water.css` has the measurements, `water.js` every state and journey.
Where this document and the canvas differ, this document wins.

## Why

Home's top half (the sunset, Start a call) is right. Everything under the horizon was not: For you was a panel of busy tiles,
the calendar card was a paragraph in a box, Recent notes and Coming up were thin lists in boxes, the first day was pastel
tiles beside empty boxes, and connecting Google Calendar opened a modal on a blank page. Two other directions were rejected
(three hairline columns: too much text; one quiet centred group: didn't look good). This one follows how the big apps build a
home: Notion's widgets (a calendar widget whose unconnected state is one Connect button, My tasks, a row of recently visited
cards), Granola and Zoom leading with the next few meetings, Asana's tabbed tasks, and Miro's thumbnails of your own work.

## The sky

Unchanged, except: **the row of people to ring under Start now and Schedule is gone** (it showed the first three teammates
on Alcove, whoever came first in your meeting invites, with no way to see the rest). Ringing someone starts from Team or from
Start a call. Home's loader stops prefetching the team for it.

## The water: three widgets

`For you` (7 parts) beside `Upcoming` (5 parts), then `Recent notes` across the width, 20px apart, starting where Home's grid
starts now (72px under the horizon). At 1320px and narrower they stack: For you, Upcoming, Recent notes. On a phone the tabs
sit on their own line under the title, rows drop the faces and the ×, and the note cards scroll sideways.

A widget is one card: `surface`, 20px radius, a `line` ring and a soft shadow; a 56px head (a 28px icon tile, the title
in 15px semibold, then whatever the head holds); the body; and, only when a list is longer than it shows, a 48px foot with
Show N more.

### For you

- **Head:** the inbox icon, For you, a hairline, then two tabs: **To answer** and **Follow-ups**, each with a count pill
  (rose under To answer, horizon under Follow-ups, while that tab is on; neutral otherwise). The tab you're on has a 2px ink
  line along the head's foot. They're a real tablist. It opens on To answer when anything's there, else Follow-ups when
  anything's there, else To answer. The side panel's Home count is unchanged.
- **To answer** keeps every behaviour Home has now (`features/home/Waiting.tsx`): decisions, disputed decisions on your own
  notes, follow-ups the notes suggest are yours or someone gave you or changed, and notes shared with you this past week, newest
  first, answered in place with Undo. Only the look changes. Each row is one grid: the kind in a 28px circle (a rose diamond for
  a decision, a dashed horizon box for a follow-up that isn't yours yet, a warm share icon for shared notes); the words, 14.5px,
  up to two lines, opening the note at the moment they were said; the faces of whoever was on the call (a microphone arch for a
  room recording), 20px, in a fixed column; and the answer in a fixed column at the right: a tinted pill (Confirm, Keep it
  confirmed, I'll do it, Read) and the × beside it (Read keeps the ×'s room so the pills line up). There's no moment chip, no
  "Proposed by the notes" line and no "What was said" chip on the row; the source call's title is the row's tooltip. What
  backs a decision or follow-up and what to be careful of (`Backing`, `EvidenceFlags`) still matter: keep them reachable from the
  row in a compact form (for instance a small mark after the words that shows them on hover and focus), never as a second line
  of text. Answered, a row stays where it is: its words go to `ink-2`, its circle to an outline, and the answer column says what
  happened in a word or two (Confirmed, Not decided, Disputed, In your follow-ups, Not yours) with Undo, or It's mine.
  The first five, then Show N more.
- **Follow-ups** keeps every behaviour of `features/home/FollowUps.tsx` (due words, ticking, saving, rollback). Each row: the
  box to tick, the words in one line (opening the moment), the call it came from in `ink-2`, and the day at the right
  (Today in `sun-text`, late in `caution`). The first five, then Show N more.
- **Empty states,** in the middle of the body:
  - Before any notes, To answer: a small drawing of rows not filled in yet (a rose diamond, a dashed box, bars, pills, on a
    faint panel; `fy-art` in `water.css`), **Nothing to answer yet**, "Decisions to confirm and follow-ups from your calls show
    up here."
  - Before any notes, Follow-ups: the same drawing with boxes to tick, **No follow-ups yet**, "What you take on shows up here,
    with when it's due."
  - While the first notes are being written: **Nothing to answer yet**, "<Call>'s notes are being written."
  - To answer empty but follow-ups waiting: **Nothing to answer**, "Your follow-ups are in the next tab."
  - Nothing at all: Home's small sunset (`hw-calm`), **You're all caught up**, "New ones show up after your calls."
- There is no Get started any more: the first day is these empty states. Read an example note moves to Recent notes; Invite
  your team stays on the Team page.

### Upcoming

- **Head:** the calendar icon, Upcoming, and at the right a quiet icon button to Settings › Calendar.
- **Body,** by day: a 52px date block (the day in 12px, Today in `sun-text`, then the date's number in 22px tabular) beside that
  day's calls. Today, then the next six days by weekday, then later days by date; a call still waiting for a time to be picked
  goes last, under **Soon**.
- **Each row:** the time (44px, tabular, `ink-2`); the title in one line; under it, a calendar mark for a meeting from your
  calendar (not an Alcove call), or a clock and "Jamie is picking a time", then up to three faces at 16px. At the right, only
  what needs saying: **In 4 min** in `sun-text` in the call's last minutes and **Now** while it's going; **Answer** (a rose pill)
  for an invitation you haven't answered; **Use Alcove** (a line button with the camera) for a calendar meeting you organized.
  Pressing an Alcove call opens its card, as now; pressing a calendar meeting opens its menu (Use Alcove instead, Open in Google
  Calendar, What carries over), as now. A call just scheduled, or meetings just connected, rise in once. The first five, then
  Show N more. Blocks with nobody else on them never show, as now.
- **Not connected** (`calendar.needsAccess`) and nothing to show: a small drawing of a week (three days, tinted blocks;
  `up-art`), **See what's coming up**, "Your meetings with other people show here.", **Connect Google Calendar** (a line
  button with the calendar mark) and, small in `ink-3`, "Alcove reads your events and adds the calls you schedule." The button
  goes straight to Google (`calendarConnectUrl({ back: '/home' })`). With Alcove calls already ahead, they show, and
  the connect is a row at the foot instead: a dashed calendar circle, "See your other meetings here", Connect.
- **Back from Google,** Home reads `?calendar=` and then drops it from the address: connected shows a toast ("Google Calendar
  is connected.") and the meetings rise in; denied, the wrong account or a failure show in Upcoming's body instead of the
  connect: a caution circle, **Google didn't allow the calendar** / **Choose the Google account you signed in with** /
  **Google Calendar couldn't be connected**, "Calls still work without it.", and Try again.
- **No Google account** (`source: 'none'`): only Alcove calls, no connect. The demo account's sample calendar shows as a
  calendar. Connected with nothing in the next week: "Nothing in the next 7 days."

### Recent notes

- **Head,** with no card: the notes icon tile and Recent notes; View all at the right, to Notes.
- **A sideways row of cards** (at least 196px each, 14px apart, scrolling sideways, no scrollbar): a 96px cover, each note's own
  small sunset (a sky, a sun on a sea band, two glints) picked from its id like `coverFor`; the people's faces (28px, up to two)
  standing on the cover's lower edge, or a microphone arch for a room recording; the title in up to two lines; when and how long
  ("Today · 14 min"). A note being written says Being written with the moving dots, and its cover breathes slowly. Up to eight.
- **The first day:** the example note's card (an Example tag on its cover; `data-tour="notes-example"`, so the tour still
  points at it; it opens `/notes/example`), then a dashed card, "Notes from your calls land here".

## Connecting Google Calendar

The page that explained Calendar access before Google (`/connect-calendar`, `CalendarConsent`) is gone. Everywhere that linked to
it goes straight to Google: Home's Upcoming (back to Home), Settings › Connections (back to Settings, as now), scheduling's
Details and a series' What carries over (back to Settings, in a new tab where they open one now). Settings' row says the same
one line as Home under its Connect.

- `CalendarApi.connectUrl({ back: '/home' })`, shaped like `signInUrl`'s `{ next: '/move' }`: `/auth/google?consent=1&back=%2Fhome`.
- The API's consent start reads `back=/home`; the Google attempt carries it (`back: '/home'`, optional, so an attempt made by the
  previous release still lands on Settings); every way back (`backToCalendar`) goes to `/home?calendar=<result>` for Home, and
  to `/settings?calendar=<result>#calendar` otherwise. Integration tests in `flows.integration.test.ts` cover Home connected,
  Home cancelled and the existing Settings cases.

## Storybook and docs

- `stories/pages/Home.stories.tsx`: every scenario redrawn by the new Home, plus new ones for the Follow-ups tab, all caught
  up, back from Google connected and denied, and a calendar meeting's Use Alcove. Anything about the people row goes.
- `stories/journeys/03-home.stories.tsx`: Ring someone goes; Move a meeting uses Use Alcove; Clear what's waiting and Tick off a
  follow-up use the tabs; Your first day connects the calendar. Numbered as `docs/product/user-flows.md`.
- `stories/pages/Settings.stories.tsx`: the Calendar consent stories go.
- `docs/design/pages.md` (Home), `docs/product/user-flows.md` (§3 Home, and Connections in Settings), `AGENTS.md` (any new
  `@alcove/ui` component).

## Unchanged

The side panel and its Up next, the palette, the scene and what passes through it, how answers are stored, the inbox and
calendar endpoints.
