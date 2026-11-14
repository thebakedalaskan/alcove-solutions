/*
 * Journeys on a board's own page (docs/product/user-flows.md › 13. Boards), from the whiteboards canvas's page, its board and its
 * States board: making one, putting one in a document, everything under its name, a comment, the connection going; then adding to
 * it, changing what's there and undoing it, linking things, looking round, resolving a comment, and a board someone can only look at.
 * Then after the call, from the canvas's `after` and `notes` journeys: the board on the note, opening it, starting a call on it,
 * and each breakout room's board on the note, opened in one click. Last, sharing it from Share on the head over it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { RETRO_NOTE, afterTheRetro, itemId } from '../../../src/api/scenarios';
import { setOnline } from '../../../src/browser';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import type { World } from '../../../src/world/world';
import { away, LAPTOP, pause, pressable, SOON } from '../play';

const meta = { title: 'Journeys/13 Boards', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type UserEvent = Parameters<Play>[0]['userEvent'];

const RETRO = `/drive/ws-product/${itemId('Launch retro')}`;
const PLAN = `/drive/ws-product/${itemId('Launch plan')}`;

/** The board itself, named for it: where everything on it is pressed. */
const sheet = (name: string) => screen.findByRole('application', { name }, SOON);
/** What was shared and made in a call, under its stage on the call's page. */
const made = () => screen.findByRole('region', { name: 'Shared and made in this call' }, SOON);

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

/**
 * A press in the middle of `el`, where a person's would be. The board finds some things by where the pointer is, as it does the
 * far end of a line, so the press needs its place on the screen.
 */
const middleOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { keys: '[MouseLeft]', target: el, coords: { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 } };
};
/** The bar over what's picked. */
const picked = () => screen.findByRole('toolbar', { name: 'Selected' }, SOON);
/** This platform's shortcut key, as the board reads it: ⌘ on a Mac, Ctrl elsewhere. */
const MOD = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control';
const withMod = (key: string): string => `{${MOD}>}${key}{/${MOD}}`;
const shortcut = (key: string): string => (MOD === 'Meta' ? `⌘${key}` : `Ctrl+${key}`);

/** Art can only look at the launch retro: it was shared with him to read. */
const reading = (w: World): void => {
  const product = w.workspaces.find((s) => s.id === 'ws-product');
  const id = itemId('Launch retro');
  if (product) product.items = product.items.map((i) => (i.id === id ? { ...i, role: 'read' } : i));
};

export const MakeABoard: PageStory = {
  name: '13.1 Make a board',
  ...page('/drive/ws-product', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Press + at the top of the list: New document, New folder and New board', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'New document, folder or board' }, SOON));
    });
    await step('New board makes Untitled board in the list and opens it. One line says how to start', async () => {
      await userEvent.click(await screen.findByRole('menuitem', { name: /New board/ }, SOON));
      await screen.findByText('Double-click to write', {}, SOON);
    });
    await step('Double-click on the blank board: plain text, ready to type. In a frame it would be a sticky', async () => {
      await doubleClick(userEvent, await sheet('Untitled board'), 420, 260);
      await userEvent.keyboard('Who owns the launch post?');
    });
    await step('Esc when you’re done. The line that said how to start fades as the first thing lands', async () => {
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
    await step('Rename: the name becomes a field in its place, all of it picked to type over. Enter keeps it, for everyone', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'The board' }, SOON)).getByRole('button', { name: 'Rename' }));
      await userEvent.keyboard('Launch retro, November{Enter}');
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

