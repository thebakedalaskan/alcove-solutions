# The call's timer

[Docs home](../README.md) · [Calls and recordings](calls-and-recordings.md) · [Data and storage](data-and-storage.md)

A call has one timer: a countdown the host starts for everyone, as in Google Meet. It's independent of a board's timer,
the breakout rooms' countdown, the workspace and anyone's own layout. There are no presets and no agenda of segments.

## Shared state and time

`CallState.timer` is `null` while none runs. Otherwise it has an `id` (this countdown, from its start until it's stopped), a
`revision`, its length with any time added (`durationSeconds`, up to a day), its `status` (`running` or `paused`), the
milliseconds it ran before its latest start (`elapsedMs`) and the server time it last started or resumed (`startedAt`, null
while paused).

While it runs, what's left is its length less `elapsedMs` and the time since `startedAt`, on the server's clock: each browser
anchors the call's `attention.serverNow` to its own monotonic clock and works the second out whenever it paints, rather than
counting down, so a tab in the background, a reconnect or a late join shows the same second as everyone else. Pausing
materializes the elapsed time and clears the anchor; resuming sets a new one. At zero it keeps running, over time, and every
button and popover says so (`+0:12`, over time, in caution with a warning sign as well as the colour). No timer action mutes
anyone or ends the call. Each browser that sees it reach zero plays a soft chime, under its Sounds settings' **Timers**.

## Who controls it, and concurrent presses

Only whoever hosts now (the organizer, or a stand-in while they're away) starts or changes it, through
`POST /v1/live/calls/:id/timer` with one of:

- `{ action: 'start', durationSeconds }`, only while none runs. A second start is refused, so two presses at once start one.
- `{ action: 'pause' | 'resume' | 'stop', expectedRevision }`. Stop clears it.
- `{ action: 'add-time', expectedRevision, seconds }`. Over time, the time added counts from the second it's on, so +1 min
  leaves a minute.

Everything but a start names the revision it was made against, and the call's row lock serializes them, so a stale or
repeated press is refused rather than applied twice. Admitted participants, guests included, read it from the call
snapshot; someone still waiting to be let in reads `null`. A host who handed over, or whose session ran out, is refused.

## Stored state and upgrade

The timer lives in the call's sealed state (`call-state`), as the contract's `CallTimerSchema`; a field added to it needs a
default. Call state sealed by the previous release kept `timerSequence`, an agenda of named segments with presenters,
stepped through by the host. It reads as the segment it was on: its ID, revision, length plus the time added to it, and its
clock, running or paused. A sequence that was ready to start or had finished, or one that doesn't read, reads as no timer.
The next save writes `timer` in its place, without the agenda's names. Older call state, from before there were timers,
reads as no timer. Key labels and the call-state header don't change.

Timer presets, an earlier release's private agendas in `timer_presets` (`timer-preset` records under the account's own
keys), are gone: nothing reads or writes them, and this release changes no table. Their rows stay, unread, while the previous
release may still serve (during the deploy, or after a rollback, when it can still write one); a later migration drops the
table, rows and all, once that release is gone. Until then, deleting an account deletes its presets with it (`owner_id`
cascades).

## Verification

`apps/api/src/features/calls/timers.integration.test.ts` drives it through the real API and client: starting, pausing,
adding time, resuming and stopping, one of two concurrent presses, over time and added time, the day's limit, malformed and
cross-site controls, permissions for waiting and admitted guests, invited people and a session that ran out, hand-off and
the organizer's return, reconnecting, a second API process, and reading the previous release's sealed sequences.
`notifications.integration.test.ts` covers its browser-notification warning and expiry. Storybook's **Calls / Timer** and
**Journeys / 6 In the call / Timer** show it as the app renders it.
