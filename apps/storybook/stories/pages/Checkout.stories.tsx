/*
 * Checkout in every stage (docs/design/pages.md › Checkout; the canvas's
 * Checkout board, docs/design/canvas/plans/Checkout.dc.html), the app's own window over the app, opened as a door opens
 * it (src/checkout.tsx). A payment on its way is the world's (`plan-waiting`), or one a story opens and the stand-in plays
 * out by itself (`payments` and the `payment-*` scenarios: seen, added and bought a few seconds apart, or less, more,
 * refused, expired, failed). Each stage comes in the toolbar's theme, and on a phone (the `Phone` stories).
 */
import type { Purchase } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { playsOut } from '../../src/api/payments';
import { current } from '../../src/api/state';
import { setOnline } from '../../src/browser';
import { checkout, checkouts, type CheckoutArgs, type CheckoutStory } from '../../src/checkout';
import { changing } from '../../src/page';
import { addToBalance, PREVIEW_TOP_UP, PRO_YEAR, purchaseAt, raisePrices, TEAM_SIX, TEAM_SIX_YEAR, withPayments, type PaymentPlay, type PurchaseAt } from '../../src/world/payments';
import { ART } from '../../src/world/people';
import { planWithTeam, priyasTeam } from '../../src/world/teams';
import { LATER, pressable, SOON } from '../journeys/play';

const meta = { title: 'Pages/Checkout', ...checkouts } satisfies Meta<CheckoutArgs>;
export default meta;

const PHONE = { viewport: { value: 'phone', isRotated: false } };
const DARK = { theme: 'dark' };
/** The checkout window, once it's open. */
const win = () => screen.findByRole('dialog', {}, SOON);
/** Picks `name` among the networks. */
const network = async (name: string) => within(await screen.findByRole('radiogroup', { name: 'Pay with USDC on' }, LATER)).getByRole('radio', { name: new RegExp(`^${name}`) });

/* ---------- choosing ---------- */

/** Get Pro on Free with nothing in the balance: 12 months, the 20% off bracket, the networks, none chosen. */
export const Choose = checkout('/home', 'payments', { plan: 'pro' });
export const ChoosePhone: CheckoutStory = { ...Choose, globals: PHONE };
export const ChooseNight: CheckoutStory = { ...Choose, globals: DARK };
/** Opened on a month, as Plans' Monthly opens it. */
export const OneMonth = checkout('/home', 'payments', { plan: 'pro', months: 1, from: 'plans' });
/** Base chosen: Get the address can be pressed. */
export const NetworkChosen = checkout('/home', 'payments', { plan: 'pro' }, {
  play: async ({ userEvent }) => { await userEvent.click(await network('Base')); }
});
export const NetworkChosenNight: CheckoutStory = { ...NetworkChosen, globals: DARK };
/** Another length: a stepper from 1 to 12, at 8 months. */
export const AnotherLength = checkout('/home', 'payments', { plan: 'pro', months: 8 });
/**
 * A month with $5 in the balance is 15 USDC short, and Ethereum takes at least 20: what's asked rises to it, and the summary
 * says the rest stays in the balance.
 */
