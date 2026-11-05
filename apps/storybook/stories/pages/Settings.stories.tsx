/* Settings: change one thing and leave. One long sheet with an index beside it (user-flows 11). */
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs } from '../../src/page';

const meta = { title: 'Pages/Settings', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Busy = page('/settings', 'busy');
export const FirstDay = page('/settings', 'first-day');
export const OnTheirOwn = page('/settings', 'on-their-own');
/** Opened at the minutes, from the side panel. */
export const Minutes = page('/settings#plan', 'busy');
