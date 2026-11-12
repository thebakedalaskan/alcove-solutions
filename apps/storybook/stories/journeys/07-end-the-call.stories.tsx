/*
 * Ending a call and what comes after it (docs/product/user-flows.md › 7. End the call and get the notes), as the canvas "After
 * the call" plays it: Leave's question over Leave for whoever hosts, and, once the call is over for you, its own page on the
 * call's night, which follows the notes as they're written, turns when a call you left ends, and takes you back in with
 * Rejoin. The calls are the call stories': Art's design review twenty-three minutes in, and Priya's launch check-in.
 */
import { AlcoveApiError } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at, ringFrom, run } from '../../src/api/script';
import { ringYou } from '../../src/api/standin';
import { inCall, light, phone } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, BOARD_PREP, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, INES, KOFI, MAYA, PREP, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK, STARTED } from '../calls/talk';
import { LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/7 End the call and get the notes', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** Art's design review, twenty-three minutes in, notes on. */
const LATE = { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], since: 23 * 60, earlier: REVIEW_TALK.slice(0, 12), talk: { lines: REVIEW_TALK.slice(12) }, summary: REVIEW_SUMMARY };
/** Priya's launch check-in, nineteen minutes in, notes on. */
const CHECKING_IN = { here: [{ who: KOFI }, { who: AIKO }, { who: MAYA }], since: 19 * 60, earlier: CHECK_IN_TALK.slice(0, 5), talk: { lines: CHECK_IN_TALK.slice(5) }, summary: CHECK_IN_SUMMARY };
/** The page a call leaves you on, by its title. */
const thePage = (name: string) => screen.findByRole('heading', { name, level: 1 }, LATER);
/** Home, on the demo Wednesday. */
const home = () => screen.findByRole('heading', { name: 'Wednesday 4 November', level: 1 }, LATER);

export const EndTheCall: PageStory = {
  name: '7.1 End the call and read the notes',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }),
  play: async ({ userEvent, step }) => {
    await step('Press Leave. You host, so it asks first, over Leave: End for everyone, or Leave, Priya hosts. The call carries on behind it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('End for everyone. The last audio and speech go, and the call eases back as its own page rises in: it has ended, and who was in it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^End for everyone/ }, SOON));
      await thePage('Design review has ended');
    });
    await step('The notes are being written: the step they’re on, and who gets them. Open the notes is the one filled button', async () => {
      await screen.findByRole('button', { name: /^Open the notes/ }, SOON);
    });
    await step('Stay a moment, and they’re written: their first lines, what was decided and the follow-ups. Read the notes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Read the notes/ }, LATER));
    });
    await step('The page fades, and the note settles in, the side panel easing in after it', async () => {
      await screen.findByRole('heading', { name: 'Design review', level: 1 }, LATER);
    });
  }
};

export const LeaveAndKeepItGoing: PageStory = {
  name: '7.2 Leave and keep it going, then Rejoin',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }),
  play: async ({ userEvent, step }) => {
    await step('Press Leave. Priya is the best person to host, chosen already; Change would pick someone else, in the same question', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('Leave, Priya hosts. The call goes on, the notes with it, and its page says Priya is hosting until you’re back', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Leave, Priya hosts/ }, SOON));
      await thePage('You left Design review');
    });
    await step('Who’s still in it, and how long it’s been going, ticking. No camera: this isn’t the join page', async () => {
      await screen.findByText(/Priya is hosting until you’re back/, {}, SOON);
    });
    await step('Rejoin. Straight back in, the microphone and camera as they were, and hosting again (J rejoins too, with both off)', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Rejoin/ }, SOON));
      await within(await screen.findByRole('toolbar', { name: 'Call controls' }, LATER)).findByRole('button', { name: 'Leave' }, SOON);
      await screen.findByText(/You’re hosting again/, {}, SOON);
    });
  }
};

/** Invited to Priya's check-in: Leave is one press, and the call's page has Rejoin while it goes on. */
export const ParticipantLeaves: PageStory = {
  name: '7.3 Leave as a participant',
  ...inCall({ scenario: 'busy', call: CHECK_IN, script: CHECKING_IN }),
  play: async ({ userEvent, step }) => {
    await step('Press Leave. You don’t host, so nothing is asked: you’re out at once', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('The call’s page: you left, who’s still in it, and how long it’s been going. Notes are on, and you get them when it ends', async () => {
      await thePage('You left Launch check-in');
    });
    await step('Go to Home. The page fades, and Home settles in, the side panel easing in. The notes come to Calls once the call ends', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Go to Home/ }, SOON));
      await home();
    });
  }
};
export const ParticipantLeavesPhone = phone(ParticipantLeaves, '7.3 Leave as a participant, on a phone');
export const ParticipantLeavesLight = light(ParticipantLeaves, '7.3 Leave as a participant, in a light theme');

