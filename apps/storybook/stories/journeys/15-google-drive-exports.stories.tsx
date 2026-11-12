/*
 * Google Drive exports (docs/product/user-flows.md › 15), from the canvas's Settings board: Settings → Connections →
 * Google Drive, one line until Manage opens it in place; a call's own, from More › Google Drive on its page, in a window.
 * Google's pages can't open in Storybook: Connect plays up to the hand-off (15.5), and the way back is Settings' own
 * address, `?drive=connected`, with Drive just connected (15.1).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { withDriveJustConnected, withSharedCallExports } from '../../src/world/drive-exports';
import { away, LATER, SOON } from './play';

const meta = { title: 'Journeys/15 Google Drive exports', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** A row of Settings, by its label. */
const row = (name: string | RegExp) => screen.findByRole('group', { name }, LATER);
/** The picker of folders Google lets Alcove use. */
const picker = () => screen.findByRole('dialog', { name: 'Choose a Google Drive folder' }, SOON);
/** A call's own exports, in the window More › Google Drive opens on its page. */
const callsDrive = () => screen.findByRole('dialog', { name: 'Google Drive exports for this call' }, SOON);
type Play = NonNullable<PageStory['play']>;
/** More › Google Drive, on a call's page. */
async function openCallsDrive(userEvent: Parameters<Play>[0]['userEvent']): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'More' }, LATER));
  await userEvent.click(await screen.findByRole('button', { name: /^Google Drive/ }, SOON));
  await callsDrive();
}

export const ChooseDefaultFiles: PageStory = {
  name: '15.1 Choose default files',
  ...page('/settings?drive=connected#google-drive', 'busy', { beforeEach: changing(withDriveJustConnected) }),
  play: async ({ userEvent, step }) => {
    await step('Back from Google, Google Drive is open in place and says so. Notes and Transcript are ticked already', async () => {
      await screen.findByText('Google Drive is connected. Choose a folder, and what to send to it.', {}, LATER);
    });
    await step('Export after each call waits for a folder. Click Choose a folder: the folders Google lets Alcove use open', async () => {
      await userEvent.click(within(await row('Folder')).getByRole('button', { name: /Choose a folder/ }));
    });
    await step('Click Call notes. Alcove checks it can write there, and keeps it', async () => {
      await userEvent.click(await within(await picker()).findByRole('button', { name: 'Use Call notes' }, SOON));
      await within(await row('Folder')).findByText('Saved', {}, SOON);
    });
    await step('Tick Recording too: the call’s original audio goes as well', async () => {
      await userEvent.click(within(await row('Files')).getByRole('button', { name: /^Recording/, pressed: false }));
      await within(await row('Files')).findByText('Saved', {}, SOON);
    });
    await step('Turn on Export after each call. It covers calls that end from now on, and their files go once their notes are final', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Export after each call', checked: false }, SOON));
      await screen.findByRole('switch', { name: 'Export after each call', checked: true }, SOON);
    });
    await step('Click Done. Drive folds back into one line that says where notes go', async () => {
      await userEvent.click(within(await row('Google Drive')).getByRole('button', { name: 'Done' }));
      await within(await row('Google Drive')).findByText('After each call: notes, transcript and recording to Call notes.', {}, SOON);
    });
  }
};

export const ChooseASharedDriveFolder: PageStory = {
  name: '15.2 Choose a shared-drive folder',
  ...page('/settings#google-drive', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Click Manage. Google Drive opens in place', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Manage' }, LATER));
    });
    await step('Click the folder. The folders Alcove may use open, each saying whether it’s in a shared drive', async () => {
      await userEvent.click(within(await row('Folder')).getByRole('button', { name: /^Call notes/ }));
    });
    await step('Click Product / Call exports, in a shared drive. Alcove checks it can still write there before keeping it', async () => {
      await userEvent.click(await within(await picker()).findByRole('button', { name: 'Use Product / Call exports in shared drive' }, SOON));
      await within(await row('Folder')).findByRole('button', { name: /^Product \/ Call exports/ }, SOON);
    });
  }
};

