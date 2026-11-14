/*
 * A workspace, from the Drive: the list beside the page, or one at a time on a phone; sharing, Trash, a workspace you can
 * only read; tags, comments, photos, video and files in a document; its History, grouped by call; and what the page says
 * when Alcove won't take what's written, with the words offered back (user-flows 12).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { rememberSeen } from '~/features/workspace/tree/seen';
import { drawnPicture } from '../../../src/api/media';
import { itemId } from '../../../src/api/scenarios';
import { caretAtEnd, changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import type { World } from '../../../src/world/world';
import { iso } from '../../../src/world/clock';
import { ME_ID } from '../../../src/world/people';
import { HIRING_SYNC, JUST_OPENED, LAUNCH, spaceItem, withJustMade, withWorkspaces } from '../../../src/world/workspaces';
import { troubled } from '../changes';

const meta = { title: 'Pages/Drive/Workspace', ...pages } satisfies Meta<PageArgs>;
export default meta;


/** A workspace's address, or one of its documents', by the document's name. */
const at = (workspace: string, name?: string) => `/drive/${workspace}${name === undefined ? '' : `/${itemId(name)}`}`;
const PLAN = at('ws-product', 'Launch plan');
const FIXES = at('ws-standup', 'Onboarding fixes');
const SHOTS = at('ws-review', 'Sidebar screenshots');
const UPLOADS = at('ws-review', 'Review uploads');
const PHONE = { viewport: { value: 'phone' } };

/* ---------- full screen (the canvas's A workspace board) ---------- */

const launch = changing(withWorkspaces);
const DESKTOP = { viewport: { value: 'laptop', isRotated: false } };
const WIDE = { viewport: { value: 'wide', isRotated: false } };
const TABLET = { viewport: { value: 'tablet', isRotated: false } };
const LAUNCH_HOME = `/drive/${LAUNCH}`;
const LAUNCH_PLAN_PAGE = `/drive/${LAUNCH}/${spaceItem('Launch plan')}`;
const STANDUP_MADE = '/drive/ws-standup?from=calls';
const STANDUP_CHECKLIST = `/drive/ws-standup/${spaceItem('Launch checklist')}`;
const AGENDA_PAGE = `/drive/${HIRING_SYNC}/${spaceItem('Agenda')}?from=calls`;
/**
 * Launch's Home, full screen: its name on the evening after sunset, under a clear bar; who's in it; what was edited lately as
 * large previews; and the calls kept in it, the next one first. Its pages down the dark side panel, with the calls under Calls.
 */
export const Home = page(LAUNCH_HOME, 'busy', { beforeEach: launch, globals: DESKTOP });
export const HomeNight = page(LAUNCH_HOME, 'busy', { beforeEach: launch, globals: { ...DESKTOP, theme: 'dark' } });
export const HomeTablet = page(LAUNCH_HOME, 'busy', { beforeEach: launch, globals: TABLET });
export const HomeWide = page(LAUNCH_HOME, 'busy', { beforeEach: launch, globals: { ...WIDE, theme: 'dark' } });
/** On a phone a workspace opens on its pages: Home among them, then each page, its calls and Trash. */
export const HomePhone = page(LAUNCH_HOME, 'busy', { beforeEach: launch, globals: PHONE });
/** Home on a phone, from its pages: back goes to them. */
export const HomePhonePage = page(LAUNCH_HOME, 'busy', {
  beforeEach: launch, globals: { ...PHONE, theme: 'dark' },
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole('button', { name: 'Home' }, { timeout: 8000 })); }
});
/**
 * A page, full screen: Launch plan, with which call it came from, who made it, @mentions, ticks and dates, the callout's
 * comments in the margin, a quote from the call with its moment, and Priya writing in it, her caret in the focus colour.
 */
