/*
 * Journeys in a call (docs/product/user-flows.md › 6. In the call). The call is the call stories' (src/call.ts and
 * stories/calls/talk.ts): you're in it as the lobby leaves you, and everyone else, and the server, play their part from its
 * script. The states on the way are in Calls/; these go from one to the next.
 *
 * 6.1 to 6.7 are the call canvas's journeys (docs/design/canvas/call/nc.js), a step for each of their frames, in its words.
 * They happen in Art's launch review: Product is its home, and Priya, Kofi and Aiko are in it, talking pricing with notes on.
 * Whatever's on your stage is in a frame, named for what's in it and who sees it: "Product, only you see it", "Launch retro,
 * everyone sees it". 6.8 onward are the call's other journeys; a board in the call has its own after them (06b).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { asks, at, chats, floats, knocks, nudges, presentsWorkspace, shares, stopsPresenting, type CallScript, type Present } from '../../src/api/script';
import { MORE, inCall, phone, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import {
  AIKO, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, CHECKLIST, DIEGO, KOFI, LAUNCH_REVIEW, MAYA, PLAN, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK
} from '../calls/talk';
import { LAPTOP, LATER, SOON, away, still } from './play';

const meta = { title: 'Journeys/6 In the call', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

type Context = Parameters<NonNullable<PageStory['play']>>[0];

const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const dock = () => screen.findByRole('toolbar', { name: 'Call controls' }, LATER);
const notesPanel = () => screen.findByRole('complementary', { name: 'Notes' }, LATER);
/**
 * Your side put away first, as the canvas has it, so what opens on your stage has the stage's width: in a window narrower than
 * a laptop's, the workspace's list gives way beside Notes. A call you've just joined opens Notes beside the stage by itself
 * while notes are on, as they are in the launch review, wherever the window is 1100 wide or more (the call's own rule).
 */
async function sideAway({ userEvent, step }: Context): Promise<void> {
  if (window.innerWidth < 1100) return;
  await step('Put your side away', async () => {
    await userEvent.click(within(await notesPanel()).getByRole('button', { name: 'Close Notes' }));
    await away('complementary', 'Notes');
  });
}

/* ---------- the canvas's journeys ---------- */

/**
 * The launch review, a minute and a half in: the empty states are decided already, and pricing is talked through as the
 * journey plays. Priya is in the launch plan, and Kofi is typing there.
 */
const launchReview = (script: CallScript = {}): PageStory => inCall({
  scenario: 'busy', call: LAUNCH_REVIEW,
  script: {
    here: REVIEWERS, since: 100, earlier: REVIEW_TALK.slice(0, 7), talk: { lines: REVIEW_TALK.slice(7), from: 3, every: 5 }, summary: REVIEW_SUMMARY,
    workspace: { where: [{ who: PRIYA, document: PLAN }, { who: KOFI, document: PLAN, typing: true }] }, ...script
  }
}, { globals: LAPTOP });

/** What's on your stage, in its frame, by what the frame is called. */
const frame = (name: string | RegExp, wait = SOON) => screen.findByRole('region', { name }, wait);
const yours = /, only you see it$/;
const everyones = /, everyone sees it$/;
/** Something on a frame's bar, once it's there. */
const onBar = (f: HTMLElement, name: string | RegExp) => within(f).findByRole('button', { name }, SOON);
/** The frame's name, which opens its menu: the first thing on its bar that opens something. */
const nameOf = (f: HTMLElement) => waitFor(() => {
  const [menu] = within(f).getAllByRole('button').filter((b) => b.hasAttribute('aria-haspopup'));
  if (!menu) throw new Error('The frame’s name isn’t a menu yet.');
  return menu;
}, SOON);
/** A document or one of the call's pages in the workspace's list, by its name. */
async function row(name: string): Promise<HTMLElement> {
  const [first] = await screen.findAllByRole('button', { name }, SOON);
  if (!first) throw new Error(`${name} isn’t in the list.`);
  return first;
}
/** What a toast says, once it's said it. */
const told = (text: string | RegExp) => screen.findByText(text, {}, SOON);
/** The question Close asks while you present: for you, or for everyone. */
const forYou = () => screen.findByRole('button', { name: /^For you/ }, SOON);
const forEveryone = () => screen.findByRole('button', { name: /^For everyone/ }, SOON);

