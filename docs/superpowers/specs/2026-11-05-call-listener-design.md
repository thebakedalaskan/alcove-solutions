# Call listener: design

Status: being built on `feat/listener`, 6 November 2026. Plan: [2026-11-05-call-listener.md](../plans/2026-11-05-call-listener.md).
Durable intake (item 1 below) is shelved on `shelf/durable-clips`: the listener retries what it sends itself. Dispatch is
LiveKit's (D6), not polling.

## Why

Today one browser hears each part of a call for the notes: the host's for the main room, a "scribe" person's for each
breakout room (`CallEars`, `apps/web/src/features/call/speech.ts`). The server only transcribes and summarizes what that
browser sends. So the notes lose speech when:

- the host's (or a room scribe's) browser drops, reloads or has a weak uplink: what it held is lost, and nobody hears
  until a stand-in takes over (10 s), or the call ends (25 s) when nobody can;
- the host is in a breakout room: nobody hears the main room;
- Whisper (NEAR AI) is slow or down: a clip that fails three times is thrown away, and after two in a row the browser
  skips 20 s of speech. A clip is durable only once Whisper has answered.

The summary itself is already safe: `writer.ts` is a leased, retried job.

## What we build

1. **Durable intake.** A clip is stored (sealed, in the object store, with a queued row) the moment it reaches the API,
   and the request answers straight away. A transcribe worker inside the API process claims queued clips with leases,
   as the notes worker claims notes, and waits out NEAR AI outages instead of dropping clips. The notes job waits for a
   note's queue to empty before moving its transcript into the note.
2. **A listener service** (`apps/listener`, `@alcove/listener`): a long-running Node process that joins calls as a
   hidden participant through LiveKit (`@livekit/rtc-node`), is a member of the part's MLS group like any browser
   (through `@alcove/api-http`, whose call session already runs in Node in the tests), decrypts each person's
   microphone, cuts clips with the same logic browsers use today, and sends them to the same transcribe route.
3. **Listening tasks with two seats.** The API keeps one task per part of a call while notes are on (the main room,
   each open breakout room). Each task has two seats, held by two different listener processes. One seat is active and
   sends; the other is a standby that hears the same audio, keeps the last minute, and sends nothing.
