/*
 * The stage recorder (/record/live): the same night as Record over the whole window, recording from the moment it opens.
 * The orb fills as it records, the voice runs across the water, and what's said comes up under it (user-flows 9).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { sessions } from '~/lib/live';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs } from '../../src/page';
import { recordsOnlyOnline } from './changes';

const meta = { title: 'Pages/Record stage', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Record hands the stage the recording's name, in memory, as Start recording does. */
const named = changing(() => { sessions.roomTitle = 'Cold store walkthrough'; });

/** Recording: for its first moments it's listening, and reminds you to tell the room. What's said comes up as it's heard. */
export const Recording = page('/record/live', 'busy', { beforeEach: named });
export const RecordingPhone = phone(Recording);
/** Paused: nothing is heard until it resumes. */
export const Paused = page('/record/live', 'busy', {
  beforeEach: named,
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Pause', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Pause' }, { timeout: 8000 }));
    });
  }
});
/** Home, mid-recording: finish and write the notes, or discard it. */
export const LeavingAsks = page('/record/live', 'busy', {
  beforeEach: named,
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Home. It asks first: finish and write notes, or discard the recording', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Home' }, { timeout: 8000 }));
      await screen.findByRole('button', { name: /Discard recording/ });
    });
  }
});
/** Recording without a connection: it's saved on this device, and uploads when the connection is back. */
export const Offline = page('/record/live', 'offline', { beforeEach: named });
/** The microphone is blocked: what's wrong, and how to fix it, in place of the reminder. */
export const MicrophoneBlocked = page('/record/live', 'busy', { beforeEach: named, parameters: { opening: { browser: { devices: 'denied' } } } });
/** Offline, with Record without a connection off: it can't start, and says why, with the way back to Record. */
export const CouldntStart = page('/record/live', 'offline', { beforeEach: changing(recordsOnlyOnline, () => { sessions.roomTitle = 'Cold store walkthrough'; }) });
