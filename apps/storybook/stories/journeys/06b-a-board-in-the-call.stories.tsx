/*
 * Journeys through a board in the call (user-flows 6, A board in the call), numbered after the call's own (06), in the
 * whiteboards canvas's words. A board opens on your stage just for you, from Board at the top right: a new one, which is the
 * board in the call, or one your team already has. Present, on its frame's bar, brings everyone. Then working on it together,
 * beside a shared screen, the organizer closing someone's for everyone, its timer and votes, how the call helps: ideas from
 * what's said, and Sort into themes, and all of it on a phone. You're Art, the organizer, in the design review with Priya,
 * Kofi and Aiko, who fill the board in the call as they talk (stories/calls/boards.ts); their side is the script's.
 */
import { fillTemplate } from '@alcove/board';
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { itemId } from '../../src/api/scenarios';
import { at, opensBoard, presentsBoard, shares, type CallScript, type Cue, type Present } from '../../src/api/script';
import { boardDoc } from '../../src/api/workspaces';
import { MORE, inCall } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { drawIdeas } from '../../src/world/boards';
import { HEARD, RETRO, filledAfter, retroWith } from '../calls/boards';
import { AIKO, CHECKLIST, KOFI, PRIYA, REVIEW, REVIEW_TALK, SAM } from '../calls/talk';
import { LAPTOP, LATER, SOON, pressable, still } from './play';

