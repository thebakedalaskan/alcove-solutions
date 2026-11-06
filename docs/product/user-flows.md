# User flows

[Docs home](../README.md) · [Product overview](overview.md)

Each flow below is implemented in `apps/web` and exercised end to end by the integration tests in
`apps/api/src/flows.integration.test.ts` (API level) and by a real-browser check before release.

## 1. Sign in

1. Open Alcove. Signed out, the welcome page shows what Alcove does, as one evening on the app's own scene: the
   note a call leaves, with its call along the horizon; the call itself, a feature at a time, each looping while its
   step is the one being read (Documents and boards, Captions in your language, Set your status, Breakout rooms, A
   quiet nudge, Private messages and threads, Arrange it your way); finding a time with your team; your agent using
   Alcove; recording in the room without a connection; and what Alcove can see. Each scene plays while it's on
   screen, and shows a still with reduced motion. Choose **Continue with Google**, **Continue with Microsoft** or
   **Use single sign-on**, at the top or the bottom of the page; single sign-on asks for a work email in place.
2. **Google** goes to Google's account chooser and consent screen, which also asks for the calendar (events
   only); unticking it still signs in. If the sign-in doesn't happen (cancelled, too slow, an email Google
   hasn't verified, too many attempts, or Google not set up on this server), the welcome screen says why.
