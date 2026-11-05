/*
 * The board: what a person sees and presses, drawn from a plain Y.Doc with the kit in `@alcove/ui`. It knows nothing about
 * where the doc comes from, so the call, a board's page and a tile all use it. `mode` says what it's for.
 *
 * What's drawn is split by how often it changes. `Objects` draws when the board does, and a change to one object draws that
 * object alone, because `readBoard` keeps the identity of the rest and the kit's objects are memoised. The camera doesn't
 * reach it at all: it moves one transform, and only `OverSheet`, which sits in screen pixels, follows it. What each tool does
 * and what the bars offer is in `tools/`.
 */
import { errorCode } from '@alcove/api';
import { addObject, bounds, hasBox, shapePath, type BoardView, type PlacedObject } from '@alcove/board';
import {
  BoardBar, BoardDots, BoardEmpty, BoardFrame, BoardGuide, BoardLayout, BoardLine, BoardLines, BoardMarquee, BoardPageActions, BoardPicture, BoardRail, BoardSelectionBox, BoardShape, BoardSheet, BoardSticky, BoardStroke,
  BoardText, BoardWorld, DURATION, useToast, type AvatarPerson, type BoardNaming, type IconName
} from '@alcove/ui';
import { createContext, forwardRef, memo, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { log as rootLog } from '~/lib/log';
import { BoardTyping } from './editing';
import { watchSheet } from './gestures';
import { FollowingPill } from './pills';
import { BoardPointers, useBoardPresence, useOthersEditing, type BoardPresenceStore } from './presence';
import { mounted, placed, selectionRing } from './selection';
import { BOARD_LOOKS, type BoardMode, type BoardMoreItems } from './state';
import { SelectedBar } from './tools/bar';
import { Draft } from './tools/draft';
import { Flyouts } from './tools/flyouts';
import { dotsOn, lineRoute } from './tools/line';
import { Minimap } from './tools/map';
import { strokePath } from './tools/pen';
import { useBoard, useBoardState, type Board } from './useBoard';

const log = rootLog.child({ component: 'board' });

/** Someone in the call or on the page. */
export interface BoardPerson {
  /** Their call identity: what `follow` and `talking` name them by. */
  id: string;
  person: AvatarPerson;
  name: string;
  /** The colour of their pointer and of the ring round a view that's theirs. */
  colour: string;
  /** Their browsers on this board's awareness. Awareness doesn't say whose a browser is: the server does, and this is how it gets here. */
  clients: readonly number[];
}

/** A picture of someone's screen, as its file and what it says under it. */
export interface BoardShot {
  media: string;
  caption: string;
}

/** What the world around a board can ask of it. */
export interface BoardHandle {
  /** Shows everything on the board. */
  fit(): void;
  /** Goes once to where someone is looking, by their call identity, with the glide. */
  goTo(id: string): void;
  /** Follows someone by their call identity, or stops and goes back to where this person was. */
  follow(id: string | null): void;
  /** Fills the sheet with a frame. */
  focusFrame(id: string): void;
  /**
   * Puts a picture of a screen in the middle of what this person sees (beside everything, on a tile), as a change of
   * theirs, which their undo takes back. The id it was given, or null when the board is full or can't be changed here.
   */
  addShot(shot: BoardShot): string | null;
}

/** Reads a picture on the board into an object URL, which the surface lets go of when the picture goes. */
export type BoardPictures = (media: string, signal: AbortSignal) => Promise<string>;

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
  /** Following stopped from this side: a scroll, a zoom or Esc, Stop, or the person going. */
  onFollow?: ((id: string | null) => void) | undefined;
  /** Something to tell this person, such as what they were typing in being deleted. */
  onSay?: ((text: string) => void) | undefined;
  /** Sort into themes, on the stickies picked. The bar offers it only with this, so while a call is paused it isn't given. */
  onSort?: ((stickies: readonly string[]) => void) | undefined;
  /** What More beside the rail does: Image, From your workspace, Table, Mind map, Comment (also K) and Templates. */
  moreItems?: BoardMoreItems | undefined;
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
  /** The person's theme, which the sheet takes whatever is round it. The stage is night for everything else, so the call passes `useTheme().resolved`. Elsewhere the sheet is what the page is. */
  theme?: 'light' | 'dark' | undefined;
  /** Night board: the sheet goes dark, whatever the theme is. */
  night?: boolean | undefined;
  /** The name as a field in the bar, while it's being renamed. */
  naming?: BoardNaming | undefined;
  /** Reads the pictures on the board. Without it, a picture is an empty ground. */
  pictures?: BoardPictures | undefined;
  /**
   * The pill at the top of the sheet, for whoever has more than following to show there: given who's being followed and
   * how to stop, it says what shows. Without it, following has the pill to itself.
   */
  pill?: ((following: BoardPerson | null, stop: () => void) => ReactNode) | undefined;
  /** What the call puts over the sheet: its menus, ideas from the call. */
  children?: ReactNode;
  className?: string | undefined;
}