export const OverrideOneCall: PageStory = {
  name: '15.3 Override one call',
  ...page('/calls/n2', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('On the call’s page, More › Google Drive opens where this call’s files go, in a window', async () => {
      await openCallsDrive(userEvent);
    });
    await step('Choose settings for this call without changing the default', async () => {
      await userEvent.click(within(await callsDrive()).getByRole('switch', { name: 'Use custom export settings for this call', checked: false }));
    });
    await step('Choose an authorized destination for this call', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Choose Google Drive folder for this call' }, SOON));
      await userEvent.click(await within(await picker()).findByRole('button', { name: 'Use Research interviews in shared drive' }, SOON));
    });
  }
};

export const RetryAnExport: PageStory = {
  name: '15.4 Retry an export',
  ...page('/settings#google-drive', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Click Manage. Recent exports say what went, what’s on its way, and what didn’t go and why', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Manage' }, LATER));
      await screen.findByText('The destination folder is unavailable. Choose a folder you can write to, then retry.', {}, SOON);
    });
    await step('Click Try again. It checks access again and keeps the same export, so nothing goes twice', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await step('It goes again at once, not at the next upkeep, while the notes already sent keep their link', async () => {
      await away('button', 'Try again');
    });
  }
};

export const DisconnectDrive: PageStory = {
  name: '15.5 Disconnect Google Drive',
  ...page('/settings?drive=connected#google-drive', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Back from Google, Google Drive is open in place and says it’s connected', async () => {
      await screen.findByText('Google Drive is connected.', {}, LATER);
    });
    await step('Click Disconnect Google Drive. Exports stop, and copies already in Drive stay there', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Disconnect Google Drive' }));
      await screen.findByText('Google Drive is disconnected. Copies already there stay.', {}, SOON);
    });
    await step('Drive folds to one line with Connect. Signing in and the calendar are as they were', async () => {
      await within(await row('Google Drive')).findByRole('button', { name: 'Connect' }, SOON);
      await within(await row('Google Calendar')).findByText('Connected', {}, SOON);
    });
    await step('Click Connect: the page goes to Google, which asks which account, and which folders Alcove may use', async () => {
      await userEvent.click(within(await row('Google Drive')).getByRole('button', { name: 'Connect' }));
      await within(await row('Google Drive')).findByRole('button', { name: 'Opening Google' }, SOON);
    });
  }
};

export const ExportSharedCallNotes: PageStory = {
  name: '15.6 Export shared call notes',
  ...page('/calls/n3', 'busy', { beforeEach: changing(withSharedCallExports) }),
  play: async ({ userEvent, step }) => {
    await step('As a reader of Maya’s call, More › Google Drive: choose your own export settings and destination', async () => {
      await openCallsDrive(userEvent);
      await userEvent.click(await within(await callsDrive()).findByRole('switch', { name: 'Use custom export settings for this call', checked: false }, LATER));
    });
    await step('Original audio is unavailable to readers. Keep just the shared notes', async () => {
      await screen.findByRole('button', { name: /^Recording.*Only the organizer can export original audio/ }, SOON);
      await userEvent.click(await screen.findByRole('button', { name: /^Transcript/, pressed: true }, SOON));
    });
  }
};

export const ReviewDrivePermissions: PageStory = {
  name: '15.7 Review Drive permissions',
  ...page('/settings#google-drive', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Connect, beside Google Drive, opens a disclosure before opening Google', async () => {
      await userEvent.click(await within(await screen.findByRole('group', { name: 'Google Drive' }, LATER)).findByRole('button', { name: 'Connect' }, LATER));
    });
    await step('Cancel and stay in Settings without starting consent', async () => {
      const disclosure = await screen.findByRole('dialog', { name: 'Allow Google Drive exports' }, SOON);
      await userEvent.click(within(disclosure).getByRole('button', { name: 'Cancel' }));
    });
  }
};

export const ExportACallFromBefore: PageStory = {
  name: '15.8 Export a call from before automatic exports',
  ...page('/calls/n7', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Launch planning ended the week before automatic exports went on. More › Google Drive says it isn’t exported', async () => {
      await openCallsDrive(userEvent);
      await screen.findByText('This call ended before automatic exports were on, so it isn’t exported.', {}, LATER);
    });
    await step('Press Export to Google Drive. It goes to the folder shown, with the files ticked in Settings', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Export to Google Drive' }));
      await screen.findByText('Goes to this folder. The copies follow the notes when they change.', {}, SOON);
    });
    await step('The files upload straight away, then each shows when it went, which opens it in Drive', async () => {
      await screen.findByRole('link', { name: /Open Notes in Google Drive/ }, LATER);
    });
  }
};
