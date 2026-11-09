import { PersonSchema } from '../identity/people';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';

export const CallQuestionStatusSchema = z.enum(['open', 'answered', 'dismissed']);
export type CallQuestionStatus = z.infer<typeof CallQuestionStatusSchema>;
export const CallHandSchema = z.object({ id: IDSchema, participantId: z.string(), seat: z.string(), raisedAt: ISODateSchema });
export type CallHand = z.infer<typeof CallHandSchema>;
export const CallQuestionSchema = z.object({
  id: IDSchema,
  /** Who asked, as you may see them; null for a question asked anonymously, which never says who asked, to anyone. `own` tells the asker it's theirs. */
  author: PersonSchema.nullable(), text: z.string(), createdAt: ISODateSchema,
  status: CallQuestionStatusSchema, votes: z.number().int().nonnegative(), voted: z.boolean(), own: z.boolean(), pinned: z.boolean()
});
export type CallQuestion = z.infer<typeof CallQuestionSchema>;
/** A quiet word to one person in your room, which only they see: they're muted, you can't hear them, a little slower, a bit louder. */
export const CallNudgeKindSchema = z.enum(['muted', 'cant-hear', 'slow-down', 'louder']);
export type CallNudgeKind = z.infer<typeof CallNudgeKindSchema>;
/**
 * A nudge you got: one note for the same nudge from everyone who sent it within a minute, `count` people, with who sent it
 * (`from`) while that's one person. `at` is when it last changed, on the server clock. Nobody but you is told of it.
 */
export const CallNudgeNoteSchema = z.object({ id: IDSchema, kind: CallNudgeKindSchema, count: z.number().int().positive(), from: PersonSchema.nullable(), at: ISODateSchema });
export type CallNudgeNote = z.infer<typeof CallNudgeNoteSchema>;
/** What someone says they're up to, for everyone in the call: be right back, listening only, or on their phone. */
export const CallStatusKindSchema = z.enum(['away', 'listening', 'phone']);
export type CallStatusKind = z.infer<typeof CallStatusKindSchema>;
/** Back in 2, 5 or 10 minutes. */
export const CallStatusMinutesSchema = z.union([z.literal(2), z.literal(5), z.literal(10)]);
export type CallStatusMinutes = z.infer<typeof CallStatusMinutesSchema>;
/** Someone's status: since when its time was set, and until when (it goes then), or null for no time. Server clock. */
export const CallStatusSchema = z.object({ kind: CallStatusKindSchema, since: ISODateSchema, until: ISODateSchema.nullable() });
export type CallStatus = z.infer<typeof CallStatusSchema>;
export const CallAttentionCueSchema = z.object({ id: IDSchema, seq: z.number().int().nonnegative(), kind: z.enum(['hand', 'question', 'admission', 'join', 'leave']), at: ISODateSchema });
export type CallAttentionCue = z.infer<typeof CallAttentionCueSchema>;
/** Questions from your room and their original audience, and the nudges you got there; hosts also see hands from every room. Times use the server clock. */
export const CallAttentionSchema = z.object({
  place: z.string(), hands: z.array(CallHandSchema), questions: z.array(CallQuestionSchema), nudges: z.array(CallNudgeNoteSchema),
  cues: z.array(CallAttentionCueSchema), latest: z.number().int().nonnegative(), serverNow: ISODateSchema
});
export type CallAttention = z.infer<typeof CallAttentionSchema>;
