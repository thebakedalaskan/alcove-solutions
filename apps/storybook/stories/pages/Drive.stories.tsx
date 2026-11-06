/*
 * The Drive: every workspace you're in, newest first. A call's home says which call it was made for and when, one made by
 * hand when it was made; each opens on its own page, and a call's home has the call's folder at its top, whose Notes,
 * Follow-ups and Transcript open the call's note (user-flows 12).
 */
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';

const meta = { title: 'Pages/Drive', ...pages } satisfies Meta<PageArgs>;
export default meta;

const PHONE = { viewport: { value: 'phone' } };
/** Opens the standup's folder in its home's list: the row, not the workspace's own name, which is the same. */
const openFolder: PageStory['play'] = async ({ canvas, userEvent }) => {
  const named = await canvas.findAllByRole('button', { name: /^Team standup · / });
  const folder = named.find((b) => b.closest('.wt-r') !== null);
  if (folder) await userEvent.click(folder);
};

/** The day's calls' homes first, the standup's newest, then the workspaces made by hand. */
export const Busy = page('/drive', 'busy');
export const Night = page('/drive', 'busy', { globals: { theme: 'dark' } });
export const Phone = page('/drive', 'busy', { globals: PHONE });
export const PhoneNight = page('/drive', 'busy', { globals: { ...PHONE, theme: 'dark' } });
/** Before the first call: where workspaces come from. */
export const Empty = page('/drive', 'first-day');
export const EmptyNight = page('/drive', 'first-day', { globals: { theme: 'dark' } });
/** New workspace, named in place, in the sky. */
export const NewWorkspace = page('/drive', 'busy', {
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole('button', { name: 'New workspace' })); }
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
