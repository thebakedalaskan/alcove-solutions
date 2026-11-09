/** Real workspace rename, refusal, retained input and deliberate retry (user-flows 12). */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { standIn } from '../../src/api/standin';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { LATER, outage, pause, SOON, swap, unreachable } from './play';

const meta = { title: 'Journeys/12 Workspace', ...pages } satisfies Meta<PageArgs>;
export default meta;
const refusal = outage(() => swap(standIn.workspaces, 'rename', async () => { await pause(800); throw unreachable(); }));
export const RenameAndRetry: PageStory = {
  name: '12.1 Rename immediately, recover the name and retry',
  ...page('/drive/ws-product', 'busy'),
  beforeEach: refusal.begin,
  play: async ({ userEvent, step }) => {
    await step('Rename Product to Launch planning. The name changes while it is being kept', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Product' }, LATER));
      const rename = await screen.findByRole('menuitem', { name: 'Rename' }, SOON);
      await pause(450);
      await userEvent.click(rename);
      const field = await screen.findByRole('textbox', { name: 'Name this workspace' }, SOON);
      await userEvent.clear(field);
      await userEvent.type(field, 'Launch planning');
      await userEvent.keyboard('{Enter}');
      await screen.findByText('Saving…', {}, SOON);
    });
    await step('A refusal offers Edit name; the entered name is kept in the editor', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Edit name' }, LATER));
      await screen.findByRole('textbox', { name: 'Name this workspace' }, SOON);
    });
    await step('Reconnect and press Enter to retry that name; no reload or retyping', async () => {
      refusal.end();
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('button', { name: 'Launch planning' }, LATER);
    });
  }
};
export const RenameAndRetryPhoneNight: PageStory = { ...RenameAndRetry, globals: { viewport: { value: 'phone' }, theme: 'dark' } };
