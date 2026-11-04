/*
 * What a browser tells the others about itself on the document's awareness, at most every 100 ms. Another
 * browser's state is `unknown` until this parses it. It says nothing about who it is: the server adds that, so
 * nobody points under another name.
 */
import { BOARD_LIMITS, BoardIdSchema } from './shape';
import { z } from './zod';

export const BoardPresenceSchema = z.object({
  /** Where the pointer is on the board, or null off it. */
  at: z.object({ x: z.number(), y: z.number() }).nullable(),
  /** The camera, which is how following and Go to find someone. */
  view: z.object({ x: z.number(), y: z.number(), z: z.number().positive() }).nullable(),
  sel: z.array(BoardIdSchema).max(BOARD_LIMITS.objects),
  edit: BoardIdSchema.nullable(),
  typing: z.boolean()
});
export type BoardPresence = z.output<typeof BoardPresenceSchema>;

/** A browser with nothing to show yet. */
export const NO_PRESENCE: BoardPresence = { at: null, view: null, sel: [], edit: null, typing: false };
