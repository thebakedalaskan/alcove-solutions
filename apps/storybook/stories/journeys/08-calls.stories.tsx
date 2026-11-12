/*
 * Journeys on Calls (docs/product/user-flows.md › 8. Calls), as the Calls board draws them (the design canvas's JOURNEYS):
 * open a call, find what was said, see the week, answer an invitation and a request to move, follow a series, connect a
 * calendar, ask every call, the first day, and meet again. The busy afternoon, with Calls' own additions
 * (src/world/calls-page.ts).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { callsDay } from '../../src/world/calls-page';
import { inEveryState } from '../../src/world/states';
import { noCalendar } from '../pages/changes';
import { first, LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/8 Calls', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

const day = { beforeEach: changing(callsDay) };
const line = () => screen.findByRole('textbox', { name: 'Search every call, or ask' }, SOON);
const sheet = () => screen.findByRole('region', { name: 'Your calls' }, SOON);
const rail = () => screen.findByRole('navigation', { name: 'Your calls' }, SOON);

export const OpenACall: PageStory = {
  name: '8.1 Open a call',
  ...page('/calls', 'busy', day),
  play: async ({ userEvent, step }) => {
    await step('Past calls, newest first, with what waits on you. Click Past calls', async () => {
      await userEvent.click(within(await rail()).getByRole('link', { name: 'Past calls' }));
    });
    await step('Click Pricing sync', async () => {
      await userEvent.click(await within(await sheet()).findByRole('link', { name: 'Pricing sync' }, SOON));
    });
    await step('The call opens: watch it back, and what came of it', async () => {
      await screen.findByRole('heading', { name: 'Pricing sync', level: 1 }, LATER);
    });
  }
};

export const FindWhatWasSaid: PageStory = {
  name: '8.2 Find what was said',
  ...page('/calls', 'busy', day),
  play: async ({ userEvent, step }) => {
    await step('Type in the line on the sky, or press ⌘K', async () => {
      await userEvent.type(await line(), 'flag');
    });
    await step('Each call quotes the line it was said in, with a chip for each moment. Click one', async () => {
      await userEvent.click(await first(within(await sheet()).findAllByRole('link', { name: /^Open Team standup at / }, SOON)));
    });
    await step('The call opens at that moment, not playing', async () => {
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, LATER);
    });
  }
};

export const SeeTheWeek: PageStory = {
  name: '8.3 See the week',
  ...page('/calls?view=soon', 'busy', day),
  play: async ({ userEvent, step }) => {
    await step('Coming up, day by day. Click Week', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Week/ }, SOON));
    });
    await step('The week, hour by hour: what happened, with what waits on you marked, and what’s ahead. The sun is now', async () => {
      await screen.findByRole('group', { name: 'This week' }, SOON);
    });
    await step('Next week, then back to today', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
      await screen.findByRole('group', { name: 'Next week' }, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Today' }));
      await screen.findByRole('group', { name: 'This week' }, SOON);
    });
  }
};

export const AnswerAnInvitation: PageStory = {
  name: '8.4 Answer an invitation',
  ...page('/calls?view=soon', 'busy', day),
  play: async ({ userEvent, step }) => {
    await step('Priya invited you to the roadmap review. Click Yes', async () => {
      const answer = await screen.findByRole('group', { name: 'Are you going to Roadmap review?' }, SOON);
      await userEvent.click(within(answer).getByRole('button', { name: 'Yes' }));
    });
    await step('You’re going, and Priya sees it. Change opens the answers again', async () => {
      await screen.findByText('You’re going', {}, SOON);
      await screen.findByRole('button', { name: 'Change your answer to Roadmap review' }, SOON);
    });
  }
};

export const AnswerARequestToMove: PageStory = {
  name: '8.5 Answer a request to move',
  ...page('/calls?view=soon', 'busy', day),
  play: async ({ userEvent, step }) => {
    await step('Diego asks to move the Harbourline proposal. It waits on you, in rose. Click Move it', async () => {
      const asked = await screen.findByRole('group', { name: 'Diego asks to move Harbourline proposal' }, SOON);
      await userEvent.click(within(asked).getByRole('button', { name: 'Move it' }));
    });
    await step('Moved, and everyone invited is told', async () => {
      await screen.findByText(/^Moved to /, {}, SOON);
    });
  }
};

export const FollowASeries: PageStory = {
  name: '8.6 Follow a series',
  ...page('/calls', 'busy', { beforeEach: changing(callsDay, inEveryState) }),
  play: async ({ userEvent, step }) => {
    await step('Under Series, click Team standup', async () => {
      await userEvent.click(await within(await rail()).findByRole('link', { name: /^Team standup/ }, SOON));
    });
    await step('Its next call, the standups so far, and what carries over from them', async () => {
      await screen.findByRole('heading', { name: 'Team standup', level: 2 }, SOON);
      await screen.findByRole('region', { name: 'What carries over' }, SOON);
    });
  }
};
export const ConnectYourCalendar: PageStory = {
  name: '8.7 Connect your calendar',
  ...page('/calls', 'busy', { beforeEach: changing(callsDay, noCalendar) }),
  play: async ({ userEvent, step }) => {
    await step('Without a calendar only Alcove calls show, and one line offers to connect it. Click Connect', async () => {
      await userEvent.click(await within(await sheet()).findByRole('link', { name: 'Connect' }, SOON));
    });
    await step('It says what Alcove does with the calendar, then goes on to Google', async () => {
      await screen.findByRole('dialog', { name: 'Connect Google Calendar' }, LATER);
    });
  }
};

export const AskEveryCall: PageStory = {
  name: '8.8 Ask every call',
  ...page('/calls', 'busy', day),
  play: async ({ userEvent, step }) => {
    await step('Type a question, then press Enter or click Ask', async () => {
      await userEvent.type(await line(), 'What did we decide about the launch?{Enter}');
    });
    await step('Read in confidential compute. The answer lands on the sheet with the calls it comes from', async () => {
      await screen.findByRole('region', { name: 'The answer' }, SOON);
      await screen.findByRole('heading', { name: 'Asked across every call' }, SOON);
    });
    await step('Typing puts it away', async () => {
      await userEvent.type(await line(), ' And');
      await screen.findByRole('textbox', { name: 'Search every call, or ask' }, SOON);
    });
  }
};

export const TheFirstDay: PageStory = {
  name: '8.9 The first day',
  ...page('/calls', 'first-day'),
  play: async ({ userEvent, step }) => {
    await step('No calls yet: connect a calendar, or start one', async () => {
      await within(await sheet()).findByRole('link', { name: /Connect Google Calendar/ }, SOON);
    });
    await step('Click Start a call now', async () => {
      await userEvent.click(within(await sheet()).getByRole('button', { name: 'Start a call now' }));
    });
    await step('The same flow as everywhere', async () => {
      await screen.findByRole('dialog', { name: 'Start a call' }, SOON);
    });
  }
};

export const MeetAgain: PageStory = {
  name: '8.10 Meet again',
  ...page('/calls?view=past', 'busy', day),
  play: async ({ userEvent, step }) => {
    await step('A past call’s menu has Meet again', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'More for Pricing sync' }, SOON));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Meet again' }, SOON));
    });
    await step('Scheduling opens in place of the list, with the same people and name, beside the week', async () => {
      await screen.findByRole('complementary', { name: 'Schedule a call' }, SOON);
      await screen.findByRole('textbox', { name: 'The call’s name' }, SOON);
    });
  }
};
