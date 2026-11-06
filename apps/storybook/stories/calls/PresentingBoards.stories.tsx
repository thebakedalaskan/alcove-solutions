/*
 * Presenting a board (docs: Calls and recordings › Presenting a board, user-flows 6): frames are slides, in order, with
 * nothing to prepare. Whoever presents sees the frame as everyone does, ringed, with the next frame and their own notes beside
 * it, and the board stays in front of them until they stop; everyone else sees the frame alone, with no tools, until they look
 * around, and Back to them is one press. After rooms close, each room's frame is a slide. The journeys play the canvas's
 * Present, its rooms coming back to be presented, and presenting from the keyboard.
 */
import type { BreakoutBoard, CallSession } from '@alcove/api';
import { addObject, readBoard, type StickyColour } from '@alcove/board';
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor } from 'storybook/test';
import type * as Y from 'yjs';
import { at } from '../../src/api/script';
import { boardDoc, keepFrameNotes } from '../../src/api/workspaces';
import { inCall, light, phone } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, CHECK_IN, KOFI, MAYA, PRIYA, REVIEW } from './talk';

const meta = { title: 'Calls/Presenting a board', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const EACH: BreakoutBoard = { mode: 'each', template: 'what-why-next' };
const SOON = { timeout: 10000 };
const LATER = { timeout: 40000 };
type Play = NonNullable<PageStory['play']>;

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
    await s.startPresenting('board', open.documentId, section);
  })();
};
/** The retro open in your design review, filled in, for you to present. */
const retroOpen = (s: CallSession): void => {
  void s.openBoard({ template: 'retro' }).then(() => {
    const open = s.getSnapshot().board.open;
    if (open?.workspaceId && open.documentId) fillRetro(boardDoc(open.workspaceId, open.documentId));
  });
};
/** Priya's check-in: she opens the retro for everyone a second in, and presents it a second later. */
const priyaPresents = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: { here: [{ who: KOFI }, { who: AIKO }, { who: MAYA }], cues: [...at(1, { do: 'open-board', who: PRIYA, template: 'retro', draw: fillRetro }), ...at(2, { do: 'present', who: PRIYA })] }
});

/* ---------- Presenting ---------- */

/** You present the retro: the frame as everyone sees it, ringed, with 1 of 3 and the way on under it, and the next frame and your notes on this one beside it. */
export const YouPresent = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(0) });
/** On to the next frame: Could improve, everyone with you, and the notes you keep beside that one. */
export const YouPresentTheNextFrame = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: presenting(1) });
/** On a narrow stage your notes go under the frame, and the next frame waits for a wider one. */
export const YouPresentPhone = phone(YouPresent);
/** In a light theme the board you present is light, as everyone's own board is, and the stage round it night. */
export const YouPresentLight = light(YouPresent);
/**
 * While you present, the board stays in front of you, so you always see what everyone sees: O, or Board in the dock, says to
 * stop presenting first, and nothing hides.
 */
export const HidingItWhileYouPresent: PageStory = {
  ...YouPresent,
  play: (async ({ userEvent, step }) => {
    await step('You present the retro', async () => { await screen.findByText('1 of 3', {}, LATER); });
    await step('Press O: the board stays in front of you, and you’re told to stop presenting first', async () => {
      await userEvent.keyboard('o');
      await screen.findByText('Stop presenting first. Everyone sees this board while you present it.', {}, SOON);
    });
  }) satisfies Play
};

/* ---------- Watching ---------- */

/** Priya presents: you see the frame alone, with no tools and no handles, and the pill says who's presenting, with Look around. */
export const PriyaPresents = priyaPresents;
/** Look around: your own view back, with the tools, and Back to Priya in the pill. Priya moving on doesn't move you. */
export const LookingAround: PageStory = {
  ...priyaPresents,
  play: (async ({ userEvent, step }) => {
    await step('Priya is presenting', async () => { await screen.findByText('Priya is presenting', {}, LATER); });
    await step('Press Look around', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Look around' }, SOON)); });
  }) satisfies Play
};
export const PriyaPresentsPhone = phone(PriyaPresents);
/** In your own call, Priya presents: as the organizer you can stop it, from the pill, as you can anyone's. */
const priyaPresentsInYours = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, cues: [...at(1, { do: 'open-board', who: PRIYA, template: 'retro', draw: fillRetro }), ...at(2, { do: 'present', who: PRIYA })] }
});
export const PriyaPresentsInYourCall = priyaPresentsInYours;

/* ---------- The journeys ---------- */

