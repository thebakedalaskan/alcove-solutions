/*
 * Journeys through a board in the call: user-flows 6, A board in the call, each named with its steps' numbers there, in the
 * whiteboards canvas's words. Start a board, someone else starting one, a saved board some people here can't open, working on
 * it together, beside a shared screen, closing it, its timer and votes, how the call helps: ideas from what's said, and Sort
 * into themes, and all of it on a phone. You're Art, the organizer, in the design review with Priya, Kofi and Aiko, who fill the
 * board as they talk (stories/calls/boards.ts); their side is the script's.
 */
import { fillTemplate } from '@alcove/board';
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { itemId } from '../../src/api/scenarios';
import { at, opensBoard, shares, type CallScript, type Cue, type Present } from '../../src/api/script';
import { boardDoc } from '../../src/api/workspaces';
import { inCall } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { drawIdeas } from '../../src/world/boards';
import { HEARD, RETRO, filledAfter, retroWith } from '../calls/boards';
import { AIKO, CHECKLIST, KOFI, PRIYA, REVIEW, REVIEW_TALK, SAM } from '../calls/talk';
import { LAPTOP, LATER, SOON, pause } from './play';

const meta = { title: 'Journeys/6 A board in the call', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/** The design review, talking it through with notes off, and the launch retro's work for whatever board opens, unless it says otherwise. */
const review = (o: { cues?: Cue[]; here?: Present[]; board?: CallScript['board']; notes?: 'on' | 'off'; then?: () => void } = {}): PageStory => {
  const script: CallScript = { here: o.here ?? REVIEWERS, notes: o.notes ?? 'off', talk: { lines: REVIEW_TALK, every: 6 }, board: 'board' in o ? o.board : RETRO, cues: o.cues ?? [] };
  return inCall({ scenario: 'call-soon', call: REVIEW, script, ...(o.then ? { then: o.then } : {}) }, { globals: LAPTOP });
};
/** The board's name in its bar: the call's, as a new board is named. */
const boardName = () => screen.findByRole('button', { name: 'Design review' }, LATER);
/** Opens the Board menu from Board at the top right and starts a new board from `template`. */
async function startFrom(template: 'Blank' | 'Retro' | 'Ideas' | 'Flow', { userEvent }: Parameters<NonNullable<PageStory['play']>>[0]): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
  await userEvent.click(await screen.findByRole('button', { name: template }, SOON));
}

export const StartABoard: PageStory = {
  name: '1–2 Start a board',
  ...review(),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Board sits at the top right, beside Workspace. Press it, or O', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
    });
    await step('A small menu rises from it. Blank is one click; boards your team already has are underneath. Press Retro', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Retro' }, SOON));
    });
    await step('It opens for everyone, and the call carries on: the sheet rises through an arch, and people glide to a strip beside it', async () => {
      await boardName();
    });
    await step('Double-click in Went well: a sticky in that frame’s colour, ready to type', async () => {
      // A frame takes no presses itself: a double-click there lands on the sheet under it, where Went well's hint is.
      const hint = await screen.findByText('What should we keep doing?', {}, SOON);
      const sheet = hint.closest('.bd');
      const at = hint.getBoundingClientRect();
      if (sheet) await userEvent.pointer({ keys: '[MouseLeft][MouseLeft]', target: sheet, coords: { clientX: at.x + at.width / 2, clientY: at.y + at.height / 2 } });
      await userEvent.keyboard('Pricing page shipped a week early');
    });
    await step('Esc when you’re done. Everyone writes at once, each pointer with a face and a name', async () => {
      await userEvent.keyboard('{Escape}');
      await screen.findByText('Changelog went out after the launch post', {}, LATER);
    });
  }
};

export const SomeoneElseStartsIt: PageStory = {
  name: '2, 5 When someone else starts it',
  ...review({ cues: at(4, opensBoard(PRIYA, 'retro')) }),
  play: async ({ userEvent, step }) => {
    await step('You’re listening to Priya. She opens the launch retro: it rises on your stage too, with one line to say what it is', async () => {
      await boardName();
    });
    await step('Press Board, at the top right: only your view changes. The board drops to a live tile, and the faces get big again', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Board', pressed: true }, SOON));
    });
    await step('Press the tile: you’re back on the board, where everyone has been working', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Open the board' }, SOON));
      await boardName();
    });
  }
};

/** The onboarding flow, in Design, drawn as the Flow template draws it: what the saved board has on it. */
const ONBOARDING = itemId('Onboarding flow');
export const OpenASavedBoard: PageStory = {
  name: '3 Open a saved board',
  ...review({ here: [...REVIEWERS, { who: SAM, guest: true }], board: undefined, then: () => { fillTemplate(boardDoc('ws-design', ONBOARDING), 'flow', null, ONBOARDING); } }),
  play: async ({ userEvent, step }) => {
    await step('Press Board: boards your team already has are under the templates, with where they’re from', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
    });
    await step('Press Onboarding flow. Sam came in with the link and can’t open it: you decide, in the same menu, before anything opens', async () => {
      const row = await screen.findByRole('button', { name: /^Onboarding flow/ }, LATER);
      // The saved boards come in a moment after the menu opens, and it takes no press until they're still: a person's comes later anyway.
      await pause(500);
      await userEvent.click(row);
    });
    await step('Let them in for this call: everyone can work on it until the call ends, and after that, Sam can’t again', async () => {
      const letIn = await screen.findByRole('button', { name: 'Let them in for this call' }, SOON);
      await pause(500);
      await userEvent.click(letIn);
      await screen.findByRole('button', { name: 'Onboarding flow' }, LATER);
    });
  }
};