export const APage = page(LAUNCH_PLAN_PAGE, 'busy', { beforeEach: launch, globals: DESKTOP });
export const APageNight = page(LAUNCH_PLAN_PAGE, 'busy', { beforeEach: launch, globals: { ...DESKTOP, theme: 'dark' } });
export const APageWide = page(LAUNCH_PLAN_PAGE, 'busy', { beforeEach: launch, globals: WIDE });
export const APagePhone = page(LAUNCH_PLAN_PAGE, 'busy', { beforeEach: launch, globals: { ...PHONE, theme: 'dark' } });
/** The callout's thread, opened from its count in the margin. */
export const APageThread = page(LAUNCH_PLAN_PAGE, 'busy', {
  beforeEach: launch, globals: DESKTOP,
  play: async ({ canvas, userEvent }) => {
    const [count] = await canvas.findAllByRole('button', { name: 'Open the comments' }, { timeout: 8000 });
    if (count) await userEvent.click(count);
  }
});
/**
 * A call's own workspace, opened from the call: it has no Home, so it opens on what's in it, with the call itself first in its
 * list (anything made in the call is under its row), then the workspace's own Pages, where + makes something, then the
 * standups before it.
 */
export const WhatTheCallMade = page(STANDUP_MADE, 'busy', { beforeEach: launch, globals: { ...DESKTOP, theme: 'dark' } });
export const WhatTheCallMadeLight = page(STANDUP_MADE, 'busy', { beforeEach: launch, globals: DESKTOP });
/** What the call made, opened full screen from the Drive: the way back says Drive. */
export const ACallsPage = page(STANDUP_CHECKLIST, 'busy', { beforeEach: launch, globals: DESKTOP });
/**
 * An agenda Art just made in Hiring sync's workspace, before its call tomorrow: its pages are For the call, and Ines is reading
 * it. It's Art's, so it never says New.
 */
export const AnAgendaJustMade = page(AGENDA_PAGE, 'busy', { beforeEach: launch, globals: { ...DESKTOP, theme: 'dark' } });
export const AnAgendaJustMadePhone = page(AGENDA_PAGE, 'busy', { beforeEach: launch, globals: PHONE });

/** Launch with what's just been made in it, and Priya's press quotes opened in this browser a minute ago. */
const justMade = changing(withWorkspaces, withJustMade, () => { rememberSeen(ME_ID, JUST_OPENED); });
/**
 * What's new to Art, full screen: Kofi's pricing FAQ, made three minutes ago, says New until it's opened. Art's own launch
 * tweet never does, and nor do Priya's press quotes, which Art has opened.
 */
export const WhatsNew = page(LAUNCH_HOME, 'busy', { beforeEach: justMade, globals: DESKTOP });
export const WhatsNewNight = page(LAUNCH_HOME, 'busy', { beforeEach: justMade, globals: { ...DESKTOP, theme: 'dark' } });
export const WhatsNewWide = page(LAUNCH_HOME, 'busy', { beforeEach: justMade, globals: WIDE });
/** On a phone, among the workspace's pages. */
export const WhatsNewPhone = page(LAUNCH_HOME, 'busy', { beforeEach: justMade, globals: { ...PHONE, theme: 'dark' } });
/** Opening Kofi's FAQ takes its New away, and it stays away back on Home. */
export const WhatsNewOpened = page(LAUNCH_HOME, 'busy', {
  beforeEach: justMade, globals: DESKTOP,
  play: async ({ canvas, userEvent, step }) => {
    await step('Open Pricing FAQ, which says New', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: /^Pricing FAQ/ }, { timeout: 8000 }));
    });
    await step('Back to Home: it doesn’t say New any more', async () => {
      await beat(600);
      await userEvent.click(await canvas.findByRole('button', { name: 'Home' }));
    });
  }
});
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

/** Launch, a team workspace the whole team is in, made last week, which Art runs (`admin`) or edits in. */
const withTeamSpace = (role: 'admin' | 'edit') => (w: World): void => {
  w.workspaces = [...w.workspaces, { id: 'ws-launch', name: 'Launch', role, inCall: false, people: 5, teamAccess: 'team', createdAt: iso(-6, 11, 0), call: null, items: [] }];
};
/** Opens People from the workspace's name at the top of its list. */
const teamPeople: PageStory['play'] = async ({ canvas, userEvent, step }) => {
  await step('Press Launch at the top of its list, then People', async () => {
    const named = await canvas.findAllByRole('button', { name: /^Launch/ }, { timeout: 8000 });
    const top = named.find((b) => b.closest('.wt-head') !== null);
    if (top) await userEvent.click(top);
    const people = await screen.findByRole('menuitem', { name: /^People/ }, { timeout: 5000 });
    // A menu takes no press until its rows have been still for a moment (WsMenu).
    await beat(800);
    await userEvent.click(people);
  });
};
/** A team's workspace, as its admin: who's in it, Whole team or Only people I add, above its people. */
export const TeamWorkspacePeople = page(at('ws-launch'), 'team-member', { beforeEach: changing(withTeamSpace('admin')), play: teamPeople });
export const TeamWorkspacePeopleNight = page(at('ws-launch'), 'team-member', { beforeEach: changing(withTeamSpace('admin')), play: teamPeople, globals: { theme: 'dark' } });
export const TeamWorkspacePeoplePhone = page(at('ws-launch'), 'team-member', { beforeEach: changing(withTeamSpace('admin')), play: teamPeople, globals: PHONE });
/** As someone who edits in it: which it is, said, not chosen. */
export const TeamWorkspacePeopleNotAdmin = page(at('ws-launch'), 'team-member', { beforeEach: changing(withTeamSpace('edit')), play: teamPeople });

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

