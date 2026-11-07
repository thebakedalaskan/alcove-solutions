/*
 * Presenting a board (docs: Calls and recordings › Presenting a board, user-flows 6): frames are slides, in order, with nothing to
 * prepare. Whoever presents sees the frame as everyone does, on their stage, with a pager at its foot (where everyone is, back and
 * next, and their own notes on each frame, in their side), and Close asks whether it's for them or for everyone; everyone else
 * follows them, with Unfollow to look around on their own and Follow to come back, and the organizer can close it for everyone.
 * After rooms close, each room's frame is a slide. The journeys play the canvas's Present, watching, the organizer closing
 * someone else's, its rooms coming back to be presented, and presenting from the keyboard.
 */
import type { BreakoutBoard, CallSession } from '@alcove/api';
import { addObject, readBoard, type StickyColour } from '@alcove/board';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import type * as Y from 'yjs';
import { at } from '../../src/api/script';
import { boardDoc, keepFrameNotes } from '../../src/api/workspaces';
import { inCall, light, phone, plays } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { LATER, SOON, close, closeFor, frameMenu, frameOf, openCallBoard, present, toldThat, type Context, type Play } from './plays';
import { AIKO, CHECK_IN, KOFI, MAYA, PRIYA, REVIEW } from './talk';

const meta = { title: 'Calls/Presenting a board', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const EACH: BreakoutBoard = { mode: 'each', template: 'what-why-next' };

/** The canvas's retro, a few minutes in: what went well, what could improve, and what's being done about it. */
const RETRO: Record<string, readonly [StickyColour, readonly string[]]> = {
  'Went well': ['butter', ['Beta sign-ups beat the plan', 'Support ran launch day with no queue', 'Design and engineering paired on the importer', 'Pricing page shipped a week early', 'No rollbacks']],
  'Could improve': ['rose', ['Nobody owned the status page', 'Changelog went out after the launch post', 'QA found the billing bug on launch day', 'Staging data was two days stale']],
  Actions: ['sky', ['One owner for launch comms', 'Refresh staging every night', 'Write the launch runbook']]
};
/** Fills a retro's frames with the canvas's stickies, two to a row, as people's browsers would have put them. */
function fillRetro(doc: Y.Doc): void {
  for (const frame of readBoard(doc).frames) {
    const [c, words] = RETRO[frame.title] ?? ['butter', []];
    words.forEach((t, i) => addObject(doc, { k: 'note', x: frame.x + 20 + (i % 2) * 170, y: frame.y + 20 + Math.floor(i / 2) * 170, w: 150, h: 150, c, size: 'm', t }, 'story'));
  }
}
/** What you keep beside each of the retro's frames, as the canvas has them. */
const NOTES: Record<string, string> = {
  'Went well': 'Start with what we’d repeat. Thank Maya’s team for launch day.',
  'Could improve': 'Ask Priya to take the changelog point.'
};

/** You open the retro in your design review, filled in, and present it from `section`, with your notes beside its frames. */
const presenting = (section: number) => (s: CallSession): void => {
  void (async () => {
    await s.openBoard({ template: 'retro' });
    const open = s.getSnapshot().board.open;
    if (!open?.workspaceId || !open.documentId) return;
    const doc = boardDoc(open.workspaceId, open.documentId);
    fillRetro(doc);
    for (const frame of readBoard(doc).frames) {
      const said = NOTES[frame.title];
      if (said) keepFrameNotes(open.documentId, frame.id, said);
    }
    await s.startPresenting({ kind: 'board', id: open.documentId, section });
  })();
};
/** The retro open in your design review, filled in, for you to open from Board and present. */
const retroOpen = (s: CallSession): void => {
  void s.openBoard({ template: 'retro' }).then(() => {
    const open = s.getSnapshot().board.open;
    if (open?.workspaceId && open.documentId) fillRetro(boardDoc(open.workspaceId, open.documentId));
  });
};
/** A board made in the design review is named after it; at Priya's check-in, after hers. */
const YOURS = 'Design review';
const HERS = 'Launch check-in';
/** Priya's check-in: she opens the retro a second in, and presents it a second later. */
const priyaPresents = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: { here: [{ who: KOFI }, { who: AIKO }, { who: MAYA }], cues: [...at(1, { do: 'open-board', who: PRIYA, template: 'retro', draw: fillRetro }), ...at(2, { do: 'present', who: PRIYA })] }
});
/** One labelled step of a play. */
const step = (label: string, run: (c: Context) => Promise<unknown>): Play => async (c) => { await c.step(label, async () => { await run(c); }); };
const onTheBoard = step('Press Board, then the retro in this call: it opens just for you', (c) => openCallBoard(c, YOURS));
const following = step('Priya presents the retro: you follow her, on the frame she’s on', () => frameOf(HERS));

