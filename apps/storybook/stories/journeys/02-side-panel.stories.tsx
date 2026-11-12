/*
 * Journeys from the side panel and Search or ask (docs/product/user-flows.md › 2. The side panel). The first four are the
 * search canvas's (docs/design/canvas/StepsSearch.dc.html): find what someone said, search a word and open the moment,
 * see all in Calls, and ask a question and open a cited moment. The rest are the panel's own.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { setOnline } from '../../src/browser';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { LAPTOP, SOON } from './play';

const meta = { title: 'Journeys/2 The side panel', ...pages } satisfies Meta<PageArgs>;
export default meta;

const palette = () => screen.findByRole('dialog', { name: 'Search or ask' }, SOON);
const line = async () => within(await palette()).getByRole('combobox', { name: /Search or ask your notes/ });
/** Waits until the lit row, the one the line points at, says `text`. */
const lit = (text: RegExp) => waitFor(async () => {
  const id = (await line()).getAttribute('aria-activedescendant');
  const row = id ? document.getElementById(id) : null;
  if (!row || !text.test(row.textContent ?? '')) throw new Error(`The lit row doesn’t say ${String(text)} yet.`);
}, SOON);

export const FindWhatSomeoneSaid: PageStory = {
  name: '2.1 Find what someone said',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Click Search or ask, or press ⌘K. The people you meet most come first, then your recent notes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
      await within(await palette()).findByRole('button', { name: 'What Maya said' }, SOON);
    });
    await step('Type a name. They come first, lit, then every moment they spoke, call by call', async () => {
      await userEvent.type(await line(), 'maya');
      await lit(/Maya Chen/);
    });
    await step('Press Enter. Only what Maya said, newest call first, with her name in the line', async () => {
      await userEvent.keyboard('{Enter}');
      await within(await palette()).findByRole('listbox', { name: 'What Maya said' }, SOON);
    });
    await step('Type “flag” to narrow it. The lit moment shows beside the list, in its transcript', async () => {
      await userEvent.type(await line(), 'flag');
      await lit(/Does the flag change anything/);
    });
    await step('Press Enter. The note opens at that moment', async () => {
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, SOON);
    });
  }
};

export const SearchAWord: PageStory = {
  name: '2.2 Search a word and open the moment',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Open Search or ask, and type a word. Each match is a moment: who said it, their words, and when', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
      await userEvent.type(await line(), 'flag');
      await lit(/Agreed\. Put it behind a flag/);
    });
    await step('Press ↓ twice. A moment that became a decision says so, and can be confirmed right here', async () => {
      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      await lit(/new onboarding ships behind a flag/);
      await userEvent.click(await within(await palette()).findByRole('button', { name: 'Confirm' }, SOON));
      await within(await palette()).findByText('Confirmed by you', {}, SOON);
    });
    await step('Press Enter. The note opens at 3:15', async () => {
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, SOON);
    });
  }
};

export const SeeAllInCalls: PageStory = {
  name: '2.3 See all in Calls',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Open Search or ask, and type a word. More than fits? See all, at the foot of the list', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
      await userEvent.type(await line(), 'flag');
      await userEvent.click(await within(await palette()).findByRole('option', { name: /^See all .* in Calls/ }, SOON));
    });
    await step('Calls opens with the same words in its line: every call that has them, each with its moments', async () => {
      await screen.findByRole('heading', { name: 'Calls', level: 1 }, SOON);
      await screen.findByDisplayValue('flag', {}, SOON);
    });
  }
};

export const AskAQuestion: PageStory = {
  name: '2.4 Ask a question and open a cited moment',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Open Search or ask, and type a question. Ask comes first and is lit, so Enter asks', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
      await userEvent.type(await line(), 'Who writes the help article for support?');
      await lit(/^Ask/);
    });
    await step('Press Enter. The answer is written in confidential compute, from your notes only, with the moments it comes from', async () => {
      await userEvent.keyboard('{Enter}');
      await within(await palette()).findByRole('listbox', { name: 'From your notes' }, SOON);
    });
    await step('Click a moment it comes from. The note opens there, not playing', async () => {
      await userEvent.click(await within(await palette()).findByRole('option', { name: /help article before the flag goes on/ }, SOON));
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, SOON);
    });
  }
};

export const PinANote: PageStory = {
  name: '2.5 Pin a note',
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
  name: '2.6 Hide the side panel',
  ...page('/calls', 'busy'),
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
  name: '2.7 A group, and the notes left',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click a group. It opens on the Team page', async () => {
      await userEvent.click(await screen.findByRole('link', { name: 'Product 4 people' }, SOON));
      await screen.findByRole('heading', { name: 'Team', level: 1 }, SOON);
    });
    await step('The time of notes left opens Settings at your minutes', async () => {
      await userEvent.click(screen.getByRole('link', { name: /of notes left$/ }));
      await screen.findByRole('region', { name: 'Plan and credits' }, SOON);
    });
  }
};

export const TheConnectionDrops: PageStory = {
  name: '2.8 The connection drops',
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