/** The pricing sync's draft: long enough to scroll, with a thread on its first line. */
const DRAFT = at('ws-pricing', 'Pricing draft');
/** Opens the thread on the first line from its count in the margin, then scrolls the page down by `by` pixels. */
const scrollThread = (by: number, said: string): NonNullable<PageStory['play']> => async ({ canvas, canvasElement, userEvent, step }) => {
  await step('Open the thread on the first line, from its count in the margin', async () => {
    const [count] = await canvas.findAllByRole('button', { name: 'Open the comments' }, { timeout: 8000 });
    if (count) await userEvent.click(count);
    await screen.findByRole('dialog', { name: /^Comments on/ }, { timeout: 5000 });
  });
  await step(said, async () => {
    const scroller = canvasElement.querySelector('.wd-scroll');
    if (scroller) scroller.scrollTop = by;
    await beat(300);
  });
};
/** Scrolled a little: the thread moves with the words it's on. */
export const ThreadFollowsItsWords = page(DRAFT, 'busy', { play: scrollThread(90, 'Scroll the page down a little. The thread moves with its words') });
export const ThreadFollowsItsWordsNight = page(DRAFT, 'busy', { globals: { theme: 'dark' }, play: scrollThread(90, 'Scroll the page down a little. The thread moves with its words') });
/** Scrolled past the words: the thread goes out of view with them, and comes back when they do. */
export const ThreadGoesWithItsWords = page(DRAFT, 'busy', { play: scrollThread(400, 'Scroll on, past the words. The thread goes out of view with them') });
/** On a phone the thread is a sheet at the foot of the window, wherever its words have scrolled to. */
export const ThreadAsThePageScrollsPhone = page(DRAFT, 'busy', { globals: PHONE, play: scrollThread(400, 'Scroll past the words. The sheet stays at the foot of the window') });

/*
 * Dates in a document: `@` offers Today, Tomorrow and the next Friday, a day typed with its month first, and Pick a date…,
 * a month to pick any day from in the list's place. A date tag outside this year says its year (the draft's prices hold
 * until Sun 31 Jan 2027), and pressing one opens the month to change it.
 */
const startTagging = (typed: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(`Start a line under “The team plan”, and type @${typed}`, async () => {
    const line = await canvas.findByText('The team plan', {}, { timeout: 8000 });
    await userEvent.click(line);
    caretAtEnd(line);
    await userEvent.keyboard(`{Enter}@${typed}`);
    await screen.findByRole('listbox', { name: 'People, documents and dates' }, { timeout: 5000 });
  });
};
const pickADate: NonNullable<PageStory['play']> = async (c) => {
  await startTagging('')(c);
  await c.step('Press Pick a date…. A month takes the list’s place, with the keyboard on today', async () => {
    await c.userEvent.click(await screen.findByRole('option', { name: 'Pick a date…' }, { timeout: 5000 }));
    await screen.findByRole('grid', {}, { timeout: 5000 });
  });
};
const changeADate: NonNullable<PageStory['play']> = async ({ canvasElement, userEvent, step }) => {
  await step('Press the follow-up’s date, Fri 13 Nov. The month opens against it, on that day', async () => {
    let tag: Element | null = null;
    for (let tries = 0; !tag && tries < 50; tries++) { tag = canvasElement.querySelector('.ws-ed .wdt[data-d="2026-11-13"]'); if (!tag) await beat(200); }
    if (!tag) return;
    tag.scrollIntoView({ block: 'center' });
    await userEvent.click(tag);
  });
};
/** `@` on a new line: Dates at the foot of the list, with Pick a date… under them. */
export const DatesInTheList = page(DRAFT, 'busy', { play: startTagging('') });
export const DatesInTheListNight = page(DRAFT, 'busy', { globals: { theme: 'dark' }, play: startTagging('') });
export const DatesInTheListPhone = page(DRAFT, 'busy', { globals: PHONE, play: startTagging('') });
/** A day typed with its month, run together: @12dec offers Sat 12 Dec first. */
export const ATypedDate = page(DRAFT, 'busy', { play: startTagging('12dec') });
export const ATypedDatePhone = page(DRAFT, 'busy', { globals: PHONE, play: startTagging('12dec') });
/** Pick a date…: the month, in the list's place. */
export const PickADate = page(DRAFT, 'busy', { play: pickADate });
export const PickADateNight = page(DRAFT, 'busy', { globals: { theme: 'dark' }, play: pickADate });
export const PickADatePhone = page(DRAFT, 'busy', { globals: PHONE, play: pickADate });
export const PickADatePhoneNight = page(DRAFT, 'busy', { globals: { ...PHONE, theme: 'dark' }, play: pickADate });
/** Pressing a date tag: the month against it, on its day, to pick another. */
export const ChangeADate = page(DRAFT, 'busy', { play: changeADate });
export const ChangeADatePhone = page(DRAFT, 'busy', { globals: PHONE, play: changeADate });

