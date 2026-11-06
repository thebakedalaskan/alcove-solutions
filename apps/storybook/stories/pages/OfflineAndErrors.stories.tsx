/*
 * What a screen shows when it can't load: offline, it says so and what still works (Record, for someone signed in on this
 * browser who records without a connection); anything else, that the page didn't load, with Try again; and an address
 * that leads nowhere (features/shell/OfflinePage.tsx, routes/__root.tsx).
 */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs } from '../../src/page';
import { recordsOnlyOnline, troubled } from './changes';

const meta = { title: 'Pages/Offline and errors', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Opened with no connection, signed in on this browser: this page needs one, and recording still works. */
export const Offline = page('/notes', 'offline');
export const OfflinePhone = phone(Offline);
/** The same, with Record without a connection off: recording waits for the connection too. */
export const OfflineRecordingWaits = page('/notes', 'offline', { beforeEach: changing(recordsOnlyOnline) });
/** Alcove can't be reached, and nobody is signed in on this browser to record here: it opens once the connection is back. */
export const CantReachAlcove = page('/home', 'busy', {
  beforeEach: changing(troubled({ 'notes.inbox': 'network' })),
  play: async ({ canvas, step }) => {
    await step('Alcove doesn’t answer. The page tries twice more, then says it needs a connection', async () => {
      await canvas.findByText('You’re offline', {}, { timeout: 10000 });
    });
  }
});
/** Anything else: the page didn't load, with Try again. */
export const DidntLoad = page('/home', 'busy', { beforeEach: changing(troubled({ 'notes.inbox': 'failed' })) });
export const DidntLoadPhone = phone(DidntLoad);
/** An address that leads nowhere. */
export const NothingHere = page('/nowhere', 'busy');
