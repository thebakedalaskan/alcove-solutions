# Settings, regrouped

Settings today is twelve parts in one long sheet of about sixty equal rows, with Sounds and Notifications listing the
same events twice. The approved redesign keeps the index that stays beside you as you scroll, and regroups everything
into seven groups of panels. It says each event that can reach you once, with an Alert and a Sound side by side, and
folds what you set up once (Google Drive, agents) into one line until you open it.

- Design canvas (approved): https://claude.ai/artifact/H8Qx6FYrn1XJ6w5qYiZxw9. Its boards are copied into the design kit,
  `docs/design/canvas/` (Settings.dc.html, page-settings.css, data-settings.js, StepsSettings.dc.html), with a step
  for every state. The canvas is the visual spec: match its layout, spacing and
  copy, built from the real tokens, components and the app's own rules (AGENTS.md, docs/design/principles.md).
- The canvas's demo data and model names are made up. In the app, show only what's real.

## The page

You stand on the horizon in the sky (unchanged: avatar, name, address, Take the tour, Sign out and its question).
Below, the index (a line with a small sun that follows the group in view; a strip at the top at 1000px and narrower),
then seven groups. A group is a heading (20px semibold) over one or two panels. A panel is `surface` with a hairline
edge and 18px corners; rows inside are separated by hairlines. Every control sits at the panel's right edge, and Saved
appears just left of the control that was pressed. Help is one short line, only where it's needed.

