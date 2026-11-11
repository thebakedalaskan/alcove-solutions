/*
 * Journeys on Home (docs/product/user-flows.md › 3. Home), as the canvas's Home board draws them (docs/design/canvas/home.js,
 * AH.JOURNEYS_HOME and AH.JOURNEYS). Asking your notes from Search or ask is the side panel's (2.1), and Start a call's
 * modal is flow 4's.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { calendarEvent, notConnected } from '../../src/world/build';
import { iso } from '../../src/world/clock';
import { LENA, MAYA } from '../../src/world/people';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { before, holding, LATER, SOON } from './play';

const meta = { title: 'Journeys/3 Home', ...pages } satisfies Meta<PageArgs>;
export default meta;

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
    await step('Back on Home. It’s on your calendar, which is where you’ll join it', async () => {
      await screen.findByText(/On your Google Calendar/, {}, SOON);
      await within(await screen.findByRole('region', { name: 'Coming up' })).findByRole('button', { name: /Call with Priya/ }, SOON);
    });
  }
};

export const RingSomeone: PageStory = {
  name: '3.3 Ring someone',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click someone you talk to', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Ring Priya Raman' }, SOON));
    });
    await step('The join screen, and they get a ring as you join', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Join and ring 1' }, SOON));
    });
    await step('In the call, Priya’s arch waits for her answer, and she comes in', async () => {
      await screen.findByRole('toolbar', { name: 'Call controls' }, LATER);
      await screen.findByRole('group', { name: /^Priya/ }, LATER);
    });
  }
};

export const ACallIsAboutToStart: PageStory = {
  name: '3.4 A call is about to start',
  ...page('/home', 'call-soon'),
  play: async ({ userEvent, step }) => {
    await step('Only in the last few minutes, a slim line offers Join, and the side panel’s Up next makes way for it. Click it, or press J', async () => {
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

/** A meeting Art set up on Google Calendar himself, on Google Meet: it can move to Alcove. */
const PRICING_REVIEW = calendarEvent({ id: 'e-pricing-review', title: 'Pricing review', startsAt: iso(2, 14, 0), minutes: 30, guests: [MAYA, LENA], meet: true });

export const MoveAMeetingToAlcove: PageStory = {
  name: '3.5 Move a meeting to Alcove',
  ...page('/home', 'busy'),
  beforeEach: before((w) => { w.calendar.events.push(structuredClone(PRICING_REVIEW)); }),
  play: async ({ userEvent, step }) => {
    await step('Open the menu on a meeting in Coming up', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'More for Pricing review' }, SOON));
    });
    await step('Use Alcove instead. The meeting gets an Alcove link, and Google tells everyone on it', async () => {
      const menu = await screen.findByRole('dialog', { name: 'Pricing review' }, SOON);
      await userEvent.click(within(menu).getByRole('button', { name: /^Use Alcove instead/ }));
    });
    await step('It’s an Alcove call now. Click it, and its call card opens over Home', async () => {
      const coming = await screen.findByRole('region', { name: 'Coming up' });
      await userEvent.click(await within(coming).findByRole('button', { name: /^Fri 14:00 Pricing review/ }, SOON));
      await screen.findByRole('dialog', { name: /Pricing review/ }, SOON);
    });
  }
};

export const ClearWhatsWaiting: PageStory = {
  name: '3.6 Clear what’s waiting',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Answer on the tile. No page to open: Confirm the decision from Art’s call', async () => {
      const tile = await holding('listitem', 'Orders placed before the move ship from the old warehouse.');
      await userEvent.click(within(tile).getByRole('button', { name: 'Confirm' }));
    });
    await step('It says what you did, with Undo. Nothing jumps', async () => {
      await screen.findByText('Confirmed for everyone.', {}, SOON);
    });
    await step('Take it on, or the ✕ for Not mine', async () => {
      await userEvent.click(within(await holding('listitem', 'Book the movers for the 14th')).getByRole('button', { name: 'I’ll do it' }));
      await userEvent.click(within(await holding('listitem', 'List which suppliers move with us')).getByRole('button', { name: 'Not mine' }));
      await screen.findByText('Nobody has it now.', {}, SOON);
    });
    await step('Next time you’re here, what you took on is on your list', async () => {
      await userEvent.click(screen.getByRole('link', { name: /^Notes/ }));
      await screen.findByRole('heading', { name: 'Notes', level: 1 }, SOON);
      await userEvent.click(screen.getByRole('link', { name: /^Home/ }));
      await screen.findByRole('list', { name: 'Your follow-ups' }, SOON);
    });
  }
};

export const TickOffAFollowUp: PageStory = {
  name: '3.7 Tick off a follow-up',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Take on the launch checklist from this morning’s standup: it joins your follow-ups', async () => {
      await userEvent.click(within(await holding('listitem', 'Review the launch checklist')).getByRole('button', { name: 'I’ll do it' }));
      await screen.findByRole('list', { name: 'Your follow-ups' }, SOON);
    });
    await step('Tick the box', async () => {
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Mark done: Review the launch checklist' }, SOON));
    });
    await step('It crosses out where it is, until you leave Home', async () => {
      await screen.findByRole('checkbox', { name: 'Done: Review the launch checklist', checked: true }, SOON);
    });
  }
};

export const YourFirstDay: PageStory = {
  name: '3.8 Your first day',
  ...page('/home', 'first-day'),
  beforeEach: before((w) => { w.calendar = notConnected; }),
  play: async ({ userEvent, step }) => {
    await step('Before any notes: start a call, or get set up', async () => {
      await screen.findByRole('region', { name: 'Start your first call' }, SOON);
      await screen.findByRole('region', { name: 'Get set up' }, SOON);
    });
    await step('Connect your calendar explains how Alcove uses it. Choose Not now to return to Home', async () => {
      await userEvent.click(await screen.findByRole('link', { name: 'Connect your calendar' }, SOON));
      const disclosure = await screen.findByRole('dialog', { name: 'Connect Google Calendar' }, SOON);
      await userEvent.click(within(disclosure).getByRole('button', { name: 'Not now' }));
      await screen.findByRole('region', { name: 'Get set up' }, SOON);
    });
    await step('Read an example note, to see what notes look like', async () => {
      await userEvent.click(screen.getByRole('link', { name: 'Read an example note' }));
      await screen.findByRole('heading', { level: 1 }, SOON);
    });
  }
};