const meta = { title: 'Journeys/6 A board in the call', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

type Step = Parameters<NonNullable<PageStory['play']>>[0];

const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/** The design review, talking it through with notes off, and the launch retro's work for whatever board opens, unless it says otherwise. */
const review = (o: { cues?: Cue[]; here?: Present[]; board?: CallScript['board']; notes?: 'on' | 'off'; then?: () => void } = {}): PageStory => {
  const script: CallScript = { here: o.here ?? REVIEWERS, notes: o.notes ?? 'off', talk: { lines: REVIEW_TALK, every: 6 }, board: 'board' in o ? o.board : RETRO, cues: o.cues ?? [] };
  return inCall({ scenario: 'call-soon', call: REVIEW, script, ...(o.then ? { then: o.then } : {}) }, { globals: LAPTOP });
};
/** A board on your stage, in its frame, by its name: a new board is named after the call. */
const board = (name = 'Design review', who: 'only you' | 'everyone' = 'only you') => screen.findByRole('region', { name: `${name}, ${who} see${who === 'everyone' ? 's' : ''} it` }, LATER);
/**
 * Presses `row` in the picker under Board, once it's there and the picker's rows are still. Your team's boards come in under the
 * templates a moment after it opens, and the board in this call at its top once someone has made it; like every menu, it takes
 * no press for a moment after its rows move, so what's under the pointer is what someone aimed at.
 */
async function pick(row: string | RegExp, { userEvent }: Pick<Step, 'userEvent'>): Promise<void> {
  const picker = await screen.findByRole('dialog', { name: 'Open a board' }, LATER);
  await within(picker).findByText('Your team’s boards', {}, LATER);
  await within(picker).findByRole('button', { name: row }, LATER);
  await still(picker);
  await userEvent.click(within(picker).getByRole('button', { name: row }));
}
/** Opens the board picker from Board at the top right and starts a new board from `template`, on your stage just for you. */
async function startFrom(template: 'Blank' | 'Retro' | 'Ideas' | 'Flow', c: Step): Promise<void> {
  await c.userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
  await pick(template, c);
}
/** The board Priya made, the board in this call, first in the picker under Board (in More on a phone): it opens on your stage, just for you. */
async function openTheCallsBoard(c: Step, phone = false): Promise<void> {
  if (phone) await c.userEvent.click(await screen.findByRole('button', { name: MORE }, LATER));
  await c.userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
  await pick(/^Design review/, c);
}
/**
 * `row` in a menu, by the menu's name, once it's there and the menu's rows are still: the menus of someone's tile and of what's
 * presented, whose rows follow the call (who's on the board with you, whether there's room for two).
 */
async function settledRow(menu: string | RegExp, row: string): Promise<HTMLElement> {
  const it = await screen.findByRole('dialog', { name: menu }, SOON);
  await within(it).findByRole('button', { name: row }, SOON);
  await still(it);
  return within(it).getByRole('button', { name: row });
}
/** Where in a frame to look for a clear spot, across and down it: its middle first, where its hint is while it's empty. */
const SPOTS = [[0.5, 0.5], [0.5, 0.68], [0.5, 0.84], [0.28, 0.6], [0.72, 0.6], [0.28, 0.84], [0.72, 0.84]] as const;
/**
 * A clear spot in a board's frame, by the frame's title. A frame takes no presses itself, so with nothing of the board's there
 * a double-click lands on the sheet, which puts a sticky there in the frame's colour. The others fill a frame from its top as
 * they talk, so its middle is clear for a while, and lower down for longer.
 */
function clearSpotIn(title: string): Promise<{ sheet: HTMLElement; x: number; y: number }> {
  return waitFor(() => {
    const frame = screen.queryAllByText(title).map((t) => t.closest('.bf')).find((f) => f instanceof HTMLElement);
    const sheet = frame?.closest('.bd');
    if (!(frame instanceof HTMLElement) || !(sheet instanceof HTMLElement)) throw new Error(`There’s no ${title} on the board yet.`);
    const box = frame.getBoundingClientRect();
    for (const [across, down] of SPOTS) {
      const x = box.left + box.width * across;
      const y = box.top + box.height * down;
      if (document.elementFromPoint(x, y) === sheet) return { sheet, x, y };
    }
    throw new Error(`Nowhere in ${title} is clear.`);
  }, SOON);
}
/** The sticky just made, open for typing: its field on the sheet has the keys. */
const typingIn = (sheet: HTMLElement) => waitFor(() => {
  const field = document.activeElement;
  if (!(field instanceof HTMLTextAreaElement) || !sheet.contains(field)) throw new Error('No sticky is open for typing yet.');
}, SOON);
/** The frame's name, which opens its menu: the first thing on its bar that opens something. */
function nameOf(f: HTMLElement): HTMLElement {
  const [menu] = within(f).getAllByRole('button').filter((b) => b.hasAttribute('aria-haspopup'));
  if (!menu) throw new Error('The frame’s name isn’t a menu.');
  return menu;
}

export const StartABoard: PageStory = {
  name: '6.13 Start a board',
  ...review(),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Board sits at the top right, beside Workspace. Press it, or O', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
    });
    await step('The picker rises from it. Blank is one click; boards your team already has are underneath. Press Retro', async () => {
      await pick('Retro', c);
    });
    await step('It opens on your stage, just for you, and the call carries on beside it. It’s the board in the call: Present, on its bar, brings everyone', async () => {
      await board();
    });
    await step('Double-click in Went well: a sticky in that frame’s colour, ready to type', async () => {
      // The others fill the board as they talk, and Went well's hint goes with its first sticky: anywhere clear in it will do.
      const { sheet, x, y } = await clearSpotIn('Went well');
      await userEvent.pointer({ keys: '[MouseLeft][MouseLeft]', target: sheet, coords: { clientX: x, clientY: y } });
      await typingIn(sheet);
      await userEvent.keyboard('Pricing page shipped a week early');
    });
    await step('Esc when you’re done. Whoever opens it writes at once, each pointer with a face and a name', async () => {
      await userEvent.keyboard('{Escape}');
      await screen.findByText('Changelog went out after the launch post', {}, LATER);
    });
  }
};