/** Admitted from the link with only a name: no notes and no Home, and Rejoin lets them straight back in. */
export const GuestLeaves: PageStory = {
  name: '7.4 Leave as a guest',
  ...inCall({
    scenario: 'signed-out', call: PREP,
    script: { here: [{ who: KOFI, organizer: true }, { who: MAYA }], notes: 'off', cues: at(0.5, { do: 'let-in' }) }
  }),
  play: async ({ userEvent, step }) => {
    await step('Kofi lets you in. Press Leave: a guest is never asked', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('The call’s page: you left, who’s still in it, and Rejoin, the only thing to press', async () => {
      await thePage('You left Harbourline prep');
    });
    await step('Rejoin. Kofi let you in before, so you’re back in without asking again', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Rejoin/ }, SOON));
      await within(await screen.findByRole('toolbar', { name: 'Call controls' }, LATER)).findByRole('button', { name: 'Leave' }, SOON);
    });
  }
};

export const ParticipantRetriesLeaving: PageStory = {
  name: '7.5 Retry a departure that failed',
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
    await step('Press Leave. It doesn’t go through: the same call stays open, and says why', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
      await screen.findAllByText('Alcove couldn’t leave the call. Try again.', {}, SOON);
    });
    await step('Press Leave again: this time you’re out, and the call’s page says you left', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, SOON));
      await thePage('You left Launch check-in');
    });
  }
};

export const ParticipantJoinsAnotherCall: PageStory = {
  name: '7.6 Join another call while in one',
  ...inCall({
    scenario: 'busy', call: CHECK_IN, also: [BOARD_PREP],
    script: {
      here: [{ who: KOFI }, { who: AIKO }], notes: 'off',
      cues: at(1, run(() => ringYou(ringFrom(INES, BOARD_PREP.code, BOARD_PREP.title))))
    }
  }),
  play: async ({ userEvent, step }) => {
    await step('Ines rings while you’re in Priya’s call. Press Join', async () => {
      const card = await screen.findByRole('alertdialog', { name: 'Ines is ringing you' }, LATER);
      await userEvent.click(within(card).getByRole('button', { name: 'Join' }));
    });
    await step('You leave Priya’s call without a question, and go on to Board prep’s lobby rather than the call’s page', async () => {
      await screen.findByRole('heading', { name: 'Board prep', level: 1 }, LATER);
    });
  }
};
export const ParticipantJoinsAnotherCallPhone = phone(ParticipantJoinsAnotherCall, '7.6 Join another call while in one, on a phone');

/** Priya ends her check-in a few seconds after you've left it; the page reads the call's card every 10 to 17 seconds, and turns. */
export const EndsWhileOnItsPage: PageStory = {
  name: '7.7 The call ends while you’re on its page',
  ...inCall({ scenario: 'busy', call: CHECK_IN, script: { ...CHECKING_IN, cues: at(10, { do: 'end' }) } }),
  play: async ({ userEvent, step }) => {
    await step('Press Leave', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('The call’s page: you left, and who’s still in it. You get the notes when it ends', async () => {
      await thePage('You left Launch check-in');
    });
    await step('Stay, and Priya ends it: the page turns. It ended after you left, and the notes are being written', async () => {
      await thePage('Launch check-in has ended');
    });
    await step('Written: their first lines, what was decided and the follow-ups. Read the notes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Read the notes/ }, LATER));
    });
    await step('The note, from Priya’s call', async () => {
      await screen.findByRole('heading', { name: 'Launch check-in', level: 1 }, LATER);
    });
  }
};

/** Art started a call and nobody came. Pressing Leave ends it; any other way out, such as answering a ring, asks first. */
export const AloneLeaveEndsIt: PageStory = {
  name: '7.8 Alone, Leave ends it',
  ...inCall({ scenario: 'busy', call: STARTED, script: { here: [], notes: 'off' } }),
  play: async ({ userEvent, step }) => {
    await step('Press Leave. There’s nobody to hand it to and nothing to choose, so it ends at once', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Leave' }, LATER));
    });
    await step('The call’s page says it has ended. No notes were taken, so Go to Home is the filled button', async () => {
      await thePage('Art’s call has ended');
    });
    await step('Go to Home: the page fades, and Home settles in', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Go to Home/ }, SOON));
      await home();
    });
  }
};
