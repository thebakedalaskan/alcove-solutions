# Storybook

The record of what's built: the foundations, every component in `@alcove/ui`, every page and the journeys between them,
rendered by the real components and the real app on made-up data. It shows; it never tests (AGENTS.md › Testing).

```
pnpm storybook        # from the repo root: http://localhost:6006, no Docker, no API
pnpm build            # turbo builds it into apps/storybook/dist, as CI's Build job does
```

The toolbar has the **Theme** (light, dark), the **Connection** (online, offline, while the page stays open) and the
viewports: phone (390), tablet (1024), laptop (1440) and wide (1920). A page story's **Controls** switch its scenario and
its address.

## How it's laid out

```
.storybook/main.ts        Vite: the app's ~ alias, Tailwind, and the two stand-ins (below)
.storybook/preview.tsx    styles and fonts, the toolbar, viewports, providers; starts each story's scenario
src/api/                  the stand-in AlcoveApi (standin.ts), its live stores, and the scenarios (scenarios.ts)
src/api/call.ts           a call played from its script: the server's side (who's in it, notes, rings, rooms, the host)
src/api/script.ts         what a call's script says: who's here, what's said and done when, how rings are answered
src/api/trouble.ts        a part of Alcove that fails, can't be reached or keeps a page waiting, as the story's world says
src/api/kept.ts           recordings kept on this device that haven't uploaded, through the app's own way of keeping them
src/api/move.ts           a call being moved to this device, as /move sees it
src/world/                the demo world, in the contract's types: people, notes, calls, the demo clock
src/media/livekit.ts      a scripted room in place of LiveKit: microphones, speaking, shares, your connection
src/media/screens.ts      what other people share, drawn
src/browser.ts            the browser as a story finds it: connection, devices, notifications, a page that goes
src/app.tsx               the app's own router at an address, in memory
src/page.tsx              what page stories share: `pages` and `page()`
src/component.tsx         what component stories share: `onStage`, `PopSurface`, `ModalFrame`, `Box`, `Row`, `did()`
src/call.ts               what call stories share: `inCall()`, `atTheDoor()`, `rung()`, `phone()`, `press()`
stories/foundations/      colour, type, icons, scales, the evening and what passes through
stories/components/       one file per @alcove/ui component, a story per state, in a folder per group
stories/pages/            one file per page, a story per state
stories/calls/            the call: the lobby and waiting, ringing, the call itself, notes, sharing, rooms, leaving
stories/journeys/         one file per section of docs/product/user-flows.md
```

**The stand-ins.** `main.ts` swaps two of the app's files for Storybook's, by the file an import lands on (so `~/lib/api`,
`./api` and `../lib/api` all get it): `apps/web/src/lib/api.ts` becomes `src/api/index.ts`, and
`apps/web/src/features/call/livekit.ts` becomes `src/media/livekit.ts`. Nothing else in the app changes, and nothing in
`apps/web` or `packages/*` knows Storybook exists.

**Before every story** the preview starts its scenario: a fresh world for the stand-in, the demo clock at the scenario's
moment, the browser as the scenario says, and what this browser remembers (the tour, being signed in here), with nothing
left from the story before: its calls and recordings stop, and so do its microphone, camera, recorders and audio, as
they would when a page goes away.

**The demo clock.** Every story starts on Wednesday 4 November 2026, at 16:12 unless its scenario says otherwise, and the
clock runs on from there, so "Today" and "in 4 minutes" read the same whenever Storybook is opened. `Date` is moved; timers
aren't.

