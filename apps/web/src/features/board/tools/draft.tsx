/*
 * What's being drawn: a line following the pointer, or a stroke the pen hasn't finished. It's this person's alone until it's
 * let go, so it lives in their state rather than the doc, and only this draws as it moves.
 */
import type { InkColour, LineEnd } from '@alcove/board';
import { BoardLine, BoardStroke } from '@alcove/ui';
import { useBoardState, type Board } from '../useBoard';
import { draftRoute } from './line';

export type BoardDraft =
  | { kind: 'line'; from: LineEnd; to: [number, number] }
  | { kind: 'ink'; d: string; colour: InkColour; marker: boolean };

export function Draft({ board }: { board: Board }) {
  const draft = useBoardState(board, (s) => s.draft);
  const view = useBoardState(board, (s) => s.view);
  const style = useBoardState(board, (s) => s.line);
  if (!draft) return null;
  if (draft.kind === 'ink') return <BoardStroke d={draft.d} colour={draft.colour} marker={draft.marker} />;
  const route = draftRoute(view, draft.from, draft.to, style);
  return route && <BoardLine d={route.d} head={route.head} draft />;
}
