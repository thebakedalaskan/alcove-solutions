import { IDSchema } from '../shared/ids';
import { z } from '../shared/zod';
export const NoteProgressSchema = z.object({
  noteId: IDSchema,
  title: z.string(),
  steps: z.array(z.object({ label: z.string(), done: z.boolean() })),
  ready: z.boolean()
});

export type NoteProgress = z.infer<typeof NoteProgressSchema>;

/**
 * One line of a note's progress stream (`GET /v1/notes/:id/progress`): where the notes are, about once a second until they're
 * ready. `gone`, its last line: the reader can't read the note any more (it was deleted, they removed it, or it's no longer
 * visible to their team), which the client says as reading the note would, `not-found`. A stream that just ends, before the
 * notes are ready, is to be followed again.
 */
export const NoteProgressLineSchema = z.union([NoteProgressSchema, z.object({ gone: z.literal(true) })]);

export type NoteProgressLine = z.infer<typeof NoteProgressLineSchema>;
