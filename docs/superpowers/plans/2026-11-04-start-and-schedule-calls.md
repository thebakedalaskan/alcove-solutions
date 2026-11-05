# Starting and scheduling calls: implementation plan

> **For agentic workers:** each task below is one implementer on its own branch and worktree. Read this page, the
> spec, and the sections of the build map your task names. Steps use checkbox syntax for tracking.

**Goal:** replace the one-line composer with the Start a call modal, the organizer's lobby, a three-step scheduler
and the call card, for teams and for individuals, with the backend each of those needs.

**Architecture:** the contract in `packages/api` was written first and is committed: it is the interface between
tasks, so read `types.ts`, `live.ts`, `rings.ts`, `wire.ts` and `client.ts` before anything else. Server tasks fill in
what the contract promises. App tasks build against the contract.

**Tech stack:** TypeScript, Hono, Postgres, zod, React 19, TanStack Router and Query, Tailwind v4, Motion.

**Spec:** `docs/superpowers/specs/2026-11-04-start-and-schedule-calls-design.md`. What each screen says and how it
moves is in the canvas's source (paths in the task briefs): `Proto.dc.html` holds the copy for every state,
`flow.css` the styles, `journeys.js` every journey step by step.

## Global constraints

- `AGENTS.md` applies to every line: integration tests only, strict types (no `any`, no `as` except `as const`, no `!`,
  no suppressions), `log` not `console`, `AppError` subclasses, sealed records, `owner_id` on every query, physical
  deletion, one shape at a time, no fallbacks for an old shape, and every new ID that comes from a request gets a
  cross-owner test.
- Stored data survives: migrations are new files only, additive. Numbers are fixed here: `0004_meeting_access`,
  `0005_call_rings`, `0006_series_items`. Stored schemas get `.default(...)` on added fields. `MeetingInputSchema` and
  `PreferencesSchema` get no defaults (`.partial()` would turn them into changes). `MeetingStatusSchema` isn't widened.
- Keep to the file ownership in your task. If you must touch another task's file, keep the change small and say so in
  your report.
- Nothing readable in a column, URL, log line or error message. New stored data gets a record kind, a header, a row in
  the table in `docs/engineering/privacy-keys-and-sessions.md`, and a canary in a leakage test (add the table to the dump in
  `flows.integration.test.ts`).
- UI copy is plain and says what happens. People are named or "they". `sun` is the only pressable colour, one primary
  per view. `rec` only means notes or recording. No green. No raw hex in the app except on the stage and in
  illustrations. People appear in the arch, never a circle. Every view works in light and dark, on a phone and on a wide
  screen. Reduced motion: every change still happens, at once. No camera outside the join screen and the call. No window
  ever opens over another.
- A team is `q.team()` not null. Nothing is a setting. Only a directory (the demo company) can say "Everyone at X"; a
  real work account says "Everyone you meet at X".

## Decisions made while mapping the backend

These settle what the spec left open. Each goes in the pull request so Ben can overrule it.

| Question | Decision |
| --- | --- |
| One link per series? | Yes. A `series` item has its own code; it leads to the call that's on now or next. Google gets one recurring event carrying that link. Each call keeps its own code for Alcove's Join buttons. |
| How are repeats expanded? | In the browser, where the time zone is. The server validates order and count, builds the RRULE and stores each call as an ordinary meeting sharing `seriesId`. At most 60 calls; an end date is required. |
| `MAX_GUESTS` | 300. |
| What invitees see of the guest list | Up to 25 invited: everyone's names. Past that, only the count (`guests: []`, `guestCount`). |
| Keep-transcript off and notes can't be written | The transcript stays so the organizer can have them written again, and the note says so. It's deleted when the notes are written. |
| Keep choices versus "one fixed behaviour" | The choices replace it; the three engineering docs that say otherwise change in this work. |
| Free/busy for other people | Add `calendar.events.freebusy` to the Google scope. Existing connections answer 403 and read as `busy: null`. That's an operator step for the consent screen, named in the pull request. |
| Questions with votes on big calls | Not built: it needs its own end-to-end encrypted message model. The app shows only what works: join muted. |
| Documents for real accounts | `source: 'none'` and a designed empty state. Sample accounts get the catalog. Real workspaces are #81. |
| Abandoned lobbies | Instant calls aren't listed until someone is in them. Backing out cancels. Starting a new one sweeps your unjoined ones older than a day. |
| Who can be rung, after review | Teammates, and people invited who said yes to this call. Being invited alone isn't enough: anyone can invite any address, and T3's "already invited" let a stranger put a title on someone's screen. |
| Where the series link goes after a call, after review | A call that ended keeps it until an hour after its time is up, unless the next one starts within that hour, which then has it at once. |

