/*
 * The Drive (docs/design/pages.md › The Drive, user-flows 12): the tree of places beside a sheet of large previews, in the
 * canvas's world (src/world/drive.ts): Recent by day, Shared with you, a workspace with its folders, calls and files, a
 * call's own workspace with the call and what it made, one Trash, what a search finds, and the first day. On a phone the
 * tree becomes chips.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { driveId, withNothingYet, withTheDrive } from '../../src/world/drive';

const meta = { title: 'Pages/Drive', ...pages } satisfies Meta<PageArgs>;
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

/** A call's own workspace: the call's Notes, Follow-ups and Transcript, what it made, and the standup before. */
export const ACallsWorkspace = page('/drive?ws=dv-standup', 'busy', DRIVE);
export const ACallsWorkspaceNight = page('/drive?ws=dv-standup', 'busy', { ...DRIVE, globals: NIGHT });
export const ACallsWorkspacePhone = page('/drive?ws=dv-standup', 'busy', { ...DRIVE, globals: { ...PHONE, ...NIGHT } });
/** A document open beside the tree, in the workspace it lives in, with ⤢ to give it the whole screen. */
export const ADocumentBesideTheTree = page(`/drive?ws=dv-standup&doc=${driveId('Launch checklist')}`, 'busy', DRIVE);
export const ADocumentBesideTheTreeNight = page(`/drive?ws=dv-standup&doc=${driveId('Launch checklist')}`, 'busy', { ...DRIVE, globals: NIGHT });
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
