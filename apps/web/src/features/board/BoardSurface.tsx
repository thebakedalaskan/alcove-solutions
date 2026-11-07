/*
 * The board: what a person sees and presses, drawn from a plain Y.Doc with the kit in `@alcove/ui`. It knows nothing about
 * where the doc comes from, so the call, a board's page and a tile all use it. `mode` says what it's for.
 *
 * What's drawn is split by how often it changes. `Objects` draws when the board does, and a change to one object draws that
 * object alone, because `readBoard` keeps the identity of the rest and the kit's objects are memoised. The camera doesn't
 * reach it at all: it moves one transform, and only `OverSheet`, which sits in screen pixels, follows it. What each tool does
 * and what the bars offer is in `tools/`, and what More adds in `more/`.
 */
import { errorCode } from '@alcove/api';
import { addObject, addStickies, bounds, hasBox, roomFrameId, setNight, shapePath, type Added, type BoardStep, type BoardView, type Landing, type PlacedObject } from '@alcove/board';
import {
  BOARD_MORE, BoardBar, BoardDots, BoardEmpty, BoardFrame, BoardGuide, BoardLayout, BoardLine, BoardLines, BoardMarquee, BoardPageActions, BoardPicture, BoardRail, BoardSelectionBox, BoardShape, BoardSheet, BoardSticky,
  BoardStroke, BoardText, BoardWorld, DURATION, useToast, type AvatarPerson, type BoardNaming, type IconName
} from '@alcove/ui';
import { createContext, forwardRef, memo, useContext, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { typing } from '~/lib/keys';
import { log as rootLog } from '~/lib/log';
import { CommentPins, CommentSheets, BoardCommentsStore, type BoardCommenting } from './comments';
import { BoardTyping, STICKY } from './editing';
import { watchSheet } from './gestures';
import { downloadBoard } from './more/download';
import { BarMenu, MoreLists, anyIn, moreFor, type BoardUpload, type BoardWorkspace } from './more/items';
import { Branches, LinkObjectView, Links, NodeObjectView, TableObjectView, type BoardLinks } from './more/objects';
import { PhoneAdd } from './phone';
import { BoardPills, FollowingPill, type PillKind, type Pills } from './pills';
import { BoardPointers, useBoardPresence, useOthersEditing, type BoardPresenceStore } from './presence';
import { inSlide, mounted, placed, selectionRing } from './selection';
import { BOARD_LOOKS, type BoardBarItems, type BoardLook, type BoardMode, type BoardMoreItems, type BoardState } from './state';
import { SelectedBar } from './tools/bar';
import { Draft } from './tools/draft';
import { Flyouts } from './tools/flyouts';
import { dotsOn, lineRoute } from './tools/line';
import { Minimap } from './tools/map';
import { strokePath } from './tools/pen';
import { inVote, RunMenus, runPills, TimerSaid, useBallot, voteMarks, type Ballot, type BoardRun, type RunPills, type RunVote, type VoteMarks } from './tools/run';
import { useBoard, useBoardState, type Board, type SortAsk } from './useBoard';

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
  /** Fills the sheet with the frames of these breakout rooms, on the board every room shares. */
  showRooms(roomIds: readonly string[]): void;
  /**
   * Puts a picture of a screen in the middle of what this person sees (beside everything, on a tile), as a change of
   * theirs, which their undo takes back. The id it was given, or null when the board is full or can't be changed here.
   */
  addShot(shot: BoardShot): string | null;
  /**
   * Puts stickies on the board as one change of this person's, an undo of its own whatever they're doing meanwhile: each in the
   * frame it fits, in a free spot there and in the frame's colour, or in the middle of what they see when it fits none
   * (`landings` in `@alcove/board`). One made from something, such as an idea from the call, has an ID made from it, so one
   * already on the board, from someone else's tray, is left as it is. Whoever can add to the board can do it, on a phone too,
   * and what lands where someone else's lands at the same moment is moved apart (`landing.ts`). What became of each, in order,
   * and the step that made them, which `undoStep` takes back; null when it can't be changed here.
   */
  addStickies(stickies: readonly Landing[]): { added: readonly Added[]; step: BoardStep | null } | null;
  /** Takes back one change of this person's by itself, wherever it is in their undo, as a toast's Undo does: on a phone too. */
  undoStep(step: BoardStep): void;
  /** Download as an image, as the bar's More does: what this person's board shows them, drawn and saved here. */
  saveImage(): void;
  /** Download as a PDF, as the bar's More does. */
  savePdf(): void;
  /** Whether it's a night board: dark in any theme, for everyone. */
  night(): boolean;
  /**
   * Night board on or off, for everyone, as the bar's More has it. It's for whoever can change the board, which whoever offers it
   * makes sure of: someone presenting a board they can change draws nothing on it, but can still make it a night board.
   */
  setNight(on: boolean): void;
}

