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
  choose: z.boolean()
});
export type Plan = z.infer<typeof PlanSchema>;

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
