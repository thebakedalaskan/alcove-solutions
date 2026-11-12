/*
 * Presenting a board (docs: Calls and recordings › Presenting a board, user-flows 6): the whole board stays the board, tools and
 * all, for everyone. Whoever presents moves round it freely, and steps from frame to frame with the pager at its foot (where they
 * are, back and next, in the order the frames sit, and their own notes on each frame, in their side), and Close asks whether it's
 * for them or for everyone; everyone else follows their view, their tools to hand, and anything of their own on the board takes
 * them off following, from where they are, with Follow to come back. The organizer can close it for everyone. After rooms close,
 * each room's frame is a stop on the pager. The journeys play Present, watching, the organizer closing someone else's, its rooms
 * coming back to be presented, presenting from the keyboard, adding to it while someone presents, and showing what's outside the
 * frames.
 */
import type { BreakoutBoard, CallSession } from '@alcove/api';
import { addObject, readBoard, type StickyColour } from '@alcove/board';
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import type * as Y from 'yjs';
import { at } from '../../src/api/script';
import { boardDoc, keepFrameNotes } from '../../src/api/workspaces';
import { inCall, light, phone, plays } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { LATER, SOON, close, closeFor, frameMenu, frameOf, openCallBoard, present, settle, toldThat, type Context, type Play } from './plays';
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
const onTheBoard = step('Press Board, then the retro in this call: it opens on your screen', (c) => openCallBoard(c, YOURS));
const following = step('Priya presents the retro: you follow her view, on the frame she’s on, your tools to hand', () => frameOf(HERS));

/* ---------- Presenting ---------- */

/**
 * You present the retro: the whole board, tools and all, glided to its first frame as the frames sit, with the pager at its foot
 * (1 of 3, Went well), and your notes a press away. Everyone following sees your view.
 */
export const YouPresent = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(0) });
/** On to the next frame: Could improve, everyone following you glides there with you. */
export const YouPresentTheNextFrame = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(1) });
/** On a phone the board fills the screen under the faces, on the frame, and the pager stays at its foot. */
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
/**
 * You present Could improve and press Vote, on the board's bar: it votes on the frame you show, the call tells everyone who can
 * vote in it, and everyone following you votes as they follow.
 */
export const YouStartAVote: PageStory = {
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(1) }, {
    play: plays(
      step('You present the retro, on Could improve', () => screen.findByText('2 of 3', {}, LATER)),
      step('Press Vote, on the board’s bar: it votes on the frame you show', async (c) => {
        await c.userEvent.click(await screen.findByRole('button', { name: 'Vote' }, SOON));
        await screen.findByRole('dialog', { name: 'Vote on Could improve' }, SOON);
      }),
      step('Start the vote: everyone following you votes as they follow, and whoever ends it is you, from the pill', async (c) => {
        await c.userEvent.click(await screen.findByRole('button', { name: 'Start the vote' }, SOON));
        await screen.findByText('3 of 3 votes left', {}, SOON);
      })
    )
  }),
  name: 'You start a vote'
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

/** Priya presents: you see her view, following her, with your tools to hand, and the bar says so, with Unfollow. */
export const PriyaPresents = priyaPresents;
/** Unfollow: your own view back, and Follow Priya says where she is. Priya moving on doesn't move you. */
export const Unfollowing: PageStory = {
  ...priyaPresents,
  play: plays(following, step('Press Unfollow, on its bar', async (c) => { await c.userEvent.click(await screen.findByRole('button', { name: 'Unfollow Priya' }, SOON)); }))
};
export const PriyaPresentsPhone = phone(PriyaPresents);
/** Priya presents Could improve and starts a vote there: you vote as you follow her, and your vote doesn't take you off following. */
export const PriyaStartsAVote: PageStory = {
  ...inCall({
    scenario: 'busy', call: CHECK_IN,
    script: {
      here: [{ who: KOFI }, { who: AIKO }, { who: MAYA }],
      cues: [...at(1, { do: 'open-board', who: PRIYA, template: 'retro', draw: fillRetro }), ...at(2, { do: 'present', who: PRIYA, section: 1 }), ...at(4, { do: 'start-vote', who: PRIYA, frame: 'Could improve', per: 3 })]
    }
  }, {
    play: plays(
      following,
      step('She starts a vote on the frame she shows. Press a sticky in it: one of your votes is on it', async (c) => {
        await screen.findByText('3 of 3 votes left', {}, LATER);
        await c.userEvent.click(await screen.findByText('Nobody owned the status page', {}, SOON));
        await screen.findByText('2 of 3 votes left', {}, SOON);
      }),
      step('A vote changes nothing on the board, so you’re still following her', () => screen.findByRole('button', { name: 'Unfollow Priya' }, SOON))
    )
  }),
  name: 'Priya starts a vote'
};
/** In your own call, Priya presents: as the organizer, its name's menu has Close it for everyone, as anyone's does. */
export const PriyaPresentsInYourCall = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, cues: [...at(1, { do: 'open-board', who: PRIYA, template: 'retro', draw: fillRetro }), ...at(2, { do: 'present', who: PRIYA })] }
}, { play: step('Press its name, on its frame', (c) => frameMenu(c, YOURS)) });

