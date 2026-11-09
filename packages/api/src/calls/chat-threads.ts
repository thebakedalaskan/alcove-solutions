import { z } from '../shared/zod';

/** One canonical original and the exact reply being answered, encrypted with its conversation. */
export const CallChatThreadSchema = z.object({ root: z.string().min(1).max(64), replyTo: z.string().min(1).max(64) });
export type CallChatThread = z.infer<typeof CallChatThreadSchema>;
