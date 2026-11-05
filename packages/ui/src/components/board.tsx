/*
 * The board's parts: the sheet, what's on it and the controls around it. All of it is drawn from props, with no idea where
 * the data lives. The camera is one transform on `BoardWorld`, written through a ref by `moveBoardCamera`, so objects place
 * themselves in board units and never draw again when it moves. Objects take no handlers either: `data-id`, `data-h` and
 * `data-p` say what was pressed, so one listener on the sheet serves them all, and `memo` keeps a busy board from drawing
 * anything that didn't change.
 */
import { forwardRef, memo, type CSSProperties, type HTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../cn';
import { CallDock, DockButton, DockSeparator, SharePointer } from './call';
import { Icon, type IconName } from './icon';
import { EmptyArch } from './illustrations';
import { Popover } from './overlay';
import { Avatar, Faces, type AvatarPerson } from './people';
import { Button, IconButton } from './primitives';

export const BOARD_COLOURS = ['butter', 'peach', 'rose', 'lilac', 'sky', 'mist'] as const;
export type BoardColour = (typeof BOARD_COLOURS)[number];
export type BoardTool = 'select' | 'note' | 'text' | 'shape' | 'line' | 'pen' | 'frame';
export type BoardShapeKind = 'rect' | 'ellipse' | 'diamond' | 'pill';
export type BoardLineStyle = 'elbow' | 'straight' | 'curve';
export type BoardPenKind = 'pen' | 'marker' | 'eraser';
/** A place and size: in board units on the board, in screen pixels over it. */
export interface BoardBox { x: number; y: number; w: number; h: number }
/** Where the camera is: `x` and `y` in screen pixels, `z` its zoom. */
export interface BoardCamera { x: number; y: number; z: number }

const colourName = (c: BoardColour): string => c.charAt(0).toUpperCase() + c.slice(1);
const place = ({ x, y, w, h }: BoardBox): CSSProperties => ({ left: x, top: y, width: w, height: h });

/* ---------- The sheet ---------- */

/**
 * Moves the camera without drawing anything again: one transform on the world, the dots on the sheet keep up with it,
 * and `--iz` undoes the zoom for pointers, on the layer `BoardWorld` keeps for them last.
 */
export function moveBoardCamera(sheet: HTMLElement, world: HTMLElement, { x, y, z }: BoardCamera): void {
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  if (world.lastElementChild instanceof HTMLElement) world.lastElementChild.style.setProperty('--iz', String(Math.round(1000 / z) / 1000));
  sheet.style.setProperty('--dot', `${Math.max(12, Math.round(2400 * z) / 100)}px`);
  sheet.style.setProperty('--dx', `${x}px`);
  sheet.style.setProperty('--dy', `${y}px`);
}

/**
 * Keeps what takes a press on a line one width on screen, whatever the zoom, through its own `--iz`. That restyles every line and
 * stroke, so it's for when the camera has come to rest: nobody presses a line in the middle of a zoom.
 */
export function restBoardCamera(world: HTMLElement, { z }: BoardCamera): void {
  const lines = world.querySelector('.bd-svg');
  if (lines instanceof SVGElement) lines.style.setProperty('--iz', String(Math.round(1000 / z) / 1000));
}

/** The board and its rail, side by side. `page`: on its own page, with day around it. `phone`: the whole space between the faces and the dock. */
export function BoardLayout({ page = false, phone = false, className, children }: { page?: boolean | undefined; phone?: boolean | undefined; className?: string | undefined; children: ReactNode }) {
  return <div className={cn('bz', page && 'is-page', phone && 'is-phone', className)}>{children}</div>;
}

export interface BoardSheetProps extends HTMLAttributes<HTMLDivElement> {
  /** Sets the cursor. */
  tool?: BoardTool | undefined;
  /** No dots: presenting, a phone, a live tile. */
  clean?: boolean | undefined;
  /** Rises through the arch: a board that has just opened. */
  fresh?: boolean | undefined;
  page?: boolean | undefined;
  /** A live picture of the board: a tile, a note, the next slide. It can't be pressed. */
  mini?: boolean | undefined;
  /** The camera glides to where it's next put, in place of jumping. */
  glide?: boolean | undefined;
  /** Dragging the board around. */
  pan?: boolean | undefined;
  /** The colour of whoever you're following: a ring round the sheet says this view isn't your own. */
  follow?: string | undefined;
  /** The person's theme, which this sheet takes whatever is round it. The stage is night for everything else, so a board in a call passes this. Without it, the sheet is what the page is. */
  theme?: 'light' | 'dark' | undefined;
  /** Night board: this sheet goes dark, whatever the theme is. */
  night?: boolean | undefined;
}

/** The sheet. Pass it the pointer and key handlers; everything over the board goes inside, after `BoardWorld`. */
export const BoardSheet = forwardRef<HTMLDivElement, BoardSheetProps>(function BoardSheet(
  { tool = 'select', clean = false, fresh = false, page = false, mini = false, glide = false, pan = false, follow, theme, night = false, className, style, tabIndex = mini ? -1 : 0, children, ...rest }, ref
) {
  return (
    <div ref={ref} tabIndex={tabIndex} style={follow ? { '--fc': follow, ...style } : style}
      className={cn('bd', `is-tool-${tool}`, clean && 'is-clean', fresh && 'is-new', page && 'is-page', mini && 'is-mini', glide && 'is-glide', pan && 'is-pan', night ? 'dark' : theme, className)} {...rest}>
      {children}
    </div>
  );
});

/** The layer the camera moves. Frames, `BoardLines` and objects go inside it, in that order, and each `BoardPointer` in `pointers`, over them. */
export const BoardWorld = forwardRef<HTMLDivElement, { className?: string | undefined; pointers?: ReactNode; children?: ReactNode }>(function BoardWorld({ className, pointers, children }, ref) {
  return <div ref={ref} className={cn('bd-w', className)}>{children}<div className="bd-pts">{pointers}</div></div>;
});

/** Every line and stroke on the board, in one drawing. */
export function BoardLines({ children }: { children?: ReactNode }) {
  return <svg className="bd-svg" aria-hidden="true">{children}</svg>;
}

/** A line, with its arrowhead. `id` lets it be pressed, through a wider path that isn't drawn. `draft`: the one being drawn, as dots. `settle`: it's just been let go. */
export const BoardLine = memo(function BoardLine({ id, d, head, selected = false, draft = false, settle = false }: { id?: string | undefined; d: string; head?: string | undefined; selected?: boolean | undefined; draft?: boolean | undefined; settle?: boolean | undefined }) {
  const state = cn(selected && 'is-sel', draft && 'is-draft', settle && 'is-settle');
  return <>{id && <path className="bd-hit" data-id={id} d={d} />}<path className={state} d={d} />{head && <path className={cn('head', state)} d={head} />}</>;
});

/** A stroke of the pen. `marker` is the highlighter: wide, and see-through. `id` lets it be pressed, as `BoardLine`'s does. */
export const BoardStroke = memo(function BoardStroke({ id, d, colour = 'horizon', marker = false, selected = false }: { id?: string | undefined; d: string; colour?: 'horizon' | 'sun' | 'rose' | undefined; marker?: boolean | undefined; selected?: boolean | undefined }) {
  return <>{id && <path className={cn('bd-hit', marker && 'is-marker')} data-id={id} d={d} />}<path className={cn('ink', `c-${colour}`, marker && 'is-marker', selected && 'is-sel')} d={d} /></>;
});

/* ---------- The rail and the bar ---------- */

const RAIL: { tool: BoardTool; icon: IconName; label: string }[] = [
  { tool: 'select', icon: 'pointer', label: 'Select · Esc' },
  { tool: 'note', icon: 'stickyNote', label: 'Sticky · N' },
  { tool: 'text', icon: 'type', label: 'Text · T' },
  { tool: 'shape', icon: 'shapes', label: 'Shape · S' },
  { tool: 'line', icon: 'line', label: 'Line · L' },
  { tool: 'pen', icon: 'pen', label: 'Pen · P' },
  { tool: 'frame', icon: 'frame', label: 'Frame · F' }
];

/** The tools: the call's dock, turned on its side, just off the sheet. `faded` lets them fade out while presenting starts. */
export function BoardRail({ tool, onTool, onMore, moreOpen = false, faded = false, className }: {
  tool: BoardTool; onTool: (tool: BoardTool) => void; onMore: () => void; moreOpen?: boolean | undefined; faded?: boolean | undefined; className?: string | undefined;
}) {
  return (
    <CallDock label="Tools" className={cn('bz-rail', faded && 'is-faded', className)}>
      {RAIL.map((t) => <DockButton key={t.tool} icon={t.icon} label={t.label} on={tool === t.tool} aria-pressed={tool === t.tool} data-tool={t.tool} onClick={() => onTool(t.tool)} />)}
      <DockSeparator />
      <DockButton icon="plus" label="More: images, documents, templates" title="More" aria-expanded={moreOpen} onClick={onMore} />
    </CallDock>
  );
}

export interface BoardBarProps {
  name: string;
  /** What the seal says: Sealed, Sealed to this room, Reconnecting, Not saved, View only. Empty hides it. */
  seal?: string | undefined;
  sealIcon?: IconName | undefined;
  /** The camera's zoom, shown as a percentage. */
  zoom: number;
  canUndo?: boolean | undefined;
  canRedo?: boolean | undefined;
  /** Undo and Redo: false for someone who can only look. */
  editable?: boolean | undefined;
  /** Timer, Vote, Present and More: false where there's no session to run. */
  acts?: boolean | undefined;
  mapOn?: boolean | undefined;
  faded?: boolean | undefined;
  onName: () => void; onSeal: () => void;
  onUndo?: (() => void) | undefined; onRedo?: (() => void) | undefined;
  onZoomOut: () => void; onFit: () => void; onZoomIn: () => void; onMap: () => void;
  onTimer?: (() => void) | undefined; onVote?: (() => void) | undefined; onPresent?: (() => void) | undefined; onMore?: (() => void) | undefined;
  className?: string | undefined;
}

/** Everything about the board that isn't a tool, in one line along the top of the sheet. */
export function BoardBar({ name, seal = 'Sealed', sealIcon = 'sealed', zoom, canUndo = false, canRedo = false, editable = true, acts = true, mapOn = false, faded = false,
  onName, onSeal, onUndo, onRedo, onZoomOut, onFit, onZoomIn, onMap, onTimer, onVote, onPresent, onMore, className }: BoardBarProps) {
  return (
    <div className={cn('bd-head', acts && editable && 'is-full', faded && 'is-faded', className)}>
      <button type="button" className="nm" title="Rename, move or copy this board" onClick={onName}><Icon name="presenter" size={16} /><span>{name}</span><Icon name="down" size={14} /></button>
      {seal && <button type="button" className="sv" title="Sealed. Alcove can’t read this board." onClick={onSeal}><Icon name={sealIcon} size={15} /><span>{seal}</span></button>}
      <span className="sp" />
      {editable && (
        <>
          <IconButton className="bt" icon="undo" size={17} label="Undo" title="Undo your last change · ⌘Z" disabled={!canUndo} onClick={onUndo} />
          <IconButton className="bt" icon="redo" size={17} label="Redo" title="Redo · ⇧⌘Z" disabled={!canRedo} onClick={onRedo} />
          <span className="vr" />
        </>
      )}
      <IconButton className="bt" icon="minus" size={16} label="Zoom out" onClick={onZoomOut} />
      <button type="button" className="pct" title="Show everything · ⇧1" onClick={onFit}>{Math.round(zoom * 100)}%</button>
      <IconButton className="bt" icon="plus" size={16} label="Zoom in" onClick={onZoomIn} />
      <IconButton className="bt" icon="map" size={16} label="Map" aria-pressed={mapOn} onClick={onMap} />
      {acts && (
        <>
          <span className="vr" />
          <IconButton className="bt" icon="timer" size={17} label="Timer" onClick={onTimer} />
          <IconButton className="bt" icon="vote" size={17} label="Vote" onClick={onVote} />
          <IconButton className="bt" icon="play" size={15} label="Present" onClick={onPresent} />
          <IconButton className="bt" icon="more" size={17} label="More" onClick={onMore} />
        </>
      )}
    </div>
  );
}

/** Anything the whole board shares, in one place: a timer, a vote, following, a room's time. `soon` turns it amber. */
export function BoardPill({ icon = 'clock', title, text, time, soon = false, action, onAction, className }: {
  /** `null` for no icon. */
  icon?: IconName | null | undefined;
  title?: string | undefined; text?: string | undefined; time?: string | undefined; soon?: boolean | undefined;
  action?: string | undefined; onAction?: (() => void) | undefined; className?: string | undefined;
}) {
  return (
    <div className={cn('bd-pill', 'dark', soon && 'is-soon', action && 'has-act', className)} role="status">
      {icon && <Icon name={icon} size={16} fill="none" />}
      {title && <b>{title}</b>}
      {text && <span>{text}</span>}
      {time && (title || text) && <span className="sep" />}
      {time && <span className="t">{time}</span>}
      {action && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}

export interface BoardPopProps {
  /** Where it sits on the sheet, from the left or the right edge, and the top. */
  left?: number | undefined; right?: number | undefined; top: number;
  title?: string | undefined; sub?: string | undefined;
  /** Names it when it has no title. */
  label?: string | undefined;
  /** Lines to read. */
  rows?: { icon: IconName; text: string }[] | undefined;
  /** A choice of up to three. */
  options?: { label: string; on: boolean; onPick: () => void }[] | undefined;
  /** Things to do. `small` sits at the end of the line. */
  items?: { icon: IconName; label: string; small?: string | undefined; onPick: () => void }[] | undefined;
  /** The one button at the bottom. */
  action?: { label: string; onPick: () => void } | undefined;
  /** Moves it from where `left` puts it, as `BoardSelectionBar` does to keep its menu on the sheet. */
  translate?: string | undefined;
  className?: string | undefined;
}

/** A small menu on the sheet, opened from the bar. Say where with `left` or `right`, and `top`. */
export const BoardPop = forwardRef<HTMLDivElement, BoardPopProps>(function BoardPop({ left, right, top, title, sub, label, rows, options, items, action, translate, className }, ref) {
  return (
    <div ref={ref} className={cn('bp', className)} style={{ left, right, top, translate }} role="dialog" aria-label={title ?? label}>
      {title && <div className="hd">{title}</div>}
      {sub && <div className="sub">{sub}</div>}
      {rows && <div className="rows">{rows.map((r) => <div key={r.text}><Icon name={r.icon} size={15} /><span>{r.text}</span></div>)}</div>}
      {options && <div className="opts">{options.map((o) => <button key={o.label} type="button" className="opt" aria-pressed={o.on} onClick={o.onPick}>{o.label}</button>)}</div>}
      {items?.map((i) => <button key={i.label} type="button" className="mi" onClick={i.onPick}><Icon name={i.icon} size={17} /><span>{i.label}</span>{i.small && <small>{i.small}</small>}</button>)}
      {action && <div className="ft"><Button variant="primary" onClick={action.onPick}>{action.label}</Button></div>}
    </div>
  );
});

/* ---------- A tool's options ---------- */

export type BoardMoreItem = 'image' | 'workspace' | 'table' | 'mindMap' | 'comment' | 'templates';
const MORE: { id: BoardMoreItem; icon: IconName; label: string; key?: string }[] = [
  { id: 'image', icon: 'image', label: 'Image' },
  { id: 'workspace', icon: 'transcript', label: 'From your workspace' },
  { id: 'table', icon: 'table', label: 'Table' },
  { id: 'mindMap', icon: 'workflow', label: 'Mind map' },
  { id: 'comment', icon: 'commentBubble', label: 'Comment', key: 'K' },
  { id: 'templates', icon: 'layoutTemplate', label: 'Templates' }
];
const LINES: { id: BoardLineStyle; icon: IconName; label: string }[] = [
  { id: 'elbow', icon: 'elbow', label: 'Elbow arrow' },
  { id: 'straight', icon: 'line', label: 'Straight arrow' },
  { id: 'curve', icon: 'spline', label: 'Curved line' }
];
const PENS: { id: BoardPenKind; icon: IconName; label: string }[] = [
  { id: 'pen', icon: 'pen', label: 'Pen' },
  { id: 'marker', icon: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' }
];
const SHAPES: { id: Exclude<BoardShapeKind, 'pill'>; icon: IconName; label: string }[] = [
  { id: 'rect', icon: 'square', label: 'Rectangle' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse' },
  { id: 'diamond', icon: 'diamond', label: 'Diamond' }
];

export type BoardFlyoutProps = { className?: string | undefined } & (
  | { kind: 'note'; colour: BoardColour; onColour: (colour: BoardColour) => void }
  | { kind: 'shape'; shape: BoardShapeKind; onShape: (shape: BoardShapeKind) => void }
  | { kind: 'line'; line: BoardLineStyle; onLine: (line: BoardLineStyle) => void }
  | { kind: 'pen'; pen: BoardPenKind; onPen: (pen: BoardPenKind) => void }
  | { kind: 'more'; onMore: (item: BoardMoreItem) => void }
);

/** A tool's options, beside the rail and level with that tool. */
export function BoardFlyout(props: BoardFlyoutProps) {
  const cls = cn('bfly', `is-${props.kind}`, props.className);
  if (props.kind === 'more') {
    return (
      <div className={cls}>
        {MORE.map((m) => <button key={m.id} type="button" className="item" onClick={() => props.onMore(m.id)}><Icon name={m.icon} size={18} />{m.label}{m.key && <kbd>{m.key}</kbd>}</button>)}
      </div>
    );
  }
  return (
    <div className={cls}>
      <div className="row">
        {props.kind === 'note' && BOARD_COLOURS.map((c) => (
          <button key={c} type="button" className={cn('sw', `c-${c}`)} aria-label={`${colourName(c)} sticky`} title={`${colourName(c)} sticky`} aria-pressed={props.colour === c} onClick={() => props.onColour(c)}><i className="swatch" /></button>
        ))}
        {props.kind === 'shape' && (
          <>
            {SHAPES.map((s) => <IconButton key={s.id} className="bt" icon={s.icon} size={19} label={s.label} aria-pressed={props.shape === s.id} onClick={() => props.onShape(s.id)} />)}
            {/* Lucide has no pill, so this one is drawn. */}
            <button type="button" className="ac-icon-btn bt" aria-label="Pill" title="Pill" aria-pressed={props.shape === 'pill'} onClick={() => props.onShape('pill')}>
              <svg className="ac-i" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="5" /></svg>
            </button>
          </>
        )}
        {props.kind === 'line' && LINES.map((l) => <IconButton key={l.id} className="bt" icon={l.icon} size={19} label={l.label} aria-pressed={props.line === l.id} onClick={() => props.onLine(l.id)} />)}
        {props.kind === 'pen' && PENS.map((p) => <IconButton key={p.id} className="bt" icon={p.icon} size={19} label={p.label} aria-pressed={props.pen === p.id} onClick={() => props.onPen(p.id)} />)}
      </div>
    </div>
  );
}

/* ---------- Selection ---------- */

export interface BoardSelectionBarProps {
  /** Where it sits on the sheet, in screen pixels: `x` is its middle. */
  x: number; y: number;
  /** The sheet's width. The bar stays on the sheet, however near its edge the selection is. */
  room?: number | undefined;
  /** How many are selected. Above one, it says so. */
  count?: number | undefined;
  /** What it says they are. */
  things?: string | undefined;
  /** The colour shown. `null` for what has none, such as a picture of a screen. */
  colour?: BoardColour | null | undefined;
  textSize?: boolean | undefined;
  /** The row of colours under the bar is open. */
  picking?: boolean | undefined;
  /** How a selected line runs, to change it. */
  lineStyle?: BoardLineStyle | undefined;
  onColour: () => void; onPick: (colour: BoardColour) => void;
  onTextSize?: (() => void) | undefined; onLineStyle?: ((style: BoardLineStyle) => void) | undefined;
  /** What More holds, while it's open. */
  moreItems?: BoardPopProps['items'];
  onDelete: () => void;
  /** A button shows only if it's given something to do: nothing is offered that can't be done to what's picked. */
  onLine?: (() => void) | undefined; onDuplicate?: (() => void) | undefined; onMore?: (() => void) | undefined;
  onSort?: (() => void) | undefined; onTidy?: (() => void) | undefined;
  className?: string | undefined;
}

/** Centres something on `x`, and keeps it `gap` inside a sheet `room` wide. */
const centredOn = (x: number, room: number | undefined, gap = 8): string => (room === undefined ? '-50% 0' : `clamp(${gap - x}px, -50%, calc(${room - gap - x}px - 100%)) 0`);
/** How far below where the bar starts its row of colours and its menu sit. */
const UNDER_BAR = 48;
const POP_GAP = 12;

/** A small bar that only appears on what you've picked, with its row of colours and its menu under it. */
export function BoardSelectionBar({ x, y, room, count = 1, things = 'stickies', colour, textSize = false, picking = false, lineStyle, moreItems, onColour, onPick, onTextSize, onLineStyle, onLine, onDuplicate, onDelete, onMore, onSort, onTidy, className }: BoardSelectionBarProps) {
  return (
    <>
      <div className={cn('bx', className)} style={{ left: x, top: y, translate: centredOn(x, room) }} role="toolbar" aria-label="Selected">
        {count > 1 && <><span className="n">{count} {things}</span><span className="bd-sep" /></>}
        {count > 1 && (onSort || onTidy) && (
          <>
            {onSort && <button type="button" className="wide" title="Written in confidential compute" onClick={onSort}><Icon name="group" size={17} />Sort into themes</button>}
            {onTidy && <button type="button" className="wide" onClick={onTidy}><Icon name="grid" size={16} />Tidy</button>}
            <span className="bd-sep" />
          </>
        )}
        {lineStyle && LINES.map((l) => <IconButton key={l.id} className="bt" icon={l.icon} size={17} label={l.label} aria-pressed={lineStyle === l.id} onClick={() => onLineStyle?.(l.id)} />)}
        {colour && <button type="button" className={cn('sw', `c-${colour}`)} aria-label="Colour" title="Colour" onClick={onColour}><i /></button>}
        {textSize && <IconButton className="bt" icon="textSize" size={18} label="Text size" onClick={onTextSize} />}
        {onLine && <IconButton className="bt" icon="line" size={17} label="Draw a line from this" onClick={onLine} />}
        {onDuplicate && <IconButton className="bt" icon="copy" size={17} label="Duplicate" title="Duplicate · ⌘D" onClick={onDuplicate} />}
        <IconButton className="bt" icon="trash" size={17} label="Delete" onClick={onDelete} />
        {onMore && <IconButton className="bt" icon="more" size={18} label="More" onClick={onMore} />}
      </div>
      {picking && (
        <div className="bx-sw" style={{ left: x, top: y + UNDER_BAR, translate: centredOn(x, room) }}>
          {BOARD_COLOURS.map((c) => <button key={c} type="button" className={`c-${c}`} aria-label={colourName(c)} title={colourName(c)} aria-pressed={colour === c} onClick={() => onPick(c)}><i className="swatch" /></button>)}
        </div>
      )}
      {moreItems && <BoardPop left={x} top={y + UNDER_BAR} translate={centredOn(x, room, POP_GAP)} label="More" items={moreItems} />}
    </>
  );
}

/** The ring round what's selected, in screen pixels, so it never scales with the board. `handles` for what can be sized: each says which corner in `data-h`. */
export function BoardSelectionBox({ x, y, w, h, handles = true }: BoardBox & { handles?: boolean | undefined }) {
  return <div className="bs" style={place({ x, y, w, h })}>{handles && <><i data-h="nw" /><i data-h="ne" /><i data-h="sw" /><i data-h="se" /></>}</div>;
}

export interface BoardDot { x: number; y: number; dir: 'r' | 'l' | 't' | 'b' }
/** The dots a line starts from, just off each edge so they're easy to grab, in screen pixels. Each says which edge in `data-p`. */
export function BoardDots({ points }: { points: BoardDot[] }) {
  return <>{points.map((p) => <span key={p.dir} className="bs-p" data-p={p.dir} style={{ left: p.x, top: p.y }} />)}</>;
}

/** The box dragged out to select, in screen pixels. */
export function BoardMarquee(box: BoardBox) {
  return <div className="bm" style={place(box)} />;
}

/** A line showing what a move has lined up with, across the sheet at `at` screen pixels. `axis` is the axis it marks a place on. */
export function BoardGuide({ axis, at }: { axis: 'x' | 'y'; at: number }) {
  return <i className="bd-guide" style={axis === 'x' ? { left: at, top: 0, width: 1, height: '100%' } : { left: 0, top: at, width: '100%', height: 1 }} />;
}

/* ---------- What's on the board ---------- */

interface ObjectProps extends BoardBox {
  /** Written to `data-id`, which is how the sheet's one listener knows what was pressed. */
  id: string;
  selected?: boolean | undefined;
  /** The colour of whoever else is editing it. */
  other?: string | undefined;
  /** Moves to a new place smoothly, as a sort or a tidy does. */
  glide?: boolean | undefined;
  /** Pops in where it was made, `delay` ms from now. */
  pop?: boolean | undefined;
  delay?: number | undefined;
  /** Picked up, while it's dragged. */
  lift?: boolean | undefined;
  /** A `BoardEdit` while it's being typed in: it takes the place of the text. */
  editor?: ReactNode;
}

function objectAttrs(o: ObjectProps, kind: string, ...more: (string | false | undefined)[]) {
  return {
    'data-id': o.id,
    className: cn('bo', kind, ...more, o.selected && 'is-sel', o.other && 'is-other', o.glide && 'is-glide', o.pop && 'is-pop', o.lift && 'is-lift', o.editor ? 'is-live-edit' : false),
    style: { ...place(o), ...(o.other ? { '--pc': o.other } : {}), ...(o.delay ? { '--d': `${o.delay}ms` } : {}) }
  };
}

/**
 * Keeps a `BoardEdit` over the whole of a text or a shape with its words where they sit at rest, which only the words themselves
 * can say. Words too long for the object take the field past it with them, as they run past it at rest. Returns how to stop.
 */
export function fitBoardEdit(edit: HTMLElement): () => void {
  const object = edit.parentElement, words = object?.querySelector(':scope > .bo-t');
  if (!object?.matches('.k-text, .k-label, .k-shape') || !(words instanceof HTMLElement)) return () => undefined;
  const fit = (): void => {
    const top = Math.min(0, words.offsetTop), bottom = Math.max(object.offsetHeight, words.offsetTop + words.offsetHeight);
    edit.style.top = `${top}px`;
    edit.style.height = `${bottom - top}px`;
    edit.style.paddingTop = `${words.offsetTop - top}px`;
  };
  const sizes = new ResizeObserver(fit);
  sizes.observe(words);
  sizes.observe(object);
  fit();
  return () => sizes.disconnect();
}

/** Where typing goes: over an object, in that object's type. `label` says what's being edited, as in "Edit this sticky". */
export const BoardEdit = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'aria-label'> & { label: string }>(function BoardEdit({ className, label, ...rest }, ref) {
  return <textarea ref={ref} className={cn('bo-edit', className)} aria-label={label} {...rest} />;
});

/** A frame, in board units. `theme`: drawn round a theme after sorting. `dim`: steps back. `land`: arrives from a room, `delay` ms from now. */
export const BoardFrame = memo(function BoardFrame({ id, x, y, w, h, title, sub, hint, land = false, dim = false, theme = false, delay, other, editor }: BoardBox & {
  id: string; title: string;
  /** Beside the title: how many stickies, or who was in the room. */
  sub?: string | undefined;
  /** Shown while it's empty. */
  hint?: string | undefined;
  land?: boolean | undefined; dim?: boolean | undefined; theme?: boolean | undefined; delay?: number | undefined;
  /** The colour of whoever else is typing in its title, which is where the ring goes. */
  other?: string | undefined;
  /** A `BoardEdit` while its title is being typed in. */
  editor?: ReactNode;
}) {
  return (
    <div className={cn('bf', land && 'is-land', dim && 'is-dim', theme && 'is-theme')} data-id={id} style={{ ...place({ x, y, w, h }), ...(delay ? { '--d': `${delay}ms` } : {}) }}>
      <div className={cn('bf-h', other && 'is-other')} style={other ? { '--pc': other } : undefined}>{editor ?? <span className="t">{title.trim()}</span>}{sub && <span className="sub">{sub}</span>}</div>
      {hint && <p className="bf-hint">{hint}</p>}
    </div>
  );
});

/** A sticky. It says nothing about who wrote it. */
export const BoardSticky = memo(function BoardSticky({ colour, text, size = 'm', votes = 0, dots = 0, top = false, muted = false, ...o }: ObjectProps & {
  colour: BoardColour; text: string; size?: 's' | 'm' | 'l' | undefined;
  /** Everyone's votes, once a vote has ended. */
  votes?: number | undefined;
  /** Your own votes while one runs. */
  dots?: number | undefined;
  /** One of the most voted. */
  top?: boolean | undefined;
  /** Didn't make it: it steps back. */
  muted?: boolean | undefined;
}) {
  return (
    <div {...objectAttrs(o, 'k-note', `c-${colour}`, size !== 'm' && `is-${size}`, votes > 0 && 'has-v', dots > 0 && 'has-dots', top && 'is-top', muted && 'is-muted')}>
      {o.editor}
      <p className="bo-t">{text}</p>
      {votes > 0 && <b className="bo-v"><Icon name="vote" size={11} />{votes}</b>}
      {dots > 0 && <span className="bo-dots">{Array.from({ length: dots }, (_, i) => <i key={i} />)}</span>}
    </div>
  );
});

/** Text straight on the board, with no box round it. */
export const BoardText = memo(function BoardText({ text, size = 'title', ...o }: ObjectProps & { text: string; size?: 'title' | 'heading' | 'body' | undefined }) {
  return (
    <div {...objectAttrs(o, size === 'heading' ? 'k-label' : 'k-text', size === 'body' && 'is-body')}>
      {o.editor}
      <p className="bo-t">{text}</p>
    </div>
  );
});

/** A shape. `path` is its outline at `w` by `h`, from `shapePath` in `@alcove/board`. */
export const BoardShape = memo(function BoardShape({ path, colour, text = '', ...o }: ObjectProps & { path: string; colour?: BoardColour | undefined; text?: string | undefined }) {
  return (
    <div {...objectAttrs(o, 'k-shape', colour && `c-${colour}`)}>
      <svg className="bo-sh" viewBox={`0 0 ${o.w} ${o.h}`} preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>
      {o.editor}
      <p className="bo-t">{text}</p>
    </div>
  );
});

/** A picture. `shot`: a moment of someone's screen, framed, with `caption` under it. With no `src` yet it's an empty ground. */
export const BoardPicture = memo(function BoardPicture({ src, shot = false, caption = '', ...o }: Omit<ObjectProps, 'editor'> & { src?: string | undefined; shot?: boolean | undefined; caption?: string | undefined }) {
  const picture = src && <img src={src} alt={caption} draggable={false} />;
  if (!shot) return <div {...objectAttrs(o, 'k-img')}>{picture}</div>;
  return <div {...objectAttrs(o, 'k-shot')}><span className="bo-shot">{picture}</span><p className="bo-t">{caption}</p></div>;
});

/** Moves a pointer without drawing it again, as `moveBoardCamera` moves the board: it's written on a `BoardPointer`'s ref, in board units, and eases there. */
export function moveBoardPointer(pointer: HTMLElement, x: number, y: number): void {
  pointer.style.setProperty('--bcx', `${x}px`);
  pointer.style.setProperty('--bcy', `${y}px`);
}

/**
 * Someone's pointer: a face and a name, never colour alone, in board units. Whoever is `talking` glows, with the same ring
 * as their tile, and dots show who's `typing`. It stays one size whatever the zoom, through `--iz`. `x y` say where it first
 * appears, and `moveBoardPointer` where it goes after that.
 */
export const BoardPointer = memo(forwardRef<HTMLDivElement, {
  x: number; y: number; person: AvatarPerson; name: string; colour: string; talking?: boolean | undefined; typing?: boolean | undefined;
}>(function BoardPointer({ x, y, person, name, colour, talking = false, typing = false }, ref) {
  return (
    <div ref={ref} className={cn('bc', talking && 'is-talk')} style={{ '--bcx': `${x}px`, '--bcy': `${y}px`, '--stage-point': colour }}>
      <SharePointer person={person} name={(
        <>
          <span className="nm">{name}</span>
          {talking && <span className="ac-level" aria-hidden="true"><i /><i /><i /></span>}
          {typing && <span className="bc-type" aria-hidden="true"><i /><i /><i /></span>}
        </>
      )} />
    </div>
  );
}));

/** A comment pinned to something, with their face on the pin, in board units. `open` shows what they said beside it. */
export const BoardComment = memo(function BoardComment({ id, x, y, person, name, text, open = false, onOpen }: {
  id: string; x: number; y: number; person: AvatarPerson; name: string; text: string; open?: boolean | undefined; onOpen?: ((id: string) => void) | undefined;
}) {
  return (
    <>
      <button type="button" className="bo-pin" style={{ left: x, top: y }} aria-label={`Comment from ${name}`} aria-expanded={open} onClick={() => onOpen?.(id)}><Avatar person={person} size={22} /></button>
      {open && <div className="bo-th" style={{ left: x + 30, top: y + 8 }}><b>{name}</b><p>{text}</p></div>}
    </>
  );
});

/* ---------- Over the sheet ---------- */

/** Says the call has heard something worth keeping, and waits. */
export function BoardHeard({ count, onOpen, className }: { count: number; onOpen: () => void; className?: string | undefined }) {
  return <button type="button" className={cn('bd-heard', 'dark', className)} onClick={onOpen}><Icon name="waveform" size={16} />{count === 1 ? '1 idea from the call' : `${count} ideas from the call`}</button>;
}

export interface BoardIdea {
  id: string; person: AvatarPerson; text: string;
  /** Who said it, and when. */
  sub: string;
  added?: boolean | undefined;
}

const addAllLabel = (n: number): string => (n === 2 ? 'Add both' : n === 3 ? 'Add all three' : `Add all ${n}`);

/** Ideas the call heard, each with who said it. */
export function BoardTray({ ideas, onClose, onAdd, onAddAll, className }: { ideas: BoardIdea[]; onClose: () => void; onAdd: (id: string) => void; onAddAll: () => void; className?: string | undefined }) {
  return (
    <div className={cn('bd-tray', className)} role="dialog" aria-label="Ideas from the call">
      <div className="hd"><Icon name="waveform" size={16} />From the call<span className="sp"><Icon name="sealed" size={13} />Written in confidential compute</span><IconButton className="bt" icon="x" size={16} label="Close" onClick={onClose} /></div>
      {ideas.map((l) => (
        <div key={l.id} className="ln">
          <Avatar person={l.person} size={24} />
          <p>{l.text}<small>{l.sub}</small></p>
          <Button variant="secondary" size="sm" disabled={l.added} onClick={() => onAdd(l.id)}>{l.added ? 'Added' : 'Add'}</Button>
        </div>
      ))}
      {ideas.length > 1 && <div className="ft"><Button variant="primary" size="sm" onClick={onAddAll}>{addAllLabel(ideas.length)}</Button></div>}
    </div>
  );
}

/** Where you are on a board too big for the sheet. `blocks` are its frames, `bounds` all of it and `view` what the sheet shows, all in board units. */
export function BoardMap({ blocks, bounds, view, className }: { blocks: BoardBox[]; bounds: BoardBox; view: BoardBox; className?: string | undefined }) {
  const x = Math.min(bounds.x, view.x);
  const y = Math.min(bounds.y, view.y);
  const k = Math.min(160 / (Math.max(bounds.x + bounds.w, view.x + view.w) - x), 100 / (Math.max(bounds.y + bounds.h, view.y + view.h) - y));
  const onMap = (b: BoardBox): CSSProperties => place({ x: 6 + (b.x - x) * k, y: 6 + (b.y - y) * k, w: b.w * k, h: b.h * k });
  return <div className={cn('bi bd-map', className)} aria-hidden="true">{blocks.map((b, i) => <i key={i} style={onMap(b)} />)}<b style={onMap(view)} /></div>;
}

/** What a blank board says, until the first sticky. `fading` as that sticky lands: it goes on being drawn until it has gone. */
export function BoardEmpty({ fading = false, className }: { fading?: boolean | undefined; className?: string | undefined }) {
  return (
    <div className={cn('bd-empty', fading && 'is-faded', className)}>
      <EmptyArch />
      <b>Double-click anywhere to add a sticky</b>
      <span>Or press N. Everyone here can add to this board.</span>
    </div>
  );
}

/** What a board's own page has that a call doesn't: who else is here, and Start a call here. Goes in `BoardLayout`, after the sheet. */
export function BoardPageActions({ people, onCall, className }: { people: AvatarPerson[]; onCall: () => void; className?: string | undefined }) {
  return (
    <div className={cn('bpg-acts', className)}>
      {people.length > 0 && <Faces people={people} size={30} max={2} />}
      <Button variant="primary" icon="video" onClick={onCall}>Start a call here</Button>
    </div>
  );
}

/** In the board's place for someone it wasn't opened to: says whose it is, and nothing about what's on it. */
export function BoardNoAccess({ owner, onAsk, className }: { owner: string; onAsk: () => void; className?: string | undefined }) {
  return (
    <div className={cn('bd-noaccess', className)}>
      <div>
        <Icon name="lock" size={28} />
        <h3>A board you can’t open</h3>
        <p>{owner} keeps it in a workspace you’re not in.</p>
        <Button variant="secondary" onClick={onAsk}>Ask {owner} for access</Button>
      </div>
    </div>
  );
}

/* ---------- The Board menu ---------- */

export type BoardTemplate = 'blank' | 'retro' | 'ideas' | 'flow';

/* The coloured art is `.light`, so it stays the bright stickies it stands for in either theme. */

const TEMPLATES: { id: BoardTemplate; label: string; art: ReactNode }[] = [
  { id: 'blank', label: 'Blank', art: <path d="M40 24v12M34 30h12" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" fill="none" /> },
  { id: 'retro', label: 'Retro', art: <g className="light"><rect x="7" y="10" width="20" height="40" rx="3" fill="var(--note-butter)" /><rect x="30" y="10" width="20" height="40" rx="3" fill="var(--note-rose)" /><rect x="53" y="10" width="20" height="40" rx="3" fill="var(--note-sky)" /></g> },
  { id: 'ideas', label: 'Ideas', art: <g className="light"><rect x="10" y="12" width="15" height="15" rx="2" fill="var(--note-butter)" /><rect x="32" y="8" width="15" height="15" rx="2" fill="var(--note-lilac)" /><rect x="54" y="16" width="15" height="15" rx="2" fill="var(--note-peach)" /><rect x="20" y="33" width="15" height="15" rx="2" fill="var(--note-sky)" /><rect x="44" y="36" width="15" height="15" rx="2" fill="var(--note-rose)" /></g> },
  { id: 'flow', label: 'Flow', art: <g fill="none" stroke="var(--ink-2)" strokeWidth="1.6" strokeLinejoin="round"><rect x="6" y="23" width="18" height="14" rx="7" /><path d="M41 19 53 30 41 41 29 30Z" /><rect x="60" y="11" width="15" height="12" rx="2" /><rect x="60" y="37" width="15" height="12" rx="2" /><path d="M24 30h5M53 30h3v-13h4M56 30v13h4" /></g> }
];

/** A small picture for a saved board in the Board menu. */
export function BoardMenuThumb({ kind }: { kind: 'flow' | 'columns' }) {
  return (
    <svg viewBox="0 0 38 38" aria-hidden="true">
      {kind === 'flow'
        ? <g fill="none" stroke="var(--ink-2)" strokeWidth="1.4" strokeLinejoin="round"><rect x="3" y="15" width="10" height="8" rx="4" /><path d="M22 11 29 19 22 27 15 19Z" /><path d="M13 19h2M29 19h6" /></g>
        : <g className="light"><rect x="5" y="8" width="8" height="22" rx="2" fill="var(--note-butter)" /><rect x="15" y="8" width="8" height="22" rx="2" fill="var(--note-rose)" /><rect x="25" y="8" width="8" height="22" rx="2" fill="var(--note-sky)" /></g>}
    </svg>
  );
}

export interface BoardMenuRecent {
  id: string; name: string;
  /** Whose it is. */
  by: string;
  /** When it was last used, as it should read. */
  when: string;
  thumb?: ReactNode;
}

/** The team's recent boards, and the workspace they're from. */
export interface BoardMenuRecents { workspace: string; boards: BoardMenuRecent[] }

/** Some people here can't open the saved board: the opener decides before anything opens. */
export interface BoardMenuAccess {
  names: string[];
  board: string;
  /** Where it's kept, as it should read after "It’s in". */
  where: string;
  onLetIn: () => void; onWithout: () => void;
}

const namesList = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/**
 * The Board button's menu, rising from `anchor` (the dock's button): a new board from a template, the team's recent boards
 * and, in place of those, the access step. `inRoom` says it's only for this room, and leaves the saved boards out.
 */
export function BoardMenu({ open, onOpenChange, anchor, inRoom = false, recents, access, onTemplate, onRecent, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: ReactNode; inRoom?: boolean | undefined;
  recents?: BoardMenuRecents | undefined;
  access?: BoardMenuAccess | undefined;
  onTemplate: (template: BoardTemplate) => void; onRecent?: ((id: string) => void) | undefined; className?: string | undefined;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} side="top" align="center" label="Open a board" className={cn('bl', className)}>
      <div className="bl-h"><span>New board</span><small>{inRoom ? 'Only this room sees it' : 'Opens for everyone here'}</small></div>
      <div className="bl-tpl">
        {TEMPLATES.map((t) => <button key={t.id} type="button" className="bl-c" onClick={() => onTemplate(t.id)}><span className="bl-th"><svg viewBox="0 0 80 60" aria-hidden="true">{t.art}</svg></span><span className="lb">{t.label}</span></button>)}
      </div>
      {!access && !inRoom && recents && recents.boards.length > 0 && (
        <>
          <div className="bl-sub">From {recents.workspace}</div>
          {recents.boards.map((r) => <button key={r.id} type="button" className="bl-r" onClick={() => onRecent?.(r.id)}><span className="bl-th">{r.thumb}</span><span><b>{r.name}</b><small>{r.by}</small></span><span className="when">{r.when}</span></button>)}
        </>
      )}
      {access && (
        <div className="bl-q">
          <p><b>{namesList(access.names)} can’t open {access.board}.</b> It’s in {access.where}.</p>
          <div className="acts"><Button variant="primary" onClick={access.onLetIn}>Let them in for this call</Button><Button variant="secondary" onClick={access.onWithout}>Open without them</Button></div>
        </div>
      )}
      <div className="bl-f"><Icon name="sealed" size={15} /><span>{inRoom ? 'Comes back with you when rooms close. Alcove can’t read it.' : 'Sealed. Alcove can’t read boards.'}</span></div>
    </Popover>
  );
}

/* ---------- A live tile ---------- */

/**
 * The board as a tile, drawn small from its own full size: `children` is a `mini` sheet at `w` by `h`, shrunk by `scale`.
 * `compact` is the one that sits above the tiles beside a big share, and takes its height from `style`.
 */
export function BoardTile({ person, name, label, w, h, scale, compact = false, onOpen, style, className, children }: {
  /** Whoever opened it. */
  person: AvatarPerson; name: string;
  /** What pressing it does: Open the board, Go back to the board. */
  label: string;
  w: number; h: number; scale: number; compact?: boolean | undefined; onOpen: () => void;
  style?: CSSProperties | undefined; className?: string | undefined; children: ReactNode;
}) {
  return (
    <button type="button" className={cn('bd-tile', compact && 'is-col', className)} style={style} aria-label={label} onClick={onOpen}>
      <span className="bd-mini" style={{ width: w, height: h, transform: `scale(${scale})` }}>{children}</span>
      <span className="ac-tile-name"><Avatar person={person} size={compact ? 16 : 18} />{name}</span>
      {!compact && <span className="open"><Icon name="grow" size={16} /></span>}
    </button>
  );
}

/* ---------- On a phone ---------- */

/** The phone's one tool: tap to add a sticky. */
export function BoardPhoneAdd({ onAdd, className }: { onAdd: () => void; className?: string | undefined }) {
  return <button type="button" className={cn('pc-add', className)} aria-label="Add a sticky" onClick={onAdd}><Icon name="plus" size={24} /></button>;
}

const PHONE_COLOURS = BOARD_COLOURS.filter((c) => c !== 'mist');

/** One sticky, a colour and a button that says where it's going, rising from the bottom of the phone. */
export function BoardPhoneSheet({ text, colour, target, onText, onColour, onAdd, className }: {
  text: string; colour: BoardColour;
  /** Where it's going: the frame, or the room. */
  target: string;
  onText: (text: string) => void; onColour: (colour: BoardColour) => void; onAdd: () => void; className?: string | undefined;
}) {
  return (
    <div className={cn('pc-sheet', className)} role="dialog" aria-label="Add a sticky">
      <div className="grab" />
      <textarea className={cn('pc-note', `c-${colour}`)} aria-label="What the sticky says" value={text} onChange={(e) => onText(e.target.value)} />
      <div className="row">
        {PHONE_COLOURS.map((c) => <button key={c} type="button" className={cn('sw', `c-${c}`)} aria-pressed={colour === c} aria-label={colourName(c)} onClick={() => onColour(c)}><i className="swatch" /></button>)}
      </div>
      <Button variant="primary" disabled={!text.trim()} onClick={onAdd}>Add to {target}</Button>
    </div>
  );
}
