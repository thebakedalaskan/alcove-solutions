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
