/*
 * The call, rethought (docs/design/canvas/call/, nc.js): every moment its seven journeys show, each reached as a person would
 * reach it. Board and Workspace at the top right open on your stage just for you; Present, on what you have open, or Share in
 * the dock brings everyone with you; everyone follows whoever presents, and on a board or in the workspace they can unfollow;
 * something presented that isn't on your stage is a tile with the people, only while it's presented; and Close is for you,
 * asking for you or for everyone while you present. Then the review's three hard cases: a presentation that starts while
 * you're typing, two things presented at once, and a guest.
 *
 * You're Art in the launch review, a little way in, with Priya, Kofi and Aiko: the notes are written, two messages wait in
 * Chat, and everyone else is in Launch plan. In your own launch review you're the organizer; in Priya's you aren't. Both are
 * held in Product, so its documents and its launch retro are there. Everyone else's browser is the script's.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at, chats, line, presentsBoard, presentsWorkspace, shares, stopsPresenting, type CallScript, type Cue, type Line, type Present } from '../../src/api/script';
import { inCall, light, phone, plays, reach, type InCall, type StoryCall } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { iso } from '../../src/world/clock';
import { RETRO } from './boards';
import {
  LATER, SOON, boardPicker, close, closeFor, frameMenu, frameOf, onTheBar, pickBoard, present, settle, shareATab, shareKind, shareMenu, sideAway, startingWith,
  tileOf, toldThat, toldThenGone, type Context, type Play
} from './plays';
import { AIKO, ART, CHECKLIST, EMPTY_STATES, KOFI, LAUNCH_REVIEW, PLAN, PRIYA } from './talk';

const meta = { title: 'Calls/The call, rethought', ...pages } satisfies Meta<PageArgs>;
export default meta;

/* ---------- the launch review, as the canvas has it ---------- */

/** What's said in the launch review, as the canvas has it: the first three before you look, the rest as the story plays. */
const SAID: readonly Line[] = [
  line(PRIYA, 'Sign-ups are back up since the pricing change.', { decides: 'The launch holds for Wednesday 18 November.' }),
  line(KOFI, 'Then the date holds. I can take the status page.', { hands: { text: 'Own the status page from now on', due: 'Friday' } }),
  line(AIKO, 'I’ll move the empty arch into the kit by Thursday.', { hands: { text: 'Move the empty arch into the kit', due: 'Thursday' } }),
  line('me', 'Good. And the changelog goes out before the post this time.'),
  line(PRIYA, 'The pricing page copy is the last thing on my list.'),
  line(KOFI, 'The status page goes up on Monday, before the post.'),
  line(PRIYA, 'Then let’s go through the plan together.')
];
const SUMMARY = 'The launch holds for 18 November: sign-ups are back up since the pricing change. Nobody owned the status page last time, so Kofi takes it, and the changelog goes out before the post from now on.';
/** Two messages in Chat you haven't read. */
const CHAT: Cue[] = [...at(1, chats(KOFI, 'Link to the checklist?')), ...at(1.5, chats(PRIYA, 'It’s in the workspace, under Documents.'))];

/** Priya's launch review: the same, but she organizes it. */
const PRIYAS: StoryCall = { ...LAUNCH_REVIEW, id: 'm-launch-review-priya', code: 'lch-revw-pry', organizer: PRIYA, guests: [ART, KOFI, AIKO], status: 'live' };

/** The launch review a little way in, yours or Priya's, with whatever else the story's script says happens. */
function review(call: StoryCall, here: readonly Present[], script: CallScript): InCall {
  return {
    scenario: 'busy', call,
    script: {
      here, since: 100, earlier: SAID.slice(0, 3), talk: { lines: SAID.slice(3), from: 3, every: 7 }, summary: SUMMARY,
      workspace: { where: [{ who: PRIYA, document: PLAN }, { who: KOFI, document: PLAN }, { who: AIKO, document: PLAN }] },
      ...script, cues: [...CHAT, ...(script.cues ?? [])]
    }
  };
}
/** Your launch review: you organize it. */
const yours = (script: CallScript = {}): InCall => review(LAUNCH_REVIEW, [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], script);
/** Priya's launch review: she organizes it. */
const hers = (script: CallScript = {}): InCall => review(PRIYAS, [{ who: PRIYA, organizer: true }, { who: KOFI }, { who: AIKO }], script);

