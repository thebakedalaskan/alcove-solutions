# User flows

[Docs home](../README.md) · [Product overview](overview.md)

Each flow below is implemented in `apps/web` and exercised end to end by the integration tests in
`apps/api/src/flows.integration.test.ts` (API level) and by a real-browser check before release.

## 1. Sign in

1. Open Alcove. Signed out, the welcome page shows what Alcove does (offline calls in the room, live notes,
   layouts, breakout rooms, live translation and privacy), each with a scene that plays while it's on screen.
   Choose **Continue with Google**, **Continue with Microsoft** or **Use single sign-on**, at the top or the
   bottom of the page; single sign-on asks for a work email in place.
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
- **Home**, with how many things are waiting on you; **Notes**, with how many notes you have; **Record**, where recording in the room starts (flow 9),
  with how many recordings on this device are waiting to upload; and **Team** (flow 10), with how many people at
  your company use Alcove, you among them, once anyone besides you does. Someone on their own, at a personal address,
  has no Team page and no groups here.
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
below, and you, which opens Settings (flow 11). In a narrow window search shrinks to its magnifying glass.

On a phone (860 px wide or narrower) a top bar takes its place, with the brand, search, **Start a call** (a plus) and
you (Settings), and a tab bar runs along the bottom: **Home**, **Notes**, **Record** (raised),
**Team** when you're on one, and **Settings**. Offline, the same notice sits under the top bar.

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
2. **Schedule for later** stays in the same modal and asks one thing at a time: **Who**, **When**, **Details**. Back
   goes the other way, and everything chosen so far stays. No window ever opens over another.
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
   on, so everyone joins muted. **Documents** steps to your workspace, or your own documents, with a search; a call can
   bring 12, and anyone who can't open one is told, without seeing its name. The button says what it will do:
   **Schedule**, **Schedule 4 calls** or **Get the link**.
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

The call opens full screen: the stage with everyone's tiles, a side panel that slides in beside it, and one
dock at the bottom.

- **Top bar.** The title and clock; the notes sign (**Notes on** in crimson, **Notes paused**, **Notes
  unavailable** when the host's browser can't record or listen or is out of the call, **Notes off**, or **Notes requested** while
  someone has asked; the organizer's own says **Pausing…** until their pause lands), the same for everyone, which
  opens what's captured: each kind of capture and its state, who changed it and when, who gets the notes, and
  the organizer's **Pause notes**, **Resume notes** and **Turn off** (or **Turn on notes**) and **Read shared
  screens**, or anyone else's **Ask for notes**; your view: **Auto**, **Speaker** or **Grid**, which change only
  your screen, beside a menu with the same three, two ready-made layouts (**Everyone equal**, **Presenter and
  me**), where you see yourself, and a reset (on a phone, that menu is the one button); **Reset my view** once
  you've arranged it; **Catch up**; the shield, whose hover says what confidential compute covers (verified only
  when the server's hardware check is bound to this browser's request); and who is here, which opens People.
- **Dock.** Microphone (**M**) and camera (**V**), each with an arrow for its menu: which microphone, which
  speaker, **Play test sound** and **Noise reduction**; your camera's preview, which camera and, where the
  browser can do it, **Blur my background**. A microphone or camera that can't work has a caution mark, and
  pressing it opens its menu, which says why and how to fix it. Unplugging a device moves to another one,
  muted or not as before, and says which; a device that comes back is used again. Nothing turns your
  microphone or camera on by itself during a call. Then **Share** (a tab, a window or a screen; the browser's own
  picker asks which one), **Raise hand**, **Captions** (with an arrow to pick the caption language), breakout
  rooms (once someone else is in the call), **Notes**, **Chat** (**C**), **More** (Catch up, Audio and video
  settings, Video quality) and **Leave**. **Video quality** sets the most video you send (360p, 720p or HD 1080p,
  where your camera has it) and how you see everyone else's cameras: **Auto** (as sharp as each tile on your
  screen), **Data saver**, or **No cameras**, which stays said at the top of the call with **Show cameras**. Both
  are remembered in this browser, and shared screens are never made smaller.
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
  keys); one on a phone. The rest wait as tiles: click or tap one, or press **P** on it, to see it big, beside the one
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
  and a summary, read from the transcript as the call goes; each time opens the transcript at that moment. The organizer's
  **⋯** turns notes on or off. The notes everyone gets are written when the call ends.
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
  answered. On your own, while nobody else is here, **Just you so far** keeps the link to hand.
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
- If your connection drops, the top bar says **Reconnecting** and you're back by yourself when it returns, as the
  same person. While the host's browser is out of the call, the notes sign says **Notes unavailable**, for
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
  (Today, Yesterday, This week, Last week, then months). Each row has the start of the summary, who has the
  note, what's still open in it (follow-ups, decisions to confirm), the time or the day, and a pin when it's
  pinned. Search matches titles, summaries and transcripts. **All**, **Calls**, **In the room** and **Shared
  with you** (notes someone shared with you afterwards) narrow the list, and **With anyone** picks someone you
  have notes with: the list shows only the notes they have too, under a chip whose × shows everyone's again.
  That person is in the address after `#with=` (the Team page links there), which never leaves the browser.
