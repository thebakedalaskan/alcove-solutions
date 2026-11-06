/* Agent access (user-flows 14). Real pages; the external OAuth callback stays outside Storybook. */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { AGENT_CONNECT_PATH } from '../../src/api/agents';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { LAPTOP, SOON } from './play';

const meta = { title: 'Journeys/14 Agent access', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;
export const CreateAToken: PageStory = {
  name: '14.1 Create a personal token', ...page('/settings#agents', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Open Agents and create a named, expiring connection', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Create a token' }, SOON));
      await userEvent.type(await screen.findByRole('textbox', { name: 'Connection name' }, SOON), 'Planning assistant');
      await userEvent.clear(screen.getByRole('spinbutton', { name: 'Expires after this many days' }));
      await userEvent.type(screen.getByRole('spinbutton', { name: 'Expires after this many days' }), '7');
    });
    await step('Read permissions start selected; add scheduling, while sharing and deletion remain separate choices', async () => {
      await userEvent.click(screen.getByRole('switch', { name: 'Schedule and manage calls' }));
      await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    });
    await step('The token appears once, masked, with its MCP endpoint. Done leaves the connection in the list', async () => {
      const reveal = await screen.findByRole('region', { name: 'Your new agent token' }, SOON);
      await userEvent.click(within(reveal).getByRole('button', { name: 'Done' }));
      await screen.findByRole('group', { name: 'Planning assistant' }, SOON);
    });
  }
};
export const DisconnectAnAgent: PageStory = {
  name: '14.2 Disconnect an agent', ...page('/settings#agents', 'agents-connected'),
  play: async ({ userEvent, step }) => {
    await step('Each connection says what it can do, when it expires and whether it was used', async () => {
      await screen.findByRole('group', { name: 'Workspace assistant' }, SOON);
      await screen.findByRole('group', { name: 'Scheduling assistant' }, SOON);
    });
    await step('Disconnect the Workspace assistant. The connection is removed', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Workspace assistant' }, SOON)).getByRole('button', { name: 'Disconnect' }));
      await screen.findByText('Agent disconnected.', {}, SOON);
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
      await screen.findByRole('switch', { name: 'Read notes' }, SOON);
    });
    await step('Remove calendar access. Allow selected access or Cancel hands control back to the external agent', async () => {
      await userEvent.click(screen.getByRole('switch', { name: 'Read calendar and availability' }));
      await screen.findByRole('button', { name: 'Allow selected access' }, SOON);
    });
  }
};
