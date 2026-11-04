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
  (`POST /v1/live/calls/:id/actions` with `{type: "notes", on}`) and pauses and resumes them
  (`{type: "pause"}`, `{type: "resume"}`); anyone else can ask for them. Each change adds a notice shown in
  the call, and everyone sees the same capture state ([What's captured](#whats-captured)).
- **Segments.** Turning notes off, or pausing them, stops the recording. Turning them on again, or resuming,
  starts segment `n+1`. Each segment is one continuous MediaRecorder stream, so its pieces concatenate into
  one playable file.
- **Ordering and retries.** The browser uploads pieces in order and tries each one up to three times.
  The server treats a repeated `(segment, seq)` as a no-op and rejects audio for a paused or stopped
  recording, or for an earlier segment. A piece whose `content-length` is over 2 MiB is refused before its
  body is read.
- **Live transcript.** While notes are on, the organizer's browser also sends clips of speech, one stream per
  voice it hears (its own microphone and each other unmuted microphone it plays), to
  `POST /v1/live/calls/:id/transcribe` (16 kHz mono WAV, at most 30 seconds, each saying whose it is with
  `x-alcove-speaker`; 40 a minute for each voice, 240 for the account). Each clip is transcribed by NEAR AI and
  kept as sealed lines, and `CallState.transcript` carries the latest 200 the viewer may read, each under
  whoever said it. Clips are refused while notes are off or paused, for an earlier segment, or from anyone not
  in the call. See [Notes and inference › The live transcript](notes-and-inference.md#the-live-transcript).
- **Leaving.** The browser stops the recorder, sends the last audio and speech, then calls `leave`. The
  server finishes the note in the same transaction that ends the call, then starts the notes worker.
## Group calls

Media goes through LiveKit (an SFU: a local server in Docker for development, LiveKit Cloud in
production), end-to-end encrypted: LiveKit forwards frames it can't read ([below](#end-to-end-encryption)).
The call itself stays in the API: who's let in, notes and the transcript.

- **Joining.** `GET /v1/calls/:code/card` (no account needed; 600 a minute per client address, since every
  pre-join keeps reading it) gives the title, organizer's name, whether the organizer is there, whether the call
  is locked, whether it was scheduled with notes, once it has started what it captures (`capture`, without
  anyone's name), whether it has ended (and nobody started it again), where the person asking stands (`you`:
  invited, asking with an account the notes may go to, or a guest) and which ways of signing in get the notes
  (`signInForNotes`). `POST /v1/calls/:code/join` (120 a minute per address) takes `{mic, cam}`, this
  connection's random `identity` and MLS `keyPackage` (made in the browser), a `name` (1–60 characters) without
  an account, and `previous`, this tab's last pass for the call, if it has one. Someone signed in joins under
  their account's name; a typed name is only for guests. It returns a ticket: the LiveKit URL and room, the
  identity, the role and a **call pass**. No LiveKit token: that comes only once you're let in.
- **Who gets in.** The organizer by their account; it starts the call and makes the room (`r_<random>`;
  LiveKit never creates rooms itself). Invited people (signed in with an invited address) are let in by the
  organizer's browser without anyone asking, and so is someone let in before who comes back with their old
  pass (a reload). **Anyone else asks to join**: the organizer sees them (`CallState.waiting`, a toast and
  People) and lets them in or turns them away (`deny`). Someone signed in with an account the notes may go to
  asks under it, so the organizer sees their name and address; anyone else is a guest by name (the one they
  typed, or their account's). Nobody joins before the organizer is there (`409 conflict`), while the call is
  locked (`403 forbidden`) or once it has ended (`409`, "This call has ended."); someone removed asks again. An
  ask taken back stays turned away, so its identity can't ask again as someone else. Someone waiting learns only
  what the call captures, as the card does: nobody's name, no asks, and nothing that's been said. There's no
  participant limit.
- **Let in from the link, signed in.** The commit that lets in someone who asked with an address also adds it to
  the invite: to the meeting's guests, and to the note's invited people when notes have been on
  (`modules/invites.ts`), so they get the notes when the call ends, like everyone invited by email. Only someone
  who asked counts (the organizer saw who it was), and an address comes with an ask only when the notes may go to
  that account: a real one (Google), or any when the organizer's own account is a demo one, since demo sign-ins
  check nobody and Microsoft's is one account everyone trying Alcove shares. Invites keep their usual rules, up
  to 100 people; past that, someone let in is a guest without the notes. From then on they're invited: the call
  shows them their role as `invited` (`CallState.role`, which can be more than their pass says), they see people
  as invited people do, a reload or another device comes in without asking, and the organizer can send them to a
  breakout room. An earlier pass brings someone back only as the same account (or still none). The meeting keeps
  which guests came this way (`addedFromLink`, in its sealed manifest), so removing one takes them off the invite
  in any run of the call, once no other connection of theirs is still in it. People invited by email stay
  invited, and notes already given when an earlier run ended stay given. The calendar event isn't changed:
  Google would email everyone on it in the middle of the call.
- **The room.** `GET /v1/live/calls/:id/room` gives a LiveKit token for that one room (120 seconds, no
  admin rights, no data messages) to people let in, and to nobody else. Tokens carry no name: LiveKit knows
  people only by random identity.
- **The call pass** is an HMAC (a key derived from `KMASTER`) over the call, the organizer, the person's
  LiveKit identity, role and name, valid for 12 hours. It goes in the `x-alcove-call` header on every
  `/v1/live/calls/:id` request, never in a URL or log. The live routes open the organizer's keys for it
  from `KMASTER`, per request. A removed person's pass stops working, and once the call has ended only the
  organizer can read it.
- **What each role can do.** Everyone let in: read the call, chat, catch up and ask, for themselves alone
  ([Catching up during a call](notes-and-inference.md#catching-up-during-a-call)), raise a hand, and ask for
  notes. The organizer and everyone on the invite (people signed in whom the organizer let in included) read the
  whole call's transcript; a guest with the link, who doesn't get the notes, reads only what was said while they
  were in the call (the live transcript, captions, catching up, asking and moments). Only the organizer (pass role
  `host`, their own session and their current connection: joining from another device takes the powers with it):
  let people in or turn them away, notes on/off, pause and resume, say not now to an ask for notes, say what their
  browser can't capture, audio and speech uploads, mute someone's microphone, remove someone, lock the call, and
  end it. The recording is the organizer's microphone; the live transcript comes from what the organizer's browser
  plays (see Notes below). Link guests get no notes; invited people, and people signed in whom the organizer let
  in, get them.
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
  call's reads cost LiveKit nothing. Each participant also has a `seat`, the same across their reconnections (a
  reload) and, for the organizer, on any device, which viewers' own layouts key them by
  ([The call screen](#the-call-screen)). Anyone else joining from a second browser or device gets a new seat.
- **In the browser** `apps/web/src/features/call/livekit.ts` (loaded only by the call screen) wraps the
  room: it publishes `LocalMedia`'s tracks as they are, encrypted, swapping a new microphone or camera (or a
  change of what's shared) into the same publication, plays everyone else's audio on the chosen speaker at each
  person's volume for this listener, and refetches the call on nudges, arrivals and departures. Several people can
  share a screen at once ([The call screen › Shares](#the-call-screen)).

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
  for the transcript and notes, outside the media encryption, as the call's People panel says. That's the
  organizer's microphone, and every other microphone the organizer's browser plays, each person's sent on its
  own. Breakout rooms the organizer isn't in aren't heard, and what's said in a breakout room can be read only by
  the people sent there and the organizer. LiveKit still sees addresses,
  when calls happen, who's in which room (by random identity), track kinds and mute state, packet sizes and
  timing, and the audio-level header, so exactly who is speaking when. Breakout rooms are kept apart by each
  browser playing only its own room's media, not by separate keys: the whole call shares its keys.

## What's captured

One capture state for the whole call (`CallState.capture`, `packages/api/src/capture.ts`), kept in the
call's sealed state (`apps/api/src/modules/capture.ts`) and the same for everyone in it:

- **Its parts.** `recording` (the organizer's microphone, encrypted), `transcript` (everyone the organizer's
  browser plays in its part of the call, turned into text by the private speech model, each line under whoever
  said it), `ai` (the private notes model reading the transcript: the notes at the end, catch-up, questions and
  captions during the call) and `screen` (shared screens read for the notes). Each is `on`, `paused`, `off` or
  `unavailable`, with when it last changed (`since`) and who changed it (`by`: the call's schedule, or the
  organizer by name). Recording and the transcript follow notes. The notes model reads what was transcribed for
  as long as there is some, so `ai` stays `on` while notes are off once they've been on, and only a pause stops
  it. Nothing reads shared screens yet, so `screen` is always `off` until shared-screen notes arrive. `mode`
  says it in one word: `on`, `paused`, `off`, or `unavailable` when notes are on but the organizer's browser can
  neither record nor listen. Capture runs in one place, the organizer's browser, and the server enforces it on
  the audio and transcribe routes, which only the organizer's current connection may use.
- **Unavailable.** The organizer's browser says what it can't capture (`{type: "unavailable", parts}`, the
  organizer's only): the recording without a microphone (none, refused, or in use elsewhere) or when the
  recorder couldn't start or failed, the transcript when the browser can't run the audio worklet it listens
  through. While notes are on, those parts are `unavailable` for everyone, and when it's both, `mode` is too
  (the sign says **Notes unavailable**, in caution). It's forgotten with every change to notes and when a new
  organizer connection takes over, and one that arrives while notes aren't on is ignored, so the browser says
  again and nobody is told something isn't captured when it is.
- **Who sees it.** Everyone in the call, and anyone reconnecting, gets it with the call. People asking to join
  and anyone reading the card get it without names: `by` says only "the organizer", and there are no gaps or
  asks. Every change nudges the room, so browsers fetch the call again.
- **Pause** (`{type: "pause"}`, only while notes are on) stops every kind of capture at once. The one gate every
  capturing path goes through, `mayCapture` in `apps/api/src/modules/capture.ts`, refuses audio pieces, speech
  clips, caption translations, catch-up and questions with `409 conflict` ("Notes are paused…"), whoever sends
  them, so nothing new is recorded, transcribed or sent to the AI. The organizer's browser holds everything as
  it sends the pause: the recorder and every voice stop, and nothing they have is sent. Once the server has
  paused, what they held is dropped rather than flushed, and a `409` from a later upload is dropped too. If the
  pause fails, notes are still on, so the same recorder and voices carry on and send what they held: the
  recorder's pieces stay in order, and no segment restarts from piece 0. While it's on its way, the organizer's
  sign says **Pausing…**; that's the only in-between state, since the server changes the call's state in one
  step and everyone else sees it change at once. What the server took before the pause stays: a piece or clip
  that got through the gate before the pause was saved is kept (a clip still being transcribed lands in the
  transcript, before the pause). Notes off is the same for audio and speech, but catch-up, questions and
  captions still read what was transcribed before. Turning notes off sends the last audio and speech first; if
  it fails, the same recorder carries on.
- **Resume** (`{type: "resume"}`) is the organizer's choice and nothing else's: not a reconnect, not a reload,
  not a breakout room, and not a new organizer connection, which takes over with notes still paused (or off).
  Resuming starts segment `n+1`, and so does turning notes on.
- **Gaps.** Every stretch with nothing captured (notes off, from the start until they first come on, or paused)
  is a gap: when it started and ended, and where it falls in the recording (`at`, at the end of the segment
  before it, as transcript lines are placed). The call (`capture.gaps`), a catch-up (`CatchUp.gaps`, the ones in
  or after what it read) and the finished note (`Note.gaps`) carry them; the transcript and chapters say
  "Paused 10:02–10:05" in their place, and the notes model reads a `--` line there and is told never to guess
  what was said in it. Changes are kept to a tenth of a second, so even a short pause shows. Lines stay inside
  their own segment: one placed past the end of its segment's audio (its last pieces were dropped by a pause)
  goes at the segment's end, so nothing said before a pause comes after it.
- **Asking for notes.** While notes are off or paused, anyone in the call but the organizer can ask
  (`{type: "request-notes", up}`; `up: false` takes it back; 10 a minute per person). Everyone in the call sees
  open asks (`capture.requests`, by participant), like raised hands. The organizer hears about each one as a
  toast and sees them in People, and either turns notes on (or resumes them), which answers every open ask, or
  says not now (`{type: "decline-notes", requestId}`). Whoever asked is told (`capture.asked`). Asks are kept in
  the sealed call state, one per person, by the person's ID across their reconnections.
- **What it doesn't cover.** Video and chat are never captured: they're encrypted end to end between the
  browsers. Nothing stops someone recording their own screen or speakers. Retention has one fixed behaviour,
  with no settings: the live transcript and caption translations last only until the call ends; the audio,
  transcript and notes stay in the organizer's vault until someone with the right deletes the note, and
  deleting is physical ([Privacy › Deletion](privacy-keys-and-sessions.md#deletion)). Paused stretches capture
  nothing, so there's nothing of them to keep.

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
  call's live transcript, or that the person asking may not read, are left out. Like catch-up and ask, it keeps no idempotency receipt, it has its
  own rate limit (90 a minute per person), and it's refused while notes are paused. Captions themselves are only shown: turning them off hides the
  caption bar, and the call is still transcribed for notes while notes are on.


## The join page

`apps/web/src/routes/join.$code.tsx` (with `apps/web/src/features/join/`) is the pre-join for everyone with the
link: the organizer by their account, and anyone else from the call's card.

- **What it says before anyone joins.** The title and organizer, and what the call captures (`CaptureSummary`, the
  same for everyone), with who gets the notes said for the person looking (`PrejoinCapture`, one component for
  every pre-join, the organizer's included): the organizer and who's invited; "You're invited, so you get them";
  for someone whom letting in adds to the invite, that once they're let in they're added and get them; for a
  guest, that the people invited get them. Nobody's name but the organizer's. The card is read again every 3 to 5
  seconds while the organizer isn't there (a little apart, so many people waiting don't read it in step), every
  10 to 17 after (capture changing, a lock), and every 30 to 50 once it has ended, so the page follows the call. A
  read that's refused (too many from one address) or fails keeps the last answer and waits 20 to 33 seconds; only a
  code that leads nowhere stops it. The organizer's own page reads it once.
- **Guest or signed in.** A guest types a name and asks. One line says the trade-off ("Guests don't get the
  notes. Sign in to get them"); signing in opens in place of the name, with only the ways in that get the notes
  (`signInForNotes`): Google, and Microsoft and single sign-on too when the organizer's own account is a demo
  one. With Microsoft and single sign-on the page carries on signed in. Google's way back lands on Home, so the
  call to return to waits in the tab's sessionStorage (`lib/afterSignIn.ts`, ten minutes, used once, never by a
  preload, and dropped when the page comes back from the back-forward cache or someone signs in another way
  there) rather than in the sign-in URL; a refused Google sign-in comes back to the join page with the reason.
  Signed in, the page shows the account you join as, and the button says **Join now** when you're invited and
  **Ask to join** when you're not. Signed in with an account this call's notes can't go to, it says you join as
  a guest, with a way to sign in another way. Asking can be taken back (**Stop asking**).
- **Camera and microphone.** They start as soon as there's a call to join, while the rest of the page loads
  (`LocalMedia`, [Media in the browser](#media-in-the-browser)), and stop when the page turns into one with
  nothing to join (it ended, or the link leads nowhere). Joining works with either or both off.
- **When it can't go on.** A code that leads nowhere, a call that's over, or a card that can't be read each get
  their own page; a refused join (locked, ended, the organizer not there) shows under the button. Every failed
  request's reference (its request ID, `RequestRef`) is shown, finds its lines in the server's log, and says
  nothing about anyone.
- **Time to join.** The card is read alongside the session, and the call screen's media code (`livekit.ts`)
  loads while the pre-join is open. A browser waiting to be let in checks the call's log after 150 ms, then
  twice as long each time up to the usual 1.5 seconds, so an invited person (let in by the organizer's browser
  within about 50 ms) is in after a quick check or two. Measured from opening the link to being in the room, on
  a local stack (a production build, Chromium with fake devices, median of five runs): the organizer 0.4 s, an
  invited person 0.6 s (2.0 s before the quick checks), and a guest 0.6 s after the organizer presses Let in
  straight away (1.7 s before). A guest let in after a few seconds waits for their browser's next check, at
  most 1.5 s away as before (0.9 s median with the organizer taking 3 to 8 seconds).

## The call screen

`apps/web/src/routes/call.$code.tsx` is the call for everyone in it; no account is needed, since the call's
pass is what lets a guest in. It's built from `apps/web/src/features/call/`: the stage (`Stage.tsx`, laid out
by `stageLayout.ts` from your view in `view.ts`, with who's talking settled in `speakers.ts`), each tile's menu
(`TileMenu.tsx`), the top bar and its view menu (`ViewMenu.tsx`), the side panel (`Panel.tsx`: Notes, Transcript,
Ask, Chat, People), breakout rooms (`Rooms.tsx`), captions, live notes, the share picker, the leave sheet and the
device pickers.

- **What it reads.** The `CallSession` (who's in, hands, spotlight, rooms, notes, the transcript), its
  `crypto` store (MLS status and members, media keys, chat) and the LiveKit room (`livekit.ts`: mic, camera,
  screen, who's speaking, and their tracks), each with `useLive()`, copying none of their state. Only the
  organizer also reads the meeting, to know who's invited.
- **Who's shown.** Everyone the server says is in the call, plus anyone else in the browser's MLS group, as
  "Someone". Mic, camera, screen and speaking come from the room; raised hands from `participants[].hand`.
  Other people's cameras and screens are attached with `CallRoom.attach` and aren't mirrored. The join page
  opens the call once the browser is in the group and the call names it.
- **The room.** One connection per session, shared across remounts and left when no screen uses it. It
  publishes `LocalMedia`'s mic, camera and screen (with its sound), and plays only encrypted media from
  members of the browser's MLS group; screens are under the same per-sender encryption as everything else. LiveKit's own logs go to the app's logger at debug; a decryption error
  is logged at debug when a key is briefly missing around a key change, and as a warning otherwise.
- **Asking to join.** The organizer gets a toast, a count on the People button, and an Asking to join section in
  People to let people in or turn them away: someone signed in with their address and "Gets the notes once let
  in", a guest as "Guest, by name only" and "Doesn't get the notes". A guest's toast has Let in; letting in
  someone with an address gives them the notes, so their toast has Review, which opens People. Their call
  re-reads the meeting when someone with an account is in it and not on the invite yet, and after they remove
  someone with an account, so who's invited (who gets the notes, who can go to a breakout room) includes whoever
  they let in and not whoever they removed.
- **Host controls** are the organizer's, in People: mute someone's microphone (LiveKit mutes the track, their
  dock shows it off, they're told, and only they can unmute), remove someone (they're told and go back to the
  call's page), and lock the call.
- **Each person's volume, for you.** Anyone can turn someone else up to 100% or down to muted for themselves,
  from that person's tile menu or their row in People ([Media in the browser](#media-in-the-browser)).
- **Chat** is `crypto.chat`, decrypted in the browser; names come from the people in the call. It's off until
  the browser holds the call's keys, takes up to 4,000 characters, says when there was earlier chat it can't
  read, and gives back a message that couldn't be sent.
- **Spotlight** goes through the server and can name anyone in the call. It leads on everyone's stage.
- **Your view** (`view.ts`, laid out by `stageLayout.ts`) is each viewer's own and is never sent anywhere: Auto,
  Speaker or Grid; up to six pins, which share the main stage (in Grid they come first and bigger); the order you
  put people in; who you made bigger; how much room shared screens get beside the people; and where you see
  yourself (in the grid, in a corner the layout makes room for so it never covers a tile, or hidden, folded into a
  chip there). Two ready-made layouts, Everyone equal and Presenter and me, are defined by role rather than by
  person, so they fit any call. Reset puts the layout back to Auto (where you see yourself stays as it is), with
  Undo in its toast, as unpinning everyone and the ready-made layouts have.
- **What's remembered where.** How you like calls (the mode, room for shares, where you see yourself and its
  corner: `CallViewPrefsSchema`) is in `localStorage` for your account, `alcove.callView.<ownerId>` (one set for a
  browser without an account), because it's about you, not about anyone in a call. How you arranged this call
  (pins, order, sizes, which shares you see big: `CallLayoutSchema`) only means something in this call, so it's in
  `sessionStorage` for the tab, `alcove.callLayout.<callId>`: a reload keeps it, and leaving the call deletes it.
  It names people by their `seat` (`CallParticipant.seat`), not their participant ID: participant IDs are LiveKit
  identities, new for every connection (a reload is a new connection), while a seat is the same across someone's
  reconnections (a reload's pass carries their random `person`; the organizer has one seat on any device; anyone
  else joining from a second browser is a new person with a new seat). The API makes it when the call is read, a MAC
  of that `person` under a key for the call from the organizer's root, so nobody can work one out, it stores nothing
  new, and it differs in every call. Shares are named by their sharer's participant ID, since a share lives and dies
  with its connection. Neither store holds a name, an address, or anything said or shared.
- **Nothing you chose moves by itself.** Someone you pinned who leaves keeps their pin and has it again when they
  come back to the same seat; you're told both times. With all six pins taken, pinning someone else gives up the
  oldest pin of someone who isn't here, and someone the organizer removes loses the organizer's pin, since they
  can't come back. Everyone keeps their place across reconnections (the order
  people first came in, by seat). Speaker view hands the main stage to someone only after a moment of talking and
  leaves it with them while they talk, and in the strip whoever steps down takes the place of whoever steps up.
  Auto shows one person big only once they've had most of the talk time over the last minute or so (yours
  counted), and only while you haven't arranged anything. Shares take the stage in Auto and Speaker until you
  choose how to see any of them; from then on a new one comes in as a tile. Your pins stay first beside them, and
  when they stop everything is where it was. Cameras turning off move nothing.
- **Keyboard.** The stage is one tab stop. Arrow keys move between tiles, Enter (or Shift+F10) opens a tile's menu,
  P pins or unpins (on a share, shows it big or as a tile), Shift with an arrow moves a tile earlier or later (your
  corner picture to another corner), and + and − make it bigger or smaller; Escape unpins everyone. The line beside a
  shared screen, and the one between two, is a separator moved with the arrow keys, Home and End. Each tile's menu
  shows its keys, and on touch screens its ⋯ is always there.
- **Shares.** Several people can share at once, a screen each, and nobody's share replaces anyone else's. A share
  starts only while fewer than four (`MAX_SHARES`, `share.ts`) are going in your part of the call, yours counted:
  two sit side by side and the rest wait as tiles, and past four the stage would give screens more room than people
  while every browser decrypts and decodes one more stream for each. The cap is the browser's, not LiveKit's: it's
  checked when the share picker opens and again at the click that starts sharing, so people still choosing in their
  browser's own picker at the same moment can take it over, and the stage takes any number. While four share, the
  share button says so.
- **Seeing shares.** The stage keeps shares in the order they started here. Each names whoever shares it, in the arch
  with their name (never by colour alone), and marks a share that carries sound. Until you choose, the first two of
  everyone else's are big, side by side or one above the other, whichever shows both pictures bigger, with a line
  between them that you drag or move with the arrow keys (Home, End, Enter for half and half); one on a narrow
  stage, where the rest sit under it as tiles to switch to. A click on a share's tile, or P on it, shows it big:
  beside what's big, or, when as many are big as fit, in place of the one that's been big longest. The stage keeps
  every share you made big and shows the latest that fit, so a stage that grows (the panel closing) shows them
  again. Its ⋯ shows it as a tile again, and nothing takes its place. Your own share starts as a tile on your stage:
  you see what you share on your screen already, and a whole screen shown big would show itself. Choices about a
  share go when it stops: one seen on this connection that's gone.
- **A share starting or stopping.** A new share glows for a moment where the layout puts it. Until you've chosen how
  to see any share, a second one goes big beside the first (each gets half); once you have, a new share comes in as
  a tile and nothing you see moves. When a new share comes in as a tile for you, a toast says who started sharing,
  with Show it; when one you see big stops, the toast says that too. Neither is said once the call has ended or while
  the room isn't connected, nor for a few seconds after it connects, reconnects or your part of the call changes
  (breakout rooms opening, closing or moving you), when shares come and go with the connection or the room.
- **Changing what you share** swaps the track inside the same LiveKit publication, so everyone sees it change in
  place, with their choices and its muting kept, rather than one share stopping and another starting.
- **A share's sound.** Anyone can mute the sound of someone else's share for themselves from its ⋯ (`CallRoom.muteShare`:
  this browser stops playing that track). It's kept by the share's picture's track sid, so it lasts while that share
  goes on, through a change of what's shared and through this browser's own reconnects; it's said on the share, and
  changes nothing for anyone else.
- **Sharing honestly.** The bar says you're sharing only once LiveKit has your screen (until then it says it's
  starting), and adds "with sound" while the capture's sound is live. Publishing reads LiveKit's current publication
  for each kind (after a full reconnect, the one LiveKit republished) and handles each kind on its own: a camera that
  won't publish never keeps the screen from trying, and only the screen's own failure is said. A screen that can't
  be published is stopped, if it's still the capture being shared, and you're told, with Try again. When the picture
  ends (the browser's own Stop, or the shared tab or window closing), the whole capture stops, sound included, and
  LiveKit unpublishes it, so it goes for everyone at once; a presenter who leaves or drops takes their share with
  them when LiveKit says they've gone.
- **Captions** show the newest live transcript line, under whoever said it, translated for each viewer who
  picks a language. They're hidden while rooms are open, and say so instead of showing an old line while notes
  are paused or off, or while the organizer's browser can't listen.
- **Catching up** (`CatchUp.tsx`, `catchingUp.ts`) is for the person asking alone. **Catch up** in the top bar and
  the More menu opens the Ask view on what they most likely missed (their recent time away, what was said before
  they joined late, or the last five minutes). In the Ask view a chip says what's read and opens a menu: the last 5
  or 15 minutes, before you joined, since you joined, while you were away, the whole call, or a stretch picked on
  the call's timeline (two handles, by pointer or keys; notes-off and paused stretches hatched, time away marked,
  and for a guest what they can't read dimmed). Each answer says the stretch it read, how many lines it read and as
  of when, and what can't be in it, all as times of day like the transcript's gaps. Each point carries its moments
  as time chips, to the second; one opens the transcript at that line, marked, with what was said around it, asked
  of the server again. **Back to live** returns the panel to
  how it was before catching up (closing it on a phone), and the transcript to following along; the viewer's own
  layout (pins, sizes, order, self-view) is never touched. Someone who comes back after time away, or joins well
  after the start, is offered a catch-up once, as a toast, decided when the call screen first learns their window;
  nobody is while notes have never been on, and a guest isn't, since they can't read what was said then.
  Nothing of it is kept: it goes with the page.
- **Notes.** While notes are on, the recorder keeps the organizer's microphone, and the live transcript hears
  everyone the organizer's browser plays: its own microphone and each other microphone in its part of the call
  (`CallRoom.heard()`, the raw decrypted tracks of unmuted microphones, so nobody's volume on this screen changes
  what's heard). Each person is heard on their own (`CallEars` in `speech.ts`: one `SpeechClips` per voice,
  sharing one audio context and counting from the segment's start), so every clip says whose it is
  (`x-alcove-speaker`, a participant ID the server checks is someone in the call: not still asking, not turned
  away, not from another call), and every line is said by that person. A voice no longer heard (they left,
  muted, or a room move took them out of earshot) stops being listened to at once and sends what it had heard.
  A line keeps the breakout room its speaker was in, from where they were sent (the organizer: the room they
  were visiting), with rooms that have run out counted as closed. Without a microphone of the organizer's own,
  everyone else is still heard. Nothing shared, picture or sound, is recorded or transcribed (`heard()` is
  microphones only, and the capture state's `screen` part, "Shared screens", is always off): seeing a share takes only
  being in the call (its group, and your room while rooms are open), and what the notes capture is decided apart from
  it. Pausing holds the recorder and every voice (`hold()`) until the server answers,
  then drops what they held (`discard()`, `stop()`) or carries on (`release()`) ([What's captured](#whats-captured)).
  The browser also says what it can't capture, whenever that changes: no microphone, a recorder that failed
  (`NotesRecorder`'s `onBroken`), or no audio worklet (`canListen()`, and `CallEars`' `onDeaf` when the worklet
  won't load).
- **What's captured.** The notes sign in the top bar is the same for everyone: **Notes on** (crimson),
  **Notes paused**, **Notes unavailable** (caution), **Notes off**, or **Notes requested** while someone has
  asked; the organizer's own says **Pausing…** while their pause is on its way. It opens a popover
  (`features/call/Capture.tsx`) with each kind of capture and its state, who changed it and when, who gets the
  notes, and that they're written in confidential compute; with the organizer's **Pause notes**, **Resume
  notes** and **Turn off** or **Turn on notes**, or anyone else's **Ask for notes**. Its sentence says what's
  captured now: what everyone says transcribed and the organizer's microphone recorded, less whatever the
  organizer's browser can't do. The notes panel has the same controls in its menu and empty states. The
  transcript, in the call and in the note, marks each gap.
- **Asks for notes.** The organizer gets a toast with Turn on (or Resume), and an Asking for notes section in
  People with Not now for each; everyone sees "Asked for notes" on the asker's row. Whoever asked hears when
  the organizer says not now. Joining shows only the latest notice as a toast; older ones are history.
- **Before joining.** Guests and invited people see what the call captures on the join page, before they ask
  and while they wait (`CaptureSummary` in `@alcove/ui`, from the card, refreshed every few seconds).
- **Breakout rooms.** The organizer opens rooms for the invited people in the call (by email, as the server
  requires); guests stay in the main room. Who's in each room comes from `breakouts.open.rooms[].members`,
  and each browser tells the room whose media to play (`CallRoom.playOnly`). The organizer sees every room:
  who's in it, who's talking (LiveKit's speaker detection) and a raised hand as that room asking for help.
  Everyone else sees only their own room or the main room, with the time left and the organizer's messages,
  and is told when the organizer comes into or leaves their part of the call. Of the live transcript they read
  the main room's lines and their own room's (catching up, questions and caption translations too).
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
  Browsers that hand out new device IDs (after clearing site data, say) start from their defaults again.
- **Permission and device state.** Before asking, `LocalMedia` reads the Permissions API (`microphone`,
  `camera`; Chrome, Firefox 132+, Safari 16+) and never asks for a device the browser already refuses. It asks
  for both together and, if that fails, for each alone, so a blocked, missing or busy camera never costs the
  microphone. Each device then has a state (`MediaSnapshot.access`): allowed, refused or not asked yet, and,
  when it isn't working, why: blocked by the browser, kept from the browser by the computer (allowed in the
  browser yet refused; Chrome says "by system"), the question went unanswered, none plugged in, busy in another
  app, or didn't start. A refusal that comes back faster than anyone could answer counts as blocked. Pre-join
  shows the state in place of the picker, says in plain words how to allow it in this browser (or in the
  computer's privacy settings), offers Try again, and never keeps anyone from joining: they join with both off.
  In the call the dock's buttons carry a caution mark, and pressing one that can't work opens its menu with the
  same explanation (`apps/web/src/features/call/access.ts` holds the copy).
- **Watching devices.** From the first start, `LocalMedia` follows `devicechange`, each track's `ended`, the
  permissions' `change` events and, because Safari never sends those, the page coming back into view. A
  microphone or camera that's unplugged gives way to the chosen one or the system's, muted or not and on or off
  as it was; with none left it turns off and says so. A chosen device that comes back after it was gone is used
  again (one that's listed but won't start isn't tried at every look), and a microphone left on the system's
  follows the system when its default moves (Chrome's `default` entry changes group). A choice is remembered only
  once it has opened, and a remembered device that's listed but won't start (busy in another app, say) gives way to
  the system's. Device work happens one step at a time; each step carries the moment it was asked for, so a stop
  (leaving the screen) or a later press wins over work still waiting, and a device opens the way the latest press
  says. Before the call, a device that becomes usable (plugged in, or allowed again) starts the way the person
  wanted it; in the call nothing turns a microphone or camera on by itself: it says the device is ready and
  waits for its button. Each change nobody pressed for is said once (`MediaSnapshot.changes`): under the
  preview before the call, as a toast in it.
- **Switching tracks safely.** A new microphone or camera is swapped into its existing LiveKit publication
  (`replaceTrack`): nobody sees it stop and start, it stays muted or not, and the organizer's mute still finds
  it. The room always reads LiveKit's current publication rather than keeping its own, and publishes nothing while
  LiveKit reconnects (a full reconnect republishes every track under a new publication); it catches up once
  reconnected, so nothing is ever sent twice. LiveKit mutes a publication whose device was unplugged; the room
  tells that apart from the organizer's mute by whether the track's `ended` event really fired, and unmutes it
  again only if the person's microphone (or camera) is on by then.
- **Speakers.** Where a page can choose one (`setSinkId` on media elements: Chrome, Edge and Firefox; LiveKit
  doesn't on Safari), the chosen speaker goes through LiveKit's own output switching, so every element plays
  there, now and as people arrive, and LiveKit's device handling knows it. Firefox lists speakers only once the
  page has used the microphone. A chosen speaker that's unplugged falls back to the system's, and is used again
  when it's back. Where a page can't choose (Safari), the menus say calls play through the speaker the system
  uses, and where to change it.
- **Each person's volume, for you** (`apps/web/src/features/call/volume.ts`). From 0 (muted for you) to 100%,
  on the element that plays that person's voice (`RemoteAudioTrack.setVolume`, LiveKit's element playback;
  a tab they share plays at its own volume). Their track itself is never touched: it stays exactly as it
  arrived, so turning someone down, or a muted speaker, never changes what the person sends, what's recorded or
  transcribed, or anyone else's sound. It's set again on every element that plays them (a resubscribed track,
  media held back and played again around a key change or breakout rooms, a reconnect). Levels are kept for
  this call in this tab's `sessionStorage` (`alcove.callVolumes`, `CallVolumesSchema`), by the random identity
  each connection has in the call, never a name or address: a reload keeps them, leaving the call or closing the
  tab forgets them, and someone with an account who comes back on a new connection keeps theirs (matched in
  memory only), as does the level to go back to after a quick mute. Browsers that lock an element's volume
  (iPhones) don't offer it. There's no going above 100%:
  that needs Web Audio on the way to the speaker, which LiveKit turned off by default because echo cancellation
  doesn't cover it everywhere.
- The microphone test (`apps/web/src/features/call/devices.ts`) records three seconds in memory and plays
  them back through the chosen speaker. Nothing is uploaded or kept. In the call, **Play test sound** plays a
  short chime through the chosen speaker.
- `getDisplayMedia` for screen sharing (`shareScreen`), opened on the kind picked in the share picker (tab, window or
  screen), from the click itself (Safari and Firefox need that), with the call's own tab left out of the browser's
  picker. It captures nothing but what's picked: sound only when asked for (a tab's, or the computer's on a whole
  screen), and with `restrictOwnAudio`, so where the browser knows that constraint the computer's sound never carries
  the call's own (everyone's voices). The picker offers sound only where the browser can share it: Chrome and Edge
  share a tab's sound, Firefox and Safari share none. Ending it from the browser's own control updates the call.
- Why a share didn't start is read from the browser's refusal (`share.ts`): closing the picker says nothing; Chrome's
  "Permission denied by system" is the computer refusing (macOS without Screen & System Audio Recording permission:
  the picker comes back saying where to allow it, and offers a tab, which needs no permission); a refusal faster than
  anyone could answer a picker is the browser or a policy blocking it; the rest are nothing to share, the capture
  held by another app, or a failure to try again. Each comes back in the picker with what to do. A browser without
  `getDisplayMedia` (phones and tablets) is told it can't share and can still see shares. Sound asked for that didn't
  come (the browser picker's own switch was off, or the computer wouldn't share it) is said, with Change.
- A Web Audio analyser drives the mic meter (in the microphone picker before the call and beside the microphone
  in its menu), the speaking ring and the recorder waveform.
- Sound the browser won't play until the page is clicked (Safari, when nothing is being captured) is said in the
  status bar for as long as it lasts, with **Play sound**, and every click, tap or key tries again
  (`CallRoom.startAudio`) until it plays.
- `NotesRecorder` picks the first supported codec (Opus in WebM, then MP4, then Ogg) at 32 kbps. It records
  through a Web Audio graph (a `MediaStreamAudioDestinationNode`), so switching microphones mid-recording
  carries on in the same recording instead of going silent; MediaRecorder can't change its input track.

Beside it, `SpeechClips` (`apps/web/src/features/call/speech.ts`) feeds the live transcript: an
AudioWorklet (`apps/web/public/pcm-capture.js`) mixes the microphone to mono, filters and resamples it to
16 kHz, and the samples are cut into WAV clips at pauses. Clips without a voice in them aren't sent. It
never touches the encrypted recording.

## Next

- **Host hand-off** when the organizer drops (#30): another member's browser takes over committing.
- **Screen notes** (the stretch goal) would sample shared-screen frames inside the attested service;
  Scribe's autocapture is a reference for turning screen activity into a written summary.
