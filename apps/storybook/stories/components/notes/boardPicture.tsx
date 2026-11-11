/*
 * A board drawn small for the note's cards, as the note draws one: the board at a full width, shrunk to whatever box the
 * card gives its picture, with all of it in view. Pieces of the canvas's launch retro stand in for a board.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { KitSheet, RetroPiece } from '../board/parts';

/** The width the picture draws the board at before shrinking it, as the call's tile does. */
const W = 1120;
/** What the launch retro's pieces cover, their titles included. */
const PIECE = { w: 760, h: 570, above: 40 };

/** The board drawn to fill a box of `width` by `height`, all of it in view. */
function Drawn({ width, height }: { width: number; height: number }) {
  const h = Math.round((W * height) / width);
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

/** Measures the box it's put in (the card's picture), as the note does, and draws the board to fill it. */
function BoardPicture() {
  const mark = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const box = mark.current?.parentElement;
    if (!box) return undefined;
    const read = () => setSize({ width: box.clientWidth, height: box.clientHeight });
    read();
    const watch = new ResizeObserver(read);
    watch.observe(box);
    return () => watch.disconnect();
  }, []);
  return <><span ref={mark} hidden />{size && size.width > 0 && size.height > 0 && <Drawn width={size.width} height={size.height} />}</>;
}

/** The board, as a card's picture: it fills the box the card gives it. */
export const boardPicture = (): ReactNode => <BoardPicture />;