- On a wide screen (more than 1240px) the note picked in the list shows beside it: whether it's ready,
  **Pin**, **Share** and **Open notes**, when it was and who has it, the summary, decisions (**Confirm** one
  there) and follow-ups (tick one there). A click picks a note; a double click, Enter or **Open notes** opens
  it; ↑, ↓, Home and End move through the list. Narrower, a note opens on its own page.
- When the list has nothing to show, it says why: nothing matches the search (**Clear search**), nothing has
  been shared with you yet, or you have no notes with that person yet (**Show notes with anyone**). Before your
  first notes, Notes shows an example of what they'll look like, with **Start a call** and **Record in the room**.
- **Share** gives the notes to more people by email, or to one of your groups (offered first, by name), once
  the call has ended or the room recording has stopped. Anyone who has the notes can share them; people who have them already are skipped, and someone
  who removed them gets them again. Each share records who shared the notes and when, and the group's name
  when they went to one of the sharer's groups.
- Someone else's notes say how you got them, beside their title: **From Priya’s call** when you were invited,
  **Shared by Theo** when someone shared them afterwards, or **Shared by Theo with Leads** when it was to one of
  their groups. Notes lists them under the call they came from, and **Who has these notes** says how each person
  got them: organizer, invited, or shared afterwards by whom (and with which group). A long list shows its
  first eight people until **Show all** opens it.
- **More › Delete notes** deletes your own notes for everyone, audio included, with anyone's own notes on them, and
  then lists what went. For notes from someone else it's **Remove from your notes**: everyone else keeps them, and
  you're no longer listed as having them. Your own notes on them go for good, and what you added to the shared notes stays.
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
- A note's page starts with a way back (**Notes /** its title), the pin (**Pin these notes**, at most eight
  pinned), **Share** and **More**. Chips above the title say whether it's **Ready**, **Being written** or **Still
  recording**, the series it's in, and how you got it. Under the title: when it was and who has it, then
  **Written in confidential compute** with when the hardware was checked, which opens what was checked about
  the models.
- A written note shows the summary, decisions, open questions, follow-ups, the transcript (its first lines,
  then **Show all 24 minutes**) and, beside it, the encrypted recording, chapters, shared screens and who has
  it. It takes questions about the call: a suggested question or your own, in a bar that stays at the bottom
  while you read (suggestions show at the end of the note). Answers cite the moments in the recording they
  come from.
- Until the notes are written, the page says the audio is saved and encrypted (or, when the call doesn't keep its
  recording, that the call has ended) and the notes are being written
  in confidential compute, and ticks off each step (the call ended, the audio saved, the transcript) with the
  one in progress marked. When nothing was said, it says so and offers **Play** for the audio. A call that didn't keep
  its transcript or recording says so in one line where it would have been, and has no player; you can still ask
  about what the notes say. After **Delete
  notes** it lists what went; a note that isn't there (deleted, or never shared with you) says so, with **Back
  to notes**.
