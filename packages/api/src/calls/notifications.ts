import { IDSchema } from '../shared/ids';
import { type LiveStore } from '../shared/live';
import { z } from '../shared/zod';
import { CallIdentity } from './wire';
import { CallPlaceSchema } from './state';

const ChatId = z.string().min(1).max(100);
/** Opaque original targets only. No message, name, title, pass or key enters an OS notification. */
export const CallNotificationTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('private'), peer: CallIdentity, message: IDSchema, root: IDSchema.nullable() }).readonly(),
  z.object({ type: z.literal('thread'), root: ChatId, message: ChatId }).readonly(),
  z.object({ type: z.literal('chat'), message: ChatId, root: ChatId.nullable() }).readonly(),
  z.object({ type: z.literal('attention'), section: z.enum(['hands', 'questions']), id: IDSchema }).readonly(),
  z.object({ type: z.literal('admission'), identity: CallIdentity }).readonly(),
  z.object({ type: z.literal('timer'), timer: z.enum(['presenter', 'board']), id: z.string().min(1).max(200) }).readonly(),
  z.object({ type: z.literal('capture'), id: IDSchema }).readonly()
]);
export type CallNotificationTarget = z.infer<typeof CallNotificationTargetSchema>;
export const CallNotificationCategorySchema = z.enum(['privateMessages', 'replies', 'chatMentions', 'hands', 'questions', 'admissions', 'timers', 'notesRequested']);
export type CallNotificationCategory = z.infer<typeof CallNotificationCategorySchema>;
/** A click stays bound to the original call connection and room; another tab/session cannot inherit it. */
export const CallNotificationDestinationSchema = z.object({
  eventId: z.string().min(1).max(300), callId: IDSchema, connection: CallIdentity,
  generation: z.number().int().nonnegative(), place: CallPlaceSchema, target: CallNotificationTargetSchema
}).readonly();
export type CallNotificationDestination = z.infer<typeof CallNotificationDestinationSchema>;
export const CallNotificationSchema = z.object({
  category: CallNotificationCategorySchema, destination: CallNotificationDestinationSchema,
  raisedAt: z.number().nonnegative(), expiresAt: z.number().nonnegative()
}).readonly();
export type CallNotification = z.infer<typeof CallNotificationSchema>;
/** Derived exclusively from this connection's authorized live snapshots, never an independent authority. */
export interface CallNotificationState { readonly ready: boolean; readonly candidates: readonly CallNotification[] }
export type CallNotificationsApi = LiveStore<CallNotificationState>;