4. **Fencing and watermarks.** Each task has a term. Only clips carrying the current term are taken. The API keeps,
   per task and speaker, how far it has heard (a watermark on the server's clock). When the active seat's lease runs
   out, the standby is promoted to the next term and resends from the watermarks out of its buffer, so nothing is lost
   and nothing is counted twice.
5. **The listener records the call** (the mixed audio the note plays back), instead of the host's browser, so a
   host's connection no longer matters for capture at all.
6. **Trust.** A listener holds the call's media keys, so browsers only admit one that proves (TDX quote, dstack) it
   runs the published listener build. Until that check exists, listeners only run in development and tests.

## Decisions

| | Decision | Why |
|---|---|---|
| D1 | Listener is Node + `@livekit/rtc-node` + `@alcove/api-http` | Tests already join encrypted calls this way; reuses the MLS client and the contract as is. |
| D2 | `pnpm patch` rtc-node so `KeyProvider.setKey` takes the key bytes | Browsers encrypt with one key per sender (`sharedKey: false`). The native `SetKeyRequest` has a `key` field; rtc-node 1.2.1's wrapper drops it. Offer the patch upstream. |
| D3 | The listener talks only to the API, never to Postgres or the object store, and never holds `KMASTER` | It needs nothing but a call pass. Keys and sealing stay in the API. |
| D4 | A new participant role, `listener`, in the call's sealed state | It's admitted to MLS groups like a person but never shown as a tile, never hosts, never commits, never asks for notes. |
| D5 | Tasks are created and deleted by the call's own changes (notes on/off, rooms open/close, call end). Pausing keeps the task; the listener holds what it hears, as browsers do | Rejoining takes seconds; a pause shouldn't lose the room. |
| D6 | Dispatch: the API asks LiveKit to dispatch a worker registered as `alcove-listener` (restart policy `JRP_NEVER`); LiveKit pushes the job to a registered listener process, which joins with a one-time invite from the dispatch plus the service key. The API sends another when a listener doesn't join within 10 s or LiveKit's `participant_left` says it left (a sweep every 5 s, row locks with `SKIP LOCKED`). The thin worker speaks LiveKit's agent protocol; LiveKit's agents framework isn't used | Push in ~200 ms, load-aware, nothing polls. LiveKit's own server never re-dispatches (Cloud does unless told not to), so recovery is ours, the same in Cloud, dev and CI. The framework is 281 MB of AI tooling the listener doesn't need. |
| D7 | Every listener clip is placed by the server's clock (`began`), as breakout room clips already are | Two listeners agree on server time, not on each other's local timelines. |
| D8 | The clip cutter moves into `packages/speech` (`@alcove/speech`): frames in, clips out, no WebAudio | Browser room recorder and listener share one cutter. |
| D9 | Recording: the active seat mixes everyone (rtc-node `AudioMixer`) and encodes Ogg/Opus pieces; a promotion starts a new segment from the audio watermark | The API already takes Ogg pieces; Ogg streams from two encoders don't concatenate, segments already exist for that. |
| D10 | Breakout rooms get their own task; rooms still aren't recorded | Same as today, minus the scribe browser. |
| D11 | The host's browser still commits MLS. A new generation after a hand-off re-adds the listeners | Making the listener the committer would let it decide who's in the call. |
| D12 | Trust: the listener's MLS key package carries a TDX quote over its signing key; the host's browser verifies it with `@phala/dcap-qvl` (already used in `evidence.ts`) against Intel collateral the API relays, and pinned listener compose hashes | Without it, anyone running the service could add a "listener" and hear calls. |

## Numbers

| Name | Value |
|---|---|
| `LISTEN_HEARTBEAT_MS` | 3,000 |
| `LISTEN_LEASE_MS` | 10,000 |
| `LISTEN_BUFFER_MS` | 60,000 (a standby's ring, per speaker) |
| `LISTEN_CLAIM_POLL_MS` | 1,000 |
| `LISTENER_SEATS` (per process, default) | 40 |
| Transcribe worker | 3 attempts, 60 s lease, retries 5 s and 30 s after a failure; NEAR AI unverified or unanswering waits 60 s without using an attempt |
| Notes job waiting for a note's clips | up to 15 minutes, then writes with what's transcribed |

## What goes away

- `CallEars` and the call's use of `NotesRecorder` in the browser; `setUnavailable` and the `unavailable` parts the host's
  browser reports; host-only `/audio` and `/transcribe`; `mainScribeOf`; `modules/scribes.ts` and room scribe terms
  (the stored field stays readable: zod ignores it); a hand-off starting a new segment; the host-`offline` gap.
- Presenters' browsers sending shared-screen frames, if phase 5 is done.

## New gaps

Notes on, but no active listener seat for that part of the call (both seats lost, or the pool full). It keeps the
stored gap kind `offline` (`CaptureGapSchema`), which notes already hold, so nothing stored changes shape and the
previous release still reads it; only its meaning and words change ("Nobody was listening 10:20–10:21"). The notes
model is told never to guess what was said in it, as for every gap.

## Stored data

- `0011_speech_clips.sql`: the intake queue.
- `0012_listening.sql`: tasks, seats, watermarks.
- Sealed call state: `role: 'listener'` on a person, and `listening` terms per part (when each term was active). Both
  are additions with defaults. The previous release must parse `listener` before any release writes it, so the contract
  change ships to main on its own first (phase 1).
- Clip audio in the object store is a new record kind (`speech-clip`) with its own header and a canary in the leakage
  test; it's deleted once transcribed.

## Rollout

- Phase 1 (durable intake and the `listener` role in the contract) merges to main and deploys on its own.
- Phases 2 to 4 live on one branch, `feat/listener`, and merge together. Merging the listener without phase 4 would
  let the operator add listeners to production calls.
- Phase 5 (screens) follows separately.

## Open questions

1. Ogg/Opus encoder for Node (D9): a WASM encoder (no native build in the TEE image) vs. `ffmpeg`. Task 12 starts with a spike.
2. Production host for the pool before the API itself is in a TEE: none. Listeners go to production only on dstack (Phala), with phase 4.
3. Pool size to start: 3 processes, 40 seats each.
