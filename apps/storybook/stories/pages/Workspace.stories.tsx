/*
 * The workspace: the list beside the page, or one at a time on a phone; sharing, Trash, a workspace you can only read, and
 * what the page says when Alcove won't take what's written, with the words offered back (user-flows 12).
 */
import type { Meta } from '@storybook/react-vite';
import { itemId } from '../../src/api/scenarios';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';

const meta = { title: 'Pages/Workspace', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** A workspace's address, or one of its documents', by the document's name. */
const at = (workspace: string, name?: string) => `/workspace/${workspace}${name === undefined ? '' : `/${itemId(name)}`}`;
const PLAN = at('ws-product', 'Launch plan');
const PHONE = { viewport: { value: 'phone' } };
/** Opens the document's Share sheet. */
const share: PageStory['play'] = async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Share' }));
};

/** Product, which Art runs: the launch plan open beside the list. */
export const ADocument = page(PLAN, 'busy');
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
/** Alcove wouldn't take Art's last edits: the words are on the page, with Copy text, Save as new document and Discard. */
export const CouldntSave = page(at('ws-product', 'Pricing page copy'), 'unsaved');
/** More than one document holds: delete something, or send a block to another document, and it saves. */
export const TooBig = page(at('ws-product', 'Interview notes'), 'unsaved');
/** Made a reader with words not yet saved: they can be copied or discarded. */
export const ReaderNow = page(at('ws-handbook', 'Expenses'), 'unsaved');
export const Offline = page(PLAN, 'offline');
export const FirstDay = page('/workspace', 'first-day');
export const Night = page(PLAN, 'busy', { globals: { theme: 'dark' } });
export const Phone = page(PLAN, 'busy', { globals: PHONE });
/** On a phone the list and the page take turns: the list, until something's open. */
export const PhoneList = page(at('ws-product'), 'busy', { globals: PHONE });
export const PhoneCouldntSave = page(at('ws-product', 'Pricing page copy'), 'unsaved', { globals: { ...PHONE, theme: 'dark' } });
