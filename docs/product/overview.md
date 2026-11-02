# Product overview

[Docs home](../README.md) · [User flows](user-flows.md) · [System architecture](../engineering/system-architecture.md)

Alcove is a private video call platform with confidential AI notes built in. Notes are a service of
the call itself: no bot joins the meeting, nobody installs a recorder, and the notes are written inside
confidential compute that Alcove's operators cannot read.

## The problem

Meeting notes today come from one of three places, and each is wrong for sensitive conversations:

1. **The platform's own AI** (Google Meet, Zoom). Convenient, but the provider reads everything.
2. **A note-taker bot** someone brings in (Fireflies and the like). It sits visibly in the call (imagine a
   therapy session), and sharing its notes with non-users pushes them to sign up.
3. **Recording in the background yourself.** Illegal under two-party consent in many places, uncomfortable
   for everyone else, and fiddly to set up.

Proton Meet shows that end-to-end encrypted calls can be pleasant and open source, but it has no AI notes.
Alcove's thesis: confidential transcription and notes belong inside a privacy-first video platform.

## What it does

| Capability | What the user gets |
| --- | --- |
| Calls | Start a call instantly or schedule one, join full screen with camera, mic and screen sharing, chat. |
| Notes in calls | Choose per call: notes with transcript, notes only (transcript deleted after writing), or none. Everyone sees when notes are on, paused or stopped. Notes start only when someone starts them, never retroactively. |
| Recording in the room | Record an in-person conversation into the same private notes. Only you can read them. |
| Notes | Summary, decisions, action items, chapters, what was on the shared screen, and the transcript if kept, with questions answered from the call only. |
| Privacy | A passkey is the only key to your notes. Content is encrypted before storage; the server holds your key only while you're unlocked. |
| Credits | Calls are free. Notes and room recordings use credits (25 a minute); new accounts start with 10,000. |

## Status of this build

| Area | State |
| --- | --- |
| Passkey accounts, lock and unlock, second passkeys | Working |
| Scheduling, instant calls, call links | Working; email invites not sent yet |
| Calls with real camera, microphone, screen sharing, chat | Working, one participant (you); multi-party is next |
| Notes recording (encrypted audio pieces, playback) | Working |
| Transcription and note writing (NEAR AI) | Key configured, not yet called; notes wait in "pending" |
| Notes from shared screens | Planned (stretch goal; Scribe-style capture is a reference) |
| Payments (USDC top-ups) | Not connected; balance and welcome credits only |
| Confidential compute (TEE, attestation) | Required before real users; see deployment docs |
