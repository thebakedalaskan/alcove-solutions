/*
 * The board itself: the real `BoardSurface` on an in-memory board, in each place the app shows it. In a call it's the main
 * thing on the stage, with the tools beside it and the bar along its top; on its own page it has day round it and Start a call
 * here; in a presented tile it's a picture that can't be pressed; on a phone it's for looking round and adding a sticky. Every board
 * here is the design canvas's, written through the board package's own writes: a new board from each template, the launch retro
 * a few minutes in, the ideas before and after sorting, the onboarding flow and what three breakout rooms brought back.
 *
 * Everything on it works: double-click to write (text on open board, a sticky in a frame), drag, draw, undo, and the board's
 * own More (a table, a mind map, a template, Copy link, the downloads, Night board). The name and the seal's menus, Image, From
 * your workspace and Start a call here belong to what's round the board, so here they say they were pressed in the Actions panel.
 */
import { BoardPhoneAdd, BoardPill, PresentedTile } from '@alcove/ui';
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { BoardScene, whereItShows, type BoardStory } from '../../src/board';
import { did } from '../../src/component';
import { AROUND, launchIdeas, launchRetro, onboardingFlow, retroWithComments, roomsBack, templateBoard } from '../../src/world/boards';
import { PRIYA } from '../../src/world/people';

const MODES = ['call', 'page', 'read', 'tile', 'phone'] as const;
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
    board: { control: false }, others: { control: false }, talking: { control: false }, follow: { control: false }, children: { control: false }, sealIcon: { control: false }, sort: { control: false }
  }
} satisfies Meta<typeof BoardScene>;
export default meta;

/**
 * The launch retro a few minutes in, as the call shows it: everyone has written, three actions are linked to what they fix,
 * and five pointers carry a face and a name. Priya is talking, so her pointer glows with the same ring as her tile.
 */
export const InTheCall: BoardStory = { name: 'In the call' };
export const InTheCallDark: BoardStory = { name: 'In the call, dark', globals: { theme: 'dark' } };

/** A new board from Blank: one line says how to start, and fades after the first thing on it. A double-click there writes text. */
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

/**
 * Ideas where people dropped them, before anyone sorted them. Drag round them all and the bar offers Sort into themes, which here
 * answers after a moment as confidential compute would, with the canvas's three themes. They travel into them, and one undo puts it
 * all back.
 */
export const PileOfIdeas: BoardStory = { name: 'A pile of ideas', args: { board: () => launchIdeas(), others: [], talking: ['theo'] } };
/** The same ideas after Sort into themes: three named groups, each in its own colour, and the frame drawn round its themes. It counts nine stickies: a theme's name is no sticky. */
export const SortedIntoThemes: BoardStory = { name: 'Sorted into themes', args: { board: () => launchIdeas({ sorted: true }), others: [], talking: ['theo'] } };

/**
 * A board with comments: Maya asked about the changelog on Priya's sticky and Art answered, and Kofi left a note on refreshing
 * staging. Each shows as a pin on the sticky's corner with its first person's face and how many have replied, and nothing else
 * until it's opened. Pins stay one size at any zoom. Comments aren't on the board: nobody's undo takes one back.
 */
export const WithComments: BoardStory = { name: 'With comments', args: { board: () => retroWithComments() } };
/** Maya's thread, open beside its pin in the workspace's comment sheet: what it's on, Resolve, what's been said and the field to reply in. */
export const AThreadOpen: BoardStory = {
  name: 'A thread open',
  args: { board: () => retroWithComments() },
  play: async ({ canvas, userEvent, step }) => {
    await step('Click the pin on Priya’s sticky', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Comment from Maya, and 1 reply' }));
    });
  }
};
/** A new comment: pick a sticky, press K, and write. The field opens beside its corner, with your face. */
export const ANewComment: BoardStory = {
  name: 'A new comment',
  args: { board: () => retroWithComments() },
  play: async ({ canvas, userEvent, step }) => {
    await step('Click One owner for launch comms, then press K', async () => {
      await userEvent.click(await canvas.findByText('One owner for launch comms'));
      await userEvent.keyboard('k');
    });
    await step('Write the comment', async () => {
      // The field opens in the workspace's comment sheet, which is drawn over the page, outside the story's root.
      await userEvent.type(await screen.findByRole('textbox', { name: 'Comment' }), 'Priya, can you take this one?');
    });
  }
};
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
 * and the bar has no Vote, as there's no call to run one.
 */
export const OnItsPage: BoardStory = { name: 'On its page', args: { mode: 'page', others: [{ who: 'priya', at: { x: 575, y: 214 } }, { who: 'kofi', at: { x: 980, y: 430 } }], talking: [] } };
export const OnItsPageDark: BoardStory = { ...OnItsPage, name: 'On its page, dark', globals: { theme: 'dark' } };
/**
 * For someone given view access, in a call: the tools and undo go away, and they can still look round, follow people, read
 * comments and talk. The bar keeps More, which has nothing in it that changes the board. With the call's vote round it, Vote
 * stays where it is too, disabled, saying why in its tip (Components/Board/BoardBar, View only, in a call).
 */
