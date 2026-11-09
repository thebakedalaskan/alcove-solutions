# Folder ownership

This is the target map for [#144](https://github.com/thebakedalaskan/the-privacy-suite/issues/144), recorded before files move. It is also the rule for new code. Organize around the behavior a maintainer changes, with a small explicit interface and the implementation and integration coverage beside it.

## Package responsibilities

| Location | Owns |
| --- | --- |
| `apps/web/src/routes` | Router declarations and page composition. A route delegates to its feature; it does not own call connections, recorders, subscriptions or capture pipelines. |
| `apps/web/src/features/call` | An active call: session lifecycle, media, screen sharing, layout, notes/capture, rooms, workspaces, boards and playback. |
| `apps/web/src/features/calls` | Making, scheduling, listing and entering calls: flow, scheduling, lobby, ringing and list presentation. |
| `apps/web/src/lib` | App-wide API construction, query definitions, logging and shared browser infrastructure. |
| `apps/api/src/features` | Feature behavior, HTTP registration and feature integration suites. The owners are account, agents, meetings, calls, notes, recordings, workspaces and billing. |
| `apps/api/src/http` | Shared HTTP types, request parsing, middleware and request limits. |
| `apps/api/src/testing` | Shared integration harness and external-provider fixtures, never production behavior. |
| `apps/api/src/integration` | Flows that intentionally exercise several features and service infrastructure. |
| `apps/api/src/live` | Shared realtime transport, document workers and their build entry points. |
| `packages/api/src` | Contracts only. Feature schemas, types, wire shapes and API interfaces; `client.ts` composes `AlcoveApi`. |
| `packages/api-http/src` | HTTP transport and browser implementations grouped by account, meetings, calls, notes, recordings and workspaces. `index.ts` constructs the client. |
| `packages/ui`, `packages/board` | Reusable visuals and shared board document logic, respectively. Their package responsibilities do not change. |

## Target feature layout

```text
apps/web/src/features/
  call/
    session/         connection ownership, the call screen's composition (InCall.tsx), its keys, lifecycle helpers
    media/           local devices, LiveKit, tracks, speaking and video
    screen-sharing/  what can be shared, a share in its frame (ShareInFrame.tsx), looking closer, marks and pop-out
    layout/          the shell, room/private chat presentation and audience drafts: top bar and View, your side (side.ts), what's on your stage (onStage.ts) in its frame
                     (frame.tsx), the people, Share's steps (ShareMenu.tsx), the keys sheet and layout state
    notes/           recorder, live transcript, captions and catch-up
    rooms/           breakout-room controls and hosting
    workspace/       choosing/accessing/presenting the call workspace
    boards/          the board in the call: its session, picker (BoardPicker.tsx), presenting, timer and vote
    playback/        synchronized media
  calls/
    flow/            making a call and its details
    scheduling/      choosing times and availability
    lobby/           entry checks and joining
    ringing/         incoming-call UI and sound
    list/            call cards
apps/api/src/
  app.ts             shared middleware and feature-route composition
  features/
    account/         account, people and photos
    agents/          scoped agent grants, OAuth, MCP operations and tools
    meetings/        schedule, invitations, calendar and repeats
    calls/           active-call lifecycle, state, rooms, MLS and notes/capture
    notes/           saved notes, additions, personal notes, series and writing
    recordings/      audio, screen frames, transcripts and room recordings
    workspaces/      tree, access, documents, media and mentions
    billing/         service accounting
  http/              shared request infrastructure
  integration/       cross-feature and infrastructure suites
  live/              shared realtime/worker infrastructure
  testing/           shared fixtures
packages/api/src/
  client.ts          aggregate interface
  errors.ts          shared client errors
  identity/ agents/ meetings/ calls/ notes/ recordings/ workspaces/
  trust/ credits/ telemetry/ shared/
packages/api-http/src/
  index.ts           public exports and client composition
  transport/         request, parse, stream and client options
  account/ agents/ meetings/ calls/ notes/ recordings/ workspaces/
```

Exact filenames follow the responsibility they implement; this map is not a request to fill every directory with scaffolding. Existing shared API infrastructure (`db`, `crypto`, `owners`, `sessions`, `objects`, configuration, logging, inference, attestation and maintenance) keeps its deliberately stable location. Server, migration, limits CLI and document-worker entry paths stay stable.

## Rules for every change

1. Identify the owning feature before adding a file. Put its implementation, private types and helpers there. A helper used by only one feature belongs to that feature even when its name sounds general.
2. In the active call and scheduling features, choose the existing subfeature directory. Do not add another loose file at either root. Add a new directory only for a distinct responsibility and document its ownership here.
3. A route, app entry point or client factory composes feature behavior. A new connection, recorder, polling loop, HTTP handler or lifecycle belongs in its owner, not in the composition file. Extract coherent behavior with explicit inputs and cleanup; do not just relocate a giant entry point.
4. Keep a feature's integration suites beside its server implementation. Use `integration/` only for genuinely cross-feature or infrastructure flows. Keep reusable fixtures in `testing/`; never copy a fixture into several features.
5. Import the owning file directly inside a package. Do not add a folder `index.ts`, a wildcard export tree, a forwarding file at an old path or a second name for the same behavior. Deliberate package entry points remain supported: `@alcove/api`, `@alcove/api/retire`, `@alcove/api-http` and the existing UI/board entry points.
6. Avoid `utils`, `common`, `misc` and undifferentiated `helpers` directories. Shared code needs a concrete responsibility and real callers in more than one feature. Do not introduce a generic abstraction for a single implementation or split a file merely to meet a line count.
7. Preserve the app's backend access through `lib/api.ts`, its TanStack query layer, and `LiveStore`/`useLive` ownership. Contract packages cannot import runtime implementations or apps; reusable UI cannot import apps. Browser HTTP implementations do not depend on app internals.
8. A move updates every consumer in the same change: direct imports, package export targets, worker/assets, Storybook's existing imports, build outputs, CI timing keys, policy scans and documentation. Delete the old path. Renaming source never renames persisted record kinds, key labels, SQL tables, migrations, wire fields or routes.
9. Review ownership before expanding an orchestration file. The relevant questions are whether callers need to understand fewer moving parts and whether a change and its verification stay local. File size alone is neither a reason to extract nor a reason to keep unrelated behavior together.
10. Run `pnpm check` for each completed stage. Nested files remain inside the same strict type, test and privacy enforcement. Preserve integration-only coverage and every test's assertions. Verify affected call/workspace composition manually without introducing browser tests.

## Automated enforcement

`pnpm check:structure` runs in local checks and CI. It protects feature homes, composition entry points, package direction and deliberate exports. It must reject violations with the owning path and a useful explanation. Change the policy only when the ownership decision changes, update this document and the scoped `AGENTS.md` in the same change, and explain why. Never add an allowlist entry just to silence a failure.

Review still checks responsibilities, lifecycle ordering and whether an extraction earns its interface. A static guard cannot judge those decisions.

Prefer the codebase knowledge graph for discovery. Check the index's excluded-directory report: a graph result with no matches is insufficient when it skipped a documented source home (notably a directory named `media` or `integration`). Use the map to read that owner directly or fall back to source search; never infer that implementation or coverage is absent from an incomplete index.

## Refactor verification

The implementation plan and completed move/extraction inventory live in `docs/superpowers/plans/2026-11-06-feature-structure.md` and `docs/engineering/folder-move-map.md`. This reorganization changes no public wire shapes, stored formats, migrations or data. The existing real API/client integration flows cover access, encryption, deletion, reconnects and storage; no isolated function or browser tests are introduced.

## Integration with newer main

Before integrating main `b7f61754221b34b160dc4a524de9138859cb89ad`, the new agent feature is assigned to `apps/api/src/features/agents` (including its `mcp/` implementation), `packages/api/src/agents` and `packages/api-http/src/agents`. Its complete integration suites live beside that server owner. Camera background implementation belongs in `apps/web/src/features/call/media/backgrounds`; its existing UI assets stay in `packages/ui/src/backgrounds`. Google sign-in contract additions belong to `packages/api/src/identity`. Preserve the upstream implementations, stored formats and migration `0017_agent_grants.sql` byte-for-byte while adapting source ownership and composition.
