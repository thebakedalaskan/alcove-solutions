/*
 * Breakout rooms (user-flows 6): the organizer sets them up and opens them, anyone in the call going to one, guests with the
 * link too, and themselves if they like; from the main room they see every room on the stage, any of them folded to its
 * header, and in a room just that room. Anyone sent to a room sees only the people in it, a timer, the organizer's message to
 * every room, and comes back when time's up. Each room has its own keys: the call screen plays only its own room's media, as
 * the scripted room does.
 */
import type { BreakoutPlan, CallSession } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { asksToSee, at, joins, line } from '../../src/api/script';
import { MORE, inCall, light, narrow, phone, plays, press, reach } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { SOON, type Play } from './plays';
import { AIKO, CHECK_IN, KOFI, MAYA, PRIYA, REVIEW } from './talk';

const meta = { title: 'Calls/Breakout rooms', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const ROOMS = press(MORE, { then: ['Breakout rooms'] });
/**
 * The organizer sets rooms up in their side, from Breakout rooms in More or in People: how many, how long, and who goes where
 * (drag people between them). They're in the main room, over the rooms, and go to one as the rooms open if they put themselves
 * in it.
 */
export const SettingUp = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, { play: ROOMS });
/** From People: Breakout rooms sits above who's here, for the organizer. */
export const SettingUpFromPeople = { ...SettingUp, name: 'Setting up, from People', play: reach('People', { then: ['Breakout rooms'] }) };
/**
 * A guest who joined with the link is on the board like anyone else, and goes to a room. Only someone invited transcribes a
 * room, so with notes on, a room with only Maya in it says before it opens that nothing said there will be transcribed.
 */
export const SettingUpWithAGuest = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: [{ who: KOFI }, { who: MAYA, guest: true }] } }, { name: 'Setting up, with a guest', play: ROOMS });
export const SettingUpWithAGuestLight = light(SettingUpWithAGuest);
/** You go to a room as the rooms open: drag yourself into it, or move with the arrow keys. With notes on, the board says the main room isn't heard meanwhile. */
const intoARoom: Play = async (c) => {
  await c.step('Put yourself in Room 1', async () => {
    (await screen.findByLabelText(/^You, in the main room/, {}, SOON)).focus();
    await c.userEvent.keyboard('{ArrowRight}');
  });
};
export const StartingInARoom = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, { name: 'Setting up, starting in a room', play: plays(ROOMS, intoARoom) });
export const StartingInARoomPhone = phone(StartingInARoom);

const TWO_ROOMS: BreakoutPlan = { rooms: [{ name: 'Empty states', emails: [PRIYA.email, KOFI.email] }, { name: 'Pricing', emails: [AIKO.email] }], minutes: 10, board: { mode: 'none', template: 'blank' } };
/** Rooms open: the organizer's stage shows every room and who's in it, the time left said once, over them. */
export const Open = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS },
  then: (s) => s.openRooms(TWO_ROOMS)
}, { play: ROOMS });
/** On a phone, your side, and the rooms with it, is a sheet over the call. */
export const OpenPhone = phone(Open);
/**
 * A lighter overview: a room nobody's in is only its header, and the organizer folds any room to its header, the main room too,
 * for their own view. On a wide stage the headers sit in a row over the rest.
 */
export const OpenWithAFoldedRoom = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS },
  then: (s) => s.openRooms({ ...TWO_ROOMS, rooms: [...TWO_ROOMS.rooms, { name: 'Copy', emails: [] }] })
}, {
  name: 'Open, one room folded and one empty',
  play: async (c) => { await c.step('Fold Pricing', async () => { await c.userEvent.click(await screen.findByRole('button', { name: 'Fold Pricing' }, SOON)); }); }
});
export const OpenWithAFoldedRoomPhone = phone(OpenWithAFoldedRoom);
export const OpenWithAFoldedRoomNarrow = narrow(OpenWithAFoldedRoom);
/**
 * The organizer starts in Empty states as the rooms open: their stage is that room's people, as everyone in it sees it, with
 * tile menus and Focus; the time left is said over it, and Back to main room, in their side, brings back every room.
 */
export const OrganizerInARoom = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS },
  then: (s) => s.openRooms({ ...TWO_ROOMS, visit: 0 })
}, { name: 'The organizer in a room' });
export const OrganizerInARoomWithRooms = { ...OrganizerInARoom, name: 'The organizer in a room, with Rooms open', play: ROOMS };
export const OrganizerInARoomPhone = phone(OrganizerInARoom);
/** Join room, from the main room: the stage goes from every room to the people in the one you joined. */
export const JoiningARoom = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS },
  then: (s) => s.openRooms(TWO_ROOMS)
}, {
  name: 'Joining a room',
  play: plays(ROOMS, async (c) => {
    await c.step('Press Join room on Empty states', async () => {
      const [join] = await screen.findAllByRole('button', { name: 'Join room' }, SOON);
      if (join) await c.userEvent.click(join);
    });
  })
});
/**
 * Maya, a guest, sent to Pricing by her seat; Aiko, who came after the rooms opened, waits in the main room, to be sent to one
 * from there. With notes on, Pricing doesn't say Notes: nobody invited is in it, so nothing said there is transcribed.
 */
const withAGuest = (s: CallSession) => {
  const maya = s.getSnapshot().participants.find((p) => p.person.email === MAYA.email)?.seat;
  s.openRooms({ ...TWO_ROOMS, rooms: [{ name: 'Empty states', emails: [PRIYA.email, KOFI.email] }, { name: 'Pricing', emails: [], seats: maya ? [maya] : [] }] });
};
export const OpenWithAGuest = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }, { who: MAYA, guest: true }], cues: at(1, joins(AIKO)) },
  then: withAGuest
}, { name: 'Open, with a guest in a room', play: ROOMS });
export const OpenWithAGuestPhone = phone(OpenWithAGuest);
/**
 * The workspace while rooms are open: Workspace, W, Find or the notes' Open puts it on the organizer's stage, and the rooms stand
 * beside it, where the people would be. Maya, a guest who stayed in the main room, asks to see it six seconds in, and the
 * organizer can answer her there. On a phone, or a stage too narrow for both, it goes over the rooms until it's closed.
 */
export const WorkspaceBesideRooms = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: [...REVIEWERS, { who: MAYA, guest: true }], cues: at(6, asksToSee(MAYA)) },
  then: (s) => s.openRooms(TWO_ROOMS)
}, { name: 'The workspace beside the rooms', play: reach('Workspace') });
export const WorkspaceBesideRoomsPhone = phone(WorkspaceBesideRooms);

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