export const AddToIt: PageStory = {
  name: '13.6 Add to it, one sticky after another',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Double-click under Went well, where nothing is yet: a sticky, ready to type', async () => {
      // Under No rollbacks and clear of its frame: a sticky lands centred where it's double-clicked.
      const last = (await screen.findByText('No rollbacks', {}, SOON)).closest('[data-id]')?.getBoundingClientRect();
      if (!last) throw new Error('No rollbacks isn’t on the board.');
      const board = await sheet('Launch retro');
      await userEvent.pointer({ keys: '[MouseLeft][MouseLeft]', target: board, coords: { clientX: last.x + last.width / 2, clientY: last.bottom + last.height * 0.9 } });
      await screen.findByRole('textbox', { name: 'Edit this sticky' }, SOON);
    });
    await step('Type it, then press Tab: the next sticky starts beside it', async () => {
      await userEvent.keyboard('Name who writes the changelog');
      await userEvent.keyboard('{Tab}');
      await userEvent.keyboard('Keep the runbook in the workspace');
    });
    await step('Esc when you’re done. Both stay, side by side', async () => {
      await userEvent.keyboard('{Escape}');
      await screen.findByText('Keep the runbook in the workspace', {}, SOON);
    });
  }
};

export const ChangeWhatsThere: PageStory = {
  name: '13.7 Change what’s there, and undo',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Changelog went out after the launch post: a small bar sits above it', async () => {
      await userEvent.pointer(middleOf(await screen.findByText('Changelog went out after the launch post', {}, SOON)));
      await picked();
    });
    await step('Click its colour, then Sky', async () => {
      await userEvent.click(within(await picked()).getByRole('button', { name: 'Colour' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Sky' }, SOON));
    });
    await step(`${shortcut('D')} copies it: the copy lands beside it, picked`, async () => {
      await userEvent.keyboard(withMod('d'));
      await pressable('button', 'Delete', SOON, within(await picked()));
    });
    await step('Delete takes the copy away', async () => {
      await userEvent.keyboard('{Delete}');
    });
    await step(`${shortcut('Z')} three times: the copy comes back and goes again, then the sticky’s colour is back. Only your own changes go back`, async () => {
      for (let i = 0; i < 3; i += 1) await userEvent.keyboard(withMod('z'));
    });
  }
};

export const LinkThings: PageStory = {
  name: '13.8 Link two things',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    const support = await screen.findByText('Support ran launch day with no queue', {}, SOON);
    await step('Point at Support ran launch day with no queue: four dots show just off its edges', async () => {
      await userEvent.pointer({ target: support, coords: middleOf(support).coords });
      await waitFor(() => { if (!document.querySelector('[data-p="r"]')) throw new Error('No dots yet.'); }, SOON);
    });
    await step('Drag from the right-hand dot and drop it on Nobody owned the status page: the line stays attached when either moves', async () => {
      const dot = document.querySelector('[data-p="r"]');
      if (!dot) throw new Error('The right-hand dot has gone.');
      const from = middleOf(dot).coords, to = middleOf(await screen.findByText('Nobody owned the status page', {}, SOON)).coords;
      await userEvent.pointer([
        { keys: '[MouseLeft>]', target: dot, coords: from },
        { coords: { clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 } },
        { coords: to },
        { keys: '[/MouseLeft]', coords: to }
      ]);
    });
    await step('Or from the bar: click Pricing page shipped a week early, then Draw a line from this', async () => {
      await userEvent.pointer(middleOf(await screen.findByText('Pricing page shipped a week early', {}, SOON)));
      await userEvent.click(within(await picked()).getByRole('button', { name: 'Draw a line from this' }));
    });
    await step('Click QA found the billing bug on launch day: a line joins them too', async () => {
      await userEvent.pointer(middleOf(await screen.findByText('QA found the billing bug on launch day', {}, SOON)));
    });
  }
};

export const LookRound: PageStory = {
  name: '13.9 Look round',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Zoom in twice: closer, round the middle of the sheet', async () => {
      const zoomIn = within(await sheet('Launch retro')).getByRole('button', { name: 'Zoom in' });
      await userEvent.click(zoomIn);
      await userEvent.click(zoomIn);
    });
    await step('Map: where you are on the board, in its corner', async () => {
      await userEvent.click(within(await sheet('Launch retro')).getByRole('button', { name: 'Map' }));
    });
    await step('Shift and 1: everything on the board, fitted to the sheet', async () => {
      (await sheet('Launch retro')).focus();
      await userEvent.keyboard('{Shift>}1{/Shift}');
    });
  }
};

