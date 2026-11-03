# User flows

[Docs home](../README.md) · [Product overview](overview.md)

Each flow below is implemented in `apps/web` and exercised end to end by the integration tests in
`apps/api/src/flows.integration.test.ts` (API level) and by a real-browser check before release.

## 1. Sign in

1. Open Alcove. Choose **Continue with Google**, **Continue with Microsoft** or **Use single sign-on (SSO)**,
   which asks for a work email.
2. The first time, a welcome says the calendar came along (and the team, when there's a company directory),
   and **Open Alcove** goes to Home. After that, signing in goes straight to Home.

The first sign-in creates the account: its keys, a profile with the name, email and photo from the sign-in,
the notes default (on) and 10,000 credits. Until the providers are connected, sign-in is a stand-in: Google
and Microsoft sign in Art Vandelay (art@vandelay.industries), and SSO signs in whoever's work email was typed,
with a name made from the address. Whenever nothing is coming up at sign-in, a demo day of five calls goes on
the calendar, the first about 12 minutes later.

A session lasts until sign-out, 14 days without use, or 30 days in all; then the app goes back to the welcome
screen. Signing in on another browser doesn't end the first session.

## 2. Home

- The date, a greeting, and **Up next**: the next call with a countdown, who is invited, whether it has
  notes, **Join** (**J**) and **Copy link**. Below it, the rest of today, then tomorrow and later.
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
   call: it goes on Home, with **Undo** for a few seconds. If nobody was invited, the link is copied.

Invitations aren't sent yet, and people invited can't join the call: calls have one participant, the
organizer, for now. Everyone invited still gets the notes (flow 6).

## 4. Join

Pre-join (`/join/<code>`) shows your camera and a mic level, mic and camera switches, the title and time, who
is invited, and whether the call has notes and who gets them. **Join now** opens the call; **Copy link**
copies the join link. A link to a call that isn't on your calendar says so: only the person who set it up can
join it.

## 5. In the call

The call opens full screen. The notes sign at the top shows **Notes on** or **No notes** to everyone in the
call; only the organizer can switch it. Controls: microphone (**M**), camera (**V**), share your screen,
panels for notes, chat (**C**) and people, and **End**.

- While notes are on, the notes panel shows how much encrypted audio has been kept, with a live waveform.
- Turning notes off keeps what was recorded. Turning them on again records a new part.
- Changes show as short notices, like "Notes are on. Everyone here can see that."

## 6. End the call and get the notes

1. **End › End call** uploads the last audio and ends the call.
2. With notes, the note opens. Without, Home says how long the call was and that there are no notes from it.
3. Everyone invited gets the notes as the call ends. They find them under Notes when they sign in with the
   invited address, marked as from the organizer.
4. Until the notes service is connected, a note shows "Waiting to be written" and the steps so far, plays back
   the decrypted recording, and lists who has it.

## 7. Notes

- **Notes** lists every note you have, your own and those from other people, grouped by date. Search
  (**⌘K**) matches titles, summaries and transcripts; the filter picks calls or the room.
- **Share** gives the notes to more people by email, once the call has ended or the room recording has
  stopped. Anyone who has the notes can share them.
- **More › Delete notes** deletes your own notes for everyone, audio included, and then lists what went. For
  notes from someone else it's **Remove from your notes**: everyone else keeps them.
- Once the notes service writes them, a note shows the summary, decisions, follow-ups and transcript, and
  takes questions about the call.

## 8. Record in the room

**New call › Record in the room** starts recording the microphone straight away, in 5-second encrypted pieces
with a live waveform. Rename by editing the title, pause and resume, then **Finish and write notes** (opens the
note) or **Home › Discard recording** (nothing is kept). Room notes are yours alone until you share them.

## 9. Account

The profile from the sign-in (name, email, photo, provider) and the calendar that came with it (the demo
calendar for now); notes for new calls (on or off); credits, shown as the time of notes left; appearance
(system, light or dark); with a company directory, the team, with **Invite** for each colleague; what Alcove
knows and what it can't read; and **Sign out**.