/**
 * Priya stops presenting this long into 6.3, once the journey has had her presentation closed for you twice: well after its
 * steps, however slowly they're played, and waited for as the call says it.
 */
const PRIYA_STOPS = 55;

export const OpenTheWorkspace: PageStory = {
  name: '6.1 Open the workspace, then present it',
  ...launchReview(),
  play: async (c) => {
    const { userEvent, step } = c;
    await sideAway(c);
    await step('Click Workspace, at the top right. Board and Workspace sit beside Notes and Chat. Until someone presents, only the people are on the stage', async () => {
      await dock();
      await userEvent.click(await screen.findByRole('button', { name: /^Workspace/ }, LATER));
    });
    await step('It opens just for you. Nobody else’s screen changes. This call’s own pages are in its list, with its documents', async () => {
      await frame(yours, LATER);
    });
    await step('Click Launch plan, and work on your own. Present, on its bar, brings everyone here', async () => {
      await userEvent.click(await row('Launch plan'));
      await screen.findByText(/The launch moves to/, {}, SOON);
    });
    await step('Click Present. Everyone follows you, live. Anyone can unfollow to write alongside you', async () => {
      await userEvent.click(await onBar(await frame(yours), 'Present'));
      await told('Everyone follows you in the workspace. They can unfollow to work alongside you.');
    });
    await step('Click Close. While you present, Close asks: For you, which stops your presentation, or For everyone', async () => {
      await userEvent.click(await onBar(await frame(everyones), /^Close /));
      await forEveryone();
    });
    await step('Click For everyone. It closes for everyone and leaves nothing on the stage. Workspace opens it again', async () => {
      await userEvent.click(await forEveryone());
      await told('Closed for everyone.');
    });
  }
};

export const OpenABoard: PageStory = {
  name: '6.2 Open a board, then present it',
  ...launchReview(),
  play: async ({ userEvent, step }) => {
    await step('Click Board, at the top right. It offers a new board, or one your team has', async () => {
      await dock();
      await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LATER));
    });
    await step('Pick Launch retro, one of your team’s boards. Only you see it until you present it', async () => {
      // Your team's boards come in a moment after the picker opens, and like every menu it takes no press just after its rows move.
      const picker = await screen.findByRole('dialog', { name: 'Open a board' }, LATER);
      await within(picker).findByRole('button', { name: /^Launch retro/ }, LATER);
      await still(picker);
      await userEvent.click(within(picker).getByRole('button', { name: /^Launch retro/ }));
    });
    await step('It opens just for you. Look around and add to it on your own. Present, on its bar, brings everyone', async () => {
      await frame('Launch retro, only you see it', LATER);
    });
    await step('Click Present. Everyone follows you. The arrows at its foot step through its frames', async () => {
      await userEvent.click(await onBar(await frame('Launch retro, only you see it'), 'Present'));
      await told('Everyone follows you on Launch retro. They can unfollow to add to it.');
    });
    await step('Click the arrow for the next frame. Everyone following you moves with you', async () => {
      const pager = await screen.findByRole('group', { name: /^Step through its frames/ }, SOON);
      await userEvent.click(within(pager).getByRole('button', { name: 'Next frame' }));
      await within(pager).findByText('Could improve', {}, SOON);
    });
    await step('Click Close. For you, or for everyone', async () => {
      await userEvent.click(await onBar(await frame('Launch retro, everyone sees it'), /^Close /));
      await forYou();
    });
    await step('Click For you. You stop presenting and you’re back with the people. The others keep it open on their own; nobody presents it, so it has no tile', async () => {
      await userEvent.click(await forYou());
      await told('You stopped presenting. The others keep it open, on their own.');
    });
  }
};

