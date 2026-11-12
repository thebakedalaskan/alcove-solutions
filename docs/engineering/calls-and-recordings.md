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
  pieces (a room recording that keeps what it can't send waits for all of them, since it stops only after they've
  gone or been kept). Each piece says where it starts in its segment, pauses not counted (`x-alcove-at-ms`). The server
  treats a repeated `(segment, seq)` as a no-op (a different piece sent to a place already stored is
  `409 conflict`) and rejects audio for a paused or stopped recording, for an earlier segment, or from a
  connection that hosted before, which the call has gone on from (`409`: that tab drops what it hadn't sent, as
  below). A piece whose `content-length` is over 2 MiB is refused before its body is read.
- **Live transcript.** While notes are on, the host's browser (the organizer's, or a stand-in's) also sends clips of speech, one stream per
  voice it hears (its own microphone and each other unmuted microphone it plays), to
  `POST /v1/live/calls/:id/transcribe` (16 kHz mono WAV, at most 30 seconds, each saying where it starts in
  its segment with `x-alcove-at-ms`, whose it is with `x-alcove-speaker` and how long before the request it
  began with `x-alcove-ago-ms`; 40 a minute for each voice, 240 for the account, counted once the call takes the
  clip as its sender's to send). Each clip is transcribed by NEAR AI and kept as sealed lines in the part of the
  call its speaker was in when it began, and `CallState.transcript` carries the latest 200 the viewer may read,
  each under whoever said it. Only the browser that hears that part of the call sends its speech: whoever hosts
  now for the main room, a breakout room's scribe for the room (`403` from anyone else; see
  [Breakout rooms](#hands-spotlight-breakout-rooms-and-captions)), and a room's clip is placed by the server's
  clock rather than its `x-alcove-at-ms`. Clips are refused while notes are off or paused, the call's or the
  room's, for an earlier segment, or naming a speaker who isn't in the call. See [Notes and inference › The live transcript](notes-and-inference.md#the-live-transcript).
- **Leaving.** The browser stops the recorder, sends the last audio and speech, then calls `leave`. The
  server finishes the note in the same transaction that ends the call, then starts the notes worker.
- **Playing it back.** `GET /v1/notes/:id/audio/:segment?pieces=N` decrypts the first `N` pieces of a segment for anyone
  who has the note. That number makes it one file however much more is recorded: a browser holds a URL to the length it
  first said, and reading further is a new URL, from the note's own count of pieces. A range is what the browser's audio
  element asks for, so it starts at once and goes to any moment: 206 with the exact length, from what the pieces are
  stored at (`recordPlainBytes`) with nothing read, and at most 24 MiB, because Cloud Run refuses a reply of a known
  length over 32 MiB; the browser asks again for the rest. A recording has no cues, so going far ahead reads through
  what's between, once. Firefox won't do that: for a recording with no cues it seeks only inside what it has read, says
  that's the duration, and stops there. So the player compares where it's going with `seekable` and with where a seek
  landed, and if the browser can't get there it fetches the segment whole and plays it from memory until someone leaves.
  With no range the reply is that whole segment, chunked, with no length, so it has no size limit. Pieces are read eight
  or 2 MiB ahead of the one being sent, whichever is less, in order, and only as fast as the listener takes them. The
  first piece of a reply is read before anything is sent, so one that can't be read is an ordinary error; a failure after
  that breaks the connection, so nothing takes a short file for a whole one. Someone leaving isn't a failure, and it stops
  the reading and wipes the key, even before the reply began. HEAD says how long it is and reads nothing. While a call is
  recording, the note doesn't update by itself, so the player reads it again when it reaches the end of what it had, and
  plays on from there if there's more.
## Group calls

Media goes through LiveKit (an SFU: a local server in Docker for development, LiveKit Cloud in
production), end-to-end encrypted: LiveKit forwards frames it can't read ([below](#end-to-end-encryption)).
The call itself stays in the API: who's let in, notes and the transcript.

- **Joining.** `GET /v1/calls/:code/card` (no account needed; 600 a minute per client address, since every
  pre-join keeps reading it) gives the title, organizer's name, when it starts, whether the organizer is there,
  whether the call is locked, whether it was scheduled with notes and what they keep, whether everyone joins muted,
  once it has started what it captures (`capture`, without anyone's name), whether it has ended (and nobody started
  it again), where the person asking stands (`you`: invited, asking with an account the notes may go to, or a guest),
  which ways of signing in get the notes (`signInForNotes`), and while the call offers times, those still to come and
  how long it is (`offer`). A series that repeats has a link of its own too: every code here can be that one, and it
  leads to the call that's on now, else the next one, else the latest, with a call that just ended keeping it for
  an hour past its time, for anyone, by that call's own guests
  ([Notes and inference › Series](notes-and-inference.md#series)). The call a link leads to is the one a call session
  then belongs to: its `code` is the call's own.
  `POST /v1/calls/:code/join` (120 a minute per address) takes `{mic, cam}`, this
  connection's random `identity` and MLS `keyPackage` (made in the browser), a `name` (1–60 characters) without
  an account, and `previous`, this tab's last pass for the call, if it has one. Someone signed in joins under
  their account's name; a typed name is only for guests. It returns a ticket: the LiveKit URL and room, the
  identity, the role and a **call pass**. No LiveKit token: that comes only once you're let in.
- **One event.** A call has at most one calendar event, however a pick and a change cross. Whoever puts it on the
  calendar claims it first, under its lock (`placing`, for a minute at most, so a process that dies lets go of it), and
  asks Google holding nothing. Anything else that would place it finds the claim and leaves it, what changed meanwhile
  goes to the event once it's there, and a call cancelled meanwhile takes the event with it.
- **Picking a time.** A call can offer two or three times instead of settling on one. It goes on no calendar, and
  nobody joins it (`409 conflict`), the organizer included, until someone with the link picks one:
  `POST /v1/calls/:code/pick` (30 a minute per address, no account needed) takes `{at}`, one of the times still
  to come (`400 invalid` otherwise). It sets the call's times, lets the others go and puts it on the organizer's
  calendar, which sends the invitations. It runs under the call's lock, so of two people picking at once the first
  wins, and every later pick is `409 conflict`. Meanwhile `update` can't move it (`409`), and it can be cancelled
  like any other call.
- **Who gets in.** The organizer by their account; it starts the call and makes the room (`r_<random>`;
  LiveKit never creates rooms itself). Invited people (signed in with an invited address) are let in by the
  host's browser without anyone asking, and so is someone let in before who comes back with their old
  pass (a reload). **Anyone else asks to join**: whoever hosts sees them (`CallState.waiting`, a toast and
  People) and lets them in or turns them away (`deny`). Someone signed in with an account the notes may go to
  asks under it, so the organizer sees their name and address; anyone else is a guest by name (the one they
  typed, or their account's). Nobody joins before the organizer is there (`409 conflict`), while the call is
  locked (`403 forbidden`; a lock keeps new people out, not someone coming back to their place) or once it has ended (`409`, "This call has ended."); someone removed asks again. An
  ask taken back stays turned away, so its identity can't ask again as someone else. Someone waiting learns only
  what the call captures, as the card does: nobody's name, no asks, and nothing that's been said. There's no
  participant limit.
- **Let in from the link, signed in.** The commit that lets in someone who asked with an address also adds it to
  the invite: to the meeting's guests, and to the note's invited people when notes have been on
  (`features/meetings/invites.ts`), so they get the notes when the call ends, like everyone invited by email. Only someone
  who asked counts (the organizer saw who it was), and an address comes with an ask only when the notes may go to
  that account: a real one (Google), or any when the organizer's own account is a demo one, since demo sign-ins
  check nobody and Microsoft's is one account everyone trying Alcove shares. Invites keep their usual rules, up
  to 300 people; past that, someone let in is a guest without the notes. From then on they're invited: the call
  shows them their role as `invited` (`CallState.role`, which can be more than their pass says), they see people
  as invited people do, a reload or another device comes in without asking, and the organizer can send them to a
  breakout room. An earlier pass brings someone back only as the same account (or still none). The meeting keeps
  which guests came this way (`addedFromLink`, in its sealed manifest), so removing one takes them off the invite
  in any run of the call, once no other connection of theirs is still in it. People invited by email stay
  invited, and notes already given when an earlier run ended stay given. The calendar event isn't changed:
  Google would email everyone on it in the middle of the call.
- **The room.** `GET /v1/live/calls/:id/room` gives a LiveKit token for that one room (120 seconds, no
  admin rights) to people let in, and to nobody else. It may send data, which browsers use for pointers and marks on
  shared screens, sealed end to end ([Pointing at shared screens](#pointing-at-shared-screens)), for React's emoji
  (`CALL_REACT_TOPIC`, which emoji and nothing else, at most 8 a second each after a burst of 24), and for a browser that
  can't decode VP9 to say so (`CALL_CODECS_TOPIC`, that and nothing else, every 10 s whatever its flags, at most 1 a
  second after a burst of 3; see Video quality); the API is never in the room, so it never receives any. Tokens carry no name: LiveKit knows people only by random identity.
- **The call pass** is an HMAC (a key derived from `KMASTER`) over the call, the organizer, the person's
  LiveKit identity, role and name, valid for 12 hours. It goes in the `x-alcove-call` header on every
  `/v1/live/calls/:id` request, never in a URL or log. The live routes open the organizer's keys for it
  from `KMASTER`, per request. A removed person's pass stops working, and once the call has ended only the
  organizer can read it.
- **What each role can do.** Everyone let in: read the call, chat, catch up and ask, for themselves alone
  ([Catching up during a call](notes-and-inference.md#catching-up-during-a-call)), read the live notes of the part of
  the call they're in, written only from what they may read ([Live notes](notes-and-inference.md#live-notes)), and keep
  them up to date by watching them, raise a hand, ask for notes,
  point at and mark shared screens and say whether others may point at what they share
  ([Pointing at shared screens](#pointing-at-shared-screens)), and, while notes are on or paused, put a screen they
  share in the notes, which their own browser records ([Shared screens](#shared-screens)).
  Everyone reads the live transcript of the part of the call they're in, as said while they were there; a guest
  with the link, who doesn't get the notes, reads only what was said while they were in the call as well (the
  live transcript, captions, catching up, asking and moments), while the organizer and everyone on the invite
  (people signed in whom the organizer let in included) read all of it, and can tick follow-ups in the live notes.
  Whoever hosts (the organizer, or someone
  standing in while the organizer is away: [Host hand-off](#host-hand-off)), with their current connection and
  their own session: let people in or turn them away, mute someone's microphone, remove someone (never the
  organizer), lock the call, spotlight someone, bring everyone back from breakout rooms, say what their browser
  can't capture, audio and speech uploads, and end the call. Only the organizer (pass role `host`, their own
  session and their current connection: joining from another device takes the powers with it, and so does moving
  there, below): notes on/off, pause and resume, shared screens in the notes, say not now to an ask for notes, turn
  pointing at shared screens off for everyone, stop anyone's share for everyone ([Shared screens](#shared-screens)), and
  open, rearrange, rename, visit and pause breakout rooms. A
  connection that hosted before, which the call has gone on from, is told `409` "You're not hosting this call from
  here any more". The recording and the main room's live transcript come from what the host's browser hears, and a
  breakout room's transcript from what its scribe's browser hears there (see Notes below). Link guests get no notes; invited people, and people signed in whom the organizer let in, get them.
- **Leaving and ending.** Anyone but whoever hosts leaving is taken out of their part of the call's group, so
  its keys move on without them. They leave with **Leave** (`POST /v1/live/calls/:id/leave`), or when their page goes away
  (closed, reloaded or left for another), which sends the same request as a keepalive request. A page that is
  only put in the back-forward cache sends nothing. Anyone's page, the host's too, leaves the LiveKit room as it goes
  (`pagehide`, in `livekit.ts`), and never on `beforeunload`, LiveKit's own way (`disconnectOnPageLeave` is off): that
  fires as soon as the page follows a link, and a link that turns out to be a download leaves the page where it was. A
  file in a document downloads in a frame of its own, so the page never follows one ([Data and storage ›
  Media](data-and-storage.md#media)). A browser that dies without a word leaves by LiveKit's
  `participant_left` webhook. Anyone let in who isn't in the room 90 seconds later is taken out too. That covers
  a tab closed while asking, and a webhook that was missed. It's checked 90 seconds after the commit that let
  them in, and at every upkeep, and 90 seconds leaves time for a tab in the background, which can take a minute
  to notice it was let in. When Alcove learns a connection went without it saying so (that webhook, that check, or
  the same person back on a new page while the old one was still in), its time in the call ends when Alcove last
  heard from it, not when it found out. A page in a call asks at least every 6 seconds, so the time after that is
  never counted as theirs, and a guest with the link reads nothing said in it. The API keeps that moment in memory
  (it runs as one instance); after a restart, until the page asks again, such a stay ends when they were let in.
  The page of whoever hosts sends nothing as it goes, so their reload comes back still
  hosting. Whoever hosts ends the call for everyone with **End call for everyone** (`leave` with `end: true`): the
  normal ending above, then the room is deleted (everyone else is disconnected with "room deleted"). They can leave it
  going instead, with someone else hosting ([Host hand-off](#host-hand-off)). Their connection dropping doesn't end
  it: `POST /hooks/livekit` (signed by LiveKit with the API key) records when the host's connection left; 10 seconds
  later someone else hosts, and only if nobody can does the call end, once they've been gone for more than 25
  seconds (upkeep asks LiveKit whether they're in the room before doing either). A host whose browser never reaches
  the room is gone the same way, after 25 seconds. When everyone has left, LiveKit finishes the room after 20
  seconds, which ends the call too, and upkeep ends calls whose room is gone.
- **Who's in** comes from admission, sealed in the call's state: never from LiveKit's API on reads, so a
  call's reads cost LiveKit nothing. Each participant also has a `seat`, the same across their reconnections (a
  reload, a comeback, a move to another device) and, for the organizer, on any device, which viewers' own layouts
  key them by ([The call screen](#the-call-screen)). Anyone else joining from a second browser or device without
  moving gets a new seat.
- **In the browser** `apps/web/src/features/call/media/livekit.ts` (loaded only by the call screen) wraps the
  room: it publishes `LocalMedia`'s tracks as they are, encrypted, swapping a new microphone or camera (or a
  change of what's shared) into the same publication, plays everyone else's audio on the chosen speaker at each
  person's volume for this listener, and refetches the call on the server's change pushes (`CallChanged` on `CALL_TOPIC`:
  what to fetch again, and nothing else), arrivals and departures. Change pushes are taken only from the server (a packet
  from no participant): anyone in the room can send data, which carries pointers and marks, and a stream of them from one
  participant would keep every browser fetching the call. The server sends one to everyone in the room, or, when only one
  person's view changed (someone's nudge, below), to that person's connections alone. Several people can
  share a screen at once ([The call screen › Shares](#the-call-screen)).

## End-to-end encryption

Every browser in a call is an MLS client (RFC 9420): `packages/api-http/src/mls.ts`, on ts-mls, suite
`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`. Its keys are made in the browser and never leave it. The
API orders and relays MLS messages and can't read them. Each group's operations run one at a time, in
order, and nothing a message carries can stop it: anything unreadable is skipped and the next one is read.

- **One group for each part of the call.** The main room has an MLS group, and while breakout rooms are open
  so does each room (named `alcove/call/<call>/<generation>/<main or the room's ID>`). A part's media keys and
  chat come from its own group, so they belong to the people in that part alone. The browser of whoever hosts (the
  organizer's, or a stand-in's: [Host hand-off](#host-hand-off)) creates every group, so it's in all of them; everyone
  else is in exactly one at a time, the group of the part they're in (the API adds only people who are in no group).
  Where someone is comes from the call's state
  (`CallMls.place`): someone sent to a room (invited, by address, or a guest, by person) is in that room, the
  organizer in the room it's visiting, and everyone else in the main room.
- **Members and commits.** Joining makes a fresh key package whose credential is the connection's random
  identity. The host's browser is every group's only committer: it adds people (an Add commit, with a
  Welcome carrying the ratchet tree for each) and removes whoever left, was removed, or was sent to another part
  of the call. Every other browser accepts commits only from the committer's leaf (leaf 0, which a joining
  browser checks is the connection the API names as committer, in the group it expects: this call, this
  generation, this part). The host's browser adds only people the API lists as pending for that group
  (`CallMls.groups[].pending`), checks each key package (well formed, this suite, signed by its own key, naming
  the identity it came with; one that isn't is turned away), adds at most 50 at a time, and waits a little
  longer after each refused commit, so a refusal can't become a loop. When nobody comes or goes it moves each
  group's keys on anyway every 10 minutes (an empty commit), so one set of keys never covers a whole call.
- **Who commits.** The connection that hosts (the call's sealed `host`, mirrored in `calls.host_identity` for
  webhooks and upkeep), for every group: the organizer's while they're in the call, a stand-in's while they're away.
  Every change of host starts a new generation (`newGeneration` in the calls module: the organizer joining or coming
  back, a hand-off, a stand-in's reload), so a generation's committer never changes, and the host and the generation
  change together in one transaction holding the call's row. The places that rely on it: `committerOf` (the places
  module), which names the committer to every browser (`CallMls.committer`); the `/mls/commits` route, which takes
  commits only from whoever hosts (`hostOnly` in `app.ts`), and `mlsCommit`, which checks again under the row lock
  that the commit's connection hosts and its generation is the current one; `mlsSync`, which gives that connection
  the committer's view (every group's commits, whom to add to each and take out of it); and in the browser,
  `HttpCall`'s `hosting` (from `CallMls.committer`), which opens and commits for every group, and `COMMITTER_LEAF`
  (`mls.ts`), the one leaf whose commits a group takes. Breakout rooms' own scribes, should a room transcribe itself,
  are no part of this: they hear, and never commit.
- **Moving between parts of the call.** Rooms opening or closing, or the organizer moving someone
  (`rooms-move`), changes where people are. The host's browser commits every group's departures before any
  additions: it takes each mover out of their old group, whose keys move on without them, then adds them to the
  new part's group with a fresh key package (each key package joins one group at most; the API asks a browser for
  a new one with `CallMls.keys`, and gives the host's browser each mover's latest one with their entry in
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
  (`call_mls`, each entry but a key package tagged with its part of the call). The host's browser gets
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
- **Chat mentions** are selected MLS identities and UTF-16 spans inside that same encrypted payload. The sender and
  recipient validate the spans and the destination's MLS membership; a mention never grants access to a room. Older
  encrypted messages without `mentions` open as an empty list. `read-chat` carries only opaque `generation:seq` message
  IDs, stored in the existing sealed call state by the checked person's seat (the organizer has one stable seat).
  Only that viewer receives their `chatRead` list. Waiting/removed callers cannot write receipts, and message IDs must
  belong to this owner's call log. Older sealed call records default missing `chatRead` to `{}`; no migration or
  encryption-header change is needed. Receipts live as long as the call, so handled mentions cannot reappear after an
  arbitrary receipt limit.
- **Reactions** are a second kind of payload inside the same MLS application message as chat, so the API sees
  nothing new: the same relay, the same sender check, and the same rate limit as a chat message. A reaction names a
  message by its place in the log, `generation:seq`, and an emoji (one of eight, by name; the wire never carries a
  glyph), and says whether it's added or taken back. Each person's reaction is a toggle: the same emoji twice from
  one person is one reaction, and taking back one they never added changes nothing. Because the target is the log
  ID, you can only react once your own message is in the log. Each browser folds the toggles into the message as it
  reads them, in the order they came, and an emoji with nobody left on it goes away. Someone who comes in later
  can't read earlier chat, so a reaction to a message this browser never had is ignored. A reaction only counts on a message of
  the part of the call it was sent in: after moving to a breakout room you can't react to the main room's messages
  still on screen, and a reaction read in one room never lands on another's. One that can't be sent
  after a few tries is taken back, and the person is told.
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
- **A new host connection** (the organizer's reload or another device, the organizer coming back while someone
  stood in, a hand-off, or a stand-in's reload) starts a new group generation for every part of the call, which the
  new host's browser creates: the old connection's keys stay with it and open nothing from then on, everyone already
  in rejoins their part's new group with fresh keys without asking, open rooms stay open (the organizer in the room
  it was visiting), and anyone still waiting keeps waiting (key packages aren't tied to a group, so theirs carry
  over). The old host's commits are refused from then on: as out of date (`409`) when it hosted before, for its old
  generation and the new one alike.
- **Who vouches for whom.** The API says who each identity is, who's invited, what their names are and who's in
  which room; it can't read media or chat. It's built to run attested, but it runs on Cloud Run today, so whoever
  operates it could run other code (privacy › Moving to confidential computing). There are no safety codes. An
  API running other code could have the host's browser add someone as an invitee, or put them in a room they
  weren't sent to, but never silently: everyone sees every member of their part of the call's group in People (as
  "Someone" if the API doesn't name them), and their tile if they connect.
- **What it doesn't cover.**
  - The host's browser holds every room's keys, because it commits for every group, so a modified host browser
    could hear and read any room: the organizer's, or while the organizer is away, a stand-in's (someone invited,
    never a guest). An unmodified one plays, sends and chats only in the part of the call it's in, the API relays a
    room's chat to it only while it's there, and the room is told when the organizer comes and goes. Zoom's end-to-end
    encrypted breakout rooms give each room a leader of its own instead; here every room's committer is the host's
    browser, so a room committed by one of its own members is still to come.
  - The host's browser also writes the organizer's notes: it records what it hears and sends each voice's speech
    to be transcribed, saying whose voice it is. The API checks that this comes from the connection that hosts, with
    its own session, but it can't check what it hears or whose it says it is. So while someone stands in, the
    notes that go to everyone invited are only as true as the stand-in's browser: a modified one could leave words
    out, add some, or put them in someone else's mouth. That's the same trust the call places in the organizer's
    browser, given to someone the organizer invited, and only while the organizer is away.
  - Every part of the call shares one LiveKit room, so LiveKit forwards each room's encrypted frames to everyone
    in the call: a modified browser gets frames it can't decrypt from other rooms, with their audio-level header,
    so it can tell who is speaking when in another room, though not what they say. Each frame also carries its
    key's ring index in the clear (LiveKit's frame trailer), so LiveKit can see whose keys change together, and so
    who is in which part of the call, and who is between two (the reserved index).
  - While notes are on, what everyone says also goes to the API, outside the media encryption, as the call's People
    panel says. In the main room, what the host's browser hears (the host is the organizer, or someone standing in
    while they're away): its microphone and every other microphone it plays, each person's speech on its own as clips
    to transcribe, and the recording, which mixes them ([The call screen](#the-call-screen)). In each breakout room,
    what the room's scribe's browser hears there, as clips only: what's said in a room goes into the call's notes as
    the room's own section, and the recording is silent while the host is in a room
    ([Breakout rooms](#hands-spotlight-breakout-rooms-and-captions)).
  - LiveKit still sees addresses, when calls happen, who's in the call's room (by random identity), track kinds and
    mute state, packet sizes and timing, the audio-level header, so exactly who is speaking when, and the size and
    timing of the data browsers send each other, so roughly when someone points or draws on a shared screen (not
    where, nor at what).

## Host hand-off

The organizer hosts while they're in the call. While they're away (their connection dropped, or they left it to
someone), someone invited stands in: the call goes on, and the organizer takes it back by joining again. Who hosts is
the call's sealed `host` (`apps/api/src/features/calls/hosting.ts` decides who may and in what order; `newGeneration` in the
calls module makes the change), shown to everyone as `CallState.host`.

- **Who can stand in.** Someone in the call who is invited: by email, or signed in and let in from the link (so added
  to the invite). Never a guest: whoever hosts sees everyone asking to join (addresses included), decides who comes in,
  and holds every part of the call's keys. The order: the person the host chose when leaving; otherwise people in the
  main room before people in a breakout room (the host's browser is what hears the main room for the call's notes),
  then whoever came into the call first (their first connection), then by identity, so every server picks the same
  person. Whoever hosts sees that list as `CallState.host.next`; nobody else does. When everyone invited is in a room,
  the stand-in hosts from there and nothing hears the main room until rooms close
  ([Hosting from inside a room](#hands-spotlight-breakout-rooms-and-captions)).
- **When the organizer's connection drops.** LiveKit's `participant_left` webhook records when the host's connection
  left. Ten seconds later (`HANDOFF_MS`), if LiveKit still doesn't have it, upkeep hands the call to the best person who
  is in the call and in its LiveKit room (`reconcile`, then `standInFor`, which checks everything again under the
  call's row lock). If nobody can, the call ends once the host has been gone 25 seconds (`HOST_GRACE_MS`), as it always
  has; a host whose browser never reaches the room is gone after 25 seconds the same way. The same happens when a
  stand-in's connection drops: someone else stands in, or the call ends. A host who let go to move to another device
  isn't dropped: until that move runs out, upkeep leaves the call alone, and the new device hosts on
  ([Moving to another device](#moving-to-another-device)); a move that runs out is a host gone like any other. Upkeep
  sees to each call on its own
  (`reconcileCall`): one it can't hand on or end this time is logged and tried again next time, and never holds up
  the others.
- **Leaving on purpose.** Whoever hosts chooses in the leave sheet: **End call for everyone** (`leave` with `end:
  true`), or **Leave and keep it going** with someone else hosting (`POST /v1/live/calls/:id/hand-off {to}`; the best
  person is chosen already, and Change lists the others). One transaction takes the leaver out and starts the new
  host's generation, so the call is never without a host; someone who can't host now (a guest, someone gone, someone
  not in the room, someone in another call) is refused with `409` and nothing changes. A host's `leave` without `end`
  (a browser that hadn't heard yet that it hosts) hands the call to whoever's next, and is refused when nobody can
  take it, so leaving never ends a call by accident and a page going away never ends one at all.
- **Coming back.** The organizer joining again (from the join page, or any device) hosts at once, in a new
  generation; whoever stood in carries on as a member. A stand-in's reload comes back hosting too, as the organizer's
  does, even into a locked call. An organizer's tab that was away when someone else took over learns so
  (`CallMls.admission` and `CallCrypto.status` `away`) and goes back to the join page, where joining takes the call
  back.
- **What a stand-in can do.** Let people in or turn them away, mute, remove anyone but the organizer, lock and
  unlock, spotlight, bring everyone back from breakout rooms, end the call, or leave it to someone else. What the notes
  capture stays the organizer's: a stand-in can't turn notes on or off, pause or resume, choose the model that writes the notes, or
  say not now to an ask, and can ask for notes like anyone else. Stopping someone's share stays the organizer's too. Breakout rooms stay as the organizer set them (no
  opening, moving, renaming, visiting or pausing a room), and close on time. Only the organizer adds anyone to their
  invite: someone signed in whom a stand-in lets in is in the call as a guest, without the notes (their call card
  says `guest` while someone stands in), and the organizer can share the notes with them afterwards. Host powers
  need the stand-in's own session as well as their pass: an account with the invited address they joined with.
- **Keys.** Every change of host starts a new MLS generation, which the new host's browser creates for every part of
  the call ([Who commits](#end-to-end-encryption)): it's leaf 0 and the only committer in each, which every joining
  browser checks against the API's `committer`; everyone rejoins their own part's new group with fresh keys; the old
  host's keys open nothing from then on. Fencing: the host and the generation change together under the call's row
  lock, and a commit is taken only from the connection hosting now, in the current generation, checked again in the
  commit's own transaction, so two browsers never commit in one generation. Races settle the same way: the organizer
  joining as upkeep hands off leaves the organizer hosting whichever goes first (upkeep sees the host changed and does
  nothing, or the organizer's join takes it back), and two upkeeps at once (two servers, or a webhook's timer and the
  regular run) hand off once. A connection that hosted before gets `409` ("You're not hosting this call from here any
  more") from what only the host may do, so its browser drops what it was still sending; anyone else gets `403`.
- **The notes go on.** The recording and the live transcript come from the browser of whoever hosts: while notes are
  on, each change of host ends the old browser's segment and starts a new one in the new host's, so the notes cover
  the call, and audio or speech still arriving from the old browser is refused (an earlier segment, and not the host).
  Each clip is transcribed once: one browser hears at a time, and a clip sent twice is kept once. What the notes
  capture carries over exactly: on stays on, paused stays paused and off stays off, and nothing but the organizer
  resumes or turns them on. The call's note, its recording and its keys stay the organizer's (the live routes open the
  organizer's keys per request, whoever sends), and when the call ends the notes go to everyone invited, as always.
  The moments between a drop and someone taking over aren't captured, and aren't marked as a gap yet.
- **What everyone is told.** Each change says so once, to the new host in their own words ("Art's connection dropped,
  so you're hosting until Art is back") and to everyone else in the same sentence ("…so Priya is hosting until Art is
  back"; "Art is back and hosting again"; to the organizer, "You're hosting again. Priya hosted while you were away"):
  notices for one connection (`to`) or everyone but one (`not`). While someone stands in, the status bar says so for
  everyone ("Priya is hosting while Art is away"), People tags them, the call's link says someone is hosting (named only
  to the organizer, whose join page says joining takes it back), and people asking to join wait for "the host".

## What's captured

One capture state for the whole call (`CallState.capture`, `packages/api/src/calls/capture.ts`), kept in the
call's sealed state (`apps/api/src/features/calls/capture.ts`) and the same for everyone in it:

- **Its parts.** `recording` (what the host's browser hears in the main room, mixed: its own
  microphone and everyone else's, encrypted; silent while the host is in a breakout room), `transcript`
  (everyone the host's browser plays in the main room, or a breakout room's scribe's browser in the room, turned into text by the private speech model, each line under whoever
  said it), `ai` (the private notes model reading the transcript: the notes at the end, live notes, catch-up, questions and
  captions during the call) and `screen` (a shared screen going into the notes). Each is `on`, `paused`, `off` or
  `unavailable`, with when it last changed (`since`) and who changed it (`by`: the call's schedule, or the
  organizer by name). Recording and the transcript follow notes. The notes model reads what was transcribed for
  as long as there is some, so `ai` stays `on` while notes are off once they've been on, and only a pause stops
  it. `screen` is `off` unless a share its presenter put in the notes is going, and then follows notes: on, paused
  with them ([Shared screens](#shared-screens)); presenters' own browsers record their shares, so it doesn't depend
  on what the host's browser can capture. `mode` says it in one word: `on`,
  `paused`, `off`, or `unavailable` when notes are on but the host's browser can neither record nor listen.
  Capture runs in one place, the browser of whoever hosts (the organizer's, or a stand-in's:
  [Host hand-off](#host-hand-off)), and the server enforces it on the audio and transcribe routes, which only the
  connection that hosts may use; shared screens come from each presenter's own browser. Only the organizer changes
  what's captured, standing in or not.
- **Unavailable.** The host's browser says what it can't capture (`{type: "unavailable", parts}`, whoever hosts
  only): the recording when the recorder couldn't start or failed (without a microphone of the
  organizer's own it still records everyone else), the transcript when the browser can't run the audio worklet
  it listens through. While notes are on, those parts are `unavailable` for everyone, and when it's both, `mode` is too
  (the sign says **Notes unavailable**, in caution). It's forgotten with every change to notes and when a new
  host connection takes over (joining from another device, or moving there), and one that arrives while
  notes aren't on is ignored, so the browser says again and nobody is told something isn't captured when it is.
  Both parts are also unavailable while the host's browser is out of the call (`away`: LiveKit says its
  connection left, and neither it nor another hosting connection is there yet), and the sentence
  says so: "Art's browser isn't in the call right now, so nothing is captured until it's back". So is every open
  breakout room's transcript (`CaptureState.room`), and a room's gaps include the part of an `offline` stretch while
  it was open.
- **Who sees it.** Everyone in the call, and anyone reconnecting, gets it with the call. People asking to join
  and anyone reading the card get it without names: `by` says only "the organizer", and there are no gaps or
  asks. Every change sends the room a change push, so browsers fetch the call again.
- **Running out** (`capture.runningOut`, `capture.stopped`). Notes are paid for from the organizer's AI allowance and
  storage, so when what's left would last about 5 minutes at this call's pace the organizer alone is told, once
  (`runningOut`), and when either is spent notes go off for everyone as if the organizer had turned them off, and
  everyone sees **Notes have stopped** until they close it (`stopped`, with its reason, `notes` or `storage`). The call
  goes on, and what was captured until then still goes into the notes. A call also ends at `CallState.endsAt`, 10 hours
  after it started, with everyone told 5 minutes before, and takes at most 100 people
  ([Plans and usage](plans-and-usage.md#running-out-in-a-call)).
- **Pause** (`{type: "pause"}`, only while notes are on) stops every kind of capture at once. The one gate every
  capturing path goes through, `mayCapture` in `apps/api/src/features/calls/capture.ts`, refuses audio pieces, speech
  clips, caption translations, catch-up and questions with `409 conflict` ("Notes are paused…"), whoever sends
  them, and refreshes no live notes, so nothing new is recorded, transcribed or sent to the AI; pieces of shared screens' video are refused too. The
  organizer's browser holds everything as it sends the pause: the recorder and every voice stop, and nothing they
  have is sent. Once the server has paused, what they held is dropped rather than flushed, and a `409` from a
  later upload is dropped too; a presenter's browser stops recording its share and drops its unsent video as
  soon as it sees the pause. If the pause fails, notes are still on, so the same recorder and voices carry on and
  send what they held: the recorder's pieces stay in order, and no segment restarts from piece 0. While it's on
  its way, the organizer's sign says **Pausing…**; that's the only in-between state, since the server changes the
  call's state in one step and everyone else sees it change at once. What the server took before the pause
  stays: a piece or clip that got through the gate before the pause was saved is kept (a clip still being
  transcribed lands in the transcript, before the pause). Notes off is the same for audio and speech, and live notes stop refreshing, but
  catch-up, questions and captions still read what was transcribed before. Turning notes off sends the last
  audio and speech first; if it fails, the same recorder carries on.
- **Resume** (`{type: "resume"}`) is the organizer's choice and nothing else's: not a reconnect, not a reload,
  not a breakout room, not a new organizer connection (another device, or a move to one), and not a hand-off: whoever takes over
  does so with notes
  still paused (or off).
  Resuming starts segment `n+1`, and so does turning notes on.
- **Gaps.** Every stretch with nothing captured (notes off, from the start until they first come on, paused, or
  `offline`: notes on, but the host's browser out of the call until another connection hosted (the organizer's,
  or a stand-in's) or the call ended, "Host offline 10:20–10:21") is a gap: when it started and ended, and where it falls in the recording (`at`, at the end of the segment
  before it, as transcript lines are placed). The call (`capture.gaps`), a catch-up (`CatchUp.gaps`, the ones in
  or after what it read) and the finished note (`Note.gaps`) carry them; the transcript and chapters say
  "Paused 10:02–10:05" in their place, and the notes model reads a `--` line there and is told never to guess
  what was said in it. Changes are kept to a tenth of a second, so even a short pause shows. Lines stay inside
  their own segment: one placed past the end of its segment's audio (its last pieces were dropped by a pause)
  goes at the segment's end, so nothing said before a pause comes after it.
- **In breakout rooms.** Each open room has its own capture state, for the people in it and for the organizer
  while it's visiting (`capture.room`, beside the call's). A room is never recorded. It captures (what's said there
  transcribed by the room's scribe, read for the room's live notes, catching up, questions and captions in the room, and given to the
  call's notes as the room's section) only while the call's notes are on and the organizer hasn't paused the room.
  Its `transcript` part is unavailable while the room has no scribe, and `capture.room.scribe` says whose browser
  it is (null while there's none). The
  organizer pauses the room it's in, or carries on there, from the notes sign (**Pause notes here**,
  `{type: "rooms-pause", roomId, paused}`; pausing needs notes on). The call's notes don't change, only that room
  is told (a notice for its people alone), and the organizer sees **Notes paused** on the room's card in Rooms.
  The capture gate, asked for the part of the call something comes from, refuses speech placed in a paused room
  and catching up, questions and captions asked from one ("Notes are paused in this room…"). The scribe's
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
  browsers. Shared screens are captured only as the video a presenter's own browser records of a share they put in
  the notes, while notes are on. Apart from the notes, anyone who can edit a board open in the call can put a picture of someone else's share on it,
  from their own browser, whatever the notes do ([Put on the board](#put-on-the-board)). The earlier pictures of a share a
  viewer can step back through stay in that viewer's browser's memory and go when the share stops; none are kept while notes
  are paused ([Looking closer at a share](#looking-closer-at-a-share)).
  Nothing stops someone recording their own screen or speakers. The live transcript and caption translations
  last only until the call ends; the audio, transcript, kept shares' video, the frames read from it and what was read on them, and the
  notes (every revision of them, corrections included) stay in the organizer's vault until the organizer deletes
  the note, and deleting is physical. Whoever schedules a call can have it keep less
  (`MeetingInput.choices`, which everyone sees on the call's card): without the recording, the audio still uploads,
  since it places what's said, and it's deleted when the call ends; without the transcript, it's used to write the
  notes and deleted when they're written, every breakout room's included
  ([Notes and inference › What's kept, and for how long](notes-and-inference.md#whats-kept-and-for-how-long),
  [Privacy › Deletion](privacy-keys-and-sessions.md#deletion)). Capture says recording either way, which is true
  while the call runs. Paused stretches capture nothing, so there's nothing of them to keep.

## Shared screens

Call media is end-to-end encrypted, so LiveKit never sees a shared screen, and the API sees only what a presenter
chose to put in the notes. Each presenter says, for each share, whether it goes in the notes; their own browser
records the shares that do and sends the video in pieces, which the API seals as they arrive, as it does audio.
After the call, once the share's tail is over, each share's pieces are joined into one video the note's player can seek, and the notes read it
where what was said points at it ([Notes and inference › Shared screens](notes-and-inference.md#shared-screens)).
Code: `apps/web/src/features/call/screen-sharing/screenRecord.ts` (the recorder), `ShareScreenStep` in `@alcove/ui` (the question),
`apps/api/src/features/recordings/screens.ts` (storage, video and analysis), `apps/api/src/features/recordings/ffmpeg.ts`.

- **Asking the presenter.** While notes are on or paused, and the call's `allowScreens` choice (**Read shared
  screens** when it's scheduled, on by default; `CaptureState.allowScreens`) lets shares go in the notes, the share
  steps ask **Include this share in the
  notes?**, already answered, so the share button never waits: **No** to begin with, then the presenter's last answer
  in this call (`ShareMenu` keeps it while the call screen is open, so **Change** and a try after a refused one start
  from it). A share goes in the notes only after a deliberate **Yes**. Each share carries the answer as it stands when it
  starts (**Change** included: something else shared is a new share), and it's never asked with notes off or in a
  breakout room, where nothing shared is kept. Once the browser's own picker has returned, the browser tells the call:
  `POST /v1/live/calls/:id/shares {notes}`, answered with `{share, keep, state}`. `share` is a new random ID for
  this share; `keep` is whether it goes in the notes: what the presenter said, with notes on or paused, the call reading shared screens (asking with it off is refused,
  409), and the
  presenter in the main room. Asking for the notes while they're off is `409 conflict` ("Turn on notes first"), as
  is a call that has ended; someone not in the call is `403`. A share of theirs still going ends first: each person
  shares one screen at a time. 30 starts and ends a minute per person (`503` past that).
- **What everyone sees.** `CallState.shares` lists the shares going now, `{id, participant, keep}`, so every
  browser shows **Read for the notes** (the recording dot, with that tooltip) on a kept share, the presenter's own
  included. `capture.screen` is the call's word for it: `on` (or `paused` with notes) while a kept
  share is going, `off` otherwise, with each change kept to a tenth of a second and the recording's segment in the
  call's sealed state (`screenHistory`); the card, the join page and someone waiting see it without a name. The
  call remembers its latest 200 shares (whose, kept or not, when each started and ended), dropping the oldest
  ended ones first.
- **Calls already running at deployment.** The previous release's sealed `notes.screens` history and ended-share
  boundaries are read into `notes.frameCapture` (default `null` for other calls), so a save of a still-live call
  preserves the frames it already captured. At call end, `recordings/storedFrames.ts` places those existing
  `screen_frames` on the recording timeline before the notes are queued. The writer reads those frames alongside
  any video captured after deployment; their original share-end, capture-stop and pause boundaries still apply.
  Record keys, headers and frame rows remain the same, and the removed frame-upload API stays removed.
- **Which model reads them.** The same model that writes the notes. The organizer chooses on the capture panel
  (**Notes written by**, `{type: "model", model}`, the organizer's only, `null` for the default model), starting
  from their default in Settings (`Preferences.model`). It is kept in the call's state (`notes.model`) and shown
  in `CaptureState.model`, with `CaptureState.modelPrivate` saying whether it is private; the card, which sees
  no name, gets only `modelPrivate`. The choice goes into the note when the call ends, and can be changed when the
  notes are written again. The call's own AI (catching up, live notes, questions, caption translation) uses it
  too ([Notes and inference › Choosing the model](notes-and-inference.md#choosing-the-model)).
- **In the presenter's browser.** While a kept share is going, notes are on, the call is live and the presenter
  isn't in a breakout room, `ScreenRecorder` records a copy of the share's video track, slowed to 5 frames a
  second, with `MediaRecorder` (WebM, VP9 where the browser records it, else VP8, at about 400 kbps), handing over
  a piece every 5 seconds. It is recorded from the moment it starts, but held in the presenter's browser:
  nothing is sent until it has been up 10 seconds, and a share that ends sooner is dropped, so a window picked by
  mistake never leaves the browser (as Google Meet and Teams do). Each recording is one share in one segment of the call's
  recording: one continuous stream, numbered from piece 0, each piece placed where it starts in the segment
  (`at`, from when this browser saw the segment begin, or from when the call says it began for one already going
  when the page opened), on the same timeline as the audio. What everyone sees is untouched. Pieces go up in order;
  while the connection is down or the server busy, a piece keeps trying for up to two minutes, and one that still
  can't go says so in the Notes panel. Pausing, notes going off or leaving the call stops the recorder at once and
  drops what wasn't sent; going to a breakout room stops it after sending what it recorded. Resuming starts a new
  segment, so a new recording of the same share.
- **The request.** `POST /v1/live/calls/:id/shares/:share/video`, the piece as the body with its type
  (`video/webm` or `video/mp4`, codecs allowed) and its place in `x-alcove-segment`, `x-alcove-seq`,
  `x-alcove-at-ms` and `x-alcove-duration-ms`. A piece over 4 MiB (`MAX_VIDEO_PIECE_BYTES`) is refused from its
  `content-length` before it's read; 60 pieces a minute per person (`503` past that). Then, in order: the sender
  must have been let in (`403`; someone who has left can still send their share's tail); the share must be one the
  call knows (`404`) and the sender's own (`403`); it must
  have a row with the recording (`403`: started before notes were ever on). A piece already stored at that place
  is a retry and is answered as stored, whatever has happened since. Otherwise the share must still be kept (`403`:
  the presenter said no, or notes went off), the capture gate's `screen` path must allow it (`409` while notes are
  paused or off), the piece must be in the recording's current segment (`409`: from an earlier one), and LiveKit
  must list a screen the sender is sharing in the call's room (`403`; what LiveKit said is kept for 10 seconds, and
  `503` when LiveKit can't be asked). A share's pieces together can't be more than 250 KB for each second since it
  started, plus 30 seconds' worth (about five times what a browser records), so nobody fills the organizer's storage
  under one share (`409`). A different piece at a place already stored is `409` too, never dropped as if it were
  stored. The answer is the call's state.
- **The tail.** A share that has ended, or whose call has, still takes pieces of the segment it ended in for 20
  seconds after it ended (`SHARE_TAIL_MS`; its end in the call, or when the recording stopped if that's earlier),
  since the browser hands its last piece over as it stops, as the presenter leaves, or as the call ends; after that
  it's `404`. A presenter who has just left sends it too, and once the call has ended their pass still works for this
  request alone (only the organizer's works for anything else); either way the answer says only that they're out. The notes worker waits until 20 seconds after the last kept share
  ended before it joins the video. A piece is stored holding its share's row (`FOR SHARE`), and refused (`404`,
  its object deleted) once that share's video in its segment is joined; joining locks the row (`FOR UPDATE`) and
  counts the pieces again, and joins once more if more came in meanwhile. The browser drops a piece refused with `409`, and stops recording a
  share refused with `403` or `404`. What this proves is that the sender is the presenter who started that share,
  said it goes in the notes, and has a screen up in the call: the API can't see what's on it, so the video is the
  presenter's browser's word. A modified browser could send any video under its own kept share while it shares a
  screen, which is no more than it could show everyone, and no more of it than the share's byte budget.
- **Sealed as it arrives.** Each piece is sealed under the recording's key, like audio (record kind
  `screen-video`, binding the recording, the share, the segment, the piece and the object), written under a random
  object name, read back and checked, and only then recorded in `screen_pieces` with its place, length and type.
  Whose share it was, and who they are as the notes name speakers, is sealed in its `screen_shares` row
  (`screen-share`, under the state key `screen-share:<recordingId>`), with whether it's kept and when it started
  and ended in the clear (milliseconds into the call, and the segment then).
- **When a share ends.** The presenter's browser sends what it recorded (waiting up to 10 seconds for the last
  pieces), then says so: `POST /v1/live/calls/:id/shares/:share/ended`, their own share only (`404` for one the
  call doesn't know, `403` for someone else's), and ending one again changes nothing. A presenter's connection
  leaving the call (they leave, are removed, or a new connection of theirs takes over), or moving out of the main
  room, ends every share of theirs on the server, so a share whose browser couldn't say so still stops there. So
  does the call ending. Turning notes off makes every kept share going not kept, and ends it in the notes; it
  carries on for everyone, and sharing again with notes on asks again.
- **Into replay.** Once the share's tail is over (`SHARE_TAIL_MS`), `screens.joinDue` joins on its own, whether or not the notes service is configured: the call ending (or the recording stopping) sets a timer for the tail's end, and maintenance joins any left in pieces. The notes job joins too, before it asks the notes model or counts attempts; in one instance they take turns for each recording, holding no database connection while they wait, and when two instances join at once the first video kept stands and the other is let go. Replay is there shortly after the call and before the notes are written (the progress step `Shared screens ready to replay`). Each kept share's pieces in each segment are joined into one video a
  browser can seek (`finishVideo`: ffmpeg, pipes only, copying the stream, with an index and duration added for
  WebM), sealed in chunks of at most 4 MiB (`screen-video-chunk`, binding the chunk and how many there are) into
  `screen_videos`, and the pieces are deleted, in one transaction with the chunks' rows, so a join that stopped halfway
  carries on. A share whose pieces won't join (ffmpeg can't read them, or one fails its integrity check) has them
  deleted, since they'd fail the same way at every try, and is left out of replay; the object store failing fails the join instead, and the next try (the notes job's retry, or maintenance) carries on. `Note.shares` lists each kept
  share with video: its label ("Priya’s screen", then "Priya’s screen (2)"), whose it was, and where each segment's
  video falls on the recording's timeline (`at` to `until`, kept inside that segment's audio); it's empty until the
  video is joined. The video is at `GET /v1/notes/:id/screen/:share/:segment`, for anyone who has the note and only
  for kept shares with video in that segment (`notes.videoAccess`: the note's access check and one query, without
  opening the whole note, since a player asks for many ranges), with one byte range at a time (`206`, `416` for one it can't serve), opening only the chunks
  a range needs, with `cache-control: no-store`. The note's player keeps the audio as its clock and a muted video
  follows it, put back in step when it drifts more than 0.3 seconds; with two shares at once it shows the one that
  started last, with a chip for each. The stage follows the video element's own events: while it loads, seeks or waits
  for more data for over 300 ms it says it's loading that share, and an element that errors says this part couldn't be
  played, with **Try again** (the element loads again; the failure is logged with the share and segment). Where no
  share in `Note.shares` covers the moment, which is also where a share that wasn't kept (not put in the notes, in a
  breakout room, under ten seconds, or not joined) would have been, the stage says **No shared screen in the notes
  here** and offers the nearest four shares, each a press that moves the playhead to its start.
- **Breakout rooms.** What's shared in a room stays in the room, like what's said there: a share started in one is
  never kept, the browser doesn't record while its presenter is in one, and leaving the main room ends the
  presenter's shares there. The main room's shares are kept while rooms are open.
- **Catch-up** doesn't read screens yet ([Notes and inference › What's left](notes-and-inference.md#whats-left)).
- **The organizer stops a share** for everyone (`share-stop`, by the person's `seat`, which holds across their connections):
  the API asks LiveKit for that seat's share tracks, its picture (`SCREEN_SHARE`) and its sound (`SCREEN_SHARE_AUDIO`) on any
  of their connections, with nothing of the call held, and mutes each through the room service that mutes a microphone, which
  never unmutes. Then, under the call's row, everyone in the part of the call it was shared in, but the organizer's own
  connection, gets a `people` notice: "Art stopped Priya’s share." (first names, as the call names them); the organizer's
  browser says it in its own words. It's the organizer's alone (`403` for anyone else, a stand-in included), `409` "They
  aren’t sharing anything." when that seat shares nothing LiveKit hasn't muted already, or isn't in the call, and, like every
  organizer control, `409` from a connection that doesn't host. LiveKit sees which tracks are shares, never what's on them,
  and the log has how many were muted, never whose.

## Pointing at shared screens

People in a call can point at what someone shares and leave marks that fade, so "this, here" is easy to say
(`apps/web/src/features/call/screen-sharing/marks.ts`, `SharePointing.tsx`, the wire format in `packages/api/src/calls/marks.ts`). Pointers
and marks go from browser to browser, end-to-end encrypted: nothing of them reaches the API, nothing is kept anywhere,
and nothing reaches anyone's computer but a picture drawn over the share on their own screen. No input of any kind is
ever sent to the presenter's computer.

- **Who may point.** Anyone let in, at any share on their stage, while the organizer allows pointing for the call
  (`CallState.pointing`; `{type: "pointing", on}`, the organizer's only, on until they turn it off, each change a notice for
  everyone) and the share's presenter lets others point at it (`CallParticipant.othersPoint`; `{type: "others-point", on}`,
  anyone in the call about their own shares, kept by person so it holds across their reconnections and moves to another
  device, 20 changes a minute per person). A presenter can always point at their own share. Both live in the call's sealed
  state, the server checks who may change them, and every browser enforces them on what it sends and on what it takes: marks
  from someone the presenter doesn't let point never show, whatever that person's browser sends. Turning either off takes
  the pointers and marks it covers away at once, everywhere. Everyone may point by default because in a working call
  pointing is how people talk about what's shared; a presenter keeps their screen to themselves with one switch in their
  share's name menu, **Others can point at it** (a demo, something sensitive), and the organizer turns it off for a large or
  formal call from People.
- **On screen.** A pointer is an arrow with its owner's face in the arch and their name beside it, never told apart by
  colour alone. A click leaves a ring and a drag a line, named the same way (at a ring, and where a line starts). Marks
  last 8 seconds (`SHARE_MARK_MS`), fading over the last 1.5. A pointer's browser says where it is up to 20 times a
  second while it moves (`SHARE_POINT_EVERY_MS`), once a second while it's still, and stops after 6 seconds without
  moving; a pointer nothing has been heard of for 2.5 seconds goes. Its author takes their last mark back (Undo in the
  pointing bar, or Backspace), and the presenter clears every mark on their share (**Clear marks** in its name menu).
  Everything goes when the share stops, its author leaves the call or your part of it, you move to another part of the
  call (sent to a room, back to the main room, moved, or, for the organizer, visiting one), the room disconnects, or
  pointing is turned off; someone else coming or going takes only their own pointer and marks with them. The marks on a
  share go when its presenter changes what's shared, since they were about the old picture. On a phone, a tap leaves a ring and
  a drag a line; there's no pointer to hover with.
- **Where marks land.** Every place is a fraction of the shared picture, 0 to 1 across and down ([the coordinate
  model](#looking-closer-at-a-share), `shareFrame.ts`), so a mark lands on the same spot of the picture on a phone and on a
  wide screen, however each viewer has framed it. The drawing sits on the picture's own box, in parts of it: on a share
  someone looks at closer it's inside the box `place` gives for their framing, so it moves with every zoom and pan and
  glides with the picture; elsewhere it's the box the video shows the picture in (`place` with the whole picture,
  letterboxed in its frame). Rings and lines keep their size on screen at any zoom. A press goes the other way, through the
  viewer's framing (`toShare`). A picture held still (frozen, or an earlier one) shows no pointers or marks, as they're
  about the live picture, and holding one ends your pointing; a share in its own window shows them, and you point in the
  call. A message names its share by the picture's LiveKit track sid, which no later share has: a message about a share that
  stopped, or one this browser doesn't show, lands nowhere.
- **Keyboard.** On a share on your stage and live, with its frame focused, L (or **Point at it** in its name menu) starts
  pointing. The arrow keys move your pointer (with Shift, further), Enter or Space leaves a ring, Backspace takes back your
  last mark and Escape stops. While you point, the arrows move your pointer rather than around a zoomed picture; +, −, 0, F,
  comma and full stop still frame the share, and so do its bar, the wheel and a pinch. A drag draws rather than moving the
  picture.
- **Breakout rooms.** Pointers and marks stay in the part of the call they're made in. Each part has its own MLS
  group, so what's sealed in a room opens only with that room's keys. A browser also takes them only from the people
  in its own part, about shares it shows (a room's shares are shown only in the room), and drops them all when its
  part changes; between two parts it has no key to seal with, so it sends nothing.
- **Never captured.** Pointers and marks are drawn in each viewer's browser, over the video. They aren't in the shared
  picture, so a presenter's browser never records them for the notes ([Shared screens](#shared-screens)), and
  nothing adds them. The only way one reaches a frame is the presenter's own screen showing it: someone sharing a whole
  screen with the call's window on it shares whatever that window shows, marks included, like anything else on that
  screen. The notes don't link marks to what was said.
- **The presenter's view.** Marks show on the presenter's own share on their stage as well. A web page can't
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
  database write, a change push through LiveKit and a read by every browser), took a median of 103 to 153 ms there, and
  would load the API and database with every move. Pointers glide between places (90 ms), and lines go out at most
  every 80 ms as they're drawn.

## Reconnects

- **A short drop.** LiveKit resumes the connection, or reconnects it under the same identity, and the top bar
  says **Reconnecting** meanwhile, for a dropped signalling connection too (that's how most drops start; LiveKit
  calls it `SignalReconnecting`). The call keeps up over HTTP as before. On coming back, and also as soon as it
  first connects to the room, the browser fetches the call and its log again: a change push sent while it was still
  connecting reached a room it wasn't in. That was why, after the organizer reloaded, everyone's camera looked off
  for a while: the others' fresh key packages arrived while the organizer's new page was still connecting, so it
  waited for its next check (up to 6 seconds, longer on a slow join) before letting them into its new group. Now
  they're in within about two seconds, and until then their tiles say **Connecting**.
- **Taken out while away.** A connection gone for longer than LiveKit waits (about 15 seconds without an answer)
  is taken out by LiveKit's `participant_left` webhook ([Group calls](#group-calls)), and the host's browser
  takes it out of the group, so the keys move on. If that browser is still there and comes back, it comes back in
  as it is: its log read says `admission: "out"` (it left by nobody's choice: not removed, not turned away, and its
  place not taken by another tab or device), so it lets go of the groups it held and asks
  `POST /v1/live/calls/:id/mls/back`. That puts it back as the same connection and person (seat, hand and all), in
  the same part of the call, with a fresh 90 seconds to reach the room; the log then asks it for keys, as for anyone
  on their way into a group, and the host's browser adds it to that part's group (a breakout room's included).
  Its time in before the drop is kept as a stretch of its own (`earlier`), so its time away stays time away: a guest
  reads nothing said then, and catching up "while you were away" finds it ([Notes and inference](notes-and-inference.md#catching-up-during-a-call)).
  Until the host's browser has taken the old connection out of its group, `mls/back` answers `409` and the
  browser asks again a few seconds later. Someone removed, turned away or replaced gets `admission: "denied"` and stops. Chat sent while it was out
  stays unreadable to it, as for anyone let in later.
- **The host away.** Notes are written from what the host's browser hears, so from LiveKit's `participant_left`
  for the connection that hosts (it dropped, is reloading, or is moving) until it or another hosting connection is
  there, the capture state says so for everyone and on the card: recording and transcript `unavailable`, `away`
  set, the sign **Notes unavailable** ([What's captured](#whats-captured)). The webhook sends the room a change push both ways,
  so screens change at once. If the same connection comes back, its browser kept recording through the drop and
  sends what it held ([Call lifecycle](#call-lifecycle)), so nothing is marked; what others said meanwhile wasn't
  heard. If another connection hosts (a reload, another device, a move, someone standing in, or the organizer back)
  or the call ends first, the time from the old one leaving is an `offline` gap after the segment it was
  recording: in the transcript, catch-up and notes, and breakout rooms are placed in the recording without it.
  Nothing turns notes, a microphone or a camera on that was off, and a pause outlasts all of it.
- **The old tab.** Joining from another tab or device takes over without asking the old tab, which may still be
  recording, and so does someone else hosting. The server tells a connection that hosted before `409` ("You're not
  hosting this call from here any more") for anything only whoever hosts or the organizer may do, audio and speech
  included, so it stops trying at once instead of retrying a refusal; once its screen learns the call went on
  from elsewhere it drops what the recorder and voices hadn't sent (the server would refuse it) and leaves. A
  move lets go first instead: the old device sends its last audio and speech before the new one takes over.
- **Nobody twice.** A reload, a comeback and a move each keep one person: a new connection of someone who was in
  takes the old one's place (left and replaced), never a second seat. While the host's browser takes the old
  connection out of the group, `CallState.leaving` names it, with that person's connection now (`now`), so screens
  show it as who it is, and not at all once they're back on another connection, rather than as "Someone". Audio
  pieces and transcript clips are idempotent by their place (and, for clips, whose they are), so nothing sent again
  is kept twice; a moved organizer's recording goes on in a new segment. Notices already shown aren't new to the
  screen that showed them; a new device shows the latest once.

## Moving to another device

Someone in a call moves their place to another device (a laptop to a phone, say) from **More › Move to another
device**: `apps/web/src/features/move/` and `apps/api/src/features/calls/moves.ts`.

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
   case it didn't get there, and out of the call, so the host's browser moves the keys on without it. The connection
   that hosts (the organizer's, or a stand-in's) is counted gone from then, but nobody takes over and the call
   doesn't end while its new device can still arrive (two minutes): a move that runs out is a host gone like any
   other, handed on by the next upkeep, or ended if nobody can host ([Host hand-off](#host-hand-off)).
5. **In.** The new device comes in (`POST /v1/moves/arrive`) as the same person, with the identity and key package
   it sent: a guest or invited person the way a reload comes back (the same person, so the same seat and breakout
   room, name, role, raised hand and spotlight): a new connection in no group, which the host's browser adds to
   the group of the part of the call they're in, a room's included, and takes the old one out of, so nobody is
   counted twice. The organizer comes in as the organizer's new connection (a new key generation for every part of
   the call, host powers, back in the room it was visiting, and the recording on a new segment, as when they join
   from another device), and someone standing in comes in the same way, as a stand-in's reload does, still hosting,
   with nothing resumed: a paused call, or a room it paused, stays paused. It brings in
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

## Ringing

The organizer rings people into a live call, and each sees a card on whatever Alcove page they have open:
`features/calls/rings.ts`, `packages/api-http/src/rings.ts` and, in the app, `features/calls/Ring*`. It's for reaching someone
now, so it only works once the call is on: "Join and ring" is joining first, then `session.ring(emails)`.

1. **Who can be rung.** Teammates (the people `GET /v1/team` lists) and people invited who said yes to this call (their
   answer in `meeting_access`), by the organizer only, up to 20 at once and 20 times a minute. Being invited isn't
   enough: anyone can put any address on an invite, and a ring is the call's title on someone's screen. Everyone else
   gets one refusal that names nobody, whether or not they have an account or answered, so ringing can't be used to
   find out whether an address is on Alcove, online, or what it said. Someone
   already in the call isn't rung, nobody is rung into a locked call (`409`), and an invite that's full refuses the
   ring rather than leave someone rung who'd have to ask.
2. **The ring.** Everyone rung goes on the invite and the note's invited people (`features/meetings/invites.ts`), so they get
   the notes and come in without asking, whether or not they pick up. It's the same as for someone let in from the
   link: removing them from the call takes them off it, and the calendar event isn't changed. Each person has one
   ring per call in `call_rings`: ringing them again starts it over, with the same ID, whatever they said to it.
3. **Delivery.** `GET /v1/rings`, signed in, is a stream of newline-delimited JSON (`RingsSnapshotSchema`): everything
   ringing this person now, in full, on connecting and each time that changes. Each browser tab holds one, read by
   `api.rings.live()`, a `LiveStore`. One ticker per API process runs while anyone is listening, once a second, with
   one indexed query for everyone listening; only a stream whose rings changed reads any further, opening the
   organizer's keys to read the title and who's ringing from the call, and dropping them after. So a ring reaches its
   person within about a second, and a ring running out, or coming back, needs no request from anyone. Postgres is
   the only truth: an instance knows nothing another doesn't, so a ring taken by one is delivered by whichever holds
   the stream.
4. **Answering.** `POST /v1/rings/:id/answer`, found by the hash of the caller's own address, so for anyone else the
   ring doesn't exist (`404`). `join` and `no` end the ring at once. `in-5` and `in-15` put it off: it rings again
   then, for another 45 seconds, if the call is still on. Each tells the room, so the organizer's arch changes at once.
   An answer leaves every tab: this one straight away, others within a second. An answer that arrives after a ring ran
   out still counts, and the last answer stands.
5. **What the organizer sees.** `CallState.ringing`, for the organizer alone: each person rung who isn't in the call,
   as `ringing`, `coming` (said Join), `later` (with when they'll be rung again), `declined` or `missed`. That's worked
   out from the row each time the call is read, so a ring running out shows on the call's next read, within a few
   seconds. **Missed never means offline:** someone with no Alcove tab open, someone who ignored it and an address with
   no account at all look the same, and nothing else says which it was. Stop (`stopRing`) deletes the ring, card and
   arch; they stay on the invite.
6. **How it ends.** A ring goes when its person is let into the call, in the commit that lets them in, so an arch
   becomes a tile with no gap; when the organizer stops it; and with the call, in the transaction that ends it. One
   left in a call that runs for a day goes a day after it ran out. An account going takes the rings to its address
   with it.

**A demo account's rings stay among demo accounts.** Single sign-on checks nobody, so a ring never reaches a real
account from a demo one, whose name and address could be anyone's, nor a demo account from a real organizer, as with
notes. It's filtered at delivery and on answering, never when ringing: the organizer sees only that nobody answered.

**How many.** Streams are counted as they stand, not as they open, since each holds a request for minutes: an account
holds at most 8 at once and a process 300, out of the 1,000 requests an instance serves. Past either limit,
someone with a stream gives up their oldest, likeliest a tab that went without the server hearing, so a tab coming back
always gets in, and a tab still there opens another. Someone with none, on a full process, gets `503 unavailable`, and
their browser tries again, more slowly each time.

**The stream.** It ends after about 4 minutes (`RING_STREAM_SECONDS`: 210 to 240 seconds, so streams that opened
together don't end together), under Cloud Run's 300-second limit, and the browser opens another within a second, or
backs off to at most 30 seconds while the API can't be reached. Each line says everything, so reconnecting shows the
right thing with nothing to replay. The server repeats itself every 20 seconds, so a browser that hears nothing for 50
gives up and opens another: a laptop waking up can hold a connection that's dead without knowing it. A stream keeps
the person's owner ID, the hash of their address, whether it's a demo account and the session's hash: never their
keys, which go when the request does. It holds no database connection while idle, and it's released when the browser
goes. It lasts no longer than its session: before sending anything new it checks the session is still there, so
someone who signed out, or deleted their account, gets nothing more. A process shutting down ends its streams, so they
don't hold up the shutdown, and each browser goes to another instance.

Rings past their time also drop by a timer in the browser, so a card doesn't outstay a dropped stream. That timer trusts
the server over the browser's own clock: a ring the server just sent is ringing, so a clock that's wrong can't hide it.

**When Alcove isn't in front.** A tab that shows the card also raises a browser notification that names nobody, once
browser notifications are on and allowed and rings are ticked (`features/calls/ringing/RingAlert.ts`; see
[Browser notifications › Rings](browser-notifications.md#rings)): one per ring, closed when the ring ends.

**What it can't do.** Reach someone with no Alcove tab open: there's no Web Push.

Rings are rows in `call_rings`, in the organizer's vault, found by a keyed hash of the address (blind index purpose
`ring`). The address and the answer are sealed as a `call-ring` record bound to the meeting and the ring;
`deliver_at` and `expires_at` are clear, so the ticker can read them. What that shows is in
[Privacy, keys and sessions › What is still visible](privacy-keys-and-sessions.md#what-is-still-visible).

## Hands, spotlight, breakout rooms and captions

- **Raised hands** are call state, one per person (`{type: "hand", up}`): anyone in the call raises or lowers
  their own, and everyone sees it (`CallState.participants[].hand`). It stays up across a reload, a dropped
  connection that comes back, and a move to another device: it's the person's, not the connection's. Each raise is an
  entry, in the order they went up (`CallState.attention.hands`): People lists hands first in that order, and whoever
  hosts lowers one by its entry (`{type: "hand-lower", entryId}`), so an older press can't lower a newer raise.
- **Nudges** (`{type: "nudge", to, kind}`, `kind` one of `muted`, `cant-hear`, `slow-down` and `louder`): anyone in the
  call, to someone else in their part of it, by participant ID. Only the person nudged is told: their read alone carries
  it (`CallState.attention.nudges`), one note for each kind with how many sent it within a minute of the first, and who
  while that's one person; the same sender again within that minute changes nothing. Nobody else's read has it, whoever
  hosts included, and only the recipient's browser is told to read the call again. Notes go a minute after they last
  changed, when their recipient leaves on purpose or changes rooms, and once their connection has been gone for two minutes
  without leaving. The browser says each note once, as a toast, and again with the new count (`session/nudgeAlerts.ts`);
  its **Unmute** only ever unmutes.
- **Statuses** (`{type: "status", status, minutes}`, `status` one of `away`, `listening` and `phone`, or null to clear
  it): anyone in the call sets their own, for everyone (`CallState.participants[].status`, with `since` and `until` on the
  server clock), until 2, 5 or 10 minutes from then, or with no `minutes` keeping a time already set. It stays through a
  reload and a room move, and goes when its time runs out, when they clear it, when they leave on purpose, or once their
  connection has been gone for two minutes without leaving. Their browser clears it once they talk with their microphone
  on (`layout/status.ts`, with the call's one talk detector, `useTalking`). Both are sealed in the call's attention
  record ([Privacy, keys and sessions › Attention during a call](privacy-keys-and-sessions.md#attention-during-a-call)).
- **Spotlight** (`{type: "spotlight", participantId}`) is the organizer's, and only names someone in the call;
  it puts that tile first on everyone's stage, and goes with that person to a new connection (a reload, a move).
  Opening breakout rooms ends it.
- **Breakout rooms** (`{type: "rooms-open", rooms: [{name, emails, seats}], minutes, board, visit}`, `rooms-message`,
  `rooms-rename`, `rooms-move`, `rooms-close`) are the organizer's. Two to eight rooms, and anyone in the call can be
  sent to one, each to one room: someone invited by address (`emails`), so they land in their room from any device, and
  anyone else, a guest with the link, by seat (`seats`, as `CallParticipant.seat` names them), kept in the sealed call
  state as their `person`, with the name they're in the call under (`HeldRooms.guests`: seats are never stored). A seat
  names whoever has it, in the call or stepped out for a moment (a reload), and someone on the invite goes by their
  address all the same; the organizer's own seat, someone removed's, another call's and one nobody here has are refused
  (400). Guests go to rooms because nothing in the privacy
  model keeps them out: going into a room's group follows `placeOf` alone, whatever someone's role, and a guest sees,
  hears and chats in a room as in the main room. They still get no notes, and never transcribe a room (Each room's
  scribe, below), so a room with only guests in it isn't transcribed, which the setup says before it opens. Anyone can
  be moved to another room or back to the main room while they're open (`{type: "rooms-move", email, roomId}` or
  `{type: "rooms-move", seat, roomId}`, one of the two; `null` for the main room). `CallState.breakouts.open` carries the
  rooms (the invited people sent to each, `people`; the guests, `guests`, by name only, never an address, under their
  seat; and who of them is in the call now, by participant ID), `from` and `until` (seconds since the call
  started) and the latest message to every room. Each room is a part of the call with its own MLS group, so its
  own media keys and chat, and moving someone moves their keys
  ([End-to-end encryption](#end-to-end-encryption)). Rooms whose time is up close on the next read or action,
  and ending the call closes them too; a room closing deletes its MLS log. Closed rooms are kept in
  `breakouts.held`, each with its pauses, its scribes and everyone who was in it, and when the call ends each
  becomes its own section of the note ([Notes and inference › Breakout rooms](notes-and-inference.md#breakout-rooms));
  once the notes are written, each time rooms were open is also a chapter ("2 breakout rooms", who was in which
  room when they closed, a guest by name only, and for how long). A call or note stored before guests could be sent to a
  room reads its rooms with no guests (`guests` defaults to none), and is saved in the new shape the next time it is.
  Room names and messages stay in the sealed call state. The organizer visits one room at a time
  (`{type: "rooms-visit", roomId}`, `null` for the main room), and can start in one as the rooms open (`visit`, by its
  place in `rooms`; left out, they stay in the main room): while visiting, they're one of that room's `members`, and
  their browser sends, plays and chats with that room's keys, so that room sees and hears them and the main room
  doesn't.
- **Each room's scribe.** The host's browser hears the main room for the notes, and only while it's there; each open
  breakout room has a scribe of its own instead, one browser in the room that hears it (its own microphone and every
  other microphone it plays there, each on its own) and sends what's said there. The server picks it (`scribes.ts`,
  apart from who commits for each group): someone on the invite (never a guest with the link, though guests are sent
  to rooms too: a room's lines are only as trustworthy as its scribe's browser, and they go into notes for the people
  invited; nor whoever hosts), in the call, placed in the room and in its group, the one there longest. It keeps the
  room for as long as it may; otherwise the next one takes over, in the save that saw the change (someone leaving,
  moved, reloading, starting to host, or out of the room's group while its keys move on). Each term (connection,
  number, from, until) is kept in the sealed call state, the ended call's too, and a room's speech is taken only from
  whoever was its scribe when the speech began: a clip still on its way from the scribe before lands once, the next
  one can't send the same speech again, and two browsers never send one room. The main room's is taken only from
  whoever hosts now (`mainScribeOf`). A room nobody may scribe, one with only guests in it among them, hears nothing
  (its `transcript` part says unavailable).
  Everyone in a room sees whose browser it is, and the scribe is told when it starts. Ties for scribe go by what the
  server made (when someone came in, their seat's random person), never the ID a browser chose. A room's lines are
  only as trustworthy as its scribe's browser, which says who spoke each clip, as the host's does in the main room:
  the server checks that whoever it names was in the room then, not that it was their voice.
- **Hosting from inside a room.** When everyone invited is in a breakout room and the host's connection goes, a
  stand-in hosts from their room ([Host hand-off](#host-hand-off)). Whoever hosts hears only the main room and is
  never a room's scribe, so a stand-in in a room hears nothing for the notes: their room goes on with its own scribe
  (the next person there; a stand-in alone in a room leaves it unheard), and nothing hears the main room, whose
  recording is silent too, until rooms close or the organizer is back. Their browser says so
  (`unavailable`, so everyone in the main room sees the recording and transcript can't capture now; a room with a
  scribe still says it's on). The stand-in is told, in a toast and a lasting notice in the Notes panel, with **Bring
  everyone back** above the stage. The stretch isn't marked as a gap in the note.
- **What's said in a room stays in it, until the notes.** Every live transcript line is kept in the part of the
  call its speaker was in when they began saying it: the browser that heard it says how long ago each clip began
  (`x-alcove-ago-ms`), the server places it from where each person has been (`placeAt` in the places module), and
  a hearing browser ends the clip in progress when it moves, so no clip spans two parts. A room's clip is placed in
  the recording by the server's clock, since its scribe's browser counts from when it loaded. A line said while rooms are open
  also keeps who was in its part then. One rule, `readableBy`, decides who reads a line: the call's state,
  captions, catch-up, questions and caption translations show someone the lines said in the part of the call
  they're in now, and of those said while rooms were open, only the ones said while they were there. A room's
  lines stay sealed in the live transcript once it closes, read live by nobody (no part of the call is that room
  any more), until the call ends and they go into the note as the room's section, for everyone the notes go to
  (or, in a call set not to keep its transcript, for the organizer alone, until that room's notes are written).
  The organizer's notes recording hears silence while it's in a room and isn't recorded in any room, so the
  note's audio has none of a room's talk: a room's section has its words, never its sound. Each room has its own
  capture state, which the organizer can pause ([What's captured](#whats-captured)).
- **Captions in another language.** `POST /v1/live/calls/:id/translate {language, lines}` translates up to
  20 live transcript lines (by ID) for the person asking (anyone let in), through `drafting.translate`, which
  sends them to NEAR AI's notes model, checked and sealed like every request
  ([Verified private inference](notes-and-inference.md#verified-private-inference)). Each line and language is
  translated once and kept as a sealed `transcript_translations` row, tagged with a keyed hash of the line and
  language, until the recording stops; then they go with the live transcript. Lines that aren't in this
  call's live transcript, or that the person asking may not read, are left out. Like catch-up and ask, it keeps no idempotency receipt, it has its
  own rate limit (90 a minute per person), and it's refused while notes are paused. Captions themselves are only shown: turning them off hides the
  caption bar, and the call is still transcribed for notes while notes are on.


## The call's workspace

A call has one workspace, or none: where its notes and transcript go, in a folder of its own
([Data and storage › Workspaces](data-and-storage.md#workspaces)). Everyone in the call views and edits it together.
Nothing makes one by itself: a workspace exists only because someone pressed New workspace, in the Drive, in the call
(the organizer), or when scheduling (`meetings.create({ newWorkspace: true })`). What's done is
`apps/api/src/features/calls/workspace.ts`, what the call keeps of it is `space-state.ts`, and who can open what is
`workspaces/access.ts`, on every read: access is never copied into the call. Being in a call, or organizing it, opens nothing.

- **Its workspace.** The meeting's `workspaceId`, sealed in its manifest, default null. It's one the organizer chose when
  scheduling (one they can edit in), one made for the call when scheduling, or the one its series has. With none, the call has
  none: opening Workspace shows that, and the organizer picks or makes one (below). A workspace made for a call is named after
  it unless it's given a name, with the organizer as its admin and this run's folder at the top. A call's workspace is the
  organizer's to use only while they can still make things in it: one deleted since reads as none, and one they've lost, or
  with no room for the call's folder (a full tree), can't take the folder or a new board (`shut`, `full`).
- **Picking or making it.** Only the organizer, and someone standing in as host only hosts: anyone else is `403`, "Only the
  organizer chooses this call's workspace." `workspace-set` picks one where they have at least `edit` (a role of `read` is
  `403`; one they can't reach is the same `404` as one that doesn't exist); `workspace-new` makes one for the call
  (`madeFor`, with its series), named after it unless given a name. Either changes the meeting's `workspaceId` under the call's
  row, so it's the call's for this call and every later call of its series that had none, or had the one it replaced
  (`carryForward`, once the row is let go), and it ends what was presented and what was playing in the one before. `call
  workspace set` is logged, and `call workspace made` for a new one. Switching interrupts nothing else: nobody's keys move and
  nothing open closes. `GET /v1/live/calls/:id/workspace/:id` says what a switch would mean, for the sheet that asks: the
  workspace's name, and the first names of people in the call who aren't in it. It goes by membership alone, which the
  organizer can see from the workspace's people: someone with one document there is still named, because saying otherwise
  would tell the organizer about something they can't see. A stand-in hosts the call and doesn't choose its workspace.
- **Who's let in.** Only a workspace made for the call, or for its series, lets people in: everyone invited is let in to edit
  once the call's row is let go, and who's in it follows the invite (`followInvite`, below). A picked existing workspace lets
  nobody in: its people are its own, and anyone invited who can't open it finds it private and can ask (below).
- **In a series.** The next call scheduled takes `workspaceId` with it, and every call of a series scheduled to repeat
  starts with it. A call whose organizer picks or makes another moves the later calls that had none, or had the one it
  replaced, along; a later call someone gave a workspace of its own keeps it.
- **At the end.** A call with notes puts them in its workspace's folder for it (below). A call with notes and no workspace
  stays unfiled: nothing makes a workspace for it, its notes are in Notes, `call ended unfiled` is logged, and
  `CallEndResult.filed` is false (it's true when the call had no notes, or its notes are in a workspace), so the page after
  the call asks its organizer where they go. `meetings.file(id, { workspaceId } | { newWorkspace: true })`
  (`POST /v1/meetings/:id/file`, `fileNotes`) files them: one of the organizer's workspaces they can edit in, or a new one
  made for the call, with everyone invited in it. This run's folder goes at the top with its note, and it's the call's
  workspace from now on, and its series' later calls'. It's the organizer's, on their own calls: `409` for a call that isn't
  over ("This call isn't over yet."), has no notes ("This call has no notes to file."), or has a workspace already ("These
  notes are in a workspace already."); `409` for a workspace with no room ("That workspace has as many things in it as it
  can hold. Pick another, or make a new one."); `404` for a workspace they can't reach. `call notes filed` is logged.
- **Deleting it.** Admins delete a workspace from the Drive row's menu, the workspace's own menu and the call's Workspace
  frame menu (`api.workspaces.remove`). A call whose workspace was deleted has none until its organizer picks or makes
  another, and notes it had are in Notes, to file as above. There are no read-only or frozen workspaces: a plan limits
  storage only ([Plans and usage](plans-and-usage.md)).
- **`CallState.workspace`** is per viewer, worked out on every read: `id` (the call's workspace), `chosen`, `name`,
  `chosenBy`, `canOpen`, `role`, `documents`, `agenda`, `present`, `ended`, `play`, `asks`, `asked`. `chosen` says the call has a
  workspace, whether or not this person can open anything in it. Someone who can open nothing gets `id` and `name` null: private, and
  nothing that names anything, `present` and `ended` aside (below). Someone with one document has the `id` to open it with and no name.
  It's computed only for a call that has something to show, and a workspace that can't be read reads as private: nothing
  in one can stop anyone reading the call. Someone waiting to be let in gets nothing at all.
  - **What a read costs.** What it needs of a workspace's tree, its name and what's brought, presented and played, with who
    can open each, is read once for each version of the workspace, for everyone reading the call, and kept by ID until the
    version moves on, as each update typed is checked (`editableBy`): a read by someone in it costs a small query for the
    version and two for who holds what, two more for whoever started what's showing, and a tree is opened once a version
    however many read at once. Who holds what is read afresh every time. Someone with nothing in it has nothing of it read for them: they're told only that something's
    being presented, and by whom, so a read costs them the same whatever's going on there, and how long it takes says
    nothing about a video they can't see.
- **What's brought to the call** is `Meeting.documents`, the one list, kept as `<workspace>.<item>`. `workspace-bring`
  adds a document in the call's workspace, or takes one off, for anyone who can open it, up to 12. `CallState.workspace.documents`
  says which of them this person can open, wherever they are, by the name they have now; one in Trash isn't listed.
- **Asking.** Someone who can't open it asks (`workspace-ask`), which names nothing, and takes the ask back the same way. Only
  the organizer sees who's asking (`asks`), from people still in the call. They answer with one document, read or edit
  (`workspace-grant`, which needs them to be able to share that document, as Share does), or say not now
  (`workspace-decline`, and whoever asked sees `asked: 'declined'`, and can ask again; 10 asks a minute per person). A
  grant is a seat entry in `document_access`: it ends with the call, when they're removed, or from Share, and it holds across
  a reload, because a seat does. Anything shared with someone in a call, by asking or from Share, tells the call to read
  itself again, so it opens by itself.
- **Follow-ups.** `GET /v1/live/calls/:id/follow-ups` is the live notes' follow-ups as this person reads them, what people
  added by hand ([Notes and inference › Adding a follow-up](notes-and-inference.md#adding-a-follow-up)), plus every
  to-do with a mention and a date in the documents worked on in this call, for whoever can open each, with `notes` saying
  what the notes are doing there. A to-do's words are its line's, without tags side by side at the end of it, which say who and
  when; a tag in the middle of a sentence stays part of it, with a date as a day. With notes off they come from documents alone,
  and say so. It reads documents, so it isn't
  part of reading the call: `CallSession.watchFollowUps` reads it every few seconds while something shows it. They come from
  the 20 documents most recently worked on, 25 from each and 100 in all, each to-do's words cut at 300 characters with five
  mentions and dates at most, worked out in the worker that reads the document, so nothing past that comes back from it.
  What's in each is read once for each place the document gets to, for everyone in the call however many poll at once, and
  that stands three seconds more while people type, so everyone's polls read a document at most every few seconds between
  them. Who can open what is asked on every read, and a closed document is left out without a worker. `POST` to the
  same path ticks a to-do with `writeDocument`, as a server-made update that sets the block's own `done`, as the editor does,
  so a tick there and a tick in the document are one thing. It needs `edit`, in a document worked on in this call, and it
  counts as working on it, and whoever ticked it sees the tick at once. Access is checked again under the workspace's row in
  the transaction that writes it. Someone who
  can't open the document gets the same `404` as for a follow-up that never was, whether or not it was worked on in this call.
- **What was worked on.** An update sent with a call's pass says it's from that call (`reader.seat`). The first from each
  person on each document goes into the call's sealed state (`worked`), under the call's row and once only: that first
  update waits on it, and everything typed after doesn't. A failure costs only the record. When the call ends, its note gets the list (`workedOn`: IDs, `kind` and
  who) in the transaction that ends it, and the call lets go of it. Once the room has gone, with nobody waiting, each document
  keeps a version with reason `call`, filed under the call: a worker can take as long as it has on each, and nothing about
  the call's end depends on it, so a failure is logged and costs only that version. A call with notes off has nowhere to keep the list, so only the versions remain. Each person reading
  the note is told what they can open now, by the name it has now, and nothing else is listed or counted, and which of the
  people who changed it they are (`by[].isMe`): who changed it is kept as the workspace knows them (`personIn`, a keyed
  hash), so the reader is found among them the same way, on each read, and nothing stored says who's reading.
- **Presenting.** One thing at a time in each part of the call, for the people there: the workspace, or a board
  (`present-start` with `what`, `{ kind: 'workspace' }` or `{ kind: 'board', id, section }`). Each start is a new presentation
  with a random `key` (`id128`), which names nothing and is the same for everyone told of it.
  - *The workspace* presented is the one everyone views, by someone something in it opens for (`404` "That workspace…"
    otherwise, as for a call that views none). It names that workspace and nothing more: where the presenter is in it comes
    from presence. The call keeps it in `workspace.space`, `{ place, workspaceId, key, since, by }`, apart from `present`: a
    release that knows only documents and boards there would fail to read the call with a new kind in it.
  - *A board* is presented where it's open: the board open in your part of the call (the main board, in a room that shares it),
    from whichever workspace it's kept in, and no other, so everyone it's presented to has it on their stage already. The call
    keeps it in `workspace.present`, `{ kind: 'board', id, section, by, key, since }`. It's shown from that workspace whichever
    one everyone views, and only while it's still the board open there: closed, it's over, and the next change takes it out of
    what the call keeps. It moves a frame at a time (`present-move`; `409` while the workspace is what's presented), by whoever
    started it or the organizer. Frames are the browser's to count ([Presenting a board](#presenting-a-board)).
  - *One at a time.* Nobody starts either over someone else presenting there (`409` "Someone else is presenting here."), unless
    they're reloading or have lost it: then theirs ends for good, said there (below). Starting while you present one presents
    this in its place, and the same again is the same presentation, with its key.
  - *Access doesn't change*: someone who can't open it is told something's being presented, by whom, and its `key`, with
    `kind`, `id`, `name` and `section` null. Which workspace is said only to someone something in it opens for, and which board
    only to someone who can open it. Presenter notes aren't call state: see
    [Data and storage › Presenter notes](data-and-storage.md#presenter-notes).
- **Ending a presentation.** `present-stop` is for whoever started it, or the organizer (`403` for anyone else), and says
  whom it ends for: whoever presented it (`close` false), everyone following keeping it open on their own, which only they can
  choose (`403` for the organizer on someone else's); or everyone (`close`). A board closed for everyone closes in the call too,
  as `board-close` closes it: by the organizer always, and by anyone else when it's their part of the call's own board, or they
  opened it, and nobody else presents it anywhere it shows. Otherwise, in a room on the board the rooms share, or while someone
  else presents it in another room, it's closed for everyone in their part of the call, and stays the call's.
  The call keeps how the last presentation in each part ended, `workspace.ended`, `{ place, key, close, by, at }`, `by` being its
  presenter whoever stopped it, until another starts there, and tells everyone there (`CallWorkspace.ended`: `key`, `close` and
  `by`), so whoever was following it knows whether to keep it open. Every end is said there as it happens, whatever ends it
  (below), and only its presenter or the organizer ends one for everyone: a presenter whose presentation closed for everyone
  without them can tell it was the organizer, and nothing else is sent to say so.
- **What a release before this one kept.** A document it presented a section at a time is over, and the next change takes it out
  of what the call keeps. A board it presented has no `key` (`''`) or `since` (0): it's told with a key made from where it is,
  whose it is and which board, keyed under the call's own key (`call-present:<callId>`), so it's the same on every read and for
  everyone, and says nothing to anyone without that key. A workspace presented that isn't the one everyone views, as one of
  those releases switching would leave it, is over.
- **Playing together.** `{ mediaId, documentId, by, playing, positionMs, atMs }`, with `nowMs` as it's read: all the
  server's clock, so `playPosition` lands a late joiner at the same moment whatever their own clock says. `play-start` needs the
  document open and the video to be a block in it, which is read from the document with nothing held; only IDs are kept, and
  nothing about the video changes. Paused, seeked, resumed and stopped by whoever started it or the organizer. Only someone
  who can open the document is told: anyone else sees nothing, and what they try reads as nothing playing, or, if they start
  a video of their own over it, as that video not being there (`404`, the same as for one that isn't).
- **What stops them.** What's presented and what's playing belong to the part of the call they started in, and show only to
  the people there.
  - Someone reloading hides what they started until they're back: it isn't stopped, nothing says it ended, and they find it as
    it was, with its key. A page going away sends `leave` without `onPurpose`, which is all a reload is to the call.
  - Their being removed, their moving to another part of the call (sent to a room, moved, or the organizer visiting one, even
    while they reload), or their leaving on purpose stops it for good, as a change of workspace, the board no longer being open
    where it was presented (another opened in its place, closed, in Trash, or its workspace deleted) and the call ending do.
    Each is said where it was presented as it happens, in `workspace.ended` (`close` false: nobody closed it for everyone), so
    nobody's browser waits to see whether it comes back. What decides it says it, and whatever saves the call takes what's over
    out of it and says so in the same save (`tidied`). Only they can say they left on purpose (`onPurpose` on `leave`, which a
    page going away doesn't send), and handing the call on counts. Someone still here on another connection hasn't left.
    Their part of the call closing says nothing there, as nobody's left in it: how a presentation ended in a part of the call
    goes when that part closes, and everything presented with the call. A presenter presenting something else in place of their
    own makes a new presentation, by the same person in the same part, and clears how the last one ended, as every start does:
    that's the last one's end.
  - Someone losing the document stops being told at once, on their next read. Whoever started it losing it stops it for
    everyone, and the workspace presented stops once nothing in it opens for its presenter: losing a document or a workspace
    says nothing to the call, so a read that finds this takes it out of the call's state and tells everyone, that read included
    (`ended`, as above). It's found by a read from someone who can open something in the workspace, or from whoever started it,
    never from someone with nothing in it, who's told only that something's being presented until then. A workspace that's
    been deleted is found by any read. While something's showing, a browser reads the call each time it checks its keys, so it
    never waits on a change push that isn't coming.
- **Presenting, in the browser** (`apps/web/src/features/call/workspace/presenting.ts`, with what's on each person's stage in
  `layout/onStage.ts`: [The call screen](#the-call-screen)).
  - *The workspace presented* is in its frame on the stage of everyone following it, and the frame's bar says who's
    presenting it. Following takes you to the presenter's page and line, through the workspace's own Follow and presence
    (`features/workspace/follow.ts`), so nothing new goes to the server. Unfollow takes you back to where you were before
    you followed; a click, a scroll, a key or Escape in it leaves you where you are, on your own (`onOwn`). Only in it:
    `useFollow` takes Escape from inside the workspace's pane alone, so an Escape anywhere else (focus, the chat box, your
    side) stays the call's. Present, on the workspace's frame, or Share › The workspace, presents it; Close, while you
    present it, asks whom it ends for.
  - *A presentation ending* because its presenter left the call says so, for everyone, as the call says it ended
    (`CallWorkspace.ended`) with them gone from it. Which presentation it is, is its `key`.
  - *Presenter notes* beside a board's frames are as [Presenting a board](#presenting-a-board) says.
- **Playing together, in the browser** (`features/call/playback/sharedVideo.ts`, `PlayTogether.tsx`).
  - *One player per call*, playing whatever's open. A video block on screen borrows its `<video>`, which moves into the block
    and is never copied, so nothing is heard twice; with none on screen it plays out of sight and is still heard.
  - *In step*: it reads the call itself, and works out where everyone is with `playPosition(play, ms since this browser heard
    it)`, four times a second. More than 500 ms off, it moves there; nearer than that, it plays 5% faster or slower until it's
    within 60 ms, which nobody hears; held, it holds the same frame (within 40 ms). A late joiner does the same on arriving. Whoever started it says when it's reached the end, which stops it for everyone.
  - *Here alone*: a browser that refuses to play (autoplay) shows Play here, and anything pressed tries again; the system's
    pause key holds it for you with Back to everyone; loading, a file this browser can't play and one that didn't arrive each
    say so. Your volume is the player's own. None of it reaches anyone else.
  - *What it plays* comes from `videoSource.ts`: the workspace's media, read by range through the document the video is in,
    with the call's pass (`api.workspaces.media.url`), asked again once if the file stops arriving after it had played (a URL
    is good for 12 hours); a URL is never logged. The bar's title is the video block's, read from its document
    (`videoAbout.ts`). Play for everyone is on every video block in a call, beside a smaller Play here that plays it in this
    browser alone, which stops when it plays for everyone (`editor/blocks/Media.tsx`).
- **The next agenda.** When a call in a series opens Workspace, it looks for an agenda to make, until it has one or finds
  there's none to make: the call before
  it that had one (kept on its meeting, as IDs, when that call ended: whatever it brought or worked on that's named Agenda,
  or says what the Agenda template says), still in the tree of the workspace this call uses. It's made in the organizer's
  name, so it takes what making a document there takes: `edit` in the workspace, and `edit` on the last agenda, whose open
  to-dos it carries. An organizer taken out of the workspace, or who can only read in it or read the last one, gets none,
  however many calls their series has. What was left open, every to-do with words and no tick, is read with nothing held.
  Whoever opens Workspace first takes it on, under the call's row, so there's one however many open it at once: the call's
  sealed state keeps the document it's making and until when (`agendaDraft`, two minutes). The server makes that document
  beside the last one, in the same folder, for the same people, restricted as it was, in the workspace's own transaction, and
  `writeDocument` fills it in, with nothing of the call held: From last time, Today, Notes. Only once it's filled in does the
  call say it's done, `agenda` name it, and it take the last one's place among what's brought. A try that fails lets go and
  keeps the document, so the next opening fills that one in, never a second; one a worker gave up on stays closed for five
  minutes first ([Data and storage › Documents](data-and-storage.md#documents)), and filling in one that's filled changes
  nothing. Nothing from the notes goes in it: not everyone in a workspace gets a call's notes. An agenda stays in its
  workspace, so a call that moved to another gets none.

A live call comes first, so nothing under the call's row waits on a workspace's lock, opens a workspace, or works through its
documents. Each action is two steps (`prepare` in `callWorkspace.ts`): everything that reads a workspace, and a grant, which
changes one under that workspace's row in a transaction of its own, with nothing of the call held; then the call's row, held
only to check again what that went by, from the call's own state, and to save. A call that moved on in between is asked
afresh, three times at most before a `409`. So a big change to a workspace, such as duplicating a folder of thousands of
documents, can make a grant wait for it, and never a hand going up, nor anyone else's request for a connection. A grant to
someone removed while it was being made is taken back, as their removal takes everything else.

Actions are rate limited per person: 240 a minute for what goes on in the workspace, as each makes every browser read the
call again. Following a change to who can open what, the state is right on the next read; only what's shared with a seat
tells the call straight away, because that's the only case that knows which call to tell.

`workspaceForCall(d, call)` and `grantDocumentToCall(d, workspace, documentId, call, { role, place? })`, in
`workspaces/access.ts`, are the same things for server code: the call's workspace, with this run of the call's folder in it
(`folderId`, settled if it isn't yet), where what the server makes for the call goes, such as its board (a call with no
workspace, or one that can't take it, is a `409` instead, below); and one document given
to everyone in a call now, or in one part of it, as a seat each.

## The call's folder

Each run of a call has its own folder at the top of the call's workspace, named as a workspace made for a call is
(`Launch check-in · 5 Nov`), holding the call's pages: Notes (the summary and what was decided), Follow-ups and Transcript,
live during the call and the written note after it. A workspace that holds several calls has a folder for each, the newest at
the top. Nothing of the call or the note goes into the workspace: the folder's sealed item keeps whose call it is (the
organizer's owner, address and call ID), when it started, whether it's over, and its note's ID once it is (`StoredCall`), and
nothing else. A call with no workspace has no folder: nothing makes a workspace for it.

- **Made once.** The call takes the folder's ID under its row (`CallSpace.home`: workspace, folder and whether it's made, in
  its sealed state), and the folder is made in the workspace's own transaction with that ID, with nothing of the call held
  (`settledFolder`), so however many people open Workspace at once there's one. A workspace made for the call is made with
  its folder already in it. Someone deleting the folder doesn't bring it back. `call folder settled` is logged. A workspace
  that already holds this call's own folder (the call was in it before, or its notes were filed there) takes that one up
  again instead of making a second (`call folder taken up again`).
- **Settled by Workspace.** `workspace-open` settles the folder only if the call has a workspace; with none it settles nothing
  (`call folder not settled`, with why: `none`, `shut` or `full`) and the rest still opens. The same goes for what the server
  makes for the call (`workspaceForCall`).
- **Switching lets the old one go** (`letGo`), once the call's row is let go: the folder the call left in the last workspace is
  removed if nothing was put in it, else kept as a plain folder that's over with no note, since the notes go to the folder in
  the call's workspace. `call folder let go` is logged, with whether it was kept. The new workspace gets this run's folder,
  as above.
- **Its pages, per reader.** A tree read works out, for each call's folder, what its reader may read of it
  (`WorkspaceItem.call`): `here`, while the call's on and their pass is for it, which is the call's live pages, read through
  the call as everywhere in it; and `noteId` once it's over, for its organizer and whoever has the note now by its own rows
  (`note_access`), one small query for a tree. Someone who removes the note from their notes, or whom it's shared with
  later, finds that on their next read; a deleted note is nobody's. Everyone else sees the folder, its name and what people
  put in it. Opening a page reads the call or the note through their own access, so a stale tree can never read either.
- **When the call ends** (`afterCall`), the folder is told it's over and given its note, if it had notes, which publishes the
  tree. A folder taken and never made is made then. A call that had notes and no folder yet gets one in its workspace, if it
  has one its organizer can still make things in (`call folder made after the call`); with none it stays unfiled, as above.
  It never throws: the call has ended all the same.
- **Who's in a workspace made for a call** follows its invite (`followInvite`), one change at a time. One made in a call is
  made with its organizer alone, under the call's row; everyone invited is let in to edit once the row's let go, and again as
  each call of a series settles there. One made when scheduling, or for filing notes, is made the same way. Whoever a change
  puts on the invite is let in: rung, let in from the link, or added to a scheduled call or a series' later calls. Whoever a
  change takes off it is taken out: removed in the call, or taken off a scheduled call or a series' later calls, unless the
  series still invites them to a call that hasn't ended. Each member's sealed record says whether the invite put them there;
  only those are ever taken out, and adding someone or changing their role by hand makes their place theirs. Someone taken out
  by hand, or who left, is kept on the workspace's `out` list, and no invite puts them back; an admin adding them by hand takes
  them off it. A guest without an account gets nothing unless something's shared. A workspace the organizer picked isn't made
  for the call, so its people are its own. A failure is logged, and tried again by the next change or the next call.
- **Like any folder** otherwise: it can be renamed, moved and sent to Trash. A copy of it is a plain folder.

## The call's timer

A call has one countdown for everyone, which only the host starts, pauses, adds time to and stops, separate from any board
or breakout-room timer. Its server clock, host permissions, concurrent presses and how the previous release's sealed
sequences read are in [The call's timer](call-timer.md).

## A board in a call

A board is a workspace item of kind `board`: what's on it, who can open it and how it's deleted are the workspace's. What's the
call's is which board is open, kept by part of the call in its sealed state (`board`: `main`, or a room's ID) with who opened
it, by their name, address and seat, and which boards it lets everyone into. What's done is `apps/api/src/features/calls/boards.ts`, what's kept is
`space-state.ts`, and who can open what is `workspaces/access.ts`, on every read.

- **`CallState.board.open`** is per viewer, for the part of the call they're in: `workspaceId`, `documentId`, `name` (what it's
  called now), `openedBy` (the connection whoever opened it is on now, or null when they aren't in the call), `canClose`,
  `everyone` (the call made it and it's still the call's to give, so everyone in it can add to it, anyone let in later too,
  which is what the board's seal, a blank board and the call's toasts say; false once it's restricted or the organizer can't
  edit in its workspace, for a saved board, and for anyone who can't open it; a room's own board is everyone in the room's),
  `role`, `seal` (`Sealed`, or `Sealed to this room` on a room's own board), and `frame`: on the one board every room shares,
  the frame of the room you're in, where you land; null anywhere else. Someone who can't open it gets `role`, `workspaceId`, `documentId` and
  `name` null: that's "A board you can't open", and nothing names it. A board in Trash, or gone, has left the call for
  everyone, and one brought back from Trash is open again. That, `board-close` by whoever opened it or the organizer, and a
  presentation closing for everyone are all that take the board in your part of the call away while you stay there. Whoever
  had it on their stage is told which, as the board's own session hears it, which is usually before the call does:
  "Launch retro was moved to Trash, so it closed for everyone.", or "… was deleted, …" (its workspace with it); a board the
  session says neither of was closed: "Launch retro was closed for everyone. It's saved in Product." (`goneWords` in
  `features/call/boards/callBoard.ts`). A presentation closing for everyone is said by the stage instead. In the browser,
  Close on the call's board while nobody presents it asks whoever may close it (`canClose`, or the organizer) for whom:
  For you closes it on their stage alone, For everyone sends `board-close`. While rooms share the board, only the organizer
  is asked, as someone may be presenting it in a room, which nobody else can see and the call would refuse (`409`).
  Someone waiting to be let in is told nothing. Late
  joiners and reconnects read it from here like everyone else. None of what happens to a board outside the call tells the
  call, so while one's open a browser reads the call each time it checks its keys, as it does for what's presented.
- **Who can open one.** Anyone invited. Guests add to what's open and don't start one: `board-open`, and `boardCheck`, answer
  them `403` in the same words whatever they asked for, logged at info, before anything is read or settled.
- **One board per part of the call.** Opening one replaces whatever's open there for everyone, and the old one just closes;
  a browser that had the old one on its stage keeps it there, just for that person, as a saved board (`InCall.tsx`). A
  saved board is named as its workspace names it now, from the tree the call reads for its links (`callBoard.ts`), not as it
  was named when it opened, and a rename in the call (`useRenameBoard`) puts the new name at once in that tree, the board
  picker's Your team's boards and the Drive's library, and reads each again, so no copy brings the old name back.
  A main board doesn't show in a breakout room, unless rooms share it ([Boards in breakout rooms](#boards-in-breakout-rooms)).
  The call's seats on it are for the whole call, so someone in a room finds it when they come back, and `boardCheck` counts
  them. A new board started in a room is the room's; a saved board is the main room's to bring: `board-open` with one, and
  `boardCheck`, from a room are `409`, before anything is settled.
- **Not over someone presenting.** Nobody makes or brings in a board while someone else presents one where it would open,
  there or in a room that shows that board: it would take theirs off everyone's stage. `board-open` is `409` "Someone else is
  presenting a board here. You can start one once they stop.", asked before anything is made and again under the call's row,
  and it names nobody: the call already tells everyone who's presenting. Bringing in the board that's presented, to let people
  in, takes it off nobody's stage, and whoever's presenting may open another, which ends their presentation with the board it
  was of. The workspace presented is in no board's way.
- **A new board** (`board-open` with `template`) goes in the call's workspace, in this run of the call's folder
  there while that's in the tree (`workspaceForCall`'s `folderId`), and named after the call. A call with no workspace has
  nowhere to put one, and nothing makes one: it's `409` "This call has no workspace yet, so there's nowhere to keep a new
  board. The organizer chooses one.", asked before anything is made, and the organizer picks or makes one first. It's made by the server through what `items.create` does, because whoever opens it needn't be in the
  workspace, and it's by them. A call adds to a workspace only while its organizer can edit there, as it only ever took one
  they could: past that it's `409` ("This call's workspace can't take a new board any more. You can still open one that's saved.", or, for
  a full workspace, "...has as many things in it as it can hold..."), and a saved board can still be opened. Those invited get `edit` by email, so it stays theirs
  through the note, and anyone else here who can't edit it a seat: everyone in the call works on it, so someone the workspace
  lets read it gets one too. An address it went to never gets a seat as well, and neither does anyone with an entry on it: what
  someone does to an entry stands, so an address taken back stays taken back, from a new tab too, and one set to `read` stays `read`.
  Someone on the invite because they were let in from the link, or rung, has a seat instead, as taking them out takes them off the
  invite and a seat goes with them. When the call ends they keep the board by email, at the role their seats have, if every seat
  it knows of theirs, from connections not taken out of the call, is still there, and an entry someone gave their address stays
  as it is. Someone taken out of the call stays
  on the invite if they were invited from the start. While they're out they aren't given what's opened, and what they had before
  they keep, as they keep the note. Back in the call, a board made from then on goes to their address, and one made while they
  were out is a seat, for that call. A call can let everyone into 50 boards, the ones it made included. That's asked before a
  board is made, with nothing of the call held, so two made at once can take it one past.
- **Filling one from its template** is `fillBoard`, at the end of the first step, once the board is made in its workspace and
  before the call's row says it's open: nobody can know of the board until then, so whoever reads the call and opens it finds
  its template on, however busy the workers are, and nobody can put anything there first. The server writes the template
  through the board's log, as the template's own Yjs client, with the board's id as its seed, so everyone gets the same frames
  and nobody's undo can take them away ([Data and storage › Documents](data-and-storage.md#documents)). It's written once
  however often it's asked, and blank writes nothing. One that can't be filled is logged at warn (`board not filled from its
  template`), and the board opens as it is: a board left as it started is still a board. The call's row is held only for the
  second step, so nothing of the call waits on the fill.
- **A saved board** (`board-open` with `workspaceId`, `documentId` and `letIn`) comes from the workspace the request names,
  whichever that is: a call's workspace may be new, so what a team already has is across the Drive, and the board picker offers boards
  from there, with any brought to the call first. The browser reads them as the picker opens, from the newest 12 workspaces in
  your Drive's list (`q.boardsToBring`); reaching for Board reads only that list, ahead. Bringing one needs `edit`
  on it, and it opens from where it is, whichever workspace the call views; nothing moves. Someone who can only read it gets
  `403`, and one in Trash is `409`. Anything else is the same `404` in the same words, whatever it was: a workspace they can't
  open, a board that isn't in the one named, someone else's board, a document, or nothing at all.
  `GET /v1/live/calls/:id/boards/:workspace/:document` (`boardCheck`) says what presenting it would mean, for Present (or the
  picker in Share › A board) to ask first: the first names of everyone in the call who can't open it, and whether the asker
  may let them in.
- **Letting people in.** `letIn: true` needs the right to share that board, the workspace's rule, so nobody gets past it through
  a call. It's a policy on the call, not a list. Everyone here who can't open it gets a seat at `edit`, and whoever can keeps
  what they have. `syncBoardSeats(call)`, started wherever someone's let in, does the same for anyone who comes later, on
  boards the call made too, whether they're open or not. Being let in doesn't wait for it: a seat lands a moment later, and the
  call reads itself again when it does. Upkeep calls it as well, for anyone a crash left without their seat.
  Each board is done on its own, so one that can't take anyone more stops nothing else. Each remembers who it's been worked out
  for, so a seat taken back in Share stays taken back, through a reload and through anyone else being let in, until someone
  chooses `letIn` again. A new tab with no earlier pass is a new person with a new seat. For someone the call knows by address it's
  seated only as the seats on that board from their other connections stand: not at all if one was taken back, at `read` if one
  is `read`. So opening a tab never undoes what someone did to a seat. A guest is known only by the name they typed, so a guest's
  new tab can't be told from someone new, and is seated as anyone new is, for that call: nothing lasting comes of it. Someone taken
  out of the call and let in again starts afresh, as taking them out ended their seats and letting them back in is the organizer's
  new decision. Whoever let people in is asked about again each time, so once they can't share it nobody new gets a
  seat in their name. A board the call made is given on the call's word, so that stops, and nothing turns into an email entry
  when the call ends, once the board is restricted or the organizer can't edit in its workspace. Someone who may share it can
  still let people in, on their own word. `letIn: false` changes nothing about anyone: whoever can't open it sees a board they
  can't open, as does anyone let in later.
- **Share, while it's open.** A change to who has a board (`share.set`, `share.remove`, `share.restrict`, and a rename) is told at
  once to the call it was made from, by the call's pass, which Share opened from a call sends, and to every call it's open to by a
  seat in (`document_access.call_id`), so everyone there reads the call again then: a board turns read-only, opens or closes for
  someone in a moment, not at the call's next read. A call it's open in by nobody's seat, changed from elsewhere, still hears it
  through each browser's own document: the stream says the reader's new role (`access`), and the call is read again then.
- **How it stands, in the browser.** The call's browser holds the board's session (`useBoardSession` in
  `features/call/boards/callBoard.ts`, with the call's pass) and says how it stands in its page's words, from the same code
  (`features/board/standing.ts`): its seal, what that says on hover and when it's pressed, and, while there's something to
  say, the pill at the top of the board, ahead of everything else in it (`standing` is the first of `PILL_ORDER`).
  **Reconnecting** while the session has no connection, or the browser is offline: what's added is kept, on the device for
  an account, and goes when it's back. **Couldn't save** (the seal says **Not saved**) when Alcove refuses what was added
  here, counting the changes that are only on this screen (`useChangesSinceSaved`), with **Try again** for an account, which
  opens the session again so what the device keeps goes again; the session tries again by itself as well. **View only** for
  someone who can only read it. A session that ends `unavailable` opens again by itself, a little later each time
  (`useOpensAgain`, as the page's does), and one that couldn't open at all opens again once the browser is back online.
- **Closing** (`board-close`) is for whoever opened it, on any connection of theirs, or the organizer, and only closes it: it's
  how a board nobody presents leaves the call (`canClose` says who may). In a room on a board every room shares, it's the main
  room's board, for every room. Nobody but the organizer closes it while someone else presents it where it shows (`409`
  "Someone else is presenting this board. You can close it once they stop."), as nobody opens a board over theirs. Closed while
  it's presented, wherever it's presented, the presentation ends too, said at once (`workspace.ended`), for everyone when the
  organizer or its presenter closed it. Nothing is deleted, seats stay until the call ends because people may open it again, and
  what the call lets people into stays. While it's presented, ending the presentation for everyone (`present-stop` with
  `close`) closes it the same way, for whoever's presenting it too ([Presenting](#the-calls-workspace)).
- **When it stops.** The call ending ends every seat, and what it kept of its boards goes. A change of workspace leaves what's
  open alone: a board says where it is, and only a new one goes to the new workspace.
- **Ideas from the call** are kept by part of the call in its sealed state (`board.ideas`: when they were last looked for, a
  digest of what that read, a run holding the look, and what's on offer, six at most), and shown in `CallState.board.ideas` only
  to someone who can add to the board there, while notes are on in their part, and only those whose every line they may read.
  A browser with the board open to add to, while notes are on where it is, asks every 15 seconds
  (`POST /v1/live/calls/:id/ideas/watch`, 30 a minute a connection). The server looks at most once a minute for each part of
  the call, and only when something new was said: what was said there lately (`catchup.readOf`), with the board's frames by
  their titles, goes to the notes model (`drafting.ideasFrom`), which offers up to three things worth a sticky, each from one
  line, which says who said it and when, with the words it comes from, copied from that line (the line's own words when they
  aren't in it), and the frame it fits. Only someone who may read every line of that part looks, the call's organizer pays for it,
  and nothing is held while the model reads: a run claims the look for two and a half minutes at most, and any other look
  meanwhile answers at once. A pause stops it as it stops any capture (`capture.mayCapture`, `'ideas'`). Adding one writes a
  sticky in the browser (`addStickies` in `@alcove/board`), as a change of that person's own whatever they have under way, on a
  phone as from a laptop, and `board-ideas-done` takes it off for everyone there; Add all's toast has Undo, which takes back that
  change and nothing done since (`undoStep`), on a phone too, though its bar has no Undo. Putting the tray aside is that browser's
  alone. Opening another board, closing this one, its room closing, or the call ending drops that part's
  ideas. A part's ideas are for its own board: a room on the one board every room shares has none, since not everyone on that
  board may read what's said in the room, so nobody there looks, and nobody there is offered the main room's. A look claims and
  lets go through `saveSettled`, so rooms whose time ran out close with either ([Boards in breakout
  rooms](#boards-in-breakout-rooms)), and it lands rooms' boards waiting to come back, as anything done in the call does.
- **When people add at once.** Each browser works out where a sticky goes from what it has heard, and the call takes an idea
  off only once it's been added, so two people can add at the same moment. What holds then:
  - **The same idea from two trays** is one sticky: its ID is made from the idea's (`stickyFrom`), so both write the same object
    and one of them wins whole, the same for everyone. It's both of theirs then, so neither one's Undo takes it away. A tray that
    has heard it already writes nothing, and counts it as added, and either one's `board-ideas-done` takes it off for everyone.
  - **Two things in one place.** Different ideas going into one frame at once, or a phone's **+** beside them, each take the
    frame's first free spot as their browser sees it, and so do two branches from one mind-map idea (`branchSpot`). Once the two
    browsers hear each other, of two things exactly on one another, in the same frame with the same box, the one drawn on top (the
    later `at`, then the later ID) moves: to the frame's next free spot, or under the idea's other branches (`apart`). Only the
    browser that put it there moves it, so only one of them does, and it's moved as if it had gone there in the first place
    (`BoardHistory.amend`): undoing what put it there, the toast's Undo or the bar's, takes it from where it is now, and no undo
    or redo puts it back on the other. A browser watches what it has just put on the board for 30 seconds, for as long as nobody
    moves it (`features/board/landing.ts`).
  - **An idea added just as someone's drag of its frame lands**, the drag not knowing of it, is left where the frame was, held by
    it: the browser that added it moves it into the frame as the frame is now, in the same way.
- **Sort into themes** is `POST /v1/workspaces/:id/documents/:doc/sort` with the stickies picked, by their IDs and what each
  says (each cut to 400 characters by the browser), for someone who can edit that board: on its own page, or in
  a call with the call's pass, where it's refused while notes are paused where they are, as Ask is (`maySortInCall`). The notes
  model names up to six themes (`drafting.themesOf`): a sticky it wasn't given, or one it names twice, goes, and a theme left
  with none goes. A blank sticky has nothing to sort by. Fewer than two with words is `400` "Pick at least two stickies with
  words to sort.", and more than 80 "Sort up to 80 stickies at a time.", both before anything reaches the model, and a
  browser says the same before it asks (`SORT_TOO_FEW`, `SORT_TOO_MANY`). Nothing is kept. The browser writes the answer as one change of that person's (`applyThemes`), so one undo
  takes it all back, and the frame they share is marked `sorted`.

- **After the call.** A board open for everyone in a part of the call goes into what the call worked on, with that part
  (`CallSpace.worked`, `open`), whether or not anyone changed it, as the call is saved and as it ends, a room's own board with
  its room, and into the note when the call ends: the note shows it, and
  that part's notes read it when everyone the note went to can open it ([Notes and inference › Boards in the
  notes](notes-and-inference.md#boards-in-the-notes)). What the note says of it is read for each reader, as for documents.
- **Bringing one to a call.** A board scheduled into a call is one of the meeting's `documents`, as any document is, and
  comes first in the board picker's Your team's boards; joining never opens it. Start a call here, on a board's page, opens
  the start flow with the board brought (`InstantCallInput.documents`, from the starter's own library, checked by
  `validDocuments` as a scheduled call's are), and the starter's browser opens it once the call is under way there
  (`features/call/session/opening.ts`): on their stage, just for them, as a saved board picked from the picker opens, so
  nothing in the call changes until they present it. Present brings it into the call first, asking about anyone who can't
  open it, as for any saved board. A board they can only read is brought and not opened, as presenting one needs edit. A
  reload in between forgets the opening, and the board is still brought. The next call in a series brings what this one
  brought, and the boards open for everyone in it that the organizer can still bring (`documents.boardsFrom`, from the
  note), up to 12 in all.

A board is two steps too, as everything about the call's workspace is (`prepare` in `callBoards.ts`). Making a board, giving
its grants and seats, and checking who may bring one are done with nothing of the call held, in the workspace's own transaction.
The call's row is then held only to save what came of it, from the call as it is then. Opening never needs asking again:
a board made and a seat given stand whatever happened meanwhile, as they would have a moment earlier. A seat given meanwhile
to someone taken out of the call is taken back once the row is let go, and anyone let in meanwhile is seated straight after.
`syncBoardSeats` is the same: each board's seats in the workspace's own transaction, then the call's row to note who's been worked out, and only against the same
decision, since a new `letIn` replaces it. Closing touches no workspace. So a busy workspace can make a board wait for it, and
never a hand going up, nor anyone being let in.

### Put on the board

The one capture of a shared screen that doesn't come from the presenter's own browser. Anyone who can edit the board open in the
call can put a picture of someone else's share on it, from the share's name menu, while that board is on their stage beside the
share (Show beside), and whether or not the share is in the notes: it has nothing to do with the notes, and nothing of it reaches
them. A saved board open just for you takes none, and your own share's menu doesn't offer it.

- **What's taken.** The share's picture as that viewer's own browser shows it now (the frame held for looking back, if they're
  on one), drawn into a JPEG at most 2560 pixels on its longer side (`keepShot` in `features/call/boards/callBoard.ts`). Nothing
  else: not its sound, and not any earlier picture.
- **Where it's kept.** Uploaded with the call's pass to the board's workspace as one of that board's files
  (`media.upload`), sealed as every workspace file is, and placed on the board as a `shot` with its caption ("Priya's screen,
  14:05"), which is also what the file is named. It's the board's like any picture on it: whoever can open the board can see
  it, it's reached only through the board (`media.picture`), and it's kept and deleted as the board's files are ([Data and
  storage](data-and-storage.md)).
- **The sharer is told.** Whoever put it on the board sends `board-shot/1` through LiveKit, sealed with their call data keys as
  pointers and marks are, saying which share by its picture's track ID and nothing else (at most 256 bytes; a browser reads a
  burst of 4 from someone, then 1 a second). The sharer's browser says "Art put a picture of your screen on the board.", and
  takes it only from someone in the call, about its own share.

### A board's vote

A vote on a board is the call's, not the board's: a late joiner and a reconnect get it from `CallState.board`, and a saved board
has none. A board has no timer of its own: the call's one countdown is the timer over a board too ([The call's
timer](call-timer.md)), and a call stored with a board timer from before keeps it, unread, until it's next saved.
`CallState.board` still carries `timer`, always `null`, for this release only: the previous release's web app, still served
while the API deploys and open in tabs left from before, can't read a call without it. It goes in the next release. On the one
board every room shares, the vote is the main board's: someone in a room is told of it as anyone on it is, and starts it and
votes in it the same, each step addressed to the board where it's open (`boardPlace`). It's kept on the open board's entry in
the call's sealed state (`vote`, `null` by default, so a call stored before votes still opens), so closing the board ends it
and another board opening in its place starts with none. The same board opened again keeps it. It isn't told to anyone who
can't open the board, and nothing they try says whether one is on: whatever they ask, they're told what they'd be told of a
board that isn't there, before anything about a vote is looked at.

- **Who started it.** Whoever started a vote is the same person to it as anyone voting: on any connection of theirs, and,
  signed in, on any device of their account. While it's on, they or the organizer can end it, and clear its results; while
  neither of them is in the call, on any connection or device, anyone who can edit the board can, until one of them is back.
  They're asked nothing of the board to do it, so the organizer can end a vote on a board they can only read.
- **A vote** (`board-vote`, a step at a time): `start` on a frame, or with `frame` null on every sticky on the board, with 3, 5
  or 10 votes each; `cast` and `take-back` a vote for a sticky; `end`; and `done`, which clears the results. One at a time: a
  vote can't start while another is on, nor while one's results haven't been cleared. Anyone who can edit the board starts one
  and votes in it, guests with a seat on it included. A vote takes one vote a sticky, up to `per`, and only stickies (`k:
  'note'`) inside its frame, however deep, never a frame or sticky of another board. The server checks a frame and a sticky by
  reading the board, in a worker as everything in a document is read (`voteOn` in `documentOps.ts`), on every vote cast, one for
  a sticky already voted for included: a take-back from another device can land first. When it ends, votes for a sticky deleted
  since, or moved out of its frame, count for nothing (`stillInVote`), in `results` or in `voters`.
- **Voting from the keyboard.** In the browser a press on a sticky votes (`useBallot`, `tools/run.tsx`), and so do the keys:
  while a vote is on, each sticky it takes is a toggle button for whoever can vote (`role="button"`, `aria-pressed` once it
  has their vote, `aria-disabled` while they've none left to give it) that only Tab reaches. `keys.ts` takes Tab from the
  sheet to the first and on from sticky to sticky in `voteOrder`'s order (frame by frame as the outermost frames are read,
  then row by row), focusing each with `preventScroll` and gliding the board to one out of view (`reveal`), and lets Tab go
  on past the last; Enter or Space votes or takes the vote back, and so does a screen reader's own press, a click with no
  pointer behind it (`detail` 0), while a pointer's click does nothing more than its press did. A press never puts the keys
  on a sticky, and once the vote ends, or they can't vote any more, a sticky that had them gives them back to the sheet.
- **Reaching the call.** A vote is told to everyone in its part of the call who can open the board, whether or not they have it
  open, with who started it (`startedBy`, their connection in the call, as `openedBy` says who opened the board). In the
  browser, someone who can vote in it (whose `role` on the board is `edit`) without the board on their stage is told a vote
  started there, by whom, with Vote, which opens it on their stage on the vote's frame (`useVoteStarted` in
  `boards/boardRun.ts`); someone who can only read the board isn't, as Vote would take them where they can't vote. A vote
  already on as they join or arrive says nothing, and whoever started it isn't told. Someone following a presentation of the board votes as they follow, since a vote changes
  nothing on the board, and whoever presents starts a vote on the frame they show. The bar's Vote names the frame it will be
  on, and which of several frames of one name, in the order they sit ("Could improve, the second of two").
- **Votes stay on the server.** `CallState.board.vote` is `{ on, frame, per, left, mine, results, voters, canEnd, startedBy }`.
  `mine` is your own votes alone. `results` is empty and `voters` is 0 until the vote ends, and then everyone is told every count at once.
  Votes are kept by who someone is to the vote: their account when they're signed in, so it's one set of votes on every device,
  else the person their pass names (`limitKey`, as media counts a guest's uploads), so a reload, or a second tab with the first
  one's pass, is the same person with the same votes; a tab that asks to be let in again, with no pass, is someone new to the
  call. Only IDs are kept: which stickies, never what they say. A vote cast or taken back is told to nobody else (no change push), so
  nobody can count votes by when the call changes. Nothing about a vote is written to the board, and nothing logged names a
  frame or a sticky.

Each step is two steps as well (`prepareRun` in `callBoards.ts`): whether someone can open the board, then whether they can
edit it, which the workspace says, and what's on the board, with nothing of the call held; then the call's row, held only to
save it, which asks again whatever could have changed meanwhile: that it's the same board and the same vote, whether another
vote has started, how many votes are left, and who's in the call. So two people starting a vote at once start one, and someone
casting their last vote from two devices at once casts one.

Each step counts towards the same 240 a minute as what goes on in the workspace.

### Presenting a board

Present, on the bar of the board's frame, presents the board open where you are
(`present-start` with `what: { kind: 'board', id }`, on its first frame), and Share › A board presents what's picked there
straight away; what's kept, who may move and stop it, how it ends and what stops it are as for anything presented
([Presenting](#the-calls-workspace)). A saved board open just for you is brought into the call first (`board-open`, after
`boardCheck` and its question), then presented. In the browser: `features/call/boards/boardPresenting.ts` turns the call's
present state into the board's, `features/board/CallBoard.tsx` draws it, and the frame's bar and its pager are
`layout/frame.tsx`'s. Close, while you present it, asks whom it ends for: For you (`close` false) leaves the board in the
call, open on everyone's stage who followed, on their own; For everyone closes it.

- **It's still the board.** Nothing about presenting changes how anyone's board is drawn: whoever presents and everyone
  following keep their own mode (`call`, `phone` or `read`), tools, bar, dots, comments and every pointer included. What's
  presented is the presenter's view, which their board already publishes on its awareness ten times a second (`view`, as for
  Follow); nothing more goes to the server. The view says how tall it is as well as how wide (`h`, beside the zoom, both for
  a sheet `BOARD_VIEW_WIDTH` wide), and a follower fits all of it into their own sheet (`viewHere`), so a sheet of another
  shape, a phone's or one narrowed by its side, shows more round it, never less of it. `h` is optional: a browser from
  before it says only the width, which is followed as before, and one that never heard of it drops it as it parses.
- **Frames are the presenter's stops.** The board's top-level frames, in the order they sit, top to bottom and left to right
  (`slides.ts`, the same reading order as a vote's Tab), so the order can be told from the board, and moving a frame moves it
  in the order. A frame held in another is part of it. `section` is the presenter's place in that order, kept by the call for
  their pager, their notes and a reload; past the last it's the last, and a board with no frames has no pager. A frame
  moved, added or taken away changes the order, not which frame they're on: every browser holds the frame `section` meant
  while it stays the same (`usePresentedFrame`), at its new place, for the pager, Your notes and Follow's "Art is in", and
  the presenter's tells the call that place (`present-move`), with no glide, so everyone's number means the same frame again.
- **Whoever's presenting** moves round the board freely, with every tool. As it starts, and each time they step to a frame
  (the pager, → and ←, or the organizer moving it), their camera glides to the frame (`Board.toFrame`), clear of the bar, the
  pill and the pager at its foot (`PRESENTING_PAD`), and stays fitted to it as their sheet changes size (Your notes opening
  beside it, the window resized) until they move the view themselves (`takeCamera`); when their own camera comes to rest with
  an outermost frame in the middle of their view (`onRest`), `section` follows it, with no glide, so the pager says where they
  are and → goes on from there.
  Their pointer shows to everyone. At the frame's foot, for them alone, the pager (`FramePager`) has Back a frame and Next
  frame on either side of where they are ("1 of 3", with the frame's name), and, for an account, the button for Your notes,
  which opens `mine` on their side: where they are, their notes beside this frame, each frame its own, kept under their account
  ([Data and storage › Presenter notes](data-and-storage.md#presenter-notes)), and the next frame, drawn small. Present on the
  frame's bar is for bigger screens: a phone's frame has no Present, and a board is presented there from Share › A board.
- **It's on their stage like anything they have open.** Opening something else puts it away and they go on presenting: it's
  a tile among the people, with Open, which takes them back. O, or the lit Board, is Close, and asks the same question.
- **Their keys.** → and ← (and Page Down and Page Up) glide to a frame while the presentation has the keys: the sheet, or the
  pager (`data-pager`), whose keys come by the document (`CallBoard.tsx`). Never from the notes in the side, from any other
  control, while typing (`typing`), or from a key something has already used (`defaultPrevented`). Back a frame and Next
  frame are `aria-disabled` at either end, not `disabled`, so the keys stay on the one pressed. As a presentation starts,
  keys that were on the board, or lost as it changed, go to Next frame (none move on a board of one frame), or to the sheet on
  a board with no frames, which has no pager to wait for (`data-no-pager`), and as it ends, keys that were lost go to the
  sheet. Anyone typing keeps their place.
- **Everyone else** follows the presenter's view (`BoardSurface`'s `presenter`, `Board.follow` with `watching`), found by their
  connection in the call (`BoardPresentation.who`) as Follow finds anyone, eased to as it moves, and held where it was while
  there's none to follow, as the presenter opens something else or reloads. Only they stop following: the board's session
  opening again under them (Try again, opening again by itself, their account arriving after it opened) draws a new board,
  which follows on; the old one going tells nobody (`stopFollow(false)`). The frame's bar says who's presenting and
  Following them, with Unfollow, which gives them their own view back, as they left it; the pill doesn't, and no ring goes
  round the sheet. Their tools stay: anything of their own on the board takes them off following, where they are, and does
  what they did (`Board.ownView`): a press that picks or changes something (`gestures.ts`), a key of the board's (`keys.ts`),
  a tool or More from the rail, a scroll, a zoom or a drag, which take the camera. A press on a sticky in a vote votes and
  leaves them following, as it changes nothing on the board, and Esc is Unfollow. Someone who can only read follows the same
  way, and a drag takes them off. Follow, on the bar, with the frame the presenter is on, takes them back to the presenter's
  view. Whoever's presenting moving on never pulls them back. The organizer, who can stop anyone's, has Close it for everyone
  in the board's name menu. Nobody goes to or follows anyone else on a board while it's being presented to them, and ideas from
  the call wait while it's presented, to whoever's presenting or following.
- **When it ends**, whoever was following stays where it left them, quietly.
- **Rooms' frames.** Once rooms close, each room's board is a frame on the main board, so presenting it, each room's frame is a
  stop, in the order they sit; a board made for what came back has only theirs.
- **What reaches anyone else** is which board, which frame its presenter is on and who, and on the board's own awareness, as
  ever, the presenter's view: notes and the next frame are this browser's, and nothing about presenting changes who can open
  the board.

### Boards in breakout rooms

Rooms open with what the organizer chose in the rooms panel's Board row, `BreakoutPlan.board` (`rooms-open`'s `board`):
`{ mode: 'none' | 'each' | 'shared', template }`. Open rooms say it back (`CallState.breakouts.open.board`), and each open room
says whether it's on a board of its own (`rooms[].board`), which is all anyone outside it is told. What's done is
`callBoards.ts` (`prepareRooms`, `roomsClosed`, `roomInStep`, `land`); `calls.ts` holds the row and says when.

- **In each room.** One board per room, made as rooms open, before the call's row is held: restricted, with nobody as its
  creator, named "<room> board", in the call's folder, filled from `template` before anyone arrives. With no workspace
  to put it in, or one that can't take it, opening rooms with boards is refused with the same `409` as a new board, before
  any room opens. Its readers are the seats of
  whoever is in the room now, and nobody else: not the workspace's members, not its admins, and not the organizer, whom being
  organizer gives nothing, except while visiting. A restricted board opens for its creator and whoever restricted it, so a room's
  has neither, and whoever started one in a room doesn't keep it once moved out.
- **Started in a room.** `board-open` with a template from a room makes the same: the room's alone, the board in that part of
  the call for everyone in it, though it opens only on the stage of whoever started it until they present it.
- **`syncRoomBoards(call)`** keeps each room's board with the people in its room: the seats of whoever is in it get `edit`, and
  every other seat of the call on it goes (`seatsInStep`). It reads the call under the board's workspace lock, so of several at once
  the last goes by the latest. It runs wherever people move, after the call's row is let go and before anyone's told: rooms
  opening and closing, `rooms-move`, `rooms-visit` (the organizer's seat comes as they arrive and goes as they leave), a board
  opened in a room, someone let in (`mlsCommit`), someone leaving, and upkeep. Every change publishes to the workspace's
  streams, so someone moved out of a room loses the board at once, and an open page on it closes (`closed: 'access'`). It goes
  by every board of the call's rooms it can find (`roomBoardsFound`): what the call keeps (`board.rooms`), any board open in a
  room, which only a room's own ever is, and any its workspace's tree says is one of this call's rooms', so a save of the call by a
  release that didn't know rooms' boards leaves none behind, and what it finds the call keeps again. One whose room nothing names
  any more opens for nobody until rooms have closed, and then for everyone invited.
- **A room's board isn't stranded.** It has no creator and, for a moment, maybe nobody in its room: the item keeps its call
  (`StoredItem.room`), which `roomInStep` puts back while its room is open, and nothing counts it as stranded, so it's neither
  sent to Trash nor handed to the workspace's admins. A tree saved without the mark, by a release that didn't know it, still
  doesn't strand it: a live call whose folder is in the workspace names its rooms' boards (`roomsOfCalls`). Once the call has kept
  it for everyone invited the mark goes, and it's a restricted board like any other. A call that ended without keeping it, as a
  release before this one ended calls, has it kept for everyone it invited the first time anything in its workspace asks what's
  stranded (`keepRoomsOfEndedCalls`).
- **Shared.** The main board gets an empty frame for each room, named for it with who's going (`roomFrames`), after whatever's
  there: the board open in the main room, while whoever opened it can still edit it (asked again as the frames are written, with
  its workspace held), or a new one from `template`, made as the board picker makes one, which opens in its place: then the call
  says "The rooms share a new board. The one that was open can't take their frames." Everyone stays on it:
  in a room with no board of its own, the main board shows, sealed as the main board, with `frame` set to the room's frame, made
  from its ID (`roomFrameId`), the same every time. Closing it from a room closes the main board. The panel says plainly that
  everyone can see it, and so does the board's pill in each room, all along.
- **The rooms' time is in the board's one pill** (`features/board/pills.tsx`'s `roomPills`, from the call's `breakouts.open`):
  in a room, its name and how long it has left; amber in the last minute, when a room's own board says it comes back with you,
  and in the last ten seconds that rooms close, counting down; on the shared board, that everyone can see it, and in the main
  room how many rooms are on it. The time changes on screen only: the pill's one live line (`BoardPill`'s `said`) is read out
  twice, at ten seconds and as they close, never each second. The rooms closing come after a vote's results and before
  following someone in the pill's order; the room itself comes last. The board hands up which kind of pill it shows
  (`BoardPills`' `onShown`, through `CallBoardSheet`'s `onPill`, which says none while the board is a tile or sinking), and
  the rooms line over the call stays unless that's the rooms' own (`room` or `closing`): under a timer, a vote, following or
  how the board stands, the line says where you are and how long is left. The line over the call is built only from what's
  in it, so with nothing to say there's no empty band above the board; while it says anything, a phone's row of arches and
  the board stand under it, as a wider screen's frames do (`placeMain`'s `top`). While a pill shows, the board
  frames what it shows clear of it (`CLEAR` in `useBoard.ts`, as a vote frames its frame), and frames itself again as one
  comes or goes, until someone moves round it.
- **The rooms' words.** Rooms worked on boards (`breakouts.open.board` other than `none`, or a room on its own,
  `rooms[].board`) say things the board's way: "Art opened rooms. You're going to Comms.", the organizer's message as a toast
  for everyone else ("Art, to every room: …", and the same words on the organizer's own stage), "Art joined this room.", and
  the hand is **Raise your hand**, to ask the organizer by name. Rooms with no board say what rooms always have.
- **When rooms close** (by the organizer, by time, or as the call ends) whatever was open in them closes, what was said in them
  as ideas goes, their part of the call's MLS log is deleted, and the call keeps a landing (`board.landing`): each room's latest
  board, named for the room with the first names of who was there (from the room's record, the organizer left out), and the board
  to land on: the one open in the main room, or a new one, whose ID is taken under the call's row so it's made once. Rooms close
  by time in whatever saves the call first once their time is up, every save of a settled call going through `saveSettled`: a
  hand, a board's vote, a board opening or closing, the workspace, an MLS commit, chat or a key package, a hand-off, and
  a look for ideas. Whatever closed them follows through once the row's let go (`afterClosing`): each room's board is everyone
  invited's before anyone's told, and once it has answered the boards come back. A look for ideas, which nobody did on purpose,
  does the first and leaves their coming back to the next look or whatever's done next in the call. `landRooms` takes the
  landing on under the row (for 60 seconds), does it with nothing of the call held, then lets it go, opening a board it made in
  the main room for everyone. Landing reads each room's board and writes a frame for it in one update (`landBoards`): stickies
  in reading order in a two-column grid, everything else below them, and no pictures, images or shots, which are their board's
  own files. Each landed thing's ID is made from the room's board and what it copies, so landing again changes nothing: however
  many browsers ask at once, and upkeep after a crash, it lands once.
- **Where they land.** On the board open in the main room only while it's still open there and whoever opened it can still
  edit it, asked first and again as it's written, with its workspace held, as rooms' frames are: a call writes on a board it didn't
  make only on someone's word who may. One that can't take them, restricted away from its opener, say, gives way to a new board
  in the call's workspace, made as when nothing's open, which opens in its place, and the call says "The rooms' boards came back on a
  new board. The one that was open can't take them." When the workspace can't take a new board, as its organizer can't edit there any
  more, or there's none, they come back nowhere: the landing goes, each room's board stays where it is, everyone invited's, and the call says
  "The rooms' boards didn't come back: this call's workspace can't take a new board. Each one is still saved where it was." A try
  that fails otherwise is tried again only after 30 seconds, then a minute, counted on the landing (`tries`), and after three
  it's given up, said once at warn, so a landing that can't be done never costs every call action a try. A call ending with rooms
  open lands on the main board if there is one and it can take them, and makes none.
- **Landing, in the browser.** The rooms' frames land one after another, 180 ms apart, as they arrive (`expectLanding` in
  `useBoard.ts`), and every browser on the main board glides to them as they do (`showLanding`), as the shared board glides
  out to its rooms' frames: anyone who stayed on it too, unless they're following someone, being presented to or in the middle
  of something on it.
- **After rooms close** room seats go, and each room's board is everyone invited's by email at `edit`, the organizer and everyone
  on the invite who wasn't taken out, as the people its room's notes go to: then it's kept, a restricted board like any other,
  and workspace members who weren't invited never see it. Someone taken off the invite loses it with the room's notes.
- **Limits.** A call makes 64 boards for its rooms in all.
### More, and a board on a phone

What More adds is the board's, written in the browser as everything on a board is (`features/board/more/`), with nothing new on
the server and no change to the contract. A board's own page has the same More (`BoardPane.tsx`), read and written with the
person's own access where the call uses its pass, and its links open on the page.

- **A picture** from **Image** is uploaded with the call's pass to the board's document (`media.upload`, which takes only
  someone who can edit it), placed as an `image`, and read through the board (`media.picture`), as a picture of a share is.
- **From your workspace** lists the board's own workspace as that person's own tree has it (`api.workspaces.get` with the
  call's pass, `q.workspaceTree`): documents and boards they can open, not in Trash, the board aside. It offers nothing from
  any other workspace, not even the library's, so links stay within what the board's readers can reach. A `link` keeps the item's ID
  and nothing else, and each browser names it from its own tree, so someone who can't open it sees "A document you can't
  open". Opening one opens it in the workspace on your stage when that's the call's workspace, and in a tab of its
  own for an account otherwise.
- **A comment** from **Comment** (or **K**) is the board's own comment thread, as on its page. In a call, each one names its
  writer as the board's workspace knows them: the ID it keys their address under (`api.workspaces.ids` with the call's pass),
  which is a member's own ID there, so the page finds their face; never the address. Someone with no address, or none known
  yet, is named by their name alone. Each writer's face in the call is whoever in it that ID or name is.
- **A table's cells** are made with it, a `Y.Text` for every row and column, and a row or column brings its own, in the same
  transaction (`put` and `addTableLine` in `@alcove/board`). So focusing a cell writes nothing, and two people who start in one
  empty cell at the same moment type in the same text and both keep what they type. An undo that brings a row or column back
  brings its empty cells too, and an empty cell made with its line isn't anyone's words to undo. A cell is still missing in a
  table saved before cells came with their rows and columns, or where two people added a row and a column at once, neither
  knowing of the other's, at the cell where they cross: focusing one makes it, with any other the table is missing
  (`fillCells`). Only there can two browsers each make one before hearing of the other; Yjs keeps one for everyone, and the
  field whose text lost follows the winner (`bindCell` watches the cell's key), so what's lost is at most what that person
  typed before the sync.
- **Downloads** are drawn on a canvas in the browser from that person's own view of the board (`boardScene` and `sceneWords`
  say what one covers and says), in the sheet's own colours, every link by that reader's name for it, and saved there; a PDF
  is the same picture as one JPEG page. The API never sees one.
- **Night board** is the board's own setting, kept in its Y.Doc under a fourth root, `settings` (`night`, in
  `@alcove/board`'s `settings.ts`), written by whoever can change the board and refused as any change is from someone who
  can only read. Every picture of the board reads it from the board, so the stage, a tile, a note, presenting and the page
  all follow it: a dark board in any theme. Undo leaves it alone. Both menus that offer it, the bar's More and the frame's
  name menu, show it the same way (the moon, ticked while it's on), and either says what it did in a toast (`Board.nightBoard`):
  in someone's own dark theme nothing on their screen changes, so that's how they know it changed everyone else's.
- **Getting back.** The bar's Show the whole board (⇧1 too) fits all of the board, on a phone as well, where the zoom gives way
  to a pinch, and further out than a pinch goes. It's named for the board, as the dock's Show everything, which leaves focus,
  can be in view beside it. Whenever the camera comes to rest, or the board changes, with nothing on it in view
  though there's something on it (`Board.noteLost`), the sheet offers Back to the board (`BoardLost`), which does the same,
  until something's in view again.
- **On a phone** (a sheet under 600 px), a board opens on its first frame at a size it can be read (`phoneCamera`), not
  shrunk to all of it. Someone who can add to it gets the phone's board: the bar with its name, seal, Show the whole board, Vote and More, no
  tools beside it, **+** at the bottom right for one sticky at a time, and a tap on a sticky to vote. The sticky goes in the
  first free place of the frame that was in the middle of the view, as that frame is when Add is pressed, wherever someone has
  moved it meanwhile, and the frame the button names holds it. Ideas from the call add there as **+** does, Undo and all. A
  board's own page at the workspace's phone width (640 px) is the same phone's board (`pagePhone`), with the page's **Start a
  call here** in its bar and the add sheet in the person's own theme rather than the call's night.

## The join page

`apps/web/src/routes/join.$code.tsx` (with `apps/web/src/features/join/`) is the pre-join for everyone with the
link: the organizer's lobby (`features/calls/lobby/Lobby.tsx`) by their account, and anyone else from the call's card.

- **What it says before anyone joins.** The title and organizer, and what the call captures (`CaptureSummary`, the
  same for everyone), with who gets the notes said for the person looking (`PrejoinCapture`, one component for
  every pre-join, the organizer's included): the organizer and who's invited; "You're invited, so you get them";
  for someone whom letting in adds to the invite, that once they're let in they're added and get them; for a
  guest, that the people invited get them. Nobody's name but the organizer's. It says what won't be kept (from
  `card.choices`) and when everyone joins muted (`card.joinMuted`), which starts the camera off and the microphone
  muted. The card is read again every 3 to 5
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
  nothing to join (it ended, or the link leads nowhere). Joining works with either or both off. A link that offers
  times isn't a call to join yet, so they don't start, and a page that showed times stays that way when the offer
  goes: opening the link again goes to the pre-join.
- **The organizer's lobby.** Until the call has started, its name (Enter or leaving the field saves, Escape puts it
  back) and notes change here through `meetings.update`; a save that fails says so and the old value comes back.
  Live, it's read-only and shows what's captured instead. On a team, a call started just now offers arches of
  teammates on Alcove (`LobbyRing.tsx`: free first, busy dimmed where a calendar can be read, Add for the rest), and
  whoever it was started with comes picked. Picks stay in the page, never in an address or storage, and go to
  `CallSession.ring` once joined; a ring that fails leaves the organizer in the call and says so once. The lobby's
  only link is **Copy link**, quietly under Join, on a team or not. Backing out of a call started just now cancels it, once and
  best effort, by leaving the page any way but joining; a reload doesn't, and neither does leaving once this tab has
  copied the link (kept in `sessionStorage` for the tab, by code): someone may be on their way, so the call stays until
  starting a new one sweeps it, a day on.
- **Picking a time.** While a link offers times (`card.offer`) it shows `PickTime`, public and in the guest's own
  time zone, which it names. The first `calls.pick` settles it; anyone after that gets `conflict`, and the card, read
  again, says when the call is (`card.startsAt`), with its link. Add to my calendar is an `.ics` made in the browser
  (`PickTimeCalendar.ts`), so nothing else sees the title. The organizer on their own link sees who it's waiting for.
- **When it can't go on.** A code that leads nowhere, a call that's over, or a card that can't be read each get
  their own page; a refused join (locked, ended, the organizer not there) shows under the button. Every failed
  request's reference (its request ID, `RequestRef`) is shown, finds its lines in the server's log, and says
  nothing about anyone.
- **Time to join.** The card is read alongside the session, and the call screen's media code (`livekit.ts`)
  loads while the pre-join is open. A browser waiting to be let in checks the call's log after 150 ms, then
  twice as long each time up to the usual 1.5 seconds, so an invited person (let in by the host's browser
  within about 50 ms) is in after a quick check or two. Measured from opening the link to being in the room, on
  a local stack (a production build, Chromium with fake devices, median of five runs): the organizer 0.4 s, an
  invited person 0.6 s (2.0 s before the quick checks), and a guest 0.6 s after the organizer presses Let in
  straight away (1.7 s before). A guest let in after a few seconds waits for their browser's next check, at
  most 1.5 s away as before (0.9 s median with the organizer taking 3 to 8 seconds).

## The call screen

`apps/web/src/routes/call.$code.tsx` is the call for everyone in it; no account is needed, since the call's
pass is what lets a guest in. It's built from `apps/web/src/features/call/`, put together in `session/InCall.tsx`. The shell
is `layout/`: the top bar (`TopBar.tsx`) and Settings, from More (`CallSettings.tsx`); the call's area (`PanelHost.tsx`), with your side at its
right (`side.ts`, drawn by `Panel.tsx`) and its main area shared out by `panels.ts`; what's on your stage (`onStage.ts`), each
in its frame, with Close's question (`frame.tsx`); the people (`Stage.tsx`, laid out by `stageLayout.ts` from your view in
`view.ts`, with who's talking settled in `media/speakers.ts`); each tile's menu and a presented tile's (`TileMenu.tsx`); Share's
steps (`ShareMenu.tsx`); and the call's keys are `session/useCallShortcuts.ts`. Presenting the workspace is
`workspace/presenting.ts`, a board, its picker and presenting it are in `boards/`, and a share in its frame is
`screen-sharing/ShareInFrame.tsx`. Then breakout rooms (`Rooms.tsx`), captions, the leave sheet and the device pickers.

- **What it reads.** The `CallSession` (who's in, hands, spotlight, rooms, notes, the transcript, the live notes), its
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
- **Asking to join.** The organizer gets a card at the top of the stage, which stays until it's answered, a count
  on the People button, and an Asking to join section in People to let people in or turn them away: someone signed in
  with their address and "Gets the notes once let in", a guest as "Guest, by name only". Two cards show at a time,
  with how many more are asking, and none while People is open. A card goes as soon as the ask is answered, wherever
  that happens (here, in People, or on another device), and when the asker takes it back or leaves. A Let in pressed too late lets nobody
  in: it checks the call first and says the person is already in, or isn't asking any more (the organizer's
  browser adds only people still asking anyway, so a late admit changes nothing). Their call
  re-reads the meeting when someone with an account is in it and not on the invite yet, and after they remove
  someone with an account, so who's invited (who gets the notes, who can go to a breakout room) includes whoever
  they let in and not whoever they removed.
- **Host controls** are whoever hosts', on each person's ⋯, on their tile and in People: lower their hand, mute their
  microphone (LiveKit mutes the track, their dock shows it off, they're told, and only they can unmute), and remove them
  (they're told and go back to the call's page; nobody removes the organizer). Locking the call and pointing at shared
  screens are the call's settings, not People's.
- **Who hosts** (`features/call/rooms/Hosting.tsx`). While someone stands in for the organizer, the status bar says so for
  everyone ("Priya is hosting while Art is away"; to Priya, "You're hosting while Art is away", with **Bring everyone
  back** while breakout rooms are open), and their row in People says it too. Each change arrives once as a notice.
  An organizer's tab that was away when someone else took over says so and goes back to the join page, which shows the
  organizer that someone is hosting and that joining makes them the host again (**Join and host**).
- **Each person's volume, for you.** Anyone can turn someone else up to 100% or down to muted for themselves,
  from that person's tile menu or their row in People ([Media in the browser](#media-in-the-browser)).
- **Chat** is `crypto.chat`, decrypted in the browser; names come from the people in the call. Each message
  says which part of the call it was sent in, and the view marks where the conversation moved; the box says where
  a message goes ("Message Design") while rooms are open. It's off until the browser holds its part's keys (and
  while it's moving), takes up to 4,000 characters, says when there was chat here it can't read, and gives back a
  message that couldn't be sent.
  Typing @ offers current room members by stable identity, with keyboard selection and clear recipient chips. Chat
  highlights selected names and offers Open mention for the first unread addressed message. Only an addressed span
  actually visible in a focused, visible Chat panel writes a read receipt; opening a background tab's panel does not.
  Under a message, `Reactions` shows each emoji with how many used it, yours marked; pressing one adds yours or takes
  it back, and its tooltip lists who reacted. Hovering a message (or focusing it) shows `ReactionAdd`. Your own
  message can't be reacted to until it has gone out (`sending`). If a reaction can't be sent it's reverted and the toast
  says "Your reaction wasn't sent. Try again." The stand-in call in Storybook folds reactions the same way (`react`).
- **Spotlight** goes through the server and can name anyone in the call. It leads on everyone's stage.
- **Tab attention** (`features/shell/TabAttention.tsx`) needs no OS notification permission: authorized unread document
  and chat mentions use a horizon circle, and the current host's pending admissions use a rose square with priority.
  Counts over nine show +. The Alcove mark stays unchanged underneath. Each call publishes bounded generic counts
  to sibling tabs, without content or join tokens; a live browser lock keeps a background tab's projection valid when
  its timers are throttled, and abandoned publishers expire. Current call authorization, account changes and sign-out
  clear projections. Document notices are read through account-keyed queries in every tab; a read in another tab
  invalidates them, and periodic background reads reconcile other devices and permissions. Focus alone never handles
  admission. The root renders a still PNG from the design-system icon and restores the original favicon on clear.
  Optional chat notifications follow Tagged in Settings and always use a generic title and body, without previews.
- **The shell** (`layout/`) has fixed places, each with one job, and nothing in it is dragged, torn off or rearranged:
  what's open is always in the middle, and your side always on the right.
  - *The top bar* (`TopBar.tsx`). On the left, the title, the clock, the notes sign, the shield, Reconnecting, and, when two
    things on your stage take turns, which is showing. On the right, one group (`CallTopGroup` of
    `CallTopButton`s, with a `CallTopRule` between kinds): Board, which opens the board picker under it, Workspace (counting
    what's been brought), Notes, Chat (counting what's unread) and the faces, which open People (counting who's asking to
    join, for whoever hosts). Each is lit (`on`) while what it opens is open, and a press on a lit one puts it away: on Board
    or Workspace that's Close, which asks first while you present it. On a phone it's the title, the notes sign, Chat and
    the faces.
  - *The dock* (`CallDock`): the microphone and camera with their menus, a hairline, Share (a `DockButton` with a `word`,
    which says Presenting while you present), Raise your hand, More, a hairline, Show everything while in focus, and Leave.
  - *More* is the same on every screen: Turn on captions, Mark this moment (with an account), Catch up on what you missed,
    Breakout rooms (the organizer's), then Open floating call, Reset layout (only while `isCustom` in `view.ts` says
    there's something to put back), Move to another device and Settings. On a phone the dock is the microphone, camera,
    Share, More and Leave, and More starts with a grid (`CallMoreGrid`, `CallMoreTile`) of Board, Workspace, Notes, Chat
    and People, then Raise your hand.
  - *Settings* (`CallSettings.tsx`) is one `Modal` from More, its parts a tablist down its left (a strip on a phone, where
    it's a sheet): Audio and video (`MicOptions` and `CamOptions` from `media/DevicePickers.tsx`, the dock's own menus),
    Video quality (`media/VideoQuality.tsx`), Notifications (`CallAlertControls`, from the same pieces as Settings' own
    Notifications: Browser notifications, Sounds, Quiet mode and the In a call rows of What reaches you, a guest's kept in
    this browser), and Call, for whoever hosts: Lock the call (`HostControls.lock`, a host action) and,
    for the organizer alone, Pointing at shared screens (`HostControls.setPointing`, which the API takes from the organizer
    only). Each switch moves once the call has taken it. The part you were on is kept while the call is open; one that's
    gone (Call, once you no longer host) shows Audio and video. Closing it hands the keys back to More.
  - *One width makes a phone*: under 600 px (`PHONE_W`), for the layout and the dock alike.
- **Your side** (`side.ts`, `useSide`) is one view at a time (`SideView`: `notes`, `chat`, `people`, `rooms`, `mine`), on
  the right, 368 px wide (340 px in a window under 1200 px), sliding in as the stage gives way. Where that would leave the
  stage under 480 px (`STAGE_BESIDE_SIDE`, a window under 864 px), it slides in over the stage instead, which keeps its
  width and dims under it (`.ic-scrim.is-over`, the main area alone, so the top bar and the dock work as ever); a press on
  the stage puts it away, and so does choosing something there, as on a phone (`sideCovers`). Someone asking to join is
  answered in what it leaves clear. On a phone it's a sheet over the call, and a window that narrows to a phone puts it
  away. `Panel.tsx` draws each. Notes is a head (Notes; the pill, which says the state in a word and opens what's
  captured; Open; ×) over the tabs Notes, Transcript, Ask and, for an account, Yours. Under the tabs on Notes and
  Transcript a bar shows while capture isn't simply live, with the one thing to do about it (the organizer's Resume or
  Turn on, or anyone else's Ask to resume or Ask for notes), and the foot of every tab but Ask has Note to self with the
  bookmark beside it, for an account once notes have been on. Chat is alone; People has Breakout rooms for the
  organizer, which opens `rooms`; and `mine` is a presenter's own notes beside a board they present, from the pager's notes
  button. It takes your theme (`ThemeScope`, so a popover or a list that opens from it takes it too), as a board's sheet
  does unless it's a night board, while the stage, the dock, the workspace and screens stay night. What's typed in Chat or
  Ask and not sent is kept above the side (`useDraft`), so moving to another view and back keeps it. A reload finds your
  side as it was (`CallLayout.side`, never `rooms` or `mine`, which go with the moment), and a call just joined opens Notes
  on a wide screen while notes are on.
- **The stage** (`Stage.tsx`, `stageLayout.ts`, placed in the main area by `panels.ts`'s `placeMain`) holds the people and
  what you have open (`onStage.ts`: the workspace, the board in the call, a saved board just for you, or someone's screen).
  With nothing open the people fill it, laid out by the stage itself (Your view, below). With something open, it sits in its
  frame, and the people stand beside it at the window's right edge, past your side: a column about 300, 248, 216 or 176 px
  wide as the call's area narrows, or, made smaller (⇧P), a rail of arches 74 px wide; or a row of arches over the frame,
  which any call's area under 760 px gets. Your stage holds one
  thing: opening something puts away what was there, so a presentation becomes its tile, and what's open just for you closes
  (the workspace keeping your place, caret and undo). Show beside is the one exception: it puts a second presented thing
  beside the first, side by side where there's 900 px across for them, else one over the other where there's 620 px down,
  else taking turns, with a switcher in the top bar (under the arches on a phone). Nothing between them is dragged. From the
  main room, the organizer's stage shows every breakout room while they're open (`StageRooms`), and what's open stands beside
  them, the rooms in place of the people, a little over a third of the stage (340 to 560 px). A room nobody's in, and any
  part of the call they fold (a room, or the main room, for their own view, for as long as the rooms are open), is only its
  header: in a row over the rest on a wide stage, in its place in the column on a tall one. The time left is said once, in
  the line over the rooms. In a room, their stage shows that room's people as anyone else's does, with tile menus, dragging,
  their own view and Focus; Back to main room, in their side, brings every room back. On a phone, and on a stage under 880 px, what's
  open goes over the rooms until it's closed, with whoever's in the organizer's part of the call in arches over it, as anyone
  else's are. A board the rooms are worked on takes the rooms' place while it's on the organizer's stage: the one every room
  shares, which comes onto it as those rooms open (`useCallBoard`'s `arrived`, and again on joining while they're open), or
  the board of the room they're visiting. Focus isn't on offer while the rooms hold the stage, nor is arranging your own view.
- **The frame** (`frame.tsx`, drawing `CallFrame` from the kit) is one for a screen, a board or the workspace, with one bar;
  it rises into its place as it opens, and glides as the room round it changes (`FrameBox`). On the left, the presenter's
  face (or the kind's icon while nobody presents), the name as a menu of the kind's own commands, and a line: Open just for
  you, You're presenting · 3 following (everyone else in your part of the call), You're presenting · a tab with sound
  (Starting to share… until LiveKit has it), or Priya is presenting. On the right, only what applies: Following Priya with
  Unfollow, or Follow Priya with where she is; Present; focus; Stop sharing, on your own screen; and Close. On your own
  screen Close puts it away for you while it's still shared (`closeForMe`): it's a tile with the people (Go back to Your
  screen), as anyone else's presentation is, and a toast says so (`wsToast.screenAway`). Close's tip says what it does, and
  when it's the only thing on your stage (`FrameBar.clears`) that the people fill it again ("Close it, and the people fill
  your stage again").
  Present is on a board you can add to, open just for you on a wider screen, for anyone but a guest (on a saved board,
  `PresentAsk` comes first when someone here can't open it), and on the workspace for anyone in it, on a phone too, each only
  while nobody else presents a board or the workspace there: there's one at a time, and the server refuses another (409).
  Share's A board and The workspace then say who's presenting instead ("Priya is presenting. You can present once they
  stop.", `presentingWhy`), the board picker in Share takes no pick, and nothing is made or brought in that couldn't be
  presented (`bringAndPresent` checks first). While you present a board or the workspace, Close asks For you or For everyone
  (`CloseAsk`: a popover on a wide screen, a sheet on a phone), on its frame, brought to the front when two take turns; Stop
  sharing in Share asks the same in Share itself (`ShareStopStep`), wherever what you present is: on your stage, a tile, or
  out of sight. The name
  menus: a board's Rename, Open where it's saved, Who can add to it, Copy link, Download as an image or as a PDF
  (`BoardHandle.saveImage`, `savePdf`) and Night board (`BoardMenuRows` in `boards/BoardStage.tsx`); the workspace's Switch
  workspace (the organizer's), Find in the workspace,
  Who's in it and Copy link (`WorkspaceMenuRows`); someone else's screen's pointing, looking closer, its sound, its own
  window, Put on the board and Show beside (`ShareMenuRows`); and your own screen's Others can point at it, Clear marks and
  Change what you share, saying Read for the notes while it is (`MyShareMenuRows`), as its bar's line does. The organizer's name menu on someone
  else's has, after a line, Close it for everyone, or, on a screen, Stop it for everyone. A board keeps its own controls
  inside the frame: the seal, Vote, More, the pill, the rail, zoom and the phone's +; a board you present puts its
  pager at its foot, with the button for Your notes (`mine`).
- **Presented, and not on your stage** (`PresentedTile`, with `ThingMenu` in `TileMenu.tsx`): a tile first among the people,
  with its name, who's presenting it and Join (Open when it's yours), which puts it on your stage, following, as Enter, Space
  or P on it do. It's one tab stop among the tiles (the tile's group; its button isn't one of its own), and says what it is
  and who presents it, with no "Enter for options". One that lands while you watch something else glows for 3 s where it
  lands (`onStage.ts` `fresh`, `.ic-ptile.is-new`). A screen's tile shows it live, and a board's shows it drawn small (`BoardMini`); the workspace's has no
  picture, and says where its presenter is. Among arches it's small: the kind's icon and
  the presenter's face. Its ⋯ has Show it, Show beside (while your stage holds one thing, and not on a phone) and, for a share
  with sound, its sound for you. It's there only while it's presented: when the presentation ends, its tile goes.
- **A presentation starting** takes the stage of everyone who isn't watching another (what was open just for them closes),
  and they follow it, with a toast ("Priya is presenting the workspace, and you're following.", "Priya is presenting Launch
  retro, and you're following." or "Priya is presenting their screen."); someone watching another gets it as a tile, with a
  toast ("Priya is presenting their screen. It's with the people.") and Show it, which goes once it's been taken up some
  other way. Someone who can't open it gets no frame and no tile, only who's presenting. Following the workspace is the
  workspace's own Follow, through presence (`features/workspace/follow.ts`), so nothing new goes to the server; following a
  board is seeing the presenter's frame. Unfollow takes you back: in the workspace to where you were before you followed, on
  a board to your own view as you left it. A click, scroll or key in the workspace, or a scroll, drag or pinch on a board,
  works on your own from where you are. Follow, with where the presenter is, brings you back; a screen can't be unfollowed.
  Close on someone else's makes it a tile for you while they present. When it ends, its tile goes, and followers stay in it
  on their own if the presenter ended it for themselves, and it closes if they closed it for everyone
  ([Presenting](#the-calls-workspace)); a screen that stops leaves every stage. Yours, closed for everyone and not by you, was
  the organizer's doing, the only other who can: you're told who ("Art closed the workspace for everyone.",
  `wsToast.closedByOrganizer`), as a stopped share's sharer is. Every end the call decides comes as `ended`, naming the
  presentation's key, and ends it at once; what ended goes before what started in the same change, so a presentation
  started in its place takes the stage. Two more end at once, unsaid: one whose presenter starts another here (a new key
  from the same seat), and everything presented where you were when you go to another part of the call, which no `ended`
  follows. Said by the call with nobody closing it for everyone, and its presenter's seat gone from `participants`, it's
  "Priya left the call, so the presentation ended" (`presenting.ts` says it to someone who couldn't open it). A board or the
  workspace that goes with none of that is its presenter reloading: it's waited for, 30 seconds (`HOLD_MS`), its frame and
  tile as they were, nothing said, and carries on if it comes back; only if it doesn't is it said to have ended. In a room on
  the board every room shares, closing it for everyone while `board.open` stays is that room's alone ("… closed for everyone
  in this room."). What's on your stage, and whether you follow, is this browser's alone.
- **The workspace in the call** (`WorkspacePanel.tsx`) is the app's `<Workspace mode="call">` in its frame. The screen holds
  whether it's on your stage and where you are in it; `CallState.workspace` says which workspace it is (`openWorkspace`, the
  first time it opens in this browser) and what's been brought. It first opens on this call's agenda or the first thing
  brought to it, in the workspace the call uses now, and with neither on what you had open there last (`firstPlace`), and so
  does a switch to another workspace. Its frame stays once it's been opened (`mounted`), out of sight and `inert` when it
  isn't on your stage, so a page keeps its caret, scroll and undo, and its keys sleep (`WorkspaceCall.closed`). Where you
  are, and whether it was on your stage, are kept with `CallLayout`, so a reload finds them. Everything it says goes through
  the call's one place for toasts, one at a time, and a share's offer stays beside that until it's taken up some other way.
  The list gives way when the frame has no room for it (under 760 px across, or on a phone), and the call tells it
  (`WorkspaceCall.list`): one that gave way comes over the page (`peek`). Whatever needs it showing, such as ⇧N naming a
  folder, asks with `list.onShow`, which never hides it, so the list over the page behaves as it does docked.
- **Choosing it and asking for it.** A call with no workspace shows `WsNoSpace` where the workspace would be, with the call's
  own pages around it. For the organizer it says "This call has no workspace yet" with New workspace and a way to pick one of
  theirs; for everyone else it says the organizer chooses it, and opens by itself once they do. New workspace is
  `newWorkspace`, which makes one for the call and opens a blank document in it. Once there is one, the organizer's picker is
  the name at the top of the list (`SpacePicker.tsx`, as `WorkspaceCall.picker`), and so is Switch workspace in the frame's
  name menu: their workspaces they can write in, the workspace's people, and New workspace. Picking another asks first, in
  place of the menu, with `previewWorkspace` saying who can't open it; Switch is `setWorkspace`, and Back on the toast
  switches back. Nobody but the organizer is offered any of it. An organizer who can't open the workspace the call has any
  more (taken out of it, or it's gone) is shown `WsLostSpace` with the same two ways to give it another. The frame menu's
  Delete workspace is for the workspace's admins, and asks first (`WsDeleteAsk`). The frame shows only the call's workspace,
  so what was brought from another stays with that one, and anyone who can't open this one is told it's private
  (`WsNoAccess`, whose Ask is `askForWorkspace`). When which it shows changes, what was there stays over what's coming, as it
  was and out of reach, until that has drawn its list and page (or says it's private), then fades, 240 ms. The organizer
  answers asks at the top of the call, or above the dock on a phone (`WsKnock`, `WorkspaceAsks.tsx`), with the document in
  front of them, else the agenda or the first thing brought; with none, Open the workspace opens the document they were last
  in there, or the list (`WorkspaceCall.list.wanted`): `grantWorkspaceAsk` to read or edit, `declineWorkspaceAsk` for not
  now, and only a document they can share is offered. Whoever asked sees the workspace open by itself on the document (on a
  phone too, which otherwise shows the list first), or hears not now and can ask again. With no workspace, the board
  picker's New waits (`newWhy`) while saved boards still open, and the rooms panel offers a board in each room, or a shared one
  with none open, only once there is one, and says to pick or make one in Workspace first. The page after the call asks its
  organizer where its notes go when `CallEndResult.filed` is false (`FileNotes`, which calls `meetings.file`), and so does the
  note.
- **The call's own pages** (`features/workspace/live`). The call gives the workspace one object for the whole call
  (`LiveCall`, from `useLiveCall`): the session, who's talking (a store of its own, so the screen draws nothing for it), and
  what to do when something asks for your side or a toast goes there. `LiveRows` are Notes, Follow-ups and Transcript, quiet
  with notes off: in the call's folder in its workspace (`CallPages`, for the folder whose `call.here` says it's the call you're
  in, opened the first time it's there), and pinned at the top of the list while everyone views another workspace.
  `LivePage` draws each from `CallState` as it stands, so nothing is kept in step. Another call's folder opens its note in a
  tab of its own, from a call, and in place from the Drive. Where you are can be one of them (`WorkspacePlace` `live`), like
  a document. Someone who can't open the workspace has the same rows and pages: `OutsideSpace` puts them around the private
  state, with no tree, and the arrows go because there's no document to send to. With nothing to show and notes off a page
  is `WsNotesOff`; with something to show, a `Notice` says what's holding the notes back. Notes and Follow-ups watch the
  notes while they show; the transcript comes with the call. A row's button opens Notes on its Notes or Transcript tab on
  your side (`LiveCall.beside`), and **Open**, at the top of Notes, goes the other way. At the end of the transcript is
  whoever's talking, you included, with no words: a line is written once its clip is heard.
- **Follow-ups on the page** (`useFollowUps`) put what the call holds beside `CallSession.followUps`. A line in a document with the
  same words as something said or added, for the same person if both say who, is that follow-up: one row, done if either is.
  Ticking the row ticks both, and so does the Notes tab's box (`tickEverywhere`), which finds the line from the last time the list
  read it. The box in the document ticks the line alone: the row reads done, and the Notes tab doesn't. **Mine** goes by name for
  what's said, and by tag for what's written.
- **Sending from the call** (`useSending`). Arrows on the pages and in your side send to the last document you were in while
  you can edit it (`LivePut`, which your side gets through `LiveCall.onPut`). With that document open it goes in at the end,
  over a blank last line, and scrolls there and glows; closed, or with your side's sheet over it on a phone
  (`LiveCall.covered`), it goes in the same way and a toast says so. With another open, it goes in through `withDocument`
  and a toast goes there. A day the notes put in words becomes a date tag when it can be read as one (`dates.ts`), and
  otherwise stays words. Who it tags is who's in the call by that name, by their address, as a workspace knows people
  (`asInDocuments`), or else someone in the workspace by that name.
- **From the call in `/`** (`useEditorCall`). A `live` block is written by browsers in the call that can edit the document, with
  nothing but the notes to go on, so a dozen mustn't fight. What's written is the same in every browser (`liveLinesOf`: moments and
  words as they were said, read in each reader's time when drawn), and writing what's already there writes nothing, so all that's
  left is taking turns: each waits for its place among the call's identities, 600 ms a place and 12 places at most, and by then the
  block says it already. A browser writes only when its own notes change, never because the block did, so one that's a moment behind
  can't undo one that's ahead, and it never writes an empty list over lines. Only someone reading the notes everyone shares writes
  (`writesLiveBlocks`): not a guest, in a breakout room, or with notes of their own. A block holds the call it belongs to, so a later
  call leaves it alone, and it only fills in while someone in the call who can edit has its document open. A block in a document
  counts as watching the notes.
- **Hear it** (`HearIt.tsx`) is the `Editor`'s `hear`, drawn on a quote once it names a note. During the call the quote is from,
  it's for anyone in the call, guests included, and shows on a line that's in their own live transcript: `GET
  /v1/live/calls/:id/hear/:note/:line` (`CallSession.hear`, `calls.hear`) answers with that line's own pieces of the recording,
  whole, and where in them the line starts and how long it lasts (`HEARD_HEADERS`). It takes a line the person may read
  (`mayRead`: their part of the call, and for a guest with the link only while they were in it, a stay that ended without a word
  ending when they were last heard from), not one said in a breakout room, and only pieces the person was there for, placed in
  the call by where they are from the line: a guest who came in or went out part way through a piece doesn't get it. What's sent
  is a file of its own that starts at 0 (`recordings/stretchFile.ts`), so the line's place in it means the same in every browser.
  MediaRecorder cuts pieces wherever its timeslice falls: in Chrome each piece after a segment's first starts with the end of
  the last block of the piece before (1,967 bytes in the test recording), and its own Cluster after that, and every Cluster
  keeps its time from the start of the segment. A run that doesn't start the segment is preceded by what the segment's first
  piece says the recording is (a WebM up to its first Cluster, an MP4 up to its first fragment, `moof` with its `mfhd`), with
  none of that piece's sound, and its own first piece starts at its own first Cluster or fragment: the end of the piece before
  isn't sent. Its last piece's sound ends in the next piece's first bytes (the last half second of it, in the test
  recording), so once the next piece is there, those bytes, up to its own first Cluster or fragment, go on the end: a line
  said in a piece's last moments keeps its end, and nothing of the next piece's own sound goes. (If they don't read as the
  rest of the run, they're left off rather than the run.) Then every Cluster's Timestamp, and every fragment's decode time
  (`tfdt`, each track's), is less the first one's, rewritten in place in the width it had, and the file stops after the last
  element it has all of (a WebM block, or an MP4 fragment with its `mdat`), saying how much of a cut-off Cluster there is if
  it said its size. A run whose own start can't be found, or isn't laid out as a recording is, can't be played from where it
  starts: `not-found`, logged at `warn`. A run from the segment's start that can't be read through goes as it was recorded.
  The answers: the audio; `conflict` when none of the segment's pieces reach the line yet and none come after it, while that
  segment is still being recorded, notes on and in it (the host's browser sends each piece after its 5 seconds, so a line
  just said isn't there yet: try again in a few seconds); and `not-found` for anything else, a call that doesn't keep its
  recording, a line said in a breakout room, and a piece that will never come (notes paused or off since, or a new segment
  begun, as when a new host's browser takes over: the server takes no more of that segment) included, which names nothing. The call says whether it keeps its recording
  (`CallState.notes.keepsRecording`), and a live line which room it was said in, so the quote says "This call doesn't keep
  its recording." or "Breakout rooms aren't recorded." instead of offering Hear it. Pressed, the button turns until the sound
  starts; the audio plays on the speaker chosen for the call where the browser can choose one (`setSinkId`, the remembered
  choice, given 200 ms), and seeks to the line's place in the file. Each failure is said beside it in words and logged at
  `warn` with its code and request ID: not in the recording yet, Alcove unreachable or busy, and anything else unknown keep
  the button to try again; `not-found` ("You can only hear what you were there for." for a guest with the link, the only one
  held to the pieces they were there for, and for everyone else, who hears all of it that plays, "This part of the
  recording can't be played.", as `CallState.role` says) and a file the browser can't play (its `error` event, or `play()`
  refused: "This browser couldn't play it.") take its place. Otherwise, and after the call, it reads the note as the
  note's own page does, so someone without it never sees the button, finds the line in the note's transcript by its ID, and
  plays through `usePlayer` (`notes.audioUrl`) until the next line, or for 8 seconds after the last one. A call that keeps no
  recording has nothing to hear.
- **Focus** fills your window with what's in the frame (⌘⇧F, or the frame's Fill your window with it): the top bar slides
  off, the people keep a rail of arches at the right, and the dock tucks to the microphone, camera, Show everything and Leave. Show
  everything, ⌘⇧F or Esc brings it all back. Esc goes in the canvas's order: a menu, a sheet or a drag takes it first (they
  listen on `window`), then whatever's being edited keeps it (a field does what it does anywhere, so a rename is cancelled
  and the chat box keeps its words, and words selected in the document lose their format bar), then the list over the page
  goes, then focus. The workspace takes it in the capture phase on `document` and steps aside for all of those (`editing`
  in WorkspacePanel.tsx); with only the caret in the document, the editor never sees it, so the caret stays where it was.
- **When room runs out**, the people's column narrows with the call's area, and under 760 px of it they're a row of arches
  over the frame; your side is 340 px wide in a window under 1200 px, and where what's open would be left under 480 px beside
  it and the people, it sits over the stage instead; and two things on your stage with room for neither side by side nor one over the other take turns,
  with a switcher in the top bar. Under 600 px it's a phone: what's open fills the
  screen under a row of arches, two things take turns with the switcher under the arches, and your side, Share, More, a
  frame's name menu and Close's question are sheets over the call.
- **The people beside what's open.** They stand at the window's right edge, past your side, level with what's open and in
  the middle of their edge (`panels.ts`: `peopleEdge` decides their strip, `placeMain` the rest). They're a column of tiles
  sized to the call's area, or, made smaller (**⇧P**, stored as `hidden`), a rail of arches one arch wide (74 px) in the same
  place; in a call's area under 760 px, a row of arches over the frame, their name, mic and menu moved to a click on the arch.
  Their strip comes from the call's whole width, so your side never moves or resizes them: it opens between what's open and
  them (`HostSide.edge` in `PanelHost.tsx`), fading in where it lands, and what's open makes room; where that would leave the
  stage under 480 px, your side sits over the stage instead, left of the people. Their one control is the seam left of them
  (`PeopleSeam.tsx`, placed as `MainPlaced.seam`): the gap, with a faint grip in its middle, lit while you point at it, with a
  focus ring on the grip from the keyboard. Click it, or drag it 36 px right to make the people smaller or left to make them
  bigger; a drag the other way, or one that stops short, does nothing. There's none on a phone or a narrow stage, where the
  arches always stay (⇧P says so there), in focus, beside the organizer's rooms, or while your side covers the stage. As many as fit are shown, then a count that opens People, and the speaker
  (`speakers.ts`, so a quick "yes" moves nothing) and anyone with a hand up always have a place, with the speak ring or the
  gold one. Those there's no room for stay mounted, out of sight. Someone rung waits in a tile among the tiles; among arches
  they're in People. Beside what's open there's no stage to have a corner of, so your own picture is one of the people;
  hidden, its chip waits under the tiles. Nothing here changes while nothing is open: making the people smaller then says it
  applies once something is. A presented thing's tile (`PresentedTile`) stands first among them. A tile folding into an arch
  rounds off as it shrinks (the arch's 37 px corners transition with it) rather than snapping into a dome.
- **Toasts in a call** sit left of the dock from 1328 px, spaced as the canvas spaces them so that someone's share is offered
  on one line. Narrower, there's no room for one line beside the dock, so they go above it, in the middle. They never cover
  your side's foot, its composer and its buttons: while it's open they keep to the middle of the stage left of it and of the
  people at the window's edge (`--ic-right`, which InCall.tsx sets), and on a phone, with your side a sheet, they go to the
  top. Nor do they cover the pager at the foot of a
  board you present: they stand above it (all in `call.css`). What presenting says (who you're following, closed for you or
  for everyone, a share the organizer stopped) is built with `wsToast`, in the words the canvas's `nc.js` has. Each is about
  one thing on your stage (`topic`, `ToastOptions` in the kit's `toast.tsx`), and a newer one about the same thing takes the
  place of the one before, so "Closed for you. While Priya presents, its tile takes you back." never stays up once she's
  stopped.
- **Your view** (`view.ts`, laid out by `stageLayout.ts`) is each viewer's own and is never sent anywhere. There are no layout
  modes: the stage lays itself out (`arrange`), and what's kept is what you did to it: up to six pins, which share the main
  stage; the order you dragged people into; who you made bigger from a tile's corner; whether you made the people beside
  what's open smaller (⇧P); and where you see yourself (in the grid, in a corner the layout makes room for so it never covers
  a tile, or hidden, folded into a chip there). Beside what's open the people are the column or the rail that was kept, or a
  row of arches in a call's area under 760 px and on a phone, whatever was kept (`panels.ts`). Reset layout, in More while there's something to
  put back (`isCustom`), puts everything back as the stage lays it out (where you see yourself stays as it is, and what's
  open stays open), with Undo in its toast, as unpinning everyone has. Testers asked for preset layouts or tiles that
  snap to drop zones again (#227): both stay out, as #178 and #197 decided, and what's there is easier to find instead.
  The first time the pointer rests on a tile you can move (`TileHint.tsx`, watching the call's area, so `Stage.tsx` is
  untouched), a `Coachmark` under it says "Drag a tile to move it", and in the grid "Pull its corner to make it bigger";
  it stays while the pointer does, and goes as it leaves the tile or at the next press.
- **What's remembered where.** How you like calls (where you see yourself and its corner: `CallViewPrefsSchema`) is in
  `localStorage` for your account, `alcove.callView.<ownerId>` (one set for a browser without an account), because it's
  about you, not about anyone in a call. So is how you like the main area (`CallPanelsSchema`: whether the people beside
  what's open are hidden, and whether the workspace shows its list), `alcove.callPanels.<ownerId>`, so tomorrow's call
  starts the way you left this one; it never names a person, a call or a share. Both were written with layout modes
  before the stage laid itself out: a kept `mode` (Auto, Speaker or Grid) is dropped as the preferences are read, and the
  people kept as `arches` read as beside what's open (`tiles`), so nobody's kept choices are lost or refused, and the next
  save writes the current shape. Whether you've been told what a tile does is `alcove.callTileHint.<ownerId>`
  (`alcove.callTileHint` without an account), only `1` once it has. Your side isn't part of it: it shows one thing at a
  time, on the right, at a fixed width. A record that doesn't parse is ignored, a phone starts with your side closed, and a
  call just joined on a wide screen opens Notes while notes are on. How you arranged this call (pins, order, sizes, your
  side, where you were in the workspace: `CallLayoutSchema`) only means something in this call, so it's in `sessionStorage`
  for the tab, `alcove.callLayout.<callId>`: a reload keeps it, and leaving the call deletes it. It names people by their
  `seat` (`CallParticipant.seat`), not their participant ID: participant IDs are LiveKit identities, new for every
  connection (a reload is a new connection), while a seat is the same across someone's reconnections (a reload's pass
  carries their random `person`, and so does a move to another device; the organizer has one seat on any device; anyone else
  joining from a second browser without moving is a new person with a new seat). The API makes it when the call is read, a
  MAC of that `person` under a key for the call from the organizer's root, so nobody can work one out, it stores nothing
  new, and it differs in every call. Neither store holds a name, an address, or anything said or shared.
- **Nothing you chose moves by itself.** Someone you pinned who leaves keeps their pin and has it again when they
  come back to the same seat; you're told both times. With all six pins taken, pinning someone else gives up the
  oldest pin of someone who isn't here, and someone the organizer removes loses the organizer's pin, since they
  can't come back. Everyone keeps their place across reconnections (the order
  people first came in, by seat). Talking moves nobody: only a pin or the organizer's spotlight puts someone on the main
  stage (`arrange`), and whoever's talking has the speak ring. The stage used to put whoever had most of the last 45
  seconds' talk time there by itself; it switched between that and the grid well after anyone started or stopped
  talking, which read as the layout changing for no reason, so it went. A presentation that starts takes your stage
  only while you aren't watching another; otherwise it comes in as a tile, and nothing you see moves. Your pins stay first beside what's
  open, and when it closes everything is where it was. Cameras turning off move nothing.
- **Keyboard.** The stage is one tab stop. Arrow keys move between tiles, Enter (or Shift+F10) opens a tile's menu, P pins
  or unpins, and Shift with an arrow moves your corner picture to another corner (tiles move and grow by dragging); on a
  presented thing's tile, Enter, Space or P puts it on your stage. A share's frame is one tab stop
  too, where L starts pointing at it ([Pointing at shared screens](#pointing-at-shared-screens)). Escape stops pointing;
  then, once no menu or sheet is open, it leaves focus, then unpins everyone, then puts your side away. The call's own keys
  are M and V (microphone and camera), C (Chat), B (Mark this moment), W (Workspace), O (Board), ⇧P (make the people
  smaller or bigger), ⌘K (find in the workspace) and ⌘⇧F (focus), all in `session/useCallShortcuts.ts`; captions have none,
  and the letters sleep while you type. There's no sheet listing them: the keys just work. A share you
  bring back from its own window takes the keys back, on its frame or its tile (`useFocusBack`), so focus never drops to the
  page. Nor does it as your stage changes under the keys (`layout/landKeys.ts`): closing what's on it hands them to its
  tile while someone else still presents it, else to what opens it again (Board or Workspace at the top right, More on a
  phone, Share for your own screen); a tile pressed hands them to its frame, which says what it is, and Tab goes on to its
  bar; and Present, on a board, hands them to Next frame on the pager as soon as it's drawn, the workspace's to its frame.
  Keys that have moved on meanwhile stay where they are. On a board you present, ← and → move its frames. On someone
  else's share on your stage, + and − zoom, 0 shows the whole picture, the arrows move around while zoomed in (your pointer,
  while you point), F freezes it or goes back to live, and comma and full stop step through earlier pictures
  ([below](#looking-closer-at-a-share)). On touch screens a tile's ⋯ is always there.
- **Shares.** Several people can share at once, a screen each, and nobody's share replaces anyone else's. A share
  starts only while fewer than four (`MAX_SHARES`, `share.ts`) are going in your part of the call, yours counted:
  two sit side by side with Show beside and the rest are tiles, and past four the stage would give screens more room than people
  while every browser decrypts and decodes one more stream for each. The cap is the browser's, not LiveKit's: it's
  checked when Share › Your screen opens and again at the click that starts sharing, so people still choosing in their
  browser's own picker at the same moment can take it over, and the stage takes any number. While four share, Share's
  Your screen says so, and can't be pressed.
- **Seeing shares.** The stage keeps shares in the order they started here. A share is a presentation like a board or the
  workspace: it sits in the frame, which names whoever shares it, in the arch with their name (never by colour alone), and
  says when it carries sound. Its name menu has Point at it, Freeze the picture, Earlier picture, zoom, Mute its sound for
  you, Open in its own window, Put on the board (while the board in the call is beside it, for someone who can add to it)
  and a Show beside for each other thing presented ("Show Kofi's screen beside", while your stage holds one); on your own,
  Others can point at it, Clear marks and Change what you share, with Stop sharing on the bar. Two side by side are placed
  as the stage above says, with nothing between them to drag. Close on someone else's makes it a tile for you while they
  share, and Join on the tile brings it back. A share that leaves your stage goes back to live and lets its earlier pictures
  go, and everything about it goes when it stops.
- **A share starting or stopping.** A new share takes your stage, its frame rising into place, unless you're watching
  another presentation, when it comes in as a tile and a toast says who's presenting it, with Show it; when one on your
  stage stops, the toast says that too ("Priya stopped sharing."). The organizer can stop anyone's share for everyone (Stop
  it for everyone, in its name menu): the sharer's browser stops it, everyone's notice says who stopped it, and the
  organizer's toast says the sharer is told. Neither toast is said once the call has ended or while the room isn't
  connected, nor for a few seconds after it connects, reconnects or your part of the call changes (breakout rooms opening,
  closing or moving you), when shares come and go with the connection or the room.
- **Changing what you share** swaps the track inside the same LiveKit publication, so everyone sees it change in
  place, with their choices and its muting kept, rather than one share stopping and another starting.
- **A share's sound.** Anyone can mute the sound of someone else's share for themselves from its name menu (`CallRoom.muteShare`:
  this browser stops playing that track). It's kept by the share's picture's track sid, so it lasts while that share
  goes on, through a change of what's shared and through this browser's own reconnects; it's said on the share, and
  changes nothing for anyone else.
- **Sharing honestly.** Your frame's bar says you're presenting only once LiveKit has your screen (until then it says it's
  starting), and adds "with sound" while the capture's sound is live. Publishing reads LiveKit's current publication
  for each kind (after a full reconnect, the one LiveKit republished) and handles each kind on its own: a camera that
  won't publish never keeps the screen from trying, and only the screen's own failure is said. A screen that can't
  be published is stopped, if it's still the capture being shared, and you're told, with Try again. When the picture
  ends (the browser's own Stop, or the shared tab or window closing), the whole capture stops, sound included, and
  LiveKit unpublishes it, so it goes for everyone at once; a presenter who leaves or drops takes their share with
  them when LiveKit says they've gone.
- **Shared screens in the notes.** While notes are on or paused, the share steps ask **Include this share in the
  notes?**, on **No** until the presenter says **Yes** (their last answer in this call after that), without holding Share up. A kept share shows **Read for the notes** to everyone. The organizer chooses the model
  that writes the notes (**Notes written by**) under what's captured. A piece of video that can't reach the notes says so
  in the Notes panel ([Shared screens](#shared-screens)).
- **Captions** show the newest live transcript line the viewer may read (said in their part of the call while
  they were there), under whoever said it, translated for each viewer who picks a language. They show in
  breakout rooms too, each room its own, and say so instead of showing an old line while notes are paused or
  off, or while the host's browser can't listen.
- **Live notes** (the Notes tab in `Panel.tsx`) are the call's, not this browser's: `CallState.liveNotes`, one set for
  everyone who can read the same lines in that part of the call. While the tab is open and notes are on where you are,
  the browser says it's watching (`CallSession.watchNotes`), which is what keeps them up to date at most every 30 seconds,
  in one run however many are watching. Someone reading the notes everyone shares, who gets the notes, can tick a
  follow-up (`tickFollowUp`), and it's done for everyone, add one (`addFollowUp`), and add (or apply) or dismiss what
  the call suggests (`reviewFollowUp`), which waits under the checklist, two at a time. A guest's box is disabled, as is
  the box of anyone whose notes are written from what they may read, and they're told so
  ([Notes and inference › Live notes](notes-and-inference.md#live-notes)). Each row's arrow sends it to a document. A
  refresh that didn't work (`liveNotes.error`) turns the summary's time caution ("Not updated since 16:12"), with no
  notice: Alcove tries again on its own.
- **Catching up** (`CatchUp.tsx`, `catchingUp.ts`) is for the person asking alone. **Catch up on what you missed**, in
  More, opens Notes on the Ask tab on what they most likely missed (their recent time away, what was said before
  they joined late, or the last five minutes). In the Ask view a chip says what's read and opens a menu: the last 5
  or 15 minutes, before you joined, since you joined, while you were away, the whole call, or a stretch picked on
  the call's timeline (two handles, by pointer or keys; notes-off and paused stretches hatched, time away marked,
  and for a guest what they can't read dimmed). Each answer says the stretch it read, how many lines it read and as
  of when, and what can't be in it, all as times of day like the transcript's gaps. Each point carries its moments
  as time chips, to the second; one opens the transcript at that line, marked, with what was said around it, asked
  of the server again. In a breakout room it all reads what was said in the room while you were there. **Back to
  live** returns your side to how it was before catching up (closing it on a phone), and the transcript to
  following along; the viewer's own layout (pins, sizes, order, self-view) is never touched. Someone who comes back
  after time away, or joins well after the start, is offered a catch-up once, as a toast, decided when the call
  screen first learns their window; nobody is while notes have never been on, and a guest isn't, since they can't
  read what was said then. Nothing of it is kept: it goes with the page.
- **What carries over** (`FromLastTime.tsx`, `features/join/PrejoinCarry.tsx`) is for the person looking alone, from
  the notes their own account has: a fold at the top of the Notes view, **From last time**, open until the call has
  notes of its own, and the same in brief under the way in at the pre-join. A guest has no account, and someone with no
  notes from the series sees neither: nothing says there's a series. It isn't in the call's state. In the Ask view,
  **Earlier calls** beside **This call** asks across the series, with each answer's sources; it's there only for someone
  with written notes from it, waits while notes are paused, and an answer leaves the screen once the notes it read
  aren't yours any more. Sources open in a new tab, so the call carries on
  ([Notes and inference › Series](notes-and-inference.md#series)).
- **Notes.** They run in the browser of whoever hosts (`CallState.isHost`): the organizer's, or a stand-in's while
  the organizer is away, starting on the segment the server says and stopping the moment someone else hosts. While
  notes are on, the recorder and the live transcript hear everyone the host's browser plays in the main room, and in
  each breakout room the live transcript hears everyone its scribe's browser plays there (`hearsHere` in the call
  route): its own microphone and each other microphone in its part of the call (`CallRoom.heard()`, the raw
  decrypted tracks of unmuted microphones, so nobody's volume on this screen, nor the speaker chosen, changes
  what's heard). The recorder mixes them into one recording (`NotesRecorder` in `media.ts`), so playing the notes
  back sounds like the call and a guest's line points at a moment where they can be heard: each voice fades in
  when it's heard and out when it isn't (someone joining, leaving, muting, or a room move) while the same segment
  carries on, through a limiter so voices over each other don't clip. Once the host presses End or leaves it to someone,
  or the organizer turns notes off, the recorder is paused, the last audio and speech are sent, and nothing starts recording or listening
  again while the server ends the call or turns notes off (as people drop out of the room, or anyone mutes); if it
  can't, the same recorder carries on, so its pieces stay in order in the same segment. A scribe leaving sends its
  last speech first too. Each person is heard on
  their own (`CallEars` in `speech.ts`: one `SpeechClips` per voice, sharing one audio context and counting from
  the segment's start), so every clip says whose it is
  (`x-alcove-speaker`, a participant ID the server checks is someone in the call: not still asking, not turned
  away, not from another call), and every line is said by that person. A voice no longer heard (they left,
  muted, or a room move took them out of earshot) stops being listened to at once and sends what it had heard.
  Each clip also says how long ago it began (`x-alcove-ago-ms`), which the server turns into a moment on its own
  clock as the request arrives (never earlier than the speaker came into the call), and keeps it in the part of the
  call its speaker was in then, from where each person has been (the places module's `placeAt`), with rooms that
  have run out counted as closed: a clip still on its way when someone moves stays where it was said. A clip that
  began within the request's travel time before a move counts as said after it; a hearing browser moving ends
  every clip in progress (`CallEars.mark`), so none spans two parts and such a clip holds a fraction of a second at
  most. Nothing is heard while a browser is between two parts, or in a room the organizer paused (`CallEars.quiet`),
  and the host's browser hears nothing while it's in a room: that room's scribe hears it there.
  The recorder hears silence while the host is in a breakout room (`hush()`: one gain after the limiter, so
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
  (`features/call/notes/Capture.tsx`), the same card the pill beside Notes, on your side, opens: who changed the state
  and when, then one sentence on what's captured now, what everyone says recorded and transcribed, less whatever the
  host's browser can't do. It doesn't list the kinds of capture one by one: the sentence says what isn't working, in
  words. Then the asks, the organizer's **Pause notes**, **Resume notes** and **Turn off** or **Turn on notes**, or
  anyone else's **Ask for notes**, and a row each for how the notes are written (confidential compute, or
  **Unencrypted**), who gets them, shared screens while they're read and, for the organizer outside a breakout room,
  **Notes written by**. The pill says the same state in a word (**Live**, **Paused**, **Unavailable**, **Off**, or for
  the organizer how many asked), and Notes' bar and empty states carry the one thing to do about it. The transcript, in
  the call and in the note, marks each gap, and dots what it isn't sure of: words that were hard to hear, and a name
  heard on more than one microphone ([Notes and inference › The live transcript](notes-and-inference.md#the-live-transcript)).
- **Asks for notes.** The organizer gets a toast with Turn on (or Resume), and an Asking for notes section in
  People with Not now for each; everyone sees "Asked for notes" on the asker's row. Whoever asked hears when
  the organizer says not now. Joining shows only the latest notice as a toast; older ones are history.
- **Before joining.** Guests and invited people see what the call captures on the join page, before they ask
  and while they wait (`CaptureSummary` in `@alcove/ui`, from the card, refreshed every few seconds).
- **Breakout rooms.** The organizer opens rooms for anyone in the call. On the setup board in their side, everyone is
  dealt into the rooms, people invited first, so each room gets someone who can transcribe it where there are enough,
  and the organizer is **You** in the main room, over the rooms; anyone, You included, is dragged (or moved with the
  arrow keys) between the main room and the rooms, and opening sends invited people by address and guests by seat, and
  the organizer to the room You is in, if any (`useBreakoutRooms`, `Rooms.tsx`). With notes on, the board says when
  a room has nobody invited in it, so nothing said there will be transcribed, and, while You is in a room, that nothing
  said in the main room goes into the notes meanwhile. Who's in each room comes from `breakouts.open.rooms[].members`,
  and each browser tells the room whose media to play (`CallRoom.playOnly`), on top of holding only its own part's
  keys. The organizer sees the main room and every room in their side: who's in each, who's talking (LiveKit's speaker
  detection) and a raised hand as that room asking for help; it renames a room in place, and moves someone from their
  chip to another room or back to the main room, and sends whoever's in the main room (someone who came late, a guest,
  someone moved back) to a room; a room it paused says **Notes paused** on its card and on its box on the stage, as every
  room does while the whole call is paused. Escape in a room's name puts the old one back. Everyone else sees only their own room or the main room, with the time left and the organizer's
  messages, is told when the organizer comes into or leaves their part of the call or moves them, and sees "Moving
  you to…" while their browser changes groups. In a room, the notes sign, its popover, the Notes panel (whose
  controls stay the call's), captions, the transcript and Ask show the room's capture (`captureHere` in
  `lib/capture.ts`), since a room can be heard while the main room can't: the transcript marks the room's own gaps,
  and Ask waits while the room is paused. While notes are on, the toast that tells someone their room says that
  what's said there is transcribed for the call's notes, as the room's own section, as do the notes popover (which
  names whose browser transcribes the room), the Rooms panel and the call's privacy line; the scribe's browser
  says when it starts hearing the room. In a room, catching up says a stretch with nothing transcribed was one
  with no scribe there, not the host away.
- **Leaving and ending.** Anyone but whoever hosts leaves (`leave()` returns null) and goes back to the call's
  page. Whoever hosts chooses in the same sheet: **End call for everyone**, which deletes the room and disconnects
  everyone, who are told the call has ended, while the host's sheet follows the notes being written; or, when
  someone invited is in the call, **Leave and keep it going** with the best person chosen already to host until the
  organizer is back, and **Change** to pick someone else (`handOff`); the host then goes back to the call's page.
  For the organizer ending is the main button, for a stand-in leaving it going is. With nobody else who can host,
  the sheet says leaving ends the call. A browser that's
  removed, out of the group, or whose room ended is told, closes the session and leaves the room; one whose
  keys fell out of step, or whose connection dropped for good, is offered a reload.
- **Reconnecting.** The top bar says **Reconnecting** while the room's connection is coming back (signalling
  only, or everything) and while this browser is getting back into the call's group after a comeback. While the
  host's browser is out of the call, the notes sign says **Notes unavailable** ([Reconnects](#reconnects)).
- **Moving to another device.** **More › Move to another device** opens one dialog whose content changes in
  place (`features/move/MoveSheet.tsx`): the QR code and link, then the device that opened it, then letting go.
  Afterwards this screen says where the call went, with **Join again here** (and **Go to Home** when signed in).
  The new device's page is `routes/move.tsx` ([Moving to another device](#moving-to-another-device)).

## Looking closer at a share

Someone else's share on your stage can be zoomed into, moved around, frozen and stepped back through, or opened in its
own window: for you only, in this browser only. Nothing is sent, the presenter's screen and everyone else's view don't
change, and the server is never involved (`ShareSurface.tsx`, with `shareLook.ts` for the state and `shareFrame.ts` for
the coordinates). Your own share has none of this: you have the original.

- **Zoom and pan.** 100% is the whole picture, as big as it fits; + and − step through 125, 150, 200, 300, 400, 600 and
  800%, and pinching (a trackpad's, Safari's own pinch gesture, or two fingers), or Ctrl/⌘ with the wheel, zooms
  anywhere between, where the pointer is. A drag, or the wheel, moves around once zoomed in; a double-click goes to 200%
  or back to the whole picture; 0 (or the label, "200%") shows the whole picture again. While zoomed in, the bar stays up
  with the label and a minimap of where you are, which you can press or drag. The bar's buttons are for pointers and
  touch (on a phone a tap shows it); from the keyboard the keys on the focused share do the same, and its name menu lists
  them (Later picture while one is held, and Zoom out and See the whole picture while zoomed in), so its frame stays one
  tab stop. The keys are
  one table (`LOOK_KEYS`) that the share, its menu, its bar and `aria-keyshortcuts` all read. A new framing from a key, a
  button or the menu glides (instantly under reduced motion); a drag or a pinch follows the pointer, and the view
  changing size (the layout moving, your side coming or going) moves the picture with its frame at once.
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
  48 × 27 grey grid of `screenGrid.ts`: 0.6% of it moving, or all of it
  shifting a little (a new slide, a scroll or a window moved counts; a cursor moving doesn't). They're taken at most once
  a second from the video this browser already decodes to show the share, and only while that share is on your stage or
  in its own window. They're compressed (WebP, or JPEG from the first picture on where the browser can't write WebP, at
  most 4K) into ArrayBuffers in the page: never written to storage, a file or a Blob that's kept, never sent, never
  logged. A frozen picture is shown from a bitmap of the frame on screen, also at most 4K, so holding a 6K screen still
  costs no more than a 4K one: one such picture per share, apart from the 16 MiB, gone when you go back to live. The one
  line at the foot of the share's name menu says it: up to 30 earlier pictures stay in
  this browser's memory until the share stops, and nothing is saved or sent. Presenters are told in the share steps
  that everyone can zoom in and look back at its last 30 pictures, each on their own screen, until they stop.
- **Apart from the notes.** [Shared screens](#shared-screens) in the notes are video a presenter's own browser
  records of a share they put in them. These are pictures a viewer's browser keeps for that viewer alone,
  whatever the notes do; nothing of them reaches the API, unless that viewer puts one on a board ([Put on the
  board](#put-on-the-board)).
- **Never before you could see it.** Pictures come only from what this browser decrypts and shows, so none predates the
  moment you could see the share: after you were let in (the media keys move on as you join, so earlier frames can't be
  read), and only while you're in the same part of the call as its sharer (each part has its own keys, and another
  part's media is never attached).
- **When it goes.** Everything about a share goes the moment it leaves your stage: its sharer stops, leaves, is removed
  (LiveKit takes the share out of every room at once, and their pass can't get them back in) or drops out of the call's
  group (the MLS check stops showing it). All of it goes when this browser moves to another part of the call
  (`CallCrypto.place`: sent to a breakout room, back from one, or the organizer visiting one, each move a change of
  keys) and when you leave or are removed. A share leaving your stage (closed for you, or put away by something else
  you open) goes back to live and lets its earlier pictures go. A share's own window closes at the same moments. A presenter's
  Change swaps the track inside the same publication, so viewers can't tell a new surface from new content: pictures
  from before a change stay until the share stops.
- **Without earlier pictures.** While the organizer has paused notes nothing new is kept and what was kept goes (pausing
  stops every kind of capture), and they're kept again when notes resume. A device with little memory
  (`navigator.deviceMemory` under 2 GB) or a browser that can't draw or compress the picture keeps none either. Zoom,
  pan and freezing still work, and the menu says why there's nothing earlier.
- **Its own window.** Open in its own window (in the share's name menu, or on its bar) puts the share in a window of its
  own, to keep in view over other apps or put on another screen. Document Picture-in-Picture where the browser has it
  (Chrome and Edge 116+, Firefox 151+): an always-on-top window this page fills itself, which LiveKit's adaptive stream
  counts as on screen even while the call's tab is in the background. Elsewhere on a computer (Safari) a popup window, which
  can go full screen on another display; LiveKit pauses its picture while the call's tab is hidden, as it pauses every video
  then, and the window says so. Phones and tablets show shares in the call only, and the menu says that. One share at a
  time: its frame keeps its place, saying In its own window, with Bring it back, and the next share takes its place. The
  window has the share's own bar and keys, with the share focused as soon as it opens (and again when you come back to the
  window), so its keys work at once; Back to the call, Bring it back, or closing the window brings it back to its frame.
  It's a blank page that carries the call's own CSP, whose `base-uri 'none'` refuses a `<base>`, so the app's stylesheets
  are linked by their full address. It uses its own timers (so it keeps going while the call's tab is in the background),
  and nothing in it relies on the call tab's animation frames.
- **Comparing shares.** Two shares sit side by side ([The call screen](#the-call-screen)); each is zoomed, frozen and
  stepped back through on its own, so you can hold one still beside the other live, or open one in its own window on
  another screen beside the call.
- **Checked by hand,** with three people and two shares at once (Chromium, fake devices, the presenters sharing slide
  decks drawn on a canvas): zoom by keys, Ctrl and the wheel and dragging; freezing, stepping back and forward and back
  to live; Document Picture-in-Picture and the popup window, each closing as its share stopped, both also on the
  production build under production's CSP (no violation, styled, the share focused, focus back on the tile); a move
  into a breakout room; a 6K share held still at 4K; phone and wide stages, keyboard only and reduced motion; and memory
  over ten minutes of a share that changed every frame, which stayed flat once 30 pictures were kept.

## Floating call

The running call can expose a compact Document Picture-in-Picture presentation with the same controls and media ownership.
Its lifecycle, automatic-opening capability, attention scope and verification requirements are documented in
[Floating call](floating-call.md). The compact view shows a generic Chat attention count, including unread room-chat mentions,
and returns to the full call for exact-message navigation and reading. The full call's mention indicators use the person's
read receipts from the sealed call state.

## Room recordings

`POST /v1/recordings` creates a private note (`kind: room`, nobody invited) and a recording. In the app, Record
(`/record`) takes the name and opens the stage recorder (`/record/live`), which starts it. The name is handed over
in memory (`sessions.roomTitle` in `apps/web/src/lib/live.ts`), never in the address; the stage recorder opened
any other way (a reload, a link) starts with "Notes from the room". It records with or without a connection
([Recording without a connection](#recording-without-a-connection)). The browser records the microphone in 5-second pieces to
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

- **Starting.** `POST /v1/recordings {title?, startedAt?, owner?}`. Without `startedAt` the recording starts now.
  With it, the recording and its note start then. `startedAt` may be up to 14 days back
  (`MAX_RECORDING_AGE_DAYS`) and up to 5 minutes ahead of the server's clock, since a device's clock can
  run a little fast; anything else is `400 invalid`. `owner` is the account it was recorded under: a session
  of any other account gets `403 forbidden` before anything is looked up or made, so a recording kept on a
  shared browser never starts (or carries on) in whoever is signed in there now.
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

### Recording without a connection

The stage recorder (`StageRecording`, `apps/web/src/features/record/stage.ts`) keeps going when the connection
drops. Started with a connection, it starts on Alcove at once, at the server's time (no `startedAt`, so a device
clock that runs fast can't stop it), and that start is what's kept. Started without one, its start is the
device's, to the millisecond, and it starts on Alcove from then (`recordings.start({ title, startedAt, owner })`).
Either way the kept start is the one to carry on from later. Before anything starts on Alcove (here or in the
uploads), Alcove is asked who's signed in (`GET /v1/session`): only the account that recorded it goes on, and
`owner` makes the server refuse any other.

- **Kept on this device** (`apps/web/src/features/record/offline.ts`). From the start, the recording's name and
  start are kept in this browser's IndexedDB (`alcove-offline`), and its lock is held (Web Locks,
  `alcove-kept:<id>`) until it's finished or discarded. A piece or clip that can't be sent (no connection, a
  failed try, more than 15 s for a piece or 20 s for a clip, or a 409 because Alcove's copy is out of step) is
  kept there at once, exactly as it would have been sent: its segment, `seq`, `at`, duration, codec and bytes, so
  nothing waits in memory through more tries. Once one is kept because sending failed, the next go straight there
  for a while (15 s for pieces, 20 s for clips). A piece or clip that reached Alcove after all is stored once when
  it's sent again. `NotesRecorder` and `SpeechClips` take the place to keep them as `keep`; calls don't give one.
- **Sealed.** The name, the audio and the speech are sealed with AES-GCM under a non-extractable 256-bit key made
  in the browser and kept in the same database, with a fresh 12-byte IV per item and the item's place
  (`alcove/kept/v1`, kind, recording, segment and `seq` or start) as additional data. In the clear: IDs, the
  account's ID, times, lengths, sizes, the codec, and Alcove's refusal message if it gave one
  ([Privacy › On this device](privacy-keys-and-sessions.md#on-this-device)). The browser is asked once to keep the
  site's storage (`navigator.storage.persist()`) when the first item is kept. A full device pauses the recording
  and says so.
- **On Alcove when it can be.** Started offline, it starts on Alcove as soon as the connection is back (and every
  30 s while it isn't there), so new pieces and the live transcript go up from then on; renaming, pausing and
  resuming done meanwhile catch up (`pause`, `resume` and `rename` resolve once the server has them; every call
  to Alcove gives up after 20 s). What was kept stays kept until it's finished. Signed out meanwhile, or with
  someone else signed in on the browser, it keeps recording here and says so; signed out on this browser (which
  deletes what it kept for the account), it pauses and says nothing more of it can be kept.
- **Finishing.** It never records again once finishing has begun, even if finishing has to be tried again. The
  last clips are sent, or kept when they take more than 5 s, never dropped, and any pause, resume or name still on
  its way reaches Alcove first. With nothing kept and a connection, it stops on Alcove and opens the note, as
  before. Otherwise it's marked finished, its lock let go, and handed to the uploads, waiting up to 10 s so a short
  gap still ends on the note; past that, Record shows it under **On this device** and it finishes by itself.
  **Discard** deletes it here at once; whatever reached Alcove of it is deleted there now or, offline, when
  the connection is back.
- **Uploads** (`apps/web/src/features/record/uploads.ts`), the oldest first, when the app opens, when the
  connection comes back, when the page is looked at again, after a failed try (15 s, doubling to 5 minutes)
  and as the stage recorder finishes one. Each runs under the recording's lock, so two tabs never upload the
  same one and none is uploaded while a recorder has it; one whose tab closed mid-recording (nobody holds its
  lock) is finished as it is. In order: ask Alcove who's signed in (nobody, or another account: uploading stops,
  the recordings stay here and aren't listed, and the app goes to sign-in or catches up with who's signed in,
  asking again until it can; a 401 later does the same); start from its `startedAt` with its `owner` (carrying on with Alcove's copy if it
  got there); rename and resume it there if needed; every kept piece in `seq` order, every kept clip in order,
  and again for anything kept meanwhile; stop, only with everything sent; and only after the stop succeeds,
  delete it here. Cut off anywhere, the next try does it all again and still makes one note: pieces resent are
  stored once, clips heard before aren't transcribed again, stopping finishes once.
  - **What's left out**, and only this: a piece or clip Alcove says it can't take (400), one refused because the
    recording had already stopped there, and one Alcove refuses (409) in three runs while one after it got through
    each time, which shows the refusal is its own. A 5xx never counts: what the server fails (500, or a gateway's
    502, 503 or 504) stays here, isn't tried again in that run, and goes in a later one. A 409 from a recording
    still paused there (a pause on its way when the upload started) resumes it once and sends again. Any other
    failure, or three in a row, waits for the next try, and the recordings behind it still go, so one that keeps
    failing holds nothing up. A recording never stops with something unsent.
  - **What's never uploaded:** a recording whose start Alcove refuses says why on Record and is tried again later
    (a start in the future by this device's clock passes in time); one more than 14 days old that never reached
    Alcove is refused for good and can only be deleted. One that won't open on this device is never stopped or
    deleted by the uploads: Record says it can't be read here, and it can only be deleted. With its key gone nothing
    of it is sent. With one piece or clip damaged (it fails its schema, or won't open), what came before that item
    has already gone to Alcove, on a recording that stays unfinished with no note until this copy is deleted, which
    deletes it there too. A recording Alcove no longer has (its note was deleted, so starting again made a new one)
    isn't brought back: the new one is discarded, the copy here deleted, and a toast says so.
  - **Deleting from Record** asks first. What reached Alcove (or may have: a start whose answer never came) is
    deleted there too, through the same tombstone as **Discard**. When Alcove refuses that start (more than 14 days
    old, with nothing from that moment there), there's nothing to delete, and the tombstone goes.
- **One segment.** A recording on Alcove is never continued by a new recorder: after a reload, the old
  recording's kept pieces are sent unchanged, and new audio goes to a new recording.
- **"Record without a connection"** (`recordOffline`, on by default; this browser remembers it for offline use)
  off, or a browser without IndexedDB, Web Crypto or Web Locks: nothing is kept. Starting needs a connection
  ("You're offline, and recording without a connection is off in Settings."), and losing it pauses the
  recording, which can be resumed once it's back.

## Media in the browser

`apps/web/src/features/call/media/media.ts` owns one `LocalMedia` instance from pre-join through the call:

- `getUserMedia` with echo cancellation and noise suppression; camera off releases the camera. Noise
  reduction can be switched from the microphone menu (`applyConstraints` on the live track, so the recording
  and transcript carry on).
- **Backgrounds** (`media/backgrounds`, chosen in Background's window, `ChooseBackground.tsx` over `BackgroundModal` in
  `@alcove/ui`, opened from the pre-join and from Background in the camera's menu): Off, light (`mild`) or strong blur,
  three stable solid colors (Slate, Sand, Rose, from `CAMERA_COLORS` in `@alcove/ui`, shared with their swatches and never changed by theme),
  three of Alcove's pictures (balloons, beach, office; drawn in `packages/ui/src/backgrounds`), or up to six of
  your own. Alcove's matte (`matte.ts`, drawn by `matteGl.ts`) runs MediaPipe's multiclass selfie segmenter
  (256×256, which counts hair as the person) on this device and LiveKit's `ProcessorWrapper` (`@livekit/track-processors`) makes a new track of what
  it draws. The segmenter gives how sure it is that each pixel is the person; that's smoothed over time (slowly where
  it only wavers, at once where someone moves, so a still edge doesn't shimmer and a moving one doesn't trail), then
  sized up to the frame along the camera's own colour edges (a joint bilateral upsample), and the person is laid over
  the room blurred without them in it, or a picture cut to fill; `LocalMedia` keeps the camera's own track (`camSource()`, for
  its size) and shows and sends the drawn one, so the preview, your tile and the call all have it and nothing in
  `livekit.ts` changes. It happens before anything is encrypted or sent. A new camera track goes through the
  processor before it's put in, so what's behind someone never goes out for a frame; if the background can't be
  drawn the camera turns off and says so. A failure while processing frames discards those frames and turns the
  camera off too: the unprocessed camera is never a fallback. Turning the camera off or leaving while the model
  loads stops its input and output at once, closes the transformer, and releases the media queue. Late initialization and
  image/model results are fenced and disposed. A download or update stalled for 15 seconds fails closed too, without
  blocking a later explicit Off choice or camera restart. WebGL context loss is a processing failure.
  Support detection loads the processing code without a camera; the 16 MB model loads only when an effect is actually used
  (the service worker doesn't keep either), and the
  model (`public/mediapipe`) and its WebAssembly (served by a plugin in `vite.config.ts`, the version of
  `@mediapipe/tasks-vision` the app imports) come from Alcove's own origin: nothing is fetched elsewhere, and the policy allows
  `'wasm-unsafe-eval'` for it. The choice is remembered with the devices (`background` in `alcove.devices`; a
  browser that kept `blur: true`, or a blur without strength, keeps strong blur). Pictures of your own are made into 1920×1080 JPEGs and
  kept sealed in this browser for the account ([Privacy › On this device](privacy-keys-and-sessions.md#on-this-device));
  a missing/inaccessible picture turns the camera off, and a guest has none. Replacement validates, prepares and seals a new
  picture before replacing the original atomically, even at the six-picture limit; failures keep the original. A fresh
  storage revision invalidates in-flight reads in other tabs. Removing the active picture deliberately selects strong blur.
  Where the browser can't do it (no WebGL2, or no way to make a track from frames), Background explains that and offers
  Choose Off. A remembered effect keeps the camera off there; choosing Off clears it without starting the camera.
- **Effect processing budget** (`media/backgrounds/frameBudget.ts`): camera pixels are capped to a 1920-pixel long edge
  before GL upload; balanced caps it to 960 (540p landscape) at up to 20 fps, light to 640 (360p) at up to 12 fps.
  Full quality caps at 30 fps. Two slow two-second measurement windows lower one tier; eight fast windows restore one,
  preventing rapid oscillation. Expensive frames leave equal time for the rest of the call before another frame is processed.
  Skipped frames are closed without enqueueing anything, leaving the last safe processed frame; there is no raw passthrough.
  Blur spread scales with output resolution so its selected strength stays the same. A tier change isn't one of
  `MediaSnapshot.changes`, so nothing is said under the pre-join picker or as a toast in the call: nobody can act on it, and
  the effect stays on. `MediaSnapshot.backgroundQuality` keeps Background's window saying so under its preview while it's
  below full. No performance or effect preference goes to another service.
  Storybook serves the same installed WASM and model and exercises the actual pipeline with its drawn synthetic camera.
- The microphone, camera and speaker chosen last time are asked for first (`deviceId: { ideal }`). When one
  isn't plugged in, the browser's default is used and pre-join says so in a line under that device's picker (one change
  for each device, in `MediaSnapshot.changes`, until a device of that kind is picked). Choices live in `localStorage`
  (`alcove.devices`, parsed with `DevicePrefsSchema`) in this browser only; nothing about devices is sent.
  Browsers that hand out new device IDs (after clearing site data, say) start from their defaults again.
- **What to pick from** (`deviceChoices` in `media/devices.ts`, and `deviceOptions` for a Select): the call's menus,
  Settings › Audio and video and Record list the same rows. Chrome lists `default` (and on Windows `communications`)
  beside each real microphone and speaker, under the same device's name; they aren't rows. The device `default` points
  at (the one in its `groupId`, else the one with its name) says **Your system’s choice**, and is ticked while the device
  in use is `default` or nothing is chosen yet: the call follows the system then. Picking a device pins it (its own ID is
  remembered); while one is pinned, **Follow your system** goes last, and picks `default` again. Cameras, Firefox and
  Safari list no such entries, so their lists are the browser's own.
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
  same explanation (`apps/web/src/features/call/media/access.ts` holds the copy).
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
  with the background in use, without a word. Only while the camera is still on: one turned off meanwhile stays off. Each try waits
  longer, also when the camera doesn't open again, and a publish that works starts the count over. The new track is
  published as any other, at the size chosen (HD included).
- **Video quality** (`apps/web/src/features/call/media/VideoQuality.tsx`, under More → **Video quality**). Two choices,
  remembered in this browser with the devices (`sendVideo` and `receiveVideo` in `alcove.devices`), changeable at
  any moment of a call:
  - **Video you send:** 360p, 720p (the default) or HD 1080p. The camera is asked for that size (`VIDEO` in
    `media.ts`: 30 fps, 24 at 360p) when it opens. A change in the call goes to the running camera
    (`applyConstraints`, after any device work already asked for): a smaller size is the browser scaling it, and HD asks it for at least 1920×1080, then for the nearest
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
  - **Two feature flags** ([Feature flags](feature-flags.md)) change how a call's media goes, for whoever has them. The
    room reads them once, as it opens (`openRoom` takes their names, so retiring one finds every check): what the lobby
    read as the call's media code came down, or else the server's answer, waited for at most 1.5 s (`FLAGS_WAIT_MS` in
    `useCallRoom.ts`). Flags not read by then are off for that call, so joining is never held up by more; the log says
    so, and `joined the room` names the flags the room opened with.
  - **With `call.bandwidth_reduction`**, calls download less:
    - Cameras under Auto are capped by how big each picture of one is here (`CAMERA_MOST` in `livekit.ts`: each element
      `attach` plays it in is measured then, and after by the `ResizeObserver` of the window it's in, so the floating
      call's picture counts while the tab is hidden): one under 200 CSS pixels tall (or as tall as its width
      at 16:9), such as a big grid's or the column beside a share, asks for at most 180p (`setVideoDimensions`, in
      pixels, since a sender's own low, medium and high depend on the size they send; 180×180, so an upright camera
      is capped too). Only a picture crossing that step asks again. Each copy is downloaded by
      everyone who shows it, and 180p costs about 0.15 Mbps against 360p's 0.45.
    - A camera's 720p copy is sent at 1 Mbps instead of 1.7 (`CAMERA_CUT` in `livekit.ts`), whether it's the top copy
      (Standard) or the middle one (HD): a still face looks the same, and motion is blockier.
    - Microphones are published as speech (`AudioPresets.speech`, Opus at up to 24 kbps, with LiveKit's default DTX;
      LiveKit turns RED off under end-to-end encryption); a share's sound keeps LiveKit's music default.
  - **With `call.screen_share_quality`**, a shared screen is sent at up to 30 fps instead of LiveKit's 15, at LiveKit's
    own 2.5 Mbps and priority over cameras (its 1080p screen preset; `SCREEN` in `livekit.ts`), and with LiveKit's
    `maintain-resolution` for screens: scrolling that outruns the rate drops frames and text stays sharp, since blurred
    text shows more than a choppy scroll. It's sent as one copy at the screen's full size (`simulcast: false`), not
    LiveKit's full and half-size pair: adaptive stream counts at most 1.5 pixels to a CSS pixel, so with the pair a share
    frame under about 1000 CSS pixels wide on a Retina screen takes the half-size copy and blurs its text. A still screen
    costs the same; while it moves, a viewer with a small frame downloads up to the full rate. It's sent as VP9
    (`videoCodec: 'vp9'`), about 30% fewer bits than VP8 for the same picture; a sharer whose browser LiveKit won't send
    VP9 from (Firefox) sends VP8. LiveKit sends a VP9 screen as one layer (`L1T3`) with `contentHint: 'motion'`, working
    round Chrome's own path for screens, which holds that layer to 5 fps. LiveKit sets the hint only as it publishes, so
    sharing something else in place hands it on to the new track.
    - The screen sent is a clone of LocalMedia's track (`publishScreen`), so that a change of codec can put up a second
      copy of the same capture. Stopping LocalMedia's track doesn't end a clone, so the room stops it itself the moment
      its track isn't the one shared any more (`follow`), a clone still being published included: a share stopped or
      swapped stops being sent at once, as it does without the flag.
  - **VP8 while anyone can't decode VP9.** Under end-to-end encryption LiveKit sends no second codec beside the first, so
    a viewer that can't decode VP9 (Safari or iOS before 16) would see nothing. Such a browser says so on its own data
    topic (`CALL_CODECS_TOPIC` in `packages/api/src/calls/codecs.ts`, sealed like marks, every 10 s, whatever its flags;
    browsers that decode VP9 say nothing). It's the one thing said there (`{ vp9: false }`), and whoever says it counts
    until they leave the room, so nobody can make a share go back and forth. While anyone it hears can't decode VP9, a
    sharer with the flag sends its screen as VP8 with LiveKit's own screen settings, as a screen goes without the flag
    (unless LiveKit is sending it as VP8 already). A change of codec publishes the new copy before taking the old one
    down, and the sharer isn't asked to pick a screen again; it goes back to VP9 once they leave. A switch that failed is
    tried again when they next say it, and a full reconnect, which LiveKit starts by saying everyone left, forgets nobody:
    someone counts as gone only once they're still gone with the room connected, and a browser that can't decode VP9
    says so again as soon as it's back. A viewer still sees the share stop for a moment (the stage's end
    animation) and come back, since it drops the old copy before the new one arrives. The picture's track sid changes, so
    pointers and marks on it start afresh, and a viewer who muted the share's sound hears it again.
    - **Switching it on.** A browser on an earlier release never says it can't decode VP9, so switch
      `call.screen_share_quality` on only once nobody can still be on one: Safari or iOS before 16 would see a flagged
      share black. A viewer without VP9 who has just joined can see a VP9 share black for up to 10 s, until what it says
      gets through.
- **Speakers.** Where a page can choose one (`setSinkId` on media elements: Chrome, Edge and Firefox; LiveKit
  doesn't on Safari), the chosen speaker goes through LiveKit's own output switching, so every element plays
  there, now and as people arrive, and LiveKit's device handling knows it. Firefox lists speakers only once the
  page has used the microphone. A chosen speaker that's unplugged falls back to the system's, and is used again
  when it's back. Where a page can't choose (Safari), the menus say calls play through the speaker the system
  uses, and where to change it.
- **Each person's volume, for you** (`apps/web/src/features/call/media/volume.ts`). From 0 (muted for you) to 100%,
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
- The microphone test (`MicTest` in `apps/web/src/features/call/media/devices.ts`, one for each `LocalMedia`, so a menu
  that closes and opens again shows where it's got to) records three seconds in memory and plays them back through
  the chosen speaker. Nothing is uploaded or kept. It's in the microphone's menu before joining only: in the call the
  microphone is live, published to the room and heard by the notes, so a test there couldn't say nothing leaves.
  **Play a test sound**, under the speakers (the speaker's own picker before joining, the microphone's menu in the
  call), plays a short chime through the chosen speaker.
- `getDisplayMedia` for screen sharing (`shareScreen`), opened on the kind picked in Share › Your screen (a tab, a window or
  your whole screen), from the click itself (Safari and Firefox need that), with the call's own tab left out of the
  browser's picker. It captures nothing but what's picked: sound only when asked for (a tab's, or the computer's on a whole
  screen), and with `restrictOwnAudio`, so where the browser knows that constraint the computer's sound never carries the
  call's own (everyone's voices). Share › Your screen offers sound only where the browser can share it (Also share the tab's
  sound, or your computer's on a whole screen): Chrome and Edge share a tab's sound, Firefox and Safari share none. Ending
  it from the browser's own control updates the call.
- Why a share didn't start is read from the browser's refusal (`share.ts`): closing the browser's picker says nothing;
  Chrome's "Permission denied by system" is the computer refusing (macOS without Screen & System Audio Recording permission:
  Share › Your screen comes back saying where to allow it, with A tab picked, which needs no permission); a refusal faster
  than anyone could answer a picker is the browser or a policy blocking it; the rest are nothing to share, the capture held
  by another app, or a failure to try again. Each comes back in Share › Your screen with what to do. A browser without
  `getDisplayMedia` (phones and tablets) is told it can't share and can still see shares. Sound asked for that didn't come
  (the browser picker's own switch was off, or the computer wouldn't share it) is said, with Change.
- A Web Audio analyser drives the mic meter (in the microphone picker before the call and beside the microphone
  in its menu), the speaking ring and the recorder's voice on the water (`useVoice`, which changes CSS variables
  and never renders). It listens to a copy of the microphone that stays on while the microphone is muted, which goes
  nowhere but the analyser, so a muted microphone still knows when you talk: a couple of seconds of talking says
  "You're talking on mute" at the top of the call, with Unmute (`useTalkingOnMute`, in `media/useSpeaking.ts`), and it
  rests 45 seconds after saying so. The meter itself reads nothing while you're muted. On Record the page has its own `LocalMedia`, which
  opens the microphone only when **Check the level** is pressed and lets it go on **Stop** or when the page is
  left; choosing a microphone while it's closed only remembers it, and one that doesn't start while it's open
  says so and isn't shown as chosen.
- Sound the browser won't play until the page is clicked (Safari, when nothing is being captured) is said in the
  status bar for as long as it lasts, with **Play sound**, and every click, tap or key tries again
  (`CallRoom.startAudio`) until it plays.
- `NotesRecorder` picks the first supported codec (Opus in WebM, then MP4, then Ogg) at 32 kbps. It records
  through a Web Audio graph (a `MediaStreamAudioDestinationNode` behind a limiter) that mixes its voices: the
  microphone in a room recording, everyone the host's browser hears in a call. Switching microphones, and
  voices coming and going, carries on in the same recording instead of going silent or starting again;
  MediaRecorder can't change its input track. It keeps recording through a dropped connection and sends what it
  held once it's back (above); on the stage it keeps what it can't send on this device instead
  ([Recording without a connection](#recording-without-a-connection)).

Beside it, `SpeechClips` (`apps/web/src/features/call/notes/speech.ts`) feeds the live transcript: an
AudioWorklet (`apps/web/public/pcm-capture.js`) mixes the microphone to mono, filters and resamples it to
16 kHz, and the samples are cut into WAV clips at pauses. Clips without a voice in them aren't sent. It
never touches the encrypted recording.

## Next

- **The moments before someone takes over.** Between a host's connection dropping and someone else hosting (about
  10 seconds after LiveKit notices), nothing is captured; the notes don't mark that stretch as a gap yet.
- **A room committed by one of its own members**, so that whoever hosts holds a breakout room's keys only while in it
  (Zoom's model): each group's committer would be one of its own people, rather than the host's browser for all.

## Call sounds

Short call cues, their audience, output isolation and preference upgrades are documented in [Call sounds](call-sounds.md).
