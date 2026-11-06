# Listener dispatch (hybrid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Listeners reach calls by LiveKit's push dispatch instead of polling our API, and our API makes sure every part of a call with notes on has one, says plainly when it doesn't, and records the gap.

**Architecture:** When a part of a call needs hearing, the API asks LiveKit to dispatch an `alcove-listener` (`createDispatch`, restart policy `JRP_NEVER`, so recovery is ours in Cloud, dev and CI alike). LiveKit pushes the job to one of our registered workers (`apps/listener`: a small worker on LiveKit's agent protocol, not their framework), which joins through our API with a one-time invite from the dispatch's metadata plus the service key. LiveKit's `participant_joined` / `participant_left` webhooks tell the API when the listener arrives and leaves, and are trusted as the truth for now; a sweep every few seconds re-dispatches any part of a call whose listener never arrived within 10 seconds, or left.

**Tech Stack:** TypeScript (strict), Hono, Postgres, `livekit-server-sdk` 2.19 (`AgentDispatchClient`), `@livekit/protocol` (agent worker messages), `ws`, `@livekit/rtc-node` 1.2.1 (pinned), Vitest integration tests against real LiveKit.

**Spec:** `docs/superpowers/specs/2026-11-05-call-listener-design.md`. Its D6 (polling) is superseded by this plan; Task 4 updates the spec to match.

## Where things stand (branch `feat/listener`)

Done and committed: the `listener` role; per-person keys (`setParticipantKey`); `@alcove/speech`; `apps/listener`'s `listen()` (hears, cuts, sends, retries); `listen_tasks` (ended, never deleted, swept after 7 days); `calls.listenerJoin`; the transcribe gate for the task's holder; placement by the server's clock. This plan replaces the claim and beat routes, `runListener`'s polling loop and the lease columns.

What it rests on (measured on self-hosted LiveKit 1.13.11, and read in LiveKit's server code):
- Dispatch reaches a registered worker in ~200–250 ms.
- A dispatch made while no worker is registered is dropped, not queued.
- Open-source LiveKit never re-dispatches after a worker dies (`restart_policy` is Cloud-only); Cloud does unless told `JRP_NEVER`.
- Deleting a dispatch doesn't tell the worker.
- LiveKit drops a killed worker's participant ~21 s later, which is when `participant_left` fires.

## Global Constraints

- Everything in `AGENTS.md`: no `any`, no `as` (except `as const`), no `!`, no suppressions; zod at every boundary; `log.child({ component })`, IDs and counts only; `AppError` subclasses with `context`.
- Integration tests only (`*.integration.test.ts`): real API, Postgres, object store and LiveKit. This worktree runs them with `.superpowers/sdd/2026-11-05-call-listener/t.sh` (its own test database).
- No backwards compatibility on the branch: what's replaced is deleted in the same task, with its tests and docs.
- `0012_listening.sql` is unmerged and may change in place.
- Agent name: config `LISTENER_AGENT`, default `alcove-listener`. Dispatch restart policy `JRP_NEVER`.
- Constants in `apps/api/src/modules/listening.ts`: `ARRIVE_WITHIN_MS = 10_000`, `SUPERVISE_EVERY_MS = 5_000`, `INVITE_TTL_MS = 60_000`.
- LiveKit's webhooks are the truth about who's in a room: nothing asks LiveKit for a room's participants (a lost `participant_left` is a known gap, closed later: see Later).
- The listener joins only with the dispatch's invite **and** `LISTENER_KEY`: LiveKit (Cloud's operator included) sees dispatch metadata, so an invite alone must never let anyone in. Attestation, a later step, replaces the key.
- Commits: agents commit unsigned (`git -c commit.gpgsign=false commit`); the user re-signs the branch later. Never push.

## Review Focus

1. **The listener's `participant_joined` arrives after its `participant_left`, or twice** (LiveKit retries webhooks): `left_at` set once stays set until the next dispatch, and a late `joined` for an old holder changes nothing. → test in Task 2.
2. **Two API instances sweep at once:** a part of a call gets one new dispatch, not two. → test in Task 2.
3. **The old listener comes back after a new one was dispatched** (a network blip, not a crash): its clips are refused once it isn't the holder. → test in Task 2.
4. **Notes paused:** the task and the listener stay, and the call says paused, not "nothing is being transcribed". → test in Task 3.
5. **An invite used twice, expired, or without `LISTENER_KEY`:** refused, and nobody is let into the call. → test in Task 1.

---

### Task 1: LiveKit dispatches the listener; polling goes

**Files:**
- Modify: `apps/api/migrations/0012_listening.sql`: drop `lease_until`, `claims`, `first_claimed_at` and the `listen_tasks_free` use; add `dispatches int NOT NULL DEFAULT 0`, `dispatched_at timestamptz`, `invite_id text`, `joined_at timestamptz`, `left_at timestamptz` (`holder` stays: the listener's call identity).
- Modify: `apps/api/src/modules/listening.ts`, `apps/api/src/livekit.ts`, `apps/api/src/callPass.ts`, `apps/api/src/app.ts`, `apps/api/src/config.ts` (`LISTENER_AGENT`), `apps/api/src/modules/calls.ts` (dispatch after the saving transaction commits)
- Modify: `packages/api/src/{wire,live,client}.ts`, `packages/api-http/src/index.ts`
- Modify: `apps/listener/src/index.ts` (`serveDispatch` replaces `runListener`), `apps/listener/package.json` (`@livekit/protocol`, `livekit-server-sdk`, `ws`)
- Test: `apps/api/src/listener.integration.test.ts`

**Interfaces:**
- Produces: `listening.dispatch(d: Deps, o: Owner, task: { taskId: string; callId: string; roomName: string }): Promise<void>`. Mints an invite, sets `invite_id`, `dispatched_at = now()`, `dispatches + 1`, clears `holder`, `joined_at`, `left_at`, then `d.livekit.dispatch(roomName, cfg.LISTENER_AGENT, JSON.stringify({ invite }))`. Logs `listener dispatched` `{ callId, taskId, dispatches }`. A LiveKit error is logged (warn) and left to the sweep.
- Produces: `LiveKit.dispatch(roomName: string, agentName: string, metadata: string): Promise<void>` (`AgentDispatchClient.createDispatch`, `restartPolicy: JobRestartPolicy.JRP_NEVER`).
- Produces in `callPass.ts`: `issueInvite(cfg: Config, i: { ownerId: string; callId: string; taskId: string; inviteId: string; exp: number }): string` and `readInvite(cfg: Config, token: string | undefined): Invite | undefined`, sealed like the call pass under its own key label `alcove/listener-invite/v1`; `exp` is `Date.now() + INVITE_TTL_MS`.
- Produces: `POST /v1/listeners/join`, bearer `LISTENER_KEY`, body `ListenerJoinBodySchema = { invite: string (max 2000), identity: CallIdentity, keyPackage: Mls(8192) }` → `ListenerJoinedSchema = { place, ticket, state }`. It takes the invite once: `UPDATE listen_tasks SET invite_id = NULL, holder = $identity WHERE owner_id = … AND task_id = … AND invite_id = … AND ended_at IS NULL` must touch one row, or `409 conflict`; then `calls.listenerJoin`.
- Produces: `ListenerApi = { join(invite: string): Promise<{ place: string; session: CallSession }> }` from `createListenerApi`, replacing `claim` and `beat`.
- Produces: `serveDispatch(o: { livekitUrl: string; apiKey: string; apiSecret: string; api: ListenerApi; agentName: string; seats?: number; keyIndex?: (epoch: number) => number; log?: ListenerLog }): { hearing(): number; stop(): Promise<void> }`. Registers on `<livekitUrl>/agent` (JWT with the `agent` grant), reports `WS_AVAILABLE` / `WS_FULL` by `hearing() < seats` every 2.5 s, accepts offered jobs while it has a seat, and on assignment reads `invite` from the job's metadata, `api.join(invite)`, waits to be let in, then `listen()`. It leaves when its own `CallState` says notes are off (`capture.mode === 'off'`) or the call ended. It reconnects to LiveKit with backoff if the socket drops.
- `listening.holds(o, db, callId, place, holder)`: the open task's `holder` is `holder` and `left_at IS NULL`.
- Removes: `runListener`, `listening.claim / later / renew`, `LISTEN_LEASE_SECONDS`, `/v1/listeners/claim`, `/v1/listeners/beat`, `ListenerClaimSchema`, `ListenerClaimBodySchema`, `ListenerBeatSchema`, `ListenerBeatBodySchema`.

- [ ] **Step 1: Rewrite the failing tests** in `listener.integration.test.ts` (the harness sets `LISTENER_AGENT` to a value unique to the run, so workers on the shared LiveKit never take another run's jobs):
  - `it('is dispatched by LiveKit when notes go on, joins without anyone asking, and hears everyone under their own names')`: a `serveDispatch` worker; a call with notes on and Kofi in; within 5 s `worker.hearing() === 1`; both tone lines arrive under the right names (as the current test checks); notes off → `hearing() === 0` within 10 s; the task's history: `{ place: 'main', dispatches: 1, ended_why: 'notes-off' }` with `joined_at` set.
  - `it('lets nobody in with an invite used twice, expired, or without the listener key')`: notes on with no worker (the dispatch is dropped, the task keeps its `invite_id`); mint the invite with `issueInvite(h.deps.cfg, …)` from the task's row; join → 200; the same invite again → 409; one with `exp` in the past → 401; the right invite with a wrong bearer → 401; the call's MLS log gained one key package, the first join's.
- [ ] **Step 2: Run** `.superpowers/sdd/2026-11-05-call-listener/t.sh src/listener.integration.test.ts` → FAIL (`serveDispatch` isn't exported).
- [ ] **Step 3: Implement.** `listening.follow` returns the task it opened (or none); `save`'s callers that can open one dispatch it once their transaction has committed. Ending a task needs no LiveKit call: the listener sees the end in its call state.
- [ ] **Step 4: Run** the listener tests, then `t.sh` (the whole suite) → PASS; `pnpm typecheck` → exit 0.
- [ ] **Step 5: Commit**: `feat(listener): LiveKit dispatches the listener to calls with notes on; no more polling`.

### Task 2: The API keeps a listener in every call that needs one

**Files:**
- Modify: `apps/api/src/modules/listening.ts` (`arrived`, `left`, `supervise`), `apps/api/src/modules/calls.ts` (`onRoomEvent`: the holder joining and leaving), `apps/api/src/server.ts` (run `supervise` every `SUPERVISE_EVERY_MS`, `unref`'d, stopped on shutdown), `apps/api/src/testing/harness.ts` (the same interval for test servers)
- Create: `apps/api/src/testing/workers.ts` (spawns a `serveDispatch` worker in a child process, so a test can `SIGKILL` it)
- Test: `apps/api/src/listener.integration.test.ts`

**Interfaces:**
- Produces: `listening.arrived(d: Deps, ownerId: string, callId: string, identity: string): Promise<void>` sets `joined_at` where `holder = identity` on the open task. `listening.left(d: Deps, ownerId: string, callId: string, identity: string): Promise<void>` sets `left_at`, then re-dispatches that task at once.
- Produces: `listening.supervise(d: Deps): Promise<number>`. Takes, with `FOR UPDATE SKIP LOCKED`, the open tasks of live calls that need a listener:
  - dispatched more than `ARRIVE_WITHIN_MS` ago with no `joined_at` (`why: 'never-arrived'`);
  - `left_at` set (`why: 'left'`);
  - never dispatched (`why: 'new'`).
  It dispatches each, logs `listener missing; dispatching again` `{ callId, taskId, dispatches, why }`, and returns how many it dispatched.
- `onRoomEvent`: a `participant_joined` / `participant_left` whose identity is an open task's holder calls `arrived` / `left`, with no `LEFT_CHECK_MS` wait: a listener that blipped is replaced, and the holder change refuses its clips. Everyone else is handled as now.

- [ ] **Step 1: Write the failing tests:**
  - `it('sends another listener when the one hearing the call is killed, and what is said after reaches the transcript')`: two workers from `testing/workers.ts`; `SIGKILL` the hearing one; post the signed `participant_left` webhook as LiveKit would (`signWebhook`); within `SUPERVISE_EVERY_MS + 5 s` the other worker hears; a tone spoken after that is in the transcript; the task: `dispatches: 2`.
  - `it('takes a late or repeated webhook about the listener as it was')`: after a replacement, post the old holder's `participant_joined` and the new holder's `participant_joined` twice → the task's `holder`, `joined_at` and `dispatches` don't change, and the new holder's clips are taken.
  - `it('dispatches once a worker is there when none was')`: notes on with no worker; after 3 s `dispatches === 1` and nobody hears; start a worker; within `ARRIVE_WITHIN_MS + SUPERVISE_EVERY_MS + 3 s` it hears.
  - `it('dispatches once when two API instances supervise at the same time')`: a task due; `supervise` on `h.deps` and on a `secondServer`'s deps concurrently → `dispatches` grows by exactly 1.
  - `it('refuses what a replaced listener still sends')`: replace the holder by the webhook path; the old session's `transcribe` → `409 conflict`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `arrived`, `left`, `supervise`, the `onRoomEvent` branch and the intervals.
- [ ] **Step 4: Run** the listener tests and the whole suite → PASS.
- [ ] **Step 5: Commit**: `feat(listener): the API sends another listener whenever a call that needs one has none`.

### Task 3: The call says whether anyone is hearing it, and the note says when nobody was

**Files:**
- Modify: `packages/api/src/live.ts` (`CallState.notes.heard: 'starting' | 'hearing' | 'nobody'`), `apps/api/src/modules/calls.ts` (the view; `s.notes.offline` stretches for time without a listener), `apps/api/src/modules/listening.ts` (`arrived` / `left` / `supervise` open and close the stretch through a function `calls` exports), `apps/web/src/features/call/*` (the notes sign's words), `docs/engineering/calls-and-recordings.md`
- Test: `apps/api/src/listener.integration.test.ts`

**Interfaces:**
- `notes.heard`, while notes are on:
  - `'starting'`: from notes on until the first listener joins, and for `ARRIVE_WITHIN_MS` after a listener leaves;
  - `'hearing'`: while the holder is in;
  - `'nobody'`: once `ARRIVE_WITHIN_MS` has passed with none.
  While paused it keeps its last value, and the web says paused.
- A stretch with no listener in (from when the last one left, or notes went on, until one joined) goes into `s.notes.offline` (the stored `OfflineStretch`), so `capture.gapsOf` makes it an `offline` gap. The gap's words become "Nobody was listening" in the docs and the web's gap label.
- Web: while notes are on, the notes sign reads "Notes starting", "Notes on", or "Nothing is being transcribed" (`caution` tone), from `notes.heard`.

- [ ] **Step 1: Write the failing tests:**
  - `it('says notes are starting until a listener is in, then on')`: notes on, no worker → `heard: 'starting'`; after `ARRIVE_WITHIN_MS` → `'nobody'`; start a worker → `'hearing'`.
  - `it('puts the stretch nobody was listening into the note')`: as above, then end the call → the note's `gaps` has one `offline` gap from notes on to the listener's arrival, within a second either way.
  - `it('keeps the listener while notes are paused, and says paused')`: pause → the task stays open, `hearing() === 1`, `heard` unchanged, `capture.mode === 'paused'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Until the step that stops the browser capturing, the host's browser still sends clips, so `'nobody'` describes the listener only.
- [ ] **Step 4: Run** the whole suite → PASS. The user checks the notes sign by hand in light and dark, on a phone and wide (there are no browser tests).
- [ ] **Step 5: Commit**: `feat(listener): a call says whether anyone is hearing it, and its note says when nobody was`.

### Task 4: Run it in dev, and the docs

**Files:**
- Create: `apps/listener/src/cli.ts`: reads `API_URL`, `LISTENER_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LISTENER_AGENT`, `LISTENER_SEATS` (default 40) with zod; runs `serveDispatch`; stops on SIGTERM and SIGINT.
- Modify: `apps/listener/package.json` (`dev`: `tsx watch --env-file=../../.env src/cli.ts`), `.env.example` (`LISTENER_AGENT`, `LISTENER_SEATS`), `docs/engineering/calls-and-recordings.md` (The listener: dispatch, invite, supervision, status), `docs/superpowers/specs/2026-11-05-call-listener-design.md` (D6 becomes LiveKit dispatch plus our supervision; the durable-intake sections go, since that work is shelved on `shelf/durable-clips`)
- Test: none new; the whole suite and a run by hand.

- [ ] **Step 1:** `pnpm dev` starts the listener beside the API and the web app. With notes on in a call, the API logs `listener dispatched`, and the notes sign goes from "Notes starting" to "Notes on".
- [ ] **Step 2:** `pnpm check` → PASS.
- [ ] **Step 3: Commit**: `feat(listener): runs in dev beside the API; the docs say how it's dispatched and kept`.

## Later (not this plan)

**Hard rule: no listener in production before attestation.** Production gets no deploy step for `apps/listener` and no `LISTENER_KEY` until the host's browser checks a listener's attestation before adding it to the call's group (and the API checks it in place of `LISTENER_KEY`). Until then the API decides alone who is let in as a hidden listener, so a compromised API, or a stolen `LISTENER_KEY` with the LiveKit secret, could hear any call with notes on, locked or not, without anyone in it seeing. Without the key the API sends no listener, so merging this is off in production.

**The listener records the audio too.** Today the host's browser mixes and records the call (MediaRecorder, Opus 32 kbps, pieces to `/audio`, sealed by the API), so while the host is away the recording has a hole even when the listener hears, and the listener's lines from that stretch fall in a stretch the notes call offline. The listener already decrypts every voice: it mixes them, encodes Opus in a WebM or Ogg container (a WASM encoder or ffmpeg), and uploads pieces under the same segment rules, with the same hand-over as transcripts between the host's browser and the listener. Nobody can hear more than today: the API already sees the pieces in the clear. It comes with the browser no longer capturing.

**Next, in order.**

1. **Breakout rooms.** A task for each open room, its listener placed in that room's group as people are, so room scribes' browsers stop transcribing too. With it, a clip from a part of the call the listener doesn't hold is answered `409`, not `403` (a `403` dismisses the listener, so opening rooms could make it leave).
2. **The listener records the audio too** (above).
3. **A standby listener** for each part of the call, already in its group, so a crash loses nothing in the ~20 s before LiveKit says the first is gone.
4. **The browser stops capturing**, with Task 3: the call says whether anyone is hearing it, and the note marks when nobody was.
5. **Attestation replaces `LISTENER_KEY`**: the host's browser checks a listener's attestation before adding it to the group, and only then leaves it off the screen (in place of `VITE_ALCOVE_LISTENERS`).
6. **Deploying the pool** (Confidential Space), once 5 is in.
7. **A screen-watching agent** (`alcove-screen`) on the same dispatch and supervision.

Not covered yet: a listener that's still asking the API things but can't hear (its keys or the room broke) stays in charge of its part of the call until it leaves.
