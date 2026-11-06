/*
 * What a browser tells the others about itself on the document's awareness, at most every 100 ms. Another
 * browser's state is `unknown` until this parses it. It says nothing about who it is: the server adds that, so
 * nobody points under another name.
 */
import { BOARD_LIMITS, BoardIdSchema } from './shape';
import { z } from './zod';

/**
 * The width of sheet a `view`'s zoom is given for. Screens differ, and a view says nothing about how wide its sheet is, so
 * `z` is the zoom that would show the same width of the board on a sheet this wide. Any sheet can work out its own from that.
 */
export const BOARD_VIEW_WIDTH = 1000;

export const BoardPresenceSchema = z.object({
  /** Where the pointer is on the board, or null off it. */
  at: z.object({ x: z.number(), y: z.number() }).nullable(),
  /** The camera, which is how following and Go to find someone: the board point in the middle of the sheet, and the zoom for a sheet `BOARD_VIEW_WIDTH` wide. */
  view: z.object({ x: z.number(), y: z.number(), z: z.number().positive() }).nullable(),
  sel: z.array(BoardIdSchema).max(BOARD_LIMITS.objects),
  edit: BoardIdSchema.nullable(),
  typing: z.boolean()
});
export type BoardPresence = z.output<typeof BoardPresenceSchema>;

/** A browser with nothing to show yet. */
export const NO_PRESENCE: BoardPresence = { at: null, view: null, sel: [], edit: null, typing: false };
