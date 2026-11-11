/*
 * A workspace, from the Drive: the list beside the page, or one at a time on a phone; sharing, Trash, a workspace you can
 * only read; tags, comments, photos, video and files in a document; its History, grouped by call; and what the page says
 * when Alcove won't take what's written, with the words offered back (user-flows 12).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { itemId } from '../../src/api/scenarios';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import type { World } from '../../src/world';
import { troubled } from './changes';

const meta = { title: 'Pages/Workspace', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** A workspace's address, or one of its documents', by the document's name. */
const at = (workspace: string, name?: string) => `/drive/${workspace}${name === undefined ? '' : `/${itemId(name)}`}`;
const PLAN = at('ws-product', 'Launch plan');
const FIXES = at('ws-standup', 'Onboarding fixes');
const SHOTS = at('ws-review', 'Sidebar screenshots');
const UPLOADS = at('ws-review', 'Review uploads');
const PHONE = { viewport: { value: 'phone' } };
/** A moment, as a person takes one. */
const beat = (ms: number) => new Promise<void>((done) => { setTimeout(done, ms); });
/** Holds a finger on the first block of this kind until its menu opens: a phone has no handles to press. */
const hold = (selector: string): NonNullable<PageStory['play']> => async ({ canvasElement, step }) => {
  await step('Hold a finger on the block. Its menu opens as a sheet', async () => {
    let block: Element | null = null;
    for (let tries = 0; !block && tries < 50; tries++) { block = canvasElement.querySelector(selector); if (!block) await beat(200); }
    if (!block) return;
    const box = block.getBoundingClientRect();
    const at = { bubbles: true, pointerType: 'touch', isPrimary: true, clientX: box.left + box.width / 2, clientY: box.top + Math.min(box.height / 2, 60) };
    block.dispatchEvent(new PointerEvent('pointerdown', at));
    await beat(700);
    block.dispatchEvent(new PointerEvent('pointerup', at));
  });
};
/** Opens the document's Share sheet. */
const share: PageStory['play'] = async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Share' }));
};