## Review focus

The inputs and conditions most likely to bite someone that no task's happy path exercises. Each has a test in the
task that owns it.

1. A lobby rename on an instant call must not reach Google (T1).
2. A guest's link for an offered call opens no camera, and two people picking at once: first wins, second is told (T1, T6).
3. A late audio piece after the call ended, with keep-recording off, must still be purged (T4).
4. Cancelling the first call of a series keeps the series link working for the rest (T2).
5. Someone rung with no Alcove tab open: the ring ends as `missed`, nothing implies they were offline (T3).

## Task index

| # | Task | Branch | Depends on |
| --- | --- | --- | --- |
| T1 | Invited people, answers, instant calls, offered times | `calls/meetings` | Contract |
| T2 | Repeating calls, the series link, Google recurrence | `calls/series` | T1 merged |
| T3 | Ringing | `calls/rings` | Contract |
| T4 | Keep choices, busy times, documents, sample data | `calls/keep` | Contract |
| T5 | The modal, the scheduler, the call card; composer deleted | `calls/flow` | Contract |
| T6 | The lobby, the ring card, the call's waiting arches, picking a time | `calls/live` | Contract |

---

### T1: Invited people, answers, instant calls, offered times

**Owns:** `apps/api/migrations/0004_meeting_access.sql`, `apps/api/src/modules/access.ts` (new), `modules/meetings.ts`,
`modules/invites.ts`, the `card`/`join` paths of `modules/calls.ts`, `toEvent`/`joinOf` in `modules/calendar.ts`, routes in
`app.ts`, `apps/api/src/invited.integration.test.ts` (new).

**Build map:** sections 0, 1, 6, 9, 10 ("Invited view and RSVPs", "Offered times").

- [ ] **Migration:** `meeting_access (owner_id, meeting_item_id, email_index, answer_ciphertext, PRIMARY KEY (owner_id, meeting_item_id, email_index), FOREIGN KEY → items ON DELETE CASCADE)` and an index on `email_index`. Blind index purpose `invite`.
- [ ] **`modules/access.ts`:** `syncAccess(o, db, meetingId, guests)`, in the same transaction as every guest change (`create`, `update`, `adopt`, `scheduleNext`, `startNow`, `addToInvite`, `takeOffInvite`), keeping the answers of people who stay. `invitedMeetings(viewer)`, `locateInvited(viewer, meetingId)`, `answer(...)`. New record kind `meeting-answer`, state key `meeting-answers:<meetingId>`, header binding owner, meeting and email index.
- [ ] **Calls scheduled before this release:** the organizer's `upcoming` read syncs any meeting whose rows don't match its guests.
- [ ] **`upcoming` and `get`:** invited calls are merged in with `isOrganizer: false`, opened with `openOwner` per organizer, as `meetingFor` does. A demo viewer never sees a real organizer's call (`notesCanGo`). Invitees get no `noteId`, no `calendarUrl`, no `seriesCode` beyond what's in the invitation, and no addresses past 25 people. Rows of calls that have ended or are past the upcoming cut-off are removed as they're read.
- [ ] **`POST /v1/meetings/:id/answer`:** invited only; the organizer gets `not-found`, like anyone else who isn't invited.
- [ ] **`rsvps` and `rsvp` on `toMeeting`:** one batch query for a list. On `get` for the organizer, add Google's `attendees[].responseStatus` for people with no Alcove answer, read at that moment and stored nowhere; a failure leaves the counts as they are.
- [ ] **Documents on `toMeeting`:** call `documentsFor(ids, viewer)` from `modules/documents.ts` (T4 fills it in).
- [ ] **Instant calls:** `update` never calls `placeOnCalendar` on an `instant` call; `update` takes `choices`, `joinMuted`, `documents`. `findUpcoming` leaves out `instant && status === 'scheduled'`. `startNow` deletes this owner's instant calls that never started and are over a day old, in its transaction. `cancel` works on an unjoined instant call.
- [ ] **`MAX_GUESTS = 300`.**
- [ ] **Offered times:** `create` with `offer` stores `offer: { times }`, sets `startsAt` to the first, places nothing on a calendar. `upcoming` lists it. `card.offer` carries the times and minutes until picked. `join` refuses while offered. `POST /v1/calls/:code/pick`, public, before auth, rate limited, idempotent by first pick: picks a time that's on the offer, clears `offer`, sets the times, then `placeOnCalendar`; any later pick is `ConflictError`. `offer` with `repeat` is a `ValidationError`. An offered call can be cancelled.
- [ ] **Calendar:** `toEvent` sets `alcoveCode` from a location under `WEB_ORIGIN/join/`, and `join: { url, label: 'Alcove' }`, so an invitee's Google copy can join and the app can de-duplicate it.
- [ ] **Tests** (`invited.integration.test.ts`): schedule → guest signs in → sees it with `isOrganizer: false` → answers → organizer's counts change → guest taken off → gone. Past 25 people, no addresses. A cross-owner `get` and `answer` are `not-found`. A demo viewer can't see a real organizer's call. Renaming an instant call places nothing on the fake Google calendar. An instant call isn't listed until joined. Offer → card shows times → join refused → pick → `startsAt` set, event on the fake calendar → second pick refused → pick of a time not offered refused. `meeting_access` is in the leakage dump with an answer canary.
- [ ] **Commit** on `calls/meetings`.

