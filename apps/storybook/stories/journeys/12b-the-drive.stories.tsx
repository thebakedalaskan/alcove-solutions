/*
 * Journeys in the Drive (docs/product/user-flows.md › 12, the Drive), from the canvas's Drive board and its world
 * (src/world/drive.ts): opening a workspace from the tree, picking up a document from Recent, and the first day.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { withNothingYet, withTheDrive } from '../../src/world/drive';
import { LATER, SOON } from './play';

const meta = { title: 'Journeys/12 The Drive', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The tree of places beside the sheet. */
const tree = () => screen.findByRole('navigation', { name: 'Places in the Drive' }, LATER);

export const OpenAWorkspace: PageStory = {
  name: '12.2 Open a workspace',
  ...page('/drive', 'busy', { beforeEach: changing(withTheDrive) }),
  play: async ({ userEvent, step }) => {
    await step('In the Drive, under Workspaces, click Launch', async () => {
      await userEvent.click(await within(await tree()).findByRole('button', { name: 'Launch' }, SOON));
    });
    await step('Its folders, the calls kept in it and its files, beside the tree. Click Open full screen', async () => {
      await screen.findByRole('region', { name: 'Launch' }, SOON);
      await userEvent.click(await screen.findByRole('button', { name: 'Open full screen' }, SOON));
    });
    await step('Launch, full screen: what was edited lately, its calls, and every page in its list', async () => {
      await screen.findAllByText('Launch plan', {}, LATER);
    });
  }
};

export const PickUpWhereYouLeftOff: PageStory = {
  name: '12.3 Pick up where you left off',
  ...page('/drive', 'busy', { beforeEach: changing(withTheDrive) }),
  play: async ({ userEvent, step }) => {
    await step('The Drive opens on Recent: what was edited today first, as large previews. Click Launch checklist', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Open Launch checklist' }, LATER));
    });
    await step('It opens beside the tree, in Team standup’s workspace, where it lives. Click the arrows to give it the whole screen', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Open full screen' }, LATER));
    });
    await step('Full screen, in the workspace it lives in: Team standup’s', async () => {
      await screen.findAllByText('Launch checklist', {}, LATER);
    });
  }
};

export const TheFirstDay: PageStory = {
  name: '12.4 The Drive on the first day',
  ...page('/drive', 'first-day', { beforeEach: changing(withNothingYet) }),
  play: async ({ userEvent, step }) => {
    await step('The Drive starts empty: Recent, Shared with you, New workspace, Trash, and one empty state. Click New document', async () => {
      await screen.findByText('Nothing here yet', {}, LATER);
      await userEvent.click(await screen.findByRole('button', { name: 'New document' }, SOON));
    });
    await step('There’s no workspace for it yet, so name one, in the same menu', async () => {
      await userEvent.type(await screen.findByRole('textbox', { name: 'Name this workspace' }, SOON), 'Launch');
      await userEvent.click(await screen.findByRole('button', { name: 'Make it' }, SOON));
    });
    await step('The new document opens in Launch, beside the tree, ready for its title', async () => {
      await screen.findAllByText('Launch', {}, LATER);
    });
  }
};