/** The onboarding flow, in Design, drawn as the Flow template draws it: what the saved board has on it. */
const ONBOARDING = itemId('Onboarding flow');
export const OpenASavedBoard: PageStory = {
  name: '6.14 Open a saved board, then present it',
  ...review({ here: [...REVIEWERS, { who: SAM, guest: true }], board: undefined, then: () => { fillTemplate(boardDoc('ws-design', ONBOARDING), 'flow', null, ONBOARDING); } }),
  play: async ({ userEvent, step }) => {
    await step('Press Board: boards your team already has are under the templates, with where they’re from', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
    });
    await step('Press Onboarding flow. It opens on your stage, just for you: nothing in the call changes', async () => {
      await pick(/^Onboarding flow/, { userEvent });
      await board('Onboarding flow');
    });
    await step('Present, on its bar. Sam came in with the link and can’t open it: you decide before anyone sees it', async () => {
      await userEvent.click(await within(await board('Onboarding flow')).findByRole('button', { name: 'Present' }, SOON));
    });
    await step('Let them in for this call: everyone can work on it until the call ends, and after that, Sam can’t again. Everyone follows you on it', async () => {
      // Present's question isn't a menu whose rows move: it takes a press once its button can be pressed.
      await userEvent.click(await pressable('button', 'Let them in for this call'));
      await screen.findByText('Everyone follows you on Onboarding flow. They can unfollow to add to it.', {}, LATER);
    });
  }
};

export const WorkOnItTogether: PageStory = {
  name: '6.15 Work on it together',
  ...review({ cues: at(1, opensBoard(PRIYA, 'retro')) }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Priya made the launch retro. Press Board: the board in this call is first. Open it, just for you', async () => {
      await openTheCallsBoard(c);
      await board();
    });
    await step('Everyone on it is there with you. Whoever’s talking glows, on their tile and their pointer', async () => {
      await screen.findByText('Refresh staging every night', {}, LATER);
    });
    await step('Press Enter on Priya’s tile: Go to Priya takes you to where she is, and Follow Priya keeps you with her', async () => {
      const tile = await screen.findByRole('group', { name: /^Priya/ }, SOON);
      tile.focus();
      await userEvent.keyboard('{Enter}');
    });
    await step('Follow Priya: a ring in her colour says this view isn’t yours, and a pill at the top of the board says whose it is', async () => {
      await userEvent.click(await settledRow(/^Options for Priya/, 'Follow Priya'));
      await screen.findByText('Following Priya', {}, SOON);
    });
    await step('Stop: you’re back where you were', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Stop' }, SOON));
    });
  }
};

export const BesideASharedScreen: PageStory = {
  name: '6.16 Beside a shared screen',
  ...review({ cues: at(1, shares(PRIYA, CHECKLIST)) }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Priya is sharing: her screen is on your stage, and everyone beside it', async () => {
      await screen.findByRole('region', { name: 'Priya’s screen, everyone sees it' }, LATER);
    });
    await step('Press Board, then Retro: the board takes your stage, just for you, and Priya’s screen waits as a tile with the people, still live', async () => {
      await startFrom('Retro', c);
      await board();
    });
    await step('Press ⋯ on Priya’s screen, then Show beside: the board and her screen side by side', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Options for Priya’s screen' }, SOON));
      await userEvent.click(await settledRow('Options for Priya’s screen', 'Show beside'));
      await board();
    });
    await step('Press the name of Priya’s screen: with the board open, its menu has Put on the board', async () => {
      await userEvent.click(nameOf(await screen.findByRole('region', { name: 'Priya’s screen, everyone sees it' }, SOON)));
    });
    await step('Put on the board: a picture of this moment lands on the board with its time, and Priya is told', async () => {
      // A shared screen's menu moves its rows only as something else starts or stops being presented, which nothing does here.
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Put on the board' }, SOON));
      await screen.findByText(/A picture of Priya’s screen is on the board/, {}, SOON);
    });
  }
};

