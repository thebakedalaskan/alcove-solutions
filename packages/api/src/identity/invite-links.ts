import { z } from '../shared/zod';

/* ---------- your own invite link (docs: Privacy, keys and sessions › Invite links) ---------- */

/**
 * The secret after `/invite#`: 32 bytes as base64url, 43 characters, for both kinds of link there, your own invite link and
 * an invitation's own (from its email). Only ever in the link's fragment, which browsers never send, and in POST bodies. The
 * server keeps only its hash.
 */
export const InviteSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** A link's secret, in a body: to see who it's from and which team it joins (`InvitePeek`, teams/schema.ts). */
export const InviteSecretBodySchema = z.object({ secret: InviteSecretSchema });

/**
 * Your own invite link, the same every time it's asked for until you make a new one. Whoever opens it can join your team,
 * new to Alcove or not: the team you're on, or one made for you then if you're on none.
 */
export const InviteLinkSchema = z.object({ link: z.string().url() });

export type InviteLink = z.infer<typeof InviteLinkSchema>;
