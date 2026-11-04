# Calls and recordings

[Docs home](../README.md) · [System architecture](system-architecture.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md) · [Notes and inference](notes-and-inference.md)

Notes are a service of the call, not a bot in it. This page covers how a call and a room recording turn
into encrypted audio and a live transcript, and how stopping hands them to the notes service.

## Call lifecycle

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    participant D as Postgres
    participant O as Object store
    participant N as NEAR AI Cloud
    B->>A: POST /v1/calls (start now) or schedule a meeting
    B->>B: Pre-join: getUserMedia, mic and camera
    B->>A: POST /v1/calls/:code/join {mic, cam}
    A->>D: calls row (state ciphertext); meeting revision → live
    opt the meeting has notes on
      A->>D: note item (status recording) + recording with wrapped Krec
    end
    loop every 5 seconds while notes are on
      B->>A: POST /v1/live/calls/:id/audio (segment, seq, bytes)
      A->>O: sealed audio record under a random object ID
      A->>O: read back, verify length and SHA-256
      A->>D: recording_pieces row
    end
    loop each clip of speech while notes are on
      B->>A: POST /v1/live/calls/:id/transcribe (16 kHz WAV, segment, start)
      A->>N: speech to text, sealed to the verified model
      A->>D: sealed transcript_clips row
    end
    B->>A: POST /v1/live/calls/:id/leave (after sending the last audio and speech)
    A->>D: call ended; recording stopped; transcript into the note; note → pending; job queued; meeting → ended
    A->>A: notes worker writes the notes
