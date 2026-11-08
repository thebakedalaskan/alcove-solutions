import { PersonSchema } from '../identity/people';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';

export const CallFeedbackKindSchema = z.enum(['cant-hear', 'slow-down', 'yes', 'no', 'need-break']);
export type CallFeedbackKind = z.infer<typeof CallFeedbackKindSchema>;
export const CallQuestionStatusSchema = z.enum(['open', 'answered', 'dismissed']);
export type CallQuestionStatus = z.infer<typeof CallQuestionStatusSchema>;
export const CallHandSchema = z.object({ id: IDSchema, participantId: z.string(), seat: z.string(), raisedAt: ISODateSchema });
export type CallHand = z.infer<typeof CallHandSchema>;
export const CallQuestionSchema = z.object({
  id: IDSchema, author: PersonSchema, text: z.string(), createdAt: ISODateSchema,
  status: CallQuestionStatusSchema, votes: z.number().int().nonnegative(), voted: z.boolean(), own: z.boolean(), pinned: z.boolean()
});
export type CallQuestion = z.infer<typeof CallQuestionSchema>;
export const CallFeedbackSchema = z.object({ participantId: z.string(), seat: z.string(), kind: CallFeedbackKindSchema, expiresAt: ISODateSchema });
export type CallFeedback = z.infer<typeof CallFeedbackSchema>;
export const CallAttentionCueSchema = z.object({ id: IDSchema, seq: z.number().int().nonnegative(), kind: z.enum(['hand', 'question', 'admission', 'join', 'leave']), at: ISODateSchema });
export type CallAttentionCue = z.infer<typeof CallAttentionCueSchema>;
/** Questions and feedback from your room and their original audience; hosts also see hands from every room. Times use the server clock. */
export const CallAttentionSchema = z.object({
  place: z.string(), hands: z.array(CallHandSchema), questions: z.array(CallQuestionSchema), signals: z.array(CallFeedbackSchema),
  cues: z.array(CallAttentionCueSchema), latest: z.number().int().nonnegative(), serverNow: ISODateSchema
});
export type CallAttention = z.infer<typeof CallAttentionSchema>;
