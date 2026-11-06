import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
/* ---------- documents ---------- */

export const DocumentKindSchema = z.enum(['doc', 'board']);

export type DocumentKind = z.infer<typeof DocumentKindSchema>;

/**
 * A document or board someone can bring to a call. `id` is what a call keeps: an ID of its own, not the item's in its workspace.
 * `item` is the item's own ID there, for finding it from where it's open, such as a board's page.
 */
export const DocumentSchema = z.object({
  id: IDSchema,
  item: IDSchema,
  /** Empty until it's named: the app shows its own word for that. */
  name: z.string(),
  kind: DocumentKindSchema,
  /** Who it belongs to, by first name. Null when nobody in particular made it. */
  by: z.string().nullable(),
  updatedAt: ISODateSchema
});

export type Document = z.infer<typeof DocumentSchema>;

/** What someone can bring: everything they can open, by workspace, with a workspace that has nothing to bring left out. */
export const DocumentLibrarySchema = z.object({
  workspaces: z.array(z.object({
    id: IDSchema,
    /** Null for someone outside the workspace who has documents in it. */
    name: z.string().nullable(),
    documents: z.array(DocumentSchema)
  }))
});

export type DocumentLibrary = z.infer<typeof DocumentLibrarySchema>;

/** The most documents a call can bring. */
export const MAX_CALL_DOCUMENTS = 12;
