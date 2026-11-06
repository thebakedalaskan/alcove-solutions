/* Record: the night, with the recorder for a sun, and what's been recorded on the water (user-flows 9). */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { keptHere, recordsOnlyOnline } from './changes';

const meta = { title: 'Pages/Record', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Check the level: the microphone opens, and the orb's rim and its reflection move with the voice. Nothing is recorded. */
const checking: NonNullable<PageStory['play']> = async ({ canvas, userEvent, step }) => {
  await step('Press Check the level', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: /Check the level/ }));
  });
};

export const Busy = page('/record', 'busy');
export const BusyPhone = phone(Busy);
export const FirstDay = page('/record', 'first-day');
export const OnTheirOwn = page('/record', 'on-their-own');
export const Lots = page('/record', 'lots');
/** Without a connection Record still works: it records on this device. */
export const Offline = page('/record', 'offline');
/** Without a connection, with Record without a connection off in Settings: Start recording waits for the connection. */
export const OfflineAndNotKept = page('/record', 'offline', { beforeEach: changing(recordsOnlyOnline) });

/** Recordings on this device that haven't uploaded: one uploading, one waiting, one Alcove refused for now, one too old, one unreadable here, one recording in another tab. */
export const OnThisDevice = page('/record', 'busy', { beforeEach: changing(keptHere) });
export const OnThisDevicePhone = phone(OnThisDevice);
/** The same, opened without a connection: they wait for it. */
export const OnThisDeviceOffline = page('/record', 'busy', {
  beforeEach: changing(keptHere),
  parameters: { opening: { browser: { online: false }, signedInHere: true } }
});
/** A recording's menu: Upload now, or Delete from this device, which asks first in the same menu. */
export const DeleteFromThisDevice = page('/record', 'busy', {
  beforeEach: changing(keptHere),
  play: async ({ canvas, userEvent, step }) => {
    await step('Open the menu of the supplier visit, which Alcove refused for now', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'More for Supplier visit' }, { timeout: 8000 }));
    });
    await step('Press Delete from this device. It asks first', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Delete from this device/ }));
    });
  }
});

/** Check the level: the microphone opens, and nothing is recorded. */
export const CheckingTheLevel = page('/record', 'busy', { play: checking });
/** The browser blocks the microphone: it says so under it, and how to allow it. */
export const MicrophoneBlocked = page('/record', 'busy', { parameters: { opening: { browser: { devices: 'denied' } } }, play: checking });