/* ---------- Presenting ---------- */

/** You present the retro: the frame as everyone sees it, with the pager at its foot (1 of 3, Went well), and your notes a press away. */
export const YouPresent = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(0) });
/** On to the next frame: Could improve, everyone with you. */
export const YouPresentTheNextFrame = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(1) });
/** On a phone the frame fills the screen under the faces, and the pager stays at its foot. */
export const YouPresentPhone = phone(YouPresent);
/** In a light theme the board you present is light, as everyone's own board is, and the stage round it night. */
export const YouPresentLight = light(YouPresent);
/** Your notes on each frame, in your side: only yours, kept for next time, with the next frame under them. */
export const YourNotes: PageStory = {
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(1) }, {
    play: step('Press Your notes, at its foot', async (c) => { await c.userEvent.click(await screen.findByRole('button', { name: 'Your notes, only you see them' }, LATER)); })
  }),
  name: 'Your notes'
};
/** While you present, Board at the top right, or O, is Close: it asks whether it's for you or for everyone, as Close does. */
export const ClosingItWhileYouPresent: PageStory = {
  ...YouPresent,
  play: plays(
    step('You present the retro', () => screen.findByText('1 of 3', {}, LATER)),
    step('Press O: Close asks, for you or for everyone', async (c) => {
      await c.userEvent.keyboard('o');
      await screen.findByRole('dialog', { name: `Close ${YOURS}` }, SOON);
    })
  )
};

/* ---------- Watching ---------- */

/** Priya presents: you see the frame she's on, following her, and the bar says so, with Unfollow. */
export const PriyaPresents = priyaPresents;
/** Unfollow: your own view back, with the tools, and Follow Priya says where she is. Priya moving on doesn't move you. */
export const Unfollowing: PageStory = {
  ...priyaPresents,
  play: plays(following, step('Press Unfollow, on its bar', async (c) => { await c.userEvent.click(await screen.findByRole('button', { name: 'Unfollow Priya' }, SOON)); }))
};
export const PriyaPresentsPhone = phone(PriyaPresents);
/** In your own call, Priya presents: as the organizer, its name's menu has Close it for everyone, as anyone's does. */
export const PriyaPresentsInYourCall = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, cues: [...at(1, { do: 'open-board', who: PRIYA, template: 'retro', draw: fillRetro }), ...at(2, { do: 'present', who: PRIYA })] }
}, { play: step('Press its name, on its frame', (c) => frameMenu(c, YOURS)) });

/* ---------- The journeys ---------- */

