# Folder move and extraction map

Issue #144; baseline `04e377b9c44899c817d9c8f9b4f696441662a8fa`. The [ownership map](folder-ownership.md) was recorded in commit `0df036e9` before source moves. Public package exports and runtime/wire/stored formats are unchanged.

## Coherent extractions

| Previous owner | New owner / responsibility |
| --- | --- |
| `routes/call.$code.tsx: active-session guard` | `apps/web/src/features/call/session/CallPage.tsx` |
| `routes/call.$code.tsx: asShown, SOMEONE` | `apps/web/src/features/call/session/participants.ts` |
| `routes/call.$code.tsx: useSpeaking` | `apps/web/src/features/call/media/useSpeaking.ts` |
| `routes/call.$code.tsx: useWidth` | `apps/web/src/features/call/layout/useWidth.ts` |
| `routes/call.$code.tsx: room connection and shared marks lifecycle` | `apps/web/src/features/call/media/useCallRoom.ts` |
| `routes/call.$code.tsx: recorder/speech lifecycle, capture controls with hold/flush/rollback, displacement discard and move/leave/handoff departure protocols` | `apps/web/src/features/call/notes/useNotesCapture.ts` |
| `routes/call.$code.tsx: screen-note frames lifecycle` | `apps/web/src/features/call/notes/useScreenCapture.ts` |
| `features/call/media.ts: wakeAudio` | `apps/web/src/features/call/notes/audio.ts` |
| `features/call/media.ts: NotesRecorder and private recording/mixing helpers` | `apps/web/src/features/call/notes/recorder.ts` |
| `routes/call.$code.tsx: active-call composition; lifecycle concerns extracted` | `apps/web/src/features/call/session/InCall.tsx` |
| `routes/call.$code.tsx: breakout-room state, playback routing, transitions and controls` | `apps/web/src/features/call/rooms/useBreakoutRooms.ts` |
| `routes/call.$code.tsx: caption language menu and live caption presentation` | `apps/web/src/features/call/notes/CallCaptions.tsx` |
| `routes/call.$code.tsx: keyboard subscription and current action closures` | `apps/web/src/features/call/session/useCallShortcuts.ts` |
| `apps/api/src/app.ts` | `http/context.ts`, `body.ts`, `limits.ts`, `runtime.ts`, `middleware.ts`, `authorization.ts`, `receipts.ts`, `system-routes.ts`; feature-owned route registrars. `app.ts` is 43 lines of ordered composition. |
| `apps/api/src/modules/calls.ts` | `features/calls/{state,participants,mls-log,mls,notifications,read-model,insights,recording,joining,lifecycle,room-boards,permissions,workspace-actions,workspace-state,board-actions,service}.ts`. `service.ts` retains the transaction/action dispatcher and state entry. |
| `packages/api/src/types.ts` | `packages/api/src/calls/captions.ts`, `packages/api/src/calls/entry.ts`, `packages/api/src/calls/settings.ts`, `packages/api/src/calls/view.ts`, `packages/api/src/calls/workspace.ts`, `packages/api/src/credits/schema.ts`, `packages/api/src/identity/devices.ts`, `packages/api/src/identity/notifications.ts`, `packages/api/src/identity/people.ts`, `packages/api/src/identity/preferences.ts`, `packages/api/src/identity/session.ts`, `packages/api/src/meetings/calendar.ts`, `packages/api/src/meetings/schema.ts`, `packages/api/src/notes/entries.ts`, `packages/api/src/notes/schema.ts`, `packages/api/src/notes/screens.ts`, `packages/api/src/notes/series.ts`, `packages/api/src/notes/transcript.ts`, `packages/api/src/recordings/offline.ts`, `packages/api/src/shared/ids.ts`, `packages/api/src/trust/schema.ts`, `packages/api/src/workspaces/library.ts` |
| `packages/api/src/wire.ts` | `packages/api/src/calls/wire.ts`, `packages/api/src/identity/wire.ts`, `packages/api/src/meetings/wire.ts`, `packages/api/src/notes/wire.ts`, `packages/api/src/recordings/wire.ts`, `packages/api/src/shared/http.ts`, `packages/api/src/shared/validation.ts`, `packages/api/src/telemetry/wire.ts` |
| `packages/api/src/live.ts` | `packages/api/src/calls/session.ts`, `packages/api/src/calls/state.ts`, `packages/api/src/notes/progress.ts`, `packages/api/src/recordings/capture.ts`, `packages/api/src/recordings/schema.ts`, `packages/api/src/shared/live.ts` |
| `packages/api/src/client.ts` | `packages/api/src/calls/api.ts`, `packages/api/src/client.ts`, `packages/api/src/credits/api.ts`, `packages/api/src/errors.ts`, `packages/api/src/identity/api.ts`, `packages/api/src/meetings/api.ts`, `packages/api/src/notes/api.ts`, `packages/api/src/recordings/api.ts`, `packages/api/src/telemetry/api.ts`, `packages/api/src/trust/api.ts`, `packages/api/src/workspaces/api.ts` |
| `packages/api-http/src/index.ts` | `packages/api-http/src/account/api.ts`, `packages/api-http/src/calls/api.ts`, `packages/api-http/src/calls/session.ts`, `packages/api-http/src/meetings/api.ts`, `packages/api-http/src/notes/api.ts`, `packages/api-http/src/notes/personal.ts`, `packages/api-http/src/recordings/api.ts`, `packages/api-http/src/recordings/session.ts`, `packages/api-http/src/transport/audio.ts`, `packages/api-http/src/transport/diagnostics.ts`, `packages/api-http/src/transport/http.ts`, `packages/api-http/src/transport/ids.ts`, `packages/api-http/src/transport/live.ts`, `packages/api-http/src/transport/options.ts`, `packages/api-http/src/workspaces/api.ts` |