/*
 * Code in a document: the draft's bill in JavaScript, Python and C++, each coloured as its language, which its corner says
 * and changes, as its block's menu does.
 */
const toTheCode = (): NonNullable<PageStory['play']> => async ({ canvasElement, step }) => {
  await step('Scroll to the bill, worked out in code in each language', async () => {
    let block: Element | null = null;
    for (let tries = 0; !block && tries < 50; tries++) { block = canvasElement.querySelector('.ws-ed .wb.is-code'); if (!block) await beat(200); }
    block?.scrollIntoView({ block: 'start' });
    /* Each language's colours come the first time a block in it is drawn. */
    await beat(600);
  });
};
export const CodeBlocks = page(DRAFT, 'busy', { play: toTheCode() });
export const CodeBlocksNight = page(DRAFT, 'busy', { globals: { theme: 'dark' }, play: toTheCode() });
export const CodeBlocksPhone = page(DRAFT, 'busy', { globals: PHONE, play: toTheCode() });
export const CodeBlocksPhoneNight = page(DRAFT, 'busy', { globals: { ...PHONE, theme: 'dark' }, play: toTheCode() });
/** The Python block's corner: its languages, Python ticked. Picking one changes it for everyone with the document. */
const pickALanguage: NonNullable<PageStory['play']> = async (c) => {
  await toTheCode()(c);
  await c.step('Press Python, in the second block’s corner', async () => {
    const [, python] = c.canvasElement.querySelectorAll('.ws-ed .wb.is-code .wb-lang');
    if (python) await c.userEvent.click(python);
  });
};
export const CodeLanguages = page(DRAFT, 'busy', { play: pickALanguage });
export const CodeLanguagesNight = page(DRAFT, 'busy', { globals: { theme: 'dark' }, play: pickALanguage });
export const CodeLanguagesPhone = page(DRAFT, 'busy', { globals: PHONE, play: pickALanguage });

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
/** On a phone, holding a block opens its menu as a sheet: here the screenshots', with Download the photos and Delete the photos for good. */
export const HoldingABlockPhone = page(SHOTS, 'busy', { globals: PHONE, play: hold('.ws-ed .wb.is-gallery') });
/** Opens a block's menu from its handle: points at the first block of this kind, and presses the handle beside it. */
const menuOf = (selector: string, said: string): NonNullable<PageStory['play']> => async ({ canvasElement, userEvent, step }) => {
  await step(said, async () => {
    let block: Element | null = null;
    for (let tries = 0; !block && tries < 50; tries++) { block = canvasElement.querySelector(selector); if (!block) await beat(200); }
    if (!block) return;
    await userEvent.hover(block);
    await userEvent.click(await screen.findByRole('button', { name: 'Drag to move, click for options' }, { timeout: 5000 }));
  });
};
/** The screenshots' menu: Download the photos saves each one as it was added, beside Delete the photos for good. */
export const PhotosMenu = page(SHOTS, 'busy', { play: menuOf('.ws-ed .wb.is-gallery', 'Point at the screenshots and press the handle beside them. Download the photos saves the originals') });
export const PhotosMenuNight = page(SHOTS, 'busy', { globals: { theme: 'dark' }, play: menuOf('.ws-ed .wb.is-gallery', 'Point at the screenshots and press the handle beside them. Download the photos saves the originals') });
/** The walkthrough's menu: Download saves the film itself. */
export const VideoMenu = page(SHOTS, 'busy', { play: menuOf('.ws-ed .wb.is-video', 'Point at the walkthrough and press the handle beside it. Download saves the film') });
/**
 * `/` → File: a picture chosen there goes on the page as a photo, as Photos and a drop put it, and anything that isn't a
 * picture or a film is a file, whose arrow downloads it. So is a picture Alcove can't show, such as a phone's HEIC photo:
 * File was asked for a file, so it isn't a photo that failed.
 */