export const RaisedToTheLeast = checkout('/home', 'payments', { plan: 'pro', months: 1 }, {
  beforeEach: changing((w) => addToBalance(w, 5_000_000, '5')),
  play: async ({ userEvent }) => { await userEvent.click(await network('Ethereum')); }
});
/** $5 in the balance: it comes off what's sent. */
export const SomeBalance = checkout('/home', 'payments', { plan: 'pro' }, {
  beforeEach: changing((w) => addToBalance(w, 5_000_000, '5')),
  play: async ({ userEvent }) => { await userEvent.click(await network('Base')); }
});
/** The balance covers 3 months: no network, and Buy with your balance. */
export const BalanceCovers = checkout('/home', 'plan-balance', { plan: 'pro', months: 3 });
export const BalanceCoversNight: CheckoutStory = { ...BalanceCovers, globals: DARK };
/** A server that takes no payments: a balance that doesn't cover it can't buy, and says so. */
export const PaymentsOff = checkout('/home', 'busy', { plan: 'pro' });
/** The price went up after checkout read it: Get the address is refused, the offers are read again, and it says so. */
export const PriceChanged = checkout('/home', 'payments', { plan: 'pro' }, {
  play: async ({ userEvent }) => {
    await userEvent.click(await network('Base'));
    raisePrices(current());
    await userEvent.click(await pressable('button', 'Get the address', SOON, within(await win())));
  }
});
/** Offline, signed in on this browser, over Record (which works without a connection): the button waits, and the foot says why. */
export const Offline = checkout('/record', 'payments', { plan: 'pro' }, {
  parameters: { opening: { signedInHere: true } },
  play: async ({ userEvent }) => {
    await userEvent.click(await network('Base'));
    await within(await win()).findByText('For Art Vandelay', {}, LATER);
    setOnline(false);
  }
});
/** Offline on a phone: the window fills the screen, the button waits, and why is said over it. */
export const OfflinePhone: CheckoutStory = { ...Offline, globals: PHONE };
/** Extending Pro, which ends in 3 days: counted from its end, with the days left said. */
export const Extend = checkout('/settings#plan', 'plan-pro-ending', { plan: 'pro', from: 'settings' });
/** More notes for this period, with notes stopped: 10, 20 or 50 hours. */
export const MoreNotes = checkout('/home', 'plan-stopped', { plan: 'hours', from: 'side' }, { beforeEach: changing((w) => withPayments(w)) });
export const MoreNotesPhone: CheckoutStory = { ...MoreNotes, globals: PHONE };

/* ---------- paying ---------- */

/** A payment on its way for 12 months of Pro, reopened from the side panel: the amount, the QR code and the address. */
export const Waiting = checkout('/home', 'plan-waiting', { plan: 'pro', topUpId: PREVIEW_TOP_UP });
export const WaitingNight: CheckoutStory = { ...Waiting, globals: DARK };
export const WaitingPhone: CheckoutStory = { ...Waiting, globals: PHONE };
export const WaitingPhoneNight: CheckoutStory = { ...Waiting, globals: { ...PHONE, ...DARK } };
/** Cancel payment asks first, in the foot. */
export const CancelAsks = checkout('/home', 'plan-waiting', { plan: 'pro', topUpId: PREVIEW_TOP_UP }, {
  play: async ({ userEvent }) => { await userEvent.click(await pressable('button', 'Cancel payment', SOON, within(await win()))); }
});

/** Checkout reopened on a payment for a year of Pro (192 USDC on Base) where it is now: `where`. It stays there. */
const at = (where: PurchaseAt, more: Partial<CheckoutStory> = {}): CheckoutStory =>
  checkout('/home', 'payments', { plan: 'pro', topUpId: PREVIEW_TOP_UP }, { beforeEach: changing(purchaseAt(where)), ...more });
/**
 * Checkout reopened on a payment that has just been seen, which is added and bought a few seconds later (or goes as `play`
 * says), as the window would see it: in `scenario`, for `buys` and `asked`.
 */
const lands = (scenario: CheckoutArgs['scenario'], open: Partial<CheckoutArgs>, play: PaymentPlay = 'pays', buys?: Purchase, asked?: number, more: Partial<CheckoutStory> = {}): CheckoutStory =>
  checkout(open.path ?? '/home', scenario, { plan: buys?.kind === 'licenses' ? 'team' : buys?.kind ?? 'pro', topUpId: PREVIEW_TOP_UP, ...open }, {
    beforeEach: changing(purchaseAt('waiting', buys, asked), playsOut(PREVIEW_TOP_UP, play)), ...more
  });

/**
 * 128 of 192 USDC arrived: send the rest to the same address, or keep it in the balance. A payment something has reached
 * can't be cancelled (the server cancels only one nothing has reached), so the foot has Close alone.
 */
export const LessArrived = at('short');
export const LessArrivedNight: CheckoutStory = { ...LessArrived, globals: DARK };
/**
 * 128 of 192 USDC arrived and the address has closed since: nothing more can be sent to it, what arrived settles into the
 * balance, and a new address for Pro is a press away.
 */
