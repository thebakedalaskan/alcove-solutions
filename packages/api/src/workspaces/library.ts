import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { ItemIdSchema, WorkspaceItemSchema } from './schema';
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

/* ---------- the Drive's cards and its Trash ---------- */

/** How a line starts on the page, as a card draws it: plain words, a heading, a bullet or a number, or a tick box, ticked (`done`) or not. */
export const PreviewLineKindSchema = z.enum(['text', 'heading', 'bullet', 'todo', 'done']);

export type PreviewLineKind = z.infer<typeof PreviewLineKindSchema>;

export const PreviewLineSchema = z.object({ text: z.string(), kind: PreviewLineKindSchema });

export type PreviewLine = z.infer<typeof PreviewLineSchema>;

/** How many lines a card shows of a document, and how long each can be: past that it's cut at a word, with an ellipsis. */
export const PREVIEW_LINES = 4;
export const PREVIEW_CHARS = 120;
/** The most documents one ask for previews names: a screen of cards. */
export const MAX_PREVIEWS = 24;

/**
 * What a document says at the top, for its card in the Drive: read from the document as it is now, only for someone who can
 * open it, and kept nowhere. A board has none: its card draws one.
 */
export const DocumentPreviewSchema = z.object({
  id: IDSchema,
  /** Its first lines with words in them, under its title. */
  lines: z.array(PreviewLineSchema),
  /** How many pictures it holds: a document that's photos and nothing else shows them. */
  pictures: z.number().int().nonnegative(),
  /** How many videos it holds, for one that's a video and nothing else. */
  videos: z.number().int().nonnegative(),
  /** The ending of the first file it holds, upper-cased (PDF), for a document that's a file and nothing else; null with none. */
  file: z.string().nullable()
});

export type DocumentPreview = z.infer<typeof DocumentPreviewSchema>;

/** Which documents to preview, as the query names them: IDs with commas between. */
export const PreviewItemsSchema = z.string().transform((s) => s.split(',')).pipe(z.array(ItemIdSchema).min(1).max(MAX_PREVIEWS));

/**
 * Something in Trash, in any workspace you can open it in: the item as that workspace's tree shows it to you, which says who
 * sent it there and when (with a folder it's in, or on its own), and when it goes for good, for everyone.
 */
export const TrashedSchema = z.object({ workspaceId: IDSchema, item: WorkspaceItemSchema, deletesAt: ISODateSchema });

export type Trashed = z.infer<typeof TrashedSchema>;