/** Product, which Art runs: the launch plan open beside the list. */
export const ADocument = page(PLAN, 'busy');
const renameWorkspace: NonNullable<PageStory['play']> = async ({ canvas, userEvent, step }) => {
  await step('12. Rename the workspace; its requested name shows while saving', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Product' }));
    const rename = await screen.findByRole('menuitem', { name: 'Rename' });
    await beat(450);
    await userEvent.click(rename);
    const field = await screen.findByRole('textbox', { name: 'Name this workspace' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Launch planning');
    await userEvent.keyboard('{Enter}');
  });
};
export const RenameSaving = page(at('ws-product'), 'busy', { beforeEach: changing(troubled({ 'workspaces.rename': 'hold' })), play: renameWorkspace });
export const RenameRefused = page(at('ws-product'), 'busy', { beforeEach: changing(troubled({ 'workspaces.rename': 'failed' })), play: renameWorkspace });
export const RenameSavingNight = { ...RenameSaving, globals: { theme: 'dark' } };
export const RenameSavingPhone = { ...RenameSaving, globals: PHONE };
export const RenameSavingPhoneNight = { ...RenameSaving, globals: { ...PHONE, theme: 'dark' } };
export const RenameRefusedNight = { ...RenameRefused, globals: { theme: 'dark' } };
export const RenameRefusedPhone = { ...RenameRefused, globals: PHONE };
export const RenameRefusedPhoneNight = { ...RenameRefused, globals: { ...PHONE, theme: 'dark' } };
/** A document in a folder: the folder opens around it in the list. */
export const InAFolder = page(at('ws-product', 'Interview notes'), 'busy');
/** Share: the workspace's people, a designer outside the company who can read it, and someone from sales who can edit. */
export const Sharing = page(PLAN, 'busy', { play: share });
/** Closed to the workspace: only the people it's shared with have it. */
export const ClosedToTheWorkspace = page(at('ws-product', 'Pricing page copy'), 'busy', { play: share });
export const Trash = page(`${at('ws-product')}/trash`, 'busy');
export const TrashEmpty = page(`${at('ws-design')}/trash`, 'busy');
/** A document in Trash, open: it can be read, and Restore it brings it back. */
export const InTrash = page(at('ws-product', 'Old roadmap'), 'busy');
/** The company handbook, which Art can only read: the bar says who to ask, and nothing on the page changes anything. */
export const ReadOnly = page(at('ws-handbook', 'Holidays'), 'busy');

/** In the standup's home: people tagged on its lines, words with comments on them, and the toast for Kofi's tag. */
export const TagsAndComments = page(FIXES, 'busy');
export const TagsAndCommentsNight = page(FIXES, 'busy', { globals: { theme: 'dark' } });
/** The thread on the tour's line, opened from its count in the margin: Kofi's comment and Priya's reply. */
export const ACommentThread = page(FIXES, 'busy', {
  play: async ({ canvas, userEvent }) => {
    const [first] = await canvas.findAllByRole('button', { name: 'Open the comments' });
    if (first) await userEvent.click(first);
  }
});
export const TagsAndCommentsPhone = page(FIXES, 'busy', { globals: PHONE });

/** In the design review's home: its screenshots side by side, the walkthrough to play, and the spec to download. */
export const PhotosVideoAndAFile = page(SHOTS, 'busy');
export const PhotosVideoAndAFileNight = page(SHOTS, 'busy', { globals: { theme: 'dark' } });
export const PhotosVideoAndAFilePhone = page(SHOTS, 'busy', { globals: PHONE });
/**
 * Tagging someone in a caption: click under a photo, type @, and pick who, as in a line. The caption Aiko's tagged in shows
 * her name marked; Kofi, who can't open the review's home, says so in the list, and is asked about before he's told.
 */
const captionTag: PageStory['play'] = async ({ canvasElement, userEvent, step }) => {
  await step('Click the caption under the first screenshot, and type @ at its end', async () => {
    let field: HTMLInputElement | null = null;
    for (let tries = 0; !field && tries < 50; tries++) { field = canvasElement.querySelector<HTMLInputElement>('.ws-ed .wb-cap[aria-label="Caption"]'); if (!field) await beat(200); }
    if (!field) return;
    await userEvent.click(field);
    await userEvent.keyboard('{End} with @');
  });
};
export const CaptionTagging = page(SHOTS, 'busy', { play: captionTag });
export const CaptionTaggingNight = page(SHOTS, 'busy', { globals: { theme: 'dark' }, play: captionTag });
export const CaptionTaggingPhone = page(SHOTS, 'busy', { globals: PHONE, play: captionTag });
/**
 * Photos from `/`: the workspace's photos to use again, each drawn from its small preview, or for one from before previews,
 * from the photo itself made small here once. One already in this document keeps its caption, and none starts with a file's name.
 */
const reusePhotos: PageStory['play'] = async ({ canvas, userEvent, step }) => {
  await step('Press + beside the first line: the same menu as /', async () => {
    const first = await canvas.findByText(/^From the design review/, undefined, { timeout: 8000 });
    await userEvent.hover(first);
    const [add] = await canvas.findAllByRole('button', { name: 'Add a block' }, { timeout: 5000 });
    if (add) await userEvent.click(add);
  });
  await step('Pick Photos. The picker shows the workspace’s photos small', async () => {
    const photos = await screen.findAllByText(/^Photos$/, undefined, { timeout: 5000 });
    const row = photos.at(-1);
    if (row) await userEvent.click(row);
  });
};
export const ReusePhotos = page(SHOTS, 'busy', { play: reusePhotos });
export const ReusePhotosNight = page(SHOTS, 'busy', { globals: { theme: 'dark' }, play: reusePhotos });
export const ReusePhotosPhone = page(SHOTS, 'busy', { globals: PHONE, play: reusePhotos });
/** On a phone, holding a block opens its menu as a sheet: here the screenshots', with Delete the photos for good. */
export const HoldingABlockPhone = page(SHOTS, 'busy', { globals: PHONE, play: hold('.ws-ed .wb.is-gallery') });
/** Aiko's walkthrough still uploading, a recording too big to keep here, and a photo deleted for good. */
export const UploadingAndWhatDidnt = page(UPLOADS, 'busy');
export const UploadingAndWhatDidntNight = page(UPLOADS, 'busy', { globals: { theme: 'dark' } });

/** Opens History from the document's ⋯. */
const history: PageStory['play'] = async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'More for this document' }, { timeout: 8000 }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'History' }, { timeout: 5000 }));
};
/**
 * History, grouped by call: Kofi's edits this afternoon on their own, then the standup the document was made in, under its
 * note's title. A version's tags keep their faces.
 */
