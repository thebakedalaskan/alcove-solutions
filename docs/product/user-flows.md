# User flows

[Docs home](../README.md) · [Product overview](overview.md)

Each flow below is implemented in `apps/web` and exercised end to end by the integration tests in
`apps/api/src/flows.integration.test.ts` (API level) and by a real-browser check before release.

## 1. Create an account

1. Open Alcove. Enter your name and choose **Create your passkey**.
2. The browser creates a passkey (Touch ID, Face ID, Windows Hello, a phone or a security key).
3. You land on the first-day home: 10,000 free credits, a setup checklist (passkey ✓, first call, second
   passkey) and empty states for meetings and notes.

There is no password, email or social sign-in. Connecting calendars and other accounts comes later.

## 2. Unlock

Returning, or after the session ends (15 minutes idle, 60 minutes at most, or a server restart), choose
**Unlock with your passkey**. If the passkey's provider supports PRF the key comes from the passkey;
otherwise from a secret kept on the device where the passkey was created.

## 3. Start a call now

1. **New call › Start a call now** (or press **N**). A call is created and you go to pre-join.
2. Pre-join shows your camera, a live mic meter and device names. Choose notes for this call:
   *Notes + transcript*, *Notes only* or *No notes* (pre-selected from your default; "Ask me" leaves it open).
3. **Join**. The call opens full screen. Controls: mute (M), camera (V), present your screen, notes,
   raise hand, leave; panels for notes, people and chat (C).

## 4. Notes during a call

- Starting notes shows a notice to everyone and records from that moment.
- Pause stops recording; resume continues the same part. Stop ends the part; starting again begins a new part.
- The notes panel shows recording time and how many encrypted pieces have been saved.

## 5. Leave and read notes

1. **Leave** flushes the last audio, ends the call and hands the recording to the notes service.
2. "Writing your notes" shows progress, then opens the note.
3. Until the notes service is connected, the note shows a clear status and plays back the decrypted recording.

## 6. Schedule for later

**New call › Schedule for later**: title, day, time, length, guests, notes setting and who receives notes.
The meeting appears on Home (next call, week view) and in Meetings, where it can be edited, have its notes
setting changed, or be cancelled. Guests are stored; email invites are not sent yet.

## 7. Record in the room

**Record in the room** records your microphone in 5-second encrypted pieces with a live waveform.
Rename, pause, resume, **Stop and save** (into a private note) or **Discard** (deletes everything).

## 8. Account

Change your name, set notes defaults, add a passkey on another device, see credits, or **Lock Alcove**.