export const LessArrivedClosed = at('closed-short');
export const LessArrivedClosedPhone: CheckoutStory = { ...LessArrivedClosed, globals: PHONE };
/** The payment is seen and Pro is starting: the track's glint runs, and the window can be closed. */
export const Seen = at('seen');
export const SeenNight: CheckoutStory = { ...Seen, globals: DARK };
export const SeenPhone: CheckoutStory = { ...Seen, globals: PHONE };
/** Seen, then bought a few seconds later: You're on Pro, with the receipt's row and the reminder that nothing renews by itself. */
export const Done = lands('payments', {});
export const DoneNight: CheckoutStory = { ...Done, globals: DARK };
export const DonePhone: CheckoutStory = { ...Done, globals: PHONE };
/** 198 USDC arrived for 192: Done says the 6 more is in the balance. */
export const MoreArrived = lands('payments', {}, 'over');
/** The prices went up before the payment arrived: it's in the balance, and checkout says why and chooses again at today's. */
export const Refused = at('refused');
/** Nothing arrived in 24 hours: nothing was charged, and a new address is a press away. */
export const Expired = at('expired');
export const ExpiredNight: CheckoutStory = { ...Expired, globals: DARK };
/** Cancelled elsewhere while the window was open. */
export const Cancelled = at('cancelled');
/** 1Click failed it: the reference for support. */
export const Failed = at('failed');
/** Done's Receipt: the receipt alone in a small window, to print. */
export const Receipt = lands('payments', {}, 'pays', undefined, undefined, {
  play: async ({ userEvent }) => { await userEvent.click(await pressable('button', 'Receipt', LATER, within(await win()))); }
});
export const ReceiptNight: CheckoutStory = { ...Receipt, globals: DARK };
/** Bought over a call: Back to the call. */
export const DoneFromACall = lands('plan-stopped', { from: 'call' });
/** Pro extended from its last days, with $5 in the balance: Pro runs to the new end. */
export const ExtendDone = lands('plan-pro-ending', { path: '/settings#plan', from: 'settings' }, 'pays', PRO_YEAR, 187);
/** Ten more hours of notes for this period, bought with 15 USDC while notes had stopped. */
export const MoreNotesDone = lands('plan-stopped', {}, 'pays', { kind: 'hours', packs: 1, microUsdPerPack: 15_000_000, minutesPerPack: 600 }, 15);
/** Three months bought from the balance at once: no Pay step. */
export const BoughtWithTheBalance = checkout('/home', 'plan-balance', { plan: 'pro', months: 3 }, {
  play: async ({ userEvent }) => { await userEvent.click(await pressable('button', 'Buy with your balance', LATER, within(await win()))); }
});

/* ---------- Team: starting one ---------- */

/** Presses the window's one filled button, once it can be pressed. */
const press = (name: string): NonNullable<CheckoutStory['play']> => async ({ userEvent }) => {
  await userEvent.click(await pressable('button', name, LATER, within(await win())));
};

/**
 * Start a team, from Team's card on Plans, on nothing in the balance: its name is the company's, six licenses for the six
 * people at Vandelay on Alcove, the networks, none chosen. The team is made only as Art pays, with Art its admin.
 */
export const StartATeam = checkout('/plans', 'payments', { plan: 'team', from: 'plans' });
export const StartATeamNight: CheckoutStory = { ...StartATeam, globals: DARK };
export const StartATeamPhone: CheckoutStory = { ...StartATeam, globals: PHONE };
export const StartATeamPhoneNight: CheckoutStory = { ...StartATeam, globals: { ...PHONE, ...DARK } };
/** Base chosen: Get the address makes the team and opens the payment for its licenses. */
export const StartATeamNetworkChosen = checkout('/plans', 'payments', { plan: 'team', from: 'plans' }, {
  play: async ({ userEvent }) => { await userEvent.click(await network('Base')); }
});
export const StartATeamNetworkChosenNight: CheckoutStory = { ...StartATeamNetworkChosen, globals: DARK };
/** Another number: a stepper from 1 to 500 licenses, at 7. */
export const StartATeamAnotherNumber = checkout('/plans', 'payments', { plan: 'team', from: 'plans', licenses: 7 });
/** Opened from the Team page, away from Plans: Compare plans in the foot. */
export const StartATeamFromTheTeamPage = checkout('/team', 'payments', { plan: 'team', from: 'team' });
/** With $300 in the balance: six licenses come from it, with no network to choose, and Buy with your balance. */
export const StartATeamWithYourBalance = checkout('/plans', 'payments', { plan: 'team', from: 'plans' }, {
  beforeEach: changing((w) => addToBalance(w, 300_000_000, '300'))
});
export const StartATeamWithYourBalanceNight: CheckoutStory = { ...StartATeamWithYourBalance, globals: DARK };
/**
 * Bought from the balance: Vandelay Industries is on Team. Buying them is a visit, so Art's own license is taken now, and each
 * of the others when the person it's for next opens Alcove.
 */
