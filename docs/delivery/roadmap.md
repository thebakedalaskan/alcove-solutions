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
  the recording stops, a notes worker writes the summary, decisions, follow-ups, chapters and suggested
  questions, retries a failed attempt twice, and charges 25 credits a minute; anyone with the note can ask
  about the call ([Notes and inference](../engineering/notes-and-inference.md)).
- Stand-ins for Microsoft and SSO sign-in, the sample calendar and the company directory
  (`apps/api/src/demo.ts`).
- Privacy hardening: per-request key copies, keyed hashes instead of stored names and addresses, physical
  deletion with object GC, session sweeping, origin and content-type checks, rate limits.
- Structured logging, an error hierarchy and request IDs from the browser to the server log.
- Ready for confidential compute: nothing third-party loads in the browser, logs are scrubbed so they can
  leave a VM, and with `TEE=dstack` the API takes its keys from dstack's key service and attests to its
  build with a nonce ([Privacy › Moving to confidential computing](../engineering/privacy-keys-and-sessions.md#moving-to-confidential-computing)).
- CI with merge-blocking checks; deploy pipeline and GCP bootstrap, first deployed on 3 November 2026
  ([deployment plan](../superpowers/plans/2026-11-03-alcove-deployment.md)); release acceptance is still open.

## Next

| # | Work | Notes |
| --- | --- | --- |
| 1 | Verified private inference: NEAR AI's end-to-end encrypted requests and attestation checks | [Notes and inference › What's left](../engineering/notes-and-inference.md#whats-left) |
| 2 | End-to-end encryption for group calls (LiveKit carries them unencrypted today), then a relay inside the confidential VM so LiveKit doesn't see who's calling | Call key from the API first, MLS later; the transcriber joins inside the VM; transcript lines per speaker; [Calls and recordings](../engineering/calls-and-recordings.md#next-end-to-end-encrypted-calls) |
| 3 | Real Microsoft and SSO sign-in, with their calendars and company directories | Replaces `apps/api/src/demo.ts`; shared notes depend on verified emails |
| 4 | Invitation emails (SMTP) | For organizers without a connected calendar, and for people notes are shared with |
| 5 | Release acceptance in the deployed environment | [Deployment and acceptance](../engineering/deployment-and-acceptance.md); public journeys, private storage and deletion |
| 6 | Deploy the API to a dstack VM on Phala Cloud, bind TLS to the attestation, check it in the client, and pin the client | [Moving to confidential computing](../engineering/privacy-keys-and-sessions.md#moving-to-confidential-computing) |
| 7 | Credit purchases (1Click) and admission before recording | [Payments and usage](../engineering/payments-and-usage.md) |
| 8 | Speaker diarization for room recordings | Room transcripts name nobody today |
| 9 | Remaining review items | Strict JSON parsing, rollback detection (version-bound associated data, encrypted piece manifest), billing account IDs, key rotation, account deletion |
| 10 | Notes from shared screens (stretch) | Sample frames inside the attested service; Scribe autocapture as a reference |