3. The first time, the account is created on screen, in about six seconds: an arch draws itself, dawn fills
   it and the sun rises, while what came with the account arrives a row at a time, each with a check. **Signed
   in as** the name, with the provider's mark (a key for single sign-on). **Your calendar**: how many calls are
   left today and which is next, from the connected or sample calendar (no row without calendar access). **Your
   team at** the company, with its size and faces, when it has people in it and has arrived by then (the screen
   doesn't wait for it). **Notes are written in
   confidential compute**, with the time the hardware was verified when this browser could check it. Then
   "You’re in" and the arch opens into Home. **Skip**, **Escape** or **Enter** opens it straight away; with
   reduced motion the finished screen shows for a moment and Home follows. After that, signing in goes
   straight to Home.
4. On first arriving in Home, a tour goes through it, one slide at a time: a card with a short animation, and
   the page dimmed around the real thing the slide is about, with an arrow to it. **Start or schedule a call**
   (Start a call, or Start now with the side panel hidden), **Notes for your calls** (the example note before there are
   any, then Notes), **Join a call** (Join, when an Alcove call is on offer at the top of Home), **Record in the room**
   (Record, in the side panel or the phone's tab bar), **Your notes stay yours** (the confidential-compute check in
   the side panel, or the badge on Home on a phone) and **You’re ready** (Start a call). The card
   moves beside its target, or along the bottom on a phone; **←**/**→** and **Enter** move through it and
   **Escape** or **Skip tour** closes it. It isn't shown again on that browser for that account; **Take the
   tour** in Settings (flow 11) plays it again.

The first sign-in creates the account: its keys, a profile with the name, email and photo from the sign-in,
the notes default (on) and 10,000 credits. Later sign-ins bring the name, email and photo up to date. Microsoft
and SSO are still stand-ins: Microsoft signs in Art Vandelay (art@vandelay.industries), and SSO signs in
whoever's email was typed, with a name made from the address, as long as it's an address no real person can
have (at example.com or another domain reserved for examples, or at vandelay.industries). These demo accounts get a sample day of
five calls whenever nothing is coming up at sign-in, the first about 12 minutes later.

A session lasts until sign-out, 14 days without use, or 30 days in all; then the app goes back to the welcome
screen. Signing in on another browser doesn't end the first session.

## 2. The side panel

Beside every page, dark in both themes:

- **Start a call** (or **N**) opens flow 4.
- **Home**, with how many things are waiting on you; **Notes**, with how many notes you have; **Drive**, every workspace,
  where you write together (flow 12); **Record**, where recording in the room starts (flow 9), with how many recordings on this
  device are waiting to upload; and **Team** (flow 10), with how many people at your company use Alcove, you among them,
  once anyone besides you does. Someone on their own, at a personal address, has no Team page and no groups here.
- **Up next**, on every page but Home: the next Alcove call today, or the next meeting on your calendar
  that has a video link (unless **Show my other meetings on Home** is off), when it starts, who's coming,
  and **Join**. With nothing left today it says the next call will show there, except before your first
  notes, when it says nothing.
- **Pinned**: the notes you pinned, in the order you pinned them, up to 8. A pinned note that was deleted,
  or that you removed from your notes, isn't listed. The pin beside the heading opens the palette to pick
  notes to pin or unpin; with 8 pinned it says to unpin one first. With nothing pinned, a line says what
  pins are for.
- **Groups**: each of your groups and how many people are in it. Each opens on the Team page, and **+**
  starts a new one there.
- At the bottom: the confidential-compute check (**Confidential compute · verified** when the server's
  hardware answer is bound to this browser's request), and the time of notes left, which opens Settings at your
  minutes.
- Offline, a notice at the top says recording still works and everything else catches up when you're back
  (with **Record without a connection** off, that recording waits for the connection too). Up next and the
  check wait until the connection returns. Alcove also opens offline for someone signed in on this browser:
  Record works, and every other page says it's offline, with **Record**.
- **Hide the side panel** gives the page the room; the button left in the top-left corner brings the panel
  back, and the offline notice moves to the top of the page meanwhile. This browser remembers which.

At the top right of every page: **Search or ask** (**⌘K** on a Mac, **Ctrl+K** elsewhere), which opens the palette
below, and you, which opens Settings (flow 11). In a narrow window search shrinks to its magnifying glass. Notes has
its own search, so there's none at the top right, and the shortcut goes to the line in its sky (flow 8). In the workspace
the shortcut is **Find** (flow 12), and **Search or ask** stays at the top right without it.

On a phone (860 px wide or narrower) a top bar takes its place, with the brand, search (not on Notes), **Start a call** (a plus) and
you (Settings), and a tab bar runs along the bottom: **Home**, **Notes**, **Record** (raised), **Drive** and **Team**
when you're on one. Offline, the same notice sits under the top bar.

**The palette** is one line over the page. Before anything is typed it lists your five newest notes. Typing
lists the notes whose titles, summaries or transcripts match, up to eight, with the match marked. **Enter**
or **Ask** asks every note you have (flow 8), one question at a time: the answer appears under the line with
the notes it comes from and the moments in them, and a moment opens its note with the player at that point,
not playing. **↑** and **↓** pick a note instead, and **Enter** opens it. **Escape**, or the shortcut again,
closes the palette, and focus goes back where it was. It never opens over another window, such as Start a call, and nothing opens over it.

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
  (flow 5). **Schedule** opens scheduling at Who (flow 4). The third button schedules a call for now and copies its
  link, so it's listed with a card like any other (**Undo** cancels it), and isn't on a phone. Under them, up to three people on your team who use Alcove: pressing one starts a
  call and rings them when you join. **+** opens scheduling at Who. Someone on their own has no one to show.
- While a call is going, or from 5 minutes before one with someone else on it, a line above **Start a call** names it
  with **Join** (**J**), and says when it starts or **Happening now**. It's the one time a call comes near the top: people
  join from their calendar. A call that's going comes first. A calendar meeting needs a video link to get this line, and
  its **Join** opens that link in a new tab. **Join** takes the filled button, and **Start now** gives it up.
- **For you**, with how many things are open: what needs an answer, as tiles, then your follow-ups as a checklist.
  With nothing open, it says so. The side panel's **Home** shows the same count.
- The tiles, newest first, the first six and then **Show more**. A **Decision** (rose) proposed in any note you organized or
  were invited to that nobody has confirmed, by the notes or by someone else, saying whose words it's in: **Confirm**, or **×**
  for it wasn't decided, each with **Undo**. On someone else's note, **×** says so for everyone and the organizer settles it,
  and it stops waiting on you. On your own notes, **Disputed** is one someone confirmed that someone else says wasn't
  decided: **Keep it confirmed**, or **×**. A **Follow-up** (blue) the notes suggest is yours, that someone gave you or suggested
  (the tile says **From** them), or that changed since you took it on (**Changed by** them), with the date it's suggested for:
  **I’ll do it**, which puts it in your follow-ups, or **×**, which leaves it with nobody (then **It’s mine** gives it back to
  you, taken on). Each shows **What was said** and anything to be careful of. **Shared with you**: notes
  someone shared in the last 7 days, with **Read the notes**. What you answer stays where it is, saying what you did,
  until you leave Home. Each tile's time opens its note at the moment it was said, when the notes know it.
- The checklist: the follow-ups you took on and haven't done, from every note you have, soonest first, with the rest
  after them. The due words count from when they were said: the last time the due date was changed, or else the call. A
  day ("today", "EOD", "tomorrow", "Friday", "Friday next week", "Nov 5") is that day, so "tomorrow" said yesterday is
  due today, and it says when ("Today", "Thu", "Fri 13 Nov"). A stretch of time ("this week", "next week", "in two
  weeks", "end of the month", "next month", "end of March", "Q1") is due when it ends, so "next week" said last Friday is
  this week, and it keeps the words. Words with no date ("ASAP", "later") show as they were said, under the follow-up
  when they're long. A follow-up's words open its note, at the moment it was said when the notes know it. Ticking one
  crosses it out, and ticking it again puts it back.
- **Coming up**: every Alcove call ahead and, with Google Calendar connected, the meetings with someone else on them,
  one line each, soonest first: **Now**, the time today, the day and time this week, then the date. The call on offer
  above stays listed too, so it can always be opened. Time blocked out on a calendar
  with nobody else on it isn't listed. A call waiting for a guest to pick a time says **Soon** and **Waiting for Jamie
  to pick** (someone invited reads **A time is being picked**). A call you're invited to and haven't answered says so, and
  other people's calls are listed for the next 90 days. A series shows its next call only, and a calendar event that's a
  copy of a listed call isn't listed twice. A call just scheduled rises in. An Alcove call's row opens its card (flow 4),
  where **What carries over** opens its series. A calendar meeting has a menu (**⋯**) with **Open in Google Calendar**
  (in a new tab), **Use Alcove instead** when you organized it (the calendar event gets the Alcove link, and Google tells
  everyone on it), and **What carries over** when it's in a series. With **Show my other meetings on Home** off
  (Settings), only Alcove calls count.
- **Recent notes**: your four newest, one line each, and the heading opens all of them.
- Signed in with Google without sharing the calendar, a card offers **Connect Google Calendar**; **Not now** puts
  it away in this browser.

The tiles and the checklist come from the inbox (`GET /v1/notes/inbox`): the follow-ups for you that aren't done
(taken on, or only suggested); the decisions in written notes that nobody has confirmed or rejected and that you can
confirm, unless it's you who proposed one or said it wasn't decided; and, in notes you organized, confirmed decisions
someone disputes; newest note first. Follow-ups in notes someone else shared with you count; ones you removed don't.

Before your first notes, **Get set up** takes the place of **For you**, with what's left to do: **Read an example
note**; **Connect your calendar**, unless one's connected; and **Invite your team**, unless you're on your own (flow 10).

## 4. Start or schedule a call

**Start a call** (or **N**) opens a small modal from anywhere. On a phone it's the plus in the top bar, and the modal
is a sheet from the bottom. It asks one thing: **Start now** (**Enter**) or **Schedule for later** (**S**). **Escape**
closes it, closing asks nothing, opening it again starts clean, and focus goes back where it was. A person or group on
the Team page opens it with them already picked. Whether someone is on a team or on their own comes from their
address, and nothing is a setting: on a team it says "Ring your team in, or share a link", on your own "Get a link to
send to anyone".

1. **Start now** creates the call and goes to the organizer's lobby, with anyone picked already there to ring. Night
   floods out from the card that was pressed. If the call can't be made, the modal stays and says why.
2. **Schedule for later** stays in the same modal and asks one thing at a time: **Who**, **When**, **Details**. With
   someone already picked it starts at **When**. Back goes the other way, and everything chosen so far stays. No window
   ever opens over another.
3. **Who** is one field. Typing finds people in the company directory, people from past calls, groups, and the whole
   company ("Everyone at Vandelay"; without a directory, "Everyone you meet at Harbourline"); on your own it's the
   people you've met and any address. Pasting a list of addresses reads it at once: commas, semicolons, spaces and
   lines, `Name <address>` as mail programs write it, each address once. A list stays one token however long it is,
   and what can't be read is flagged one at a time with **Use it** when the list gives a fix away, or **Leave out**.
   Groups, the company and a list can overlap, and everyone counts once. On an empty field, Backspace selects the last
   token and a second Backspace removes it. A call can invite 300 people; past that it says so and waits, and a list
   is removed whole and pasted again shorter. **Skip, I'll share a link** goes on with nobody invited.
4. **When** suggests three times, the best already picked: never in the past, inside 9 to 17 on weekdays where you
   are, never when you're busy, the times that suit the most people first, on different days. It says what's true:
   "All 8 of you are free at these times.", how many are free under each time, that other calendars can't be read and
   the times are free on yours, or with no calendar connected that these are open working hours. The length is 30 min,
   45 min or 1 h. **Pick another time** widens the modal around the week, with your own things by name and when anyone
   is busy, and every half hour can be picked (arrow keys move around it); the arrows go to the next five working days.
   **Doesn't repeat** opens Every Thursday, Every 2 weeks, Every month (on "the third Thursday"; a fifth one is "the
   last") or Days you pick, with an end date, which counts once you leave the field or press Enter. Repeats keep their
   clock time where you are when the clocks change, and one repeat is at most 60 calls. On your own, with one guest whose calendar can't be read, **Let Jamie pick** offers
   the times on the cards instead (a time picked from the week is one of them, and the week closes): two or three stay
   ticked, and the call has no time until Jamie picks one from its link.
5. **Details** reads like the finished call. The name is ready to type over, When and Who step back, and notes open
   in place: **Write notes**, and with them **Keep the transcript** (without it, it's used to write the notes and then
   deleted), **Keep the recording** and **Read shared screens**. Past 25 people, **Set up for a big call** is already
   on, so everyone joins muted. **Documents** steps to the documents and boards you can open, by workspace, with a
   search; what's shared with you from workspaces you aren't in sits under **Shared with you**. With nothing to bring yet
   it says so, and the call works without. A call can bring 12, and anyone who can't open one is told whose it is, without
   seeing its name, so they can ask for it. The button says what it will do: **Schedule**, **Schedule 4 calls** or
   **Get the link**.
6. Once it's scheduled the modal settles away, the row rises on Home, and a toast says what happened, and only that.
   With Google Calendar connected the call is on it and Google sends the invitations, with **Undo** for a moment. With
   no calendar connected, or with **Put calls I schedule on my calendar** off (Settings), nobody has been told: the
   toast says so and offers **Copy link**. With nobody invited, the link is copied. Letting a guest pick copies the
   link to send them. While it saves, Back and the steps wait, so it can't be sent twice. If it can't be saved, the
   error stays in the modal and nothing chosen is lost.
7. **A scheduled call opens one card from its row**, for the organizer and for anyone invited: who's coming, notes,
   documents, the link and **Join**. There's no Calls page: scheduled calls live in Home's list.
   - For the organizer every row opens to change it (who, the time, notes, documents; the pen renames it), and only
     what changed is sent. In a series each change asks **This call** or **This and later calls** before saving; a call
     that doesn't repeat can start repeating from **Change the time**. With a calendar connected everyone gets the
     update. **Undo** puts one call back; a change to later calls has none.
   - A document in Trash, or deleted, leaves the card for everyone, and comes back if it's restored. One the organizer
     can't open any more stays on the call, and shows among **Documents** for them to take off.
   - **Cancel this call** asks once, in place. It comes off the calendar and everyone invited is told. **Undo**
     schedules one call again as a new call: a toast says it has a new link, the old one won't work and answers start
     over, and offers **Copy link**; if it can't be done, the toast says that. A call in a series can't rejoin it.
   - Someone invited answers **Yes**, **Maybe** or **No**, and sees who's coming and what was brought. Past 25 people
     they see only how many are invited. How a call repeats reads in their own time zone, like its time.
   - A call that offers times shows them, says it's waiting for the guest, and has its link and **Cancel this call**.
     Someone invited to it reads that a time is being picked, isn't asked whether they're coming, and has **Pick a
     time**, which goes to its link.

Alcove sends no emails of its own yet, so without a connected calendar nobody hears about the call, and calls
started now don't go on the calendar: share the link. Everyone invited gets the notes (flow 7).

## 5. Join

Pre-join (`/join/<code>`) shows your camera and a mic level, mic and camera switches, the title, and what the call
captures and who gets the notes. Under the preview you pick a microphone (its level moves as you speak), camera
and speaker (where the browser allows choosing one; otherwise it says calls play through your system's speaker),
and **Test microphone** records three seconds and plays them back, without uploading or keeping anything. Alcove
remembers the choices in this browser and says when one isn't plugged in. When the browser or the computer blocks
the microphone or camera, or there's none, the picker says so ("Microphone blocked", "No camera") and a note under
it says how to allow it in this browser, with **Try again**; you can still join, with them off, and turn them on
later. Allowing them in the browser's settings is noticed by itself. In the call, the arrow beside the microphone
and camera buttons switches devices without leaving the call or interrupting the notes.

Everyone sees what the call captures before they join and while they wait: whether notes are on, paused or off,
the recording, transcript, AI notes and shared screens each with its state, that the notes are written in
confidential compute, who gets them, and what won't be kept ("The transcript is deleted after the notes are written.",
"The recording is deleted when the call ends."). Never anyone's name or anything said. A call set up to join muted
starts your microphone and camera off, and says so.

When the call is in a series and you're signed in with earlier notes from it, **From last time** sits under the way
in: one of each of what's decided, still open and handed out, each with where it comes from, how many more there are,
and **All of it**, the series, in a new tab so the camera here stays on. It comes from the notes you have, so it isn't
the same for everyone. Someone newly invited and a guest with the link see nothing, not even that there's a series.

- **The organizer** gets the lobby, which rises in two beats: until the call has started they can rename it (the
  pencil; Enter or clicking away saves, Escape puts it back) and turn notes on or off, and a change that can't be
  saved says so and goes back. Once it's live both are read-only. On a team, a call started just now shows arches of
  people on Alcove, free first and busy dimmed, with **Add** for anyone else; pressing one picks them (anyone the call
  was started with comes picked), the button says **Join and ring 2**, and **Copy link** sits under it. With nobody
  picked it says **Join**. On your own, your link comes first with **Copy**, then **Join**. A scheduled call shows the
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
of the call itself there's no card. From another call, **Join** asks you to leave it first, and leaving carries on to
the call that rang.

## 6. In the call

The call opens full screen: the stage with everyone's tiles, side panels that slide in beside it and go wherever you
put them, and one dock at the bottom.

- **Top bar.** The title and clock; the notes sign (**Notes on** in crimson, **Notes paused**, **Notes
  unavailable** when the host's browser can't record or listen or is out of the call, **Notes off**, or **Notes requested** while
  someone has asked; the organizer's own says **Pausing…** until their pause lands), the same for everyone, which
  opens what's captured: each kind of capture and its state, who changed it and when, who gets the notes, and
  the organizer's **Pause notes**, **Resume notes** and **Turn off** (or **Turn on notes**) and **Read shared
  screens**, or anyone else's **Ask for notes**; **Reset my view** once you've arranged anything; **View**, which
  changes only your screen: four layouts (**Side by side**, **Stacked**, **Screen first**, **Document first**), how
  you see people (**Tiles**, **Arches**, **Hidden**), **Auto**, **Speaker** or **Grid**, where you see yourself, and
  two ready-made layouts (**Everyone equal**, **Presenter and me**); **Catch up**; the shield, whose hover says what confidential compute covers (verified only
  when the server's hardware check is bound to this browser's request); and who is here, which opens People.
- **Dock.** Microphone (**M**) and camera (**V**), each with an arrow for its menu: which microphone, which
  speaker, **Play test sound** and **Noise reduction**; your camera's preview, which camera and, where the
  browser can do it, **Background**: **None**, **Blur**, Alcove's pictures (**Balloons**, **Beach**, **Office**)
  or up to six of your own (**Add image**; they stay in this browser, and a guest has none). The same choice is on
  the pre-join screen, so you pick it before anyone sees you. Removing the picture you're using shows blur
  instead. A microphone or camera that can't work has a caution mark, and
  pressing it opens its menu, which says why and how to fix it. Unplugging a device moves to another one,
  muted or not as before, and says which; a device that comes back is used again. Nothing turns your
  microphone or camera on by itself during a call. Then **Share** (a tab, a window or a screen; the browser's own
  picker asks which one), **Raise hand**, **Captions** (with an arrow to pick the caption language), breakout
  rooms (once someone else is in the call), **Notes**, **Chat** (**C**), **More** (Catch up, Audio and video
  settings, Video quality) and **Leave**. On a phone (640 px wide or narrower) the dock is shorter: microphone, camera,
  the workspace, **More** and **Leave**. Chat (its count on **More**), Notes, the hand, captions, sharing, breakout
  rooms and marking a moment are at the top of **More**, and the devices are under Audio and video settings. **Video quality** sets the most video you send (360p, 720p or HD 1080p,
  where your camera has it) and how you see everyone else's cameras: **Auto** (as sharp as each tile on your
  screen), **Data saver**, or **No cameras**, which stays said at the top of the call with **Show cameras**. Both
  are remembered in this browser, and shared screens are never made smaller.
- **Panels.** Everything can be moved and resized, for you alone. Drag the line between two panels: it follows your
  pointer, snaps at half, and a double-click evens it. Hover a panel for its handle and drag it: a sunrise glow shows
  where it will land, on any edge of another panel, an edge of the window, or the middle of a panel to swap them.
  Drag a tab out of a side panel to keep it open beside the others; drop it back on a panel to merge them. Hover the
  people to move them, fold them to arches, or hide them (**⇧P**): hidden, they stand small on the horizon beside the
  dock, and whoever's talking or has a hand up rises, with a line saying so. As the window narrows, tiles fold to arches,
  side panels float, and what's big takes turns, with a switcher in the top bar. A panel there's no room for waits out
  of sight: its button in the dock shows it closed, with anything new on it, and one press brings it up. All of it works from the keyboard,
  and Alcove remembers how you like calls in this browser, so tomorrow's starts the way you left it.
- **Your view.** Drag a tile to reorder, drag its corner to make it bigger, drag the line beside a shared
  screen. A tile's **⋯** menu says what each choice changes and the key for it: **Pin for me** (up to six people,
  who share the main stage), **Move earlier** and **Move later**, **Make bigger** (Only you), and **Spotlight for
  everyone** (Everyone; organizer only). On your own tile it also has where you see yourself: **In the grid**,
  **In a corner** (drag it, or Shift and an arrow, to another corner) or **Hidden** (a small chip in the corner
  brings you back; everyone else still sees you). On anyone else's it has **Volume for you** (Only you): a slider
  from muted to 100% and a quick mute, for that person's voice in your speakers only; the same control is in their
  row in People, and someone you've turned down shows "40% for you" on their tile and in People. Nobody else hears
  a difference, and nothing they say goes into the notes any differently. A shared screen's **⋯** shows it big or
  as a tile, and mutes its sound for you. A pin or a spotlight shows on the tile with an ×, a spotlight also as a bar with **Stop spotlight**.
  From the keyboard, Tab to the stage, move between tiles with the arrow keys, and use **Enter** for the menu,
  **P** to pin, **Shift** with an arrow to move and **+** or **−** to resize, **L** to point at a share shown big;
  **Escape** stops pointing, then unpins everyone. Someone
  pinned who leaves is pinned again if they come back, and nothing you arranged moves when people talk, join,
  leave, turn their camera off or share. Alcove remembers how you like calls (the layout, room for shares, where
  you see yourself) for your account in this browser; how you arranged this call lasts until you leave it.
- **Sharing.** Several people can share at once (up to four), and starting yours never stops anyone else's. A bar
  says what you're sharing (and "with sound" when its sound goes too), with **Change**, which swaps it in place for
  everyone, and **Stop sharing**. Each share names whoever shares it, with their face in the arch. Two sit side by
  side, or one above the other where that shows both bigger, with a line between them to drag (or move with the arrow
  keys); one on a phone, where a share that starts goes in a switcher under the arches at once, behind the document
  if the workspace is open, so **Document** and their screen take turns. The rest wait as tiles: click or tap one, or press **P** on it, to see it big, beside the one
  that's big or, when two already are, in place of the one that's been big longest. Your own share starts as a tile
  on your screen. Until you've chosen how to see any share, a second one goes big beside the first; once you have, a
  new share comes in as a tile and nothing you see moves. A share that starts later glows for a moment where it lands,
  and when it comes in as a tile a toast says who started sharing, with **Show it**. When the browser or the computer
  won't share (on a Mac, the screen-recording permission), the picker comes back and says what to do, and offers a
  tab, which needs no permission; when the sound you asked for didn't come, a toast says so. Phones and tablets can
  see shares but can't share. Nothing shared is recorded or transcribed. While the organizer has shared screens read
  for the notes, your bar also says **Read for the notes**, and your browser sends what changes on your share to the
  notes: nothing for the first ten seconds of a share, and at most one frame every few seconds. Cameras never. Once
  the notes have kept as many shared screens as they can for a call (about four hours of slides), screen notes turn
  off for everyone, with a message saying why, and what was shared stays in the notes.
- **Looking closer at a share.** On someone else's share you see big, pinch or Ctrl/⌘ and the wheel to zoom where you
  point (or **+**, **−**, and **0** for the whole picture), drag to move around, and double-click for 200% and back; a
  label says how far in and a minimap where. **Freeze** (**F**) holds the picture still while the share goes on, and
  **Earlier picture** (**,**) steps back through the last 30 times it changed; a bar says how far behind live you are,
  with **Back to live**. They're kept in your browser's memory only, never saved or sent, and go when the share stops,
  you show it as a tile, you move to or from a breakout room, or you leave; none are kept while notes are paused (zoom and freeze still work).
  **Open in its own window** puts a share in a window of its own (Picture-in-Picture in Chrome, Edge and Firefox, a
  popup in Safari) to keep in view or put on another screen; its tile says **In its own window**, with **Bring it
  back**. Two shares side by side are each zoomed and frozen on their own, to compare. Only your screen changes.
- **Pointing at a share.** On a share shown big and live, the pointer button (or **L**, or **Point and mark** in its
  **⋯**) starts pointing: everyone sees your pointer there with your face and name, a click leaves a ring and a drag a
  line, and each fades after a few seconds. A small bar says you're pointing, with **Undo** (or Backspace) for your
  last mark and **Stop pointing**, the × (or Escape). From the keyboard, the arrow keys move your pointer and Enter
  leaves a ring; on a phone, tap and drag. Pointers and marks stay on the same spot of the picture however each person
  has zoomed into it or moved around, and while you point the wheel, a pinch and the keys still zoom. A frozen or earlier
  picture shows none, as they're about the live one, and freezing stops your pointing; a share in its own window shows
  them, and you point in the call. Your own share shows what others point at too. Its bar has a switch for whether others can point at it
  (on unless you turn it off; you always can) and **Clear marks** while there are any; changing what you share clears
  them too. The organizer can turn pointing off for everyone in People. Pointers and marks go from browser to browser,
  encrypted end to end, and stay in your room; they're never recorded or read for the notes, and nobody's computer is
  ever controlled from the call.
- **Captions** are off until you turn them on, and turning them off only hides them: while notes are on the
  call is still transcribed. Captions show the newest line, in the language you pick (translated in
  confidential compute, for you alone), with the original underneath. Captions need notes on.
- **Notes** (side panel). While notes are on: what's been decided, the follow-ups (who and when, as said),
  and a summary, read from the transcript as the call goes, the same for everyone in that part of the call; each time
  opens the transcript at that moment. Anyone who gets the notes can tick a follow-up, and it's done for everyone and in
  the notes at the end. A guest with the link gets notes written only from what was said while they were here, and can't tick them. The
  organizer's **⋯** turns notes on or off. The notes everyone gets are written when the call ends.
- **Yours** (side panel), beside **Notes**: your own notes on the call, which say **Only you** before you type. Write
  something for yourself, or **Mark this** to bookmark what was just said (**B**, the bookmark in the dock, or **More**
  on a phone; the bookmark on a transcript line marks that line). Under an answer in **Ask**, **Keep in your notes**
  keeps it here; nothing else keeps one. A bookmark of something said where you aren't now (the main room, from a
  breakout room) says so, and opens once you're back there or in the notes after the call. Someone with only the link
  doesn't have this: there's no account to keep it under. It goes with the call's notes, so it starts when notes do.
- **From last time**, at the top of Notes when the call is in a series and you have earlier notes from it: for you
  alone, from those notes. What's decided, what's still open and for how long, and the follow-ups (who took them on,
  who they're only suggested for), three of each, then what was settled since the last call. Each has its call and
  moment, a breakout room's with its room, and opens in a new tab, so the call carries on. It's open until the call has
  notes of its own, then folds away. A later call that seems to have replaced or answered something says so.
  **Everything from these calls** opens the series. Before a series has notes, it says so.
- **Earlier calls**, in **Ask**, beside **This call**: ask across the calls you have notes from, such as why something was
  chosen. Each answer says which calls it comes from, and opens them in a new tab. Only you see it, and nothing of it
  is kept. It waits while notes are paused, and a guest, or someone with no notes from the series, doesn't have it.
- **Transcript**, **Ask**, **Chat** and **People** (who is here, with raised hands, pins and spotlight, who is
  ringing and how they answered, and who is invited and not here; the organizer can ring anyone in the last two).
- **Waiting for people.** Everyone the organizer rings waits on the stage in an empty arch that ripples, then shows
  their answer (**In 5 minutes**, **Not this time**), and opens into their tile when they arrive, while the others make
  room. Someone who says no or doesn't answer stays a moment with **Ring again**, then gives the room back, and stays
  in People. A ring that isn't answered never says they're offline: Alcove can't know.
- **Someone asking to join.** A card drops in for the organizer with **Not now** and **Let in**, and stays until it's
  answered. On your own, while nobody else is here, **Just you so far** keeps the link to hand: at the bottom left of the
  stage, or, while the workspace is open, at the foot of its list, under Trash, where it covers none of it.
- **Catching up**, for you alone, and not saved unless you keep an answer. **Catch up** (top bar or **More**) reads what you most likely
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
- **Breakout rooms.** Pick two or three rooms and how long, drag people between rooms and rename them, then
  **Open rooms**. While they're open: a shared timer, each room and who is in it (rename a room in place, or
  move someone to another room or back to the main room from their name), **Join room** and **Back to main
  room**, **Message every room**, and **Bring everyone back now**. Each room has its own encryption keys and
  chat, so what's seen, heard and written in a room reaches only the people in it; the room sees the organizer
  come and go, and someone moved is told. Captions and catching up in a room cover that room only. With notes on,
  what's said in a room is transcribed by one browser there (someone sent to the room, told when it's theirs),
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
- **Asking for notes.** While notes are off or paused, anyone can ask for them, from the notes sign or the Notes
  panel. Everyone sees who asked. The organizer gets a toast and sees the ask in People, then turns notes on (or
  resumes them) or says not now, and whoever asked is told.
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

### The call's workspace

1. **Workspace** in the dock, or **W**, opens the workspace beside the call: the stage makes room, the people glide to a
   column, and the workspace rises in. The count on the button is what's been brought to this call. Every call has a home,
   where its notes and transcript go: the workspace it was scheduled with, as a continuation, or the one its series has;
   else, the first time anyone opens it, a new one made for the call, named after it and the day (**Launch check-in ·
   5 Nov**), with the organizer and everyone invited in it. At the top of the home is the call's own folder, named the
   same, open, with **Notes**, **Follow-ups** and **Transcript** in it; a home for several calls has a folder for each,
   the newest first. Everyone sees the same workspace, late or back from a reload. It opens on this call's agenda, or the
   first thing brought to it, and **This call** at the top of the list holds what's been brought. Anyone who
   can open a document can bring it from its row's menu (**Bring to this call**, **Take out of this call**), or by dropping
   its row on This call. Pressing Workspace or **W** again gives the stage back and keeps your place: the document, where
   you'd scrolled to, your caret and your undo, for the rest of the call and across a reload. The call's letters (**M**,
   **V**, **C**, **B**, **W**) and the workspace's **N** sleep while the caret is in a document, for a moment and a half after
   a key goes into one, and, when what held the caret goes from under it (a presentation coming over the page, or the
   workspace switching), until you click, tap, Tab or Esc: the rest of a sentence never mutes you or makes a document
   somewhere else. Focus lands on the document taking the page's place, where a key does nothing.
   - **Someone shares while you're writing:** nothing you're looking at moves. It lands as a tile among the people and glows
     for 3 seconds, and a toast offers **Show it**, as does the tile. It takes its place beside the document, the
     people fold to arches and the list tucks away, so both stay readable, and they're back once it's a tile again. Drag the line between them (it snaps at half, and a double-click evens it);
     **×** on the screen sends it back to a tile for you only. On a window with no room for both, they take turns, and
     the one you just showed is in front.
   - **Arranging it:** the workspace is a panel like any other: its handle moves it, View has the four layouts, and **Document
     list** hides the list. A list that gave way for want of room comes over the page from the button at the top left of the page,
     until you open something or press **Esc**. **Reset my view** puts everything back and leaves the workspace open.
   - **Just the document** (**⌘⇧F**, the arrows at the top right of the page, or View): the bars slide off, everyone drops to
     arches on the horizon, and your microphone, camera, **Show everything** and Leave stay. You still see who's talking and
     who has a hand up. **Show everything** or **Esc** brings it all back as it was, with the caret where you left it.
   - **Working together:** with the workspace open, hovering someone's tile offers **Follow** if they're in it (an arch has it in
     its menu, and People has it beside where each person is); the tile says **Following**, and shows a pen while they write.
     On a phone, tapping someone's arch opens their card as a sheet: **Follow** (or **Stop following**), **Go to where
     they are**, **Tag them in this document**, and **Pin, volume and more** for the rest of their tile's options.
     **@** lists who's in the call first, then who's invited, then the workspace and the company, and tagging someone in
     the call lights their tile for a moment. Tagged while the workspace isn't open, you get the same toast, a little later:
     **Go there** opens it on the line. Putting the workspace away, or bringing in something it takes turns with, stops
     following, and for everyone else you've left it.
   - **While breakout rooms are open** the organizer's stage shows the rooms, and the workspace stands beside them. Just the
     document isn't on offer until the rooms close, and on a phone the workspace goes over the rooms until it's closed.
   - **An organizer taken out of the workspace** everyone's viewing is told so, and **New workspace** has everyone view one
     of their own. Everyone else carries on.
2. **Only the organizer switches what everyone views**, from the name at the top of the list: their workspaces they can edit
   in, with who's in each, the call's home marked **This call's home**, and **New workspace**. Picking one asks once, in
   place, says who in the call can't open it, and that the notes and transcript still go to the home; **Switch to …**
   changes the list for everyone at once, a toast says where the notes still go (in two lines at most), and **Back** on it
   changes it back; it goes when the call ends, or when Leave asks its question. The question takes focus as it opens, and
   **Tab** reaches its answers. Someone following someone stops, and is told the call's workspace changed. The
   call's Notes, Follow-ups and Transcript stay at the top of the list while another workspace is viewed. Nobody is
   interrupted and nothing is moved or copied: sound and video carry on, and whoever can't open it stays in the call and
   sees that it's private, not what's in it. What was brought to the call from the workspace before stays with that one.
   **New workspace** makes one for the call, with everyone invited in it to edit, as its home has (a guest without an account
   isn't), named after the call, and opens a blank document in it; it's
   still there after the call. The home doesn't change: the next call in the series still has it. Everyone else sees the
   name, and that the organizer chooses.
3. **Someone who can't open it**, a guest or anyone outside the workspace, is told it's private, and nothing else: no
   names, no folders, nobody's whereabouts. **Ask** (the organizer by name) changes the words in place, and they carry on
   with the call. The organizer sees who's asking at the top of the call (above the dock on a phone, clear of the list's button), and
   shares the document in front of them: **Let … read**, **Let … edit**, or **Not now**. With nothing open, **Open the
   workspace** opens the document they were last in there, to share, or else the list to pick one, on a phone too. Only that document
   opens for whoever asked, by itself, under Shared with you, and read only says to ask the organizer to edit. **Not now**
   is said to them, and they can ask again. Share lists them as a guest in this call and **Remove** takes it back, and it
   ends with the call.
4. **Notes, Follow-ups and Transcript** are in the call's folder in its home, and at the top of the list wherever else, for everyone
   in the call, whether or not they can open the workspace, and the count is what's still to do. They fill in as people talk. With notes off they go quiet and say why they're
   empty, and the organizer can turn notes on from there while anyone else asks; if something's written already it stays, and a line
   says what's holding the notes back. **Notes** is the summary and what's been decided so far, and a time opens the transcript at
   that moment. **Transcript** is the whole call so far, with who's talking at the end, and finds any word. Notes and Transcript
   open beside the document from the button on their row, as side panels you can pull out to sit anywhere, and **Open in the
   workspace** in the Notes panel goes the other way.
   - **Follow-ups** are what the notes heard, what people added, and the to-dos with a person and a date in the documents worked on
     in this call, each for whoever can open it, as **Everyone** or **Mine**. Ticking one is done for everyone and ticks the line in
     its document, and where it came from opens that line. **Add a follow-up** adds one of your own, which anyone can tick and which
     goes into the note. A guest with the link reads what's written for them and doesn't tick or add. With notes off they come from
     documents alone, and say so.
   - **Sending to a document:** the arrow on a line sends it to the document you were last in, if you can edit it: something decided
     as a line, a follow-up as a checklist line tagged with who and when, which is then the same follow-up, and a line of the
     transcript as a quote with who said it and when. It lands where you can see it, or a toast says where it went and **Go there**
     opens it. With no document to send to, there are no arrows.
   - **From the call** in **/**: **Decided so far** and **Follow-ups so far** fill in as the notes do, for everyone in the document,
     and nobody types them. When the call ends they stay as they were. **Quote what was said** picks from the last few lines. With
     notes off they say so.
   - **Hear it** on a quote plays that moment, for anyone with the notes, when the call keeps its recording: during the call
     for whoever can read its notes then, and for everyone with them after.
5. **Present** is at the top of every document in a call (in **⋯** on a phone). Its preview shows what people will see and
   how many sections the document splits into, at each first- or second-level heading, and **Present N sections** starts it.
   - **Everyone who can open it** sees it in place of their own page: one section at a time, with no list, menus or
     anyone's caret, and the strip at the top saying who's presenting what. The workspace opens for it if it wasn't open.
   - **Whoever presents** also gets, beside it and for them alone, where they are and what's next, **Back** and **Next**
     (or **←** and **→**), their own notes for that document, kept for next time, and **Stop presenting**, always at the foot.
   - **Work on my own** goes back to your own page, or to the document itself, while the presentation carries on; the strip
     says **Back to the presentation**. The organizer can also stop someone else's from the strip.
   - **Stop presenting** puts everyone back exactly where they were: your own page as you left it, and the workspace put
     away again if it opened for the presentation. If the presenter leaves the call, the same happens, and a toast says
     they left, so the presentation ended. Nobody's access changes: someone who can't open it is told who's
     presenting, never what.
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
8. **⌘K** finds anything in the workspace from anywhere in the call. It opens the workspace first if it's closed, and brings it
   to the front if it's taking turns with a share, so the line it lands on is one you can see.
9. **Ask** on what's selected (flow 12) answers **What was said about this?** from this call: everything said in it that you
   may read.
10. **History** files what was worked on under the call: **During this call** while it's on, and after it under the call's name
    for anyone who has its notes.

### A board in the call

1. **Board** in the dock, beside Share, or **O**, opens the Board menu. **Blank**, **Retro**, **Ideas** and **Flow** start a new
   board, which opens for everyone here at once. Under them are boards your team already has: whatever's been brought to this
   call first, then the newest from the workspaces in your Drive, three at most, with where they're from. Anyone invited can
   start one, in the main room or a breakout room; a guest can't. On a phone, Board is in **⋯** beside Share, and **Open a
   board** shows the same menu there.
2. **It opens for everyone.** The board rises through an arch onto the stage, people glide to a strip beside it, and one
   line says what happened: "Everyone here can add to this board." for whoever opened it, "Art opened Launch retro. Everyone
   here can add to it." for everyone else. A new board is saved in the call's workspace, named after the call. Opening
   another replaces it for everyone.
3. **A saved board some people here can't open** asks first, in the same menu, before anything opens: "Priya and Theo can't
   open Onboarding flow. It's in Product." **Let them in for this call**, there only for someone who may share it, opens it to
   them until the call ends. **Open without them** opens it to everyone else. Someone it isn't open to sees **A board you
   can't open** and who brought it, and nothing of its name; **Ask Art for access** asks in the call's chat.
4. **Working on it together.** Everyone's pointer carries their face and name, with dots while they type, and whoever's
   talking glows on their tile and their pointer. A person's tile has **Go to Priya**, which takes you to where Priya is,
   and **Follow Priya**, which keeps your view with Priya's, with a ring in her colour and a pill at the top of the board,
   until **Stop**, Escape, a scroll or a zoom. The pill shows one thing at a time.
5. **Hide it, for you alone.** With a board open, the Board button (or **O**) puts it away for you: it's a live tile among
   the faces, and pressing the tile brings it back where you were, with the keys on it. Nobody else's view changes. While
   you're presenting it, it stays in front of you, since everyone's watching what you see: the Board button and **O** say
   "Stop presenting first. Everyone sees this board while you present it." and leave it where it is.
6. **Beside a shared screen.** If someone's sharing, the board takes the main space and the share moves to the top of the
   column, live, with everyone under it. A share that starts while you're on the board comes in the same way, and one line
   says so: "Priya started sharing. It's beside the board." Nothing you're doing on the board stops. Dragging the line
   between them gives one more room, for you only. Pressing the share makes it big and the board a live tile above the faces;
   pressing the board swaps them back. From the keyboard, **P** on the share (or **Make it big**, first in its **⋯**) swaps
   them as a press does, and Enter on the board's tile brings it back with the keys on the board. While you present the board
   it stays where it is, and the share says to stop presenting first. **Put on the board**, in a share's **⋯**, puts a picture
   of the share as your browser shows it on the board, captioned "Priya's screen, 14:05", and Priya is told. It's kept in the
   board's files, whether or not screen notes are on.
7. **The board's name** has **Rename**, for anyone who can change it, and everyone sees the new name at once; **Saved in
   Product**, which brings up that workspace if it's the one the call is viewing and opens any other in a tab of its own;
   **Who can add to it**, for someone in that workspace who can edit the board, which opens the workspace's own **Share** for
   it under the name (add people by name or address, change what each can do, or keep it to the people added; someone it
   becomes read-only to sees it as **View only** at once, and once it's kept to the people added, nobody's told everyone here
   can add to it); and **Close for everyone**, for whoever opened
   it or the organizer. Closing deletes nothing: the sheet sinks back through the arch, the faces come back and one
   line says "Launch retro is closed. It's saved in Product." Whoever closed it has the keys on Board in the dock (on a phone, on More, where Board is). The seal
   beside the name says what's true of this board: who can add to it, where it's saved, and that Alcove can't read it. It says
   how the board stands too, as on its own page:
   - **Reconnecting**, when the board's connection drops while the call carries on. The pill at the top of the board says
     "Keep going. Your changes are safe here." What you add goes up once the connection's back, with nothing lost or doubled.
   - **Not saved**, when Alcove won't take what was added. The pill says **Couldn't save** and how many changes are only on
     this screen ("Your last 3 changes are only here."). For anyone signed in, whose browser keeps them, it has **Try
     again**, which opens the board again and sends them. It tries again by itself as well.
   - Pressing the seal says the same, under the pill. A board that can't be opened right now opens again by itself, a little
     later each time.
8. **Timer and votes**, on the board's bar, for anyone who can add to it. **Timer** offers 3, 5 or 10 minutes and **Start**:
   one pill at the top of the board counts down, the same for everyone, turns amber in its last minute and chimes softly at
   the end, and whoever started it, or the organizer, can **Stop** it. A screen reader hears it start, with how long, then with
   a minute left, when time's up and when it's stopped, never each second. **Vote** votes on the frame you're looking at (every
   sticky, with no frame in view), 3, 5 or 10 votes each, and the board glides to it. After **Start the vote**, pressing a
   sticky spends a vote and shows a dot only you can see, and pressing it again takes it back. From the keyboard, Tab from
   the board goes from sticky to sticky in the vote, frame by frame and row by row, with the board gliding to one out of
   view, and on past the last; Shift and Tab go back. Enter or Space votes for the sticky you're on, and again takes the
   vote back. A screen reader hears each sticky's words as a toggle button, pressed once it has your vote and dimmed while
   you've no votes left to give it, and the pill says how many you have left as that changes. When the vote ends, the keys
   go back to the board. Nobody sees a count until
   whoever started it, or the organizer, presses **End the vote**: every count appears at once, for everyone, the top three
   stay bright and the rest step back, until **Done**. The pill shows one thing at a time: how the board stands (Reconnecting
   or Couldn't save), someone presenting, then a vote, its results, following someone, and the timer.
9. **Ideas from the call.** While notes are on where you are, the call picks out things people said that are worth a sticky,
   and a pill rises at the foot of the board: **3 ideas from the call**. Nobody has to stop talking to write them down.
   Pressing it opens the tray, **From the call**, written in confidential compute like the notes: each line is what someone
   said, with who and when ("Priya, 2 min ago"), and **Add**. Adding one puts it on the board as a sticky, in a free spot in
   the frame it fits and that frame's colour, and it goes from everyone's tray; it says **Added** in yours. **Add all three**
   (or **Add both**) adds the rest at once, popping in one after another, and says "Added 3 stickies from the call." with
   **Undo**, which takes back those three and nothing you've done since. Two people adding at the same moment get their
   stickies side by side, never one on another, and the same idea added by both is one sticky. Closing the tray (× or Escape)
   puts what's left aside for you alone; the pill comes back when there's something new. While the tray is open the call's
   keys work as ever: O, W, and Escape for the side panel. Ideas are only for people who can add to the board, only from
   what everyone there may read, and never while notes are off or paused; a room's ideas stay in the room.
10. **Sort into themes.** Drag round several stickies (or Shift-click them) and the bar offers **Sort into themes** beside
   **Tidy**. It sends what they say to confidential compute, says **Sorting…** meanwhile, and moves them into named columns,
   each in its own colour, inside their frame: "Sorted into 3 themes." with **Undo**, and one Undo puts it all back. It
   works with notes off, and on a board's own page. While notes are paused nothing goes to the AI, so it isn't offered.
   Fewer than two stickies with words says "Pick at least two stickies with words to sort.", and more than 80 "Sort up to 80
   stickies at a time."
11. **Present.** **Present** on the board's bar makes its frames slides, in order, with nothing to prepare (on a wider screen:
   a phone's bar has no Present).
   - **Whoever presents** sees exactly what everyone sees, ringed and marked **Everyone sees this**, with **1 of 3**, **Back a
     frame** and **Next frame** (or **←** and **→**) and **Stop presenting** under it, and beside it, for them alone, the next
     frame and their own notes beside this frame, marked **Only you see this**: each frame its own, kept for next time. Their
     pointer shows to everyone. The board stays in front of them until they stop (step 5).
   - **From the keyboard**, Enter on **Present** puts the keys on **Next frame** (on **Stop presenting**, with only one
     frame). **←** and **→**, and a clicker's Page Up and Page Down, move the frames while the presentation has the keys: the
     frame itself, or Back a frame, Next frame and Stop presenting under it. Anywhere else they move nothing: in the notes
     beside the frame, on a tile on the stage, in the rooms' setup, or on the page with nothing chosen. **Stop presenting**
     puts the keys back on **Present**. Someone watching who had the keys on the board finds them on **Look around** as the
     frame takes the sheet, and back on the board once the presentation ends.
   - **Everyone else** sees the frame alone, with no tools and no handles, as it changes, and the pill says "Art is presenting"
     with **Look around**. Look around, or a scroll, gives you your own view back, tools and all, and the pill says **Back to Art**;
     Art moving on never pulls you back. Someone who comes in late lands on the frame everyone's on. The organizer's pill has
     **Stop presenting** too, which stops anyone's for everyone.
   - **Stop presenting** puts everyone back where they were. If the presenter leaves the call, the same happens, and a toast says
     they left, so the presentation ended. Closing the board ends it too. Nobody's access changes: someone who can't open the
     board is told who's presenting, never what.
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
   change nothing, so someone who can only look has them too. **Night board**, for whoever can change the board, makes it a
   dark board in any theme, a dark board by day, for everyone and everywhere it shows: on the stage, as a tile, on the note,
   presenting and on its page. It says **On** while it is, and pressing it again lets the board follow each person's theme.
14. **On a phone**, faces stay on top, under the line over the call when it says anything, and the board fills the rest,
   opening on its first frame at a size it can be read. Drag to look round and pinch to zoom; the bar keeps the name, the
   seal, **Timer**, **Vote** and **More**, and what the pill says wraps rather than being cut. The one tool is **+**, at the
   bottom right: a sheet rises, night as the call is, with one sticky, its colours and a button that says where
   it's going, "Add to Went well" for the frame in the middle of the view, and the sticky goes into that frame's first free
   place, wherever someone has moved the frame meanwhile. Ideas from the call are there too: tap the pill, then **Add** or
   **Add all three**, and the toast's **Undo** takes them back. In a vote, a tap on a sticky votes for it and another takes it
   back. Drawing and moving things stay on bigger screens.

### Boards in breakout rooms

1. **Set up rooms.** The rooms panel has one more row: **Board**, with **None**, **In each room** and **Shared**. In each room:
   "Only that room sees its board. When rooms close, every board comes back to the main room.", and what each starts from
   (**What, why, next**, Retro, Ideas, Flow or Blank). Shared: "One board, a frame for each room. Everyone can see every frame
   while they work.", on the board open now, or a new one from what you pick. **Open 2 rooms** sends everyone, and every room
   already has its board open: "2 rooms are open. Each one has a board."
2. **Inside a room.** "Art opened rooms. You're going to Rollout." You arrive on the room's board with its frames ready. Its
   seal says **Sealed to this room**: "Only the people in Rollout can see this board.", "When rooms close it comes back to the
   main room, and everyone in the call sees it." and "Alcove can't read it, then or later." Whoever's moved to another room
   loses it as they go, and finds the new room's. The pill at the top of the board says the room and how long it has left
   (**Comms · 9:12**): in its last minute it turns amber and says **This board comes back with you**, and in the last ten
   seconds **Rooms close in 10 seconds**, counting down. A screen reader hears it at ten seconds and as rooms close, not every
   second. While the board's pill says it, the line over the call doesn't; while the pill shows something more pressing, such
   as a timer, the line over the call says where you are and how long is left. Art's message to every room comes as a toast,
   "Art, to every room: Two minutes left", so nobody has to leave the board to read it. **Raise your hand** asks Art for help,
   and Art coming in is told as "Art joined this room."
3. **Start a board in a room.** With none set up, **Board** is where it always is, and the same menu says "Only this room sees
   it" and "Comes back with you when rooms close. Alcove can't read it." It opens for everyone in the room, and nobody outside it
   can see it, the organizer included, until they join.
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
   Afterwards a room's board is a saved board like any other, everyone invited's, and nothing to a teammate who wasn't invited.
   **Present** then makes each room's frame a slide: the room reports back, and the organizer moves on.
6. **One board for every room.** With Shared, the organizer stays on the board and can watch every frame fill up; when the one
   open can't take the rooms' frames (whoever brought it can't edit it now), the rooms share a new one in its place: "The rooms
   share a new board. The one that was open can't take their frames." In a room you land on your room's frame, hear your room
   only, and the pill says **Everyone can see this board** with the room's time; in the main room it says how many rooms are
   on it (**3 rooms on this board**). When rooms close nothing has to come back: "Everyone's back. The board stays as it
   is.", and the board glides out to all of it.
7. **Rooms with no board**, opened with **None** and with nobody starting one, are as rooms have always been (Breakout rooms,
   above): "You're in Comms for 5 min.", the organizer's message for a moment in the line over the call ("Art to all rooms:
   Two minutes left"), **Ask for help** on the hand, and "Art joined your room".

## 7. End the call and get the notes

1. **Leave › End the call** (with others in the call, **End call for everyone**) sends the last audio and
   speech and ends the call. **Stay in the call** goes back. With someone invited in the call, whoever hosts can
   also **Leave and keep it going**: the person who'll host is chosen already ("Priya will host until you're back"),
   and **Change** picks someone else. The call goes on, the notes with it, and the organizer takes it back by
   joining again. Someone standing in sees the same sheet, with leaving it going first.
2. The sheet becomes **Call ended**: who gets the notes, and how they're coming along until "Notes are
   ready", then **Read the notes** or **Go to Home**. The note shows the steps so far (call ended, audio
   saved, the transcript's length, the notes being written), playback of the decrypted recording, and who
   has it. Without notes, the sheet says there's nothing to send.
   Notes are written in the language and summary length set in settings by the organizer (or, for a room
   recording, by whoever recorded): "Same as the call" by default, with a short summary of two or three sentences.
3. Everyone invited gets the notes as the call ends, including people signed in whom the organizer let in
   from the link (letting them in added them to the invite; removing them took them off it). They find them
   under Notes when they sign in with that address, marked as from the organizer. Guests who joined with only
   a name don't get them.
4. If the notes service fails three times, the note is finished with its transcript and recording and no
   summary. On a server without NEAR AI, notes wait with "Waiting for the notes service to be connected".
   While the notes model's evidence can't be checked or doesn't check out, nothing is sent; and while it
   doesn't answer, nothing is lost. Either way notes wait with "Waiting for the notes model. The notes are
   written as soon as it’s verified and answering" and are tried again every five minutes.

## 8. Notes

- **Notes** lists every note you have, your own and those from other people, newest first and grouped by day
  (Today, Yesterday, This week, Last week, then months), on the water under a band of sky. Each row has the faces of
  whoever else has the note (an arch with a microphone for a recording only you have), its title, how you got it, the
  start of the summary, chips for what's still open in it (decisions to confirm, follow-ups), the time or the day, and
  a pin when it's pinned. On a wide screen the list scrolls under the horizon, so the sky stays in view; on a phone the
  page scrolls as one.
- **Search everything said, or ask** is the line in the middle of the sky (**⌘K** on a Mac, **Ctrl+K** elsewhere goes to
  it; **↓** goes from it to the list, and **Escape** clears it). It finds the words, not just the note: every word typed
  has to be somewhere in the note's title, summary or what was said, in any order, breakout rooms included. A row quotes
  the line with most of the words and who said it, unless the summary has them, with a chip for each of the best moments,
  up to three in the order they were said, and the preview lists up to four of them above the summary. A moment opens the note there, not playing. While a question is
  being typed the list shows the notes with any of its words, and all of them when none has. Someone who can't read a
  note's transcript finds the note only by what they can read, and nothing is quoted to them.
- Under the line are the four people you have most notes with, and **+** to find anyone else you have notes with. Picking
  someone shows only the notes they have too, under a chip whose × shows everyone's again, and **+** still changes who.
  That person is in the address after `#with=` (the Team page links there), which never leaves the browser. Then **All**,
  **Calls**, **In the room** and **Shared with you** (notes someone shared with you afterwards) narrow the list.
- On a wide screen (more than 1240px) the note picked in the list shows beside it: whether it's ready, the pin, **Share**,
  **More** and **Open notes**; when it was and who has it (pressing the faces shows **Who has these notes**); then the
  summary, decisions and follow-ups. **Confirm** or **It wasn’t decided** settle a decision there, with **Undo** after,
  or **Take that back**, or for the organizer **Keep it confirmed** when someone disputes a confirmed one; a follow-up ticks
  off in place, and the row's chips follow. A click picks a note; a double click, Enter or **Open notes** opens it; ↑, ↓,
  Home and End move through the list. Narrower, a note opens on its own page. Only one button is filled at a time: while
  Share or the question in More is up, Open notes turns tinted.
- **Enter** or **Ask** asks every note you have, whatever the filters are (see below). It reads them in confidential compute
  while the horizon pulses, and the answer lands on the water above the list, with a chip for each note and moment it
  comes from. The list and the preview then follow what it cites: each row quotes the line it used, and the preview lists
  those moments. **×** puts the answer away, and so does typing, or picking someone or a filter. An answer that cites
  nothing just says so and leaves the list alone. When a note it read was deleted or taken from you while it was being
  written, it isn't shown, and **Ask again** asks once more.
- When the list has nothing to show, it says why: nothing matches the search (**Clear search**, and **Search all notes**
  when a filter is on), the search couldn't get an answer (**Try again**), nothing has been shared with you yet, nothing
  was recorded in the room yet (**Record in the room**), or you have no notes with that person yet (**Show notes with
  anyone**). Before your first notes there's nothing to search, so there's no line: **No notes yet**, with **Start a call**
  and **Record in the room**, takes the middle of the sky, and an example on the water shows what notes look like, with
  **Open the example**.
- **Share** gives the notes to more people by email, or to one of your groups (offered first, by name), once
  the call has ended or the room recording has stopped. Anyone who has the notes can share them; people who have them already are skipped, and someone
  who removed them gets them again. Each share records who shared the notes and when, and the group's name
  when they went to one of the sharer's groups.
- Someone else's notes say how you got them, beside their title: **From Priya’s call** when you were invited,
  **Shared by Theo** when someone shared them afterwards, or **Shared by Theo with Leads** when it was to one of
  their groups. Notes lists them under the call they came from, and **Who has these notes** says how each person
  got them: organizer, invited, or shared afterwards by whom (and with which group). A long list shows its
  first eight people until **Show all** opens it.
- **More** has **Copy as text**, once the notes are written, and **Delete notes**, which deletes your own notes for everyone, audio included, with anyone's own notes on them, once you say so,
  and then lists what went. For notes from someone else it's **Remove from your notes**: everyone else keeps them, and
  you're no longer listed as having them. Your own notes on them go for good, and what you added to the shared notes stays.
  Beside the list it asks in place, and the row leaves the list. While the call is going, it waits until the call ends.
- **Your notes**, beside the note, is what you kept in the call and more: write something, bookmark a line (the bookmark
  beside it) or a shared screen, or **Keep in your notes** under an answer. It says **Only you**, and the note itself
  says **Everyone with the notes**: nobody else reads Your notes, the organizer included.
- **Add to the shared notes** on anything in Your notes shows, in place of the box you write in, exactly what goes:
  the words, which you can cut down, the moment they point at, **Added by people** on this note, and everyone who
  has the notes. Nothing goes until **Add for 3 people**; only what's in the box goes, and never a question you asked.
  If someone got the notes since, it says so and shows them. An answer goes only if the moments behind it are in the
  notes. Once the notes are written is when this can be done: until then the people who'll get them aren't settled.
- **Added by people** shows what people added, with who and when, for everyone with the notes. **Take back** removes
  yours for everyone, once you say so in the row, and it stays in Your notes; the organizer can **Remove** any of them
  the same way.
- A note's page is a slim band of sky, with the call drawn along the horizon. The band has a way back (**Notes /** its
  title), the pin (**Pin these notes**, at most eight pinned), **Share**, **More**, and one line under the title: when
  it was, who has it, how you got it, and **Written in confidential compute** with when the hardware was checked, which
  opens what was checked about the models. Until the notes are written that says **Being written in confidential
  compute**, or **Still recording** beside what's been checked so far, and while they're written again, **Being written
  again**.
- The horizon is the call: **Play** and the time, then a line with the chapters standing on it, what was decided and
  what's to do sitting on it (hollow until people have said so), where nothing was captured, and light under it drawn
  from what was said, still where nobody spoke. Pointing at a chapter or a mark says what it is. Pressing one, a moment
  chip anywhere on the page, or the time of a transcript line goes there: the sun moves along the line, and the
  transcript goes to that line and marks it, opening the rest if it has to. A chapter that's breakout rooms opens them
  instead. **Play** starts as soon as the first of the recording arrives; until it's pressed, moving along the line
  reads nothing. Whatever was pressed last wins, even while the recording is on its way. As it plays the sun moves and
  the line being said is marked. If part of it won't play, it says so, and **Play** tries again from there. The horizon
  stays at the top of the page as you read. On a phone it shows the chapter you're in, and the chapters are listed
  beside the note. While a call is still recording, the line ends where it has got to, and **Play** plays what's there
  so far and carries on as more is recorded; at the very edge it stops, and says that's all so far. A call that didn't
  keep its recording has the line and no player.
- A written note shows the summary, **Decided**, **Still open**, **Follow-ups**, **Worked on in this call** (each document
  worked on in the call that you can open, who changed it, and a row that opens it; there whether or not the notes are
  written yet), the transcript (its first five lines,
  then **Show all 24 minutes**, and how many shared screens are further on, which open from there) and, beside it, Your
  notes, what people added, who has it and its series. On a wide screen the transcript moves beside what was decided, so
  going to a moment never takes the note away. It takes questions about the call: a suggested question or your own, in
  a bar that stays at the bottom while you read (suggestions show at the end of the note). Answers cite the moments in
  the recording they come from.
- Until the notes are written, the page says the audio is saved and encrypted (or, when the call doesn't keep its
  recording, that the call has ended) and the notes are being written
  in confidential compute, and ticks off each step (the call ended, the audio saved, the transcript) with the
  one in progress marked. When nothing was said, it says so, the water is still, and **Play** stays on the line for the
  audio. A call that didn't keep its transcript or recording says so in one line where it would have been, and has no
  player; you can still ask about what the notes say. After **Delete notes** it lists what went; a note that isn't
  there (deleted, or never shared with you) says so, with **Back to notes**.
- A question can also go across every note you have, your own and other people's (`POST /v1/notes/ask`,
  behind the line in Notes' sky, and **Search or ask**, flow 2). The answer comes from those notes only, up
  to 12 of them that share the most words with the question, and cites the notes and the moments in them it
  comes from. Until a note is written, or when nothing was said in any, it says so instead, and nothing is sent to
  the notes model. An answer written while a note it read was deleted or taken from you isn't shown: ask again.
- The transcript dots what it isn't sure of (words that were hard to hear, a name heard on more than one
  microphone) and says what the dots mean above it. The organizer can correct any line in place, its words or
  who said it, or say it was heard right; anyone else who has the notes can correct the words of their own lines,
  or say their words were heard right. Each line says who corrected it and when, starting with what was heard.
  Once lines were corrected, the organizer is offered **Write the notes again**, which keeps what people already
  confirmed or took on. Meanwhile everyone still reads, asks about and confirms the notes as they were, marked
  **Being written again**.