export const WhenSomeoneElsePresents: PageStory = {
  name: '6.3 When someone else presents',
  ...launchReview({ cues: [...at(10, presentsWorkspace(PRIYA)), ...at(PRIYA_STOPS, stopsPresenting())] }),
  play: async (c) => {
    const { userEvent, step } = c;
    await sideAway(c);
    await step('Priya presents the workspace. You follow Priya into Launch plan. The blue edge says you’re seeing what Priya sees', async () => {
      await screen.findByText('Priya is presenting the workspace, and you’re following.', {}, LATER);
      await onBar(await frame(everyones), 'Unfollow Priya');
    });
    await step('Click Unfollow. You’re on your own in the same workspace: open another document and write. A face shows where Priya is', async () => {
      await userEvent.click(await onBar(await frame(everyones), 'Unfollow Priya'));
      await userEvent.click(await row('Launch checklist'));
      const first = await screen.findByText(/Everything that has to be true on the 18th/, {}, SOON);
      // The page takes writing once its document has come in.
      await waitFor(() => { if (!first.closest('[contenteditable="true"]')) throw new Error('The checklist doesn’t take writing yet.'); }, SOON);
      await userEvent.pointer({ keys: '[MouseLeft]', target: first, offset: (first.textContent ?? '').length });
      await userEvent.keyboard(' Kofi checks the status page today.');
      await screen.findByText(/Kofi checks the status page today/, {}, SOON);
    });
    await step('Click Follow Priya. You’re back where Priya is', async () => {
      await userEvent.click(await onBar(await frame(everyones), /^Follow Priya/));
      await screen.findByText(/The launch moves to/, {}, SOON);
    });
    await step('Click Close. It’s closed for you. While Priya presents it, it has a tile with the people', async () => {
      await userEvent.click(await onBar(await frame(everyones), /^Close /));
      await told('Closed for you. While Priya presents, its tile takes you back.');
    });
    await step('Click its tile. You’re back in, following Priya', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Join / }, SOON));
      await onBar(await frame(everyones), 'Unfollow Priya');
    });
    await step('If Priya stops while it’s closed for you, its tile goes too. Workspace, at the top right, still opens it just for you', async () => {
      await userEvent.click(await onBar(await frame(everyones), /^Close /));
      await screen.findByRole('button', { name: /^Join / }, SOON);
      await screen.findByText('Priya stopped presenting the workspace.', {}, { timeout: PRIYA_STOPS * 1000 });
      await away('button', /^Join /);
    });
  }
};

export const ShareYourScreen: PageStory = {
  name: '6.4 Share your screen',
  ...launchReview(),
  play: async ({ userEvent, step }) => {
    await step('Click Share in the dock. It opens a menu above the dock', async () => {
      await userEvent.click(await within(await dock()).findByRole('button', { name: 'Share' }, SOON));
    });
    await step('Click Your screen. Your screen, a board or the workspace, presented straight away', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Your screen/ }, SOON));
    });
    await step('Pick a tab, a window or your screen, then Share. The next step opens in the same menu. Then the browser asks which one', async () => {
      const menu = await screen.findByRole('dialog', { name: 'Share with everyone' }, SOON);
      await userEvent.click(await within(menu).findByRole('button', { name: 'A tab' }, SOON));
      await userEvent.click(await within(menu).findByRole('button', { name: 'Share' }, SOON));
    });
    await step('You’re presenting. Everyone sees what you see. Stop sharing is on your bar; anyone else can close it for themselves', async () => {
      await told('Everyone sees your tab.');
      await frame('Your screen, everyone sees it');
    });
    await step('Click Stop sharing. It stops for everyone, and the people take the stage back', async () => {
      await userEvent.click(await onBar(await frame('Your screen, everyone sees it'), 'Stop sharing'));
      await told('You stopped sharing.');
    });
  }
};

export const NotesTranscriptAndChat: PageStory = {
  name: '6.5 Notes, the transcript and chat, apart',
  ...launchReview({ cues: [...at(2, chats(PRIYA, 'I’ve put the launch plan in the workspace, under this call.')), ...at(4, chats(KOFI, 'The status page is mine from now on.'))] }),
  play: async ({ userEvent, step }) => {
    await step('Click Chat, at the top right. Chat has a panel of its own, with nothing else in it', async () => {
      await dock();
      await userEvent.click(await screen.findByRole('button', { name: 'Chat, 2 new' }, LATER));
    });
    await step('It’s only messages, encrypted end to end. Notes is the button beside it', async () => {
      await screen.findByRole('complementary', { name: 'Chat' }, SOON);
      await screen.findByText('The status page is mine from now on.', {}, SOON);
    });
    await step('Click Notes. This call’s notes, the same pages the workspace keeps: the notes, the transcript and Ask', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Notes' }, SOON));
      await notesPanel();
    });
    await step('Click Transcript. The whole call so far, with who’s talking at the end', async () => {
      await userEvent.click(within(await notesPanel()).getByRole('tab', { name: 'Transcript' }));
      await screen.findByText(/Shall we start with the empty states/, {}, SOON);
    });
    await step('Click Ask. Catch up lives here: ask what you missed, or anything about the call', async () => {
      await userEvent.click(within(await notesPanel()).getByRole('tab', { name: 'Ask' }));
    });
    await step('Click Open, at the top of Notes. The workspace opens on these notes, just for you, as Workspace at the top right would. Present brings everyone', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Open the workspace on these notes' }, SOON));
      await onBar(await frame(yours, LATER), 'Present');
    });
  }
};

