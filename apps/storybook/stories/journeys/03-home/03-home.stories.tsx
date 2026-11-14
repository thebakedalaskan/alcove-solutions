/*
 * Journeys on Home (docs/product/user-flows.md › 3. Home), as the canvas's Home board draws them
 * (docs/design/canvas/home/water.js, AH.HW.JOURNEYS), 3.8 and 3.9 as Upcoming's own canvas does
 * (docs/design/canvas/upcoming), and 3.10, the side panel's Home count landing on For you. Asking your notes from Search
 * or ask is the side panel's (2.4), and Start a call's modal is flow 4's. Google's pages can't open in Storybook, so
 * connecting the calendar plays up to the hand-off; Home as Google sends you back to it is in Pages/Home/Home (Back from
 * Google, Google didn't allow).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { notConnected } from '../../../src/world/build';
import { page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { onlyOwnEvents, yourMeeting } from '../../pages/changes';
import { before, holding, LAPTOP, LATER, SOON } from '../play';

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
    await step('Click Schedule. No chooser in between: the Calls page opens on the scheduler, beside the week', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }, SOON));
      await screen.findByRole('complementary', { name: 'Schedule a call' }, SOON);
    });
    await step('Who’s it with? Type a name and pick them', async () => {
      await userEvent.type(await screen.findByRole('combobox', { name: 'Add people' }, SOON), 'Priya');
      await userEvent.click(await screen.findByRole('option', { name: /Priya Raman/ }, SOON));
      await userEvent.keyboard('{Escape}');
    });
    await step('The call moves to the soonest time you’re both free, on the week beside it', async () => {
      await screen.findByText(/soonest time you.re both free/, {}, LATER);
    });
    await step('Schedule. It’s on your calendar, which is where you’ll join it, and Google Calendar invites Priya', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
      await screen.findByText(/Google Calendar invites Priya/, {}, SOON);
    });
  }
};

export const ACallIsAboutToStart: PageStory = {
  name: '3.3 A call is about to start',
  ...page('/home', 'call-soon'),
  play: async ({ userEvent, step }) => {
    await step('Only in the last few minutes, a slim line offers Join, Upcoming counts down, and the call at the foot of the side panel makes way. Click Join, or press J', async () => {
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
    await step('Click it, and its page opens: who’s invited, its link and its agenda', async () => {
      await userEvent.click(await within(await widget('Upcoming')).findByRole('link', { name: /^Fri 14:00 Pricing review/ }, SOON));
      await screen.findByRole('heading', { name: 'Pricing review', level: 1 }, LATER);
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
    await step('Undo. It’s back to Confirm, still in its place: every row keeps the place it had when Home opened', async () => {
      await userEvent.click(within(await holding('listitem', 'Orders placed before the move ship from the old warehouse.')).getByRole('button', { name: 'Undo' }));
      await within(await holding('listitem', 'Orders placed before the move ship from the old warehouse.')).findByRole('button', { name: 'Confirm' }, SOON);
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

export const SeeYourOwnEvents: PageStory = {
  name: '3.8 See your own events',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Events with only you on them aren’t calls, so Upcoming counts them at its foot. Click 2 with only you', async () => {
      await userEvent.click(await within(await widget('Upcoming')).findByRole('button', { name: '2 with only you' }, SOON));
    });
    await step('They show in their days, one slim line each after the hatch your own time has when you schedule. It’s a preference, so they stay shown wherever you’re signed in', async () => {
      await within(await widget('Upcoming')).findAllByRole('link', { name: /Focus time, only you/ }, SOON);
    });
    await step('Click 2 with only you again to hide them', async () => {
      await userEvent.click(within(await widget('Upcoming')).getByRole('button', { name: '2 with only you' }));
    });
  }
};

export const AWeekOfYourOwnEvents: PageStory = {
  name: '3.9 A week of only your own events',
  ...page('/home', 'busy'),
  beforeEach: before(onlyOwnEvents),
  play: async ({ userEvent, step }) => {
    await step('Nobody else is on anything this week: Upcoming says so, and how many of your own events it isn’t showing. Click Show them', async () => {
      await userEvent.click(await within(await widget('Upcoming')).findByRole('button', { name: 'Show them' }, SOON));
    });
    await step('Your week, quietly, in its days, with Show 4 more. The count at the foot hides it again', async () => {
      await within(await widget('Upcoming')).findByRole('button', { name: '12 with only you' }, SOON);
    });
  }
};

export const WhatsWaitingFromTheSidePanel: PageStory = {
  name: '3.10 What’s waiting, from the side panel',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    const count = () => screen.findByRole('link', { name: /^For you:/ }, SOON);
    await step('Home’s count in the side panel is everything waiting on you. Point at it: how much is in each of For you’s tabs', async () => {
      await userEvent.hover(await count());
    });
    await step('Click it. For you comes into view, on To answer, and its edge glows for a moment', async () => {
      await userEvent.click(await count());
      await screen.findByRole('tab', { name: /^To answer/, selected: true }, SOON);
    });
    await step('From any other page it does the same: Home opens on For you', async () => {
      await userEvent.click(within(screen.getByRole('complementary', { name: 'Side panel' })).getByRole('link', { name: 'Calls' }));
      await screen.findByRole('heading', { name: 'Calls', level: 1 }, SOON);
      await userEvent.click(await count());
      await screen.findByRole('tab', { name: /^To answer/, selected: true }, SOON);
    });
  }
};