- A call with breakout rooms has a **Breakout rooms** part under its own notes, one section per room, closed until
  opened: the room's name, who was in it and for how long, and inside, its own summary, decisions, open
  questions, follow-ups and chapters, written from what was said in that room alone, and what was said there.
  A room where nothing was said says so. Everyone who has the notes reads every room's section, and proposes,
  confirms, answers, takes on and ticks off what a room's notes say as far as they can the call's; a room's lines are corrected like
  the call's, and writing the notes again writes each room's section again too, keeping what people settled.
  Questions about the notes cover the rooms. Deleting the notes deletes the rooms' sections with them. A call set
  not to keep its transcript keeps each room's notes and deletes what was said there, as it does for the main room.
- What the notes heard is a proposal until people say so. Each entry's row shows anything to be careful of (nothing
  said backs it, someone said otherwise, it was hard to hear, or a line behind it or its own words changed since), and
  its menu shows **What was said** behind it. Each decision says where it stands and who said so: proposed, confirmed,
  not decided, or no longer holding, and it's solid on the horizon once it's confirmed. The organizer and anyone invited can **Confirm** what's proposed, except whoever proposed it
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
- Beside a call's notes is the series it's in: **Every Tuesday** when the last three calls in it were a week apart,
  otherwise **In a series**, with the series' other calls (the newest three, with the start of each summary), how much
  is still open across them and, for the organizer, the next call with **Change**; **All** opens the series page. When
  it isn't in one, the organizer gets **Meet again › Schedule next week’s call**: the same people and notes setting, at
  the same time of day a week on (still the same time when the clocks change in between), on the calendar. That starts
  the series, so the next call shows there; **Change** moves it or cancels it.