export const EverythingElse: PageStory = {
  name: '6.6 Everything else',
  ...launchReview({ cues: at(8, shares(PRIYA, CHECKLIST)) }),
  play: async ({ userEvent, step }) => {
    await step('Click More. Captions, marking a moment, catching up and breakout rooms, then a floating call, another device and Settings', async () => {
      await userEvent.click(await within(await dock()).findByRole('button', { name: MORE }, SOON));
      await screen.findByRole('button', { name: 'Catch up on what you missed' }, SOON);
    });
    await step('Click Settings. One window: Audio and video, Video quality, Sounds, Notifications, and Call, which is the organizer’s', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Settings' }, SOON));
      await screen.findByRole('dialog', { name: 'Settings' }, SOON);
    });
    await step('Click Call. Lock the call, and pointing at shared screens, for everyone here', async () => {
      await userEvent.click(await screen.findByRole('tab', { name: 'Call' }, SOON));
      await screen.findByRole('switch', { name: 'Lock the call' }, SOON);
    });
    await step('Close Settings. The stage lays itself out: drag a tile to move it, or its corner to make it bigger', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Close settings' }, SOON));
      await away('dialog', 'Settings');
    });
    await step('Click the faces. People opens on your side: who’s here and who’s asking to join. The organizer starts breakout rooms here too', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^People in this call/ }, SOON));
      await screen.findByRole('complementary', { name: 'People' }, SOON);
    });
    await step('Priya shares her screen. As the organizer, click the name of Priya’s share. Priya’s bar has Close for you, like anyone’s', async () => {
      await userEvent.click(await nameOf(await frame(/^Priya’s screen, everyone sees it$/, LATER)));
    });
    await step('Stop it for everyone is in its menu. Only the organizer has it, apart from Close', async () => {
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop it for everyone' }, SOON));
      await told('You stopped Priya’s share for everyone. Priya is told it was you.');
    });
  }
};

export const OnAPhone: PageStory = {
  name: '6.7 On a phone',
  ...phone(launchReview({ cues: at(10, presentsWorkspace(PRIYA)) })),
  play: async ({ userEvent, step }) => {
    await step('Tap More. Chat and the people are at the top; everything else is in More', async () => {
      await userEvent.click(await within(await dock()).findByRole('button', { name: MORE }, SOON));
    });
    await step('Board and Workspace come first, then Notes, Chat and People. Tap Workspace', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Workspace/ }, SOON));
    });
    await step('It opens just for you, under the faces. Present brings everyone with you', async () => {
      await frame(yours, LATER);
    });
    await step('Tap Present. Everyone follows you', async () => {
      await userEvent.click(await onBar(await frame(yours), 'Present'));
      await told('Everyone follows you in the workspace. They can unfollow to work alongside you.');
    });
    await step('Tap Close. For you, or for everyone, as a sheet', async () => {
      await userEvent.click(await onBar(await frame(everyones), /^Close /));
      await forEveryone();
    });
    await step('Tap For everyone. Then, when Priya presents the workspace, you follow Priya. Unfollow and Close are on the bar', async () => {
      await userEvent.click(await forEveryone());
      await told('Closed for everyone.');
      await screen.findByText('Priya is presenting the workspace, and you’re following.', {}, LATER);
      await onBar(await frame(everyones), 'Unfollow Priya');
    });
  }
};

/* ---------- the call's other journeys ---------- */

