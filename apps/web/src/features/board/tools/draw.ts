/*
 * Dragging something out, as a shape or a frame is. It goes on the board at the first sign of a drag and grows under the
 * pointer, so everyone sees it being drawn, all as one undo. A press that doesn't go anywhere gets the standard size, with
 * its corner where the press was.
 */
import { BOARD_LIMITS, resizeObject, type Box } from '@alcove/board';
import type { SheetPoint } from '../camera';
import type { Gesture } from '../gestures';
import { CLICK_SLOP, boxBetween } from '../selection';
import type { Board } from '../useBoard';

export interface Drawn {
  /** What a click makes. */
  standard: { w: number; h: number };
  add(box: Box): string | null;
  /** It's been let go. Its undo step is still open: this says when that ends. */
  done(id: string): void;
}

export function drawGesture(board: Board, start: SheetPoint, thing: Drawn): Gesture {
  const standard = { x: start.x, y: start.y, ...thing.standard };
  let id: string | null = null, refused = false;

  const begin = (box: Box): void => {
    board.beginStep();
    id = thing.add(box);
    if (id) {
      board.read();
      board.select([id]);
      return;
    }
    refused = true;
    board.endStep();
    board.refuse();
  };
  const size = (made: string, box: Box): void => {
    resizeObject(board.doc, made, box, board.origin);
    board.read();
  };

  return {
    move(at) {
      const box = boxBetween(start, at);
      if (id) size(id, box);
      else if (!refused && box.w + box.h >= CLICK_SLOP / board.camera.getSnapshot().z) begin(box);
    },
    up(at) {
      const { w, h } = boxBetween(start, at);
      if (!id && !refused) begin(standard);
      else if (id && w <= BOARD_LIMITS.minSide && h <= BOARD_LIMITS.minSide) size(id, standard);
      if (!id) return;
      board.set({ tool: 'select' });
      thing.done(id);
    },
    cancel() {
      if (!id) return;
      board.endStep();
      board.set({ tool: 'select' });
    }
  };
}
