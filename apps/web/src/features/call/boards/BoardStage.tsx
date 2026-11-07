/*
 * The board on the call's stage: inside its frame (layout/frame.tsx), drawn small for its tile among the people while it's
 * presented and isn't on your stage, and your notes beside it in your side while you present it. Its code is loaded the first
 * time a board opens, so a call without one pays nothing for it. Someone it isn't open to sees "A board you can't open", and
 * nothing of its name.
 */
import { BoardNoAccess, Icon, useSettledPress, type IconName } from '@alcove/ui';
import { Suspense, lazy, useMemo, useState, type ReactNode } from 'react';
import type { BoardLanding } from '~/features/board/BoardSurface';
import type { BoardPager, BoardPresentation } from '~/features/board/CallBoard';
import type { BoardLinks } from '~/features/board/more/objects';
import type { CallPills, PillKind } from '~/features/board/pills';
import type { Standing } from '~/features/board/standing';
import type { BoardRun } from '~/features/board/tools/run';
import type { CallBoard } from './callBoard';

const load = () => import('~/features/board/CallBoard');
const Sheet = lazy(() => load().then((m) => ({ default: m.CallBoardSheet })));
const Mini = lazy(() => load().then((m) => ({ default: m.CallBoardMini })));
const Mine = lazy(() => load().then((m) => ({ default: m.CallBoardMine })));
/** Starts loading the board's code, as someone reaches for one, so it's there by the time it opens. */
export const loadBoard = (): void => { void load(); };

export interface BoardLeafProps {
  board: CallBoard;
  seal: Standing;
  /** Renames it, for whoever can, and how many times Rename in the frame's name menu has asked. */
  rename: ((name: string) => Promise<void>) | undefined;
  renameAsk: number;
  pills: CallPills;
  /** Which kind of pill shows on the board, as that changes. */
  onPill: (kind: PillKind | null) => void;
  /** The board's timer and vote, and what Timer and Vote do: `useBoardRun`. Not on a saved board just for you. */
  run: BoardRun | undefined;
  theme: 'light' | 'dark';
  /** On a phone: the board opens where it can be read, and adds a sticky through +. */
  phone: boolean;
  /** Opens something the board links to, for whoever can open it. */
  openLinked: ((item: string) => void) | undefined;
  /** The board's own link, which its bar's More copies. */
  link: string | undefined;
  /** Whoever brought a board someone can't open, while they're here, and asking them to let them in. */
  opener: string | null;
  onAsk: (() => void) | undefined;
  onSay: (text: string, icon: IconName) => void;
  /** Rooms' boards coming back to it, which land frame by frame. */
  landing: BoardLanding | null;
  /** It's being presented where you are. */
  present: BoardPresentation | null;
  /** Where whoever presents it is, for the pager at the frame's foot. */
  onPager: (pager: BoardPager | null) => void;
}

/** The board in its frame. */
export function BoardLeaf({ board, seal, rename, renameAsk, pills, onPill, run, theme, phone, openLinked, link, opener, onAsk, onSay, landing, present, onPager }: BoardLeafProps) {
  const { drawn: open, doc, itemFor } = board;
  const links = useMemo<BoardLinks>(() => ({ itemFor, open: openLinked }), [itemFor, openLinked]);
  if (!open) return null;
  if (open.role === null) return <BoardNoAccess who={opener} onAsk={onAsk} />;
  if (!doc) return null;
  const ours = !board.savedDrawn;
  return (
    <Suspense fallback={null}>
      <Sheet ref={board.handle} session={doc} name={open.name ?? ''} role={open.role} everyone={open.everyone} seal={seal} rename={rename} renameAsk={renameAsk} people={board.people} talking={board.talking}
        pictures={board.pictures} pills={pills} onPill={onPill} run={ours ? run : undefined} fresh={board.fresh} sinking={board.sinking} landing={ours ? landing : null} present={ours ? present : null} onPager={onPager} theme={theme} phone={phone}
        upload={board.upload} workspace={board.toLink} links={links} link={link} comments={board.comments} ideas={ours ? board.ideas : undefined} onSort={ours ? board.sort : undefined} onFollow={board.onFollow} onSay={onSay} />
    </Suspense>
  );
}

/** The board drawn small, for its presented tile, while its session is open here. */
export function BoardMini({ board, width, height, theme }: { board: CallBoard; width: number; height: number; theme: 'light' | 'dark' }) {
  const { doc, itemFor } = board;
  const links = useMemo<BoardLinks>(() => ({ itemFor }), [itemFor]);
  if (!doc || board.savedDrawn) return null;
  return <Suspense fallback={null}><Mini session={doc} width={width} height={height} pictures={board.pictures} links={links} theme={theme} /></Suspense>;
}

/** Your notes beside the board you present, in your side. */
export function BoardMine({ board, section, notes, onNote, theme }: {
  board: CallBoard; section: number; notes: Readonly<Record<string, string>> | null; onNote: (frame: string, text: string) => void; theme: 'light' | 'dark';
}) {
  const { doc, itemFor } = board;
  const links = useMemo<BoardLinks>(() => ({ itemFor }), [itemFor]);
  if (!doc) return null;
  return <Suspense fallback={null}><Mine session={doc} section={section} notes={notes} onNote={onNote} pictures={board.pictures} links={links} theme={theme} /></Suspense>;
}

/**
 * What the board's frame's name menu offers, each only where it's true: Rename, Open where it's saved, Who can add to it (the
 * board's own Share, in place of the rows), Copy link, Download as an image, and Night board for whoever can change the board.
 * The board's own More, on its bar, has the downloads and Night board too.
 */
export function BoardMenuRows({ rename, where, share, link, image, night, onDone }: {
  rename: (() => void) | undefined;
  /** Where it's kept, and opening that. */
  where: { name: string; onOpen: () => void } | null;
  share: ReactNode;
  link: (() => void) | undefined;
  /** Download as an image, of what your board shows you. */
  image: (() => void) | undefined;
  /** Night board, for whoever can change the board: whether it's on, and turning it on or off for everyone. */
  night: { on: boolean; onToggle: () => void } | undefined;
  onDone: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const press = useSettledPress(['rename', 'saved', 'share', 'link', 'image', 'night'].join('\n'));
  const pick = (f: () => void) => press(() => { onDone(); f(); });
  if (sharing && share) return <div className="ic-menu-sheet">{share}</div>;
  const row = (icon: IconName, label: string, onPick: () => void) => (
    <button type="button" className="mi" role="menuitem" onClick={onPick}><Icon name={icon} size={17} /><span className="t">{label}</span></button>
  );
  return (
    <>
      {rename && row('pen', 'Rename', pick(rename))}
      {where && row('folderOpen', 'Open where it’s saved', pick(where.onOpen))}
      {share && row('people', 'Who can add to it', press(() => setSharing(true)))}
      {link && row('link', 'Copy link', pick(link))}
      {image && row('download', 'Download as an image', pick(image))}
      {night && (
        <button type="button" className="mi" role="menuitemcheckbox" aria-checked={night.on} onClick={pick(night.onToggle)}>
          <Icon name="moon" size={17} /><span className="t">Night board</span><Icon name="check" size={16} className="tick" />
        </button>
      )}
      {!rename && !where && !share && !link && !image && !night && <p className="hint">There’s nothing to do with it until it opens for you.</p>}
    </>
  );
}
