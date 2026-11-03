# Roadmap

[Docs home](../README.md)

## Done

- Monorepo, design system, web app: sign-in, Home with the day's calls, the one-line call composer, pre-join,
  the full-screen call, notes, the room recorder and account.
- API with encrypted vault, account keys wrapped under `KMASTER` and opened per request, sessions in Postgres,
  meetings, single-participant calls with real camera, mic and screen sharing, chat, encrypted notes
  recordings in calls and in the room, playback, notes for everyone invited, sharing by email, people search
  and credits display.
- Stand-ins for Google, Microsoft and SSO sign-in, the calendar and the company directory
  (`apps/api/src/demo.ts`).
- Privacy hardening: per-request key copies, keyed hashes instead of stored names and addresses, physical
  deletion with object GC, session sweeping, origin and content-type checks, rate limits.
- Structured logging, an error hierarchy and request IDs from the browser to the server log.
- CI with merge-blocking checks; deploy pipeline and GCP bootstrap prepared (inactive until infrastructure exists).

## Next

| # | Work | Notes |
| --- | --- | --- |
| 1 | Notes worker with NEAR AI: transcription, structured notes, charging | [Notes and inference](../engineering/notes-and-inference.md) |
| 2 | Multi-party end-to-end encrypted calls with LiveKit | Proton Meet model; [Calls and recordings](../engineering/calls-and-recordings.md#next-multi-party-calls) |
| 3 | Real sign-in: Google and Microsoft OAuth, OIDC SSO, with calendar sync and company directories | Replaces `apps/api/src/demo.ts`; shared notes depend on verified emails |
| 4 | Invitation emails (SMTP) | Invited people hear about calls and notes without signing in first |
| 5 | Production infrastructure and first deploy | [infra/README.md](../../infra/README.md); apply the ruleset |
| 6 | Confidential compute with attestation, `KMASTER` released only to the attested VM, and a pinned client | [Production requirements](../engineering/privacy-keys-and-sessions.md#production-requirements) |
| 7 | Credit purchases (1Click) and admission/settlement | [Payments and usage](../engineering/payments-and-usage.md) |
| 8 | Remaining review items | Strict JSON parsing, rollback detection (version-bound associated data, encrypted piece manifest), billing account IDs, key rotation, account deletion |
| 9 | Notes from shared screens (stretch) | Sample frames inside the attested service; Scribe autocapture as a reference |
