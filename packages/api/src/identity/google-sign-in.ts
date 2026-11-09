import { z } from '../shared/zod';

/** Correlates a popup with its waiting tab; never a session or an OAuth credential. */
export const GoogleSignInPopupIdSchema = z.uuid();
export const GoogleSignInRefusalSchema = z.enum(['cancelled', 'expired', 'unverified', 'unavailable', 'busy', 'failed', 'invite-only']);
export const GoogleSignInNextSchema = z.enum(['/ready', '/home', '/move']);
export const GoogleSignInResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('complete'), next: GoogleSignInNextSchema }),
  z.object({ type: z.literal('refused'), reason: GoogleSignInRefusalSchema })
]);
export type GoogleSignInResult = z.infer<typeof GoogleSignInResultSchema>;
export const GoogleSignInMessageSchema = z.union([GoogleSignInResultSchema, z.object({ type: z.literal('received') })]);
export const GoogleSignInSearchSchema = z.object({
  popup: GoogleSignInPopupIdSchema.optional().catch(undefined),
  next: GoogleSignInNextSchema.optional().catch(undefined),
  signin: GoogleSignInRefusalSchema.optional().catch(undefined)
});