```

- **Who controls notes.** Notes start on when the call was scheduled with them; otherwise nothing is
  recorded until they're turned on. Only the organizer turns them on and off
  (`POST /v1/live/calls/:id/actions` with `{type: "notes", on}`), and each change adds a notice shown in
  the call.
- **Segments.** Turning notes off pauses the recording. Turning them on again starts segment `n+1`. Each
  segment is one continuous MediaRecorder stream, so its pieces concatenate into one playable file.
- **Ordering and retries.** The browser uploads pieces in order and tries each one up to three times.
  The server treats a repeated `(segment, seq)` as a no-op and rejects audio for a paused or stopped
  recording, or for an earlier segment. A piece whose `content-length` is over 2 MiB is refused before its
  body is read.
- **Live transcript.** While notes are on, the browser also sends clips of speech to
  `POST /v1/live/calls/:id/transcribe` (16 kHz mono WAV, at most 30 seconds, 120 a minute per account).
  Each clip is transcribed by NEAR AI and kept as sealed lines, and `CallState.transcript` carries the
  latest 200, attributed to the organizer. Clips are refused while notes are off or for an earlier
  segment. See [Notes and inference › The live transcript](notes-and-inference.md#the-live-transcript).
- **Leaving.** The browser stops the recorder, sends the last audio and speech, then calls `leave`. The
  server finishes the note in the same transaction that ends the call, then starts the notes worker.
- **Chat and presentation state** are stored in the call's encrypted state; chat is not added to notes.
- **Raise hand and spotlight** are call state too (`{type: "hand", up}`, `{type: "spotlight", participantId}`).
  Spotlight is organizer-only on the server (the organizer is whoever the call belongs to) and only names
  someone in the call; it puts that tile first on everyone's stage. Opening breakout rooms ends it.
- **Breakout rooms** (`{type: "rooms-open", rooms: [{name, emails}], minutes}`, `rooms-message`,
  `rooms-close`) are organizer-only. Two to eight rooms; only people invited to the call can be sent to one,
  each to one room. `CallState.breakouts.open` carries the rooms, `from` and `until` (seconds since the
  call started) and the latest message to every room; rooms whose time is up close on the next read or
  action, and leaving the call closes them too. Closed rooms are kept in `breakouts.held` and, when the
  call ends, go into its note in recording time; once the notes are written each becomes a chapter ("2
  breakout rooms", who was in which room and for how long). Room names and messages stay in the sealed
  call state.
- **Captions in another language.** `POST /v1/live/calls/:id/translate {language, lines}` translates up to
  20 live transcript lines (by ID) for the person asking, through `drafting.translate`, which sends them to
  NEAR AI's notes model, checked and sealed like every request
  ([Verified private inference](notes-and-inference.md#verified-private-inference)). Each
  line and language is translated once and kept as a sealed `transcript_translations` row, tagged with a
  keyed hash of the line and language, until the recording stops; then they go with the live transcript.
  Lines that aren't in this call's live transcript are left out. Like catch-up and ask, it keeps no
  idempotency receipt. Captions themselves are only shown: turning them off hides the caption bar, and the
  call is still transcribed for notes while notes are on.

## The call screen

`apps/web/src/routes/call.$code.tsx` puts it together from `apps/web/src/features/call/`:

- **Top bar** (`TopBar.tsx`): title and clock, the crimson notes sign (opens the notes), the view control
  (Auto, Speaker, Grid; "changes your view only"), Reset my view once you've arranged it, Catch up, the
  confidential-compute shield and who is here. The shield asks `GET /v1/attestation` with a fresh nonce and
  says "verified" only when a dstack quote's report data is bound to that nonce; outside a TEE it says the
  hardware can't be checked.
- **Stage** (`Stage.tsx`, layout in `view.ts`): tiles are placed in stage pixels and glide there
  (`motion/react`, about 500 ms; reduced motion places them at once). Auto shows a shared screen beside the
  people, the speaker view for a spotlight, a pin or whoever has done most of the talking, and a grid
  otherwise. Drag a tile to reorder, drag its corner or use its menu to make it bigger, drag the line beside
  a shared screen. Each tile's menu says what a choice changes: **Pin for me** and **Make bigger** (Only you),
  **Spotlight for everyone** (Everyone, organizer only). Pins and spotlights show as chips with an ×, and a
  spotlight also as a bar on the stage with **Stop spotlight**; Escape unpins. Your view (mode, order,
  sizes, pin, screen width) is remembered per account in this browser (`alcove.callView.<id>`, parsed with
  `CallViewPrefsSchema`) and never sent.
- **Dock**: microphone and camera (each with a device menu), share, raise hand, captions (with a language
  menu), then breakout rooms (only with someone else in the call), notes, chat and More (Catch up, Audio and
  video settings), then Leave.
- **Side panel** (`Panel.tsx`, `Rooms.tsx`): Notes, Transcript, Ask, Chat and People, or the rooms. It slides
  in and the stage makes room; on phones it covers the stage. Notes during the call are read from the live
  transcript by catch-up over the whole call (`liveNotes.ts`), refreshed when new lines arrive, at most every
  30 seconds and only while the notes view is open; time chips jump to the transcript. The notes everyone
  gets are still written when the call ends.
- **Share picker** (`SharePicker.tsx`): Tab, Window or Screen. Alcove only passes the kind to
  `getDisplayMedia` (`displaySurface`, `preferCurrentTab: false`, tab audio or system audio where asked); the
  browser's own picker shows what can be shared. A bar on the stage says "You're sharing …" with Change
  (asks again and swaps) and Stop.
- **Leaving** (`LeaveSheet.tsx`): one sheet that becomes "Call ended", follows the note's progress and opens
  it when it's ready.

## Room recordings

`POST /v1/recordings` creates a private note (`kind: room`, nobody invited) and a recording. The browser
records the microphone in 5-second pieces to `POST /v1/recordings/:id/audio` and sends clips of speech to
`POST /v1/recordings/:id/transcribe`; a room recording has one segment, and clips are refused while it's
paused. `RoomRecordingState.transcript` carries the latest 200 lines, with no speaker. Rename, pause and
resume are actions; **Stop** finishes the note like leaving a call (stopping twice finishes it once);
**Discard** deletes the note, its recording and every object, as deleting your own note does.

## Media in the browser

`apps/web/src/features/call/media.ts` owns one `LocalMedia` instance from pre-join through the call:

- `getUserMedia` with echo cancellation and noise suppression; camera off releases the camera. Noise
  reduction can be switched from the microphone menu (`applyConstraints` on the live track, so the recording
  and transcript carry on). Background blur is offered only where the browser can switch it both ways
  (`backgroundBlur` in the camera's capabilities, as Chrome does with the system's camera effects); Alcove
  doesn't segment video itself.
- The microphone, camera and speaker chosen last time are asked for first (`deviceId: { ideal }`). When one
  isn't plugged in, the browser's default is used and pre-join says so. Choices live in `localStorage`
  (`alcove.devices`, parsed with `DevicePrefsSchema`) in this browser only; nothing about devices is sent.
- Switching microphones keeps mute as it was; switching cameras with the camera off is remembered for later.
  The speaker is applied where the browser can choose one (`setSinkId`; not Safari).
- The microphone test (`apps/web/src/features/call/devices.ts`) records three seconds in memory and plays
  them back through the chosen speaker. Nothing is uploaded or kept. In the call, **Play test sound** plays a
  short chime through the chosen speaker.
- `getDisplayMedia` for screen sharing; ending it from the browser's own control updates the call.
- A Web Audio analyser drives the mic meter, the speaking ring and the recorder waveform.
- `NotesRecorder` picks the first supported codec (Opus in WebM, then MP4, then Ogg) at 32 kbps. It records
  through a Web Audio graph (a `MediaStreamAudioDestinationNode`), so switching microphones mid-recording
  carries on in the same recording instead of going silent; MediaRecorder can't change its input track.
- Per-person playback volume waits for multi-party calls. Choosing a speaker already applies to the test sound.

Beside it, `SpeechClips` (`apps/web/src/features/call/speech.ts`) feeds the live transcript: an
AudioWorklet (`apps/web/public/pcm-capture.js`) mixes the microphone to mono, filters and resamples it to
16 kHz, and the samples are cut into WAV clips at pauses. Clips without a voice in them aren't sent. It
never touches the encrypted recording.

## Multi-party preview

Calls have one participant today. So that the parts of the call screen that need other people can be seen
and worked on now, `apps/web/src/features/call/multiparty-preview.ts` stands in for them: five of the
illustrated cast join, take turns talking with captions (in English, Spanish, German and Japanese), raise a
hand now and then, and go to breakout rooms, where they talk among themselves and one asks for help. This
is a deliberate exception to "no mock data" (AGENTS.md), limited to that one module:

- It's on in development builds and in builds made with `VITE_ALCOVE_MULTIPARTY_PREVIEW=on`. Production sets it from the repository variable `MULTIPARTY_PREVIEW` (currently `on`); `?preview=off`
  (or `on`) in the address bar overrides it for the browser tab.
- Nothing from it is sent to or stored by the server, and it never reaches the transcript, the notes, Ask
  or catch-up. Spotlighting a preview person stays in the browser; opening rooms sends the server only the
  invited people, and the preview's people are placed in the rooms locally.
- Every place that reads it is marked `TODO(multi-party): replace with LiveKit participants`.

What to swap when multi-party calls land:

1. Stage participants: `CallState.participants` from the server (with their media) instead of
   `pv.people`; who is speaking from the media, not `pv.speaking`.
2. Spotlight: send any participant's ID to the server (`setSpotlight`), and drop `preview.setSpotlight`.
3. Captions: per-speaker transcript lines from the server instead of `pv.caption`.
4. Breakout rooms: send everyone's addresses in `openRooms`, take who is in each room, who is talking and
   help requests from the call, and move media when you join a room (`preview.joinRoom`).
5. Raised hands of others: from `CallState.participants[].hand`.
6. Delete `multiparty-preview.ts` and this section.

## Next: multi-party calls

Multi-party media must be end-to-end encrypted, following Proton Meet's open-source model: media passes an
SFU that never holds keys; senders encrypt frames with per-call keys (WebRTC encoded transforms / SFrame);
the call key travels in the link fragment (`#k=…`, never sent to servers) or via the participants' keys.
The notes service then joins as an attested participant that receives the call key only while notes are
on, which keeps the "everyone sees when notes are on" guarantee enforceable rather than a UI promise. It
would also let transcript lines name each speaker; today every line in a call is the organizer's.
Screen notes (the stretch goal) would sample shared-screen frames inside the same attested service;
Scribe's autocapture is a reference for turning screen activity into a written summary.
