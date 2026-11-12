/*
 * The call, rethought (docs/design/canvas/call/, nc.js): every moment its seven journeys show, each reached as a person would
 * reach it. Board and Workspace at the top right open on your stage, only on your screen, and everyone in the call can edit
 * what they open; Present, on what you have open, or Share in
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
import { screen, waitFor, within } from 'storybook/test';
import {
  at, chats, closesPresenting, line, movesPresenting, movesToRoom, presentsBoard, presentsWorkspace, reloads, shares, stopsPresenting, stopsShare, type CallScript, type Cue, type Line,
  type Present
} from '../../src/api/script';
import { inCall, light, narrow, phone, plays, reach, type InCall, type StoryCall } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { iso } from '../../src/world/clock';
import { RETRO } from './boards';
import {
  LATER, SOON, boardPicker, close, closeFor, frameMenu, frameOf, onTheBar, pickBoard, present, settle, shareATab, shareKind, shareMenu, sideAway, startingWith,
  tileOf, toldThat, toldThenGone, type Context, type Play
} from './plays';
import { AIKO, ART, CHECKLIST, EMPTY_STATES, KOFI, LAUNCH_REVIEW, PLAN, PRIYA, SAM } from './talk';

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

/**
 * Workspace, at the top right: it opens on your stage, only on your screen, and nobody else's screen changes. Its bar says so,
 * and that everyone in the call can edit it.
 */
export const WorkspaceOpenJustForYou: PageStory = { ...moment(yours(), openWorkspace, step('It’s only on your screen, and everyone in the call can edit it', () => frameOf(WS))), name: 'Workspace only on your screen' };
/** On a phone, Workspace is at the top of More, and it opens under the faces. */
export const WorkspaceOpenJustForYouPhone: PageStory = { ...phone(WorkspaceOpenJustForYou), name: 'Workspace only on your screen, on a phone' };
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
/** Open, at the top of Notes: the workspace opens on these notes, on your screen, as Workspace at the top right would. */
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
const openRetro = step('Press Board, then Launch retro, from your team’s boards: it comes into the call, on your screen until you present it, and everyone here can edit it', async (c) => { await pickBoard(c, retro); await frameOf(retro); });
const presentRetro = step('Press Present on its bar: everyone follows you, and its foot steps through its frames', (c) => present(c, retro));
const boardOn = `Everyone follows you on ${retro}. They can add to it as you go.`;
const presented = [openRetro, presentRetro, step('Everyone follows you', () => toldThat(boardOn))];
const nextFrame = step('Press Next frame, at its foot: everyone following you moves with you', async (c) => {
  await c.userEvent.click(await screen.findByRole('button', { name: 'Next frame' }, LATER));
  await screen.findByText('2 of 3', {}, SOON);
});

/** Board, at the top right: a new board, or one your team has. It's only on your screen until you present it, and everyone in the call can edit it. */
export const TheBoardPicker: PageStory = { ...moment(yours(), step('Press Board, at the top right', boardPicker)), name: 'The board picker' };
/** Launch retro, from your team's boards: on your screen, to look round and add to on your own, and everyone here can edit it too. */
export const ABoardOpenJustForYou: PageStory = { ...moment(yours(), openRetro), name: 'A board on your screen' };
export const ABoardOpenJustForYouLight: PageStory = { ...light(ABoardOpenJustForYou), name: 'A board on your screen, in a light theme' };
export const ABoardOpenJustForYouPhone: PageStory = { ...ABoardOpenJustForYou, name: 'A board on your screen, on a phone', globals: PHONE };
/** Your launch review, with Sam, who came in with the link: a guest, in none of your workspaces. */
const withSam = (): InCall => review(LAUNCH_REVIEW, [{ who: PRIYA }, { who: KOFI }, { who: AIKO }, { who: SAM, guest: true }], {});
const askedAboutSam = step('Press Board, then Onboarding flow, from your team’s boards. It’s in Design, and Sam can’t open it: it asks once, in the picker’s place', async (c) => {
  await pickBoard(c, 'Onboarding flow');
  await screen.findByText('Let everyone here edit Onboarding flow?', {}, LATER);
});
/** A saved board someone here can't open: let everyone here edit it, or not now. */
export const ASavedBoardSomeoneCantOpen: PageStory = { ...moment(withSam(), askedAboutSam), name: 'A saved board someone can’t open' };
export const ASavedBoardSomeoneCantOpenPhone: PageStory = { ...ASavedBoardSomeoneCantOpen, name: 'A saved board someone can’t open, on a phone', globals: PHONE };
/** Open it: it comes into the call on your screen, and everyone here can edit it while they're in the call, Sam too, as its bar says. */
export const ASavedBoardLetIn: PageStory = {
  ...moment(withSam(), askedAboutSam, step('Press Open it', async (c) => {
    await settle();
    await c.userEvent.click(await screen.findByRole('button', { name: 'Open it' }, SOON));
    await frameOf('Onboarding flow');
  })),
  name: 'A saved board, everyone let in'
};
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
/** For you: you stop presenting and you're back with the people, and the others keep it open on their own. Nobody presents it, so it has no tile. */
export const BoardClosedForYou: PageStory = {
  ...moment(yours(), ...presented, nextFrame,
    step('Press Close, then For you', async (c) => { await close(c, retro); await closeFor(c, retro, 'For you'); }),
    step('You stopped presenting, and the others keep it open', () => toldThat('You stopped presenting. The others keep it open, on their own.'))),
  name: 'Board closed for you'
};
/** Its name is a menu: Rename, Open where it's saved, Who can add to it, Copy link, Download as an image or a PDF, and Night board, there while you present it. */
export const TheBoardsNameMenu: PageStory = { ...moment(yours(), ...presented, step('Press its name, on its bar', (c) => frameMenu(c, retro))), name: 'The board’s name menu' };
/** Chat in your side beside the board you present: the stage gives way. */
export const ChatBesideTheBoard: PageStory = { ...moment(yours(), ...presented, reach('Chat')), name: 'Chat beside the board' };
export const ChatBesideTheBoardLight: PageStory = { ...light(ChatBesideTheBoard), name: 'Chat beside the board, in a light theme' };
/**
 * In a narrow window, wider than a phone, there's no room for the stage beside your side: Chat sits over the stage at the right,
 * which keeps its width, and toasts keep to the stage left of it, clear of the composer.
 */
