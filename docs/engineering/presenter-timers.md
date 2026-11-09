# Presenter timer sequences

[Issue #84](https://github.com/thebakedalaskan/the-privacy-suite/issues/84) adds a call-wide agenda of timed presenter slots. It is independent of the board timer, breakout-room countdown, workspace and personal layout.

## Shared state and time

`CallState.timerSequence` contains ordered segment definitions, a revision, the active index, status, accumulated elapsed milliseconds, a server start anchor and added time. A segment has an opaque ID, a label, a duration in seconds and optional presenter text. An absent sequence is `null`.

While running, elapsed time is accumulated time plus the difference between server time and the start anchor. Browsers display that clock rather than decrementing a counter. Pausing materializes elapsed time and clears the anchor; resuming gives it a new anchor. Expiry remains running and displays over time. Only an explicit host command advances to another slot. No timer action mutes a participant or ends the call.

Late joiners and reconnecting clients read the existing sequence from the call snapshot. Nothing depends on the host keeping a tab active. Existing call host handoff determines who may control it after a disconnect.

## Access and concurrent commands

Only an authorized host changes the sequence or controls its timer. Admitted participants, including guests, receive its display state through the existing call access boundary. A waiting participant receives no sequence details.

Commands carry the timer revision they were made against. Existing call locking serializes changes and refuses a stale revision, so simultaneous Next commands cannot skip two presenters. Once started, completed and active segments are protected from definition edits; editing the future preserves the active clock. Restarting resets the current slot deliberately, while adding time changes its allowance without resetting elapsed time.

## Presets

Timer presets belong to the signed-in account. They contain a name and segment definitions, never a running clock, elapsed time, active position or overrun. Listing, updating and deleting are scoped to the request owner; guessing another account’s ID grants no access. Updates carry the preset revision to refuse stale overwrites.

Applying a preset copies its definitions into a fresh sequence. Editing a call changes only its copy. Saving back is an explicit update; renaming, duplicating or deleting a preset cannot change a running call.

Preset names, slot labels and presenter text are sealed records. Logs contain only identifiers, revisions, states and counts. Account deletion physically removes owned presets through the owner relationship. Preset mutations do not retain content-bearing operation receipts, so removing a preset leaves no replayable receipt copy.

## Upgrade and verification

The new call-state field defaults to `null`, so records sealed by the previous release still open and acquire the new shape on their next save. Existing key labels and call-state headers stay unchanged. Preset storage is introduced with additive migration `0019_timer_presets.sql`; no existing row is rewritten or removed during deployment.

Colocated public API/client integration flows cover creation and editing, presets and fresh call copies, permissions and owner isolation, timer transitions and overrun, concurrent commands, reconnects, and previous-release stored state. Privacy verification checks stored bytes and logs. Storybook renders the actual UI; keyboard, themes, small screens and working-content layouts are verified manually.
