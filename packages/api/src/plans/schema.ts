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
 * - `pro-ending`: Pro ends at `until`, a few days from now, and won't renew (renewing is off, or the balance is short).
 * - `pro-renewed`: a month was bought from the balance, so Pro now runs to `until`.
 * - `pro-ended`: Pro ended at `until`; the account is on Free.
 * - `licenses-low` (a team's admin): `count` licenses are left unconsumed, fewer than the team's low mark.
 * - `licenses-none` (a team's admin): a member needed a license and none was left (nor bought, with auto-purchase).
 * - `license-needed` (a member): there was no license to take, so they're on their own plan until the admin buys more.
 * - `license-replaced-pro` (a member): a team license replaced Pro; `count` unstarted months went back to the balance.
 */
export const PlanNoticeKindSchema = z.enum(['pro-ending', 'pro-renewed', 'pro-ended', 'licenses-low', 'licenses-none', 'license-needed', 'license-replaced-pro']);
export type PlanNoticeKind = z.infer<typeof PlanNoticeKindSchema>;
export const PlanNoticeSchema = z.object({
  id: z.string(), kind: PlanNoticeKindSchema, at: ISODateSchema,
  /** Pro's end, for Pro's notices; null for a team's. */
  until: ISODateSchema.nullable(),
  /** How many, for `licenses-low` and `license-replaced-pro`; null otherwise. */
  count: z.number().int().nonnegative().nullable()
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
    /** Whether a month is bought from the balance as Pro is about to end, while the balance has enough. */
    renew: z.boolean(),
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
export const PlanAllowanceSchema = z.object({
  notesMinutes: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
  fileBytes: z.number().int().nonnegative()
});
export type PlanAllowance = z.infer<typeof PlanAllowanceSchema>;
/** The plans on offer and what each costs now. Buying sends the price seen here, so a change in between is refused. */
export const PlanOffersSchema = z.object({
  /** How long a period, and a month of Pro, is. */
  periodDays: z.number().nonnegative(),
  free: PlanAllowanceSchema,
  pro: PlanAllowanceSchema.extend({
    microUsdPerMonth: MicroUsdSchema,
    /** The most months one purchase can buy. */
    maxMonths: z.number().int().positive()
  }),
  /** Team: what each licensed person gets (storage is pooled: this much for each live license). */
  team: PlanAllowanceSchema.extend({
    microUsdPerLicense: MicroUsdSchema,
    /** The most licenses one purchase can buy. */
    maxLicenses: z.number().int().positive()
  })
});
export type PlanOffers = z.infer<typeof PlanOffersSchema>;
/** Buys `months` of Pro from the balance, at the price per month the buyer was shown. */
export const BuyProBodySchema = z.object({ months: z.number().int().min(1).max(1000), microUsdPerMonth: MicroUsdSchema.min(0) });
export type BuyProBody = z.infer<typeof BuyProBodySchema>;
export const RenewBodySchema = z.object({ renew: z.boolean() });

/* ---------- adding money ---------- */

/** A way to add money: a stablecoin on one chain. */
export const TopUpRouteSchema = z.object({
  id: z.string(), chain: z.string(), chainName: z.string(), token: z.enum(['USDC', 'USDT']),
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
export const StartTopUpBodySchema = z.object({ routeId: z.string().min(1).max(200), microUsd: MicroUsdSchema.min(1).max(MAX_TOP_UP_MICRO_USD) });
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
  received: z.object({ amount: z.string(), microUsd: MicroUsdSchema.nullable() }).nullable()
});
export type TopUp = z.infer<typeof TopUpSchema>;
