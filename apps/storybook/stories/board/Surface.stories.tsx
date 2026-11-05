/*
 * The board itself: the real `BoardSurface` on an in-memory board, in each place the app shows it. In a call it's the main
 * thing on the stage, with the tools beside it and the bar along its top; on its own page it has day round it and Start a call
 * here; in a live tile it's a picture that can't be pressed; on a phone it's for looking round and adding a sticky. Every board
 * here is the design canvas's, written through the board package's own writes: a new board from each template, the launch retro
 * a few minutes in, the ideas before and after sorting, the onboarding flow and what three breakout rooms brought back.
 *
 * Everything on it works: double-click to add a sticky, drag, draw, undo. The bar's menus and Start a call here belong to
 * what's round the board, so here they say they were pressed in the Actions panel.
 */
import { BoardPhoneAdd, BoardPill, BoardTile } from '@alcove/ui';
import type { Meta } from '@storybook/react-vite';
import { BoardScene, whereItShows, type BoardStory } from '../../src/board';
import { did } from '../../src/component';
import { AROUND, launchIdeas, launchRetro, onboardingFlow, roomsBack, templateBoard } from '../../src/world/boards';
import { ART } from '../../src/world/people';

const MODES = ['call', 'page', 'read', 'tile', 'present', 'phone'] as const;
const PHONE = { viewport: { value: 'phone', isRotated: false } };

const meta = {
  title: 'Board/Surface',
  component: BoardScene,
  decorators: [whereItShows],
  parameters: { layout: 'fullscreen' },
  args: { board: () => launchRetro(), mode: 'call', name: 'Launch retro', others: AROUND, talking: ['priya'] },
  argTypes: {
    mode: { control: 'select', options: MODES },
    name: { control: 'text' },
    seal: { control: 'text' },
    board: { control: false }, others: { control: false }, talking: { control: false }, follow: { control: false }, children: { control: false }, sealIcon: { control: false }
  }
} satisfies Meta<typeof BoardScene>;
export default meta;

/**
 * The launch retro a few minutes in, as the call shows it: everyone has written, three actions are linked to what they fix,
 * and five pointers carry a face and a name. Priya is talking, so her pointer glows with the same ring as her tile.
 */
export const InTheCall: BoardStory = { name: 'In the call' };
export const InTheCallDark: BoardStory = { name: 'In the call, dark', globals: { theme: 'dark' } };

/** A new board from Blank: one line says how to start, and fades after the first sticky. */
export const Blank: BoardStory = { args: { board: () => ({ doc: templateBoard('blank') }), others: [], talking: [] } };
/** A new board from Retro: Went well, Could improve and Actions, each saying what goes in it while it's empty. Double-click in one and a sticky appears in its colour. */
export const Retro: BoardStory = { args: { board: () => ({ doc: templateBoard('retro') }), others: [], talking: [] } };
/** A new board from Ideas: one wide frame to drop ideas into anywhere. */
export const Ideas: BoardStory = { args: { board: () => ({ doc: templateBoard('ideas') }), others: [], talking: [] } };
/** A new board from Flow: a start, steps, a choice and a done, already linked. */
export const Flow: BoardStory = { args: { board: () => ({ doc: templateBoard('flow') }), others: [], talking: [] } };
/** A breakout room's board, from What happened, why and what next: sealed to the room, with the room's time over it. */
export const WhatWhyNext: BoardStory = {
  name: 'What, why, next',
  args: {
    board: () => ({ doc: templateBoard('what-why-next') }), name: 'Comms board', seal: 'Sealed to this room', others: [{ who: 'theo', at: { x: 300, y: 180 } }], talking: [],
    children: <BoardPill icon="door" title="Comms" time="9:12" />
  }
};

/** Ideas where people dropped them, before anyone sorted them. Drag round them all and the bar offers Sort into themes. */
export const PileOfIdeas: BoardStory = { name: 'A pile of ideas', args: { board: () => launchIdeas(), others: [], talking: ['theo'] } };
/** The same ideas after Sort into themes: three named groups, each in its own colour. One undo puts it all back. */
export const SortedIntoThemes: BoardStory = { name: 'Sorted into themes', args: { board: () => launchIdeas({ sorted: true }), others: [], talking: ['theo'] } };
/** A saved board brought in from the workspace: the onboarding flow, with Aiko's question on the step people stop at. */
export const OnboardingFlow: BoardStory = {
  name: 'Onboarding flow',
  args: { board: () => ({ doc: onboardingFlow() }), name: 'Onboarding flow', others: [{ who: 'theo', at: { x: 300, y: 60 } }, { who: 'aiko', at: { x: 620, y: 280 } }], talking: [] }
};
/** When breakout rooms close, each room's board comes back as a frame, named, with who was there. */
export const RoomsBack: BoardStory = {
  name: 'Rooms back',
  args: { board: () => roomsBack(), others: [{ who: 'priya', at: { x: 180, y: 90 } }, { who: 'kofi', at: { x: 560, y: 200 } }, { who: 'lena', at: { x: 980, y: 330 } }], talking: [] }
};

