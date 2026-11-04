# The redesigned app

[Plan](../plans/2026-11-03-app-redesign.md) · Visual design: the "Alcove app redesign" canvas (claude.ai artifact
`PjpX3aXPs2dVT9YEWEfcod`, private to Ben). Every screen and empty state on the canvas is the visual spec; this page
records the decisions behind it and what the backend has to provide.

## Why

Home and the side panel felt empty. The redesign gives each part of the app one job and fills it with real things:
what's next, what's waiting on you, what you owe, your notes, your team, recording in the room (also without a
connection), and settings that cover how Alcove behaves.

## What ships, in order

1. **Backend for the redesign** (API, storage, integration tests). Stored shapes change, so production's database is
   backed up and reset when it merges.
2. **The redesigned app**: side panel, Home, Notes, a note, Team, Record, Settings, the phone tab bar and every empty
   state, on the new API.
3. **Offline recording and notifications**: the recorder keeps working without a connection, the app opens offline,
   and browser notifications.

Each is its own PR, merged and deployed before the next starts.

## Product decisions

- **Side panel.** New call; "Search or ask" (opens the palette, ⌘K); Home, Notes (count), Record (count of
  recordings waiting to upload), Team (count of people on Alcove); Up next with Join (not on Home, not offline);
  Pinned notes; Groups; the confidential-compute check (from `q.trust()`); minutes of notes left; you, opening
  Settings. Offline, a notice says recording still works. Below 860px it becomes a bottom tab bar: Home, Notes,
  Record (raised, in the middle), Team, Settings.
- **Pins** belong to a person, are ordered, at most 8, and live with their preferences. Deleting a note, or removing
  someone else's note from yours, unpins it.
- **Groups** belong to a person: a name (1–40 characters) and 1–50 email addresses. Inviting a group to a call or
  sharing notes with it adds its people. Whoever gets notes shared with a group sees who shared them and the group's
  name ("Priya shared it with Product"). Nothing about a group leaves its owner's vault except the name carried on a
  share.
- **Who shared a note.** A note you received says how you got it: invited to the call, or shared afterwards by whom
  (and with which group). This replaces today's `from`, which is always the organizer.
- **Waiting on you** = decisions the notes proposed that nobody has confirmed, in any note you have; follow-ups the
  notes suggest for you that you haven't taken on; notes shared with you in the last 7 days.
- **Your follow-ups** = follow-ups you own that aren't done, across every note you have (yours and received), with
  their due text.
- **Ask your notes** answers from the notes you have and nothing else, cites the notes and moments it used, and runs
  through the same verified private inference as asking about one note. With no ready notes it says so without
  calling a model.
- **Series.** Main's series: calls that follow on from each other (the next call scheduled after one, or the
  occurrences of a recurring Google Calendar meeting held in Alcove) share a `seriesId`; a title alone never makes
  one. Home's "Last time" is the series' latest earlier call, with "From earlier calls" (what carries over) under
  Up next; a series whose last three calls are 7 days apart is labelled "Every <weekday>". The note page shows
  the series a call is in.
- **Team.** The company directory where one exists (the demo directory today). Otherwise the people at your work
  email domain you've had calls or calendar meetings with, marked on Alcove or invited. Personal email domains have
  no team: gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, icloud.com, me.com, yahoo.com, aol.com,
  proton.me, protonmail.com. Each person's last call with you comes from your notes. "Copy invite link" copies the
  sign-in page's address.
- **Notes language**: "Same as the call" (default) or English, Spanish, French, German, Portuguese, Italian, Dutch,
  Japanese, Chinese, Korean, Hindi or Arabic. **Summary**: Short (default, two or three sentences) or Detailed (a
  short paragraph per topic). Both change how the notes are written from then on.
- **Calendar.** "Put calls I schedule on my calendar" (default on); "Show my other meetings on Home" (default on);
  Disconnect deletes the stored Google tokens.
- **Notifications** are browser notifications while Alcove is open in a tab: before a call (1 min, 5 min or off;
  default 5 min), notes ready, notes shared with you, someone asks for notes in your call, a follow-up is due (off by
  default; due text that names a weekday, "today" or "tomorrow").
- **Offline recording.** The recorder keeps going without a connection. Audio pieces and speech clips stay in the
  browser's IndexedDB, encrypted with a non-extractable AES-GCM key made on this device, and upload when the
  connection returns; the notes are written then. A service worker caches the app so Alcove opens offline. "Record
  without a connection" (default on) turns this off; then a dropped connection pauses recording, as today.
- **Usage**: minutes of notes used this calendar month, from the credit ledger.
- **Delete account** physically deletes the account and everything it owns (notes and their audio, recordings,
  meetings, groups, pins, calendar tokens, sessions) and takes it off notes others shared with it. Notes it
  organized are deleted for everyone, as deleting a note is today.
- **Devices** (microphone, speaker, camera, noise reduction) are this browser's choices, the ones pre-join already
  remembers. The camera is a list only: you see yourself on the join screen, never before.

## Needs Ben before it can ship

These are on the canvas but depend on something outside the repo. They aren't drawn until they work.

- **Outlook calendar** (and real Microsoft sign-in): a Microsoft Entra app (client ID, secret, redirect URI).
- **Add minutes** and the **team plan with seats**: a payments provider account (1Click, per
  [payments and usage](../../engineering/payments-and-usage.md)) and pricing.
- **Invitation emails sent by Alcove itself**: an email provider. Until then, inviting someone opens your own
  email with the invitation.
- **Telling voices apart** in room recordings: a diarization-capable model on NEAR AI. Room transcripts name nobody
  today, by design.
