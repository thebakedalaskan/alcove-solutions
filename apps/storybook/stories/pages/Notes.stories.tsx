/* Notes: the search in the middle of the sky, the list on the water, and a preview beside it on a wide screen (user-flows 8). */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../src/call';
import { searched } from '../../src/api/trouble';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { noRoomNotes, takenOn, troubled } from './changes';

const meta = { title: 'Pages/Notes', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Types into the line in the sky, as a person would; `{Enter}` at the end asks. */
const typing = (text: string, said: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(said, async () => {
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Search everything said, or ask' }), text);
  });
};
/** Picks one of the filters under the line. */
const showing = (tab: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(`Show ${tab}`, async () => {
    await userEvent.click(await canvas.findByRole('tab', { name: tab }));
  });
};

export const Busy = page('/notes', 'busy');
export const BusyPhone = phone(Busy);
/** The wide preview shows the same pending done command as Home and its full note cache. */
export const FollowUpSaving = page('/notes', 'busy', {
  beforeEach: changing(takenOn, troubled({ 'notes.updateAction': 'hold' })),
  play: async ({ canvas, userEvent, step }) => {
    await step('8. Tick a follow-up in the selected note preview while saving', async () => {
      const [box] = await canvas.findAllByRole('checkbox', { name: /^Mark done:/ });
      if (box) await userEvent.click(box);
    });
  }
});
export const FollowUpSavingNight = { ...FollowUpSaving, globals: { theme: 'dark' } };
export const FirstDay = page('/notes', 'first-day');
export const Writing = page('/notes', 'writing');
export const OnTheirOwn = page('/notes', 'on-their-own');
export const Offline = page('/notes', 'offline');
export const Lots = page('/notes', 'lots');

/** Search finds the words: each row quotes the line that has them and who said it, with a chip for each moment. */
export const Search = page('/notes', 'busy', { play: typing('flag', 'Search for “flag”. Every note that says it, quoting where') });
/** Nothing has the words: Clear search. */
export const NothingMatches = page('/notes', 'busy', { play: typing('zebra crossing', 'Search for words no call has') });
/** Asking: every note is read in confidential compute, and the answer lands above the list, which follows what it cites. */
export const Asking = page('/notes', 'busy', { play: typing('What did we decide about the launch?{Enter}', 'Ask what was decided about the launch') });
/** The answer is still being written: the horizon pulses while the notes are read. */
export const StillAsking = page('/notes', 'busy', {
  beforeEach: changing(troubled({ 'notes.askAll': 'hold' })),
  play: typing('What did we decide about the launch?{Enter}', 'Ask, and the notes are read')
});
/** The search couldn't get an answer: Try again. */
export const SearchFailed = page('/notes', 'busy', {
  beforeEach: changing(troubled({ 'notes.list': (query) => (searched(query) ? 'failed' : null) })),
  play: typing('pricing', 'Search, and Alcove can’t answer')
});
/** The notes picked in the list don't open: the preview says so. A wide screen's: narrower, a note opens on its own page. */
export const PreviewFailed = page('/notes', 'busy', {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  beforeEach: changing(troubled({ 'notes.get': (id) => (id === 'n1' ? 'failed' : null) })),
  play: async ({ canvas, step }) => {
    await step('Alcove doesn’t answer for Art’s call. The preview tries twice more, then says so', async () => {
      await canvas.findByText('Couldn’t open these notes', {}, { timeout: 10000 });
    });
  }
});

/** Notes other people shared with Art after their calls. */
export const SharedWithYou = page('/notes', 'busy', { play: showing('Shared with you') });
/** Nothing shared yet. */
export const NothingShared = page('/notes', 'on-their-own', { play: showing('Shared with you') });
/** Recordings made in the room. */
export const InTheRoom = page('/notes', 'busy', { play: showing('In the room') });
/** Nothing recorded in the room yet: Record in the room. */
export const NothingInTheRoom = page('/notes', 'busy', { beforeEach: changing(noRoomNotes), play: showing('In the room') });
/** The notes Art has with Priya, from the Team page or the people under the line. */
export const WithSomeone = page('/notes#with=priya%40vandelay.industries', 'busy');
/** Nobody's notes with Sam yet: Show notes with anyone. */
export const NobodyWithThem = page('/notes#with=sam%40vandelay.industries', 'busy');
/** + finds anyone else you have notes with. */
export const WithSomeoneElse = page('/notes', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press +, beside the people under the line', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Notes with someone else' }));
    });
  }
});
