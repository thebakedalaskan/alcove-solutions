/*
 * What the board kit's stories share: a piece of board drawn with the kit alone, as the design canvas's Tools sheet draws
 * one, at a camera that stays put, and pieces of the canvas's launch retro in the kit's own props. The kit only draws: it
 * holds no board and writes nothing, so a story gives each part what the surface would, placed the way the surface places it.
 */
import { route } from '@alcove/board';
import { BoardFrame, BoardLayout, BoardLine, BoardLines, BoardSheet, BoardSticky, BoardWorld, moveBoardCamera, useTheme, type BoardBox, type BoardCamera, type BoardColour, type BoardDot, type BoardLineStyle, type BoardSheetProps } from '@alcove/ui';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { selectionRing } from '~/features/board/selection';
import { dotsOn } from '~/features/board/tools/line';
import '../../../src/board.css';
import { did } from '../../../src/component';
import { FOLK, ROOMS } from '../../../src/world/boards';

/** A board at rest: no pan, no zoom. */
const AT_REST: BoardCamera = { x: 0, y: 0, z: 1 };

interface KitSheetProps {
  /** Its size, in screen pixels or as CSS. It's never wider than the window. */
  width?: number | string | undefined;
  height?: number | string | undefined;
  cam?: BoardCamera | undefined;
  /** The sheet's own: `clean`, `follow`, `night`, `mini`. */
  sheet?: BoardSheetProps | undefined;
  /** The tools, just off the sheet, as a call has them. */
  rail?: ReactNode;
  /** On the board's own page, with day round it. */
  page?: boolean | undefined;
  /** On a phone: the whole space between the faces and the dock, with no dots. */
  phone?: boolean | undefined;
  /** What the layout has after the sheet: a page's Start a call here. */
  after?: ReactNode;
  /** Pointers, in board units, over everything on the board. */
  pointers?: ReactNode;
  /** What sits over the sheet in screen pixels: the bar, a selection, a menu, a pill. */
  over?: ReactNode;
  /** What's on the board, in board units. */
  children?: ReactNode;
}

/** A piece of board: the kit's layout, sheet and world, with the camera put where `cam` says. The sheet takes the person's theme, as a call gives it. */
export function KitSheet({ width = 720, height = 420, cam = AT_REST, sheet, rail, page = false, phone = false, after, pointers, over, children }: KitSheetProps) {
  const s = useRef<HTMLDivElement>(null), w = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  useLayoutEffect(() => {
    if (s.current && w.current) moveBoardCamera(s.current, w.current, cam);
  }, [cam]);
  return (
    <div className="sbb-sheet" style={{ '--sbb-w': typeof width === 'number' ? `${width}px` : width, '--sbb-h': typeof height === 'number' ? `${height}px` : height }}>
      <BoardLayout page={page} phone={phone}>
        {rail}
        <BoardSheet ref={s} tabIndex={-1} theme={resolved} page={page || phone} clean={phone} {...sheet}>
          <BoardWorld ref={w} pointers={pointers}>{children}</BoardWorld>
          {over}
        </BoardSheet>
        {after}
      </BoardLayout>
    </div>
  );
}

/** A sticky's side, and the gap the canvas keeps between them and round a frame's edge. */
const S = 150, G = 20;
/** Where the canvas puts the `i`th sticky of a frame at `fx`, `fy`: two to a row. */
export const slot = (fx: number, fy: number, i: number): BoardBox => ({ x: fx + G + (i % 2) * (S + G), y: fy + G + Math.floor(i / 2) * (S + G), w: S, h: S });

/** Where the surface puts the ring round something picked, the dots a line starts from, and the bar above it, for a box on the board at `cam`. */
export function pickedAt(box: BoardBox, cam: BoardCamera): { ring: BoardBox; dots: BoardDot[]; bar: { x: number; y: number } } {
  const ring = selectionRing([box], cam);
  return { ring, dots: dotsOn(box, cam), bar: { x: ring.x + ring.w / 2, y: Math.max(66, ring.y - 52) } };
}

