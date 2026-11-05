/*
 * Ending a call and getting its notes (docs/product/user-flows.md › 7. End the call and get the notes), which the
 * canvas never drew: from the call, through the sheet that becomes Call ended, to the note being written. The call is the
 * call stories' design review, twenty-three minutes in.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { inCall } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, KOFI, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from '../calls/talk';
import { LATER, SOON } from './play';

const meta = { title: 'Journeys/7 End the call and get the notes', ...pages } satisfies Meta<PageArgs>;
export default meta;

const LATE = { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], since: 23 * 60, earlier: REVIEW_TALK.slice(0, 12), talk: { lines: REVIEW_TALK.slice(12) }, summary: REVIEW_SUMMARY };

export const EndTheCall: PageStory = {
  name: '7.1 End the call and read the notes',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }, {}),
  play: async ({ userEvent, step }) => {
    await step('Leave opens a sheet. Stay in the call goes back', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
      await userEvent.click(await screen.findByRole('button', { name: 'Stay in the call' }, SOON));
    });
    await step('Leave, then End call for everyone. It sends the last audio and speech and ends the call', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, SOON));
      await userEvent.click(await screen.findByRole('button', { name: 'End call for everyone' }, SOON));
    });
    await step('The sheet becomes Call ended: who gets the notes, and how they’re coming along until they’re ready', async () => {
      await screen.findByText(/Call ended/, {}, LATER);
      await userEvent.click(await screen.findByRole('button', { name: /Read the notes/ }, LATER));
    });
    await step('The note: the call’s steps so far, then what it decided, what’s still open and what’s next', async () => {
      await screen.findByRole('heading', { name: 'Design review', level: 1 }, LATER);
    });
  }
};

export const LeaveAndKeepItGoing: PageStory = {
  name: '7.2 Leave and keep it going',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }, {}),
  play: async ({ userEvent, step }) => {
    await step('Leave. With someone invited in the call, whoever hosts can leave it going', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('Leave and keep it going: the person who’ll host is chosen already', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave and keep it going' }, SOON));
    });
    await step('The call goes on, the notes with it. The lobby says who’s hosting, and Join and host takes it back', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Join and host' }, LATER));
      await within(await screen.findByRole('toolbar', { name: 'Call controls' }, LATER)).findByRole('button', { name: 'Leave' }, SOON);
    });
  }
};