const yourNotes = async (c: Context, words: string) => {
  await c.userEvent.type(await screen.findByRole('textbox', { name: /^Your notes on/ }, SOON), words);
};
/** The journey: the retro's full; open it, Present, and frames are slides: Next frame, your notes, and Close for everyone puts everyone back. */
export const JourneyPresent = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: retroOpen }, {
  name: '1. Present',
  play: plays(
    onTheBoard,
    step('Press Present on its bar: everyone follows you, and you’re on 1 of 3', async (c) => { await present(c, YOURS); await screen.findByText('1 of 3', {}, SOON); }),
    step('Press Your notes, at its foot, and write beside this frame', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Your notes, only you see them' }, SOON));
      await yourNotes(c, 'Thank Maya’s team for launch day.');
    }),
    step('Press Next frame: its notes are its own', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Next frame' }, SOON));
      await screen.findByText('2 of 3', {}, SOON);
      await yourNotes(c, 'Ask Priya to take the changelog point.');
    }),
    step('Press Back a frame: the first frame’s notes are as you left them', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Back a frame' }, SOON));
      await screen.findByDisplayValue('Thank Maya’s team for launch day.', {}, SOON);
    }),
    step('Press Close, then For everyone: it closes for everyone', async (c) => {
      await close(c, YOURS);
      await closeFor(c, YOURS, 'For everyone');
      await toldThat('Closed for everyone.', SOON);
    })
  )
});
/** The journey: Priya presents, you unfollow to look around on your own, and Follow Priya puts you on the frame she's on. */
export const JourneyWatching: PageStory = {
  ...priyaPresents, name: '2. Watching',
  play: plays(
    following,
    step('Press Unfollow: you look around on your own', async (c) => { await c.userEvent.click(await screen.findByRole('button', { name: 'Unfollow Priya' }, SOON)); }),
    step('Press Follow Priya: back on her frame', async (c) => { await c.userEvent.click(await within(await frameOf(HERS)).findByRole('button', { name: /^Follow Priya/ }, SOON)); }),
    step('Following her again', () => screen.findByRole('button', { name: 'Unfollow Priya' }, SOON))
  )
};
/** The journey: Priya presents in your call; as the organizer you close it for everyone from its name's menu, and it's gone from every stage. */
export const JourneyOrganizerCloses: PageStory = {
  ...PriyaPresentsInYourCall, name: '3. Closing someone else’s',
  play: plays(
    step('Priya presents: its name’s menu has Close it for everyone, for the organizer', (c) => frameMenu(c, YOURS)),
    step('Press Close it for everyone', async (c) => { await c.userEvent.click(await screen.findByRole('menuitem', { name: 'Close it for everyone' }, SOON)); }),
    step('It closes for everyone', () => toldThat('Closed for everyone.', SOON))
  )
};
/**
 * The journey from the keyboard: Enter on Present presents, → moves everyone on while the pager has the keys, and Close's question
 * is a Tab and an Enter away.
 */
export const JourneyFromTheKeyboard = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: retroOpen }, {
  name: '5. From the keyboard',
  play: plays(
    onTheBoard,
    step('Tab to Present on its bar and press Enter: you present', async (c) => {
      (await within(await frameOf(YOURS)).findByRole('button', { name: 'Present' }, LATER)).focus();
      await c.userEvent.keyboard('{Enter}');
      await screen.findByText('1 of 3', {}, SOON);
    }),
    step('Press →: everyone moves on with you', async (c) => {
      (await screen.findByRole('button', { name: 'Next frame' }, SOON)).focus();
      await c.userEvent.keyboard('{ArrowRight}');
      await screen.findByText('2 of 3', {}, SOON);
    }),
    step('Tab to Close on its bar and press Enter: it asks, for you or for everyone', async (c) => {
      (await within(await frameOf(YOURS)).findByRole('button', { name: `Close ${YOURS}` }, SOON)).focus();
      await c.userEvent.keyboard('{Enter}');
      await screen.findByRole('dialog', { name: `Close ${YOURS}` }, SOON);
    })
  )
});
/** The journey: rooms close, each room's board lands as a frame, and presenting it, each room's frame is a slide. */
export const JourneyRoomsFramesAsSlides = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: {
    here: [{ who: KOFI }, { who: AIKO }, { who: MAYA }],
    cues: [
      ...at(2, {
        do: 'rooms', minutes: 10, board: EACH,
        rooms: [
          { name: 'Rollout', people: ['me', KOFI], work: ['Ten percent of teams on Monday', 'Tell the beta teams on Friday', 'Watch the error rate for a day'] },
          { name: 'Support', people: [AIKO, MAYA], work: ['A help article for the new flag', 'Macros for the first week'] }
        ]
      }),
      ...at(12, { do: 'close-rooms' })
    ]
  }
}, {
  name: '4. Rooms’ frames as slides',
  play: plays(
    step('Rooms close, and two boards come back', () => toldThat('Everyone’s back. 2 boards came with you.')),
    step('Press Present on its bar', (c) => present(c, HERS)),
    step('Each room’s frame is a slide: Rollout, 1 of 2', () => screen.findByText('1 of 2', {}, SOON)),
    step('Press Next frame: Support', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Next frame' }, SOON));
      await screen.findByText('2 of 2', {}, SOON);
    })
  )
});
