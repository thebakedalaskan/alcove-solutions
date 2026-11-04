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
   **Join a call** (Join on the next Alcove call, left out when there isn't one), **Record in the room** (In the
   room), **Your notes stay yours** (the confidential-compute badge) and **You’re ready** (New call). The card
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

## 2. Home

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
  **Your follow-ups**: the open follow-ups from your notes, which can be ticked off.
- With a company directory, a team card shows who already uses Alcove, with **Invite** for the rest.
  Inviting marks them as invited; no email is sent yet.

The sidebar has **New call**, **Home**, **Notes** and **In the room** (record on your phone). The menu under
your name has **Account**, **Take the tour**, the light or dark theme, and **Sign out**.

## 3. Start or schedule a call

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

Alcove sends no emails of its own yet, so without a connected calendar nobody hears about the call, and calls
started now don't go on the calendar. People invited can't join the call either: calls have one participant,
the organizer, for now. Everyone invited still gets the notes (flow 6).

## 4. Join

Pre-join (`/join/<code>`) shows your camera and a mic level, mic and camera switches, the title and time, who
is invited, and whether the call has notes and who gets them. Under the preview you pick a microphone,
camera and speaker (where the browser allows choosing one), and **Test microphone** records three seconds
and plays them back, without uploading or keeping anything. Alcove remembers the choices in this browser and
says when one isn't plugged in. In the call, the arrow beside the microphone and camera buttons switches
devices without leaving the call or interrupting the notes. **Join now** opens the call; **Copy link**
copies the join link. A link to a call that isn't on your calendar says so: only the person who set it up can
join it.

## 5. In the call

The call opens full screen: the stage with everyone's tiles, a side panel that slides in beside it, and one
dock at the bottom.

- **Top bar.** The title and clock; the notes sign (**Notes on** in crimson, or **Notes off**), the same for
  everyone, which opens the notes; your view: **Auto**, **Speaker** or **Grid**, which change only your
  screen, beside a menu with the same three, two ready-made layouts (**Everyone equal**, **Presenter and me**),
  where you see yourself, and a reset (on a phone, that menu is the one button); **Reset my view** once you've
  arranged it; **Catch up**; the shield, whose hover says what
  confidential compute covers (verified only when the server's hardware check is bound to this browser's
  request); and who is here, which opens People.
- **Dock.** Microphone (**M**) and camera (**V**), each with an arrow for its menu: which microphone, which
  speaker, **Play test sound** and **Noise reduction**; your camera's preview, which camera and, where the
  browser can do it, **Blur my background**. Then **Share** (a tab, a window or a screen; the browser's own
  picker asks which one), **Raise hand**, **Captions** (with an arrow to pick the caption language), breakout
  rooms (once someone else is in the call), **Notes**, **Chat** (**C**), **More** (Catch up, Audio and video
  settings) and **Leave**.
- **Your view.** Drag a tile to reorder, drag its corner to make it bigger, drag the line beside a shared
  screen. A tile's **⋯** menu says what each choice changes and the key for it: **Pin for me** (up to six people,
  who share the main stage), **Move earlier** and **Move later**, **Make bigger** (Only you), and **Spotlight for
  everyone** (Everyone; organizer only). On your own tile it also has where you see yourself: **In the grid**,
  **In a corner** (drag it, or Shift and an arrow, to another corner) or **Hidden** (a small chip in the corner
  brings you back; everyone else still sees you). A shared screen's **⋯** shows it big or as a tile. A pin or a
  spotlight shows on the tile with an ×, a spotlight also as a bar with **Stop spotlight**. From the keyboard, Tab
  to the stage, move between tiles with the arrow keys, and use **Enter** for the menu, **P** to pin, **Shift**
  with an arrow to move and **+** or **−** to resize; **Escape** unpins everyone. Someone pinned who leaves is
  pinned again if they come back, and nothing you arranged moves when people talk, join, leave, turn their camera
  off or share. Alcove remembers how you like calls (the layout, room for shares, where you see yourself) for your
  account in this browser; how you arranged this call lasts until you leave it.
- **Sharing.** A bar says what you're sharing, with **Change** and **Stop sharing**.
- **Captions** are off until you turn them on, and turning them off only hides them: while notes are on the
  call is still transcribed. Captions show the newest line, in the language you pick (translated in
  confidential compute, for you alone), with the original underneath. Captions need notes on.
- **Notes** (side panel). While notes are on: what's been decided, the follow-ups (who and when, as said),
  and a summary, read from the transcript as the call goes; each time jumps to the transcript. The organizer's
  **⋯** turns notes on or off. The notes everyone gets are written when the call ends.
- **Transcript**, **Ask** (questions about the call so far, and **Catch me up** for the last few minutes, for
  you alone and not saved), **Chat** and **People** (who is here, with raised hands, pins and spotlight, and
  who is invited and not here).
- **Breakout rooms.** Pick two or three rooms and how long, drag people between rooms and rename them, then
  **Open rooms**. While they're open: a shared timer, each room and who is in it, **Join room** and **Back to
  main room**, **Message every room**, and **Bring everyone back now**. Everyone comes back when time is up,
  and the rooms go into the call's notes.
- Turning notes off keeps what was recorded and transcribed. Turning them on again records a new part.
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

## 6. End the call and get the notes

1. **Leave › End the call** (with others in the call, **End call for everyone**) sends the last audio and
   speech and ends the call. **Stay in the call** goes back.
2. The sheet becomes **Call ended**: who gets the notes, and how they're coming along until "Notes are
   ready", then **Read the notes** or **Go to Home**. The note shows the steps so far (call ended, audio
   saved, the transcript's length, the notes being written), playback of the decrypted recording, and who
   has it. Without notes, the sheet says there's nothing to send.
3. Everyone invited gets the notes as the call ends. They find them under Notes when they sign in with the
   invited address, marked as from the organizer.
4. If the notes service fails three times, the note is finished with its transcript and recording and no
   summary. On a server without NEAR AI, notes wait with "Waiting for the notes service to be connected".
   While the notes model's evidence can't be checked or doesn't check out, nothing is sent; and while it
   doesn't answer, nothing is lost. Either way notes wait with "Waiting for the notes model. The notes are
   written as soon as it’s verified and answering" and are tried again every five minutes.

## 7. Notes

- **Notes** lists every note you have, your own and those from other people, grouped by date. Search
  (**⌘K**) matches titles, summaries and transcripts; the filter picks calls or the room.
- **Share** gives the notes to more people by email, once the call has ended or the room recording has
  stopped. Anyone who has the notes can share them.
- **More › Delete notes** deletes your own notes for everyone, audio included, and then lists what went. For
  notes from someone else it's **Remove from your notes**: everyone else keeps them.
- A written note shows the summary, decisions, open questions, follow-ups, chapters and transcript, and
  takes questions about the call: a suggested question or your own. Answers cite the moments in the recording
  they come from.
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

## 8. Record in the room

**In the room** in the sidebar, or **New call › Record in the room**, starts recording the microphone straight away, in 5-second encrypted pieces
with a live waveform, and transcribes what's said as it goes, without naming who spoke. Rename by editing the
title, pause and resume, then **Finish and write notes** (opens the note) or **Home › Discard recording**
(nothing is kept). Room notes are yours alone until you share them.

## 9. Account

The profile from the sign-in (name, email, photo, provider); for a Google account, Google Calendar (connected,
or **Connect**), and for a demo account, the sample calendar; notes for new calls (on or off); credits, shown
as the time of notes left; appearance (system, light or dark); with a company directory, the team, with
**Invite** for each colleague; what Alcove knows and what it can't read; and **Sign out**.