The notes owner keeps recorder/speech references private and exposes coordinated pause/displacement/departure protocols. Session composition keeps navigation, layout and feedback. The HTTP entry point is 27 lines of explicit feature-factory composition.

## Exact relocations

These are source relocations, not forwarding aliases. Old files are removed. A file that also supplied extracted declarations is listed above.

### Web

| Before | After |
| --- | --- |
| `apps/web/src/features/call/BoardMenu.tsx` | `apps/web/src/features/call/boards/BoardMenu.tsx` |
| `apps/web/src/features/call/BoardStage.tsx` | `apps/web/src/features/call/boards/BoardStage.tsx` |
| `apps/web/src/features/call/Capture.tsx` | `apps/web/src/features/call/notes/Capture.tsx` |
| `apps/web/src/features/call/CatchUp.tsx` | `apps/web/src/features/call/notes/CatchUp.tsx` |
| `apps/web/src/features/call/DevicePickers.tsx` | `apps/web/src/features/call/media/DevicePickers.tsx` |
| `apps/web/src/features/call/FromLastTime.tsx` | `apps/web/src/features/call/notes/FromLastTime.tsx` |
| `apps/web/src/features/call/Hosting.tsx` | `apps/web/src/features/call/rooms/Hosting.tsx` |
| `apps/web/src/features/call/LeaveSheet.tsx` | `apps/web/src/features/call/session/LeaveSheet.tsx` |
| `apps/web/src/features/call/LiveLines.tsx` | `apps/web/src/features/call/notes/LiveLines.tsx` |
| `apps/web/src/features/call/Panel.tsx` | `apps/web/src/features/call/layout/Panel.tsx` |
| `apps/web/src/features/call/PanelHost.tsx` | `apps/web/src/features/call/layout/PanelHost.tsx` |
| `apps/web/src/features/call/PlayTogether.tsx` | `apps/web/src/features/call/playback/PlayTogether.tsx` |
| `apps/web/src/features/call/Rooms.tsx` | `apps/web/src/features/call/rooms/Rooms.tsx` |
| `apps/web/src/features/call/SharePicker.tsx` | `apps/web/src/features/call/screen-sharing/SharePicker.tsx` |
| `apps/web/src/features/call/SharePointing.tsx` | `apps/web/src/features/call/screen-sharing/SharePointing.tsx` |
| `apps/web/src/features/call/ShareSurface.tsx` | `apps/web/src/features/call/screen-sharing/ShareSurface.tsx` |
| `apps/web/src/features/call/SpacePicker.tsx` | `apps/web/src/features/call/workspace/SpacePicker.tsx` |
| `apps/web/src/features/call/Stage.tsx` | `apps/web/src/features/call/layout/Stage.tsx` |
| `apps/web/src/features/call/TileMenu.tsx` | `apps/web/src/features/call/layout/TileMenu.tsx` |
| `apps/web/src/features/call/TopBar.tsx` | `apps/web/src/features/call/layout/TopBar.tsx` |
| `apps/web/src/features/call/Video.tsx` | `apps/web/src/features/call/media/Video.tsx` |
| `apps/web/src/features/call/VideoQuality.tsx` | `apps/web/src/features/call/media/VideoQuality.tsx` |
| `apps/web/src/features/call/ViewMenu.tsx` | `apps/web/src/features/call/layout/ViewMenu.tsx` |
| `apps/web/src/features/call/WorkspaceAsks.tsx` | `apps/web/src/features/call/workspace/WorkspaceAsks.tsx` |
| `apps/web/src/features/call/WorkspacePanel.tsx` | `apps/web/src/features/call/workspace/WorkspacePanel.tsx` |
| `apps/web/src/features/call/Yours.tsx` | `apps/web/src/features/call/notes/Yours.tsx` |
| `apps/web/src/features/call/access.ts` | `apps/web/src/features/call/media/access.ts` |
| `apps/web/src/features/call/boardPresenting.ts` | `apps/web/src/features/call/boards/boardPresenting.ts` |
| `apps/web/src/features/call/boardRun.ts` | `apps/web/src/features/call/boards/boardRun.ts` |
| `apps/web/src/features/call/callBoard.ts` | `apps/web/src/features/call/boards/callBoard.ts` |
| `apps/web/src/features/call/captions.ts` | `apps/web/src/features/call/notes/captions.ts` |
| `apps/web/src/features/call/catchingUp.ts` | `apps/web/src/features/call/notes/catchingUp.ts` |
| `apps/web/src/features/call/devices.ts` | `apps/web/src/features/call/media/devices.ts` |
| `apps/web/src/features/call/frames.ts` | `apps/web/src/features/call/notes/frames.ts` |
| `apps/web/src/features/call/links.tsx` | `apps/web/src/features/call/session/links.tsx` |
| `apps/web/src/features/call/liveCall.ts` | `apps/web/src/features/call/notes/liveCall.ts` |
| `apps/web/src/features/call/livekit.ts` | `apps/web/src/features/call/media/livekit.ts` |
| `apps/web/src/features/call/marks.ts` | `apps/web/src/features/call/screen-sharing/marks.ts` |
| `apps/web/src/features/call/media.ts` | `apps/web/src/features/call/media/media.ts` |
| `apps/web/src/features/call/opening.ts` | `apps/web/src/features/call/session/opening.ts` |
| `apps/web/src/features/call/panels.ts` | `apps/web/src/features/call/layout/panels.ts` |
| `apps/web/src/features/call/pass.ts` | `apps/web/src/features/call/session/pass.ts` |
| `apps/web/src/features/call/popOut.ts` | `apps/web/src/features/call/screen-sharing/popOut.ts` |
| `apps/web/src/features/call/presenting.ts` | `apps/web/src/features/call/workspace/presenting.ts` |
| `apps/web/src/features/call/screenGrid.ts` | `apps/web/src/features/call/screen-sharing/screenGrid.ts` |
| `apps/web/src/features/call/seen.ts` | `apps/web/src/features/call/session/seen.ts` |
| `apps/web/src/features/call/share.ts` | `apps/web/src/features/call/screen-sharing/share.ts` |
| `apps/web/src/features/call/shareFrame.ts` | `apps/web/src/features/call/screen-sharing/shareFrame.ts` |
| `apps/web/src/features/call/shareLook.ts` | `apps/web/src/features/call/screen-sharing/shareLook.ts` |
| `apps/web/src/features/call/sharedVideo.ts` | `apps/web/src/features/call/playback/sharedVideo.ts` |
| `apps/web/src/features/call/speakers.ts` | `apps/web/src/features/call/media/speakers.ts` |
| `apps/web/src/features/call/speech.ts` | `apps/web/src/features/call/notes/speech.ts` |
| `apps/web/src/features/call/stageLayout.ts` | `apps/web/src/features/call/layout/stageLayout.ts` |
| `apps/web/src/features/call/videoSource.ts` | `apps/web/src/features/call/media/videoSource.ts` |
| `apps/web/src/features/call/view.ts` | `apps/web/src/features/call/layout/view.ts` |
| `apps/web/src/features/call/volume.ts` | `apps/web/src/features/call/media/volume.ts` |
| `apps/web/src/features/calls/CallFlow.tsx` | `apps/web/src/features/calls/flow/CallFlow.tsx` |
| `apps/web/src/features/calls/Card.tsx` | `apps/web/src/features/calls/list/Card.tsx` |
| `apps/web/src/features/calls/Details.tsx` | `apps/web/src/features/calls/flow/Details.tsx` |
| `apps/web/src/features/calls/Documents.tsx` | `apps/web/src/features/calls/flow/Documents.tsx` |
| `apps/web/src/features/calls/Lobby.tsx` | `apps/web/src/features/calls/lobby/Lobby.tsx` |
| `apps/web/src/features/calls/LobbyRing.tsx` | `apps/web/src/features/calls/lobby/LobbyRing.tsx` |
| `apps/web/src/features/calls/PickTime.tsx` | `apps/web/src/features/calls/scheduling/PickTime.tsx` |
| `apps/web/src/features/calls/PickTimeCalendar.ts` | `apps/web/src/features/calls/scheduling/PickTimeCalendar.ts` |
| `apps/web/src/features/calls/RingHost.tsx` | `apps/web/src/features/calls/ringing/RingHost.tsx` |
| `apps/web/src/features/calls/RingSound.ts` | `apps/web/src/features/calls/ringing/RingSound.ts` |
| `apps/web/src/features/calls/RingWords.ts` | `apps/web/src/features/calls/ringing/RingWords.ts` |
| `apps/web/src/features/calls/When.tsx` | `apps/web/src/features/calls/flow/When.tsx` |
| `apps/web/src/features/calls/Who.tsx` | `apps/web/src/features/calls/flow/Who.tsx` |
| `apps/web/src/features/calls/addresses.ts` | `apps/web/src/features/calls/scheduling/addresses.ts` |
| `apps/web/src/features/calls/availability.ts` | `apps/web/src/features/calls/scheduling/availability.ts` |
| `apps/web/src/features/calls/draft.ts` | `apps/web/src/features/calls/flow/draft.ts` |
| `apps/web/src/features/calls/parts.tsx` | `apps/web/src/features/calls/flow/parts.tsx` |
| `apps/web/src/features/calls/times.ts` | `apps/web/src/features/calls/scheduling/times.ts` |
| `apps/web/src/features/calls/words.ts` | `apps/web/src/features/calls/scheduling/words.ts` |

