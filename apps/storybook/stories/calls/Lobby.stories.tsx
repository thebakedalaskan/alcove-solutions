/*
 * Before the call (user-flows 5): the organizer's lobby, and the page everyone else waits on. The camera preview is the
 * browser's made-up camera; the microphone's level is its murmur. Stories that ask to join play the click, and the call
 * answers as its script says: let in, or not.
 */
import type { Meta } from '@storybook/react-vite';
import { at } from '../../src/api/script';
import { atTheDoor, phone } from '../../src/call';
import { page, pages, type PageArgs } from '../../src/page';
import { iso } from '../../src/world/clock';
import { AIKO, CHECK_IN, CHECK_IN_TALK, DIEGO, KOFI, MAYA, PREP, PRIYA, REVIEW, STARTED } from './talk';

const meta = { title: 'Calls/Lobby and waiting', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** A call started just now on a team: the people it was started with come picked, so the button says Join and ring 2. */
export const StartedNow = atTheDoor({ scenario: 'busy', call: STARTED });
export const StartedNowPhone = phone(StartedNow);

/** The design review, four minutes away: its time, who's invited, and notes, which can still be switched. */
export const Scheduled = atTheDoor({ scenario: 'call-soon', call: REVIEW });
export const ScheduledPhone = phone(Scheduled);

/** On your own, the link comes first: send it, and let people in as they ask. */
export const OnYourOwn = atTheDoor({ scenario: 'on-their-own', call: { id: 'm-solo', title: 'Art’s call', startsAt: iso(0, 16, 12), minutes: 30, code: 'art-solo-now', guests: [], instant: true } });

/** You left the roadmap planning to Priya: she hosts until you're back, and joining makes you the host again. */
export const SomeoneHostingForYou = atTheDoor({
  scenario: 'busy',
  call: { id: 'm-roadmap', title: 'Roadmap planning', startsAt: iso(0, 15, 45), minutes: 60, code: 'rdm-plan-art', guests: [PRIYA, KOFI, AIKO], status: 'live' },
  script: { door: { standIn: PRIYA }, here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], since: 20 * 60 }
});

/** Invited to Priya's check-in before she's there: it waits for her, and opens once she arrives, eight seconds in. */
export const WaitingForTheOrganizer = atTheDoor({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-wait-prr', status: 'scheduled' },
  script: { door: { hostArrives: 8 }, here: [{ who: KOFI }], talk: { lines: CHECK_IN_TALK } }
});
export const WaitingForTheOrganizerPhone = phone(WaitingForTheOrganizer);

/** Kofi's Harbourline prep, which Art isn't invited to: he asks, waits, and Kofi lets him in six seconds later. */
export const AskingToJoin = atTheDoor({
  scenario: 'busy', call: PREP,
  script: { here: [{ who: KOFI, organizer: true }, { who: DIEGO }, { who: MAYA }], cues: at(6, { do: 'let-in' }) }
}, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Ask to join. The page waits for Kofi, and the call opens once he lets you in', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Ask to join' }, { timeout: 8000 }));
    });
  }
});
export const AskingToJoinPhone = phone(AskingToJoin);

/** The same, and Kofi says no: the page says so, with a way back. */
export const TurnedAway = atTheDoor({
  scenario: 'busy', call: { ...PREP, code: 'hbr-prep-nop' },
  script: { here: [{ who: KOFI, organizer: true }, { who: DIEGO }], cues: at(4, { do: 'turn-away' }) }
}, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Ask to join. Kofi turns the ask down four seconds later', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Ask to join' }, { timeout: 8000 }));
    });
  }
});

/** Nobody signed in: a guest types a name, is told guests don't get the notes, and asks. */
export const AsAGuest = atTheDoor({
  scenario: 'signed-out', call: { ...PREP, code: 'hbr-prep-gst' },
  script: { here: [{ who: KOFI, organizer: true }, { who: DIEGO }], cues: at(5, { do: 'let-in' }) }
}, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Type a name', async () => {
      await userEvent.type(await canvas.findByRole('textbox', {}, { timeout: 8000 }), 'Sam');
    });
    await step('Ask to join. Kofi lets the guest in five seconds later', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Ask to join' }));
    });
  }
});
export const AsAGuestPhone = phone(AsAGuest);

/** Kofi locked the call: nobody new can join. */
export const Locked = atTheDoor({ scenario: 'busy', call: { ...PREP, code: 'hbr-prep-lck' }, script: { door: { locked: true } } });

/** The call is over: the page says so, and opens again if Kofi starts it again. */
export const Ended = atTheDoor({ scenario: 'busy', call: { ...PREP, code: 'hbr-prep-end', status: 'ended' } });

/** A link that leads nowhere. */
export const NoSuchCall = page('/join/zzz-zzzz-zzz', 'busy', { globals: { theme: 'dark' } });
