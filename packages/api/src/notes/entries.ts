import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { FollowUpReviewFields } from './follow-ups';
import { ScreenRefSchema } from './screens';
import { ChangerSchema, ChangeSchema, LineDoubtSchema, SpeakerSchema } from './transcript';
/**
 * What an entry in the notes (a decision, an open question or a follow-up) rests on, by transcript line: the lines it
 * comes from, and any that cut against it, where someone said otherwise. The notes model points at lines it was sent
 * and anything else is dropped; someone proposing an entry picks the lines themselves. Empty on entries written before
 * notes pointed at lines, and on anything nobody could tie to one.
 */
const Grounds = { lines: z.array(IDSchema).default([]), against: z.array(IDSchema).default([]) };


/** Someone saying a decision wasn't decided, who can't reject it themselves: it stands until they take it back or the organizer settles it. */
export const DisputeSchema = z.object({ by: ChangerSchema, at: ISODateSchema });

export type Dispute = z.infer<typeof DisputeSchema>;


/**
 * Something the call settled, as the notes heard it, or as someone who has the notes proposed it. It stays proposed
 * until someone who has the notes confirms it; the organizer can say it wasn't decided (rejected). A confirmed decision
 * can later stop holding (superseded), when a later one replaces it. Rewording a confirmed decision puts it back to
 * proposed, since what people confirmed was the words before.
 */
export const DecisionSchema = z.object({
  id: IDSchema,
  text: z.string(),
  /** When it was said, in seconds into the recording, if the notes could tell. */
  at: z.number().optional(),
  state: z.enum(['proposed', 'confirmed', 'rejected', 'superseded']),
  /** What was on a shared screen when it was settled, if it was about something shown. */
  screen: ScreenRefSchema.optional(),
  ...Grounds,
  /** The people who say it wasn't decided and aren't the ones to reject it. */
  disputes: z.array(DisputeSchema).default([]),
  /** Who proposed, confirmed, rejected, superseded, reopened, disputed or reworded it, oldest first. */
  changes: z.array(ChangeSchema)
});

export type Decision = z.infer<typeof DecisionSchema>;


/**
 * Something the call asked and didn't settle, as the notes heard it. It stays open until someone
 * who has the notes says it was answered.
 */
export const QuestionSchema = z.object({
  id: IDSchema,
  text: z.string(),
  /** When it was asked, in seconds into the recording, if the notes could tell. */
  at: z.number().optional(),
  state: z.enum(['open', 'answered']),
  /** What was on a shared screen when it was asked, if it was about something shown. */
  screen: ScreenRefSchema.optional(),
  ...Grounds,
  /** Who said it was answered, reopened or reworded it, oldest first. */
  changes: z.array(ChangeSchema)
});

export type Question = z.infer<typeof QuestionSchema>;


/**
 * Something someone said they, or someone else, would do. Who it's for (`owner`) and when it's due are suggestions, the
 * notes' or a person's, until `takenOn`: the owner said they'll do it, as it's worded, by that date. Nobody but the owner
 * can say so for them, and changing a follow-up they took on (anyone but them) asks them again.
 */
export const ActionItemSchema = z.object({
  id: IDSchema, text: z.string(),
  ...FollowUpReviewFields,
  /** Stable origin of an inferred board action; sealed with the note. */
  sourceId: z.string().nullable().default(null),
  /** Changes only with authoritative source corrections, never with model wording. */
  sourceVersion: z.string().default(''),
  /** Who it's for: suggested by the notes, or given to them by someone with the notes. Absent when nobody said, or they said it isn't theirs. */
  owner: SpeakerSchema.optional(),
  /** The owner acknowledged it: they said they'll do it. The notes only suggest; nobody but the owner can take it on for them. */
  takenOn: z.boolean(),
  /** When it's due, as said in the call ("Wed", "end of March"). A suggestion until the owner takes it on. */
  due: z.string().optional(),
  /** When it came up, in seconds into the recording, if the notes could tell. */
  at: z.number().optional(),
  done: z.boolean(),
  /** What was on a shared screen when it came up, if it was about something shown. */
  screen: ScreenRefSchema.optional(),
  ...Grounds,
  /** Who took it on, said it wasn't theirs, gave it to someone, changed it or ticked it, oldest first. */
  changes: z.array(ChangeSchema),
  /** Where it was written down, when not in what was said: a board's Actions frame, which puts it under "Follow-ups from the board". */
  from: z.enum(['board']).nullable().default(null)
});

export type ActionItem = z.infer<typeof ActionItemSchema>;


/**
 * What was said or shown that an entry rests on, as it stands now: a line of the transcript (`against` when it cuts
 * against the entry; `corrected` when its words or speaker changed after the entry was last settled) or a moment of a
 * shared screen. Only moments of the note the entry is in.
 */
export const NoteEvidenceMomentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), id: IDSchema, at: z.number(), speaker: SpeakerSchema.optional(), text: z.string(), against: z.boolean(), corrected: z.boolean(), unsure: LineDoubtSchema.optional() }),
  z.object({ kind: z.literal('screen'), id: IDSchema, at: z.number(), title: z.string(), region: z.number().optional(), part: z.string().optional(), sure: z.boolean() })
]);

export type NoteEvidenceMoment = z.infer<typeof NoteEvidenceMomentSchema>;

/**
 * What to be careful of in an entry. `missing`: nothing said or shown backs it. `conflict`: someone said otherwise, in
 * the call (a line against it) or since (a dispute). `unsure`: every line behind it was hard to hear, or may be someone
 * else's. `corrected`: a line behind it changed after it was last settled. `reworded`: its words changed after it was
 * last settled, so what was said may not say what it says now.
 */
export const NoteEvidenceFlagSchema = z.enum(['missing', 'conflict', 'unsure', 'corrected', 'reworded']);

export type NoteEvidenceFlag = z.infer<typeof NoteEvidenceFlagSchema>;

/** What backs an entry for the person reading it: worked out from the note each time they read it, and never kept. */
export const NoteEvidenceSchema = z.object({ moments: z.array(NoteEvidenceMomentSchema), flags: z.array(NoteEvidenceFlagSchema) });

export type NoteEvidence = z.infer<typeof NoteEvidenceSchema>;


const Evidenced = { evidence: NoteEvidenceSchema };

/** An entry in the notes as someone reading them gets it: as kept, with what backs it. */
export const NoteDecisionSchema = DecisionSchema.extend(Evidenced);

export type NoteDecision = z.infer<typeof NoteDecisionSchema>;

export const NoteQuestionSchema = QuestionSchema.extend(Evidenced);

export type NoteQuestion = z.infer<typeof NoteQuestionSchema>;

export const NoteActionSchema = ActionItemSchema.extend(Evidenced);

export type NoteAction = z.infer<typeof NoteActionSchema>;
