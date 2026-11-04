# Roadmap

[Docs home](../README.md)

## Done

- Monorepo, design system, web app: sign-in, Home with the day's calls, the one-line call composer, pre-join,
  the full-screen call, notes, the room recorder and account.
- API with encrypted vault, account keys wrapped under `KMASTER` and opened per request, sessions in Postgres,
  meetings, single-participant calls with real camera, mic and screen sharing, chat, encrypted notes
  recordings in calls and in the room, playback, notes for everyone invited, sharing by email, people search
  and credits display.
- Real Google sign-in (OpenID Connect with PKCE, verified emails only) and Google Calendar: the coming week's
  meetings on Home, scheduled calls on the organizer's calendar with Google's invitations, changes and
  cancellations kept in step, and an organizer's own event made an Alcove call.
- Live transcript and written notes with NEAR AI Cloud: Whisper transcribes speech while notes are on; when
  the recording stops, a notes worker writes the summary, decisions, open questions, follow-ups, chapters and
  suggested questions, retries a failed attempt twice, and charges 25 credits a minute; anyone with the note
  can ask about the call ([Notes and inference](../engineering/notes-and-inference.md)).
- Verified private inference: before anything with content goes to NEAR AI, each model's Intel TDX quote,
  OS image (a published dstack image, measured exactly), measurements and NVIDIA GPU verdict are checked
  against a fresh nonce; speech and transcripts go by Oblivious HTTP sealed to the models' attested keys, at
  their own endpoints; notes wait through a verification outage; each note shows which verified models wrote
  it and what was checked ([Verified private inference](../engineering/notes-and-inference.md#verified-private-inference)).
- Memory across a series: the occurrences of a recurring Google event held in Alcove, and calls scheduled as
  the next one, carry confirmed decisions, open questions and follow-ups into the next call, on Home and a
  series page, each with its call and moment, and people can ask across the calls. Everyone sees only the
  calls whose notes they have ([Notes and inference › Series](../engineering/notes-and-inference.md#series)).
- What a call captures, for everyone: recording, transcript, AI notes and shared screens, each on, paused or
  off with who changed it and when, in the call and before joining; one pause that stops every kind of capture
  on the server; asking the organizer for notes; and the gaps marked in the transcript, catch-up and notes
  ([Calls and recordings › What's captured](../engineering/calls-and-recordings.md#whats-captured)).
- Notes from shared screens: the organizer has shared screens read; each presenter's own browser sends what
  changes on its share, sealed; the verified notes model reads each frame after the call; the note shows what
  was on screen beside the lines said then, and decisions, follow-ups and answers point at it
  ([Calls and recordings › Shared screens](../engineering/calls-and-recordings.md#shared-screens)).
- Breakout rooms with their own end-to-end encryption: each room is its own MLS group, so its own media keys
  and chat; moving someone between rooms moves their keys; what's said in a room shows only there (transcript,
  captions, catching up) and is deleted when it closes; and each room has its own capture state, which the
  organizer can pause ([Calls and recordings › End-to-end encryption](../engineering/calls-and-recordings.md#end-to-end-encryption)).
- Catching up during a call, for the person asking alone: what they missed while away or before they joined,
  or any stretch of the call, sorted into decided, proposed, open and next, each point with the transcript moments
  it came from (only real lines), saying what it couldn't have heard and as of when, with Back to live. In a
  breakout room it reads the room's lines; guests with the link read only what was said while they were there.
  Nothing is kept ([Notes and inference › Catching up during a call](../engineering/notes-and-inference.md#catching-up-during-a-call)).
- Stand-ins for Microsoft and SSO sign-in, the sample calendar and the company directory
  (`apps/api/src/demo.ts`).
- Privacy hardening: per-request key copies, keyed hashes instead of stored names and addresses, physical
  deletion with object GC, session sweeping, origin and content-type checks, rate limits.
- Structured logging, an error hierarchy and request IDs from the browser to the server log.
- Joining by link without an account: the pre-join says who you're joining, whether notes are on and who gets
  them; guests ask with a name, people signed in are added to the invite when the organizer lets them in, and
  every failure has its own screen with a request reference
  ([Calls and recordings › The join page](../engineering/calls-and-recordings.md#the-join-page)).
- Ready for confidential compute: nothing third-party loads in the browser, logs are scrubbed so they can
  leave a VM, and with `TEE=dstack` the API takes its keys from dstack's key service and attests to its
  build with a nonce ([Privacy › Moving to confidential computing](../engineering/privacy-keys-and-sessions.md#moving-to-confidential-computing)).
- CI with merge-blocking checks; deploy pipeline and GCP bootstrap, first deployed on 3 November 2026
  ([deployment plan](../superpowers/plans/2026-11-03-alcove-deployment.md)); release acceptance is still open.

## Next

| # | Work | Notes |
| --- | --- | --- |
| 1 | Host hand-off when the organizer drops (#30) | Group calls are end-to-end encrypted with MLS already: [Calls and recordings](../engineering/calls-and-recordings.md#end-to-end-encryption) |
| 2 | Real Microsoft and SSO sign-in, with their calendars and company directories | Replaces `apps/api/src/demo.ts`; shared notes depend on verified emails |
| 3 | Invitation emails (SMTP) | For organizers without a connected calendar, and for people notes are shared with |
| 4 | Release acceptance in the deployed environment | [Deployment and acceptance](../engineering/deployment-and-acceptance.md); public journeys, private storage and deletion |
| 5 | Deploy the API to a dstack VM on Phala Cloud, bind TLS to the attestation, check it in the client, and pin the client | [Moving to confidential computing](../engineering/privacy-keys-and-sessions.md#moving-to-confidential-computing) |
| 6 | Credit purchases (1Click) and admission before recording | [Payments and usage](../engineering/payments-and-usage.md) |
| 7 | Pin the model code NEAR AI runs | Check what its compose manager starts against deployments with published provenance; bind the GPU evidence and the model's name to the VM; [Notes and inference › What's left](../engineering/notes-and-inference.md#whats-left) |
| 8 | Speaker diarization for room recordings | Room transcripts name nobody today |
| 9 | Remaining review items | Strict JSON parsing, rollback detection (version-bound associated data, encrypted piece manifest), billing account IDs, key rotation, account deletion |
| 10 | A series during the call and at pre-join | What carries over, and asking across the series, once group calls land; [Notes and inference › What's left](../engineering/notes-and-inference.md#whats-left) |
| 11 | A breakout room's own notes, for the people who were in it; each room committed by one of its own members | What's said in a room is shown live there and kept out of the call's notes today; a room's own committer builds on host hand-off (#30) |
