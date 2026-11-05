# Starting and scheduling calls

Visual design: the "Starting and scheduling calls" canvas (claude.ai artifact `Hg42pwdjn3vRfxughTeffj`, private to
Ben). It has two playable prototypes, every journey step by step, and every animation. This page records the
decisions behind it and what the build has to provide.

## Why

New call was one line: describe the call in a sentence and Alcove parses it. Nobody knew what to type, Enter did two
different things, and it had no room for a team, a long invitation list, repeats, what's kept, or documents. Starting
now and scheduling are different jobs, so they get different paths, and each path asks one thing at a time.

## The shape

- **Start a call** (`N`) is the one primary button in the side panel. On a phone it's the plus in the top bar. It opens
  a small modal with two choices: **Start now** (`Enter`) and **Schedule for later** (`S`). Nothing else is on it.
- **Start now** creates the call and goes to the organizer's lobby, the pre-join on the night stage. Night floods out
  from the card that was pressed.
- **Schedule for later** stays in the same modal and asks one question at a time: **Who**, **When**, **Details**. Back
  goes the other way. There's no separate page, and no window ever opens over another.
- **A scheduled call** opens one card from its row: who's coming, notes, documents, the link, Join. Every row opens to
  change it; in a series, a change applies to this call or to this and later calls.

The sentence composer and its parser are gone.

## A team and an individual

Which experience someone gets comes from `q.team()`: a work domain or company directory is a team, a personal address
isn't. Nothing is a setting.

| Moment | On a team | On your own |
| --- | --- | --- |
| Side panel | Team page and groups | Neither |
| Start a call | "Ring your team in, or share a link." | "Get a link to send to anyone." |
| Lobby | Ring: arches of who's free now, then **Join and ring 2** | Your link first, with **Copy**, then **Join** |
| Waiting | Rung people wait as empty arches, with their answers | Guests ask to join, and you let them in |
| Who | Groups, everyone at the company, the people you meet | People you've met, and any address |
| When | Free time across everyone's calendars | Your own calendar, with **Let Jamie pick** for private calendars |
| Documents | From a workspace | From your own documents |

## Decisions

- **Ringing.** An organizer can ring their team, and anyone invited who has said yes: an invitation alone isn't enough,
  or anyone could put words on someone's screen. They see a card on whatever page they have open, and hear it.
  It lasts 45 seconds. **Join** goes through pre-join; **Can't now** offers In 5 minutes, In 15 minutes and Not this
  time, and the answer shows on their arch in the call. Everyone rung is added to the invite, so they get the notes.
- **Who.** Typing searches the directory, people met and groups; a pasted list of addresses is read at once, stays one
  token, and flags only what it can't read, with a fix where it can guess. Skip makes a call with just a link.
- **When.** Three suggested times, the best already picked, inside everyone's working day. **Pick another time** opens
  the week. With guests, or too many people to all be free, it says how many are free. Length and repeat live here.
- **Repeat.** Every week, every 2 weeks, every month, or days you pick, with an end date. Each call keeps its own notes;
  what's still open carries over. People read only the notes of calls they were invited to.
- **Notes.** On or off when scheduling. When on: keep the transcript, keep the recording, read shared screens. Without
  the transcript, it's used to write the notes and then deleted. Mid-call, only the organizer can turn notes on, and
  others can ask.
- **Big calls.** Past 25 people, Details adds big-call settings, already on: join muted, questions with votes, guests
  wait to be let in.
- **Letting a guest pick.** When someone's calendar is private, offer up to three times. You get a link; the guest picks
  one on a public page, with no account. The call then goes on the calendar and the other times are let go.
- **No Calls page.** Scheduled calls live in Home's list and open their card. The side panel doesn't grow.

## What the first build leaves out

The canvas shows where this is going. The app shows only what works, so these wait:

- **Questions with votes** on big calls. They need their own end-to-end encrypted message model. Big calls get join muted
  now; guests already wait to be let in.
- **Documents for real accounts.** Workspaces are #81. Demo accounts get a sample catalog; everyone else gets a designed
  empty state.
- **Other people's working hours and time zones.** "09:00 for Sam" on the canvas needs a zone Alcove doesn't have, so
  suggestions use the organizer's 9 to 17.
- **Ringing someone with no Alcove tab open.** That needs web push (#88). Until then the ring ends unanswered, and
  nothing implies they were offline.
- **An answer given in Alcove reaching Google Calendar.** Answers given in Google do show on the call's card.

## Motion

| Moment | What moves | Timing |
| --- | --- | --- |
| Modal opens | Page dims and blurs a little, modal rises 8 px and fades in | 240 ms, ease-out |
| Hover a choice | Sun rises 5 px in the arch, card lifts 1 px | 420 ms, ease-out |
| Start now | Night floods out from the card, then the lobby rises in two beats | 560 ms, ease-in-out, then 420 ms |
| Step to step | Content slides 14 px and fades; back slides the other way | 240 ms, ease-out |
| Add someone | Token pops in, row leaves the list | 240 ms, ease-out |
| Pick a time | Card fills, tick pops, the button says the time | 140 ms, 240 ms |
| Pick another time | Modal widens around the week | 420 ms, ease-in-out |
| Scheduled | Modal settles away, the new row rises, a toast offers Undo | 240 ms, then 420 ms |
| Ringing | The arch ripples, twice, 1.2 s apart | 2.4 s, repeating |
| Picked up | The arch opens into a tile; the layout moves | 420 ms, 900 ms ease-in-out |
| Asks to join, or you're rung | A card drops 10 px and stays until answered | 420 ms, ease-out |

With reduced motion every change still happens, at once.
