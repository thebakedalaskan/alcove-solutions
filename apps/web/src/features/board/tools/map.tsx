/* The map: where you are on a board too big for the sheet. Only this draws as the camera moves, and only while it's open. */
import { bounds, hasBox } from '@alcove/board';
import { BoardMap } from '@alcove/ui';
import { useMemo, useSyncExternalStore } from 'react';
import { drawn } from '../selection';
import { useBoardState, type Board } from '../useBoard';

/** What a board with nothing on it maps. */
const BLANK = { x: 0, y: 0, w: 1000, h: 600 };
/** The most it marks: this draws as the camera moves, and a map doesn't need all 5000 of a board's objects to say where things are. */
const MOST = 300;

function OpenMap({ board }: { board: Board }) {
  useSyncExternalStore(board.camera.subscribe, board.camera.getSnapshot);
  const view = useBoardState(board, (s) => s.view);
  const box = useMemo(() => {
    const all = drawn(view);
    return all.length ? bounds(all) : BLANK;
  }, [view]);
  // Frames say where things are. A board without any shows what's on it instead.
  const blocks = useMemo(() => (view.frames.length ? view.frames : view.objects.filter(hasBox)).slice(0, MOST), [view]);
  return <BoardMap blocks={blocks} bounds={box} view={board.camera.visible()} />;
}

export function Minimap({ board }: { board: Board }) {
  const open = useBoardState(board, (s) => s.map);
  return open ? <OpenMap board={board} /> : null;
}