/** A moment of the canvas: the call, your side put away as the canvas has it, and what a person does to get there. */
const moment = (call: InCall, ...steps: Play[]): PageStory => inCall(call, { play: plays(sideAway, ...steps) });
/** At a phone's size. */
const PHONE = { theme: 'dark', viewport: { value: 'phone', isRotated: false } };
/** One labelled step of a play. */
const step = (label: string, run: (c: Context) => Promise<unknown>): Play => async (c) => { await c.step(label, async () => { await run(c); }); };

/** The workspace is Product, where the launch review is kept: its frame is named for it. */
const WS = 'Product';
/** Priya presents seven seconds in, once you've settled into the call, so you're told. */
const PRIYA_PRESENTS = 7;

/* ---------- 4 Share your screen ---------- */

const openShare = step('Press Share in the dock: a menu above it offers your screen, a board or the workspace', shareMenu);
const shareTab = step('Press Share, Your screen, A tab, then Share: the browser’s made-up screen goes out', shareATab);
const seesYourTab = step('Everyone sees your tab', () => toldThat('Everyone sees your tab.'));

/** Share, in the dock: your screen, a board or the workspace, presented to everyone straight away. */
export const ShareInTheDock: PageStory = { ...moment(yours(), openShare), name: 'Share in the dock' };
/** On a phone it's a sheet, and your screen needs a computer. */
export const ShareInTheDockPhone: PageStory = { ...phone(ShareInTheDock), name: 'Share in the dock, on a phone' };
/** Share › Your screen: a tab, a window or your whole screen, in the same menu, then Share. The browser asks which one after. */
export const ShareYourScreen: PageStory = {
  ...moment(yours(), step('Press Share in the dock, then Your screen', (c) => shareKind(c, 'Your screen'))), name: 'Share › Your screen'
};
/** Share › A board: the board picker as Share's next step, presenting what you pick straight away. */
export const ShareABoard: PageStory = { ...moment(yours(), step('Press Share in the dock, then A board', (c) => shareKind(c, 'A board'))), name: 'Share › A board' };
/** Your screen, presented: everyone sees your tab, your bar has Stop sharing, and Share in the dock says Presenting. */
export const YourScreenPresented: PageStory = { ...moment(yours(), shareTab, seesYourTab), name: 'Your screen, presented' };
/** Stop sharing, on your bar: it stops for everyone, and the people take the stage back. */
export const YouStopSharing: PageStory = {
  ...moment(yours(), shareTab, seesYourTab,
    step('Press Stop sharing on your screen’s bar: it stops for everyone', async (c) => { await onTheBar(c, 'Your screen', 'Stop sharing'); await toldThat('You stopped sharing.', SOON); })),
  name: 'You stop sharing'
};

/* ---------- 1 Open the workspace, then present it ---------- */

const openWorkspace = reach('Workspace');
/** Launch plan, from the workspace's list: you work on your own there. */
const toThePlan = step('Press Launch plan in its list', async (c) => {
  const [row] = await within(await frameOf(WS)).findAllByRole('button', { name: /^Launch plan/ }, LATER);
  if (row) await c.userEvent.click(row);
});
const presentWorkspace = step('Press Present on its bar: everyone follows you', (c) => present(c, WS));
const wsOn = 'Everyone follows you in the workspace. They can unfollow to work alongside you.';
const followsYou = step('Everyone follows you', () => toldThat(wsOn));