**The demo world** is the design canvas's (`docs/design/canvas/appdata.js` and `data-*.js`): Vandelay Industries, you are
Art Vandelay, and everyone is made up. Never write a real person's name. It's written the way the canvas writes it, with
the builders in `src/world/build.ts`, and checked against the contract's schemas whenever a scenario starts. Its workspaces
are Product (Art runs it: a folder, a document closed to the workspace, the launch retro board, two things in Trash),
Design (he edits; the onboarding flow board) and the company handbook (he can only read). What each document says is in
`src/world/documents.ts`, in the editor's own blocks, and who it's shared with in the world's `shares`; a page can say what
Alcove refused of it, which opens it couldn't-save. What each board holds is in `src/world/boards.ts`, drawn with
`@alcove/board`'s own writers, with who else is on it (their pointers, and their faces in the workspace) and how it stands
for this browser (`standing`: Reconnecting, Couldn't save, or taken away while it's open).

## Scenarios

| Name | What it is |
|---|---|
| `busy` | Wednesday afternoon at Vandelay Industries: a day of notes, things waiting on you, a design sync at 17:30 |
| `first-day` | Art has just signed in: no notes or calls, a team not on Alcove yet, no calendar access |
| `on-their-own` | Art at a personal address: no team, no groups, recordings and calls with people he meets |
| `offline` | The busy afternoon opened with no connection, signed in on this browser: Record works, the rest says offline |
| `writing` | Just after the pricing follow-up: its notes are written over a few seconds; a walkthrough records elsewhere |
| `call-soon` | Wednesday at 10:26: the design review starts in four minutes |
| `lots` | Thirty people on Alcove, three months of notes, eight pins, a dozen groups, long names |
| `signed-out` | Nobody signed in on this browser: the welcome page; Microsoft or single sign-on signs Art in to the busy afternoon |
| `unsaved` | The busy afternoon after Alcove wouldn't take some of Art's edits: the pricing copy's last edits, more interview notes than a document holds, and a line in the handbook he can only read now |
| `first-sign-in` | Nobody signed in, and no account yet: signing in makes Art's account on screen, his first day, and Home's tour |

## Add a component story

`stories/components/<group>/<Component>.stories.tsx`, one per component, a story per state, titled
`Components/<Group>/<Component>`. The groups run from the basics to whole surfaces: icons and marks, actions, forms,
feedback, overlays, layout, motion, the evening, people, starting a call, ringing and waiting, in a call, notes and
transcript, record, settings, and the workspace. Put a new component in the group a person would look for it in, and
add a new group to `storySort` in `.storybook/preview.tsx` only when none fits. The preview gives it what the app's
root would (theme, tooltips, toasts). People come from the world, never made up on the spot:

```tsx
import { Button } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = { title: 'Components/Actions/Button', component: Button, args: { children: 'Start a call' } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary', icon: 'video' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Loading: Story = { args: { variant: 'primary', loading: true } };
```

Give every prop worth playing with an arg, so it has a control (react-docgen is off: unions need `argTypes` with their
`options`, icons `ICON_NAMES`). Handlers are `did('onClick')`, which says it was called in the Actions panel; a value
that changes when pressed (`checked`, `open`, `value`) is kept with `useArgs` from `storybook/preview-api`, so pressing
it moves the control too. What only exists at night (the call stage, Record) spreads `...onStage` into its meta and
stands on the stage in both themes; what only shows inside a popover or the call modal can stand on a `PopSurface` or in
a `ModalFrame`. The workspace kit is grouped by surface, in `stories/components/workspace/`.

## Add a page story

`stories/pages/<Page>.stories.tsx`. A page story is an address and a scenario:

```tsx
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs } from '../../src/page';

const meta = { title: 'Pages/Notes', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Busy = page('/notes', 'busy');
export const FirstDay = page('/notes', 'first-day');
/** Anything else goes in the third argument: here, notifications the browser has blocked, on a phone at night. */
export const Blocked = page('/settings#notifications', 'busy', {
  parameters: { opening: { browser: { notifications: 'denied' } } },
  globals: { theme: 'dark', viewport: { value: 'phone' } }
});
```

The address is any of the app's (`/notes/n2?at=372`, `/team?group=g-product`, `/call/dsn-revw-pka`). `parameters.opening`
changes how the page opens on top of the scenario: `now` (a `Date`, `on(day, hours, minutes)` from `src/world/clock.ts`),
`browser` (`online`, `devices`, `notifications`), `signedInHere`, `tourSeen` and `latency` (ms). The page answers clicks:
what you change changes the world for the rest of the story.