/** Rooms' boards coming back to this one: which rooms, by id, and until when (ms) they're on their way. */
export interface BoardLanding { until: number; rooms: readonly string[] }

/** Reads a picture on the board into an object URL, which the surface lets go of when the picture goes. */
export type BoardPictures = (media: string, signal: AbortSignal) => Promise<string>;

/** What's outside the board. Each is optional, and whatever isn't given does nothing. */
export interface BoardHandlers {
  onName?: (() => void) | undefined;
  onSeal?: (() => void) | undefined;
  /** What the bar's Timer and Vote do where there's no `run` to open their menus, as in a story of the kit. */
  onTimer?: (() => void) | undefined;
  onVote?: (() => void) | undefined;
  /** Start a call here, on a board's page. */
  onCall?: (() => void) | undefined;
  /** Following stopped from this side: a scroll, a zoom or Esc, Stop, or the person going. */
  onFollow?: ((id: string | null) => void) | undefined;
  /** This person took the camera from a frame presented to them, with a scroll, a drag or a pinch: they're looking around. */
  onLook?: (() => void) | undefined;
  /** Something to tell this person, such as what they were typing in being deleted, with the icon that says what it's about. */
  onSay?: ((text: string, icon: IconName) => void) | undefined;
  /**
   * Sort into themes, given the stickies picked and what each says: asks confidential compute, and answers with the themes, which
   * the board writes as this person's change, so one undo puts it all back. The bar offers it only with this, so while a call is
   * paused it isn't given.
   */
  onSort?: SortAsk | undefined;
  /**
   * What More beside the rail does where the world round the board does it, in place of the board's own. Table, Mind map and
   * Templates are the board's own; Comment (also K) comes with `comments`, and Image and From your workspace with `upload` and
   * `workspace`.
   */
  moreItems?: BoardMoreItems | undefined;
  /** Keeps a picture in the board's own files, for Image under More. Without it, Image isn't offered. */
  upload?: BoardUpload | undefined;
  /** What can be linked from the board's workspace, for From your workspace under More. Without it, that isn't offered. */
  workspace?: BoardWorkspace | undefined;
  /** What each linked item is for whoever's looking, and how to open one. Without it, every link says it can't be opened. */
  links?: BoardLinks | undefined;
  /** The board's own link, which Copy link in the bar's More copies. */
  link?: string | undefined;
}