/** Workspace, at the top right: it opens on your stage just for you, and nobody else's screen changes. */
export const WorkspaceOpenJustForYou: PageStory = { ...moment(yours(), openWorkspace, step('It’s open just for you', () => frameOf(WS))), name: 'Workspace open just for you' };
/** On a phone, Workspace is at the top of More, and it opens under the faces. */
export const WorkspaceOpenJustForYouPhone: PageStory = { ...phone(WorkspaceOpenJustForYou), name: 'Workspace open just for you, on a phone' };
/** Launch plan, on your own: Present, on the workspace's bar, brings everyone here. */
export const WorkspaceOnLaunchPlan: PageStory = { ...moment(yours(), openWorkspace, toThePlan), name: 'Workspace open on Launch plan' };
/** Present: everyone follows you, live, and anyone can unfollow to write alongside you. */
export const YouPresentTheWorkspace: PageStory = { ...moment(yours(), openWorkspace, toThePlan, presentWorkspace, followsYou), name: 'You present the workspace' };
/** On a phone, Present is on its bar too. */
export const YouPresentTheWorkspacePhone: PageStory = {
  ...moment(yours(), openWorkspace, presentWorkspace, followsYou), name: 'You present the workspace, on a phone', globals: PHONE
};
/** A moment later, the toast has gone: your bar says how many follow you. */
export const YouPresentTheWorkspaceLater: PageStory = {
  ...moment(yours(), openWorkspace, toThePlan, presentWorkspace, step('The toast goes after a moment', () => toldThenGone(wsOn))),
  name: 'You present the workspace, a moment later'
};
/** Close, while you present: just for you, or for everyone. */
export const CloseWhileYouPresentTheWorkspace: PageStory = {
  ...moment(yours(), openWorkspace, toThePlan, presentWorkspace, step('Press Close on its bar: it asks', (c) => close(c, WS))),
  name: 'Close, while you present the workspace'
};
/** On a phone, Close's question is a sheet. */
export const CloseWhileYouPresentTheWorkspacePhone: PageStory = {
  ...moment(yours(), openWorkspace, presentWorkspace, step('Press Close on its bar: it asks, in a sheet', (c) => close(c, WS))),
  name: 'Close, while you present the workspace, on a phone', globals: PHONE
};
/** For everyone: it closes for everyone and leaves nothing on the stage. Workspace opens it again. */
export const WorkspaceClosedForEveryone: PageStory = {
  ...moment(yours(), openWorkspace, toThePlan, presentWorkspace,
    step('Press Close, then For everyone', async (c) => { await close(c, WS); await closeFor(c, WS, 'For everyone'); }),
    step('It closes for everyone', () => toldThat('Closed for everyone.'))),
  name: 'Workspace closed for everyone'
};
/** Open, at the top of Notes: the workspace opens on these notes, just for you, as Workspace at the top right would. */
export const WorkspaceFromNotes: PageStory = {
  ...inCall(yours(), {
    play: plays(reach('Notes'), step('Press Open, at the top of Notes: the workspace opens on these notes', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Open the workspace on these notes' }, SOON));
      await frameOf(WS);
    }))
  }),
  name: 'Workspace, from Notes'
};

/* ---------- 2 Open a board, then present it ---------- */

const retro = 'Launch retro';
const openRetro = step('Press Board, then Launch retro, from your team’s boards: it opens just for you', async (c) => { await pickBoard(c, retro); await frameOf(retro); });
const presentRetro = step('Press Present on its bar: everyone follows you, and its foot steps through its frames', (c) => present(c, retro));
const boardOn = `Everyone follows you on ${retro}. They can unfollow to add to it.`;
const presented = [openRetro, presentRetro, step('Everyone follows you', () => toldThat(boardOn))];
const nextFrame = step('Press Next frame, at its foot: everyone following you moves with you', async (c) => {
  await c.userEvent.click(await screen.findByRole('button', { name: 'Next frame' }, LATER));
  await screen.findByText('2 of 3', {}, SOON);
});