| Group (id) | Panels and rows |
|---|---|
| You (`you`) | Profile: Name and photo (provider account link, or Single sign-on), Company (→ Team), Time zone. Appearance (tag: This browser): Theme, three small evenings. |
| Calls and notes (`calls`) | Notes: Notes for new calls (On/Off; help "Everyone invited gets them. You can change it for each call."), Language, Summary, AI model. Recording in the room (`recording`): Record without a connection; On this device only while something waits to upload. |
| Audio and video (`audio`, tag: This browser) | Microphone (+ Check the level), Speaker (+ Play test sound), Camera, Reduce background noise. |
| Notifications (`notifications`) | First panel: Browser notifications (Turn on → the browser asks → a switch; Blocked; Not available), Sounds (mute, volume, play), Quiet mode, Before a call starts (1 min, 5 min, Off). Second panel, "What reaches you": the alert table. |
| Connections (`connections`) | Google panel: Google Calendar (`calendar`) with its two switches nested under it; Google Drive (`google-drive`) as one line ("After each call: notes and transcript to <folder>.", Exporting) with Manage, which opens Folder, Files, Export after each call, Recent exports and a foot (disclosure + Disconnect) in place. Agents panel (`agents`): each connection one row with Disconnect, then Connect an agent, which opens in place: the MCP address with Copy, "Create a token" for a script (name, expiry, permissions), and the token shown once. |
| Plan and credits (`plan`) | Notes left (big number, the sun on the row's hairline; help "Calls without notes are free."), Used this month, Add credits (opens the existing sheet), open top-ups. |
| Privacy (`privacy`) | What Alcove knows / can't read (two columns), Confidential compute (hardware check). Then, in its own panel, Delete your account, which opens in place as today. |

Deep links: the group ids, plus the anchors `recording`, `calendar`, `google-drive` and `agents`, which other pages
already link to (Record, Home's first day, a note's Drive exports, the side panel's minutes → `plan`). The index
lights the group that holds whatever the address names. `?drive=connected|cancelled|failed` (Google's return)
scrolls to Google Drive and opens it, with the result said inside the panel.

### The alert table

One row per thing that can reach you, two columns: **Alert** (on screen in Alcove, and from the browser when Alcove is
in another tab, once browser notifications are on) and **Sound**. A cell is empty where that way doesn't apply. With
sounds off, the Sound column steps back (dimmed, keeping its ticks). Rows, in two groups:

| Row | Alert field (`notifications`) | Sound field (`sounds`) |
|---|---|---|
| **In a call** | | |
| Private messages | `privateMessages` | `messages` |
| Mentions | `chatMentions` | `mentions` |
| Replies to you | `replies` | `replies` |
| Requests to join (When you host) | `admissions` | `admissions` |
| Raised hands (When you host or present) | `hands` | `hands` |
| New questions (When you host or present) | `questions` | `questions` |
| The timer running out | `timers` | `timers` |
| People joining and leaving | — | `people` |
| Your microphone on and off | — | `mic` |
| **Outside a call** | | |
| Someone rings you | `ringing` (new) | `ringing` |
| Your notes are ready | `notesReady` | — |
| Notes shared with you | `sharedWithYou` | — |
| Someone asks for notes (Calls you organize) | `notesRequested` | — |
| A follow-up is due (At 9:00 that day) | `followUpDue` | — |
| Mentions in documents | `tagged` | — |

The call's own Settings (More, then Settings) uses the same pieces: its Sounds and Notifications tabs become one
Notifications tab with the first panel's rows and the table's In a call rows.

## Contract changes (packages/api/src/identity/preferences.ts)

- `NotificationPrefs` gains `ringing: boolean` (`.default(true)` for stored records; required in the input schema).
- `replyAlerts` and `mentionAlerts` go: the Alert tick for Replies and Mentions is `replies` and `chatMentions`, which
  now drive the in-app reply and mention alerts too (signed in: the profile; guests: their local notification
  preferences). Stored records from before still open: where a stored group carries `replyAlerts`/`mentionAlerts`,
  the schema folds them in as it reads (`replies = replies || replyAlerts`, `chatMentions = chatMentions ||
  mentionAlerts`, via `z.preprocess` on the stored schema only), so an in-app alert that was on stays on. The record
  is written in the new shape the next time it's saved. The input schema has no such fold.
- New accounts and guests (`DEFAULT_NOTIFICATION_PREFERENCES`): `enabled: false` (the browser is still opt-in), and
  Alert on for private messages, mentions, replies, requests to join, raised hands, the timer, rings, notes ready,
  notes shared, notes asked for and document mentions; off for new questions and follow-ups.
- Agents: the web needs the MCP address before any token exists. Add `endpoint(): Promise<{ endpoint: string }>` (or
  equivalent, named to fit the existing API) to `AgentsApi`, served from the existing `resourceUrl`, through the server,
  `@alcove/api-http` and Storybook's stand-in, with an integration test.
- The ring alert is a browser notification raised when someone rings you while Alcove is in another tab, through the
  existing delivery (`features/shell/notification-delivery.ts`), with copy that names nobody ("Someone is calling
  you"). Pressing it brings the tab forward, where the ring card is.

Every contract change updates the server, `@alcove/api-http`, the app and Storybook's stand-in together. The pull
request says how stored preference records from the previous release read afterwards.

## Components (packages/ui)

`components/settings.tsx` and `styles/settings.css` (classes `set-`):

- `SettingsGroup({ id, title, tag?, children })`: a section with its heading; `tag` is what it's limited to (This browser).
- `SettingsPanel({ id?, title?, tag?, className?, children })`: an optional heading over one panel.
- `SettingRow` keeps its props (label, mark, help, problem, control, saved, saveState, wide, stack, off, onLabel,
  children) and gains `sub` (nested under the connection above it). The control sits at the panel's right edge; Saved
  sits just left of the control itself.
- `SettingFact`, `SunLine`, `ThemePreview` stay.
- New: `SettingTile` (a 32px tile with an icon, as a row's mark for an agent), `SettingNote` (a notice inside a panel),
  `SettingFoot` (the foot of something open in place: a line of text and its buttons), `AlertTable` (the table above:
  stateless, groups of rows with `alert`/`sound` as boolean or null, a `soundOff` flag, `onChange(id, way, on)`, a
  save state per row), `SoundLevel` (mute, volume, play).
- `DriveExportFormats`, `DriveExportHistory`, `DriveExportDisclosure` and the agent components are restyled to sit in a
  panel as drawn; `SettingsPart` goes (no alias).

Component stories in `apps/storybook/stories/components/settings/` for each, in every state, light and dark.

## Who builds what

Each builder works in its own worktree on its own branch, cut from `settings-regroup`, and merges the branches it
depends on as soon as they have something (`git merge --no-edit <branch>`), as often as needed. Files are owned by one
builder; touch another's only where the plan says.

| Builder | Branch | Owns |
|---|---|---|
| Kit | `sr-kit` | `packages/ui/src/components/settings.tsx` (and a new `alert-table.tsx` if it reads better), `packages/ui/src/styles/settings.css`, the drive and agent components' settings styling, `packages/ui/src/index.ts` exports, `apps/storybook/stories/components/settings/*`. First commit: every component above with its final props, rendering real markup, so the page builders can compile against it; then the styling to the canvas. |
| Backend | `sr-backend` | `packages/api` preference and agents contract, `apps/api` (agents endpoint, preference tests, mentions and flows tests), `packages/api-http`, Storybook's stand-in (`apps/storybook/src/api`) for these, the web's in-call reply/mention alerts (`features/call/session/alertPreferences.ts`, `replyAlerts.ts`, `mentionAlerts.ts`, `lib/queryWrites.ts`, `lib/notification-preferences.ts` as needed), the ring alert (`features/shell/*notification*`, `notify.ts`, `features/calls/ringing/RingHost.tsx`), `docs/engineering` notes for these. First commit: the contract. |
| Page | `sr-page` | `apps/web/src/routes/_app/settings.tsx`, `features/settings/` except Notifications/Sounds/Drive files, the You, Calls and notes, Audio and video, Plan and credits and Privacy groups, the index and strip, deep links, `stories/pages/Settings.stories.tsx` and `stories/journeys/11-settings.stories.tsx`. |
| Alerts | `sr-alerts` | `features/settings/Notifications.tsx` and `Sounds.tsx` (merged into the Notifications group and the call sheet's pieces), `features/call/layout/CallSettings.tsx` (its tabs), the call stories that show Settings' notifications (`stories/calls/BrowserNotifications.stories.tsx`, `InTheCall`), and the Settings page scenarios for notifications. |
| Connections | `sr-connections` | `features/settings/DriveExports.tsx`, `DriveFolderPicker.tsx`, a new `features/settings/Calendar.tsx` (the calendar part moves out of `parts.tsx`), `features/agents/Settings.tsx`, `stories/journeys/14-agent-access.stories.tsx`, `15-google-drive-exports.stories.tsx` and the Settings page scenarios for connections. |

The orchestrator writes the docs (docs/design/pages.md, docs/product/user-flows.md, AGENTS.md's component list, the
design canvas copied into docs/design/canvas), merges the branches into `settings-regroup`, and runs the final checks
and one review.

## Rules every builder keeps

- AGENTS.md in full: strict TypeScript (no `any`, no `as`, no `!`, no suppressions), no backwards compatibility (delete
  what you replace; no aliases or shims), integration tests only, Storybook shows and never tests, logging and privacy
  rules, design system rules (one filled button per view, colour means one thing, no green, sentence case, icons from
  `Icon`).
- Copy is plain and short, as on the canvas. Never write a real person's name.
- Checks before you report: `pnpm check:structure`, `node scripts/check-types.mjs`, `pnpm --filter <package>
  typecheck` for every package you touched, `pnpm --filter @alcove/web build` if you touched the app, and the
  integration suites you touched. Run integration tests from `apps/api` with the env from `.env.example`
  (`set -a; . ../../.env.example; set +a`) and your own database:
  `TEST_DATABASE_URL=postgres://alcove:alcove@127.0.0.1:54329/alcove_test_<builder> pnpm exec vitest run <files>`.
  Never run root `pnpm test`, `pnpm check` or `pnpm dev` (they restart the shared Docker services).
- Look at what you built: Storybook (`pnpm --filter @alcove/storybook exec storybook dev --port <yours> --no-open --ci`;
  Kit 6121, Page 6122, Alerts 6123, Connections 6124) and screenshot your stories at 1440 and 390, light and dark, with
  Playwright from a scratch folder (never a repo dependency). Compare with the canvas screenshots.
- Commit small, signed (the repo's hooks sign), with clear messages; never push. Report what you built, what you
  checked, and anything left.
