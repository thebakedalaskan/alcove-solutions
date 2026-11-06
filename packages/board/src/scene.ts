/*
 * What a download of a board shows: what its reader's own board shows them, and nothing more. It's made from their view of
 * the board, which they could only read because they can open it, and each workspace item linked from it goes by their own
 * name for it, from what they can open, so a download never names something they can't. Comments aren't on the board, and
 * aren't in it. Pictures are read the same way as on the board, through the reader's own access.
 */
import { bounds } from './geometry';
import { cellKey, hasBox, type BoardView, type Box } from './shape';

/** What a linked item says to someone who can't open it: the same on the board and in a download. */
export const CANT_OPEN = 'A document you can’t open';
/** How much room a download leaves round what's on the board, in board units. */
const MARGIN = 48;

export interface BoardScene {
  /** What it covers, in board units: everything on the board, with room round it. */
  box: Box;
  view: BoardView;
  /** What each linked item is called for this reader, or null where they can't open it. */
  names: ReadonlyMap<string, string | null>;
}

/** A download of `view` for whoever reads it, naming linked items as `nameOf` does for them. */
export function boardScene(view: BoardView, nameOf: (item: string) => string | null): BoardScene {
  const placed = view.objects.filter(hasBox);
  const b = placed.length ? bounds(placed) : { x: 0, y: 0, w: 1160, h: 530 };
  const names = new Map<string, string | null>();
  for (const o of view.objects) if (o.k === 'link' && !names.has(o.item)) names.set(o.item, nameOf(o.item));
  return { box: { x: b.x - MARGIN, y: b.y - MARGIN, w: b.w + MARGIN * 2, h: b.h + MARGIN * 2 }, view, names };
}

/** Every word a download of the scene says, in the order it's drawn. */
export function sceneWords({ view, names }: BoardScene): string[] {
  return view.objects.flatMap((o): string[] => {
    switch (o.k) {
      case 'note': case 'text': case 'shape': case 'node': return [o.t];
      case 'frame': return [o.title, o.sub];
      case 'shot': return [o.caption];
      case 'table': return o.rows.flatMap((row) => o.cols.map((col) => o.cells[cellKey(row.id, col.id)] ?? ''));
      case 'link': return [names.get(o.item) ?? CANT_OPEN];
      default: return [];
    }
  }).map((w) => w.trim()).filter(Boolean);
}