/** Board, at the top right: a new board, or one your team has. Only you see it until you present it. */
export const TheBoardPicker: PageStory = { ...moment(yours(), step('Press Board, at the top right', boardPicker)), name: 'The board picker' };
/** Launch retro, from your team's boards: open just for you, to look round and add to on your own. */
export const ABoardOpenJustForYou: PageStory = { ...moment(yours(), openRetro), name: 'A board open just for you' };
/** Present: everyone follows you, and the arrows at its foot step through its frames. */
export const YouPresentABoard: PageStory = { ...moment(yours(), ...presented), name: 'You present a board' };
/** A moment later: 1 of 3, Went well, at its foot. */
export const YouPresentABoardLater: PageStory = {
  ...moment(yours(), openRetro, presentRetro, step('The toast goes after a moment', () => toldThenGone(boardOn))), name: 'You present a board, a moment later'
};
/** On a phone a board has no Present, so it's presented from Share › A board, straight away. */
export const YouPresentABoardPhone: PageStory = {
  ...inCall(yours(), {
    play: plays(
      step('Press Share, then A board, then Launch retro: everyone follows you', async (c) => {
        const menu = await shareKind(c, 'A board');
        const row = await within(menu).findByRole('button', { name: startingWith(retro) }, LATER);
        await settle();
        await c.userEvent.click(row);
      }),
      step('The toast goes after a moment', () => toldThenGone(boardOn))
    )
  }),
  name: 'You present a board, on a phone', globals: PHONE
};
/** Next frame: everyone following you moves with you, to Could improve. */
export const TheNextFrame: PageStory = { ...moment(yours(), ...presented, nextFrame), name: 'The next frame' };
/** Your notes, at its foot: the few words you keep for each frame, in your side, for you alone, with the next frame under them. */
export const YourNotesBesideIt: PageStory = {
  ...moment(yours(), ...presented, nextFrame,
    step('Press Your notes, at its foot', async (c) => { await c.userEvent.click(await screen.findByRole('button', { name: 'Your notes, only you see them' }, SOON)); })),
  name: 'Your notes beside the board'
};
/** In a light theme your side is light, and so is the board; the stage round them stays night. */
export const YourNotesBesideItLight: PageStory = { ...light(YourNotesBesideIt), name: 'Your notes beside the board, in a light theme' };
/** Close, while you present the board: for you, or for everyone. */
export const CloseWhileYouPresentTheBoard: PageStory = {
  ...moment(yours(), ...presented, nextFrame, step('Press Close on its bar: it asks', (c) => close(c, retro))), name: 'Close, while you present the board'
};
/** For you: you're back with the people, and the others keep it open on their own. Nobody presents it, so it has no tile. */
export const BoardClosedForYou: PageStory = {
  ...moment(yours(), ...presented, nextFrame,
    step('Press Close, then For you', async (c) => { await close(c, retro); await closeFor(c, retro, 'For you'); }),
    step('The others keep it open', () => toldThat('Closed for you. The others keep it open, on their own.'))),
  name: 'Board closed for you'
};
/** Its name is a menu: Rename, Open where it's saved, Who can add to it, Copy link, Download as an image and Night board. */
export const TheBoardsNameMenu: PageStory = { ...moment(yours(), ...presented, step('Press its name, on its bar', (c) => frameMenu(c, retro))), name: 'The board’s name menu' };
/** Chat in your side beside the board you present: the stage gives way. */
export const ChatBesideTheBoard: PageStory = { ...moment(yours(), ...presented, reach('Chat')), name: 'Chat beside the board' };
export const ChatBesideTheBoardLight: PageStory = { ...light(ChatBesideTheBoard), name: 'Chat beside the board, in a light theme' };
const workspaceAway = step('Press Board, then Launch retro: the workspace you present waits as a tile', async (c) => { await pickBoard(c, retro); await frameOf(retro); });
/** Share's Stop sharing, on what you present: "For you" or "For everyone", asked in Share itself. */
async function stopInShare(c: Context): Promise<HTMLElement> {
  const menu = await shareMenu(c);
  await c.userEvent.click(within(menu).getByRole('button', { name: 'Stop sharing' }));
  return within(menu).findByRole('button', { name: startingWith('For everyone') }, SOON);
}
/** The workspace you present waits as a tile while a board of yours is open: Share's Stop sharing asks for you or for everyone in Share itself. */
export const StopSharingFromShare: PageStory = {
  ...moment(yours(), openWorkspace, toThePlan, presentWorkspace, followsYou, workspaceAway,
    step('Press Presenting in the dock, then Stop sharing: Share asks, wherever what you present is', stopInShare)),
  name: 'Stop sharing, from Share'
};
/** For everyone: the workspace closes for everyone, its tile goes, and the board open just for you stays. */
export const StoppedFromShare: PageStory = {
  ...moment(yours(), openWorkspace, toThePlan, presentWorkspace, followsYou, workspaceAway,
    step('Press Presenting in the dock, Stop sharing, then For everyone', async (c) => {
      await c.userEvent.click(await stopInShare(c));
      await toldThat('Closed for everyone.', SOON);
    })),
  name: 'Stopped from Share, for everyone'
};

