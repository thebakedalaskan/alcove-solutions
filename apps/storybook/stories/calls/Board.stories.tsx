/*
 * A board in the call (user-flows 6, A board in the call): the Board menu; the board on the stage, opened by Priya and filled
 * as the design review talks, with its name's menu and its seal, and in a light theme, light on the night stage; hidden for you
 * alone, a live tile among the faces; beside Priya's shared screen, swapped with it from the keyboard, and a share that starts
 * while you're on it; a board you can't open; closed for everyone; how it stands when its connection drops (Reconnecting) and
 * when Alcove won't take what you add (Couldn't save); its timer, running and in its last minute; a vote, from a press or the
 * keyboard, and its results; and the one pill, which shows the most pressing thing. Everyone else's browser is the script's
 * (stories/calls/boards.ts): who opens it, what they put on it, where their pointer is, and how they vote.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, clearsVote, closesBoard, endsVote, opensBoard, shares, startsTimer, startsVote, type CallScript, type Cue, type Present } from '../../src/api/script';
import { MORE, inCall, light, phone } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { RETRO, filledAfter, retroWith } from './boards';
import { AIKO, CHECKLIST, KOFI, PRIYA, REVIEW, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/A board in the call', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
const SOON = { timeout: 10000 };
/** Long enough for the script to get there: a board opening, filling, a vote ending. */
const LATER = { timeout: 40000 };
const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/** The design review, talking it through with notes off, so the stage is the board's and the faces', and what happens on its board. */
const review = (cues: Cue[], board: CallScript['board'] = RETRO, more: Omit<PageStory, 'args'> = {}): PageStory =>
  inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off', talk: { lines: REVIEW_TALK, every: 6 }, board, cues } }, more);

/* ---------- on the stage ---------- */

/** The Board menu, from Board at the top right or O: a new board from a template, or one your team already has, with where it's from. */
export const TheBoardMenu = review([], RETRO, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Board, at the top right', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Board' }, LATER));
    });
  }
});
/** On a phone, Board is at the top of More, and shows the same menu there. */
export const TheBoardMenuPhone: PageStory = {
  ...phone(TheBoardMenu),
  play: (async ({ userEvent, step }) => {
    await step('Press More, then Board', async () => {
      await userEvent.click(await screen.findByRole('button', { name: MORE }, LATER));
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, SOON));
    });
  }) satisfies Play
};

/** Priya opens the launch retro a second in, and everyone fills it as they talk: pointers with faces, stickies landing in each frame's colour. */
export const Open = review(at(1, opensBoard(PRIYA, 'retro')));
export const OpenPhone = phone(Open);
/** In a light theme: the board follows yours, light on the stage, which is night as the call always is. */
export const OpenLight = light(Open);

/** Its name's menu: Rename, where it's saved, Who can add to it, and, for whoever opened it or you, the organizer, Close for everyone. */
export const TheNameMenu = review(at(1, opensBoard(PRIYA, 'retro')), retroWith(4), {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press the board’s name', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Design review' }, LATER));
    });
  }
});
/** Its seal says what's true of this board: everyone in the call can add to it, where it's saved, and that Alcove can't read it. */
export const TheSeal = review(at(1, opensBoard(PRIYA, 'retro')), retroWith(4), {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Sealed, beside the name', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Sealed' }, LATER));
    });
  }
});

/** Hidden for you alone: Board at the top right, lit while the board's on your stage, drops it to a live tile among the faces. Nobody else's view changes. */
export const HiddenForYou = review(at(1, opensBoard(PRIYA, 'retro')), retroWith(4), {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Board, at the top right: the board drops to a live tile among the faces, for you alone', async () => {
      await canvas.findByRole('button', { name: 'Design review' }, LATER);
      await userEvent.click(await canvas.findByRole('button', { name: 'Board', pressed: true }, LATER));
    });
  }
});
/** On a phone, Board is at the top of More. */
export const HiddenForYouPhone: PageStory = {
  ...phone(HiddenForYou),
  play: (async ({ userEvent, step }) => {
    await step('Press More, then Board: it drops to a live tile, for you alone', async () => {
      await screen.findByRole('button', { name: 'Design review' }, LATER);
      // The dock's More, not the board's own beside its tools.
      await userEvent.click(await screen.findByRole('button', { name: MORE }, LATER));
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, SOON));
    });
  }) satisfies Play
};

