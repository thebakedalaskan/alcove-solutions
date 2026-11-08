/*
 * Ending a call and getting its notes (docs/product/user-flows.md › 7. End the call and get the notes), which the
 * canvas never drew: from the call, through the sheet that becomes Call ended, to the note being written. The call is the
 * call stories' design review, twenty-three minutes in.
 */
import { AlcoveApiError } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at, ringFrom, run } from '../../src/api/script';
import { ringYou } from '../../src/api/standin';
import { inCall, light, phone } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, BOARD_PREP, CHECK_IN, INES, KOFI, MAYA, PREP, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from '../calls/talk';
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

/** An invited participant's Leave is one press; the host and everyone else carry on. */
export const ParticipantLeaves: PageStory = {
  name: '7.3 Leave as a participant',
  ...inCall({ scenario: 'busy', call: CHECK_IN, script: { here: [{ who: KOFI }, { who: AIKO }], notes: 'off' } }),
  play: async ({ userEvent, step }) => {
    await step('Press Leave once, without a confirmation', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('The call’s join page is ready to return to the ongoing call', async () => {
      await screen.findByRole('heading', { name: 'Launch check-in', level: 1 }, LATER);
    });
  }
};
export const ParticipantLeavesPhone = phone(ParticipantLeaves, '7.3 Leave as a participant, on a phone');
export const ParticipantLeavesLight = light(ParticipantLeaves, '7.3 Leave as a participant, in a light theme');

/** The same behavior for a guest admitted from the call's link. */
export const GuestLeaves: PageStory = {
  name: '7.4 Leave as a guest',
  ...inCall({
    scenario: 'signed-out', call: PREP,
    script: { here: [{ who: KOFI, organizer: true }, { who: MAYA }], notes: 'off', cues: at(0.5, { do: 'let-in' }) }
  }),
  play: async ({ userEvent, step }) => {
    await step('After the host admits you, press Leave once', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('The call goes on and its link is ready to ask to join again', async () => {
      await screen.findByRole('heading', { name: 'Harbourline prep', level: 1 }, LATER);
    });
  }
};

export const ParticipantRetriesLeaving: PageStory = {
  name: '7.5 Retry a participant departure',
  ...inCall({
    scenario: 'busy', call: CHECK_IN, script: { here: [{ who: KOFI }, { who: AIKO }], notes: 'off' },
    then: (session) => {
      const leave = session.leave.bind(session);
      let refused = false;
      session.leave = () => {
        if (refused) return leave();
        refused = true;
        return Promise.reject(new AlcoveApiError('unavailable', 'Alcove couldn’t leave the call. Try again.'));
      };
    }
  }),
  play: async ({ userEvent, step }) => {
    await step('The first Leave fails and the same call stays open', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
      await screen.findAllByText('Alcove couldn’t leave the call. Try again.', {}, SOON);
    });
    await step('Press Leave again to retry and return to the call’s join page', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, SOON));
      await screen.findByRole('heading', { name: 'Launch check-in', level: 1 }, LATER);
    });
  }
};

export const ParticipantJoinsAnotherCall: PageStory = {
  name: '7.6 Join another call as a participant',
  ...inCall({
    scenario: 'busy', call: CHECK_IN, also: [BOARD_PREP],
    script: {
      here: [{ who: KOFI }, { who: AIKO }], notes: 'off',
      cues: at(1, run(() => ringYou(ringFrom(INES, BOARD_PREP.code, BOARD_PREP.title))))
    }
  }),
  play: async ({ userEvent, step }) => {
    await step('Ines rings while you are in Priya’s call. Press Join', async () => {
      const card = await screen.findByRole('alertdialog', { name: 'Ines is ringing you' }, LATER);
      await userEvent.click(within(card).getByRole('button', { name: 'Join' }));
    });
    await step('Leave the current call without a question and continue to Board prep’s lobby', async () => {
      await screen.findByRole('heading', { name: 'Board prep', level: 1 }, LATER);
    });
  }
};
export const ParticipantJoinsAnotherCallPhone = phone(ParticipantJoinsAnotherCall, '7.6 Join another call as a participant, on a phone');
