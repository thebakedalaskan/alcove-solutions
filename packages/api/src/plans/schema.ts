import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';

/* ---------- plans (docs: Plans and usage) ---------- */

/** The plans there are. They differ only in how much they bring: every plan has every feature. */
export const PlanKindSchema = z.enum(['free', 'pro', 'team']);
export type PlanKind = z.infer<typeof PlanKindSchema>;

/** An amount of US dollars, in millionths (micro-USD), as a whole number: $20 is 20000000. */
export const MicroUsdSchema = z.number().int();
/** The most one top-up can add: 8,000 USD. */
export const MAX_TOP_UP_MICRO_USD = 8_000_000_000;

/** One change to the balance: money added, or spent on a plan. */
export const BalanceEntrySchema = z.object({ id: z.string(), at: ISODateSchema, label: z.string(), microUsd: MicroUsdSchema });
export type BalanceEntry = z.infer<typeof BalanceEntrySchema>;

/** A month of Pro bought from the balance: `plan.period_seconds` long, back to back with the others bought. */
export const ProMonthSchema = z.object({ from: ISODateSchema, to: ISODateSchema, microUsd: MicroUsdSchema });
export type ProMonth = z.infer<typeof ProMonthSchema>;

/**
 * Something about the plan its owner is told, in the app and, if they've turned it on, from the browser
 * (`NotificationPrefs.plan`), until they dismiss it:
 * - `pro-ending`: Pro ends at `until`, a few days from now, and won't renew: renewing is off, the balance is short, or a month
 *   costs more now than when the last was bought, which renewing never pays without its owner buying at it first.
 * - `pro-renewed`: a month was bought from the balance, so Pro now runs to `until`.
 * - `pro-ended`: Pro ended at `until`; the account is on Free.
 * - `licenses-low` (a team's admin): `count` licenses are left unconsumed, fewer than the team's low mark.
 * - `licenses-none` (a team's admin): a member needed a license and none was left (nor bought, with auto-purchase).
 * - `license-needed` (a member): there was no license to take, so they're on their own plan until the admin buys more.
 * - `license-replaced-pro` (a member): a team license replaced Pro; `count` unstarted months went back to the balance.
 * - `workspace-payer` (an admin of `workspaceId`): whoever paid for that workspace isn't in it any more, so its payment
 *   moved to this account, its longest-standing admin with an account. Its files count against this account's storage
 *   from `until`, the end of its grace (null: at once). The workspace's name is never kept with the plan: the app says it
 *   from the workspaces its reader is in.
 */
export const PlanNoticeKindSchema = z.enum(['pro-ending', 'pro-renewed', 'pro-ended', 'licenses-low', 'licenses-none', 'license-needed', 'license-replaced-pro', 'workspace-payer']);
export type PlanNoticeKind = z.infer<typeof PlanNoticeKindSchema>;
export const PlanNoticeSchema = z.object({
  id: z.string(), kind: PlanNoticeKindSchema, at: ISODateSchema,
  /** Pro's end, for Pro's notices; when a workspace's files start to count, for `workspace-payer`; null for a team's. */
  until: ISODateSchema.nullable(),
  /** How many, for `licenses-low` and `license-replaced-pro`; null otherwise. */
  count: z.number().int().nonnegative().nullable(),
  /** The workspace, for `workspace-payer`; null otherwise. */
  workspaceId: IDSchema.nullable()
});
export type PlanNotice = z.infer<typeof PlanNoticeSchema>;

/**
 * An account's plan as its owner sees it. Notes are given as time: what's left of the period's AI allowance at the
 * rate an hour of notes is reckoned at, which is an estimate (what a call really uses depends on the model, how much is
 * said and what's shared). The allowance itself, in dollars, never leaves the server.
 */
