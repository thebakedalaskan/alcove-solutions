/*
 * What happens to the rooms' boards when rooms close: each one lands on the main board as a frame, side by side,
 * named for the room with who was there. Stickies flow in reading order into a two-column grid, as the canvas shows,
 * and anything else follows below them, keeping its layout. It's a copy for looking at together: a room's own board
 * stays whole. Pictures stay behind with it, images and shots alike: what's shared in a room stays in the room, and a
 * picture is its board's own file, which nobody reaches through another board.
 *
 * Everything landed has an id made from the room it came from and what it copies, so landing again finds the frame there
 * and changes nothing, however often the server is asked, and every browser in the call knows which frames are rooms' as
 * they land. Rooms sharing one board get an empty frame each the same way.
 */
import type * as Y from 'yjs';
import { bounds, byFrame } from './geometry';
import { readBoard } from './read';
import { BOARD_LIMITS, hasBox, idFrom, isAttached, type BoardView, type Box, type LineEnd, type NoteObject, type PlacedObject } from './shape';
import { BESIDE, clearSpot, insert, stack, viewOf, writing } from './write';

const STICKY = 150, GAP = 20, FRAME_W = 360, FRAME_H = 530;

/** The frame a room's board lands as, by the room's id (`key`): the same every time. */
export const landedFrameId = (key: string): string => idFrom('landed', key);
/** A room's frame on the one board every room shares, by the room's id: the same every time. */
export const roomFrameId = (roomId: string): string => idFrom('room', roomId);

/** A room's stickies in reading order: frame by frame, as the room worked through them, then the loose ones. */
function stickiesOf(board: BoardView): NoteObject[] {
  const held = byFrame(board.objects.filter((o) => o.k === 'note'));
  return [...board.frames.flatMap((f) => held.get(f.id) ?? []), ...(held.get('') ?? [])];
}

/** Everything else that comes back: not frames, whose stickies flow into the room's one frame, and no pictures. */
function othersOf(board: BoardView): PlacedObject[] {
  return board.objects.filter(hasBox).filter((o) => o.k !== 'note' && o.k !== 'frame' && o.k !== 'shot' && o.k !== 'image');
}

/** A room's board as it lands: `key` is the room it's from (its id), and `who` the names of whoever was there. */
export interface LandingRoom { key: string; name: string; who: readonly string[]; doc: Y.Doc }

/**
 * Lands each room's board on the main board, in one transaction, after whatever's already there. A board at
 * `BOARD_LIMITS.objects` takes what fits: the room's own board still has the rest. A room whose frame is there already
 * landed before, and is left as it is. How many frames it landed.
 */
export function landBoards(main: Y.Doc, rooms: readonly LandingRoom[], origin: unknown): number {
  return writing(main, origin, 0, (into) => {
    const view = viewOf(main);
    const at = stack(view);
    let room = BOARD_LIMITS.objects - into.objects.size;
    let { x, y } = clearSpot(view);
    let landed = 0;

    for (const { key, name, who, doc } of rooms) {
      if (room <= 0) break;
      const frameId = landedFrameId(key);
      if (into.objects.has(frameId)) continue;
      const board = readBoard(doc);
      const stickies = stickiesOf(board), others = othersOf(board);
      const lines = board.objects.flatMap((o) => (o.k === 'line' ? [o] : []));
      const copies = new Map([...stickies, ...others].map((o) => [o.id, idFrom('landed', key, o.id)]));
      const kept = lines.filter((line) => [line.from, line.to].every((end) => !isAttached(end) || copies.has(end.on)));

      const rowsTall = Math.ceil(stickies.length / 2) * (STICKY + GAP);
      const free = kept.flatMap((line) => [line.from, line.to]).flatMap((end): Box[] => (isAttached(end) ? [] : [{ ...end, w: 0, h: 0 }]));
      const block = bounds([...others, ...free]);
      const dx = x + GAP - block.x, dy = y + rowsTall + GAP - block.y;
      const hasBlock = others.length + free.length > 0;

      const w = Math.min(BOARD_LIMITS.maxSide, Math.max(FRAME_W, hasBlock ? block.w + 2 * GAP : 0));
      const h = Math.min(BOARD_LIMITS.maxSide, Math.max(FRAME_H, rowsTall + GAP + (hasBlock ? block.h + GAP : 0)));
      const frame = insert(into, { k: 'frame', x, y, w, h, title: name, hint: '', sub: who.join(', '), sorted: false, c: '', role: '', id: frameId, at: at('frame'), f: '' });
      if (!frame) continue;
      room -= 1;
      landed += 1;

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
      const moved = (end: LineEnd): LineEnd => (isAttached(end) ? { ...end, on: copies.get(end.on) ?? end.on } : { x: end.x + dx, y: end.y + dy });
      for (const line of kept) {
        if (room <= 0) break;
        room -= 1;
        insert(into, { ...line, from: moved(line.from), to: moved(line.to), id: idFrom('landed', key, line.id), at: at('line'), f: frame.id });
      }
      x += w + BESIDE;
    }
    return landed;
  });
}

/**
 * The one board every room shares gets an empty frame for each room, side by side after whatever's there, named for the
 * room with who's going to it. A room whose frame is there already has it. How many frames it put there.
 */
export function roomFrames(main: Y.Doc, rooms: readonly { id: string; name: string; who: readonly string[] }[], origin: unknown): number {
  return writing(main, origin, 0, (into) => {
    const view = viewOf(main);
    const at = stack(view);
    let { x, y } = clearSpot(view);
    let made = 0;
    for (const r of rooms) {
      const id = roomFrameId(r.id);
      if (into.objects.has(id) || into.objects.size >= BOARD_LIMITS.objects) continue;
      if (!insert(into, { k: 'frame', x, y, w: FRAME_W, h: FRAME_H, title: r.name, hint: '', sub: r.who.join(', '), sorted: false, c: '', role: '', id, at: at('frame'), f: '' })) continue;
      made += 1;
      x += FRAME_W + BESIDE;
    }
    return made;
  });
}
