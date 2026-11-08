/** Optional AI review beside the stable actual checklist (user-flows 6.23–6.25). */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { sessions } from '~/lib/live';
import { at, says } from '../../src/api/script';
import { inCall, plays, press, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { FOLLOW_UP_NEW, FOLLOW_UP_TARGET, FOLLOW_UP_TASK } from '../../src/world/follow-ups';
import { PRIYA } from '../../src/world/people';
import { FOLLOW_UP_SCRIPT } from '../calls/followUps';
import { REVIEW } from '../calls/talk';
import { holding, LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/6 Follow-up proposals', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;
const batch = () => screen.findByRole('region', { name: 'Suggestions from the call' }, SOON);
const open = plays(reach('Workspace'), press('Follow-ups'), press('2 suggestions from the call'));

export const ReviewInTheCall: PageStory = {
  name: '6.23 Review suggestions in the call',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: FOLLOW_UP_SCRIPT }, { globals: LAPTOP }),
  play: async (c) => {
    await open(c);
    await c.step('Add the suggested handover to the shared checklist. Its owner has not taken responsibility', async () => {
      await c.userEvent.click(within(await holding('article', FOLLOW_UP_NEW.text)).getByRole('button', { name: 'Add' }));
      await within(await batch()).findByText('Added', {}, SOON);
    });
    await c.step('Dismiss the proposed checklist change. Both review rows stay where they were', async () => {
      await c.userEvent.click(within(await holding('article', 'Send the reviewed launch checklist')).getByRole('button', { name: 'Dismiss' }));
      await within(await batch()).findByText('Dismissed', {}, SOON);
    });
    await c.step('Close review and mark the actual handover done for everyone', async () => {
      await c.userEvent.click(within(await batch()).getByRole('button', { name: 'Close suggestions' }));
      await c.userEvent.click(await screen.findByRole('checkbox', { name: /Draft the support handover/ }, SOON));
    });
  }
};

export const FixedReviewBatch: PageStory = {
  name: '6.24 Keep a fixed review batch',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: {
    ...FOLLOW_UP_SCRIPT,
    cues: at(12, says(PRIYA, 'We should check the launch email on Thursday.', { hands: { text: 'Check the launch email', due: 'Thursday' } }))
  } }, { globals: LAPTOP }),
  play: async (c) => {
    await open(c);
    await c.step('Keep reading these two proposals while a new one waits below the fixed batch', async () => {
      await within(await batch()).findByText('1 more suggestion waiting', {}, LATER);
    });
    await c.step('Dismiss the handover without moving the remaining review controls', async () => {
      await c.userEvent.click(within(await holding('article', FOLLOW_UP_NEW.text)).getByRole('button', { name: 'Dismiss' }));
      await within(await batch()).findByText('Dismissed', {}, SOON);
    });
    await c.step('Close and reopen review when ready to include the new suggestion', async () => {
      await c.userEvent.click(within(await batch()).getByRole('button', { name: 'Close suggestions' }));
      await c.userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }, SOON));
      await within(await batch()).findByText('Check the launch email', {}, SOON);
    });
  }
};

export const ChangedWhileReviewing: PageStory = {
  name: '6.25 A follow-up changes during review',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: FOLLOW_UP_SCRIPT }, { globals: LAPTOP }),
  play: async (c) => {
    await open(c);
    await c.step('Someone changes the actual checklist while this proposal is open', async () => {
      const session = sessions.call?.session;
      if (!session) throw new Error('The story has no active call.');
      const { id: _id, ...seen } = FOLLOW_UP_TARGET;
      await session.updateFollowUp(FOLLOW_UP_TASK.id, { seen, due: 'Thursday' });
    });
    await c.step('Apply change keeps the actual edit and explains that the proposal needs a fresh review', async () => {
      await c.userEvent.click(within(await holding('article', 'Send the reviewed launch checklist')).getByRole('button', { name: 'Apply change' }));
      await within(await batch()).findByText('That follow-up changed. Close review and open it again.', {}, SOON);
    });
  }
};