- The series page sits on the same evening as a note. Its calls stand on the horizon, each opening its notes, with the
  sun on the latest and the next call at the end of the line. Under it is what carries over from the calls you have
  notes from: decisions (confirmed, not
  confirmed yet, and no longer holding), questions still open and answered since the last call, and follow-ups taken
  on, not taken on yet and done since the last call, each with the call and moment it came from, breakout rooms'
  with their room. Things can be settled there, and
  questions asked across the calls, with answers that cite the calls and moments they come from, by the
  days you saw them on. When a later call seems to have replaced a decision, it says which and offers **It no longer
  holds** or **It still holds**; when one seems to have answered a question, **It was answered** or **It’s still open**.
  Saying **It still holds** or **It’s still open** shows who said so, with **Undo**, and writing that call's notes
  again doesn't change it, though a further call can suggest it again. A decision's is for the organizer and whoever
  confirmed it, and a question's for anyone with both calls' notes. Only someone with both sees any of this, and
  nothing changes until someone says so. Someone invited to only some of the calls sees only those. It shows the newest 24
  calls and says how many older ones aren't shown. The organizer also sees the next call, with **Join** and
  **Change this call**, or **Schedule next week’s call**. When the series follows a recurring Google event
  and Google Calendar isn't connected any more, it says so and offers **Connect Google Calendar**.

