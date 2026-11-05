/*
 * The in-call workspace: its people, its tree of documents, boards and folders, who a document is shared with, and its
 * live stream (docs: Privacy, keys and sessions › Who can open a workspace). What a document or board holds isn't here:
 * to the tree, `kind` is only data.
 */
import { z } from './zod';
import type { LiveStore } from './live';
import { DeviceSealedSchema, IDSchema, ISODateSchema, PersonSchema, PortraitStyleSchema } from './types';

/** IDs that come from a browser: 22 characters of base64url. Anything else names nothing. */
export const ItemIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
/** Words on one line, however they were typed. */
const oneLine = (min: number, max: number) => z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(min).max(max));
const EmailSchema = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);

/** What someone in a workspace can do: `admin` also changes its name and people; `read` changes nothing. */
export const WorkspaceRoleSchema = z.enum(['admin', 'edit', 'read']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;
/** What someone can do with one document. */
export const DocumentRoleSchema = z.enum(['edit', 'read']);
export type DocumentRole = z.infer<typeof DocumentRoleSchema>;
/** What's in the tree. Documents and boards hold content and are shared the same way; a folder holds the tree's other items. */
export const ItemKindSchema = z.enum(['document', 'folder', 'board']);
export type ItemKind = z.infer<typeof ItemKindSchema>;

/** Who made something, as anyone who can see it sees them: never an address. */
export const ItemAuthorSchema = z.object({ name: z.string(), portrait: PortraitStyleSchema });
export type ItemAuthor = z.infer<typeof ItemAuthorSchema>;

export const WorkspaceItemSchema = z.object({
  id: IDSchema,
  kind: ItemKindSchema,
  /** Empty until it's named: the app shows its own word for that. */
  name: z.string(),
  /** The folder it's in, or null at the top. Null for someone it was shared with on its own, who sees no folders. */
  parent: IDSchema.nullable(),
  /** Who made it, when someone in particular did. */
  by: ItemAuthorSchema.nullable(),
  createdAt: ISODateSchema,
  editedAt: ISODateSchema,
  /** When it went to Trash, on its own or with a folder it's in; null when it's in the tree. */
  trashedAt: ISODateSchema.nullable(),
  /** Who sent it there, by name. */
  trashedBy: z.string().nullable(),
  /** Opens only for its creator and the people it's shared with. Always false for a folder. */
  restricted: z.boolean(),
  /** What you can do with it. */
  role: DocumentRoleSchema
});
export type WorkspaceItem = z.infer<typeof WorkspaceItemSchema>;

/** A workspace as one reader sees it: everything they can open and nothing else, parents before what's in them. */
export const WorkspaceTreeSchema = z.object({
  id: IDSchema,
  /** Null for someone outside the workspace who has documents in it. */
  name: z.string().nullable(),
  /** Your role in it, or null when you only have documents in it. */
  role: WorkspaceRoleSchema.nullable(),
  /** How many people are in it. Null for someone outside it. */
  people: z.number().nullable(),
  items: z.array(WorkspaceItemSchema)
});
export type WorkspaceTree = z.infer<typeof WorkspaceTreeSchema>;

/** A workspace in your list. Someone outside it who has documents in it sees only that it's there. */
export const WorkspaceSummarySchema = WorkspaceTreeSchema.omit({ items: true });
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

/** Someone in a workspace. `id` is what the API calls them here. */
export const WorkspacePersonSchema = z.object({ id: IDSchema, person: PersonSchema, role: WorkspaceRoleSchema, since: ISODateSchema, isMe: z.boolean() });
export type WorkspacePerson = z.infer<typeof WorkspacePersonSchema>;

/** Who to share a document with: an address, or a seat in the call you're in (`CallParticipant.seat`), which ends with the call. */
export const ShareTargetSchema = z.union([z.object({ email: EmailSchema }), z.object({ seat: z.string().min(1).max(64) })]);
export type ShareTarget = z.infer<typeof ShareTargetSchema>;
/** Someone a document is shared with beyond the workspace's own people. A seat has a name only. */
export const ShareEntrySchema = z.object({ id: IDSchema, kind: z.enum(['email', 'seat']), person: PersonSchema, role: DocumentRoleSchema, since: ISODateSchema });
export type ShareEntry = z.infer<typeof ShareEntrySchema>;
/** Who has a document, for the Share sheet. */
export const DocumentShareSchema = z.object({
  /** The workspace's own people, who have it unless it's restricted. */
  workspace: z.object({ name: z.string(), people: z.number() }),
  restricted: z.boolean(),
  entries: z.array(ShareEntrySchema)
});
export type DocumentShare = z.infer<typeof DocumentShareSchema>;

/* ---------- requests ---------- */
export const WorkspaceInputSchema = z.object({ name: oneLine(1, 120) });
export const WorkspacePersonInputSchema = z.object({ email: EmailSchema, role: WorkspaceRoleSchema });
export const WorkspaceRolePatchSchema = z.object({ role: WorkspaceRoleSchema });
const ItemName = oneLine(0, 200);
/** Where something lands: in `parent` (null: at the top), after the sibling `after` (null: first; left out: last). */
export const ItemPlaceSchema = z.object({ parent: ItemIdSchema.nullable(), after: ItemIdSchema.nullable().optional() });
export type ItemPlace = z.infer<typeof ItemPlaceSchema>;
export const ItemInputSchema = z.object({ kind: ItemKindSchema, name: ItemName.default(''), parent: ItemIdSchema.nullable().default(null), after: ItemIdSchema.nullable().optional() });
export type ItemInput = z.input<typeof ItemInputSchema>;
export const ItemRenameSchema = z.object({ name: ItemName });
/** Sharing with many people is one change: all of them, or none. */
export const ShareBodySchema = z.object({ to: z.array(ShareTargetSchema).min(1).max(100), role: DocumentRoleSchema });
export const RestrictBodySchema = z.object({ restricted: z.boolean() });
/** What a new workspace, item or person comes back as. Only an ID: an answer kept for a retry holds nothing readable. */
export const CreatedSchema = z.object({ id: IDSchema });

/* ---------- in this browser ---------- */

/**
 * Where someone was, remembered in this browser, per account, by ID only: the workspace they last had open, the document
 * they last had open in each, which folders they left open, and whether they tucked the list away.
 */
export const WorkspacePlacesSchema = z.object({
  workspace: z.string().nullable(),
  documents: z.record(z.string(), z.string()),
  folders: z.record(z.string(), z.array(z.string())),
  listOff: z.boolean()
});
export type WorkspacePlaces = z.infer<typeof WorkspacePlacesSchema>;

/** An edit kept in this browser until Alcove has it: where it belongs, when it was made, and the update sealed under the device key. */
export const KeptEditSchema = z.object({ owner: z.string(), workspace: z.string(), document: z.string(), key: z.number(), at: z.number(), sealed: DeviceSealedSchema });
export type KeptEdit = z.infer<typeof KeptEditSchema>;

/* ---------- live ---------- */

/**
 * Someone in the workspace now, on one connection. The document and block are null, with `elsewhere`, when you can't open
 * what they have open. `person.id` is what they're known by in this workspace, the same on every connection and in
 * `user.id` on their caret; `person.email` is empty unless you're both in the workspace. `callIdentity` is their connection
 * to a call you're both in, so a tile can show where they are.
 */
export const WorkspaceHereSchema = z.object({
  person: PersonSchema, connection: z.string(), callIdentity: z.string().nullable(), document: IDSchema.nullable(), block: z.string().nullable(), typing: z.boolean(), elsewhere: z.boolean(),
  /** It's you, here or in another tab or on another device. */
  isMe: z.boolean()
});
export type WorkspaceHere = z.infer<typeof WorkspaceHereSchema>;

/** Where a browser says it is: the document open in it and the block its caret is in, or nothing open. */
export const WorkspaceWhereSchema = z.object({ document: ItemIdSchema.nullable(), block: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(), typing: z.boolean() });
export type WorkspaceWhere = z.infer<typeof WorkspaceWhereSchema>;
/** Presence, from a browser: where this connection is now, or that it's gone. It says so again every few seconds, or it's taken for gone. */
export const PresenceBodySchema = z.union([z.object({ connection: ItemIdSchema, gone: z.literal(true) }), WorkspaceWhereSchema.extend({ connection: ItemIdSchema })]);
export type PresenceBody = z.infer<typeof PresenceBodySchema>;

/**
 * One line of a workspace's stream. `tree` comes first and then whenever it changes for you, whole. `presence`: everyone
 * here that you can know of, whole, whenever that changes. `access`: your role changed, just before the `tree` that shows
 * it. `ping`: it's still there. `closed`: you can't open this workspace any more, so it ends and stays ended. A stream that
 * just ends is to be opened again.
 */
export const WorkspaceLiveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tree'), tree: WorkspaceTreeSchema }),
  z.object({ type: z.literal('presence'), here: z.array(WorkspaceHereSchema) }),
  z.object({ type: z.literal('access'), role: WorkspaceRoleSchema.nullable() }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('closed') })
]);
export type WorkspaceLiveEvent = z.infer<typeof WorkspaceLiveEventSchema>;

export interface WorkspaceView {
  /** `connecting` until the first line; `reconnecting` while the connection is down, keeping what it last showed; `closed` for good, showing nothing. */
  status: 'connecting' | 'live' | 'reconnecting' | 'closed';
  tree: WorkspaceTree | null;
  /** Everyone in the workspace now. */
  here: WorkspaceHere[];
}
/** A workspace, kept up to date. Read it with useLive(). */
export interface WorkspaceLive extends LiveStore<WorkspaceView> {
  /** Says where this browser is. It's here with nothing open from the moment the stream opens, and for as long as it stays open. */
  present(where: WorkspaceWhere): void;
  close(): void;
}
/**
 * A guest in a call has no session: they read a workspace with their call pass (`CallTicket.pass`). Someone signed in
 * sends both from inside a call, and has what each gives them.
 */
export interface WorkspaceReadOptions { pass?: string | undefined }