### Server

| Before | After |
| --- | --- |
| `apps/api/src/modules/access.ts` | `apps/api/src/features/meetings/access.ts` |
| `apps/api/src/modules/account.ts` | `apps/api/src/features/account/account.ts` |
| `apps/api/src/modules/additions.ts` | `apps/api/src/features/notes/additions.ts` |
| `apps/api/src/modules/audio.ts` | `apps/api/src/features/recordings/audio.ts` |
| `apps/api/src/modules/backing.ts` | `apps/api/src/features/notes/backing.ts` |
| `apps/api/src/modules/billing.ts` | `apps/api/src/features/billing/service.ts` |
| `apps/api/src/modules/calendar.ts` | `apps/api/src/features/meetings/calendar.ts` |
| `apps/api/src/modules/callBoards.ts` | `apps/api/src/features/calls/boards.ts` |
| `apps/api/src/modules/callSpace.ts` | `apps/api/src/features/calls/space-state.ts` |
| `apps/api/src/modules/callWorkspace.ts` | `apps/api/src/features/calls/workspace.ts` |
| `apps/api/src/modules/calls.ts` | `apps/api/src/features/calls/service.ts` |
| `apps/api/src/modules/capture.ts` | `apps/api/src/features/calls/capture.ts` |
| `apps/api/src/modules/catchup.ts` | `apps/api/src/features/calls/catchup.ts` |
| `apps/api/src/modules/codes.ts` | `apps/api/src/features/meetings/codes.ts` |
| `apps/api/src/modules/documentFirewall.ts` | `apps/api/src/features/workspaces/document-firewall.ts` |
| `apps/api/src/modules/documentOps.ts` | `apps/api/src/features/workspaces/document-ops.ts` |
| `apps/api/src/modules/documentText.ts` | `apps/api/src/features/workspaces/document-text.ts` |
| `apps/api/src/modules/documentWork.ts` | `apps/api/src/features/workspaces/document-work.ts` |
| `apps/api/src/modules/documents.ts` | `apps/api/src/features/workspaces/library.ts` |
| `apps/api/src/modules/drafting.ts` | `apps/api/src/features/notes/drafting.ts` |
| `apps/api/src/modules/heldRooms.ts` | `apps/api/src/features/calls/held-rooms.ts` |
| `apps/api/src/modules/hosting.ts` | `apps/api/src/features/calls/hosting.ts` |
| `apps/api/src/modules/invites.ts` | `apps/api/src/features/meetings/invites.ts` |
| `apps/api/src/modules/liveNotes.ts` | `apps/api/src/features/calls/live-notes.ts` |
| `apps/api/src/modules/media.ts` | `apps/api/src/features/workspaces/media.ts` |
| `apps/api/src/modules/meetings.ts` | `apps/api/src/features/meetings/service.ts` |
| `apps/api/src/modules/moves.ts` | `apps/api/src/features/calls/moves.ts` |
| `apps/api/src/modules/notes.ts` | `apps/api/src/features/notes/service.ts` |
| `apps/api/src/modules/people.ts` | `apps/api/src/features/account/people.ts` |
| `apps/api/src/modules/personal.ts` | `apps/api/src/features/notes/personal.ts` |
| `apps/api/src/modules/photos.ts` | `apps/api/src/features/account/photos.ts` |
| `apps/api/src/modules/places.ts` | `apps/api/src/features/calls/places.ts` |
| `apps/api/src/modules/portraits.ts` | `apps/api/src/features/account/portraits.ts` |
| `apps/api/src/modules/presenterNotes.ts` | `apps/api/src/features/workspaces/presenter-notes.ts` |
| `apps/api/src/modules/recordings.ts` | `apps/api/src/features/recordings/service.ts` |
| `apps/api/src/modules/repeats.ts` | `apps/api/src/features/meetings/repeats.ts` |
| `apps/api/src/modules/rings.ts` | `apps/api/src/features/calls/rings.ts` |
| `apps/api/src/modules/screens.ts` | `apps/api/src/features/recordings/screens.ts` |
| `apps/api/src/modules/scribes.ts` | `apps/api/src/features/calls/scribes.ts` |
| `apps/api/src/modules/series.ts` | `apps/api/src/features/notes/series.ts` |
| `apps/api/src/modules/transcripts.ts` | `apps/api/src/features/recordings/transcripts.ts` |
| `apps/api/src/modules/workedOn.ts` | `apps/api/src/features/notes/worked-on.ts` |
| `apps/api/src/modules/workspaceAccess.ts` | `apps/api/src/features/workspaces/access.ts` |
| `apps/api/src/modules/workspaceDocuments.ts` | `apps/api/src/features/workspaces/documents.ts` |
| `apps/api/src/modules/workspaceMentions.ts` | `apps/api/src/features/workspaces/mentions.ts` |
| `apps/api/src/modules/workspaces.ts` | `apps/api/src/features/workspaces/service.ts` |
| `apps/api/src/modules/writer.ts` | `apps/api/src/features/notes/writer.ts` |

