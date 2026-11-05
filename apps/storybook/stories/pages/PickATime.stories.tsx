/*
 * Picking a time: what a call's link shows while it offers times. It's public, with no account and no camera, each time in
 * the guest's own zone with the zone named, and one button that says the time. The first to pick settles it (user-flows 5).
 */
import type { Meta } from '@storybook/react-vite';
import { current } from '../../src/api/state';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { FOR_JONAS, FROM_ANA, PASSED } from '../../src/world/invitations';
import { invited } from './changes';

const meta = { title: 'Pages/Pick a time', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
/** Picks the second time offered. */
const picking: Play = async ({ canvas, userEvent, step }) => {
  await step('Pick the second time offered. The button says it', async () => {
    const times = await canvas.findAllByRole('button', { name: /·/ }, { timeout: 8000 });
    const second = times[1] ?? times[0];
    if (second) await userEvent.click(second);
  });
};
const confirming: Play = async ({ canvas, userEvent, step }) => {
  await step('Confirm it', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: /^Confirm / }));
  });
};

/** Jonas opens Art's link, with no account: Pick a time with Art. */
export const AsAGuest = page(`/join/${FOR_JONAS.code}`, 'signed-out', { beforeEach: changing(invited) });
export const AsAGuestPhone = phone(AsAGuest);
/** Picked: on Art's calendar, with a calendar file made in the browser. */
export const Picked = page(`/join/${FOR_JONAS.code}`, 'signed-out', {
  beforeEach: changing(invited),
  play: async (ctx) => { await picking(ctx); await confirming(ctx); }
});
/** Someone picked first: the page says which time was taken, and gives the call's link. */
export const SomeonePickedFirst = page(`/join/${FOR_JONAS.code}`, 'signed-out', {
  beforeEach: changing(invited),
  play: async (ctx) => {
    await picking(ctx);
    await ctx.step('Meanwhile, someone else with the link picks the first time', () => {
      const w = current();
      w.meetings = w.meetings.map((m) => {
        if (m.code !== FOR_JONAS.code) return m;
        const { offer: _picked, ...settled } = m;
        return settled;
      });
    });
    await confirming(ctx);
  }
});
/** All the times have passed: ask for new ones. */
export const TimesPassed = page(`/join/${PASSED.code}`, 'signed-out', { beforeEach: changing(invited) });
/** Signed in and invited: Art picks from the times Ana offered. */
export const SignedIn = page(`/join/${FROM_ANA.code}`, 'busy', { beforeEach: changing(invited) });
/** Art's own link, while it offers times: nobody can join until Jonas picks. */
export const WaitingForThem = page(`/join/${FOR_JONAS.code}`, 'busy', { beforeEach: changing(invited) });
