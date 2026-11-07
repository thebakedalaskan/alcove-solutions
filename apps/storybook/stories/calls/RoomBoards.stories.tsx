/*
 * Boards in breakout rooms (docs: Calls and recordings › Boards in breakout rooms, user-flows 6): the rooms panel's Board row,
 * a board in each room sealed to it, one started in a room, the organizer seeing only that a room is on its board until they
 * join it, every room's board coming back to the main board as rooms close, and one board every room shares, closed in a room
 * for that room alone. Each journey
 * plays the canvas's: Set up rooms, Inside a room, Start a board in a room, While rooms are open, When rooms close, and One
 * board for every room. The stand-in makes, fills and lands the boards as the server does, with @alcove/board's own writers.
 */
import type { BreakoutBoard } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at } from '../../src/api/script';
import { MORE, inCall, phone } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { close, present } from './plays';
import { AIKO, CHECK_IN, KOFI, MAYA, PRIYA, REVIEW } from './talk';

const meta = { title: 'Calls/Boards in breakout rooms', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const EACH: BreakoutBoard = { mode: 'each', template: 'what-why-next' };
const SHARED: BreakoutBoard = { mode: 'shared', template: 'retro' };
const SOON = { timeout: 10000 };
/** Long enough for rooms to open or close in the script, and the board to come up. */
const LATER = { timeout: 40000 };
type Play = NonNullable<PageStory['play']>;
type Press = Parameters<Play>[0]['userEvent'];
/** Breakout rooms, from More: they open in your side. */
async function openRooms(userEvent: Press): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: MORE }, SOON));
  await userEvent.click(await screen.findByRole('button', { name: 'Breakout rooms' }, SOON));
}
/** The rooms you open as the organizer: Priya and Kofi on the empty states, Aiko on pricing. */
const roomsFor = (board: BreakoutBoard) => ({ rooms: [{ name: 'Empty states', emails: [PRIYA.email, KOFI.email] }, { name: 'Pricing', emails: [AIKO.email] }], minutes: 10, board });
/** At Priya's check-in, she opens rooms two seconds in: you're in Rollout with Kofi, and Aiko and Maya are in Support. */
const checkIn = (board: BreakoutBoard | undefined, more: { closeAt?: number | undefined } = {}) => inCall({
  scenario: 'busy', call: CHECK_IN,
  script: {
    here: [{ who: KOFI }, { who: AIKO }, { who: MAYA }],
    cues: [
      ...at(2, {
        do: 'rooms', minutes: 10, ...(board ? { board } : {}),
        rooms: [
          { name: 'Rollout', people: ['me', KOFI], work: ['Ten percent of teams on Monday', 'Tell the beta teams on Friday', 'Watch the error rate for a day'] },
          { name: 'Support', people: [AIKO, MAYA], work: ['A help article for the new flag', 'Macros for the first week'] }
        ]
      }),
      ...(more.closeAt ? at(more.closeAt, { do: 'close-rooms' }) : [])
    ]
  }
});

/* ---------- Set up rooms ---------- */

/** The rooms panel's one new row: Board, with None, In each room and Shared. With In each room, one line says who sees each board, and what it starts from. */
export const SettingUpABoardEach = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, {
  play: async ({ userEvent, step }) => {
    await step('Press More, then Breakout rooms', async () => { await openRooms(userEvent); });
    await step('Press In each room', async () => { await userEvent.click(await screen.findByRole('button', { name: 'In each room' }, SOON)); });
  }
});
/** Shared: one board, a frame for each room, and the line says plainly that everyone can see every frame. */
export const SettingUpABoardShared = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, {
  play: async ({ userEvent, step }) => {
    await step('Press More, then Breakout rooms', async () => { await openRooms(userEvent); });
    await step('Press Shared', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Shared' }, SOON)); });
  }
});
/** On a phone, breakout rooms are in More too, and the Board row is the same. */
export const SettingUpABoardPhone: PageStory = {
  ...phone(SettingUpABoardEach),
  play: (async ({ userEvent, step }) => {
    await step('Press More, then Breakout rooms', async () => { await openRooms(userEvent); });
    await step('Press In each room', async () => { await userEvent.click(await screen.findByRole('button', { name: 'In each room' }, SOON)); });
  }) satisfies Play
};

