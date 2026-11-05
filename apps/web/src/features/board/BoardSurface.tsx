/*
 * The board: what a person sees and presses, drawn from a plain Y.Doc with the kit in `@alcove/ui`. It knows nothing about
 * where the doc comes from, so the call, a board's page and a tile all use it. `mode` says what it's for.
 *
 * What's drawn is split by how often it changes. `Objects` draws when the board does, and a change to one object draws that
 * object alone, because `readBoard` keeps the identity of the rest and the kit's objects are memoised. The camera doesn't
 * reach it at all: it moves one transform, and only `OverSheet`, which sits in screen pixels, follows it.
 */
import { freeRoute, isAttached, route, shapePath, type BoardView, type InkObject, type LineObject, type PlacedObject, type Route } from '@alcove/board';
import {
  BoardBar, BoardEmpty, BoardFrame, BoardGuide, BoardLayout, BoardLine, BoardLines, BoardMarquee, BoardPageActions, BoardPicture, BoardRail, BoardSelectionBox, BoardShape, BoardSheet, BoardSticky, BoardStroke,
  BoardText, BoardWorld, DURATION, useToast, type AvatarPerson, type IconName
} from '@alcove/ui';
import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { BoardPlace } from './camera';
import { BoardTyping } from './editing';
import { watchSheet } from './gestures';
import { endBox, mounted, placed, selectionRing } from './selection';
import { BOARD_LOOKS, useBoard, useBoardState, type Board, type BoardMode } from './useBoard';

/** Someone in the call or on the page. */
export interface BoardPerson {
  /** Their call identity: what `follow` and `talking` name them by. */
  id: string;
  person: AvatarPerson;
  name: string;
  /** The colour of their pointer and of the ring round a view that's theirs. */
  colour: string;
}

/** What the world around a board can ask of it. */
export interface BoardHandle {
  /** Shows everything on the board. */
  fit(): void;
  /** Goes to where someone is looking: the board point in the middle of their sheet, and their zoom. */
  goTo(view: BoardPlace): void;
  /** Follows someone by their call identity, or stops. */
  follow(id: string | null): void;
  /** Fills the sheet with a frame. */
  focusFrame(id: string): void;
}

/** What's outside the board. Each is optional, and whatever isn't given does nothing. */
export interface BoardHandlers {
  onName?: (() => void) | undefined;
  onSeal?: (() => void) | undefined;
  onTimer?: (() => void) | undefined;
  onVote?: (() => void) | undefined;
  onPresent?: (() => void) | undefined;
  onMore?: (() => void) | undefined;
  /** Start a call here, on a board's page. */
  onCall?: (() => void) | undefined;
  /** Following stopped from this side: a scroll, a zoom or Esc. */
  onFollow?: ((id: string | null) => void) | undefined;
}

export interface BoardSurfaceProps extends BoardHandlers {
  doc: Y.Doc;
  awareness: Awareness;
  mode: BoardMode;
  /** The board's name, in the bar. */
  name?: string | undefined;
  /** What the seal says: Sealed, Sealed to this room, View only. */
  seal?: string | undefined;
  sealIcon?: IconName | undefined;
  /** Timer, Vote, Present and More in the bar. On by default in a call and nowhere else. */
  acts?: boolean | undefined;
  people?: readonly BoardPerson[] | undefined;
  /** The call identities of whoever is talking. */
  talking?: ReadonlySet<string> | undefined;
  /** Rises through the arch: a board that has just opened. */
  fresh?: boolean | undefined;
  /** Night board: the sheet goes dark, whatever the page's theme is. */
  night?: boolean | undefined;
  className?: string | undefined;
}

const NO_PEOPLE: readonly BoardPerson[] = [];

/** A line's route. Its first end leads, as a line being drawn does. */
function lineRoute(view: BoardView, o: LineObject): Route | null {
  const a = endBox(view, o.from), b = endBox(view, o.to);
  if (!a || !b) return null;
  return isAttached(o.from) && !isAttached(o.to) ? freeRoute(a, [o.to.x, o.to.y], o.style) : route(a, b, o.style);
}

const strokes = new WeakMap<InkObject, string>();

/** A stroke as a path, smoothed through the midpoints between its points. Worked out once for each version of the stroke, which can hold 2000 points. */
function strokePath(o: InkObject): string {
  const known = strokes.get(o);
  if (known !== undefined) return known;
  const at = (i: number): number => (i % 2 ? o.y : o.x) + (o.pts[i] ?? 0);
  let d = `M${at(0)} ${at(1)}`;
  for (let i = 2; i < o.pts.length - 2; i += 2) d += `Q${at(i)} ${at(i + 1)} ${(at(i) + at(i + 2)) / 2} ${(at(i + 1) + at(i + 3)) / 2}`;
  strokes.set(o, d);
  return d;
}

