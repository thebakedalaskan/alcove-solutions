# Calls and recordings

[Docs home](../README.md) · [System architecture](system-architecture.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md) · [Notes and inference](notes-and-inference.md)

Notes are a service of the call, not a bot in it. This page covers how a call and a room recording turn
into encrypted audio that the notes service can later process.

## Call lifecycle

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    participant D as Postgres
    participant O as Object store
    B->>A: POST /v1/calls (start now) or schedule a meeting
    B->>B: Pre-join: getUserMedia, choose notes
    B->>A: POST /v1/calls/:code/join {mic, cam, notes, audience}
    A->>D: calls row (state ciphertext); meeting revision → live
    opt notes on
      A->>D: note item (status recording) + recording with wrapped Krec
    end
    loop every 5 seconds while notes are on
      B->>A: POST /v1/live/calls/:id/audio (segment, seq, bytes)
      A->>O: sealed audio record under a random object ID
      A->>O: read back, verify length and SHA-256
      A->>D: recording_pieces row
    end
    B->>A: POST /v1/live/calls/:id/leave (after flushing audio)
    A->>D: call ended; recording stopped; note → pending; content job queued; meeting → ended
```

- **Who controls notes.** The host starts, pauses, resumes and stops notes. Each change creates a notice
  shown to everyone in the call. Recording never starts before someone starts notes.
- **Segments.** Pausing pauses the current segment. Stopping ends it; starting again opens segment `n+1`.
  Each segment is one continuous MediaRecorder stream, so its pieces concatenate into one playable file.
- **Ordering and retries.** The browser uploads pieces sequentially and retries a failed piece up to three
  times. The server treats a repeated `(segment, seq)` as a no-op and rejects audio for a stopped recording,
  a paused one, or an earlier segment.
- **Leaving.** The browser stops the recorder, waits for every queued piece, then calls `leave`. The server
  then finalises the note in the same transaction that ends the call.
- **Chat and presentation state** are stored in the call's encrypted state; chat is not added to notes.

## Room recordings

`POST /v1/recordings` creates a private note (`kind: room`, audience `host`) and a recording. The browser
records the microphone in 5-second pieces to `POST /v1/recordings/:id/audio`. Rename, pause and resume are
actions; **Stop** queues the note like a call; **Discard** tombstones the note and deletes every object.

## Media in the browser

`apps/web/src/features/call/media.ts` owns one `LocalMedia` instance from pre-join through the call:

- `getUserMedia` with echo cancellation and noise suppression; camera off releases the camera.
- `getDisplayMedia` for screen sharing; ending it from the browser's own control updates the call.
- A Web Audio analyser drives the mic meter, the speaking ring and the recorder waveform.
- `NotesRecorder` picks the first supported codec (Opus in WebM, then MP4, then Ogg) at 32 kbps.

## Next: multi-party calls

Multi-party media must be end-to-end encrypted, following Proton Meet's open-source model: media passes an
SFU that never holds keys; senders encrypt frames with per-call keys (WebRTC encoded transforms / SFrame);
the call key travels in the link fragment (`#k=…`, never sent to servers) or via the participants' keys.
The notes service then joins as an attested participant that receives the call key only while notes are
on, which keeps the "everyone sees when notes are on" guarantee enforceable rather than a UI promise.
Screen notes (the stretch goal) would sample shared-screen frames inside the same attested service;
Scribe's autocapture is a reference for turning screen activity into a written summary.
