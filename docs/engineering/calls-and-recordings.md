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
    A->>D: calls row (state ciphertext, room name); meeting revision → live
    A-->>B: ticket: LiveKit URL and 120-second token, call pass
    B->>B: joins the LiveKit room; publishes mic, camera, screen
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
## Group calls

Media goes through LiveKit (an SFU: a local server in Docker for development, LiveKit Cloud in
production), end-to-end encrypted: LiveKit forwards frames it can't read ([below](#end-to-end-encryption)).
The call itself stays in the API: who's let in, notes and the transcript.

- **Joining.** `GET /v1/calls/:code/card` (no account needed) gives the title, organizer's name, whether
  the organizer is there and whether the call is locked. `POST /v1/calls/:code/join` takes `{mic, cam}`,
  this connection's random `identity` and MLS `keyPackage` (made in the browser), a `name` (1–60
  characters) without an account, and `previous`, this tab's last pass for the call, if it has one. It
  returns a ticket: the LiveKit URL and room, the identity, the role and a **call pass**. No LiveKit token:
  that comes only once you're let in.
- **Who gets in.** The organizer by their account; it starts the call and makes the room (`r_<random>`;
  LiveKit never creates rooms itself). Invited people (signed in with an invited address) are let in by the
  organizer's browser without anyone asking, and so is someone let in before who comes back with their old
  pass (a reload). **Anyone else asks to join**: the organizer sees them (`CallState.waiting`, a toast and
  People) and lets them in or turns them away (`deny`). Nobody joins before the organizer is there
  (`409 conflict`) or while the call is locked (`403 forbidden`); someone removed asks again. Someone
  waiting learns only whether notes are on: nobody's name and nothing that's been said. There's no
  participant limit.
- **The room.** `GET /v1/live/calls/:id/room` gives a LiveKit token for that one room (120 seconds, no
  admin rights, no data messages) to people let in, and to nobody else. Tokens carry no name: LiveKit knows
  people only by random identity.
- **The call pass** is an HMAC (a key derived from `KMASTER`) over the call, the organizer, the person's
  LiveKit identity, role and name, valid for 12 hours. It goes in the `x-alcove-call` header on every
  `/v1/live/calls/:id` request, never in a URL or log. The live routes open the organizer's keys for it
  from `KMASTER`, per request. A removed person's pass stops working, and once the call has ended only the
  organizer can read it.
- **What each role can do.** Everyone let in: read the call, chat, catch up and ask. Only the organizer
  (pass role `host`, their own session and their current connection: joining from another device takes the
  powers with it): let people in or turn them away, notes on/off, audio and speech uploads, mute someone's
  microphone, remove someone, lock the call, and end it. The live transcript comes from what the organizer's
  browser plays (see Notes below); link guests get no notes, invited people get them as before.
- **Leaving and ending.** Anyone but the organizer leaving is taken out of the call's group, so the keys move
  on without them. They leave with **Leave** (`POST /v1/live/calls/:id/leave`), or when their page goes away
  (closed, reloaded or left for another), which sends the same request as a keepalive request. A page that is
  only put in the back-forward cache sends nothing. A browser that dies without a word leaves by LiveKit's
  `participant_left` webhook. Anyone let in who isn't in the room 90 seconds later is taken out too. That covers
  a tab closed while asking, and a webhook that was missed. It's checked 90 seconds after the commit that let
  them in, and at every upkeep, and 90 seconds leaves time for a tab in the background, which can take a minute
  to notice it was let in. The organizer's page sends nothing as it goes. The organizer leaving ends the call
  for everyone: the normal ending above, then the room is
  deleted (everyone else is disconnected with "room deleted"). The organizer reloading doesn't end it:
  `POST /hooks/livekit` (signed by LiveKit with the API key) records when the organizer's connection left,
  and the call ends only if they're gone for more than 25 seconds (upkeep asks LiveKit whether they're in
  the room before ending it). An organizer whose browser never reaches the room is gone the same way. When
  everyone has left, LiveKit finishes the room after 20 seconds, which ends the call too, and upkeep ends
  calls whose room is gone.
- **Who's in** comes from admission, sealed in the call's state: never from LiveKit's API on reads, so a
  call's reads cost LiveKit nothing.