### Integration suites

| Before | After |
| --- | --- |
| `apps/api/src/availability.integration.test.ts` | `apps/api/src/features/meetings/availability.integration.test.ts` |
| `apps/api/src/board-at-once.integration.test.ts` | `apps/api/src/features/workspaces/board-at-once.integration.test.ts` |
| `apps/api/src/board-more.integration.test.ts` | `apps/api/src/features/workspaces/board-more.integration.test.ts` |
| `apps/api/src/board-timer-votes.integration.test.ts` | `apps/api/src/features/calls/board-timer-votes.integration.test.ts` |
| `apps/api/src/boardHelps.integration.test.ts` | `apps/api/src/features/calls/boardHelps.integration.test.ts` |
| `apps/api/src/boards-in-calls.integration.test.ts` | `apps/api/src/features/calls/boards-in-calls.integration.test.ts` |
| `apps/api/src/boards.integration.test.ts` | `apps/api/src/features/workspaces/boards.integration.test.ts` |
| `apps/api/src/boardsAfter.integration.test.ts` | `apps/api/src/features/calls/boardsAfter.integration.test.ts` |
| `apps/api/src/callHomes.integration.test.ts` | `apps/api/src/features/calls/callHomes.integration.test.ts` |
| `apps/api/src/callWorkspace.integration.test.ts` | `apps/api/src/features/calls/callWorkspace.integration.test.ts` |
| `apps/api/src/calls.integration.test.ts` | `apps/api/src/features/calls/calls.integration.test.ts` |
| `apps/api/src/capture.integration.test.ts` | `apps/api/src/features/calls/capture.integration.test.ts` |
| `apps/api/src/carryover.integration.test.ts` | `apps/api/src/features/notes/carryover.integration.test.ts` |
| `apps/api/src/catchup.integration.test.ts` | `apps/api/src/features/calls/catchup.integration.test.ts` |
| `apps/api/src/connections.integration.test.ts` | `apps/api/src/features/meetings/connections.integration.test.ts` |
| `apps/api/src/decisions.integration.test.ts` | `apps/api/src/features/notes/decisions.integration.test.ts` |
| `apps/api/src/flows.integration.test.ts` | `apps/api/src/integration/flows.integration.test.ts` |
| `apps/api/src/guests.integration.test.ts` | `apps/api/src/features/calls/guests.integration.test.ts` |
| `apps/api/src/hearIt.integration.test.ts` | `apps/api/src/features/calls/hearIt.integration.test.ts` |
| `apps/api/src/hosting.integration.test.ts` | `apps/api/src/features/calls/hosting.integration.test.ts` |
| `apps/api/src/invited.integration.test.ts` | `apps/api/src/features/meetings/invited.integration.test.ts` |
| `apps/api/src/keep.integration.test.ts` | `apps/api/src/features/notes/keep.integration.test.ts` |
| `apps/api/src/library.integration.test.ts` | `apps/api/src/features/workspaces/library.integration.test.ts` |
| `apps/api/src/liveNotes.integration.test.ts` | `apps/api/src/features/calls/liveNotes.integration.test.ts` |
| `apps/api/src/media.integration.test.ts` | `apps/api/src/features/workspaces/media.integration.test.ts` |
| `apps/api/src/migrations.integration.test.ts` | `apps/api/src/integration/migrations.integration.test.ts` |
| `apps/api/src/moves.integration.test.ts` | `apps/api/src/features/calls/moves.integration.test.ts` |
| `apps/api/src/nextRelease.integration.test.ts` | `apps/api/src/integration/nextRelease.integration.test.ts` |
| `apps/api/src/personal.integration.test.ts` | `apps/api/src/features/notes/personal.integration.test.ts` |
| `apps/api/src/pointing.integration.test.ts` | `apps/api/src/features/calls/pointing.integration.test.ts` |
| `apps/api/src/repeats.integration.test.ts` | `apps/api/src/features/meetings/repeats.integration.test.ts` |
| `apps/api/src/rings.integration.test.ts` | `apps/api/src/features/calls/rings.integration.test.ts` |
| `apps/api/src/screens.integration.test.ts` | `apps/api/src/features/recordings/screens.integration.test.ts` |
| `apps/api/src/series.integration.test.ts` | `apps/api/src/features/notes/series.integration.test.ts` |
| `apps/api/src/transcripts.integration.test.ts` | `apps/api/src/features/recordings/transcripts.integration.test.ts` |
| `apps/api/src/workspaceDocuments.integration.test.ts` | `apps/api/src/features/workspaces/workspaceDocuments.integration.test.ts` |
| `apps/api/src/workspaceTags.integration.test.ts` | `apps/api/src/features/workspaces/workspaceTags.integration.test.ts` |
| `apps/api/src/workspaces.integration.test.ts` | `apps/api/src/features/workspaces/workspaces.integration.test.ts` |