export const ChatOverTheBoardNarrow: PageStory = narrow(ChatBesideTheBoard, 'Chat over the board, in a narrow window');
export const ChatOverTheBoardNarrowLight: PageStory = light(ChatOverTheBoardNarrow, 'Chat over the board, in a narrow window, in a light theme');
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
/** For everyone: the workspace closes for everyone, its tile goes, and the board on your screen stays. */
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
/** Priya stops while it's closed for you: its tile goes too. Workspace still opens it, on your screen. */
export const PriyaStopped: PageStory = {
  ...moment(hers({ cues: [...at(PRIYA_PRESENTS, presentsWorkspace(PRIYA)), ...at(PRIYA_PRESENTS + 10, stopsPresenting())] }),
    followingPriya, closeTheirs, step('Priya stops: its tile goes', () => toldThat('Priya stopped presenting the workspace.'))),
  name: 'Priya stopped presenting'
};
/** One board or workspace is presented at a time: while Priya presents the workspace, a board you open on your screen has no Present. */
export const ABoardOfYoursWhilePriyaPresents: PageStory = {
  ...moment(priyaWs, followingPriya,
    step('Press Board, then Launch retro: it opens on your screen, and has no Present while Priya presents', async (c) => { await pickBoard(c, 'Launch retro'); await frameOf('Launch retro'); })),
  name: 'A board of yours, while Priya presents'
};
/** Share, while Priya presents the workspace: A board and The workspace say who's presenting, so nothing's made that couldn't be. */
export const ShareWhilePriyaPresents: PageStory = { ...moment(priyaWs, followingPriya, openShare), name: 'Share, while Priya presents' };
/** Priya organizes this call: while you present the workspace, she closes it for everyone from its name, and you're told it was her. */
export const PriyaClosesWhatYouPresent: PageStory = {
  ...moment(hers({ cues: at(30, closesPresenting()) }), openWorkspace, presentWorkspace, followsYou,
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
/**
 * Priya presents a board: you follow her view, with your tools to hand, and anything of your own on it takes you off following,
 * from where you are.
 */
export const PriyaPresentsABoard: PageStory = { ...moment(priyaBoard, followingHerBoard), name: 'Priya presents a board' };
/** Close: closed for you, and while she presents it, its tile takes you back. */
export const PriyasBoardClosedForYou: PageStory = {
  ...moment(priyaBoard, followingHerBoard, step('Press Close on its bar', (c) => close(c, herBoard)), itsTile), name: 'Priya’s board, closed for you'
};

/* ---------- how a presentation ends: the call says each end as it happens ---------- */

/** Priya's tile among the people: there while she's in the call. */
const herTile = () => screen.queryByRole('group', { name: /^Priya\. / });
/**
 * Priya's page reloads while she presents the workspace: she's gone from the people for a moment, and nothing is said. Nothing
 * says her presentation ended, so you stay with it as it was, and she comes back presenting it, with you still following.
 */
export const PriyaReloads: PageStory = {
  ...moment(hers({ cues: [...at(PRIYA_PRESENTS, presentsWorkspace(PRIYA)), ...at(PRIYA_PRESENTS + 6, reloads(PRIYA, 6))] }), followingPriya,
    step('Priya reloads: she’s gone from the people, and nothing is said', () => waitFor(() => { if (herTile()) throw new Error('Priya is still here.'); }, LATER)),
    step('She’s back, presenting as she was, and you’re still following her', async () => {
      await waitFor(() => { if (!herTile()) throw new Error('Priya isn’t back yet.'); }, LATER);
      await screen.findByRole('button', { name: 'Unfollow Priya' }, SOON);
    })),
  name: 'Priya reloads while she presents'
};
/** Priya, presenting a board, moves on a frame: you're following, so you move with her, to Could improve. */
export const MovingWithPriya: PageStory = {
  ...moment(hers({ board: RETRO, cues: [...at(PRIYA_PRESENTS - 1, { do: 'open-board', who: PRIYA, template: 'retro' }), ...at(PRIYA_PRESENTS, presentsBoard(PRIYA, 0)), ...at(PRIYA_PRESENTS + 6, movesPresenting(1))] }),
    followingHerBoard, step('Priya moves on a frame: you move with her, and see Could improve', () => toldThat('Could improve', LATER))),
  name: 'Moving on with Priya'
};
/**
 * Priya presents the workspace, then a board in its place: hers ends as the board starts, so the board takes your stage, and
 * the workspace has no tile and nothing waits.
 */
export const PriyaPresentsABoardInstead: PageStory = {
  ...moment(hers({ board: RETRO, cues: [...at(PRIYA_PRESENTS, presentsWorkspace(PRIYA)), ...at(PRIYA_PRESENTS + 7, { do: 'open-board', who: PRIYA, template: 'retro' }), ...at(PRIYA_PRESENTS + 8, presentsBoard(PRIYA, 0))] }),
    followingPriya, step('Priya presents a board in its place: it takes your stage', () => toldThat(`Priya is presenting ${herBoard}, and you’re following.`))),
  name: 'Priya presents a board instead'
};
/** Priya closes what she presents for everyone: it closes on your stage too, and you're told. */
export const PriyaClosesItForEveryone: PageStory = {
  ...moment(hers({ cues: [...at(PRIYA_PRESENTS, presentsWorkspace(PRIYA)), ...at(PRIYA_PRESENTS + 8, stopsPresenting(true))] }), followingPriya,
    step('Priya closes it for everyone: it closes here too', () => toldThat('The workspace closed for everyone.'))),
  name: 'Priya closes it for everyone'
};
/**
 * Kofi presents the workspace in Priya's call, and she sends him to a breakout room: his presentation ends there and then, said
 * at once, and what you followed stays open, only on your screen.
 */
const kofiPresents = (cues: Cue[]) => hers({ cues: [...at(PRIYA_PRESENTS, presentsWorkspace(KOFI)), ...at(PRIYA_PRESENTS + 3, { do: 'rooms', rooms: [{ name: 'Rollout', people: [AIKO] }, { name: 'Support', people: [] }], minutes: 10 }), ...cues] });
const followingKofi = step('Kofi presents the workspace: you follow him', () => toldThat('Kofi is presenting the workspace, and you’re following.'));
export const KofiMovedToARoom: PageStory = {
  ...moment(kofiPresents(at(PRIYA_PRESENTS + 9, movesToRoom(KOFI, 'Rollout'))), followingKofi,
    step('Priya moves Kofi to Rollout: his presentation ends, and you’re told at once', () => toldThat('Kofi stopped presenting the workspace.')),
    step('What you followed stays open, only on your screen', () => screen.findByText('Only on your screen', {}, SOON))),
  name: 'Kofi moved to a room while he presents'
};
/** You're moved to a room while you follow Kofi: what was presented where you were ends for you without a word, and stays open, only on your screen. */
export const YouMovedToARoom: PageStory = {
  ...moment(kofiPresents(at(PRIYA_PRESENTS + 9, movesToRoom('me', 'Support'))), followingKofi,
    step('Priya moves you to Support: what Kofi presents stays in the main room, and the workspace stays open, only on your screen', () => screen.findByText('Only on your screen', {}, LATER))),
  name: 'You, moved to a room while Kofi presents'
};
/** Priya organizes the call: she stops what you share for everyone, and the call says it was her. */
export const YourShareStopped: PageStory = {
  ...moment(hers({ cues: at(24, stopsShare('me')) }), shareTab, seesYourTab, step('Priya stops your share: it stops for everyone, and you’re told it was her', () => toldThat('Priya stopped Art’s share.'))),
  name: 'Your share, stopped by Priya'
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
const guestFollows = step('Priya presents the workspace: it opens to a guest as to everyone in the call, so you follow her', () => toldThat('Priya is presenting the workspace, and you’re following.'));
/** A guest follows whoever presents the workspace, as everyone in the call does: it opens to them while they're in the call. */
export const AGuestIsToldWho: PageStory = { ...moment(asGuest(at(8, presentsWorkspace(PRIYA))), guestFollows), name: 'A guest, while Priya presents' };
/** A guest's board picker says a guest can't start a board, and has nothing to open. */
export const AGuestsBoardPicker: PageStory = { ...moment(asGuest([]), step('Press Board, at the top right', boardPicker)), name: 'A guest’s board picker' };
/** A guest's Share: their screen and the workspace, once nobody else presents, and why a board isn't theirs to start. */
export const AGuestsShare: PageStory = { ...moment(asGuest(at(8, presentsWorkspace(PRIYA))), guestFollows, openShare), name: 'A guest’s Share' };
