# Product overview

[Docs home](../README.md) · [User flows](user-flows.md) · [System architecture](../engineering/system-architecture.md)

Alcove is a private video call platform with confidential AI notes built in. Notes are a service of
the call itself: no bot joins the meeting, nobody installs a recorder, and the notes are written inside
confidential compute that Alcove's operators cannot read. Neither the notes service nor confidential compute
is in place in this build yet; see [Status](#status-of-this-build).

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
| Sign-in | Google, Microsoft or the company's single sign-on. The calendar and the company directory come with the account. |
| Calls | Start a call now or schedule one from a single line; join full screen with camera, mic, screen sharing and chat. |
| Notes in calls | On or off for each call, set when it's scheduled (new calls follow the account's default). During the call only the organizer can switch them, and everyone in the call sees the notes sign. Nothing is recorded while notes are off, and nothing from before they were turned on. |
| Who gets the notes | Everyone invited, when the call ends. They find the notes in Alcove when they sign in with the invited address, and anyone who has them can share them on by email. |
| Recording in the room | Record an in-person conversation into the same kind of notes. They stay yours alone until you share them. |
| Notes | Summary, decisions, follow-ups, chapters and the transcript, with questions answered from the call only. |
| Privacy | Content is encrypted before it's stored, under keys for each account. The server holds those keys, wrapped under one master key, so the promise that Alcove can't read notes depends on releasing that key only to attested confidential compute. |
| Credits | Calls without notes are free. Notes and room recordings use credits (25 a minute); new accounts start with 10,000. |

## Status of this build

| Area | State |
| --- | --- |
| Sign-in with Google, Microsoft and SSO | Stand-ins: Google and Microsoft sign in a demo person (Art Vandelay); SSO signs in whoever's work email is typed, unverified |
| Calendar and company directory | Stand-ins: a demo day of calls is placed at sign-in when nothing is upcoming; `vandelay.industries` accounts see a demo directory |
| Scheduling and instant calls | Working; invitation emails aren't sent yet |
| Calls with real camera, microphone, screen sharing, chat | Working, one participant (the organizer); multi-party arrives with LiveKit |
| Notes recording (encrypted audio pieces, playback) | Working |
| Notes for everyone invited, sharing by email | Working |
| Transcription and note writing (NEAR AI) | Not connected; notes stay "pending" with their audio saved and encrypted, and asking about notes answers "unavailable" |
| Notes from shared screens | Planned (stretch goal; Scribe-style capture is a reference) |
| Payments (USDC top-ups) | Not connected; balance and welcome credits only, and nothing is charged yet |
| Confidential compute (TEE, attestation, master key release) | Required before real users; see [Privacy › Production requirements](../engineering/privacy-keys-and-sessions.md#production-requirements) |
