/*
 * A board on a phone, as the canvas's phone journey has it: faces stay on top, the board fills the rest, and the one tool is
 * +, at the bottom right. It opens a sheet with one sticky, a colour and a button that says where it's going: the frame in the
 * middle of the view, or the board. The sticky goes in that frame's first free place as the frame is when it's added, so
 * nothing lands on anything, wherever someone has moved the frame meanwhile.
 */
import { colourIn, hasBox, holds, type BoardView, type FrameObject, type StickyColour } from '@alcove/board';
import { BoardPhoneAdd, BoardPhoneSheet } from '@alcove/ui';
import { useEffect, useState } from 'react';
import { STICKY } from './editing';
import { useBoardState, type Board } from './useBoard';

/** The gap round a sticky in a frame, as Tab leaves it. */
const GAP = 20;

/** The frame in the middle of what this person sees, if there is one. */
function frameInView(board: Board): FrameObject | null {
  if (!board.camera.width) return null;
  const seen = board.camera.visible();
  const x = seen.x + seen.w / 2, y = seen.y + seen.h / 2;
  const { frames } = board.getSnapshot().view;
  return frames.findLast((f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h)
    ?? frames.find((f) => f.x < seen.x + seen.w && seen.x < f.x + f.w && f.y < seen.y + seen.h && seen.y < f.y + f.h) ?? null;
}

/** The first place in a frame, left to right and down, that a sticky can go without landing on anything; under the rest if it's full. */
function freeIn(view: BoardView, f: FrameObject): { x: number; y: number } {
  const taken = view.objects.filter(hasBox).filter((o) => o.k !== 'frame' && o.id !== f.id);
  const across = Math.max(1, Math.floor((f.w - GAP) / (STICKY + GAP)));
  const free = (x: number, y: number) => !taken.some((o) => o.x < x + STICKY && x < o.x + o.w && o.y < y + STICKY && y < o.y + o.h);
  for (let i = 0; i < across * 40; i += 1) {
    const x = f.x + GAP + (i % across) * (STICKY + GAP), y = f.y + GAP + Math.floor(i / across) * (STICKY + GAP);
    if (free(x, y)) return { x, y };
  }
  return { x: f.x + GAP, y: f.y + f.h + GAP };
}

/** A frame on the board as it is now, by its ID, or null when it has gone. */
const frameNow = (view: BoardView, id: string | null): FrameObject | null => {
  const o = id ? view.byId.get(id) : undefined;
  return o?.k === 'frame' ? o : null;
};

/** +, and the sheet it opens. `night`: in a call, where everything over the board is night; elsewhere the sheet is the person's theme. */
export function PhoneAdd({ board, name, night, theme }: { board: Board; name: string; night: boolean; theme: 'light' | 'dark' | undefined }) {
  /** The sheet, while it's open, with the frame it said it was going to, by its ID. */
  const [open, setOpen] = useState<{ frame: string | null } | null>(null);
  const [text, setText] = useState('');
  const [colour, setColour] = useState<StickyColour>('butter');
  // The frame it's going to as it is now: renamed meanwhile, the button says its new name, and gone, the board's.
  const frame = useBoardState(board, (s) => frameNow(s.view, open?.frame ?? null));
  // Escape, on a phone with a keyboard, puts the sheet away as the shade does.
  const shown = open !== null;
  useEffect(() => {
    if (!shown) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(null);
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [shown]);
  if (!board.canAdd) return null;
  if (!open) {
    return (
      <BoardPhoneAdd onAdd={() => {
        const inView = frameInView(board);
        setColour(colourIn(board.getSnapshot().view, inView, 'butter'));
        setText('');
        setOpen({ frame: inView?.id ?? null });
      }} />
    );
  }
  const target = frame?.title.trim() || name.trim() || 'the board';
  const add = () => {
    const words = text.trim();
    if (!words) return;
    // Where the frame is now, as the doc has it: someone may have moved it since + was pressed. It's the frame the button
    // named that holds it, even where that frame now lies over another, unless it's full and the sticky goes under it.
    const into = frameNow(board.written, open.frame);
    const at = into ? freeIn(board.written, into) : board.middle(STICKY, STICKY);
    const held = into !== null && holds(into, { ...at, w: STICKY, h: STICKY });
    if (board.addFromSheet({ k: 'note', ...at, w: STICKY, h: STICKY, c: colour, size: 'm', t: words, ...(held ? { f: into.id } : {}) })) setOpen(null);
  };
  return (
    <>
      <button type="button" className="pc-shade" aria-label="Close" onClick={() => setOpen(null)} />
      <BoardPhoneSheet className={night ? 'dark' : theme} text={text} colour={colour} target={target} onText={setText} onColour={setColour} onAdd={add} />
    </>
  );
}
