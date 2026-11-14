import { AgentAuthorizationIdSchema } from '../agents/schema';
import { CallCodeSchema } from '../calls/entry';
import { NoteLinkSecretSchema } from '../notes/links';
import { CheckoutParamSchema } from '../plans/schema';
import { TeamSecretBodySchema } from '../teams/schema';
import { z } from '../shared/zod';
import { InviteSecretSchema } from './invite-links';

/** Correlates a popup with its waiting tab; never a session or an OAuth credential. */
export const GoogleSignInPopupIdSchema = z.uuid();
export const GoogleSignInRefusalSchema = z.enum(['cancelled', 'expired', 'unverified', 'unavailable', 'busy', 'failed', 'invite-only', 'google-email-required']);
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

/**
 * Where a tab goes once it's signed in, when signing in started on a page with somewhere to come back to. Google's way back
 * lands on /ready or /home, so it waits in that tab's sessionStorage (the app's features/account/afterSignIn.ts), never in a URL: a
 * call's code and a link's or an invite's secret are secrets. One at a time, so a sign-in started somewhere else since takes
 * its place. A call's join page (`call`), an agent's request to be let in (`agent`, a pointer with no credential), a link to
 * someone's notes, an invite to a team or someone's invite link, whose own pages take the secret (`link`, `team`, `invite`),
 * or Plans with checkout open on what the welcome page's Get Pro or Start a team chose (`plans`). An invite link's page
 * tells its sender only when the account was just made, which Google's way back says by landing on /ready: `arriving`,
 * set when it did.
 */
export const AfterSignInSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('call'), code: CallCodeSchema }),
  z.object({ to: z.literal('agent'), requestId: AgentAuthorizationIdSchema }),
  z.object({ to: z.literal('link'), secret: NoteLinkSecretSchema }),
  z.object({ to: z.literal('team'), secret: TeamSecretBodySchema.shape.secret }),
  z.object({ to: z.literal('invite'), secret: InviteSecretSchema, arriving: z.boolean().optional() }),
  z.object({ to: z.literal('plans'), checkout: CheckoutParamSchema })
]);
export type AfterSignIn = z.infer<typeof AfterSignInSchema>;
/** The same as the tab keeps it: with until when it counts (ms), ten minutes, like the sign-in attempt itself. */
export const AfterSignInStoredSchema = z.object({ back: AfterSignInSchema, until: z.number() });
export type AfterSignInStored = z.infer<typeof AfterSignInStoredSchema>;