/* ---------- 3 When someone else presents ---------- */

const priyaWs = hers({ cues: at(PRIYA_PRESENTS, presentsWorkspace(PRIYA)) });
const followingPriya = step('Priya presents the workspace: you follow her into Launch plan', () => toldThat('Priya is presenting the workspace, and you’re following.'));
const unfollow = step('Press Unfollow on its bar, then Launch checklist: you work on your own', async (c) => {
  await c.userEvent.click(await screen.findByRole('button', { name: 'Unfollow Priya' }, LATER));
  const [row] = await within(await frameOf(WS)).findAllByRole('button', { name: /^Launch checklist/ }, SOON);
  if (row) await c.userEvent.click(row);
});
const followAgain = step('Press Follow Priya, on its bar: you’re back where she is', async (c) => {
  await c.userEvent.click(await within(await frameOf(WS)).findByRole('button', { name: /^Follow Priya/ }, SOON));
});
const closeTheirs = step('Press Close on its bar: it’s closed for you', (c) => close(c, WS));
const itsTile = step('While Priya presents it, its tile takes you back', () => toldThat('Closed for you. While Priya presents, its tile takes you back.'));

/** Priya presents the workspace: you follow her into Launch plan, and the lit edge says you see what she sees. */
export const PriyaPresentsTheWorkspace: PageStory = { ...moment(priyaWs, followingPriya), name: 'Priya presents the workspace' };
/** On a phone: Unfollow and Close are on its bar, under the faces. */
export const PriyaPresentsTheWorkspacePhone: PageStory = { ...phone(PriyaPresentsTheWorkspace), name: 'Priya presents the workspace, on a phone' };
/** Unfollow: you're on your own in the same workspace, in another document. Follow Priya says where she is. */
export const UnfollowPriya: PageStory = { ...moment(priyaWs, followingPriya, unfollow), name: 'Unfollow Priya' };
/** Follow Priya: you're back where she is. */
export const FollowPriyaAgain: PageStory = { ...moment(priyaWs, followingPriya, unfollow, followAgain), name: 'Follow Priya again' };
/** Close: it's closed for you, and while Priya presents it, it has a tile with the people. */
export const ClosedWhilePriyaPresents: PageStory = { ...moment(priyaWs, followingPriya, closeTheirs, itsTile), name: 'Closed for you while Priya presents' };
/** Its tile: you're back in, following Priya. */
export const BackFromItsTile: PageStory = {
  ...moment(priyaWs, followingPriya, closeTheirs, itsTile,
    step('Press its tile: you’re back in, following her', async (c) => { await c.userEvent.click(await tileOf(WS)); await frameOf(WS); })),
  name: 'Back in from its tile'
};
/** Priya stops while it's closed for you: its tile goes too. Workspace still opens it just for you. */
export const PriyaStopped: PageStory = {
  ...moment(hers({ cues: [...at(PRIYA_PRESENTS, presentsWorkspace(PRIYA)), ...at(PRIYA_PRESENTS + 10, stopsPresenting())] }),
    followingPriya, closeTheirs, step('Priya stops: its tile goes', () => toldThat('Priya stopped presenting the workspace.'))),
  name: 'Priya stopped presenting'
};
/** One board or workspace is presented at a time: while Priya presents the workspace, a board you open just for you has no Present. */
export const ABoardOfYoursWhilePriyaPresents: PageStory = {
  ...moment(priyaWs, followingPriya,
    step('Press Board, then Launch retro: it opens just for you, and has no Present while Priya presents', async (c) => { await pickBoard(c, 'Launch retro'); await frameOf('Launch retro'); })),
  name: 'A board of yours, while Priya presents'
};
/** Share, while Priya presents the workspace: A board and The workspace say who's presenting, so nothing's made that couldn't be. */
export const ShareWhilePriyaPresents: PageStory = { ...moment(priyaWs, followingPriya, openShare), name: 'Share, while Priya presents' };
/** Priya organizes this call: while you present the workspace, she closes it for everyone from its name, and you're told it was her. */
export const PriyaClosesWhatYouPresent: PageStory = {
  ...moment(hers({ cues: at(30, stopsPresenting(true)) }), openWorkspace, presentWorkspace, followsYou,
    step('Priya closes it for everyone: you’re told it was her', () => toldThat('Priya closed the workspace for everyone.'))),
  name: 'Priya closes what you present'
};
/** Focus: what Priya presents fills your window. Show everything, or Esc, brings it all back. */
export const FollowingInFocus: PageStory = {
  ...moment(priyaWs, followingPriya,
    step('Press Fill your window with it, on its bar', async (c) => { await c.userEvent.click(await screen.findByRole('button', { name: 'Fill your window with it' }, SOON)); })),
  name: 'Following Priya, in focus'
};