- A question can also go across every note you have, your own and other people's (`POST /v1/notes/ask`,
  behind **Search or ask**, flow 2). The answer comes from those notes only, up
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
- What the notes heard is a proposal until people say so, and each entry shows **What was said** behind it, with
  anything to be careful of: nothing said backs it, someone said otherwise, it was hard to hear, or a line behind it or
  its own words changed since. Each decision says where it stands: **Proposed**, **Confirmed**, **Not decided** or **No longer
  holds**, and who said so. The organizer and anyone invited can **Confirm** what's proposed, except whoever proposed it
  or last reworded it; someone given the notes afterwards can propose and say what they think, but not confirm. Only
  the organizer can say **It wasn’t decided**, and anyone else saying so flags it, in their name, for the organizer to
  settle. Whoever confirmed a decision, or the organizer, can undo that or mark **It no longer holds**. New words on a
  confirmed decision need someone else to confirm them. If what you're agreeing to changed after you opened it, nothing
  is saved and the page shows what it says now. An open question shows **Not answered yet** until someone taps **It was
  answered**. A follow-up shows who the notes suggest, dashed, and any date as only suggested, until that person taps
  **I’ll do it**, or **Not mine**, which leaves it with nobody. Its menu lets the organizer or the person it's for
  give it to anyone who has the notes (giving it to yourself takes it on); once someone has taken it on, only they or
  the organizer can reword, date or tick it, and the organizer doing so asks them again. **History** on each lists every
  change: who did what, when, and what the words were.
- **Propose a decision** and **Add a follow-up** add what the notes missed, in your words, to the call's notes or a
  breakout room's section, and the plus on a transcript line starts one from what was said there.
- A call's notes say when it's in a series: **Every Tuesday** when the last three calls in it were a week apart,
  otherwise **In a series**. Beside the note are the series' other calls (the newest three, with the start of
  each summary), how much is still open across them and, for the organizer, the next call; **All** opens the
  series page. When it isn't in one, the organizer gets **Meet again › Schedule next week’s call**: the same people
  and notes setting, at the same time of day a week on (still the same time when the clocks change in
  between), on the calendar; **Change** in the confirmation moves it or cancels it.
- The series page shows what carries over from the calls you have notes from: decisions (confirmed, not
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

**Record** in the side panel or the phone's tab bar (raised) opens the Record page:

- **The recorder**: a name for the recording (left empty, it's "Notes from the room") and the microphone it will
  use, from this browser's microphones (the same choice calls use). Choosing one doesn't open it. **Check the
  level** opens the microphone and shows how loud it is, recording nothing; **Stop** lets go of it. While it's
  open, a microphone that doesn't start, or one unplugged, is said under it, and the one still in use stays
  shown. The page never opens the microphone by itself, and the camera plays no part.
- **Start recording** (or **R**, or **Enter** in the name) opens the stage recorder, which starts recording the
  microphone straight away, in 5-second encrypted pieces with a live waveform, and transcribes what's said as
  it goes, without naming who spoke. Rename by editing the title, pause and resume, then **Finish and write
  notes** (opens the note) or **Home › Discard recording** (nothing is kept).
- **Without a connection** it keeps recording: **Offline** shows at the top, and "Saved on this device. It
  uploads when you're back online." under the waveform. What's said is transcribed once the connection is back;
  if it comes back while recording, the rest goes up as it's recorded. With a connection that isn't getting
  through, it says Alcove isn't answering and that it's sent when it does. **Finish and save** keeps it on this
  device and goes to Record; with a connection, a recording with a short gap still ends on its note. Started
  offline, it works the same way. A full device pauses it and says so; signed out meanwhile, or with someone
  else signed in, it keeps it here and says so; signed out on this browser, it pauses and says nothing more can
  be kept.
- **On this device**: recordings kept here until they upload, encrypted, each with its name, length and start,
  and how it stands: **Waiting for a connection**, **Waiting to upload**, **Uploading**, **Recording now** (in
  another tab), **Can't upload yet** with Alcove's reason, or, for good, **Can't upload** (more than 14 days old)
  or **Can't be read here** (this device can't open it any more). They upload by themselves when the connection
  is back, the oldest first, and their notes are written; a toast says when each one has, or that one's note was
  deleted on Alcove so it's gone from here too. Its menu has **Upload now** and **Delete from this device**, which
  asks first. A tab closed mid-recording leaves what it recorded here, and it's finished and uploaded as it was.
  Only the account that recorded them sees or uploads them: if someone else signs in on the browser, they stay
  here until their own account signs in again. That account signing out deletes them, and Settings' **Sign out**
  says so first; anyone else's stay.
- **Record without a connection** (on by default) off: nothing is kept on this device, starting needs a
  connection, and losing it pauses the recording. The page says so instead of saying it works without one.
- **Recorded before**: your four newest recordings as tiles (when, how long, the start of the summary, who has
  it, follow-ups still open), with **In Notes** for the rest. Room notes others shared with you aren't listed.
  Before the first recording (and with none waiting on this device), **Your recordings** says they'll show up
  here with their notes.
- **How it works** says the audio is encrypted as it's recorded, recording needs no connection (or, with **Record
  without a connection** off, that a dropped connection pauses it), and room notes go to nobody unless you share
  them.

