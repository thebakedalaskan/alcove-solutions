# Notes and inference

[Docs home](../README.md) · [Calls and recordings](calls-and-recordings.md) · [Payments and usage](payments-and-usage.md)

## Status

The recording side is complete: encrypted audio is stored per note and plays back. Transcription and note
writing are not wired yet. The NEAR AI key is configured (`NEAR_AI_API_KEY`, reported by `/healthz` as
`inference: configured`) and isolated in `apps/api/src/inference.ts`; no code path sends audio or text to it.

## Note states

| Status | Meaning |
| --- | --- |
| `recording` | Audio is still arriving (call in progress or room recording running) |
| `pending` | Recording finished; a `content_jobs` row with kind `notes`, state `awaiting_inference` exists |
| `ready` | Summary, decisions, action items, chapters (and transcript if kept) written into a new revision |

The note page shows `pending` notes honestly ("Waiting for the notes service") with playback of each
decrypted segment. Asking questions returns `503 unavailable` until notes are written.

## Planned pipeline

1. A worker claims an `awaiting_inference` job with a row lock and lease (`lease_until`, `attempt` ≤ 3).
2. Inside the trusted process, it opens the recording key, decrypts pieces segment by segment, and sends
   audio to NEAR AI speech-to-text using its end-to-end encrypted request mode.
3. It sends the transcript to a NEAR AI model with a fixed prompt that returns structured JSON (summary,
   decisions, action items with owners and dates, chapters with timestamps) validated against `NoteSchema`.
4. It writes one new note revision. If the note's `keep` is `notes`, the transcript is not stored and the
   recording pieces are deleted after the revision commits.
5. It charges credits (25 per recorded minute) through the billing module and marks the job done.

Prompts, model IDs and NEAR AI request formats will be pinned in this document when implemented.
