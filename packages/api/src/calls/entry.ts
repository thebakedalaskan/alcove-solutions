import { IDSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { MAX_CALL_DOCUMENTS } from '../workspaces/library';
import { NotesSettingSchema } from './notes/settings';
/**
 * A call that starts now. Everything is optional: a bare call is "<name>'s call" with your default notes setting. `documents`:
 * what it brings, from your own library (`Document.id`), as a scheduled call's are.
 */
export const InstantCallInputSchema = z.object({
  title: z.string().optional(),
  guests: z.array(z.string()).optional(),
  notes: NotesSettingSchema.optional(),
  documents: z.array(IDSchema).max(MAX_CALL_DOCUMENTS).optional()
});

export type InstantCallInput = z.infer<typeof InstantCallInputSchema>;


/** A call's code, as its links have it: `kpw-rnzq-hte`. */
export const CallCodeSchema = z.string().regex(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
