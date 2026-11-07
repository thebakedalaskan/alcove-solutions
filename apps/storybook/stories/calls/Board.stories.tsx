/*
 * A board in the call (user-flows 6, A board in the call): Board's picker; the board in the call, opened by Priya and filled as
 * the design review talks, on your stage just for you from the picker's In this call, with its name's menu and its seal, and in a
 * light theme, light on the night stage; Priya presenting it, closed for you, its tile taking you back; Priya's shared screen
 * as a tile while Kofi presents it, Show beside and P; a board you can't open; closed for everyone; a share taking your stage
 * from it; how it stands when its connection drops (Reconnecting) and when Alcove won't take what you add (Couldn't save); its
 * timer, running and in its last minute; a vote, from a press or the keyboard, and its results; and the one pill, which shows the
 * most pressing thing. Everyone else's browser is the script's (stories/calls/boards.ts): who opens it, what they put on it,
 * where their pointer is, and how they vote.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at, clearsVote, closesBoard, endsVote, opensBoard, presentsBoard, shares, startsTimer, startsVote, type CallScript, type Cue, type Present } from '../../src/api/script';
import { inCall, light, phone, plays } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { RETRO, filledAfter, retroWith } from './boards';
import { LATER, SOON, boardPicker, close, frameMenu, frameOf, openCallBoard, settle, tileOf, toldThat, type Context, type Play } from './plays';
import { AIKO, CHECKLIST, KOFI, PRIYA, REVIEW, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/A board in the call', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/** The design review, talking it through with notes off, so the stage is the board's and the faces', and what happens on its board. */
const review = (cues: Cue[], board: CallScript['board'] = RETRO, more: Omit<PageStory, 'args'> = {}): PageStory =>
  inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off', talk: { lines: REVIEW_TALK, every: 6 }, board, cues } }, more);
/** A board made in the call is named after it. */
const BOARD = 'Design review';
/** One labelled step of a play. */
const step = (label: string, run: (c: Context) => Promise<unknown>): Play => async (c) => { await c.step(label, async () => { await run(c); }); };
/** Board, then the board in this call: on your stage, just for you. Nobody else's screen changes. */
const onTheBoard = step('Press Board, at the top right (in More on a phone), then the board in this call: it opens just for you', (c) => openCallBoard(c, BOARD));
/** A play that opens the board in the call first, then does the rest. */
const onIt = (...rest: Play[]): Omit<PageStory, 'args'> => ({ play: plays(onTheBoard, ...rest) });

/* ---------- on the stage ---------- */

/**
 * Board, at the top right, or O: the board in this call, with who brought it, a new board from a template, or one your team
 * already has, each with where it's from. Only you see what you open until you present it.
 */
export const TheBoardPicker = review(at(1, opensBoard(PRIYA, 'retro')), RETRO, {
  play: step('Press Board, at the top right', async (c) => { await within(await boardPicker(c)).findByRole('button', { name: /^Design review/ }, LATER); })
});
/** On a phone, Board is at the top of More, and the picker opens there. */
export const TheBoardPickerPhone = phone(TheBoardPicker);

/** Priya opens the launch retro a second in; In this call puts it on your stage, and everyone fills it as they talk: pointers with faces, stickies landing in each frame's colour. */
export const Open = review(at(1, opensBoard(PRIYA, 'retro')), RETRO, onIt());
export const OpenPhone = phone(Open);
/** In a light theme: the board follows yours, light on the stage, which is night as the call always is. */
export const OpenLight = light(Open);

/** Its name's menu, on its frame: Rename, Open where it's saved, Who can add to it, Copy link, Download as an image and Night board. */
export const TheNameMenu = review(at(1, opensBoard(PRIYA, 'retro')), retroWith(4), onIt(step('Press the board’s name, on its frame', (c) => frameMenu(c, BOARD))));
/** Its seal says what's true of this board: everyone in the call can add to it, where it's saved, and that Alcove can't read it. */
export const TheSeal = review(at(1, opensBoard(PRIYA, 'retro')), retroWith(4), onIt(step('Press Sealed, on the board’s bar', async (c) => {
  await c.userEvent.click(await screen.findByRole('button', { name: 'Sealed' }, LATER));
})));

