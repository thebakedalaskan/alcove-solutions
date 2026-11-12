import { z } from '../shared/zod';
import { CheckoutParamSchema } from './schema';

/* ---------- the doors into checkout, as a browser keeps them ---------- */

/**
 * Where to go after signing in when Get Pro on the welcome page started it (sessionStorage, in that tab only): Plans, with
 * checkout open on what `checkout` says, and until when it counts (ms), like any way back through sign-in.
 */
export const PlansReturnStoredSchema = z.object({ checkout: CheckoutParamSchema, until: z.number() });
export type PlansReturnStored = z.infer<typeof PlansReturnStoredSchema>;