### T2: Repeating calls, the series link, Google recurrence

**Owns:** `apps/api/migrations/0006_series_items.sql`, `modules/repeats.ts` (new), `vault.ts` (`ItemKind`), `modules/meetings.ts` dispatch points, `meetingFor` in `modules/calls.ts`, `modules/series.ts`, the recurring half of `modules/calendar.ts`, account deletion in `modules/account.ts`, `testing/fake-google.ts`, `apps/api/src/repeats.integration.test.ts` (new).

**Build map:** sections 0, 2 (recurrence), 10 ("Repeat rules"), risk 2.

- [ ] **Migration:** widen `items.kind` to allow `series`: drop and re-add the CHECK (confirm its name from `0001_init.sql`).
- [ ] **`create` with `repeat`:** validates `occurrences[0] === startsAt`, ascending, all still to come, at most `MAX_SERIES_CALLS`. Writes a `series` item `{ title, repeat, code, calendarEvent? }` whose ID is `seriesId`, its `call_codes` row, and one meeting item per occurrence with `seriesId`, `seriesCode` and `repeat` readable through `toMeeting`, in one transaction, with `syncAccess` for each. It returns the first call.
- [ ] **Series link:** `meetingFor` resolves a code that leads to a `series` item to its live call, else the next not ended, else the latest. No meeting left: `NotFoundError`.
- [ ] **Google:** one master event with `recurrence` (RRULE built from the rule and `until`), `start.timeZone`, and the series link as its location. Read `events/:id/instances` and store each instance's ID in that call's `calendarEvent`. Unmatched instance: a `warn` line, the call still exists.
- [ ] **`update` with `scope`:** `this` changes the one call (PATCH the instance). `following` applies the patch to this call and every later one that hasn't started. A time change with `following` needs `repeat`; pair `occurrences` with the calls in order, create what's new, delete what's left over. Google: end the old master with UNTIL, POST a new one carrying the same link; if this is the first call, PATCH the master. `repeat` on a call that doesn't repeat makes it a series.
- [ ] **`cancel` with `scope`:** `this` deletes the call and its instance; `following` deletes it and later ones and trims the master; from the first call that's the whole series. The last call gone deletes the `series` item, its code and the master.
- [ ] **`Series.repeat`, and account deletion withdraws masters.** `recurring` keeps its Google meaning.
- [ ] **Fake Google:** `recurrence`, `/events/:id/instances`, per-instance PATCH and DELETE.
- [ ] **Tests** (`repeats.integration.test.ts`): schedule weekly → N calls, one link, one event on the fake calendar → the series link joins the next call → cancel the first → the link still works and leads to the second → change this call only → change this and later → cancel following → the whole series gone with its code. Occurrences out of order or past the cap refused. Cross-owner `update` and `cancel` with `scope` are `not-found`. `scheduleNext` still works beside it. The `series` manifest is in the leakage canary.
- [ ] **Commit** on `calls/series`.

