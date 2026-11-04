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
3. The first time, a short screen says what came along (the calendar, and the team when there's a company
   directory), and **Open Alcove** goes to Home. After that, signing in goes straight to Home.

The first sign-in creates the account: its keys, a profile with the name, email and photo from the sign-in,
the notes default (on) and 10,000 credits. Later sign-ins bring the name, email and photo up to date. Microsoft
and SSO are still stand-ins: Microsoft signs in Art Vandelay (art@vandelay.industries), and SSO signs in
whoever's email was typed, with a name made from the address, as long as it's an address no real person can
have (at example.com or another domain reserved for examples, or at vandelay.industries). These demo accounts get a sample day of
five calls whenever nothing is coming up at sign-in, the first about 12 minutes later.

A session lasts until sign-out, 14 days without use, or 30 days in all; then the app goes back to the welcome
screen. Signing in on another browser doesn't end the first session.

## 2. Home

- The date, a greeting, and **Up next**: the next Alcove call or, with Google Calendar connected, the next
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
says when one isn't plugged in. In the call, the small arrow on the microphone and camera buttons switches
devices without leaving the call or interrupting the notes. **Join now** opens the call; **Copy link**
copies the join link. A link to a call that isn't on your calendar says so: only the person who set it up can
join it.

## 5. In the call

The call opens full screen. The notes sign at the top shows **Notes on** or **No notes** to everyone in the
call; only the organizer can switch it. Controls: microphone (**M**), camera (**V**), share your screen,
panels for notes, chat (**C**) and people, and **End**.

- While notes are on, what's said appears as a live transcript, and the notes panel shows how much encrypted
  audio has been kept, with a live waveform. If the browser can't transcribe, the call says so and the
  recording carries on.
- **Catch up** in the notes panel reads the transcript so far, for you alone: the last 5 minutes, the last 15
  or the whole call, sorted into what was decided, what was suggested but not agreed, what's still open and
  what's next, each with when it was said. It says how current it is and when notes were off, and you can ask
  about the call so far. Nothing is saved, and nobody else sees it. **Back to live** returns to the transcript.
- Turning notes off keeps what was recorded and transcribed. Turning them on again records a new part.
- Changes show as short notices, like "Notes are on. Everyone here can see that."

## 6. End the call and get the notes

1. **End › End call** sends the last audio and speech and ends the call.
2. With notes, the note opens: "Waiting to be written", with the steps so far (call ended, audio saved, the
   transcript's length, the notes being written), playback of the decrypted recording, and who has it. The
   notes appear once they're written. Without notes, Home says how long the call was and that there are no
   notes from it.
3. Everyone invited gets the notes as the call ends. They find them under Notes when they sign in with the
   invited address, marked as from the organizer.
4. If the notes service fails three times, the note is finished with its transcript and recording and no
   summary. On a server without NEAR AI, notes wait with "Waiting for the notes service to be connected".

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

**New call › Record in the room** starts recording the microphone straight away, in 5-second encrypted pieces
with a live waveform, and transcribes what's said as it goes, without naming who spoke. Rename by editing the
title, pause and resume, then **Finish and write notes** (opens the note) or **Home › Discard recording**
(nothing is kept). Room notes are yours alone until you share them.

## 9. Account

The profile from the sign-in (name, email, photo, provider); for a Google account, Google Calendar (connected,
or **Connect**), and for a demo account, the sample calendar; notes for new calls (on or off); credits, shown
as the time of notes left; appearance (system, light or dark); with a company directory, the team, with
**Invite** for each colleague; what Alcove knows and what it can't read; and **Sign out**.
