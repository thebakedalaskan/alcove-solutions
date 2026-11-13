# User flows

[Docs home](../README.md) · [Product overview](overview.md)

Each flow below is implemented in `apps/web` and exercised end to end by the integration tests in
`apps/api/src/integration/flows.integration.test.ts` (API level) and by a real-browser check before release.

## 1. Sign in

1. Open Alcove. Signed out, the welcome page shows what Alcove does, as one evening on the app's own scene, looking out
   of a cove to sea at the top and at the bottom: the note a call leaves, with its call along the horizon; the call
   itself, a feature at a time, each looping while its step is the one being read (Documents and boards, Captions in
   your language, Set your status, Breakout rooms, A quiet nudge, Private messages and threads, Arrange it your way);
   finding a time with your team; your agent using Alcove; recording in the room without a connection; and what Alcove
   can see. Each scene plays while it's on screen, and shows a still with reduced motion. Choose **Continue with Google**
   at the top or bottom of the page. Local development and Storybook also show the Microsoft and single sign-on demo
   options. The footer links to the public **Privacy policy**, available without signing in.
2. **Google** opens its account chooser in a popup, keeping Alcove open. It shares the account's name, email address
   and profile. Calendar and Drive access are optional and have their own consent screens. Alcove says **Waiting for Google…**,
   with **Cancel sign-in** to stop waiting,
   including when the popup was closed. On success the popup closes, the waiting tab checks its session, and the welcome
   page fades into the app. If the browser blocks popups or can't pass the result between tabs, Google opens in the current
   tab instead. New accounts use a Gmail or Google Workspace address. Existing accounts can still sign in.
   If Google sign-in fails, the welcome screen says why.
