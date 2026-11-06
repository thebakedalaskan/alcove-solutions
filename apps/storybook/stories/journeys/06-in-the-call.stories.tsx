/*
 * Journeys in a call (docs/product/user-flows.md › 6. In the call), which the canvas never drew. The call is the call
 * stories' (src/call.ts and stories/calls/talk.ts): you're in it as the lobby leaves you, and everyone else, and the
 * server, play their part from its script. The states on the way are in Calls/; these go from one to the next.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at, knocks } from '../../src/api/script';
import { MORE, inCall, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, DIEGO, KOFI, MAYA, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from '../calls/talk';
import { LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/6 In the call', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const dock = () => screen.findByRole('toolbar', { name: 'Call controls' }, LATER);
const notesPanel = () => screen.findByRole('complementary', { name: 'Notes' }, LATER);

export const NotesAsYouTalk: PageStory = {
  name: '6.1 Notes as you talk',
  ...inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK, every: 3 }, summary: REVIEW_SUMMARY } }, { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('The notes sign says Notes on, the same for everyone. The Notes panel sits beside the stage', async () => {
      await dock();
      await notesPanel();
    });
    await step('As people talk, what’s decided and the follow-ups fill in, read from the transcript', async () => {
      await within(await notesPanel()).findByText(/Every empty list gets one line and the empty arch/, {}, LATER);
    });
    await step('Anyone who gets the notes can tick a follow-up, and it’s done for everyone', async () => {
      await userEvent.click(await within(await notesPanel()).findByRole('checkbox', { name: /Write the copy for each empty state/ }, LATER));
    });
    await step('The transcript, each line a moment after it’s said', async () => {
      await userEvent.click(within(await notesPanel()).getByRole('tab', { name: 'Transcript' }));
      await screen.findByText(/Shall we start with the empty states/, {}, SOON);
    });
  }
};

export const PauseTheNotes: PageStory = {
  name: '6.2 Pause the notes, and resume them',
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
  name: '6.3 Someone asks to join',
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
  name: '6.4 Ask for notes',
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
  name: '6.5 Catch up',
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