const NO_PEOPLE: readonly BoardPerson[] = [];
const NO_ITEMS: BoardMoreItems = {};
/** A picture of a screen as the canvas sizes one, in board units: its frame, the picture and the line under it. */
const SHOT = { w: 320, h: 228 } as const;
/** How far beside everything a picture lands when there's no view to put it in the middle of. */
const BESIDE = 40;

/** How the board's pictures are read: given to every picture on it, so none needs it passed down. */
const Pictures = createContext<BoardPictures | undefined>(undefined);

/** A picture on the board, read once through what the surface was given, and let go of when it goes. */
const Picture = memo(function Picture({ media, ...rest }: ComponentProps<typeof BoardPicture> & { media: string }) {
  const read = useContext(Pictures);
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!read) return undefined;
    const stop = new AbortController();
    let url: string | null = null;
    read(media, stop.signal).then((u) => {
      if (stop.signal.aborted) URL.revokeObjectURL(u);
      else { url = u; setSrc(u); }
    }, (e: unknown) => {
      // Gone, or out of reach for now: an empty ground says nothing that isn't so. The URL is never logged.
      if (!stop.signal.aborted) log.info('a picture on the board couldn’t be read', { code: errorCode(e) });
    });
    return () => {
      stop.abort();
      if (url) URL.revokeObjectURL(url);
      setSrc(undefined);
    };
  }, [read, media]);
  return <BoardPicture {...rest} src={src} />;
});

/** How many objects each frame holds, for the number beside its title and to know when it's empty. */
function heldCounts(view: BoardView): Map<string, number> {
  const held = new Map<string, number>();
  for (const o of view.objects) if (o.f && o.k !== 'frame' && o.k !== 'line') held.set(o.f, (held.get(o.f) ?? 0) + 1);
  return held;
}

function drawObject(o: PlacedObject, board: Board, selected: boolean, pop: boolean, glide: boolean, editing: boolean, other: string | undefined): ReactNode {
  const base = { id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, selected, pop, glide, other };
  const typing = (label: string): ReactNode => (editing ? <BoardTyping board={board} id={o.id} label={label} /> : undefined);
  switch (o.k) {
    case 'note': return <BoardSticky key={o.id} {...base} colour={o.c} size={o.size} text={o.t} editor={typing('Edit this sticky')} />;
    case 'text': return <BoardText key={o.id} {...base} size={o.size} text={o.t} editor={typing('Edit this text')} />;
    case 'shape': return <BoardShape key={o.id} {...base} path={shapePath(o.s, o.w, o.h)} colour={o.c || undefined} text={o.t} editor={typing('Edit this shape')} />;
    case 'image': return <Picture key={o.id} {...base} media={o.media} />;
    case 'shot': return <Picture key={o.id} {...base} media={o.media} shot caption={o.caption} />;
    default: return null;
  }
}