/** Priya's sticky, which the line leaves from, and the action it arrives at. */
export const F1 = slot(0, 0, 1), A1 = slot(400, 0, 0);

/** Could improve's five stickies and two of the actions, from the launch retro, each in the slot the canvas puts it in. */
const RETRO: readonly { id: string; box: BoardBox; colour: BoardColour; text: string }[] = [
  { id: 'f3', box: slot(0, 0, 0), colour: 'rose', text: 'Nobody owned the status page' },
  { id: 'f1', box: F1, colour: 'rose', text: 'Changelog went out after the launch post' },
  { id: 'f5', box: slot(0, 0, 2), colour: 'rose', text: 'QA found the billing bug on launch day' },
  { id: 'f2', box: slot(0, 0, 3), colour: 'rose', text: 'Staging data was two days stale' },
  { id: 'f4', box: slot(0, 0, 5), colour: 'rose', text: 'One checklist lived in three tools' },
  { id: 'a1', box: A1, colour: 'sky', text: 'One owner for launch comms' },
  { id: 'a2', box: slot(400, 0, 2), colour: 'sky', text: 'Refresh staging every night' }
];

/**
 * Could improve and Actions side by side, with the line from Priya's sticky to the action that fixes it, as the board package
 * routes it: a piece of the retro for the rest of the kit to stand on. `picked` is the sticky that's selected, in `colour` if
 * that's given; `line` is how the line runs, and `lineSelected` picks it.
 */
export function RetroPiece({ picked, colour, line = 'elbow', lineSelected = false, hide = [], children }: {
  picked?: string | undefined; colour?: BoardColour | undefined; line?: BoardLineStyle | undefined; lineSelected?: boolean | undefined;
  /** Stickies left off, as one being dragged elsewhere is. */
  hide?: readonly string[] | undefined;
  children?: ReactNode;
}) {
  const drawn = route(F1, A1, line);
  return (
    <>
      <BoardFrame id="fix" x={0} y={0} w={360} h={530} title="Could improve" sub="5" />
      <BoardFrame id="act" x={400} y={0} w={360} h={530} title="Actions" sub="2" />
      <BoardLines><BoardLine id="l1" d={drawn.d} head={drawn.head || undefined} selected={lineSelected} /></BoardLines>
      {RETRO.filter((n) => !hide.includes(n.id)).map((n) => <BoardSticky key={n.id} id={n.id} {...n.box} colour={n.id === picked && colour ? colour : n.colour} text={n.text} selected={n.id === picked} />)}
      {children}
    </>
  );
}

const ROOM_COLOURS: readonly BoardColour[] = ['rose', 'peach', 'sky'];
/**
 * The Support room's board, as it came back to the main one: what happened, why, and what next, a row each. `hide` leaves
 * stickies off by their place, 0 to 5; `land` brings the frame in as rooms close.
 */
export function SupportRoom({ hide = [], land = false }: { hide?: readonly number[] | undefined; land?: boolean | undefined }) {
  const support = ROOMS.find((r) => r.name === 'Support');
  if (!support) return null;
  return (
    <>
      <BoardFrame id="support" x={0} y={0} w={360} h={530} title="Support" sub={support.who.map((w) => FOLK[w].name).join(', ')} land={land} />
      {support.rows.flatMap(([first, second], k) => [first, second].map((text, i) => {
        const at = k * 2 + i;
        return hide.includes(at) ? null : <BoardSticky key={text} id={`support${at}`} {...slot(0, 0, at)} colour={ROOM_COLOURS[k] ?? 'butter'} text={text} />;
      }))}
    </>
  );
}

/** The bar's buttons, each saying it was pressed in the Actions panel. */
export const BAR = {
  onName: did('onName'), onSeal: did('onSeal'), onUndo: did('onUndo'), onRedo: did('onRedo'), onZoomOut: did('onZoomOut'), onFit: did('onFit'),
  onZoomIn: did('onZoomIn'), onMap: did('onMap'), onTimer: did('onTimer'), onVote: did('onVote'), onPresent: did('onPresent'), onMore: did('onMore')
};
