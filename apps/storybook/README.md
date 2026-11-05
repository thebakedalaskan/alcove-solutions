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
src/world/                the demo world, in the contract's types: people, notes, calls, the demo clock
src/media/livekit.ts      a scripted room in place of LiveKit
src/browser.ts            the browser as a story finds it: connection, devices, notifications
src/app.tsx               the app's own router at an address, in memory
src/page.tsx              what page stories share: `pages` and `page()`
stories/foundations/      colour, type, icons, scales, the evening and what passes through
stories/components/       one file per @alcove/ui component, a story per state
stories/pages/            one file per page, a story per state
stories/journeys/         one file per section of docs/product/user-flows.md
```

**The stand-ins.** `main.ts` swaps two of the app's files for Storybook's, by the file an import lands on (so `~/lib/api`,
`./api` and `../lib/api` all get it): `apps/web/src/lib/api.ts` becomes `src/api/index.ts`, and
`apps/web/src/features/call/livekit.ts` becomes `src/media/livekit.ts`. Nothing else in the app changes, and nothing in
`apps/web` or `packages/*` knows Storybook exists.

**Before every story** the preview starts its scenario: a fresh world for the stand-in, the demo clock at the scenario's
moment, the browser as the scenario says, and what this browser remembers (the tour, being signed in here), with nothing
left from the story before.

**The demo clock.** Every story starts on Wednesday 4 November 2026, at 16:12 unless its scenario says otherwise, and the
clock runs on from there, so "Today" and "in 4 minutes" read the same whenever Storybook is opened. `Date` is moved; timers
aren't.

**The demo world** is the design canvas's (`docs/design/canvas/appdata.js` and `data-*.js`): Vandelay Industries, you are
Art Vandelay, and everyone is made up. Never write a real person's name. It's written the way the canvas writes it, with
the builders in `src/world/build.ts`, and checked against the contract's schemas whenever a scenario starts.

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

## Add a component story

`stories/components/<Component>.stories.tsx`, one per component, a story per state. The preview gives it what the app's
root would (theme, tooltips, toasts). People come from the world, never made up on the spot:

```tsx
import { Button } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = { title: 'Components/Button', component: Button, args: { children: 'Start a call' } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary', icon: 'video' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Loading: Story = { args: { variant: 'primary', loading: true } };
```

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

## Add a journey

`stories/journeys/<nn>-<section>.stories.tsx`, one file per section of `docs/product/user-flows.md` (`04-start-a-call`,
title `Journeys/4 Start or schedule a call`), a story per journey, named with its number there. The play function clicks
the way a person would, finding what it clicks by role and label, in labelled steps that say what happens, as the canvas's
journey captions do. It never checks: no `expect` (the policy script refuses it). `findBy…` waits for what the next step
needs.

```tsx
export const StartNow = page('/home', 'busy', {
  name: '4.1 Start now',
  play: async ({ canvas, userEvent, step }) => {
    await step('Click Start now. The call is made and its lobby opens, with the camera and microphone to check', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: /Start now/ }));
    });
  }
});
```

The interactions panel steps back and forth through it. What Storybook can't play (Google's sign-in, an email, a second
person) plays up to the hand-off, and the stand-in plays the other side: a scenario, or a script in `src/api/`.

## Extend the stand-in

- **The contract changed.** `standIn` is typed `AlcoveApi`, so the compiler fails until `src/api/standin.ts` answers the new
  method. Answer with `answer((w) => …)`: it waits a moment, refuses offline and signed out as the client does, and hands
  back a copy. New data gets a field on `World` (`src/world/index.ts`), a value in each scenario, and a line in
  `checked()` in `scenarios.ts`.
- **A new state.** Add a scenario to `SCENARIOS` in `src/api/scenarios.ts` and to the table above, or give one story its own
  `opening`.
- **Something live.** Extend `Snapshots` (`src/api/live.ts`): push whole snapshots on a script with `after()` and `every()`,
  and `halt()` when it closes. A call is `src/api/call.ts` (its people, notes and transcript) with `src/media/livekit.ts`
  (who's speaking, mics, cameras and screens); a room recording is `src/api/recording.ts`.

## Rules

- Stories show; they never check. Storybook's test runner, its Vitest addon, Chromatic and Testing Library are refused, and
  so is `expect(` anywhere here (`scripts/check-tests.mjs`).
- Everything Storybook needs lives here. If a story needs something a package keeps to itself, export the smallest honest
  thing from the package and say so in the pull request.
- Strict TypeScript and no `console`, as everywhere (`scripts/check-types.mjs` covers this app).
- A page change updates its stories and journeys here in the same pull request, and a contract change extends the stand-in.

## Known limits

- Each story starts a fresh world, clock, router and query cache, and forgets what the browser remembered, but some of the
  app's in-memory stores (the arrival after a first sign-in) last until the frame reloads: reload it if a journey leaves
  one behind.
- Google's pages, a calendar's and a call's media aren't real: those links stay on the page, a note's audio is quiet,
  shared screens are drawn slides, and the call is scripted.
