import { IDSchema, ISODateSchema } from '../shared/ids';
import { ChangerSchema } from './transcript';
import { oneLine } from '../shared/validation';
import { z } from '../shared/zod';

/** Pending proposals and durable review receipts per readable part, independent of the actual task limit. */
export const MAX_FOLLOW_UP_PROPOSALS = 200;

/** The exact accepted task a proposed change was written against. Owner is an account email, or null. */
export const FollowUpTargetSchema = z.object({ id: IDSchema, revision: z.string(), text: z.string(), owner: z.string().nullable(), due: z.string().nullable() });
export type FollowUpTarget = z.infer<typeof FollowUpTargetSchema>;
/** Defaults open records from before checklist review without changing their accepted tasks. */
export const FollowUpReviewFields = {
  review: z.enum(['accepted', 'suggested', 'dismissed']).default('accepted'),
  changeOf: IDSchema.nullable().default(null),
  revision: z.string().default(''),
  target: FollowUpTargetSchema.nullable().default(null),
  reviewed: z.object({ by: ChangerSchema, at: ISODateSchema, decision: z.enum(['accept', 'dismiss']) }).nullable().default(null)
};
export const ACCEPTED_FOLLOW_UP = { review: 'accepted', changeOf: null, revision: '', target: null, reviewed: null, sourceId: null, sourceVersion: '' } as const;
export const isAcceptedFollowUp = (row: { review: string; changeOf: string | null }): boolean => row.review === 'accepted' && row.changeOf === null;
export const isPendingFollowUp = (row: { review: string }): boolean => row.review === 'suggested';
export const FollowUpReviewSchema = z.object({ id: IDSchema, revision: z.string().min(1).max(64), decision: z.enum(['accept', 'dismiss']) });
export type FollowUpReview = z.infer<typeof FollowUpReviewSchema>;
const Email = z.string().trim().toLowerCase().email().max(254).nullable();
export const FollowUpCreateSchema = z.object({ text: oneLine(300), owner: Email, due: oneLine(40).nullable() });
export type FollowUpCreate = z.infer<typeof FollowUpCreateSchema>;
export const FollowUpPatchSchema = z.object({
  seen: FollowUpTargetSchema.omit({ id: true }),
  text: oneLine(300).optional(), owner: Email.optional(), due: oneLine(40).nullable().optional()
}).refine((p) => p.text !== undefined || p.owner !== undefined || p.due !== undefined, 'Nothing to change.');
export type FollowUpPatch = z.infer<typeof FollowUpPatchSchema>;