/** How many objects each frame holds, for the number beside its title and to know when it's empty. */
function heldCounts(view: BoardView): Map<string, number> {
  const held = new Map<string, number>();
  for (const o of view.objects) if (o.f && o.k !== 'frame' && o.k !== 'line') held.set(o.f, (held.get(o.f) ?? 0) + 1);
  return held;
}

function drawObject(o: PlacedObject, board: Board, selected: boolean, pop: boolean, glide: boolean, editing: boolean): ReactNode {
  const base = { id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, selected, pop, glide };
  const typing = (label: string): ReactNode => (editing ? <BoardTyping board={board} id={o.id} label={label} /> : undefined);
  switch (o.k) {
    case 'note': return <BoardSticky key={o.id} {...base} colour={o.c} size={o.size} text={o.t} editor={typing('Edit this sticky')} />;
    case 'text': return <BoardText key={o.id} {...base} size={o.size} text={o.t} editor={typing('Edit this text')} />;
    case 'shape': return <BoardShape key={o.id} {...base} path={shapePath(o.s, o.w, o.h)} colour={o.c || undefined} text={o.t} editor={typing('Edit this shape')} />;
    case 'image': return <BoardPicture key={o.id} {...base} />;
    case 'shot': return <BoardPicture key={o.id} {...base} shot caption={o.caption} />;
    default: return null;
  }
}

/** Everything on the board, in the order it stacks: frames, then lines and ink in one drawing, then objects. */
const Objects = memo(function Objects({ board }: { board: Board }) {
  const view = useBoardState(board, (s) => s.view);
  const near = useBoardState(board, (s) => s.near);
  const sel = useBoardState(board, (s) => s.sel);
  const edit = useBoardState(board, (s) => s.edit);
  const landed = useBoardState(board, (s) => s.landed);
  const settling = useBoardState(board, (s) => s.settling);
  const picked = useMemo(() => new Set(sel), [sel]);
  const shown = useMemo(() => mounted(view, near, edit), [view, near, edit]);
  const held = useMemo(() => heldCounts(view), [view]);

  const frames: ReactNode[] = [], lines: ReactNode[] = [], objects: ReactNode[] = [];
  for (const o of shown) {
    if (o.k === 'frame') {
      const count = held.get(o.id) ?? 0;
      frames.push(<BoardFrame key={o.id} id={o.id} x={o.x} y={o.y} w={o.w} h={o.h} title={o.title} sub={o.sub || (count ? String(count) : undefined)} hint={count ? undefined : o.hint} />);
    } else if (o.k === 'line') {
      const r = lineRoute(view, o);
      if (r) lines.push(<BoardLine key={o.id} d={r.d} head={r.head} selected={picked.has(o.id)} />);
    } else if (o.k === 'ink') {
      lines.push(<BoardStroke key={o.id} d={strokePath(o)} colour={o.c} marker={o.tool === 'marker'} selected={picked.has(o.id)} />);
    } else {
      objects.push(drawObject(o, board, picked.has(o.id), landed.has(o.id), settling.has(o.id), edit === o.id));
    }
  }
  return <>{frames}<BoardLines>{lines}</BoardLines>{objects}</>;
});

/** What sits over the board in screen pixels, following the camera. Only this draws as the camera moves, and only while there's something to show. */
function OverSheet({ board }: { board: Board }) {
  const cam = useSyncExternalStore(board.camera.subscribe, board.camera.getSnapshot);
  const view = useBoardState(board, (s) => s.view);
  const sel = useBoardState(board, (s) => s.sel);
  const edit = useBoardState(board, (s) => s.edit);
  const marquee = useBoardState(board, (s) => s.marquee);
  const guides = useBoardState(board, (s) => s.guides);
  const boxes = useMemo(() => placed(view, sel), [view, sel]);
  const { x, y, z } = cam;
  return (
    <>
      {boxes.length > 0 && <BoardSelectionBox {...selectionRing(boxes, cam)} handles={!edit && boxes.length === 1} />}
      {guides.map((g) => <BoardGuide key={g.axis} axis={g.axis} at={g.at * z + (g.axis === 'x' ? x : y)} />)}
      {marquee && <BoardMarquee x={marquee.x * z + x} y={marquee.y * z + y} w={marquee.w * z} h={marquee.h * z} />}
    </>
  );
}