- **In the browser** `apps/web/src/features/call/livekit.ts` (loaded only by the call screen) wraps the
  room: it publishes `LocalMedia`'s tracks as they are, encrypted, plays everyone else's audio on the chosen
  speaker, and refetches the call on nudges, arrivals and departures. One screen is shared at a time.

## End-to-end encryption

Every browser in a call is an MLS client (RFC 9420): `packages/api-http/src/mls.ts`, on ts-mls, suite
`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`. Its keys are made in the browser and never leave it. The
API orders and relays MLS messages and can't read them. Each client's operations run one at a time, in
order, and nothing a message carries can stop it: anything unreadable is skipped and the next one is read.

- **Members and commits.** Joining makes a fresh key package whose credential is the connection's random
  identity. The organizer's browser creates the call's group and is its only committer: it adds people (an
  Add commit, with a Welcome carrying the ratchet tree for each) and removes whoever left or was removed.
  Every other browser accepts commits only from the organizer's leaf (leaf 0, which a joining browser checks
  is this call's organizer, in this call's group). The organizer's browser adds only people the API lists as
  pending (`CallMls.pending`: asking, or coming back after a reload), checks each key package (well formed,
  this suite, signed by its own key, naming the identity it came with; one that isn't is turned away), adds
  at most 50 at a time, and waits a little longer after each refused commit, so a refusal can't become a
  loop. When nobody comes or goes it moves the keys on anyway every 10 minutes (an empty commit), so one set
  of keys never covers a whole call.
- **The log.** `GET /v1/live/calls/:id/mls?after=` gives each browser its part of the call's MLS log
  (`call_mls`): the organizer's browser from the start of the generation (commits, chat, and the key packages
  it may act on), anyone else from their welcome on (nothing before it is any use to them; `earlierChat`
  says whether there was chat they can't read). It reads up to the call's last seq as it stood, 100 entries
  at a time (`more` says ask again), so nothing is skipped or sent twice. The API takes exactly one commit per
  epoch, in order (`409` for a stale one); a commit whose answer was lost is sent again as it was. Bodies are
  sealed again under the organizer's call key, and the log is deleted when the call ends.
- **Media.** Each sender has its own media key every epoch, `MLS-Exporter("alcove/call-media/v1",
  identity, 32)`: a key encrypts only its sender's frames (as SFrame requires, RFC 9605 §4.4.1), and every
  member can derive every sender's key to decrypt them. LiveKit's frame encryption uses them (AES-GCM in a
  worker, per participant, keys derived with HKDF). A key's ring index is the epoch modulo 128, in one half
  of LiveKit's 256-key ring per generation, so a group being left keeps its keys while people still send
  with them. Browsers keep the last four epochs' keys to decrypt with, and switch their own send key a moment
  after the keys move on (0.5 s after someone is only added, 2 s after someone leaves or the keys move on
  by themselves; at most twice that in a burst), so everyone has the new keys before anyone sends with them.
  Someone who left can't follow what comes after, and someone new can't decrypt what came before. Like
  SFrame, this doesn't stop a member from sending media as another member (every member can derive every
  key). A browser that can't encrypt frames can't join; there's no unencrypted fallback. Media is played or
  shown only if LiveKit marks it encrypted and its sender is in the browser's MLS group; anything else is
  held back.
- **Chat** is MLS application messages, encrypted in the browser's sync loop (so nothing else touches the
  keys meanwhile): only the people in the group when a message is sent can read it, and someone who joins
  later sees that earlier chat exists but can't read it. The sender comes from MLS (the message's sender
  leaf and signature), not from the text. A message that can't be sent after a few tries is taken back, and
  the sender is told. Messages are at most 4,000 characters.
- **People, not connections.** Each browser keeps one `person` across its reconnections (its pass brings
  it back once, without asking; a second use of the same pass has to ask), so removing someone removes
  every connection of theirs and none of their passes works again. Leaving while still asking, closing the
  page included, takes the request back and forgets it: a pass only brings back someone who was let in, so
  asking again means being let in again. A LiveKit `participant_left` webhook only takes someone out of the group after LiveKit
  confirms, three seconds later, that they're really gone. A browser taken out of the group, or whose place
  another tab took, is told and stops.
