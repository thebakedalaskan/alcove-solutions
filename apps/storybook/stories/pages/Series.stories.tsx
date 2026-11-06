/*
 * A series: the same evening as a note, its calls standing on the horizon, and what carries over from the calls you have
 * notes from: decided, still open, follow-ups. For the organizer, the next call (docs/design/pages.md, user-flows 8).
 */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs } from '../../src/page';
import { SERIES, inEveryState } from '../../src/world/states';
import { troubled } from './changes';

const meta = { title: 'Pages/A series', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The busy afternoon, with the standups, Maya's pricing syncs, the design reviews and a hiring panel in their series. */
const series = { beforeEach: changing(inEveryState) };

/** Art's weekly standup: three calls on the horizon, what's still open two calls later, and next week's call to join or change. */
export const Yours = page(`/notes/series/${SERIES.standup}`, 'busy', series);
export const YoursPhone = phone(Yours);
/** Maya's pricing sync, which Art is invited to: only the calls he has notes from, and no next call to change. */
export const Theirs = page(`/notes/series/${SERIES.pricing}`, 'busy', series);
/** Art's design reviews, with nothing scheduled next: Schedule next week's call. */
export const NothingNext = page(`/notes/series/${SERIES.design}`, 'busy', series);
/** The first call's notes are still being written: nothing carries over yet. */
export const BeingWritten = page(`/notes/series/${SERIES.panel}`, 'busy', series);

/** Asking across the calls: the answer cites the calls and moments it comes from. */
export const Asking = page(`/notes/series/${SERIES.standup}`, 'busy', {
  ...series,
  play: async ({ canvas, userEvent, step }) => {
    await step('Ask what’s still open across the calls', async () => {
      await userEvent.type(await canvas.findByRole('textbox', { name: /Ask about these calls/ }), 'What’s still open?{Enter}');
    });
  }
});

/** A series that isn't there: its calls' notes were deleted, or none of them were given to Art. */
export const NotThere = page('/notes/series/s-gone', 'busy');
/** Alcove couldn't answer. */
export const CouldntOpen = page(`/notes/series/${SERIES.standup}`, 'busy', { beforeEach: changing(inEveryState, troubled({ 'series.get': 'failed' })) });
/** Opened without a connection: a series needs one. */
export const Offline = page(`/notes/series/${SERIES.standup}`, 'offline');
