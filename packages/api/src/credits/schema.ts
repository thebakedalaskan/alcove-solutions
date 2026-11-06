import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
/* ---------- credits ---------- */

export const CreditBalanceSchema = z.object({
  balance: z.number(),
  /** Every credit added to the account so far, so the app can show how much is left. */
  granted: z.number(),
  /** Credits charged since this month began (00:00 UTC on the 1st), from the account's credit history. */
  usedThisMonth: z.number(),
  /** Credits charged per minute of notes or room recording. Calls without notes are free. */
  perMinute: z.number()
});

export type CreditBalance = z.infer<typeof CreditBalanceSchema>;

/** A way to pay for credits: a stablecoin on one chain. */
export const TopUpRouteSchema = z.object({
  id: z.string(), chain: z.string(), chainName: z.string(), token: z.enum(['USDC', 'USDT']),
  /** The least that can be sent, in tokens, as a decimal string ("5"). */
  minimum: z.string(),
  /** The fewest credits a top-up on this route can add: what its minimum buys. */
  minimumCredits: z.number().int()
});
export type TopUpRoute = z.infer<typeof TopUpRouteSchema>;
/** From how many credits one top-up buys, how many credits each USD buys. */
export const CreditTierSchema = z.object({ fromCredits: z.number().int(), creditsPerUsd: z.number() });
export type CreditTier = z.infer<typeof CreditTierSchema>;
export const TopUpRoutesSchema = z.object({
  routes: z.array(TopUpRouteSchema), tiers: z.array(CreditTierSchema),
  /** Amounts of credits offered first. */
  presets: z.array(z.number().int()),
  /** Credits a minute of notes takes. */
  perMinute: z.number()
});
export type TopUpRoutes = z.infer<typeof TopUpRoutesSchema>;
/** The most credits one top-up can add. */
export const MAX_TOP_UP_CREDITS = 10_000_000;
export const StartTopUpBodySchema = z.object({ routeId: z.string().min(1).max(200), credits: z.number().int().min(1).max(MAX_TOP_UP_CREDITS) });
export const TopUpStateSchema = z.enum(['waiting', 'arriving', 'short', 'credited', 'held', 'failed', 'expired', 'cancelled']);
export type TopUpState = z.infer<typeof TopUpStateSchema>;
/** One payment for credits: what to send and where, and what has happened to it so far. */
export const TopUpSchema = z.object({
  id: IDSchema, route: TopUpRouteSchema,
  /** Only while a payment, or the rest of one, can still be sent (`waiting`, `short`); null once the top-up has moved on. */
  address: z.string().nullable(), memo: z.string().nullable(),
  expiresAt: ISODateSchema, state: TopUpStateSchema,
  /** What to send, in tokens as a decimal string, and the credits it adds. */
  asked: z.object({ amount: z.string(), credits: z.number().int() }),
  /**
   * Once a payment is seen: what was sent, in tokens as a decimal string, and the credits it added once it's settled
   * (0 if held, null until then).
   */
  received: z.object({ amount: z.string(), credits: z.number().int().nullable() }).nullable()
});
export type TopUp = z.infer<typeof TopUpSchema>;