export interface BoardSurfaceProps extends BoardHandlers {
  doc: Y.Doc;
  awareness: Awareness;
  mode: BoardMode;
  /** The board's name, in the bar. */
  name?: string | undefined;
  /** What the menu under the name lets this person do, which its tip says. */
  nameTitle?: string | undefined;
  /** What the seal says: Sealed, Sealed to this room, View only. */
  seal?: string | undefined;
  /** Everyone here can add to it, as a blank board says to whoever can. Unless it's said otherwise, they can. */
  everyone?: boolean | undefined;
  sealIcon?: IconName | undefined;
  /** What the seal says on hover. */
  sealTitle?: string | undefined;
  /** Comments: who's writing, and whose faces go on them. Without it there are none to see or add. */
  comments?: BoardCommenting | undefined;
  /**
   * Timer, Vote and Present in the bar, each where it has something to do. On by default in a call, on a phone or not, and
   * nowhere else: someone with view access in a call has them too, disabled, saying why.
   */
  acts?: boolean | undefined;
  /** What the call runs on this board, its timer and vote, and what the bar's Timer and Vote do. Only a call has them. */
  run?: BoardRun | undefined;
  people?: readonly BoardPerson[] | undefined;
  /** The call identities of whoever is talking. */
  talking?: ReadonlySet<string> | undefined;
  /** Rises through the arch: a board that has just opened. */
  fresh?: boolean | undefined;
  /** Rooms (by id) whose boards are coming back to this one, and until when (ms): each lands as its frame, one after another. */
  landing?: BoardLanding | null | undefined;
  /**
   * What's presented: a frame, by id, alone on the sheet and filling it, or null for everything, held there as the sheet and the
   * frame change. In `present` mode it's what everyone watching sees; on a `tile`, a picture of that frame alone, as the next one
   * beside the presenter is. Before it's given, the camera is this person's.
   */
  slide?: string | null | undefined;
  /** The camera is the board's to put: nothing this person does moves it. The presenter's own frame, as everyone sees it, is. */
  still?: boolean | undefined;
  /** The bar and the rail fade out, as they do before a presentation takes the sheet. */
  faded?: boolean | undefined;
  /**
   * The person's theme, which the sheet takes whatever is round it. The stage is night for everything else, so the call passes
   * `useTheme().resolved`. Elsewhere the sheet is what the page is. A night board (the board's own setting) is dark in any theme.
   */
  theme?: 'light' | 'dark' | undefined;
  /** The name as a field in the bar, while it's being renamed. */
  naming?: BoardNaming | undefined;
  /** Reads the pictures on the board. Without it, a picture is an empty ground. */
  pictures?: BoardPictures | undefined;
  /**
   * The pills at the top of the sheet, for whoever has more to show there: given who's being followed, how to stop, and what
   * the call runs on the board (a vote, its results, the timer), every pill there is, of which `BoardPills` shows the one that
   * matters most, so their order is said in one place. Without it, the surface has following and the run's pills alone.
   */
  pill?: ((following: BoardPerson | null, stop: () => void, run: RunPills) => Pills) | undefined;
  /** Which kind of pill shows, as that changes, and null once none does. */
  onPill?: ((kind: PillKind | null) => void) | undefined;
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

/** What each frame holds: how many things, to know when it's empty, and how many stickies, the number beside its title. A theme's name is no sticky. */
function heldCounts(view: BoardView): { held: Map<string, number>; stickies: Map<string, number> } {
  const held = new Map<string, number>(), stickies = new Map<string, number>();
  for (const o of view.objects) {
    if (!o.f || o.k === 'frame' || o.k === 'line') continue;
    held.set(o.f, (held.get(o.f) ?? 0) + 1);
    if (o.k === 'note') stickies.set(o.f, (stickies.get(o.f) ?? 0) + 1);
  }
  return { held, stickies };
}

/** How far apart a few things that land together pop in, one after another. More than `STAGGER_UP_TO` pop in at once. */
const STAGGER_MS = 90;
const STAGGER_UP_TO = 6;

/** A vote this person can vote in: the one on, the board it's on as drawn, and how many votes they have left. */
interface Voting { vote: RunVote; view: BoardView; left: number }

function drawObject(o: PlacedObject, board: Board, selected: boolean, pop: number | null, glide: boolean, editing: boolean, other: string | undefined, land: number | undefined, marks: VoteMarks | null, cell: BoardState['cell'], voting: Voting | null): ReactNode {
  const base = { id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, selected, pop: pop !== null, glide, other, land: land !== undefined, delay: land ?? (pop || undefined) };
  const shown = { selected, pop: pop !== null, glide, editing, other };
  const typing = (label: string): ReactNode => (editing ? <BoardTyping board={board} id={o.id} label={label} /> : undefined);
  switch (o.k) {
    case 'note': {
      const vote = marks && { votes: marks.counts[o.id] ?? 0, dots: marks.dots.has(o.id) ? 1 : 0, top: marks.top.has(o.id), muted: marks.muted.has(o.id) };
      // In a vote this person can vote in, a sticky it takes takes the keys too, unless it's being typed in.
      const ballot = !voting || editing || !inVote(voting.view, voting.vote.frame, o.id) ? undefined : marks?.dots.has(o.id) ? 'voted' : voting.left > 0 ? 'open' : 'spent';
      return <BoardSticky key={o.id} {...base} {...vote} ballot={ballot} colour={o.c} size={o.size} text={o.t} editor={typing('Edit this sticky')} />;
    }
    case 'text': return <BoardText key={o.id} {...base} size={o.size} text={o.t} editor={typing('Edit this text')} />;
    case 'shape': return <BoardShape key={o.id} {...base} path={shapePath(o.s, o.w, o.h)} colour={o.c || undefined} text={o.t} editor={typing('Edit this shape')} />;
    case 'image': return <Picture key={o.id} {...base} media={o.media} />;
    case 'shot': return <Picture key={o.id} {...base} media={o.media} shot caption={o.caption} />;
    case 'table': return <TableObjectView key={o.id} o={o} board={board} shown={shown} cell={editing ? cell : null} />;
    case 'node': return <NodeObjectView key={o.id} o={o} board={board} shown={shown} />;
    case 'link': return <LinkObjectView key={o.id} o={o} shown={shown} />;
    default: return null;
  }
}

/**
 * Everything on the board, in the order it stacks: frames, then lines and ink in one drawing, then objects. A vote marks the
 * stickies it's on, and presenting, the frame on the sheet is all there is.
 */
const Objects = memo(function Objects({ board, presence, mode, vote, mine, left }: {
  board: Board; presence: BoardPresenceStore; mode: BoardMode; vote: RunVote | null; mine: ReadonlySet<string>;
  /** The votes this person has left while they can vote, or null. */
  left: number | null;
}) {
  const view = useBoardState(board, (s) => s.view);
  const near = useBoardState(board, (s) => s.near);
  const sel = useBoardState(board, (s) => s.sel);
  const edit = useBoardState(board, (s) => s.edit);
  const cell = useBoardState(board, (s) => s.cell);
  const landed = useBoardState(board, (s) => s.landed);
  const landing = useBoardState(board, (s) => s.landing);
  const settling = useBoardState(board, (s) => s.settling);
  const presented = useBoardState(board, (s) => s.slide);
  const slide = mode === 'present' || mode === 'tile' ? presented : null;
  const others = useOthersEditing(presence);
  const picked = useMemo(() => new Set(sel), [sel]);
  // What landed together pops in one after another, in the order it came.
  const popAt = useMemo(() => new Map([...landed].map((id, i) => [id, landed.size <= STAGGER_UP_TO ? i * STAGGER_MS : 0])), [landed]);
  // Presenting, the frame on the sheet is all there is, and on a picture of one: nothing of the next one shows at its edge.
  const shown = useMemo(() => {
    const all = mounted(view, near, edit);
    if (!slide || !view.byId.has(slide)) return all;
    const only = inSlide(view, slide);
    return all.filter((o) => only.has(o.id));
  }, [view, near, edit, slide]);
  const { held, stickies } = useMemo(() => heldCounts(view), [view]);
  const marks = useMemo(() => voteMarks(view, vote, mine), [view, vote, mine]);
  const voting = useMemo(() => (vote?.on && left !== null ? { vote, view, left } : null), [vote, view, left]);

  const frames: ReactNode[] = [], lines: ReactNode[] = [], objects: ReactNode[] = [];
  for (const o of shown) {
    if (o.k === 'frame') {
      const count = stickies.get(o.id) ?? 0;
      const editor = edit === o.id ? <BoardTyping board={board} id={o.id} label="Edit this title" field="title" /> : undefined;
      frames.push(<BoardFrame key={o.id} id={o.id} x={o.x} y={o.y} w={o.w} h={o.h} title={o.title} sub={o.sub || (count ? String(count) : undefined)} hint={held.get(o.id) ? undefined : o.hint}
        theme={o.sorted} other={others.get(o.id)} editor={editor} land={landing.has(o.id)} delay={landing.get(o.id)} />);
    } else if (o.k === 'line') {
      const r = lineRoute(view, o);
      if (r) lines.push(<BoardLine key={o.id} id={o.id} d={r.d} head={r.head} selected={picked.has(o.id)} settle={landed.has(o.id)} land={landing.get(o.id)} />);
    } else if (o.k === 'ink') {
      lines.push(<BoardStroke key={o.id} id={o.id} d={strokePath(o)} colour={o.c} marker={o.tool === 'marker'} selected={picked.has(o.id)} />);
    } else {
      objects.push(drawObject(o, board, picked.has(o.id), popAt.get(o.id) ?? null, settling.has(o.id), edit === o.id, others.get(o.id), landing.get(o.id), marks, cell, voting));
    }
  }
  return <>{frames}<BoardLines>{lines}<Branches view={view} /><Draft board={board} /></BoardLines>{objects}</>;
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

/** What a blank board says, to someone who can add to it and to someone who can only look. It fades as the first thing lands, and goes on being drawn until it has. */
function Blank({ board, look, everyone }: { board: Board; look: BoardLook; everyone: boolean }) {
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
  return here ? <BoardEmpty fading={!empty} reader={!look.edit} everyone={everyone} page={look.page} /> : null;
}

function Bar({ board, surface, more }: { board: Board; surface: BoardSurfaceProps; more: boolean }) {
  // To the percent the bar shows, so a pinch draws it only when the number changes.
  const zoom = useSyncExternalStore(board.camera.subscribe, () => Math.round(board.camera.getSnapshot().z * 100) / 100);
  const canUndo = useBoardState(board, (s) => s.canUndo);
  const canRedo = useBoardState(board, (s) => s.canRedo);
  const mapOn = useBoardState(board, (s) => s.map);
  const moreOn = useBoardState(board, (s) => s.barMenu);
  const following = useBoardState(board, (s) => s.following !== null);
  const { name, nameTitle, naming, seal, sealIcon, sealTitle, mode, acts = mode === 'call' || mode === 'phone', faded = false, people = NO_PEOPLE, run, onName, onSeal, onCall } = surface;
  const look = BOARD_LOOKS[mode];
  const faces = useMemo(() => people.map((p) => p.person), [people]);
  return (
    <BoardBar name={name} nameTitle={nameTitle} naming={naming} seal={seal} sealIcon={sealIcon} sealTitle={sealTitle} zoom={zoom} canUndo={canUndo} canRedo={canRedo} editable={look.edit}
      acts={acts && !following} canAct={look.edit || look.phone} moreOn={moreOn} mapOn={mapOn} faded={faded}
      onName={onName} onSeal={() => onSeal?.()} onUndo={() => board.undo()} onRedo={() => board.redo()}
      onZoomOut={board.zoomOut} onFit={board.showEverything} onZoomIn={board.zoomIn} onMap={() => board.set({ map: !mapOn })}
      onTimer={run && (() => board.toggleRunMenu('timer'))} onVote={run && (() => board.toggleRunMenu('vote'))}
      onMore={more ? () => board.toggleBarMenu() : undefined}
      tail={look.page && <BoardPageActions people={faces} onCall={() => onCall?.()} />} />
  );
}

/** The pills there are without the call to say more: following, and what the call runs on the board. */
const byItself: NonNullable<BoardSurfaceProps['pill']> = (person, stop, run) => ({ ...run, following: person && <FollowingPill person={person} onStop={stop} /> });

/**
 * The pill at the top of the sheet: told who's being followed, how to stop, and what the call runs on the board (`runPills`,
 * with the votes you've just pressed in what's left), `pill` says every pill there is, and `BoardPills` shows the one that
 * matters most. The board frames itself clear of it, and `onPill` hears which kind it is. Under it, what's said as a timer
 * starts and stops.
 */
function SheetPill({ board, people, pill, run, ballot, editable, onPill }: {
  board: Board; people: readonly BoardPerson[]; pill: NonNullable<BoardSurfaceProps['pill']>; run: BoardRun | undefined; ballot: Ballot; editable: boolean; onPill: BoardSurfaceProps['onPill'];
}) {
  const following = useBoardState(board, (s) => s.following);
  const pills = pill(people.find((p) => p.id === following) ?? null, () => {
    board.stopFollow();
    board.focusSheet();
  }, runPills(board, run, ballot, editable));
  return (
    <>
      <BoardPills pills={pills} onShown={(kind) => { board.setPill(kind); onPill?.(kind); }} />
      {run && <TimerSaid board={board} timer={run.timer} />}
    </>
  );
}

/** Download as an image, or as a PDF: what this person's board shows them, drawn here and saved here. */
async function saveAs(board: Board, how: 'image' | 'pdf', sheet: HTMLElement | null, o: { name: string | undefined; pictures: BoardPictures | undefined; links: BoardLinks | undefined }): Promise<void> {
  if (!sheet) return;
  try {
    await downloadBoard({ how, name: o.name ?? '', view: board.getSnapshot().view, sheet, pictures: o.pictures, itemFor: (item) => o.links?.itemFor(item) ?? null });
  } catch (e: unknown) {
    log.warn('a board couldn’t be downloaded', { how, objects: board.getSnapshot().view.objects.length, code: errorCode(e) });
    board.tell('The board couldn’t be saved as a file. Try again in a moment.');
  }
}

/**
 * Where something `w` by `h` lands from outside the board, by its top left corner: the middle of what this person sees, or beside
 * everything on a board nobody's looking round.
 */
function landingSpot(board: Board, w: number, h: number): { x: number; y: number } {
  if (board.look.mini || !board.camera.width) {
    const placed = board.getSnapshot().view.objects.filter(hasBox);
    if (!placed.length) return { x: 0, y: 0 };
    const b = bounds(placed);
    return { x: b.x + b.w + BESIDE, y: b.y };
  }
  const seen = board.camera.visible();
  return { x: Math.round(seen.x + seen.w / 2 - w / 2), y: Math.round(seen.y + seen.h / 2 - h / 2) };
}

/**
 * Stickies from outside the board, put there as one change of their own: what `addStickies` does. It's for whoever can add to
 * the board, so a phone's tray adds as its + does.
 */
function addLanded(board: Board, stickies: readonly Landing[]): { added: Added[]; step: BoardStep | null } | null {
  if (!board.canAdd || !stickies.length) return null;
  const corner = landingSpot(board, STICKY, STICKY);
  const middle = { x: corner.x + STICKY / 2, y: corner.y + STICKY / 2 };
  // One transaction, an undo of its own whatever this person has under way, so the toast's Undo takes back these and nothing else.
  const { result, step } = board.writeApart(() => addStickies(board.doc, stickies, middle, board.getSnapshot().colour, board.origin));
  if (result.some((r) => r.added === 'full')) board.refuse();
  board.justPut.watch(result.flatMap((r) => (r.added === 'made' && r.id ? [r.id] : [])));
  return { added: result.map((r) => r.added), step };
}

export const BoardSurface = forwardRef<BoardHandle, BoardSurfaceProps>(function BoardSurface(props, ref) {
  const {
    doc, awareness, mode, people = NO_PEOPLE, talking, fresh = false, landing, slide, still = false, faded = false, theme, name, pictures, pill, onPill, everyone = true, comments,
    run, onFollow, onLook, onSay, onSort, moreItems = NO_ITEMS, upload, workspace, links, link, children, className
  } = props;
  const sheetId = useId();
  const board = useBoard(doc, mode);
  const look = BOARD_LOOKS[mode];
  const toast = useToast();
  const sheet = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const tool = useBoardState(board, (s) => s.tool);
  const moreOpen = useBoardState(board, (s) => s.fly === 'more');
  const glide = useBoardState(board, (s) => s.glide);
  const pan = useBoardState(board, (s) => s.space || s.panning);
  const following = useBoardState(board, (s) => s.following);
  const said = useMemo(() => new BoardCommentsStore(board, `${sheetId}comment`), [board, sheetId]);
  /** Whoever can change the board can vote on it (on a phone, an editor votes with a tap) and make it a night board. */
  const canChange = look.edit || look.phone;
  const night = useBoardState(board, (s) => s.night);
  const ballot = useBallot(board, run, canChange);
  /* Whoever can write comments has K and More's Comment for them, unless what's around the board says otherwise. */
  const commentsMe = comments?.me ?? null;
  const given = useMemo(() => (commentsMe && !moreItems.comment ? { ...moreItems, comment: said.start } : moreItems), [commentsMe, moreItems, said]);
  const moreRun = useMemo(() => moreFor(board, { upload, workspace, given }), [board, upload, workspace, given]);
  /* More holds what it has something to do with, and nothing else: an item that does nothing is a dead end. */
  const more = useMemo(() => BOARD_MORE.filter((id) => moreRun[id]), [moreRun]);
  /* The bar's More: Copy link and the downloads change nothing, so they're there for whoever can see the board. */
  const barItems = useMemo((): BoardBarItems => ({
    link: link ? () => {
      navigator.clipboard.writeText(link).then(() => board.onSay?.('Link copied. It opens for whoever can open the board.', 'link'), (e: unknown) => {
        log.info('a board’s link wasn’t copied', { code: errorCode(e) });
        board.tell('This browser didn’t let the link be copied.');
      });
    } : undefined,
    image: () => { void saveAs(board, 'image', sheet.current, { name, pictures, links }); },
    pdf: () => { void saveAs(board, 'pdf', sheet.current, { name, pictures, links }); },
    // Night board changes the board, for everyone, so it's for whoever can change it.
    night: canChange ? () => board.toggleNight() : undefined
  }), [board, link, name, pictures, links, canChange]);

  useLayoutEffect(() => board.setMode(mode), [board, mode]);
  useLayoutEffect(() => { if (landing) board.expectLanding(landing.until, landing.rooms); }, [board, landing]);
  useLayoutEffect(() => {
    // A refusal carries the cross every refusal does, never a tick; what happened says what it's about, with what to press.
    board.tell = (text, o) => { toast(text, o ?? { icon: 'x' }); };
    board.onFollow = onFollow;
    board.onLook = onLook;
    // Where nothing round the board says it for it, the board says it itself, as it says a refusal.
    board.onSay = onSay ?? ((text, icon) => { toast(text, { icon }); });
    board.moreItems = moreRun;
    board.still = still;
  }, [board, toast, onFollow, onLook, onSay, moreRun, still]);
  // After the mode, so a presentation that's just begun keeps where this person was. Again with each mode: Back to them is one.
  useLayoutEffect(() => { if (slide !== undefined) board.present(slide); }, [board, slide, mode]);
  useLayoutEffect(() => {
    const s = sheet.current, w = world.current;
    if (!s || !w) return undefined;
    const stopBoard = board.attach(s, w);
    const stopSheet = watchSheet(board, s);
    // "Or press N" should be true from the start, unless someone is busy elsewhere: typing a moment ago, or in a field the page
    // took from them, the rest of their sentence isn't for the board.
    if (board.canEdit && document.activeElement === document.body && !typing(document.body)) board.focusSheet();
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
    showRooms: (roomIds) => board.showFrames(roomIds.map(roomFrameId)),
    addShot: ({ media, caption }) => {
      const { x, y } = landingSpot(board, SHOT.w, SHOT.h);
      // It comes from outside the board, whatever this person is doing, so it's an undo of its own.
      const id = board.writeApart(() => addObject(board.doc, { k: 'shot', x, y, w: SHOT.w, h: SHOT.h, media, caption }, board.origin)).result;
      if (!id) board.refuse();
      return id;
    },
    addStickies: (stickies) => addLanded(board, stickies),
    undoStep: (step) => board.undoStep(step),
    saveImage: () => barItems.image?.(),
    savePdf: () => barItems.pdf?.(),
    night: () => board.getSnapshot().night,
    setNight: (on) => setNight(board.doc, on, board.origin)
  }), [board, presence, barItems]);

  return (
    <Pictures.Provider value={pictures}>
     <Links.Provider value={links ?? null}>
      <BoardLayout page={look.page} phone={look.phone} className={className}>
        {look.rail && <BoardRail tool={tool} more={more} moreOpen={moreOpen} faded={faded} onTool={(t) => { board.pickTool(t); board.focusSheet(); }} onMore={() => { board.toggleMore(); board.focusSheet(); }} />}
        <BoardSheet ref={sheet} tool={tool} clean={look.clean} fresh={fresh} page={look.page} mini={look.mini} glide={glide} pan={pan} theme={theme} night={night} follow={people.find((p) => p.id === following)?.colour}
          tabIndex={look.mini ? -1 : 0} role={look.mini ? undefined : 'application'} aria-label={name} aria-hidden={look.mini || undefined}>
          {/* Beside the rail, but first on the sheet: what a tool's key opens is the next thing Tab reaches. */}
          {look.rail && <Flyouts board={board} more={more} />}
          {look.rail && <MoreLists board={board} workspace={workspace} />}
          <BoardWorld ref={world} pointers={<>{comments && !look.mini && <CommentPins board={board} store={said} commenting={comments} mode={mode} />}<BoardPointers presence={presence} talking={talking} only={mode === 'present' ? following : undefined} /></>}>
            <Objects board={board} presence={presence} mode={mode} vote={run?.vote ?? null} mine={ballot.mine} left={canChange && run?.vote?.on ? ballot.left : null} />
          </BoardWorld>
          {!look.mini && <Over board={board} onSort={onSort} />}
          {!look.mini && <Blank board={board} look={look} everyone={everyone} />}
          {look.bar && <Bar board={board} surface={props} more={anyIn(barItems)} />}
          {look.bar && <BarMenu board={board} items={barItems} night={night} />}
          {look.bar && !look.phone && <Minimap board={board} />}
          {look.phone && <PhoneAdd board={board} name={name ?? ''} night={!look.page} theme={theme} />}
          {look.bar && run && <RunMenus board={board} run={run} />}
          {!look.mini && <SheetPill board={board} people={people} pill={pill ?? byItself} run={run} ballot={ballot} editable={canChange} onPill={onPill} />}
          {comments && !look.mini && <CommentSheets board={board} sheet={() => sheet.current} store={said} commenting={comments} />}
          {children}
        </BoardSheet>
      </BoardLayout>
     </Links.Provider>
    </Pictures.Provider>
  );
});
