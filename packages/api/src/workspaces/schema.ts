import { TeamAccessSchema } from '../teams/schema';
import { PersonSchema, PortraitStyleSchema } from '../identity/people';
import { DeviceSealedSchema } from '../recordings/offline';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { type LiveStore } from '../shared/live';
import { z } from '../shared/zod';
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


/** A call's own pages, in its folder: its notes (the summary and what was decided), its follow-ups, and its transcript. */
export const CallPageSchema = z.enum(['notes', 'follow-ups', 'transcript']);

export type CallPage = z.infer<typeof CallPageSchema>;

export const CALL_PAGES: readonly CallPage[] = ['notes', 'follow-ups', 'transcript'];

/**
 * What makes a folder a call's own: the folder a call makes at the top of its home workspace. Its pages aren't items: they
 * read the call (`here`) or its note (`noteId`), through their own access, and nothing of either is copied into the
 * workspace. Someone who can't read them sees the folder and whatever else is in it.
 */
export const ItemCallSchema = z.object({
  startedAt: ISODateSchema,
  /** The call is still on. */
  on: z.boolean(),
  /** You're in it now: its pages are the live ones (`CallSession`). */
  here: z.boolean(),
  /** Its notes, once it's over, for someone who has them: what its pages open. */
  noteId: IDSchema.nullable()
});

export type ItemCall = z.infer<typeof ItemCallSchema>;


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
  role: DocumentRoleSchema,
  /** A call's folder: its pages, as you may read them. Null for everything else. */
  call: ItemCallSchema.nullable()
});

export type WorkspaceItem = z.infer<typeof WorkspaceItemSchema>;


/** A workspace as one reader sees it: everything they can open and nothing else, parents before what's in them. */
export const WorkspaceTreeSchema = z.object({
  id: IDSchema,
  /** Null for someone outside the workspace who has documents in it. */
  name: z.string().nullable(),
  /** Your role in it, or null when you're not in it: you only have documents in it, or a call you're in uses it. */
  role: WorkspaceRoleSchema.nullable(),
  /**
   * A call you're in uses it: you can open it as its people can, folders and all, and change what isn't restricted, while
   * you're in the call. It gives no say in who has what. Read with the call's pass.
   */
  inCall: z.boolean(),
  /** How many people are in it. Null for someone outside it. */
  people: z.number().nullable(),
  /** On a team's workspace, who's in it (the whole team, or only the people added); null when it isn't a team's. */
  teamAccess: TeamAccessSchema.nullable(),
  items: z.array(WorkspaceItemSchema)
});

export type WorkspaceTree = z.infer<typeof WorkspaceTreeSchema>;


/**
 * A workspace in your Drive, newest first. Someone outside it who has documents in it sees only that it's there: `createdAt`
 * is null for them. `call`: the call it was made for, as a call's home, for someone in it. `youPay`: its files count against
 * your storage, and AI in it against your plan (docs: Plans and usage › Storage), so a call you organize in it opens it, its
 * boards and its files to everyone in the call; one someone else pays for opens only for its own people.
 */
export const WorkspaceSummarySchema = WorkspaceTreeSchema.omit({ items: true, inCall: true }).extend({
  createdAt: ISODateSchema.nullable(),
  call: z.object({ title: z.string(), at: ISODateSchema }).nullable(),
  youPay: z.boolean()
});

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
  entries: z.array(ShareEntrySchema),
  /** The address of everyone who can open it, whichever way they came to: anyone else can't, and is told nothing of it. */
  canOpen: z.array(z.string()),
  /** Asked from inside a call: the seats in it (`CallParticipant.seat`) it's shared with, for people with no address here. */
  seats: z.array(z.string())
});

export type DocumentShare = z.infer<typeof DocumentShareSchema>;


/**
 * What a workspace is for, in one line, as its Home says under its name: empty until an admin says. It's kept with the
 * workspace's name, sealed, and read by anyone in it.
 */
export const WorkspaceAboutSchema = z.object({ about: z.string() });

export type WorkspaceAbout = z.infer<typeof WorkspaceAboutSchema>;


/* ---------- requests ---------- */
export const WorkspaceInputSchema = z.object({ name: oneLine(1, 120) });

/** Saying what a workspace is for: one line, however it was typed, up to 200 characters. Empty says nothing. */
export const WorkspaceAboutInputSchema = z.object({ about: oneLine(0, 200) });

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

/** A block in a document, from a browser. */
const BlockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Someone tagged on a line of a document, by address, or by their seat in the call you're both in. */
export const MentionBodySchema = z.object({ to: ShareTargetSchema, block: BlockIdSchema.nullable() });

export type MentionBody = z.infer<typeof MentionBodySchema>;

/** Addresses a document may name someone by, to have the ID each has in the workspace (`AlcoveApi.workspaces.ids`). */
export const PersonIdsBodySchema = z.object({ emails: z.array(EmailSchema).min(1).max(1000) });

/** The IDs, by address, lower-cased: only the addresses you may ask about are in it. */
export const PersonIdsSchema = z.object({ ids: z.record(z.string(), z.string()) });


/* ---------- in this browser ---------- */

/**
 * Where someone was, remembered in this browser, per account, by ID only: the document they last had open in each workspace
 * and the ones before it, which folders they left open, and whether they tucked the list away.
 */
