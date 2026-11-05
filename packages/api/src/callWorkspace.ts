/*
 * The workspace a call uses (docs: Calls and recordings › The call's workspace): which one it is, what's been brought to the
 * call, who's asking to see it, what's being presented and played, and the call's follow-ups. All of it is as one person may
 * know it. Being in a call, or organizing it, opens nothing, so whoever can't open something is told nothing that names it.
 */
import { z } from './zod';
import { LiveFollowUpSchema } from './catchup';
import { IDSchema, ISODateSchema, PersonSchema } from './types';
import { DocumentRoleSchema, ItemIdSchema, ItemKindSchema, WorkspaceRoleSchema } from './workspaces';

/** Someone in the call, as what they started names them. `seat` is `CallParticipant.seat`: it holds across their reconnections. */
export const CallSeatSchema = z.object({ seat: z.string(), name: z.string() });
export type CallSeat = z.infer<typeof CallSeatSchema>;

/** A document or board brought to the call that you can open: where it is, and what you can do with it. */
export const CallBroughtSchema = z.object({ workspaceId: IDSchema, id: IDSchema, kind: ItemKindSchema, name: z.string(), role: DocumentRoleSchema });
export type CallBrought = z.infer<typeof CallBroughtSchema>;

/** What can be presented. */
export const PresentKindSchema = z.enum(['document', 'board']);
export type PresentKind = z.infer<typeof PresentKindSchema>;
/**
 * What's being presented in the part of the call you're in. Presenting changes nobody's access: someone who can't open it
 * is told that something is being presented, and by whom, and `kind`, `id`, `name` and `section` are null for them.
 */
export const CallPresentSchema = z.object({
  kind: PresentKindSchema.nullable(),
  id: IDSchema.nullable(),
  name: z.string().nullable(),
  /** Which section everyone is on, from 0. */
  section: z.number().nullable(),
  by: CallSeatSchema,
  /** You started it. */
  mine: z.boolean(),
  /** You can move it on and stop it: you started it, or you're the organizer. */
  canControl: z.boolean()
});
export type CallPresent = z.infer<typeof CallPresentSchema>;

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

/** Someone asking to see the workspace, for the organizer to answer. They name nothing: the organizer picks what to share. */
export const CallWorkspaceAskSchema = z.object({ id: IDSchema, participantId: z.string(), person: PersonSchema, at: ISODateSchema });
export type CallWorkspaceAsk = z.infer<typeof CallWorkspaceAskSchema>;

export const CallWorkspaceSchema = z.object({
  /**
   * Which workspace the call uses. Null until someone first opens Workspace (`CallSession.openWorkspace`), and for anyone
   * who can open nothing in it: to them it's private, and they aren't told which it is.
   */
  id: IDSchema.nullable(),
  /** Its name, for someone in it. */
  name: z.string().nullable(),
  /** Who chooses it: the organizer, as you see them. */
  chosenBy: PersonSchema,
  /** Something in it opens for you: read the tree with `api.workspaces.live(id, { pass })`. */
  canOpen: z.boolean(),
  /** Your role in it; null when you're not in it, whatever you have in it. */
  role: WorkspaceRoleSchema.nullable(),
  /** What's been brought to the call that you can open, wherever it is. */
  documents: z.array(CallBroughtSchema),
  /** The agenda this call has, by the ID it has in `documents`, if you can open it. */
  agenda: IDSchema.nullable(),
  present: CallPresentSchema.nullable(),
  play: CallPlaySchema.nullable(),
  /** For the organizer: who's asking now, oldest first. Empty for everyone else. */
  asks: z.array(CallWorkspaceAskSchema),
  /** Your own ask: `no`, `asking`, or `declined` once the organizer says not now. An ask they say yes to is a document that opens. */
  asked: z.enum(['no', 'asking', 'declined'])
});
export type CallWorkspace = z.infer<typeof CallWorkspaceSchema>;

/** What changing the call's workspace would mean. `cantOpen`: the first names of people in the call who aren't in that workspace. */
export const CallWorkspaceSwitchSchema = z.object({ name: z.string(), cantOpen: z.array(z.string()) });
export type CallWorkspaceSwitch = z.infer<typeof CallWorkspaceSwitchSchema>;

/* ---------- the call's follow-ups ---------- */

/** One from the call's shared live notes: ticked with `CallSession.tickFollowUp`. */
export const NotesFollowUpSchema = LiveFollowUpSchema.extend({ from: z.literal('notes') });
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
export const CallFollowUpSchema = z.discriminatedUnion('from', [NotesFollowUpSchema, DocFollowUpSchema]);
export type CallFollowUp = z.infer<typeof CallFollowUpSchema>;
/** The call's follow-ups as you may read them. "Mine" is yours to filter. */
export const CallFollowUpsSchema = z.object({
  items: z.array(CallFollowUpSchema),
  /** What the notes are doing where you are: anything but `on`, and what's here comes from documents, or from before. */
  notes: z.enum(['on', 'paused', 'off'])
});
export type CallFollowUps = z.infer<typeof CallFollowUpsSchema>;
const BlockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/** Ticking a to-do in a document from the call's follow-ups. */
export const DocFollowUpTickSchema = z.object({ workspaceId: ItemIdSchema, documentId: ItemIdSchema, block: BlockIdSchema, done: z.boolean() });
export type DocFollowUpTick = z.infer<typeof DocFollowUpTickSchema>;

/* ---------- what can be sent ---------- */

/** A section of something presented, from 0. */
export const PresentSectionSchema = z.number().int().min(0).max(9999);
/** How far into a video, in ms: at most a day. */
export const PlayPositionSchema = z.number().int().min(0).max(86_400_000);
/** A video's media ID, as a block in its document names it. */
export const PlayMediaSchema = BlockIdSchema;
