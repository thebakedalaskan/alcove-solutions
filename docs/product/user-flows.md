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
   team at** the company, with its size and faces, when there's a company directory. **Notes are written in
   confidential compute**, with the time the hardware was verified when this browser could check it. Then
   "You’re in" and the arch opens into Home. **Skip**, **Escape** or **Enter** opens it straight away; with
   reduced motion the finished screen shows for a moment and Home follows. After that, signing in goes
   straight to Home.
4. On first arriving in Home, a tour goes through it, one slide at a time: a card with a short animation, and
   the page dimmed around the real thing the slide is about, with an arrow to it. **Schedule in one line**
   (New call), **Notes for your calls** (a call's notes setting, or the example note before there are calls),
   **Join a call** (Join on the next Alcove call, left out when there isn't one), **Record in the room**
   (Record, in the side panel or the phone's tab bar), **Your notes stay yours** (the confidential-compute badge) and **You’re ready** (New call). The card
   moves beside its target, or along the bottom on a phone; **←**/**→** and **Enter** move through it and
   **Escape** or **Skip tour** closes it. It isn't shown again on that browser for that account; **Take the
   tour** in the menu under your name plays it again.

The first sign-in creates the account: its keys, a profile with the name, email and photo from the sign-in,
the notes default (on) and 10,000 credits. Later sign-ins bring the name, email and photo up to date. Microsoft
and SSO are still stand-ins: Microsoft signs in Art Vandelay (art@vandelay.industries), and SSO signs in
whoever's email was typed, with a name made from the address, as long as it's an address no real person can
have (at example.com or another domain reserved for examples, or at vandelay.industries). These demo accounts get a sample day of
five calls whenever nothing is coming up at sign-in, the first about 12 minutes later.

A session lasts until sign-out, 14 days without use, or 30 days in all; then the app goes back to the welcome
screen. Signing in on another browser doesn't end the first session.

## 2. The side panel

Beside every page:

- **New call** (or **N**) opens the one line of flow 4. **Search or ask** (**⌘K** on a Mac, **Ctrl+K**
  elsewhere) opens the palette, below.
- **Home**; **Notes**, with how many notes you have; and **Record**, which starts recording in the room
  straight away (flow 9).
- **Up next**, on every page but Home: the next Alcove call today, or the next meeting on your calendar
  that has a video link (unless **Show my other meetings on Home** is off), when it starts, who's coming,
  and **Join**. With nothing left today it says the next call will show there, except before your first
  notes, when it says nothing.
- **Pinned**: the notes you pinned, in the order you pinned them, up to 8. A pinned note that was deleted,
  or that you removed from your notes, isn't listed. The pin beside the heading opens the palette to pick
  notes to pin or unpin; with 8 pinned it says to unpin one first. With nothing pinned, a line says what
  pins are for.
- **Groups**: each of your groups and how many people are in it.
- At the bottom: the confidential-compute check (**Confidential compute · verified** when the server's
  hardware answer is bound to this browser's request), the time of notes left, and you, with your company or
  your address, which opens the menu under your name: **Account**, **Take the tour** (the tour of Home again,
  flow 3), the light or dark theme, and **Sign out**.
- Offline, a notice at the top says recording and calls need a connection, and pages update when you're back.
  Up next and the check wait until the connection returns.
- **Hide the side panel** gives the page the room; the button left in the top-left corner brings the panel
  back, and the offline notice moves to the top of the page meanwhile. This browser remembers which.

On a phone (860 px wide or narrower) a top bar takes its place, with the brand, search, **New call** and
you (the same menu), and a tab bar runs along the bottom: **Home**, **Notes**, **Record** (raised) and **Settings**. Offline,
the same notice sits under the top bar.

**The palette** is one line over the page. Before anything is typed it lists your five newest notes. Typing
lists the notes whose titles, summaries or transcripts match, up to eight, with the match marked. **Enter**
or **Ask** asks every note you have (flow 8), one question at a time: the answer appears under the line with
the notes it comes from and the moments in them, and a moment opens its note with the player at that point,
not playing. **↑** and **↓** pick a note instead, and **Enter** opens it. **Escape**, or the shortcut again,
closes the palette, and focus goes back where it was. It never opens over another window, such as New call, and nothing opens over it.

## 3. Home

- The date, a greeting, a **Confidential compute** badge (with the time the hardware was verified when this
  browser could check it), and **Up next**: the next Alcove call or, with Google Calendar connected, the next
  meeting on the calendar, with a countdown and who is invited. An Alcove call shows whether it has notes,
  **Join** (**J**), **Copy link** and, before it starts, **Change this call**. Another calendar meeting
  shows **Join on Google Meet** (or Zoom, Teams, Webex) when it has a video link, **Use Alcove instead** when
  you organized it, and a link to it in Google Calendar.
- When the call that's up next is in a series, **From earlier calls** sits under it: the decisions people
  confirmed, the questions still open (marked once they've stayed open through two calls), and the
  follow-ups someone took on, with a count of the rest (not confirmed yet, not taken on yet, done since the
  last call). Each names the call it came from, which opens its notes, and the moment it was said, which
  opens them at that line. **N calls** opens the series. Before a series has notes, the card says nothing
  carries over yet.
- Below it, the rest of today, then tomorrow and later, with Alcove calls and calendar meetings together.
  A later call in a series has a link to what carries over into it.
  **Use Alcove** on a meeting you organized makes it an Alcove call: the calendar event gets the Alcove
  link, and Google tells everyone on it.
- Signed in with Google without sharing the calendar, a card offers **Connect Google Calendar**.
- Until there are notes, an example note shows what notes look like. After that, **Recent notes** and
  **Your follow-ups**: the follow-ups in your notes that are for you and not done, which can be ticked
  off. They come from the inbox (`GET /v1/notes/inbox`), which also lists the decisions in notes you have that
  nobody has confirmed yet, newest note first. Notes someone else shared with you count; ones you removed don't.
- A team card shows who already uses Alcove, with **Invite** for the rest. With a company directory it lists the directory (with titles). Otherwise it lists the people at your work email domain you have had Alcove calls or calendar meetings with. The calendar is read newest first (the coming week, then up to 90 days back) and given 4 seconds; if Google is slow or unavailable, the team lists Alcove calls only. Personal addresses (gmail.com, outlook.com, icloud.com and the like) have no team.
  Inviting marks them as invited; no email is sent yet.

## 4. Start or schedule a call

1. **New call** (or press **N**) opens one line. Describe the call, like "Design review with Priya tomorrow
   3pm for 45 min". What's understood turns into chips: the day and time, the people (colleagues and people
   from past calls by name, anyone by email address) and notes on or off (from your default, or "no notes" in
   the sentence). A name without a known address asks for an email.
2. **Enter** starts the call now and opens pre-join, unless a day or time was typed. Then it schedules the
   call: it goes on Home and, with Google Calendar connected, on the calendar, where Google sends everyone
   invited an invitation. For a few seconds, **Undo** cancels it. If nobody was invited, the link is copied.
3. **Change this call** opens the same line for a scheduled call, which keeps its time unless a new one is
   typed. **Save changes** updates it, and the calendar sends everyone the update. **Cancel call** takes it
   off the calendar and tells everyone invited.
4. With **Put calls I schedule on my calendar** off (Settings, on by default), a scheduled call stays off
   Google Calendar, and changing or cancelling it never touches Google; nobody is invited through the calendar.

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
confidential compute, and who gets them. Never anyone's name or anything said.

- **The organizer** sees the time and who is invited, **Join now** and **Copy link**.
- **Someone invited**, signed in, is told they get the notes, sees **Join now**, and is in as soon as the
  organizer is there.
- **Anyone else with the link** sees who's hosting, and asks to join. Without an account they type a name; one
  line says guests don't get the notes, and **Sign in to get them** offers Google in place (and Microsoft and
  single sign-on when the organizer signed in with one of those). Signed in that way, they ask under their
  account, and once the organizer lets them in they're added to the invite and get the notes. While they wait
  the page says so, with **Stop asking**; if the organizer turns them away, it says that too.
- **Before the organizer arrives** the page says it's waiting for them and opens joining when they're there. A
  locked call says nobody new can join. A call that's over says so, and opens again if the organizer starts
  it. A link that leads nowhere says to check it. The camera and microphone start as soon as there's a call
  to join, and stop when there isn't.
- A join that fails says why under the button, with a reference (Ref) to quote if it keeps happening.

## 6. In the call

The call opens full screen: the stage with everyone's tiles, a side panel that slides in beside it, and one
dock at the bottom.

- **Top bar.** The title and clock; the notes sign (**Notes on** in crimson, **Notes paused**, **Notes
  unavailable** when the organizer's browser can't record or listen, **Notes off**, or **Notes requested** while
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
- **Transcript**, **Ask**, **Chat** and **People** (who is here, with raised hands, pins and spotlight, and
  who is invited and not here).
- **Catching up**, for you alone and not saved. **Catch up** (top bar or **More**) reads what you most likely
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
  come and go, and someone moved is told. Captions and catching up in a room cover that room only, and the
  call's notes have what was said in the main room. Each room shows its own notes sign: inside a room, the organizer
  can **Pause notes here** (that room alone is told, and its card says **Notes paused**) and carry on later.
  Everyone comes back when time is up, told when notes are on in the main room, and the notes record which rooms
  there were and who was in each.
- Turning notes off keeps what was recorded and transcribed. Turning them on again records a new part, and so
  does the organizer coming back to the call after reloading the page.
- **Pausing** stops everything at once: nothing is recorded, transcribed or sent to the AI, catch-up and
  captions included, until the organizer resumes. Nothing resumes it by itself. The transcript, a catch-up and
  the notes everyone gets say where it was paused ("Paused 10:02–10:05"), and where notes were off.
- **When the organizer's browser can't capture.** Without a microphone that works (none, refused, or busy in
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
- If your connection drops, the top bar says **Reconnecting** and you're back by yourself when it returns, as the
  same person. While the organizer's connection is gone, everyone else's notes sign says **Notes paused**, and
  catching up says what wasn't captured.

Calls are for groups: invited people join with their accounts, anyone else with the link asks and the
organizer lets them in, and video, audio and chat are encrypted end to end between the people in the call
([Calls and recordings › Group calls](../engineering/calls-and-recordings.md#group-calls)).

## 7. End the call and get the notes

1. **Leave › End the call** (with others in the call, **End call for everyone**) sends the last audio and
   speech and ends the call. **Stay in the call** goes back.
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

- **Notes** lists every note you have, your own and those from other people, grouped by date. Search
  matches titles, summaries and transcripts; the filter picks calls or the room.
- **Share** gives the notes to more people by email, once the call has ended or the room recording has
  stopped. Anyone who has the notes can share them; people who have them already are skipped, and someone
  who removed them gets them again. Each share records who shared the notes and when, and the group's name
  when they went to one of the sharer's groups.
- Someone else's notes say how you got them: **From Priya’s call** when you were invited, **Shared with you**
  when someone shared them afterwards. Notes lists them as from whoever gave them to you, and **Who has these
  notes** shows how each person got them.
- **More › Delete notes** deletes your own notes for everyone, audio included, and then lists what went. For
  notes from someone else it's **Remove from your notes**: everyone else keeps them, and you're no longer
  listed as having them.
- A written note shows the summary, decisions, open questions, follow-ups, chapters and transcript, and
  takes questions about the call: a suggested question or your own. Answers cite the moments in the recording
  they come from.
- A question can also go across every note you have, your own and other people's (`POST /v1/notes/ask`,
  behind **Search or ask**, flow 2). The answer comes from those notes only, up to 12 of them that share the
  most words with the question, and cites the notes and the moments in them it comes from. Until a note is
  written, or when nothing was said in any, it says so instead, and nothing is sent to the notes model. An
  answer written while a note it read was deleted or taken from you isn't shown: ask again.
- The transcript dots what it isn't sure of (words that were hard to hear, a name heard on more than one
  microphone) and says what the dots mean above it. The organizer can correct any line in place, its words or
  who said it, or say it was heard right; anyone else who has the notes can correct the words of their own lines,
  or say their words were heard right. Each line says who corrected it and when, starting with what was heard.
  Once lines were corrected, the organizer is offered **Write the notes again**, which keeps what people already
  confirmed or took on. Meanwhile everyone still reads, asks about and confirms the notes as they were, marked
  **Being written again**.
- What the notes heard is a proposal until people say so. Each decision shows **Proposed by the notes** until
  someone who has the notes taps **Confirm** (or **It wasn’t decided**); it says who did, and can be reworded,
  undone or reopened. A confirmed decision that a later one replaced can be marked **It no longer holds**. An
  open question shows **Not answered yet** until someone taps **It was answered**. A follow-up shows who the
  notes suggest, dashed, until that person taps **Take it on**. Its menu gives it to anyone who has the notes
  (giving it to yourself takes it on), sets a due date, rewords it, and lists every change: who did what, and
  when.
- A call's notes say when it's **In a series**, with how much is still open and, for the organizer, the next
  call. When it isn't in one, the organizer gets **Meet again › Schedule next week’s call**: the same people
  and notes setting, at the same time of day a week on (still the same time when the clocks change in
  between), on the calendar; **Change** in the confirmation moves it or cancels it.
- The series page shows what carries over from the calls you have notes from: decisions (confirmed, not
  confirmed yet, and no longer holding), questions still open, and follow-ups taken on, not taken on yet and
  done since the last call, each with the call and moment it came from. Things can be settled there, and
  questions asked across the calls, with answers that cite the calls and moments they come from, by the
  days you saw them on. Someone invited to only some of the calls sees only those. It shows the newest 24
  calls and says how many older ones aren't shown. The organizer also sees the next call, with **Join** and
  **Change this call**, or **Schedule next week’s call**. When the series follows a recurring Google event
  and Google Calendar isn't connected any more, it says so and offers **Connect Google Calendar**.

## 9. Record in the room

**Record** in the side panel or the phone's tab bar, or **New call › Record in the room**, starts recording the microphone straight away, in 5-second encrypted pieces
with a live waveform, and transcribes what's said as it goes, without naming who spoke. Rename by editing the
title, pause and resume, then **Finish and write notes** (opens the note) or **Home › Discard recording**
(nothing is kept). Room notes are yours alone until you share them.

The note keeps the recording's own times: when it started, how long it ran with the pauses left out, and
when each line was said. Each piece of audio and each clip of speech carries its place in the recording, so
a piece that reaches Alcove late, or twice, still lands where it was recorded, once.

## 10. Account

The profile from the sign-in (name, email, photo, provider); for a Google account, Google Calendar (connected,
or **Connect**, with **Disconnect** to forget it and withdraw Alcove's access at Google, and **Put calls I schedule on my calendar** to keep scheduled
calls off it), and for a demo account, the sample calendar; notes for new calls (on or off); credits, shown
as the time of notes left and the minutes of notes used this month (since 00:00 UTC on the 1st); appearance
(system, light or dark); the team (not at a personal address), with **Invite** for each colleague; what Alcove
knows and what it can't read; and **Sign out**.

**Delete account**, after a step that names what goes, deletes the account for good: the notes you organized,
for everyone you gave them to, with their audio; your recordings, calls and meetings; your groups and pins; your
Google Calendar connection; and your sessions, so every browser is signed out. You're taken off the notes other
people gave you; notes you shared on stay with the people you shared them with, still saying you shared them.
Your calls on Google Calendar that haven't ended are cancelled there, begun or not, and their guests are told,
except a meeting you made an Alcove call with **Use Alcove**: it's your own event, so it stays on your calendar
as it was, and its Alcove link stops working. Alcove's access to your Google account is revoked. If Google is
slow or unavailable, the account is deleted all the same, and calls it couldn't cancel stay on the calendar.
The shared demo account can't be deleted. Signing in again starts a new, empty account with 10,000 credits.