3. The first time, the account is created on screen, in about six seconds: an arch draws itself, dawn fills
   it and the sun rises, while what came with the account arrives a row at a time, each with a check. **Signed
   in as** the name, with the provider's mark (a key for single sign-on). **Your calendar**: how many calls are
   left today and which is next, from the connected or sample calendar (no row without calendar access). **Your
   team at** the company, with its size and faces, when it has people in it and has arrived by then (the screen
   doesn't wait for it), with who already uses Alcove, or **Invite them from Team** while nobody does. **Notes are
   written in confidential compute**, and only the people invited to a call get its notes. Then
   "You’re in" and the arch opens into Home, where the plans to choose from come first, once (16.20): the screen says
   "Opening Plans" then, and "Opening Home" when Home is next. **Skip**,
   **Escape** or **Enter** opens it straight away; with
   reduced motion the finished screen shows for a moment and Home follows. After that, signing in goes
   straight to Home. From the welcome page it sails out of the cove: the headlands go by, the horizon comes up to
   Home's, the side panel and the page's frame form round the sea, and Home rises in, in about three and a half
   seconds (a press, a key or the wheel ends it at once; with reduced motion Home just opens). While the plans haven't
   been shown, it sails onto them in Home's place instead, the sun sinking to their last sliver (16.20).
4. On first arriving in Home (past the plans), a tour goes through it, one stop at a time: a card with a short animation on the dawn sky,
   and the page dimmed around the real thing the stop is about, with a ring round it and an arrow to it. **Start or
   schedule a call** (Start now and Schedule, on Home's sky); **Join a call** (the line on Home that offers an Alcove
   call, only while it does, from its last few minutes); **Notes for your calls** (the example note's card in Recent
   notes before there are any notes, then Calls; it says they're written in confidential compute); **Search or ask** (at
   the top right, or the search button in the phone's top bar); **Documents and boards** (Drive, in the side panel or the tab bar); **Record in the room** (Record); **Bring your
   agent** (Agents, at the foot of the side panel; a phone has no Agents in its tab bar, so the stop is left out); and
   **You’re ready** (Start now and Schedule again). Any stop whose target isn't on screen is left out. Shortcuts (**N**,
   **J**, **⌘K** or **Ctrl K**) are named only where there's a keyboard. The card's button names the next stop (**Show me notes**,
   **Show me the call**, **Show me search**, **Show me the Drive**, **Show me recording**, **Show me agents**, **Back to
   the start**), and the last is **Start using Alcove**. The card moves beside its target, or along the bottom on a phone,
   standing above the tab bar when it points at it; **←**/**→** and **Enter** move through it and **Escape** or **Skip
   tour** closes it. A toast says it can be taken again from your menu. It isn't shown again on that browser for that
   account; **Take the tour** in your menu (flow 2) or in Settings (flow 11) plays it again.

The first sign-in creates the account: its keys, a profile with the name, email and photo from the sign-in,
the notes default (on) and the Free plan, with all of its notes for the period. Later sign-ins bring the name, email and photo up to date. In local
development and Storybook, Microsoft signs in Art Vandelay (art@vandelay.industries), and SSO signs in
whoever's email was typed, with a name made from the address, as long as it's an address no real person can
have (at example.com or another domain reserved for examples, or at vandelay.industries). These demo accounts get a sample day of
five calls whenever nothing is coming up at sign-in, the first about 12 minutes later.

A session lasts until sign-out, 14 days without use, or 30 days in all; then the app goes back to the welcome
screen. Signing in on another browser doesn't end the first session.

## 2. The side panel

Beside every page, dark in both themes, in two groups: your work at the top, and who works with you at the foot.

- **Start a call** (or **N**) opens flow 4.
- **Home**, **Calls** (flow 8), **Drive**, every workspace, where you write together (flow 12), and **Record**, where
  recording in the room starts (flow 9). A count beside a place says something is waiting on you there: on Home, what's
  for you; in the Drive, tags you haven't seen; on Record, recordings on this device waiting to upload. Nothing counts a
  total, such as every call or everyone on Team.
- **Pinned**, under them, once you've pinned a note: the notes you pinned, in the order you pinned them, up to 8. A pinned
  note that was deleted, or that you removed from your notes, isn't listed. A call's page pins its notes; the pin at the end
  of the heading, which shows while you point at Pinned, opens the palette to pick notes to pin or unpin, and with 8 pinned
  it says to unpin one first. With nothing pinned there's no Pinned at all.
- At the foot, **Team** (flow 10), where your groups are, and **Agents** (flow 14). Someone on their own, at a personal
  address, has no Team page, and still has Agents.
- Under them, on every page, while a call is going, or from 10 minutes before one with someone else on it until it ends:
  the call, when it starts (or **Happening now** once someone's in it), and **Join**. A meeting on your calendar is offered when it has a video link (unless **Show my
  other meetings on Home** is off). The rest of the day is on Home, under Upcoming. On Home it makes way while Home's own
  line offers the call (from 5 minutes before, and while it's going), so there's one **Join** at a time.
- At the bottom: the confidential-compute check (**Confidential compute · verified** when this browser's check of the
  server passed: its attestation token, and its release in Sigstore's public log, which the server hands over with it;
  pointing at it says when, or why the check didn't pass, beside a shield without its tick; a check that doesn't pass
  blocks nothing, and a server that can't be asked isn't verified: what an earlier check said doesn't stay), then your
  plan (16.7), in one row. On Free, about how much of the
  period's notes is left, "About 1 h 26 min of notes left" over a meter (warm under an hour, "No notes left until 1 Dec" in
  caution once they've stopped), which opens Settings at your plan. On Pro or Team, a row like the places: the plan's small
  sun, **Pro** and "Until 4 Nov 2027", opening Settings at your plan; once notes are low or out it says that instead ("About
  40 min of notes left", "No notes left until 1 Dec"). From a week before Pro ends without renewing, its sun is half set
  and it says "Ends in 6 days · Extend", which opens checkout. A payment for a plan on its way takes the row's place:
  "Waiting for 192 USDC", and **Pro, 12 months · Open**, which opens it again in checkout. "Pro renewed from your
  balance" or "Pro ended. Nothing was deleted." is one line above the row until it's dismissed in Settings. On Plans,
  Pro's or Team's row, or a payment's, is the place you're on.
- Offline, a notice at the top says recording still works and everything else catches up when you're back
  (with **Record without a connection** off, that recording waits for the connection too). The call about to start and
  the check wait until the connection returns. Alcove also opens offline for someone signed in on this browser:
  Record works, and every other page says it's offline, with **Record**.
- **Hide the side panel** gives the page the room; the button left in the top-left corner brings the panel
  back, and the offline notice moves to the top of the page meanwhile. This browser remembers which.

At the top right of every page: **Search or ask** (**⌘K** on a Mac, **Ctrl+K** elsewhere), which opens the palette
below, and you, which opens your menu (below). In a narrow window search shrinks to its magnifying glass. Notes has
its own search, so there's none at the top right, and the shortcut goes to the line in its sky (flow 8). In the workspace
the shortcut is **Find** (flow 12), and **Search or ask** stays at the top right without it.

On a phone (860 px wide or narrower) a top bar takes its place, with the brand, search (not on Notes), **Start a call** (a plus) and
you (your menu), and a tab bar runs along the bottom: **Home**, **Calls**, **Record** (raised), **Drive** and **Team**
when you're on one. Agents isn't in it: on a phone it opens from **Settings → Connections** (flow 11). Offline, the same
notice sits under the top bar.

**Your menu** opens under you, at the top right of every page but Settings (where you stand on the horizon instead), and
from the bottom as a sheet on a phone. At its top you stand on a small evening, with your name and address. Then:

- **Pause notifications** opens three lengths in place under it: **For 30 minutes**, **For 1 hour** and **Until
  tomorrow**, each with the time it ends (tomorrow at 9:00, in this computer's time zone). While paused, nothing reaches
  you from the browser or by sound, except your own microphone going on and off and requests to join a call you host;
  what shows on the page still shows. The row says **Paused until 17:12**, with **Resume**, and a small crossed-out bell
  sits on you at the top right until then, on every page and every device you're signed in on. It ends by itself.
- **Theme**: system, light or dark, as the three small evenings Settings shows. The page changes at once, the menu stays
  open, and this browser keeps it.
- **Settings** (flow 11) and **Take the tour** (the tour of Home again, flow 1), which close the menu. Settings is a link,
  so ⌘-click, Ctrl-click or the middle button opens it in a new tab and leaves the menu open.
- **Sign out**, which signs out at once, unless something on this device would be lost: then the menu asks in place, in
  Settings' words, with **Stay signed in** (focused), **Copy what you wrote** when something written is waiting, and **Sign
  out and delete them**. Everything Settings' **Sign out** does holds here too.

**Escape** steps back one thing at a time (the question, then the menu, focus back on you), and **↓** and **↑** move
between its rows. Storybook's journeys use these numbers: **2.9 Open your menu, then Settings**, **2.10 Pause
notifications for an hour**, **2.11 Change the theme from your menu**, **2.12 Sign out with recordings on this device**
and **2.13 Your menu on a phone**.

**The palette** is a solid window over the page, with the page dimmed behind it and never blurred. On a wide screen what's
lit in its list shows beside it; under 1100 px the list is alone, and on a phone it takes the screen, with **Cancel**.

- Before anything is typed it shows the five people you have most calls with and your five newest notes. Pressing
  someone shows everything they said.
- Typing finds what was said, not just the note. **Ask "…"** comes first, then the people whose names have the words,
  then every moment with them, call by call, newest call first: who said it, their words with the match marked, and the
  time. A line that a decision or follow-up rests on says **Decision** or **Follow-up**. A call shows two or three of its
  moments, and **N more** opens the rest in place; the list shows the eight newest calls. Notes that have the words only
  in their title, summary, decisions or follow-ups come after, five at most, and **See all N moments in Calls** (or
  notes), at the end of the list, opens Calls with the same words (flow 8), with every call that has them.
- **Enter** does what's lit: the first thing found, or **Ask** when what's typed reads as a question. **↑** and **↓**
  move it, the pointer too, and **Tab** asks about anything typed. **Enter** on someone puts them in the line, and what's
  typed then searches only what they said; **Backspace** on an empty line takes them out. With them in the line, the
  list ends with **Calls with Maya**, with no count: Calls lists the calls you're both on, with what's typed in its
  line, not only what they said. Someone who said nothing you can read (they were invited and stayed quiet, or their
  lines are the organizer's alone) says so: **Nothing Maya said is in your notes**, with **Calls with Maya**, which opens
  Calls with the calls you're both on.
- Beside the list: a moment in its transcript, a line before it and three after, with the decision or follow-up made
  there (one still waiting can be confirmed, or said not to be one, right there), **Open at 3:15** and, when the call
  kept its audio, **Play from 3:15**, which plays it from there once: going back to the note, or reloading it, opens it
  at that moment without playing; someone, with the last things they said, **What Maya said** and **Calls with
  Maya** (Notes, with only the notes you both have); a note's summary and what's open in it, with **Open notes**; or what
  Ask will do.
- Asking (flow 8) puts the answer in place of the list, one question at a time, written in confidential compute from
  your notes only, with the moments it comes from under it, each in its call. A moment opens its note there, not
  playing. **Escape** goes back to the results, and so does changing the question.
- When nothing has the words it says what was searched, with **Ask** lit. The first day, a search that didn't go through
  (**Try again**) and being offline each say so.
- **Escape**, or the shortcut again, closes the palette, and focus goes back where it was. It never opens over another
  window, such as Start a call, and nothing opens over it.

## 3. Home

Home is for starting a call and for what's yours. The page is a sunset: the sky meets the water behind **Start a
call**, and the rest sits on the water. It moves a little so it feels awake: the sun rises as the page opens and lifts
when you point at **Start now**, its glitter shimmers, the chop drifts and the clouds cross the sky on the wind. Once in a
while something passes through: gulls; a fish, a shoal, a flying fish, a marlin or dolphins leaping; a whale's tail far out; a
balloon in the corner; and, slowly along the horizon, boats and ships of six kinds, sometimes out there already when Home
opens. Every other page is a later moment of the same evening, with less sky the less it's about one action, and quieter
visitors: a boat far out, stars after dark and now and then a shooting star. With reduced motion on, it's a still picture and nothing passes through.

- The date, top left. On a phone or with the side panel hidden, a **Confidential compute** badge (with the time the
  hardware was verified when this browser could check it) shows on Home too, since the panel's check isn't there.
- **Start a call** (**Start your first call** before your first notes). **Start now** goes straight to the lobby
  (flow 5). **Schedule** opens the scheduler on the Calls page (flow 4). Nothing else sits under them: ringing someone
  starts from their arch on Team (flow 10), or from the lobby, which rings whoever you pick when you join (flow 5).
- While a call is going, or from 5 minutes before one with someone else on it, a line above **Start a call** names it
  with **Join** (**J**), and says when it starts or **Happening now**. It's the one time a call comes near the top: people
  join from their calendar. A call that's going comes first. A calendar meeting needs a video link to get this line, and
  its **Join** opens that link in a new tab. **Join** takes the filled button, and **Start now** gives it up. From 10
  minutes before until then, the call at the foot of the side panel offers **Join**, as on every page, and it makes way
  for this line while the line is there.
- **For you** holds what's yours in two tabs, **To answer** and **Follow-ups**, each with how many are open; the side
  panel's **Home** shows the two together. It opens on **To answer** when anything's there, else on **Follow-ups** when
  anything's there, else on **To answer**. Each tab shows its first five, then **Show N more**.
- **To answer**: what needs an answer from you, newest first, a row each with its kind, its words, the faces of whoever
  was on the call (a microphone for a room recording) and the answer at the right. A row's words open its note at the
  moment they were said, when the notes know it, and the call's name is the row's tooltip. What a decision or follow-up
  rests on, and anything to be careful of, open from a small mark after its words.
  - A **decision** proposed in any note you organized or were invited to that nobody has confirmed, by the notes or by
    someone else: **Confirm**, or **×** for it wasn't decided, each with **Undo**. On someone else's note, **×** says so
    for everyone and the organizer settles it, and it stops waiting on you. On your own notes, a decision someone
    confirmed and someone else says wasn't decided is yours to settle: **Keep it confirmed**, or **×**.
  - A **follow-up** the notes suggest is yours, that someone gave you or suggested, or that changed since you took it
    on: **I’ll do it**, which puts it in your follow-ups, or **×**, which leaves it with nobody (then **It’s mine**
    gives it back to you, taken on).
  - **Notes shared with you** in the last 7 days ("Aiko shared the notes from Board prep"): **Read** opens them.
  - What you answer stays where it is until you leave Home, saying what you did in a word or two: **Confirmed**, **Not
    decided**, **Disputed**, **In your follow-ups** or **Not yours**.
- **Follow-ups**: the ones you took on and haven't done, from every note you have, soonest first, with the rest after
  them. Each row has the box to tick, the words, the call it came from and when it's due. The due words count from when
  they were said: the last time the due date was changed, or else the call. A day ("today", "EOD", "tomorrow", "Friday",
  "Friday next week", "Nov 5") is that day, so "tomorrow" said yesterday is due today, and it says when ("Today", "Thu",
  "Fri 13 Nov"). A stretch of time ("this week", "next week", "in two weeks", "end of the month", "next month", "end of
  March", "Q1") is due when it ends, so "next week" said last Friday is this week, and it keeps the words. Words with no
  date ("ASAP", "later") show as they were said. Words go in the day's column when they fit; longer ones go after the
  call it came from, and on a phone, where the call isn't shown, in the day's place. A follow-up's words open its
  note, at the moment it was said when the notes know it. Ticking one crosses it out until you leave Home, and ticking
  it again puts it back. While a tick saves, its row says **Saving…**; if it can't be saved, the box goes back and a
  toast says why.
- With nothing in a tab, it says so, with a small drawing. Once notes are written and both tabs are empty: **You're all
  caught up** ("New ones show up after your calls."), under Home's small sunset, which shows only then. Otherwise the
  drawing is rows not filled in yet, with boxes to tick on **Follow-ups**. Before your first notes: **Nothing to answer
  yet** ("Decisions to confirm and follow-ups from your calls show up here.", or while they're being written, "Design
  sync's notes are being written.") and **No follow-ups yet** ("What you take on shows up here, with when it's due.").
  After them, with only the other tab holding anything: **Nothing to answer** ("Your follow-ups are in the next tab.")
  or **No follow-ups** ("What you take on shows up here, with when it's due.").
- **Upcoming**: every Alcove call ahead and, with Google Calendar connected, the meetings with someone else on them, by
  day: today, then the next six days by weekday, then later days by date. A call waiting for a guest to pick a time
  comes last, under **Soon**. Other people's calls are listed for the next 90 days. A series shows its next call only,
  and a calendar event that's a copy of a listed call isn't listed twice. With **Show my other meetings on Home** off
  (Settings), only Alcove calls count. The first five show, then **Show N more**. The button at the right of its heading
  opens Settings at **Google Calendar**.
- An event with nobody else on it isn't a call, so it isn't listed: the end of **Upcoming**'s foot counts them, with a
  small square of hatching ("2 with only you"). Pressing it shows them, in their days among the calls: one slim, quieter
  line each, the time, then the title after the hatch (the hatching scheduling's week gives the time you're busy), and no
  faces. A row opens the event in Google Calendar, in a new tab. While they show, eight rows come before **Show N more**,
  and the count stays pressed; pressing it again hides them. It's a preference, **Show my own events on Home** (Settings,
  under **Show my other meetings on Home**, and only while that's on), so it's the same wherever you're signed in.
- Each row has the time, the title and up to three faces, and a meeting from your calendar is marked as one. A call
  waiting for a guest says **Jamie is picking a time** (someone invited reads **A time is being picked**). At the right,
  only what needs saying: **In 4 min** in a call's last few minutes and **Now** while it's going (the call on offer
  above stays listed, so it can always be opened); **Answer** on a call you're invited to and haven't answered; and
  **Use Alcove** on a meeting you organized on your calendar.
- An Alcove call's row opens its page (flow 8, before a call), where someone invited answers, and where its series
  opens. A meeting from your calendar opens its menu, with what applies: **Use Alcove instead** when you organized it,
  **Open in Google Calendar** (in a new tab), and **What carries over** when it's in a series. **Use Alcove** on the
  row, or **Use Alcove instead** in the menu, makes the meeting an Alcove call: the calendar event gets the Alcove link,
  Google tells everyone on it, a toast says who gets the new link, and from then on its row opens its page. A call just
  scheduled, and meetings just connected, rise in once.
- Until Google Calendar is connected, **Upcoming** offers to connect it. With nothing to list it says **See what's
  coming up** ("Your meetings with other people show here."), with **Connect Google Calendar** and "Alcove reads your
  events and adds the calls you schedule." With Alcove calls to list, they show, and a row at its foot says **See your
  other meetings here**, with **Connect**. With **Show my other meetings on Home** off, neither promises meetings: both
  say "The calls you schedule go on your calendar." Either goes straight to Google, with no page in between. Google asks for
  access to the Google account you signed in with, then comes back to Home: connected, a toast says **Google Calendar is
  connected.** and your meetings rise in. When Google wasn't allowed, the account was a different one, or connecting
  failed, **Upcoming** says so in place of the connect (**Google didn't allow the calendar**, **Choose the Google
  account you signed in with**, or **Google Calendar couldn't be connected**), with "Calls still work without it." and
  **Try again**. Either way, Home then takes the result out of its address.
- Without a Google account there's nothing to connect, and **Upcoming** lists Alcove calls only. A demo account's sample
  calendar shows as a calendar. With nothing to list, **Upcoming** says why, over a small drawing of a week:
  - Connected, with only events of your own: **No meetings with other people in the next 7 days**, "12 events with only
    you on them aren't shown." and **Show them**, over a week of hatched blocks. **Show them** lists them, as the count
    at the foot does.
  - Connected, with nothing to list: **No calls or meetings in the next 7 days** ("Calls you schedule show up here."),
    over a week with empty days. It doesn't say the calendar is empty: all-day events, and Google's focus time and out
    of office, aren't read as meetings.
  - Without a calendar to read, or with **Show my other meetings on Home** off: **No calls in the next 7 days**.
- While the calendar is on its way, the Alcove calls ahead show, with "Your calendar is on its way" at the foot until it
  comes (with none, a placeholder). If it doesn't load, **Upcoming** says **Your calendar didn't load** with **Try
  again**: in place of the list when there's nothing else to list ("Calls still work without it."), otherwise in a row at
  its foot. With **Show my other meetings on Home** off, it neither waits for the calendar nor says it didn't load.
- **Recent notes**: your newest notes, up to eight, as a row of cards that scrolls sideways, with **View all** to
  Calls' past calls (flow 8). Each card has the note's own small sunset as its cover, the faces of the people on it (two at most; a
  microphone for a room recording), the title, and when and how long ("Today · 14 min"). A note still being written says
  **Being written**. A card opens its note.

**To answer** and **Follow-ups** come from the inbox (`GET /v1/notes/inbox`): the follow-ups for you that aren't done
(taken on, or only suggested); the decisions in written notes that nobody has confirmed or rejected and that you can
confirm, unless it's you who proposed one or said it wasn't decided; and, in notes you organized, confirmed decisions
someone disputes; newest note first. Follow-ups in notes someone else shared with you count; ones you removed don't.

Before your first notes, Home has no list of things to set up: **For you** says there's nothing to answer yet,
**Upcoming** offers **Connect Google Calendar** until a calendar is connected, and **Recent notes** has the example
note's card, marked **Example**, which opens the example note, then a dashed card: **Notes from your calls land here**.
Inviting your team is on the Team page (flow 10).

Storybook's journeys use these numbers: **3.1 Start a call now**, **3.2 Schedule a call**, **3.3 A call is about to
start**, **3.4 Move a meeting to Alcove**, **3.5 Clear what’s waiting**, **3.6 Tick off a follow-up**, **3.7 Your
first day**, **3.8 See your own events** and **3.9 A week of only your own events**.

## 4. Start or schedule a call

**Start a call** (or **N**, anywhere outside a call, the Drive, a text field or another window) opens a small modal. On a phone it's the plus in the top bar, and the modal
is a sheet from the bottom. It asks one thing: **Start now** (**Enter**) or **Schedule for later** (**S**). **Escape**
closes it, closing asks nothing, opening it again starts clean, and focus goes back where it was. A person or group on
the Team page opens it with them already picked. Whether someone is on a team or on their own comes from their
address, and nothing is a setting: on a team it says "Ring your team in, or share a link", on your own "Get a link to
send to anyone".

1. **Start now** creates the call and goes to the organizer's lobby, with anyone picked already there to ring. Night
   floods out from the card that was pressed. If the call can't be made, the modal stays and says why.
2. **Scheduling happens on the Calls page**, not in a window. **Schedule for later** closes the modal and opens it there
   with whoever was picked, and so do **Schedule a call** on Calls, **Schedule** and **+** on Home, **Schedule** in
   someone's popover on Team, pressing or dragging across a free time on the Calls page's week (it opens with that time,
   as long as the drag), **Meet again** on a past call (the same people and name), and **Change the time** on a call
   (step 11). The page's sky keeps only its title, and one sheet fills the rest of the page: the week on the left
   (step 6) and the call's editor beside it, which says at its top what it's doing (**New call**, **Move a call** or
   **Ask to move a call**). Its **×** (Close, back to Calls) and **Cancel** close it, keeping nothing; moving a call has
   only **×**, as **Cancel this call** is in its foot (step 11). What opens from the editor (the people to add, a month, a
   list of times, a menu) opens one at a time, under what opened it, and **Escape** or pressing outside closes it, with
   focus back where it was. The address says what it's doing (`/calls?schedule=new`, `move` or `again`); who it's with
   never goes in it.
3. **The name** is at the top, large: "Add a title" while it's empty, then "Call with Priya and Kofi" as people are
   added, until you type your own. Enter schedules.
4. **Who** is one field of tokens (an arch, a first name, ×): "Add people" while it's empty, "Add someone" after.
   Pressing it or typing opens the people under it: **Often with you** while nobody's in (on your own, **People you've
   met**), **Add someone else** after the first, without anyone already in, and **People and groups** while you type.
   Each row is a face (a group shows two of its faces, and its line says how many), the name, what they do or their
   address, and **+**. Typing finds people in the company directory, people from past calls, groups, and the whole
   company ("Everyone at Vandelay"; without a directory, "Everyone you meet at Harbourline"); on your own it's the
   people you've met and any address. A group adds everyone in it, each their own token. Pasting a list of addresses
   reads it at once: commas, semicolons, spaces and lines, `Name <address>` as mail programs write it, each address
   once. A list stays one token however long it is, and what can't be read is flagged one at a time with **Use it** when
   the list gives a fix away, or **Leave out**. Groups, the company and a list can overlap, and everyone counts once. On
   an empty field, Backspace selects the last token and a second Backspace removes it. A call can invite 300 people;
   past that it says so and waits, and a list is removed whole and pasted again shorter. When someone's calendar can't
   be read, it says so: for one guest from outside the company, inside **Let Jonas pick the time** (step 10), "You can't
   see Jonas's calendar."; among other people, in a line under the field ("You can't see the calendars of Jonas and
   Ines." for more than one). That one guest's token says where they are once you've said: pressing its place ("Where?"
   until then) lists the places. Nobody at all is fine: the call gets a link to share.
5. **When** is ready from the start. A new call opens on the soonest free half hour: the first time on the hour or half
   hour at least 10 minutes from now, on a weekday from 09:00 with the call over by 17:00 where you are, when you and
   everyone whose calendar can be read are free. If nothing in the next 15 days suits everyone it's the soonest you're
   free, and failing that the next working half hour. It moves to the new soonest time whenever who's invited changes or
   the calendars are read, until you set a time or a length yourself (on the week, the day, the start or end, the
   lengths, **Next free**); from then on it stays where you put it.
   - **The day**, "Thu 12 Nov" with "Today" or "Tomorrow" quietly after it, opens a month: Monday first, the days gone
     greyed, today marked and the call's day filled. A day picked keeps the clock time; if that time has gone, the call
     goes to the next half hour at least 10 minutes off.
   - **The time** is the start and the end, with how long it is quietly after them ("11:30 – 12:15 45 min"). The start
     and the end can be typed, as 24-hour times like every other time here (14:15, or 1415), to the nearest 5 minutes,
     and count once you leave the field or press Enter. Pressing one lists every quarter hour, scrolled to the one
     picked: starts from 00:00 to 23:45, those gone greyed, and ends from a quarter hour after the start to 24:00, each
     with the length it makes ("12:15, 45 min"). A start moves the call and keeps its length; an end sets the length,
     any from 5 minutes to 10 hours. A start that's gone, an end before the start, or a length past those limits says
     why under the time, and what was picked stays; so does anything a 24-hour clock doesn't say ("9", "2pm", "25:00"),
     with "Type a 24-hour time, like 14:15.", and a field left empty goes back to what was picked. A call starts at 45
     min, and ends on the day it starts: one whose end would pass midnight stops at 24:00 and says "It stops at
     midnight: a call ends on the day it starts.", keeping the length it should have, so moving it earlier gives it
     back.
   - **A line under the time** says what's true, only when there's something to say: "Reading calendars…" while they're
     read; with people whose calendars can be read, "The soonest time you're all free", or "You're all free" once you've
     picked the time yourself (with ", outside working hours" when it is). On a clash it says so in caution ("Priya is
     busy then", "You have Design review then"), with **Next free: 16:00** ("Next free: Fri 10:00" on another day), the
     soonest free half hour from then on for everyone the clash is about, which moves the call there.
   - **Doesn't repeat** opens a menu: Every Thursday, Every 2 weeks on Thursday, Every month on the first Thursday (a
     fifth one is "the last") or Days you pick, whose day letters open in place. Once it repeats, **Ends after 4 calls**
     counts once you leave the field or press Enter, and the row reads "Every Thursday · 4 calls". Repeats keep their
     clock time where you are when the clocks change, and one repeat is at most 60 calls.
   - With no calendar connected, the line is "Only your Alcove calls are known without a calendar." with **Connect
     Google Calendar**, which opens Google in a new tab (it comes back to Settings with the result) and keeps the draft.
6. **The week** shows seven days from today, so every day on it can take the call, each as wide as the others (with too
   little room, only the weekdays of those seven). Its heading is the days it shows ("12 – 18 Nov"; across months "30
   Nov – 6 Dec"); **›** goes seven days on, **‹** comes back but never before today, and **Today** shows beside them
   once you've moved off this week. The day is a scroll box of all 24 hours that opens on 08:00 to 18:00 and never
   grows: scrolling reaches 00:00 and 24:00, so 23:30 can be pressed, and the row of days stays at its top. Now is a tag
   in the hours ("11:10") and a line across today. The hours outside 09:00 to 17:00 on weekdays, and the weekend, are
   greyed, and the past is veiled. Your own calls and meetings are neutral blocks, so the call is the one thing in
   colour; everyone else's busy time is hatched and says whose it is ("Priya, Kofi"), never what it is. Every block says
   its time first, the range when it fits ("10:30 – 11:30") or else its start, and a name only when a whole line of it
   fits; blocks that overlap stand side by side. The call is solid, "11:30 – 12:15" with its name under it when there's
   room, a grip along its bottom edge, and a caution ring when it clashes.
   - Pointing at a free time shows the call there in outline, with its time and who's free ("All 3 free", "Kofi busy",
     "Free on your calendar"). Pressing anywhere, a free time or the call itself, moves its start to that half hour and
     keeps its length: 12:00 – 14:00 pressed at 13:00 is 13:00 – 15:00.
   - Dragging the call takes it to any time on any day, a quarter hour at a time, and it lands where it's let go. Held
     at the left or right edge of the days, the week turns back or on, and keeps turning while it's held, taking the
     call with it; never into the past.
   - The grip drags the end a quarter hour at a time, at least a quarter hour after the start and at most 24:00.
     Dragging across free time gives the call that stretch, 15 minutes at least.
   - When the call is above or below the hours in view, a pill at the top or bottom says where it is ("↑ 07:00 – 07:45")
     and scrolls to it. When the call moves from the editor (the day's month, the start list, **Next free**, a new
     soonest time), the week turns to it and scrolls it into view.
   - A finger scrolls the week rather than dragging the call; a press still moves it.
   - Every half hour can be reached with the arrow keys, as one tab stop, with Home and End for the day's first and
     last. Enter or Space moves the call there, and Shift with ↑ or ↓ on its first half hour moves its end a quarter
     hour. Each half hour says the day, the time and who's free ("Thursday 12 November, 14:00, All 3 free"), and a
     screen reader hears where the call went and where it ends.

   On a phone there's no week: the editor is the page, one column, with its foot above the tabs, and every time can be
   set from its own controls (the day's month, the start and end lists).
7. **Details**: **Notes** is a switch (its tooltip says "Everyone invited gets the notes"), and while it's on **What the
   notes keep** opens in place under it: **Keep the transcript** (without it, it's used to write the notes and then
   deleted), **Keep the recording**, **Read shared screens** (whoever shares is asked whether theirs goes in the notes),
   and **Where they go** (a new workspace, or one of yours), then a line saying the notes are written in confidential
   compute, or by a model outside a secure enclave. One someone else pays for says so once under it: "Its files don’t
   count against your storage, so its boards and files open only for its own people." Past 25 people, **Everyone joins
   muted** is on. **Add an agenda** opens your documents and boards to search and pick from, and lists what's picked
   under it, each with ×, up to 12; anyone who can't open one is told whose it is, without seeing its name, so they can
   ask for it.
8. **The foot** comes after the editor's last row, and stays at the bottom when the editor has to scroll: one line on
   what will happen, then **Cancel** and the one filled button, **Schedule** (**Schedule 4 calls** for a repeat). The
   line says "Google Calendar invites Priya and Kofi."; with nobody invited, "You'll get a link to share."; with no
   calendar, "Without a calendar, nobody is told. Share the link yourself."; and on a demo account's sample calendar,
   "Priya and Kofi get an invitation."
9. **Once it's scheduled** the scheduler closes, the call is on Calls marked **Just scheduled**, and a toast says what
   happened, and only that: "Scheduled for tomorrow at 14:00. Google Calendar invites Priya.", with **Undo** for a
   moment. With no calendar connected, or with **Put calls I schedule on my calendar** off (Settings), nobody has been
   told: the toast says so and offers **Copy link**. With nobody invited, the link is copied. While it saves the button
   waits, so it can't be sent twice; if it can't be saved, the error stays above the foot with its reference, and nothing
   chosen is lost.
10. **Let a guest pick.** With one guest whose calendar can't be read, **Let Jonas pick the time** sits under Who, off
    until you turn it on: until then the call has one time, like any other. On, three times take the place of the day,
    the time and how it repeats: the time you had, then the same time on each of the next two weekdays you're free then
    (or the soonest you're free that day). They're rows numbered 1 to 3, never re-sorted or replaced. Each says its day
    ("Today", "Tomorrow", "Mon 16 Nov") and its time, then what Jonas's clock says once you've said where Jonas is
    ("12:30 for Jonas"), or in caution what of yours it clashes with, and has a tick of its own. The first is the active
    one to start: lit in sun here, and solid on the week, where the others are outlined. Pressing another row, or
    another of the times on the week, makes it the active one until you press another, and "Press the week to move
    time 2." says what the week does then: pressing or dragging anywhere else on it moves the active time, and each
    keeps the time it was given. Unticked, a time is left out, struck through here and dashed on the week, and two at
    least stay ticked ("Offer at least two times"). **45 min each** sets one length for them all (30 min, 45 min, 1 h, 1
    h 30 min, 2 h, or the length they have). Turned off, the call keeps the active time, and adding or removing someone
    turns it off the same way. The button reads **Send Jonas the times**, and the foot says "Your calendar holds the
    times until Jonas picks." (with no calendar, "You get a link to send to Jonas."). Each time offered goes on your
    Google Calendar as a hold that invites nobody; when Jonas picks from the call's link the holds go and the call takes
    that time, and cancelling the call clears them too. The link is copied to send Jonas, and the call waits under
    **Waiting for a time** in Coming up.
11. **Move a call** (**Change the time** on your call) opens the scheduler with the call where it is, and nothing moves
    until you move it. Its top says **Move a call**, its title is the call's name, and once the time changes, "Was Thu 5
    Nov, 10:00 – 10:45" is struck through under it. Who's on it are tokens to read, each with their answer (**Going**,
    **Not going**, **Maybe**, **No answer yet**). The week shows where it is now dashed ("Now 10:00") and where it's
    going solid. When someone invited has asked for another time, the line under the time says so, "Aiko asked for Fri
    11:00", with **Move it there**. In a series **This call** and **This and later calls** sit at the top of When, and
    moving later calls can change how they repeat, though not stop them repeating. The button reads **Move** until the
    time changes, then **Move to tomorrow 15:30**, and the foot says "Google Calendar tells Ines and Aiko." (or "Nobody
    else is invited."); once it's moved, **Undo** puts one call back, and a change to later calls has none. **Cancel
    this call** waits in the foot, in caution, and asks once, in place (**Keep it** or **Cancel the call**). There's no
    quiet **Cancel** beside the button, since a second Cancel would read as the same thing: **×** closes it. A call that
    has started, or is waiting for a guest to pick, can't be moved, and a call that's gone says so, with the way back to
    Calls.
12. **Propose another time** (on a call you're invited to) opens the same scheduler for asking: its top says **Ask to
    move a call**, then the call's name, who's on it (the organizer, and who else is invited) and the call where it is,
    with the busy time of anyone whose calendar can be read hatched on the week. The button reads **Ask to move it**
    until you move the call, then **Ask to move it to tomorrow 15:30**, and the foot says "Kofi sees it, and can move
    the call there." The organizer sees the ask on the call's row, "Aiko asks to move it to 11:00" in rose, with **Move
    it** and **Keep 10:00**: **Move it** moves the call there and Google Calendar tells everyone; **Keep** turns it
    down. Asking again replaces your last ask, a call that moves drops every ask, and only the organizer sees anyone
    else's.
13. **A scheduled call opens its page from its row** (`/calls/upcoming/<meeting ID>`, from Home's Upcoming and Calls),
    for the organizer and for anyone invited: who's invited and how they answered, the link and **Join**, the agenda
    and the notes (flow 8, before a call).
    - For the organizer **Change** opens the scheduler (step 11), and **More** changes the time, skips one in a series,
      copies the link or cancels it. In a series a change asks **This call** or **This and later calls**. With a
      calendar connected everyone gets the update. **Undo** puts one call back; a change to later calls has none.
    - **Cancel this call** asks once, in place. It comes off the calendar and everyone invited is told. **Undo**
      schedules one call again as a new call: a toast says it has a new link, the old one won't work and answers start
      over, and offers **Copy link**; if it can't be done, the toast says that. A call in a series can't rejoin it.
    - Someone invited answers **Yes**, **Maybe** or **No**, sees who's coming and what was brought, and has **Propose
      another time** (step 12). How a call repeats reads in their own time zone, like its time.
    - A call that offers times says it's waiting for the guest, with its link and **Cancel this call**. Someone invited
      to it reads that a time is being picked, isn't asked whether they're coming, and has **Pick a time**, which goes
      to its link.

Alcove sends no emails of its own yet, so without a connected calendar nobody hears about the call, and calls
started now don't go on the calendar: share the link. Everyone invited gets the notes (flow 7).

Storybook's journeys use these numbers: **4.1 Start now**, **4.2 Schedule a call**, **4.3 Pick a time on the week**,
**4.4 Start from the week**, **4.5 Repeat a call**, **4.6 Let a guest pick**, **4.7 Move a call**, **4.8 Answer a request
to move**, **4.9 Propose another time**, **4.10 Meet again**, **4.11 Share a link instead**, **4.12 Paste a list of
addresses**, **4.13 Change a scheduled call**, **4.14 Cancel a scheduled call**, **4.15 Answer an invitation**, **4.16
Press a time, keep the length**, **4.17 Stop at midnight**, **4.18 Drag it to another day**, **4.19 Carry it into next
week**, **4.20 Scroll the day, pick a start**, **4.21 Go to another week, or day**, **4.22 Find the next free time**,
**4.23 Choose the times to offer**, **4.24 Stop letting a guest pick** (off again, and someone added while Jonas would
pick: the call keeps the time that was lit) and **4.25 Type the time** (a start and an end typed, an end before the
start, a time a 24-hour clock doesn't say, and 24:00).

## 5. Join

Pre-join (`/join/<code>`) shows your camera and a mic level, mic and camera switches, the title, and what the call
captures and who gets the notes. Under the preview sit a calm picker each for the microphone, camera and speaker,
each showing the device in use (the microphone's with its level moving as you speak), then **Background**. A picker
opens a menu in the call's own style, not the browser's list: each device once, by its full name, with a tick on the
one in use, and **Your system’s choice** under the one your computer uses. With nothing picked, that one is ticked and the
call follows your computer when it switches; picking a device keeps the call on it, and then **Follow your system**, last,
goes back. The microphone's menu has **Test your microphone**, which
listens for three seconds (a bar fills, the seconds count down) and plays them back through the speaker you chose,
without uploading or keeping anything, and **Noise reduction**. The speaker's has **Play a test sound**; where the
browser can't choose a speaker, its picker says calls play through your system's speaker, and the sound plays there.
Picking applies at once and the menu stays open; Escape or a click away closes it, and focus goes back to the
picker. Alcove remembers the choices in this browser. When one it remembered isn't available, or a device goes, a
short line under that device's picker says so ("The microphone you chose before isn’t available.") until you pick
one. **Background** opens its window, with a big live preview of you beside the choices (6.29). When the browser or
the computer blocks the microphone or camera, or there's none, the picker says so ("Microphone blocked", "No camera")
and a panel under the pickers says how to allow it in this browser, with **Try again**; you can still join, with them
off, and turn them on later. Allowing them in the browser's settings is noticed by itself. In the call, the arrows
beside the microphone and camera buttons open the same menus, and switch devices without leaving the call or
interrupting the notes.

Everyone sees what the call captures before they join and while they wait, each fact once: whether notes are on, paused
or off; one sentence on what happens to what they say, which follows the call (recorded and transcribed, you included;
only one of the two while the host's browser can't do the other; nothing while notes are paused or that browser is away;
and, while someone shares a screen they put in the notes, that it's read too); what won't be kept ("The transcript is
deleted after the notes are written.", "The recording is deleted when the call ends."); and that the notes are written
in confidential compute, and who gets them. Never anyone's name or anything said. A call set up to join muted
starts your microphone and camera off, and says so.

When the call is in a series and you're signed in with earlier notes from it, **From last time** sits under the way
in: one of each of what's decided, still open and handed out, each with where it comes from, how many more there are,
and **All of it**, the series, in a new tab so the camera here stays on. It comes from the notes you have, so it isn't
the same for everyone. Someone newly invited and a guest with the link see nothing, not even that there's a series.

- **The organizer** gets the lobby, which rises in two beats: until the call has started they can rename it (the
  pencil; Enter or clicking away saves, Escape puts it back) and turn notes on or off, and a change that can't be
  saved says so and goes back. Once it's live both are read-only. On a team, a call started just now shows arches of
  people on Alcove, free first and busy dimmed, with **Add** for anyone else; pressing one picks them (anyone the call
  was started with comes picked), and the button says **Join and ring 2**. With nobody picked it says **Join**.
  **Copy link** sits quietly under the button, on a team or on your own; there's no link box, since the address the
  organizer is on is the call's link too. A scheduled call shows the
  time and who is invited, without the arches. **Home** out of a call started just now cancels it; reloading doesn't.
  Once its link has been copied here it stays, since someone may be on their way: it's reachable by that link, and
  shows on Home once someone is in it.
  While someone is hosting in their place (their connection dropped, or they left the call to someone), it says who,
  and **Join and host** makes them the host again.
- **Someone invited**, signed in, is told they get the notes, sees **Join now**, and is in as soon as the
  organizer is there.
- **Anyone else with the link** sees who's hosting, and asks to join. Without an account they type a name; one
  line says guests don't get the notes, and **Sign in to get them** offers Google in place (and Microsoft and
  single sign-on when the organizer signed in with one of those). Signed in that way, they ask under their
  account, and once the organizer lets them in they're added to the invite and get the notes. While they wait
  the page says so, with **Stop asking**; if they're turned away, it says that too. While someone stands in for the
  organizer, they wait for "the host", and that person lets them in; everyone new then comes in as a guest, without
  the notes, which the page says before they ask ("While Art is away, you join as a guest, without the notes").
- **Before the organizer arrives** the page says it's waiting for them and opens joining when they're there. A
  locked call says nobody new can join. A call that's over says so, and opens again if the organizer starts
  it. A link that leads nowhere says to check it. The camera and microphone start as soon as there's a call
  to join, and stop when there isn't.
- **A link that offers times** shows them instead, with no account and no camera: **Pick a time with Zara**, each
  time in the guest's own zone with the zone named, what the notes will be, and one button that says the time.
  After picking, **Add to my calendar** saves a calendar file made in the browser. If someone picked first, the page
  says which time was taken and gives the call's link.
- A join that fails says why under the button, with a reference (Ref) to quote if it keeps happening.

**Being rung.** Only your team can ring you, or an organizer whose call you've said yes to: an invitation alone puts
nothing on your screen. A card drops in on whatever page you have open, over a window too, and doesn't take the focus from
what you're typing. With a window open, Tab goes on from its last control to the card and from there back to the
window, and what you typed stays. It rings once, in one tab, where the browser allows sound. **Join** goes through
pre-join. **Can't now** opens **In 5 minutes**, **In 15 minutes** and **Not this time** in the same card, and a toast
says what the organizer sees and that Alcove rings you again then. A ring nobody answers leaves by itself after 45
seconds. On the page
of the call itself there's no card. From another call, **Join** asks the current host to leave it first; other participants leave immediately, carrying on to
the call that rang.

## 6. In the call

The call opens full screen, in three places, each with one job: the stage holds the people and whatever you have open,
the dock at the bottom holds what you do in the call, and the top right holds what's only yours. Your side, one panel at a
time, slides in on the right.

- **Top bar.** On the left, the title and clock; the notes sign (**Notes on** in crimson, **Notes paused**, **Notes
  unavailable** when the host's browser can't record or listen or is out of the call, **Notes off**, or **Notes requested**
  while someone has asked; the organizer's own says **Pausing…** until their pause lands), the same for everyone; and the
  shield, whose hover says what confidential compute covers (verified only when this browser's check of the server
  passed, and if it didn't, why). The notes sign opens what's captured, the card the pill in **Notes** opens too. It has the sign
  and when it changed ("Since 16:02", "By you at 16:12"), then one sentence on what's captured now, which says in words
  what isn't working (there's no list of each kind of capture), and for anyone but the organizer who can change it ("Only
  Priya can pause or turn them off."). The organizer sees who asked for notes, in rose; whoever asked sees "You asked
  Priya." with **Take back your ask**, or when Priya said not now. Then the organizer's **Pause notes**, **Resume notes**
  and **Turn off** (or **Turn on notes**; **Pause notes here** or **Resume notes here** in a breakout room), or anyone
  else's **Ask for notes** while notes are off or paused. Last, a row each for how the notes are written, who gets them,
  shared screens while they're read and, for the organizer outside a breakout room, **Notes written by** (the AI model
  that writes this call's notes). Opened from the sign while Notes isn't open, it ends with **Open the notes**. On the
  right, what's only yours: **Board** (**O**), which
  opens the board picker under it, and **Workspace** (**W**, with a count of what's been brought to this call), which
  opens the workspace, each on your stage just for you (Presenting, below); **Notes** and **Chat** (**C**,
  with a count of what's new), which open your side; and who is here, the faces and the count (and, for whoever hosts, how
  many are asking to join), which open People. Each is lit while what it opens is open, and pressing it again puts it away:
  on Board and Workspace that's **Close**, which asks first while you present it. When two things are on your stage and
  there isn't room for both, they take turns, with a switcher in the top bar. On a phone (narrower than 600 px) the top bar
  is the title, the notes sign, Chat (with its count) and the faces.
- **Dock.** Microphone (**M**) and camera (**V**), each with an arrow for its menu, the pre-join pickers' own menus:
  which microphone (its level beside it), which speaker and **Play a test sound**, and **Noise reduction** (no **Test
  your microphone** here: in the call your microphone is live, heard by everyone and by the notes); your camera's
  preview, which camera, and **Background**, which says what's behind you now and opens Background's window over the
  call, closing the menu first. The window has a big live preview of you on the
  left, with what's behind you named on it, and on the right **Blur** (**Off**, **Light**, **Strong**), **Pictures**
  (Alcove's **Balloons**, **Beach** and **Office**), **Colours** (**Slate**, **Sand**, **Rose**) and **Yours**: up to six of
  your own (**Add**; kept sealed in this browser; a guest has none, and Yours says to sign in). Each of your own has
  **Replace** and **Remove**; a failed replacement leaves the old picture, and a picture that's refused says why under
  Yours (JPEG, PNG or WebP, up to 20 MB, six at most). Picking applies at once; **Done** or Escape closes it, and on a
  phone it's a sheet, the preview on top. The same window opens from the pre-join's **Background**, so you pick it
  before anyone sees you. Choosing while the camera is off leaves it off. Removing the picture you're using shows
  strong blur instead. A microphone or camera that can't work has a caution mark, and
  pressing it opens its menu, which says why and how to fix it. Unplugging a device moves to another one,
  muted or not as before, and says which; a device that comes back is used again. Nothing turns your
  microphone or camera on by itself during a call. Then **Share** (Presenting and Sharing, below; it says **Presenting**
  while you present), **Raise your hand**, **React**, **More** and **Leave**, and, in focus, **Show everything**. **More** is the same
  on every screen, what you do in a call first: **Turn on captions** (or **Turn off captions**), **Mark this moment**,
  **Catch up on what you missed** and **Breakout rooms** (the organizer's, once someone else is in the call); then, under a
  hairline, **Open floating call** (Keep the call in view, below), **Reset layout** (only once you've changed the layout:
  Your view, below), **Move to another device** and **Settings**. On a phone the dock is microphone, camera, **Share**,
  **More** and **Leave**, and **More** starts with a grid of **Board**, **Workspace**, **Notes**, **Chat** (with its count),
  **React** and **People**, then **Raise your hand**; the devices are in Settings.
- **Settings**, from **More**, is one window, its parts as tabs down its left (on a phone, a sheet with the parts in a
  strip along its top), and closes with its **×** or **Esc**. **Audio and video** has the dock's two menus in one place:
  which microphone, with its level, which speaker, **Play a test sound** and **Noise reduction**, then your camera's
  preview, which camera, and its **Background**. **Video quality** sets the most video you send (360p, 720p or HD
  1080p, where your camera has it) and how you see everyone else's cameras: **Auto** (as sharp as each tile on your
  screen), **Data saver**, or **No cameras**, which stays said at the top of the call with **Show cameras**. Both are
  remembered in this browser, and shared screens are never made smaller. **Notifications** has the same choices as
  Settings' Notifications (11.25): browser notifications, Sounds, Quiet mode and the In a call rows of What reaches you,
  guests included. **Call** is there for whoever hosts, and
  changes the call for everyone in it: **Lock the call** (nobody new can ask to join, and anyone who leaves can't come
  back), and, for the organizer alone, **Pointing at shared screens** (anyone here can point and mark, unless whoever
  shares says only they can). Someone hosting while the organizer is away has Lock the call; anyone else has no Call.
- **Your side.** One panel at a time, on the right, at a fixed width: it slides in and the stage makes room. In a window
  too narrow for both (under 864 px), it slides in over the stage instead, which keeps its width and dims behind it, and a
  press on the stage puts it away; the top bar and the dock work as ever. **Notes**,
  **Chat** and the faces (People) open it from the top right; **Your notes** opens there beside a board you present, and
  **Breakout rooms** (in People or **More**) opens the rooms there. A panel's button is lit while it's open, and pressing it
  again, its **×**, or **Esc** (once no menu is open, you're not in focus, and nobody you pinned is here) puts it away. On a
  phone a panel is a sheet over the call. A reload finds your side as it was, and a call you've just joined opens Notes
  beside the stage on a wide screen while notes are on. Nothing on your side changes anyone else's screen.
- **Your view.** There are no layouts to choose: the stage lays itself out, everyone in a grid, and talking moves
  nobody (whoever's talking has the speak ring). Only someone you pin, or the organizer's spotlight, goes on the main
  stage over a strip of everyone else. Drag a tile to move it, and pull its corner to make it bigger; the stage stays as
  you left it. The first time you point at a tile you can move, it says so under the tile ("Drag a tile to move it", and
  in the grid "Pull its corner to make it bigger"), once in this browser.
  Beside what's open the people stand at the window's right edge, in a column of tiles that narrows with the window, or a
  row of arches over it on a narrow stage and on a phone. **Notes**, **Chat** and **People** open between what's open and
  them: what's open makes room, and the people stay where they are. The seam left of them, a faint grip until you point at
  it, makes them smaller: click it, drag it right, or press **⇧P**, and the column folds into a rail of arches in the same
  place, where whoever's talking has the ring and anyone with a hand up keeps a place. Click it again, drag it left, or
  press **⇧P** again, and it opens back out. On a narrow stage and a phone the arches stay. Closing the last thing on your
  stage gives it back to everyone, and **Close** says so before it's pressed ("Close it, and the people fill your stage
  again"). Once you've changed the layout (moved, sized or pinned someone, or made the people smaller), **Reset layout**
  in **More** puts it back, with
  **Undo**; where you see yourself stays as it is. Only your screen changes. A tile's **⋯** menu is short, with no key
  hints. On your own tile: **Set a status** (journey 6.34), **Pin for me** (up to six people, who share the main
  stage), **See yourself**: **Grid**, **Corner** (drag it, or Shift and an arrow, to another corner) or **Hidden** (a
  small chip in the corner brings you back; everyone else still sees you), and for whoever hosts **Spotlight for
  everyone**. On anyone else's: **Pin for me**, **Message Kofi privately**, **Nudge Kofi** (journey 6.16) and **Volume
  for you**: a slider from muted to 100% and a quick mute, for that person's voice in your speakers only; the same
  control is in their row in People, and someone you've turned down shows "40% for you" on their tile and in People.
  Nobody else hears a difference, and nothing they say goes into the notes any differently. For whoever hosts it also
  has **Spotlight for everyone**, **Lower hand** while their hand is up, **Mute for everyone** while their microphone
  is on, and **Remove from the call**. A pin or a spotlight shows on the tile with an ×, a spotlight also as a bar
  with **Stop spotlight**. From the keyboard, Tab to the stage, move between tiles with the arrow keys, and use
  **Enter** for the menu and **P** to pin; on a presented thing's tile,
  **Enter** or **P** puts it on your stage, with the keys on its frame. Closing what's on your stage leaves the keys on its
  tile while someone still presents it, or else on what opens it again (**Board**, **Workspace**, or **Share** for your
  own screen), never nowhere. What's open on your stage comes before the people in Tab's order. The keys stay put as
  **Unfollow** turns into **Follow Priya** and back, go to your side as what it shows changes from inside it, to the next
  step's first choice inside Share, and back to **More** as **Settings** closes; on a phone, your side's sheet keeps them
  while it's up. On a share on your stage, **L** points at it, and **Escape** stops pointing;
  then **Escape** unpins everyone. Someone pinned who leaves is pinned again if they come back, and nothing you arranged
  moves when people talk, join, leave or turn their camera off. Alcove remembers how you like calls (whether the people
  beside what's open are hidden, and where you see yourself) for your account in this browser; how you arranged this call
  lasts until you leave it.
- **Presenting.** What you have open, or what someone presents, sits on your stage in one frame, with the people beside
  it. Its bar has whoever presents it (their face, or what kind of thing it is while nobody does), its name, which opens a
  menu of what you can do with it, and a line: "Only on your screen", "You’re presenting · 3 following" or "Priya is
  presenting". On the right it has only what applies: following, **Present**, focus (**⌘⇧F**, "Fill your window with
  it"), **Stop sharing** or **Close**.
  - **Open it just for you.** **Board** (from its picker) and **Workspace**, at the top right, open on your stage, and nobody
    else's screen changes. Your stage holds one thing: opening something puts away what was there. Something presented
    becomes its tile; something open just for you closes, and the workspace keeps your place, caret and undo.
  - **Present it.** **Present**, on the bar of a board you can add to or of the workspace, while it's open just for you,
    brings everyone with you. **Share**, in the dock, presents **Your screen**, **A board** or **The workspace** straight
    away: your screen after a step that asks which kind, and a board picked from the board picker, Share's next step. A
    presentation that starts takes the stage of everyone who isn't watching another: they follow it, and a toast says so
    ("Priya is presenting the workspace, and you’re following.", or "Priya is presenting their screen."). Someone watching
    another presentation gets it as a tile, with a toast ("Kofi is presenting their screen. It’s with the people.") and
    **Show it**, and its tile glows for a moment where it lands. Toasts about the same thing take each other's place, so
    one never stays up saying what's no longer so. Each part of the call (the main room, or a breakout room) has one
    presented board or workspace at a time, and up to four screens: while someone else presents a board or the workspace
    there, neither has **Present**, and
    Share's **A board** and **The workspace** say "Priya is presenting. You can present once they stop." instead. Someone
    who can't open what's presented is told who's presenting, never what ("Priya is presenting something you can’t
    open"), and gets no frame and no tile; when it's the call's board, brought by someone here, the toast has **Ask Priya for
    access**, which asks in the call's chat, as the board's own frame does.
  - **Follow, or work alongside.** On a board you see the presenter's frame; in the workspace, their page and line. The
    bar says "Following Priya", with **Unfollow**, which gives you your own view back, to work alongside them: in the
    workspace, where you were before you followed; on a board, as you left it. A click, scroll or keystroke in the
    workspace, or a scroll, drag or pinch on a board, works on your own too, from where you are. The bar then says where
    they are ("Priya is in Launch plan") with **Follow Priya**, which takes you back. A screen can't be unfollowed.
  - **Close is for you.** On something open just for you, **Close** closes it. On someone else's presentation, it closes
    it for you: "Closed for you. While Priya presents, its tile takes you back." While you present a board or the
    workspace, Close asks first: **For you** ("You stop presenting. Everyone else keeps it open, on their own.", and
    then "You stopped presenting. The others keep it open, on their own.") or **For everyone** ("It
    closes for everyone in the call.", or in a breakout room "It closes for everyone in this room.", where it does, unless
    it's the board every room shares and you opened it or you're the organizer), as a sheet on a phone, and so do the lit
    **Board** and **Workspace** (**O**, **W**). On the call's board while nobody presents it, whoever opened it and the
    organizer are asked too: **For you** ("It stays in the call, and Board opens it again.") or **For everyone** ("It
    leaves the call for everyone, and stays saved in Product."), which takes it out of the call for everyone, who are
    told "Launch retro was closed for everyone. It's saved in Product."; while rooms share it, only the organizer is;
    **Stop sharing** in Share's first step, which says what you're presenting, asks the same in Share itself, wherever what
    you present is. Your own screen has **Stop sharing**, which stops it for everyone, and **Close**, which puts it away
    for you while everyone still sees it: "Put away for you. Everyone still sees your screen, and its tile brings it
    back." It's a tile with the people, who fill your stage again. The organizer can close anyone's presented
    board or workspace for everyone (**Close it for everyone**), and stop anyone's screen (**Stop it for everyone**), from
    its name; whoever presented it is told who did ("Art closed Launch retro for everyone.").
  - **A tile only while it's presented.** Something presented that isn't on your stage is a tile first among the people:
    a screen shown live, a board drawn small, or the workspace with where its presenter is, and its name, "Priya is
    presenting" and **Join** (**Open**, on your own). Pressing it puts it on your stage, following, with the keys on its frame;
    from the keyboard it's one stop among the tiles, and **Enter** or **P** does the same. When the presentation
    ends, its tile goes, and something nobody presents has no tile. Its **⋯** has **Show it**; **Show beside**, which puts
    it beside the one thing on your stage, as two screens sit side by side (not on a phone); and, for a screen with sound,
    **Mute its sound for you**.
- **Sharing.** **Share › Your screen** (a tab, a window or your whole screen, with **Also share the tab’s sound**, or your
  computer's on a whole screen, where the browser can share it: the next step opens in the same menu, then the browser's own
  picker asks which one) presents your screen, and a toast says "Everyone sees your tab." Several people can share at once
  (up to four), and starting yours never stops anyone else's. Your share sits on your stage. Its bar says "You’re presenting
  · a tab with sound" (with sound only when its sound goes too, and "Starting to share…" until it's out), and "· Read for the
  notes" when it goes in the notes, and has **Stop
  sharing**. Its name has **Others can point at it**, **Clear marks** and **Change what you share**, which swaps it in place
  for everyone, and says **Read for the notes** while it goes in the notes. Each share names
  whoever shares it, with their face in the arch. Someone else's share is presented like anything else (above): it takes
  your stage, with a toast ("Priya is presenting their screen."), unless you're watching another presentation, when it comes
  in as a tile, with a toast and **Show it**; **Close** makes it a tile again, for you, while they share. Its name has
  **Point at it** (**L**), **Freeze the picture** (**F**), **Earlier picture** (**,**), zoom, **Mute its sound for you**,
  **Open in its own window**, **Put on the board** (while the board in the call is beside it on your stage, for whoever can
  add to the board) and a **Show beside** for anything else presented ("Show Kofi’s screen beside"), which puts the two side
  by side, or one above the other where there isn't room across; with room for neither, they take turns, with a switcher in
  the top bar. When the browser or the computer won't share (on a Mac, the screen-recording permission), **Your screen**
  comes back and says what to do, with **A tab** picked, which needs no permission; when the sound you asked for didn't
  come, a toast says so. Phones and tablets can see shares but can't share: there, **Your screen** says "Sharing a screen
  needs a computer". Nothing shared is transcribed, and cameras never go
  in the notes. A share goes in the notes only if you say so (**A share in the notes**, below).
  **Stop it for everyone**, the organizer's, stops someone's share for everyone: "You stopped Priya’s share for everyone.
  Priya is told it was you.", and a notice says who stopped it.
- **Looking closer at a share.** On someone else's share on your stage, pinch or Ctrl/⌘ and the wheel to zoom where you
- **A share in the notes.** While notes are on or paused, and the organizer lets shared screens go in them (**Read shared
  screens** when the call was scheduled, on by default), Share › Your screen asks **Include this share in the notes?**,
  already answered: **No** to begin with, then your last answer in this call (**Change**, and a try after one that didn't
  start, included), so **Share** never waits on it and a share goes in the notes only after you say **Yes**. It's never asked
  with notes off or in a breakout room, where nothing shared is kept. With **Yes**, everyone sees **Read for the notes** on your share, and your
  own browser records it (a few frames a second) from the moment it starts, but holds it in your browser: nothing is sent
  until it's been up ten seconds, and a share that ends sooner is dropped. It goes to the notes while notes are on; paused,
  nothing is recorded until they resume. **No** keeps nothing of it. Notes going off stop it there. If your share can't reach
  the notes, the Notes panel says so.
  point (or **+**, **−**, and **0** for the whole picture), drag to move around, and double-click for 200% and back; a
  label says how far in and a minimap where. **Freeze the picture** (**F**) holds the picture still while the share goes on, and
  **Earlier picture** (**,**) steps back through the last 30 times it changed; a bar says how far behind live you are,
  with **Back to live**. They're kept in your browser's memory only, never saved or sent, and go when the share stops,
  you close it, you move to or from a breakout room, or you leave; none are kept while notes are paused (zoom and freeze still work).
  **Open in its own window** puts a share in a window of its own (Picture-in-Picture in Chrome, Edge and Firefox, a
  popup in Safari) to keep in view or put on another screen; the call says **In its own window** where it was, with **Bring it
  back**. Two shares side by side are each zoomed and frozen on their own, to compare. Only your screen changes.
- **Pointing at a share.** On a share on your stage, live, **Point at it** in its name (or **L**) starts pointing:
  everyone sees your pointer there with your face and name, a click leaves a ring and a drag a
  line, and each fades after a few seconds. A small bar says you're pointing, with **Undo** (or Backspace) for your
  last mark and **Stop pointing**, the × (or Escape). From the keyboard, the arrow keys move your pointer and Enter
  leaves a ring; on a phone, tap and drag. Pointers and marks stay on the same spot of the picture however each person
  has zoomed into it or moved around, and while you point the wheel, a pinch and the keys still zoom. A frozen or earlier
  picture shows none, as they're about the live one, and freezing stops your pointing; a share in its own window shows
  them, and you point in the call. Your own share shows what others point at too. Its name has **Others can point at it**
  (on unless you turn it off; you always can) and **Clear marks** while there are any; changing what you share clears
  them too. The organizer can turn pointing off for everyone, in **Settings › Call**. Pointers and marks go from browser to
  browser, encrypted end to end, and stay in your room; they're never recorded or read for the notes, and nobody's
  computer is ever controlled from the call.
- **Captions** are off until you turn them on (**More › Turn on captions**; they have no key, as **C** is Chat), and
  turning them off only hides them: while notes are on the call is still transcribed. Captions show the newest line, in
  the language you pick on the captions themselves (translated in confidential compute, for you alone), with the
  original underneath. Captions need notes on.
- **Notes**, at the top right, opens on your side. Its head is **Notes**, the pill, **Open** (an icon: the workspace on
  these notes, just for you) and **×**, over the tabs **Notes**, **Transcript**, **Ask** and **Yours** (a guest with the
  link has no Yours), words with a line under the one you're on. The notes everyone gets are written when the call ends.
  - **The pill** says the state in a word, and opens what's captured (above): **Live**, with a crimson dot, while notes
    are on; **Paused** (the organizer's says **Pausing…** until their pause lands); **Unavailable**, in caution, while the
    browser taking the notes can't capture; or **Off**. For the organizer, while notes are off and people have asked, it
    says how many (**2 asked**), in rose. In a breakout room it says the room's state.
  - **The bar**, under the tabs on Notes and Transcript, is there only while capture isn't simply live: it says what that
    means, with the one thing to do about it. Paused, the organizer reads "Paused at 16:12. Nothing new is written until
    you resume." with **Resume**, and anyone else "Priya paused notes at 16:12…" with **Ask to resume**, then **Take
    back your ask** once they've asked. Off after notes were on, the organizer reads "Notes are off. What was written is
    kept." with **Turn on**, and anyone else "Priya turned notes off. What was written is kept." with **Ask for notes**.
    While people have asked, the organizer's is rose: their faces, "Kofi and Aiko asked for notes.", **Not now** (said
    to each of them, once) and **Turn on**. In caution, it says whose browser can't record or listen (in a breakout
    room, that nobody's there can), or can record but not listen, so nothing new is transcribed, and that notes pick up
    as soon as it can. It also says
    when you host from a breakout room while notes are on, and when the organizer paused the room you're in. This
    browser's own problems (the recording couldn't upload, the microphone isn't heard, a share can't reach the notes) get
    a bar each, in caution.
  - **The Notes tab** has the summary first, under **From last time** (below) when there is one: three lines and **Show
    all**, with how fresh it is at its heading's right. That's "Writing" while notes are on, "As of 16:12" otherwise, and
    "Not updated since 16:12", in caution, while the notes can't be brought up to date (Alcove tries again on its own);
    an **Unencrypted** badge sits there too while the call's model isn't in a secure enclave. Then **Decided**, in rose:
    each a rose diamond, the words, the time it was said and the arrow that sends it to the document you were last in.
    Then **Follow-ups** (below), and **From the rooms** once breakout rooms have been held. The notes are read from the
    transcript as the call goes, the same for everyone in that part of the call, and each time opens the transcript at
    that moment. A guest with the link gets notes written only from what was said while they were here, and the summary
    says so. With nothing to show yet it says why: **Listening**, **Writing the first notes** (or that the first notes
    couldn't be written yet, while Alcove tries again), **Notes are off** (with
    **Turn on notes** for the organizer, or **Ask for notes**, then "You asked Priya for notes" with **Take back your
    ask**, or that Priya said not now), **Notes are paused** or **Nothing is being captured**.
  - **Follow-ups**, in horizon, is the checklist everyone shares, with no filter: each one's box, its words, who and when
    (as said) and the time it was said; pointing at one shows edit, which opens it in place, and the arrow. Anyone
    permitted to change a follow-up can tick it, and it's done for everyone and in the notes at the end; a guest's box
    can't be ticked. **+** in the heading adds one in place. What the call suggests waits under the checklist, under
    "Suggested from the call": dashed, with who and when and its time, **Add** and **×** (Dismiss). A change to a
    follow-up shows its new words over the old ones, struck through, with **Apply**. Two show, then how many more ("3
    more suggested"). Nothing moves or changes under your pointer or keyboard: while you point at the suggestions or one
    has focus, the ones shown stay as they are, and new ones wait behind the count. What you press goes with what you
    saw: one that changed says "Changed since you saw it" and shows its new words, and one someone else reviewed says
    so. Someone who can read the suggestions but not review them sees no buttons on them. With neither follow-ups nor
    suggestions it says "Nothing to do yet." The workspace's Follow-ups page and the note after the call review the
    same suggestions as a batch.
- **Yours**, the last tab, is your own notes on the call: what you wrote, marked and kept, oldest first. Empty, it says
  "Only you see what's here" and what can go in, and before notes have been on, that it starts when they do. At the
  foot of every tab but Ask, **Note to self** says **Only you**, with a lock, until you type; **Enter** keeps it in
  Yours, and a toast says so ("Kept in your own notes."), with **Open**. Beside it, the bookmark, **Mark this moment, only you**, bookmarks what was
  just said, as **B** and **Mark this moment** in **More** do. The bookmark on a line of the **Transcript** (**Bookmark
  this line in your own notes, which only you see**) bookmarks that line, as on the note: once it's on, it stays in
  sight, ticked, and says **Remove your bookmark**, which takes it back out of Yours. A toast says each time it goes in
  (with **Open**, which opens Yours) or comes out, and nothing when a press changes nothing. A moment marked as a line
  was said opens at the same line, but it's a moment, not that line's bookmark: taking the line's bookmark back leaves
  it. Under an answer in **Ask**, **Keep in your notes** keeps it here; nothing else keeps one. A bookmark of something
  said where you aren't now (the main room, from a breakout room) says so, and opens once you're back there or in the
  notes after the call. Someone with only the link has neither Yours nor Note to self: there's no account to keep them
  under. It goes with the call's notes, so it starts when notes do, and the foot is there once they've been on.
- **From last time**, at the top of the Notes tab when the call is in a series and you have earlier notes from it: for you
  alone, from those notes. What's decided, what's still open and for how long, and the follow-ups (who took them on,
  who they're only suggested for), three of each, then what was settled since the last call. Each has its call and
  moment, a breakout room's with its room, and opens in a new tab, so the call carries on. It's open until the call has
  notes of its own, then folds away. A later call that seems to have replaced or answered something says so.
  **Everything from these calls** opens the series. Before a series has notes, it says so.
- **Earlier calls**, in **Ask**, beside **This call**: ask across the calls you have notes from, such as why something was
  chosen. Each answer says which calls it comes from, and opens them in a new tab. Only you see it, and nothing of it
  is kept. It waits while notes are paused, and a guest, or someone with no notes from the series, doesn't have it.
- **Transcript** (the whole call so far, with who's talking at the end), **Ask** and **Yours** are the Notes panel's
  other tabs. **Chat** (**C**) has a panel to itself, encrypted end to end, with its conversations as tabs: **Everyone**,
  **Questions** and one per private conversation. **People**, from the faces, opens with **Find someone**,
  which narrows every list in it by name: who is asking to join (first, for whoever hosts), who is here (hands raised
  first, in the order they went up, with each person's status, pins and spotlight), who is ringing and how they answered,
  and who is invited and not here (the organizer can ring anyone in the last two); for the organizer, **Breakout rooms**,
  which opens the rooms on their side. Each row in the call has **Message privately** and **⋯** (a nudge, how loud they
  are for you, and whoever hosts' controls), and **Copy link** sits at its foot. Locking the call and pointing at shared
  screens are in the call's settings, not in the list.
- **Chat, like Slack.** Messages sit on the panel without boxes; a run from one person within five minutes sits under
  one arch, name and time, and the others' times show in the margin as you point at them. Point at a message (or reach it
  with the keyboard) for a small bar over its top right corner: three quick reactions, the rest from the smiley, **Reply in
  thread** and, on someone else's, **Message privately**. On a phone, its **⋯** or pressing and holding it opens the same
  as a sheet, with all eight reactions. A message that mentions you is highlighted until you've seen it; **Open mention**
  goes to the first. Sending and failed states stay with the message, and **Retry** sends it again in its own conversation.
  In a breakout room, **Everyone** is the people in that room, and a line says where the conversation moved.
- **Private messages (journey 6.30).** Each private conversation is a tab of its own, with a lock and a dot when something
  new arrives. Start one with **+** beside the tabs (find someone in the call), **Message privately** on their tile, the lock
  on their row in **People**, or the lock on a message of theirs. It opens with **Only you and [name] can read this.**, and
  Send says **Send only to [name]**. Each conversation and each thread keeps its own draft. Private messages have times,
  reactions, unread counts and sending, sent, delivered or failed states; **Retry privately** keeps the original recipient
  and message. A departed recipient or different room makes that conversation unavailable (its tab stays, quieter, to read).
  Only the original pair can read it, its reactions included, admitted guests too. Private messages never enter the shared
  chat, recording, transcript, AI notes or shared exports, and history ends with the call. Unread indicators and optional
  sound do not open over shared work or take focus; notifications show no private preview.
- **Chat threads (journey 6.31).** **Reply in thread** opens one discussion in place of the conversation: **←**, **Thread**
  and where it is (**In Everyone · 3 people**), the original on top, a line with how many replies, the replies, and a
  composer that says **Reply…**. Under the original in the conversation, the thread's line shows who replied, **2 replies**
  and **Last reply 14:29**, or how many are new; pressing it opens the thread at the first new reply. **Also send to
  Everyone** sends a reply to the conversation as well, where it says what it answered and opens the thread. **←** restores
  your place and its own draft. Every room, private conversation and thread keeps its separate draft. Only the original
  audience can read or reply; unavailable originals show a placeholder, with only the replies you can already read. Failed
  replies stay in that thread for deliberate retry. **Replies to you**, in Settings → Notifications (its Alert and Sound
  ticks), controls new-reply cues for authors and people who have participated, without notifying the entire room or revealing private previews. Seeing a message while
  the call is visible and focused updates its read receipt.
- **Browser notifications (journey 6.33).** Explicitly enable browser alerts, then choose what reaches you: each event's Alert tick covers its alert inside Alcove and from the browser, and its Sound tick its sound. In a background tab, fresh authorized private messages, relevant replies/mentions and pending call actions can show generic alerts. Click back to the exact original conversation/action after access is checked; handled actions and ended sessions explain their unavailability. Blocked or unsupported browsers retain the same unread counts and pending actions in Alcove.

- **Reacting on screen (journey 6.36).** **React** in the dock opens the same eight emoji. Each one you press rises out of the bottom edge of
  the screen, somewhere across a strip left of the middle that keeps clear of the sides, slows to a stop part of the way up
  the stage and fades there within two seconds, for everyone in your part of the call (with reduced motion it rises a
  shorter way, without swaying). The picker stays open, so you can press as fast as you like: pressed fast, they
  come several at a time, wider and higher, and everyone's pile up over each other. Nobody's name goes with them, and
  nothing is kept: they travel browser to browser, sealed like pointers, and the API never sees them.
- **Reacting to chat.** The bar over a message has thumbs up, heart and laughing at once, and the smiley opens all eight
  (thumbs up, thumbs down, heart, smile, laughing, surprised, sad, celebrate). Each emoji someone used sits under
  the message as a pill with how many, yours outlined. Press one to add yours, or press yours again to take it back; **+**
  at the end adds another. Its tooltip names who reacted, and after about 40 characters says how many more ("Aiko, Maya,
  Kofi +2"). You can react once your own message has gone out, in private conversations too, where only the two of you
  see them. If a reaction doesn't send, it's taken back and a toast says so.
- **Questions (journey 6.15).** **Questions** in Chat holds the room's questions, separate from chat and from the private AI
  **Ask** under Notes; its tab says how many are open. Type in **Ask a question** and press Send; switch on **Ask
  anonymously** first and the question says **Anonymous** to everyone, whoever hosts included, and only you see **You,
  anonymously** and **Take back your question**, in its ⋯. Each question shows its votes in a column that says **Vote**,
  or **Voted** once you have: press it to vote, again to take your vote back; one identity has one vote, and there's no
  voting down. **Most votes** or **Newest** sets the order, and the list follows it whenever the pointer is away from the
  questions and nothing in them has keyboard focus: votes coming in move them, gliding to their places (without gliding
  with reduced motion), and under **Newest** a question just asked comes in at the top. While you point at them, or a
  question's ⋯ is open, nothing moves: the order you're reading in holds, **Most votes** (or **Newest**) stops looking
  chosen, and **Sort by votes** (or **Sort by newest**) sorts them now. On a touch screen, where a finger leaves the list as
  it lifts, it holds while your finger is on the questions and for a couple of seconds after you last touch or scroll them,
  so the question you just voted for doesn't move from under your next tap. This replaces the call attention spec's
  "Sorting preserves the reader's place while votes change" (`docs/superpowers/specs/2026-11-08-call-attention-design.md`).
  Whoever hosts uses a question's ⋯: **Pin to the top** (it leads the list) or **Unpin**, **Mark answered** and
  **Dismiss**; answered and dismissed questions leave the open count and the list, their toast offering **Undo**, and
  **Show answered** brings them back, marked, where their ⋯ has **Reopen**. Whoever asked can take a question back from
  its ⋯, and it goes for everyone. Questions belong to the room they were asked in, and stay with that audience when rooms
  close.
- **Mentioning someone in chat (journey 6.32).** Type **@** and search the people who can read this room or, in a private conversation, its original two participants. Their address, or a guest's
  identity, distinguishes people with the same name. Use the arrow keys and **Enter**, or press their row, to select them.
  Selected people appear beside the composer and stay highlighted in the sent message; changing the tagged words removes
  that selection. An unread mention counts in Chat and in the browser tab. **Open mention** goes to the exact message;
  seeing the addressed words in a visible, focused Chat panel marks it read. Room reads reconcile across your open clients; private reads stay with their original connection. Drafts, failed sends and
  self-mentions do not add unread attention. **Mentions**, in Settings → Notifications, has a Sound tick and an Alert tick (a generic alert inside the call, and from the browser when it's on), set independently. A reply that mentions you has one primary mention cue. Retained private history keeps its unread count when its other participant leaves or you move rooms; new alerts require the current audience. Mentioning someone never adds them to a room.
- **Waiting for people.** Everyone the organizer rings waits on the stage in an empty arch that ripples, then shows
  their answer (**In 5 minutes**, **Not this time**), and opens into their tile when they arrive, while the others make
  room. Someone who says no or doesn't answer stays a moment with **Ring again**, then gives the room back, and stays
  in People. A ring that isn't answered never says they're offline: Alcove can't know.
- **Someone asking to join.** A card drops in for the organizer with **Not now** and **Let in**, and stays until it's
  answered. On your own, while nobody else is here, **Just you so far** keeps the link to hand: at the bottom left of the
  stage, or, while the workspace is open, at the foot of its list, under Trash, where it covers none of it. Its **×** closes
  it for the rest of the call, through a reload, and nothing takes its place: the link is at the foot of People.
- **Catching up**, for you alone, and not saved unless you keep an answer. **Catch up on what you missed**, in **More**,
  opens **Ask** in Notes on what you most likely
  missed: your time away if you just came back, what was said before you came if you joined late, or the last
  five minutes. In **Ask**, a chip says what's read (**Whole call** at first) and changes it: the last 5 or 15
  minutes, before you joined, since you joined, while you were away, the whole call, or a stretch picked on the
  call's timeline. Ask a question, or **Catch me up** for what was decided, suggested, left open and what's next.
  Each answer says the stretch it read, as of when, and what isn't in it (notes off or paused, the organizer's
  connection away, the middle of a stretch too long to read whole), all as times of day, and each point has the
  times it was said: one opens the transcript there, that line marked.
  **Back to live** returns to the call as it was before you started catching up; your own view stays as you
  arranged it. Coming back after time away, or joining well after the start, offers a catch-up once, if notes have
  been on. A guest with
  the link can catch up on what was said while they were in the call; the notes go to the people invited.
- **Breakout rooms.** The organizer opens them on their side, from **Breakout rooms** in People or **More**. Pick two
  or three rooms and how long. Everyone in the call is on the board, guests who joined with the link too, dealt into the
  rooms with people invited first, and you're **You**, in the **Main room** over them: drag anyone between the main room
  and the rooms, yourself too, rename rooms, then **Open rooms**. You start in the room you put yourself in, or in the
  main room. Only someone invited transcribes a room, so with notes on, the board says when a room has nobody invited in
  it (nothing said there will be transcribed), and, while you've put yourself in a room, that nothing said in the main
  room goes into the notes meanwhile. While they're open: a shared timer, the main room and each room and who is in it
  (rename a room in place, move someone to another room or back to the main room from their name, or send someone in the
  main room, such as someone who came late or a guest, to a room), **Join room** and **Back to main room**, **Message
  every room**, and **Bring everyone back now**. From the main room, your stage shows every room; one with nobody in it,
  and any you fold (the main room too), is only its name, and the time left is said once, over them. With notes on, a
  room says **Notes** only while someone invited is in it: one with only guests, or nobody, in it isn't transcribed.
  In a room, your stage is that room's people, as it is for everyone in it. Each room has its own encryption keys and
  chat, so what's seen, heard and written in a room reaches only the people in it; the room sees the organizer
  come and go, and someone moved is told. Captions and catching up in a room cover that room only. With notes on,
  what's said in a room is transcribed by one browser there (someone invited sent to the room, told when it's theirs),
  never recorded, and goes into the call's notes as the room's own section, for everyone who gets the notes:
  everyone is told so when the rooms open, and each room's notes sign says whose browser transcribes it. Inside a
  room, the organizer can **Pause notes here** (that room alone is told, and its card says **Notes paused**) and
  carry on later. Everyone comes back when time is up, told when notes are on in the main room.
- Turning notes off keeps what was recorded and transcribed. Turning them on again records a new part, and so
  does the organizer coming back to the call after reloading the page.
- **Pausing** stops everything at once: nothing is recorded, transcribed or sent to the AI, catch-up and
  captions included, until the organizer resumes. Nothing resumes it by itself. The transcript, a catch-up and
  the notes everyone gets say where it was paused ("Paused 10:02–10:05"), where notes were off, and where the
  organizer's browser was out of the call.
- **When the host's browser can't capture.** Without a microphone that works (none, refused, or busy in
  another app), everyone sees the recording as unavailable, and the transcript carries on for everyone else.
  When the browser can neither record nor listen, the sign says **Notes unavailable**, for everyone and on the
  join page, until it can again.
- **When the organizer's notes or storage run out** (16.9). The organizer alone is told, once, when what's left would
  last about 5 minutes at this call's pace (a limit, `ai.warn_seconds`, so the words name no time): "Notes are about to
  run out". Notes then stop for everyone and the call carries on: Notes' pill says **Stopped** and the top bar **Notes
  stopped**. Over Notes' tabs, or in a banner while Notes is closed, the organizer reads "Notes stopped at this period's
  5 hours. The call carries on. Notes start again the moment you have more." with **Get Pro** and **Add 10 hours · $15**
  (on Pro, the hours only), which open checkout over the call; a
  stop for storage says storage, with **Make room**. Everyone else, guests included, reads whose notes ran out ("Priya's
  notes for this period are used up, and the call carries on. What was written before stays.") with nothing to buy. What
  was said until then is in the notes, which are written when the call ends, even when writing them goes past what was
  left. Once the organizer has bought more, wherever the payment lands, notes come on again by themselves: "You're on
  Pro. Notes are on again." (or "Notes are on again."), and the notes mark **Notes stopped** and **Notes on again** at
  their times, in that tab. When the plan has notes again without a purchase (a new period), nothing turns on by itself:
  the organizer is asked, "Your plan has notes again", with **Turn notes on**. While they're stopped, turning notes on or starting a room recording says "Your notes for this
  period have run out. They start again when your plan renews."
- **How long a call runs.** A call ends at 10 hours, and everyone is told 5 minutes before ("This call ends at
  14:30"); its notes are written as when anyone ends it. At most 100 people are in a call. Asking to be let in takes no
  place, so however many ask, someone invited still gets in while there's room; once the people in it fill it, someone
  invited is told "This call is full: 100 people are in it, the most a call can have", and whoever hosts is told someone
  tried. Anyone can still ask then, and **Let in** says the same until someone leaves. One network can have 10 asks waiting
  at once ("Too many people on your network are already asking to join this call. Try again once the host has answered
  them."), so nobody can fill the host's list. An ask whose browser closed stops counting once it's gone from the host's
  list, and someone who reloads while asking asks again in place of their earlier ask.
- **Asking for notes.** While notes are off or paused, anyone can ask for them: **Ask for notes** in what's captured,
  or in Notes, whose bar says **Ask to resume** while they're paused. Everyone sees who asked. The organizer gets a toast
  and sees the ask in People, and while notes are off, Notes says how many asked in its pill, in rose, with **Not now**
  and **Turn on** under its tabs. They turn notes on (or resume them) or say not now, and whoever asked is told.
- Changes show as short notices beside the dock, like "Notes are on. Everyone here can see that."
- **Move to another device** (in **More**) shows a QR code and a link that work once, for two minutes. Scan it
  with the phone's camera, or open the link on another computer: it shows the call, who you'll be and whether your
  microphone and camera are on, with **Move here**. The organizer and invited people sign in there first, with the
  same account. For a guest the laptop then asks **Move to iPhone** or **Not my device**; signed in to the same
  account, it lets go by itself. The laptop turns off its microphone and camera and leaves, then the phone comes
  in as you, with your place, raised hand and breakout room, and its microphone and camera as they were. The
  laptop says where the call went, with **Join again here**. While you share your screen the code stays hidden.
  Whoever hosts keeps hosting on the new device, and nobody takes over while it can still arrive.
- If your connection drops, the top bar says **Reconnecting**, whether the browser is offline or the call's sound and
  video are finding their way back, and you're back by yourself when it returns, as the same person, with **Back online.**
  (or, from a document you wrote in meanwhile, that your edits are saved). While the host's browser is out of the call, the notes sign says **Notes unavailable**, for
  everyone and on the join page; when another browser takes over (theirs on another device, or someone standing in),
  the notes mark the time between ("Host offline 10:20–10:21"). A pause stays a pause through all of it.
- **When the organizer's connection drops.** The call goes on. About ten seconds after the call loses them,
  someone invited who's in the call hosts in their place (never a guest; someone in the main room first, then
  whoever came first), and everyone is told: "Art's connection dropped, so Priya is hosting until Art is back".
  While Priya hosts, the status bar says so for everyone and People marks her. She lets people in, mutes, removes
  and locks, can bring everyone back from breakout rooms, and can end the call or leave it to someone else; what
  the notes capture stays as Art left it, and only Art changes it (she can ask, like anyone). Only Art adds people
  to the invite, so whoever Priya lets in is a guest, without the notes. The notes carry on
  from her browser. If everyone invited is in a breakout room, Priya hosts from hers: that room goes on being
  transcribed by someone else there, and nothing hears the main room, where the notes sign says **Notes unavailable**,
  until she brings everyone back. Priya is told so. When Art joins again, he hosts again at once: "You're hosting again. Priya hosted while you
  were away". If nobody in the call can host, it ends as it always has. A tab of Art's that was still open says
  someone else is hosting, and goes to the join page to take the call back.

Calls are for groups: invited people join with their accounts, anyone else with the link asks and the
organizer lets them in, and video, audio and chat are encrypted end to end between the people in the call
([Calls and recordings › Group calls](../engineering/calls-and-recordings.md#group-calls)).

### Hands, questions, nudges and status (journeys 6.14 to 6.17, 6.34 and 6.35)

A raised hand, a nudge and a status are about one person, so they live on that person: on their tile, and on their row in
People. Opening People changes only your own view and never starts presenting anything. Requests already outstanding appear
after joining or reconnecting without replaying their sounds, and a polite screen-reader announcement says how many hands
are up, and for whoever hosts how many are waiting, without moving focus.

14. **Raise your hand, and take turns.** **Raise your hand** in the dock (in **More** on a phone) shows your hand on your
    tile and puts you first in People, after anyone who raised theirs before you; **Lower your hand** takes it down. Whoever
    hosts lowers someone's hand from their **⋯** (**Lower hand**), on their tile or in People, once they've had their turn.
    Each raise has its own identity, so an old lower can't take down a newer raise, and a hand stays up through a reload or
    a move to another device. In a breakout room, it asks the organizer for help.
15. **Ask, vote and resolve questions** in Chat's **Questions** tab (above, under Chat), by name or anonymously. Another
    room's questions never become main-room questions.
16. **Nudge someone quietly.** Someone's **⋯** has **Nudge Kofi**, a step in the same menu headed "Only Kofi sees it":
    **You’re muted**, **Can’t hear you**, **Slow down a little** or **A bit louder**. Only they see it, as a quiet toast on
    their side ("Kofi can’t hear you"); **You’re muted** offers **Unmute** while they are. Nobody else is told, whoever hosts
    included. The same nudge from several people within a minute is one note that says how many ("3 people can’t hear
    you"), and the same again from you meanwhile changes nothing. You're told "Kofi got your nudge: Can’t hear you". Only
    someone in your part of the call can be nudged.
    If you talk with your microphone muted, the top of the call says "You’re talking on mute", with **Unmute**, from how
    loud your microphone is here alone: nothing of it leaves your device.
17. **Let someone in from People.** Someone asking to join gets a card on the stage, and the faces at the top right count
    them for whoever hosts; People opens with them first, with **×** and **Let in**. A withdrawn, resolved or expired request
    disappears, and a stale press never claims that someone joined.
34. **Set your status.** Your own tile's **⋯** opens **Set a status**: **Be right back**, **Listening only** or **On my
    phone**, and **Back in** 2, 5 or 10 minutes. Everyone in the call sees it at the top left of your tile with the time
    you're back ("Be right back · 14:37"), and on your row in People; Be right back dims your tile, and a line along its foot
    counts the time down. It goes when its time runs out, when you talk, or with **I’m back** in the same menu, and stays
    through a reload.
35. **Find someone, and write to them.** **Find someone**, at the top of People, narrows every list in it by name; **Message
    privately** on someone's row opens Chat with only you and them.

**Sounds.** Successful microphone on/off transitions and fresh joins, departures, hands, questions and host admissions
have short speaker cues. Room changes and reconnection synchronize without playing history. **More → Settings → Notifications** has Sounds (silence, volume, and a sound to play at that volume), **Quiet mode** and a Sound tick for each cue in What reaches you, also for guests.
Settings has the same account preferences. Quiet mode retains microphone confirmations and host admission cues; browser
notification permission is independent. Sound uses your selected speaker and never enters the outgoing call or notes.
If playback is blocked, hands, People and their counts still work.

### The call's timer (journeys 6.26–6.28)

26. **Start a timer for everyone.** Whoever hosts has **Timer** in the top bar (its icon alone on a phone). It opens
    **Timer for everyone**: the length, big, then **1 min**, **3 min**, **5 min**, **10 min** and **15 min**, a minute less
    or more, and **Start**. Once it starts, the button is the countdown, the same second for everyone in the call.
27. **Pause it, add a minute or stop it.** The countdown opens the same popover, with **Pause** (then **Resume**),
    **+1 min** and **Stop**. In its last 30 seconds it turns the caution colour with a warning sign. At zero a soft chime
    plays and it counts up, over time (`+0:12`), until the host adds a minute (counted from then) or stops it. **Stop**
    brings **Timer** back for another.
28. **Follow the timer.** Everyone let in, guests too, sees the countdown in the top bar, over the stage in focus and in the
    floating call. Pressing it opens the same popover, which says only the host can change it. Joining late, reconnecting
    or a tab in the background shows the same second; the chime follows **Sounds › Timers**. Whoever hosts now, a stand-in
    too, controls it.

**6.29 Choose what others see behind you.** Before joining, **Background** opens its window: a big live preview of you, and
blur, a picture or a colour beside it, applied as you pick. During the call, **Background** in the camera's menu opens the same
window. The preview and outgoing video use the same local effect;
switching a camera or turning it off/on keeps the choice, remembered on this browser/device. When the device is busy the effect
drops to a lower processing quality and recovers when it can, without a word in the call or before joining: the chosen background
stays on, and while it's below full quality, Background's window says so under its preview.
A browser without effects explains that and offers **Choose Off**. A background that cannot load, is no longer kept here or
stops processing turns the camera off and says so: choose another background, or **Off**, then deliberately turn the camera on.

### Floating call

**6.22 Keep the call in view.** On a supported desktop browser, **Open floating call** in **More** opens a small,
movable and resizable window over other apps. It shows the speaker or a selected live shared screen, with the same
microphone, camera and raised-hand state as the meeting. Its controls act on this call. Closing the window keeps you
in the call; **Return to call** brings the meeting forward. **Leave** asks only whoever hosts, in the window, with the
same choices as the main stage (flow 7); other participants leave immediately. Both save the last recording pieces
before departing, and a failure keeps the call open with an explanation and Leave available to retry.

Hands, open Q&A, people asking to enter (for the host), and new chat have compact indicators that return to the full meeting: hands and people asking to enter open People, and Q&A and chat open Chat. The compact and full meeting controls share one confirmed action owner and the same speaker cues.
The window shows no personal notes or message text. Its Chat count includes unread mentions; opening Chat returns to
the full call, where **Open mention** finds the exact message and reading it clears its mention attention.

On a supported secure site, the call floats automatically when you switch tabs, subject to the browser's permission.
There is no separate Alcove preference; the browser controls this choice and may show its permission question.
An already-allowed live microphone can stay muted. The call never requests camera, microphone or screen access just to
enable automatic opening. **More** keeps **Open floating call** for when manual opening is needed. Minimizing Chrome and
switching tabs are different browser behaviors; an already-open floating window can remain over other apps.
Unsupported browsers keep the normal call controls.

When this browser can’t float a call, More keeps the unavailable action with an explanation linked to it for assistive
technology. If the browser refuses an opening, More stays open with permission guidance and the manual action available
to try again. Nothing retries by itself, and the call keeps running in this tab.

See [Floating call](../engineering/floating-call.md) for browser capabilities and verification coverage.

### The call's workspace

1. **Workspace**, at the top right, or **W**, opens the workspace on your stage, just for you: nobody else's screen changes,
   and the people sit beside it. **Open**, at the top of Notes, opens it on the call's notes. The count on the
   button is what's been brought to this call. Every call has a home, where its notes and transcript go: the workspace it
   was scheduled with, as a continuation, or the one its series has; else, the first time anyone opens it, a new one made
   for the call, named after it and the day (**Launch check-in · 5 Nov**), with the organizer and everyone invited in it.
   Everyone let in to the call can open it and edit it, guests too (step 3). Its bar says "Only on your screen" and, beside
   that, "Everyone in the call can edit", or "You can edit while you’re in the call" for a guest or anyone else not in the
   workspace, which opens **Who’s in it**: the workspace's people, and everyone in the call. The workspace's name, on its
   bar, is its one menu: **Switch workspace** for the organizer (step 2), **Find in the workspace**, **Who’s in it**,
   **Rename** for an admin, and **Copy link**; a guest's has **Find in the workspace** and **Who’s in it**. The list's head
   has only **Find** and **+**. At the top of the list is **This call**: the call's own folder in its home, named after the
   call and the day as a new home is, with **Notes**, **Follow-ups** and **Transcript**, then whatever's made in it, and
   what's been brought to the call. What you make during the call (**N**, **+**, **New document**) goes in This call. A
   home for several calls has a folder for each, the newest first. Everyone sees the same workspace, late or back from a
   reload. It opens on this call's agenda, or the first thing brought to it, or with neither on what you had open there
   last. Anyone who can open a document can bring it from its row's menu (**Bring to this call**, **Take out of this
   call**), or by dropping its row on This call. Pressing
   Workspace or **W** again, or **Close** on its bar (which asks first while you present it: step 5), puts it away and keeps
   your place: the document, where you'd scrolled to, your caret and your undo, for the rest of the call and across a
   reload, so opening it again takes you back there. A list that gives way for want of room comes over the page from the
   button at the top left of the page, until you open something or press **Esc**. The call's letters (**M**, **V**, **C**,
   **B**, **W**, **O**) and the workspace's **N** sleep while the caret is in a document, for a moment and a half after a
   key goes into one, and, when what held the caret goes from under it (a presentation taking your stage, or the workspace
   switching), until you click, tap, Tab or Esc: the rest of a sentence never mutes you or makes a document somewhere else.
   Focus lands on the document taking the page's place, where a key does nothing.
   - **Someone presents while you're writing:** what they present takes your stage, with a toast, and you follow it. If
     it's the workspace, you follow them in it: what you wrote stays where you wrote it, and **Unfollow** takes you back
     there. If it's something else, the workspace keeps your place, caret and undo, and **Workspace** takes you back to
     exactly where you were. If you're watching someone else's presentation, it comes in as a tile among the people
     instead, with **Join**, and a toast offers **Show it**; **Show beside** puts it beside the one you're watching, and
     closing either leaves the other.
   - **Focus** (**⌘⇧F**, or "Fill your window with it" on the frame's bar): the bars slide off, the people keep a rail
     of arches at the right, and your microphone, camera, **Show everything** and Leave stay. You still see who's talking and
     who has a hand up, and the faces at the top right still count anyone asking to join. **Show everything**, **⌘⇧F** or **Esc** brings it all back as it was, with the caret where you left it.
   - **Working together:** with the workspace open, hovering someone's tile offers **Follow** if they're in it (an arch has it in
     its menu, and People has it beside where each person is); the tile says **Following**, and shows a pen while they write.
     On a phone, tapping someone's arch opens their card as a sheet: **Follow** (or **Stop following**), **Go to where
     they are**, **Tag them in this document**, and **Pin, volume and more** for the rest of their tile's options.
     **@** lists who's in the call first, then who's invited, then the workspace and the company, and tagging someone in
     the call lights their tile for a moment. Tagged while the workspace isn't open, you get the same toast, a little later:
     **Go there** opens it on the line. Putting the workspace away, or opening something else on your stage, stops
     following, and for everyone else you've left it.
   - **While breakout rooms are open** the organizer's stage, in the main room, shows the rooms, and the workspace stands
     beside them, as anything else open there does, the rooms where the people would be; Workspace, **W**, Find and the
     notes' **Open** all open it there. On a phone, or a window too narrow for both, the workspace goes over the rooms until
     it's closed. Focus isn't on offer there until the rooms close; in a room, it is, as for anyone.
   - **An organizer taken out of the workspace** everyone's viewing is told so, and **New workspace** has everyone view one
     of their own. The workspace's own people carry on. Once its organizer can't edit there, taken out or left only able to
     read it, it stops opening to everyone else in the call, who's told it's private (step 3).
2. **Only the organizer switches what everyone views**, from **Switch workspace** in the workspace's name on its bar: their
   workspaces they can edit in, with who's in each, the call's home marked **This call's home**, and **New workspace**.
   Picking one asks once, in place: it names who in the call isn't in that workspace, and says that while they're in the
   call they can open and edit everything in it, that anything closed to some people stays closed, and that the notes
   still go to the home. A workspace whose files don't count against the organizer's storage asks differently: those people
   can't open it, "Its files don’t count against your storage, so it opens only for its own people."
   **Switch** changes the list for everyone at once and opens it to everyone in the call (only to its own people when
   someone else pays for it), a toast says where the notes still go (in two lines at most), and **Back** on it changes it
   back; it goes when the call ends, or when Leave asks its question. The question takes focus as it opens, and **Tab** reaches its answers. Someone
   following someone stops, and is told the call's workspace changed. The call's Notes, Follow-ups and Transcript stay at
   the top of the list while another workspace is viewed. Nobody is interrupted and nothing is moved or copied: sound and
   video carry on, and the workspace the call was using closes to anyone who had it only through the call. What was
   brought to the call from the workspace before stays with that one. **New workspace** makes one for the call, with
   everyone invited in it to edit, as its home has (a guest without an account isn't, and edits it through the call, as in
   any workspace the call uses), named after the call, and opens a blank document in it; it's still there after the call.
   The home doesn't change: the next call in the series still has it. Everyone else sees the name, and that the organizer
   chooses.
3. **Everyone in the call can open it and edit it**, a guest or anyone else outside the workspace too, for as long as they're
   in the call and what's added counts against the organizer's storage: its folders, documents and boards, and its name,
   as its people see them. They work in it as anyone who can
   edit there does: make, rename, move and duplicate things, send them to Trash and bring them back, and write. A member
   who can only read can edit too while they're in the call. What someone closed to some people stays closed to them, and
   changing who's in it, sharing, deleting for good and renaming the workspace stay with its people. Leaving the call, or
   the call ending, closes it for them, and what they wrote stays. If the organizer can't edit there any more, or its
   files count against someone else's storage, it opens only to its own people: anyone else is told it's private, and nothing else, no names, no folders, nobody's whereabouts,
   and carries on with the call.
4. **Notes, Follow-ups and Transcript** are This call's first rows, in the call's folder in its home, and stay at the top of
   the list wherever else, for everyone in the call, whether or not they can open the workspace, and the count is what's
   still to do. They fill in as people talk. With notes off they go quiet and say why they're
   empty, and the organizer can turn notes on from there while anyone else asks; if something's written already it stays, and a line
   says what's holding the notes back. **Notes** is the summary and what's been decided so far, and a time opens the transcript at
   that moment. **Transcript** is the whole call so far, with who's talking at the end, and finds any word. Notes and Transcript
   open on your side, beside the document, from the button on their row, and **Open**, at the top of the Notes panel, goes the
   other way.
   - **Follow-ups** is a stable shared checklist: what people added or accepted, and the to-dos with a person and a date in the
     documents worked on in this call, each for whoever can open it, as **Everyone** or **Mine**. Ticking one is done for everyone
     and ticks the line in its document; its source opens that line. **Add a follow-up** lets someone write the task, choose who it
     is for or leave it unassigned, and set a date. Tasks can be edited without the notes model changing their words underneath.
     A quiet count offers **suggestions from the call**. **Review** opens a fixed batch below the list: **Add** or **Dismiss** a new
     task, or **Apply change** or **Dismiss** proposed changes to an existing task, with the old and new values shown. New arrivals
     wait behind a separate count. A suggestion resolved by someone else says so; stale words cannot silently be accepted. Adding
     a task does not mean its owner has said “I'll do it”. Pending suggestions are not unfinished tasks. The same review remains
     available in the notes after the call, without holding up leaving. A guest with the link reads only what is written for them
     and cannot add, edit or review for the group. Notes off stops new suggestions; existing tasks stay.
   - **Sending to a document:** the arrow on a line sends it to the document you were last in, if you can edit it: something decided
     as a line, a follow-up as a checklist line tagged with who and when, which is then the same follow-up, and a line of the
     transcript as a quote with who said it and when. It lands where you can see it, or a toast says where it went and **Go there**
     opens it. With no document to send to, there are no arrows.
   - **From the call** in **/**, first in the list during a call, before Write and Add: **Decided so far** and **Follow-ups so far** fill in as the notes do, for everyone in the document,
     and nobody types them. When the call ends they stay as they were. **Quote what was said** picks from the last few lines. With
     notes off they say so.
   - **Hear it** on a quote plays that moment, when the call keeps its recording: during the call for anyone in it who was
     there for that moment, guests included (a guest never hears what was said while they were away), and after it for
     everyone with the notes. It plays on the speaker chosen for the call, and turns while the recording comes. When it can't
     play, it says why beside the button: "Not in the recording yet. Try again in a few seconds." for a line just said, whose
     piece of the recording is still on its way, and pressing it again then plays it; "This browser couldn't play it.";
     "You can only hear what you were there for." for a guest with the link, who hears only what they were there for; or,
     for anyone else, "This part of the recording can't be played.". A quote from a call that doesn't keep its recording
     says "This call doesn't keep its recording.", and one said in a breakout room, which is never recorded, "Breakout rooms
     aren't recorded.", with no Hear it.
5. **Present the workspace**, from **Present** on its bar while it's only on your screen (on a phone too), or with
   **Share › The workspace** in the dock, for anyone it opens for, guests too, while nobody else presents a board or the
   workspace (Share says "Priya is presenting. You can present once they stop."). Everyone in your part of the call who
   isn't watching another presentation follows you, live, to the page and the line you're on, through the same Follow as
   working together, and you're told "Everyone follows you in the workspace. They can unfollow to work alongside you." The
   bar says how many follow ("You’re presenting · 3 following").
   - **Everyone else** finds it on their stage, unless they're watching another presentation, when it comes in as a tile
     with **Show it**. The bar says "Priya is presenting" and "Following Priya". **Unfollow** gives them their own place
     back, where they were before they followed, and a click, scroll or keystroke in it leaves them where they are, on their
     own: to open another document and write alongside Priya, with her face showing where she is. **Follow Priya** ("Priya
     is in Launch plan") takes them back to her page and line. **Close** closes it for them: while Priya presents it's a
     tile among the people, saying where she is, and **Join** takes them back in, following.
   - **Ending it.** While you present, **Close** (or the lit **Workspace**, or **W**) asks: **For you** ("You stop
     presenting."), and everyone following stays in it, working on their own; or **For everyone**, and it closes for
     everyone in the call. With nobody presenting it, Close closes it at once: there's nobody else to close it for. The
     organizer can close anyone's for everyone from its name, and whoever presented it is told who did ("Art closed the
     workspace for everyone."). It also ends when the presenter leaves the call for good
     ("Priya left the call, so the presentation ended"), is removed or moved to another part of the call ("Priya stopped
     presenting the workspace."), when they present something else in its place, when their breakout room closes, when the
     workspace everyone views switches, or when the call ends; each ends it at once, as the call says it. Going to another
     part of the call yourself leaves what was presented where you were, without a word. A reload doesn't end it: nothing
     is said, everyone's screen keeps it as it was, and it carries on when they're back; only if they aren't back within
     half a minute is it said to have ended. When it ends, its tile goes, and whoever was following keeps it open on their
     own unless it closed for everyone. Nobody's access changes: someone who can't open it is told who's presenting, never
     what.
6. **Play for everyone**, on a video in a document, plays it at the same moment on the screen of everyone who can open it,
   from the workspace: no screen share, and nobody hears it twice. Late joiners land at the same moment.
   - **The bar** above the dock says what's playing and who started it, and has your own volume. Whoever started it, or the
     organizer, can pause it for everyone, move it along, and stop it with **×**.
   - **If your browser holds it back**, the bar says so, and **Play here** brings you in. Paused with your computer's own
     pause key, **Back to everyone** puts you where everyone is. A file your browser can't play says so.
   - Losing the document, a new workspace, another room or the call ending stops it, and the video stays where it is.
7. **After the call**, the note has **Worked on in this call** under the follow-ups: each document worked on and by whom
   ("Priya and you edited this"), for each person only what they can open. Each opens in the app, in your theme: the same
   document, nothing copied. Each document keeps a version of how the call left it. **The next call in a series** finds a
   new agenda beside the last one, at the top of This call, holding only what was left open.
8. **⌘K** finds anything in the workspace from anywhere in the call. It opens the workspace on your stage first if it isn't
   there, so the line it lands on is one you can see.
9. **Ask** on what's selected (flow 12) answers **What was said about this?** from this call: everything said in it that you
   may read.
10. **History** files what was worked on under the call: **During this call** while it's on, and after it under the call's name
    for anyone who has its notes.

### A board in the call

1. **Board**, at the top right, or **O**, opens the board picker under it: "Open a board" and "Only on your screen until
   you present it. Everyone in the call can edit it." **In this call**, if the call has a board, has its name and who
   brought it ("Priya · brought it"), or "Priya is presenting it". **New** has **Blank**, **Retro**, **Ideas** and
   **Flow**. **Your team’s boards** has whatever's been brought to this call first, then the newest from the workspaces
   in your Drive, three at most, with whose each is and where it's from. At its foot: "Boards are encrypted in storage."
   Anyone invited can start one, in the main room or a breakout room; a guest can't ("Guests can’t start a board
   here."). While someone else presents a board here, nobody can start or bring in another, and the picker says "Priya
   is presenting a board. You can start one once they stop." With a board on your stage, Board and **O** close it
   instead (step 5). **Share › A board** in the dock is the same picker, as Share's next step, presenting what you pick
   straight away (step 11); while someone else presents a board or the workspace here it says "Priya is presenting. You
   can present once they stop." instead, and nothing is made or brought in. On a phone, Board is in **More** (step 14).
2. **It opens only on your screen.** The board you pick opens on your stage, in the frame ("Only on your screen"), with the
   people beside it, and nobody else's screen changes. A saved board some people here can't open asks first (step 3).
   **New** makes a board, saved in This call, the call's folder, and named after the call, that's the board in this part
   of the call: the one votes, ideas from the call, breakout rooms and the note's **Worked on in this call** hang on.
   Everyone in the call can edit it, guests too. It still opens only for you, and everyone else finds it under **In this
   call**. Vote and ideas from the call show on the board in the call, not on a saved board you opened yourself. Someone
   else starting a new board while you have the call's open leaves yours on your stage, just for you. **Present**, on its
   bar, brings everyone (step 11).
3. **A saved board some here can't open asks first.** Picking one that's in a workspace some of them aren't in, or
   closed to some people, asks once, before it opens: "Let everyone here edit Onboarding flow?", that Kofi and Maya can't
   open it now, and that while they're in the call everyone here can open it and edit it. **Open it** opens it and lets
   everyone here edit it until the call ends, anyone let in later too; **Not now** goes back to the picker. Someone who
   may not share it gets **Open it anyway** instead, which lets nobody in. A board in the workspace the call uses that
   isn't closed to anyone asks nothing: everyone here can open it already. Someone it isn't open to sees **A board you
   can't open** and who brought it, and nothing of its name; **Ask Art for access** asks in the call's chat.
4. **Working on it together.** Everyone's pointer carries their face and name, with dots while they type, and whoever's
   talking glows on their tile and their pointer. While Priya's on the board, unless it's being presented to you, her
   tile's menu has **Go to Priya**, which takes you to where Priya is, and **Follow Priya**, which keeps your view with
   Priya's, with a ring in her colour and a pill at the top of the board, until **Stop**, Escape, a scroll or a zoom. The
   pill shows one thing at a time.
5. **Close is for you.** **Close**, on the frame's bar, or pressing the lit **Board** (or **O**), closes a board open just
   for you, and nothing changes for anyone else. On a board someone else presents, it closes it for you: while they present
   it, it's a tile among the people, and **Join** on the tile takes you back in, following. A board nobody presents has no
   tile. While you present it, Close asks first (step 11). Someone moving the board in the call to Trash, or deleting it,
   takes it out of the call for everyone, and whoever had it open is told which ("Launch retro was moved to Trash, so it
   closed for everyone."); restored, it's the board in the call again.
6. **Beside a shared screen.** While you're on a presented board, a share that starts comes in as a tile among the people,
   with a toast and **Show it**; opening a board just for you puts a share that's on your stage away as a tile, still live.
   **Show beside**, in the **⋯** on the share's tile, puts it beside the board, as two screens sit side by side, and closing
   either leaves the other. Nothing you're doing on the board stops. With the board in the call beside it, **Put on the
   board**, in the share's name, puts a picture of the share as your browser shows it on the board, captioned "Priya's
   screen, 14:05", and Priya is told. It's kept in the board's files, whether or not the share is in the notes. It's for whoever
   can add to the board, and isn't offered for your own screen.
7. **The board's name**, on the frame's bar, is a menu. It has **Rename**, for anyone who can change it, and everyone sees
   the new name at once, wherever it's named: a saved board renamed while it's in the call is under its new name in
   **Board**'s list once it's closed for everyone, and opens again with it (journey 6.37); **Open where it’s saved**, which brings up
   that workspace if it's the one the call is viewing and opens any other in a tab of its own;
   **Who can add to it**, for someone in that workspace who can edit the board, which opens the workspace's own **Share** for
   it under the name (add people by name or address, change what each can do, or keep it to the people added; someone it
   becomes read-only to sees it as **View only** at once, and once it's kept to the people added, nobody's told everyone here
   can add to it); **Copy link**, **Download as an image**, **Download as a PDF** and **Night board**, as the bar's **More**
   has (step 13); and, for
   the organizer, on a board someone else presents, **Close it for everyone**. Whoever presents it closes it for everyone
   from Close's question (step 11). Closing deletes nothing: the board stays saved where it is. The board's seal says
   what's true of this board: who can add to it, where it's saved, and that it’s encrypted in storage. It says
   how the board stands too, as on its own page:
   - **Reconnecting**, when the board's connection drops while the call carries on. The pill at the top of the board says
     "Keep going. Your changes are safe here." What you add goes up once the connection's back, with nothing lost or doubled.
     While the browser is online, the pill and the seal have **Try now**, which tries the connection again at once rather
     than after the wait. It tries by itself, a little later each time up to every 10 seconds, and, between tries, at once
     when the browser comes back online, the tab comes back into view, or the board goes back on your stage.
   - **Not saved**, when Alcove won't take what was added. The pill says **Couldn't save** and how many changes are only on
     this screen ("Your last 3 changes are only here."). For anyone signed in, whose browser keeps them, it has **Try
     again**, which opens the board again and sends them. It tries again by itself as well.
   - Pressing the seal says the same, under the pill. A board that can't be opened right now opens again by itself, a little
     later each time.
8. **Votes**, on the board's bar, for anyone who can add to it. A board has no timer of its own: the call's **Timer** is the
   one countdown, over the board too ([The call's timer](#the-calls-timer-journeys-626628)). **Vote** votes on the frame
   you're looking at (every sticky, with no frame in view), 3, 5 or 10 votes each, and the board glides to it. Its menu
   names the frame, "Vote on Could improve", and where frames share a name, which of them, in the order they sit: "Vote on
   Could improve, the second of two". Whoever presents the board votes on the frame they show (step 11). A vote reaches
   everyone in this part of the call who can add to the board, and so vote in it: anyone without it on their stage is told
   "Priya started a vote on Launch retro." with **Vote**, which opens it there on the vote's frame, and everyone following a
   presentation of it votes as they follow. Someone who can only look at the board isn't told, as they can't vote. After
   **Start the vote**, pressing a sticky spends a vote and shows a dot only you can see, and pressing it again takes it
   back. From the keyboard, Tab from
   the board goes from sticky to sticky in the vote, frame by frame and row by row, with the board gliding to one out of
   view, and on past the last; Shift and Tab go back. Enter or Space votes for the sticky you're on, and again takes the
   vote back. A screen reader hears each sticky's words as a toggle button, pressed once it has your vote and dimmed while
   you've no votes left to give it, and the pill says how many you have left as that changes. When the vote ends, the keys
   go back to the board. Nobody sees a count until
   whoever started it, or the organizer, presses **End the vote**: every count appears at once, for everyone, the top three
   stay bright and the rest step back, until **Done**. The pill shows one thing at a time: how the board stands (Reconnecting
   or Couldn't save), then a vote, its results, and following someone. Someone presenting is the frame's bar's to say.
9. **Ideas from the call.** While notes are on where you are, the call picks out things people said that are worth a sticky,
   and a pill rises at the foot of the board: **3 ideas from the call**. Nobody has to stop talking to write them down.
   Pressing it opens the tray, **From the call**, written in confidential compute like the notes: each line is what someone
   said, with who and when ("Priya, 2 min ago"), and **Add**. Adding one puts it on the board as a sticky, in a free spot in
   the frame it fits and that frame's colour, and it goes from everyone's tray; it says **Added** in yours. **Add all
   three** (or **Add both**) adds the rest at once, popping in one after another, and says "Added 3 stickies from the call."
   with **Undo**, which takes back those three and nothing you've done since. Two people adding at the same moment get their
   stickies side by side, never one on another, and the same idea added by both is one sticky. Closing the tray (× or
   Escape) puts what's left aside for you alone; the pill comes back when there's something new. While the tray is open the
   call's keys work as ever: O, W, and Escape for your side. Ideas are only for people who can add to the board, only from
   what everyone there may read, and never while notes are off or paused; a room's ideas stay in the room. They wait while
   the board is presented to you, or by you.
10. **Sort into themes.** Drag round several stickies (or Shift-click them) and the bar offers **Sort into themes** beside
   **Tidy**. It sends what they say to confidential compute, says **Sorting…** meanwhile, and moves them into named columns,
   each in its own colour, inside their frame: "Sorted into 3 themes." with **Undo**, and one Undo puts it all back. It
   works with notes off, and on a board's own page. While notes are paused nothing goes to the AI, so it isn't offered.
   Fewer than two stickies with words says "Pick at least two stickies with words to sort.", and more than 80 "Sort up to 80
   stickies at a time."
11. **Present.** **Present**, on the frame's bar of a board you can add to while it's only on your screen, or **Share › A
   board** in the dock, brings everyone with you, following your view, with nothing to prepare. It's still the board, tools
   and all, for everyone: nothing turns into slides. Neither is offered while someone else presents a board or the workspace
   here. The frame's bar has no Present on a phone, where **Share › A board** presents one. A saved board comes into the call
   first (step 3).
   - **Whoever presents** is told "Everyone follows you on Launch retro. They can add to it as you go.", and the bar says
     "You’re presenting · 3 following". The board glides to its first frame as it starts, and from there it's yours to move
     round: drag, scroll, zoom and **Show the whole board** as ever, add to it, start a vote (step 8), and everyone following
     sees all of what you see, whatever's outside the frames and the lines between them included, whatever the shape of their
     screen: a wider or taller one shows more round it, never less of it. At its foot, for you alone, the pager steps through
     the frames in the order they sit on the board, top to bottom and left to right, so the order can be told from the board:
     the arrows on either side of "1 of 3" and the frame's name glide your view, and everyone with it, to the frame before or
     after. The frame stays fitted to your screen as that changes size (**Your notes** opening beside it, say) until you move
     off it, and when your own view comes to rest in a frame, the pager says that's where you are. Someone moving frames round
     meanwhile never changes which frame you're on: the pager, Your notes and "Art is in Could improve" stay with it, at its
     new place in the order. With an account the pager has the notes button, which opens **Your notes** on your side: where
     you are ("1 of 3 · you’re sharing it"), your own notes beside this frame, each frame its own and kept for next time
     ("Kept for next time. Only you see them."), and the next frame, drawn small ("Next: Could improve", or "That’s the last
     one"). A board with no frames has no pager. Your pointer shows to everyone. Opening something else on your stage puts
     the board away as a tile with **Open**, and you go on presenting; everyone following stays where you left them until
     you're back.
   - **From the keyboard**, **→** and **←**, and a clicker's Page Down and Page Up, glide to the next or the last frame while
     the presentation has the keys: the board itself, or the pager's arrows, where the keys go as it starts (**Next frame**,
     as soon as the pager shows, so **→** moves on straight after **Present**; the board itself, on a board with no frames).
     Anywhere else they move nothing: while you type, in Your notes, on a tile on the stage, in the rooms' setup, or on the
     page with nothing chosen.
   - **Everyone else** follows: they see the presenter's view as it moves, with their own tools to hand, and "Art is
     presenting" and "Following Art" on the bar. Anything of their own on the board (a press, a key, a scroll, a drag) is
     theirs: it takes them off following, from where they are, and does what they did, so a double-click in a frame is a
     sticky there and the first press is never lost. A vote on a sticky (step 8) changes nothing on the board, so they vote
     and go on following. **Unfollow** gives you your own view back, as you left it; **Follow Art** ("Art is in Could
     improve") takes you back to Art's view. Art moving on never pulls you back, and only you stop following: the board
     opening again under you (**Try again**, or by itself once it can) keeps you with Art. Someone who comes in late follows
     Art from wherever Art is. Someone who can only look at the board follows the same way, looks round, and changes nothing.
   - **Close**, while you present it (or the lit **Board**, or **O**), asks: **For you** ("You stop presenting. Everyone else
     keeps it open, on their own."), and everyone following stays on it, working on their own, and it's still the board in the call; or **For
     everyone** ("It closes for everyone in the call."), which closes the board in the call too: "Closed for everyone." The
     organizer can close anyone's for everyone, from the board's name, and whoever presented it is told who did ("Art
     closed Launch retro for everyone."). **Stop sharing**, in Share, asks the same, wherever the board is: on your stage,
     a tile, or out of sight. If the presenter leaves the call, it ends too, and its tile goes. When it ends, whoever was
     following stays where it left them. Nobody's access changes: someone who can't open the board is told who's presenting,
     never what.
12. **More**, at the foot of the tools, for anyone who can add to the board. **Image** puts a picture from this computer
   where you're looking, kept in the board's own files and sealed as the board is; everyone who can open the board sees it,
   and nobody else. **From your workspace** lists what you can open in the board's own workspace, the board aside, and puts one
   on the board as a card. It offers nothing from anywhere else, so a link only ever points where the board's readers can
   reach: each person sees it by their own name for it, opens it from the card (in the call when everyone's
   viewing that workspace, in a tab of its own otherwise), or sees "A document you can't open" and nothing of its name.
   **Table** puts three by three where you're looking with its first cell open; Tab goes along a row and on to the next, and
   a row and a column are a press away while it's picked. Two people typing in one cell at once, an empty one too, both keep
   what they type. **Mind map** starts an idea: Tab branches from it, and Enter adds another branch beside it; two people
   branching from one idea at once get one branch under the other. **Comment** (or **K**) opens a comment on the sticky
   you've picked, or with nothing picked on the next thing you press: your face pins to its corner, everyone in the call
   sees it, and it's there on the board's page afterwards, by your name. **Templates** puts Retro, Ideas, Flow or What, why, next beside everything on the
   board, and the view goes to it. Whatever More adds lands in the nearest clear place to the middle of your view, never on
   anything, and the view follows it if that's out of sight. Undo takes each back while nobody's touched it.
13. **More**, at the end of the board's bar. **Copy link** copies the board's address, which opens it for whoever can open
   it. **Download as an image** and **Download as a PDF** save the board as you see it, every linked document named as you
   know it or "A document you can't open"; it's drawn and saved in your browser, and comments aren't in it. Those three
   change nothing, so someone who can only look has them too. **Night board**, with the moon, for whoever can change the
   board, makes it a dark board in any theme, a dark board by day, for everyone and everywhere it shows: on the stage, as a
   tile, on the note, presenting and on its page. A toast says what it did, for whom: "Night board is on. The board is dark for
   everyone, whatever their theme.", which is how someone whose own theme is dark knows it worked. It has a tick while it's
   on, here and in the board's name menu (step 7) alike, and pressing it again lets the board follow each person's theme:
   "Night board is off. The board follows each person's theme."
14. **On a phone**, **Board** is first in **More**'s grid and opens the same picker, and a board's frame has no Present:
   **Share › A board** presents one. Faces stay on top, under the line over the call when it says anything, and the board
   fills the rest, opening on its first frame at a size it can be read. Drag to look round and pinch to zoom; the bar keeps
   the name, the seal, **Show the whole board**, which shows all of it however big, further out than a pinch goes,
   **Vote** and **More**, and what the pill says wraps rather than being cut. Dragged off into empty space, the board offers
   **Back to the board**, as anywhere. The one tool is
   **+**, at the bottom right: a sheet rises, night as the call is, with one sticky, its colours and a button that says
   where it's going, "Add to Went well" for the frame in the middle of the view, and the sticky goes into that frame's first
   free place, wherever someone has moved the frame meanwhile. Ideas from the call are there too: tap the pill, then **Add**
   or **Add all three**, and the toast's **Undo** takes them back. In a vote, a tap on a sticky votes for it and another
   takes it back. Drawing and moving things stay on bigger screens.

### Boards in breakout rooms

1. **Set up rooms.** The rooms panel has one more row: **Board**, with **None**, **In each room** and **Shared**. In each room:
   "Only that room sees its board. When rooms close, every board comes back to the main room.", and what each starts from
   (**What, why, next**, Retro, Ideas, Flow or Blank). Shared: "One board, a frame for each room. Everyone can see every frame
   while they work.", on the board open now, or a new one from what you pick. **Open 2 rooms** sends everyone, and every room
   already has its board open: "2 rooms are open. Each one has a board."
2. **Inside a room.** "Art opened rooms. You're going to Rollout." You arrive on the room's board with its frames ready. Its
   seal says **Sealed to this room**: "Only the people in Rollout can see this board.", "When rooms close it comes back to the
   main room, and everyone in the call sees it." and "Encrypted in storage." Whoever's moved to another room
   loses it as they go, and finds the new room's. The pill at the top of the board says the room and how long it has left
   (**Comms · 9:12**): in its last minute it turns amber and says **This board comes back with you**, and in the last ten
   seconds **Rooms close in 10 seconds**, counting down. A screen reader hears it at ten seconds and as rooms close, not every
   second. While the board's pill says it, the line over the call doesn't; while the pill shows something more pressing, such
   as a timer, the line over the call says where you are and how long is left. Art's message to every room comes as a toast,
   "Art, to every room: Two minutes left", so nobody has to leave the board to read it. **Raise your hand** asks Art for help,
   and Art coming in is told as "Art joined this room."
3. **Start a board in a room.** With none set up, **Board** is where it always is, and the same picker, with no boards your
   team has, says at its foot "Comes back with you when rooms close." A new board is the room's: it
   opens on your stage, just for you, until you present it, and everyone in the room finds it under **In this call**. Nobody
   outside the room can see it, the organizer included, until they join.
4. **While rooms are open** the organizer sees who is where: each room on its board says "On their board. Join to see it." in
   the panel and on the stage, with no preview. **Join room** puts them in the room and on its board; **Back to main room** takes
   the board away with the room's keys.
5. **When rooms close** everyone's back in the main room, and each room's board lands on the main board as a frame, named for the
   room with who was there: "Everyone's back. 2 boards came with you." Its stickies come, and its pictures stay in the room. The
   board glides to the frames as they land, for anyone who stayed on it too, unless they're following someone or in the middle
   of something. With no board open in the main room, one is made for them, and so it is when the one open can't take them any
   more (whoever brought it can't edit it now): it opens in its place, and the call says "The rooms' boards came back on a new
   board. The one that was open can't take them." When the call's workspace can't take a new board, they stay where they are:
   "The rooms' boards didn't come back: this call's home can't take a new board any more. Each one is still saved there."
   Afterwards a room's board is a saved board like any other, everyone invited's, and nothing to a teammate who wasn't invited;
   in a workspace someone else pays for, it's only for those invited who are in that workspace, as the call's own board is.
   **Present** then makes each room's frame a stop on the pager, in the order they sit: the room reports back, and the
   organizer moves on.
6. **One board for every room.** With Shared, the board comes onto the organizer's stage as the rooms open, and they watch
   every frame fill up (closed just for them, the rooms take its place until they open it again); when the one
   open can't take the rooms' frames (whoever brought it can't edit it now), the rooms share a new one in its place: "The rooms
   share a new board. The one that was open can't take their frames." In a room you land on your room's frame, hear your room
   only, and the pill says **Everyone can see this board** with the room's time; in the main room it says how many rooms are
   on it (**3 rooms on this board**). When rooms close nothing has to come back: "Everyone's back. The board stays as it
   is.", and the board glides out to all of it.
7. **Rooms with no board**, opened with **None** and with nobody starting one, are as rooms have always been (Breakout rooms,
   above): "You're in Comms for 5 min.", the organizer's message for a moment in the line over the call ("Art to all rooms:
   Two minutes left"), **Ask for help** on the hand, and "Art joined your room".

### Reviewing follow-ups

Storybook journeys **6.23–6.25** show the review alongside the call:

- **6.23 Review suggestions in the call:** open Follow-ups, review a suggested task, and add it to the shared checklist.
- **6.24 Keep a fixed review batch:** new suggestions arrive while review is open and wait behind a count, leaving the current controls in place.
- **6.25 A follow-up changes during review:** another person's change makes the proposal stale; the reviewer sees what happened instead of overwriting it.

## 7. End the call and get the notes

1. **Leave** leaves at once for anyone who isn't hosting, invited participants and guests alike: nothing is asked, on
   the main stage or in the floating call. The last audio and speech are saved before leaving; while that happens,
   Leave is disabled. A failed departure keeps the same call open with an explanation and a way to retry. The call goes
   on for everyone else. In-app navigation does the same cleanup before continuing, and closing or reloading a
   participant's tab doesn't ask.
   Whoever hosts, with anyone else in the call, is asked in a popover over **Leave**, the way Close's question opens (a
   sheet on a phone, and the same choices in the floating call's own window). **End for everyone** ("Everyone invited
   gets the notes.", or without notes "It ends for everyone in the call.") sends the last audio and speech and ends the
   call. When someone in the call can host, **Leave, Priya hosts** leaves it going with the best person chosen already,
   and **Change** lists who else could, in the same popover. The call goes on, the notes with it, and the organizer
   takes it back by joining again. Someone standing in sees leaving it going first. While the call ends the question
   says **Ending the call…**, and a failure is said in it, with the call still open. When nobody here can
   host, End for everyone is the only choice: "Guests can't host, so leaving ends it for everyone." Alone in the call,
   pressing **Leave** ends it at once: there's nobody to hand it to and nothing to choose. Any other way out while alone,
   such as going back a page or answering a ring from another call, asks first, so a stray Back doesn't end a call
   people are about to join: Leave's question opens with **End for everyone** alone ("You're the only one here, so
   leaving ends the call."), and putting it away keeps the call going. The browser still asks whoever hosts to confirm
   closing or reloading the tab.
2. When the call is over for you, the call eases back and fades as its own page rises in, on the call's night over a
   cove. From the top: who was in the call (or who's still in it) in their arches, the title, one line, the notes and
   the buttons, the first one filled. It never moves on by itself.

   | What happened | Title | The line | Notes | Buttons |
   |---|---|---|---|---|
   | You ended it, notes on | {Title} has ended | {n} min with {names} (alone: {n} min) | Being written (step, who gets them), then the summary's first lines with decided and follow-up counts | **Open the notes** (then **Read the notes**), Go to Home |
   | You ended it, no notes | {Title} has ended | {n} min with {names} (alone: {n} min) | No notes were taken. | **Go to Home** |
   | Whoever hosts ended it, you get the notes | {Title} has ended | {n} min with {names} | Being written, then written | **Open the notes**, Go to Home |
   | Whoever hosts ended it, you don't (a guest) | {Title} has ended | {Organizer} can share the notes with you. | none | none |
   | You left, it goes on | You left {Title} | {names} are still in it, and how long it's run (ticking) | As notes were when you left, only if you get them: Notes are on. You get them when it ends. / Notes are paused. You get what was written when it ends. / Notes are off. You get what was written when it ends. | **Rejoin** (J), Go to Home (a guest: Rejoin only) |
   | You hosted, and left it with someone | You left {Title} | {Name} is hosting until you're back (standing in for the organizer: until {Organizer} is back) | the same | **Rejoin**, Go to Home |
   | You left, and it ended while you're here | {Title} has ended | It ended after you left. | Being written (if you get them) | **Open the notes**, Go to Home (a guest: none) |
   | The notes take long, or their progress can't be followed | | | Still being written. They'll be in Calls when they're ready. You don't need to wait here. | as above |

   The page keeps up while you're on it: the notes turn from being written into their first lines, a call you left
   turns into the ended page within about 15 seconds of it ending, and how long it's run ticks while it goes on. Who's
   still in it is who was in the call as you left, without you: once you've left there's no live view of the room.

   A call that ends while you're in it, and not by you, says the same line as one you end. Alcove can't tell whether
   whoever hosts ended it or it ended by itself (the host's connection gone, with nobody to stand in), so the page names
   nobody. A guest is told who can share the notes whenever the call had them. While a call you left goes on, whoever
   gets the notes is told how notes were as they left: on, paused, or off after being on. Paused or off, what was
   written comes to them when the call ends. Notes the organizer's plan stopped aren't said as off: "Your notes for this
   period have run out. What was said until then is in the notes." (or whose, or that storage is full), with the
   organizer's ways to more (16.9).

   **Rejoin** goes straight back in, with the microphone and camera as they were: no join page and no camera preview.
   It says **Rejoining…** meanwhile, waits to be let in when it has to, and says on the page if it's refused; the call
   comes back up in place as its page fades. **J** rejoins too, but with the microphone and camera off, so a stray key
   never puts your voice and picture back into a call you chose to leave; J with Shift, ⌘, Ctrl or Alt does nothing.
   **Go to Home** still works while it says Rejoining…: it's the way out while you wait to be let in, and it takes the
   rejoin back without ending the call for anyone. **Go to Home** and **Open the notes** fade the page, and the frame
   settles in with the side panel easing in. The call's page shows the steps so far (call ended, audio saved, the
   transcript's length, the notes being written), plays the decrypted recording on its stage, and says who has it. Signing out, or deleting your
   account, in another tab takes the page to the welcome page, as it does every other tab, and what it showed of the
   notes goes with it. Reloading the call's address after leaving goes to the join page. Being removed, moving to
   another device, the connection dropping and someone else hosting after a drop don't come here (flow 6).

   Notes are written in the language set in settings by the organizer (or, for a room recording, by whoever recorded):
   "Same as the call" by default. Every note gets a short summary of two or three sentences, and a longer full summary
   under it.
3. Everyone invited gets the notes as the call ends, including people signed in whom the organizer let in
   from the link (letting them in added them to the invite; removing them took them off it). They have them before
   the call closes for anyone in it, so they can follow them being written on its page. They find them under Notes
   when they sign in with that address, marked as from the organizer. Guests who joined with only a name don't get
   them.
4. If the notes service fails three times, the note is finished with its transcript and recording and no
   summary. On a server without NEAR AI, notes wait with "Waiting for the notes service to be connected".
   While the notes model's evidence can't be checked or doesn't check out, nothing is sent; and while it
   doesn't answer, nothing is lost. Either way notes wait with "Waiting for the notes model. The notes are
   written as soon as it’s verified and answering" and are tried again every five minutes.

**Journeys:** 7.1 ends the call and reads the notes; 7.2 leaves it going with someone hosting, then rejoins; 7.3 leaves
as a participant (on a phone, in the light theme); 7.4 leaves as a guest; 7.5 retries a departure that failed; 7.6 joins
another call while in one; 7.7 the call ends while they're on its page; 7.8 alone, pressing Leave ends the call.

## 8. Calls

- **Calls** is every call, ahead and past, in one place: a short band of sky with the search and **Schedule a call**, then
  a rail of places beside a sheet with what the place holds. On a wide screen the rail and the sheet each scroll under
  the sky; on a phone the page scrolls as one, the places are chips at the top of the sheet (**All**, **Coming up**,
  **Past**, **Series**), and **Schedule a call** is the top bar's plus.
- The rail has **All calls**, **Coming up** with how many, **Past calls** with **In the room** and **Shared with you** under
  it, and **Series**, each with when its next call is. At its foot **Google Calendar · Connected** opens Settings at
  Google Calendar. The place you're on is in the address (`/calls?view=soon`, `/calls?series=…`), never any words or
  anyone's address.
- **All calls** shows later today and tomorrow, then **Show 6 more coming up**, then the calls that happened, by day
  (Earlier today, Yesterday, Earlier this week, Last week, then the date). **Coming up** shows the calls waiting for a guest
  to pick a time first, then each day: Alcove calls and, with Google Calendar connected, the meetings on it with someone
  else. **Past calls**, **In the room** and **Shared with you** list what happened, by day.
- A call ahead shows who's on it, its time and length in sun, and only what matters: its series or **From your calendar ·
  Google Meet**, how the others have answered, quietly, and **No notes** only when it won't write them. An invitation
  says **Kofi invited you** in rose, with **Yes**, **Maybe** and **No** as equal buttons; once answered it says
  **You're going** with **Change**, the organizer sees it, and changing it offers **Undo**. When someone invited asks to
  move your call, it says **Diego asks to move it to 14:00** in rose, with **Move it** (it moves, and Google Calendar
  tells everyone invited, with **Undo**) and **Keep 11:00**. A call scheduled or moved a moment ago is lit once, and says
  **Just scheduled** or **Moved**.
- A call that happened shows who had it, how it came to you (**From Maya's call**, **In the room, only you**, **Shared by
  Ines**), what it was about in a line, and only what waits on you from it (**1 to confirm** in rose, **2 follow-ups** in
  horizon), or that it's still recording or being written. Its name opens the call.
- **⋯** on a row does what that call allows, asking first in the same popover when something would be lost: **Change the
  time** (the scheduler, flow 4, which asks for a call in a series you run whether it's this call or this and later ones),
  **Copy link**, **Cancel this call** (it comes off your calendar and everyone invited is told, with **Undo**), **Skip this
  one** and **Cancel the series**; on an invitation, **Propose another time** (the scheduler, with the times you're both
  free; the organizer sees it on the row); on a meeting from your calendar, **Open in Google Calendar** and, for your own, **Use Alcove instead**; on a call
  waiting for a guest, **Copy the link for Jonas**; on a call that happened, **Meet again** (scheduling, with the same
  people and name) and **Share the notes**.
- **Schedule a call**, on the sky or the phone's plus, opens the scheduler in place of the rail and the sheet (flow 4),
  and its **×** or **Cancel** goes back to the place that was open.
- **Week** (from **List / Week** at the sheet's top right) shows Monday to Sunday, each day as wide as the others, under
  its days ("9 – 15 Nov"; across months "30 Nov – 6 Dec"). **‹** and **›** move it a week, and **Today** shows beside
  them once you've moved off this week; on a phone it's today and the next two days. The day is a scroll box of all 24
  hours that opens on 08:00 to 18:00 and never grows, with a tag in the hours and a line across today at now. It shows
  what happened, with a rose diamond for a decision to confirm and a blue dot for a follow-up, Alcove calls ahead, the
  calendar's meetings, invitations, times held for a guest and a call just scheduled, each with its own mark, which the
  key under the week names; what's over fades. Every block says its time first, and a name only when a whole line of it
  fits; blocks that overlap stand side by side. Pressing a call opens it; pressing a free time, or dragging across one,
  opens the scheduler there, as long as the drag. From the keyboard every half hour is a button, reached with the arrow
  keys, and Enter or Space starts scheduling there.
- **Search every call, or ask** is the line in the middle of the sky (**⌘K** on a Mac, **Ctrl+K** elsewhere goes to it;
  **↓** goes from it to the list, and **Escape** clears it). Coming from the palette's **See all in Calls** (flow 2), it
  already holds the palette's words. It finds the words, not just the call: every word typed has to be somewhere in the
  call's title, summary, decisions, follow-ups or what was said, or start the name of someone who spoke in it, in any order,
  breakout rooms included. A row quotes the line with most of the words and who said it, unless the summary has them,
  with a chip for each of the best moments, up to three in the order they were said. A moment opens the call there, not
  playing. Someone who can't read a call's transcript finds it only by what they can read, and nothing is quoted to them.
- A name in the line lists the calls with that person, coming up first, then the ones you've had. From the Team page or
  the palette's **Calls with Priya**, they're a token in the line whose × shows everyone's calls again; that person is in
  the address after `#with=`, which never leaves the browser.
- **Enter** or **Ask** asks every call you have. It reads them in confidential compute, and the answer lands at the top of
  the sheet with a chip for each call and moment it comes from, then the calls it read, each quoting the line it used.
  **×** puts the answer away, and so does typing. When a call it read was deleted or taken from you while it was being
  written, it isn't shown, and **Ask again** asks once more.
- When there's nothing to show, it says why: nothing coming up, no calls yet, nothing recorded in the room yet (**Record
  in the room**), nothing shared with you yet, no series yet, no calls with that person yet (**Show every call**), nothing
  matches the search (**Clear search**), or the search couldn't get an answer (**Try again**). Without a calendar, one line
  at the top of **All calls** and **Coming up** offers **Connect**. On the first day there's one empty state on the sheet:
  **No calls yet**, with **Connect Google Calendar** and **Start a call now**. Either way, connecting goes straight to
  Google, which comes back to Settings with the result.
- **Share** gives the notes to more people by email, or to one of your groups (offered first, by name), once
  the call has ended or the room recording has stopped. Anyone who has the notes can share them; people who have them already are skipped, and someone
  who removed them gets them again. Each share records who shared the notes and when, and the group's name
  when they went to one of the sharer's groups.
- **Share a link**, under the people in Share, is for someone whose address you don't have: **Make a link** shows a link
  to copy, once. For seven days, whoever opens it can have the notes, as shared by you, and the link alone opens nothing.
  Signed in, it asks first, because everyone with the notes will see who opened it: "Open them as
  kofi@vandelay.industries? Everyone who has them will see that you did." Only **Open the notes** gives that account the
  notes and opens them; **Not now** goes to Home with nothing given. Someone signed out is asked to sign in first (to a
  real account, unless the organizer's is a demo one), and is then asked the same: signing in never opens them by itself.
  The links that still work are listed there, **Your link** or **Priya's link**, with until when, and whoever made one,
  or the organizer, can **Revoke** it: from then on it opens nothing, and whoever it gave the notes to keeps them. A
  link that's run out or been revoked says so, and to ask for a new one. Notes from a link say **From Priya's link**
  beside their title, and **Who has these notes** says **By Priya's link**.
- Someone else's notes say how you got them, beside their title: **From Priya’s call** when you were invited,
  **Shared by Theo** when someone shared them afterwards, or **Shared by Theo with Leads** when it was to one of
  their groups. Calls lists them under the call they came from, and **Who has these notes** says how each person
  got them: organizer, invited, or shared afterwards by whom (and with which group). A long list shows its
  first eight people until **Show all** opens it.
- **More**, on a call's page, has **Pin to the side panel** (at most eight pinned), **Copy as text** once the notes are
  written (the summary, the full summary, what was decided, what's still open, the follow-ups and the shared notes),
  **Meet again** (the scheduler, with the same people and name), **Google Drive** (a window with the call's own exports,
  flow 15) and, for the organizer, **Write the notes again**; then **Delete notes**, which deletes your own notes for
  everyone, audio included, with anyone's own notes on them, once you say so in the same popover, and then lists what went.
  For notes from someone else it's **Remove from your notes**: everyone else keeps them, and you're no longer listed as
  having them. Your own notes on them go for good, and what you added to the shared notes stays. While the call is going,
  it waits until the call ends.
- **Your notes**, a tab beside the call, is what you kept in the call and more: write something, bookmark a line (the
  bookmark beside it, **Bookmark this line in your own notes, which only you see**) or a shared screen, or **Keep in your
  notes** under an answer. A bookmarked line's bookmark stays in sight, ticked; **Remove your bookmark** takes that line's
  own bookmark back and leaves a moment marked near it in the call. It says "Only you can read these. Not the others on the
  call, not Alcove.": nobody else reads Your notes, the organizer included. Each row starts with its kind (lines of text for
  something you wrote, a bookmark, a question for a kept answer); pointing at a row, or moving the keyboard into it, shows
  **Add to the shared notes**, **Change what you wrote** and **Delete**, which a touch screen always shows.
- A call's page is two halves. The left, the call, never scrolls: its stage, its line, and what was shared and made in it.
  The right has the tabs (**Notes**, **Transcript**, **Your notes**), each scrolling by itself, with **Ask about this call**
  at its foot. Narrower than 1100px (and on a phone) it's one column: the stage, the line, then the tabs, with what was
  shared and made as a **Shared** tab, and the page scrolls as one.
- **Add to the shared notes** on anything in Your notes shows, in place of the box you write in, exactly what goes:
  the words, which you can cut down, the moment they point at, **Shared notes** on this note, and everyone who
  has the notes, with "everyone on Vandelay Industries" when the organizer made them visible to their team, whose
  licensed people read them too. Nothing goes until **Add for 3 people** (the team's people counted in); only what's in the
  box goes, and never a question you asked. If someone got the notes since, or the notes were made visible to the team, it
  says so and shows them. An answer goes only if the moments behind it are in the
  notes. Once the notes are written is when this can be done: until then the people who'll get them aren't settled.
- **Shared notes** (**Everyone with the notes**) shows what people wrote there or added from their own notes, with who
  and when, for everyone with the notes, and once the notes are written, a box of its own: before anything is typed it
  says who reads it (their faces and names, "everyone on Vandelay Industries" when the notes are visible to the team, "and
  anyone they share the notes with"), and Enter posts it for all of them in one step. If someone got the notes after the box
  showed, or the team can read them since, posting is refused, the words stay in the box, and it says who got them since;
  Enter again posts it for them too. What's posted can't be changed. **Take back** removes yours for
  everyone, once you say so in the row; something added from Your notes stays there. The organizer can **Remove** any
  of them the same way. During a call the shared place to write is the call's workspace pages.
- A call's page (`/calls/<note ID>`) is a slim band of sky over its head: the way back (**Calls**), **Share**, **Download**
  and **More**, the title, and one line under it: when it was and how long, who has the notes (pressing their faces shows
  **Who has these notes** and how each got them), how you got them, its series (how it repeats, opening the series' place
  on Calls), and **Written in confidential compute** (or, in caution, **Written by an unencrypted model**), which opens the
  model for each task (transcribing the speech, writing the notes, reading the shared screens) and when the hardware was
  last checked: verified ones with **Check this model at NEAR AI**, unencrypted ones marked **Unencrypted**, and at its foot
  any other unencrypted model the call was sent to (**This call was also sent unencrypted to …**). Until the notes are
  written that says **Being written in confidential compute**, or **Still recording**, and while they're written again,
  **Being written again**.
- **The stage** plays the call, always night: everyone in arches, whoever's speaking lit, and what they said as captions
  (**Hide captions** under it; they hide while the Transcript is open, which says the same). When a screen was shared and
  kept, it plays there in step with the audio, with whose it is and the speaker small in its corner, and a chip for each
  when two overlap; while its picture takes a moment it says **Loading Kofi’s screen**, and if it can't be played, says so
  with **Try again**. A room recording has a microphone's arch. **Full screen** fills the screen with the stage and its
  line; Escape leaves.
- **The line**, under the stage: **Play** and the time, the chapter you're in above the line, the chapters as lengths, what
  was decided as rose diamonds on it (hollow until confirmed) and follow-ups as blue dots under it, a shared screen as a
  tinted length, the sun as the playhead, the end, **Speed** (it opens the speeds, 0.75×, 1×, 1.25×, 1.5× and 2×, to pick
  one from; in full screen they open over the player), captions and full screen.
  Pressing or dragging along it goes there, and so does a mark; the arrow keys move ten seconds. **Play** starts as soon as
  the first of the recording arrives; **Space** plays and pauses it, as in most players, with nothing focused, and the page
  doesn't scroll. While a call is still recording, the line ends at a recording-coloured edge where it has got to. A call
  that didn't keep its recording has the line and nothing to play, and says the recording was deleted when the call ended.
- Every ▶ chip on the page (a decision's, a follow-up's, a chapter's, an answer's) plays its moment on the stage without
  changing the tab, and a moment opened from a link (`?at=`, from an answer or a search) opens the Transcript at the line
  said then, lit, playing only when the link says so.
- **Shared and made in this call**, under the line: each shared screen as a card with its ▶ moment and how long it was up,
  lit while it plays; what the call worked on that you can open (documents with their first lines, boards drawn as they
  are, a breakout room's saying which room), each opening where it lives; and **Open its workspace**, for whoever is in the
  call's workspace (flow 12). With nothing, it says so.
- **Notes** shows the gist and, under it, **Full summary**, a longer account of the call in order (a note written before
  this existed, or one whose full summary couldn't be written, has none; writing the notes again brings it). Then **For
  you**: what's asked of you, each with its two answers (**Confirm** or **It wasn’t decided** for a decision to confirm,
  **I’ll do it** or **Not mine** for a follow-up suggested for you), each saying what happened with **Undo**; with nothing
  left, "Nothing from this call is waiting on you". Then **Decided**, **Follow-ups** (yours first) and **Still open**, each
  thing once, with who said it and its ▶ chip, its buttons, and a menu with the rest. Then the shared notes, and **How it
  went**: each chapter, what it was about, what was shared then, and each breakout room under the chapter it was in.
- **Transcript** has **Find in the transcript** (only the lines with every word, and how many), **Download the
  transcript**, what was said by chapter, the line being played lit and kept in sight as it plays (unless you've just
  scrolled), and **From the start** once you're down it. Pressing a line, its words or its time, goes to its moment and
  plays from there; selecting its words to copy them doesn't (a press on the words waits a quarter of a second). On a phone,
  where one line at a time shows its tools, the line pressed keeps them while the call plays on past it. A shared screen
  sits among the lines said while it was up, when the AI judged it key to what was said, and opens to a closer look.
- **Ask about this call** stays at the foot of the right column, **Only you**: a suggested question or your own (suggestions
  show above it at the end of what's read, while it's pointed at, and while you're in it). Answers cite the moments they
  come from, which play on the stage.
- **Download** saves to this device, put together in the browser: the transcript (text, with times), the notes (Markdown),
  the recording (its audio, a file for each part) and each shared screen (its video). "Opened on this device. Alcove can’t
  read it."
- Until the notes are written, the page says the audio is saved and encrypted (or, when the call doesn't keep its
  recording, that the call has ended) and the notes are being written
  in confidential compute, and ticks off each step (the call ended, the audio saved, the transcript, and shared screens ready to replay when a share was kept) with the
  one in progress marked. When nothing was said, it says so, the water is still, and **Play** stays on the line for the
  audio. A call that didn't keep its transcript or recording says so in one line where it would have been, and has no
  player; you can still ask about what the notes say. After **Delete notes** it lists what went; a call that isn't
  there (deleted, or never shared with you) says so, with **Back to Calls**.
- A question can also go across every note you have, your own and other people's (`POST /v1/notes/ask`,
  behind the line on Calls' sky, and **Search or ask**, flow 2). The answer comes from those notes only, up
  to 12 of them that share the most words with the question, and cites the notes and the moments in them it
  comes from. Until a note is written, or when nothing was said in any, it says so instead, and nothing is sent to
  the notes model. An answer written while a note it read was deleted or taken from you isn't shown: ask again.
- The transcript dots what it isn't sure of (words that were hard to hear, a name heard on more than one
  microphone) and says what the dots mean above it. The organizer can correct any line in place, its words or
  who said it, or say it was heard right; anyone else who has the notes can correct the words of their own lines,
  or say their words were heard right. Each line says who corrected it and when, starting with what was heard.
  Once lines were corrected, the organizer is offered **Write the notes again**, which keeps what people already
  confirmed or took on. **More › Write the notes again** asks the same in a small window at any time, with the AI
  model to write them (the default, or another the organizer picks), **Write the notes again** and **Cancel**; both
  offers show the choice. Meanwhile everyone still reads, asks about and confirms the notes as they were, marked
  **Being written again**. While they're written again the organizer can **Cancel**, which leaves the notes as they
  were, with the AI model they had; what was being written is thrown away.
- A call with breakout rooms has each room under the chapter it was in, in **How it went**: the room's name, who was in it
  and for how long, and inside, its own summary, decisions, open questions, follow-ups and chapters, written from what was
  said in that room alone. A room where nothing was said says so. The Transcript says which room you were in, and with whom,
  and shows the others' in one press. Everyone who has the notes reads every room's, and proposes, confirms, answers, takes
  on and ticks off what a room's notes say as far as they can the call's; a room's lines are corrected like the call's, and
  writing the notes again writes each room's again too, keeping what people settled. Questions about the notes cover the
  rooms. Deleting the notes deletes the rooms' with them. A call set not to keep its transcript keeps each room's notes and
  deletes what was said there, as it does for the main room.
- What the notes heard is a proposal until people say so. Each entry's row shows anything to be careful of (nothing
  said backs it, someone said otherwise, it was hard to hear, or a line behind it or its own words changed since), and
  its menu shows **What was said** behind it. Each decision says where it stands and who said so: proposed, confirmed,
  not decided, or no longer holding, and its diamond on the line is solid once it's confirmed. The organizer and anyone invited can **Confirm** what's proposed, except whoever proposed it
  or last reworded it; someone given the notes afterwards can propose and say what they think, but not confirm. Only
  the organizer can say **It wasn’t decided**, and anyone else saying so flags it, in their name, for the organizer to
  settle. Whoever confirmed a decision, or the organizer, can undo that or mark **It no longer holds**. New words on a
  confirmed decision need someone else to confirm them. If what you're agreeing to changed after you opened it, nothing
  is saved and the page shows what it says now. An open question shows **Not answered yet** until someone taps **It was
  answered**. A follow-up shows who the notes suggest, dashed, and any date as only suggested, until that person taps
  **I’ll do it**, or **Not mine** in its menu, which leaves it with nobody. Its menu lets the organizer or the person it's
  for give it to anyone who has the notes (giving it to yourself takes it on); once someone has taken it on, only they
  or the organizer can reword, date or tick it, and the organizer doing so asks them again. **Changes** in each one's
  menu lists every change: who did what, when, and what the words were.
- **Propose a decision** and **Add a follow-up** add what the notes missed, in your words, to the call's notes or a
  breakout room's section, and the plus on a transcript line starts one from what was said there.
- **Suggestions from the call** stay separate from the Follow-ups checklist until someone accepts them. **Review** shows a fixed
  batch, with **Add** / **Dismiss** for a suggested task and **Apply change** / **Dismiss** for a proposed change to a task already
  there. Later suggestions wait behind a count. Accepted tasks retain their words and identity when notes are written again;
  dismissed suggestions do not return from the same source material. **I'll do it** remains a separate acceptance of responsibility.
- A call in a series says so on its line: **Every weekday**, **Every other Tuesday** or **Every month on the first
  Thursday** for its organizer, **Every Tuesday** for anyone else when the last three calls they have were a week apart,
  otherwise **In a series**, opening the series' place on Calls. **More › Meet again** schedules another with the same
  people and name.
- A series has its place on Calls (`/calls?series=`): its next call, its calls so far, and what carries over from the
  calls you have notes from: decisions (confirmed, not confirmed yet, and no longer holding), questions still open and
  answered since the last call, and follow-ups taken on, not taken on yet and done since the last call, each with the call
  and moment it came from, breakout rooms' with their room. Things can be settled there, and questions asked across the
  calls, with answers that cite the calls and moments they come from. When a later call seems to have replaced a decision,
  it says which and offers **It no longer holds** or **It still holds**; when one seems to have answered a question, **It
  was answered** or **It’s still open**. Only someone with both calls' notes sees any of this, and nothing changes until
  someone says so. Someone invited to only some of the calls sees only those.
- **Before a call**, its page (`/calls/upcoming/<meeting ID>`, from Calls' rows, Home's Upcoming and the week) waits for
  it. The stage has everyone invited in arches with how each answered: its organizer sees everyone's (**Accepted**,
  **Maybe**, **Can’t come**, or **Invited** and dimmed until they answer); anyone else sees their own. **Join shows here
  five minutes before it starts**, and then **Join** does; a call offering times says whose pick it's waiting on, and its
  guest gets **Pick a time**. Under it, the link with **Copy link** (**Copy the link for Jonas** while he picks). Someone
  invited answers **Are you coming?** (**Yes**, **Maybe** or **No**; then their answer with **Change**, and the organizer
  sees it at once). The **Agenda** has what's brought to the call, each opening where it lives (whoever can't open one sees
  whose it is), and **Add an agenda**, **New board** and **Upload**: each is made in the call's workspace (the one its
  organizer chose, or one made for the call, with everyone invited in it), brought to the call and opened there, files
  uploading into it, for everyone invited, before the call and in it. **Notes** says whether the call writes them, where,
  what they keep and who can open them; its organizer can **Change** that here, for this call or this and later ones.
  **Change** in the head opens the scheduler on it, and **More** offers what its row's menu does: change the time, skip
  one in a series, copy the link, cancel it (asking first, with **Undo** for a single call), or for someone invited,
  propose another time.

### 8.46 Notes visible to a team

While you're licensed on a team, Share on a call's notes you organized has **Visible to team** ("Everyone licensed on
{team} can read it and ask about it."). It works on notes from before you joined, and they stay visible after you leave
the team. A licensed member finds notes someone else made visible on the Team page, and they open on their call's page,
saying "From {organizer}, visible to your team". They can be read, played and asked about, and asking across your notes
reads them too. Anything else on them is their organizer's: the page has no Share and no Your notes, nothing to settle,
propose, add or correct, an answer can't be kept, and More has no way to remove them. Anything asked of them anyway is
refused in those words: "This note is visible to your team to read and ask about. Only its organizer changes it." Storybook
shows one as **Pages / A call › A team note**.

Storybook journeys **8.1–8.10** play Calls: open a call, find what was said, see the week, answer an invitation, answer
a request to move, follow a series, connect your calendar, ask every call, the first day, and meet again (to where the
scheduler opens).

Storybook journeys (**Journeys / 8 A call**, 8.11–8.45) follow a call's page. **8.37** and **8.38** write straight into the shared notes: posting for everyone in one step, and
someone getting the notes while the box is open, which it says before posting again. **8.39** shares the notes by a
link, then revokes it, and **8.40** opens one signed out: it asks to sign in, then asks before opening the notes as that
account.

Storybook journeys **8.34–8.36** continue the same review after the call:

- **8.34 Review suggestions after the call:** accept or dismiss pending suggestions in the note, keeping the checklist separate.
- **8.35 Apply a proposed change:** review the previous and proposed values before changing an existing task.
- **8.36 Review a stale suggestion:** a concurrent review or task change is explained in place; unseen words are never silently accepted.

Before and around the call: **8.41** adds an agenda on a call ahead and opens it in the call's workspace, **8.42** answers
an invitation on the call's page, **8.43** joins when it's time, **8.44** plays a moment from the notes on the stage, and
**8.45** downloads from a call.

## 9. Record in the room

**Record** in the side panel or the phone's tab bar (raised) opens the Record page. It's the night in both themes, the
last moment of the evening, and the recorder stands on the horizon where the sun would: dark until something is recorded.

- **The recorder**, in the middle of the sky: a name for the recording (left empty, it's "Notes from the room"),
  **Start recording**, the microphone it will use, from this browser's microphones (the same choice and list calls use), and
  under them the reminder to let everyone here know before you start.
  Choosing one doesn't open it. Until the browser has named them it says **Default microphone**. **Check the level**
  opens the microphone: the orb's rim lights up and its reflection on the water moves with your voice, recording nothing;
  **Stop** lets go of it. While it's open, a microphone that doesn't start, or one unplugged, is said under it, and the one
  still in use stays shown; one that can't be used says what to do, with **Try again** where that can help. The page
  never opens the microphone by itself, and the camera plays no part.
- **Start recording** (or **R**, or **Enter** in the name) opens the stage recorder, the same night over the whole window.
  It starts recording the microphone straight away, in 5-second encrypted pieces: the orb fills with colour, your voice
  runs across the water, and what's said comes up under it a few seconds later, without naming who spoke. The last three
  lines show, fading as they get older; scrolling up reads back the rest, with **Latest** to return. Words it couldn't
  hear well are dotted. For the first moments, and until the first words, the reminder to let everyone here know stays
  under the voice, connection or not. Rename by editing the title, pause and resume, then **Finish and write notes** (the
  orb sets, and the note opens) or **Home › Discard recording** (nothing is kept, and you're back on Record). A finish that
  fails says so, and **Finish** can be pressed again; it never records again after that.
- **Without a connection** it keeps recording: **Offline** shows at the top, and "Saved on this device. It uploads when
  you're back online." under the voice. What's said is transcribed once the connection is back; if it comes back while
  recording, the rest goes up as it's recorded. With a connection that isn't getting through, it says Alcove isn't
  answering and that it's sent when it does. **Finish and save** keeps it on this device and goes to Record; with a
  connection, a recording with a short gap still ends on its note. Started offline, it works the same way. A full device
  pauses it and says so; signed out meanwhile, or with someone else signed in, it keeps it here and says so; signed out on
  this browser, it pauses and says nothing more can be kept. If it can't start at all, the stage says why, with the way
  back to Record.
- **On this device**: recordings kept here until they upload, encrypted, each with its name, length and start, and how it
  stands, in its own mark and colour: **Waiting for a connection**, **Waiting to upload**, **Uploading**, **Recording now**
  (in another tab), **Can't upload yet** with Alcove's reason, or, for good, **Can't upload** (more than 14 days old) or
  **Can't be read here** (this device can't open it any more). They upload by themselves when the connection is back, the
  oldest first, and their notes are written; a toast says when each one has, or that one's note was deleted on Alcove so
  it's gone from here too. Its menu has **Upload now** and **Delete from this device**, which asks first, in the same menu,
  and says so if another tab has it and it wasn't deleted.
  A tab closed mid-recording leaves what it recorded here, and it's finished and uploaded as it was. Only the account that
  recorded them sees or uploads them: if someone else signs in on the browser, they stay here until their own account
  signs in again. That account signing out deletes them, and Settings' **Sign out** says so first; anyone else's stay.
- **Offline**, the page says **Offline. Recording still works.** at the top of the sky.
- **Record without a connection** (on by default) off: nothing is kept on this device, and losing the connection pauses
  the recording. **Resume** waits for the connection, then it's yours to press. Offline, **Start recording** waits, and the
  page says **Offline. Recording needs a connection.**
- **Recorded before**: your four newest recordings as rows (the recording's own print, the start of the summary, how many
  follow-ups are still open, when, how long, and who has it), with **In Notes** for the rest. Room notes others shared with
  you aren't listed. Offline, a row says notes open when you're back online. Before the first recording (and with none
  waiting on this device), the water says what will show up there, and the sky takes more of the page.
- One line at the foot says the audio is encrypted as it's recorded, that it works without a connection (or, with **Record
  without a connection** off, that a dropped connection pauses it), and that room notes go to nobody until you share them.

Room notes are yours alone until you share them.

The note keeps the recording's own times: when it started, how long it ran with the pauses left out, and
when each line was said. Each piece of audio and each clip of speech carries its place in the recording, so
a piece that reaches Alcove late, or twice, still lands where it was recorded, once.

## 10. Team

**Team** is your company, standing on the horizon: the company directory where there is one (the demo directory
today), otherwise the people at your work email domain you have calls or calendar meetings with. A personal address
(gmail.com, outlook.com, icloud.com and the like) has no company, so someone there has no Team page until they're on a
team: nothing links to it, and its address goes Home. On a team, the page is the team's instead (16.17), and a company's
page has a quiet **Start a team** while you're on none (16.15).

- **The line**: the company's name in the middle of the sky, and everyone on the horizon in their arch. You stand in
  the middle, whoever you met most recently beside you, one to each side, and people not on Alcove yet at the ends,
  in empty arches with their initial. The low sun stands in an empty arch near where it sets, or just past the end of
  the line. Nine people stand at full size; up to thirteen, everyone gives up a little room and keeps a name; past
  that the front stays and the rest recede, smaller, nameless and hazier, on the same line, and pointing at someone
  or reaching them with the keyboard brings them forward with their name. The line holds 34. On a phone it runs off
  both sides, with you in the middle to start with, and the sun stands in its empty arch and slides with it.
- **Someone's popover**: pressing an arch opens a popover under it (on a phone, a sheet): their name, their title or
  address, and one line about the two of you: **Next call** at a time later today, how many meetings are coming up, or
  **Last call** with the day. **Ring** starts a call and goes straight to the lobby with them picked. **Schedule** opens
  Start a call at **When**, with them picked. **Notes you both have** lists the latest five in the same popover: each
  opens its note, and **Open in Calls** lists them all (`/calls#with=<address>`: the address stays in the browser, since
  a fragment is never sent to the web host). Someone not on Alcove yet has **Invite** in place of Ring, then **Remind**.
  Your own arch has your address, the groups you're in and **Settings**.
- **All 33 people**: past thirteen people a second button lists everyone, to search by name or address. Picking
  someone brings them forward on the line, past the 34 too, and opens their popover.
- **Invite people**: tick colleagues who aren't on Alcove and haven't been asked (they step up on the line as you do),
  or type anyone's whole address, which counts as it's typed; a comma, a space, Tab or **Enter** ticks it and clears the
  line for the next, and **Enter** again finishes. **Invite** opens your own email with an invitation to them (a subject and the link to
  sign in), and marks the people on your team invited. **Copy link** copies the address of the page to sign in. Alcove
  sends no email itself.
- **Not on Alcove yet**: the rest, each with their title and the same line about the two of you, or **Invited**, and in
  the same place on every row **Invite**, or **Remind**, which opens your email again. **Invite all** asks everyone who
  hasn't been asked at once. Nobody moves when they're invited. Five show before **Show all**.
- **Groups**: a tile for each, with its people standing on the tile's bottom edge, how many there are, and how many calls
  had all of them. The camera starts a call with all of them without opening it. A tile opens in place, across the
  column: its people, each with × to take them out (a group keeps at least one);
  **Add people**, from anyone you could reach; **Start a call** with all of them; **Rename**; and **Delete**, which asks once
  and can be undone for a few seconds. **New group** is a tile too: it opens to name one (Enter opens the picker) and fill
  it, **Create group** takes the filled button once it's ready, and a group half made waits on its tile until you make it
  or discard it with ×. A name is 1 to 40 characters and not one of your other groups'; a group holds up to 50 people,
  you can have 30 groups, and eight show before **Show all**. Groups live in your preferences: only you see them, and
  only a group's name leaves them, on the notes you share with it. Changes to your preferences (groups, pins, settings)
  are saved one at a time, in order.
- **Shared with groups**: every share with a group in the notes you have, whoever made it ("Theo shared it with Leads",
  "You shared it with Product"), newest first; the notes list carries them (`groupShares`, from the people who still
  have each note). Each opens its note. Five show before **Show all**.

What the numbers count: a call counts once it has notes, for the people on it who still have them. Someone a note was
shared with afterwards doesn't count, nor do notes shared with you. Someone who removes a note drops out of that call's
count, and a call with notes off leaves nothing to count. What's coming up is your Alcove calls and the coming week of
your calendar, which is as far as Alcove reads it (unless **Show my other meetings on Home** is off), each once.

With nobody else at your company on Alcove yet, the page asks you to bring them: **Bring your team to Alcove**, with
**Invite people** and **Copy invite link**, you beside empty arches for the four people you meet most, then those people,
each with **Invite**, **Invite everyone**, and how many more there are.

While the team is on its way, empty arches wait on the line beside you, and everyone comes up over the horizon when it
arrives. If it doesn't load, the page says why (or that you're offline, and it comes back by itself), with **Try again**.
Your groups and notes load beside it: if your groups don't, their section says so, with **Try again**, and the rest of
the page works.

## 11. Settings

**Settings** opens from your menu at the top right of every page, and on a phone from the same menu in the top bar
(flow 2). You stand on
the horizon with your name and address, beside **Take the tour** (the tour of Home again, flow 1) and **Sign out**.
With recordings on this device that haven't uploaded, **Sign out** first says so: the sky grows to hold the question
("2 recordings on this device haven't uploaded. Signing out deletes them."), says what staying does (they upload by
themselves, or, too old or unreadable here, never will), with **Stay signed in** (focused; **Escape** too) and
**Sign out and delete them**. It counts only this account's recordings, and only those go. The same goes for anything
written in the workspace that hasn't reached Alcove ("Something you wrote hasn't reached Alcove yet. Signing out deletes it
from this browser."), with **Copy what you wrote** beside them, which copies only your own words, as plain text. Every
other tab open here hears it at once and goes to the welcome page, saying you signed out in another tab. With no connection, signing
out says so and nothing happens later by itself. Under the water the page is
seven groups, each a heading over one or two panels, with an index beside it that stays as you scroll, jumps to each group
and moves a small sun to the one in view; on a narrow screen the index is a strip that stays at the top. A link into
Settings can name a group or one of the places other pages point at (**Recording in the room**, **Google Calendar**,
**Google Drive**, **Agents**); the page lands there, with its group's heading over it when it's near the group's top, the
place shows in a soft blue that fades as the page settles, and the index lights its group. Every control changes immediately and
says **Saving…** while its request is pending. **Saved** shows for a moment just left of the control, only once its
latest choice is confirmed (**Saved for new notes** for the language). A refusal says **Couldn’t confirm**, with a
toast explaining why; it removes only that attempt, keeping later choices. Pick the setting again to retry. Panels that
don't load say so, with **Try again**, and the rest of the page still works. Journey **11.23** shows Off → On → Off for
notes on new calls while the oldest request fails.

- **You**: your name and photo, from your sign-in, with a link to change them at Google or Microsoft (they update
  the next time you sign in; with single sign-on they come from your company's sign-in); your company, which opens
  Team (not at a personal address); and the time zone times are shown in, this computer's. Then **Appearance**:
  system, light or dark, each shown as a small evening in its own colours, kept in this browser.
- **Calls and notes**: notes on or off for new calls (everyone invited gets them; each call can still be set when it's
  scheduled), the language they're written in ("Same as the call", or one of twelve), and **AI model**: the model that
  writes the notes, reads shared screens and answers
  questions for calls you organize. The default shows as "<name> (default)"; the others are NEAR AI models that take
  text and images. A model that doesn't run in a secure enclave carries a yellow **Unencrypted** badge ("Not in a secure
  enclave, so Alcove can't guarantee this model keeps your call private."). Transcription is always private. There's no
  choice of how long the summary is: every note has the short summary with the full summary under it. The language
  applies to notes written from then on; the model to calls started from then on, and you can change it
  during a call (**Notes written by**, on the capture panel) or when you write a note's notes again. Then **Recording in
  the room**: **Record without a connection** (on by default), and, while something waits here to upload, **On this
  device**: how many recordings, and how much room, with **See them** (Record's list).
- **Audio and video**: this browser's choices, the ones the join screen and the call use, listed as the call lists them
  (each device once, **Your system’s choice** on the one your computer uses, and **Follow your system** while one is
  picked); choosing one doesn't open it.
  A browser names devices only once they're allowed, so until then the microphone and speaker have no list. Nothing
  opens by itself: **Check the level** opens the microphone for eight seconds (the browser asks first if it hasn't been
  allowed), its level moves as you speak, and **Stop** counts down; it records nothing, and closes sooner when stopped
  or when this group leaves the screen. A microphone that won't open says why, with **Try again**. **Play test sound**
  plays through the chosen speaker; a browser that can't choose one says it uses the system's. The camera is a list
  only, never opened here, and until the browser has allowed a camera on the join screen it says it isn't allowed yet;
  **Reduce background noise**. They're kept in this browser only.
- **Notifications**: **Browser notifications**: **Turn on** is the only thing that asks the browser's permission; once
  allowed it's a switch, and a browser that blocks or can't show them says so, with guidance. Then **Sounds**: silence
  every sound, set the volume, and play a sound at that volume; **Quiet mode** keeps only your microphone and requests to
  join when you host; and **Before a call starts** (1 min, 5 min or off, for calls you organize). Then **What reaches
  you**: one row for each thing that can reach you, with an **Alert** tick and a **Sound** tick, empty where that way
  doesn't apply. In a call: private messages, mentions, replies to you, requests to join (when you host), raised hands
  and new questions (when you host or present), the timer running out, people joining and leaving (sound only) and your
  microphone on and off (sound only). Outside a call: someone ringing you, your notes being ready, notes shared with you,
  someone asking for notes (calls you organize), a follow-up being due (at 9:00 that day), mentions in documents and your plan (Pro about to end,
  renewed or ended), the last two alert only. A plan alert says only "Your Alcove plan", never an amount or a date, and opens Settings at Plan. An Alert shows inside Alcove (replies and mentions as a brief alert in the call), and from the browser
  when Alcove is in another tab, once browser notifications are on. With sounds off the Sound column steps back and keeps
  its ticks. **More → Settings → Notifications** in a call offers the same, with the In a call rows; guests keep their
  choices in this browser.
  Alerts arrive while Alcove stays open in a background tab/window; there is no delivery service after every tab closes. They always hide names, messages and call/workspace details, including on lock screens: a ring says only that someone is calling you. Browser alerts are silent; sounds follow their own ticks.
  The relevant focused conversation/action suppresses a redundant alert. Events deduplicate across tabs and reconnects, bursts share one alert per category, and handling/reading/withdrawing an event closes or replaces its alert where supported. Enabling a category or joining a thread does not replay old messages. Clicking focuses an existing tab, preferring the original call connection, checks current access, then opens the exact conversation, thread, pending action or timer; a ring's alert brings the tab with the ring forward, and closes when the ring ends. An ended private session or handled action says it is no longer available. Sign-out, removal and revoked permission stop delivery and close the applicable alerts. Other-device preference changes arrive through background refresh.
- **Connections**: **Google Calendar**, **Connected** with **Disconnect** (it removes the Calendar connection in
  Alcove), or **Connect**, with Alcove's one line about it under the name: "Alcove reads your events and adds the calls
  you schedule." **Connect** goes straight to Google, which asks for access to the same Google account you signed in
  with. Google sends you back here, as it does from **Connect Google Calendar** while scheduling or in a series, with the
  result said under the row: connected; access not granted, so you can still schedule calls and share the link yourself;
  the wrong Google account; or a failure, to try again. A demo account has a
  sample calendar. Other accounts show **Not connected**: Google Calendar connects from an Alcove account that uses Google
  sign-in. A calendar that doesn't answer says why, with **Try again**. Under it, **Put calls I schedule on my calendar**
  (when Google Calendar is connected, Google sends the invitations; a sample calendar stands in for it) and **Show my
  other meetings on Home** (both on by default), and while that's on, **Show my own events on Home** ("Events with
  nobody else on them, in their days under your calls and meetings."; off by default), which Upcoming's count of them changes too. Then
  **Google Drive**, one line that says where notes go until
  **Manage** opens it in place, where **Connect** and **Reconnect** first say what Google shares and what Alcove uploads
  (flow 15). Then **Agents**, one row: who's connected ("Claude, Cursor and Weekly digest are connected.", and past three
  names how many more), or what agents are for while none is, with **Open Agents**, or **Connect an agent** while none
  is, which opens Agents (flow 14). On a phone this row is the way to Agents.
- **Plan** (16.7, 16.8, 16.14), in two panels. What you have: **Free** ("Every feature, with about 5 hours of notes and
  10 GB of storage.") or **Pro** ("Until Thursday 4 November 2027. Nothing renews by itself: Alcove reminds you before it
  ends.", or "It renews from your balance before it ends."), with **See plans** (Plans) and **Get Pro** or **Extend**
  (checkout). Ending is said in warm from a week before ("Ends in 6 days, on Tuesday 10 November. Then you're back on
  Free, and nothing is deleted."), and **Extend** is the page's one filled button then, as **Get Pro** is once notes have
  run out. **Notes left this period** ("About 1 h 26 min", "Back to 5 hours on 1 December. Calls without notes are free.")
  has a sun on its line, at the end of the line on a new period and back along it as notes are written: warm under an
  hour, "None" with "Calls go on without notes until 1 December." once out. **Storage** ("2.1 GB of 10 GB", files up to
  512 MB): over the plan's storage, a note says until when everything works as before, then that uploads and notes have
  stopped until you make room. **More notes** ("10 hours for $15, for this period.", **Add 10 hours**, which opens
  checkout) shows on Free, and on any plan once notes are low or out. At the top until dismissed with ×: "Pro renewed from
  your balance, for another month." or "Pro ended on … Nothing was deleted: you're back on Free." (with
  **Get Pro again**). What you pay with: **Balance**, in dollars, with **Add money** (11.24); on Pro,
  **Renew from balance** (off by default; it says when the balance is short of a month) and, while months bought after
  this one haven't started, **Refund**, asked in place. Then **Payments**: first what's on its way or needs a person, each
  opening checkout (a payment for a plan) or the add-money sheet, with a cancel while nothing has reached it; then the
  balance's latest changes, each with **Receipt**, a receipt to print. Without a server that takes payments the balance
  has no **Add money**. On a team, the plan row says whose team it is and until when your license runs, with
  **Open Team**, and Storage is the team's pool; its admin has the licenses too (16.18).
- **Privacy**: what account and call information Alcove processes, then confidential compute: the time the hardware
  was verified when this browser could check it, **Not verified** and why when its check of the server didn't pass, or
  where your audio is opened and your notes are written. The **Privacy policy** explains how Alcove uses account and service
  data and how to disconnect Google services. Then, in its own panel at the end, **Delete account**.

**Delete account** opens one step where it is (never a window over the page): the row becomes the question, **Delete
your account for good?**, and what goes sits beside what stays. What goes: the notes you made, with their audio, for
everyone who has them; the calls you scheduled, for everyone invited; your plan, and your balance when there is one; your own notes on every
call, and anything you added from them to other people's notes; your groups and pins; workspaces only you are in, and
documents only you can open; your Google Calendar connection, where Alcove also asks Google to cancel your calls and end
its access; and your sign-in on every browser. What stays: the notes other people gave you stay with them, without you,
keeping what you said in the call and your name and address on what you did in them. **Keep my account** has focus, and
**Escape** does the same.
**Delete my account** then deletes the account for good:
the notes you organized, for everyone you gave them to, with their audio; your recordings, calls and meetings; your own
notes, and everything you added to anyone's shared notes, whether or not you still had the note; your groups and pins; your
Google Calendar connection; and your sessions, so every browser is signed out. You're taken off the notes other
people gave you; notes you shared on stay with the people you shared them with, still saying you shared them.
Your calls on Google Calendar that haven't ended are cancelled there, begun or not, and their guests are told,
except a meeting you made an Alcove call with **Use Alcove**: it's your own event, so it stays on your calendar
as it was, and its Alcove link stops working. Alcove's access to your Google account is revoked. If Google is
slow or unavailable, the account is deleted all the same, and calls it couldn't cancel stay on the calendar.
The shared demo account can't be deleted: as soon as **Delete account** is pressed the row says so and offers only
**Close**. So does a tab left showing one account after another tab changed who's signed in: nothing is deleted, and the
row says to reload the page. Any other failure, having no connection included, is said in the step, **Delete my account**
tries again, and nothing happens later by itself. Once it's deleted you land on the welcome page, signed out, even
if you left Settings meanwhile, and this browser forgets the tour and call view it kept for the account.
Signing in again starts a new, empty account on Free.

### 11.24 Add money

Open **Settings → Plan → Add money** beside **Balance**, choose **$20**, **$60**, **$120** or your own amount in dollars,
then the network to send it on, under **Pay with USDC**. A USDC is a dollar, so $20 is 20 USDC. **Get an address** follows
the payment as checkout's Pay step does (16.2), with the same parts and words: "Waiting for your payment" and until when
the address is open, **Send exactly** the amount with Copy, the QR code and the address made for this one payment, its
first six and last four characters in bold (on a phone, **Open in wallet** in place of the code), and "Only send USDC on
Base". A short payment says "Less than asked arrived", with **Send the rest** to the same address before it closes; after
that it asks for no more money, and what arrived goes into the balance once the payment settles. Seen, the amount that
arrived counts up and the line runs to "Added to your balance"; then the tick, and how much is in the balance now. A
payment on its way stays under the balance in **Payments** with **Open**, as do failed and held payments with their support
reference; once it's added it shows as "Added, 20 USDC" with **Receipt**. **Cancel payment** stops a waiting one; a payment
already sent still counts. Over, **Start a new payment** starts again. Deleting an account warns when one of its payment
addresses could still receive money. Buying Pro or more notes is checkout's (16.2–16.5), which adds the money and buys with
it in one go.

### 11.25 Choose what reaches you

Open **Settings → Notifications**. In **What reaches you**, untick **Sound** on **People joining and leaving**: it's kept at
once and **Saved** shows on the row. Press the speaker beside **Sounds** to silence everything: the Sound column steps back
and keeps your ticks for when you turn sounds on again; the play button plays a sound at your volume. Alert and Sound ticks
work even when browser notifications are blocked: alerts still show inside Alcove. **More → Settings → Notifications** in a
call offers the same choices, including for guests. Signed-in choices follow your account; guests keep theirs in this
browser.

### 11.26 Return without granting Calendar access

From **Connect** beside Google Calendar, untick Calendar access in Google's consent, or cancel it. Google brings you back
to **Settings → Connections**, and under Google Calendar it says "Calendar access wasn’t granted. You can still schedule
calls and share the link yourself." **Connect** is still there for when you're ready.

## 12. The Drive and the workspace

Journey **12.1** renames a workspace immediately: the list and breadcrumbs show the requested name with **Saving…**. If it
cannot be confirmed, **Edit name** restores the entered text; press Enter to retry without retyping or reloading. Later
choices remain in place while older requests settle. Physical **Delete for good** completes only after Alcove confirms it.

Documents and folders people write in together, between calls as well as in them. Every call has a workspace of its own,
its home, where its notes, follow-ups and transcript go. Homes with the same name, the same call twice in a day, say
when each call started too (**Launch check-in · 5 Nov, 14:30**, to the second if they started in the same minute), in
the workspace picker and when choosing a home while scheduling. Outside a call a workspace opens full screen (below).
Everything happens in its list: nothing opens a window, and nothing asks you to fill anything in. Whatever someone does
here reaches everyone else in the workspace as it happens, and a row that arrives or moves glows for a moment for all of
them.

**The Drive.** **Drive** in the side panel keeps every workspace you're in and everything in them: a tree of places beside a
sheet of large previews. The tree has **Recent**; **Shared with you**, with how many; **Workspaces**, each with its mark,
the one you're in open to its folders and files; **From calls**, each call's own workspace, the next ones first with their
time, five until **Show N more**; and **Trash**. Pressing the row of the workspace you're on folds it, and pressing it again
opens it; going anywhere else opens the workspace you go to. Recent is everything you can open, the most recently edited first, by day,
as pictures or a list: each card shows what the file is (a document's first lines as it is now, a board, photos, a PDF),
where it is (**From Team standup**, **For Launch check-in**, **In Launch**, **Shared with you**) and who touched it last and
when. A workspace on the sheet shows who's in it, its folders, the calls kept in it with **Open the call**, its files, and
**Open full screen**; a card inside it doesn't say which workspace again. A call's own workspace shows the call's **Notes**,
**Follow-ups** and **Transcript** as cards, for whoever has its notes, then what the call made, with **New document**,
**New board** and **Upload files**, and in a series the calls before. **Trash** is one list across every workspace: where
each thing was, who moved it there and when, how many days it has left, and **Restore** for whoever can edit it. Pressing a
card opens it beside the tree, in its workspace, with the tree open to it; **⤢** takes it full screen. Its **⋯** has
**Open**, **Open full screen**, **Copy link**, **Rename** (typed in the same menu; a document's title follows, for everyone)
and **Move to Trash**, with **Undo**. The search at the top (**⌘K**) narrows
everything by name as it's typed, the workspaces it names first. **New** makes a document, a board or files where you are;
on Recent, Shared with you or Trash it asks which workspace in the same menu, with **New workspace** last, named in place.
On a phone the tree becomes chips along the top of the sheet, New sits beside the search, and a document opens full screen.

Journey **12.2** opens a workspace: under Workspaces, **Launch** shows its folders, calls and files beside the tree, and
**Open full screen** takes it full screen. Journey **12.3** picks up where you left off: Recent's **Launch checklist** opens
beside the tree, in the workspace it lives in, Team standup's, and **⤢** gives it the whole screen. Journey **12.4** is the
first day: the Drive is Recent, Shared with you, New workspace and Trash, with one empty state; **New document** asks for a
workspace to put it in, named in the same menu, and the document opens in it, beside the tree.

**A workspace, full screen.** Any workspace opens full screen, in a frame of its own in place of the app's: a side panel,
dark in both themes, beside the page, with one bar over the page. The side panel has the logo (Home), the workspace
switcher, **Search** (Find, **⌘K**), then **Home** and **Pages**, the tree with its folders, and **Calls**, the calls kept in
it, each opening its call. **Trash** is at the foot, with a count only when something's in it, and who can open the
workspace ("Priya, Kofi, Ines and you can open it"). The bar has **← Drive**, or **← Calls** when it was opened from a call,
the path, how it's saving, who else is here ("Priya is here"), **Share**, **⋯**, **Leave full screen** and you. Leaving
goes back where it came from: the Drive, at this workspace, or Calls. **Home** is the workspace's name on the evening after
sunset; the line on what it's for, which an admin writes in place by pressing it (**Say what this workspace is for** until
there is one), everyone in it reads, and nobody else is told of; who's in it; **Recently edited**, three large previews;
and its calls, the next one first, for whoever organizes it. A call's own workspace has no Home: it opens on what the call
made, with **The call, today ↗** first in its list (opening the call's page), then **Made in the call** (**For the call**
before it), then in a series **Earlier calls**. A page says under its title the call it came from, as a chip that opens
it, who made it and when it was last edited; a quote from a call says who said it, in which call, and its **▶** moment
opens the call there; and something made in the last ten minutes says **New** in the list. On a phone the workspace's pages
come first, under **← Drive**, and a page has **←** and the workspace's name to go back to them.

Journey **12.5** works on a page: from Launch's Home, **Launch plan** opens with the call it came from and Priya writing in
it; a to-do ticks, and the callout's count in the margin opens its comments; the path's **Launch** goes back to Home.
Journey **12.6** is what a call made: this morning's standup, on its page, has **Open its workspace**; the standup's own
workspace opens on what it made, with the call first in its list and the standups before it after; **Standup board** opens
full screen.

**A call's folder.** At the top of a call's home is the call's folder, named after it and the day. In a call it holds its
**Notes**, **Follow-ups** and **Transcript**: while you're in the call they're its live pages, and once it's over they open
its note, at that part of it, in a tab of their own, for whoever has the note. Full screen the folder is the call itself,
a row that opens the call's own page, for whoever has its notes. Someone in the workspace without the note sees the folder
and whatever's been put in it. It's a folder like any other: rename it, move it, put documents in it.

**When scheduling** a call, the details hold **New workspace for this call**: open it to pick one of your workspaces as its
home instead, so its notes go there, beside the calls before it.

**First day.** The Drive's tree is Recent, Shared with you, **New workspace** (named in place, then open on the sheet) and
Trash, and its sheet says **Nothing here yet**, with **New document**, **New board** and **Upload files**, each asking for a
workspace to put it in. Free can make as many workspaces as it likes: storage is the only limit. An empty workspace says **Nothing here yet** with **New document** and **New folder**.
**New document** opens an empty page with the caret in the title and a few ways to start under it: **Agenda**, **Decision
log**, **Retro** and **Project brief**. They're only blocks: picking one fills the page, names an untitled document after
it, and anything in it can change or go. Two people can have the same new document open: they get one title and one first
line.

**Making things.** **+** on **Pages** (at the top of the list, in a call), or hovering a folder and pressing its **+**, offers **New document**,
**New folder** and **New board** (flow 13); **N** and **⇧N** skip the menu when you aren't typing. A folder is named in its row: type, then
**Enter**. **Esc**, or leaving it empty, makes nothing. A document's title is its name: the list and the path above the
page follow as you type, for everyone.

**Code.** **/** then **Code**, or ```` ``` ```` and a space on a line, makes a block of code; ```` ```js ````, ```` ```py ```` or
```` ```cpp ```` makes one in that language. Its corner says its language and changes it, as **Language** in its menu does:
**Plain text**, **JavaScript**, **Python** or **C++**, the same for everyone with the document. Keywords, strings, numbers,
names and comments take their colours, in both themes. Copied into another document it keeps its language, and code pasted
from a page that says its language takes it; nothing is guessed from the code itself.

**Photos, videos and files.** **+** beside a line, or **/**, offers **Photos**, **Video** and **File**. Photos opens a space at
once, "Drop photos here, or choose them", with a picker under it: **Choose from this computer**, or the photos already in the
workspace, one at a time or **Add all three**; Video and File offer films and files the same way. Files dropped on the page
land where a line shows, "Drop to add here", and pasted ones under the caret. Whichever way they come, and from **File** too,
several photos make a gallery, one makes a picture across the page, a film shows its first frame with **Play**, and anything
else is a file, whose arrow downloads it. **Download**, in a photo's or a video's menu (**Download the photos** for a gallery),
saves the original, each photo as a file of its own, and the page stays as it is, with a call on it. Everyone sees the space a file will take straight away and the ring fill as it uploads, and the
pictures sharpen when it's done; a caption starts as the file's name and is one click to change. A photo the browser can't read
says which file, with **Add as a file** and **Delete**; chosen with **File**, a picture Alcove can't show (a phone's HEIC photo,
say) goes in as a file straight away. One Alcove refuses says which file and why ("This file is bigger than
512 MiB, the most a file can be here.", "Your storage is full. Delete something, or move to a plan with more room.", "That's all you
can upload today. You can upload more tomorrow."), with **Try again** and **Delete**, and nothing else in the document changes. A block that's
uploading can be cut and pasted in its document, or undone and done again, and the upload goes on into it. Leaving the page doesn't stop
an upload, and closing the tab asks first, until everything about it has reached Alcove; a browser that goes mid-upload leaves
its block saying it couldn't, for everyone. A block's **Delete** takes it out and keeps
the file in the workspace, for older versions and to use again. **Delete the photo for good** (or the video, or the file), in
the block's menu, asks first, then deletes it from every document that has it, where it says it was deleted, older versions
too; Alcove refuses that for a file that's also in a document you can only read, and says so. **Upload files** in the list's
**+** makes a new document there holding them, named after the file when there's one.

**Moving things.** Drag a row: a line shows where it lands between two rows, a folder lights up over its middle, and
pausing over a closed folder opens it. **Esc** puts it back, and dropping it on **Trash** sends it there. When it lands
it's moved for everyone, and **Undo** is there for a moment. **⋯** on a row, or right-clicking it, offers **Rename**,
**Duplicate**, **Move to…**, **Copy link** and **Move to Trash**; a folder has **Rename**, **Move to…** and **Move to
Trash**. Renaming a document in the list changes its title too. Links are to the document, so they keep working wherever
it goes, and a link to a block (**Copy link** in the block's own menu) opens the document at that line, which glows. A
block's **Move to…**, or dragging it onto a document in the list, sends it there, with **Undo**.

**From the keyboard.** The list is one stop for Tab: **↑** and **↓** move through it, **←** and **→** close and open a
folder, **Enter** opens a row and Tab reaches its buttons. **F2** renames, **Delete** moves to Trash, **⌥↑** and **⌥↓** move
a row among its neighbours, and the menu key opens its menu. In a call, **⌘\** hides or shows the list. While the caret is in a
document, **N** and **⇧N** type letters; **Esc** goes to the block's handles, and again to the document's row in the list.

**Find.** The magnifier at the top of the list, or **⌘K** (**Ctrl+K**), finds any document or any line you can open. What
you opened last is ready, so **Enter** goes straight back to it. Typing looks through names and lines, and results arrive as
documents do. It happens in your browser, so what you type isn't sent anywhere. **↑** and **↓** move through what's found,
and **Enter** lands on the line, which glows, with the caret on it. Words typed a moment ago in the open document are found too;
what others wrote is found from the next time Find opens. **Keyboard**, at the foot of Find, or **?**, lists every key.

**History.** **⋯** at the top of a document, then **History**: now, then each stretch of work, the newest first. A call's versions
are one row, under the call's name if you have its notes; other edits are a row a day; what was kept before a restore is a row
of its own; and the last says who made the document and when. Pressing a row shows the document as it was in the page's place,
read-only, with what changed in that stretch tinted. **↑** and **↓** move through them, and **Esc** puts it away.

**Restore this version**, for anyone who can edit, makes the document that for everyone, and what it said a moment ago is kept
as a version too, so **Undo** in the toast brings it back. If anyone else is in the document, you're told who first, and who's
typing, and you choose **Restore for everyone** or **Not yet**. Everyone in it is told who restored what, with **History** one
press away. Someone typing through it sees **Saving…**, and what they type lands on what's restored. A block they're in that the
version doesn't have stays on the page, holding what they typed since; what they'd typed before that is in the version kept.

**Ask Alcove.** **Ask**, on the bar over what's selected, offers **Make this shorter**, **Turn this into a checklist** and **What
was said about this?**, written in confidential compute. The words stay marked with dots beside them, and the caret steps off
them, so you can keep writing. What comes back takes their place wherever they've got to, for everyone, and **⌘Z** takes it
back. If someone changes the words meanwhile, what they wrote stays and the answer goes under it. **What was said about
this?** answers beside the words, from every note you have, or in a call from what's been said in it. Nothing is kept.

**Trash.** A quiet row at the foot of the list, with how much is in it. It lists what was moved there, by whom, when and
how long it has left: things stay for 30 days. **Restore** puts something back in its folder, or at the top if the folder
has gone, and **Delete forever** asks once, then deletes it for everyone. A document in Trash still opens, to read.

**Sharing.** **Share** at the top of a document shows who has it: the workspace, and anyone it's shared with beyond it,
each with what they can do. Typing a name or an address finds people (**Enter** adds the first, or an address nobody
knows); they can edit, and their row changes that to **Can read** or takes them off. The workspace's row can close the
document to **Only people added here**: then it opens only for whoever made it and the people listed, and it's gone from
everyone else's list. Someone it's shared with who isn't in the workspace sees that document alone.

**Who's here.** Faces on a row and at the top of a document show who has it open, live, and go when they do. Pressing a face
opens their card: where they are, in the words you may know (a document you can't open is **A document you can’t open**, never
its name), **Follow**, **Go to where they are**, and **Tag them in this document** where you can write. Their caret shows their
face and first name while they move, which fade after three seconds of quiet; outside a call it's in the focus colour. Opening
a document only moves you.

**Following someone.** **Follow** goes where they go, to the same line: a frame around the workspace and a bar under the head
say so, and the page scrolls to them. In a call that's the call's own **Notes**, **Follow-ups** and **Transcript** too, and the
bar names the page. Nobody else moves, and they do nothing. If they open something you can't, you stay put
and the bar says **In a document you can’t open**; you catch up as soon as they come back. **Stop following**, or **Esc** in
the workspace, ends it, and so does scrolling, typing, pressing the page or going somewhere yourself: you stay where you are,
and a toast offers **Follow again**. In a call, **Esc** anywhere else is the call's (a field, focus, your side).

**Tagging.** **@** anywhere in a line lists people, then documents and dates, narrowing as you type: the workspace's people
first, then your company (in a call, who's in it first, then who's invited). The list says who **Can’t open this yet**
before you pick. Dates are **Today**, **Tomorrow** and the next Friday, with a day typed after **@** with its month first
among them (**@12dec** offers Sat 12 Dec), and then **Pick a date…**: a month to pick any day from, past ones too, in the
list's place, with the pointer or with the arrow keys and **Enter**, and **Esc** goes back to the text. Pressing a date tag
opens the same month, to pick another day for it. A date outside this year says its year (Fri 5 Feb 2027). Whoever can open the document hears about it; if they can't, Alcove asks once, right by the name: **Let them
edit**, **Read only** or **Not now**. A tag never shares anything by itself, and someone who can't open it isn't told. Being
tagged is a toast saying who and where, and nothing moves until **Go there**, which lands on the line. Someone away hears when
they're back: **Drive** in the side panel counts what's waiting, and a browser notification says so, if they've allowed them.

**Comments.** Select words: the bar over them has **Comment**, as does a block's menu, and **⌘⇧M** does the same. The words
stay marked while you write, and **@** works here too, for people and dates. **Enter** marks them for everyone, with a count in
the margin; pressing the words or the count opens the thread, and replies arrive as they're sent. **Resolve** takes the mark
away for everyone, and the toast's **Reopen** brings it back for a moment; History keeps the thread. Someone who can only
read can open a thread and has nothing to press.

**Workspaces.** The switcher at the top of the side panel (in a call, the name at the top of the list) lists your workspaces with who's in each, and opens another. **People**
shows who's in this one in the same sheet as Share: an admin adds people by name or address and sets each to **Admin**,
**Can edit** or **Can read**, or removes them; anyone can leave. **Rename** (admins) and **New workspace** turn the name
into a field: type, then **Enter**. A workspace always keeps an admin.

**When things go wrong.** At the top of every document one quiet word says how it stands: **Saved**, **Saving…**,
**Reconnecting** or **Couldn’t save**.

- The connection drops: you keep writing. A bar says your edits are safe in this browser. They're kept there, sealed,
  through a reload, and send when you're back, even if you never open that document again; everyone's words merge, with
  nothing to resolve, and a toast says so. "You're offline" only when the browser is; while it's online and Alcove can't be
  reached, the bar says "Alcove can't be reached right now. Keep writing: what you write is kept here until it saves.", with
  **Try now**, which tries again at once rather than after the wait, and a document that hasn't opened yet says the same with
  **Try now**. It tries by itself, a little later each time up to every 10 seconds, and, between tries, at once when the
  browser comes back online, the tab comes back into view, or, in a call, the workspace is opened again. A page that's still
  opening keeps its place: none of those starts it over. The list has a connection of its own:
  while it's down, a line under its name says **Reconnecting**, with **Try now**, so a list that's stopped changing isn't
  taken for current.
- Someone moves the document you're in to Trash: you aren't thrown out. A bar says who, the page stops taking edits, and
  **Restore it** brings it back for everyone, where it was. Whoever moved it goes on to the next document, with **Undo**.
- It stops being yours (taken off it, or closed to the workspace) or it's deleted: the page says you can't open it, the
  same as for a document that never existed, with the way back. The same goes for a whole workspace. Anything you'd
  written there that hadn't reached Alcove is still in this browser, and the page offers it (below).
- A document opened with no connection says so, and opens by itself when you're back. Sending a block to another document
  waits for a connection too.
- A document that can't be opened right now (someone restored a version of it, or it's too much to open) says so, stops
  taking edits, and opens again by itself, a little later each time.
- A document too big to save says so: delete something, or send a block to another document, and what's waiting saves.
  Anything Alcove can't take at all says so too, and so does losing the right to edit with something unsaved.
- Your session ends by itself (it expired): the app goes to the welcome page to sign in again, saying your edits are safe
  in this browser and save when you sign in again (a document that finds out first says so in its bar). Signing out on
  purpose asks first (flow 11), and every other tab goes to the welcome page at once.
- Someone who can only read gets no buttons that change anything: a bar says who to ask, and the list has no **+**.
- A workspace whose payer is over their storage (and the 15 days after that went by) takes no more uploads: they're refused
  with "Your storage is full. Delete something, or move to a plan with more room." Everything else works, and nothing is
  deleted for being over.

**Nothing written is trapped.** What you write stays in this browser until Alcove has it or you let it go, however the
document ends up. Wherever it may not get there by itself (the document refuses it, you can only read it now, or it's
gone), the page offers what to do with it, holding only your own words that didn't save, never the rest of the document:
**Copy text**; **Save as new document**, for someone who can make one, which makes "Your words from" and the document's
name beside it, says so with **Open**, and lets this one carry on from what Alcove has; and **Discard**, which asks once,
with the keyboard on **Keep it**. On a document that's gone, only **Copy text** is offered until it's sure the document
is gone. In Trash, the bar says what you wrote saves once it's restored. A document that's gone keeps offering them where it
was. Words this browser holds for a document you aren't looking at, found when the app opens or the connection comes back,
get one toast, with **Show it**.

Signing out, or deleting your account, on this browser deletes every edit still kept here for it and where you were in
your workspaces; Sign out asks first if anything hasn't reached Alcove.

On a phone the list and the page take turns: full screen, the workspace's pages until something's open, and **←** with the
workspace's name brings them back; in a call, the list, and the button at the top of the page. Menus and sheets rise from the bottom, and **Share** is in the document's **⋯**. Rows don't drag on a
touch screen: **Move to…** does that. While you write, a bar rides on the keyboard with a block (as **/** does), the text's
style, **@**, photos, a checklist and Done; sheets open above it. Holding a finger on a block opens its menu, the one its
handle opens on a laptop, with **Download** on a photo or a video, and **Delete for good** on a photo, video or file. Someone's card and a comment are sheets too, and faces are on the list's rows. A bar's buttons go under its words.

### Team workspaces

While you're licensed on a team, New workspace in the Drive asks who's in it under its name: **Whole team** (as it
starts), so everyone licensed on the team can open and edit it, or **Only people I add**, so only you are in it until you
add people. Either way it counts against the team's storage. A call's home made for you, and a workspace made in a call,
is only for the people invited, so a call's notes never reach the whole team unless someone chooses that. A team
workspace's row in the Drive says Whole team. In its People sheet (its name at the top of the list, then People), its
admins can switch between Whole team and Only people I add. Anyone else in it reads which it is. In a call, a team
workspace opens to everyone in it only when the organizer pays for it, as for a call's home made for them; one a teammate
made opens only for its own people (flow 6, The call's workspace, step 3). A team workspace is the team's only while whoever
pays for it is on the team: when they leave it, are taken off it, or delete their account, it stays theirs, with the people
in it, and the rest of the team is out of it (it no longer says Whole team, and nobody can open it to the team again).

## 13. Boards

A board is a page of stickies, shapes, lines and pictures that people add to together. It lives in a workspace with the
documents: in the list with a board's icon, in links, and in Trash when it's moved there. In a call it opens on the stage;
here it's on its own page, the same board, with no call around it.

**Making one.** **New board** in the list's **+** makes **Untitled board** there and opens it. In a document, **/** then
**Board** makes one beside the document and puts it in the page: a small picture of a board with its name on it, which
opens it. Someone who can't open that board sees **A board you can’t open** there, and nothing of what's on it.

**The page.** The board fills the page under the workspace's head, with its tools down the side and its bar along the top:
its name, its seal, Undo and Redo, how near you are, the map, **More**, the faces of whoever else is on it, and **Start a
call here**, which opens Start a call with the board coming too: one line says **Launch retro comes with this call. Start
now and it opens for you, ready to present.** Start now, and once the call's under way the board opens on your stage, just
for you, as a board picked from the call's board picker does: **Present** brings everyone, asking first about anyone who
can't open it. A board you can only look at comes with the call too, with no such line, and doesn't open. Schedule for
later, and the board is brought to that call, first in its board picker's boards, and opens only when someone opens it. The
bar's **More** has **Download as an image**, **Download as a PDF** and, for whoever can add to the board, **Night board**,
as in a call; a night board is dark on its page by day too. Everyone else on it has a pointer with their face and name, in a
colour of their own; you in another window aren't someone else. A blank board says **Double-click to write**: "It's text
on the board, and a sticky in a frame. Or press N for a sticky.", and that everyone who can open it can add to it too, when
that's so. To someone who can only look, it says **Nothing on this board yet**. What's added reaches everyone on it as it happens.

**Adding to it.** Double-click to write, ready to type: inside a frame, where votes, the frame's count and follow-ups look,
it's a sticky in the frame's colour, and **Tab** starts the next one beside it; anywhere else, on open board, it's plain text
with no box round it, as **Text** puts it, for labelling a diagram. **Esc** finishes either.
The tools are down the side: **Select** (Esc), **Sticky** (N) in six colours, **Text** (T) in three sizes, **Shape** (S; drag to size it, or click once, then type on it), **Line** (L), **Pen** (P; press
it again for the highlighter) and **Frame** (F). **More**, the **+** under them, holds what it holds in a call ([A board in the
call](#a-board-in-the-call), step 12): **Image**, **From your workspace**, **Table**, **Mind map**, **Comment** and **Templates**, and
a link on the board opens its document here.
Two people typing in one sticky both keep what they typed. The board's keys work as soon as the typing stops:
straight after **Esc** finishes a sticky, **N** picks the next. The call's letters still sleep for a moment after typing, as
everywhere. If what you're typing in goes from under you, as the board closes or a presentation comes over it, the board's
keys wait until you click or press **Esc**, so the rest of a sentence never makes or deletes anything.

**Changing what's there.** Click something and a small bar sits above it: its colour, its size, a line from it, copy (**⌘D**)
and delete (**Delete**), with handles to size it. Drag it to move it; a frame takes what's in it along. Drag round several, or
Shift-click them, to pick them together: the bar says how many and offers **Sort into themes**, which sorts stickies into
named columns in confidential compute, with Undo (as in a call), and **Tidy**, which puts them in a grid. Pointing at
something shows four dots just off its edges: drag from one onto something else, or press **Draw a line from this** and then
click it, and the line stays attached, finding a clean route whenever either end moves. **Undo** (**⌘Z**, with **⇧⌘Z** to redo,
or the arrows in the bar) takes back only your own changes, never anyone else's, whatever they've done since. **Sort into
themes**, on stickies picked together, sorts them into named columns when its answer comes; that's an undo of its own,
whatever you've started meanwhile, and the toast's **Undo** takes the sort back even after you've done something else.

**Looking round.** Scroll, or two fingers, to move; pinch or **⌘** and scroll to zoom; or hold **Space** and drag. The bar has
**−**, how near you are and **+**, **Show the whole board** (its tip says **⇧1**, which does the same), and **Map**, which shows
where you are on a board too big for the sheet. Scroll or drag off into empty space, so that nothing on the board is in view,
and the sheet offers **Back to the board** in its middle, which shows everything again; it goes as soon as something's in view.

**Under its name.** Pressing the board's name offers **Rename**, where the name becomes a field in its place (**Enter**
keeps it, **Esc** puts it back); **Saved in** the workspace, which shows it in the list; **Who can add to it**, the
workspace's share sheet, where the board can be shared beyond the workspace or closed to **Only people added here**; and
**Copy link**. Its tip says which of these are yours to do. Pressing the seal says how the board stands, in the seal's own
word: sealed, where it's saved and how it's encrypted in storage; or **Reconnecting**, **Couldn’t save** or **View only**,
with what that means, under the pill and never over it. Escape, or **Copy link**, gives the keys back to the board.

**Comments.** Pick a sticky and press **K**, or **Comment** in the **+** under the tools, and a field opens beside it.
With nothing picked, **K** comments on what the pointer is on, or on the next thing pressed (**Esc** stops). A comment
pins its writer's face to the corner of what it's on, with how many have replied since, hanging under the corner where it
would cover a frame's title and count; pressing the pin opens the thread, with **Reply** and **Resolve**, which a toast can
take back. Comments aren't on the board: nobody's Undo takes one back, and a sticky that's deleted takes its comments with
it, and brings them back with it. A board presented in a call shows everyone following it every comment and pointer, as ever.

**When things go wrong.** The seal says how the board stands, and the pill at the top of the sheet says the rest.

- The connection drops: the seal says **Reconnecting**, and the pill **Keep going. Your changes are safe here.** What's
  added is kept in this browser, sealed, through a reload, and goes when the connection's back, once, with nothing lost
  or doubled. A toast says so. While the browser is online, the pill and the seal have **Try now**, which tries again at once.
- Alcove won't take what was added: the seal says **Not saved**, and the pill says how many changes are only on this
  screen, with **Try again**. It tries again by itself as well.
- Someone given view only: the tools go and the seal says **View only**. They can still look round, follow people and
  read the comments.
- Someone moves it to Trash: a bar says who, the board stops taking anything, and **Restore it** brings it back.
- It stops being yours, or it's deleted, or you're taken out of the workspace: the page says **You can’t open this
  board**, the same as for a board that never existed, with the way back. Anything changed on it that didn't reach
  Alcove is kept in this browser, and **Discard** says it drops every change made on it, moves and all.

On a phone the list and the board take turns, as a document does, and the board is the phone's: it opens on its first
frame at a size it can be read, you drag to look round and pinch to zoom, and the bar keeps the name, the seal, **More** and
**Start a call here**. The one tool is **+**, at the bottom right: a sheet rises in your own theme (dark on a night board)
with one sticky, its colours and a button that says where it's going, and the sticky goes into that frame's first free
place. Someone who can only look has it to look round. Drawing and moving things stay on bigger screens.

**After the call.** The boards that were open in the call, the ones you can open, are among **Shared and made in this
call** on the call's page, under its stage: each as a card with a picture of all of it, as it is now, in your theme as the
board's own page is, its name and who worked on it, and a breakout room's saying which room (**In Comms**). One press opens
its page. On a phone they're in the call's **Shared** tab.
The stickies in the call's board's **Actions** frame come back as suggestions to review. Once accepted they appear under
**Follow-ups from the board**, in Notes after the call's own: with owners, taking on, ticking and the rest, as any follow-up has. The notes read a board, along with what was
said, only when everyone the notes went to can open it, because one summary goes to all of them; under the cards, the call's
page says so to whoever can open one (**Not everyone invited can open Retro, so the summary leaves it out.**). A room's board's
follow-ups are in that room's section of the notes, and the room's line says it had a board. The next call in a series brings
the boards open in this one.


## 14. Agent access

An agent (Claude, ChatGPT, Cursor, VS Code, Claude Code, Codex, or anything else that works with MCP) uses Alcove only as
far as you allow, and never beyond what you can do yourself. Notes, calls and your calendar each have a level, and sharing
and deleting notes are choices of their own, off unless you turn them on. Wherever you allow one, Alcove says the agent
gets readable information, which its maker handles under its own policies. Allowing an agent lasts 30 days, and a token as
long as it was made for. Signing out of a browser doesn't disconnect an agent; **Disconnect**, its access running out and
deleting the account end it.

**Agents** (`/agents`) is a place at the foot of the side panel, after Team (flow 2). On a phone
it opens from **Settings → Connections** (flow 11), and its head has a way back to Settings. It's Team's evening the other
way round, the sun low on the right just past the end of the line, and the agents stand on the horizon as windows, as people
stand in arches:

- the connected ones first, solid, each with its name and when it was last used under it (**4 min ago**, **Yesterday**,
  **Not used yet**, or **Just connected** in its first minutes), in the order of the list below, then other agents, then
  tokens
- then a gap, and the agents people use that aren't connected yet, dashed: Claude, ChatGPT, Cursor, VS Code, Claude Code
  and Codex
- then **Another agent**, a plug

A connection's mark comes from the name the agent gives itself, and is only ever its picture: a token is a key, and a name
Alcove doesn't know is a bot. One whose access ends within three days says **Ends tomorrow** (or **Ends today**, or the
day) under its name, in caution, with a dot on its window. Before one is connected the sky says **Connect your agent**,
*Ask it about your calls, and let it book them. It can do only what you allow.*; after, **Your agents**. Each window opens a
popover under it (a sheet on a phone) with one thing to do.

1. **Connect Claude.** Press **Agents** in the side panel, then Claude on the horizon. Its popover says *In Claude, press
   Add, then Add custom connector, and paste this address.* over Alcove's address, and **Copy and open Claude** copies the
   address and opens Claude's connectors (Customize › Connectors) in a new tab. ChatGPT's says *In ChatGPT, press +, then
   Add custom MCP server, and paste this address.*, and opens ChatGPT's plugins. The popover stays as it was, so the button
   can be pressed again: nothing here waits for Claude, which asks on a page of its own. While the popover is open after
   that, Agents looks for a new connection every 3 seconds. Add Alcove in Claude, and Claude opens Alcove to ask what it
   can do (14.2). The moment it's allowed, this tab knows too: Claude stands on the horizon, and its popover says
   **Claude is connected**, *Ask it something in Claude, like:* "What did we decide about the launch?", with copy.
2. **Allow it, with less than it asks for.** The agent opens Alcove's `/connect` with its request, a pointer that carries no
   credential. Signed in, Agents asks in its place; signed out, you sign in first (**Sign in to connect your agent**), and
   Agents asks after. The sky grows, and the agent's window, outlined in rose, stands on the horizon beside you in your arch,
   joined by a dashed line. **Claude wants to use your Alcove**, then a row for each part of Alcove it asked for, each set to
   all it asked for and each a menu of levels that say what they allow: **Notes** (Off, Read, Read and edit), **Calls** (Off,
   See, See and book) and **Calendar** (Off, See), with only the levels it asked for. When it asked to share or delete
   notes, **Share or delete notes** has a switch for each, off until you turn it on. *Claude gets readable information from
   Alcove, under its maker’s own policies.* **Allow** can't be pressed while everything is off; beside it is **Cancel**, and
   under them *Only allow this if you just added Alcove to Claude. It lasts 30 days.* Allowed, the line between you closes
   with a tick, **Claude is connected**, *Taking you back to Claude…*, and a moment later the browser goes back to Claude.
   An agent that's an app on this computer opens without the page going anywhere: then the page is as it was, with the agent
   on the horizon. **Cancel** tells Claude no, and a toast says nothing was shared with it. While the request is read it says
   **Reading the request**; one that doesn't load says **This request didn’t load**, with **Try again**. `/connect` without
   a request grants nothing, and says to open the connection from the agent.
3. **One button: Cursor or VS Code.** Cursor's popover says *Cursor asks to add Alcove. Then you choose what it can do,
   here.*, and **Add to Cursor** opens Cursor, which asks to add Alcove. The popover stays as it was; Cursor opens Alcove,
   Agents asks, as in 14.2, and once it's allowed the popover says it's connected.
4. **One line: Claude Code or Codex.** Claude Code's popover has the line to run in your terminal, with **Copy command**:
   *Run this in your terminal, then /mcp in Claude Code to sign in.* Codex's line signs in as well: *Run this in your
   terminal. Codex opens Alcove to sign in.* The popover stays as it was, and Agents asks, as in 14.2.
5. **Change what an agent can do.** Press a connected agent. Its popover says when it was last used (**Used 4 min ago**,
   or **Token · used Mon** for a token), then **What it can do**: Read notes, Edit notes, Share notes, Delete notes, Read
   calls, Book calls and Read calendar. Pressing one changes it at once, **Saved** shows beside the heading, and the agent
   can, or can't, from its next request. The last one can't be taken away: a toast says to disconnect instead. The foot has
   **Disconnect** and when its access ends (**Until 20 Nov**).
6. **Disconnect an agent.** **Disconnect** asks in the same popover: **Disconnect Claude?** *It stops working at once. To use
   it again, connect it again.*, with **Keep Claude** (filled) and **Disconnect**. It leaves the horizon, with what it did,
   and a toast says it can't reach Alcove any more.
7. **See what your agents did.** Once an agent is connected, under the horizon, **What your agents did** (*Only you see
   this*) lists each thing your agents read or changed, by day and newest first: a mark for what was done, a sentence
   (*Claude booked* **Onboarding review**), a second line (when the call is, or how many it found) and the time. A note in
   it opens the note, and a call opens its page. Reading is quiet; a booked call is warm, a follow-up in horizon and a
   decision in rose. **Show more** goes further back. A note or call that's gone, or isn't yours any more, isn't named: it's
   "a note", *Not there any more*. It keeps 30 days, and the last 1,000 things at most, and goes with the agent that did
   it. Before anything's done it's one row, **Nothing yet**: *What Claude reads and changes in Alcove shows here, newest
   first.* If it doesn't load, its row says **Didn’t load**, with **Try again**. Beside it, **Ask your agent**: four things
   to ask, naming people you work with, each with the mark of the row it will make, and copy. Once an agent is connected,
   each says which of your agents can do it (**Claude and Cursor can do this**) or what they can't (**Claude can’t book
   calls**). Tokens aren't among them: nobody asks a script. With nothing connected there's nothing your agents could have
   done, so the water is only **Ask your agent**, two across.
8. **A token for a script.** Press **Another agent**: Alcove's address with **Copy address**, then *A script that can’t sign
   in?* **Create a token**. Give it a name, choose how long it **Lasts** (7, 30 or 90 days; 30 to start) and **What it can
   do** (reading, to start), and press **Create token**. It shows once, hidden but for its ends, with copy, and Alcove's
   address under it with copy: *Copy it into your script now, with Alcove’s address. It won’t show again.* **Done** forgets
   it, since nothing else keeps it, and the token stands on the horizon with a key.
9. **Keep one longer.** An agent whose access ends tomorrow says so under its window. Its popover says *Its access ends
   tomorrow* and offers **Keep it 30 more days**, which keeps it for 30 days from then, and a toast says until when.
10. **A request that ended.** A request that waited too long, or was answered in another tab, says **This request ended**,
    *It waited too long, or was answered in another tab. Start again from Claude.* (from your agent, when the request can no
    longer say whose it was), with **Show me how**, which opens that agent's popover on the line, or Another agent's.
11. **Settings points to Agents.** **Settings → Connections** keeps one row for agents: who's connected, and **Open
    Agents** (flow 11).
12. **On a phone.** Agents opens from Settings. The line scrolls sideways under the sky, and what your agents did follows
    under it. A window opens a sheet, allowing works the same, and the page's head goes back to Settings.

While Agents loads, three empty windows breathe on the line. **Your agents didn’t load** says Alcove couldn't reach the
server, with **Try again**. Offline, **You’re offline**: your agents keep working, and the page catches up when you're back.

Storybook's journeys use these numbers, **14.1** to **14.12**. Claude, Cursor and the terminal are outside Storybook, so a
journey plays up to handing over to them, opening no tab or app, and the stand-in plays the agent's side.

## 15. Google Drive exports

Google Drive is a separate connection in **Settings → Connections → Google Drive**: one line that says where notes go
("After each call: notes and transcript to Call notes.") until **Manage** opens its folder, files, recent exports and
**Disconnect** in place, and **Done** folds it again. **Connect** the Google account that should own exported files and
consent to access only files and folders selected for Alcove. **Connect** and **Reconnect** first open a disclosure
explaining what Alcove gets from Google and what it uploads. **Continue to Google** opens Google’s consent and folder
picker. Connecting or disconnecting Drive leaves ordinary Alcove sign-in and Calendar settings alone. Google’s pages are outside Alcove; returning lands on Google Drive, open, and says what
happened, leaving the existing settings in place after cancellation or failure.

1. **Choose default files.** Select finalized notes as Markdown (with the full summary under the short one), transcripts
   as plain text, or retained original audio pieces as a ZIP. Each is an explicit choice. **Export after each call** stays
   unavailable until a folder and at least one type are chosen, and covers calls that end after it's turned on: its help
   says so. A call's files go as soon as its notes are final, not at the next upkeep. Every setting saves as it changes. Pausing exports keeps the choices. Only finalized, retained
   material the exporting account can still access is eligible; a call ending does not promise an export exists.
2. **Choose a shared-drive folder.** The destination opens a folder picker, showing authorized folders and whether each
   belongs to a shared drive. The picker explains what **Choose in Google** permits before opening Google to authorize another folder and return to Settings. Choosing a
   folder checks current write permission before it is saved. An unavailable destination is refused, with no fallback to
   another folder. The selected folder’s existing sharing rules apply to the readable exported copy; Alcove never adds
   people, makes public links or exports another person’s private notes.
3. **Override one call.** On a call’s page, **More › Google Drive** opens a window that says whether automatic exports cover it:
   "Uses your automatic export settings.", "This call ended before automatic exports were on, so it isn’t exported." for a
   call that ended before they were turned on, or "Automatic exports are off, so this call isn’t exported.". When a call
   they don't cover has files in Drive already (it went while they covered it, before they were turned off, or off and
   on again, or by its own export, since stopped), it says they don't cover it, and that its files already in Drive stay
   there and changes to the notes aren't sent. A call they
   don't cover has **Export to Google Drive** under its folder: it saves this call's own choice with the folder and files
   shown, and the files upload straight away, **Uploading**, then when they went. **Use custom settings** gives this call
   its own authorized destination and file choices, with **Export to Google Drive**, and once it's exporting, "Goes to
   this folder. The copies follow the notes when they change." with **Stop exporting**. Returning to defaults removes the
   override. This changes only that person’s export settings for the call.
4. **Retry an export.** Recent exports name their source call and end each line with when it went (a link to the file in
   Drive), **Uploading**, **Waiting to upload**, or why it didn't go, with **Try again**. One that went wrong in a way
   that may pass (Google busy, the network) says why, quietly, and when it's tried next (**Next try 16:52**). **Try again**
   sends it at once, not at the next upkeep. It rechecks permission and, with the same destination, keeps the same export identity
   so an uncertain response does not create a second file. Choosing another destination and retrying a failed export
   intentionally creates a new copy there; existing copies stay in their original folder. Revoked Google access asks
   for reconnection instead. Regenerated
   finalized material updates its export according to the documented export version policy.
5. **Disconnect Google Drive.** Disconnect stops further queued exports and forgets this connection. Deleting a source or
   losing permission also stops further exports. Copies already in Drive remain governed by that folder and must be
   removed in Drive; deleting them from Alcove does not delete the exported copies.

6. **Export shared call notes.** Anyone who can read a call’s notes can manage their own exports and destination. These
   choices do not affect the organizer or other readers. Original audio is available only to the organizer and only
   when the call retained it; unavailable audio is disabled with the reason beside the format. Global defaults may
   still select retained audio for future calls the person organizes.

7. **Review Drive permissions.** Press **Connect** beside Google Drive, read what access the export needs and cancel to
   stay in Settings without starting consent.
8. **Export a call from before automatic exports.** A call that ended before automatic exports went on says it isn't
   exported. **Export to Google Drive** sends it to the folder shown, with the files ticked in Settings, and they upload
   straight away.

Storybook’s journeys use **15.1–15.8** above. The account, folders and file links in the preview are made-up; real Google
consent and the provider’s own folder-selection page require manual verification with a supported Google account.

## 16. Plans and paying

Plans differ only in notes and storage: every feature is on every plan, and invitees get a call's notes on its organizer's
plan. Pro is paid in USDC from any wallet or exchange, for months at a time, and nothing renews by itself unless **Renew from
balance** is on (16.8); when a plan ends you're back on Free with nothing lost. Checkout is one window that opens over
wherever you are (Plans, Settings, the side panel, a call or a door), in your own theme even over a call. Closing it never
loses a payment on its way: the side panel and Settings show it, and opening it again opens that payment, not a new one.

### 16.1 See the plans

**Plans** (`/plans`) is what each plan brings and what it costs: Free, Pro and Team side by side, on the last of the sunset.
It's reached from the side panel's **Free plan · See plans** (16.7), Settings › Plan's **See plans**, checkout's **Compare plans**, and the welcome page's **Get Pro** and
**Start a team** (16.13), which open it with checkout open on Pro (`/plans?checkout=pro`) or on Team (`?checkout=team`;
`?checkout=hours` opens it on more notes); the address forgets it once checkout is open.

1. On Free, Settings › Plan's **See plans** opens Plans priced for a year: Pro is $16 a month, "$192 for 12 months. You save $48.", and **Get
   Pro** is the one filled button. Free's button area says **Your plan** with a tick.
2. **Monthly** shows $20 a month, "For as many months as you choose. Or $16 for a year or more."; **Yearly · 20% off** goes
   back. The switch shows only while a year or more costs less, and the saving is worked out from the two prices.
3. Every number is the server's: about how many hours of notes a period brings (Free: "Back to 5 hours on the 1st of each
   period"), the storage and the largest file. Free's last line says what more notes cost this period while they're offered.
   Under the plans, **On every plan**, then how paying works: "for 1 to 12 months at a time. Nothing renews by itself…".
4. **Get Pro** opens checkout over Plans (16.2), on 12 months with Yearly chosen and 1 with Monthly.

On Pro, Pro says **Your plan**, **Extend** is a second choice, and Free says "Where you’re back to if a plan ends". While Pro is
ending it says "Ends in 6 days" and **Extend** is filled. On a team license Pro isn't sold, and its card says "Not while you’re on
your team’s plan" where its button would be. While the prices load, the cards wait in place; if they don't load, the page says
why with **Try again**, and offline they show once you're back. The first time Home opens for an account, it opens on Plans
instead, once (16.20).

### 16.2 Get Pro, paying with USDC

1. **Choose.** Checkout's left side is the step and its right side is what you're buying: Pro's small arched window, "For"
   your name, the lines ("12 months at $20 — $240", "A year or more: 20% off — −$48"), **Total** in USDC and "Pro until" the
   day it runs to. Lengths are 1, 3, 6 and 12 months, each with its total; "20% off" marks a year or more, and **Another
   length** steps from 1 to 12. Then **Pay with USDC on**: Base, Solana, Ethereum and the rest, each with its mark ("From 20"
   where a network's minimum is higher). **Get the address** is the one filled button.
2. **Pay.** "Waiting for your payment", open for 24 hours. **Send exactly** the total, with Copy; the QR code with the USDC
   mark in its middle; the address made for this payment, its first six and last four characters in bold, with **Copy
   address**; "Only send USDC on Base. Anything else may be lost." On a phone, **Open in wallet** instead of the code where
   the network has a wallet link, else **Copy address**. The summary's sun waits on its horizon. You can close this: Pro
   starts as soon as the payment arrives.
3. **Seen.** The payment arrives: "Payment seen", the amount counts up, "Starting Pro. This takes a minute or two.", and the
   line Sent → Seen on Base → Pro starts. The sun lifts. There's nothing to press.
4. **Done.** The sun clears the horizon and a tick draws in: "You're on Pro", until when, the receipt row with **Receipt**, a
   receipt to print, "Nothing renews by itself. Alcove reminds you before it ends.", and **Done**. Pro starts at once with a
   fresh period and all of Pro's notes.
5. **Closed.** However the window is closed from Done, the page under it says once what was bought, in the server's dates:
   "You're on Pro until 4 Nov 2027." (extending, "Pro runs to 10 Nov 2027."; more notes, "10 hours of notes added."; a team,
   "Vandelay Industries is on Team." or "6 licenses added to Vandelay Industries."). Over a call, notes coming on again say
   it instead (16.9).

What you send is what the balance is short of the total: money already in the balance counts ("Your balance — −$5"). A
network's minimum above that raises the amount, and the summary says the rest stays in your balance. The payment adds the
money and buys Pro with it in one go.

### 16.3 Get Pro with your balance

With a balance that covers the total, Choose has no networks and the button is **Buy with your balance**: it goes straight to
Done.

### 16.4 Extend Pro

On Pro, **Extend** (Plans, Settings, or the side panel's ending row) opens **Extend Pro**: the summary says "Added to the 6
days you have left", and the months start after the last one, so no day is lost. Done says "Pro runs to …".

### 16.5 More notes for this period

On any plan, **Add 10 hours** (Settings › Plan's **More notes**, or a call whose notes have run out) opens **More notes**: 10,
20 or 50 hours at $15 for each 10, paid the same way. They add to this period's notes and lift a stop that ran out of
notes; they don't carry into the next period. Done says "10 more hours of notes".

### 16.6 When a payment isn't right

1. **Less arrived.** "Less than asked arrived": **Send the rest** to the same address. If you don't, what arrived stays in
   your balance.
2. **More arrived.** Done says how much more you sent: it's in your balance.
3. **It couldn't buy.** The price changed before the payment arrived, or less arrived than the months cost: the money is in
   your balance and checkout says why, with **Buy with your balance** at today's price, or fewer months.
4. **Nothing arrived in 24 hours.** The address closes and nothing was charged; **Get a new address** starts again. A payment
   that arrives after all is added to your balance and buys nothing, so a new address never buys the same thing twice:
   checkout and your payments say "Your payment arrived after its address closed, so nothing was bought. It's in your
   balance.", with **Buy with your balance**.
5. **Cancel.** While nothing has arrived, **Cancel payment** in the foot asks first: a payment sent to that address anyway
   still counts when it arrives, added to your balance as in 4. Once part of it has arrived it can't be cancelled: what
   arrived goes into your balance when the payment settles, and the address waits for the rest until it closes (1).
6. **Something went wrong.** Checkout says so, with the reference to give support.
7. **Payments off.** Choose says paying isn't available right now; a balance that covers it can still buy.

### 16.7 Your plan in the side panel

Your plan is at the side panel's foot, under the confidential-compute check. On Free, about how much of the period's notes is
left sits over a meter (warm under an hour, in caution once out) and opens Settings at your plan; under it, Free's row is the
panel's way into Plans: **Free plan · See plans** opens Plans (16.1), **Free plan · Get Pro** opens checkout on Pro once notes
are low or out, and on a team without a license **Free plan · Team** opens Team (16.19). On Pro or Team, the plan's own row
(its small sun, and until when, the team's name, or ending with **Extend**, 16.14) opens Settings at your plan. On Plans,
whichever row it is is the place you're on.

A payment for a year of Pro is on its way: the foot says "Waiting for 192 USDC", and **Pro, 12 months · Open** reopens it in
checkout. When it arrives, Pro is bought from it in the same go, and within half a minute the foot becomes Pro's own row: its
sun up, "Until …". Pressing it opens Settings at your plan, with the payment and its receipt. On Plans, that row is the
place you're on.

### 16.8 Renew, refund and your payments

On Pro, Settings › Plan says until when, with **Extend**. Turn on **Renew from balance**: it's kept and **Saved** shows. **Refund
($40.00)** asks in place: what goes back to the balance, that renewing from it turns off (while it's on), and that Pro ends
when the month running now does. **Refund $40.00** returns the months that haven't started to the balance, and the toast says
what came back; "Pro refunded, 2 months" is first in the payments. A refund turns **Renew from balance** off, so the months
given back aren't bought again. **Receipt** opens a payment's receipt over the page as paper, with **Print**.

### 16.9 Notes run out in a call

Notes stop for everyone and the call carries on. Over Notes' tabs, or in the banner while Notes is closed: "Notes stopped at
this period's 5 hours. The call carries on. Notes start again the moment you have more." The organizer has **Get Pro** and
**Add 10 hours · $15** (on Pro, the hours only), which open checkout over the call, whose **Back to the call** closes it; a stop
for storage says storage, with **Make room**. Everyone else reads whose notes ran out, with nothing to buy. Once the
organizer has bought more, wherever the payment lands (in checkout, after closing it, or in another tab), notes come on
again by themselves: "You're on Pro. Notes are on again.", and the notes mark **Notes stopped** and **Notes on again**. When
the plan has notes again without a purchase (a new period), the organizer is asked instead, with **Turn notes on**. Leaving
while notes are still stopped, the call's page says so in caution rather than "Notes are off": "Your notes for this period
have run out. What was said until then is in the notes." (anyone else reads whose), and the organizer has the same ways to
more there, none of them filled, since **Rejoin** is the page's filled button.

### 16.10 Start a call with no notes left

With none left this period and notes on by default, **Start a call** says "No notes left until 20 November" under the ways,
with **Get Pro** (on a paid plan, **Add 10 hours · $15** while more are offered), which opens checkout in the window's place,
and **Start without notes**. Once checkout closes, bought or not, **Start a call** opens again as it was, with whoever and
whatever it was opened with. Scheduling a call with notes on for a time before the period renews says "None left
until 20 November" under the Notes switch, with the same way to more, opening checkout over the Calls page, so the call
being scheduled stays. A question asked across your calls (the palette's **Ask**, or the Calls page's) with none left says
"No notes left until 20 November" in the answer's place, with the same way to more; typing again or putting the answer away
puts it away.

### 16.11 Storage full

An upload refused for storage says "Your storage is full. Pro has 100 GB." with **Get Pro** on Free, or **Make room** (the
Drive); in someone else's workspace it says the workspace can't take more files: the storage it counts against is full, or
the rest of it is kept for notes and recordings. Someone adding to another's storage past what they can add in a day hears
they can add more tomorrow. A file over the plan's largest says its limit, and offers nothing.

Whoever paid for a workspace leaves it, is taken out or deletes their account: its longest-standing admin with an account
pays for it now. Settings › Plan says so at the top, by its name, with the day its files start to count against their
storage, a fortnight on: nothing of theirs stops before then. The side panel says it in one line over the plan until it's
dismissed. Leaving a workspace you pay for while none of its other admins has an Alcove account is refused, and says to make
someone who has one an admin first.

### 16.12 An hour left

Once a period, when notes left drop under an hour: "Less than an hour of notes left this period", with **Get Pro**, never in
a call. The side panel's number turns warm.

### 16.13 Plans before signing in

The welcome page's **Plans**: Free, Pro and Team in a cove at the last of the sun, with what they cost (Team's for each person),
their notes and storage, **Start free**, **Get Pro**, which signs in and then opens Plans with checkout open on Pro, and
**Start a team**, which signs in and then opens it with checkout open on starting a team (16.15).

### 16.14 Pro ending, renewed, ended

A week before Pro ends without renewing, the foot's sun is half set ("Ends in 7 days · Extend", "Ends in 6 days" the next
day), and Plan says when in warm, with **Extend** filled; with browser notifications on and **Your plan** ticked (11.25),
the browser says so too, and again a day before it ends. With renewing on and less than a month's price in the balance,
Plan says Pro won't renew; once **Add money** brings the balance to a month's price, it says it renews and the sun is up
again. At the month's end a month is bought: "Pro renewed…" shows at the top and in the foot until dismissed. When Pro
ends without renewing you're back on Free with nothing deleted, said at the top, with **Get Pro again**, and in the foot.
Over Free's storage, everything works as before for a grace, then uploads and notes stop until you make room or get Pro
again, which lifts it at once.

### 16.15 Start a team

A team is one admin (whoever starts it) and as many people as it has licenses for, and you're on one team at most. Team's card
on Plans says what a license is (a price for each person, for a period: $40 for 30 days unless the limits say otherwise) and,
on **Yearly**, what one for a year costs a month ($32, $384 a person for 12 months), and **Start a team** on it opens checkout
on Team over the page, for a year while Plans is on **Yearly**; a company's Team page has the same as a quiet row while you're
on none, opening on a month, and the welcome page's signs in first (16.13).

1. The team's name, the company's to start with, with you its admin; how long, **Monthly** or **Yearly · 20% off** (while a
   license for a year is offered); and how many licenses: one for each person, you included. A license for a year is one
   person for 12 periods, $384 ("6 licenses for a year at $32 a month": $2,304); it runs a year from when it's taken, is
   refunded in full while nobody has taken it, and isn't once it's taken.
2. Pay from the balance, or with USDC on a network (16.2): the summary says exactly what to send. Getting the address makes the
   team at once, with you its admin, and opens the payment for its licenses; the side panel waits for it as for Pro's.
3. Once the payment is added, so are the licenses, with nothing to press: "{team} is on Team". Your license is taken then, and
   each of the others when the person it's for next opens Alcove.
4. **Done** has the way to invite them: a link for one person (16.17), and its receipt says what was bought ("Team, 6 licenses
   for a year"), as Settings' payments do. Team is your plan on Plans from then, with **Buy licenses** on its card. A license
   replaces Pro at once: the month running ends, and the months that haven't started go back to the balance, which you're
   told.

### 16.16 Join a team by its link

An invite is a page of its own (`/team/join#…`), one card on the team's evening. Its secret is after the `#`, so no server sees
it, and it leaves the address bar at once. Signed out, it asks you to sign in first, there (Google's way back comes back to it),
while the invite waits in the tab. Then it says whose team it is and what joining gives you (notes of your own, what the team
shares, its storage), with **Join** and **Not now**: nothing happens until Join. Join takes one of the team's licenses for a
period if one is left, and **Open Alcove** opens the team's page, with you on it under your license. A used or expired link, or
being on a team already, is refused in Alcove's words.

### 16.17 Your team: people, licenses and invites

On a team, Team is the team's page: its name in the sky over how many are on it, and its people on the horizon, each under
their license, opening their popover as on a company's line. On the water, everyone as a row with their role and license
("Licensed until 12 Dec", "License ended", "Waiting for a license"); the admin's **Remove** asks in place, under the row (their
license isn't refunded, they go back to Free, and notes they made visible to the team stay visible). At the foot, **Leave team**
for a member, asked the same way, or for the admin **Delete team** once nobody else is on it, which refunds the licenses nobody
took. Then the notes made visible to the team, each opening its call's page (8.46), and your groups and what's shared with them,
as ever. Beside them, for the admin: **Licenses**, how many are left and who's waiting for one, with **Buy licenses** (filled
while someone waits), which opens checkout on Team, month by month or for a year as 16.15, and buying one for a period from
the balance whenever it's needed; and **Invite people**: **Make an invite link** makes a link that lets one person join, for
a day, shown with **Copy**; each press of **Make another** makes a new one. A member without a live license is told first, at
the top of the water, why the team's notes and workspaces aren't open to them.

### 16.18 Licenses running low

A license is taken when someone without a live one uses Alcove: when the app opens signed in, when a tab comes back after 30
minutes or more away, or when they join. Nothing that reads in the background takes one. It runs a period from then, and an
ended one is replaced only by the next visit. With fewer than five left, the team's admin is told: the side panel's Team row
says how many, in warm, with **Buy** ("2 licenses left · Buy"), which opens checkout on Team over the page you're on, and
Settings › Plan says it at the top ("2 licenses left on Vandelay Industries. Buy more so nobody is left without one.") until
it's dismissed, when the row says the team's name again. In Settings, **Licenses** says how many are left of how many, with
**Buy licenses**; **Buy one when it’s needed** buys a license from the admin's balance whenever someone needs one and none is
left; and **Refund** gives back the licenses nobody has taken, asked in place.

### 16.19 On a team without a license

When none was left for you, you stay on your own plan, and the team's admin is told. The side panel says it over your own plan:
"No team license yet" in caution, and under it who has been told ("Priya has been told"), or for the team's admin "Buy
licenses, and one is yours". On Free your notes left and the meter stay under it, and Free's row is **Free plan · Team**, which
opens Team. Settings › Plan says it once at the top, over your plan. The next time you open Alcove after the admin buys
more, one is yours: your plan is Team, your license runs a period, and the side panel's foot is Team's row, over the team's name.

### 16.20 Choose a plan

The first time Home opens for an account, it opens on the plans instead, once: the plan choice, Plans in Home's place with a
head of its own. That's every new account, after its arrival (1), and every account from before plans, the first time it opens
Alcove normally after plans came.

1. Someone with no notes yet reads **Choose a plan**: "Every plan has calls, workspaces and confidential compute. They differ in
   hours of notes and storage." Someone who has used Alcove reads **Alcove has plans now** and which plan they're on, in the
   server's numbers: "You’re on Free: about 5 hours of notes a month and 10 GB of storage." Over Free's storage, it says until
   when everything works as before instead.
2. Under the head, Plans as ever: Monthly / Yearly, then Free, Pro and Team. The plan you're on leads straight on: **Continue on
   Free**, quiet, on Free's card (on Pro or Team, **Continue on Pro** or **Continue on Team** on theirs), goes to Home.
3. **Get Pro** is the one filled button and opens checkout over the plans (16.2), as **Start a team** opens Team's (16.15). Once
   what was bought is yours and checkout has closed, Home follows, with nothing more to choose. Closing checkout without buying
   leaves the plans as they were.
4. A new account's tour of Home (1, step 4) starts once Home is there, never over the plans.
5. Only Home opens on them. A link to a call, a call's page, a join link, an agent's consent page, a public page or a team
   invite is never interrupted, and nor is signing in from a call's link or for an agent: the plans wait for the next time Home
   is reached. Signing in from the welcome page sails out of its cove onto them, as it would onto Home (1, step 3), the sun
   sinking to their last sliver; a new account's arrival says "Opening Plans" and its arch opens onto them.
6. Once the plans have been on screen for a moment (the tab showing, nothing open over them), Alcove is told, and they aren't
   shown again. Plans itself counts too. If telling Alcove fails, it's tried again quietly, and this tab doesn't show them again;
   a later visit does. Left before their prices came (still loading, offline, or not loaded), they show again on a later visit.

While the prices load, the cards wait in place and **Continue on Free** is already on Free's; offline it says the plans show once
you're back, and when they don't load it says why, each with **Continue on Free** to go on.

### 16.21 Team at the third invite

On a company's Team page while you're on no team, the invite that makes three of you (you, everyone on Alcove and everyone
invited) goes as ever, and Team is offered beside it, once for the account on this browser: "That makes 3 of you. Put everyone
on one plan: Team, $40 a person a month." in the server's price, with **See Team**, which opens checkout on Team over the page
(16.15). Leaving it is Not now: it goes by itself, and invites after it say nothing more. Nothing is offered on a team.

Storybook's journeys use **16.1–16.21** above. The addresses, payments and networks in it are made up; a real
payment through 1Click needs a hand check with a wallet.
