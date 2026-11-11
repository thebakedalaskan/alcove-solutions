# Call sounds

Alcove's sounds are short original sine-tone phrases synthesized by `apps/web/src/lib/audio-output.ts`.
They have no downloaded samples, third-party recordings or external asset licenses. The family uses a quiet
attack and a short falling envelope: microphone and people pairs rise for on/join and fall for off/leave;
hands and questions have different rising pairs; admissions use three notes. The call's timer and
incoming rings use the same output and preference gates. Each phrase lasts about 0.3–1.2 seconds.

| Cue | Who hears it |
| --- | --- |
| Microphone on/off | Only the person who successfully changed their local microphone. The common click/shortcut handler confirms actual state after the latest completed change. Failed, pending, superseded and unchanged requests do not confirm success. |
| Person joins/leaves | People already in the affected room, from the server's original audience. |
| Hand raised | The current host and people currently presenting in the same room, within the server-filtered cue audience. Only the host may also hear a hand asking for help from another room. Other peers keep the persistent visual queue. Lowering, clearing and reconnecting do not chime. |
| New question | The current host or a current presenter, only when already in that question’s permitted room audience. Other peers keep persistent question visuals. Hosting or presenting never grants access to questions outside that audience. Votes, pinning and resolving do not chime. |
| Private message | Only the intended recipient, for a newly authenticated private envelope. Reconnect history does not chime and no content or sender preview is exposed. The private-message category, master volume and quiet mode apply. |
| Request to join | The current host, once for that admission request. |
| Incoming call | The person being rung, once per ring. |

The server snapshots carry audience-filtered cue IDs, monotonic sequences and server timestamps.
Hand/question playback additionally requires `CallState.isHost` or a current presentation. The call passes
`presenting` from its actual local screen shares and `CallPresent.mine` for a workspace/board presentation.
The hook observes moderator changes, cancels queued playback when that status changes, and also reapplies
the gate at playback time. This policy never broadens the server-filtered room audience.
`useCallSounds` establishes a baseline on first join, reconnect, generation change and room change; it does
not replay history. Cues older than five seconds on the server clock are discarded. A snapshot gap over
twelve seconds is treated as a new baseline. Nothing audible is needed to use raised hands in People,
questions or admission controls. Nudges have no sound: their recipient is told by a quiet toast alone.

One browser output scheduler serializes phrases with at most four waiting cues, expiring after 0.7–1.2
seconds. Hand, question and people bursts coalesce by category with a 1.8-second cooldown; admission
requests have a 0.7-second cooldown. Microphone confirmations and admissions take priority, and a newer
microphone confirmation replaces a superseded confirmation. Per-category generations also invalidate a
phrase already awaiting output preparation: a late resume or speaker switch cannot play an earlier
microphone state or an older cue from a coalesced burst. A cross-tab output lock prevents overlapping
phrases where Web Locks are available. Leaving the call/room, reconnecting or changing preferences cancels pending and active phrases.
The output context is unlocked on a gesture and reused, including on Safari. A browser that blocks or
suspends playback drops the phrase after 200 ms instead of saving it until the next gesture. Speaker
switches also have a 200 ms bound; a pending switch detaches that output so it cannot reroute a later
phrase. A rejected device choice falls back to the system output. Only a ready output claims an event,
and only started phrases retain receipts, so a blocked tab does not claim silence for the other tabs. Receipts contain only opaque event IDs and timestamps, are limited to 128 entries and
expire from deduplication after fifteen seconds. Web Locks serialize cross-tab receipt claims; browsers
without Web Locks use a bounded localStorage receipt claim. If browser storage is unavailable, deduplication
can only be guaranteed inside the current tab.

The renderer plays through an output-only media stream and HTML audio element. It uses the call's chosen
speaker where `setSinkId` is supported, and the system output otherwise or when the chosen device is no
longer usable. It is never connected to a microphone, call publisher, capture graph, transcription or
recording mix. Browser/site mute and operating-system volume still apply. Play is an explicit press
and plays one cue at the chosen volume even with that cue's own tick off; it is unavailable while sounds are off, and
volume zero stays silent.

## Preferences and stored-data upgrade

Settings → Notifications and the call's More → Settings → Notifications offer Sounds (silence, volume, and Play,
which plays one cue at that volume; unavailable while sounds are off), Quiet mode, and a Sound tick per cue in What
reaches you. Quiet mode retains only your own microphone confirmations and host admission
requests, subject to their individual switches. Sound controls never ask for browser notification
permission. Guests use `alcove.guest.sounds`, validated with the contract's zod schema; an unreadable value
uses the defaults.

Signed-in preferences are in the existing sealed profile manifest. `PreferencesSchema.sounds` has
`.default(DEFAULT_SOUND_PREFERENCES)`, and each new sound preference also has a default. Profiles written
by the previous release open with sounds enabled, volume 0.55, quiet mode off and all categories enabled.
The next profile save writes that shape. There is no SQL migration, header change or key-label change.
The PATCH body explicitly makes sounds optional without the stored-record default so an unrelated
preference update cannot reset someone's sound choices. Public API integration coverage signs in,
changes sound preferences, reads them again, checks a different account and rejects an invalid volume.
