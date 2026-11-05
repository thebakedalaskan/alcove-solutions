/* Notes: the search in the middle of the sky, the list on the water, and a preview beside it on a wide screen (user-flows 8). */
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs } from '../../src/page';

const meta = { title: 'Pages/Notes', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Busy = page('/notes', 'busy');
export const FirstDay = page('/notes', 'first-day');
export const Writing = page('/notes', 'writing');
export const OnTheirOwn = page('/notes', 'on-their-own');
export const Offline = page('/notes', 'offline');
export const Lots = page('/notes', 'lots');
