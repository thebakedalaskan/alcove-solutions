import { PersonSchema } from '../identity/people';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
/* ---------- notes ---------- */

export const SpeakerSchema = z.object({ name: z.string(), person: PersonSchema.optional() });

export type Speaker = z.infer<typeof SpeakerSchema>;


/** How someone came to have a note: they ran the call, were invited to it, or it was shared with them after. */
export const RecipientRoleSchema = z.enum(['organizer', 'invited', 'shared']);

export type RecipientRole = z.infer<typeof RecipientRoleSchema>;


/**
 * Who changed something in a note: their account, their name and address then, and how they had the note (`as`). `id` and
 * `as` are null on changes from before they were kept.
 */
export const ChangerSchema = z.object({ id: z.string().nullable().default(null), name: z.string(), email: z.string(), as: RecipientRoleSchema.nullable().default(null) });

export type Changer = z.infer<typeof ChangerSchema>;


/**
 * Someone changing a note: its decisions, open questions or follow-ups, or a line of its transcript. Who, when, what,
 * and what it was before. On a transcript line, `reworded` corrects its words, `reassigned` says someone else said it
 * (`before` and `after` are the speakers' names) and `confirmed` says it's right as it was heard. `proposed` is someone
 * adding a decision or follow-up the notes didn't hear, always its first change. `disputed` says a decision wasn't
 * decided, from someone who can't reject it, and `undisputed` takes that back. `declined` is the person a follow-up was
 * for saying it isn't theirs. `reopened` on a follow-up asks its owner to take it on again, after it was changed.
 */
export const ChangeSchema = z.object({
  by: ChangerSchema,
  at: ISODateSchema,
  what: z.enum(['proposed', 'confirmed', 'rejected', 'superseded', 'reopened', 'reworded', 'answered', 'took-on', 'declined', 'reassigned', 'due', 'done', 'undone', 'disputed', 'undisputed', 'accepted', 'dismissed']),
  /** The wording, owner, speaker or due date before a change to it, and after. */
  before: z.string().optional(),
  after: z.string().optional()
});

export type Change = z.infer<typeof ChangeSchema>;


/**
 * What the transcript can't vouch for in a line. `words`: the speech model heard them with little confidence, so they
 * may not be exactly what was said. `speaker`: the same words were heard on more than one person's microphone at
 * once (people in one room, or a speaker picked up by someone else's microphone), so someone else may have said them.
 * Correcting the line, or saying it's right, clears it.
 */
export const LineDoubtSchema = z.object({ words: z.literal(true).optional(), speaker: z.literal(true).optional() });

export type LineDoubt = z.infer<typeof LineDoubtSchema>;


export const TranscriptLineSchema = z.object({
  id: IDSchema,
  /** Seconds into the recording, counting every segment before this one (as the player does). */
  at: z.number(),
  /** Who spoke. Absent when nobody can tell, as in a room recording. */
  speaker: SpeakerSchema.optional(),
  /** The breakout room it was said in. Absent for the main room, and outside calls. */
  room: z.object({ id: IDSchema, name: z.string() }).optional(),
  text: z.string(),
  /** What the transcript can't vouch for in this line. Absent when it was heard clearly. */
  unsure: LineDoubtSchema.optional(),
  /** Corrections to a written note's line, oldest first. Absent until someone corrects it. */
  changes: z.array(ChangeSchema).optional()
});

export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;