A state no scenario has is the scenario with a change of the story's own, made as it opens and checked against the
contract (`changing()` in `src/page.tsx`). `stories/pages/changes.ts` has the ones page stories share, and
`src/world/states.ts` and `src/world/invitations.ts` the notes, series and calls they bring:

```tsx
/** The summary couldn't be written: a note in that state, put into the busy afternoon. */
export const Unwritten = page(`/notes/${STATES.unwritten}`, 'busy', { beforeEach: changing(inEveryState) });
/** A part of Alcove that fails (`failed`), can't be reached (`network`) or never answers while the story is open (`hold`). */
export const Loading = page('/team', 'busy', { beforeEach: changing(troubled({ 'people.team': 'hold' })) });
/** Recordings kept on this device that haven't uploaded, in every state Record shows. */
export const OnThisDevice = page('/record', 'busy', { beforeEach: changing(keptHere) });
```

A popover, a menu or a step of a modal is reached with a short `play`, in labelled steps, as a person would: what opens
over the page is found with `screen` from `storybook/test`, since it isn't inside the story's root.

## Add a journey

`stories/journeys/<nn>-<section>.stories.tsx`, one file per section of `docs/product/user-flows.md` (`04-start-a-call`,
title `Journeys/4 Start or schedule a call`), a story per journey, named with its number there. The play function clicks
the way a person would, finding what it clicks by role and label, in labelled steps that say what happens, as the canvas's
journey captions do. It never checks: no `expect` (the policy script refuses it). `findBy…` waits for what the next step
needs.

```tsx
const meta = { title: 'Journeys/4 Start or schedule a call', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

export const StartNow: PageStory = {
  name: '4.1 Start now',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Press N, from any page. A small modal asks one thing: now, or later?', async () => {
      await userEvent.keyboard('n');
    });
    await step('Start now. The call is made, and its lobby opens with your team to ring', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Start a call' }, SOON)).getByRole('button', { name: /^Start now/ }));
    });
  }
};
```

The story's `name` is written out in the export (Storybook's index can't read one passed through `page()`), and journeys
play at a laptop's size (`LAPTOP`) so they play the same in any window. They use `screen`, not `canvas`: modals, popovers
and toasts open outside the story's root. `stories/journeys/play.ts` has what they share: `holding()` for the tile or row
that says something, and the waits.

The interactions panel steps back and forth through it. What Storybook can't play (Google's sign-in, an email, a second
person) plays up to the hand-off, and the stand-in plays the other side: a scenario, a script in `src/api/`, or, in the
journey's `beforeEach`, `before()` for what its world needs, `outage()` for what goes wrong (a part that doesn't load, the
server saying no) and `keepMail` for a `mailto:` link, which goes as far as handing the message to the mail app. A journey
through a call uses the call's own: `atTheDoor()`, `rung()` and `inCall()` from `src/call.ts`.

## Add a call story

`stories/calls/<Part>.stories.tsx`. LiveKit can't run here, so a call is played from a script (`src/api/script.ts`):
who's in it when you come in, what's said and done and when, how the people you ring answer, and what the call's link
says while you wait. The scripted call plays the server's side; the scripted room (`src/media/livekit.ts`) plays
LiveKit's, and the call screen drives it exactly as it drives LiveKit's room. Your own microphone, camera and screen are
the browser's made-up ones (`src/browser.ts`): mute, switch a device or share, and the room publishes it. Everyone else's
camera stays off, so people show in their arches; what they share is drawn. While notes are on, what's said reaches the
transcript as it's said, and the live notes are written again a few seconds later.