/** The journey: Breakout rooms, In each room, pick what each starts from, and open them. Everyone moves, each room on its board. */
export const JourneySetUpRooms = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, {
  name: '1. Set up rooms',
  play: async ({ userEvent, step }) => {
    await step('Press More, then Breakout rooms', async () => { await openRooms(userEvent); });
    await step('Press In each room', async () => { await userEvent.click(await screen.findByRole('button', { name: 'In each room' }, SOON)); });
    await step('Choose what each board starts from: Retro', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Starts from/ }, SOON));
      await userEvent.click(await screen.findByRole('button', { name: 'Retro' }, SOON));
    });
    await step('Press Open 2 rooms', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Open 2 rooms' }, SOON)); });
    await step('Every room is on its board', async () => { await screen.findAllByText('On their board. Join to see it.', {}, SOON); });
  }
});

/* ---------- Inside a room ---------- */

/** You arrive in Rollout, and its board is open with its frames ready: sealed to this room. Kofi adds stickies as you look. */
export const InARoomWithItsBoard = checkIn(EACH);
export const InARoomWithItsBoardPhone = phone(InARoomWithItsBoard);
/** The journey: arrive in Rollout on its board, and open its seal: three plain lines say who sees it now, and what happens when rooms close. */
export const JourneyInARoom: PageStory = {
  ...checkIn(EACH), name: '2. Inside a room',
  play: (async ({ userEvent, step }) => {
    await step('Arrive in Rollout, on its board', async () => { await screen.findByRole('button', { name: /Sealed to this room/ }, LATER); });
    await step('Press Sealed to this room', async () => { await userEvent.click(await screen.findByRole('button', { name: /Sealed to this room/ }, SOON)); });
    await step('Three lines say who can see it', async () => { await screen.findByText('Only the people in Rollout can see this board.', {}, SOON); });
  }) satisfies Play
};

/* ---------- Start a board in a room ---------- */

/** Rooms opened with no board: in Rollout with Kofi, Board is where it always is, at the top right, and opens a board just for the room. */
export const InARoomWithNoBoard = checkIn(undefined);
/** The journey: Board, then Blank. The same picker, for this room alone: it comes back with the room when rooms close. */
export const JourneyStartABoardInARoom: PageStory = {
  ...checkIn(undefined), name: '3. Start a board in a room',
  play: (async ({ userEvent, step }) => {
    await step('Told you’re in Rollout, as rooms with no board say it', async () => { await screen.findByText(/You’re in Rollout for 10 min/, {}, LATER); });
    await step('Press Board', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Board' }, SOON)); });
    await step('The picker says it comes back with you when rooms close', async () => { await screen.findByText('Comes back with you when rooms close. Alcove can’t read it.', {}, SOON); });
    await step('Press Blank', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Blank' }, SOON)); });
    await step('It opens, sealed to this room', async () => { await screen.findByRole('button', { name: /Sealed to this room/ }, SOON); });
  }) satisfies Play
};
export const JourneyStartABoardInARoomPhone: PageStory = {
  ...phone(checkIn(undefined)), name: '3. Start a board in a room, on a phone',
  play: (async ({ userEvent, step }) => {
    await step('Told you’re in Rollout, as rooms with no board say it', async () => { await screen.findByText(/You’re in Rollout for 10 min/, {}, LATER); });
    await step('Press More, then Board', async () => {
      await userEvent.click(await screen.findByRole('button', { name: MORE }, SOON));
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, SOON));
    });
    await step('Press Blank', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Blank' }, SOON)); });
  }) satisfies Play
};

/* ---------- While rooms are open ---------- */

/** You're the organizer, in the main room: each room's card says it's on its board, and nothing of what's on it. */
export const OverseeingRoomBoards = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: (s) => s.openRooms(roomsFor(EACH)) }, {
  play: async ({ userEvent, step }) => {
    await step('Press More, then Breakout rooms', async () => { await openRooms(userEvent); });
  }
});
export const OverseeingRoomBoardsPhone = { ...phone(OverseeingRoomBoards), play: undefined };
/** The journey: Join room on Empty states puts you on its board; Back to main room takes it away with the room's keys. */
export const JourneyWhileRoomsAreOpen = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: (s) => s.openRooms(roomsFor(EACH)) }, {
  name: '4. While rooms are open',
  play: async ({ userEvent, step }) => {
    await step('Press More, then Breakout rooms', async () => { await openRooms(userEvent); });
    await step('Press Join room on Empty states', async () => { await userEvent.click((await screen.findAllByRole('button', { name: 'Join room' }, SOON))[0] ?? document.body); });
    await step('You’re on its board', async () => { await screen.findByRole('button', { name: /Sealed to this room/ }, SOON); });
    await step('Press Back to main room', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Back to main room' }, SOON)); });
    await step('The overview again', async () => { await screen.findAllByText('On their board. Join to see it.', {}, SOON); });
  }
});

