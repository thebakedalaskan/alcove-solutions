/*
 * Agent access (docs/product/user-flows.md › 14), from the canvas's Settings board: Settings → Connections → Agents.
 * Connect an agent opens in place with Alcove's address; the agent itself is outside Storybook, so its side starts at the
 * consent page it opens (14.3), which plays up to handing control back to it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { AGENT_CONNECT_PATH } from '../../src/api/agents';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { away, LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/14 Agent access', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** A row of Settings, by its label. */
const row = (name: string | RegExp) => screen.findByRole('group', { name }, LATER);

export const ConnectAnAgent: PageStory = {
  name: '14.1 Connect an agent, or create a personal token', ...page('/settings#agents', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Under Connections, Agents has none yet. Click Connect an agent', async () => {
      await userEvent.click(within(await row('Connect an agent')).getByRole('button', { name: 'Connect an agent' }));
    });
    await step('It opens in place, with Alcove’s address to paste into your agent, which then opens Alcove to sign in. Click Copy', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Alcove’s address for agents' }, SOON)).getByRole('button', { name: 'Copy' }));
      // A browser that won't copy for the page says to select it instead.
      await screen.findByText(/^(Copied\. Paste it into your agent’s connections\.|Copy wasn’t available)/, {}, SOON);
    });
    await step('For a script that can’t sign in, click Create a token instead', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Create a token' }));
    });
    await step('Name it and choose how long it lasts. Reading starts chosen; add Schedule and manage calls', async () => {
      await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }, SOON), 'Weekly digest script');
      await userEvent.click(screen.getByRole('button', { name: '7 days' }));
      await userEvent.click(screen.getByRole('button', { name: 'Schedule and manage calls', pressed: false }));
    });
    await step('Click Create token. It shows once, hidden but for its ends, with Copy and Alcove’s address', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
      await userEvent.click(within(await screen.findByRole('group', { name: 'Your new token' }, SOON)).getByRole('button', { name: 'Copy' }));
    });
    await step('Click Done. The token is gone from the page, and the script is in the list, not used yet', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));
      await within(await row('Weekly digest script')).findByText('Not used yet', {}, SOON);
    });
  }
};

export const DisconnectAnAgent: PageStory = {
  name: '14.2 Disconnect an agent', ...page('/settings#agents', 'agents-connected'),
  play: async ({ userEvent, step }) => {
    await step('Each connection says what it can do, how it signed in, when it expires and when it was last used', async () => {
      await within(await row('Workspace assistant')).findByText('Used today', {}, SOON);
      await within(await row('Scheduling assistant')).findByText('Not used yet', {}, SOON);
    });
    await step('Disconnect the Workspace assistant. It leaves the list, and a toast says so', async () => {
      await userEvent.click(within(await row('Workspace assistant')).getByRole('button', { name: 'Disconnect' }));
      await screen.findByText('Agent disconnected.', {}, SOON);
      await away('group', 'Workspace assistant');
    });
    await step('Disconnect the Scheduling assistant too. With none left, Connect an agent says there are none yet', async () => {
      await userEvent.click(within(await row('Scheduling assistant')).getByRole('button', { name: 'Disconnect' }));
      await within(await row('Connect an agent')).findByText(/^None yet\./, {}, SOON);
    });
  }
};

export const ReviewRequestedAccess: PageStory = {
  name: '14.3 Sign in and review requested access', ...page(AGENT_CONNECT_PATH, 'signed-out'),
  play: async ({ userEvent, step }) => {
    await step('The agent opens a public connection page; sign in to choose which Alcove account it can use', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Continue with Microsoft' }, SOON));
    });
    await step('Review the requesting client, the signed-in account and the permissions it asked for', async () => {
      await screen.findByRole('heading', { name: 'Connect your agent' }, SOON);
      await screen.findByRole('button', { name: 'Read notes', pressed: true }, SOON);
    });
    await step('Remove calendar access. Allow selected access or Cancel hands control back to the external agent', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Read calendar and availability', pressed: true }));
      await screen.findByRole('button', { name: 'Allow selected access' }, SOON);
    });
  }
};
