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
      A->>N: speech to text
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

## Room recordings

`POST /v1/recordings` creates a private note (`kind: room`, nobody invited) and a recording. The browser
records the microphone in 5-second pieces to `POST /v1/recordings/:id/audio` and sends clips of speech to
`POST /v1/recordings/:id/transcribe`; a room recording has one segment, and clips are refused while it's
paused. `RoomRecordingState.transcript` carries the latest 200 lines, with no speaker. Rename, pause and
resume are actions; **Stop** finishes the note like leaving a call (stopping twice finishes it once);
**Discard** deletes the note, its recording and every object, as deleting your own note does.

## Media in the browser

`apps/web/src/features/call/media.ts` owns one `LocalMedia` instance from pre-join through the call:

- `getUserMedia` with echo cancellation and noise suppression; camera off releases the camera.
- `getDisplayMedia` for screen sharing; ending it from the browser's own control updates the call.
- A Web Audio analyser drives the mic meter, the speaking ring and the recorder waveform.
- `NotesRecorder` picks the first supported codec (Opus in WebM, then MP4, then Ogg) at 32 kbps.

Beside it, `SpeechClips` (`apps/web/src/features/call/speech.ts`) feeds the live transcript: an
AudioWorklet (`apps/web/public/pcm-capture.js`) mixes the microphone to mono, filters and resamples it to
16 kHz, and the samples are cut into WAV clips at pauses. Clips without a voice in them aren't sent. It
never touches the encrypted recording.

## Next: multi-party calls

Multi-party media must be end-to-end encrypted, following Proton Meet's open-source model: media passes an
SFU that never holds keys; senders encrypt frames with per-call keys (WebRTC encoded transforms / SFrame);
the call key travels in the link fragment (`#k=…`, never sent to servers) or via the participants' keys.
The notes service then joins as an attested participant that receives the call key only while notes are
on, which keeps the "everyone sees when notes are on" guarantee enforceable rather than a UI promise. It
would also let transcript lines name each speaker; today every line in a call is the organizer's.
Screen notes (the stretch goal) would sample shared-screen frames inside the same attested service;
Scribe's autocapture is a reference for turning screen activity into a written summary.