export const History = page(FIXES, 'busy', { play: history });
export const HistoryNight = page(FIXES, 'busy', { globals: { theme: 'dark' }, play: history });
/** A version kept while the walkthrough was still uploading and the recording had been refused: it shows neither. */
export const HistorySkipsUploads = page(UPLOADS, 'busy', { play: history });

/** Alcove wouldn't take Art's last edits: the words are on the page, with Copy text, Save as new document and Discard. */
export const CouldntSave = page(at('ws-product', 'Pricing page copy'), 'unsaved');
/** More than one document holds: delete something, or send a block to another document, and it saves. */
export const TooBig = page(at('ws-product', 'Interview notes'), 'unsaved');
/** Made a reader with words not yet saved: they can be copied or discarded. */
export const ReaderNow = page(at('ws-handbook', 'Expenses'), 'unsaved');
export const Offline = page(PLAN, 'offline');
/**
 * The browser's online, but Alcove can't be reached from it: the page says so rather than offline, keeps what's written here
 * until it saves, and Try now, on its bar, tries again at once rather than after the wait. The list's own connection is down
 * too, so it says Reconnecting, with Try now, rather than look up to date.
 */
const unreachable = (w: World) => {
  const id = itemId('Launch plan');
  w.pages[id] = { blocks: w.pages[id]?.blocks ?? [], ...w.pages[id], standing: 'offline' };
  w.streamsDown = ['ws-product'];
};
export const Unreachable = page(PLAN, 'busy', { beforeEach: changing(unreachable) });
export const UnreachableNight = page(PLAN, 'busy', { beforeEach: changing(unreachable), globals: { theme: 'dark' } });
export const UnreachablePhone = page(PLAN, 'busy', { beforeEach: changing(unreachable), globals: PHONE });
export const UnreachableWide = page(PLAN, 'busy', { beforeEach: changing(unreachable), globals: { viewport: { value: 'wide' } } });
/** Try now, on the page's bar and on the list: each is back at once. */
export const UnreachableTryNow = page(PLAN, 'busy', {
  beforeEach: changing(unreachable),
  play: async ({ canvas, userEvent, step }) => {
    /** Try now in what's under the page's head (`.wd-off`) or the list's (`.wt-off`). */
    const tryNow = async (under: string) => {
      const found = (await canvas.findAllByRole('button', { name: 'Try now' })).find((b) => b.closest(under) !== null);
      if (found) await userEvent.click(found);
    };
    await step('Press Try now, on the bar under the page’s head: it’s back at once', () => tryNow('.wd-off'));
    await step('Press Try now, under the list’s head: the list is up to date again', () => tryNow('.wt-off'));
  }
});
export const Night = page(PLAN, 'busy', { globals: { theme: 'dark' } });
export const Phone = page(PLAN, 'busy', { globals: PHONE });
/** Writing on a phone: the bar over the keyboard, for blocks, styles, @, photos and checklists. */
export const WritingPhone = page(PLAN, 'busy', {
  globals: PHONE,
  play: async ({ canvas, userEvent, step }) => {
    await step('Tap a line to write. The bar rises with the keyboard', async () => {
      await userEvent.click(await canvas.findByText(/^The launch moves to Wednesday/));
    });
  }
});
/** The bar's text style, as a sheet over it. */
export const WritingStylesPhone = page(PLAN, 'busy', {
  globals: { ...PHONE, theme: 'dark' },
  play: async ({ canvas, userEvent, step }) => {
    await step('Tap a line to write', async () => {
      await userEvent.click(await canvas.findByText(/^The launch moves to Wednesday/));
    });
    await step('Press Text style. Bold, italic and the rest, and what the line is', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Text style' }));
    });
  }
});
/** On a phone the list and the page take turns: the list, until something's open. */
export const PhoneList = page(at('ws-product'), 'busy', { globals: PHONE });
export const PhoneCouldntSave = page(at('ws-product', 'Pricing page copy'), 'unsaved', { globals: { ...PHONE, theme: 'dark' } });