export const NotesAsYouTalk: PageStory = {
  name: '6.8 Notes as you talk',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK, every: 3 }, summary: REVIEW_SUMMARY } }, { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('The notes sign says Notes on, the same for everyone. The Notes panel sits beside the stage', async () => {
      await dock();
      await notesPanel();
    });
    await step('As people talk, what’s decided and the follow-ups fill in, read from the transcript', async () => {
      await within(await notesPanel()).findByText(/Every empty list gets one line and the empty arch/, {}, LATER);
    });
    await step('AI follow-ups wait under a quiet suggestion count. Add the copy task before ticking it', async () => {
      await userEvent.click(await within(await notesPanel()).findByRole('button', { name: /suggestions? from the call/ }, LATER));
      const proposals = await within(await notesPanel()).findByRole('region', { name: 'Suggestions from the call' }, SOON);
      const add = within(proposals).getAllByRole('button', { name: 'Add' })[0];
      if (add) await userEvent.click(add);
      await userEvent.click(await within(await notesPanel()).findByRole('checkbox', { name: /Write the copy for each empty state/ }, LATER));
    });
    await step('The transcript, each line a moment after it’s said', async () => {
      await userEvent.click(within(await notesPanel()).getByRole('tab', { name: 'Transcript' }));
      await screen.findByText(/Shall we start with the empty states/, {}, SOON);
    });
  }
};

export const PauseTheNotes: PageStory = {
  name: '6.9 Pause the notes, and resume them',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } }, { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('The notes sign opens what’s captured: each kind, its state, and who gets the notes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Notes on/ }, LATER));
    });
    await step('Pause notes. Nothing is recorded, transcribed or sent to the AI until you resume', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Pause notes' }, SOON));
      await screen.findByRole('button', { name: /^(Notes paused|Pausing)/ }, LATER);
    });
    await step('Resume notes. Everyone is told, each time', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Notes paused/ }, LATER));
      await userEvent.click(await screen.findByRole('button', { name: 'Resume notes' }, SOON));
      await screen.findByRole('button', { name: /^Notes on/ }, LATER);
    });
  }
};

export const SomeoneAsksToJoin: PageStory = {
  name: '6.10 Someone asks to join',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY, cues: at(4, knocks(DIEGO)) } }, { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Diego asks to join. A card drops in, and stays until it’s answered', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Let in/ }, LATER));
    });
    await step('Let in: Diego is in the call', async () => {
      await screen.findByRole('group', { name: /^Diego/ }, LATER);
    });
  }
};

export const AskForNotes: PageStory = {
  name: '6.11 Ask for notes',
  ...inCall({
    scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-jny' },
    script: { here: [{ who: KOFI }, { who: AIKO }, { who: MAYA }], notes: 'off', talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY, cues: at(9, { do: 'notes', mode: 'on' }) }
  }, { globals: LAPTOP }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('At Priya’s check-in, notes are off. Anyone can ask for them, from Notes at the top right', async () => {
      await reach('Notes')(c);
      await userEvent.click(await screen.findByRole('button', { name: 'Ask for notes' }, SOON));
    });
    await step('Everyone sees who asked, and Priya turns them on', async () => {
      await screen.findByRole('button', { name: /^Notes on/ }, LATER);
    });
  }
};

export const CatchUp: PageStory = {
  name: '6.12 Catch up',
  ...inCall({
    scenario: 'call-soon', call: REVIEW,
    script: { here: REVIEWERS, since: 7 * 60, earlier: REVIEW_TALK.slice(0, 9), talk: { lines: REVIEW_TALK.slice(9) }, summary: REVIEW_SUMMARY }
  }, { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Joined seven minutes late. Catch up, in More, reads what you most likely missed, for you alone', async () => {
      await userEvent.click(await screen.findByRole('button', { name: MORE }, LATER));
      await userEvent.click(await screen.findByRole('button', { name: 'Catch up on what you missed' }, SOON));
    });
    await step('What was decided, suggested and left open, each with the times it was said', async () => {
      await screen.findAllByText(/Every empty list gets one line and the empty arch/, {}, LATER);
    });
    await step('Back to live returns to the call as it was', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Back to live' }, LATER));
    });
  }
};

/* ---------- the people: a raised hand, a nudge, a status, and People ---------- */