### Contracts and HTTP client

| Before | After |
| --- | --- |
| `packages/api-http/src/media.ts` | `packages/api-http/src/workspaces/media.ts` |
| `packages/api-http/src/mls.ts` | `packages/api-http/src/calls/mls.ts` |
| `packages/api-http/src/moves.ts` | `packages/api-http/src/calls/moves.ts` |
| `packages/api-http/src/rings.ts` | `packages/api-http/src/calls/rings.ts` |
| `packages/api-http/src/workspaceDocuments.ts` | `packages/api-http/src/workspaces/documents.ts` |
| `packages/api-http/src/workspaces.ts` | `packages/api-http/src/workspaces/live.ts` |
| `packages/api/src/callBoards.ts` | `packages/api/src/calls/boards.ts` |
| `packages/api/src/callWorkspace.ts` | `packages/api/src/calls/workspace.ts` |
| `packages/api/src/capture.ts` | `packages/api/src/calls/capture.ts` |
| `packages/api/src/catchup.ts` | `packages/api/src/calls/catchup.ts` |
| `packages/api/src/grants.ts` | `packages/api/src/notes/grants.ts` |
| `packages/api/src/marks.ts` | `packages/api/src/calls/marks.ts` |
| `packages/api/src/media.ts` | `packages/api/src/workspaces/media.ts` |
| `packages/api/src/moves.ts` | `packages/api/src/calls/moves.ts` |
| `packages/api/src/personal.ts` | `packages/api/src/notes/personal.ts` |
| `packages/api/src/retire.ts` | `packages/api/src/workspaces/retire.ts` |
| `packages/api/src/rings.ts` | `packages/api/src/calls/rings.ts` |
| `packages/api/src/workspaceDocuments.ts` | `packages/api/src/workspaces/documents.ts` |
| `packages/api/src/workspaceEditor.ts` | `packages/api/src/workspaces/editor.ts` |
| `packages/api/src/workspaces.ts` | `packages/api/src/workspaces/schema.ts` |
| `packages/api/src/zod.ts` | `packages/api/src/shared/zod.ts` |

