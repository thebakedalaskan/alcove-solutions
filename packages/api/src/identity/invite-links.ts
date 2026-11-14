import { ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { PersonSchema } from './people';

/* ---------- your own invite link (docs: Privacy, keys and sessions › Invite links) ---------- */

/**
 * An invite link's secret: 32 bytes as base64url, 43 characters. Only ever in the link's fragment
 * (`<web app>/invite#<secret>`), which browsers never send, and in POST bodies. The server keeps only its hash.
 */
export const InviteSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** A link's secret, in a body: to see who it's from, or to say your account was made from it. */
export const InviteSecretBodySchema = z.object({ secret: InviteSecretSchema });

/** Someone whose account was made from your invite link, and when they said so. */
export const InviteJoinedSchema = z.object({ person: PersonSchema, at: ISODateSchema });

export type InviteJoined = z.infer<typeof InviteJoinedSchema>;

/** Your own invite link, the same every time it's asked for, and who joined Alcove from it, newest first. */
export const InviteLinkSchema = z.object({ link: z.string().url(), joined: z.array(InviteJoinedSchema) });

export type InviteLink = z.infer<typeof InviteLinkSchema>;

/** What an invite link says to whoever opens it, signed in or not: who it's from. */
export const InvitePeekSchema = z.object({ from: PersonSchema });

export type InvitePeek = z.infer<typeof InvitePeekSchema>;