export const CloseItForEveryone: PageStory = {
  name: '6.17 Close it for everyone, as the organizer',
  ...review({ cues: [...at(1, opensBoard(PRIYA, 'retro')), ...at(10, presentsBoard(PRIYA))] }),
  play: async ({ userEvent, step }) => {
    await step('Priya presents the launch retro: it comes on your stage, and you follow her', async () => {
      await board('Design review', 'everyone');
      await screen.findByText('Refresh staging every night', {}, LATER);
    });
    await step('Everything about the board itself is under its name. As the organizer, Close it for everyone is there too, after a line', async () => {
      await userEvent.click(nameOf(await board('Design review', 'everyone')));
    });
    await step('Close it for everyone: it closes for everyone in the call, and the people take your stage back', async () => {
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Close it for everyone' }, SOON));
      await screen.findByText('Closed for everyone.', {}, SOON);
    });
  }
};

export const TimerAndVotes: PageStory = {
  name: '6.18 Timer and votes',
  ...review({ cues: at(1, opensBoard(PRIYA, 'retro')) }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Priya made the launch retro. Press Board, at the top right: the board in this call comes first. Open it, just for you', async () => {
      await openTheCallsBoard(c);
      await screen.findByText('Refresh staging every night', {}, LATER);
    });
    await step('You want five quiet minutes. Timer, on the board’s bar: three lengths and Start, and no form', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Timer' }, SOON));
    });
    await step('Start: one pill at the top of the board, the same for everyone. It chimes softly at the end', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Start' }, SOON));
      await screen.findByText('Add your stickies', {}, SOON);
    });
    await step('Vote: it votes on the frame you’re looking at, and nobody sees a count until you end it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Vote' }, SOON));
    });
    await step('Start the vote, then press a sticky: each press spends a vote and shows a dot only you can see', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Start the vote' }, SOON));
      await screen.findByText(/votes left/, {}, SOON);
      await userEvent.click(await screen.findByText('Nobody owned the status page', {}, SOON));
    });
    await step('End the vote: every count appears at once, for everyone. The top three stay bright and the rest step back', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'End the vote' }, SOON));
      await screen.findByText('Results', {}, SOON);
    });
  }
};

export const IdeasFromTheCall: PageStory = {
  name: '6.19 Ideas from the call',
  ...review({ notes: 'on', cues: [...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, HEARD)] }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Priya made the launch retro. Press Board, then the board in this call: it opens on your stage, just for you', async () => {
      await openTheCallsBoard(c);
      await board();
    });
    await step('People talk, with notes on. The call picks out ideas worth keeping and says so quietly: nobody stops to write them down', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '3 ideas from the call' }, LATER));
    });
    await step('Each line says who said it. Add the ones you want: the same confidential compute writes these and the notes', async () => {
      await screen.findByRole('region', { name: 'Ideas from the call' }, SOON);
      await screen.findByText('Priya, 2 min ago', {}, SOON);
    });
    await step('Add all three: they land in the frames they belong in, popping in one after another', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Add all three' }, SOON));
      await screen.findByText('Added 3 stickies from the call.', {}, SOON);
      await screen.findByText('Name a status page owner', {}, SOON);
    });
  }
};

export const SortIntoThemes: PageStory = {
  name: '6.20 Sort into themes',
  ...review({ board: undefined, cues: at(1, opensBoard(PRIYA, 'blank', { draw: drawIdeas })) }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Priya made a board and put ideas on it. Press Board, then the board in this call: it opens on your stage, just for you', async () => {
      await openTheCallsBoard(c);
      await board();
    });
    await step('Later, a pile of ideas. Pick them all, or drag round them: the bar offers Sort into themes and Tidy', async () => {
      await userEvent.click(await screen.findByText('Write the changelog first', {}, LATER));
      await userEvent.keyboard('{Meta>}a{/Meta}');
      await userEvent.click(await screen.findByRole('button', { name: 'Sort into themes' }, SOON));
    });
    await step('Alcove reads them in confidential compute, names the themes and moves the stickies. One Undo puts it all back', async () => {
      await screen.findByText('Sorted into 3 themes.', {}, LATER);
      await screen.findByText('Ownership', {}, SOON);
    });
  }
};

/** The phone's size, for the journey on one. */
const PHONE = { viewport: { value: 'phone', isRotated: false } };