export const PlanSchema = z.object({
  kind: PlanKindSchema,
  /** The period running now: the allowance renews at `to`, and doesn't carry over. */
  period: z.object({ from: ISODateSchema, to: ISODateSchema }),
  notes: z.object({
    /** About how many minutes of notes are left this period. */
    minutesLeft: z.number().int().nonnegative(),
    /** About how many minutes a period brings. */
    minutesPerPeriod: z.number().int().nonnegative(),
    /** Whether notes and every AI request have stopped until the period renews. */
    stopped: z.boolean()
  }),
  storage: z.object({
    /** What the account stores: uploads in workspaces it owns, and its calls' recordings. */
    usedBytes: z.number().int().nonnegative(),
    limitBytes: z.number().int().nonnegative(),
    /** The largest one file can be. */
    fileBytes: z.number().int().nonnegative()
  }),
  /** While the account is over its plan's storage: until when it still works as before. After it, nothing more is uploaded. */
  grace: z.object({ until: ISODateSchema, storage: z.boolean() }).nullable(),
  /** What's past the limits now that the grace has ended: uploads have stopped. */
  over: z.object({ storage: z.boolean() }),
  /** The USD balance plans are bought with, and its latest changes, newest first. */
  balance: z.object({ microUsd: MicroUsdSchema, history: z.array(BalanceEntrySchema) }),
  /** Whether the account hasn't been shown the plans to pick from yet. */
  choose: z.boolean(),
  pro: z.object({
    /** The month running now and those bought after it, oldest first. Empty when not on Pro. */
    months: z.array(ProMonthSchema),
    /** When the last month bought ends (null: no Pro bought that hasn't ended). */
    until: ISODateSchema.nullable(),
    /**
     * Whether renewing is on: a month is bought from the balance as Pro is about to end, while the balance has enough and a
     * month costs no more than when the last was bought.
     */
    renew: z.boolean(),
    /**
     * Whether renewing will buy the next month as Pro ends, as the server would decide now, and why not when it won't:
     * `buys`; `off`, renewing is off; `price`, a month costs more now than it did when the last was bought, which renewing
     * never pays without its owner buying at the new price first; `short`, the balance is short of a month. Null while no
     * month of Pro is left to renew.
     */
    renewal: z.enum(['buys', 'off', 'price', 'short']).nullable(),
    /** What refunding the months that haven't started would add back to the balance (0: none to refund). */
    refundableMicroUsd: MicroUsdSchema
  }),
  /** What the owner is told about their plan and hasn't dismissed, newest first. */
  notices: z.array(PlanNoticeSchema),
  /** The team you're on, if any. Whether you're licensed decides `kind`. */
  team: z.object({ id: IDSchema, name: z.string(), role: z.enum(['admin', 'member']), licensed: z.boolean() }).nullable()
});
export type Plan = z.infer<typeof PlanSchema>;

/** What a plan brings, from the limits: notes as minutes a period, storage and the largest file. */
export const PlanBringsSchema = z.object({
  notesMinutes: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
  fileBytes: z.number().int().nonnegative()
});
export type PlanBrings = z.infer<typeof PlanBringsSchema>;
/** The plans on offer and what each costs now. Buying sends the price seen here, so a change in between is refused. */
export const PlanOffersSchema = z.object({
  /** How long a period, and a month of Pro, is. */
  periodDays: z.number().nonnegative(),
  free: PlanBringsSchema,
  pro: PlanBringsSchema.extend({
    microUsdPerMonth: MicroUsdSchema,
    /** The most months one purchase can buy. */
    maxMonths: z.number().int().positive(),
    /** A lower price a month for buying at least `fromMonths` at once (a year or more), or null when there's none. */
    yearly: z.object({ fromMonths: z.number().int().positive(), microUsdPerMonth: MicroUsdSchema }).nullable()
  }),
  /** More notes for this period, bought from the balance in packs of `minutes` at `microUsd` each, or null when not offered. */
  hours: z.object({ minutes: z.number().int().positive(), microUsd: MicroUsdSchema, maxPacks: z.number().int().positive() }).nullable(),
  /** Team: what each licensed person gets (storage is pooled: this much for each live license). */
  team: PlanBringsSchema.extend({
    microUsdPerLicense: MicroUsdSchema,
    /** The most licenses one purchase can buy. */
    maxLicenses: z.number().int().positive()
  })
});
export type PlanOffers = z.infer<typeof PlanOffersSchema>;
/**
 * Buys `months` of Pro from the balance, at the price per month the buyer was shown for that many months: the yearly
 * price when `months` reaches the offer's `yearly.fromMonths`, else the monthly one.
 */
export const BuyProBodySchema = z.object({ months: z.number().int().min(1).max(1000), microUsdPerMonth: MicroUsdSchema.min(0) });
export type BuyProBody = z.infer<typeof BuyProBodySchema>;
/**
 * Buys `packs` of more notes for this period from the balance, as a pack was offered when the buyer was shown it: its price
 * (`microUsdPerPack`) and its size (`minutesPerPack`). A pack that has since cost more, or holds less, is refused.
 */
