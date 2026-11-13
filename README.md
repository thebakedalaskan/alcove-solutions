<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.svg">
    <img alt="Alcove. Your meeting superapp. Powered by confidential AI." src="docs/readme/hero-light.svg" width="100%">
  </picture>
</p>

<h3 align="center">The whole meeting in one app, with AI that runs in verified hardware enclaves.</h3>

<p align="center">
  <a href="https://alcove.solutions"><img alt="Try it at alcove.solutions" src="docs/readme/try-it.svg" height="44"></a>
</p>

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/badge-tee-dark.svg"><img alt="Runs in Confidential Space · Intel TDX" src="docs/readme/badge-tee-light.svg" height="28"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/badge-ai-dark.svg"><img alt="Private inference · NEAR AI" src="docs/readme/badge-ai-light.svg" height="28"></picture>
  <br>
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/badge-e2ee-dark.svg"><img alt="End-to-end encrypted calls · MLS" src="docs/readme/badge-e2ee-light.svg" height="28"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/badge-sigstore-dark.svg"><img alt="Signed images · Sigstore" src="docs/readme/badge-sigstore-light.svg" height="28"></picture>
</p>

<p align="center">
  <a href="#what-you-can-do"><b>What you can do</b></a> ·
  <a href="#how-it-works"><b>How it works</b></a> ·
  <a href="#run-it-yourself"><b>Run it yourself</b></a> ·
  <a href="#built-at-near-hackathon"><b>NEAR HACKATHON</b></a> ·
  <a href="docs/README.md"><b>Docs</b></a>
</p>

<br>

## Architecture overview