### T3: Ringing

**Owns:** `apps/api/migrations/0005_call_rings.sql`, `modules/rings.ts` (new), the `ring` action and `ringing` in `modules/calls.ts`, routes in `app.ts`, `maintenance.ts`, the `rings` part of `packages/api-http`, `.github/workflows/deploy.yml`, `apps/api/src/rings.integration.test.ts` (new).

**Build map:** section 4 "Proposed ring delivery" in full. One stream per tab: no `navigator.locks` for the stream.

- [ ] **Migration:** `call_rings` as in the build map, plus `deliver_at timestamptz NOT NULL` (when the ring next shows) beside `expires_at`.
- [ ] **`ring` action:** organizer only, needs the call pass. Each address must be a teammate (the check in `modules/people.ts`) or already invited; anyone else is refused with a `ValidationError` that names nothing. `addToInvite`, insert or restart rows, nudge. Its own rate limiter.
- [ ] **`GET /v1/rings`:** after auth, NDJSON snapshots of `RingsSnapshotSchema`: one line on connect, then on change. One ticker per process, only while someone is subscribed, one indexed query for every subscriber. End the stream by about 240 s. Keep only the owner ID and index in the stream, never `Owner` keys. Add the path to `QUIET`.
- [ ] **`POST /v1/rings/:id/answer`:** found by the caller's email index; anyone else gets `not-found`. `join` → `coming`. `in-5`/`in-15` → `later`, `deliver_at` moved, rung again then if the call is still live. `no` → `declined`. Nudges the room.
- [ ] **`CallState.ringing`:** organizer only, from the sealed rows; `missed` once `expires_at` passes unanswered. People in the call are left out; their row goes when they join.
- [ ] **Ending:** rows go at `endCall`, Stop and cancel (FK), and `maintain` sweeps any older than 24 h. Account deletion clears by email index.
- [ ] **`rings.live()` in `api-http`:** a `LiveStore<IncomingRing[]>` over `ndjson` with an abort signal, reconnecting with jitter, `close()`. Rings past `expiresAt` drop from the snapshot by a timer.
- [ ] **Deploy:** add `--concurrency 500` beside `--max 1` in `deploy.yml`.
- [ ] **Tests** (`rings.integration.test.ts`): organizer joins → rings a teammate → teammate's stream shows it with the title → answers `in-5` → organizer sees `later` → `no` → `declined`. Rung person joins without asking and is on the note's invite. Ring crosses instances with `secondServer()`. A ring runs out → `missed`, stream empties. Ringing a stranger refused. Answering someone else's ring `not-found`. Leakage canary on `ring_ciphertext`, with the table in the dump. A guest can't ring.
- [ ] **Commit** on `calls/rings`.

### T4: Keep choices, busy times, documents, sample data

**Owns:** `modules/writer.ts`, `modules/notes.ts`, `modules/audio.ts`, host join and `endCall` in `modules/calls.ts`, a revision-pruning helper in `vault.ts`, `modules/documents.ts` (exists as a stub), busy reads in `modules/calendar.ts`, `google.ts`, `demo.ts`, routes in `app.ts`, `testing/fake-google.ts` (`/freeBusy`), `apps/api/src/keep.integration.test.ts` and `apps/api/src/availability.integration.test.ts` (new), and the retention sections of `docs/engineering/notes-and-inference.md`, `data-and-storage.md`, `calls-and-recordings.md`.

**Build map:** sections 0, 2, 5 in full, 10 ("Availability", "Attached documents").

