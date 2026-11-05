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
| Calls | Start a call now or schedule one from a single line; join full screen with camera, mic (each with its own device menu, a level meter, and plain help when the browser blocks them), each person's volume for you, video quality (send up to HD 1080p; see cameras as sharp as their tiles, at their smallest, or not at all), screen sharing (a tab, window or screen; several people at once, side by side; zoom into a share, freeze it, step back through its last pictures, or open it in its own window, for you only), pointing at what's shared (a named pointer and marks that fade, end-to-end encrypted), raise hand, captions in your own language, chat, your own view (Auto, speaker or grid; pin several people, reorder, resize, see yourself in the grid, a corner or not at all, two ready-made layouts, all by keyboard too), spotlight and breakout rooms for the organizer. Move a call to another device (a QR code or link; your place, microphone and camera come with you), and come back by yourself after a dropped connection. Scheduled calls go on the organizer's calendar, which invites everyone, and an organizer can move one of their own calendar events to Alcove. |
| Notes in calls | On or off for each call, set when it's scheduled (new calls follow the account's default). During the call only the organizer can switch them or pause them, and anyone else can ask for them. Everyone in the call, and anyone about to join, sees what's captured: recording and transcript (both of everyone the host hears), AI notes and shared screens, each on, paused, off, or unavailable when the host's browser can't capture it or is out of the call. The host is the organizer, or while the organizer's connection is down or they've left it to someone, someone invited standing in; the call goes on, and the organizer takes it back by joining again. While they're on, what's said is transcribed as the call goes. Nothing is recorded while notes are off or paused, and the notes say where they were, and where the organizer's browser was out of the call. The organizer can also have shared screens read: each presenter's own browser sends what changes on their share, and the notes show what was on screen beside what was said, and point at it. |
| Catching up in a call | For you alone: what you missed while away or before you joined, or any stretch of the call, sorted into decided, suggested, still open and next, each point with the moments it was said, saying what it couldn't hear, what it skipped in a very long stretch, and as of when. Nothing is kept unless you keep an answer in your own notes. In a breakout room it reads what was said in the room while you were there. Everyone on the invite (people signed in whom the organizer let in from the link included) catches up on the whole call; guests with only the link and a name catch up on what was said while they were there. |
| Who gets the notes | Everyone invited, when the call ends, and people signed in whom the organizer lets in from the link (they're added to the invite). They find the notes in Alcove when they sign in with that address, and anyone who has them can share them on by email or with one of their groups. Each note records how everyone got it: invited by the organizer, or shared afterwards by whom, and with which group. Guests with only the link and a name don't get them. |
| Recording in the room | Record an in-person conversation into the same kind of notes, with or without a connection: offline, it's kept on the device, encrypted, and uploads when the connection is back. They stay yours alone until you share them. |
| Team and groups | The Team page: who at your company uses Alcove (the directory, or the colleagues at your work address you meet with), when you last had a call with each, and Invite for the rest. Groups you make there (or from the side panel) invite a whole group to a call, or share notes with all of them, in one step; only you see them. |
| Notes | Summary, decisions, open questions, follow-ups, chapters and the transcript. Decisions stay proposed until people confirm them, and a follow-up is a suggestion until the person it's for takes it on, each with what was said behind it. Questions are answered from the call only, citing the moments they come from, and questions across all your notes, answered from those notes only, citing the notes and moments. |
| Your own notes | Beside the shared notes, in the call and on the note: what you write for yourself, moments you bookmark, and answers you keep. Only you read them, the organizer included, and every note and AI surface says who it's for before you write. Add something to the shared notes when you choose: you see exactly what goes and who reads it first, and you can take it back. |
| Series | Calls that follow on from each other, from a recurring calendar event or by scheduling the next one. Before the next call, Home shows what earlier ones decided, left open and handed out, each with where it was said, and anyone can ask across the calls. Everyone sees only the calls whose notes they have. |
| Notifications | While Alcove is open in a tab, the browser tells you a call you organize starts in 1 or 5 minutes, notes are ready, someone shared notes with you, someone asks for notes in your call, or it's a follow-up's due day, at 9:00. Each has its switch in Settings; they show only on that device, from one tab, each once. |
| Privacy | Content is encrypted before it's stored, under keys for each account. The server holds those keys, wrapped under one master key, so the promise that Alcove can't read notes depends on releasing that key only to attested confidential compute. Speech and transcripts go to private inference (NEAR AI Cloud) to be transcribed and written up. Deleting your account deletes everything it owns, the notes you organized for everyone, and takes you off notes other people gave you. |
| Credits | Calls without notes are free. Notes and room recordings use credits (25 a minute); new accounts start with 10,000. Settings shows the minutes of notes used this month. |

## Status of this build

| Area | State |
| --- | --- |
| Sign-in with Google | Working: OpenID Connect with PKCE, accepting only email addresses Google has verified |
| Sign-in with Microsoft and SSO | Stand-ins: Microsoft signs in a demo person (Art Vandelay); SSO signs in whoever's email is typed, unverified, so it takes only example addresses |
| Calendar | Google Calendar for Google accounts: the next meeting, the rest of today's and the next 7 days' on Home (unless other meetings are switched off), scheduled calls on the calendar with Google's invitations, changes and cancellations kept in step, and an organizer's own event made an Alcove call. Demo accounts get a sample day of calls when nothing is upcoming |
| Team | Stand-in directory for `vandelay.industries` accounts. Other work accounts see the colleagues at their email domain they have met on Alcove calls or calendar events; personal domains have no team. Inviting someone opens your own email with the invitation and marks them invited; Alcove sends no email itself |
| Scheduling and instant calls | Working. Alcove sends no emails of its own; invitations come from Google Calendar when it's connected. Calls started now don't go on the calendar |
| Calls with real camera, microphone, screen sharing, chat | Working for groups on LiveKit, end-to-end encrypted (MLS): invited people join with their accounts, anyone else with the link asks and the organizer lets them in. The live transcript and notes hear everyone the organizer hears, each line under who said it |
| Notes recording (encrypted audio pieces, playback) | Working: one recording of everyone the organizer hears, so a line plays back with its speaker's voice |
| Recording without a connection | Working on the stage recorder: kept in the browser, sealed with a key made there, uploaded in order once the connection is back (also after the tab closes), and the app opens offline for someone signed in on that browser. Calls need a connection |
| Live transcript (NEAR AI) | Working while notes are on, in calls and room recordings. Call lines name whoever said them, from everyone the organizer hears; room recordings don't say who spoke. What it isn't sure of (words hard to hear, a name heard on two microphones) is marked, and a written note's transcript can be corrected, by the organizer and by the people who spoke |
| Written notes and questions (NEAR AI) | Working: summary, decisions, open questions, follow-ups, chapters and suggested questions, written when the recording stops; answers cite moments in the recording. Questions across all your notes are answered from up to 12 that share the most words with them, citing each note and moment, and say so without asking a model when no note is written yet. If the notes service fails three times, the note keeps its transcript and audio without a summary. Each model's hardware evidence is checked first and everything sent is sealed to the key it vouches for; the note says which verified models wrote it and what was checked |
| Series | Working on Home, the notes and the series page: recurring Google events held in Alcove and calls scheduled as the next one. Not in the call or at pre-join yet |
| Notes for everyone invited, sharing by email | Working |
| Notes from shared screens | Working: frames from the presenter's own browser, sealed, read by the verified notes model after the call, linked to the transcript and referred to by the notes and answers. Catch-up during the call doesn't read screens yet |
| Browser notifications | Working while Alcove is open in a tab, shown through the app's service worker. Nothing is pushed when no tab is open |
| Credits and payments | Notes are charged 25 credits a minute when they're written; nothing checks the balance first, and USDC top-ups aren't connected |
| Confidential compute (TEE, attestation, master key release) | Required before real users; see [Privacy › Production requirements](../engineering/privacy-keys-and-sessions.md#production-requirements) |
