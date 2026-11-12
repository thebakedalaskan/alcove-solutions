/*
 * Journeys from the side panel and the palette (docs/product/user-flows.md › 2. The side panel). Asking your notes is the
 * canvas's Home board journey (docs/design/canvas/home.js); the rest are the panel's own.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { setOnline } from '../../src/browser';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { SOON } from './play';

const meta = { title: 'Journeys/2 The side panel', ...pages } satisfies Meta<PageArgs>;
export default meta;

const palette = () => screen.findByRole('dialog', { name: 'Search or ask' }, SOON);

export const AskYourNotes: PageStory = {
  name: '2.1 Ask your notes',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Search or ask, or press ⌘K', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
    });
    await step('Type your own question, and press Enter', async () => {
      await userEvent.type(within(await palette()).getByRole('combobox'), 'Who writes the help article for support?');
      await userEvent.keyboard('{Enter}');
    });
    await step('The answer cites the moment it came from', async () => {
      await within(await palette()).findByRole('link', { name: 'Team standup at 6:02' }, SOON);
    });
    await step('The citation opens the note there, not playing', async () => {
      await userEvent.click(within(await palette()).getByRole('link', { name: 'Team standup at 6:02' }));
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, SOON);
    });
  }
};

export const FindANote: PageStory = {
  name: '2.2 Find a note',
  ...page('/notes/n4', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Press ⌘K. Before anything is typed, it lists your five newest notes', async () => {
      await screen.findByRole('heading', { name: 'Design review', level: 1 }, SOON);
      await userEvent.keyboard('{Meta>}k{/Meta}');
      await within(await palette()).findByRole('listbox', { name: 'Recent notes' }, SOON);
    });
    await step('Type. It lists the notes that say it, with the match marked', async () => {
      await userEvent.type(within(await palette()).getByRole('combobox'), 'warehouse');
      await within(await palette()).findByRole('option', { name: /Art’s call/ }, SOON);
    });
    await step('↓ picks a note, and Enter opens it', async () => {
      await userEvent.keyboard('{ArrowDown}{Enter}');
      await screen.findByRole('heading', { name: 'Art’s call', level: 1 }, SOON);
    });
  }
};

export const PinANote: PageStory = {
  name: '2.3 Pin a note',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click the pin beside Pinned. The palette opens to pick notes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Pin a note' }, SOON));
    });
    await step('Pin this morning’s standup', async () => {
      const picker = await screen.findByRole('dialog', { name: 'Pin a note' }, SOON);
      await userEvent.click(within(picker).getByRole('option', { name: /^Team standup .* Pin$/ }));
      await within(picker).findByRole('option', { name: /^Team standup .* Unpin$/ }, SOON);
      await userEvent.click(within(picker).getByRole('button', { name: 'Done' }));
    });
    await step('It stays in the side panel, after the notes pinned before it', async () => {
      await within(await screen.findByRole('complementary', { name: 'Side panel' })).findByRole('link', { name: 'Team standup' }, SOON);
    });
  }
};

export const HideTheSidePanel: PageStory = {
  name: '2.4 Hide the side panel',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Hide the side panel. The page has the room', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Hide the side panel' }, SOON));
    });
    await step('The button left in the corner brings it back. This browser remembers which', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Show the side panel' }, SOON));
      await screen.findByRole('button', { name: 'Hide the side panel' }, SOON);
    });
  }
};

export const GroupsAndMinutes: PageStory = {
  name: '2.5 A group, and the notes left',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click a group. It opens on the Team page', async () => {
      await userEvent.click(await screen.findByRole('link', { name: 'Product 4 people' }, SOON));
      await screen.findByRole('heading', { name: 'Team', level: 1 }, SOON);
    });
    await step('On Free, Upgrade to Pro sits above the time of notes left. The time opens Settings at your plan', async () => {
      await screen.findByRole('link', { name: 'Upgrade to Pro' }, SOON);
      await userEvent.click(screen.getByRole('link', { name: /of notes left$/ }));
      await screen.findByRole('region', { name: 'Plan' }, SOON);
    });
  }
};

export const TheConnectionDrops: PageStory = {
  name: '2.6 The connection drops',
  ...page('/home', 'busy'),
  play: async ({ step }) => {
    await step('The connection goes. A notice says recording still works, and the rest catches up when you’re back', async () => {
      await screen.findByRole('heading', { name: 'Wednesday 4 November', level: 1 }, SOON);
      setOnline(false);
      await screen.findAllByText(/Recording still works/, {}, SOON);
    });
    await step('It comes back, and so does everything else', async () => {
      setOnline(true);
      await screen.findByRole('button', { name: 'Start now' }, SOON);
    });
  }
};