export const WorkOnItTogether: PageStory = {
  name: '4 Work on it together',
  ...review({ cues: at(1, opensBoard(PRIYA, 'retro')) }),
  play: async ({ userEvent, step }) => {
    await step('The board is open. Whoever’s talking glows, on their tile and their pointer', async () => {
      await boardName();
      await screen.findByText('Refresh staging every night', {}, LATER);
    });
    await step('Press Priya’s tile: Go to Priya takes you to where she is, and Follow Priya keeps you with her', async () => {
      await userEvent.click(await screen.findByRole('group', { name: /^Priya/ }, SOON));
    });
    await step('Follow Priya: a ring in her colour says this view isn’t yours, and a pill at the top of the board says whose it is', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Follow Priya' }, SOON));
      await screen.findByText('Following Priya', {}, SOON);
    });
    await step('Stop: you’re back where you were', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Stop' }, SOON));
    });
  }
};

export const BesideASharedScreen: PageStory = {
  name: '6 Beside a shared screen',
  ...review({ cues: at(1, shares(PRIYA, CHECKLIST)) }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Priya is sharing: her screen big, and everyone beside it', async () => {
      await screen.findByRole('group', { name: /^Priya is sharing/ }, LATER);
    });
    await step('Press Board, then Retro: the board takes the main space, and Priya’s screen moves to the top of the column, still live', async () => {
      await startFrom('Retro', c);
      await boardName();
    });
    await step('Press ⋯ on Priya’s screen: its menu has one more thing, Put on the board', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Options for Priya’s screen/ }, SOON));
    });
    await step('Put on the board: a picture of this moment lands on the board with its time, and Priya is told', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Put on the board' }, SOON));
      await screen.findByText(/A picture of Priya’s screen is on the board/, {}, SOON);
    });
    await step('Press Priya’s screen: it goes big, and the board drops to a live tile above the faces', async () => {
      await userEvent.click(await screen.findByRole('group', { name: /^Priya is sharing/ }, SOON));
    });
    await step('Press the board: you’re back on it, with Priya’s screen beside it again', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Go back to the board' }, SOON));
    });
  }
};

export const CloseIt: PageStory = {
  name: '7 Close it',
  ...review({ cues: at(1, opensBoard(PRIYA, 'retro')) }),
  play: async ({ userEvent, step }) => {
    await step('You’re done with the board. Everything about the board itself is under its name', async () => {
      await screen.findByText('Refresh staging every night', {}, LATER);
      await userEvent.click(await boardName());
    });
    await step('Close for everyone: for whoever opened it, or you, the organizer', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Close for everyone' }, SOON));
    });
    await step('The sheet sinks back through the arch, the faces come back, and one line says where the board went', async () => {
      await screen.findByText(/Design review is closed\./, {}, SOON);
    });
  }
};

export const TimerAndVotes: PageStory = {
  name: '8 Timer and votes',
  ...review({ cues: at(1, opensBoard(PRIYA, 'retro')) }),
  play: async ({ userEvent, step }) => {
    await step('You want five quiet minutes. Timer, on the board’s bar: three lengths and Start, and no form', async () => {
      await screen.findByText('Refresh staging every night', {}, LATER);
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
  name: '9 Ideas from the call',
  ...review({ notes: 'on', cues: [...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, HEARD)] }),
  play: async ({ userEvent, step }) => {
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
  name: '10 Sort into themes',
  ...review({ board: undefined, cues: at(1, opensBoard(PRIYA, 'blank', { draw: drawIdeas })) }),
  play: async ({ userEvent, step }) => {
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
  name: '14 On a phone',
  ...review({ notes: 'on', cues: [...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter(3) + 1, HEARD)], board: retroWith(3) }),
  globals: PHONE,
  play: async ({ userEvent, step }) => {
    await step('You’re in the call on your phone. Priya opens the launch retro: faces stay on top, and the board fills the rest, on its first frame, where it can be read', async () => {
      await boardName();
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
      await userEvent.click(await screen.findByRole('button', { name: 'Timer' }, SOON));
      await pause(400);
      await userEvent.click(await screen.findByRole('button', { name: 'Start' }, SOON));
      await screen.findByText('Add your stickies', {}, SOON);
    });
    await step('Tap Vote, then Start the vote. A tap on a sticky votes for it, and another takes it back', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Vote' }, SOON));
      await pause(400);
      await userEvent.click(await screen.findByRole('button', { name: 'Start the vote' }, SOON));
      await screen.findByText(/3 of 3 votes left/, {}, SOON);
      await userEvent.click(await screen.findByText('Tag plans before launch', {}, SOON));
      await screen.findByText(/2 of 3 votes left/, {}, SOON);
    });
  }
};