## Verification record

- Independent review compared original and extracted behavior, including capture cleanup/rollback and StrictMode room reuse.
- All 38 suites retain their test bodies and assertions. Imports moved; the migrations suite's `import.meta.url` path gained the required directory traversal. That path failure was reproduced and both migration flows passed after the correction.
- AST comparison preserved all 212 original calls declarations, all 196 HTTP registrations including complete callbacks in their original order, and all 46 other moved server modules' declaration bodies.
- Contract comparison preserved 973 declarations, including 341 schema declarations and 15 feature-interface bodies, with zero differences. All 736 public contract names and 443 runtime exports remain available; HTTP exports and all 15 namespaces remain available.
- Structure policy rejects 22 temporary negative probes covering flat roots, retired buckets, undocumented owners, folder barrels, generic helper buckets, package-direction bypasses and inline entrypoint behavior. No isolated test suite or test dependency was added.
- Existing recursive Vitest/type/test-policy discovery stays unchanged; all 37 existing CI timing keys were updated with their suites (the remaining suite keeps its existing default estimate).
- Vitest discovery preserves all 1,132 listed cases across 38 suites. CI shard plans contain 47 unique units and assign every listed case exactly once.
- Manual browser verification passed local demo sign-in, workspace/document creation and saved-content reopen, muted/camera-off call join, in-call workspace display and end-call cleanup. The preview used a separate database and loopback hostname to avoid other local sessions. Camera/microphone capture and multi-person browser interactions were not exercised manually; existing real LiveKit integration flows cover the media protocol.
- Both unmodified baseline and refactored source passed all 38 suites and 1,133 tests. Full refactored `pnpm check` passed all 11 tasks, including typing and builds. The final structure guard passed again after the policy audit. Details are recorded in the implementation plan.


