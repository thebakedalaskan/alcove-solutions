import { IDSchema } from '../shared/ids';
import { z } from '../shared/zod';
export const PortraitHairSchema = z.enum(['long', 'short', 'bun', 'curly', 'bob', 'wavy', 'side', 'buzz']);

export type PortraitHair = z.infer<typeof PortraitHairSchema>;

/** Appearance for illustrated portraits, used when someone has no photo. */
export const PortraitStyleSchema = z.object({
  bg: z.string(), skin: z.string(), hair: z.string(), shirt: z.string(), style: PortraitHairSchema,
  beard: z.boolean().optional(), glasses: z.boolean().optional(), earrings: z.boolean().optional(),
  /** Colours of the room behind the person when their camera is on. */
  room: z.tuple([z.string(), z.string(), z.string()]).optional()
});

export type PortraitStyle = z.infer<typeof PortraitStyleSchema>;


export const PersonSchema = z.object({
  /** The owner ID for Alcove users; the email address for everyone else. */
  id: IDSchema,
  name: z.string(),
  email: z.string(),
  /** A photo from the person's sign-in provider. Without one the UI draws their portrait. */
  photoUrl: z.string().optional(),
  portrait: PortraitStyleSchema.optional()
});

export type Person = z.infer<typeof PersonSchema>;


/* ---------- people ---------- */

/** Someone to invite or share with. */
export const PersonSuggestionSchema = z.object({
  person: PersonSchema,
  /** team: your company's directory. met: you've had calls with them. new: an address you typed. */
  source: z.enum(['team', 'met', 'new']),
  onAlcove: z.boolean()
});

export type PersonSuggestion = z.infer<typeof PersonSuggestionSchema>;


/** Your company: the directory where there is one, otherwise the colleagues you have met. Titles come from a directory only. */
export const TeamSchema = z.object({
  name: z.string(),
  domain: z.string(),
  members: z.array(z.object({ person: PersonSchema, title: z.string().optional(), onAlcove: z.boolean(), invited: z.boolean() }))
});

export type Team = z.infer<typeof TeamSchema>;


/**
 * Someone's email address after `#with=` on the notes list (`/notes#with=priya%40lumen.health`, as the Team page
 * links it): the list shows only the notes they have too. It's in the hash, which never leaves the browser, and it
 * comes from the address bar, so the app parses it with this; anything else means no filter.
 */
export const EmailParamSchema = z.string().trim().toLowerCase().email().max(254);
