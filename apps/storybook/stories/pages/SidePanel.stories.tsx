/*
 * The side panel's foot, by plan (docs/design/pages.md › The frame; the canvas's Side board): under the confidential-compute
 * check, on Free about how much of the period's notes is left over a meter and Free plan with See plans; on Pro one calm
 * row with its own small sun and until when; ending, its sun half set and Extend; a payment for a plan on its way, what
 * it's waiting for and Open. Pro renewed or ended is one short line above until it's dismissed. On Plans the row is the
 * place you're on. On Team (the canvas's team, teamLow and teamWait): the same calm row, Team over the team's name; for its
 * admin while licenses run short, how many are left and Buy, in warm; without a license, a line in caution over Free.
 * Each opens on Home, at a laptop's width, by day and by night (the panel itself is night in both).
 */
import type { Meta } from '@storybook/react-vite';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { purchaseAt } from '../../src/world/payments';
import { adminWithoutLicense, replacedPro } from './changes';

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
/** Less than asked arrived, and the address has closed: it's being settled into the balance, and its row opens it. */
export const Settling = page('/home', 'payments', { globals: LAPTOP, beforeEach: changing(purchaseAt('closed-short')) });
export const SettlingNight = night(Settling);
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

/* Team */
/** On a team with a license: the small sun, Team over the team's name. It opens Settings › Plan. */
export const Team = foot('/home', 'team-member');
export const TeamNight = night(Team);
/** The team's admin, with licenses enough: the same calm row. */
export const TeamAdmin = foot('/home', 'team-admin');
/** Two licenses left, told and not yet dismissed: the row says so, and Buy, in warm. It opens checkout on Team. */
export const TeamLicensesLow = foot('/home', 'team-admin-low');
export const TeamLicensesLowNight = night(TeamLicensesLow);
/** None left when Maya needed one. */
export const TeamNoLicensesLeft = foot('/home', 'team-admin-none');
export const TeamNoLicensesLeftNight = night(TeamNoLicensesLeft);
/** No license was left for Art: in caution, that Priya has been told, over the Free meter; the row goes to Team. */
export const TeamNoLicense = foot('/home', 'team-member-unlicensed');
export const TeamNoLicenseNight = night(TeamNoLicense);
/** The admin's own license ran out with none left: buying licenses gives them one. */
export const TeamAdminNoLicense = page('/home', 'team-admin', { globals: LAPTOP, beforeEach: changing(adminWithoutLicense) });
/** A team license replaced Pro: one short line above the row until it's dismissed in Settings. */
export const TeamReplacedPro = page('/home', 'team-member', { globals: LAPTOP, beforeEach: changing(replacedPro) });
export const TeamReplacedProNight = night(TeamReplacedPro);
/** On Plans, Team's row is the place you're on. */
export const OnPlansTeam = foot('/plans', 'team-member');