/* ---------- The journeys ---------- */

const yourNotes = async (c: Context, words: string) => {
  await c.userEvent.type(await screen.findByRole('textbox', { name: /^Your notes on/ }, SOON), words);
};
/** The journey: the retro's full; open it, Present, and its frames are stops: Next frame, your notes, and Close for everyone puts everyone back. */
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
/** The journey: Priya presents, you unfollow to look around on your own, and Follow Priya puts you back on her view. */
export const JourneyWatching: PageStory = {
  ...priyaPresents, name: '2. Watching',
  play: plays(
    following,
    step('Press Unfollow: you look around on your own', async (c) => { await c.userEvent.click(await screen.findByRole('button', { name: 'Unfollow Priya' }, SOON)); }),
    step('Press Follow Priya: back on her view', async (c) => { await c.userEvent.click(await within(await frameOf(HERS)).findByRole('button', { name: /^Follow Priya/ }, SOON)); }),
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
 * The journey from the keyboard: Enter on Present presents, and the keys go to Next frame on the pager as it comes, so → moves
 * everyone on; Close's question is a Tab and an Enter away.
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
    step('The keys are on Next frame. Press →: everyone moves on with you', async (c) => {
      await waitFor(() => { if (document.activeElement?.getAttribute('aria-label') !== 'Next frame') throw new Error('The keys aren’t on Next frame.'); }, SOON);
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
/** The journey: rooms close, each room's board lands as a frame, and presenting it, each room's frame is a stop, in the order they sit. */
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
    step('Each room’s frame is a stop: Rollout, 1 of 2', () => screen.findByText('1 of 2', {}, SOON)),
    step('Press Next frame: Support', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Next frame' }, SOON));
      await screen.findByText('2 of 2', {}, SOON);
    })
  )
});

/** Double-clicks inside a frame on the board, low on its right, where the retro leaves room: by the frame's title, as it is on screen. */
async function doubleClickIn(c: Context, title: string): Promise<void> {
  const heading = await within(await frameOf(HERS)).findByText(title, { selector: '.bf-h .t' }, LATER);
  const frame = heading.closest('[data-id]');
  const sheet = heading.closest('[role="application"]');
  if (!(frame instanceof HTMLElement) || !(sheet instanceof HTMLElement)) throw new Error(`${title} isn’t on the board.`);
  const r = frame.getBoundingClientRect();
  await c.userEvent.pointer({ keys: '[MouseLeft][MouseLeft]', target: sheet, coords: { clientX: r.right - r.width * 0.22, clientY: r.bottom - r.height * 0.12 } });
}
/**
 * The journey: Priya presents, and you add to it as she goes. Your tools are there all along: your first press, key, scroll or
 * drag on the board is your own, so it takes you off following her, from where you are, and does what you did.
 */
export const JourneyAddingWhileShePresents: PageStory = {
  ...priyaPresents, name: '6. Adding to it while she presents',
  play: plays(
    following,
    step('Double-click in Went well: a sticky, ready to type. That press was yours, so you’re working on your own from here', async (c) => {
      await settle();
      await doubleClickIn(c, 'Went well');
      await c.userEvent.keyboard('Paired on the importer again');
      await c.userEvent.keyboard('{Escape}');
    }),
    step('The bar says Follow Priya, and where she is: press it to follow her again', async () => {
      await within(await frameOf(HERS)).findByRole('button', { name: /^Follow Priya/ }, SOON);
    })
  )
};
/**
 * The journey: you present, and show what's outside the frames. You keep your tools: Templates › Flow puts a flow chart beside the
 * retro and your view goes to it, lines and all, and everyone following sees it with you. Next frame glides back to the frames.
 */
export const JourneyOutsideTheFrames = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(0) }, {
  name: '7. Showing what’s outside the frames',
  play: plays(
    step('You present the retro, on 1 of 3', () => screen.findByText('1 of 3', {}, LATER)),
    step('Press More, at the foot of the tools, then Templates', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: /^More: / }, SOON));
      await c.userEvent.click(await screen.findByRole('button', { name: 'Templates' }, SOON));
    }),
    step('Press Flow: it lands beside the frames, and your view goes there, everyone following with you', async (c) => {
      await c.userEvent.click(await screen.findByRole('menuitem', { name: 'Flow' }, SOON));
      await settle();
    }),
    step('Press Next frame: back to the frames, on Could improve', async (c) => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Next frame' }, SOON));
      await screen.findByText('2 of 3', {}, SOON);
    })
  )
});
