# Roadmap

[Docs home](../README.md)

## Done

- Monorepo, design system, web app with passkey-only onboarding and first-day states.
- API with encrypted vault, meetings, single-participant calls with real camera, mic and screen sharing,
  chat, encrypted notes recordings in calls and in the room, playback, account and credits display.
- Privacy review fixes: per-request key copies, step-up for passkey changes, physical deletion with object GC,
  session sweeping, origin and content-type checks, rate limits, server-chosen passkey secrets.
- CI with merge-blocking checks; deploy pipeline and GCP bootstrap prepared (inactive until infrastructure exists).

## Next

| # | Work | Notes |
| --- | --- | --- |
| 1 | Notes worker with NEAR AI: transcription, structured notes, charging | [Notes and inference](../engineering/notes-and-inference.md) |
| 2 | Multi-party end-to-end encrypted calls | Proton Meet model; [Calls and recordings](../engineering/calls-and-recordings.md#next-multi-party-calls) |
| 3 | Email invites and calendar connections | Optional provider sign-in for calendars; passkeys stay the only key |
| 4 | Production infrastructure and first deploy | [infra/README.md](../../infra/README.md); apply the ruleset |
| 5 | Confidential compute with attestation and a pinned client | [Production requirements](../engineering/privacy-keys-and-sessions.md#production-requirements) |
| 6 | Credit purchases (1Click) and admission/settlement | [Payments and usage](../engineering/payments-and-usage.md) |
| 7 | Remaining review items | Strict JSON parsing, rollback detection (version-bound associated data, encrypted piece manifest), billing account IDs, key rotation |
| 8 | Notes from shared screens (stretch) | Sample frames inside the attested service; Scribe autocapture as a reference |
