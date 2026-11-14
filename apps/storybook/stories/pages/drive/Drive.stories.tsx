/*
 * The Drive (docs/design/pages.md › The Drive, user-flows 12): the tree of places beside a sheet of large previews, in the
 * canvas's world (src/world/drive.ts): Recent by day, Shared with you, a workspace with its folders, calls and files, a
 * call's own workspace with the call and what it made, one Trash, what a search finds, and the first day. On a phone the
 * tree becomes chips. Share: a whole workspace's, at the head of its sheet; a file's, in its card's ⋯ (with its way back to
 * the menu, and what it says when who has it can't be shown) and on its head beside the tree. A call's folder on the path
 * over what's open beside the tree, and a folder's head while its workspace loads.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { setOnline } from '../../../src/browser';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { driveId, withNothingYet, withTheDrive } from '../../../src/world/drive';
import type { World } from '../../../src/world/world';
import { pause } from '../../journeys/play';
import { troubled } from '../changes';

const meta = { title: 'Pages/Drive/Drive', ...pages } satisfies Meta<PageArgs>;
export default meta;

const DRIVE = { beforeEach: changing(withTheDrive) };
const FIRST = { beforeEach: changing(withNothingYet) };
const NIGHT = { theme: 'dark' };
const PHONE = { viewport: { value: 'phone' } };
const TABLET = { viewport: { value: 'tablet' } };
const WIDE = { viewport: { value: 'wide' } };
const LATER = { timeout: 8000 };

type Play = NonNullable<PageStory['play']>;
/** Opens a card's ⋯. */
const cardMenu = (name: string): Play => async ({ userEvent }) => {
  await userEvent.click(await screen.findByRole('button', { name: `More for ${name}` }, LATER));
};
/** Opens a card's ⋯, then Share, once the menu has been still a moment (a menu takes no press before). */
const cardShare = (name: string): Play => async (ctx) => {
  await cardMenu(name)(ctx);
  const row = await screen.findByRole('menuitem', { name: 'Share' }, LATER);
  await pause(500);
  await ctx.userEvent.click(row);
};
/** Presses Share: at the head of a workspace's sheet, or on the head of what's open beside the tree. */
const share: Play = async ({ userEvent }) => {
  await userEvent.click(await screen.findByRole('button', { name: 'Share' }, LATER));
};
/** Presses a step of the path over what's open beside the tree. */
const pressStep = (name: string): Play => async ({ userEvent, step }) => {
  await step(`Press ${name} on the path over the page`, async () => {
    const path = await screen.findByRole('navigation', { name: 'Where this document is' }, LATER);
    await userEvent.click(await within(path).findByRole('button', { name }, LATER));
  });
};
/** Status page runbook, moved into the folder of Launch planning · 27 Oct, as anything can be. */
const runbookInTheCall = (w: World): void => {
  const space = w.workspaces.find((s) => s.id === 'dv-launch');
  if (space) space.items = space.items.map((i) => (i.id === driveId('Status page runbook') ? { ...i, parent: driveId('Launch planning · 27 Oct') } : i));
};
/** The standup's checklist, moved into the folder of the standup before it, which Art has no notes of. */
const checklistInAnEarlierStandup = (w: World): void => {
  const space = w.workspaces.find((s) => s.id === 'dv-standup');
  if (space) space.items = space.items.map((i) => (i.id === driveId('Launch checklist') ? { ...i, parent: driveId('Team standup · 3 Nov') } : i));
};

/** Recent: everything you can open, by the day it was last edited, as large previews. */
export const Recent = page('/drive', 'busy', DRIVE);
export const RecentNight = page('/drive', 'busy', { ...DRIVE, globals: NIGHT });
export const RecentTablet = page('/drive', 'busy', { ...DRIVE, globals: TABLET });
export const RecentWide = page('/drive', 'busy', { ...DRIVE, globals: { ...WIDE, ...NIGHT } });
export const RecentPhone = page('/drive', 'busy', { ...DRIVE, globals: PHONE });
export const RecentPhoneNight = page('/drive', 'busy', { ...DRIVE, globals: { ...PHONE, ...NIGHT } });
/** The same as a list. */
export const RecentAsAList = page('/drive', 'busy', {
  ...DRIVE, play: async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: 'As a list' }, LATER)); }
});
/** A card's ⋯: Open, Copy link, Rename, Move to Trash. */
export const ACardsMenu = page('/drive', 'busy', { ...DRIVE, play: cardMenu('Launch checklist') });
export const ACardsMenuNight = page('/drive', 'busy', { ...DRIVE, globals: NIGHT, play: cardMenu('Launch checklist') });
/** New: a document, a board, files, or a workspace. */
export const New = page('/drive', 'busy', {
  ...DRIVE, play: async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: 'New' }, LATER)); }
});
/** New, then Document, from Recent: which workspace it goes in. */
export const NewDocumentWhere = page('/drive', 'busy', {
  ...DRIVE,
  play: async ({ userEvent }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'New' }, LATER));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Document' }, LATER));
  }
});