## Integration of newer main

Main `b7f61754221b34b160dc4a524de9138859cb89ad` added camera backgrounds, popup Google sign-in and scoped agent/MCP access while this overhaul was being verified. Their implementations are preserved and placed under the amended owners. Original validation results above refer to the initial refactor stage; the combined branch is verified separately before merging.

| Incoming main path | Owned path |
| --- | --- |
| `apps/web/src/features/call/BackgroundOptions.tsx` | `apps/web/src/features/call/media/backgrounds/BackgroundOptions.tsx` |
| `apps/web/src/features/call/backdrop.ts` | `apps/web/src/features/call/media/backgrounds/backdrop.ts` |
| `apps/web/src/features/call/backgrounds.ts` | `apps/web/src/features/call/media/backgrounds/backgrounds.ts` |
| `apps/web/src/features/call/matte.ts` | `apps/web/src/features/call/media/backgrounds/matte.ts` |
| `apps/web/src/features/call/matteGl.ts` | `apps/web/src/features/call/media/backgrounds/matteGl.ts` |
| `apps/api/src/mcp/operations.ts` | `apps/api/src/features/agents/mcp/operations.ts` |
| `apps/api/src/mcp/server.ts` | `apps/api/src/features/agents/mcp/server.ts` |
| `apps/api/src/mcp/tools.ts` | `apps/api/src/features/agents/mcp/tools.ts` |
| `apps/api/src/modules/agentOAuth.ts` | `apps/api/src/features/agents/oauth.ts` |
| `apps/api/src/modules/agents.ts` | `apps/api/src/features/agents/service.ts` |
| `packages/api/src/agentOAuth.ts` | `packages/api/src/agents/oauth.ts` |
| `packages/api/src/agentTools.ts` | `packages/api/src/agents/tools.ts` |
| `packages/api/src/agents.ts` | `packages/api/src/agents/schema.ts` |
| `packages/api/src/googleSignIn.ts` | `packages/api/src/identity/google-sign-in.ts` |
| `apps/api/src/agents.integration.test.ts` | `apps/api/src/features/agents/agents.integration.test.ts` |
| `apps/api/src/mcp.integration.test.ts` | `apps/api/src/features/agents/mcp.integration.test.ts` |

Frozen-main comparison preserved all 212 ordered HTTP registrations and callbacks, nine server module bodies, eight security helpers, 77 incoming contract declarations, and 41 incoming web/Storybook source/config/doc files. All 736 original and 71 new upstream public contract names remain available (807 total). The incoming migration and lockfile are byte-identical to main. Existing agent suites and popup-auth assertions are retained verbatim apart from import locations.