/** Priya opens it and presents it: you follow her, and Close puts it away for you alone. While she presents it, its tile takes you back. */
export const ClosedForYou = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(2, presentsBoard(PRIYA))], retroWith(4), {
  play: plays(
    step('Priya presents the board: you follow her', () => frameOf(BOARD)),
    step('Press Close on its frame: it’s closed for you, a tile with the people while she presents it', async (c) => {
      await close(c, BOARD);
      await toldThat('Closed for you. While Priya presents, its tile takes you back.', SOON);
    })
  )
});
/** On a phone too: its tile is an arch among the arches, with the board's mark and Priya's face. */
export const ClosedForYouPhone = phone(ClosedForYou);

/**
 * Kofi presents the retro, and Priya shares her screen while you follow him: it comes in as a tile with the people, with Show it
 * on the toast. Show beside, from its options, puts her screen beside the board.
 */
const kofiPresents = (more: Omit<PageStory, 'args'> = {}) =>
  review([...at(1, opensBoard(KOFI, 'retro')), ...at(2, presentsBoard(KOFI)), ...at(7, shares(PRIYA, CHECKLIST))], retroWith(4), more);
const herScreen = 'Priya’s screen';
const herTile = step('Priya shares her screen while you follow Kofi: it’s a tile with the people', () => tileOf(herScreen));
export const ShowBeside = kofiPresents({
  play: plays(herTile, step('Hover her tile, press its options, then Show beside', async (c) => {
    await c.userEvent.hover(await tileOf(herScreen));
    await c.userEvent.click(await screen.findByRole('button', { name: `Options for ${herScreen}` }, SOON));
    const menu = await screen.findByRole('dialog', { name: `Options for ${herScreen}` }, SOON);
    await settle();
    await c.userEvent.click(within(menu).getByRole('button', { name: 'Show beside' }));
    await frameOf(herScreen);
  }))
});
/** On a phone there's no room for two: her screen waits as a tile, with Show it on the toast. */
export const AShareWhileKofiPresentsPhone = phone(kofiPresents({ play: herTile }));
/** From the keyboard: Tab to her screen's tile and press P, and it's on your stage, the board a tile in its place; Enter on that swaps back. */
export const ShowItFromTheKeyboard = kofiPresents({
  play: plays(
    step('Tab to Priya’s screen’s tile and press P: it’s on your stage, and the board waits as a tile', async (c) => {
      (await screen.findByRole('group', { name: /^Join Priya’s screen\./ }, LATER)).focus();
      await c.userEvent.keyboard('p');
      await tileOf(BOARD);
    }),
    step('Tab to the board’s tile and press Enter: you’re back on it, following Kofi', async (c) => {
      (await screen.findByRole('group', { name: /^Join Design review\./ }, SOON)).focus();
      await c.userEvent.keyboard('{Enter}');
      await frameOf(BOARD);
    })
  )
});

/**
 * You have the call's board open, and Priya brings in one from a workspace you're not in, without letting you in: your stage
 * keeps the call's board, and it says she brought it and nothing of its name, with a way to ask her.
 */
export const ABoardYouCantOpen: PageStory = {
  ...review([...at(1, opensBoard(PRIYA, 'retro')), ...at(12, opensBoard(PRIYA, 'retro', { closedToYou: true }))], retroWith(3),
    onIt(step('Priya brings in a board you can’t open', () => toldThat('A board you can’t open')))),
  name: 'A Board You Can’t Open'
};
export const ABoardYouCantOpenPhone = phone(ABoardYouCantOpen, 'A Board You Can’t Open Phone');

/** Priya closes it for everyone while it's on your stage: it sinks back through the arch, the faces come back, and one line says where it's saved. */
export const Closed = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(12, closesBoard())], retroWith(3), onIt(step('Priya closes it for everyone', () => toldThat(/^Design review is closed/))));
export const ClosedPhone = phone(Closed);

/**
 * Priya starts sharing while the board is open just for you: nobody presents the board, so her screen takes your stage, as a
 * presentation takes everyone's who isn't watching another. The board is still in the call: Board opens it again.
 */
