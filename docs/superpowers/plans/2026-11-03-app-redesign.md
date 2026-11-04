# The redesigned app: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship every screen and empty state on the redesign canvas, on a backend that supports all of it.

**Architecture:** Three PRs, each merged and deployed before the next. PR A grows the contract (`packages/api`), the
server and `@alcove/api-http` together, with integration tests; it changes stored shapes, so production's database is
backed up and reset at merge. PR B rebuilds the web app's shell and screens on that API, with new reusable pieces in
`packages/ui`. PR C adds the offline recorder (IndexedDB + service worker) and browser notifications.

**Tech stack:** pnpm + Turborepo; Hono + Postgres + S3-compatible objects (API); TanStack Start SPA, React 19,
TanStack Query, Tailwind v4, Motion (web); zod contract; Vitest integration tests against real Postgres and objects.

**Spec:** [docs/superpowers/specs/2026-11-03-app-redesign-design.md](../specs/2026-11-03-app-redesign-design.md),
plus the canvas it points to. Read both.

## Global constraints

- `AGENTS.md` rules all apply: no backwards compatibility (delete what a change replaces; one contract shape; edit
  `apps/api/migrations/` in place); integration tests only, in `*.integration.test.ts`, signing in through the real
  API; strict TypeScript (no `any`, `as`, `!`, suppressions); app talks to the backend only through `api` and
  `queries.ts`; privacy (sealed records, owner-scoped queries, cross-owner tests, physical deletion, leakage canaries);
  `log` child loggers, never `console`; `@alcove/ui` components and tokens, `sun` the only pressable colour, `rec`
  only for notes/recording, no green, people in the arch, camera only on join and in calls; copy says what happens.
- Every new screen works in light and dark, at 390px and at 1440–2000px.
- Run tests with `cd apps/api && pnpm exec vitest run` (Postgres and RustFS already run as compose project `alcove`;
  never run `docker compose` from this worktree). Typecheck with `pnpm typecheck`; build with `pnpm build`.
- Commits are signed by the repo's configuration; branch from current `origin/main`; PRs and merges go through the
  GitHub REST API with `~/.config/alcove/github-token` (never `gh`, never print the token).
- Docs stay true to the code: update `docs/product/user-flows.md`, `docs/product/overview.md` and the engineering
  page each task touches, in that task.

## Review focus

1. **Stale references.** A pin, group member or inbox item that points at a deleted note, a removed share or a
   departed person is dropped quietly, never a broken row or a 404 page (tests in A2, A3, A4).
2. **Cross-owner IDs.** Note IDs in pins, shares to groups and inbox decisions come from requests; another
   account's IDs must be refused as not found (cross-owner tests in A2, A3, A4, A5).
3. **Interrupted offline recording.** A tab closed or crashed mid-recording leaves its pieces in IndexedDB; the next
   open finishes the upload exactly once, in order, with no duplicate pieces (tests in A9, checks in C2).
4. **Asking with nothing to go on.** No ready notes, or only notes still being written: a plain answer and no model
   call (test in A5).
5. **Long and many.** 40-character group names, 50 members, 8 pins, 200-character titles and 30 notes in a series
   keep every layout intact: truncation, wrapping, scrolling (screenshots in B-tasks at 390 and 1440).

---

## PR A: backend for the redesign

### Task A1: Preferences grow

