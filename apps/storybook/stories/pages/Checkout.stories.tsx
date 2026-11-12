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
import { addToBalance, PREVIEW_TOP_UP, PRO_YEAR, purchaseAt, raisePrices, withPayments, type PaymentPlay, type PurchaseAt } from '../../src/world/payments';
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

/** 128 of 192 USDC arrived: send the rest to the same address, or keep it in the balance. */
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