export const StartedWithYourBalance: CheckoutStory = { ...StartATeamWithYourBalance, play: press('Buy with your balance') };
export const StartedWithYourBalanceNight: CheckoutStory = { ...StartedWithYourBalance, globals: DARK };
/** The name is gone: nothing can be paid until the team has one. */
export const StartATeamUnnamed = checkout('/plans', 'payments', { plan: 'team', from: 'plans' }, {
  play: async ({ userEvent }) => {
    await userEvent.clear(await within(await win()).findByRole('textbox', { name: 'Its name' }, LATER));
    await userEvent.click(await network('Base'));
  }
});
/** A server that takes no payments: six licenses aren't covered by the balance, so nothing can be bought, and it says so. */
export const StartATeamPaymentsOff = checkout('/plans', 'busy', { plan: 'team', from: 'plans' });
/**
 * The price of a license went up after checkout read it: the team is made, the payment is refused, the offers are read again
 * and it says so. Pressing again pays for the team that's made.
 */
export const StartATeamPriceChanged = checkout('/plans', 'payments', { plan: 'team', from: 'plans' }, {
  play: async ({ userEvent }) => {
    await userEvent.click(await network('Base'));
    raisePrices(current());
    await userEvent.click(await pressable('button', 'Get the address', SOON, within(await win())));
  }
});
/** Offline, over Record: the button waits, and the foot says why. */
export const StartATeamOffline = checkout('/record', 'payments', { plan: 'team', from: 'side' }, {
  parameters: { opening: { signedInHere: true } },
  play: async ({ userEvent }) => {
    await userEvent.click(await network('Base'));
    await within(await win()).findByText('For Vandelay Industries, with you its admin', {}, LATER);
    setOnline(false);
  }
});

export const StartATeamOfflinePhone: CheckoutStory = { ...StartATeamOffline, globals: PHONE };

/* ---------- Team: licenses for a year ---------- */

/**
 * Start a team from Plans on Yearly: checkout opens on licenses for a year, Monthly / Yearly · 20% off over how many. Six for a
 * year are $384 each, $2,304 in all: "6 licenses for a year at $32 a month", each running a year from when it's taken.
 */
export const StartATeamForAYear = checkout('/plans', 'payments', { plan: 'team', from: 'plans', yearly: true });
export const StartATeamForAYearNight: CheckoutStory = { ...StartATeamForAYear, globals: DARK };
export const StartATeamForAYearPhone: CheckoutStory = { ...StartATeamForAYear, globals: PHONE };
export const StartATeamForAYearPhoneNight: CheckoutStory = { ...StartATeamForAYear, globals: { ...PHONE, ...DARK } };
/** Monthly, pressed: back to $40 each, one person for 30 days. */
export const StartATeamForAMonth = checkout('/plans', 'payments', { plan: 'team', from: 'plans', yearly: true }, {
  play: async ({ userEvent }) => {
    await userEvent.click(await within(await screen.findByRole('group', { name: 'How long' }, LATER)).findByRole('button', { name: 'Monthly' }, LATER));
  }
});
/** Base chosen: the summary says exactly what to send for six licenses for a year. */
export const StartATeamForAYearNetworkChosen = checkout('/plans', 'payments', { plan: 'team', from: 'plans', yearly: true }, {
  play: async ({ userEvent }) => { await userEvent.click(await network('Base')); }
});
export const StartATeamForAYearNetworkChosenNight: CheckoutStory = { ...StartATeamForAYearNetworkChosen, globals: DARK };

/** Checkout reopened on the payment for a new team's six licenses for a year (2,304 USDC on Base) where it is now: `where`. */
const teamYear = (where: PurchaseAt, more: Partial<CheckoutStory> = {}): CheckoutStory =>
  checkout('/plans', 'team-buying', { plan: 'team', licenses: 6, yearly: true, topUpId: PREVIEW_TOP_UP }, { beforeEach: changing(purchaseAt(where, TEAM_SIX_YEAR, 2304)), ...more });
