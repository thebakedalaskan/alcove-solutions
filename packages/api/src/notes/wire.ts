import { EmailParamSchema } from '../identity/people';
import { isTimeZone } from '../meetings/schema';
import { oneLine } from '../shared/validation';
import { ModelIdSchema } from './models';
import { NoteKindSchema } from './schema';
import { z } from '../shared/zod';

/** The most characters a search's words can be: the server refuses a longer search, so the app sends no more than this. */
export const MAX_SEARCH_TEXT = 200;

/** The most characters a question can be, about one call, a series or across your notes: a longer one is refused. */
export const MAX_QUESTION = 500;

/**
 * Searching your notes: the kind of note, the words (`searchOf` says how they're read) and whose lines to look in (`by`,
 * someone's address). It all travels in the body, so neither the words nor the address reaches a URL or a log line.
 */
export const NoteSearchBodySchema = z.object({ kind: NoteKindSchema.optional(), text: z.string().max(MAX_SEARCH_TEXT).optional(), by: EmailParamSchema.optional() });


/**
 * Sharing notes: up to 50 addresses, and the group's name when they're one of the sharer's groups
 * (the app sends the group's addresses; the group itself stays in the sharer's preferences).
 */
export const ShareInputSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(50),
  group: z.string().trim().min(1).max(40).optional()
});


/** Asking about a call: the question travels in the body. */
export const AskBodySchema = z.object({ question: z.string().trim().min(1).max(MAX_QUESTION) });

/** Writing the notes again: optionally with another model (an ID from `models.list()`, or null for the default model). */
export const RewriteBodySchema = z.object({ model: ModelIdSchema.nullable().optional() });


/** Saying the notes got a later call wrong, or taking that back. */
export const RevisitPatchSchema = z.object({ dismissed: z.boolean() });

export type RevisitPatch = z.infer<typeof RevisitPatchSchema>;


/** Asking across a series: the question, and the asker's time zone, which the calls' dates are read in. */
export const SeriesAskBodySchema = AskBodySchema.extend({ timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Not a time zone.') });

/** The words someone read when they agreed to them. If they've changed since, nothing they read is what they'd be agreeing to. */
const SeenWords = z.object({ text: z.string().max(2000) });

/**
 * A change to a decision: confirm it, say it wasn't decided, put it back to proposed, reword it, say a confirmed one no
 * longer holds (superseded), or (`dispute`) say it wasn't decided as someone who can't reject it, or take that back.
 * Rewording a confirmed decision puts it back to proposed, unless the organizer confirms the new words in the same change.
 * Confirming says what was read (`seen`), and is refused if the decision says something else by then.
 */
export const DecisionPatchSchema = z.object({
  state: z.enum(['proposed', 'confirmed', 'rejected', 'superseded']).optional(),
  text: oneLine(300).optional(),
  dispute: z.boolean().optional(),
  seen: SeenWords.optional()
}).refine((p) => p.state !== undefined || p.text !== undefined || p.dispute !== undefined, 'Nothing to change.')
  .refine((p) => p.state !== 'confirmed' || p.text !== undefined || p.seen !== undefined, 'Say what you read.');

export type DecisionPatch = z.infer<typeof DecisionPatchSchema>;


/** A change to an open question: say it was answered, open it again, or reword it. */
export const QuestionPatchSchema = z.object({
  state: z.enum(['open', 'answered']).optional(),
  text: oneLine(300).optional()
}).refine((p) => p.state !== undefined || p.text !== undefined, 'Nothing to change.');

export type QuestionPatch = z.infer<typeof QuestionPatchSchema>;


/**
 * A change to a follow-up. Only the person it's for can take it on (`takeOn`: "I'll do it"). The rest follows `grants.ts`.
 * Taking something on, or giving it to yourself, says what was read (`seen`), its words and its date: agreeing to something
 * that's since become something else is refused.
 */
export const ActionPatchSchema = z.object({
  done: z.boolean().optional(),
  takeOn: z.literal(true).optional(),
  /** Give it to someone who has the notes, by email address, or to nobody: from the person it's for, that's "Not mine". */
  owner: z.string().trim().toLowerCase().max(254).nullable().optional(),
  due: z.string().trim().max(40).nullable().optional(),
  text: oneLine(300).optional(),
  seen: SeenWords.extend({ due: z.string().max(100).nullable() }).optional()
}).refine((p) => Object.values(p).some((v) => v !== undefined), 'Nothing to change.');

export type ActionPatch = z.infer<typeof ActionPatchSchema>;


/** The most lines someone can pick as what a decision or follow-up they propose rests on. */
export const MAX_PROPOSAL_LINES = 3;

/**
 * Someone with the notes adding a decision the notes didn't hear: its exact words, the lines it rests on, and the
 * breakout room's section it goes in (the call's, without one). It starts as proposed. This is the only way in: nothing
 * reaches the shared notes unless someone sends it here themselves.
 */
export const DecisionProposalSchema = z.object({
  text: oneLine(300),
  lines: z.array(z.string().min(1).max(64)).max(MAX_PROPOSAL_LINES).optional(),
  room: z.string().min(1).max(64).optional()
});

export type DecisionProposal = z.infer<typeof DecisionProposalSchema>;

/** Someone with the notes adding a follow-up: who it's for (someone who has the notes, who takes it on themselves) and when it's due. */
export const ActionProposalSchema = DecisionProposalSchema.extend({
  owner: z.string().trim().toLowerCase().max(254).optional(),
  due: z.string().trim().min(1).max(40).optional()
});

export type ActionProposal = z.infer<typeof ActionProposalSchema>;


/**
 * A correction to a line of a written note's transcript: its words, who said it (someone from the call, by their
 * `Person.id`, or null when nobody can tell), or that it's right as it was heard (`confirm`).
 */
export const LinePatchSchema = z.object({
  text: oneLine(1000).optional(),
  speaker: z.string().min(1).max(254).nullable().optional(),
  confirm: z.literal(true).optional()
}).refine((p) => p.text !== undefined || p.speaker !== undefined || p.confirm !== undefined, 'Nothing to change.');

export type LinePatch = z.infer<typeof LinePatchSchema>;
