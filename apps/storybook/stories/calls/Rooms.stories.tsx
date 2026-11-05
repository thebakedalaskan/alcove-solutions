/*
 * Breakout rooms (user-flows 6): the organizer sets them up and opens them, and sees every room on the stage; anyone
 * sent to a room sees only the people in it, a timer, the organizer's message to every room, and comes back when time's
 * up. Each room has its own keys: the call screen plays only its own room's media, as the scripted room does.
 */
import type { Meta } from '@storybook/react-vite';
import { at, line } from '../../src/api/script';
import { inCall, phone, press } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { AIKO, CHECK_IN, KOFI, MAYA, PRIYA, REVIEW } from './talk';

const meta = { title: 'Calls/Breakout rooms', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/** The organizer sets rooms up: how many, how long, and who goes where (drag people between them). */
export const SettingUp = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, { play: press('Breakout rooms') });

/** Rooms open: the organizer's stage shows every room and who's in it, with the shared timer. */
export const Open = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS },
  then: (s) => s.openRooms({ rooms: [{ name: 'Empty states', emails: [PRIYA.email, KOFI.email] }, { name: 'Pricing', emails: [AIKO.email] }], minutes: 10 })
}, { play: press('Breakout rooms') });
/** On a phone, breakout rooms are under More. */
export const OpenPhone = { ...phone(Open), play: press('More: catch up, settings', { then: ['Breakout rooms'] }) };

/**
 * At Priya's check-in, she opens rooms two seconds in: you're in Rollout with Kofi, and talk the dates through. Her message
 * reaches every room at 25 seconds, and everyone is back in the main room at 45.
 */
export const InARoom = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: {
    here: [{ who: KOFI }, { who: AIKO }, { who: MAYA }],
    cues: [
      ...at(2, { do: 'rooms', rooms: [{ name: 'Rollout', people: ['me', KOFI] }, { name: 'Support', people: [AIKO, MAYA] }], minutes: 10 }),
      ...at(25, { do: 'message-rooms', text: 'Two more minutes, then we’re back together.' }),
      ...at(45, { do: 'close-rooms' })
    ],
    talk: {
      from: 6, every: 4.5,
      lines: [
        line(KOFI, 'So, ten percent on Monday. Which teams go first?'),
        line('me', 'The ones who asked for it at the beta. That’s about forty teams.', { decides: 'The forty beta teams get the flag first.' }),
        line(KOFI, 'I’ll send them a note on Friday, so it isn’t a surprise.', { hands: { text: 'Tell the beta teams the flag goes on Monday', due: 'Friday' } }),
        line('me', 'Good. Then everyone a week later, if nothing breaks.')
      ]
    }
  }
});
export const InARoomPhone = phone(InARoom);
