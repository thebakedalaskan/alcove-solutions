/*
 * A board in a call (docs: Calls and recordings › A board in a call): which one is open in the part of the call you're in,
 * and what you may do with it. What's on it is the workspace's: a board is a document of kind `board`, read and written
 * with `api.workspaces.document`. Being in a call opens nothing, so whoever can't open a board is told one is open, and by
 * whom, and nothing that names it.
 */
import { z } from './zod';
import { IDSchema } from './types';
import { DocumentRoleSchema, ItemIdSchema } from './workspaces';

/** What a new board starts from. */
export const BoardTemplateSchema = z.enum(['blank', 'retro', 'ideas', 'flow', 'what-why-next']);
export type BoardTemplate = z.infer<typeof BoardTemplateSchema>;

/**
 * The board open in the part of the call you're in. `role` null is "A board you can't open": `workspaceId`, `documentId` and
 * `name` are null with it, and no more is said.
 */
export const CallBoardOpenSchema = z.object({
  /** Where it is, for `api.workspaces.document`. */
  workspaceId: IDSchema.nullable(),
  documentId: IDSchema.nullable(),
  /** What it's called now. */
  name: z.string().nullable(),
  /** Whoever opened it, by participant ID: the connection they're on now, or null when they aren't in the call. */
  openedBy: z.string().nullable(),
  /** You can close it for everyone: you opened it, or you're the organizer. */
  canClose: z.boolean(),
  /** What you can do with it. */
  role: DocumentRoleSchema.nullable(),
  /** What the board says about who can see it: `Sealed`, or `Sealed to this room`. */
  seal: z.string()
});
export type CallBoardOpen = z.infer<typeof CallBoardOpenSchema>;
export const CallBoardSchema = z.object({ open: CallBoardOpenSchema.nullable() });
export type CallBoard = z.infer<typeof CallBoardSchema>;

/** A new board from a template, saved in the call's workspace. */
export const BoardNewSchema = z.object({ template: BoardTemplateSchema });
/** A saved board. `letIn` gives everyone here who can't open it a seat until the call ends, and anyone let into the call later; it needs the right to share that board. */
export const BoardSavedSchema = z.object({ documentId: ItemIdSchema, letIn: z.boolean() });
export type BoardOpen = z.infer<typeof BoardNewSchema> | z.infer<typeof BoardSavedSchema>;

/** What opening a saved board would mean, for the menu to ask before anything opens. */
export const BoardCheckSchema = z.object({
  /** The first names of people in the call who can't open it. */
  cannot: z.array(z.string()),
  /** You may let them in for this call: you have the right to share this board. */
  mayLetIn: z.boolean()
});
export type BoardCheck = z.infer<typeof BoardCheckSchema>;