/** Beside a shared screen: Kofi opens it while Priya shares, so the board takes the main space and her screen moves to the top of the column, live. */
export const BesideAShare = review([...at(1, shares(PRIYA, CHECKLIST)), ...at(3, opensBoard(KOFI, 'retro'))], retroWith(4));
export const BesideASharePhone = phone(BesideAShare);
/** From the keyboard: Tab to Priya's screen beside the board and press P (or Make it big in its menu), and her screen goes big, as a press does. */
export const BesideAShareFromTheKeyboard: PageStory = {
  ...BesideAShare,
  play: (async ({ canvas, userEvent, step }) => {
    await step('Tab to Priya’s screen, beside the board, and press P: it goes big, and the board drops to a live tile above the faces', async () => {
      (await canvas.findByRole('group', { name: /beside the board, P makes it big/ }, LATER)).focus();
      await userEvent.keyboard('p');
      await canvas.findByRole('button', { name: 'Go back to the board' }, SOON);
    });
    await step('Tab to the board’s tile and press Enter: it swaps back, with the keys on the board', async () => {
      (await canvas.findByRole('button', { name: 'Go back to the board' }, SOON)).focus();
      await userEvent.keyboard('{Enter}');
    });
  }) satisfies Play
};

/** Priya opens a board from a workspace you're not in, without letting you in: you're told she brought it, and nothing of its name. */
export const ABoardYouCantOpen: PageStory = { ...review(at(1, opensBoard(PRIYA, 'retro', { closedToYou: true }))), name: 'A Board You Can’t Open' };
export const ABoardYouCantOpenPhone = phone(ABoardYouCantOpen, 'A Board You Can’t Open Phone');

/** Priya closes it for everyone: it sinks back through the arch, the faces come back, and one line says where it's saved. */
export const Closed = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter(3) + 3, closesBoard())], retroWith(3));
export const ClosedPhone = phone(Closed);

/** Kofi opens the retro, and Priya starts sharing while you're on it: it comes in beside the board, at the top of the column, and nothing you're doing stops. */
export const AShareStartsOnTheBoard = review([...at(1, opensBoard(KOFI, 'retro')), ...at(6, shares(PRIYA, CHECKLIST))], retroWith(4));
/** On a phone the board and her screen take turns, and the bar at the top says which is showing. */
export const AShareStartsOnTheBoardPhone = phone(AShareStartsOnTheBoard);

/* ---------- how it stands ---------- */

/** A sticky in one of the retro's frames, found by the hint it shows while it's empty: a double-click there, what you type, and Esc. */
async function stickyIn({ userEvent }: Parameters<Play>[0], hint: string, text: string): Promise<void> {
  const where = await screen.findByText(hint, {}, LATER);
  const sheet = where.closest('.bd');
  const at = where.getBoundingClientRect();
  if (sheet) await userEvent.pointer({ keys: '[MouseLeft][MouseLeft]', target: sheet, coords: { clientX: at.x + at.width / 2, clientY: at.y + at.height / 2 } });
  await userEvent.keyboard(text);
  await userEvent.keyboard('{Escape}');
}
const pause = (ms: number) => new Promise((done) => { setTimeout(done, ms); });
/** Nobody else adds to it meanwhile, so what's only on your screen is yours. */
const QUIET: CallScript['board'] = {};

/** The board's connection drops while the call carries on: the seal says Reconnecting, and so does the pill. You keep working. */
const reconnecting = review(at(1, opensBoard(PRIYA, 'retro', { standing: 'offline' })), QUIET);
export const Reconnecting: PageStory = {
  ...reconnecting,
  play: (async (c) => {
    await c.step('Double-click in Went well and type: you keep working, and it goes up when the connection comes back', async () => {
      await stickyIn(c, 'What should we keep doing?', 'Support ran launch day with no queue');
    });
    await c.step('Press Reconnecting, beside the name: it says the same', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: /Reconnecting/ }, SOON));
    });
  }) satisfies Play
};
export const ReconnectingPhone = phone(reconnecting);

/**
 * Alcove won't take what's added here: the seal says Not saved, and the pill says how many changes are only on this screen,
 * with Try again. It tries again on its own as well.
 */
const couldntSave = review(at(1, opensBoard(PRIYA, 'retro', { standing: 'failed' })), QUIET);
export const CouldntSave: PageStory = {
  ...couldntSave,
  name: 'Couldn’t Save',
  play: (async (c) => {
    await c.step('Add a sticky to each frame: each is a change only this screen has', async () => {
      await stickyIn(c, 'What should we keep doing?', 'Beta sign-ups beat the plan');
      await pause(1200);
      await stickyIn(c, 'What got in the way?', 'Nobody owned the status page');
      await pause(1200);
      await stickyIn(c, 'Who does what next?', 'One owner for launch comms');
    });
    await c.step('The pill says your last 3 changes are only here, with Try again', async () => {
      await c.canvas.findByText('Your last 3 changes are only here.', {}, SOON);
    });
  }) satisfies Play
};
export const CouldntSavePhone = phone(couldntSave, 'Couldn’t Save Phone');

