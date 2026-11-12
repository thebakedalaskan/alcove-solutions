import { z } from '../shared/zod';

/* ---------- the doors into checkout, as a browser keeps them ---------- */

/**
 * Where to go after signing in when Get Pro on the welcome page started it (sessionStorage, in that tab only): Plans, at its
 * address as it is ("/plans?checkout=pro", its `checkout` read by Plans itself), and until when it counts (ms), like any way
 * back through sign-in. Only a Plans address is taken.
 */
export const PlansReturnStoredSchema = z.object({ path: z.string().regex(/^\/plans(\?checkout=[a-z]+)?$/), until: z.number() });
export type PlansReturnStored = z.infer<typeof PlansReturnStoredSchema>;
