/*
 * Journeys on Home (docs/product/user-flows.md › 3. Home), as the canvas's Home board draws them
 * (docs/design/canvas/home/water.js, AH.HW.JOURNEYS). Asking your notes from Search or ask is the side panel's (2.4), and
 * Start a call's modal is flow 4's. Google's pages can't open in Storybook, so connecting the calendar plays up to the
 * hand-off; Home as Google sends you back to it is in Pages/Home (Back from Google, Google didn't allow).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { notConnected } from '../../src/world/build';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { yourMeeting } from '../pages/changes';
import { before, holding, LATER, SOON } from './play';

const meta = { title: 'Journeys/3 Home', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** One of Home's widgets, by its title. */
const widget = (name: string) => screen.findByRole('region', { name }, SOON);

export const StartACallNow: PageStory = {
  name: '3.1 Start a call now',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Start now. Nothing in between', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Start now' }, SOON));
    });
    await step('The join screen. Copy the link, or go straight in', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Copy link' }, SOON));
      await screen.findByText('Link copied', {}, SOON);
    });
    await step('Join. You’re in the call, and nobody else is here yet', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Join' }));
      await screen.findByRole('toolbar', { name: 'Call controls' }, LATER);
    });
  }
};

export const ScheduleACall: PageStory = {
  name: '3.2 Schedule a call',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Schedule. No chooser in between', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }, SOON));
    });
    await step('Who’s it with? Type a name and pick them', async () => {
      await userEvent.type(await screen.findByRole('combobox', { name: 'Add people' }, SOON), 'Priya');
      await userEvent.click(await screen.findByRole('option', { name: /Priya Raman/ }, SOON));
      await userEvent.click(screen.getByRole('button', { name: 'Find a time' }));
    });
    await step('When? Only times you’re free. The best one is picked already', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Use / }, SOON));
    });
    await step('Check the details, then Schedule', async () => {
      await screen.findByRole('textbox', { name: 'Name the call' }, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    });
    await step('Back on Home. It rises into Upcoming, under its day, and it’s on your calendar, which is where you’ll join it', async () => {
      await screen.findByText(/On your Google Calendar/, {}, SOON);
      await within(await widget('Upcoming')).findByRole('button', { name: /Call with Priya/ }, SOON);
    });
  }
};

export const ACallIsAboutToStart: PageStory = {
  name: '3.3 A call is about to start',
  ...page('/home', 'call-soon'),
  play: async ({ userEvent, step }) => {
    await step('Only in the last few minutes, a slim line offers Join, Upcoming counts down, and the side panel’s Up next makes way. Click Join, or press J', async () => {
      const line = await screen.findByRole('region', { name: 'Start a call' }, SOON);
      await within(line).findByText('Design review');
      await userEvent.click(within(line).getByRole('link', { name: 'Join' }));
    });
    await step('The join screen, the only place a camera shows', async () => {
      await screen.findByRole('heading', { name: 'Design review', level: 1 }, SOON);
      await screen.findByRole('button', { name: 'Join' }, SOON);
    });
  }
};

export const MoveAMeetingToAlcove: PageStory = {
  name: '3.4 Move a meeting to Alcove',
  ...page('/home', 'busy'),
  beforeEach: before(yourMeeting),
  play: async ({ userEvent, step }) => {
    await step('A meeting you organized on Google Calendar has Use Alcove at the end of its row', async () => {
      await userEvent.click(within(await holding('listitem', 'Pricing review')).getByRole('button', { name: 'Use Alcove' }));
    });
    await step('It’s an Alcove call now: the meeting gets an Alcove link, Google tells everyone on it, and the toast says who', async () => {
      await screen.findByText(/Pricing review is an Alcove call now/, {}, SOON);
    });
    await step('Click it, and its call card opens over Home', async () => {
      await userEvent.click(await within(await widget('Upcoming')).findByRole('button', { name: /^Fri 14:00 Pricing review/ }, SOON));
      await screen.findByRole('dialog', { name: /Pricing review/ }, SOON);
    });
  }
};

export const ClearWhatsWaiting: PageStory = {
  name: '3.5 Clear what’s waiting',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Answer in the row. No page to open: Confirm the decision from Art’s call', async () => {
      const row = await holding('listitem', 'Orders placed before the move ship from the old warehouse.');
      await userEvent.click(within(row).getByRole('button', { name: 'Confirm' }));
    });
    await step('The row stays where it is and says Confirmed, with Undo. Nothing jumps', async () => {
      await within(await holding('listitem', 'Orders placed before the move ship from the old warehouse.')).findByRole('button', { name: 'Undo' }, SOON);
    });
    await step('Take one on with I’ll do it, or the ✕ for Not mine', async () => {
      await userEvent.click(within(await holding('listitem', 'Book the movers for the 14th')).getByRole('button', { name: 'I’ll do it' }));
      await userEvent.click(within(await holding('listitem', 'List which suppliers move with us')).getByRole('button', { name: 'Not mine' }));
      await within(await holding('listitem', 'List which suppliers move with us')).findByRole('button', { name: 'It’s mine' }, SOON);
    });
    await step('What you took on is in Follow-ups now', async () => {
      await userEvent.click(within(await widget('For you')).getByRole('tab', { name: /^Follow-ups/ }));
      await within(await screen.findByRole('list', { name: 'Your follow-ups' }, SOON)).findByText('Book the movers for the 14th', {}, SOON);
    });
  }
};

export const TickOffAFollowUp: PageStory = {
  name: '3.6 Tick off a follow-up',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Show 3 more: the rest of what’s waiting on you', async () => {
      await userEvent.click(within(await widget('For you')).getByRole('button', { name: 'Show 3 more' }));
    });
    await step('Take on the launch checklist from this morning’s standup: it’s due today', async () => {
      await userEvent.click(within(await holding('listitem', 'Review the launch checklist')).getByRole('button', { name: 'I’ll do it' }));
      await within(await holding('listitem', 'Review the launch checklist')).findByText('In your follow-ups', {}, SOON);
    });
    await step('Open Follow-ups, and tick the box', async () => {
      await userEvent.click(within(await widget('For you')).getByRole('tab', { name: /^Follow-ups/ }));
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Mark done: Review the launch checklist' }, SOON));
    });
    await step('It crosses out where it is, until you leave Home', async () => {
      await screen.findByRole('checkbox', { name: 'Done: Review the launch checklist', checked: true }, SOON);
    });
  }
};

export const YourFirstDay: PageStory = {
  name: '3.7 Your first day',
  ...page('/home', 'first-day'),
  beforeEach: before((w) => { w.calendar = notConnected; }),
  play: async ({ userEvent, step }) => {
    await step('Before any notes: start your first call. For you says what will show up there', async () => {
      await screen.findByRole('region', { name: 'Start your first call' }, SOON);
      await within(await widget('For you')).findByText('Nothing to answer yet', {}, SOON);
    });
    await step('Upcoming is the way to connect your calendar. Connect Google Calendar goes straight to Google, with nothing in between, and Google sends you back to Home', async () => {
      await userEvent.click(within(await widget('Upcoming')).getByRole('link', { name: 'Connect Google Calendar' }));
    });
    await step('Read the example note in Recent notes, to see what notes look like', async () => {
      await userEvent.click(within(await widget('Recent notes')).getByRole('link', { name: 'Weekly product call' }));
      await screen.findByRole('heading', { level: 1 }, SOON);
    });
  }
};
