import { IDSchema } from '../shared/ids';
import { z } from '../shared/zod';
export const NoteProgressSchema = z.object({
  noteId: IDSchema,
  title: z.string(),
  steps: z.array(z.object({ label: z.string(), done: z.boolean() })),
  ready: z.boolean()
});

export type NoteProgress = z.infer<typeof NoteProgressSchema>;
