/* Team: your company standing on the horizon, your groups and the people not on Alcove yet on the water (user-flows 10). */
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs } from '../../src/page';

const meta = { title: 'Pages/Team', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Busy = page('/team', 'busy');
export const FirstDay = page('/team', 'first-day');
export const Lots = page('/team', 'lots');
/** A group open, from the side panel. */
export const AGroup = page('/team?group=g-product', 'busy');
/** Someone on their own has no team: the address goes Home. */
export const OnTheirOwn = page('/team', 'on-their-own');
