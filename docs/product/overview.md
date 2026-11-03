# Product overview

[Docs home](../README.md) · [User flows](user-flows.md) · [System architecture](../engineering/system-architecture.md)

Alcove is a private video call platform with confidential AI notes built in. Notes are a service of
the call itself: no bot joins the meeting, nobody installs a recorder, and the notes are written inside
confidential compute that Alcove's operators cannot read. In this build the notes are written by NEAR AI
Cloud's private inference, which Alcove verifies before sending anything, and Alcove's own server doesn't
run in confidential compute yet; see [Status](#status-of-this-build).

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
| Sign-in | Google, Microsoft or the company's single sign-on. The calendar comes with the account, and the company directory with a work account. |
| Calls | Start a call now or schedule one from a single line; join full screen with camera, mic, screen sharing and chat. Scheduled calls go on the organizer's calendar, which invites everyone, and an organizer can move one of their own calendar events to Alcove. |
| Notes in calls | On or off for each call, set when it's scheduled (new calls follow the account's default). During the call only the organizer can switch them, and everyone in the call sees the notes sign. While they're on, what's said is transcribed as the call goes. Nothing is recorded while notes are off, and nothing from before they were turned on. |
| Who gets the notes | Everyone invited, when the call ends. They find the notes in Alcove when they sign in with the invited address, and anyone who has them can share them on by email. |
| Recording in the room | Record an in-person conversation into the same kind of notes. They stay yours alone until you share them. |
| Notes | Summary, decisions, follow-ups, chapters and the transcript, with questions answered from the call only, citing the moments they come from. |
| Privacy | Content is encrypted before it's stored, under keys for each account. The server holds those keys, wrapped under one master key, so the promise that Alcove can't read notes depends on releasing that key only to attested confidential compute. Speech and transcripts go to private inference (NEAR AI Cloud) to be transcribed and written up. |
| Credits | Calls without notes are free. Notes and room recordings use credits (25 a minute); new accounts start with 10,000. |

## Status of this build

| Area | State |
| --- | --- |
| Sign-in with Google | Working: OpenID Connect with PKCE, accepting only email addresses Google has verified |
| Sign-in with Microsoft and SSO | Stand-ins: Microsoft signs in a demo person (Art Vandelay); SSO signs in whoever's email is typed, unverified, so it takes only example addresses |
| Calendar | Google Calendar for Google accounts: the coming week's meetings on Home, scheduled calls on the calendar with Google's invitations, changes and cancellations kept in step, and an organizer's own event made an Alcove call. Demo accounts get a sample day of calls when nothing is upcoming |
| Company directory | Stand-in: `vandelay.industries` accounts see a demo directory |
| Scheduling and instant calls | Working. Alcove sends no emails of its own; invitations come from Google Calendar when it's connected. Calls started now don't go on the calendar |
| Calls with real camera, microphone, screen sharing, chat | Working, one participant (the organizer): people invited can't join yet; multi-party arrives with LiveKit |
| Notes recording (encrypted audio pieces, playback) | Working |
| Live transcript (NEAR AI) | Working while notes are on, in calls and room recordings. Call lines are all attributed to the organizer; room recordings don't say who spoke |
| Written notes and questions (NEAR AI) | Working: summary, decisions, follow-ups, chapters and suggested questions, written when the recording stops; answers cite moments in the recording. If the notes service fails three times, the note keeps its transcript and audio without a summary. Each model's hardware evidence is checked first and everything sent is encrypted to it; the note says which verified models wrote it and what was checked |
| Notes for everyone invited, sharing by email | Working |
| Notes from shared screens | Planned (stretch goal; Scribe-style capture is a reference) |
| Credits and payments | Notes are charged 25 credits a minute when they're written; nothing checks the balance first, and USDC top-ups aren't connected |
| Confidential compute (TEE, attestation, master key release) | Required before real users; see [Privacy › Production requirements](../engineering/privacy-keys-and-sessions.md#production-requirements) |