## 9. Record in the room

**Record** in the side panel or the phone's tab bar (raised) opens the Record page. It's the night in both themes, the
last moment of the evening, and the recorder stands on the horizon where the sun would: dark until something is recorded.

- **The recorder**, in the middle of the sky: a name for the recording (left empty, it's "Notes from the room"),
  **Start recording**, the microphone it will use, from this browser's microphones (the same choice calls use), and
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
(gmail.com, outlook.com, icloud.com and the like) has no team, so it has no Team page: nothing links to it, and its
address goes to Home.

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
  opens its note, and **Open in Notes** lists them all (`/notes#with=<address>`: the address stays in the browser, since
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
  column (the side panel's groups open it too): its people, each with × to take them out (a group keeps at least one);
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

**Settings** opens from you at the top right of every page, the phone's avatar or its **Settings** tab. You stand on
the horizon with your name and address, beside **Take the tour** (the tour of Home again, flow 1) and **Sign out**.
With recordings on this device that haven't uploaded, **Sign out** first says so: the sky grows to hold the question
("2 recordings on this device haven't uploaded. Signing out deletes them."), says what staying does (they upload by
themselves, or, too old or unreadable here, never will), with **Stay signed in** (focused; **Escape** too) and
**Sign out and delete them**. It counts only this account's recordings, and only those go. The same goes for anything
written in the workspace that hasn't reached Alcove ("Something you wrote hasn't reached Alcove yet. Signing out deletes it
from this browser."), with **Copy what you wrote** beside them, which copies only your own words, as plain text. Every
other tab open here hears it at once and goes to the welcome page, saying you signed out in another tab. With no connection, signing
out says so and nothing happens later by itself. Under the water the page is
one long list of rows, with an index beside it that jumps to each part and moves a small sun to the one in view; on a
narrow screen the index is a strip that stays at the top. Every control saves as it changes: the row says **Saved** for a
moment, just left of the control (**Saved for new notes** for the language and the summary), and one the server refuses
goes back, with a toast saying why. Parts that don't load say so, with **Try again**, and the rest of the page still works.

- **Profile**: your name and photo, from your sign-in, with a link to change them at Google or Microsoft (they update
  the next time you sign in; with single sign-on they come from your company's sign-in); your company, which opens
  Team (not at a personal address); and the time zone times are shown in, this computer's.
- **Notes**: notes on or off for new calls (each call can still be set when it's scheduled), that everyone invited
  always gets them, the language they're written in ("Same as the call", or one of twelve), and how much the
  summary says (**Short** or **Detailed**). Language and summary apply to notes written from then on.
- **Recording in the room**: **Record without a connection** (on by default), and **On this device**: how many
  recordings, and how much room, wait here to upload, with **See them** (Record's list), or **Nothing waiting**.
- **Calendar**: Google Calendar, **Connected** with **Disconnect** (it forgets the connection and withdraws Alcove's
  access at Google), or **Connect**, which goes to Google and comes back to Home; a demo account's sample calendar
  instead; signed in another way, **Not connected**, since Google Calendar connects when you sign in with Google. A
  calendar that doesn't answer says why, with **Try again**. Then **Put calls I schedule on my calendar** and
  **Show my other meetings on Home** (both on by default).
- **Microphone, speaker and camera**: this browser's choices, the ones the join screen and the call use; choosing
  one doesn't open it. A browser names devices only once they're allowed, so until then the microphone and speaker
  have no list. Nothing opens by itself: **Check the level** opens the microphone for eight seconds (the browser asks
  first if it hasn't been allowed), its level moves as you speak, and **Stop** counts down; it records nothing, and
  closes sooner when stopped or when this part leaves the screen. A microphone that won't open says why, with **Try
  again**. **Play test sound** plays through the chosen speaker; a browser that can't choose one says it uses the
  system's. The camera is a list only, never opened here, and until the browser has allowed a camera on the join
  screen it says it isn't allowed yet; **Reduce background noise**. They're kept in this browser only.
- **Notifications**: browser notifications, shown on this device while Alcove is open in a tab (any page, a call or a
  recording included; nothing is pushed when no tab is open). Until the browser allows them the choices are greyed
  out and **Turn on** asks it (only when pressed; focus stays on the row once it answers);
  when the browser blocks them, the row says to allow them for the site in the browser's settings. Then: before a
  call you organize starts (1 min, 5 min or off); when notes you have are ready (not while that note's page is on
  screen, where they arrive anyway); when someone shares notes with you ("Priya shared it with Product"); when
  someone asks for notes in a call you organize, while you're in another tab or app (in front of you, the call says
  so itself); when someone tags you in a document you can open, while you're somewhere else (in front of you, the
  workspace says so itself); and on the due day of a follow-up you've taken on, at 9:00 (off by default; for every due Home shows
  as a day, so not "next week" or "ASAP"; not when the due day was set after 9:00 that day). One tab in the browser shows them, and the next takes over when it closes. Each shows
  once, in any tab and across reloads, and several at once (after the computer wakes, or the connection comes back)
  arrive as one: "3 notes are ready", "2 follow-ups are due today". Clicking one brings Alcove forward: on the
  call's join page, the note, Notes, Home, the line someone tagged you on, or the call you're in, in the tab already there or else the one used
  last, asking first if that means leaving a call or a recording. With no tab left, it opens one. Signing out, or
  deleting the account, closes the ones still showing and forgets which have shown. The choices are saved with your
  preferences, and one changed in another tab or on another device takes effect within a minute.
- **Appearance**: system, light or dark, each shown as a small evening in its own colours, kept in this browser.
- **Plan and credits**: the time of notes left, with a sun on the line under it: at the end of the line on a new
  account, back along it as notes are written, and set once there's none left. Then the minutes of notes used this month
  (since 00:00 UTC on the 1st). Calls without notes are free.
- **Privacy**: what Alcove knows beside what it can't read, then confidential compute: the time the hardware was
  verified when this browser could check it, or where your audio is opened and your notes are written.

**Delete account** opens one step where it is (never a window over the page): the row becomes the question, **Delete
your account for good?**, and what goes sits beside what stays. What goes: the notes you made, with their audio, for
everyone who has them; the calls you scheduled, for everyone invited; the minutes of notes left; your own notes on every
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
Signing in again starts a new, empty account with 10,000 credits.

## 12. The Drive and the workspace

Documents and folders people write in together, between calls as well as in them. Every call has a workspace of its own,
its home, where its notes, follow-ups and transcript go, and **Drive** in the side panel lists every workspace you're in,
newest first: a call's home with the call it was made for and when (**From Launch check-in, Today at 09:30**), and one
made by hand with when it was made, each with who's in it. Homes with the same name, the same call twice in a day, say
when each call started too (**Launch check-in · 5 Nov, 14:30**, to the second if they started in the same minute), here, in
the workspace picker and when choosing a home while scheduling. Picking one opens it on its own page, which fills the page, in
your theme, with search and you in the top of it: the list and a document side by side, at the document you had open in
it last. Everything happens in the list: nothing opens a window, and nothing asks you to fill anything in. Whatever
someone does here reaches everyone else in the workspace as it happens, and a row that arrives or moves glows for a moment
for all of them.

**A call's folder.** At the top of a call's home is the call's folder, named after it and the day, with its **Notes**,
**Follow-ups** and **Transcript**: once the call's over they open its note, at that part of it, for whoever has the note,
and in a call, in a tab of their own. Someone in the workspace without the note sees the folder and whatever's been put in
it. It's a folder like any other: rename it, move it, put documents in it.

**When scheduling** a call, the details hold **New workspace for this call**: open it to pick one of your workspaces as its
home instead, so its notes go there, beside the calls before it.

**First day.** The Drive says **Nothing here yet**, and that your next call makes the first. **New workspace** in its sky
names one in place and opens it. An empty workspace says **Nothing here yet** with **New document** and **New folder**.
**New document** opens an empty page with the caret in the title and a few ways to start under it: **Agenda**, **Decision
log**, **Retro** and **Project brief**. They're only blocks: picking one fills the page, names an untitled document after
it, and anything in it can change or go. Two people can have the same new document open: they get one title and one first
line.

**Making things.** **+** at the top of the list, or hovering a folder and pressing its **+**, offers **New document**,
**New folder** and **New board** (flow 13); **N** and **⇧N** skip the menu when you aren't typing. A folder is named in its row: type, then
**Enter**. **Esc**, or leaving it empty, makes nothing. A document's title is its name: the list and the path above the
page follow as you type, for everyone.

**Photos, videos and files.** **+** beside a line, or **/**, offers **Photos**, **Video** and **File**. Photos opens a space at
once, "Drop photos here, or choose them", with a picker under it: **Choose from this computer**, or the photos already in the
workspace, one at a time or **Add all three**; Video and File offer films and files the same way. Files dropped on the page
land where a line shows, "Drop to add here", and pasted ones under the caret. Several photos make a gallery, one makes a picture
across the page, a film shows its first frame with **Play**, and anything else is a file that downloads, or opens in a tab when
the browser can show it. Everyone sees the space a file will take straight away and the ring fill as it uploads, and the
pictures sharpen when it's done; a caption starts as the file's name and is one click to change. A photo the browser can't read
says which file, with **Add as a file** and **Delete**. One Alcove refuses says which file and why ("This file is bigger than
512 MiB, the most a file can be.", "This workspace is full, so it can't take more files.", "That's all you can upload today. You
can upload more tomorrow."), with **Try again** and **Delete**, and nothing else in the document changes. A block that's
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
a row among its neighbours, and the menu key opens its menu. **⌘\** hides or shows the list. While the caret is in a
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
face and first name while they move, which fade after three seconds of quiet. Opening a document only moves you.

**Following someone.** **Follow** goes where they go, to the same line: a frame around the workspace and a bar under the head
say so, and the page scrolls to them. In a call that's the call's own **Notes**, **Follow-ups** and **Transcript** too, and the
bar names the page. Nobody else moves, and they do nothing. If they open something you can't, you stay put
and the bar says **In a document you can’t open**; you catch up as soon as they come back. **Stop following** or **Esc** ends
it, and so does scrolling, typing, pressing the page or going somewhere yourself: you stay where you are, and a toast offers
**Follow again**.

**Tagging.** **@** anywhere in a line lists people, then documents and dates, narrowing as you type: the workspace's people
first, then your company (in a call, who's in it first, then who's invited). The list says who **Can’t open this yet**
before you pick. Whoever can open the document hears about it; if they can't, Alcove asks once, right by the name: **Let them
edit**, **Read only** or **Not now**. A tag never shares anything by itself, and someone who can't open it isn't told. Being
tagged is a toast saying who and where, and nothing moves until **Go there**, which lands on the line. Someone away hears when
they're back: **Drive** in the side panel counts what's waiting, and a browser notification says so, if they've allowed them.

**Comments.** Select words: the bar over them has **Comment**, as does a block's menu, and **⌘⇧M** does the same. The words
stay marked while you write, and **@** works here too, for people and dates. **Enter** marks them for everyone, with a count in
the margin; pressing the words or the count opens the thread, and replies arrive as they're sent. **Resolve** takes the mark
away for everyone, and the toast's **Reopen** brings it back for a moment; History keeps the thread. Someone who can only
read can open a thread and has nothing to press.

**Workspaces.** The name at the top of the list lists your workspaces with who's in each, and opens another. **People**
shows who's in this one in the same sheet as Share: an admin adds people by name or address and sets each to **Admin**,
**Can edit** or **Can read**, or removes them; anyone can leave. **Rename** (admins) and **New workspace** turn the name
into a field: type, then **Enter**. A workspace always keeps an admin.

**When things go wrong.** At the top of every document one quiet word says how it stands: **Saved**, **Saving…**,
**Reconnecting** or **Couldn’t save**.

- The connection drops: you keep writing. A bar says your edits are safe in this browser. They're kept there, sealed,
  through a reload, and send when you're back, even if you never open that document again; everyone's words merge, with
  nothing to resolve, and a toast says so.
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

On a phone the list and the page take turns: the list until something's open, and the button at the top of the page
brings it back. Menus and sheets rise from the bottom, and **Share** is in the document's **⋯**. Rows don't drag on a
touch screen: **Move to…** does that. While you write, a bar rides on the keyboard with a block (as **/** does), the text's
style, **@**, photos, a checklist and Done; sheets open above it. Holding a finger on a block opens its menu, the one its
handle opens on a laptop, with **Delete for good** on a photo, video or file. Someone's card and a comment are sheets too, and faces are on the list's rows. A bar's buttons go under its words.

## 13. Boards

A board is a page of stickies, shapes, lines and pictures that people add to together. It lives in a workspace with the
documents: in the list with a board's icon, in links, and in Trash when it's moved there. In a call it opens on the stage;
here it's on its own page, the same board, with no call around it.

**Making one.** **New board** in the list's **+** makes **Untitled board** there and opens it. In a document, **/** then
**Board** makes one beside the document and puts it in the page: a small picture of a board with its name on it, which
opens it. Someone who can't open that board sees **A board you can’t open** there, and nothing of what's on it.

**The page.** The board fills the page under the workspace's head, with its tools down the side and its bar along the
top: its name, its seal, Undo and Redo, how near you are, the map, **More**, the faces of whoever else is on it, and **Start
a call here**, which opens Start a call with the board coming too: one line says **Launch retro comes with this call. Start now
and it opens for everyone.** Start now, and once the call's under way the board opens on the stage for everyone, and the call
says so. Schedule for later, and the board is brought to that call, first in its Board menu, and opens only when someone opens
it. The bar's **More** has **Download as an image**, **Download as a PDF** and, for whoever can add to the board, **Night
board**, as in a call; a night board is dark on its page by day too. Everyone else on it has a pointer with their face and
name, in a colour of their own; you in another window aren't someone else. A blank board says **Double-click anywhere to add
a sticky**, or press **N**, and that everyone who can open it can add to it too, when that's so. To someone who can only look,
it says **Nothing on this board yet**. What's added reaches everyone on it as it happens.

**Adding to it.** Double-click anywhere for a sticky, ready to type; in a frame it takes the frame's colour. **Tab** starts
the next one beside it, and **Esc** finishes. The tools are down the side: **Select** (Esc), **Sticky** (N) in six colours,
**Text** (T) in three sizes, **Shape** (S; drag to size it, or click once, then type on it), **Line** (L), **Pen** (P; press
it again for the highlighter) and **Frame** (F). **More**, the **+** under them, holds what it holds in a call ([A board in the
call](#a-board-in-the-call), step 9): **Image**, **From your workspace**, **Table**, **Mind map**, **Comment** and **Templates**, and
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
**−**, how near you are and **+**, and **Map**, which shows where you are on a board too big for the sheet; **⇧1** shows
everything.

**Under its name.** Pressing the board's name offers **Rename**, where the name becomes a field in its place (**Enter**
keeps it, **Esc** puts it back); **Saved in** the workspace, which shows it in the list; **Who can add to it**, the
workspace's share sheet, where the board can be shared beyond the workspace or closed to **Only people added here**; and
**Copy link**. Its tip says which of these are yours to do. Pressing the seal says how the board stands, in the seal's own
word: sealed, and where it's saved, and that Alcove can't read it; or **Reconnecting**, **Couldn’t save** or **View only**,
with what that means, under the pill and never over it. Escape, or **Copy link**, gives the keys back to the board.

**Comments.** Pick a sticky and press **K**, or **Comment** in the **+** under the tools, and a field opens beside it.
With nothing picked, **K** comments on what the pointer is on, or on the next thing pressed (**Esc** stops). A comment
pins its writer's face to the corner of what it's on, with how many have replied since, hanging under the corner where it
would cover a frame's title and count; pressing the pin opens the thread, with **Reply** and **Resolve**, which a toast can
take back. Comments aren't on the board: nobody's Undo takes one back, and a sticky that's deleted takes its comments with
it, and brings them back with it. Presenting a frame, only its own comments and the presenter's pointer show.

**When things go wrong.** The seal says how the board stands, and the pill at the top of the sheet says the rest.

- The connection drops: the seal says **Reconnecting**, and the pill **Keep going. Your changes are safe here.** What's
  added is kept in this browser, sealed, through a reload, and goes when the connection's back, once, with nothing lost
  or doubled. A toast says so.
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

**After the call.** Right under the note's summary are the boards that were open for everyone in the call, the ones you can
open. The call's board is a wide card: a small picture of all of it, as it is now, with its name, what's on it (**3 frames, 13
stickies, saved in Product.**) and who can open it, and **Open the board**, which goes to its page. Anywhere on the card opens
it too. Each breakout room's board is a card beside the other rooms', under how many rooms there were and for how long (**3
breakout rooms · 10 min**, or **2 of 3 breakout rooms · 10 min** when a room had no board or one you can't open): its picture,
the room's name, what came of it and who was there (**One owner for launch comms. Priya and Theo were here.**), and one click
opens it. A screen reader hears a room's card by the room's name, then what came of it and who can open it. On a phone the
rooms' cards stack. Every picture is in your theme, as the board's own page is: dark in dark mode.
The stickies in the call's board's **Actions** frame come back as follow-ups, under **Follow-ups from the board**, right after
the boards: with owners, taking on, ticking and the rest, as any follow-up has. The notes read a board, along with what was
said, only when everyone the notes went to can open it, because one summary goes to all of them; a board someone couldn't open
says **Not everyone invited can open it, so the summary leaves it out.**, and only to people who can open it. A room's board's
follow-ups are in that room's section of the notes, and the room's line says it had a board. The next call in a series brings
the boards open in this one.