/** The journey: the retro's full, Present, and frames are slides: Next frame, your notes, and Stop presenting puts everyone back. */
export const JourneyPresent = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: retroOpen }, {
  name: '1. Present',
  play: async ({ userEvent, step }) => {
    await step('Press Present on the board’s bar', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Present' }, LATER)); });
    await step('You see what everyone sees, ringed, 1 of 3', async () => { await screen.findByText('Everyone sees this', {}, SOON); await screen.findByText('1 of 3', {}, SOON); });
    await step('Write your notes beside this frame', async () => { await userEvent.type(await screen.findByRole('textbox', { name: 'Your notes' }, SOON), 'Thank Maya’s team for launch day.'); });
    await step('Press Next frame: its notes are its own', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Next frame' }, SOON));
      await screen.findByText('2 of 3', {}, SOON);
      await userEvent.type(await screen.findByRole('textbox', { name: 'Your notes' }, SOON), 'Ask Priya to take the changelog point.');
    });
    await step('Press Back a frame: the first frame’s notes are as you left them', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Back a frame' }, SOON));
      await screen.findByDisplayValue('Thank Maya’s team for launch day.', {}, SOON);
    });
    await step('Press Stop presenting', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Stop presenting' }, SOON)); });
    await step('Everyone’s back where they were', async () => { await screen.findByText('You stopped presenting. Everyone’s back where they were.', {}, SOON); });
  }
});
/** The journey: Priya presents, you look around on your own, and Back to Priya puts you on the frame she's on. */
export const JourneyWatching: PageStory = {
  ...priyaPresents, name: '2. Watching',
  play: (async ({ userEvent, step }) => {
    await step('Priya presents: the frame alone', async () => { await screen.findByText('Priya is presenting', {}, LATER); });
    await step('Press Look around', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Look around' }, SOON)); });
    await step('Press Back to Priya', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Back to Priya' }, SOON)); });
    await step('Back with everyone', async () => { await screen.findByRole('button', { name: 'Look around' }, SOON); });
  }) satisfies Play
};
/** The journey: Priya presents in your call; as the organizer you stop it from the pill, and everyone's back where they were. */
export const JourneyOrganizerStops: PageStory = {
  ...priyaPresentsInYours, name: '3. Stopping someone else’s',
  play: (async ({ userEvent, step }) => {
    await step('Priya presents: the pill has Stop presenting, for the organizer', async () => { await screen.findByText('Priya is presenting', {}, LATER); });
    await step('Press Stop presenting', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Stop presenting' }, SOON)); });
    await step('It stops for everyone', async () => { await screen.findByText('You stopped Priya’s presentation. Everyone’s back where they were.', {}, SOON); });
  }) satisfies Play
};
/**
 * The journey from the keyboard: Enter on Present puts the keys on Next frame, → moves everyone on while the presentation has
 * them, and Stop presenting puts them back on Present.
 */
export const JourneyFromTheKeyboard = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: retroOpen }, {
  name: '5. From the keyboard',
  play: async ({ userEvent, step }) => {
    await step('Tab to Present on the board’s bar and press Enter: you present, with the keys on Next frame', async () => {
      (await screen.findByRole('button', { name: 'Present' }, LATER)).focus();
      await userEvent.keyboard('{Enter}');
      await screen.findByText('1 of 3', {}, SOON);
      await waitFor(() => { if (document.activeElement?.getAttribute('aria-label') !== 'Next frame') throw new Error('The keys aren’t on Next frame yet.'); }, SOON);
    });
    await step('Press →: everyone moves on with you', async () => {
      await userEvent.keyboard('{ArrowRight}');
      await screen.findByText('2 of 3', {}, SOON);
    });
    await step('Tab to Stop presenting and press Enter: everyone’s back, and the keys are on Present again', async () => {
      await userEvent.keyboard('{Tab}{Enter}');
      await screen.findByText('You stopped presenting. Everyone’s back where they were.', {}, SOON);
    });
  }
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
  play: async ({ userEvent, step }) => {
    await step('Rooms close, and two boards come back', async () => { await screen.findByText('Everyone’s back. 2 boards came with you.', {}, LATER); });
    await step('Press Present on the board’s bar', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Present' }, SOON)); });
    await step('Each room’s frame is a slide: Rollout, 1 of 2', async () => { await screen.findByText('1 of 2', {}, SOON); });
    await step('Press Next frame: Support', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Next frame' }, SOON)); await screen.findByText('2 of 2', {}, SOON); });
  }
});