Call media is end-to-end encrypted in the browsers, so LiveKit, the media relay, only ever carries ciphertext. While notes
are on, the host’s browser also sends what it hears to Alcove’s server, which runs in a confidential VM on Intel TDX: TLS
ends inside it, Cloud KMS releases its master key only to an attested image signed with Alcove’s key, and your browser
checks the attestation before it shows the seal. Everything the server stores is sealed under keys for each account, and
it sends AI work to NEAR AI’s models only after checking their hardware evidence. [More in How it works →](#how-it-works)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/architecture-dark.svg">
    <img alt="Architecture: browsers send end-to-end encrypted media through LiveKit; Alcove's API runs inside Google Cloud Confidential Space on Intel TDX, with its key released by Cloud KMS only to the signed image; Postgres and the object store hold ciphertext; NEAR AI's models run in verified enclaves and receive requests sealed with Oblivious HTTP." src="docs/readme/architecture-light.svg" width="100%">
  </picture>
</p>

<br>

## Why Alcove

A meeting today is spread across several tools, and every one of them can read it:

1. **The video app** (Meet, Zoom), whose own AI reads everything said.
2. **A note-taker bot** someone brings in: a third party sitting visibly in the call.
3. **The whiteboard, the docs and the scheduling link** around the call: more companies holding your conversations.

Alcove brings the whole meeting into one app (the call, the board, the docs, the notes and the follow-ups) and backs its
privacy with hardware evidence anyone can check, not only a policy: your browser checks what Alcove’s server runs on and
shows you the result, and the server checks what the AI runs on before sending it anything.

<p align="center">
  <img src="docs/readme/call.gif" alt="A design review in Alcove: as people talk, each line lands in the transcript under who said it, the live notes keep up with what was decided, and the seal shows the call is sealed." width="100%">
</p>
<p align="center"><sub>A design review in Alcove. Every line lands under who said it, the live notes keep up, and the seal says what’s sealed.</sub></p>

> [!TIP]
> **Use it now at [alcove.solutions](https://alcove.solutions).** Sign in with Google: sign-up is open to any Gmail or
> Google Workspace address. Every account starts on Free: unlimited calls of up to 10 hours and 100 people, about 5 hours
> of notes every 30 days, and 10 GB of storage. No Google account? [Run it yourself](#run-it-yourself) with a demo
> sign-in, or open every page in Storybook with no account at all.

<br>

## What you can do

| In the call | Between calls | Underneath |
| --- | --- | --- |
| [Private notes as you talk](#private-notes-written-as-you-talk) | [Ask every call](#ask-every-call) | [End-to-end encrypted calls](#calls-are-end-to-end-encrypted) |
| [Catch up on what you missed](#catch-up-on-what-you-missed) | [Find a time](#find-a-time) | [Confidential compute](#the-server-runs-in-confidential-compute) |
| [Whiteboards](#whiteboards-inside-the-call) | [Record in the room, offline](#record-in-the-room-even-offline) | [Sealed storage](#everything-stored-is-sealed) |
| [Breakout rooms](#breakout-rooms) | [Your AI agents, over MCP](#your-ai-agents-on-your-terms) | [Verified private AI](#ai-runs-on-verified-private-models) |
| [A workspace for every call](#a-workspace-for-every-call) | [Pay with USDC](#pay-with-usdc) | [Verify it yourself](#verify-it-yourself) |
| [Make the call yours](#make-the-call-yours) | | |

### Private notes, written as you talk

<img src="docs/readme/the-note.gif" alt="A call's page after it ended: the seal lists which verified private models transcribed the call and wrote the notes, then a decision is confirmed and a follow-up taken on." width="100%">

New calls take notes unless you turn that off, and whether a call takes notes is set when it’s scheduled, so everyone
knows before they join. While it runs, Alcove writes a live transcript under each speaker and keeps live notes of what’s
decided, suggested and still open. When it ends, everyone invited gets the note: a summary, decisions, open questions,
follow-ups and chapters, each pointing at the moment it was said. Decisions stay proposed until someone confirms them, and
a follow-up is only a suggestion until the person it’s for takes it on.

> **How it works.** The host’s browser, which hears everyone, decrypts the call’s audio like any member and sends it to the
> API as short speech clips and 5-second audio pieces, sealed on arrival; this audio is outside the media encryption.
> Before NEAR AI gets anything, the API checks the model’s hardware evidence with a fresh nonce: an Intel TDX quote
> verified to Intel’s root, the exact measurements of the published OS image it booted, NVIDIA’s attestation of
> confidential GPUs for the same nonce, and a signature by the attested key over the model’s encryption key. Only then is
> the request sent, sealed with Oblivious HTTP (RFC 9458) to that key: Whisper large-v3 transcribes, and the notes model
> (DeepSeek V4.1 Flash by default) writes. Each note records which model did each task and what was checked.
> [Notes and inference →](docs/engineering/notes-and-inference.md)

### Catch up on what you missed

<img src="docs/readme/catch-up.gif" alt="Joining a call seven minutes late: Catch up shows a summary, what was decided and what's next, each with when it was said, and a moment opens the transcript at that line." width="100%">

Join late or step away, and **Catch up** tells you, and only you, what you missed: what was decided, suggested, still open
and next, each point with the moments it was said. Ask about any stretch of the call while it’s still going.

> **How it works.** Catch-up reads only the lines you’re allowed to read (your time away, the minutes before you joined, or
> a range you pick) and asks the call’s notes model the same way the notes do: sealed to a verified private model unless
> the organizer chose one outside an enclave. Nothing is stored unless you keep an answer in your own notes, and a guest
> who came in by link catches up only on what was said while they were there.

### Whiteboards, inside the call

<img src="docs/readme/board.gif" alt="A whiteboard open in a call: other people's pointers and stickies arrive, and the private model turns what was said into stickies." width="100%">

Open a board in the call and everyone works on it at once, guests too: stickies, shapes, connectors, frames and votes,
with the call’s timer above it. It’s only on your screen until you present it; then everyone follows you, and anyone can
step away to work alongside. **Ideas from the call** turns what was just said into stickies, and **Sort into themes**
groups them.

> **How it works.** A board is a Yjs document whose shape and rules live in [`packages/board`](packages/board), shared by
> the app and the API. It’s sealed at rest under its workspace’s keys, and the server only ever runs Yjs inside worker
> threads. Pointers and presence travel as awareness. Ideas and themes always come from the default verified private model,
> and an idea must point at a line that was actually said, or it’s dropped; the words shown under it are that line’s.

### Breakout rooms

<img src="docs/readme/breakout-rooms.gif" alt="The organizer drags someone into a room, sets ten minutes and opens two breakout rooms; the stage splits into each room with a countdown, then everyone comes back." width="100%">

The organizer drags people into rooms, sets how long they last and opens them, and the stage splits into each room with a
countdown. Rooms can each have a board or share one, and when everyone comes back, each room’s talk is its own part of
the notes.

> **How it works.** Each room is its own MLS group, so a room’s media keys and chat are shared only by the people in it and
> the host’s browser, which makes every room’s group and commits who’s in it. Each room with someone invited in it has its
> own scribe for the transcript (a room of only guests isn’t transcribed), and when the rooms close, each room’s board
> comes back and goes into the note. [Calls and recordings →](docs/engineering/calls-and-recordings.md)

### A workspace for every call

<img src="docs/readme/workspace.gif" alt="The call's workspace opened beside the people: live notes pages, and a document written together with a mention." width="100%">

Every call gets a workspace: its notes, follow-ups and transcript land in the call’s folder as live pages, beside documents
your team writes together in real time, with mentions, comments, history and writing offline. In a call it opens just for
you, beside the people, and you can present it so everyone follows along.

> **How it works.** Documents are Yjs documents edited through the API’s live streams, sealed at rest under the workspace’s
> own root key, and opened on the server only in worker threads. What you write offline stays in your browser, sealed under
> a key that can’t leave it, and is sent when you’re back. Find searches every document you can open in the workspace
> inside your browser, so what you type goes nowhere.

### Make the call yours

<img src="docs/readme/make-it-yours.gif" alt="In a call: reactions float up from the foot of the call, a tile is dragged into first place for your view only, and your status is set to Be right back." width="100%">

There are no layouts to choose: the stage arranges itself, and you pin people, drag tiles, make one bigger, set your status,
nudge someone quietly, raise your hand, react, or, while notes are on, read captions in your own language.

> **How it works.** Hands, questions, votes, nudges and statuses are part of the call’s sealed state, and a nudge reaches
> only the person nudged. Reactions and pointers go between browsers encrypted with keys derived from the call’s MLS
> secrets, so neither Alcove’s server nor the media relay can read them. Your arrangement stays in your browser.

### Ask every call

<img src="docs/readme/ask.gif" alt="Search or ask: a question across every call, answered with citations to the moments it came from; pressing one opens the call at that moment." width="100%">

Press <kbd>⌘</kbd> <kbd>K</kbd> to find what anyone said in any call, or ask a question across all of them. The answer
cites the moments it came from; press one and the call opens at that line.

> **How it works.** Questions travel in the request body, never in a URL or a log line. The server opens the notes you
> have, picks the 12 that share the most words with the question (rarer words count for more), sends them to the model
> you chose in Settings (the verified private one, sealed, unless you picked another), and checks every citation against
> what it sent, so a moment the model makes up is dropped. Questions and answers are stored nowhere.

### Find a time

<img src="docs/readme/schedule.gif" alt="Scheduling a call: Calls opens beside the week, Priya and Kofi are added, their busy time is hatched in and the call moves to the soonest time they're all free, then it's scheduled for tomorrow at 14:00." width="100%">

Press <kbd>N</kbd> to start a call now or schedule one. Scheduling opens on Calls, beside your week. With Google Calendar
connected, add people and the busy time of anyone whose calendar you can see is hatched in, and the call moves to the
soonest working half hour you’re all free. Schedule, and Google Calendar sends the invitations; without it, you get a
link to share. Calls that repeat form a series, and what one call decided and left open is waiting in the next.

> **How it works.** Busy times come from Google Calendar’s free/busy for the calendars your Google account can see,
> usually your own company’s, and the app says whose it counted. Alcove keeps the call’s title, guests and times as sealed
> records, and the event on your calendar is what invites people. Notes are set when a call is scheduled, so everyone
> knows before they join.

### Record in the room, even offline

<img src="docs/readme/record.gif" alt="Recording an in-person conversation: the sun rises with the voice and lines land, the connection drops and it keeps recording, and it's saved on the device to upload later." width="100%">

Record an in-person conversation into the same kind of notes. If the connection drops, it keeps recording on your device
and uploads when you’re back.

> **How it works.** Online, the recorder sends audio and speech to the API as it goes, sealed on arrival. Without a
> connection it keeps them on the device, sealed with AES-GCM under a key made in the browser that can’t be exported
> (IndexedDB, never sent), holds a lock while it records, and uploads the pieces in order once there’s a connection. The
> server takes them only from the account that recorded them.

### Your AI agents, on your terms

<img src="docs/readme/agents.gif" alt="The Agents page: connecting Claude over MCP, lowering what it may do with calls from see and book to see, and allowing it." width="100%">

Connect Claude, ChatGPT, Cursor, VS Code, Claude Code or Codex to your meetings. You see exactly what an agent asks for
and can allow less, part by part; every agent stands on the page with what it did, and you can change or disconnect it at
any time.

> **How it works.** Alcove is a remote MCP server at `https://api.alcove.solutions/mcp`, with OAuth (authorization code and
> PKCE S256, with dynamic client registration) or personal tokens. Its 30 tools are granted by scope (`notes:read`,
> `notes:write`, `notes:share`, `notes:delete`, `meetings:read`, `meetings:write`, `calendar:read`), and an agent never
> gets more than you can see yourself. OAuth connections last 30 days and personal tokens 7, 30 or 90, unless you keep
> them longer; refresh tokens rotate (a reused one revokes the connection), and every tool call an agent completes is
> listed for you alone for 30 days. [Agents and MCP →](docs/engineering/agents-and-mcp.md)

### Pay with USDC

<img src="docs/readme/checkout.gif" alt="Checkout: a year of Pro, paid in USDC on NEAR to a one-off address shown as a QR code; the payment is seen, arrives, and Pro begins." width="100%">

Every plan has calls, workspaces and confidential compute; plans differ in hours of notes and storage. Pro and team
licenses are paid in USDC from the network you choose, with no card on file, and nothing renews by itself unless you turn
it on.

> **How it works.** Checkout asks NEAR Intents 1Click for a real quote (not a dry run) whose recipient and refund address
> are both Alcove’s treasury account on NEAR Intents (`alcove-treasury.near`), and shows you its one-off deposit address.
> Alcove follows the deposit through 1Click’s status API; once 1Click reports it settled as USDC in the treasury, it’s added
> to your balance at face value, once, and the purchase is made. If less arrives, the same address waits for the rest; if
> more arrives, the rest stays in your balance. Billing is sealed under a separate service key that can’t open anyone’s
> content. [Plans and usage →](docs/engineering/plans-and-usage.md)

### And so much more

| In the call | With the notes | Everywhere else |
| --- | --- | --- |
| **Chat** with threads, private messages and mentions | **Notes from shared screens**, linked to what was said | **Teams** with licenses and shared workspaces |
| **Screen sharing**, several at once: zoom, freeze, step back | **Series** that carry decisions into the next call | **Google Calendar** invitations, with Alcove’s changes and cancellations sent on |
| **Pointers and marks** on a share, end-to-end encrypted | **Share notes** with an address, a group, or a 7-day link | **Google Drive** exports, with your consent |
| **Captions** in your own language, while notes are on | **Your own notes** beside the shared ones | **Notifications** for calls, notes and follow-ups, while Alcove is open |
| **Raise hand**, questions with votes, spotlight | **Correct the transcript**, then rewrite the notes | **Ringing** your team into a call |
| **A timer** everyone sees, and a **floating call** (Chrome and Edge) | **Bookmarks** on a line or a shared screen | **Move a call** to another device with a QR code |

<br>

## Built at NEAR HACKATHON

Alcove was built during [NEAR HACKATHON](https://nearhackathon.com) in November 2026. The repository’s history starts
on 2 November 2026 with a plan ([its first commit](https://github.com/thebakedalaskan/alcove-solutions/commit/2aa9b86a8)),
so all of it is hackathon work, built on the open-source libraries listed in [Built with](#built-with) and the
`package.json` files. Most of the code was written with an AI coding agent, Claude Code, and nearly every commit says so
in a Co-Authored-By line (1,328 of the 1,361 that aren’t merges, on 13 November).

**Tracks:** Privacy & Private AI (private inference on NEAR AI Cloud, and a server in a TEE), and Real-World Money (plans
and team licenses paid in USDC through NEAR Intents).

**Where NEAR fits**

- **NEAR AI Cloud, for private inference.** The live transcript (Whisper large-v3) and the notes (DeepSeek V4.1 Flash
  by default) are written by models NEAR AI runs in confidential VMs, on Intel TDX with NVIDIA confidential GPUs. Before
  sending a model anything, Alcove’s server checks its hardware evidence itself, then seals each request to the model’s
  attested key with Oblivious HTTP. Speech always goes this way, and so does everything else unless someone picks a model
  NEAR AI doesn’t run in an enclave, which the app marks ([how](#ai-runs-on-verified-private-models)). This is what
  lets Alcove’s AI work on a meeting while the meeting stays inside verified hardware.
- **NEAR Intents 1Click, for payments.** Pro months and team licenses are paid in USDC from the network you choose (NEAR,
  Ethereum, Solana, Base, Arbitrum, Polygon, BNB Chain, Optimism or Avalanche), to a one-off deposit address 1Click
  opens for the payment. Whatever arrives is settled as USDC in Alcove’s treasury account on NEAR Intents, and Alcove
  credits it once 1Click reports it there ([how](#pay-with-usdc)).

**Where to look in the code:** each NEAR AI, 1Click and TEE feature, and the tests that check it, mapped to its
files [near the end of this page](#where-to-look-in-the-code).

**Try it: do this, see that**

1. Open [alcove.solutions](https://alcove.solutions) and press **Continue with Google** (any Gmail or Google Workspace
   address). Alcove makes your account on screen, then shows the plans once: press **Continue on Free**. You land on
   Home, and a short tour starts; close it with **Skip tour** when you’ve seen enough.
2. Look at the foot of the side panel: **Confidential compute · verified**. Your browser checked the server’s
   attestation token and its image’s entry in Sigstore’s public log itself; point at it to see when.
3. Press <kbd>N</kbd>, then **Start now**, allow your microphone, and press **Join** in the lobby. **Notes on** shows at
   the top left, after the call’s name and clock: new calls take notes unless you set **Settings › Calls and notes ›
   Notes for new calls** to Off.
4. Talk for half a minute, with a decision and a to-do in it. Open **Notes** at the top right: your lines appear under
   **Transcript**, labelled **You**, and the **Notes** tab fills in within about 30 seconds. Point at the shield beside
   **Notes on**: it says what’s sealed, when the hardware was checked, and that Alcove can’t read the call.
5. Press **Leave**: when you’re alone, it ends the call at once, and the call’s ended page opens. Within about a minute
   the note is written; press **Read the notes** (it says **Open the notes** while they’re being written) to see the
   summary, with any decisions and follow-ups. Under the title, press **Written in confidential compute** to see which
   NEAR AI model did each task and when its hardware evidence was checked.
6. Press <kbd>⌘</kbd> <kbd>K</kbd> (<kbd>Ctrl</kbd> <kbd>K</kbd> on Windows and Linux), type a question about the call
   and press <kbd>Enter</kbd> to ask it. The answer cites the moment it came from; press it to open the call at that line.
7. From a clone, after `pnpm install`, run the check in [Verify it yourself](#verify-it-yourself). It prints the commit
   and the image production runs; the commit is main’s newest deployed one.
8. Without an account or any keys, `pnpm install` then `pnpm storybook` opens every page and journey of the app on
   made-up data, at http://localhost:6006.

No Google account? Steps 7 and 8 need none, and [Run it yourself](#run-it-yourself) runs the whole app on your machine
with a demo sign-in (steps 4 to 6 need a NEAR AI key there too).

<br>

## How it works

The goal: readable content exists only in the browsers of the people it belongs to, inside Alcove’s server process while
it works on it, and inside the verified AI enclaves it sends work to. Everything else (the database, the object store, the
media relay, the logs, the network) sees ciphertext and metadata, unless someone with access sends it elsewhere: to a model
outside an enclave, Google Calendar, a Drive export or a connected agent. The [architecture overview](#architecture-overview)
shows the whole path; here’s how each part holds, and [Known limits](#known-limits), at the end, says where it doesn’t yet.

### Calls are end-to-end encrypted

Every browser in a call is an MLS client ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420), via ts-mls), guests
included. Keys are made in the browser and never leave it. Each sender’s media key is exported from the group for every
epoch, and frames are encrypted before they leave the device (a browser that can’t is refused, never sent in the clear),
so LiveKit relays ciphertext and Alcove’s server orders and passes on MLS messages it can’t read. The host’s browser
commits who’s in, removes whoever leaves, and rotates the keys every 10 minutes even when nobody comes or goes. While notes
are on, the host’s browser also sends what it hears to the API, outside the media encryption
([The life of a note](#the-life-of-a-note)).

### The server runs in confidential compute

The API and the web app ship as one container image. CI builds every release from main, signs it with cosign using a
Cloud KMS key, and logs the signature publicly in [Sigstore’s Rekor](https://docs.sigstore.dev/logging/overview/). The API
runs only in Google Cloud Confidential Space on Intel TDX; the same image also runs database migrations as a Cloud Run
job, which gets the database and no keys.

- **The master key** is made inside the VM. Cloud KMS releases it only to a VM that attests to Confidential Space’s
  production image on Intel TDX, with debugging off, running an image signed with Alcove’s key.
- **TLS ends inside the VM**, with a key derived from the master, and a CAA record pins certificate issuance to the VM’s
  own ACME account.
- **Your browser checks the attestation itself**, against Google’s root and the Rekor proof, before it shows the seal.
  CI checks it again after every deploy, including that the server’s TLS key is the attested one.
- **The old keys are retired.** The master from before the move is retired and its secrets deleted, the old Cloud Run
  service is gone, and all 28 accounts moved in. The blind-index, photo and billing keys from before were carried over
  ([Known limits](#known-limits)).

[Alcove in Confidential Space →](infra/confidential-space/README.md)

### Everything stored is sealed

Every account and workspace has its own root key, wrapped under the master and opened per request. Titles, names, guests,
chat, audio, transcripts, notes and files are sealed records (XChaCha20-Poly1305) whose headers bind the owner and the exact
place they’re stored, so a record can’t be moved or replayed somewhere else. Lookups use keyed hashes, logs carry IDs, codes
and counts but never content, and deleting removes rows, receipts and objects from the live database and object store
(Cloud SQL’s backups keep them for up to seven days). An integration test plants marker strings in every kind of stored
record and checks that none shows up in any table, object or log line, in any encoding.
[Privacy, keys and sessions →](docs/engineering/privacy-keys-and-sessions.md)

### AI runs on verified private models

NEAR AI Cloud runs the models in confidential VMs: Intel TDX with NVIDIA confidential GPUs. Before a model gets anything,
Alcove checks its evidence with a fresh nonce: the TDX quote and Intel’s collateral ([dcap-qvl](https://github.com/Phala-Network/dcap-qvl)),
the boot measurements against a published [dstack](https://github.com/Dstack-TEE/meta-dstack) image, the event log, the
GPUs through NVIDIA’s attestation service for the same nonce, and the model’s encryption key, signed by the attested key.
A check that passes is reused for up to 10 minutes. Each request is sealed with Oblivious HTTP to that key, so NEAR AI’s
gateway and load balancers carry only ciphertext; speech always goes this way. If anything doesn’t check out, nothing is
sent: speech in that stretch isn’t transcribed, and the notes wait until the model checks out. An organizer can choose a
model that doesn’t run in an enclave for a call’s notes, and anyone can for their own questions; the app marks it wherever
that choice is made, and each note sent to such a model records it.

### The life of a note

1. **Notes are on** for the call, set when it was scheduled. Everyone in the call, and anyone about to join, sees what’s
   being captured.
2. **The host’s browser listens** to everyone it hears, decrypting it like any member of the call, and sends 5-second
   audio pieces and short speech clips to the API. This audio is outside the media encryption; each breakout room’s
   scribe does the same for its room.
3. **The API seals the audio** under the recording’s own key and sends each clip to Whisper, sealed to its attested key.
   The lines come back, are stored as sealed rows, and stream to everyone in the call.
4. **Live notes keep up** while someone’s watching, refreshed at most every 30 seconds: decided, suggested, still open and
   the follow-ups.
5. **When the call ends**, the notes worker writes the summary, decisions, open questions, follow-ups and chapters, each
   with the moments behind it, and retries if a model is busy or can’t be verified yet.
6. **Everyone invited gets the note**, sealed, with which model did each task and when its hardware was checked.

### What each part of the system sees

| Part | What it gets |
| --- | --- |
| Alcove’s server, in the confidential VM | What it works on, in memory: call audio while notes are on, transcripts, notes, documents. Never call media through LiveKit, or the MLS messages it passes on |
| Postgres and the object store | Sealed records, opaque IDs, keyed hashes, sizes and times |
| LiveKit Cloud, the media relay | Encrypted media and data, plus who’s connected, when, and who’s speaking (from audio levels and packet timing) |
| NEAR AI | Requests sealed to models Alcove verified in the last 10 minutes; Alcove’s API key, which model, request sizes and timing. A model someone chose outside an enclave gets requests over TLS, unsealed |
| Google | Your sign-in; your calendar and Drive exports if you connect them; and, as the cloud Alcove runs in, the sealed database, the logs and the attestation |
| Logs | Request IDs, codes, counts and durations; never content, keys or session IDs |

### Verify it yourself

Alcove’s own check of the live server runs from a terminal too, after `pnpm install`, with no account or keys. It confirms
that the TLS key you’re talking to is the enclave’s, that Google’s attestation token names Alcove’s signed image, and that
the image’s signature is in Sigstore’s log for the commit the server reports. It doesn’t rebuild the image: builds aren’t
reproducible yet, so that the image came from that commit rests on CI’s signature.

```console
$ pnpm --filter @alcove/confidential-space exec tsx verify-server.ts \
    https://api.alcove.solutions --web https://alcove.solutions
https://api.alcove.solutions verified: commit 46216fe47…, image sha256:dd0ed766…, TLS key upjxI8W-…
```

Your output names whatever production runs when you check: the commit should be main’s newest deployed one.

<br>

## Built with

| Part | Built with |
| --- | --- |
| **App** | React 19, TanStack Start (as a single-page app), TanStack Router and Query, Tailwind CSS v4, Motion |
| **API** | Node 24, Hono, Postgres 17 (plain SQL, rows parsed with zod), S3-compatible objects, pino |
| **Real time** | LiveKit (WebRTC; LiveKit Cloud in production), MLS (ts-mls), Yjs for documents and boards, NDJSON streams |
| **Cryptography** | @noble/ciphers, @noble/hashes and @noble/curves (XChaCha20-Poly1305, AES-GCM, X25519, HKDF-SHA-256), with HPKE and Oblivious HTTP written on them; WebCrypto in the browser |
| **AI** | NEAR AI Cloud (Whisper large-v3, DeepSeek V4.1 Flash), verified with dcap-qvl and NVIDIA’s attestation service |
| **Agents** | MCP (`@modelcontextprotocol/server`, Streamable HTTP), OAuth with PKCE and dynamic client registration |
| **Infrastructure** | Google Cloud Confidential Space (Intel TDX), Cloud KMS, Secret Manager, Workload Identity Federation, Artifact Registry, Cloud SQL, Cloud Run (migrations only), Cloud Logging, Cloudflare R2 and DNS, Let’s Encrypt, Sigstore (cosign and Rekor), GitHub Actions |
| **Payments** | NEAR Intents 1Click (USDC) |
| **Quality** | Strict TypeScript with no `any`, casts or non-null assertions (enforced in CI); integration tests only (1,743 on main, over HTTP against real Postgres, an object store and LiveKit, split across ten CI runners); every page and journey in Storybook (3,779 stories) |
| **Written with** | Claude Code, an AI coding agent: most commits carry its Co-Authored-By line |

<br>

## Run it yourself

You need Node 24, pnpm 11 (`corepack enable` gives you the version `package.json` names) and Docker.

```sh
git clone https://github.com/thebakedalaskan/alcove-solutions.git
cd alcove-solutions

# .env from the example, with its two keys filled in: KMASTER and KSERVICE, 32 random bytes each in base64url
sed -e "s|^KMASTER=$|KMASTER=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')|" \
    -e "s|^KSERVICE=$|KSERVICE=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')|" \
    .env.example > .env

pnpm install
pnpm dev   # Postgres, an object store and LiveKit in Docker, then the API on :8787 and the app on :3000
```

Open **http://localhost:3000** and press **Continue with Microsoft** to sign in as the demo person, Art Vandelay, with a
sample calendar and a company directory already filled in. **Use single sign-on** with any `example.com` address to be a
second person (to see notes shared with someone, say). Both are local stand-ins; nothing checks those addresses.

| To get | Add to `.env` |
| --- | --- |
| Live transcripts and written notes | `NEAR_AI_API_KEY` from [NEAR AI Cloud](https://cloud.near.ai). Without it, calls still record and play back, but nothing is transcribed and no notes are written. |
| Google sign-in and Calendar | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from a Google OAuth web client, with `http://localhost:3000/api/v1/auth/google/callback` as a redirect URI |
| Paying with USDC | `TREASURY_INTENTS_ACCOUNT`, the NEAR account whose Intents balance receives payments (and, optionally, `ONECLICK_API_KEY`, 1Click’s partner key, for a lower fee). Payments are real: 1Click has no testnet |

Without Docker or any keys, `pnpm storybook` opens the whole app on a stand-in API at **http://localhost:6006**: 3,779
stories of every component, page and journey on made-up data, including every scene in this README.

The tests behind the NEAR and confidential-compute claims take about two minutes, with Docker’s services up (`pnpm dev`
leaves them running; `pnpm db:up` starts them alone):

```sh
# Nothing goes to a model whose evidence fails, in each of 27 ways: tampered, replayed, unmeasured, expired or unreachable
pnpm --filter @alcove/server exec vitest run src/integration/flows.integration.test.ts -t "sends nothing to a model"

# The TEE's start-up and key release, private and unencrypted models, 1Click payments, and the MCP server
pnpm --filter @alcove/server exec vitest run src/integration/confidential-space.integration.test.ts \
  src/features/notes/models.integration.test.ts src/features/billing/topups.integration.test.ts \
  src/features/agents/mcp.integration.test.ts
```

```sh
pnpm check   # everything CI runs: the guards, migrations, typecheck, all 1,743 integration tests and the builds
```

`pnpm check` needs the same services and runs the integration tests one file at a time, so on one machine it takes 45
minutes or more; CI splits them across ten runners.

<br>

## Inside the repo

```text
apps/web            The app: TanStack Start (SPA), React 19, Tailwind v4, Motion
apps/api            The API: Hono, Postgres, S3-compatible objects, sign-in, crypto, inference
apps/storybook      Every component, page and journey, on a stand-in API
packages/ui         The design system: tokens, components, illustrations
packages/api        The contract: zod schemas and the AlcoveApi interface
packages/api-http   The browser client: REST, live streams, uploads, MLS, the server check
packages/board      A board's Y.Doc and the logic the app and the API share
infra/              Deployment: GCP bootstrap, the Confidential Space image, signing and rollout
docs/               Product, engineering and design docs
```

| Read | For |
| --- | --- |
| [Product overview](docs/product/overview.md) | Every feature and its status |
| [User flows](docs/product/user-flows.md) | Every journey, step by step |
| [System architecture](docs/engineering/system-architecture.md) | Components, the edge, request lifecycle, limits |
| [Privacy, keys and sessions](docs/engineering/privacy-keys-and-sessions.md) | The trust model and every key |
| [Notes and inference](docs/engineering/notes-and-inference.md) | The transcript, notes, asking, and verified private inference |
| [Calls and recordings](docs/engineering/calls-and-recordings.md) | Calls, MLS, rooms, boards, recording offline |
| [Alcove in Confidential Space](infra/confidential-space/README.md) | How production is built, signed, attested and deployed |
| [Design](docs/design/README.md) | The principles behind the look, page by page |
| [AGENTS.md](AGENTS.md) | The rules for anyone changing the code, people or agents |

### Where to look in the code

| What | Where |
| --- | --- |
| Checking a NEAR AI model’s hardware evidence: the TDX quote with dcap-qvl, the dstack OS image’s measurements, the event log, NVIDIA’s GPU verdict, the key the attested VM signed | [`apps/api/src/evidence.ts`](apps/api/src/evidence.ts), [`dstack-images.ts`](apps/api/src/dstack-images.ts), [`roots.ts`](apps/api/src/roots.ts) |
| Sealing requests to that key with Oblivious HTTP (RFC 9458) and HPKE; the one place anything with content goes to a model | [`apps/api/src/ohttp.ts`](apps/api/src/ohttp.ts), [`inference.ts`](apps/api/src/inference.ts) |
| Which models count as private, and choosing one | [`apps/api/src/features/notes/models.ts`](apps/api/src/features/notes/models.ts) |
| What each note records about the models that worked on it | [`packages/api/src/notes/schema.ts`](packages/api/src/notes/schema.ts), [`apps/web/src/features/notes/Evidence.tsx`](apps/web/src/features/notes/Evidence.tsx) |
| Payments through NEAR Intents 1Click | [`apps/api/src/features/billing/oneclick.ts`](apps/api/src/features/billing/oneclick.ts), [`deposits.ts`](apps/api/src/features/billing/deposits.ts) |
| The server in Confidential Space: its master key, attestation and TLS | [`apps/api/src/serverKeys.ts`](apps/api/src/serverKeys.ts), [`tee.ts`](apps/api/src/tee.ts), [`gcp.ts`](apps/api/src/gcp.ts), [`edge/`](apps/api/src/edge), [`infra/confidential-space/`](infra/confidential-space) |
| Your browser’s check of the server: Google’s token and the Rekor entry | [`packages/api-http/src/trust/`](packages/api-http/src/trust) |
| End-to-end encrypted calls with MLS | [`packages/api-http/src/calls/mls.ts`](packages/api-http/src/calls/mls.ts), [`apps/web/src/features/call/media/livekit.ts`](apps/web/src/features/call/media/livekit.ts) |
| Sealed records and per-account keys | [`apps/api/src/crypto.ts`](apps/api/src/crypto.ts), [`owners.ts`](apps/api/src/owners.ts) |
| The MCP server for agents | [`apps/api/src/features/agents/mcp/`](apps/api/src/features/agents/mcp) |
| Tests of all of it: a stand-in NEAR AI with a real HPKE receiver and 27 ways its evidence can fail, a stand-in 1Click, the TEE’s start-up and key release | [`apps/api/src/testing/fake-near.ts`](apps/api/src/testing/fake-near.ts), [`flows.integration.test.ts`](apps/api/src/integration/flows.integration.test.ts), [`topups.integration.test.ts`](apps/api/src/features/billing/topups.integration.test.ts), [`confidential-space.integration.test.ts`](apps/api/src/integration/confidential-space.integration.test.ts); run them as in [Run it yourself](#run-it-yourself) |

<br>

## License

[MIT](LICENSE).

<br>

## Known limits

What still rests on trust, and what isn’t built yet, stated plainly. The engineering docs go deeper:
[the runbook’s Known limits](infra/confidential-space/README.md#known-limits),
[Privacy, keys and sessions › Production requirements](docs/engineering/privacy-keys-and-sessions.md#production-requirements)
and [Notes and inference › What’s left](docs/engineering/notes-and-inference.md#whats-left).

**The server and its keys**

- The Google Cloud project’s Owners can use the Cloud KMS key that wraps the master, so they could unwrap it, and they
  can sign images with Alcove’s key. Every use is in Cloud KMS’s audit log; moving the keys to a project only CI
  administers is next.
- Any image signed with Alcove’s key gets the master, even one whose signature isn’t in Sigstore’s log (browsers and
  verify-server don’t call that one verified). CI signs and deploys every merge to main, and a merge needs passing checks
  but no human approval, so whoever can merge to main is trusted.
- Builds aren’t reproducible yet, so that an image came from its commit rests on CI’s signature.
- The operator sets the environment, such as which database, Cloud KMS key and bucket the image uses. It’s visible in
  the attestation token, but nothing checks it.
- Database migrations run as a Cloud Run job outside the VM, with access to the database but no keys.
- The 28 accounts made before the move kept their root keys, wrapped again under the enclave’s master, and the
  blind-index, photo and billing keys made before the move are still in use. The old master is retired and deleted, but
  whoever copied it before could still open those accounts’ keys from a copy of the database.
- Deleting removes data from the live database and object store; Cloud SQL’s backups keep it for up to seven days.
- Someone who can write to the database could roll a record back to an earlier version, or drop a recording’s last
  pieces, without it being noticed. Billing rows are keyed by account ID in the clear.

**Your browser’s check**

- A browser can’t see its own connection’s TLS key, and the app’s code comes from the server it checks, so the seal shows
  what the server presents, not that your connection ends in the enclave. CI checks the TLS key after every deploy, and the
  CAA record and Certificate Transparency make any other certificate visible. A check that fails blocks nothing: the app
  just doesn’t show the seal as verified.

**Calls**

- While notes are on, which is the default for new calls, the host’s browser decrypts what it hears and sends it to
  Alcove’s server for the transcript, so that audio is outside the media encryption; it’s readable only inside the
  confidential VM and the verified speech model. Each breakout room’s scribe does the same for its room.
- The host’s browser is in every breakout room’s group. There are no safety codes, so who is in a group rests on the
  server, which runs attested code; People lists every member.
- As in SFrame, every member of a group can derive every member’s media key, so a member working with the media relay
  could send media as another member. Chat isn’t affected: each MLS message is signed by its sender.
- LiveKit Cloud sees who’s connected, when, and who’s speaking (from audio levels and packet timing), and, from the key
  index each frame carries in the clear, who is in which breakout room. It never hears what’s said.

**The AI**

- What runs inside NEAR AI’s enclaves is NEAR AI’s code: Alcove pins and measures the OS image, not the model code, and a
  model’s instances share one key. GPU evidence is tied to the VM only by Alcove’s nonce, and the model’s name is NEAR AI’s
  word. NEAR AI sees Alcove’s API key, which model is used, and each request’s size and timing.
- A model check that passes is reused for up to 10 minutes. While a model can’t be verified, nothing is sent to it: speech
  in that stretch is never transcribed, and notes wait.
- Someone can choose a model NEAR AI doesn’t run in an enclave (an organizer for a call’s notes, anyone for their own
  questions). Requests to it go over TLS through NEAR AI’s gateway, unsealed; the app marks it wherever it’s chosen.
- Oblivious HTTP and HPKE are written in [`ohttp.ts`](apps/api/src/ohttp.ts) on @noble’s primitives and work against
  NEAR AI in production and a test receiver, but aren’t yet checked against the RFCs’ test vectors.
- Transcripts sometimes begin a clip with names or words nobody said
  ([#228](https://github.com/thebakedalaskan/alcove-solutions/issues/228)).

**Payments**

- A payment is credited when 1Click reports it settled in Alcove’s treasury; nothing reads the NEAR chain to confirm it.
  A balance can’t be withdrawn, and 1Click’s refunds go to the treasury and are added to the balance.

**Sign-in**

- Sign-in with Microsoft and single sign-on are demo stand-ins in local development; production signs in with Google only.

<br>

<p align="center">
  <a href="https://alcove.solutions"><img src="docs/readme/mark.svg" alt="Alcove" width="28"></a>
  <br>
  <sub><a href="https://alcove.solutions">alcove.solutions</a></sub>
</p>