/** A workspace beside the tree: its folders, the calls kept in it, its files. */
export const AWorkspace = page('/drive?ws=dv-launch', 'busy', DRIVE);
export const AWorkspaceNight = page('/drive?ws=dv-launch', 'busy', { ...DRIVE, globals: NIGHT });
export const AWorkspacePhone = page('/drive?ws=dv-launch', 'busy', { ...DRIVE, globals: PHONE });
/** A folder in it, under the way back. */
export const AFolder = page(`/drive?ws=dv-launch&folder=${driveId('Research')}`, 'busy', DRIVE);
/** A workspace you can only read. */
export const ReadOnly = page('/drive?ws=dv-handbook', 'busy', DRIVE);

/** A call's own workspace: the call's Notes, Follow-ups and Transcript, its files with the ways to make more, and the standup before. */
export const ACallsWorkspace = page('/drive?ws=dv-standup', 'busy', DRIVE);
export const ACallsWorkspaceNight = page('/drive?ws=dv-standup', 'busy', { ...DRIVE, globals: NIGHT });
export const ACallsWorkspacePhone = page('/drive?ws=dv-standup', 'busy', { ...DRIVE, globals: { ...PHONE, ...NIGHT } });
/** Its row in the tree pressed again: folded, and still the place you're on. Pressed once more, it opens. */
const folding: Play = async ({ userEvent, step }) => {
  await step('Press the open row of the call you’re on, under From calls. It folds, and the sheet stays on the call', async () => {
    const tree = await screen.findByRole('navigation', { name: 'Places in the Drive' }, LATER);
    await userEvent.click(await within(tree).findByRole('button', { expanded: true }, LATER));
  });
};
export const ACallsWorkspaceFolded = page('/drive?ws=dv-standup', 'busy', { ...DRIVE, play: folding });
export const ACallsWorkspaceFoldedNight = page('/drive?ws=dv-standup', 'busy', { ...DRIVE, globals: NIGHT, play: folding });
/** A document open beside the tree, in the workspace it lives in, with ⤢ to give it the whole screen. */
export const ADocumentBesideTheTree = page(`/drive?ws=dv-standup&doc=${driveId('Launch checklist')}`, 'busy', DRIVE);
export const ADocumentBesideTheTreeNight = page(`/drive?ws=dv-standup&doc=${driveId('Launch checklist')}`, 'busy', { ...DRIVE, globals: NIGHT });
/** A board open beside the tree: its head has Share, as a document's does, which opens who can add to it. */
export const ABoardBesideTheTree = page(`/drive?ws=dv-standup&doc=${driveId('Standup board')}`, 'busy', DRIVE);
export const ABoardBesideTheTreeShare = page(`/drive?ws=dv-standup&doc=${driveId('Standup board')}`, 'busy', { ...DRIVE, globals: NIGHT, play: share });

/* ---------- sharing ---------- */

