/*
 * The Drive: every workspace you're in, newest first. One made for a call says which call and when, one made by hand when it
 * was made; each opens on its own page, and a call's workspace has the call's folder at its top, whose Notes, Follow-ups and
 * Transcript open the call's note. Whoever runs a workspace deletes it from its row's menu, or its own (user-flows 12).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import type { World } from '../../src/world';
import { iso } from '../../src/world/clock';
import { standupTwice } from './changes';

const meta = { title: 'Pages/Drive', ...pages } satisfies Meta<PageArgs>;
export default meta;

const PHONE = { viewport: { value: 'phone' } };
/** Launch, a team workspace the whole team is in, made last week, which Art runs (`admin`) or edits in. */
const withTeamSpace = (role: 'admin' | 'edit') => (w: World): void => {
  w.workspaces = [...w.workspaces, { id: 'ws-launch', name: 'Launch', role, people: 5, teamAccess: 'team', createdAt: iso(-6, 11, 0), call: null, items: [] }];
};

/** Opens the standup's folder in its home's list: the row, not the workspace's own name, which is the same. */
const openFolder: PageStory['play'] = async ({ canvas, userEvent }) => {
  const named = await canvas.findAllByRole('button', { name: /^Team standup · / });
  const folder = named.find((b) => b.closest('.wt-r') !== null);
  if (folder) await userEvent.click(folder);
};
/** Opens the picker at the top of the standup's list: the workspace's own name there, not its call's folder, named the same. */
const openPicker: PageStory['play'] = async ({ canvas, userEvent }) => {
  const named = await canvas.findAllByRole('button', { name: /^Team standup · / });
  const top = named.find((b) => b.closest('.wt-head') !== null);
  if (top) await userEvent.click(top);
};

/** The day's calls' homes first, the standup's newest, then the workspaces made by hand. */
export const Busy = page('/drive', 'busy');
export const Night = page('/drive', 'busy', { globals: { theme: 'dark' } });
export const Phone = page('/drive', 'busy', { globals: PHONE });
export const PhoneNight = page('/drive', 'busy', { globals: { ...PHONE, theme: 'dark' } });
/** Before the first call: where workspaces come from. */
export const Empty = page('/drive', 'first-day');
export const EmptyNight = page('/drive', 'first-day', { globals: { theme: 'dark' } });
/** On a phone with little in it, the sea still goes down to the tab bar: no seam where the scene would stop. */
export const EmptyPhone = page('/drive', 'first-day', { globals: PHONE });
export const EmptyPhoneNight = page('/drive', 'first-day', { globals: { ...PHONE, theme: 'dark' } });
/** New workspace, named in place, in the sky. */
export const NewWorkspace = page('/drive', 'busy', {
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole('button', { name: 'New workspace' })); }
});
/* ------------------------------------------------------------------ on a team */
/** Presses New workspace. */
const newWorkspace: PageStory['play'] = async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole('button', { name: 'New workspace' })); };
/**
 * Licensed on a team: New workspace asks who's in it under its name, Whole team (as it starts) or Only people I add. A team
 * workspace's row says Whole team.
 */
export const NewWorkspaceOnATeam = page('/drive', 'team-member', { beforeEach: changing(withTeamSpace('admin')), play: newWorkspace });
export const NewWorkspaceOnATeamNight = page('/drive', 'team-member', { beforeEach: changing(withTeamSpace('admin')), play: newWorkspace, globals: { theme: 'dark' } });
export const NewWorkspaceOnATeamPhone = page('/drive', 'team-member', { beforeEach: changing(withTeamSpace('admin')), play: newWorkspace, globals: PHONE });
export const NewWorkspaceOnATeamPhoneNight = page('/drive', 'team-member', { beforeEach: changing(withTeamSpace('admin')), play: newWorkspace, globals: { ...PHONE, theme: 'dark' } });
/** Only people I add, chosen: it says who can open it. */
export const NewWorkspaceOnlyPeopleAdded = page('/drive', 'team-member', {
  play: async (c) => {
    await newWorkspace?.(c);
    await c.step('Choose Only people I add', async () => { await c.userEvent.click(await c.canvas.findByRole('button', { name: 'Only people I add' })); });
  }
});
/** Not on a team: New workspace is only its name, as ever. */
export const NewWorkspaceOffATeam = page('/drive', 'no-team', { play: newWorkspace });