export const ResolveAComment: PageStory = {
  name: '13.10 Resolve a comment, and open it again',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Press Maya’s pin: her question, beside it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Comment from Maya Chen' }, SOON));
      await screen.findByRole('dialog', { name: 'Comment' }, SOON);
    });
    await step('Resolve: the pin goes, for everyone, and a toast says so', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Comment' }, SOON)).getByRole('button', { name: 'Resolve' }));
      await away('button', 'Comment from Maya Chen');
    });
    await step('Reopen, in the toast: the pin is back, with everything said in it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Reopen' }, SOON));
      await screen.findByRole('button', { name: 'Comment from Maya Chen' }, SOON);
    });
  }
};

export const OnlyToLook: PageStory = {
  name: '13.11 A board you can only look at',
  ...page(RETRO, 'busy', { beforeEach: changing(reading) }),
  play: async ({ userEvent, step }) => {
    await step('Shared with you to read: the seal says View only, and the tools and Undo go', async () => {
      await within(await sheet('Launch retro')).findByRole('button', { name: /View only/ }, SOON);
    });
    await step('You can still look round: zoom in', async () => {
      await userEvent.click(within(await sheet('Launch retro')).getByRole('button', { name: 'Zoom in' }));
    });
    await step('And read what’s said: press Maya’s pin. There’s no field and no Resolve', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Comment from Maya Chen' }, SOON));
      await screen.findByRole('dialog', { name: 'Comment' }, SOON);
    });
  }
};

export const AfterTheCall: PageStory = {
  name: '13.12 After the call: the board on the note',
  ...page(`/calls/${RETRO_NOTE}`, 'busy', { beforeEach: changing(afterTheRetro) }),
  play: async ({ userEvent, step }) => {
    await step('The call’s page has the board among what was shared and made in it, and the follow-ups taken from its Actions frame. Everyone invited can open it', async () => {
      await screen.findByRole('heading', { name: /^Follow-ups from the board/, level: 2 }, SOON);
      await within(await made()).findByRole('button', { name: 'Launch retro' }, SOON);
    });
    await step('Open the board: the same board on its own page, with no call around it. Start a call here brings it to the next one', async () => {
      await userEvent.click(within(await made()).getByRole('button', { name: 'Launch retro' }));
      await sheet('Launch retro');
    });
    await step('Start a call here: the board comes with the call, and opens for you when it starts, ready to present', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Start a call here/ }, SOON));
      await screen.findByText(/Launch retro comes with this call/, {}, SOON);
    });
  }
};

export const RoomsInTheNotes: PageStory = {
  name: '13.13 Each room’s board on the note',
  ...page(`/calls/${RETRO_NOTE}`, 'busy', { beforeEach: changing(afterTheRetro) }),
  play: async ({ userEvent, step }) => {
    await step('Beside the call’s board, every room’s board, each saying which room it was in, with who worked on it', async () => {
      await within(await made()).findByText('In Comms', {}, SOON);
    });
    await step('Click Comms board: a room’s board is a saved board like any other, and it can be opened in the next call', async () => {
      await userEvent.click(within(await made()).getByRole('button', { name: 'Comms board' }));
      await sheet('Comms board');
    });
  }
};

export const ShareFromItsHead: PageStory = {
  name: '13.14 Share it, from the head over it',
  ...page(RETRO, 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Share is on the head over the board, as it is over a document. Press it', async () => {
      await sheet('Launch retro');
      await userEvent.click(await screen.findByRole('button', { name: 'Share' }, SOON));
    });
    await step('Who can add to it: everyone in Product, and anyone it’s shared with beyond it. Add someone outside it by address', async () => {
      await userEvent.type(await within(await screen.findByRole('dialog', { name: 'Share' }, SOON)).findByRole('textbox', { name: 'Add people by name or email' }, SOON), 'jonas@weber.design');
      await userEvent.keyboard('{Enter}');
    });
    await step('Jonas can add to the board, and to nothing else in Product: the arrow beside the name changes that to Can read', async () => {
      await within(await screen.findByRole('dialog', { name: 'Share' }, SOON)).findByText('Jonas Weber', {}, SOON);
    });
  }
};
