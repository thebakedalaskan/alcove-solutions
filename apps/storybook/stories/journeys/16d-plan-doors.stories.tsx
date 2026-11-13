/*
 * Where checkout shows (docs/product/user-flows.md › 16, the canvas's Doors board): every place outside Plans and Settings
 * where someone meets a limit, says what ran out, and opens checkout with what fixes it chosen. Only whoever pays meets them:
 * a call's notes are on its organizer's plan. Checkout itself is the hand-off here, and the payment is the stand-in's to play:
 * the world's plan changes as a payment that lands would change it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { itemId } from '../../src/api/scenarios';
import { at, notesStop, run, type Present } from '../../src/api/script';
import { current } from '../../src/api/state';
import { inCall } from '../../src/call';
import { caretAtEnd, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { addToBalance, boughtFromBalance, freshEntryId } from '../../src/world/payments';
import { notesStopped, PRO_PRICE } from '../../src/world/plans';
import { AIKO, KOFI, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from '../calls/talk';
import { LAPTOP, LATER, SOON, first } from './play';

const meta = { title: 'Journeys/16 Where checkout shows', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Seven minutes into Art's design review, as the call stories have it. */
const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const LATE = { here: REVIEWERS, since: 7 * 60, earlier: REVIEW_TALK.slice(0, 9), talk: { lines: REVIEW_TALK.slice(9) }, summary: REVIEW_SUMMARY };

export const NotesRunOutInACall: PageStory = {
  name: '16.9 Notes run out in a call',
  ...inCall({
    scenario: 'call-soon', call: REVIEW,
    script: {
      ...LATE,
      cues: [
        ...at(4, run(() => { current().plan = notesStopped(); }), notesStop('notes')),
        // Art pays for a month of Pro from a phone while the call goes on: the payment is added and buys it in the same go,
        // as the server does, so the plan has Pro and the purchase since notes stopped.
        ...at(14, run(() => {
          const w = current();
          addToBalance(w, PRO_PRICE, '20');
          boughtFromBalance(w, { kind: 'pro', months: 1, microUsdPerMonth: PRO_PRICE }, freshEntryId(w));
        }))
      ]
    }
  }, {
    globals: LAPTOP,
    play: async ({ userEvent, step }) => {
      await step('Art’s notes for this period run out at its 5 hours. They stop for everyone and the call carries on; Notes says so over its tabs', async () => {
        await screen.findByText('Notes stopped at this period’s 5 hours', {}, LATER);
      });
      await step('Only Art, who organizes, has the ways to more: Get Pro, or 10 more hours for this period. Get Pro opens checkout over the call', async () => {
        await screen.findByRole('button', { name: 'Add 10 hours · $15' }, SOON);
        await userEvent.click(await screen.findByRole('button', { name: 'Get Pro' }, SOON));
      });
      await step('The payment lands while the call goes on. Notes come on again by themselves, and the notes mark where they stopped and came back', async () => {
        await screen.findByText(/^Notes on again/, {}, LATER);
        await screen.findByText('You’re on Pro. Notes are on again.', {}, SOON);
      });
    }
  })
};

export const StartWithNoNotesLeft: PageStory = {
  name: '16.10 Start a call with no notes left',
  ...page('/home', 'plan-stopped', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    /** Start a call's window, once it's open: the side panel says notes are out too, so what's in it is found in it. */
    const flow = () => screen.findByRole('dialog', { name: 'Start a call' }, SOON);
    await step('This period’s notes are used up. Start a call says so under the ways to start, until they come back, with Get Pro', async () => {
      const side = await screen.findByRole('complementary', { name: 'Side panel' }, SOON);
      await userEvent.click(within(side).getByRole('button', { name: /^Start a call/ }));
      await within(await flow()).findByText(/^No notes left until/, {}, SOON);
    });
    await step('Get Pro: checkout opens in the window’s place, on Pro, since no window opens over another', async () => {
      await userEvent.click(within(await flow()).getByRole('button', { name: 'Get Pro' }));
      await within(await screen.findByRole('dialog', { name: 'Get Pro' }, SOON)).findByRole('radiogroup', { name: 'How long' }, SOON);
    });
    await step('Close checkout without buying. Start a call comes back as it was', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Get Pro' }, SOON)).getByRole('button', { name: 'Close' }));
      await within(await flow()).findByText(/^No notes left until/, {}, SOON);
    });
    await step('Start without notes: the call is made with notes off, and its lobby opens', async () => {
      await userEvent.click(within(await flow()).getByRole('button', { name: 'Start without notes' }));
      await screen.findByRole('button', { name: 'Join' }, LATER);
    });
  }
};

export const StorageFull: PageStory = {
  name: '16.11 Storage full',
  ...page(`/drive/ws-product/${itemId('Launch plan')}`, 'plan-over', { globals: LAPTOP }),
  play: async ({ canvas, userEvent, step }) => {
    await step('Art is past Free’s storage and its grace is over. In the launch plan, start a line under “What goes out”, type / and pick File', async () => {
      const line = await canvas.findByText('What goes out', {}, LATER);
      await userEvent.click(line);
      caretAtEnd(line);
      await userEvent.keyboard('{Enter}/');
      await userEvent.click(await screen.findByRole('option', { name: /^File/ }, SOON));
    });
    await step('Choose a PDF. It isn’t kept: the toast says the storage is full, how much room Pro has, and Get Pro', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Choose from this computer' }, SOON));
      await userEvent.upload(screen.getByLabelText('Choose files to add'), new File(['%PDF-1.4\n% Launch timeline\n'], 'Launch timeline.pdf', { type: 'application/pdf' }));
      await screen.findByText('Your storage is full. Pro has 100 GB.', {}, LATER);
    });
    await step('Get Pro opens checkout with Pro chosen, over the document', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Get Pro' }, SOON));
    });
  }
};

export const AnHourLeft: PageStory = {
  name: '16.12 An hour left',
  ...page('/home', 'plan-low'),
  play: async ({ userEvent, step }) => {
    await step('About 20 minutes of this period’s notes are left. Once this period, a toast says so, and the side panel’s number turns warm', async () => {
      await screen.findByText('Less than an hour of notes left this period', {}, LATER);
    });
    await step('Get Pro, on the toast, opens checkout with Pro chosen', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Get Pro' }, SOON));
    });
  }
};

export const PlansBeforeSigningIn: PageStory = {
  name: '16.13 Plans before signing in',
  ...page('/welcome', 'signed-out', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Signed out, Plans is a part of the welcome page: Free and Pro on the water of a cove at night, with what each costs and brings', async () => {
      await screen.findByRole('heading', { name: 'Plans' }, SOON);
      await userEvent.click(within(await screen.findByRole('navigation', { name: 'Parts of the page' }, SOON)).getByRole('link', { name: 'Plans' }));
    });
    await step('Get Pro signs in with Google, then opens Plans with checkout on Pro. Google’s own page is the hand-off', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Get Pro' }, SOON));
      await first(screen.findAllByRole('button', { name: 'Waiting for Google…' }, SOON));
    });
  }
};
