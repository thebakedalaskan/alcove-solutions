/*
 * The selection bar: a small bar that only appears on what's picked, and never while it's being dragged or typed in. What it
 * offers depends on what's picked, and nothing is offered that can't be done to it.
 */
import { isAttached, setObjects, type BoardObject, type BoardTheme, type BoardView, type Camera } from '@alcove/board';
import { BoardSelectionBar } from '@alcove/ui';
import { endBox, placed, selectionRing } from '../selection';
import { useBoardState, type Board } from '../useBoard';
import { lineFromHere } from './line';
import { colourOf, colourSelected, hasSizes, sizeSelected, stackSelected, stacks, tidySelected } from './selected';

/** Keeps the bar clear of the board's own bar. */
const TOP = 66;
/** How far above what's picked the bar sits. */
const ABOVE = 52;
/** What a frame's title takes up above it, in board units. A frame is picked by its title, so the bar keeps off it: the second press of a double-click has to land there. */
const TITLE_ROOM = 36;
/** How far inside a frame the bar sits when there's no room above its title. */
const INSIDE = 10;

/** Where the bar goes, in screen pixels: over the middle of what's picked, and a line has its middle between its ends. */
function barSpot(view: BoardView, picked: readonly BoardObject[], cam: Camera): { x: number; y: number } | null {
  const boxes = placed(view, picked.map((o) => o.id));
  if (boxes.length) {
    const ring = selectionRing(boxes, cam);
    const x = ring.x + ring.w / 2, y = ring.y - ABOVE;
    if (!boxes.some((o) => o.k === 'frame')) return { x, y: Math.max(TOP, y) };
    const clear = y - TITLE_ROOM * cam.z;
    return { x, y: clear >= TOP ? clear : Math.max(TOP, ring.y + INSIDE) };
  }
  const line = picked[0];
  const a = line?.k === 'line' ? endBox(view, line.from) : null, b = line?.k === 'line' ? endBox(view, line.to) : null;
  if (!a || !b) return null;
  const x = (a.x + a.w / 2 + b.x + b.w / 2) / 2, y = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
  return { x: x * cam.z + cam.x, y: Math.max(TOP, y * cam.z + cam.y - ABOVE) };
}

export function SelectedBar({ board, cam, onSort }: { board: Board; cam: Camera; onSort?: ((stickies: readonly string[]) => Promise<readonly BoardTheme[]>) | undefined }) {
  const view = useBoardState(board, (s) => s.view);
  const sorting = useBoardState(board, (s) => s.sorting);
  const sel = useBoardState(board, (s) => s.sel);
  const edit = useBoardState(board, (s) => s.edit);
  const pressing = useBoardState(board, (s) => s.pressing);
  const picking = useBoardState(board, (s) => s.picking);
  const menu = useBoardState(board, (s) => s.menu);
  const picked = sel.flatMap((id) => view.byId.get(id) ?? []);
  const spot = barSpot(view, picked, cam);
  if (!spot || edit || pressing) return null;

  const [first] = picked;
  const solo = picked.length === 1 ? first : undefined;
  const line = solo?.k === 'line' ? solo : undefined;
  const colours = picked.flatMap((o) => colourOf(o) ?? []);
  const stickies = picked.flatMap((o) => (o.k === 'note' ? [o.id] : []));
  const copyable = picked.some((o) => o.k !== 'line' || !isAttached(o.from) || !isAttached(o.to));
  const arrangeable = picked.filter((o) => o.k !== 'line' && o.k !== 'frame');
  // Most of what's pressed here takes the bar away, and the keys have to go on working.
  const act = (run: () => void) => (): void => {
    board.set({ picking: false, menu: false });
    run();
    board.focusSheet();
  };
  return (
    <BoardSelectionBar x={spot.x} y={spot.y} room={board.camera.width} count={picked.length} things={stickies.length === picked.length ? 'stickies' : 'selected'}
      colour={colours[0] ?? null} textSize={solo !== undefined && hasSizes(solo)} picking={picking} lineStyle={line?.style}
      onColour={() => board.set({ picking: !picking, menu: false })} onPick={(c) => { colourSelected(board, c); board.focusSheet(); }}
      onTextSize={act(() => sizeSelected(board))}
      onLineStyle={(style) => { if (line) board.write(() => setObjects(board.doc, [line.id], { style }, board.origin)); }}
      onLine={solo && !line && solo.k !== 'ink' ? act(() => lineFromHere(board, solo.id)) : undefined}
      onDuplicate={copyable ? act(() => board.duplicateSelected()) : undefined} onDelete={act(() => board.removeSelected())}
      onMore={picked.some(stacks) ? () => board.set({ menu: !menu, picking: false }) : undefined}
      moreItems={menu ? [
        { icon: 'bringToFront', label: 'Bring to front', onPick: act(() => stackSelected(board, 'front')) },
        { icon: 'sendToBack', label: 'Send to back', onPick: act(() => stackSelected(board, 'back')) }
      ] : undefined}
      onSort={onSort && stickies.length > 1 ? act(() => { void board.sortIntoThemes(stickies, onSort); }) : undefined} sorting={sorting}
      onTidy={arrangeable.length > 1 ? act(() => tidySelected(board)) : undefined} />
  );
}