/** The payment for six licenses for a year, waiting: the amount, the QR code and the address. */
export const TeamForAYearWaiting = teamYear('waiting');
export const TeamForAYearWaitingNight: CheckoutStory = { ...TeamForAYearWaiting, globals: DARK };
export const TeamForAYearWaitingPhone: CheckoutStory = { ...TeamForAYearWaiting, globals: PHONE };
/**
 * Seen, then bought a few seconds later: Vandelay Industries is on Team with six licenses for a year, Art's taken now and each
 * running a year from when it's taken.
 */
export const TeamForAYearDone = lands('team-buying', { path: '/plans', from: 'plans', licenses: 6, yearly: true }, 'pays', TEAM_SIX_YEAR, 2304);
export const TeamForAYearDoneNight: CheckoutStory = { ...TeamForAYearDone, globals: DARK };
export const TeamForAYearDonePhone: CheckoutStory = { ...TeamForAYearDone, globals: PHONE };
/** Done's Receipt: Team, 6 licenses for a year, $2,304.00. */
export const TeamForAYearReceipt = lands('team-buying', { path: '/plans', from: 'plans', licenses: 6, yearly: true }, 'pays', TEAM_SIX_YEAR, 2304, {
  play: async ({ userEvent }) => { await userEvent.click(await pressable('button', 'Receipt', LATER, within(await win()))); }
});
/** With $2,500 in the balance: six for a year come from it, with no network to choose, and Buy with your balance. */
export const StartATeamForAYearWithYourBalance = checkout('/plans', 'payments', { plan: 'team', from: 'plans', yearly: true }, {
  beforeEach: changing((w) => addToBalance(w, 2_500_000_000, '2500'))
});
export const StartATeamForAYearWithYourBalanceNight: CheckoutStory = { ...StartATeamForAYearWithYourBalance, globals: DARK };
/** Bought from the balance: Vandelay Industries is on Team, six licenses for a year, Art's taken now. */
export const StartedForAYearWithYourBalance: CheckoutStory = { ...StartATeamForAYearWithYourBalance, play: press('Buy with your balance') };
export const StartedForAYearWithYourBalanceNight: CheckoutStory = { ...StartedForAYearWithYourBalance, globals: DARK };
export const StartedForAYearWithYourBalancePhone: CheckoutStory = { ...StartedForAYearWithYourBalance, globals: PHONE };
/** Its admin buying three more for a year from a balance of $1,180: 3 more licenses for a year, and Maya gets one. */
export const BoughtLicensesForAYear = checkout('/plans', 'team-admin-none', { plan: 'team', from: 'plans', licenses: 3, yearly: true }, {
  beforeEach: changing((w) => addToBalance(w, 1_000_000_000, '1000')),
  play: press('Buy with your balance')
});
export const BoughtLicensesForAYearNight: CheckoutStory = { ...BoughtLicensesForAYear, globals: DARK };

/* ---------- Team: paying for its licenses ---------- */

/** Checkout reopened on the payment for a new team's six licenses (240 USDC on Base) where it is now: `where`. */
const team = (where: PurchaseAt, more: Partial<CheckoutStory> = {}): CheckoutStory =>
  checkout('/plans', 'team-buying', { plan: 'team', licenses: 6, topUpId: PREVIEW_TOP_UP }, { beforeEach: changing(purchaseAt(where, TEAM_SIX, 240)), ...more });

/** The payment for the team's first licenses, reopened from the side panel: the amount, the QR code and the address. */
export const TeamWaiting = checkout('/plans', 'team-buying', { plan: 'team', licenses: 6, topUpId: PREVIEW_TOP_UP });
export const TeamWaitingNight: CheckoutStory = { ...TeamWaiting, globals: DARK };
export const TeamWaitingPhone: CheckoutStory = { ...TeamWaiting, globals: PHONE };
/** Seen: the licenses are being added. */
export const TeamSeen = team('seen');
export const TeamSeenNight: CheckoutStory = { ...TeamSeen, globals: DARK };
/**
 * Seen, then bought a few seconds later: Vandelay Industries is on Team, with the receipt's row. Art's license is taken as
 * the window says so (the visit after a purchase of licenses).
 */