- **A new organizer connection** (a reload or another device) starts a new group generation: the old
  connection's keys stay with it, everyone already in rejoins the new group with fresh keys without asking,
  and anyone still waiting keeps waiting (key packages aren't tied to a group, so theirs carry over).
- **Who vouches for whom.** The API says who each identity is, who's invited and what their names are; it
  can't read media or chat. It's built to run attested, but it runs on Cloud Run today, so whoever operates
  it could run other code (privacy › Moving to confidential computing). There are no safety codes. An API
  running other code could have the organizer's browser add someone as an invitee, but never silently: everyone in the call sees every member of the group in People
  (as "Someone" if the API doesn't name them), and their tile if they connect.
- **What it doesn't cover.** While notes are on, everyone's speech the organizer hears also goes to the API
  for the transcript and notes, outside the media encryption, as the notes sign says. That's the organizer's
  microphone, and every other microphone the organizer's browser plays, each person's sent on its own; breakout
  rooms the organizer isn't in aren't heard. LiveKit still sees addresses,
  when calls happen, who's in which room (by random identity), track kinds and mute state, packet sizes and
  timing, and the audio-level header, so exactly who is speaking when. Breakout rooms are kept apart by each
  browser playing only its own room's media, not by separate keys: the whole call shares its keys.

## Hands, spotlight, breakout rooms and captions

- **Raised hands** are call state, one per person (`{type: "hand", up}`): anyone in the call raises or lowers
  their own, everyone sees it (`CallState.participants[].hand`), and leaving lowers it.
- **Spotlight** (`{type: "spotlight", participantId}`) is the organizer's, and only names someone in the call;
  it puts that tile first on everyone's stage. Opening breakout rooms ends it.
- **Breakout rooms** (`{type: "rooms-open", rooms: [{name, emails}], minutes}`, `rooms-message`,
  `rooms-close`) are the organizer's. Two to eight rooms; only people invited to the call can be sent to one,
  each to one room. `CallState.breakouts.open` carries the rooms (with who of them is in the call now, by
  participant ID), `from` and `until` (seconds since the call started) and the latest message to every room;
  rooms whose time is up close on the next read or action, and ending the call closes them too. Closed rooms
  are kept in `breakouts.held` and, when the call ends, go into its note in recording time; once the notes are
  written each becomes a chapter ("2 breakout rooms", who was in which room and for how long). Room names and
  messages stay in the sealed call state. The organizer visits one room at a time (`{type: "rooms-visit", roomId}`, `null` for the
  main room): while visiting, they're one of that room's `members`, so that room sees and hears them and the
  main room doesn't. Each browser plays only the media of the people in its own room (or, outside the rooms,
  of everyone in no room). Rooms are kept apart by the browsers, not by separate keys: everyone in the call
  can derive every sender's media key, so a modified browser could play another room's media.
- **Captions in another language.** `POST /v1/live/calls/:id/translate {language, lines}` translates up to
  20 live transcript lines (by ID) for the person asking (anyone let in), through `drafting.translate`, which
  sends them to NEAR AI's notes model, checked and sealed like every request
  ([Verified private inference](notes-and-inference.md#verified-private-inference)). Each line and language is
  translated once and kept as a sealed `transcript_translations` row, tagged with a keyed hash of the line and
  language, until the recording stops; then they go with the live transcript. Lines that aren't in this
  call's live transcript are left out. Like catch-up and ask, it keeps no idempotency receipt, and it has its
  own rate limit (90 a minute per person). Captions themselves are only shown: turning them off hides the
  caption bar, and the call is still transcribed for notes while notes are on.


## The call screen

`apps/web/src/routes/call.$code.tsx` is the call for everyone in it; no account is needed, since the call's
pass is what lets a guest in. It's built from `apps/web/src/features/call/`: the stage (`Stage.tsx`, laid out
by `view.ts`), the top bar, the side panel (`Panel.tsx`: Notes, Transcript, Ask, Chat, People), breakout
rooms (`Rooms.tsx`), captions, live notes, the share picker, the leave sheet and the device pickers.

- **What it reads.** The `CallSession` (who's in, hands, spotlight, rooms, notes, the transcript), its
  `crypto` store (MLS status and members, media keys, chat) and the LiveKit room (`livekit.ts`: mic, camera,
  screen, who's speaking, and their tracks), each with `useLive()`, copying none of their state. Only the
  organizer also reads the meeting, to know who's invited.
- **Who's shown.** Everyone the server says is in the call, plus anyone else in the browser's MLS group, as
  "Someone". Mic, camera, screen and speaking come from the room; raised hands from `participants[].hand`.
  Other people's cameras and screens are attached with `CallRoom.attach` and aren't mirrored. The join page
  opens the call once the browser is in the group and the call names it.
- **The room.** One connection per session, shared across remounts and left when no screen uses it. It
  publishes `LocalMedia`'s mic, camera and screen (with a tab's sound), and plays only encrypted media from
  members of the browser's MLS group. LiveKit's own logs go to the app's logger at debug; a decryption error
  is logged at debug when a key is briefly missing around a key change, and as a warning otherwise.
- **Asking to join.** The organizer gets a toast with Let in, a count on the People button, and an Asking to
  join section in People to let people in or turn them away.
- **Host controls** are the organizer's, in People: mute someone's microphone (LiveKit mutes the track, their
  dock shows it off, they're told, and only they can unmute), remove someone (they're told and go back to the
  call's page), and lock the call.
- **Chat** is `crypto.chat`, decrypted in the browser; names come from the people in the call. It's off until
  the browser holds the call's keys, takes up to 4,000 characters, says when there was earlier chat it can't
  read, and gives back a message that couldn't be sent.
- **Spotlight** goes through the server and can name anyone in the call. Pins, sizes, order and layout are the
  viewer's own, kept in their browser.
- **Screen sharing** is one screen at a time: while someone else shares, the share button says who.
- **Captions** show the newest live transcript line, under whoever said it, translated for each viewer who
  picks a language. They're hidden while rooms are open.
- **Notes.** While notes are on, the recorder keeps the organizer's microphone, and the live transcript hears
  everyone the organizer's browser plays: its own microphone and each other microphone in its part of the call
  (`CallRoom.heard()`, the raw decrypted tracks, so nobody's volume on this screen changes what's heard). Each
  person is heard on their own (`CallEars` in `speech.ts`: one `SpeechClips` per voice, sharing one audio
  context and the segment's clock), so every clip says whose it is (`x-alcove-speaker`, a participant ID the
  server checks is someone in the call), and every line is said by that person. Lines said while the
  organizer visits a breakout room keep that room's ID.
- **Breakout rooms.** The organizer opens rooms for the invited people in the call (by email, as the server
  requires); guests stay in the main room. Who's in each room comes from `breakouts.open.rooms[].members`,
  and each browser tells the room whose media to play (`CallRoom.playOnly`). The organizer sees every room:
  who's in it, who's talking (LiveKit's speaker detection) and a raised hand as that room asking for help.
  Everyone else sees only their own room or the main room, with the time left and the organizer's messages,
  and is told when the organizer comes into or leaves their part of the call.
- **Leaving and ending.** Anyone but the organizer leaves (`leave()` returns null) and goes back to the call's
  page. The organizer's End ends the call for everyone: deleting the room disconnects everyone, who are told
  the organizer ended the call, and the organizer's sheet follows the notes being written. A browser that's
  removed, out of the group, or whose room ended is told, closes the session and leaves the room; one whose
  keys fell out of step, or whose connection dropped for good, is offered a reload.

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
- There's no per-person playback volume yet. Choosing a speaker already applies to the test sound.

Beside it, `SpeechClips` (`apps/web/src/features/call/speech.ts`) feeds the live transcript: an
AudioWorklet (`apps/web/public/pcm-capture.js`) mixes the microphone to mono, filters and resamples it to
16 kHz, and the samples are cut into WAV clips at pauses. Clips without a voice in them aren't sent. It
never touches the encrypted recording.

## Next

- **Every speaker in the notes.** While notes are on, each browser sends its own microphone to the notes
  service, so transcript lines name each speaker. The notes service never joins the call or its group.
- **Host hand-off** when the organizer drops (#30): another member's browser takes over committing.
- **Screen notes** (the stretch goal) would sample shared-screen frames inside the attested service;
  Scribe's autocapture is a reference for turning screen activity into a written summary.