export const ViewOnly: BoardStory = { name: 'View only', args: { mode: 'read', seal: 'View only', sealIcon: 'eye', acts: true, board: () => retroWithComments() } };
/** More, for someone with view access: a link, the board as an image or a PDF, and Night board. */
export const ViewOnlyMore: BoardStory = {
  name: 'View only, with More',
  args: { mode: 'read', seal: 'View only', sealIcon: 'eye', acts: true },
  play: async ({ canvas, userEvent, step }) => {
    await step('Click More on the bar', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'More' }));
    });
  }
};
/** Someone with view access reads a thread, with no field and no Resolve. */
export const ViewOnlyThread: BoardStory = {
  name: 'View only, a thread open',
  args: { mode: 'read', seal: 'View only', sealIcon: 'eye', acts: true, board: () => retroWithComments() },
  play: async ({ canvas, userEvent, step }) => {
    await step('Click the pin on Priya’s sticky', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Comment from Maya, and 1 reply' }));
    });
  }
};

/**
 * While someone presents the board and it isn't on your stage, it's a tile with the people: a picture that keeps up, its name,
 * who's presenting it, and Join, which puts it on your stage, following them. The picture is drawn at 1120 by 700 and shrunk.
 */
export const LiveTile: BoardStory = {
  name: 'Live tile',
  args: { mode: 'tile', others: [] },
  render: (args) => (
    <div className="sbb-tile">
      <PresentedTile name="Launch retro" icon="presentation" sub="Priya is presenting" by={PRIYA} go="Join" label="Join Launch retro" onPress={did('join')}>
        <span className="ic-ptile-board" style={{ width: 1120, height: 700, transform: 'scale(0.5)' }}><BoardScene {...args} /></span>
      </PresentedTile>
    </div>
  )
};

/**
 * On a phone, in a room: faces stay on top and the board fills the rest. Pinch to zoom and drag to look round; + adds a sticky,
 * and drawing stays on bigger screens. As in the canvas, Support has five stickies: the sixth is the one the phone adds.
 */
export const OnAPhone: BoardStory = {
  name: 'On a phone',
  globals: PHONE,
  args: {
    board: () => roomsBack({ leaveOut: ['Support2b'] }), mode: 'phone', name: 'Launch retro', focus: 'Support', others: [{ who: 'lena', at: { x: 856, y: 318 } }], talking: [],
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

/** Double-click on open board, in no frame: plain text, ready to type, with no box round it. Esc finishes it. */
export const AddText: BoardStory = {
  name: 'Add text',
  args: { board: () => ({ doc: templateBoard('blank') }), others: [], talking: [] },
  play: async ({ canvas, userEvent, step }) => {
    await step('Double-click in the middle of the blank board', async () => {
      const sheet = canvas.getByRole('application', { name: 'Launch retro' });
      const r = sheet.getBoundingClientRect();
      await userEvent.pointer({ keys: '[MouseLeft][MouseLeft]', target: sheet, coords: { clientX: r.x + r.width / 2, clientY: r.y + r.height / 3 } });
    });
    await step('Type a label, and Esc: it stays as text, with nothing round it', async () => {
      await userEvent.keyboard('Launch plan');
      await userEvent.keyboard('{Escape}');
    });
  }
};

/**
 * Dragged off into empty space, nothing on the board is in view: the sheet offers Back to the board, which shows all of it again,
 * as Show the whole board on the bar does (⇧1 too). It goes as soon as something's in view.
 */
export const LostAndBack: BoardStory = {
  name: 'Lost, and back',
  play: async ({ canvas, userEvent, step }) => {
    await step('Hold Space and drag the board off to the left, twice: nothing on it is in view, and the sheet offers Back to the board', async () => {
      const sheet = canvas.getByRole('application', { name: 'Launch retro' });
      sheet.focus();
      const r = sheet.getBoundingClientRect();
      const y = r.y + r.height / 2;
      await userEvent.keyboard('[Space>]');
      for (let i = 0; i < 2; i += 1) {
        await userEvent.pointer([{ keys: '[MouseLeft>]', target: sheet, coords: { clientX: r.right - 20, clientY: y } }, { coords: { clientX: r.x + 20, clientY: y } }, { keys: '[/MouseLeft]' }]);
      }
      await userEvent.keyboard('[/Space]');
      await canvas.findByRole('button', { name: 'Back to the board' }, { timeout: 4000 });
    });
    await step('Press it: all of the board is in view again', async () => {
      await userEvent.click(canvas.getByRole('button', { name: 'Back to the board' }));
    });
  }
};

/** On a phone, Show the whole board stays on the bar while the zoom gives way to a pinch: one press shows all of the board. */
export const ShowEverythingOnAPhone: BoardStory = {
  name: 'Show the whole board, on a phone',
  args: { mode: 'phone' },
  globals: PHONE,
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Show the whole board, on the bar: all of it, further out than a pinch goes', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Show the whole board' }));
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