const fileFrom = (make: () => Promise<File>, said: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step('Go to the end of “What goes out”, start a line under it, type / and pick File', async () => {
    const line = await canvas.findByText('What goes out', {}, { timeout: 8000 });
    await userEvent.click(line);
    caretAtEnd(line);
    await userEvent.keyboard('{Enter}/');
    await userEvent.click(await screen.findByRole('option', { name: /^File/ }, { timeout: 5000 }));
  });
  await step(said, async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Choose from this computer' }, { timeout: 5000 }));
    await userEvent.upload(screen.getByLabelText('Choose files to add'), await make());
  });
};
const aPicture = async () => new File([await drawnPicture('Offsite whiteboard', 205, 1600, 1000)], 'Offsite whiteboard.png', { type: 'image/png' });
const aPdf = async () => new File(['%PDF-1.4\n% Launch timeline\n'], 'Launch timeline.pdf', { type: 'application/pdf' });
const aHeic = async () => new File([new Uint8Array(2048)], 'IMG_2041.HEIC', { type: 'image/heic' });
const PICTURE = fileFrom(aPicture, 'Choose a picture. It goes on the page as a photo');
const PDF = fileFrom(aPdf, 'Choose a PDF. It goes on the page as a file, with its arrow to download it');
const HEIC = fileFrom(aHeic, 'Choose a phone’s HEIC photo. Alcove can’t show one, so it goes on the page as a file, with its arrow to download it');
export const FileAPicture = page(PLAN, 'busy', { play: PICTURE });
export const FileAPictureNight = page(PLAN, 'busy', { globals: { theme: 'dark' }, play: PICTURE });
export const FileAPicturePhone = page(PLAN, 'busy', { globals: PHONE, play: PICTURE });
export const FileAPicturePhoneNight = page(PLAN, 'busy', { globals: { ...PHONE, theme: 'dark' }, play: PICTURE });
export const FileAPdf = page(PLAN, 'busy', { play: PDF });
export const FileAPdfNight = page(PLAN, 'busy', { globals: { theme: 'dark' }, play: PDF });
export const FileAPdfPhone = page(PLAN, 'busy', { globals: PHONE, play: PDF });
export const FileAPdfPhoneNight = page(PLAN, 'busy', { globals: { ...PHONE, theme: 'dark' }, play: PDF });
export const FileAHeicPhoto = page(PLAN, 'busy', { play: HEIC });
export const FileAHeicPhotoNight = page(PLAN, 'busy', { globals: { theme: 'dark' }, play: HEIC });
export const FileAHeicPhotoPhone = page(PLAN, 'busy', { globals: PHONE, play: HEIC });
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

/*
 * Storage full (docs/product/user-flows.md 16.11): past Free's storage, with the grace over, a file added to a document is refused
 * before any of it is kept, and the toast says so as the doors do, with Get Pro and how much room Pro has. The block stays,
 * saying it didn't upload, with Try again.
 */
const STORAGE_FULL = fileFrom(aPdf, 'Choose a PDF. Your storage is full, so it isn’t kept: Pro has 100 GB, and Get Pro is a press away');
export const StorageFull = page(PLAN, 'plan-over', { play: STORAGE_FULL });
export const StorageFullNight = page(PLAN, 'plan-over', { globals: { theme: 'dark' }, play: STORAGE_FULL });
export const StorageFullPhone = page(PLAN, 'plan-over', { globals: PHONE, play: STORAGE_FULL });