export const OnAPhone: PageStory = {
  name: '6.21 On a phone',
  ...review({ notes: 'on', cues: [...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter(3) + 1, HEARD)], board: retroWith(3) }),
  globals: PHONE,
  play: async (c) => {
    const { userEvent, step } = c;
    await step('You’re in the call on your phone. Board is in More: the board in this call is first. Tap it: faces stay on top, and the board fills the rest, on its first frame, where it can be read', async () => {
      await openTheCallsBoard(c, true);
      await board();
      await screen.findByText('Went well', {}, SOON);
    });
    await step('Drag to look round and pinch to zoom. To add something, tap +: one sticky, a colour, and a button that says where it’s going', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Add a sticky' }, SOON));
      await userEvent.type(await screen.findByPlaceholderText('Type your sticky', {}, SOON), 'Tag plans before launch');
    });
    await step('Tap Add to Went well: it’s on the board, in Went well, on nothing else', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Add to Went well' }, SOON));
      await screen.findByText('Tag plans before launch', {}, SOON);
    });
    await step('Ideas from the call are here too. Tap 3 ideas from the call, then Add on Priya’s: it’s on the board, in Could improve', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '3 ideas from the call' }, LATER));
      const [first] = await screen.findAllByRole('button', { name: 'Add' }, SOON);
      if (first) await userEvent.click(first);
      await screen.findByRole('button', { name: 'Added' }, SOON);
    });
    await step('Tap Add both: the other two land in Actions, and the toast’s Undo would take them back', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Add both' }, SOON));
      await screen.findByText('Added 2 stickies from the call.', {}, SOON);
    });
    await step('Timer and Vote are on the board’s bar on a phone too. Tap Timer, then Start: everyone sees it count down', async () => {
      // Timer's and Vote's menus keep the same rows while they're open, so they take a press as soon as it's there.
      await userEvent.click(await screen.findByRole('button', { name: 'Timer' }, SOON));
      await userEvent.click(await screen.findByRole('button', { name: 'Start' }, SOON));
      await screen.findByText('Add your stickies', {}, SOON);
    });
    await step('Tap Vote, then Start the vote. A tap on a sticky votes for it, and another takes it back', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Vote' }, SOON));
      await userEvent.click(await screen.findByRole('button', { name: 'Start the vote' }, SOON));
      await screen.findByText(/3 of 3 votes left/, {}, SOON);
      await userEvent.click(await screen.findByText('Tag plans before launch', {}, SOON));
      await screen.findByText(/2 of 3 votes left/, {}, SOON);
    });
  }
};

export const RenameItAndOpenItAgain: PageStory = {
  name: '6.22 Rename a board, then open it again',
  ...review({ board: undefined, then: () => { fillTemplate(boardDoc('ws-design', ONBOARDING), 'flow', null, ONBOARDING); } }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Press Board, then Onboarding flow, one of your team’s boards. It opens on your stage, just for you', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
      await pick(/^Onboarding flow/, c);
      await board('Onboarding flow');
    });
    await step('Press its name, on its bar, then Rename: the name becomes a field on the board’s own bar', async () => {
      await userEvent.click(nameOf(await board('Onboarding flow')));
      await userEvent.click(await settledRow('Onboarding flow', 'Rename'));
    });
    await step('Type its new name and press Enter: its frame says it at once, and so does everything else that names it', async () => {
      const field = await screen.findByRole('textbox', { name: 'The board’s name' }, SOON);
      await userEvent.clear(field);
      await userEvent.type(field, 'Onboarding, step by step{Enter}');
      await board('Onboarding, step by step');
    });
    await step('Close, on its bar: it closes, just for you', async () => {
      await userEvent.click(await within(await board('Onboarding, step by step')).findByRole('button', { name: 'Close Onboarding, step by step' }, SOON));
    });
    await step('Press Board again: your team’s boards have it under its new name. Press it: it opens again, and keeps it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
      await pick(/^Onboarding, step by step/, c);
      await board('Onboarding, step by step');
    });
  }
};
