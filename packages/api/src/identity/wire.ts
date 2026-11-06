import { z } from '../shared/zod';
/**
 * Providers that still sign in a demo identity until they're connected: Microsoft is always Art
 * Vandelay, and single sign-on is whoever's work email is typed. Google is real: the browser goes
 * to `AlcoveApi.auth.signInUrl('google')` instead.
 */
export const DemoProviderSchema = z.enum(['microsoft', 'sso']);

export type DemoProvider = z.infer<typeof DemoProviderSchema>;


export const SignInBodySchema = z.object({
  provider: DemoProviderSchema,
  /** The work email typed for single sign-on. */
  email: z.string().trim().max(254).optional()
});

export type SignInBody = z.infer<typeof SignInBodySchema>;


/** Search terms travel in a POST body so they never appear in URLs or access logs. */
export const PeopleSearchBodySchema = z.object({ query: z.string().max(200) });

export const TeamInviteBodySchema = z.object({ emails: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(50) });