Room notes are yours alone until you share them.

The note keeps the recording's own times: when it started, how long it ran with the pauses left out, and
when each line was said. Each piece of audio and each clip of speech carries its place in the recording, so
a piece that reaches Alcove late, or twice, still lands where it was recorded, once.

## 10. Team

**Team** shows your company and who in it uses Alcove: the company directory where there is one (the demo
directory today), otherwise the people at your work email domain you have calls or calendar meetings with. A
personal address (gmail.com, outlook.com, icloud.com and the like) has no team.

- **People**: a card for each person on Alcove, you first, then whoever you met most recently, with their
  title (or address) and **Next call** at a time later today or **Last call** with the day, from your notes.
  **Start a call** opens Start a call with them already picked; **Notes with** lists the notes you both have
  (`/notes#with=<address>`: the address stays in the browser, since a fragment is never sent to the web host).
  The cards can show the colleagues invited, or not on Alcove yet, instead. Eight show before **Show all**.
- **Not on Alcove yet**: the rest, each with how many calls and calendar meetings you have with them this month.
  **Invite** (or **Invite all**) opens your own email with an invitation to them (a subject and the link to
  sign in) and marks them invited; **Remind** opens it again. **Invite people** picks from them the same way,
  or copies the invite link, which is the address of the page to sign in. Alcove sends no email itself.
- **Groups**: each with how many people are in it and how many of your calls had any of them. A group opens in
  place (the side panel's groups open it too): its people, each with × to take them out (a group keeps at least
  one); **Add people**, from the people picker; **Start a call** with all of them; **Rename**; and
  **Delete**, which asks once and can be undone for a few seconds. **New group** names one (Enter opens the
  picker) and fills it; a group half made waits there until you make it or discard it with ×. A name is 1 to 40
  characters and not one of your other groups'; a group holds up to 50 people, and you can have 30 groups. Groups
  live in your preferences: only you see them, and only a group's name leaves them, on the notes you share with
  it. Changes to your preferences (groups, pins, settings) are saved one at a time, in order.
- **Shared with groups**: every share with a group in the notes you have, whoever made it ("Theo shared it
  with Leads", "You shared it with Product"), newest first; the notes list carries them (`groupShares`, from
  the people who still have each note). Each opens its note.
- **Your minutes**: the time of notes left and the minutes used this month.

With nobody else at your company on Alcove yet, the page asks you to bring them: you beside empty arches for the
people you meet most, **Invite people** and **Copy invite link**, then those people, each with **Invite**. A
personal account shows "Just you, for now", with **Invite people** (an email from your own mail app, with the
link) and **Copy invite link**, then your groups and the notes shared with groups.

If the team itself doesn't load, the page says why (or that you're offline), with **Try again**. Your groups and
notes load beside it: if your groups don't, their card says so, with **Try again**, and the rest of the page works.

## 11. Settings

**Settings** opens from you at the top right of every page, the phone's avatar or its **Settings** tab. It says who
you're signed in as and how, and has **Take the tour** (the tour of Home again, flow 1) and **Sign out**. With
recordings on this device that haven't uploaded, **Sign out** first says so in place, under it ("2 recordings on
this device haven't uploaded. Signing out deletes them."), says what staying does (they upload by themselves, or,
too old or unreadable here, never will), with **Stay signed in** (focused; **Escape** too) and
**Sign out and delete them**. It counts only this account's recordings, and only those go. On a wide
screen a nav beside the cards jumps to each part and marks the one in view. Every control saves as it changes: the
setting says **Saved** for a moment once it's kept, and one the server refuses goes back, with a toast saying why.

- **Profile**: your name, address and photo from the sign-in, with a link to change them at Google or Microsoft
  (they update here the next time you sign in); your company, from the company directory or the people at your
  work domain you meet (not at a personal address); and the time zone times are shown in, this computer's.