/** Everything on the board, in the order it stacks: frames, then lines and ink in one drawing, then objects. */
const Objects = memo(function Objects({ board, presence }: { board: Board; presence: BoardPresenceStore }) {
  const view = useBoardState(board, (s) => s.view);
  const near = useBoardState(board, (s) => s.near);
  const sel = useBoardState(board, (s) => s.sel);
  const edit = useBoardState(board, (s) => s.edit);
  const landed = useBoardState(board, (s) => s.landed);
  const settling = useBoardState(board, (s) => s.settling);
  const others = useOthersEditing(presence);
  const picked = useMemo(() => new Set(sel), [sel]);
  const shown = useMemo(() => mounted(view, near, edit), [view, near, edit]);
  const held = useMemo(() => heldCounts(view), [view]);

  const frames: ReactNode[] = [], lines: ReactNode[] = [], objects: ReactNode[] = [];
  for (const o of shown) {
    if (o.k === 'frame') {
      const count = held.get(o.id) ?? 0;
      const editor = edit === o.id ? <BoardTyping board={board} id={o.id} label="Edit this title" field="title" /> : undefined;
      frames.push(<BoardFrame key={o.id} id={o.id} x={o.x} y={o.y} w={o.w} h={o.h} title={o.title} sub={o.sub || (count ? String(count) : undefined)} hint={count ? undefined : o.hint} other={others.get(o.id)} editor={editor} />);
    } else if (o.k === 'line') {
      const r = lineRoute(view, o);
      if (r) lines.push(<BoardLine key={o.id} id={o.id} d={r.d} head={r.head} selected={picked.has(o.id)} settle={landed.has(o.id)} />);
    } else if (o.k === 'ink') {
      lines.push(<BoardStroke key={o.id} id={o.id} d={strokePath(o)} colour={o.c} marker={o.tool === 'marker'} selected={picked.has(o.id)} />);
    } else {
      objects.push(drawObject(o, board, picked.has(o.id), landed.has(o.id), settling.has(o.id), edit === o.id, others.get(o.id)));
    }
  }
  return <>{frames}<BoardLines>{lines}<Draft board={board} /></BoardLines>{objects}</>;
});

interface OverProps {
  board: Board;
  onSort: BoardHandlers['onSort'];
}

/** What sits over the board in screen pixels, following the camera. Only this draws as the camera moves, and only while there's something to show. */
function OverSheet({ board, onSort }: OverProps) {
  const cam = useSyncExternalStore(board.camera.subscribe, board.camera.getSnapshot);
  const view = useBoardState(board, (s) => s.view);
  const sel = useBoardState(board, (s) => s.sel);
  const edit = useBoardState(board, (s) => s.edit);
  const hover = useBoardState(board, (s) => s.hover);
  const marquee = useBoardState(board, (s) => s.marquee);
  const guides = useBoardState(board, (s) => s.guides);
  const boxes = useMemo(() => placed(view, sel), [view, sel]);
  const [solo] = boxes;
  // One thing picked, or what the pointer is near: a stroke is only a mark, so a line doesn't start from it.
  const dotted = edit ? undefined : sel.length ? (sel.length === 1 && solo?.k !== 'ink' ? solo : undefined) : placed(view, hover ? [hover] : [])[0];
  const { x, y, z } = cam;
  return (
    <>
      {boxes.length > 0 && <BoardSelectionBox {...selectionRing(boxes, cam)} handles={!edit && sel.length === 1} />}
      {dotted && <BoardDots points={dotsOn(dotted, cam)} />}
      {guides.map((g) => <BoardGuide key={g.axis} axis={g.axis} at={g.at * z + (g.axis === 'x' ? x : y)} />)}
      {marquee && <BoardMarquee x={marquee.x * z + x} y={marquee.y * z + y} w={marquee.w * z} h={marquee.h * z} />}
      <SelectedBar board={board} cam={cam} onSort={onSort} />
    </>
  );
}

function Over(props: OverProps) {
  const active = useBoardState(props.board, (s) => s.sel.length > 0 || s.hover !== null || s.marquee !== null || s.guides.length > 0);
  return active ? <OverSheet {...props} /> : null;
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
  const mapOn = useBoardState(board, (s) => s.map);
  const following = useBoardState(board, (s) => s.following !== null);
  const { name = '', naming, seal, sealIcon, mode, acts = mode === 'call', onName, onSeal, onTimer, onVote, onPresent, onMore } = surface;
  return (
    <BoardBar name={name} naming={naming} seal={seal} sealIcon={sealIcon} zoom={zoom} canUndo={canUndo} canRedo={canRedo} editable={BOARD_LOOKS[mode].edit} acts={acts && !following} mapOn={mapOn}
      onName={() => onName?.()} onSeal={() => onSeal?.()} onUndo={() => board.undo()} onRedo={() => board.redo()}
      onZoomOut={board.zoomOut} onFit={board.showEverything} onZoomIn={board.zoomIn} onMap={() => board.set({ map: !mapOn })}
      onTimer={onTimer} onVote={onVote} onPresent={onPresent} onMore={onMore} />
  );
}

/** What the pill shows by itself: following, with the way back. */
const followingOnly: NonNullable<BoardSurfaceProps['pill']> = (person, stop) => person && <FollowingPill person={person} onStop={stop} />;

