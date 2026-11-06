/*
 * A board drawn small for the note's cards, as the note draws one: the board at a full size, shrunk to the card's picture,
 * with all of it in view. Pieces of the canvas's launch retro stand in for a board.
 */
import type { ReactNode } from 'react';
import { KitSheet, RetroPiece } from '../board/parts';

/** The size the picture draws the board at before shrinking it, as the call's tile does. */
const W = 1120;
/** What the launch retro's pieces cover, their titles included. */
const PIECE = { w: 760, h: 570, above: 40 };

/** The board shrunk to `width`, as tall as `ratio` (width over height) says, all of it in view. */
export function boardPicture(width: number, ratio = 5 / 3): ReactNode {
  const h = Math.round(W / ratio);
  const z = Math.min((W * 0.92) / PIECE.w, (h * 0.9) / PIECE.h);
  const cam = { x: Math.round((W - PIECE.w * z) / 2), y: Math.round((h - PIECE.h * z) / 2 + PIECE.above * z), z };
  return (
    <span className="nd-board-mini" style={{ width: W, height: h, transform: `scale(${width / W})` }}>
      <KitSheet width={W} height={h} cam={cam} sheet={{ mini: true, clean: true }}>
        <RetroPiece />
      </KitSheet>
    </span>
  );
}
