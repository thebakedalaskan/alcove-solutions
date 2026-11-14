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

/**
 * The token after `/stop-email#` that every invitation email carries, which stops Alcove's emails to the address it was sent
 * to: 32 bytes as base64url, 43 characters, naming nobody (`POST /v1/mail/stop`). A mail app's one-click unsubscribe sends
 * it in the URL instead (RFC 8058).
 */
export const MailStopBodySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export type MailStopBody = z.infer<typeof MailStopBodySchema>;