/** The pill at the top of the sheet: told who's being followed and how to stop, it says what shows. */
function SheetPill({ board, people, pill }: { board: Board; people: readonly BoardPerson[]; pill: NonNullable<BoardSurfaceProps['pill']> }) {
  const following = useBoardState(board, (s) => s.following);
  return pill(people.find((p) => p.id === following) ?? null, () => {
    board.stopFollow();
    board.focusSheet();
  });
}

/** Where a picture of a screen lands: the middle of what this person sees, or beside everything on a board nobody's looking round. */
function shotSpot(board: Board): { x: number; y: number } {
  if (board.look.mini || !board.camera.width) {
    const placed = board.getSnapshot().view.objects.filter(hasBox);
    if (!placed.length) return { x: 0, y: 0 };
    const b = bounds(placed);
    return { x: b.x + b.w + BESIDE, y: b.y };
  }
  const seen = board.camera.visible();
  return { x: Math.round(seen.x + seen.w / 2 - SHOT.w / 2), y: Math.round(seen.y + seen.h / 2 - SHOT.h / 2) };
}

export const BoardSurface = forwardRef<BoardHandle, BoardSurfaceProps>(function BoardSurface(props, ref) {
  const { doc, awareness, mode, people = NO_PEOPLE, talking, fresh = false, theme, night = false, name, pictures, pill, onCall, onFollow, onSay, onSort, moreItems = NO_ITEMS, children, className } = props;
  const board = useBoard(doc, mode);
  const look = BOARD_LOOKS[mode];
  const toast = useToast();
  const sheet = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const tool = useBoardState(board, (s) => s.tool);
  const more = useBoardState(board, (s) => s.fly === 'more');
  const glide = useBoardState(board, (s) => s.glide);
  const pan = useBoardState(board, (s) => s.space || s.panning);
  const following = useBoardState(board, (s) => s.following);
  const faces = useMemo(() => people.map((p) => p.person), [people]);

  useLayoutEffect(() => board.setMode(mode), [board, mode]);
  useLayoutEffect(() => {
    board.tell = (text) => { toast(text); };
    board.onFollow = onFollow;
    board.onSay = onSay;
    board.moreItems = moreItems;
  }, [board, toast, onFollow, onSay, moreItems]);
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
  const presence = useBoardPresence(board, awareness, sheet, people, look.mini);
  useImperativeHandle(ref, () => ({
    fit: () => board.showEverything(),
    goTo: (id) => presence.following.goTo(id),
    follow: (id) => board.follow(id),
    focusFrame: (id) => board.focusFrame(id),
    addShot: ({ media, caption }) => {
      const { x, y } = shotSpot(board);
      const id = board.write(() => addObject(board.doc, { k: 'shot', x, y, w: SHOT.w, h: SHOT.h, media, caption }, board.origin));
      if (!id) board.refuse();
      return id;
    }
  }), [board, presence]);

  return (
    <Pictures.Provider value={pictures}>
      <BoardLayout page={look.page} phone={look.phone} className={className}>
        {look.rail && <BoardRail tool={tool} moreOpen={more} onTool={(t) => { board.pickTool(t); board.focusSheet(); }} onMore={() => { board.toggleMore(); board.focusSheet(); }} />}
        <BoardSheet ref={sheet} tool={tool} clean={look.clean} fresh={fresh} page={look.page} mini={look.mini} glide={glide} pan={pan} theme={theme} night={night} follow={people.find((p) => p.id === following)?.colour}
          tabIndex={look.mini ? -1 : 0} role={look.mini ? undefined : 'application'} aria-label={name} aria-hidden={look.mini || undefined}>
          <BoardWorld ref={world} pointers={<BoardPointers presence={presence} talking={talking} />}><Objects board={board} presence={presence} /></BoardWorld>
          {!look.mini && <Over board={board} onSort={onSort} />}
          {look.edit && <Blank board={board} />}
          {look.bar && <Bar board={board} surface={props} />}
          {look.bar && <Minimap board={board} />}
          {look.rail && <Flyouts board={board} />}
          <SheetPill board={board} people={people} pill={pill ?? followingOnly} />
          {children}
        </BoardSheet>
        {look.page && !look.phone && <BoardPageActions people={faces} onCall={() => onCall?.()} />}
      </BoardLayout>
    </Pictures.Provider>
  );
});
