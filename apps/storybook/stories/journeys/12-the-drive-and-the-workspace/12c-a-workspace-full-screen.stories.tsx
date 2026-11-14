/*
 * Journeys in a workspace, full screen (docs/product/user-flows.md › 12, a workspace full screen), on the canvas's A workspace
 * board and its world (src/world/workspaces.ts): working on a page from Launch's Home, and what a call made, from the call's
 * page into its own workspace. Opening a workspace from the Drive is 12.2 (12b-the-drive.stories.tsx).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { LAUNCH, withWorkspaces } from '../../../src/world/workspaces';
import { LATER, SOON } from '../play';

const meta = { title: 'Journeys/12 The Drive and the workspace/A workspace, full screen', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The workspace's side panel. */
const side = () => screen.findByRole('navigation', { name: 'This workspace' }, LATER);
/** The block of the page that says `text`. */
const block = (text: string) => waitFor(() => {
  const found = [...document.querySelectorAll<HTMLElement>('.ws-ed .wb')].find((b) => (b.textContent ?? '').includes(text));
  if (!found) throw new Error(`Nothing on the page says “${text}” yet.`);
  return found;
}, LATER);

export const WorkOnAPage: PageStory = {
  name: '12.5 Work on a page',
  ...page(`/drive/${LAUNCH}`, 'busy', { beforeEach: changing(withWorkspaces) }),
  play: async ({ userEvent, step }) => {
    await step('Launch’s Home: what was edited lately as large previews, and its calls. Click Launch plan', async () => {
      /* The side panel has a Launch plan too, there before the previews are: wait for the card's own. */
      await userEvent.click(await waitFor(() => {
        const card = screen.getAllByRole('button', { name: 'Launch plan' }).find((b) => b.closest('.fc') !== null);
        if (!card) throw new Error('Launch plan’s card isn’t there yet.');
        return card;
      }, LATER));
    });
    await step('It opens like a page: the call it came from, who made it, and Priya writing in it, her caret in the focus colour', async () => {
      await screen.findByRole('button', { name: /^From Launch planning/ }, LATER);
      await screen.findByText('Priya is here', {}, SOON);
    });
    await step('Tick Send Kofi the pricing draft', async () => {
      await userEvent.click(within(await block('Send Kofi the pricing draft')).getByRole('checkbox', { name: 'Done' }));
    });
    await step('The callout has two comments, counted in the margin. Click the count', async () => {
      await userEvent.click(within(await block('Nothing goes out before the design review')).getByRole('button', { name: 'Open the comments' }));
      await screen.findByRole('dialog', { name: /^Comments on/ }, SOON);
    });
    await step('Back to Launch’s Home, from the path in the bar', async () => {
      await userEvent.keyboard('{Escape}');
      const named = await screen.findAllByRole('button', { name: 'Launch' }, SOON);
      const crumb = named.find((b) => b.closest('.wf-path') !== null);
      if (crumb) await userEvent.click(crumb);
      await screen.findByText('Recently edited', {}, LATER);
    });
  }
};

export const WhatTheCallMade: PageStory = {
  name: '12.6 What the call made',
  ...page('/calls/n2', 'busy', { beforeEach: changing(withWorkspaces) }),
  play: async ({ userEvent, step }) => {
    await step('This morning’s standup, on its page. Open its workspace', async () => {
      await userEvent.click(await screen.findByRole('link', { name: /^Open its workspace/ }, LATER));
    });
    await step('A call’s own workspace has no Home: it opens on what the call made, with the call first in its list', async () => {
      await within(await side()).findByRole('button', { name: /^The call, today/ }, LATER);
      await screen.findByRole('button', { name: /^From Team standup/ }, LATER);
    });
    await step('Then what it made, then the standups before. Click Standup board', async () => {
      await userEvent.click(await within(await side()).findByRole('button', { name: 'Standup board' }, SOON));
    });
    await step('The board, full screen in the call’s workspace, under the way back to where it was opened from', async () => {
      await waitFor(() => {
        if (!document.querySelector('.wf-path')?.textContent?.includes('Standup board')) throw new Error('The board isn’t open yet.');
      }, SOON);
    });
  }
};