```tsx
const meta = { title: 'Calls/Sharing', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** In the call: the lobby's part (your devices, joining, ringing anyone picked) is done before the screen opens. */
export const SomeoneSharing = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: {
    here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }],
    cues: at(2, shares(PRIYA, CHECKLIST)),
    talk: { lines: [line(PRIYA, 'Can everyone see the checklist?'), line('me', 'Yes.', { decides: 'We go down the checklist.' })] }
  }
});
export const SomeoneSharingPhone = phone(SomeoneSharing);
/** At the call's link: the organizer comes in eight seconds after the story opens. */
export const Waiting = atTheDoor({ scenario: 'busy', call: CHECK_IN, script: { door: { hostArrives: 8 } } });
/** A play that presses a button in the dock, then one in what it opens. */
export const CallEnded = inCall({ scenario: 'call-soon', call: REVIEW }, { play: press('Leave', { then: ['End call for everyone'] }) });
```

A call is one of the scenario's (its link's code) or a `StoryCall` the story puts in the world (`stories/calls/talk.ts`
has the calls, conversations and shares the call stories share). Times are seconds from joining; the door's, from the
story opening. A beat (`joins`, `says`, `shares`, `knocks`, `raisesHand`, `{ do: 'host-drops' }`, `{ do: 'reconnect' }`,
`{ do: 'end' }`...) is anything someone else, the server or LiveKit could do; `run()` is anything else, such as `ringYou()`
from another call. A call nobody scripted plays `defaultScript`: everyone invited comes in and talks it through. Call
stories are always night, and come on a phone too (`phone()`).

## Extend the stand-in

- **The contract changed.** `standIn` is typed `AlcoveApi`, so the compiler fails until `src/api/standin.ts` answers the new
  method. Answer with `answer((w) => …)`: it waits a moment, refuses offline and signed out as the client does, and hands
  back a copy. New data gets a field on `World` (`src/world/index.ts`), a value in each scenario, and a line in
  `checked()` in `scenarios.ts`.
- **A new state.** Add a scenario to `SCENARIOS` in `src/api/scenarios.ts` and to the table above, give one story its own
  `opening`, or change its world as it opens (`changing()`, above).
- **Something that goes wrong.** `trouble` on the world names the calls that fail, can't reach Alcove, or never answer
  (`src/api/trouble.ts`): the app gets the stand-in through it, so a page shows its error, offline or loading look as it
  would. A trouble can be a function of what was asked (`notes.list` fails only for a search).
- **Something live.** Extend `Snapshots` (`src/api/live.ts`): push whole snapshots on a script with `after()` and `every()`,
  and `halt()` when it closes. A call is `src/api/call.ts` (its people, notes and transcript), its `livekit` side, which
  `src/media/livekit.ts` plays (mics, who's speaking, shares, your connection), and a new beat in `src/api/script.ts`; a
  room recording is `src/api/recording.ts`.

## Rules

- Stories show; they never check. Storybook's test runner, its Vitest addon, Chromatic and Testing Library are refused, and
  so is `expect(` anywhere here (`scripts/check-tests.mjs`).
- Everything Storybook needs lives here. If a story needs something a package keeps to itself, export the smallest honest
  thing from the package and say so in the pull request.
- Strict TypeScript and no `console`, as everywhere (`scripts/check-types.mjs` covers this app).
- A page change updates its stories and journeys here in the same pull request, and a contract change extends the stand-in.

## Known limits

- Each story starts a fresh world, clock, router and query cache, and forgets what the browser remembered, but some of the
  app's in-memory stores (the arrival after a first sign-in, a move's claim once /move has taken it) last until the frame
  reloads: reload it if a journey leaves one behind.
- The other device in a move isn't here: Move here waits for it to let go, and the move stays there.
- Google's pages, a calendar's and a call's media aren't real: those links stay on the page, a note's audio is quiet,
  shared screens are drawn, nobody else's camera is ever on, and the call is scripted. Nobody else's browser is in it, so
  pointers and marks on a share go nowhere, and nothing anyone says is heard aloud.
- A play's timings: Storybook says a story has rendered once its play is done and its animations have settled, so a
  script's times (counted from joining) can be well under way by then.