- [ ] **Keep on the note:** `NoteManifest.keep` with `.default`, copied from the meeting in `blankNote`. `Note.kept` from it.
- [ ] **Keep-recording off:** upload, then purge, as section 5 lays out: save recorded seconds into the note first and bill from that, purge in `endCall` and again in `settle`, keep the `recordings` row. Fix the progress label and copy on the server side.
- [ ] **Keep-transcript off:** on the first successful write, clear `transcript` and prune earlier revisions in the same transaction, per section 5. If the notes can't be written, keep it. Ask about a note answers from the notes and summary; ask across notes includes written notes. Invitees don't read a transcript while it's pending deletion.
- [ ] **`readScreens`:** seeds `notes.screens.on` at the organizer's join when notes are on.
- [ ] **`POST /v1/calendar/busy`:** `BusyBodySchema`, added to `NO_RECEIPT`. `you` from `events.list` plus own calls. `people` from `freeBusy` in chunks of 50, `busy: null` on a per-calendar error or a 403. Counts only in logs. `from`/`to` capped at 31 days.
- [ ] **Sample accounts:** a deterministic generator in `demo.ts` (hash of address and day), so a week looks real and is the same on every read. People outside the company read as `null`. Extend `TEAM` with Priya-free names the canvas uses at Vandelay: Aiko Tanaka, Maya Chen; keep existing ones.
- [ ] **`GET /v1/documents` and `documentsFor`:** sample accounts get a catalog in `demo.ts`: two workspaces (Product, Design) for Vandelay addresses, "Your documents" for other sample accounts, matching the canvas. Others get `{ source: 'none', workspaces: [] }`. `documentsFor(ids, viewer)` gives `name: null` to anyone who can't open it, and `create`/`update` refuse unknown IDs.
- [ ] **Scope:** add `calendar.events.freebusy` to `SCOPE`.
- [ ] **Tests:** `keep.integration.test.ts`: call with keep-transcript off → note written → transcript empty, `kept.transcript` false, and no revision still holds a transcript canary. Keep-recording off → audio pieces and objects gone, duration and billing right, a late piece purged. Notes can't be written → transcript kept. `readScreens` on → capture says screens on from the start. Defaults keep everything. `availability.integration.test.ts`: real account reads own events; `freeBusy` with a private calendar → `null`; sample account's week is deterministic; busy addresses appear in no log. Documents: sample catalog, none for a real account, name hidden from an outsider.
- [ ] **Commit** on `calls/keep`.

### T5: The modal, the scheduler, the call card; the composer deleted

