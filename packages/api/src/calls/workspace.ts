import { PersonSchema } from '../identity/people';
import { IDSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { DocumentKindSchema } from '../workspaces/library';
import { DocumentRoleSchema, ItemIdSchema, ItemKindSchema, WorkspaceRoleSchema } from '../workspaces/schema';
import { AddedFollowUpSchema, LiveFollowUpSchema } from './catchup';
/** Someone in the call, as what they started names them. `seat` is `CallParticipant.seat`: it holds across their reconnections. */
export const CallSeatSchema = z.object({ seat: z.string(), name: z.string() });

export type CallSeat = z.infer<typeof CallSeatSchema>;


/** A document or board brought to the call that you can open: where it is, and what you can do with it. */
export const CallBroughtSchema = z.object({ workspaceId: IDSchema, id: IDSchema, kind: ItemKindSchema, name: z.string(), role: DocumentRoleSchema });

export type CallBrought = z.infer<typeof CallBroughtSchema>;


/** What can be presented: the workspace everyone in the call views, or the board open where you are. */
export const PresentKindSchema = z.enum(['workspace', 'board']);

export type PresentKind = z.infer<typeof PresentKindSchema>;

/**
 * One presentation, from its start to its end: starting again is a new one. Random, so it says nothing about what's presented,
 * or by whom, to anyone who isn't told.
 */
export const PresentKeySchema = z.string().min(1).max(64);

/**
 * What's being presented in the part of the call you're in. Presenting changes nobody's access: someone who can't open it
 * is told that something is being presented, and by whom, and `kind`, `id`, `name` and `section` are null for them.
 */
export const CallPresentSchema = z.object({
  key: PresentKeySchema,
  kind: PresentKindSchema.nullable(),
  /** A board: its document. The workspace: the workspace everyone views. */
  id: IDSchema.nullable(),
  /** A board: what it's called now. The workspace: null, as where the presenter is in it comes from presence. */
  name: z.string().nullable(),
  /** A board: the frame everyone is on, from 0. The workspace: null. */
  section: z.number().nullable(),
  by: CallSeatSchema,
  /** You started it. */
  mine: z.boolean()
});

export type CallPresent = z.infer<typeof CallPresentSchema>;

/**
 * How the last presentation in the part of the call you're in ended, until another starts there: which one it was, by whoever
 * presented it (not whoever stopped it), and whether it closed for everyone (`close`) or only for them, so whoever was following
 * it knows whether to keep it open.
 */
export const CallPresentEndedSchema = z.object({ key: PresentKeySchema, close: z.boolean(), by: CallSeatSchema });

export type CallPresentEnded = z.infer<typeof CallPresentEndedSchema>;


/**
 * A video playing for everyone in the part of the call you're in. Only someone who can open its document is told. Times are
 * on the server's clock, so they mean the same in every browser: see `playPosition`.
 */
export const CallPlaySchema = z.object({
  mediaId: IDSchema,
  documentId: IDSchema,
  by: CallSeatSchema,
  playing: z.boolean(),
  /** Where it was at `atMs`. */
  positionMs: z.number(),
  /** When it was there, on the server's clock. */
  atMs: z.number(),
  /** The server's clock as this was read. */
  nowMs: z.number(),
  mine: z.boolean(),
  /** You can pause, seek and stop it: you started it, or you're the organizer. */
  canControl: z.boolean()
});

export type CallPlay = z.infer<typeof CallPlaySchema>;

/** Where a video is, `sinceRead` ms after `play` was read: a late joiner lands at the same moment as everyone else. */
export const playPosition = (play: CallPlay, sinceRead = 0): number => play.positionMs + (play.playing ? play.nowMs - play.atMs + sinceRead : 0);


export const CallWorkspaceSchema = z.object({
  /**
   * The workspace everyone in the call views and edits together: its home, unless the organizer switched to another. Null
   * until someone first opens Workspace (`CallSession.openWorkspace`), and for anyone who can open nothing in it, which is
   * only once it's no longer open to the call (`everyone`): to them it's private, and they aren't told which it is.
   */
  id: IDSchema.nullable(),
  /**
   * The call's home: where its notes and transcript go, in a folder of its own. It's a new workspace made for the call
   * unless one was chosen when it was scheduled, and it doesn't change during the call, whichever is viewed. Null until it's
   * settled, and for anyone who can open nothing in it.
   */
  home: IDSchema.nullable(),
  /** Its name, for someone it opens for. */
  name: z.string().nullable(),
  /** Who chooses it: the organizer, as you see them. */
  chosenBy: PersonSchema,
  /** Something in it opens for you: read the tree with `api.workspaces.live(id, { pass })`. */
  canOpen: z.boolean(),
  /** Your role in it; null when you're not in it, whatever you have in it. */
  role: WorkspaceRoleSchema.nullable(),
  /**
   * Everyone in the call can open it and edit what isn't restricted, guests too, while they're in the call. False once its
   * organizer can't edit there any more, when it opens only for its own people.
   */
  everyone: z.boolean(),
  /** What's been brought to the call that you can open, wherever it is. */
  documents: z.array(CallBroughtSchema),
  /** The agenda this call has, by the ID it has in `documents`, if you can open it. */
  agenda: IDSchema.nullable(),
  present: CallPresentSchema.nullable(),
  /** The last presentation that ended in your part of the call, until another starts there. */
  ended: CallPresentEndedSchema.nullable(),
  play: CallPlaySchema.nullable(),
  /**
   * Always empty and always `no`: nobody asks for the workspace now that it's open to everyone in the call. They're sent only
   * because the previous release's tabs can't read a call without them, and they go in the next release.
   */
  asks: z.array(z.never()),
  asked: z.literal('no')
});

export type CallWorkspace = z.infer<typeof CallWorkspaceSchema>;


/**
 * What viewing another workspace in the call would mean. `cantOpen`: the first names of people in the call who aren't in that
 * workspace, so can't open it but through the call: once everyone views it, they can open and edit it while they're in the call.
 * `everyone`: whether the call opens it to them at all. It does only while its files count against the organizer's storage, so
 * nobody in a call fills another account's storage or spends its AI: one someone else pays for opens only for its own people.
 */
export const CallWorkspaceSwitchSchema = z.object({ name: z.string(), cantOpen: z.array(z.string()), everyone: z.boolean() });

export type CallWorkspaceSwitch = z.infer<typeof CallWorkspaceSwitchSchema>;


/* ---------- the call's follow-ups ---------- */

/** One from the call's shared live notes: ticked with `CallSession.tickFollowUp`. */
export const NotesFollowUpSchema = LiveFollowUpSchema.extend({ from: z.literal('notes') });

/** One someone added in their own words: ticked with `CallSession.tickFollowUp` too. */
export const AddedCallFollowUpSchema = AddedFollowUpSchema.extend({ from: z.literal('added') });

/**
 * A to-do with a person and a date, in a document worked on in this call that you can open: ticked with
 * `CallSession.tickDocumentFollowUp`, or in the document itself, which is the same thing.
 */
export const DocFollowUpSchema = z.object({
  from: z.literal('document'),
  workspaceId: IDSchema,
  documentId: IDSchema,
  /** What the document is called. */
  document: z.string(),
  block: z.string(),
  text: z.string(),
  mentions: z.array(z.object({ id: z.string(), name: z.string() })),
  /** YYYY-MM-DD. */
  dates: z.array(z.string()),
  done: z.boolean(),
  /** You can edit that document. */
  canTick: z.boolean()
});

export type DocFollowUp = z.infer<typeof DocFollowUpSchema>;

export const CallFollowUpSchema = z.discriminatedUnion('from', [NotesFollowUpSchema, AddedCallFollowUpSchema, DocFollowUpSchema]);

export type CallFollowUp = z.infer<typeof CallFollowUpSchema>;

/** The call's follow-ups as you may read them. "Mine" is yours to filter. */
export const CallFollowUpsSchema = z.object({
  items: z.array(CallFollowUpSchema),
  suggestions: z.array(LiveFollowUpSchema),
  /** What the notes are doing where you are: anything but `on`, and what's here comes from documents, or from before. */
  notes: z.enum(['on', 'paused', 'off'])
});

export type CallFollowUps = z.infer<typeof CallFollowUpsSchema>;

const BlockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Ticking a to-do in a document from the call's follow-ups. */
export const DocFollowUpTickSchema = z.object({ workspaceId: ItemIdSchema, documentId: ItemIdSchema, block: BlockIdSchema, done: z.boolean() });

export type DocFollowUpTick = z.infer<typeof DocFollowUpTickSchema>;


/* ---------- what can be sent ---------- */

/** A section of something presented, from 0: a board's frame. */
export const PresentSectionSchema = z.number().int().min(0).max(9999);

/** What to present: the workspace everyone views, or the board open where you are, from a frame. */
export const PresentStartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({ kind: z.literal('board'), id: ItemIdSchema, section: PresentSectionSchema.default(0) })
]);

/** As it's asked for: a board from its first frame unless it says otherwise. */
export type PresentStart = z.input<typeof PresentStartSchema>;

/** How far into a video, in ms: at most a day. */
export const PlayPositionSchema = z.number().int().min(0).max(86_400_000);

/** A video's media ID, as a block in its document names it. */
export const PlayMediaSchema = BlockIdSchema;

/**
 * A document brought to a call. `name` is null for someone who can't open it: they see whose it is and ask them for it, and
 * its `id` is theirs alone and only means something on this call, so it can't be matched with anything anyone else is told.
 * `by` is null when nobody in particular made it. One that's gone, or in Trash, isn't listed.
 */
export const CallDocumentSchema = z.object({ id: IDSchema, kind: DocumentKindSchema, by: z.string().nullable(), name: z.string().nullable() });

export type CallDocument = z.infer<typeof CallDocumentSchema>;
