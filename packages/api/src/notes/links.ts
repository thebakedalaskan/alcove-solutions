import { PersonSchema } from '../identity/people';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';

/**
 * A link to a call's notes: 128 random bits, base64url. Only ever in the link's fragment (`<web app>/link#<secret>`), which
 * browsers never send, and in a POST body. The server keeps only its hash.
 */
export const NoteLinkSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** How long a link to a call's notes works once it's made, in days. */
export const NOTE_LINK_DAYS = 7;

/** The most links a note can have working at once. */
export const MAX_NOTE_LINKS = 20;

/**
 * A link to a call's notes that still works, as everyone with them sees it: who made it, when, and when it runs out.
 * `revocable`: you can revoke it, as whoever made it or the organizer.
 */
export const NoteLinkSchema = z.object({ id: IDSchema, by: PersonSchema, at: ISODateSchema, expiresAt: ISODateSchema, revocable: z.boolean() });

export type NoteLink = z.infer<typeof NoteLinkSchema>;

/** A link just made, and its secret, for `<web app>/link#<secret>`: the secret is said once, here, and never again. */
export const NewNoteLinkSchema = z.object({ link: NoteLinkSchema, secret: NoteLinkSecretSchema });

export type NewNoteLink = z.infer<typeof NewNoteLinkSchema>;

/** Opening a link: its secret, in the body. */
export const NoteLinkClaimSchema = z.object({ secret: NoteLinkSecretSchema });

/**
 * A link to notes waiting for its opener to sign in with Google, which takes the whole tab: its secret and until when
 * (ms), kept in that tab's sessionStorage for ten minutes at most, used once, and never in a URL.
 */
export const NoteLinkReturnStoredSchema = z.object({ secret: NoteLinkSecretSchema, until: z.number() });

/** What opening a link gives the account that opened it: the notes it's to, which are theirs to read now. */
export const NoteLinkClaimedSchema = z.object({ noteId: IDSchema });

export type NoteLinkClaimed = z.infer<typeof NoteLinkClaimedSchema>;
