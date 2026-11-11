/*
 * What a browser tells the others about itself on the document's awareness, at most every 100 ms. Another
 * browser's state is `unknown` until this parses it. It says nothing about who it is: the server adds that, so
 * nobody points under another name.
 */
import { BOARD_LIMITS, BoardIdSchema } from './shape';
import { z } from './zod';

/**
 * The width of sheet a `view`'s zoom is given for. Screens differ, and a view says nothing about how big its sheet is, so `z` is
 * the zoom that would show the same width of the board on a sheet this wide, and `h` how tall that sheet would be, at the same
 * shape. Any sheet can work out its own from that.
 */
export const BOARD_VIEW_WIDTH = 1000;

export const BoardPresenceSchema = z.object({
  /** Where the pointer is on the board, or null off it. */
  at: z.object({ x: z.number(), y: z.number() }).nullable(),
  /**
   * The camera, which is how following and Go to find someone: the board point in the middle of the sheet, the zoom for a sheet
   * `BOARD_VIEW_WIDTH` wide, and how tall that sheet is (`h`), so whoever follows sees all of the view, top to bottom too,
   * whatever the shape of their own. A browser from before `h` says only the width; one that never heard of it ignores it.
   */
  view: z.object({ x: z.number(), y: z.number(), z: z.number().positive(), h: z.number().positive().optional() }).nullable(),
  sel: z.array(BoardIdSchema).max(BOARD_LIMITS.objects),
  edit: BoardIdSchema.nullable(),
  typing: z.boolean()
});
export type BoardPresence = z.output<typeof BoardPresenceSchema>;

/** A browser with nothing to show yet. */
export const NO_PRESENCE: BoardPresence = { at: null, view: null, sel: [], edit: null, typing: false };
