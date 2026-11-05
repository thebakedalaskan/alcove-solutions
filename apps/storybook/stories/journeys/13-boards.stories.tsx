/*
 * Journeys on a board's own page (docs/product/user-flows.md › 13. Boards), from the whiteboards canvas's page and its States
 * board: making one, putting one in a document, everything under its name, a comment, and the connection going.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { itemId } from '../../src/api/scenarios';
import { setOnline } from '../../src/browser';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { LAPTOP, pause, SOON } from './play';

const meta = { title: 'Journeys/13 Boards', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type UserEvent = Parameters<Play>[0]['userEvent'];

const RETRO = `/workspace/ws-product/${itemId('Launch retro')}`;
const PLAN = `/workspace/ws-product/${itemId('Launch plan')}`;

/** The board itself, named for it: where everything on it is pressed. */
const sheet = (name: string) => screen.findByRole('application', { name }, SOON);

/** Double-clicks the board `x` and `y` px in from its top left corner, where a person adding a sticky would. */
async function doubleClick(userEvent: UserEvent, board: HTMLElement, x: number, y: number): Promise<void> {
  const box = board.getBoundingClientRect();
  const coords = { clientX: box.left + x, clientY: box.top + y };
  await userEvent.pointer([{ target: board, coords }, { keys: '[MouseLeft][MouseLeft]', target: board, coords }]);
}

/** The board's name, in its bar: everything about the board itself is under it. */
const nameOf = async (name: string | RegExp) => within(await sheet(typeof name === 'string' ? name : 'Launch retro')).findByRole('button', { name }, SOON);

/** Clicks what's on the board that says `text`. */
async function press(userEvent: UserEvent, text: string): Promise<void> {
  await userEvent.click(await screen.findByText(text, {}, SOON));
}

export const MakeABoard: PageStory = {
  name: '13.1 Make a board',
  ...page('/workspace/ws-product', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Press + at the top of the list: New document, New folder and New board', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'New document, folder or board' }, SOON));
    });
    await step('New board makes Untitled board in the list and opens it. One line says how to start', async () => {
      await userEvent.click(await screen.findByRole('menuitem', { name: /New board/ }, SOON));
      await screen.findByText('Double-click anywhere to add a sticky', {}, SOON);
    });
    await step('Double-click anywhere: a sticky, ready to type', async () => {
      await doubleClick(userEvent, await sheet('Untitled board'), 420, 260);
      await userEvent.keyboard('Who owns the launch post?');
    });
    await step('Esc when you’re done. The line that said how to start fades as the first sticky lands', async () => {
      await userEvent.keyboard('{Escape}');
      await pause(600);
    });
  }
};

export const ABoardInADocument: PageStory = {
  name: '13.2 A board in a document',
  ...page(PLAN, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('In the launch plan, on a line of its own, type / and Board', async () => {
      const title = await screen.findByRole('heading', { name: 'Launch plan', level: 1 }, SOON);
      await userEvent.pointer({ keys: '[MouseLeft]', target: title, offset: (title.textContent ?? '').length });
      await userEvent.keyboard('{Enter}/board');
    });
    await step('Enter makes a board beside the document, and puts it in the page with its name on it', async () => {
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('button', { name: 'Open Untitled board' }, SOON);
    });
    await step('Press it, and the board opens on its own page', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Open Untitled board' }, SOON));
      await sheet('Untitled board');
    });
  }
};

export const UnderItsName: PageStory = {
  name: '13.3 Rename it, share it and copy its link',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Everything about the board itself is under its name', async () => {
      await userEvent.click(await nameOf(/^Launch retro/));
      await screen.findByRole('dialog', { name: 'The board' }, SOON);
    });
    await step('Rename: the name becomes a field in its place. Enter keeps it, for everyone', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'The board' }, SOON)).getByRole('button', { name: 'Rename' }));
      await userEvent.keyboard('{Control>}a{/Control}Launch retro, November{Enter}');
      await within(await screen.findByRole('tree', {}, SOON)).findByText('Launch retro, November', {}, SOON);
    });
    await step('Who can add to it: the workspace’s own share sheet, to share it beyond the workspace or close it to it', async () => {
      await userEvent.click(within(await sheet('Launch retro, November')).getByRole('button', { name: /^Launch retro, November/ }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'The board' }, SOON)).getByRole('button', { name: 'Who can add to it' }));
      await screen.findByRole('dialog', { name: 'Who can add to it' }, SOON);
    });
  }
};

export const CommentOnASticky: PageStory = {
  name: '13.4 Comment on a sticky',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Maya’s face is on a sticky’s corner: she asked something. Press it, and the thread opens beside it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Comment from Maya Chen' }, SOON));
      await screen.findByRole('dialog', { name: 'Comment' }, SOON);
    });
    await step('Reply, and Enter sends it: the pin says one reply', async () => {
      await userEvent.click(await screen.findByRole('textbox', { name: 'Reply' }, SOON));
      await userEvent.keyboard('Kofi did it last time. I’ll ask him.{Enter}');
      await screen.findByRole('button', { name: 'Comment from Maya Chen, and 1 reply' }, SOON);
    });
    await step('Pick another sticky and press K: a comment of your own, with your face on its corner', async () => {
      await userEvent.keyboard('{Escape}');
      await press(userEvent, 'No rollbacks');
      await userEvent.keyboard('k');
      await userEvent.click(await screen.findByRole('textbox', { name: 'Comment' }, SOON));
      await userEvent.keyboard('Worth keeping for the next launch{Enter}');
      await screen.findByRole('button', { name: /^Comment from Art Vandelay/ }, SOON);
    });
  }
};

export const TheConnectionGoes: PageStory = {
  name: '13.5 The connection goes',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('The connection drops: the seal says Reconnecting, and the pill says to keep going', async () => {
      await sheet('Launch retro');
      setOnline(false);
      await screen.findByText('Keep going. Your changes are safe here.', {}, SOON);
    });
    await step('What you add is kept in this browser until it can go', async () => {
      await doubleClick(userEvent, await sheet('Launch retro'), 640, 590);
      await userEvent.keyboard('Added on the train{Escape}');
    });
    await step('It’s back: what was added goes, once, and a toast says so', async () => {
      setOnline(true);
      await screen.findByText(/^Back online/, {}, SOON);
    });
  }
};
