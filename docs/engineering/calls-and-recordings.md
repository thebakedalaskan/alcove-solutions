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
      B->>A: POST /v1/live/calls/:id/audio (segment, seq, start, bytes)
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
  starts segment `n+1`, and so does the organizer joining the call again while notes are on (a reload,
  another tab: the new connection takes over from the old one): the new page's recorder never lands among
  the old one's pieces, and audio from the old page, still in the earlier segment, is refused. Each segment
  is one continuous MediaRecorder stream, so its pieces concatenate into one playable file.
- **Ordering and retries.** The browser uploads pieces in order. While the connection is down, or the server
  is busy, it keeps trying each one for up to two minutes, so a short drop loses nothing; a refusal that trying
  again won't change gives up at once (a `409` quietly), and stopping waits at most 10 seconds for the last
  pieces. Each piece says where it starts in its segment, pauses not counted (`x-alcove-at-ms`). The server
  treats a repeated `(segment, seq)` as a no-op (a different piece sent to a place already stored is
  `409 conflict`) and rejects audio for a paused or stopped recording, for an earlier segment, or from one of
  the organizer's connections that another tab or device has taken over (`409`: that tab drops what it hadn't
  sent, as below). A piece whose `content-length` is over 2 MiB is refused before its body is read.
- **Live transcript.** While notes are on, the organizer's browser also sends clips of speech, one stream per
  voice it hears (its own microphone and each other unmuted microphone it plays), to
  `POST /v1/live/calls/:id/transcribe` (16 kHz mono WAV, at most 30 seconds, each saying where it starts in
  its segment with `x-alcove-at-ms`, whose it is with `x-alcove-speaker` and how long before the request it
  began with `x-alcove-ago-ms`; 40 a minute for each voice, 240 for the account). Each clip is transcribed by
  NEAR AI and kept as sealed lines in the part of the call its speaker was in when it began, and
  `CallState.transcript` carries the latest 200 the viewer may read, each under whoever said it. Clips are
  refused while notes are off or paused, for an earlier segment, from anyone not in the call, or for a
  breakout room that has closed. See [Notes and inference › The live transcript](notes-and-inference.md#the-live-transcript).
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
  locked (`403 forbidden`; a lock keeps new people out, not someone coming back to their place) or once it has ended (`409`, "This call has ended."); someone removed asks again. An
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
  admin rights) to people let in, and to nobody else. It may send data, which browsers use for pointers and marks on
  shared screens, sealed end to end ([Pointing at shared screens](#pointing-at-shared-screens)); the API is never in the
  room, so it never receives any. Tokens carry no name: LiveKit knows people only by random identity.
- **The call pass** is an HMAC (a key derived from `KMASTER`) over the call, the organizer, the person's
  LiveKit identity, role and name, valid for 12 hours. It goes in the `x-alcove-call` header on every
  `/v1/live/calls/:id` request, never in a URL or log. The live routes open the organizer's keys for it
  from `KMASTER`, per request. A removed person's pass stops working, and once the call has ended only the
  organizer can read it.
- **What each role can do.** Everyone let in: read the call, chat, catch up and ask, for themselves alone
  ([Catching up during a call](notes-and-inference.md#catching-up-during-a-call)), raise a hand, ask for notes,
  point at and mark shared screens and say whether others may point at what they share
  ([Pointing at shared screens](#pointing-at-shared-screens)), and, while screen notes are on, send frames of their own
  shared screen ([Shared screens](#shared-screens)).
  Everyone reads the live transcript of the part of the call they're in, as said while they were there; a guest
  with the link, who doesn't get the notes, reads only what was said while they were in the call as well (the
  live transcript, captions, catching up, asking and moments), while the organizer and everyone on the invite
  (people signed in whom the organizer let in included) read all of it. Only the organizer (pass role `host`, their
  own session and their current connection: joining from another device takes the powers with it, and so does moving there, below; an earlier connection of
  theirs is told `409` "You're in this call from another tab or device now"): let people in
  or turn them away, notes on/off, pause and resume, say not now to an ask for notes, say what their browser can't
  capture, audio and speech uploads, mute someone's microphone, remove someone, lock the call, turn pointing at
  shared screens off for everyone, and end it. The
  recording and the live transcript both come from what the organizer's browser hears (see Notes below). Link guests get no notes; invited people, and people signed in whom the organizer let in, get them.
- **Leaving and ending.** Anyone but the organizer leaving is taken out of their part of the call's group, so
  its keys move on without them. They leave with **Leave** (`POST /v1/live/calls/:id/leave`), or when their page goes away
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
  reload, a comeback, a move to another device) and, for the organizer, on any device, which viewers' own layouts
  key them by ([The call screen](#the-call-screen)). Anyone else joining from a second browser or device without
  moving gets a new seat.
- **In the browser** `apps/web/src/features/call/livekit.ts` (loaded only by the call screen) wraps the
  room: it publishes `LocalMedia`'s tracks as they are, encrypted, swapping a new microphone or camera (or a
  change of what's shared) into the same publication, plays everyone else's audio on the chosen speaker at each
  person's volume for this listener, and refetches the call on the server's nudges, arrivals and departures. Nudges are
  taken only from the server (a packet from no participant): anyone in the room can send data, which carries pointers
  and marks, and a stream of nudges from one of them would keep every browser fetching the call. Several people can
  share a screen at once ([The call screen › Shares](#the-call-screen)).

## End-to-end encryption

Every browser in a call is an MLS client (RFC 9420): `packages/api-http/src/mls.ts`, on ts-mls, suite
`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`. Its keys are made in the browser and never leave it. The
API orders and relays MLS messages and can't read them. Each group's operations run one at a time, in
order, and nothing a message carries can stop it: anything unreadable is skipped and the next one is read.

- **One group for each part of the call.** The main room has an MLS group, and while breakout rooms are open
  so does each room (named `alcove/call/<call>/<generation>/<main or the room's ID>`). A part's media keys and
  chat come from its own group, so they belong to the people in that part alone. The organizer's browser
  creates every group, so it's in all of them; everyone else is in exactly one at a time, the group of the part
  they're in (the API adds only people who are in no group). Where someone is comes from the call's state
  (`CallMls.place`): an invited person sent to a room is in that room, the organizer in the room it's visiting,
  and everyone else in the main room.
- **Members and commits.** Joining makes a fresh key package whose credential is the connection's random
  identity. The organizer's browser is every group's only committer: it adds people (an Add commit, with a
  Welcome carrying the ratchet tree for each) and removes whoever left, was removed, or was sent to another part
  of the call. Every other browser accepts commits only from the committer's leaf (leaf 0, which a joining
  browser checks is the connection the API names as committer, in the group it expects: this call, this
  generation, this part). The organizer's browser adds only people the API lists as pending for that group
  (`CallMls.groups[].pending`), checks each key package (well formed, this suite, signed by its own key, naming
  the identity it came with; one that isn't is turned away), adds at most 50 at a time, and waits a little
  longer after each refused commit, so a refusal can't become a loop. When nobody comes or goes it moves each
  group's keys on anyway every 10 minutes (an empty commit), so one set of keys never covers a whole call.
- **Who commits.** The organizer's current connection, for every group. Host hand-off (#30) changes that, and
  these are every place that assumes it: `committerOf` (the places module), which names the committer to every
  browser (`CallMls.committer`); the `/mls/commits` route, which takes commits only from the organizer
  (`organizerOnly` in `app.ts`); `mlsSync`, which gives the organizer's connection the committer's view (every
  group's commits, whom to add to each and take out of it), and `join`, which starts a new generation when the
  organizer's connection changes (the calls module); and in the browser, `HttpCall`'s `organizer`, which opens
  and commits for every group, and `COMMITTER_LEAF` (`mls.ts`), the one leaf whose commits a group takes.
- **Moving between parts of the call.** Rooms opening or closing, or the organizer moving someone
  (`rooms-move`), changes where people are. The organizer's browser commits every group's departures before any
  additions: it takes each mover out of their old group, whose keys move on without them, then adds them to the
  new part's group with a fresh key package (each key package joins one group at most; the API asks a browser for
  a new one with `CallMls.keys`, and gives the organizer's browser each mover's latest one with their entry in
  `pending`, however early it came). In between, the mover's browser sends under a random key at a ring index no
  epoch uses (`CALL_VOID_KEY_INDEX`), so nothing it sends can be decrypted anywhere; it plays nobody (it isn't in
  the new part's group yet, and the call no longer counts it in the old part), and its chat is off (the API relays
  a part's chat only to the people there). It keeps the old group only to read the commit that takes it out, then
  drops it. Until then, and for the moment the old part's members take to switch keys after that commit (about
  2 s), its LiveKit key ring still holds keys that open the old part's frames; nothing plays them. Rooms closing
  drop their groups: everyone in them comes back into the main room's group, on keys none of them held before.
  The organizer moving between rooms only changes which group's keys it sends and plays with, and what it hears
  for the transcript (each clip ends at the move).
- **The log.** `GET /v1/live/calls/:id/mls?after=` gives each browser its part of the call's MLS log
  (`call_mls`, each entry but a key package tagged with its part of the call). The organizer's browser gets
  every group's commits from the start of the generation, the key packages it may act on, and chat only from
  the part of the call it's in, from when it got there. Anyone else gets only their own group's entries: their
  welcome, its commits, and its chat while they're in that part (`earlierChat` says whether there was chat there
  they can't read). It reads up to the call's last seq as it stood, 100 entries at a time (`more` says ask
  again), so nothing is skipped or sent twice. The API takes exactly one commit per epoch for each group, in
  order (`409` for a stale one, or for a room that has closed); a commit whose answer was lost is sent again as
  it was. Bodies are sealed again under the organizer's call key, bound to their place in the log and their part
  of the call. A room's entries are deleted when it closes, and the whole log when the call ends.
- **Media.** Each sender has its own media key every epoch, `MLS-Exporter("alcove/call-media/v1",
  identity, 32)` from its group's exporter secret: a key encrypts only its sender's frames (as SFrame requires,
  RFC 9605 §4.4.1), every member of that group can derive every sender's key to decrypt them, and nobody outside
  the group can. LiveKit's frame encryption uses them (AES-GCM in a worker, per participant, keys derived with
  HKDF), and a browser puts only its own part of the call's keys there. A key's ring index is the epoch modulo
  127, in one half of LiveKit's 256-key ring per generation, so a group being left keeps its keys while people
  still send with them; the ring's last index is the one sent under between parts. Each frame carries its key's
  index in the clear (LiveKit's frame trailer). The parts of the call share the same indices (a browser only ever
  holds one part's keys for any sender), so an index alone doesn't say where someone is, but whose indices change
  together, and who sends under the last one, does (What it doesn't cover, below); a separate range for each room
  wouldn't hide that, and would name the room outright. Browsers keep the last four
  epochs' keys to decrypt with, and switch their own send key a moment after their group's keys move on (0.5 s
  after someone is only added, 2 s after someone leaves or the keys move on by themselves; at most twice that in
  a burst), so everyone has the new keys before anyone sends with them. Someone who left a group (the call, or a
  room) can't follow what comes after, and someone new can't decrypt what came before. Like SFrame, this doesn't
  stop a member from sending media as another member of its group (every member can derive every key). A
  browser that can't encrypt frames can't join; there's no unencrypted fallback. Frames it can't decrypt are logged
  at debug while they're expected (a key that hasn't arrived yet, or someone in another part of the call) and at
  warn otherwise. Media is played or shown only if
  LiveKit marks it encrypted, its sender is in the browser's group, and the call says they're in the same part of
  it; anything else is held back.
- **Chat** is MLS application messages in the group of the part of the call the sender is in, encrypted in the
  browser's sync loop (so nothing else touches the keys meanwhile): only the people in that group when a message
  is sent can read it, and someone who comes in later sees that earlier chat exists but can't read it. The API
  takes chat only into the sender's own part of the call (`400` otherwise), so nobody, the organizer included,
  posts into a room they're not in. The sender comes from MLS (the message's sender leaf and signature), not from
  the text. A message that can't be sent after a few tries, or whose sender moved before it went out, is taken
  back, and the sender is told. Messages are at most 4,000 characters.
- **Data between browsers** (pointers and marks on shared screens) goes through LiveKit, not the API, sealed by the
  sender's session with a key derived from its own media key for the epoch, in its part of the call's group
  (`CallSession.sealData`), and opened with the media key of whoever LiveKit says sent it (`openData`). It's read only
  from the people whose media would play, and a room's data doesn't open anywhere else: other parts hold other keys
  ([Pointing at shared screens › How it travels](#how-it-travels)).
- **People, not connections.** Each browser keeps one `person` across its reconnections (its pass brings
  it back once, without asking; a second use of the same pass has to ask), so removing someone removes
  every connection of theirs and none of their passes works again. A reload comes straight back into the group
  of the part of the call it was in (a breakout room included), and the old connection is taken out of it, so
  nobody is counted twice. Leaving while still asking, closing the page included, takes the request back and
  forgets it: a pass only brings back someone who was let in, so asking again means being let in again. A
  LiveKit `participant_left` webhook only takes someone out of their group after LiveKit confirms, three seconds
  later, that they're really gone; if that browser is still there when its connection comes back, it comes back in
  as it is, into the group of the part of the call it's in ([Reconnects](#reconnects)). A browser that's removed,
  turned away, or whose place another tab or device took is told and stops.
- **A new organizer connection** (a reload or another device) starts a new group generation for every part of
  the call: the old connection's keys stay with it, everyone already in rejoins their part's new group with fresh
  keys without asking, open rooms stay open (the organizer in the room it was visiting), and anyone still waiting
  keeps waiting (key packages aren't tied to a group, so theirs carry over).
- **Who vouches for whom.** The API says who each identity is, who's invited, what their names are and who's in
  which room; it can't read media or chat. It's built to run attested, but it runs on Cloud Run today, so whoever
  operates it could run other code (privacy › Moving to confidential computing). There are no safety codes. An
  API running other code could have the organizer's browser add someone as an invitee, or put them in a room they
  weren't sent to, but never silently: everyone sees every member of their part of the call's group in People (as
  "Someone" if the API doesn't name them), and their tile if they connect.
- **What it doesn't cover.**
  - The organizer's browser holds every room's keys, because it commits for every group, so a modified
    organizer browser could hear and read any room. An unmodified one plays, sends and chats only in the part of
    the call it's in, the API relays a room's chat to it only while it's there, and the room is told when it comes
    and goes. Zoom's end-to-end encrypted breakout rooms give each room a leader of its own instead; here that
    waits for host hand-off (#30), which lets another connection commit.
  - Every part of the call shares one LiveKit room, so LiveKit forwards each room's encrypted frames to everyone
    in the call: a modified browser gets frames it can't decrypt from other rooms, with their audio-level header,
    so it can tell who is speaking when in another room, though not what they say. Each frame also carries its
    key's ring index in the clear (LiveKit's frame trailer), so LiveKit can see whose keys change together, and so
    who is in which part of the call, and who is between two (the reserved index).
  - While notes are on, what everyone the organizer hears says also goes to the API, outside the media encryption,
    as the call's People panel says: the organizer's microphone and every other microphone the organizer's browser
    plays, each person's speech on its own as clips to transcribe, and the recording, which mixes them
    ([The call screen](#the-call-screen)). Breakout rooms the organizer isn't in aren't heard. The call's notes have the main room's talk: a room's lines aren't kept in the note, and the
    recording is silent while the organizer is in a room ([Breakout rooms](#hands-spotlight-breakout-rooms-and-captions)).
  - LiveKit still sees addresses, when calls happen, who's in the call's room (by random identity), track kinds and
    mute state, packet sizes and timing, the audio-level header, so exactly who is speaking when, and the size and
    timing of the data browsers send each other, so roughly when someone points or draws on a shared screen (not
    where, nor at what).

## What's captured

One capture state for the whole call (`CallState.capture`, `packages/api/src/capture.ts`), kept in the
call's sealed state (`apps/api/src/modules/capture.ts`) and the same for everyone in it:

- **Its parts.** `recording` (what the organizer's browser hears in its part of the call, mixed: its own
  microphone and everyone else's, encrypted; silent while the organizer visits a breakout room), `transcript`
  (everyone the organizer's browser plays in its part of the call, turned into text by the private speech model, each line under whoever
  said it), `ai` (the private notes model reading the transcript: the notes at the end, catch-up, questions and
  captions during the call) and `screen` (shared screens read for the notes). Each is `on`, `paused`, `off` or
  `unavailable`, with when it last changed (`since`) and who changed it (`by`: the call's schedule, or the
  organizer by name). Recording and the transcript follow notes. The notes model reads what was transcribed for
  as long as there is some, so `ai` stays `on` while notes are off once they've been on, and only a pause stops
  it. `screen` is `off` until the organizer has shared screens read, and then follows notes: on, paused with
  them, off when they're turned off ([Shared screens](#shared-screens)); presenters' own browsers send the
  frames, so it doesn't depend on what the organizer's browser can capture. `mode` says it in one word: `on`,
  `paused`, `off`, or `unavailable` when notes are on but the organizer's browser can neither record nor listen.
  Capture runs in one place, the organizer's browser, and the server enforces it on the audio and transcribe
  routes, which only the organizer's current connection may use; shared screens come from each presenter's own
  browser.
- **Unavailable.** The organizer's browser says what it can't capture (`{type: "unavailable", parts}`, the
  organizer's only): the recording when the recorder couldn't start or failed (without a microphone of the
  organizer's own it still records everyone else), the transcript when the browser can't run the audio worklet
  it listens through. While notes are on, those parts are `unavailable` for everyone, and when it's both, `mode` is too
  (the sign says **Notes unavailable**, in caution). It's forgotten with every change to notes and when a new
  organizer connection takes over (joining from another device, or moving there), and one that arrives while
  notes aren't on is ignored, so the browser says again and nobody is told something isn't captured when it is.
  Both parts are also unavailable while the organizer's browser is out of the call (`away`: LiveKit says its
  connection left, and neither it nor another of the organizer's connections is back yet), and the sentence
  says so: "Art's browser isn't in the call right now, so nothing is captured until it's back". So is every open
  breakout room's transcript (`CaptureState.room`), and a room's gaps include the part of an `offline` stretch while
  it was open.
- **Who sees it.** Everyone in the call, and anyone reconnecting, gets it with the call. People asking to join
  and anyone reading the card get it without names: `by` says only "the organizer", and there are no gaps or
  asks. Every change nudges the room, so browsers fetch the call again.
- **Pause** (`{type: "pause"}`, only while notes are on) stops every kind of capture at once. The one gate every
  capturing path goes through, `mayCapture` in `apps/api/src/modules/capture.ts`, refuses audio pieces, speech
  clips, caption translations, catch-up and questions with `409 conflict` ("Notes are paused…"), whoever sends
  them, so nothing new is recorded, transcribed or sent to the AI; shared-screen frames are refused too. The
  organizer's browser holds everything as it sends the pause: the recorder and every voice stop, and nothing they
  have is sent. Once the server has paused, what they held is dropped rather than flushed, and a `409` from a
  later upload is dropped too; a presenter's browser stops looking at its share and drops its unsent frames as
  soon as it sees the pause. If the pause fails, notes are still on, so the same recorder and voices carry on and
  send what they held: the recorder's pieces stay in order, and no segment restarts from piece 0. While it's on
  its way, the organizer's sign says **Pausing…**; that's the only in-between state, since the server changes the
  call's state in one step and everyone else sees it change at once. What the server took before the pause
  stays: a piece or clip that got through the gate before the pause was saved is kept (a clip still being
  transcribed lands in the transcript, before the pause). Notes off is the same for audio and speech, but
  catch-up, questions and captions still read what was transcribed before. Turning notes off sends the last
  audio and speech first; if it fails, the same recorder carries on.
- **Resume** (`{type: "resume"}`) is the organizer's choice and nothing else's: not a reconnect, not a reload,
  not a breakout room, and not a new organizer connection (another device, or a move to one), which takes over
  with notes still paused (or off).
  Resuming starts segment `n+1`, and so does turning notes on.
- **Gaps.** Every stretch with nothing captured (notes off, from the start until they first come on, paused, or
  `offline`: notes on, but the organizer's browser out of the call until another of their connections took over
  or the call ended, "Organizer offline 10:20–10:21") is a gap: when it started and ended, and where it falls in the recording (`at`, at the end of the segment
  before it, as transcript lines are placed). The call (`capture.gaps`), a catch-up (`CatchUp.gaps`, the ones in
  or after what it read) and the finished note (`Note.gaps`) carry them; the transcript and chapters say
  "Paused 10:02–10:05" in their place, and the notes model reads a `--` line there and is told never to guess
  what was said in it. Changes are kept to a tenth of a second, so even a short pause shows. Lines stay inside
  their own segment: one placed past the end of its segment's audio (its last pieces were dropped by a pause)
  goes at the segment's end, so nothing said before a pause comes after it.
- **In breakout rooms.** Each open room has its own capture state, for the people in it and for the organizer
  while it's visiting (`capture.room`, beside the call's). A room is never recorded and nothing said in it goes
  into the notes; it captures (what's said there transcribed while the organizer is in it, and read for catching
  up, questions and captions) only while the call's notes are on and the organizer hasn't paused the room. The
  organizer pauses the room it's in, or carries on there, from the notes sign (**Pause notes here**,
  `{type: "rooms-pause", roomId, paused}`; pausing needs notes on). The call's notes don't change, only that room
  is told (a notice for its people alone), and the organizer sees **Notes paused** on the room's card in Rooms.
  The capture gate, asked for the part of the call something comes from, refuses speech placed in a paused room
  and catching up, questions and captions asked from one ("Notes are paused in this room…"). The organizer's
  browser stops hearing everyone there (`CallEars.quiet`: what was held is dropped, and the segment's timeline
  carries on), and the recording, which hears silence in a room anyway, goes on in its segment. Pausing the whole
  call pauses every room, and resuming it doesn't carry on in a room the organizer paused on its own. Each part
  says who changed it and when, from the call's changes and the room's together, and the room's gaps are the
  stretches since it opened with nothing captured there. Closing the rooms takes their capture with them: people
  come back under the call's, and are told when that means notes are on (moved back, or everyone back), as they
  are when the organizer comes into their room while its notes are on.
- **Asking for notes.** While notes are off or paused, anyone in the call but the organizer can ask
  (`{type: "request-notes", up}`; `up: false` takes it back; 10 a minute per person). Everyone in the call sees
  open asks (`capture.requests`, by participant), like raised hands. The organizer hears about each one as a
  toast and sees them in People, and either turns notes on (or resumes them), which answers every open ask, or
  says not now (`{type: "decline-notes", requestId}`). Whoever asked is told (`capture.asked`). Asks are kept in
  the sealed call state, one per person, by the person's ID across their reconnections.
- **What it doesn't cover.** Cameras and chat are never captured: they're encrypted end to end between the
  browsers. Shared screens are captured only as the frames a presenter's own browser sends while screen notes
  are on. The earlier pictures of a share a viewer can step back through stay in that viewer's browser's memory and
  go when the share stops; none are kept while notes are paused ([Looking closer at a share](#looking-closer-at-a-share)).
  Nothing stops someone recording their own screen or speakers. Retention has one fixed behaviour,
  with no settings: the live transcript and caption translations last only until the call ends; the audio,
  transcript, shared-screen frames, what was read on them and the notes (every revision of them, corrections
  included) stay in the organizer's vault until the organizer deletes the note, and deleting is physical
  ([Notes and inference › What's kept, and for how long](notes-and-inference.md#whats-kept-and-for-how-long),
  [Privacy › Deletion](privacy-keys-and-sessions.md#deletion)). Paused stretches capture nothing, so there's
  nothing of them to keep.

## Shared screens

Call media is end-to-end encrypted, so LiveKit never sees a shared screen, and the API sees only the frames a
presenter's browser sends for the notes. When the organizer has shared screens read for the notes, each
presenter's own browser sends frames of its own share to the API, which holds each one in memory only to seal it
(and later to open it for the notes model and the note's people), and the private notes model reads them after the
call (`apps/web/src/features/call/frames.ts`, `apps/api/src/modules/screens.ts`).

- **Turning it on.** Only the organizer (`POST /v1/live/calls/:id/actions` with `{type: "screens", on}`), and
  only while notes are on or paused (`409 conflict` otherwise: "Turn on notes first"). Pausing holds it with
  everything else and resuming brings it back; turning notes off turns it off too, and turning them on again
  doesn't bring it back: that's the organizer's choice each time. Every change is a notice for everyone, and
  the card, the join page and someone waiting see `capture.screen` like the other parts, without a name. Its
  changes are kept to a tenth of a second, with the recording's segment, like the notes' own.
- **In the presenter's browser.** While screen notes are on and not paused, the call is live and the presenter
  isn't in a breakout room, the browser looks at its own share once a second (`ImageCapture.grabFrame` where the
  browser has it, which reads the track itself rather than a video on the page, or a hidden video element). It compares each look on
  a 48×27 grey grid: the screen changed when 2% of the grid moved by more than 24 levels from the last frame
  kept, which a moving cursor doesn't. A frame is kept once the change has settled (two looks agree), at most
  one every 4 seconds, and every 15 seconds while a screen never settles (a video playing). A share's first
  frame waits until it has been up 10 seconds, so a window picked by mistake is gone before anything of it is
  kept (as Google Meet and Teams do); something else shared in its place with **Change** (the same share, a new
  picture) waits its own 10 seconds. Frames go up as JPEG (quality 0.72, at most 1600 pixels across), one at a
  time, three tries each, the newest three waiting. Pausing, screen notes going off or a breakout room stops
  it at once and drops what wasn't sent. When a share ends (stopped, or swapped for another), the browser says
  so (`POST /v1/live/calls/:id/frames/ended {share}`), so its last frame's stretch ends there, and the API takes
  no frame of it taken after that. A presenter's connection leaving the call (they leave, are removed, or a new
  connection of theirs takes over) ends every share of theirs on the server, so a share whose browser couldn't
  say so still stops where they left. The share bar says **Read for the notes**, and the share picker says so
  before anyone chooses (during a pause: that it's read once notes resume).
- **The request.** `POST /v1/live/calls/:id/frames` with the JPEG as the body (`content-type: image/jpeg`), the
  share's LiveKit track ID in `x-alcove-share` and how long ago it was taken in `x-alcove-age-ms` (at most 30
  seconds counts). A body over 1 MiB (`MAX_FRAME_BYTES`) is refused from its `content-length` before it's read;
  then the JPEG's frame header must give a size between 64 and 4096 pixels a side. 24 frames a minute per
  person (`503` past that). Then, in order: the sender must be let in (`403`); the capture gate's `screen` path
  must allow it: the call live, notes on and not paused, screens on, and the frame taken in the main room, placed
  where its presenter was when it was taken as speech is (`409` from a breakout room, or when that can't be told
  any more); the frame mustn't be from before notes came on, were resumed, or screens were turned on (`409`); the
  presenter's browser mustn't have said the share ended (`403`); and LiveKit must list the share as a screen
  this person is sharing in this call's room now (`403` for someone else's share, a camera or a share that's
  over; a yes is remembered for 10 seconds, forgotten when the browser says the share ended; `503` when LiveKit
  can't be asked). The presenter is always the sender's own participant ID, so nobody can add frames to someone
  else's share. What this proves is that the sender has a screen share up in this call's room: the API can't
  see what's on it, so which picture is sent is the presenter's browser's word. A modified browser could send
  any image under its own share, which is no more than it could show everyone on that share.
- **Kept once, sealed.** A frame is found by a keyed hash of its share and its bytes' SHA-256 (`frame_tag`), so
  a retried frame is kept once and answers with the ID it has (`{id, duplicate: true}`). The JPEG is sealed
  under the recording's key, like audio (record kind `screen-frame`, binding the recording, the frame and the
  object), written under a random object name, read back and checked; then its `screen_frames` row is written
  with whose share it was, when (seconds since the call started, by the server's clock less the age), the
  segment, its size and, later, what was read on it, sealed under the note's screen key (`screen-frame-info`,
  binding the note and the frame). The row is written under a share lock on the recording, so a frame either
  lands before a pause or stop, or stays out and its object is deleted.
- **As many as the notes keep.** A call's notes keep at most 240 frames (`SCREEN_FRAMES_MAX`): about one a
  minute for four hours, or an hour of a screen that keeps changing. The frame after that is refused (`409`:
  "The notes have kept as many shared screens as they can for this call"), and screen notes turn off for
  everyone, as if the organizer had turned them off, with a notice saying why; the presenters' browsers stop
  looking, and the share bar stops saying **Read for the notes**. The organizer can't turn them on again for
  that call (`409`); what was kept stays.
- **Into the note.** When the call ends, its frames become the note's screen moments (`Note.screens`): each
  placed in the recording as transcript lines are (in its segment, counted from when that segment started, kept
  inside its audio), on screen until its share's next frame, its share ending or its presenter leaving, screen
  notes stopping, notes pausing or going off, a gap, or the end. A segment with no audio (an organizer without a
  microphone) places its frames by the call's clock, less the stretches notes were paused or off, so frames after
  a pause still come after the ones before it. Presenters are named as the call named them. The image is at `GET /v1/notes/:id/screens/:frameId`, for anyone who has
  the note and only for frames the note shows, decrypted per request with `cache-control: no-store`.
- **Read and referred to.** The notes worker has the notes model read each frame before the notes are written
  ([Notes and inference › Shared screens](notes-and-inference.md#shared-screens)), and the notes point at the
  screen, and the part of it, a decision, question, follow-up, chapter or answer was about.
- **Breakout rooms.** What's shared in a room stays in the room, like what's said there: the browser doesn't look
  while its presenter is in one, and the API refuses a frame taken in one. It places each frame where its presenter
  was when it was taken (`placeAt`, from how long ago the frame says it was taken and where each person has been):
  the organizer while visiting a room, anyone sent to one. A frame taken in the main room just before its presenter
  left is kept. Leaving the main room ends the presenter's shares there in the notes, by presenter rather than by
  share, so a share is read again once they're back. The main room's shares are read while rooms are open.
- **For catch-up.** `screens.framesOf` lists a live call's frames (ID, presenter, share, time) for a catch-up to
  point at; catch-up doesn't read screens yet ([Notes and inference › What's left](notes-and-inference.md#whats-left)).

## Pointing at shared screens

People in a call can point at what someone shares and leave marks that fade, so "this, here" is easy to say
(`apps/web/src/features/call/marks.ts`, `SharePointing.tsx`, the wire format in `packages/api/src/marks.ts`). Pointers
and marks go from browser to browser, end-to-end encrypted: nothing of them reaches the API, nothing is kept anywhere,
and nothing reaches anyone's computer but a picture drawn over the share on their own screen. No input of any kind is
ever sent to the presenter's computer.

- **Who may point.** Anyone let in, at any share they show big, while the organizer allows pointing for the call
  (`CallState.pointing`; `{type: "pointing", on}`, the organizer's only, on until they turn it off, each change a
  notice for everyone) and the share's presenter lets others point at it (`CallParticipant.othersPoint`;
  `{type: "others-point", on}`, anyone in the call about their own shares, kept by person so it holds across their
  reconnections and moves to another device, 20 changes a minute per person). A presenter can always point at their own share. Both live in the
  call's sealed state, the server checks who may change them, and every browser enforces them on what it sends and on
  what it takes: marks from someone the presenter doesn't let point never show, whatever that person's browser sends.
  Turning either off takes the pointers and marks it covers away at once, everywhere. Everyone may point by default
  because in a working call pointing is how people talk about what's shared; a presenter keeps their screen to
  themselves with one switch on their share bar (a demo, something sensitive), and the organizer turns it off for a
  large or formal call from People.
- **On screen.** A pointer is an arrow with its owner's face in the arch and their name beside it, never told apart by
  colour alone. A click leaves a ring and a drag a line, named the same way (at a ring, and where a line starts). Marks
  last 8 seconds (`SHARE_MARK_MS`), fading over the last 1.5. A pointer's browser says where it is up to 20 times a
  second while it moves (`SHARE_POINT_EVERY_MS`), once a second while it's still, and stops after 6 seconds without
  moving; a pointer nothing has been heard of for 2.5 seconds goes. Its author takes their last mark back (Undo in the
  pointing bar, or Backspace), and the presenter clears every mark on their share (**Clear marks** on their share bar).
  Everything goes when the share stops, its author leaves the call or your part of it, you move to another part of the
  call (sent to a room, back to the main room, moved, or, for the organizer, visiting one), the room disconnects, or
  pointing is turned off; someone else coming or going takes only their own pointer and marks with them. The marks on a
  share go when its presenter changes what's shared, since they were about the old picture. On a phone, a tap leaves a ring and
  a drag a line; there's no pointer to hover with.
- **Where marks land.** Every place is a fraction of the shared picture, 0 to 1 across and down
  ([the coordinate model](#looking-closer-at-a-share), `shareFrame.ts`), so a mark lands on the same spot of the picture
  on a phone and on a wide screen, in a tile or big, however each viewer has framed it. The drawing sits on the
  picture's own box, in parts of it: on a share someone looks at closer it's inside the box `place` gives for their
  framing, so it moves with every zoom and pan and glides with the picture; elsewhere it's the box the video shows the
  picture in (`place` with the whole picture, letterboxed in its tile). Rings and lines keep their size on screen at any
  zoom. A press goes the other way, through the viewer's framing (`toShare`). A picture held still (frozen, or an
  earlier one) shows no pointers or marks, as they're about the live picture, and holding one ends your pointing; a
  share in its own window shows them, and you point in the call. A message names its share by the picture's LiveKit
  track sid, which no later share has: a message about a share that stopped, or one this browser doesn't show, lands
  nowhere.
- **Keyboard.** On a share shown big and live, L (or **Point and mark** in its ⋯) starts pointing. The arrow keys move
  your pointer (with Shift, further), Enter or Space leaves a ring, Backspace takes back your last mark and Escape
  stops. While you point, the arrows move your pointer rather than to the next tile or around a zoomed picture; +, −,
  0, F, comma and full stop still frame the share, and so do its bar, the wheel and a pinch. A drag draws rather than
  moving the picture.
- **Breakout rooms.** Pointers and marks stay in the part of the call they're made in. Each part has its own MLS
  group, so what's sealed in a room opens only with that room's keys. A browser also takes them only from the people
  in its own part, about shares it shows (a room's shares are shown only in the room), and drops them all when its
  part changes; between two parts it has no key to seal with, so it sends nothing.
- **Never captured.** Pointers and marks are drawn in each viewer's browser, over the video. They aren't in the shared
  picture, so a presenter's browser never captures them for screen notes ([Shared screens](#shared-screens)), and
  nothing adds them. The only way one reaches a frame is the presenter's own screen showing it: someone sharing a whole
  screen with the call's window on it shares whatever that window shows, marks included, like anything else on that
  screen. The notes don't link marks to what was said.
- **The presenter's view.** Marks show on the presenter's own share as well, in its tile or shown big. A web page can't
  draw over other apps, so they aren't drawn on the presenter's own screen outside Alcove.

### How it travels

- **LiveKit data packets.** Room tokens may send data (`canPublishData`). Pointer places go unreliable (newest wins,
  nothing waits); marks, taking them back and clearing go reliably, in order. The API is never in the room.
- **Sealed in the browser.** Each message is sealed by the sender's call session (`CallSession.sealData`): AES-GCM-256
  under a key derived with HKDF-SHA-256 from the sender's own media key for the epoch it sends in (label
  `alcove/call-data/v1`, so a media key never encrypts data itself), with the topic and the sender's identity as
  associated data, behind a version byte, the key's ring index and a random 12-byte nonce. The receiving session opens
  it with the media key of whoever LiveKit says sent it, from the last four epochs (`openData`), and the room takes it
  only from someone whose media it would play: in its MLS group and in its part of the call. Someone who joined later
  can't read what was sent before, and someone who left can't read what comes after, as with media.
- **Why not only LiveKit's encryption.** livekit-client 2.23 also encrypts every data packet with the sender's key when
  the room is made with `encryption`, which Alcove's is, so packets are encrypted twice. But it reports a packet it
  decrypted as unencrypted (`Encryption_Type.NONE`: its sender never sets the field), the same as a packet sent in the
  clear, so a browser can't tell on arrival whether a packet was encrypted. The session's own seal is what a browser
  trusts.
- **Replays.** Each sender numbers its messages inside the seal, and a browser keeps what it knows of every sender for
  the whole call, whether or not anything of theirs shows: their newest numbers, and the last 1,024 marks they took back
  or that went. A packet replayed, or overtaken by a newer one, brings back no pointer or mark, and a share is cleared
  only by a newer clear from its presenter, so an old one can't wipe marks made since. A message more than 512 behind
  its sender's newest is dropped. Only LiveKit could replay a packet as its sender: one a member sends again comes with
  their own identity, so it opens only as theirs, which it isn't.
- **Floods.** LiveKit limits no one's data, so each browser's room checks every packet before opening it
  (`CallRoom.receive`): at most 8 KiB once sealed (`SHARE_MARK_BYTES` and the seal's 30 bytes,
  `CALL_DATA_OVERHEAD`), and from each sender at most 50 a second after a burst of 100. The rest is dropped unopened,
  so a flood from one browser costs the others a look at each packet's length. The store keeps at most 12 marks per
  person per share (a new one takes the oldest away), and a line has at most 96 places; a longer one keeps its shape
  with half as many.
- **Who could pretend.** As with media under SFrame, every member can derive every sender's key, so a member working
  with LiveKit, which says who sent each packet, could make a pointer look like someone else's. Neither can alone:
  LiveKit has no keys, and a member's packets are opened with their own.
- **What LiveKit sees.** That a participant sends data, when and how big: roughly when someone points or draws, never
  where or at what. The API sees only the grant: whether pointing is on, and who doesn't let others point.
- **Latency.** Measured on the local stack (three Chromium browsers, two shares, three runs of 40 moves): from a mouse
  move in one browser to the pointer drawn in another, a median of 31 to 39 ms, the 90th percentile 51 to 55 ms and
  the slowest 85 ms. Chat between the same two browsers, which goes through the API as MLS messages (a request, a
  database write, a nudge through LiveKit and a read by every browser), took a median of 103 to 153 ms there, and
  would load the API and database with every move. Pointers glide between places (90 ms), and lines go out at most
  every 80 ms as they're drawn.

## Reconnects

- **A short drop.** LiveKit resumes the connection, or reconnects it under the same identity, and the top bar
  says **Reconnecting** meanwhile, for a dropped signalling connection too (that's how most drops start; LiveKit
  calls it `SignalReconnecting`). The call keeps up over HTTP as before. On coming back, and also as soon as it
  first connects to the room, the browser fetches the call and its log again: a nudge sent while it was still
  connecting reached a room it wasn't in. That was why, after the organizer reloaded, everyone's camera looked off
  for a while: the others' fresh key packages arrived while the organizer's new page was still connecting, so it
  waited for its next check (up to 6 seconds, longer on a slow join) before letting them into its new group. Now
  they're in within about two seconds, and until then their tiles say **Connecting**.
- **Taken out while away.** A connection gone for longer than LiveKit waits (about 15 seconds without an answer)
  is taken out by LiveKit's `participant_left` webhook ([Group calls](#group-calls)), and the organizer's browser
  takes it out of the group, so the keys move on. If that browser is still there and comes back, it comes back in
  as it is: its log read says `admission: "out"` (it left by nobody's choice: not removed, not turned away, and its
  place not taken by another tab or device), so it lets go of the groups it held and asks
  `POST /v1/live/calls/:id/mls/back`. That puts it back as the same connection and person (seat, hand and all), in
  the same part of the call, with a fresh 90 seconds to reach the room; the log then asks it for keys, as for anyone
  on their way into a group, and the organizer's browser adds it to that part's group (a breakout room's included).
  Its time in before the drop is kept as a stretch of its own (`earlier`), so its time away stays time away: a guest
  reads nothing said then, and catching up "while you were away" finds it ([Notes and inference](notes-and-inference.md#catching-up-during-a-call)).
  Until the organizer's browser has taken the old connection out of its group, `mls/back` answers `409` and the
  browser asks again a few seconds later. Someone removed, turned away or replaced gets `admission: "denied"` and stops. Chat sent while it was out
  stays unreadable to it, as for anyone let in later.
- **The organizer away.** Notes are written from what the organizer's browser hears, so from LiveKit's
  `participant_left` for the organizer's connection (it dropped, is reloading, or is moving) until it or another
  of their connections is back, the capture state says so for everyone and on the card: recording and transcript
  `unavailable`, `away` set, the sign **Notes unavailable** ([What's captured](#whats-captured)). The webhook
  nudges the room both ways, so screens change at once. If the same connection comes back, its browser kept
  recording through the drop and sends what it held ([Call lifecycle](#call-lifecycle)), so nothing is marked;
  what others said meanwhile wasn't heard. If another connection takes over (a reload, another device, a move)
  or the call ends first, the time from the old one leaving is an `offline` gap after the segment it was
  recording: in the transcript, catch-up and notes, and breakout rooms are placed in the recording without it.
  Nothing turns notes, a microphone or a camera on that was off, and a pause outlasts all of it.
- **The organizer's old tab.** Joining from another tab or device takes over without asking the old tab, which
  may still be recording. The server tells that connection `409` for anything only the organizer may do, audio
  and speech included, so it stops trying at once instead of retrying a refusal; once its screen learns the call
  went on elsewhere it drops what the recorder and voices hadn't sent (the server would refuse it) and leaves. A
  move lets go first instead: the old device sends its last audio and speech before the new one takes over.
- **Nobody twice.** A reload, a comeback and a move each keep one person: a new connection of someone who was in
  takes the old one's place (left and replaced), never a second seat. While the organizer's browser takes the old
  connection out of the group, `CallState.leaving` names it, with that person's connection now (`now`), so screens
  show it as who it is, and not at all once they're back on another connection, rather than as "Someone". Audio
  pieces and transcript clips are idempotent by their place (and, for clips, whose they are), so nothing sent again
  is kept twice; a moved organizer's recording goes on in a new segment. Notices already shown aren't new to the
  screen that showed them; a new device shows the latest once.

## Moving to another device

Someone in a call moves their place to another device (a laptop to a phone, say) from **More › Move to another
device**: `apps/web/src/features/move/` and `apps/api/src/modules/moves.ts`.

1. **A code.** `POST /v1/live/calls/:id/moves {media}` (by the call pass) starts a move and gives a random 128-bit
   code for the new device's link, `<web app>/move#<code>`, shown as a QR code and as the same link to copy. It
   works for 2 minutes; while the dialog stays open a fresh one replaces it, for about 10 minutes. The code is in
   the fragment, which browsers never send, so no server or log sees it, and the page takes it out of the address
   bar at once. While this screen is being shared the code stays hidden, so nobody watching can use it. One move per
   person: a new code makes the last one useless. The organizer starts one only from their current connection with
   their own session, an invited person (someone signed in whom the organizer let in from the link included, by the
   role the call gives them, not their pass's) only together with their account's session.
2. **Opened.** The new device sends the code once, in a POST body (`POST /v1/moves/claim`), and gets back a claim
   only it holds: the code works once. It learns the call's title, the organizer's name, who it'll be and whether
   their microphone and camera are on, and nothing else. The device being left sees that it was opened.
3. **Ready.** The new device makes its own random identity and MLS key package (`POST /v1/moves/ready`); its keys
   never leave it. The identity must be new to the call: one the call already has (the organizer's, anyone else's,
   or the mover's own) is refused (`409`), so a move can never name someone else's place and be handed it. The
   organizer and invited people move only to a device signed in to the same account (the
   organizer's own; an invited person's by the address they were let in with), checked here and again as the new
   device comes in; the move page signs in on the spot, and Google sign-in comes back to it (`?next=/move`, with the
   claim kept in that tab's `sessionStorage` meanwhile). A guest's move involves no account: their call pass is all
   they have. A QR code never makes a session.
4. **Letting go.** The device being left confirms (`POST /v1/live/calls/:id/moves/confirm`) only once it has let go:
   the last notes audio and speech are sent, then its microphone and camera stop and it leaves the room. Signed in to
   the same account on the new device, it lets go by itself; for a guest it asks first ("iPhone · Safari is ready to
   take your place": **Move to iPhone** or **Not my device**). The API takes that connection out of the room too, in
   case it didn't get there, and out of the call, so the organizer's browser moves the keys on without it. The
   organizer's connection is counted gone from then: the call ends if their new device never arrives, as when they
   leave.
5. **In.** The new device comes in (`POST /v1/moves/arrive`) as the same person, with the identity and key package
   it sent: a guest or invited person the way a reload comes back (the same person, so the same seat and breakout
   room, name, role, raised hand and spotlight): a new connection in no group, which the organizer's browser adds to
   the group of the part of the call they're in, a room's included, and takes the old one out of, so nobody is
   counted twice. The organizer comes in as the organizer's new connection (a new key generation for every part of
   the call, host powers, back in the room it was visiting, and the recording on a new segment, as when they join
   from another device), with nothing resumed: a paused call, or a room it paused, stays paused. It brings in
   only the identity named when the device was ready, so another connection already using it (someone who joined
   with it in between) means `409`, never that connection's place; and only the person whose place it was, as they
   are when it comes in, under the call's lock: someone removed (or whose place went elsewhere) since the move last
   looked brings nobody in (`409`), and a commit adding anyone whose person was removed is refused. Asking again, after a lost answer, hands back the
   same connection with a new pass, and only that one: the connection this move made, as the person who moved, in
   the same role, and only once the move has happened. Its microphone and camera start in
   the call as they were on the device left, never more, and only after that device stopped its own: there are never
   two live microphones, and one that was off stays off. A screen being shared stops with the device that shared it.

Either device can call the move off until the device being left lets go, and the other is told. Each step runs
out: 2 minutes for an unopened code, 5 more to be ready (time to sign in), 3 to let go, 2 to come in.

Requests about one move never wait on each other. Each change is made only if the move is still as that request
read it (its sealed body unchanged), otherwise `409` and the device tries again; nothing holds a row lock while it
reads the call or brings someone in. Only one request at a time brings the new device in (a short `arriving`
stage, shown as `released`, that runs out after 30 seconds if that request fails on the way); others asking at the
same moment get `409` and ask again, and find the connection made. The device being left's own changes (starting,
letting go, calling off) never wait more than 2 seconds for a lock (then `409`). Each move is rate-limited by its
secret's hash as well as by client address: checking on it 240 times a minute, changing it 60. A move can't
go on once its person is removed, their place has gone elsewhere, or the call has ended, and each refusal says what
to do next, with the request ID to quote. A browser that can't encrypt call media is told so before the code is
used, so it still works on another device.

**What a stolen code allows.** For the organizer or an invited person, nothing: the device that comes in must be
signed in to their account. For a guest, someone who scans the code first (within its 2 minutes, before the guest's
own device does) can't come in unless the guest's device agrees to a device it didn't expect, and the guest's own
device is told the code was used, so they make another. A code never carries a key: the new device makes its own and
joins the call's group like anyone let in.

Moves are rows in `call_moves`, found by the SHA-256 of the move's current secret (the code, then the claim), each
sealed under the organizer's keys as a `call-move` record bound to the call and the move: who's moving, the stage,
whether the microphone and camera are on, and the new device's identity, key package and kind ("iPhone · Safari",
never logged). Upkeep deletes those that ran out, and a call's go when it ends.

## Hands, spotlight, breakout rooms and captions

- **Raised hands** are call state, one per person (`{type: "hand", up}`): anyone in the call raises or lowers
  their own, and everyone sees it (`CallState.participants[].hand`). It stays up across a reload, a dropped
  connection that comes back, and a move to another device: it's the person's, not the connection's.
- **Spotlight** (`{type: "spotlight", participantId}`) is the organizer's, and only names someone in the call;
  it puts that tile first on everyone's stage, and goes with that person to a new connection (a reload, a move).
  Opening breakout rooms ends it.
- **Breakout rooms** (`{type: "rooms-open", rooms: [{name, emails}], minutes}`, `rooms-message`,
  `rooms-rename`, `rooms-move`, `rooms-close`) are the organizer's. Two to eight rooms; only people invited to
  the call can be sent to one, each to one room, and moved to another or back to the main room while they're
  open (`{type: "rooms-move", email, roomId}`, `null` for the main room). `CallState.breakouts.open` carries the
  rooms (with who of them is in the call now, by participant ID), `from` and `until` (seconds since the call
  started) and the latest message to every room. Each room is a part of the call with its own MLS group, so its
  own media keys and chat, and moving someone moves their keys
  ([End-to-end encryption](#end-to-end-encryption)). Rooms whose time is up close on the next read or action,
  and ending the call closes them too; a room closing deletes its MLS log and what was heard in it. Closed rooms
  are kept in `breakouts.held` and, when the call ends, go into its note in recording time; once the notes are
  written each becomes a chapter ("2 breakout rooms", who was in which room when they closed, and for how long).
  Room names and messages stay in the sealed call state. The organizer visits one room at a time
  (`{type: "rooms-visit", roomId}`, `null` for the main room): while visiting, they're one of that room's
  `members`, and their browser sends, plays and chats with that room's keys, so that room sees and hears them and
  the main room doesn't.
- **What's said in a room stays in it.** Every live transcript line is kept in the part of the call its speaker
  was in when they began saying it: the organizer's browser says how long ago each clip began (`x-alcove-ago-ms`),
  the server places it from where each person has been (`placeAt` in the places module), and the organizer's
  browser ends the clip in progress when it moves, so no clip spans two parts. A line said while rooms are open
  also keeps who was in its part then. One rule, `readableBy`, decides who reads a line: the call's state,
  captions, catch-up, questions and caption translations show someone the lines said in the part of the call
  they're in now, and of those said while rooms were open, only the ones said while they were there. A room's
  lines (and their translations) are deleted when it closes, in the transaction that closes it; a clip or
  translation still being made then is dropped, and speech for a room that isn't open is refused (`409`). Only
  the main room's lines go into the note. The organizer's notes recording hears silence while it's in a room, so
  the note's audio has none of a room's talk either. Each room has its own capture state, which the organizer can
  pause ([What's captured](#whats-captured)).
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
  "Someone", except a connection the server says is on its way out (`CallState.leaving`), which shows as whose it
  is, or not at all once that person is here on another connection. Someone in the call who isn't in this
  browser's group yet shows **Connecting** on their tile, so it never looks like their camera is off. Mic, camera,
  screen and speaking come from the room; raised hands from `participants[].hand`.
  Other people's cameras and screens are attached with `CallRoom.attach` and aren't mirrored. The join page
  opens the call once the browser is in the group and the call names it.
- **The room.** One connection per session, shared across remounts and left when no screen uses it. It
  publishes `LocalMedia`'s mic, camera and screen (with its sound), and plays only encrypted media from
  members of the browser's MLS group; screens are under the same per-sender encryption as everything else. LiveKit's own logs go to the app's logger at debug; a decryption error
  is logged at debug when a key is briefly missing around a key change, and as a warning otherwise.
- **Asking to join.** The organizer gets a toast, a count on the People button, and an Asking to join section in
  People to let people in or turn them away: someone signed in with their address and "Gets the notes once let
  in", a guest as "Guest, by name only" and "Doesn't get the notes". A guest's toast has Let in; letting in
  someone with an address gives them the notes, so their toast has Review, which opens People. The toast goes as
  soon as the ask is answered, wherever that happens (let in or turned away in People, or on another device), when
  the asker takes it back or leaves, and when the organizer leaves the call. A Let in pressed too late lets nobody
  in: it checks the call first and says the person is already in, or isn't asking any more (the organizer's
  browser adds only people still asking anyway, so a late admit changes nothing). Their call
  re-reads the meeting when someone with an account is in it and not on the invite yet, and after they remove
  someone with an account, so who's invited (who gets the notes, who can go to a breakout room) includes whoever
  they let in and not whoever they removed.
- **Host controls** are the organizer's, in People: mute someone's microphone (LiveKit mutes the track, their
  dock shows it off, they're told, and only they can unmute), remove someone (they're told and go back to the
  call's page), and lock the call.
- **Each person's volume, for you.** Anyone can turn someone else up to 100% or down to muted for themselves,
  from that person's tile menu or their row in People ([Media in the browser](#media-in-the-browser)).
- **Chat** is `crypto.chat`, decrypted in the browser; names come from the people in the call. Each message
  says which part of the call it was sent in, and the view marks where the conversation moved; the box says where
  a message goes ("Message Design") while rooms are open. It's off until the browser holds its part's keys (and
  while it's moving), takes up to 4,000 characters, says when there was chat here it can't read, and gives back a
  message that couldn't be sent.
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
  reconnections (a reload's pass carries their random `person`, and so does a move to another device; the organizer
  has one seat on any device; anyone else joining from a second browser without moving is a new person with a new
  seat). The API makes it when the call is read, a MAC
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
  corner picture to another corner), and + and − make it bigger or smaller; L on a share shown big starts pointing at it
  ([Pointing at shared screens](#pointing-at-shared-screens)); Escape stops pointing, then unpins everyone. The line
  beside a shared screen, and the one between two, is a separator moved with the arrow keys, Home and End. On someone
  else's share you see big, + and − zoom, 0 shows the whole picture, the arrows move around while zoomed in (your
  pointer, while you point), F freezes it or goes back to live, and comma and full stop step through earlier pictures
  ([below](#looking-closer-at-a-share)). Each tile's menu shows its keys, and on touch screens its ⋯ is always there.
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
- **Shared screens in the notes.** The organizer has a **Read shared screens** switch under what's captured
  while notes are on or paused. The presenter's share bar says **Read for the notes**, and the share picker says
  it before they choose. A frame that can't reach the notes after three tries says so in the Notes panel.
- **Captions** show the newest live transcript line the viewer may read (said in their part of the call while
  they were there), under whoever said it, translated for each viewer who picks a language. They show in
  breakout rooms too, each room its own, and say so instead of showing an old line while notes are paused or
  off, or while the organizer's browser can't listen.
- **Catching up** (`CatchUp.tsx`, `catchingUp.ts`) is for the person asking alone. **Catch up** in the top bar and
  the More menu opens the Ask view on what they most likely missed (their recent time away, what was said before
  they joined late, or the last five minutes). In the Ask view a chip says what's read and opens a menu: the last 5
  or 15 minutes, before you joined, since you joined, while you were away, the whole call, or a stretch picked on
  the call's timeline (two handles, by pointer or keys; notes-off and paused stretches hatched, time away marked,
  and for a guest what they can't read dimmed). Each answer says the stretch it read, how many lines it read and as
  of when, and what can't be in it, all as times of day like the transcript's gaps. Each point carries its moments
  as time chips, to the second; one opens the transcript at that line, marked, with what was said around it, asked
  of the server again. In a breakout room it all reads what was said in the room while you were there. **Back to
  live** returns the panel to how it was before catching up (closing it on a phone), and the transcript to
  following along; the viewer's own layout (pins, sizes, order, self-view) is never touched. Someone who comes back
  after time away, or joins well after the start, is offered a catch-up once, as a toast, decided when the call
  screen first learns their window; nobody is while notes have never been on, and a guest isn't, since they can't
  read what was said then. Nothing of it is kept: it goes with the page.
- **Notes.** While notes are on, the recorder and the live transcript hear everyone the organizer's browser
  plays: its own microphone and each other microphone in its part of the call (`CallRoom.heard()`, the raw
  decrypted tracks of unmuted microphones, so nobody's volume on this screen, nor the speaker chosen, changes
  what's heard). The recorder mixes them into one recording (`NotesRecorder` in `media.ts`), so playing the notes
  back sounds like the call and a guest's line points at a moment where they can be heard: each voice fades in
  when it's heard and out when it isn't (someone joining, leaving, muting, or a room move) while the same segment
  carries on, through a limiter so voices over each other don't clip. Once the organizer presses End, or turns
  notes off, the recorder is paused, the last audio and speech are sent, and nothing starts recording or listening
  again while the server ends the call or turns notes off (as people drop out of the room, or anyone mutes); if it
  can't, the same recorder carries on, so its pieces stay in order in the same segment. Each person is heard on
  their own (`CallEars` in `speech.ts`: one `SpeechClips` per voice, sharing one audio context and counting from
  the segment's start), so every clip says whose it is
  (`x-alcove-speaker`, a participant ID the server checks is someone in the call: not still asking, not turned
  away, not from another call), and every line is said by that person. A voice no longer heard (they left,
  muted, or a room move took them out of earshot) stops being listened to at once and sends what it had heard.
  Each clip also says how long ago it began (`x-alcove-ago-ms`), which the server turns into a moment on its own
  clock as the request arrives (never earlier than the speaker came into the call), and keeps it in the part of the
  call its speaker was in then, from where each person has been (the places module's `placeAt`), with rooms that
  have run out counted as closed: a clip still on its way when someone moves stays where it was said. A clip that
  began within the request's travel time before a move counts as said after it; the organizer moving ends every
  clip in progress (`CallEars.mark`), so none spans two parts and such a clip holds a fraction of a second at most.
  Nothing is heard while the organizer's browser is between two parts, or in a room it paused (`CallEars.quiet`).
  The recorder hears silence while the organizer is in a breakout room (`hush()`: one gain after the limiter, so
  the segment carries on and the transcript still lines up), so the note's audio has none of a room's talk.
  Without a microphone of the organizer's own, everyone else is still heard. Nothing shared, picture or sound, is
  recorded or transcribed (`heard()` is microphones only, and the capture state's `screen` part, "Shared
  screens", is always off): seeing a share takes only being in the same part of the call (its group), and what the
  notes capture is decided apart from it. Pausing holds the recorder and every voice (`hold()`) until the server
  answers, then drops what they held (`discard()`, `stop()`) or carries on (`release()`)
  ([What's captured](#whats-captured)).
  The browser also says what it can't capture, whenever that changes: no microphone, a recorder that failed
  (`NotesRecorder`'s `onBroken`), or no audio worklet (`canListen()`, and `CallEars`' `onDeaf` when the worklet
  won't load).
- **What's captured.** The notes sign in the top bar is the same for everyone: **Notes on** (crimson),
  **Notes paused**, **Notes unavailable** (caution), **Notes off**, or **Notes requested** while someone has
  asked; the organizer's own says **Pausing…** while their pause is on its way. It opens a popover
  (`features/call/Capture.tsx`) with each kind of capture and its state, who changed it and when, who gets the
  notes, and that they're written in confidential compute; with the organizer's **Pause notes**, **Resume
  notes** and **Turn off** or **Turn on notes**, or anyone else's **Ask for notes**. Its sentence says what's
  captured now: what everyone says recorded and transcribed, less whatever the organizer's browser can't do. The
  notes panel has the same controls in its menu and empty states. The transcript, in the call and in the note,
  marks each gap, and dots what it isn't sure of: words that were hard to hear, and a name heard on more than one
  microphone ([Notes and inference › The live transcript](notes-and-inference.md#the-live-transcript)).
- **Asks for notes.** The organizer gets a toast with Turn on (or Resume), and an Asking for notes section in
  People with Not now for each; everyone sees "Asked for notes" on the asker's row. Whoever asked hears when
  the organizer says not now. Joining shows only the latest notice as a toast; older ones are history.
- **Before joining.** Guests and invited people see what the call captures on the join page, before they ask
  and while they wait (`CaptureSummary` in `@alcove/ui`, from the card, refreshed every few seconds).
- **Breakout rooms.** The organizer opens rooms for the invited people in the call (by email, as the server
  requires); guests stay in the main room. Who's in each room comes from `breakouts.open.rooms[].members`, and
  each browser tells the room whose media to play (`CallRoom.playOnly`), on top of holding only its own part's
  keys. The organizer sees every room: who's in it, who's talking (LiveKit's speaker detection) and a raised hand
  as that room asking for help; it renames a room in place, and moves someone from their chip to another room or
  back to the main room; a room it paused says **Notes paused** on its card and on its box on the stage, as every
  room does while the whole call is paused. Escape in a room's name puts the old one back. Everyone else sees only their own room or the main room, with the time left and the organizer's
  messages, is told when the organizer comes into or leaves their part of the call or moves them, and sees "Moving
  you to…" while their browser changes groups. In a room, the notes sign, its popover, captions, the transcript
  and Ask show the room's capture (`captureHere` in `lib/capture.ts`): the transcript marks the room's own gaps,
  and Ask waits while the room is paused.
- **Leaving and ending.** Anyone but the organizer leaves (`leave()` returns null) and goes back to the call's
  page. The organizer's End ends the call for everyone: deleting the room disconnects everyone, who are told
  the organizer ended the call, and the organizer's sheet follows the notes being written. A browser that's
  removed, out of the group, or whose room ended is told, closes the session and leaves the room; one whose
  keys fell out of step, or whose connection dropped for good, is offered a reload.
- **Reconnecting.** The top bar says **Reconnecting** while the room's connection is coming back (signalling
  only, or everything) and while this browser is getting back into the call's group after a comeback. While the
  organizer's browser is out of the call, the notes sign says **Notes unavailable** ([Reconnects](#reconnects)).
- **Moving to another device.** **More › Move to another device** opens one dialog whose content changes in
  place (`features/move/MoveSheet.tsx`): the QR code and link, then the device that opened it, then letting go.
  Afterwards this screen says where the call went, with **Join again here** (and **Go to Home** when signed in).
  The new device's page is `routes/move.tsx` ([Moving to another device](#moving-to-another-device)).

## Looking closer at a share

Someone else's share you see big can be zoomed into, moved around, frozen and stepped back through, or opened in its
own window: for you only, in this browser only. Nothing is sent, the presenter's screen and everyone else's view don't
change, and the server is never involved (`ShareSurface.tsx`, with `shareLook.ts` for the state and `shareFrame.ts` for
the coordinates). Your own share has none of this: you have the original.

- **Zoom and pan.** 100% is the whole picture, as big as it fits; + and − step through 125, 150, 200, 300, 400, 600 and
  800%, and pinching (a trackpad's, Safari's own pinch gesture, or two fingers), or Ctrl/⌘ with the wheel, zooms
  anywhere between, where the pointer is. A drag, or the wheel, moves around once zoomed in; a double-click goes to 200%
  or back to the whole picture; 0 (or the label, "200%") shows the whole picture again. While zoomed in, the bar stays up
  with the label and a minimap of where you are, which you can press or drag. The bar's buttons are for pointers and
  touch (on a phone a tap shows it); from the keyboard the keys on the focused share do the same, and its ⋯ menu lists
  them (Later picture while one is held, and the arrows while zoomed in), so the stage stays one tab stop. The keys are
  one table (`LOOK_KEYS`) that the share, its menu, its bar and `aria-keyshortcuts` all read. A new framing from a key, a
  button or the menu glides (instantly under reduced motion); a drag or a pinch follows the pointer, and the view
  changing size (a divider dragged, the layout moving) moves the picture with its tile at once.
- **Sharp when zoomed.** LiveKit sends a screen in two layers (full and half size) and its adaptive stream picks one by
  the size of the element showing it. Zooming makes the video element itself bigger, inside a box that clips it, so a
  zoomed-in share asks for the full layer and stays sharp; at 100% it may get the half one.
- **The coordinate model** (`shareFrame.ts`, pure): a point on a share is normalised (0 to 1 across the picture and down
  it), whatever its resolution and however anyone has zoomed, so it names the same spot on every screen. A framing is a
  zoom and the point of the picture at the middle of your view; `place` gives the rectangle the picture is drawn in for
  a view, and `toShare` and `toView` convert points. It's settled for each view, so a picture bigger than the view always
  covers it. Pointers and marks ([Pointing at shared screens](#pointing-at-shared-screens)) align with your framing
  through it: they're drawn on the picture's box, and a press maps back with `toShare`.
- **Freezing and earlier pictures.** F, or the bar, holds the picture on screen still while the share goes on; comma
  steps back through earlier pictures (from live, it freezes first) and full stop forward, back to live after the
  newest. While a picture is held a ring goes round the share and a bar at its top says how far behind live it is
  ("0:42 behind live", counted from when that picture was last on the share) and which it is ("3 of 12"), with
  Back to live.
- **What's kept, and where.** Earlier pictures are a bounded buffer in this page's memory: at most 30 for each share and
  16 MiB, the oldest going first (never the one you're looking at). Each is a moment the picture changed, judged on the
  same 48 × 27 grey grid the notes' frames use (`screenGrid.ts`) but more finely: 0.6% of it moving, or all of it
  shifting a little (a new slide, a scroll or a window moved counts; a cursor moving doesn't). They're taken at most once
  a second from the video this browser already decodes to show the share, and only while you see that share big or in
  its own window. They're compressed (WebP, or JPEG from the first picture on where the browser can't write WebP, at
  most 4K) into ArrayBuffers in the page: never written to storage, a file or a Blob that's kept, never sent, never
  logged. A frozen picture is shown from a bitmap of the frame on screen, also at most 4K, so holding a 6K screen still
  costs no more than a 4K one: one such picture per share, apart from the 16 MiB, gone when you go back to live. The one
  line under the share's menu says it: up to 30 earlier pictures stay in
  this browser's memory until the share stops, and nothing is saved or sent. Presenters are told in the share picker
  that everyone can zoom in and look back at its last 30 pictures, each on their own screen, until they stop.
- **Apart from screen notes.** [Shared screens](#shared-screens) are frames a presenter's own browser sends to the API
  while the organizer has them read for the notes. These are pictures a viewer's browser keeps for that viewer alone,
  whatever the notes do; nothing of them reaches the API.
- **Never before you could see it.** Pictures come only from what this browser decrypts and shows, so none predates the
  moment you could see the share: after you were let in (the media keys move on as you join, so earlier frames can't be
  read), and only while you're in the same part of the call as its sharer (each part has its own keys, and another
  part's media is never attached).
- **When it goes.** Everything about a share goes the moment it leaves your stage: its sharer stops, leaves, is removed
  (LiveKit takes the share out of every room at once, and their pass can't get them back in) or drops out of the call's
  group (the MLS check stops showing it). All of it goes when this browser moves to another part of the call
  (`CallCrypto.place`: sent to a breakout room, back from one, or the organizer visiting one, each move a change of
  keys) and when you leave or are removed. Showing a share as a tile
  goes back to live and lets its earlier pictures go. A share's own window closes at the same moments. A presenter's
  Change swaps the track inside the same publication, so viewers can't tell a new surface from new content: pictures
  from before a change stay until the share stops.
- **Without earlier pictures.** While the organizer has paused notes nothing new is kept and what was kept goes (pausing
  stops every kind of capture), and they're kept again when notes resume. A device with little memory
  (`navigator.deviceMemory` under 2 GB) or a browser that can't draw or compress the picture keeps none either. Zoom,
  pan and freezing still work, and the menu says why there's nothing earlier.
- **Its own window.** Open in its own window (the share's ⋯ or its bar) puts the share in a window of its own, to keep
  in view over other apps or put on another screen. Document Picture-in-Picture where the browser has it (Chrome and
  Edge 116+, Firefox 151+): an always-on-top window this page fills itself, which LiveKit's adaptive stream counts as
  on screen even while the call's tab is in the background. Elsewhere on a computer (Safari) a popup window, which can
  go full screen on another display; LiveKit pauses its picture while the call's tab is hidden, as it pauses every
  video then, and the window says so. Phones and tablets show shares in the call only, and the menu says that. One share
  at a time: the stage keeps it as a tile ("In its own window", Bring it back, or P), and the next share takes its
  place. The window has the share's own bar and keys, with the share focused as soon as it opens (and again when you
  come back to the window), so its keys work at once; bringing it back (Back to the call, Bring it back, or closing the
  window) puts focus back on its tile. It's a blank page that carries the call's own CSP, whose `base-uri 'none'`
  refuses a `<base>`, so the app's stylesheets are linked by their full address. It uses its own timers (so it keeps
  going while the call's tab is in the background), and nothing in it relies on the call tab's animation frames.
- **Comparing shares.** Two shares sit side by side ([The call screen](#the-call-screen)); each is zoomed, frozen and
  stepped back through on its own, so you can hold one still beside the other live, or open one in its own window on
  another screen beside the call.
- **Checked by hand,** with three people and two shares at once (Chromium, fake devices, the presenters sharing slide
  decks drawn on a canvas): zoom by keys, Ctrl and the wheel and dragging; freezing, stepping back and forward and back
  to live; Document Picture-in-Picture and the popup window, each closing as its share stopped, both also on the
  production build under production's CSP (no violation, styled, the share focused, focus back on the tile); a move
  into a breakout room; a 6K share held still at 4K; phone and wide stages, keyboard only and reduced motion; and memory
  over ten minutes of a share that changed every frame, which stayed flat once 30 pictures were kept.

## Room recordings

`POST /v1/recordings` creates a private note (`kind: room`, nobody invited) and a recording. In the app, Record
(`/record`) takes the name and opens the stage recorder (`/record/live`), which starts it. The name is handed over
in memory (`sessions.roomTitle` in `apps/web/src/lib/live.ts`), never in the address; the stage recorder opened
any other way (a reload, a link) starts with "Notes from the room". Without a connection, starting currently ends
at "Couldn't start recording". The browser records the microphone in 5-second pieces to
`POST /v1/recordings/:id/audio` and sends clips of speech to `POST /v1/recordings/:id/transcribe` (both through
`RoomCapture`, `apps/web/src/features/record/capture.ts`); a room recording has one segment, and clips are
refused while it's paused. `RoomRecordingState.transcript` carries the latest 200 lines, with no speaker. Rename, pause and
resume are actions; **Stop** finishes the note like leaving a call (stopping twice finishes it once);
**Discard** deletes the note, its recording and every object, as deleting your own note does.

### The recording's own times

Every piece and clip says where it starts in its segment (a room recording has one): `at`, in seconds with
pauses not counted (`x-alcove-at-ms` on the wire). Pieces play in the order of their `seq`, and a piece
sent again must start and last as the stored one does; transcript lines are placed by their clip's `at`.
Nothing is timed by when it arrives, so a recording keeps its own times however late it's uploaded.

- **Starting.** `POST /v1/recordings {title?, startedAt?}`. Without `startedAt` the recording starts now.
  With it, the recording and its note start then. `startedAt` may be up to 14 days back
  (`MAX_RECORDING_AGE_DAYS`) and up to 5 minutes ahead of the server's clock, since a device's clock can
  run a little fast; anything else is `400 invalid`.
- **Starting again.** Starting from the same `startedAt` as one of the account's room recordings returns
  that recording as it is (recording, paused or stopped), however old it is by now, instead of making a
  second one. Starts from the same moment wait for each other (a transaction-scoped advisory lock per
  account), so two at once still make one recording. Only the account's own room recordings are found (a
  call's recording from the same moment isn't); a discarded or deleted one is gone, so its moment starts a
  new one.
- **Pieces** are found by their place, `(segment, seq)`, and stored once. Sending a piece that's stored
  already is a no-op, even once the room recording has paused or stopped, so its upload can be sent again
  at any point. A different piece sent to a place that's taken (another start or length) is
  `409 conflict`, never dropped as if it were stored. New pieces are refused while the recording is paused
  or stopped.
- **Clips** are transcribed once each, by a keyed tag of their segment and start, and each line is placed
  at the clip's `at` plus where it starts in the clip
  ([Notes and inference › The live transcript](notes-and-inference.md#the-live-transcript)).
- **Length.** The note's duration, what stopping returns and the minutes charged are the pieces' total,
  never the time since the recording started.

**Late uploads.** A recording made without a connection uploads the same way, later: start with its
`startedAt`, send its pieces and clips, then stop. An upload cut off part way (a closed tab, an answer
that never arrived) starts again from the same `startedAt` and sends everything again: what's there
already is skipped, and stopping finishes the note once.

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
- **A camera that fails to publish** (a failed negotiation, no answer from LiveKit in time) is tried again under a
  new track. LiveKit's server keeps the failed request under the track's ID and ignores a second one with it, and
  LiveKit refuses another publish of that ID while the first waits ("a track with the same ID has already been
  published"), so retrying the same track could never work. The room takes out what LiveKit left of the attempt (a
  sender still in the connection, and the request waiting for an answer), never offers that track again, and after
  1, 3 and 10 seconds, then every 30, has `LocalMedia` open the same camera again (`renewCamera`), at the size and
  blur in use, without a word. Only while the camera is still on: one turned off meanwhile stays off. Each try waits
  longer, also when the camera doesn't open again, and a publish that works starts the count over. The new track is
  published as any other, at the size chosen (HD included).
- **Video quality** (`apps/web/src/features/call/VideoQuality.tsx`, under More → **Video quality**). Two choices,
  remembered in this browser with the devices (`sendVideo` and `receiveVideo` in `alcove.devices`), changeable at
  any moment of a call:
  - **Video you send:** 360p, 720p (the default) or HD 1080p. The camera is asked for that size (`VIDEO` in
    `media.ts`: 30 fps, 24 at 360p) when it opens. A change in the call goes to the running camera
    (`applyConstraints`, after any device work already asked for, with blur in the same set, as each call replaces
    the last): a smaller size is the browser scaling it, and HD asks it for at least 1920×1080, then for the nearest
    it has, so it never stops. The camera is published with simulcast layers for its size
    (`CAMERA` in `livekit.ts`): 180p, 360p and 720p up to 1.7 Mbps; 360p, 720p and 1080p up to 3 Mbps for HD;
    180p and 360p for 360p. A publication's layers are fixed when it's published, so a camera sent at a new
    size is published again, and everyone sees it stop and start for a moment. A camera that can't give 1080p
    is sent with 720p's layers (`cameraSends`, which the choice reads too), not as two full-size copies, and the
    choice says how far it goes ("Your camera gives 720p at most, so that's what's sent.").
  - **Video you see:** Auto, Data saver or No cameras, for everyone else's cameras.
    - **Auto** is LiveKit's adaptive stream at up to 1.5 device pixels to a CSS pixel (`pixelDensity`): each camera
      comes in as sharp as its tile is on this screen, so a large tile on a high-density screen gets 1080p while a
      grid of small ones keeps to small copies. A camera nobody here can see (the tab in the background, another
      breakout room, a tile not shown) is paused, and dynacast stops layers nobody is watching. Nothing calls
      `setEnabled`: once called, livekit-client keeps that over adaptive stream's pausing for good.
    - **Data saver** caps each camera at its smallest layer (`setVideoQuality(LOW)`).
    - **No cameras** unsubscribes from them (`setSubscribed(false)`, and `true` to come back), so LiveKit stops
      sending them, and the tiles show people's arches. While anyone else is in the call, "Cameras are hidden for
      you", with **Show cameras**, stays at the top of the call, so it isn't taken for everyone's camera being off;
      on a narrow screen it's the icon and the button.
    - Shared screens are never capped: their text has to stay readable.
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
  in its menu), the speaking ring and the recorder waveform. On Record the page has its own `LocalMedia`, which
  opens the microphone only when **Check the level** is pressed and lets it go on **Stop** or when the page is
  left; choosing a microphone while it's closed only remembers it, and one that doesn't start while it's open
  says so and isn't shown as chosen.
- Sound the browser won't play until the page is clicked (Safari, when nothing is being captured) is said in the
  status bar for as long as it lasts, with **Play sound**, and every click, tap or key tries again
  (`CallRoom.startAudio`) until it plays.
- `NotesRecorder` picks the first supported codec (Opus in WebM, then MP4, then Ogg) at 32 kbps. It records
  through a Web Audio graph (a `MediaStreamAudioDestinationNode` behind a limiter) that mixes its voices: the
  microphone in a room recording, everyone the organizer's browser hears in a call. Switching microphones, and
  voices coming and going, carries on in the same recording instead of going silent or starting again;
  MediaRecorder can't change its input track. It keeps recording through a dropped connection and sends what it
  held once it's back (above).

Beside it, `SpeechClips` (`apps/web/src/features/call/speech.ts`) feeds the live transcript: an
AudioWorklet (`apps/web/public/pcm-capture.js`) mixes the microphone to mono, filters and resamples it to
16 kHz, and the samples are cut into WAV clips at pauses. Clips without a voice in them aren't sent. It
never touches the encrypted recording.

## Next

- **A room's own notes.** What's said in a breakout room is only shown live, to the people there when it was
  said. Notes of their own for each room, given to the people who were in it, need notes whose parts have their
  own readers.
- **Host hand-off** when the organizer drops (#30): another member's browser takes over committing.
