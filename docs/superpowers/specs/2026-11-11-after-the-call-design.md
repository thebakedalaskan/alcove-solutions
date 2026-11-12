# After the call

The design is the canvas "After the call" (claude.ai artifact RLRA7saRhguTP9UtXo1fZP), whose boards this build copies into
`docs/design/canvas/after/`. This says in words what it decided, what the review of the build decided after it, and the
contract the build works to. The docs kept true to the code are
[user flow 7](../../product/user-flows.md#7-end-the-call-and-get-the-notes),
[pages.md › After the call](../../design/pages.md#after-the-call) and
[Calls and recordings › The call screen](../../engineering/calls-and-recordings.md#the-call-screen).

## What changes

- **Ending or leaving a call takes you to the call's own page**, the *over page*, on the call's night. Before, the host got
  a sheet over the frozen, blurred call (Call ended), and everyone else landed on the join page with their camera on again.
- **The host's Leave question opens over Leave**, the way Close's question does, instead of a sheet from the bottom over a
  blurred call. Anyone who doesn't host is out at once, as before.
- **Alone in the call, pressing Leave ends it at once.** There's nobody to hand it to and nothing to choose. Any other way
  out while alone (going back a page, or answering a ring from another call) opens Leave's question instead, so a stray Back
  doesn't end a call people are about to join.
- **Rejoin goes straight back in**, with the microphone and camera as they were: no pre-join, no camera preview. **J**
  rejoins too, with both off.
- **Nothing cuts.** The call eases back and fades as its page rises in (about a second); from the page to Home or the notes,
  the page fades and the frame settles in with the side panel easing in (under a second); Rejoin brings the call back up.
  Opacity and transform only; with reduced motion, short fades.

Nothing on the wire changes: the page reads what the call already sends (`state.notes.noteId`, `state.elapsed`,
`state.capture.mode`, who's here), the note's progress (`api.notes.progress`), the note itself once written, and the call's
card (`api.calls.card`, at the pace the join page reads it) for a call you left ending. Invitees are granted the note in the
transaction that stops the recording, before the room is deleted, so everyone the call ends for can follow the notes being
written.

## The over page

One page, on the call's night (the welcome page's cove after dark: Horizon moment `after`, Cove seed 17), sibling of the join
page: the logo once at the top, what the call runs on at the top right, no Home link (Go to Home is a button). From the top:
who was in the call (or who's still in it) in their arches, the title (Newsreader), one line, the notes, the buttons. The
first button is the filled one. It never moves on by itself, unless the account signs out in another tab (below).

| What happened | Title | The line | Notes | Buttons |
|---|---|---|---|---|
| You ended it, notes on | {Title} has ended | {n} min with {names} (alone: {n} min) | Being written (step, who gets them), then the summary's first lines with decided and follow-up counts | **Open the notes** (then **Read the notes**), Go to Home |
| You ended it, no notes | {Title} has ended | {n} min with {names} (alone: {n} min) | No notes were taken. | **Go to Home** |
| Whoever hosts ended it, you get the notes | {Title} has ended | {n} min with {names} | Being written, then written | **Open the notes**, Go to Home |
| Whoever hosts ended it, you don't (a guest) | {Title} has ended | {Organizer} can share the notes with you. | none | none |
| You left, it goes on | You left {Title} | {names} are still in it, and how long it's run (ticking) | As notes were when you left, only if you get them: Notes are on. You get them when it ends. / Notes are paused. You get what was written when it ends. / Notes are off. You get what was written when it ends. | **Rejoin** (J), Go to Home (a guest: Rejoin only) |
| You hosted, and left it with someone | You left {Title} | {Name} is hosting until you're back (standing in for the organizer: until {Organizer} is back) | the same | **Rejoin**, Go to Home |
| You left, and it ended while you're here | {Title} has ended | It ended after you left. | Being written (if you get them) | **Open the notes**, Go to Home (a guest: none) |
| The notes take long, or their progress can't be followed | | | Still being written. They'll be in Notes when they're ready. You don't need to wait here. | as above |

"Still in it" is who was in the call as you left, without you: after leaving there's no live view of the room.

**An end you didn't make names nobody.** The app can't tell who or what ended the call: the room going (`ROOM_DELETED`) and
the call saying it has ended (`phase: 'ended'`) look the same whether whoever hosts pressed End for everyone, upkeep ended a
call whose host had gone with nobody to stand in, or LiveKit finished the room. So the line is the one you'd see had you
ended it, never "{Name} ended it for everyone", and the title stays "{Title} has ended". A guest is told who can share the
notes whenever the call had them, however it ended.

**The notes as you left them.** While a call you left goes on, whoever gets the notes is told how notes were as they left:
on (`notesAreOn(capture.mode)`, so unavailable counts as on) with the recording dot, paused with the pause sign, or off,
once they were on earlier (there's a note). The server keeps the note once notes have been on, so the note alone doesn't say.

**The page turns when the call ends**, from the call's card, read at `q.card`'s own pace, as the join page reads it: 10 to 17
seconds apart while someone hosts the call, each browser a little apart from the rest, 20 seconds or more after a refusal
(Too many attempts) or a failed read, and never again once the code leads nowhere. So it turns within about 15 seconds of
the end, and pages left open don't fill the card's limit, which the join pages behind the same address share. Only what's
read after you left counts.

**Rejoin** goes straight back in: the microphone and camera as they were, the pass this tab kept (someone the call let in
before comes back without asking) and, only when it has to, a wait to be let in. It never navigates: `useRejoin` hands the
session to `CallPage`, which brings the call back at the same address as its page fades. **J** rejoins with the microphone
and camera off, since a stray key mustn't put your voice and picture back into a call you chose to leave. J with Shift, ⌘,
Ctrl or Alt doesn't count, nor does J while you type or something's open over the page. The button brings both back as they
were.

**Taking a rejoin back never ends the call.** While it says Rejoining…, Go to Home stays pressable: it's the way out while
waiting to be let in. A rejoin that isn't going in (the page goes first, the join comes back after the page went, or getting
in fails) is let go with the session's `closing()`, which closes it whatever happens and says "leave" only when it doesn't
host, never with `leave()`, which sends `end` from whoever hosts. An organizer's new connection hosts the moment it joins, so
`leave()` would end the call for everyone. One that never reaches the room is handed on by upkeep after 25 seconds, like any
host's browser that never gets there.

**Signed out elsewhere.** Signing out, or deleting the account, in another tab reaches the page as it reaches the frame
(`onSignedOutElsewhere`): it forgets what it read (the note) and goes to the welcome page.

## Components (`packages/ui`)

- **`Horizon` moment `after`**: night in both themes, stars, a rose glow on the horizon with light lying on the bay under
  it, no sun disc, a crescent moon high on the right; what passes through: shooting stars, now and then. `horizon.tsx`
  (MOMENTS, SCENES, LIFE, LANES) and `horizon.css`; run `docs/design/canvas/tools/sync-life.py` after.
- **`CallOver`** (`components/call-over.tsx`, `styles/call-over.css`, classes `co-`): the whole page, stateless, plain data.
  Draws its own scene (`Horizon` moment `after` with `Cove` seed 17 as its land, the land kept clear of the page's words,
  measured as `Sky` does) and its own top (the logo once in the middle, and `trust` at the top right after a sealed icon, the
  icon alone on a phone), then the people, title, line, notes and buttons; a phone (container under 600px) puts the buttons
  across the foot. Props: `title`, `meta`, `people: AvatarPerson[]`, `clock?` (ticking text), `notes?`
  (`{ kind: 'writing', step, who, faces } | { kind: 'ready', summary, decided, followUps } | { kind: 'slow' }
  | { kind: 'going', mode: 'on' | 'paused' | 'off' } | { kind: 'none' }`), `modelPrivate`, `trust` (what the call runs on:
  "Confidential compute · verified"), `actions` (the buttons, `Button`s, first `primary`), `turn` (a key: when it changes,
  what changed rises in), `entering`, `leaving`, `onEntered` (the arrival has played out, read from its own animations, at
  once when nothing plays) and `onGone` (the page has faded out). The title takes the keys as the page shows and whenever
  `turn` changes, without a ring, so what happened is read first and Tab goes on to the buttons.
- **`LeaveAsk`** and **`LeaveChoices`** (`components/call.tsx`, beside `CloseAsk`; styles in `styles/call.css`): the
  question as a popover over Leave (a sheet on a phone), and its rows for the floating call's own window, with Stay in the
  call. Rows: **End for everyone** (its line: "Everyone invited gets the notes." or "It ends for everyone in the call."), and,
  when someone here can host, **Leave, {First} hosts** with Change, which lists who else could, in the same popover. Hosting
  in someone's place puts leaving it going first. Busy ("Ending the call…") and a failure line in caution. Nobody here can
  host: End for everyone alone, with "Guests can't host, so leaving ends it for everyone." Alone in the call (`alone`), End's
  line is "You're the only one here, so leaving ends the call." Pressing Leave alone never asks, so the question opens alone
  only for another way out.
- **The call easing back**: `.ic-call.is-leaving` in `call.css`: scale to .985 and fade, in about half a second.
- **The frame arriving from a call**: `[data-arrive="call"]` on the shell's root plays once: the page settles from 1.014
  and fades in, the side panel eases in from -16px.

## The app (`apps/web`)

- `features/call/session/InCall.tsx`: `LeaveSheet` went (deleted, with its styles); `LeaveAsk` anchors on the dock's Leave
  and `LeaveChoices` stands in the floating call's window. `end()` (ended), `handOff()` (left it with someone), a
  participant's leave (left) and the call ending under you by anything but you (`ended-by-host`, or the call saying it has
  ended) show the over page in place of the call, with the call easing back under it; being removed, moving devices, the
  connection dropping and someone else hosting after a drop stay as they were. Pressing Leave alone ends the call; the leave
  guard (going back a page, answering a ring) opens Leave's question for whoever hosts, alone or not.
- `features/call/session/CallPage.tsx`: the call's address, `/call/$code`, which never changes: the call, then its page once
  the call is over for you, then the call again when Rejoin brings it back. The call eases back under the page as it
  arrives, and a call Rejoin brought back comes up under the page as it fades.
- `features/call/session/CallOver.tsx`: the over page's data (a snapshot taken as you leave: title, who, when it started,
  note ID, how notes were, whether you get the notes, your role, your microphone and camera, the host's name), the note's
  progress and the written note's first lines and counts, the card read at its own pace while the call goes on, the ticking
  clock, the buttons and J, and signing out elsewhere.
- `features/call/session/rejoin.ts`: joining again from the page: `api.calls.join` with the last pass (`previous`), the
  microphone and camera as they were, or both off from J (a fresh `LocalMedia`, as moving devices does), waiting to be let in
  if it has to, then handing the session to `CallPage`. Rejoin says Rejoining… meanwhile; a refusal or a failure is said in a
  toast, and the page stays as it was. A join that isn't going in is let go with `closing()`, never `leave()`.
- Go to Home and Open the notes fade the page, then navigate; the shell plays its arrival once (`data-arrive="call"`).
- Reloading `/call/$code` after leaving goes to the join page, as before.

## Storybook

The kit's stories for `CallOver` (every row of the table, a phone) and `LeaveAsk` (organizer, standing in, nobody can host,
busy, failed, Change, a phone). The call's scenarios (`calls/Leaving`) and **Journeys / 7**, renumbered to the user flows:
7.1 end the call and read the notes, 7.2 leave and keep it going (then Rejoin), 7.3 leave as a participant (phone, light),
7.4 leave as a guest, 7.5 retry a departure that failed, 7.6 join another call while in one, 7.7 the call ends while you're
on its page, 7.8 alone, Leave ends it. Any other journey that passed through the Call ended sheet passes through the over
page instead.

## Docs

`docs/product/user-flows.md` §7, `docs/design/pages.md` (A call: after the call; the moments), `docs/design/principles.md`
(the evening's moments), `docs/engineering/calls-and-recordings.md` (the call screen: leaving and ending, the page a call
leaves you on), `docs/engineering/floating-call.md` (Leave in the window), `AGENTS.md` (the components and stylesheets),
`docs/design/canvas/after/` with a README, and any mention of the sheet that's gone.