- **Notes**: notes on or off for new calls (each call can still be set when it's scheduled), that everyone invited
  always gets them, the language they're written in ("Same as the call", or one of twelve), and how much the
  summary says (**Short** or **Detailed**). Language and summary apply to notes written from then on.
- **Recording in the room**: **Record without a connection** (on by default), and **On this device**: how many
  recordings, and how much room, wait here to upload, with **See them** (Record's list), or that nothing is waiting.
- **Calendar**: Google Calendar, **Connected** with **Disconnect** (it forgets the connection and withdraws Alcove's
  access at Google), or **Connect**, which goes to Google and comes back to Home; a demo account's sample calendar
  instead. Then **Put calls I schedule on my calendar** and **Show my other meetings on Home** (both on by default).
- **Microphone, speaker and camera**: this browser's choices, the ones the join screen and the call use; choosing
  one doesn't open it. Nothing opens by itself: **Check the level** opens the microphone for eight seconds (the
  browser asks first if it hasn't been allowed) and its level moves as you speak, records nothing, and closes
  sooner when pressed again or when this part leaves the screen. **Play test sound** plays through the chosen
  speaker; the camera is a list only, never opened here, and until the browser has allowed a camera on the join
  screen it says it isn't allowed yet; **Reduce background noise**. They're kept in this browser only.
- **Notifications**: browser notifications, shown on this device while Alcove is open in a tab (any page, a call or a
  recording included; nothing is pushed when no tab is open). Until the browser allows them the choices are greyed
  out and **Turn on browser notifications** asks it (only when pressed; focus stays on the row once it answers);
  when the browser blocks them, the card says to allow them for the site in the browser's settings. Then: before a
  call you organize starts (1 min, 5 min or off); when notes you have are ready (not while that note's page is on
  screen, where they arrive anyway); when someone shares notes with you ("Priya shared it with Product"); when
  someone asks for notes in a call you organize, while you're in another tab or app (in front of you, the call says
  so itself); and on the due day of a follow-up you've taken on, at 9:00 (off by default; for every due Home shows
  as a day, so not "next week" or "ASAP"; not when the due day was set after 9:00 that day). One tab in the browser shows them, and the next takes over when it closes. Each shows
  once, in any tab and across reloads, and several at once (after the computer wakes, or the connection comes back)
  arrive as one: "3 notes are ready", "2 follow-ups are due today". Clicking one brings Alcove forward: on the
  call's join page, the note, Notes, Home, or the call you're in, in the tab already there or else the one used
  last, asking first if that means leaving a call or a recording. With no tab left, it opens one. Signing out, or
  deleting the account, closes the ones still showing and forgets which have shown. The choices are saved with your
  preferences, and one changed in another tab or on another device takes effect within a minute.
- **Appearance**: match the system, light or dark, each shown as a small window in its own colours, kept in this
  browser.
- **Plan and credits**: the time of notes left, a meter, and the minutes of notes used this month (since 00:00 UTC
  on the 1st). Calls without notes are free.
- **Privacy**: what Alcove knows and what it can't read, and the confidential-compute check with the time the
  hardware was verified, when this browser could check it.

**Delete account** opens one step in place (never a window over the page) that names what goes: the notes you
made, with their audio, for everyone who has them; the calls you scheduled; the minutes of notes left; your own notes on
every call, and anything you added from them to other people's notes; your groups
and pins; your Google Calendar connection; and your sign-in on every browser. It says what stays too: the notes other
people gave you, which still have what you said in the call and still say where you changed or shared them.
**Delete my account** then deletes the account for good:
the notes you organized, for everyone you gave them to, with their audio; your recordings, calls and meetings; your own
notes, and everything you added to anyone's shared notes, whether or not you still had the note; your groups and pins; your
Google Calendar connection; and your sessions, so every browser is signed out. You're taken off the notes other
people gave you; notes you shared on stay with the people you shared them with, still saying you shared them.
Your calls on Google Calendar that haven't ended are cancelled there, begun or not, and their guests are told,
except a meeting you made an Alcove call with **Use Alcove**: it's your own event, so it stays on your calendar
as it was, and its Alcove link stops working. Alcove's access to your Google account is revoked. If Google is
slow or unavailable, the account is deleted all the same, and calls it couldn't cancel stay on the calendar.
The shared demo account can't be deleted: the step says so and offers only **Close**; any other failure is said
there too, and **Delete my account** tries again. Once it's deleted you land on the welcome page, signed out, even
if you left Settings meanwhile, and this browser forgets the tour and call view it kept for the account.
Signing in again starts a new, empty account with 10,000 credits.