export const AShareStartsOnTheBoard = review([...at(1, opensBoard(KOFI, 'retro')), ...at(10, shares(PRIYA, CHECKLIST))], retroWith(4),
  onIt(step('Priya shares her screen: it takes your stage', () => frameOf(herScreen))));
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
const reconnecting = (play?: Play) => review(at(1, opensBoard(PRIYA, 'retro', { standing: 'offline' })), QUIET, onIt(...(play ? [play] : [])));
export const Reconnecting: PageStory = reconnecting(async (c) => {
  await c.step('Double-click in Went well and type: you keep working, and it goes up when the connection comes back', async () => {
    await stickyIn(c, 'What should we keep doing?', 'Support ran launch day with no queue');
  });
  await c.step('Press Reconnecting, on the board’s bar: it says the same', async () => {
    await c.userEvent.click(await c.canvas.findByRole('button', { name: /Reconnecting/ }, SOON));
  });
});
export const ReconnectingPhone = phone(reconnecting());

/**
 * Alcove won't take what's added here: the seal says Not saved, and the pill says how many changes are only on this screen,
 * with Try again. It tries again on its own as well.
 */
const couldntSave = (play?: Play) => review(at(1, opensBoard(PRIYA, 'retro', { standing: 'failed' })), QUIET, onIt(...(play ? [play] : [])));
export const CouldntSave: PageStory = {
  ...couldntSave(async (c) => {
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
  }),
  name: 'Couldn’t Save'
};
export const CouldntSavePhone = phone(couldntSave(), 'Couldn’t Save Phone');

/* ---------- its timer and vote ---------- */

/** Priya starts a five-minute timer: one pill at the top of the board, the same for everyone, counting down. */
export const TimerRunning = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(3, startsTimer(PRIYA, 5))], retroWith(4), onIt());
export const TimerRunningPhone = phone(TimerRunning);
/** Its last minute: the pill turns amber, and the call chimes once, softly, at the end. */
export const TimerNearItsEnd = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(2, startsTimer(PRIYA, 5, 50))], retroWith(4), onIt());
export const TimerNearItsEndPhone = phone(TimerNearItsEnd);

/** Priya starts a vote on Could improve: each press on a sticky there spends one of your votes and shows a dot only you can see. Nobody sees a count. */
export const Voting = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, startsVote(PRIYA, 'Could improve', 3))], RETRO, onIt(async ({ canvas, userEvent, step }) => {
  await step('Press a sticky in Could improve: it spends one of your votes, with a dot only you can see', async () => {
    await canvas.findByText(/votes left/, {}, LATER);
    await userEvent.click(await canvas.findByText('Nobody owned the status page', {}, SOON));
  });
}));
/**
 * From the keyboard: Tab from the board to the first sticky in the vote and press Enter or Space to vote, and again to take the
 * vote back. A screen reader hears each as a toggle button, pressed once it has your vote, and the pill as your votes go.
 */
export const VotingFromTheKeyboard = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, startsVote(PRIYA, 'Could improve', 3))], RETRO, onIt(async ({ canvas, userEvent, step }) => {
  await step('Priya starts a vote on Could improve', async () => { await canvas.findByText('3 of 3 votes left', {}, LATER); });
  await step('Tab from the board to the vote’s first sticky and press Enter: one of your votes is on it', async () => {
    (await within(await frameOf(BOARD)).findByRole('application', {}, SOON)).focus();
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
}));
/** Priya ends it: every count appears at once, for everyone, the top three stay bright and the rest step back. */
export const Results = review([...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, startsVote(PRIYA, 'Could improve', 3)), ...at(1 + filledAfter() + 4, endsVote(RETRO.votes ?? {}, 3))], RETRO, onIt());
export const ResultsPhone = phone(Results);

/**
 * The pill shows one thing at a time, the most pressing: a timer runs, following Priya goes over it, her vote goes over that
 * and then its results, and as each goes, the one under it comes back.
 */
export const ThePillOrder = review([
  ...at(1, opensBoard(PRIYA, 'retro')), ...at(3, startsTimer(PRIYA, 10)),
  ...at(18, startsVote(PRIYA, 'Could improve', 3)), ...at(24, endsVote(RETRO.votes ?? {}, 3)), ...at(30, clearsVote())
], RETRO, onIt(async ({ canvas, userEvent, step }) => {
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
}));