/** The dock's Raise your hand, or on a phone the same row in More. */
async function raiseHand({ userEvent }: Context): Promise<void> {
  const [hand] = screen.queryAllByRole('button', { name: 'Raise your hand' });
  if (hand) { await userEvent.click(hand); return; }
  await userEvent.click(await screen.findByRole('button', { name: /^More/ }, SOON));
  await userEvent.click(await screen.findByRole('button', { name: 'Raise your hand' }, SOON));
}
/** Someone's ⋯, on their tile, or in their row in People once that's open: their menu, once its rows are still. */
async function optionsFor({ userEvent }: Context, name: string | RegExp): Promise<void> {
  const people = screen.queryByRole('complementary', { name: 'People' });
  const [more] = people ? await within(people).findAllByRole('button', { name }, SOON) : await screen.findAllByRole('button', { name }, LATER);
  if (more) await userEvent.click(more);
  await still(await screen.findByRole('dialog', { name }, SOON));
}
export const RaiseYourHand: PageStory = {
  ...inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA, hand: true }, { who: KOFI, hand: true }, { who: AIKO }] } }),
  name: '6.14 Raise your hand, and take turns',
  play: async (c) => {
    await c.step('Priya and Kofi have their hands up. People lists them first, in the order they went up', async () => { await reach('People')(c); await screen.findAllByText(/Hand raised/, {}, SOON); });
    await c.step('As the host, lower Priya’s hand from her ⋯ once she’s had her turn', async () => {
      await optionsFor(c, 'Options for Priya Raman');
      await c.userEvent.click(await screen.findByRole('button', { name: 'Lower hand' }, SOON));
    });
    await c.step('Raise your own hand. Everyone sees it on your tile, and you go to the top of People after Kofi', async () => {
      await raiseHand(c);
      await screen.findAllByRole('button', { name: 'Lower your hand' }, SOON);
    });
  }
};
export const RaiseYourHandPhone = phone(RaiseYourHand);
export const SharedQuestions: PageStory = {
  ...launchReview({ cues: at(.2, asks(PRIYA, 'Which teams are included in the first launch?', { votes: 3 }), asks(KOFI, 'Can the status page go out before the announcement?', { votes: 1, anonymous: true })) }),
  name: '6.15 Ask, vote and resolve questions in Chat',
  play: async (c) => {
    await c.step('Open Chat, then Questions: the room’s questions, the most voted first. Notes’ Ask stays private', async () => {
      await reach('Chat')(c);
      await c.userEvent.click(await screen.findByRole('tab', { name: /^Questions/ }, SOON));
    });
    await c.step('Ask anonymously: nobody is told it’s yours, whoever hosts included, and only you see Take back', async () => {
      await c.userEvent.type(await screen.findByRole('textbox', { name: 'Ask everyone in this room a question' }, SOON), 'Who will follow up after the first rollout?');
      await c.userEvent.click(await screen.findByRole('switch', { name: 'Ask anonymously' }, SOON));
      await c.userEvent.click(await screen.findByRole('button', { name: 'Ask anonymously' }, SOON));
      await screen.findByRole('button', { name: 'Take back your question' }, SOON);
    });
    await c.step('Vote for Priya’s question; the order you’re reading in stays put', async () => {
      const [vote] = await screen.findAllByRole('button', { name: /^Vote for this question/ }, SOON);
      if (vote) await c.userEvent.click(vote);
    });
    await c.step('As whoever hosts, pin a question, then mark it answered', async () => {
      const [pin] = await screen.findAllByRole('button', { name: 'Pin question' }, SOON); if (pin) await c.userEvent.click(pin);
      const [answer] = await screen.findAllByRole('button', { name: 'Mark question answered' }, SOON); if (answer) await c.userEvent.click(answer);
    });
    await c.step('Show answered brings it back, marked Answered', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: /^Show answered/ }, SOON));
      await screen.findByText('Answered', {}, SOON);
    });
  }
};
export const NudgeSomeone: PageStory = {
  ...inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: REVIEWERS, cues: [...at(6, nudges(PRIYA, 'slow-down')), ...at(8, nudges(AIKO, 'slow-down'))] } }),
  name: '6.16 Nudge someone quietly',
  play: async (c) => {
    await c.step('Kofi is hard to hear. His ⋯ has Nudge Kofi', async () => {
      await optionsFor(c, 'Options for Kofi Asante');
      await c.userEvent.click(await screen.findByRole('button', { name: 'Nudge Kofi' }, SOON));
      await still(await screen.findByRole('dialog', { name: 'Options for Kofi Asante' }, SOON));
    });
    await c.step('Only Kofi sees it: tell him you can’t hear him', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Can’t hear you' }, SOON));
      await screen.findByText('Kofi got your nudge: Can’t hear you', {}, SOON);
    });
    await c.step('Priya, then Aiko, ask you to slow down. You get one note that says how many', async () => {
      await screen.findByText('2 people ask you to slow down a little', {}, LATER);
    });
  }
};
export const NudgeSomeonePhone = phone(NudgeSomeone);
export const LetSomeoneIn: PageStory = {
  ...inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: REVIEWERS, cues: at(.2, knocks(DIEGO)) } }), name: '6.17 Let someone in from People',
  play: async (c) => {
    await c.step('The faces at the top right count Diego asking to join. People opens with him first', async () => {
      await reach('People')(c);
      await screen.findByText(/^Asking to join/, {}, LATER);
    });
    await c.step('Let Diego in; he moves to In this call', async () => { await c.userEvent.click(await screen.findByRole('button', { name: 'Let in' }, SOON)); });
  }
};
export const LetSomeoneInPhone = phone(LetSomeoneIn);
export const SetYourStatus: PageStory = {
  ...inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: REVIEWERS } }), name: '6.34 Set your status',
  play: async (c) => {
    await c.step('Your own tile’s ⋯ opens Set a status', async () => { await optionsFor(c, /^Options for .+ \(you\)$/); });
    await c.step('Be right back, back in five minutes', async () => {
      await c.userEvent.click(await screen.findByRole('menuitemradio', { name: 'Be right back' }, SOON));
      await still(await screen.findByRole('dialog', { name: /^Options for .+ \(you\)$/ }, SOON));
      await c.userEvent.click(await screen.findByRole('button', { name: '5 min' }, SOON));
    });
    await c.step('Everyone sees it on your tile with the time you’re back, and in People, until it runs out', async () => { await screen.findAllByText(/^Be right back · /, {}, SOON); });
    await c.step('Back early: I’m back clears it for everyone', async () => {
      await optionsFor(c, /^Options for .+ \(you\)$/);
      await c.userEvent.click(await screen.findByRole('button', { name: 'I’m back' }, SOON));
    });
  }
};
export const SetYourStatusPhone = phone(SetYourStatus);
export const FindSomeone: PageStory = {
  ...inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: REVIEWERS } }), name: '6.35 Find someone, and write to them',
  play: async (c) => {
    await c.step('Find someone in People by name', async () => {
      await reach('People')(c);
      await c.userEvent.type(await screen.findByRole('searchbox', { name: 'Find someone in this call' }, SOON), 'ko');
    });
    await c.step('Message Kofi privately, from his row: Chat opens with only you and Kofi', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Message Kofi privately' }, SOON));
    });
  }
};
export const FindSomeonePhone = phone(FindSomeone);

