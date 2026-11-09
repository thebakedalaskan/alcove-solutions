import { z } from '../shared/zod';

/** Tab coordination contains no content, names, call links or credentials. Counts are projections, never receipts. */
export const TabAttentionSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('look') }),
  z.object({ type: z.literal('mentions-read'), owner: z.string() }),
  z.object({ type: z.literal('call'), tab: z.string(), owner: z.string().nullable(), call: z.string(), mentions: z.number().int().min(0).max(99), actions: z.number().int().min(0).max(99) }),
  z.object({ type: z.literal('gone'), tab: z.string() })
]);
export type TabAttentionSignal = z.infer<typeof TabAttentionSignalSchema>;
