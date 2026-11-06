/*
 * The board on the call's stage: where the panels put it (PanelHost's `board`), as a live tile among the faces for someone
 * who hid it, and as a smaller one above them beside a share shown big. Its code is loaded the first time a board opens, so
 * a call without one pays nothing for it. Someone it isn't open to sees "A board you can't open", and nothing of its name.
 */
import type { CallPanelBranch, CallPanelNode } from '@alcove/api';
import type { AvatarPerson, IconName } from '@alcove/ui';
import { BoardNoAccess } from '@alcove/ui';
import { Suspense, lazy, useMemo } from 'react';
import type { BoardLanding } from '~/features/board/BoardSurface';
import type { BoardNameMenu, BoardPresentation } from '~/features/board/CallBoard';
import type { BoardLinks } from '~/features/board/more/objects';
import type { CallPills, PillKind } from '~/features/board/pills';
import type { Standing } from '~/features/board/standing';
import type { BoardRun } from '~/features/board/tools/run';
import type { CallBoard } from './callBoard';
import { isBranch } from './panels';

const load = () => import('~/features/board/CallBoard');
const Sheet = lazy(() => load().then((m) => ({ default: m.CallBoardSheet })));
const Tile = lazy(() => load().then((m) => ({ default: m.CallBoardTile })));
/** Starts loading the board's code, as someone reaches for one, so it's there by the time it opens. */
export const loadBoard = (): void => { void load(); };

const holdsPeople = (n: CallPanelNode): boolean => (isBranch(n) ? n.kids.some(holdsPeople) : n.id === 'people');
/**
 * Whether the board stands over the faces in their column, as it does once a share beside it has been made the big thing: there
 * it's a live tile, until it's brought back. Anywhere else among your panels it's the board.
 */
export function boardOverPeople(tree: CallPanelNode): boolean {
  const walk = (n: CallPanelNode, cols: CallPanelBranch[]): boolean => {
    if (!isBranch(n)) return n.id === 'board' && cols.some(holdsPeople);
    const above = n.dir === 'col' ? [...cols, n] : cols;
    return n.kids.some((k) => walk(k, above));
  };
  return walk(tree, []);
}

export interface BoardLeafProps {
  board: CallBoard;
  /** Where it is: beside a share shown big, the board is a tile above the faces until it's brought back. */
  compact: boolean;
  width: number;
  height: number;
  seal: Standing;
  menu: BoardNameMenu;
  pills: CallPills;
  /** Which kind of pill shows on the board, as that changes. */
  onPill: (kind: PillKind | null) => void;
  /** The board's timer and vote, and what Timer and Vote do: `useBoardRun`. */
  run: BoardRun | undefined;
  theme: 'light' | 'dark';
  /** On a phone: the board opens where it can be read, and adds a sticky through +. */
  phone: boolean;
  /** Opens something the board links to, for whoever can open it. */
  openLinked: ((item: string) => void) | undefined;
  /** The board's own link, which its bar's More copies. */
  link: string | undefined;
  /** Whose board the tile says it is, and that person in the arch. */
  owner: { person: AvatarPerson; name: string };
  /** Whoever brought a board someone can't open, while they're here, and asking them to let them in. */
  opener: string | null;
  onAsk: (() => void) | undefined;
  /** Brings it back from being a tile. */
  onBack: () => void;
  onSay: (text: string, icon: IconName) => void;
  /** Rooms' boards coming back to it, which land frame by frame. */
  landing: BoardLanding | null;
  /** It's being presented where you are. */
  present: BoardPresentation | null;
  /** Presents it to everyone where you are. */
  onPresent: (() => void) | undefined;
}

/** The board in the place the panels give it. */
export function BoardLeaf({ board, compact, width, height, seal, menu, pills, onPill, run, theme, phone, openLinked, link, owner, opener, onAsk, onBack, onSay, landing, present, onPresent }: BoardLeafProps) {
  const { drawn: open, doc, itemFor } = board;
  const links = useMemo<BoardLinks>(() => ({ itemFor, open: openLinked }), [itemFor, openLinked]);
  if (!open) return null;
  if (open.role === null) return <BoardNoAccess who={opener} onAsk={onAsk} />;
  if (!doc) return null;
  // The board stays as it is behind its tile, so going back to it finds it where you left it.
  return (
    <Suspense fallback={null}>
      <Sheet key="sheet" ref={board.handle} session={doc} name={open.name ?? ''} role={open.role} everyone={open.everyone} seal={seal} menu={menu} people={board.people} talking={board.talking} pictures={board.pictures}
        pills={pills} onPill={onPill} run={run} fresh={board.fresh && !compact} sinking={board.sinking} landing={landing} present={present} onPresent={onPresent} hidden={compact} theme={theme} phone={phone}
        upload={board.upload} workspace={board.toLink} links={links} link={link} comments={board.comments} ideas={board.ideas} onSort={board.sort} onFollow={board.onFollow} onSay={onSay} />
      {compact && <Tile key="tile" session={doc} person={owner.person} name={owner.name} label="Go back to the board" width={width} height={height} compact pictures={board.pictures} links={links} theme={theme} onOpen={onBack} />}
    </Suspense>
  );
}

/** The board as a live tile among the faces, for someone who hid it: pressing it brings it back. */
export function BoardTileOnStage({ board, width, height, theme, owner, onOpen }: { board: CallBoard; width: number; height: number; theme: 'light' | 'dark'; owner: { person: AvatarPerson; name: string }; onOpen: () => void }) {
  const { doc, itemFor } = board;
  const links = useMemo<BoardLinks>(() => ({ itemFor }), [itemFor]);
  if (!doc) return null;
  return (
    <Suspense fallback={null}>
      <Tile session={doc} person={owner.person} name={owner.name} label="Open the board" width={width} height={height} compact={false} pictures={board.pictures} links={links} theme={theme} onOpen={onOpen} />
    </Suspense>
  );
}
