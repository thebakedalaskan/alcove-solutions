import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { changing } from '../../src/page';
import { withSharedCallExports } from '../../src/world/drive-exports';
import { LATER, SOON } from './play';

const meta = { title: 'Journeys/15 Google Drive exports', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const ChooseDefaultFiles: PageStory = {
  name: '15.1 Choose default files',
  ...page('/settings#google-drive', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Read the copy and sharing disclosure, then choose retained recordings explicitly', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Retained recording Original audio pieces · .zip', pressed: false }, LATER));
    });
    await step('Pause automatic exports without forgetting the folder or file choices', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Automatic Google Drive exports', checked: true }, SOON));
    });
  }
};

export const ChooseASharedDriveFolder: PageStory = {
  name: '15.2 Choose a shared-drive folder',
  ...page('/settings#google-drive', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Open the list of folders already allowed for this connection', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Choose default Google Drive folder' }, LATER));
    });
    await step('Choose the shared drive folder; the server validates current write permission before keeping it', async () => {
      const picker = await screen.findByRole('dialog', { name: 'Choose a Google Drive folder' }, SOON);
      await userEvent.click(await within(picker).findByRole('button', { name: 'Use Product / Call exports in shared drive' }, SOON));
    });
  }
};

export const OverrideOneCall: PageStory = {
  name: '15.3 Override one call',
  ...page('/notes/n2', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Choose settings for this call without changing the default', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Use custom export settings for this call', checked: false }, LATER));
    });
    await step('Choose an authorized destination for this call', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Choose Google Drive folder for this call' }, SOON));
      const picker = await screen.findByRole('dialog', { name: 'Choose a Google Drive folder' }, SOON);
      await userEvent.click(await within(picker).findByRole('button', { name: 'Use Research interviews in shared drive' }, SOON));
    });
  }
};

export const RetryAnExport: PageStory = {
  name: '15.4 Retry an export',
  ...page('/settings#google-drive', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Read the failed destination reason. Retry checks access again and keeps the same export identity', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Retry' }, LATER));
    });
    await step('The retry is pending, while the uploaded note keeps its file link', async () => {
      await screen.findAllByText('Pending', {}, SOON);
    });
  }
};

export const DisconnectDrive: PageStory = {
  name: '15.5 Disconnect Google Drive',
  ...page('/settings?drive=connected#google-drive', 'drive-connected'),
  play: async ({ userEvent, step }) => {
    await step('Return from Google with the connection confirmed', async () => {
      await screen.findByText('Google Drive connected. Choose the files to export and turn automatic exports on when you’re ready.', {}, LATER);
    });
    await step('Disconnect only Drive. Further exports stop and copies already exported stay there', async () => {
      const drive = await screen.findByRole('region', { name: 'Google Drive' }, LATER);
      await userEvent.click(within(drive).getByRole('button', { name: 'Disconnect' }));
    });
    await step('The callback success notice leaves; Alcove stays signed in and Drive can be connected again', async () => {
      await screen.findByRole('button', { name: 'Connect Google Drive' }, SOON);
    });
  }
};


export const ExportSharedCallNotes: PageStory = {
  name: '15.6 Export shared call notes',
  ...page('/notes/n3', 'busy', { beforeEach: changing(withSharedCallExports) }),
  play: async ({ userEvent, step }) => {
    await step('As a reader of Maya’s call, choose your own export settings and destination', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Use custom export settings for this call', checked: false }, LATER));
    });
    await step('Original audio is unavailable to readers. Keep just finalized shared notes', async () => {
      await screen.findByRole('button', { name: /Retained recording Original audio pieces.*Only the organizer can export original audio/ }, SOON);
      await userEvent.click(await screen.findByRole('button', { name: 'Transcript Plain text · .txt', pressed: true }, SOON));
    });
  }
};