export const MentionSomeone: PageStory = {
  name: '6.13 Mention someone in chat',
  ...launchReview({ cues: at(2, chats(AIKO, '@Art Vandelay, can you review the launch checklist?', ['me'])) }),
  play: async (c) => {
    const { userEvent, step } = c;
    await step('Aiko mentions you. Chat says there is something unread while you carry on in the call', async () => {
      await dock();
      await screen.findByRole('button', { name: /^Chat, / }, LATER);
    });
    await step('Open Chat and read the message addressed to you. Reading it clears its mention attention', async () => {
      await reach('Chat')(c);
      await screen.findByText('@Art Vandelay', {}, SOON);
    });
    await step('Type @ and choose Priya with the keyboard. Only people who can read this room are offered', async () => {
      await userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }, SOON), '@Pri');
      await userEvent.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    });
    await step('Send the message. The selected person stays highlighted in the sent message', async () => {
      await userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }, SOON), 'I’ll review it now.');
      await userEvent.click(await screen.findByRole('button', { name: 'Send to everyone' }, SOON));
      await screen.findByText(`@${PRIYA.name}`, {}, SOON);
    });
  }
};

export const ReactOnScreen: PageStory = {
  name: '6.36 React',
  ...launchReview({ cues: [...at(4, floats(PRIYA, 'party')), ...at(5, floats(KOFI, 'heart'))] }),
  play: async ({ userEvent, step }) => {
    await step('Click React, in the dock. The eight emoji open above it, and stay open', async () => {
      await userEvent.click(await within(await dock()).findByRole('button', { name: 'React' }, SOON));
      await screen.findByRole('group', { name: 'Send a reaction everyone sees' }, SOON);
    });
    await step('Press a few. Each floats up from the foot of the call and fades within two seconds, with the others’, and nobody’s name goes with it', async () => {
      const picker = await screen.findByRole('group', { name: 'Send a reaction everyone sees' }, SOON);
      for (const name of ['heart', 'celebrate', 'thumbs up']) await userEvent.click(within(picker).getByRole('button', { name }));
    });
  }
};