export const BuyHoursBodySchema = z.object({ packs: z.number().int().min(1).max(1000), microUsdPerPack: MicroUsdSchema.min(0), minutesPerPack: z.number().int().min(1) });
export type BuyHoursBody = z.infer<typeof BuyHoursBodySchema>;
/**
 * What a purchase buys, from the balance or once a payment is added, as it was offered when its buyer was shown it: months of
 * Pro at a month's price, packs of more notes at a pack's price and size, or licenses for its buyer's team at a license's price.
 */
export const PurchaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pro'), months: z.number().int().min(1).max(1000), microUsdPerMonth: MicroUsdSchema.min(0) }),
  z.object({ kind: z.literal('hours'), packs: z.number().int().min(1).max(1000), microUsdPerPack: MicroUsdSchema.min(0), minutesPerPack: z.number().int().min(1) }),
  /** Licenses for the team its buyer is the admin of, at the price they were shown for one (docs: Plans and usage › Team). */
  z.object({ kind: z.literal('licenses'), count: z.number().int().min(1).max(100_000), microUsdPerLicense: MicroUsdSchema.min(0) })
]);
export type Purchase = z.infer<typeof PurchaseSchema>;
export const RenewBodySchema = z.object({ renew: z.boolean() });
/**
 * What the Plans page opens checkout on as it opens (`/plans?checkout=pro`): Pro, more notes for this period, or Team. The
 * welcome page's Get Pro and Start a team land there once signed in.
 */
export const CheckoutParamSchema = z.enum(['pro', 'hours', 'team']);
export type CheckoutParam = z.infer<typeof CheckoutParamSchema>;

/* ---------- adding money ---------- */

/** A way to add money: a stablecoin on one chain. */
export const TopUpRouteSchema = z.object({
  id: z.string(), chain: z.string(), chainName: z.string(),
  /** Routes offered are all USDC; USDT is only on a top-up opened before USDC was the one way to pay. */
  token: z.enum(['USDC', 'USDT']),
  /** The least that can be sent, in tokens, as a decimal string ("5"). */
  minimum: z.string()
});
export type TopUpRoute = z.infer<typeof TopUpRouteSchema>;
export const TopUpRoutesSchema = z.object({
  routes: z.array(TopUpRouteSchema),
  /** Amounts offered first, in micro-USD: one, three and six periods of Pro. */
  presets: z.array(MicroUsdSchema)
});
export type TopUpRoutes = z.infer<typeof TopUpRoutesSchema>;
/** `buys`: what to buy with it once it's added, in the same transaction (null: it only adds to the balance). */
export const StartTopUpBodySchema = z.object({ routeId: z.string().min(1).max(200), microUsd: MicroUsdSchema.min(1).max(MAX_TOP_UP_MICRO_USD), buys: PurchaseSchema.nullable().default(null) });
export const TopUpStateSchema = z.enum(['waiting', 'arriving', 'short', 'credited', 'held', 'failed', 'expired', 'cancelled']);
export type TopUpState = z.infer<typeof TopUpStateSchema>;
/** One payment into the balance: what to send and where, and what has happened to it so far. */
export const TopUpSchema = z.object({
  id: IDSchema, route: TopUpRouteSchema,
  /** Only while a payment, or the rest of one, can still be sent (`waiting`, `short`); null once the top-up has moved on. */
  address: z.string().nullable(), memo: z.string().nullable(),
  expiresAt: ISODateSchema, state: TopUpStateSchema,
  /** What to send, in tokens as a decimal string. A token is added as one dollar. */
  asked: z.object({ amount: z.string() }),
  /**
   * Once a payment is seen: what was sent, in tokens as a decimal string, and what it added to the balance once it's
   * settled (0 if held, null until then).
   */
  received: z.object({ amount: z.string(), microUsd: MicroUsdSchema.nullable() }).nullable(),
  /**
   * What it was opened to buy, and how that went once it was added: `waiting` until then, `bought`, or `refused` (the
   * price changed, too little arrived, or the payment arrived after the top-up was cancelled, expired or failed, when only
   * the money is added) with why, in words for people. A refused purchase leaves the money in the balance. Null for a
   * top-up that only adds money.
   */
  purchase: z.object({ buys: PurchaseSchema, outcome: z.enum(['waiting', 'bought', 'refused']), why: z.string().nullable() }).nullable()
});
export type TopUp = z.infer<typeof TopUpSchema>;