/* ---------- its timer and vote ---------- */

/** Priya starts a five-minute timer: one pill at the top of the board, the same for everyone, counting down. */
export const TimerRunning = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(3, startsTimer(PRIYA, 5))], retroWith(4));
export const TimerRunningPhone = phone(TimerRunning);
/** Its last minute: the pill turns amber, and the call chimes once, softly, at the end. */
export const TimerNearItsEnd = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(2, startsTimer(PRIYA, 5, 50))], retroWith(4));
export const TimerNearItsEndPhone = phone(TimerNearItsEnd);

/** Priya starts a vote on Could improve: each press on a sticky there spends one of your votes and shows a dot only you can see. Nobody sees a count. */
export const Voting = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, startsVote(PRIYA, 'Could improve', 3))], RETRO, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press a sticky in Could improve: it spends one of your votes, with a dot only you can see', async () => {
      await canvas.findByText(/votes left/, {}, LATER);
      await userEvent.click(await canvas.findByText('Nobody owned the status page', {}, SOON));
    });
  }
});
/**
 * From the keyboard: Tab from the board to the first sticky in the vote and press Enter or Space to vote, and again to take the
 * vote back. A screen reader hears each as a toggle button, pressed once it has your vote, and the pill as your votes go.
 */
export const VotingFromTheKeyboard = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, startsVote(PRIYA, 'Could improve', 3))], RETRO, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Priya starts a vote on Could improve', async () => { await canvas.findByText('3 of 3 votes left', {}, LATER); });
    await step('Tab from the board to the vote’s first sticky and press Enter: one of your votes is on it', async () => {
      (await canvas.findByRole('application', { name: 'Design review' }, SOON)).focus();
      await userEvent.keyboard('{Tab}{Enter}');
      await canvas.findByText('2 of 3 votes left', {}, SOON);
    });
    await step('Tab to the next and press Space: another', async () => {
      await userEvent.keyboard('{Tab} ');
      await canvas.findByText('1 of 3 votes left', {}, SOON);
    });
    await step('Shift and Tab back, and Enter takes that vote back', async () => {
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Enter}');
      await canvas.findByText('2 of 3 votes left', {}, SOON);
    });
  }
});
/** Priya ends it: every count appears at once, for everyone, the top three stay bright and the rest step back. */
export const Results = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, startsVote(PRIYA, 'Could improve', 3)), ...at(1 + filledAfter() + 4, endsVote(RETRO.votes ?? {}, 3))]);
export const ResultsPhone = phone(Results);

/**
 * The pill shows one thing at a time, the most pressing: a timer runs, following Priya goes over it, her vote goes over that
 * and then its results, and as each goes, the one under it comes back.
 */
export const ThePillOrder = review([
  ...at(1, opensBoard(PRIYA, 'retro')), ...at(3, startsTimer(PRIYA, 10)),
  ...at(18, startsVote(PRIYA, 'Could improve', 3)), ...at(24, endsVote(RETRO.votes ?? {}, 3)), ...at(30, clearsVote())
], RETRO, {
  play: async ({ canvas, userEvent, step }) => {
    await step('A timer runs: the pill shows it', async () => {
      await canvas.findByText('Add your stickies', {}, LATER);
    });
    await step('Press Priya’s tile, then Follow Priya: following goes over the timer', async () => {
      await userEvent.click(await canvas.findByRole('group', { name: /^Priya/ }, SOON));
      await userEvent.click(await screen.findByRole('button', { name: 'Follow Priya' }, SOON));
      await canvas.findByText('Following Priya', {}, SOON);
    });
    await step('Priya starts a vote: the vote goes over following', async () => {
      await canvas.findByText('Voting', {}, LATER);
    });
    await step('She ends it: its results go over following', async () => {
      await canvas.findByText('Results', {}, LATER);
    });
    await step('She’s done with them: following comes back. Stop, and the timer is what’s left', async () => {
      await canvas.findByText('Following Priya', {}, LATER);
      await userEvent.click(await canvas.findByRole('button', { name: 'Stop' }, SOON));
      await canvas.findByText('Add your stickies', {}, SOON);
    });
  }
});
