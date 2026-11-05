/*
 * Joining (docs/product/user-flows.md › 5. Join), which the canvas never drew past Home's Join: the organizer's lobby,
 * someone invited, someone asking, a guest with the link, a link that offers times, and being rung. The organizer or
 * whoever rings you is someone else, so the call's script plays them (src/api/script.ts): they arrive, let you in, say no.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at } from '../../src/api/script';
import { atTheDoor, rung, type StoryCall } from '../../src/call';
import { call } from '../../src/world/build';
import { iso } from '../../src/world/clock';
import { ART, JONAS } from '../../src/world/people';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { CHECK_IN, CHECK_IN_TALK, DIEGO, KOFI, MAYA, PREP, PRIYA, REVIEW } from '../calls/talk';
import { before, LATER, pause, pressable, SOON } from './play';

const meta = { title: 'Journeys/5 Join', ...pages } satisfies Meta<PageArgs>;
export default meta;

const inTheCall = () => screen.findByRole('toolbar', { name: 'Call controls' }, LATER);

export const YourLobby: PageStory = {
  name: '5.1 Get ready in your lobby',
  ...atTheDoor({ scenario: 'call-soon', call: REVIEW }, {}),
  play: async ({ userEvent, step }) => {
    await step('Your call’s lobby: its time, who’s invited, and what the call captures. Until it starts, the pen renames it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Rename the call' }, LATER));
      const name = await screen.findByRole('textbox', { name: 'The call’s name' }, SOON);
      await userEvent.clear(name);
      await userEvent.type(name, 'Design review: empty states{Enter}');
      await screen.findByRole('heading', { name: 'Design review: empty states', level: 1 }, SOON);
    });
    await step('Until it’s live, notes can still be switched off', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Notes', checked: true }, SOON));
      await screen.findByText('You can turn them on during the call.', {}, SOON);
    });
    await step('And on again, once that’s saved', async () => {
      await pause(1200);
      await userEvent.click(await screen.findByRole('switch', { name: 'Notes', checked: false }, SOON));
      await screen.findByText('Everyone invited gets them', {}, SOON);
    });
    await step('Pick a microphone. Its level moves as you speak', async () => {
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Microphone' }), 'Desk microphone');
    });
    await step('Test microphone records three seconds and plays them back, keeping nothing', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Test microphone' }));
      await screen.findByText(/Say something/, {}, SOON);
      await screen.findByText('Playing it back', {}, SOON);
    });
    await step('Join. You’re in, and Priya, Kofi and Aiko come in', async () => {
      await userEvent.click(await pressable('button', 'Join'));
      await inTheCall();
    });
  }
};

export const Invited: PageStory = {
  name: '5.2 Join a call you’re invited to',
  ...atTheDoor({ scenario: 'busy', call: CHECK_IN, script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }, { who: MAYA }], talk: { lines: CHECK_IN_TALK } } }, {}),
  play: async ({ userEvent, step }) => {
    await step('Invited and signed in: what the call captures, and that you get the notes', async () => {
      await screen.findByRole('heading', { name: 'Launch check-in', level: 1 }, LATER);
      await screen.findByText(/You’re invited, so you get them/, {}, SOON);
    });
    await step('Join now. You’re in as soon as the organizer is there, and she is', async () => {
      await userEvent.click(await pressable('button', 'Join now'));
      await inTheCall();
    });
  }
};

export const WaitingForTheOrganizer: PageStory = {
  name: '5.3 Wait for the organizer',
  ...atTheDoor({
    scenario: 'busy', call: { ...CHECK_IN, code: 'lch-wait-jny', status: 'scheduled' },
    script: { door: { hostArrives: 7 }, here: [{ who: KOFI }], talk: { lines: CHECK_IN_TALK } }
  }, {}),
  play: async ({ userEvent, step }) => {
    await step('Before the organizer arrives, the page says it’s waiting for her', async () => {
      await screen.findByText('Waiting for Priya to start the call.', {}, LATER);
    });
    await step('It opens joining when she’s there. Join now', async () => {
      await userEvent.click(await pressable('button', 'Join now', LATER));
      await inTheCall();
    });
  }
};

export const AskToJoin: PageStory = {
  name: '5.4 Ask to join',
  ...atTheDoor({
    scenario: 'busy', call: { ...PREP, code: 'hbr-prep-jny' },
    script: { here: [{ who: KOFI, organizer: true }, { who: DIEGO }, { who: MAYA }], cues: at(5, { do: 'let-in' }) }
  }, {}),
  play: async ({ userEvent, step }) => {
    await step('Kofi’s call, which you’re not invited to: it says who’s hosting. Ask to join', async () => {
      await userEvent.click(await pressable('button', 'Ask to join', LATER));
    });
    await step('While you wait the page says so, with Stop asking', async () => {
      await screen.findByText(/Waiting for Kofi to let you in/, {}, SOON);
    });
    await step('Kofi lets you in, and the call opens', async () => {
      await inTheCall();
    });
  }
};

export const AsAGuest: PageStory = {
  name: '5.5 Join with the link, as a guest',
  ...atTheDoor({
    scenario: 'signed-out', call: { ...PREP, code: 'hbr-prep-gjy' },
    script: { here: [{ who: KOFI, organizer: true }, { who: DIEGO }], cues: at(5, { do: 'let-in' }) }
  }, {}),
  play: async ({ userEvent, step }) => {
    await step('Without an account, type a name. One line says guests don’t get the notes, and how to get them', async () => {
      await userEvent.type(await screen.findByRole('textbox', { name: 'Your name' }, LATER), JONAS.name);
      await screen.findByText(/Guests don’t get the notes/, {}, SOON);
    });
    await step('Ask to join, and wait for Kofi', async () => {
      await userEvent.click(await pressable('button', 'Ask to join'));
      await screen.findByText(/Waiting for Kofi to let you in/, {}, SOON);
    });
    await step('Let in: you’re in the call as a guest', async () => {
      await inTheCall();
    });
  }
};

export const TurnedAway: PageStory = {
  name: '5.6 When you’re not let in',
  ...atTheDoor({
    scenario: 'busy', call: { ...PREP, code: 'hbr-prep-njy' },
    script: { here: [{ who: KOFI, organizer: true }, { who: DIEGO }], cues: at(4, { do: 'turn-away' }) }
  }, {}),
  play: async ({ userEvent, step }) => {
    await step('Ask to join Kofi’s call', async () => {
      await userEvent.click(await pressable('button', 'Ask to join', LATER));
    });
    await step('Kofi says no. The page says so, with the way back', async () => {
      await screen.findByText('Kofi didn’t let you in.', {}, LATER);
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
      await pressable('button', 'Ask to join');
    });
  }
};

/** Art's call with Jonas, offering three times: Jonas, without an account, picks one from its link. */
const OFFERED = {
  ...call({ id: 'm-offered', title: 'Portfolio review', startsAt: iso(1, 10, 0), minutes: 30, code: 'pfl-revw-art', guests: [JONAS] }),
  offer: { times: [iso(1, 10, 0), iso(1, 14, 0), iso(2, 11, 0)] }
};