/** Share, beside Open full screen at the head of a workspace's sheet: who's in it, and for its admin, adding people. */
export const AWorkspacesShare = page('/drive?ws=dv-launch', 'busy', { ...DRIVE, play: share });
export const AWorkspacesShareNight = page('/drive?ws=dv-launch', 'busy', { ...DRIVE, globals: NIGHT, play: share });
export const AWorkspacesSharePhone = page('/drive?ws=dv-launch', 'busy', { ...DRIVE, globals: PHONE, play: share });
/** A call's own workspace: its organizer and everyone invited, and whoever its admins add, beyond the invite too. */
export const ACallsWorkspaceShare = page('/drive?ws=dv-standup', 'busy', { ...DRIVE, play: share });
export const ACallsWorkspaceSharePhone = page('/drive?ws=dv-standup', 'busy', { ...DRIVE, globals: { ...PHONE, ...NIGHT }, play: share });
/** In a workspace Art can only read: who's in it, and who to ask to add someone, as only an admin can. */
export const ReadOnlyShare = page('/drive?ws=dv-handbook', 'busy', { ...DRIVE, play: share });
/** Share, in a card's ⋯: who has it, in the menu's place, the same sheet as Share on its own page, with ← back to the rows. */
export const ACardsShare = page('/drive', 'busy', { ...DRIVE, play: cardShare('Standup board') });
export const ACardsShareNight = page('/drive', 'busy', { ...DRIVE, globals: NIGHT, play: cardShare('Launch checklist') });
/** ← in Share goes back to the card's menu: Copy link, Rename and the rest, without opening it again. */
export const ACardsShareBack = page('/drive', 'busy', {
  ...DRIVE,
  play: async (ctx) => {
    await cardShare('Standup board')(ctx);
    await ctx.userEvent.click(await screen.findByRole('button', { name: 'Back' }, LATER));
    await screen.findByRole('menuitem', { name: 'Copy link' }, LATER);
  }
});
/** Its workspace can't be opened any more (Art was taken out of it, say): Share says so, not that Alcove couldn't be reached. */
export const ACardsShareRefused = page('/drive', 'busy', {
  beforeEach: changing(withTheDrive, troubled({ 'workspaces.get': (id) => (id === 'dv-standup' ? 'gone' : null) })), play: cardShare('Standup board')
});
/** The connection goes, and who has it was never read: it says it shows once Alcove can be reached, rather than waiting with dots. */
export const ACardsShareOffline = page('/drive', 'busy', {
  ...DRIVE,
  play: async (ctx) => {
    await cardMenu('Standup board')(ctx);
    const row = await screen.findByRole('menuitem', { name: 'Share' }, LATER);
    setOnline(false);
    await pause(500);
    await ctx.userEvent.click(row);
  }
});
/**
 * A document kept in a call's folder, beside the tree: the call on its path goes where the call's row in the Drive does, to the
 * call's own page, once it has notes.
 */
export const ACallsFolderOnThePath = page(`/drive?ws=dv-launch&doc=${driveId('Status page runbook')}`, 'busy', {
  beforeEach: changing(withTheDrive, runbookInTheCall), play: pressStep('Launch planning · 27 Oct')
});
/** One Art has no notes of: its row opens nothing, so the call on the path shows where its row is, its workspace. */
export const ACallsFolderOnThePathNoNotes = page(`/drive?ws=dv-standup&doc=${driveId('Launch checklist')}`, 'busy', {
  beforeEach: changing(withTheDrive, checklistInAnEarlierStandup), play: pressStep('Team standup · 3 Nov')
});
/** A folder's address, while its workspace loads: the head has Open full screen and no Share, as the folder's own will. */
export const AFolderLoading = page(`/drive?ws=dv-launch&folder=${driveId('Research')}`, 'busy', {
  beforeEach: changing(withTheDrive, troubled({ 'workspaces.get': 'hold' }))
});
/** Before a call: what's been made for it, and the ways to add to it. */
export const ACallAhead = page('/drive?ws=dv-checkin', 'busy', DRIVE);

/** What's shared with you from workspaces you're not in. */
export const SharedWithYou = page('/drive?show=shared', 'busy', DRIVE);
/** One Trash, across every workspace. */
export const Trash = page('/drive?show=trash', 'busy', DRIVE);
export const TrashNight = page('/drive?show=trash', 'busy', { ...DRIVE, globals: NIGHT });
/** What a search finds, as it's typed. */
export const Found = page('/drive?q=launch', 'busy', DRIVE);
export const NothingFound = page('/drive?q=zebra%20crossing', 'busy', DRIVE);

/** On a phone, Workspaces and From calls are places of their own. */
export const PhoneWorkspaces = page('/drive?show=workspaces', 'busy', { ...DRIVE, globals: PHONE });
export const PhoneCalls = page('/drive?show=calls', 'busy', { ...DRIVE, globals: { ...PHONE, ...NIGHT } });

/** The first day: Recent, Shared with you, Workspaces with New workspace, Trash, and one empty state. */
export const FirstDay = page('/drive', 'first-day', FIRST);
export const FirstDayNight = page('/drive', 'first-day', { ...FIRST, globals: NIGHT });
export const FirstDayPhone = page('/drive', 'first-day', { ...FIRST, globals: PHONE });