/* ---------- When rooms close ---------- */

/** Rooms close at 25 seconds: everyone's back, and each room's board lands on the main board as a frame, named, with who was there. */
export const RoomsComeBack = checkIn(EACH, { closeAt: 25 });
/** The journey: time's up, rooms close, and the boards come with everyone. */
export const JourneyRoomsClose: PageStory = {
  ...checkIn(EACH, { closeAt: 25 }), name: '5. When rooms close',
  play: (async ({ step }) => {
    await step('Arrive in Rollout, on its board', async () => { await screen.findByRole('button', { name: /Sealed to this room/ }, LATER); });
    await step('Rooms close, and two boards come back', async () => { await screen.findByText('Everyone’s back. 2 boards came with you.', {}, LATER); });
  }) satisfies Play
};
export const RoomsComeBackPhone = phone(RoomsComeBack);

/* ---------- One board for every room ---------- */

/** Shared: you land on Rollout's frame on the one board every room is on, and you're told everyone can see it. */
export const OneBoardForEveryRoom = checkIn(SHARED, { closeAt: 30 });
/** The organizer stays on the board, and can watch every room's frame fill up. */
export const OneBoardForEveryRoomOrganizer = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: (s) => s.openRooms(roomsFor(SHARED)) });
/** The journey: arrive on your room's frame, told plainly the board isn't private; rooms close and nothing has to come back. */
export const JourneyOneBoardForEveryRoom: PageStory = {
  ...checkIn(SHARED, { closeAt: 20 }), name: '6. One board for every room',
  play: (async ({ step }) => {
    await step('Arrive on Rollout’s frame', async () => { await screen.findByText(/Everyone can see this board/, {}, LATER); });
    await step('Rooms close, and the board stays as it is', async () => { await screen.findByText('Everyone’s back. The board stays as it is.', {}, LATER); });
  }) satisfies Play
};
export const OneBoardForEveryRoomPhone = phone(OneBoardForEveryRoom);
/** The board every room shares is made for the rooms, named after the call. */
const BOARD_NAME = 'Launch check-in';
/**
 * You present the board every room shares from Rollout, and Close asks for whom: For everyone closes it for everyone in this
 * room, and the board stays the call's, as only whoever opened it or the organizer takes it out of the call.
 */
export const ClosingItInARoom: PageStory = {
  ...checkIn(SHARED), name: 'Closing it in a room',
  play: (async (c) => {
    await c.step('Arrive on Rollout’s frame, and press Present on the board’s bar', async () => {
      await screen.findByText(/Everyone can see this board/, {}, LATER);
      await present(c, BOARD_NAME);
      await screen.findByText(/You’re presenting/, {}, LATER);
    });
    await c.step('Press Close: For everyone closes it for everyone in this room', async () => {
      await close(c, BOARD_NAME);
      await screen.findByText('It closes for everyone in this room.', {}, LATER);
    });
  }) satisfies Play
};