export const WorkspacePlacesSchema = z.object({
  documents: z.record(z.string(), z.string()),
  /** What was opened in each workspace, the newest first, for Find before anything's typed. */
  recent: z.record(z.string(), z.array(z.string())).default({}),
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
  /** The call's own page they're on, Notes, Follow-ups or the Transcript, for someone in that call with them: anyone else is told only `elsewhere`. */
  page: CallPageSchema.nullable(),
  /** It's you, here or in another tab or on another device. */
  isMe: z.boolean()
});

export type WorkspaceHere = z.infer<typeof WorkspaceHereSchema>;


/** Where a browser says it is: the document open in it and the block its caret is in, the call's own page it's on, or nothing open. */
export const WorkspaceWhereSchema = z.object({ document: ItemIdSchema.nullable(), block: BlockIdSchema.nullable(), typing: z.boolean(), page: CallPageSchema.nullable() });

export type WorkspaceWhere = z.infer<typeof WorkspaceWhereSchema>;

/** Presence, from a browser: where this connection is now, or that it's gone. It says so again every few seconds, or it's taken for gone. */
export const PresenceBodySchema = z.union([z.object({ connection: ItemIdSchema, gone: z.literal(true) }), WorkspaceWhereSchema.extend({ connection: ItemIdSchema })]);

export type PresenceBody = z.infer<typeof PresenceBodySchema>;


/**
 * Someone tagged you. You only hear of it in a document you can open, so what it's called comes from your own tree, and
 * it's yours to say you've seen (`seen`): until then it's kept for you, however long you're away.
 */
export const WorkspaceMentionSchema = z.object({
  id: IDSchema,
  document: IDSchema,
  /** The line, to land on. */
  block: z.string().nullable(),
  /** Who tagged you, by name and face: never an address. */
  by: PersonSchema,
  at: ISODateSchema
});

export type WorkspaceMention = z.infer<typeof WorkspaceMentionSchema>;

/** The same, wherever you are in the app: which workspace, and what the document's called. */
export const MentionNoticeSchema = WorkspaceMentionSchema.extend({ workspaceId: IDSchema, name: z.string() });

export type MentionNotice = z.infer<typeof MentionNoticeSchema>;


/**
 * What a browser calls one of its streams of a workspace or a document: 22 characters of base64url it makes up as it opens
 * the stream, and sends with it in `LIVE_STREAM_HEADER`, never in a URL. It says when it closes the stream by the same name
 * (`LiveStreamEndBodySchema`), so the API lets go of it at once, which it couldn't otherwise hear through Cloud Run. Nobody
 * else's browser can end it, and it's never written anywhere.
 */
export const LiveStreamNameSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

export const LIVE_STREAM_HEADER = 'x-alcove-stream' as const;

/**
 * A browser closed its stream by this name: `POST …/live/end`, sent as the page may be going (keepalive). It takes an
 * account: a guest's call pass alone is refused, and their stream is let go of as any other the API doesn't hear closed.
 */
export const LiveStreamEndBodySchema = z.object({ stream: LiveStreamNameSchema });

export type LiveStreamEndBody = z.infer<typeof LiveStreamEndBodySchema>;


/**
 * One line of a workspace's stream. `tree` comes first and then whenever it changes for you, whole. `presence`: everyone
 * here that you can know of, whole, whenever that changes. `mentions`: the tags you haven't seen, whole, on opening and
 * whenever they change, including when another window reads one. `access`: your role changed, just before the `tree`
 * that shows it. `ping`: it's still there.
 * `closed`: you can't open this workspace any more, so it ends and stays ended. A stream that just ends is to be opened again.
 */
export const WorkspaceLiveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tree'), tree: WorkspaceTreeSchema }),
  z.object({ type: z.literal('presence'), here: z.array(WorkspaceHereSchema) }),
  z.object({ type: z.literal('mentions'), mentions: z.array(WorkspaceMentionSchema) }),
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
  /** Tags you've heard of here and haven't said you've seen, the oldest first. */
  mentions: WorkspaceMention[];
}

/**
 * A workspace, kept up to date. Read it with useLive(). While its stream is down it tries again by itself, a little later
 * each time up to every 10 seconds, and, waiting to, at once when the browser comes back online or the tab back into view
 * (`wake`).
 */
export interface WorkspaceLive extends LiveStore<WorkspaceView> {
  /** Says where this browser is. It's here with nothing open from the moment the stream opens, and for as long as it stays open. */
  present(where: WorkspaceWhere): void;
  /** You've heard about this tag, so it isn't kept for you any more, on any device. Done once that's said, or couldn't be: the next stream says it again. */
  seen(mention: string): Promise<void>;
  /**
   * Try now: while the stream is down, it opens again at once rather than after the wait, and a try that's hanging is given
   * up. Nothing while it's live or closed. For someone who asked.
   */
  retry(): void;
  /**
   * There's reason to think it would connect now (it's shown again, say): waiting to try again, it tries now. A try that's
   * under way, the first one included, carries on however long it's taking. Nothing while it's live or closed.
   */
  wake(): void;
  close(): void;
}

/**
 * A guest in a call has no session: they read a workspace with their call pass (`CallTicket.pass`). Someone signed in
 * sends both from inside a call, and has what each gives them.
 */
export interface WorkspaceReadOptions { pass?: string | undefined }