/** Priya opens a retro a second before she presents it, from Could improve: a board made in the call is named after it. */
const priyaBoard = hers({ board: RETRO, cues: [...at(PRIYA_PRESENTS - 1, { do: 'open-board', who: PRIYA, template: 'retro' }), ...at(PRIYA_PRESENTS, presentsBoard(PRIYA, 1))] });
const herBoard = 'Launch review';
const followingHerBoard = step('Priya presents the board she made, from Could improve: you follow her', () => toldThat(`Priya is presenting ${herBoard}, and you’re following.`));
/** Priya presents a board: you see her frame, and can unfollow to add to it. */
export const PriyaPresentsABoard: PageStory = { ...moment(priyaBoard, followingHerBoard), name: 'Priya presents a board' };
/** Close: closed for you, and while she presents it, its tile takes you back. */
export const PriyasBoardClosedForYou: PageStory = {
  ...moment(priyaBoard, followingHerBoard, step('Press Close on its bar', (c) => close(c, herBoard)), itsTile), name: 'Priya’s board, closed for you'
};

/* ---------- 6 Priya's screen, in your call ---------- */

const priyaScreen = yours({ cues: at(PRIYA_PRESENTS, shares(PRIYA, CHECKLIST)) });
const herScreen = 'Priya’s screen';
const sharing = step('Priya shares her screen: it takes your stage', () => toldThat('Priya is presenting their screen.'));
/** Priya shares her screen: everyone sees it, and you're told. */
export const PriyaSharesHerScreen: PageStory = { ...moment(priyaScreen, sharing), name: 'Priya shares her screen' };
/** A moment later: her bar has Close, for you, like anyone's. */
export const PriyasScreenLater: PageStory = {
  ...moment(priyaScreen, step('Priya shares her screen, and the toast goes', () => toldThenGone('Priya is presenting their screen.'))), name: 'Priya’s screen, a moment later'
};
/** As the organizer, its name's menu has Stop it for everyone, after a line. */
export const PriyasScreenMenu: PageStory = {
  ...moment(priyaScreen, sharing, step('Press the name of Priya’s share', (c) => frameMenu(c, herScreen))), name: 'Priya’s screen’s menu, for the organizer'
};

/* ---------- the review's hard cases ---------- */

/**
 * A presentation starts while you're typing in Launch checklist: you follow Priya into Launch plan, and the workspace keeps your
 * place, your caret and your undo. Unfollow takes you back to exactly where you were, your new line with you.
 */
export const APresentationStartsWhileYouType: PageStory = {
  ...moment(hers({ cues: at(18, presentsWorkspace(PRIYA)) }),
    openWorkspace,
    step('Open Launch checklist, and add a line at its end', async (c) => {
      const ws = await frameOf(WS);
      const [row] = await within(ws).findAllByRole('button', { name: /^Launch checklist/ }, LATER);
      if (row) await c.userEvent.click(row);
      const last = await within(ws).findByText('The launch note is written', {}, LATER);
      await c.userEvent.pointer([{ keys: '[MouseLeft]', target: last, offset: last.textContent?.length ?? 0 }]);
      await c.userEvent.keyboard('{Enter}Ask Maya how the importer test went');
    }),
    followingPriya,
    step('Press Unfollow: you’re back in Launch checklist, at the end of your line', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Unfollow Priya' }, SOON));
      await within(await frameOf(WS)).findByText('Ask Maya how the importer test went', {}, SOON);
    })),
  name: 'A presentation starts while you’re typing'
};

