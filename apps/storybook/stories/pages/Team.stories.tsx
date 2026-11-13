/* Team: your company standing on the horizon, your groups and the people not on Alcove yet on the water (user-flows 10). */
import type { Meta } from '@storybook/react-vite';
import { setOnline } from '../../src/browser';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { troubled } from './changes';

const meta = { title: 'Pages/Team', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Presses someone's arch on the line: their popover opens under it, or a sheet on a phone. */
const opening = (who: RegExp, said: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await canvas.findByRole('button', { name: who }));
  });
};

export const Busy = page('/team', 'busy');
export const BusyPhone = phone(Busy);
export const FirstDay = page('/team', 'first-day');
export const Lots = page('/team', 'lots');
/** A group open, from its tile under the water. */
export const AGroup = page('/team?group=g-product', 'busy');
/** Deleting a group asks once, in a popover, and can be undone for a few seconds after. */
export const DeleteAGroup = page('/team?group=g-product', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Delete Product. It asks once', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Delete Product' }, { timeout: 8000 }));
    });
  }
});
/** A new group being made: name it, then fill it. */
export const NewGroup = page('/team?group=new', 'busy');
/** Someone on their own has no team: the address goes Home. */
export const OnTheirOwn = page('/team', 'on-their-own');

/** Priya's popover: when you're next in a call together, Ring, Schedule, and the notes you both have. */
export const APerson = page('/team', 'busy', { play: opening(/^Priya Raman$/, 'Press Priya’s arch') });
export const APersonPhone = phone(APerson);
/** Someone not on Alcove yet: Invite in place of Ring. */
export const NotOnAlcoveYet = page('/team', 'busy', { play: opening(/^Lena Fischer, not on Alcove yet$/, 'Press Lena’s dashed arch: she isn’t on Alcove yet') });
/** Your own arch: your address, the groups you're in, and Settings. */
export const You = page('/team', 'busy', { play: opening(/^You, /, 'Press your own arch, in the middle of the line') });
/** Invite people: tick the colleagues not on Alcove yet, or type anyone's address. */
export const InvitePeople = page('/team', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Invite people', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Invite people' }));
    });
  }
});
/** Past thirteen people the far ones recede: All 33 people finds anyone. */
export const AllPeople = page('/team', 'lots', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press All people, to find anyone at Vandelay', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: /^All \d+ people$/ }));
    });
  }
});

/** The team is on its way: empty arches wait on the line beside you. */
export const Loading = page('/team', 'busy', { beforeEach: changing(troubled({ 'people.team': 'hold' })) });
/** The connection went before the team arrived: it shows when you're back. */
export const OfflineBeforeItLoaded = page('/team', 'busy', {
  beforeEach: changing(troubled({ 'people.team': 'hold' })),
  play: async ({ canvas, step }) => {
    await step('The connection drops while the team is on its way', async () => {
      await canvas.findByRole('heading', { name: 'Your team' }, { timeout: 8000 });
      setOnline(false);
    });
  }
});
/** The team didn't load: why, and Try again. Your groups didn't either, and their section says so. */
export const DidntLoad = page('/team', 'busy', { beforeEach: changing(troubled({ 'people.team': 'failed', 'account.preferences': 'failed' })) });
/** Opened without a connection: Team needs one, and Record still works. */
export const Offline = page('/team', 'offline');