**Owns:** `apps/web/src/features/calls/` (new, except `Ring*`, `Lobby*`, `PickTime*`), `features/shell/` (delete `Composer.tsx`, `callLine.ts`), `routes/_app.tsx`, `routes/_app/home.tsx`, `routes/_app/notes.index.tsx`, `routes/_app/notes.series.$seriesId.tsx`, `features/home/`, `features/series/carried.tsx`, `features/team/`, `features/onboarding/Tour.tsx`, `lib/parse.ts` (delete; move what's still used), `lib/queries.ts`, `packages/ui/src/components/flow.tsx` and `styles/flow.css` (new), `.cmp-*`, `.hm-start*` removal.

**Build map:** section 7 in full.

- [ ] **Shell:** `CallFlowContext` in `features/shell/context.ts` with `useCallFlow()`: `start(opts?: { people?: Person[] })` and `open(meeting: Meeting)`. The host in `_app.tsx`. `N` opens it. Sidebar button **Start a call**; phone plus; every composer call site per the table in section 7.
- [ ] **Choice:** the modal with **Start now** (`Enter`) and **Schedule for later** (`S`), copy by `q.team()`. Start now: `useStartNow` with any preset people as guests, the flood from the card, then `/join/$code`. Under reduced motion it goes straight there. A failed start returns to the modal with a toast.
- [ ] **Who:** tokens, directory and group suggestions, `q.people`, groups from prefs, everyone from `q.team()`, paste handling in `features/calls/addresses.ts` (split on commas, semicolons, spaces and lines; `Name <a@b>`; de-duplicated; one token for the list; flags only what it can't read, with a guessed fix where another address in the list has the domain). Skip goes straight to **When** with no guests.
- [ ] **When:** `features/calls/times.ts`: three suggestions from `calendar.busy`, working hours 9 to 17 local, best first and pre-picked, length, **Pick another time** opens the week grid and the modal widens, repeat row with Every week, Every 2 weeks, Every month, Days you pick, and an end date. `expandRepeat(rule, start, until, timeZone)` gives occurrences at the same clock time. Individuals see **Let Jamie pick** with one guest whose calendar reads `null`.
- [ ] **Details:** title, When and Who rows that step back, notes row opening the switches, big-call row past 25 people, documents view, `Schedule` / `Schedule 4 calls` / `Get the link`. After scheduling: the row rises in Home's list, a toast says what happened: on the calendar and who's invited, or when no calendar is connected, that nobody's been told, with **Copy link**.
- [ ] **Call card:** opens from any row, for the organizer and for people invited. Rows change who, time, notes, documents; a series asks this call or this and later calls; invitees answer Yes, Maybe, No. Cancel confirms in place. Join and Copy link (the series link when there is one).
- [ ] **Home:** rows open the card; a series shows its next call only; an offered call shows **Waiting for Jamie to pick**; `aheadOf` drops a calendar event whose `alcoveCode` is a listed call. `StartCall` becomes a card with one button.
- [ ] **Tour, docs:** Tour copy; `docs/product/user-flows.md` sections 1 to 4, 9, 10; the design-system rule about the composer.
- [ ] **Verify:** `pnpm typecheck`, `pnpm --filter @alcove/web build`, and the app in a browser at phone and wide widths, light and dark, with a sample account.
- [ ] **Commit** on `calls/flow`.

### T6: The lobby, the ring card, the call's waiting arches, picking a time

**Owns:** `routes/join.$code.tsx`, `features/join/`, `routes/call.$code.tsx`, `features/call/Panel.tsx`, `features/calls/Lobby*`, `features/calls/Ring*`, `features/calls/PickTime*`, `routes/__root.tsx`, `routes/_app/notes.$noteId.tsx`, `packages/ui/src/components/ringing.tsx` and `styles/ringing.css` (new), `CaptureSummary`, ring and pick additions to `lib/queries.ts`.

**Build map:** sections 4 (Client), 5 (what depends on the transcript), 6.

- [ ] **Lobby:** organizer pre-join rises in two beats. Rename in place and the notes switch while `status === 'scheduled'`, read-only once live. On a team: the Ring arches (teammates on Alcove, those in `meeting.guests` already picked, busy now dimmed, Add with a picker that works on the stage) and **Join and ring 2**, Copy link quiet. On your own: your link first with Copy, then **Join**. Back cancels an unjoined instant call. Scheduled calls keep the lobby without the ring list.
- [ ] **Ring after join:** the emails picked go to `session.act({ type: 'ring', emails })` once joined, and never into a URL.
- [ ] **In the call:** for the organizer, `state.ringing` shows as empty arches with their answers, ripple while ringing, a tile opening when they join; the Just you so far card for individuals. Ring in People: a Ringing section, and Ring on invited people who aren't here.
- [ ] **Ring card:** `RingHost` in `__root.tsx`, signed in only, reads `api.rings.live()` with `useLive()`. Card drops in, `aria-live`, works above a modal, sound once per ring in one tab only (`navigator.locks`, `ifAvailable`), **Join** → `/join/$code`, **Can't now** → In 5 minutes, In 15 minutes, Not this time. Hidden on the page of the same call.
- [ ] **Picking a time:** `/join/$code` with `card.offer` shows `PickTime` and no media starts. Each time in the guest's own zone. After picking, the done screen with Add to my calendar (an `.ics` made in the browser).
- [ ] **Pre-join says what's kept:** `CaptureSummary` shows when the transcript or recording won't be kept. `joinMuted` starts mic and camera off.
- [ ] **Note page:** `kept.transcript` false: no "Nothing was said"; say it was deleted after the notes were written. `kept.recording` false: the audio copy says so.
- [ ] **Verify:** `pnpm typecheck`, `pnpm --filter @alcove/web build`, the app in a browser where the backend allows.
- [ ] **Commit** on `calls/live`.

---

## Integration

- [ ] Merge T1, T3, T4, T5, T6, then T2, into the feature branch. Resolve `app.ts`, `calls.ts`, `queries.ts`.
- [ ] `pnpm check` with `pnpm db:up` first.
- [ ] The real app in a browser: every journey on the canvas, for a team and an individual, light and dark, phone and wide.
- [ ] Update `AGENTS.md`'s component list, the spec's scope notes and `docs/engineering/privacy-keys-and-sessions.md`.
- [ ] One pull request with the upgrade notes the repo asks for.
