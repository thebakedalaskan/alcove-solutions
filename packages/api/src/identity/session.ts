import { ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { PersonSchema } from './people';
/** How someone signed in. Their account, calendar and company directory come from it. */
export const SignInProviderSchema = z.enum(['google', 'microsoft', 'sso']);

export type SignInProvider = z.infer<typeof SignInProviderSchema>;


/** A signed-in session. Absent (null) when signed out. */
export const SessionSchema = z.object({
  user: PersonSchema,
  ownerId: z.string(),
  provider: SignInProviderSchema,
  /** A demo account, with a sample calendar and company directory instead of connected ones. */
  sample: z.boolean(),
  /** The one demo account everyone who tries Alcove signs in to, which can't be deleted. */
  sharedDemo: z.boolean(),
  createdAt: ISODateSchema,
  /** The session ends at this time at the latest. */
  expiresAt: ISODateSchema
});

export type Session = z.infer<typeof SessionSchema>;


export const SignInResultSchema = z.object({
  session: SessionSchema,
  /** True the first time this person signs in: the app shows what came with them. */
  isNew: z.boolean()
});

export type SignInResult = z.infer<typeof SignInResultSchema>;


/**
 * That this browser has a signed-in session, so the app opens without a connection and Record works: the account's
 * opaque ID, when its session ends at the latest, and whether it records without a connection. Kept in this browser
 * (localStorage) while the session lasts; never a name or an address.
 */
export const SignedInHereSchema = z.object({
  ownerId: z.string().min(1).max(100),
  until: ISODateSchema,
  recordOffline: z.boolean()
});

export type SignedInHere = z.infer<typeof SignedInHereSchema>;


/**
 * What one tab tells the others in this browser (BroadcastChannel `alcove-account`): this account signed out here, or was
 * deleted, so nothing more is kept for it; or it signed in again.
 */
export const AccountSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('signed-out'), owner: z.string(), deleted: z.boolean() }),
  z.object({ type: z.literal('signed-in'), owner: z.string() })
]);

export type AccountSignal = z.infer<typeof AccountSignalSchema>;
