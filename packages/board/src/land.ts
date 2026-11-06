/*
 * What happens to the rooms' boards when rooms close: each one lands on the main board as a frame, side by side,
 * named for the room with who was there. Stickies flow in reading order into a two-column grid, as the canvas shows,
 * and anything else follows below them, keeping its layout. It's a copy for looking at together: a room's own board
 * stays whole. A shot stays behind with it, because what's shared in a room stays in the room.
 */
import type * as Y from 'yjs';
import { bounds, byFrame } from './geometry';
import { readBoard } from './read';
import { BOARD_LIMITS, hasBox, isAttached, newId, type BoardView, type Box, type LineEnd, type NoteObject, type PlacedObject } from './shape';
import { BESIDE, clearSpot, insert, stack, viewOf, writing } from './write';

const STICKY = 150, GAP = 20, FRAME_W = 360, FRAME_H = 530;

/** A room's stickies in reading order: frame by frame, as the room worked through them, then the loose ones. */
function stickiesOf(board: BoardView): NoteObject[] {
  const held = byFrame(board.objects.filter((o) => o.k === 'note'));
  return [...board.frames.flatMap((f) => held.get(f.id) ?? []), ...(held.get('') ?? [])];
}

/** Everything else that comes back: not frames, whose stickies flow into the room's one frame, and not shots. */
function othersOf(board: BoardView): PlacedObject[] {
  return board.objects.filter(hasBox).filter((o) => o.k !== 'note' && o.k !== 'frame' && o.k !== 'shot');
}

/**
 * Lands each room's board on the main board, in one transaction, after whatever's already there. A board at
 * `BOARD_LIMITS.objects` takes what fits: the room's own board still has the rest.
 */
export function landBoards(main: Y.Doc, rooms: readonly { name: string; who: readonly string[]; doc: Y.Doc }[], origin: unknown): void {
  writing(main, origin, undefined, (into) => {
    const view = viewOf(main);
    const at = stack(view);
    let room = BOARD_LIMITS.objects - into.objects.size;
    let { x, y } = clearSpot(view);

    for (const { name, who, doc } of rooms) {
      if (room <= 0) return;
      const board = readBoard(doc);
      const stickies = stickiesOf(board), others = othersOf(board);
      const lines = board.objects.flatMap((o) => (o.k === 'line' ? [o] : []));
      const copies = new Map([...stickies, ...others].map((o) => [o.id, newId()]));
      const kept = lines.filter((line) => [line.from, line.to].every((end) => !isAttached(end) || copies.has(end.on)));

      const rowsTall = Math.ceil(stickies.length / 2) * (STICKY + GAP);
      const free = kept.flatMap((line) => [line.from, line.to]).flatMap((end): Box[] => (isAttached(end) ? [] : [{ ...end, w: 0, h: 0 }]));
      const block = bounds([...others, ...free]);
      const dx = x + GAP - block.x, dy = y + rowsTall + GAP - block.y;
      const hasBlock = others.length + free.length > 0;

      const w = Math.min(BOARD_LIMITS.maxSide, Math.max(FRAME_W, hasBlock ? block.w + 2 * GAP : 0));
      const h = Math.min(BOARD_LIMITS.maxSide, Math.max(FRAME_H, rowsTall + GAP + (hasBlock ? block.h + GAP : 0)));
      const frame = insert(into, { k: 'frame', x, y, w, h, title: name, hint: '', sub: who.join(', '), sorted: false, c: '', role: '', id: newId(), at: at('frame'), f: '' });
      if (!frame) continue;
      room -= 1;

      stickies.forEach((o, i) => {
        if (room <= 0) return;
        room -= 1;
        insert(into, { ...o, id: copies.get(o.id), at: at('note'), f: frame.id, w: STICKY, h: STICKY, x: x + GAP + (i % 2) * (STICKY + GAP), y: y + GAP + Math.floor(i / 2) * (STICKY + GAP) });
      });
      for (const o of others) {
        if (room <= 0) break;
        room -= 1;
        const parent = o.k === 'node' ? { parent: copies.get(o.parent) ?? '' } : {};
        insert(into, { ...o, ...parent, id: copies.get(o.id), at: at(o.k), f: frame.id, x: o.x + dx, y: o.y + dy });
      }
      const landed = (end: LineEnd): LineEnd => (isAttached(end) ? { ...end, on: copies.get(end.on) ?? end.on } : { x: end.x + dx, y: end.y + dy });
      for (const line of kept) {
        if (room <= 0) break;
        room -= 1;
        insert(into, { ...line, from: landed(line.from), to: landed(line.to), id: newId(), at: at('line'), f: frame.id });
      }
      x += w + BESIDE;
    }
  });
}