export const TeamDone = lands('team-buying', { path: '/plans', from: 'plans', licenses: 6 }, 'pays', TEAM_SIX, 240);
export const TeamDoneNight: CheckoutStory = { ...TeamDone, globals: DARK };
export const TeamDonePhone: CheckoutStory = { ...TeamDone, globals: PHONE };
export const TeamDonePhoneNight: CheckoutStory = { ...TeamDone, globals: { ...PHONE, ...DARK } };
/** The price of a license went up before the payment arrived: it's in the balance, and checkout chooses again at today's. */
export const TeamRefused = team('refused');
/** Nothing arrived in 24 hours: nothing was charged, and a new address is a press away. */
export const TeamExpired = team('expired');

/* ---------- Team: its admin buying more ---------- */

/**
 * Buy licenses, as Vandelay's admin: all five taken and Maya waiting for one, each card saying what's spare after Maya's. Six
 * are more than the $180 in the balance: the networks.
 */
export const BuyLicenses = checkout('/plans', 'team-admin-none', { plan: 'team', from: 'plans', licenses: 6 });
export const BuyLicensesNight: CheckoutStory = { ...BuyLicenses, globals: DARK };
export const BuyLicensesPhone: CheckoutStory = { ...BuyLicenses, globals: PHONE };
/** Three: the balance covers them, and Buy with your balance. */
export const BuyLicensesWithYourBalance = checkout('/plans', 'team-admin-none', { plan: 'team', from: 'plans', licenses: 3 });
export const BuyLicensesWithYourBalanceNight: CheckoutStory = { ...BuyLicensesWithYourBalance, globals: DARK };
/** Bought from the balance: 3 more licenses, how many are left now, and Maya gets one the next time they open Alcove. */
export const BoughtLicenses: CheckoutStory = { ...BuyLicensesWithYourBalance, play: press('Buy with your balance') };
export const BoughtLicensesNight: CheckoutStory = { ...BoughtLicenses, globals: DARK };
export const BoughtLicensesPhone: CheckoutStory = { ...BoughtLicenses, globals: PHONE };
/** Two left and nobody waiting: each card says how many there's room for then. */
export const BuyLicensesNobodyWaiting = checkout('/settings#plan', 'team-admin-low', { plan: 'team', from: 'settings' });
/** Six more with a payment for what the balance is short of (60 USDC): seen, then bought. */
export const BoughtLicensesWithAPayment = lands('team-admin-none', { path: '/plans', from: 'plans', licenses: 6 }, 'pays', TEAM_SIX, 60);
/** On Priya's team: Priya buys its licenses, so there's nothing to buy here: no steps, and one note says who buys them. */
export const OnSomeoneElsesTeam = checkout('/plans', 'team-member', { plan: 'team', from: 'plans' });
export const OnSomeoneElsesTeamNight: CheckoutStory = { ...OnSomeoneElsesTeam, globals: DARK };
export const OnSomeoneElsesTeamPhone: CheckoutStory = { ...OnSomeoneElsesTeam, globals: PHONE };
/**
 * Art stopped being the admin after checkout opened: buying is refused, the steps go, and the window says once who buys them
 * now.
 */
export const NotTheAdminAnyMore = checkout('/plans', 'team-admin', { plan: 'team', from: 'plans', licenses: 3 }, {
  play: async ({ userEvent }) => {
    await within(await win()).findByRole('radiogroup', { name: 'How many licenses' }, LATER);
    // Vandelay's admin is Priya now (as the server would have it), and Art is on it as a member.
    const w = current();
    w.myTeam = priyasTeam();
    w.plan = planWithTeam(w.plan, w.myTeam, ART.email);
    await userEvent.click(await pressable('button', 'Buy with your balance', LATER, within(await win())));
  }
});
/**
 * Art stopped being the admin while a payment for six licenses was on its way: it arrives and buys nothing, and one note says
 * the money is in the balance and who buys them now, with no steps.
 */
export const NotTheAdminWhenItArrived = lands('team-admin-none', { path: '/plans', from: 'plans', licenses: 6 }, 'pays', TEAM_SIX, 60, {
  beforeEach: changing(purchaseAt('waiting', TEAM_SIX, 60), playsOut(PREVIEW_TOP_UP, 'pays'), (w) => {
    // Vandelay's admin is Priya now (as the server would have it), and Art is on it as a member.
    w.myTeam = priyasTeam();
    w.plan = planWithTeam(w.plan, w.myTeam, ART.email);
  })
});
