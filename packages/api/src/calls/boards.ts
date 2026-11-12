import { PersonSchema } from '../identity/people';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { DocumentRoleSchema, ItemIdSchema } from '../workspaces/schema';
/** What a new board starts from. */
export const BoardTemplateSchema = z.enum(['blank', 'retro', 'ideas', 'flow', 'what-why-next']);

export type BoardTemplate = z.infer<typeof BoardTemplateSchema>;


/** Something on a board, by its ID there: 12 base64url characters, as `@alcove/board` makes them. */
export const BoardObjectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12}$/);

/** How many votes each person has in a vote on a board. */
export const BoardVotesEachSchema = z.union([z.literal(3), z.literal(5), z.literal(10)]);

export type BoardVotesEach = z.infer<typeof BoardVotesEachSchema>;


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
  /**
   * The call made it, so everyone in it can add to it, anyone let in later too, for as long as it's the call's to give: what
   * the board can say about who's on it. A saved board says only what each person has.
   */
  everyone: z.boolean(),
  /** What you can do with it. */
  role: DocumentRoleSchema.nullable(),
  /** What the board says about who can see it: `Sealed`, or `Sealed to this room`. */
  seal: z.string(),
  /**
   * On the one board every room shares (`BreakoutBoard` `shared`), the frame of the room you're in, by its id on the board:
   * where you land. Null anywhere else.
   */
  frame: z.string().nullable()
});

export type CallBoardOpen = z.infer<typeof CallBoardOpenSchema>;


/** The most ideas from the call a part of it holds at once: the oldest go as new ones come. */
export const MAX_CALL_IDEAS = 6;

/**
 * Something worth keeping that the call heard, offered for the board while notes are on (docs: Calls and recordings › Ideas
 * from the call). Only for someone who may read every line it was picked from, and only in the part of the call it was said in.
 */
export const CallBoardIdeaSchema = z.object({
  id: IDSchema,
  /** What it says, ready for a sticky. */
  text: z.string(),
  /** Who said it, when (null when the moment isn't known), and what they said, as transcribed. */
  said: z.object({ person: PersonSchema, at: ISODateSchema.nullable(), words: z.string() }),
  /** The frame on the board it fits, by its ID there, or null when none does. */
  frame: z.string().nullable()
});

export type CallBoardIdea = z.infer<typeof CallBoardIdeaSchema>;


/**
 * A vote on the board open where you are, told to everyone there who can open the board, whether or not they have it open. Your
 * own votes are yours alone, and every count comes at once, when it ends.
 */
export const CallBoardVoteSchema = z.object({
  /** It's still open. False once it's ended, with `results` for everyone, until it's cleared. */
  on: z.boolean(),
  /** The frame it's on, or null for every sticky on the board. */
  frame: BoardObjectIdSchema.nullable(),
  /** Votes each. */
  per: z.number().int(),
  /** How many of yours are left. */
  left: z.number().int(),
  /** The stickies you voted for, one vote each. */
  mine: z.array(BoardObjectIdSchema),
  /** How many votes each sticky has, for those with any: empty until the vote ends, then the same for everyone. */
  results: z.record(BoardObjectIdSchema, z.number().int()),
  /** How many people voted: 0 until the vote ends. */
  voters: z.number().int(),
  /** You can end it, and clear it after: you started it, or you're the organizer. */
  canEnd: z.boolean(),
  /** Whoever started it, by participant ID: the connection they're on now, or null when they aren't in the call. */
  startedBy: z.string().nullable()
});

export type CallBoardVote = z.infer<typeof CallBoardVoteSchema>;


/**
 * The board in the part of the call you're in, its vote, and ideas from the call for it. None is told to anyone who can't open it.
 * `timer` is always null: a board has no timer of its own now. It's sent only because the previous release's tabs can't read a
 * call without it, and it goes in the next release.
 */
export const CallBoardSchema = z.object({ open: CallBoardOpenSchema.nullable(), timer: z.null(), vote: CallBoardVoteSchema.nullable(), ideas: z.array(CallBoardIdeaSchema).max(MAX_CALL_IDEAS) });

export type CallBoard = z.infer<typeof CallBoardSchema>;


/** A new board from a template, saved in the call's workspace: a call with none has nowhere to keep one (`conflict`) until the organizer picks one. */
export const BoardNewSchema = z.object({ template: BoardTemplateSchema });

/**
 * A saved board, from the workspace it's in, whichever that is, the call's or any other across the
 * Drive. `letIn` gives everyone here who can't open it a seat until the call ends, and anyone let into the call later; it
 * needs the right to share that board.
 */
export const BoardSavedSchema = z.object({ workspaceId: ItemIdSchema, documentId: ItemIdSchema, letIn: z.boolean() });

export type BoardOpen = z.infer<typeof BoardNewSchema> | z.infer<typeof BoardSavedSchema>;


/**
 * What breakout rooms have to work on, the rooms panel's Board row (docs: Calls and recordings › Boards in breakout rooms).
 * `none`: nothing set up, though anyone sent to a room can start one there. `each`: a board for every room, made as they
 * open, from `template`, sealed to that room. `shared`: the main board, with a frame for each room, which everyone stays on;
 * with no board open in the main room, one is made from `template`.
 */
export const BreakoutBoardModeSchema = z.enum(['none', 'each', 'shared']);

export type BreakoutBoardMode = z.infer<typeof BreakoutBoardModeSchema>;

export const BreakoutBoardSchema = z.object({ mode: BreakoutBoardModeSchema, template: BoardTemplateSchema });

export type BreakoutBoard = z.infer<typeof BreakoutBoardSchema>;


/** What opening a saved board would mean, for the menu to ask before anything opens. */
export const BoardCheckSchema = z.object({
  /** The first names of people in the call who can't open it. */
  cannot: z.array(z.string()),
  /** You may let them in for this call: you have the right to share this board. */
  mayLetIn: z.boolean()
});

export type BoardCheck = z.infer<typeof BoardCheckSchema>;
