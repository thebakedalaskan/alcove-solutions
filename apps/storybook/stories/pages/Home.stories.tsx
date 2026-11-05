/* Home: the sunset with Start a call in the middle, and what's yours on the water (docs/design/pages.md, user-flows 3). */
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs } from '../../src/page';

const meta = { title: 'Pages/Home', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Busy = page('/home', 'busy');
export const FirstDay = page('/home', 'first-day');
export const CallSoon = page('/home', 'call-soon');
export const OnTheirOwn = page('/home', 'on-their-own');
export const Writing = page('/home', 'writing');
export const Offline = page('/home', 'offline');
export const Lots = page('/home', 'lots');
