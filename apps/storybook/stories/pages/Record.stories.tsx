/* Record: the night, with the recorder for a sun, and what's been recorded on the water (user-flows 9). */
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs } from '../../src/page';

const meta = { title: 'Pages/Record', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Busy = page('/record', 'busy');
export const FirstDay = page('/record', 'first-day');
/** Without a connection Record still works: it records on this device. */
export const Offline = page('/record', 'offline');