/** Priya presents the workspace, and Kofi shares his screen seven seconds later. */
const two = hers({ cues: [...at(PRIYA_PRESENTS, presentsWorkspace(PRIYA)), ...at(PRIYA_PRESENTS + 7, shares(KOFI, EMPTY_STATES))] });
const kofis = 'Kofi’s screen';
const kofiToo = step('Kofi shares his screen while you follow Priya: it comes in as a tile, with Show it', () => toldThat('Kofi is presenting their screen. It’s with the people.'));
const besideIt = step('Hover his tile, press its options, then Show beside: his screen sits beside the workspace', async (c) => {
  await c.userEvent.hover(await tileOf(kofis));
  await c.userEvent.click(await screen.findByRole('button', { name: `Options for ${kofis}` }, SOON));
  const menu = await screen.findByRole('dialog', { name: `Options for ${kofis}` }, SOON);
  await settle();
  await c.userEvent.click(within(menu).getByRole('button', { name: 'Show beside' }));
  await frameOf(kofis);
});
/** Two things presented at once: Priya the workspace, Kofi his screen. You stay with Priya; his comes in as a tile. */
export const TwoPresentedAtOnce: PageStory = { ...moment(two, followingPriya, kofiToo), name: 'Two presented at once' };
/** Show it, on the toast: Kofi's screen is on your stage, and the workspace waits as a tile. */
export const TwoPresentedShowIt: PageStory = {
  ...moment(two, followingPriya, kofiToo,
    step('Press Show it', async (c) => { await c.userEvent.click(await screen.findByRole('button', { name: 'Show it' }, SOON)); await frameOf(kofis); })),
  name: 'Two presented at once: Show it'
};
/** Show beside: Kofi's screen beside the workspace, two frames on your stage. */
export const TwoPresentedSideBySide: PageStory = { ...moment(two, followingPriya, kofiToo, besideIt), name: 'Two presented at once: Show beside' };
/** Closing either leaves the other: Close on Kofi's, and the workspace has your stage; his is a tile again. */
export const TwoPresentedCloseOne: PageStory = {
  ...moment(two, followingPriya, kofiToo, besideIt,
    step('Press Close on Kofi’s screen: the workspace stays', (c) => close(c, kofis)),
    step('His tile takes you back', () => toldThat('Closed for you. While Kofi presents, its tile takes you back.'))),
  name: 'Two presented at once: close one'
};

/** Priya's call with Harbourline: you come in with the link, by name, and she lets you in. */
const HARBOURLINE: StoryCall = { id: 'm-harbourline', title: 'Harbourline intro', startsAt: iso(0, 16, 5), minutes: 30, code: 'hbr-intr-prs', organizer: PRIYA, guests: [KOFI], status: 'live' };
const asGuest = (cues: Cue[]): InCall => ({ scenario: 'signed-out', call: HARBOURLINE, script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }], cues: [...at(0.5, { do: 'let-in' }), ...cues] } });
const guestTold = step('Priya presents the workspace: you’re told who, and never what', () => toldThat('Priya is presenting something you can’t open'));
/** A guest is told who's presenting, and never what: no frame and no tile, as there's nothing they may see. */
export const AGuestIsToldWho: PageStory = { ...moment(asGuest(at(8, presentsWorkspace(PRIYA))), guestTold), name: 'A guest, while Priya presents' };
/** A guest's board picker says a guest can't start a board, and has nothing to open. */
export const AGuestsBoardPicker: PageStory = { ...moment(asGuest([]), step('Press Board, at the top right', boardPicker)), name: 'A guest’s board picker' };
/** A guest's Share: their screen, and why a board and the workspace aren't theirs to present. */
export const AGuestsShare: PageStory = { ...moment(asGuest(at(8, presentsWorkspace(PRIYA))), guestTold, openShare), name: 'A guest’s Share' };
