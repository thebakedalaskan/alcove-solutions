import { z } from '../shared/zod';
const ClientLogValueSchema = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);

/**
 * A warning or error the browser reports so it lands in the server log next to the request it came
 * from. Codes, names, sizes and states only: never titles, names, chat, notes or keys.
 */
export const ClientLogEntrySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  msg: z.string().min(1).max(200),
  at: z.string().max(40),
  context: z.record(z.string().max(40), ClientLogValueSchema).refine((r) => Object.keys(r).length <= 30, 'Too many fields.').default({})
});

export type ClientLogEntry = z.infer<typeof ClientLogEntrySchema>;

export const ClientLogBatchSchema = z.object({ entries: z.array(ClientLogEntrySchema).min(1).max(20) });
