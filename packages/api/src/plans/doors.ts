import { z } from '../shared/zod';

/* ---------- the doors into checkout, as a browser keeps them ---------- */

/**
 * Get Pro pressed on the welcome page, before signing in (sessionStorage, in that tab only): after signing in, Plans opens
 * with checkout on it. Until when it counts (ms), like any way back through sign-in.
 */
export const PlansReturnStoredSchema = z.object({ checkout: z.enum(['pro']), until: z.number() });
export type PlansReturnStored = z.infer<typeof PlansReturnStoredSchema>;