**Files:** Modify `packages/api/src/types.ts` (PreferencesSchema), `apps/api/src/modules/account.ts`,
`apps/web/src/routes/_app/account.tsx` (keep it compiling; it's replaced in B7), `docs/engineering/data-and-storage.md`.
Test: `apps/api/src/flows.integration.test.ts`.

**Interfaces:**
- Produces in `@alcove/api`: `NOTES_LANGUAGES = ['call','en','es','fr','de','pt','it','nl','ja','zh','ko','hi','ar'] as const`,
  `NotesLanguageSchema`, `SummaryLengthSchema = z.enum(['short','detailed'])`,
  `NotificationPrefsSchema = { beforeCall: 0|1|5, notesReady, sharedWithYou, notesRequested, followUpDue: boolean }`,
  `GroupSchema = { id: ID, name: string 1–40 trimmed, emails: email[] 1–50, unique }`,
  `PreferencesSchema = { notesDefault, notesLanguage, summaryLength, addToCalendar: boolean, showOtherMeetings: boolean,
  recordOffline: boolean, notifications, pinned: ID[] (≤8, unique), groups: Group[] (≤30, unique ids) }`.
- `account.updatePreferences(patch)` merges any subset; arrays replace whole.

- [ ] Write the failing test `preferences start with defaults and keep every field`: a new account's preferences are
  `{ notesDefault:'on', notesLanguage:'call', summaryLength:'short', addToCalendar:true, showOtherMeetings:true,
  recordOffline:true, notifications:{ beforeCall:5, notesReady:true, sharedWithYou:true, notesRequested:true,
  followUpDue:false }, pinned:[], groups:[] }`; patching `{ summaryLength:'detailed', notifications:{…beforeCall:1} }`
  returns both changed and the rest untouched; `{ notesLanguage:'xx' }` is refused `invalid`.
- [ ] Run it; it fails on the missing fields.
- [ ] Store every field in the sealed profile (no new column); new accounts get the defaults; `updatePreferences`
  merges field by field.
- [ ] Run the suite; all pass. Commit `feat(api): preferences for notes, calendar, notifications, pins and groups`.

### Task A2: Pins

**Files:** `apps/api/src/modules/account.ts`, `apps/api/src/modules/notes.ts` (delete/remove unpin). Test: flows.

**Interfaces:** Consumes A1. Pins are `preferences.pinned`.

- [ ] Failing tests: `pins keep their order and refuse notes you don't have` (pin two of your notes in order B, A →
  returned in that order; pinning another account's note ID → `not-found`; a ninth pin → `invalid`);
  `deleting or removing a note unpins it` (owner deletes → gone from owner's pins; a recipient who pinned a shared
  note keeps nothing pointing at it after the owner deletes it, and after removing it from their notes).
- [ ] Validate pinned IDs against the notes the account has (own and received) on update; unpin on delete/remove,
  including for recipients when the owner deletes.
- [ ] Pass; commit `feat(api): pinned notes`.

### Task A3: Groups and who shared a note

**Files:** `packages/api/src/types.ts` (ReceivedSchema, RecipientSchema, NoteSummarySchema), `packages/api/src/wire.ts`
(ShareInputSchema), `packages/api/src/client.ts` (`notes.share`), `packages/api-http/src/index.ts`,
`apps/api/src/modules/notes.ts`, `apps/api/src/app.ts`, every web use of `from` and `share`, leakage test. Test: flows.

**Interfaces:**
- `ReceivedSchema = { role: 'invited'|'shared', by: Person, group?: string, at: ISODate }`.
- `NoteSummarySchema`: replace `from` with `received?: Received` (absent on your own notes).
- `RecipientSchema = { person, role, by?: Person, group?: string, at?: ISODate }` (`by`/`group` on shared recipients).
- `notes.share(id, { emails: string[]; group?: string | undefined }): Promise<Note>`.
- Groups themselves are `preferences.groups` (A1); the client expands a group to emails and passes its name.

- [ ] Failing tests: `a note shared with a group says who shared it and with which group` (A shares with B via
  `{ emails:[b], group:'Product' }` → B's summary has `received:{ role:'shared', by:A, group:'Product' }`, A's note
  recipients carry `by:A, group:'Product'` for B); `invited people see the organizer as who it came from`;
  `group names and members never reach storage or logs in the clear` (add canaries `CANARY-GROUP-…` and
  `canary-member-…@example.com` to the leakage test); group with 51 emails refused `invalid`.
- [ ] Record `by`, `group` and `at` on the recipient inside the sealed note; derive `received` per reader.
- [ ] Replace every `n.from` in `apps/web` with `n.received?.by` (and the shared/invited wording from `role`).
- [ ] Pass; commit `feat(api): share with a group, and who shared each note`.

### Task A4: Inbox replaces open actions

**Files:** types (PendingDecisionSchema, InboxSchema, OpenActionSchema gains `noteStartedAt`), client (`notes.inbox`,
delete `notes.openActions`), api-http, `apps/api/src/modules/notes.ts`, app.ts (`GET /v1/notes/inbox`, delete
`/v1/notes/actions`), `apps/web/src/lib/queries.ts` (`q.inbox`, delete `q.openActions`), home.tsx. Test: flows.

**Interfaces:**
- `PendingDecisionSchema = Decision & { noteId, noteTitle, noteStartedAt }`.
- `InboxSchema = { followUps: OpenAction[] /* not done, owner is you, every note you have */, decisions:
  PendingDecision[] /* state 'proposed', ready notes you have */ }`; both newest note first.
- `notes.inbox(): Promise<Inbox>`.

- [ ] Failing tests: `the inbox gathers your follow-ups and unconfirmed decisions from every note you have`
  (organizer's note with an action owned by the invitee: it's in the invitee's `followUps` with `takenOn:false`,
  not in the organizer's; a proposed decision shows for both; confirming it removes it for both; a done action
  leaves); cross-owner: a stranger's inbox is empty.
- [ ] Implement over own and received notes; delete `openActions` everywhere.
- [ ] Pass; commit `feat(api): the inbox: your follow-ups and decisions waiting to be confirmed`.

### Task A5: Ask your notes

**Files:** types (AnswerPart `cite` gains `noteId`), client (`notes.askAll`), api-http, `apps/api/src/modules/notes.ts`
(+ the inference prompt beside the per-note ask), app.ts (`POST /v1/notes/ask`), fake NEAR in
`apps/api/src/testing/`, `apps/web/src/features/notes/example.ts` and parts (cite shape). Test: flows.

**Interfaces:** `AnswerPart = { type:'text', text } | { type:'cite', noteId: ID, at: number }`;
`notes.askAll(question: string): AsyncIterable<AnswerPart>` (1–500 chars).

- [ ] Failing tests: `asking your notes answers from the notes you have and cites them` (two ready notes; the
  answer has text and only cites those note IDs; the model request went through verified private inference like
  per-note ask); `asking with no ready notes says so without a model call`; a stranger's question never cites
  another account's notes.
- [ ] Choose up to 12 most relevant ready notes by word overlap on title, summary, decisions, follow-ups and
  transcript; send their summaries, decisions, follow-ups and the best transcript excerpts (bounded to the model's
  limit the per-note ask uses); keep only cites of included notes.
- [ ] Pass; commit `feat(api): ask across your notes`.

### Task A6: Notes language and summary length

**Files:** `apps/api/src/modules/writer.ts` (and whatever builds its prompt), fake NEAR. Test: flows.

- [ ] Failing test: `notes are written in the chosen language and length` (with `notesLanguage:'es',
  summaryLength:'detailed'` the writer's request to the fake model carries those instructions; with defaults it
  asks for the call's language and two or three sentences).
- [ ] The organizer's preferences decide for calls; the recorder's for room recordings.
- [ ] Pass; commit `feat(api): notes in your language, short or detailed`.

### Task A7: Calendar choices and disconnect

**Files:** client (`calendar.disconnect`), api-http, `apps/api/src/modules/calendar.ts`, `meetings.ts`, app.ts
(`DELETE /v1/calendar`). Test: flows (uses the fake Google).

- [ ] Failing tests: `with addToCalendar off, scheduled calls stay off Google Calendar` (fake Google sees no
  insert); `disconnecting forgets the calendar` (tokens deleted physically; `calendar.get()` reports `needsAccess`;
  scheduling no longer touches Google).
- [ ] Pass; commit `feat(api): choose what goes on your calendar, and disconnect it`.

### Task A8: Team from the people you meet

**Files:** types (TeamMemberSchema gains `title?: string`), `apps/api/src/modules/people.ts`, `apps/api/src/demo.ts`
(titles for the demo directory). Test: flows.

- [ ] Failing tests: `a work account's team is the colleagues it has met` (an account at `acme.example` with calls
  and fake-Google meetings including `ann@acme.example` and `bob@other.example` → team `{ domain:'acme.example' }`
  with Ann only, `onAlcove` true once Ann signs in, `invited` after inviting); `personal addresses have no team`
  (gmail.com → null); the demo directory keeps its people and gains titles.
- [ ] Pass; commit `feat(api): your team from the colleagues you meet`.

### Task A9: Room recordings recorded offline

**Files:** live/wire/types for `recordings.start` input and piece/clip offsets, api-http, `recordings.ts`, `audio.ts`,
`transcripts.ts`. Test: flows.

**Interfaces:** `recordings.start(input?: { title?: string; startedAt?: ISODate }): Promise<RoomRecording>`
(`startedAt` up to 14 days back, never in the future); `AudioPiece` and `TranscriptClip` carry `at` (seconds from the
start); `stop()` uses the pieces' total, not wall-clock.

- [ ] Failing tests: `a recording made offline uploads later with its own times` (start with `startedAt` 2 h ago,
  append pieces at 0/5/10 s and clips at 1 and 7 s, stop → note `startedAt` is 2 h ago, duration 15 s, transcript
  lines at 1 and 7 s); `the same piece twice is stored once`; `startedAt` 15 days ago refused `invalid`.
- [ ] Pass; commit `feat(api): recordings made offline upload later with their own timings`.

### Task A10: Minutes used this month, and deleting an account

**Files:** types (CreditBalance gains `usedThisMonth`), billing module, client (`account.delete`), api-http,
account/notes/meetings/objects code, app.ts (`DELETE /v1/account`), leakage test. Test: flows.

- [ ] Failing tests: `the balance says how much was used this month`; `deleting an account removes everything it
  owns` (rows for profile, notes, recordings, meetings, sessions and calendar tokens gone; its objects deleted or
  queued in `object_gc`; a note it organized is gone for its invitee; it's off a note someone shared with it; the
  same email signs in to a fresh account with 10,000 credits).
- [ ] Pass; commit `feat(api): minutes used this month, and delete your account`.

### Task A11: Ship PR A

- [ ] Update docs (user-flows, overview, data-and-storage, notes-and-inference, calls-and-recordings).
- [ ] `pnpm typecheck`, `pnpm build`, tests; push; open the PR; wait for Policy, Typecheck, Build, Integration tests.
- [ ] Before merging: on-demand Cloud SQL backup; merge; delete and recreate the `alcove` database before the
  migrate job runs; watch Deploy; check `/health` and sign in on production.

---

## PR B: the redesigned app

Screens follow the canvas; styles go in `packages/ui/src/styles/` (a file per area: `shell.css`, `home.css`,
`library.css`, `team.css`, `settings.css`, `record.css`, imported by `styles.css`; `AGENTS.md` lists them).

### Task B1: Building blocks in @alcove/ui

**Files:** `packages/ui/src/components/` (new `app.tsx` exports), `styles/kit.css`.

**Produces:** `NoteTile` (cover, title, meta, excerpt, faces, end), `PersonCard`, `Timeline` + `TimelineItem` +
`TimelineNow`, `SettingRow` (label, help, control), `SettingsCard`, `Select` (button + popover listbox),
`ThemePreview` (`theme: 'system'|'light'|'dark'`, pressed), `MicLevel`, `GhostArch`, `EmptyArch` size prop,
`GroupChip`. Names and props as the canvas uses them.

- [ ] Build each with tokens only; check them in the welcome page's kit section or a scratch route removed before
  commit; commit `feat(ui): building blocks for the redesigned app`.

### Task B2: Shell, side panel, palette and phone tab bar

**Files:** `apps/web/src/features/shell/Sidebar.tsx`, new `Palette.tsx`, new `TabBar.tsx`, `routes/_app.tsx`,
`styles/shell.css`.

- [ ] Side panel per spec (data: `q.notes`, `q.upcoming`, `q.calendar`, `q.prefs` for pins and groups, `q.trust`,
  `q.balance`, `q.team`, offline queue count from C2 when it lands: show nothing until then); ⌘K and the search
  field open the palette: notes as you type (`q.notes(undefined, text)`), Enter asks your notes (`api.notes.askAll`,
  streamed into the palette, cites link to `/notes/$id?at=`).
- [ ] Below 860px: top bar with brand and avatar; bottom `TabBar` (Home, Notes, Record raised, Team, Settings).
- [ ] Screenshots light/dark at 390 and 1440; commit `feat(web): the new side panel, palette and phone tab bar`.

### Task B3: Home

**Files:** `routes/_app/home.tsx`, `styles/home.css`. Data: `q.upcoming`, `q.calendar`, `q.inbox`, `q.notes`, prefs.

- [ ] Up next with "Last time" (series by title), Today timeline with the now line (hide other meetings when
  `showOtherMeetings` is off), Waiting on you (decisions: Confirm / It wasn't decided via `useUpdateDecision`;
  suggested follow-ups: Take it on / Not mine (`owner: null`); shared in the last 7 days), Your follow-ups (tick via
  `useUpdateAction`), Ask your notes (opens the palette with the question), Recent notes (4 tiles).
- [ ] First day: first-call card with the composer line inline, example note, empty follow-ups, empty today,
  team card per Team state. Every card's empty state as on the canvas.
- [ ] Screenshots; commit `feat(web): the new Home`.

### Task B4: Notes

**Files:** `routes/_app/notes.index.tsx`, `styles/library.css`.

- [ ] Search, All / Calls / In the room / Shared with you, "With anyone" people filter, list grouped by day with
  pin state, preview pane (`q.note`) with Ready, pin, Share, Open notes; empty, no-match and nothing-shared states.
- [ ] Screenshots; commit `feat(web): notes with a preview pane`.

### Task B5: A note

**Files:** `routes/_app/notes.$noteId.tsx`, `features/notes/parts.tsx`, `styles/library.css`.

- [ ] Breadcrumb, pin, Share (people or one of your groups: `notes.share(id, { emails, group })`), series card and
  label, "Shared by … with …" chip from `received`, everything the page has today (evidence, progress, player,
  chapters, recipients with `by`/`group`, ask); being-written, nothing-said and deleted states as on the canvas.
- [ ] Screenshots; commit `feat(web): the note page`.

### Task B6: Team

**Files:** new `routes/_app/team.tsx`, new `features/team/Groups.tsx`, `styles/team.css`.

- [ ] People cards (title or email, last call from notes, Start a call: composer prefilled; Notes with: `/notes`
  filtered), Not on Alcove yet with Invite / Invite all, Groups (create, rename, change members with the people
  picker, delete; all through `usePreferences`), Shared with groups (received with `group`, and your own shares to
  groups), Your minutes (`q.balance`). First-one-here, personal-account and no-groups states.
- [ ] Screenshots; commit `feat(web): the Team page and groups`.

### Task B7: Settings

**Files:** new `routes/_app/settings.tsx` (delete `account.tsx` and every link to `/account`), `styles/settings.css`.

- [ ] Sections and rows exactly as the canvas, each wired: profile; notes (default, language, summary); recording
  (record without a connection, on this device count from C2 when it lands, nothing else); calendar (connected,
  disconnect, connect, the two switches); devices (this browser's choices via `features/call/devices.ts`, mic
  level, play test sound, noise reduction); notifications (the five, stored in preferences; asking for browser
  permission arrives in C3); appearance (`ThemePreview` ×3); minutes (big number, meter, used this month); privacy
  (ledger, sealed badge with `q.trust` time, Delete account with a confirm step naming what goes).
- [ ] Screenshots; commit `feat(web): Settings`.

### Task B8: Record in the side panel

**Files:** new `routes/_app/record.tsx` (the page), move today's `routes/record.tsx` to `routes/record.live.tsx`
(`/record/live`, the stage recorder), `styles/record.css`.

- [ ] Night recorder card (name, microphone choice and level, Start recording → `/record/live?title=`), Recorded
  before (`q.notes('room')`), How it works; empty state. Composer's "Record in the room" goes to `/record`.
- [ ] Screenshots; commit `feat(web): Record in the side panel`.

### Task B9: Ship PR B

- [ ] Docs (user-flows: side panel, Home, Notes, Team, Settings, Record; overview), `AGENTS.md` style-file list.
- [ ] Full click-through in a real browser, light and dark, 390 and 1600; typecheck, build, tests; PR; checks; merge;
  Deploy; verify production.

---

## PR C: offline recording and notifications

### Task C1: The app opens offline

**Files:** `apps/web/public/sw.js`, registration in `routes/__root.tsx`, `apps/web/scripts/csp.mjs` (`worker-src 'self'`).

- [ ] Cache the built shell and hashed assets on install; network-first for navigations with the cached shell as
  fallback; never cache `/api`. Verify offline load in a real browser; commit `feat(web): Alcove opens offline`.

### Task C2: The offline recorder

**Files:** new `apps/web/src/features/record/offline.ts` (IndexedDB store + key), `features/call/media.ts`
(NotesRecorder/SpeechClips write locally when offline or when an upload fails), `routes/record.live.tsx`, side panel
count, Record page "On this device" list, Settings row.

- [ ] Store pieces and clips with their `at` under a non-extractable AES-GCM key kept in IndexedDB; upload on
  `online`/app start: `recordings.start({ title, startedAt })`, pieces then clips in order, `stop`; delete local
  copies only after `stop` succeeds; resume exactly once after a crash (a lock per recording).
- [ ] Verify in a real browser with the network cut mid-recording and the tab closed and reopened; commit
  `feat(web): record without a connection`.

### Task C3: Browser notifications

**Files:** new `apps/web/src/features/shell/notify.ts`, Settings notifications section (permission prompt).

- [ ] While a tab is open: before-call reminders (1/5 min), notes ready (a note you have turns ready), shared with
  you (a new `received.role === 'shared'`), notes requested (organizer, in calls), follow-up due (weekday/today/
  tomorrow due text, at 09:00). Each obeys its preference and the browser permission; commit
  `feat(web): notifications`.

### Task C4: Ship PR C

- [ ] Docs; checks; PR; merge; Deploy; verify production offline recording end to end on a phone-size browser.
