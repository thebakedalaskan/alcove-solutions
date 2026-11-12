/*
 * The side panel's foot, by plan (docs/design/pages.md › The frame; the canvas's Side board): under the confidential-compute
 * check, on Free about how much of the period's notes is left over a meter and Free plan with See plans; on Pro one calm
 * row with its own small sun and until when; ending, its sun half set and Extend; a payment for a plan on its way, what
 * it's waiting for and Open. Pro renewed or ended is one short line above until it's dismissed. On Plans the row is the
 * place you're on. Each opens on Home, at a laptop's width, by day and by night (the panel itself is night in both).
 */
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';

const meta = { title: 'Pages/The side panel', ...pages } satisfies Meta<PageArgs>;
export default meta;

const LAPTOP = { viewport: { value: 'laptop', isRotated: false } } as const;
/** The foot at a laptop's width, by day. */
const foot = (path: string, scenario: PageArgs['scenario']): PageStory => page(path, scenario, { globals: LAPTOP });
/** The same at night. */
const night = (story: PageStory): PageStory => ({ ...story, globals: { ...LAPTOP, theme: 'dark' } });

/** Free: about 3 h 20 min of the period's 5 hours left, over a meter, then Free plan · See plans. */
export const Free = foot('/home', 'busy');
export const FreeNight = night(Free);
/** Under an hour left: the time and the meter turn warm. */
export const FreeLow = foot('/home', 'plan-low');
export const FreeLowNight = night(FreeLow);
/** None left: until when, in caution, and an empty meter. */
export const FreeOut = foot('/home', 'plan-stopped');
export const FreeOutNight = night(FreeOut);
/** A payment for a year of Pro on its way: what it's waiting for, and the row that opens it again. */
export const Waiting = foot('/home', 'plan-buying-pro');
export const WaitingNight = night(Waiting);
/** Pro: the small sun on its line, Pro, and until when. It opens Settings › Plan. */
export const Pro = foot('/home', 'plan-pro');
export const ProNight = night(Pro);
/** Pro extended by a year: the same row, until a year on. */
export const ProExtended = foot('/home', 'plan-pro-extended');
/** Pro ending in 3 days and not renewing: the sun half set, and Extend, which opens checkout. */
export const ProEnding = foot('/home', 'plan-pro-ending');
export const ProEndingNight = night(ProEnding);
/** Pro renewed from the balance: one short line above the row, until it's dismissed in Settings. */
export const ProRenewed = foot('/home', 'plan-pro-renewed');
export const ProRenewedNight = night(ProRenewed);
/** Pro ended: back on Free, said in one short line above the notes left until it's dismissed. */
export const ProEnded = foot('/home', 'plan-pro-ended');
export const ProEndedNight = night(ProEnded);
/** On Plans, the row is the place you're on, shaded as a place is: the one shaded row in the panel. */
export const OnPlans = foot('/plans', 'busy');
export const OnPlansNight = night(OnPlans);
export const OnPlansPro = foot('/plans', 'plan-pro');