/**
 * The same board on its own page, with no call round it: who else is here, and Start a call here. People can keep adding,
 * and the bar has no Timer, Vote or Present, as there's no session to run.
 */
export const OnItsPage: BoardStory = { name: 'On its page', args: { mode: 'page', others: [{ who: 'priya', at: { x: 575, y: 214 } }, { who: 'kofi', at: { x: 980, y: 430 } }], talking: [] } };
export const OnItsPageDark: BoardStory = { ...OnItsPage, name: 'On its page, dark', globals: { theme: 'dark' } };
/**
 * For someone given view access: the tools and undo go away, and they can still look round, follow people and talk. In the
 * call the bar keeps the timer, a vote, presenting and More, as the canvas has it: the call passes `acts`.
 */
export const ViewOnly: BoardStory = { name: 'View only', args: { mode: 'read', seal: 'View only', sealIcon: 'eye', acts: true } };
/** Presenting: no tools, no dots and no handles, just the frame on screen, as everyone sees it. */
export const Presenting: BoardStory = { args: { mode: 'present', focus: 'Went well', others: [], talking: ['art'] } };

/** Anyone can drop the board to a live tile and keep faces big. It's a picture that keeps up, and pressing it opens the board. */
export const LiveTile: BoardStory = {
  name: 'Live tile',
  args: { mode: 'tile', others: [] },
  render: (args) => (
    <div className="sbb-tile">
      <BoardTile person={ART} name="Art’s board" label="Open the board" w={1120} h={700} scale={0.5} onOpen={did('open the board')}>
        <BoardScene {...args} />
      </BoardTile>
    </div>
  )
};

/**
 * On a phone, in a room: faces stay on top and the board fills the rest. Pinch to zoom and drag to look round; + adds a sticky,
 * and drawing stays on bigger screens.
 */
export const OnAPhone: BoardStory = {
  name: 'On a phone',
  globals: PHONE,
  args: {
    board: () => roomsBack(), mode: 'phone', name: 'Launch retro', focus: 'Support', others: [{ who: 'lena', at: { x: 856, y: 318 } }], talking: [],
    children: (
      <>
        <BoardPill icon="door" title="Support" time="6:40" />
        <BoardPhoneAdd onAdd={did('add a sticky')} />
      </>
    )
  }
};
export const OnAPhoneDark: BoardStory = { ...OnAPhone, name: 'On a phone, dark', globals: { ...PHONE, theme: 'dark' } };

/** Picking a sticky: a small bar sits above it, with its colour, size, a line, copy and delete. Dots on each side start a line. */
export const PickASticky: BoardStory = {
  name: 'Pick a sticky',
  play: async ({ canvas, userEvent, step }) => {
    await step('Click Priya’s sticky, Changelog went out after the launch post', async () => {
      await userEvent.click(await canvas.findByText('Changelog went out after the launch post'));
    });
  }
};

/** Double-click in Went well: a sticky appears in that frame's colour, ready to type. */
export const AddASticky: BoardStory = {
  name: 'Add a sticky',
  args: { board: () => ({ doc: templateBoard('retro') }), others: [], talking: [] },
  play: async ({ canvas, userEvent, step }) => {
    await step('Double-click in Went well', async () => {
      // Under the line that says what goes in it: the sheet takes the press, and works out the frame from where it is.
      const hint = (await canvas.findByText('What should we keep doing?')).getBoundingClientRect();
      const sheet = canvas.getByRole('application', { name: 'Launch retro' });
      await userEvent.pointer({ keys: '[MouseLeft][MouseLeft]', target: sheet, coords: { clientX: hint.x + hint.width / 2, clientY: hint.y + hint.height + 60 } });
    });
    await step('Type what went well', async () => {
      await userEvent.keyboard('Beta sign-ups beat the plan');
    });
  }
};

/** The sticky tool's colours, beside the rail and level with the tool. */
export const StickyColours: BoardStory = {
  name: 'Sticky colours',
  play: async ({ canvas, userEvent, step }) => {
    await step('Click Sticky in the tools', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Sticky · N' }));
    });
  }
};