/** A workspace's menu, at the end of its row, for whoever runs it: Delete workspace. */
const rowMenu: PageStory['play'] = async ({ canvas, userEvent, step }) => {
  await step('Press More at the end of Product’s row', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: 'More for Product' }, { timeout: 8000 }));
  });
};
export const RowMenu = page('/drive', 'busy', { play: rowMenu });
export const RowMenuNight = page('/drive', 'busy', { play: rowMenu, globals: { theme: 'dark' } });
export const RowMenuPhone = page('/drive', 'busy', { play: rowMenu, globals: PHONE });
/** Delete workspace asks first, in the menu's place: it goes for everyone, with every document and board in it. */
const deleteAsk: PageStory['play'] = async (c) => {
  await rowMenu?.(c);
  await c.step('Press Delete workspace. It asks first', async () => {
    await c.userEvent.click(await screen.findByRole('button', { name: /^Delete workspace/ }, { timeout: 5000 }));
  });
};
export const DeleteAsk = page('/drive', 'busy', { play: deleteAsk });
export const DeleteAskPhone = page('/drive', 'busy', { play: deleteAsk, globals: PHONE });
/** Deleted: its row goes, and a toast says it went for everyone. */
export const Deleted = page('/drive', 'busy', {
  play: async (c) => {
    await deleteAsk?.(c);
    await c.step('Press Delete. Once Alcove says it’s done, the row goes', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Delete' }, { timeout: 5000 }));
      await screen.findByText('Product is deleted for everyone', {}, { timeout: 8000 });
    });
  }
});
/** Its own menu, at the top of its list, has Delete workspace too, for whoever runs it; deleting it goes back to the Drive. */
export const DeleteFromItsMenu = page('/drive/ws-product', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Product at the top of its list, then Delete workspace', async () => {
      const named = await canvas.findAllByRole('button', { name: /^Product/ }, { timeout: 8000 });
      const top = named.find((b) => b.closest('.wt-head') !== null);
      if (top) await userEvent.click(top);
      const remove = await screen.findByRole('menuitem', { name: /^Delete workspace/ }, { timeout: 5000 });
      // A menu takes no press until its rows have been still for a moment, as the workspaces come in (WsMenu).
      await new Promise<void>((done) => { setTimeout(done, 800); });
      remove.scrollIntoView({ block: 'nearest' });
      await userEvent.click(remove);
    });
  }
});
/** The standup's home: the call's folder at the top, open on the call's Notes, Follow-ups and Transcript. */
export const ACallsHome = page('/drive/ws-standup', 'busy', { play: openFolder });
export const ACallsHomePhone = page('/drive/ws-standup', 'busy', { globals: PHONE });
/** The folder's Notes: the call's note. */
export const TheCallsNotes = page('/notes/n2', 'busy');
/** The folder's Follow-ups: the note, at what the call left to do. */
export const TheCallsFollowUps = page('/notes/n2#follow-ups', 'busy');
/** The folder's Transcript: the note, at what was said. */
export const TheCallsTranscript = page('/notes/n2#transcript', 'busy');
/**
 * The standup twice in one day, each run with a home of its own: the two share a name, so each says when its call started
 * ("Team standup · 4 Nov, 09:00"), to the second if two started in the same minute.
 */
export const SameCallTwice = page('/drive', 'busy', { beforeEach: changing(standupTwice) });
export const SameCallTwicePhone = page('/drive', 'busy', { beforeEach: changing(standupTwice), globals: PHONE });
/** The same in the picker at the top of the standup's list. */
export const SameCallTwicePicker = page('/drive/ws-standup', 'busy', { beforeEach: changing(standupTwice), play: openPicker });