function Over({ board }: { board: Board }) {
  const active = useBoardState(board, (s) => s.sel.length > 0 || s.marquee !== null || s.guides.length > 0);
  return active ? <OverSheet board={board} /> : null;
}

/** What a blank board says. It fades as the first thing lands, and goes on being drawn until it has. */
function Blank({ board }: { board: Board }) {
  const empty = useBoardState(board, (s) => s.view.objects.length === 0);
  const [here, setHere] = useState(empty);
  useEffect(() => {
    if (empty) {
      setHere(true);
      return undefined;
    }
    const fading = setTimeout(() => setHere(false), DURATION[2] * 1000);
    return () => clearTimeout(fading);
  }, [empty]);
  return here ? <BoardEmpty fading={!empty} /> : null;
}

function Bar({ board, surface }: { board: Board; surface: BoardSurfaceProps }) {
  // To the percent the bar shows, so a pinch draws it only when the number changes.
  const zoom = useSyncExternalStore(board.camera.subscribe, () => Math.round(board.camera.getSnapshot().z * 100) / 100);
  const canUndo = useBoardState(board, (s) => s.canUndo);
  const canRedo = useBoardState(board, (s) => s.canRedo);
  const { name = '', seal, sealIcon, mode, acts = mode === 'call', onName, onSeal, onTimer, onVote, onPresent, onMore } = surface;
  return (
    <BoardBar name={name} seal={seal} sealIcon={sealIcon} zoom={zoom} canUndo={canUndo} canRedo={canRedo} editable={BOARD_LOOKS[mode].edit} acts={acts}
      onName={() => onName?.()} onSeal={() => onSeal?.()} onUndo={() => board.undo()} onRedo={() => board.redo()}
      onZoomOut={board.zoomOut} onFit={board.showEverything} onZoomIn={board.zoomIn} onMap={() => undefined}
      onTimer={onTimer} onVote={onVote} onPresent={onPresent} onMore={onMore} />
  );
}

export const BoardSurface = forwardRef<BoardHandle, BoardSurfaceProps>(function BoardSurface(props, ref) {
  const { doc, mode, people = NO_PEOPLE, fresh = false, night = false, name, onCall, onFollow, className } = props;
  const board = useBoard(doc, mode);
  const look = BOARD_LOOKS[mode];
  const toast = useToast();
  const sheet = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const tool = useBoardState(board, (s) => s.tool);
  const glide = useBoardState(board, (s) => s.glide);
  const pan = useBoardState(board, (s) => s.space || s.panning);
  const following = useBoardState(board, (s) => s.following);
  const faces = useMemo(() => people.map((p) => p.person), [people]);

  useLayoutEffect(() => board.setMode(mode), [board, mode]);
  useLayoutEffect(() => {
    board.tell = (text) => { toast(text); };
    board.onFollow = onFollow;
  }, [board, toast, onFollow]);
  useLayoutEffect(() => {
    const s = sheet.current, w = world.current;
    if (!s || !w) return undefined;
    const stopBoard = board.attach(s, w);
    const stopSheet = watchSheet(board, s);
    // "Or press N" should be true from the start, unless someone is busy elsewhere.
    if (board.canEdit && document.activeElement === document.body) board.focusSheet();
    return () => {
      stopSheet();
      stopBoard();
    };
  }, [board]);
  useImperativeHandle(ref, () => ({
    fit: () => board.showEverything(),
    goTo: (view) => board.goTo(view),
    follow: (id) => board.follow(id),
    focusFrame: (id) => board.focusFrame(id)
  }), [board]);

  return (
    <BoardLayout page={look.page} phone={look.phone} className={className}>
      {look.rail && <BoardRail tool={tool} onTool={(t) => { board.pickTool(t); board.focusSheet(); }} onMore={() => undefined} />}
      <BoardSheet ref={sheet} tool={tool} clean={look.clean} fresh={fresh} page={look.page} mini={look.mini} glide={glide} pan={pan} night={night} follow={people.find((p) => p.id === following)?.colour}
        tabIndex={look.mini ? -1 : 0} role={look.mini ? undefined : 'application'} aria-label={name} aria-hidden={look.mini || undefined}>
        <BoardWorld ref={world}><Objects board={board} /></BoardWorld>
        {!look.mini && <Over board={board} />}
        {look.edit && <Blank board={board} />}
        {look.bar && <Bar board={board} surface={props} />}
      </BoardSheet>
      {look.page && !look.phone && <BoardPageActions people={faces} onCall={() => onCall?.()} />}
    </BoardLayout>
  );
});