export const PickATime: PageStory = {
  name: '5.7 Pick a time from a link',
  ...page('/join/pfl-revw-art', 'signed-out'),
  beforeEach: before((w) => { w.meetings.push(structuredClone(OFFERED)); }),
  play: async ({ userEvent, step }) => {
    await step('A link that offers times shows them, with no account and no camera, each in your own time zone', async () => {
      await screen.findByRole('heading', { name: 'Pick a time with Art', level: 1 }, LATER);
    });
    await step('Pick one. The button says the time', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /14:00/ }, SOON));
      await userEvent.click(await pressable('button', /^Confirm /));
    });
    await step('You’re on Art’s calendar. Add to my calendar saves a calendar file made in the browser', async () => {
      await screen.findByRole('heading', { name: 'You’re on Art’s calendar', level: 1 }, SOON);
      await screen.findByRole('button', { name: 'Add to my calendar' }, SOON);
    });
  }
};

export const NoSuchCall: PageStory = {
  name: '5.8 A link that leads nowhere',
  ...page('/join/zzz-zzzz-zzz', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('A link that leads nowhere says to check it', async () => {
      await screen.findByText('There’s no call with that code', {}, LATER);
      await screen.findByText('Check the link and try again.', {}, SOON);
    });
    await step('Go home', async () => {
      await userEvent.click(screen.getByRole('link', { name: 'Go home' }));
      await screen.findByRole('heading', { name: 'Wednesday 4 November', level: 1 }, SOON);
    });
  }
};

export const ACallThatsOver: PageStory = {
  name: '5.9 A call that’s over',
  ...atTheDoor({ scenario: 'busy', call: { ...PREP, code: 'hbr-prep-ojy', status: 'ended' } }, {}),
  play: async ({ step }) => {
    await step('A call that’s over says so, and opens again if Kofi starts it again', async () => {
      await screen.findByText('Harbourline prep has ended', {}, LATER);
    });
  }
};

/** Priya's design sync, going on now: she rings Art into it. */
const SYNC: StoryCall = { id: 'm-sync-jny', title: 'Design sync', startsAt: iso(0, 16, 10), minutes: 30, code: 'dsn-sync-jny', organizer: PRIYA, guests: [ART, KOFI] };

export const BeingRung: PageStory = {
  name: '5.10 Being rung, and not now',
  ...rung({ scenario: 'busy', path: '/notes', call: SYNC, from: PRIYA }, {}),
  play: async ({ userEvent, step }) => {
    await step('Priya rings you. A card drops in on whatever page is open, and doesn’t take the focus', async () => {
      await screen.findByRole('alertdialog', { name: 'Priya is ringing you' }, LATER);
    });
    await step('Can’t now opens In 5 minutes, In 15 minutes and Not this time, in the same card', async () => {
      await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Priya is ringing you' })).getByRole('button', { name: 'Can’t now' }));
      await userEvent.click(await screen.findByRole('button', { name: 'In 5 minutes' }, SOON));
    });
    await step('A toast says what Priya sees, and that Alcove rings you again then', async () => {
      await screen.findByText(/Alcove rings you again then/, {}, SOON);
    });
  }
};

export const BeingRungAndJoining: PageStory = {
  name: '5.11 Being rung, and joining',
  ...rung({
    scenario: 'busy', path: '/home', call: { ...SYNC, code: 'dsn-sync-jyn' }, from: PRIYA,
    script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }], talk: { lines: CHECK_IN_TALK.filter((l) => l.who === PRIYA || l.who === KOFI) } }
  }, {}),
  play: async ({ userEvent, step }) => {
    await step('Priya rings you from her design sync', async () => {
      const card = await screen.findByRole('alertdialog', { name: 'Priya is ringing you' }, LATER);
      await userEvent.click(within(card).getByRole('button', { name: 'Join' }));
    });
    await step('Join goes through the pre-join: your camera and microphone, and what the call captures', async () => {
      await screen.findByRole('heading', { name: 'Design sync', level: 1 }, LATER);
      await userEvent.click(await pressable('button', 'Join now', LATER));
    });
    await step('You’re in Priya’s call', async () => {
      await inTheCall();
    });
  }
};

