/*
 * The board's parts: the sheet, what's on it and the controls around it. All of it is drawn from props, with no idea where
 * the data lives. The camera is one transform on `BoardWorld`, written through a ref by `moveBoardCamera`, so objects place
 * themselves in board units and never draw again when it moves. Objects take no handlers either: `data-id`, `data-h` and
 * `data-p` say what was pressed, so one listener on the sheet serves them all, and `memo` keeps a busy board from drawing
 * anything that didn't change.
 */
import { forwardRef, memo, useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../cn';
import { CallDock, DockButton, DockSeparator, SharePointer, ShareStepHead } from './call';
import { Icon, type IconName } from './icon';
import { EmptyArch } from './illustrations';
import { Popover } from './overlay';
import { Avatar, Faces, type AvatarPerson } from './people';
import { Button, IconButton } from './primitives';
import { useSettledPress } from './settle';

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

/**
 * A line, with its arrowhead. `id` lets it be pressed, through a wider path that isn't drawn. `draft`: the one being drawn, as
 * dots. `settle`: it's just been let go. `land`: it arrives from a room with its frame, this many ms from now.
 */
export const BoardLine = memo(function BoardLine({ id, d, head, selected = false, draft = false, settle = false, land }: { id?: string | undefined; d: string; head?: string | undefined; selected?: boolean | undefined; draft?: boolean | undefined; settle?: boolean | undefined; land?: number | undefined }) {
  const state = cn(selected && 'is-sel', draft && 'is-draft', land !== undefined ? 'is-land' : settle && 'is-settle');
  const style = land ? ({ '--d': `${land}ms` } as const) : undefined;
  return <>{id && <path className="bd-hit" data-id={id} d={d} />}<path className={state} d={d} style={style} />{head && <path className={cn('head', state)} d={head} style={style} />}</>;
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
export function BoardRail({ tool, onTool, more = BOARD_MORE, onMore, moreOpen = false, faded = false, className }: {
  tool: BoardTool; onTool: (tool: BoardTool) => void;
  /** What More holds. With nothing, there's no More: a button that opens nothing is a dead end. */
  more?: readonly BoardMoreItem[] | undefined;
  onMore: () => void; moreOpen?: boolean | undefined; faded?: boolean | undefined; className?: string | undefined;
}) {
  const holds = MORE.filter((m) => more.includes(m.id));
  return (
    <CallDock label="Tools" className={cn('bz-rail', faded && 'is-faded', className)}>
      {RAIL.map((t) => <DockButton key={t.tool} icon={t.icon} label={t.label} on={tool === t.tool} aria-pressed={tool === t.tool} data-tool={t.tool} onClick={() => onTool(t.tool)} />)}
      {holds.length > 0 && (
        <>
          <DockSeparator />
          <DockButton icon="plus" label={`More: ${holds.map((m) => m.many).join(', ')}`} title="More" aria-expanded={moreOpen} onClick={onMore} />
        </>
      )}
    </CallDock>
  );
}

/** The board's name being changed, in its place in the bar: Enter or leaving it keeps what's typed, Escape puts the name back. */
export interface BoardNaming {
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  onCancel: () => void;
}

export interface BoardBarProps {
  name: string;
  /** The name as a field, while it's being renamed. */
  naming?: BoardNaming | undefined;
  /** What the seal says: Sealed, Sealed to this room, Reconnecting, Not saved, View only. Empty hides it. */
  seal?: string | undefined;
  sealIcon?: IconName | undefined;
  /** What the seal says on hover, which is what's true of it now. */
  sealTitle?: string | undefined;
  /** What comes last: on a board's own page, who else is here and Start a call here (`BoardPageActions`). */
  tail?: ReactNode;
  /** What the menu under the name lets this person do, on hover. */
  nameTitle?: string | undefined;
  /** The camera's zoom, shown as a percentage. */
  zoom: number;
  canUndo?: boolean | undefined;
  canRedo?: boolean | undefined;
  /** Undo and Redo: false for someone who can only look. */
  editable?: boolean | undefined;
  /** Timer, Vote and Present, each shown only with its handler: false where there's no session to run. More shows whenever it's given. */
  acts?: boolean | undefined;
  /** Whether this person can start a timer, a vote or present: false for someone who can only look, who sees them disabled, saying why. More stays theirs. */
  canAct?: boolean | undefined;
  /** More is open, so its button says so. */
  moreOn?: boolean | undefined;
  mapOn?: boolean | undefined;
  faded?: boolean | undefined;
  onName: () => void; onSeal: () => void;
  onUndo?: (() => void) | undefined; onRedo?: (() => void) | undefined;
  onZoomOut: () => void; onFit: () => void; onZoomIn: () => void; onMap: () => void;
  onTimer?: (() => void) | undefined; onVote?: (() => void) | undefined; onPresent?: (() => void) | undefined; onMore?: (() => void) | undefined;
  className?: string | undefined;
}

/** The board's name as a field, with all of it selected to type over. Its keys go no further than it. */
function NameField({ naming }: { naming: BoardNaming }) {
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    // The name comes back in the field's place: the keys go to the sheet first, so nothing focused is taken out from under them.
    field.current?.closest<HTMLElement>('.bd')?.focus({ preventScroll: true });
    if (keep) naming.onDone(); else naming.onCancel();
  };
  return (
    <input ref={field} className="nm-in" aria-label="The board’s name" value={naming.value} maxLength={200} autoComplete="off" spellCheck={false} enterKeyHint="done"
      onChange={(e) => naming.onChange(e.target.value)} onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      }} />
  );
}

/** Why Timer, Vote and Present can't be pressed by someone who can only look at a board. */
const ONLY_EDITORS = {
  timer: 'Only people who can add to this board can start a timer',
  vote: 'Only people who can add to this board can vote',
  present: 'Only people who can add to this board can present'
} as const;

/** A button on the bar that someone who can only look sees, disabled, with why in its tip: a disabled button can't show a tip. */
function Barred({ icon, size, label, why }: { icon: IconName; size: number; label: string; why: string }) {
  return <IconButton className="bt run" icon={icon} size={size} label={label} title={why} aria-disabled="true" />;
}

/** Everything about the board that isn't a tool, in one line along the top of the sheet. */
export function BoardBar({ name, naming, nameTitle = 'Rename, share or copy a link', seal = 'Sealed', sealIcon = 'sealed', sealTitle = 'Sealed. Alcove can’t read this board.', tail, zoom, canUndo = false, canRedo = false, editable = true, acts = true, canAct = true, moreOn = false,
  mapOn = false, faded = false, onName, onSeal, onUndo, onRedo, onZoomOut, onFit, onZoomIn, onMap, onTimer, onVote, onPresent, onMore, className }: BoardBarProps) {
  return (
    <div className={cn('bd-head', acts && editable && 'is-full', faded && 'is-faded', className)}>
      {naming ? <NameField naming={naming} />
        : <button type="button" className="nm" title={nameTitle} aria-haspopup="dialog" onClick={onName}><Icon name="presenter" size={16} /><span>{name}</span><Icon name="down" size={14} /></button>}
      {seal && <button type="button" className="sv" title={sealTitle} onClick={onSeal}><Icon name={sealIcon} size={15} /><span>{seal}</span></button>}
      <span className="sp" />
      {editable && (
        <>
          <IconButton className="bt ur" icon="undo" size={17} label="Undo" title="Undo your last change · ⌘Z" disabled={!canUndo} onClick={onUndo} />
          <IconButton className="bt ur" icon="redo" size={17} label="Redo" title="Redo · ⇧⌘Z" disabled={!canRedo} onClick={onRedo} />
          <span className="vr ur" />
        </>
      )}
      <IconButton className="bt zm" icon="minus" size={16} label="Zoom out" onClick={onZoomOut} />
      <button type="button" className="pct" title="Show everything · ⇧1" onClick={onFit}>{Math.round(zoom * 100)}%</button>
      <IconButton className="bt zm" icon="plus" size={16} label="Zoom in" onClick={onZoomIn} />
      <IconButton className="bt zm mp" icon="map" size={16} label="Map" aria-pressed={mapOn} onClick={onMap} />
      {/*
        * Each is there only with something to do: no button does nothing. Someone who can only look sees Timer, Vote and Present
        * where they're offered, disabled, saying why. More changes nothing on the board, so it's there for them, and while
        * following someone, too.
        */}
      {((acts && (onTimer || onVote || onPresent)) || onMore) && (
        <>
          <span className="vr" />
          {acts && onTimer && (canAct ? <IconButton className="bt run" icon="timer" size={17} label="Timer" onClick={onTimer} /> : <Barred icon="timer" size={17} label="Timer" why={ONLY_EDITORS.timer} />)}
          {acts && onVote && (canAct ? <IconButton className="bt run" icon="vote" size={17} label="Vote" onClick={onVote} /> : <Barred icon="vote" size={17} label="Vote" why={ONLY_EDITORS.vote} />)}
          {acts && onPresent && (canAct ? <IconButton className="bt run" icon="play" size={15} label="Present" onClick={onPresent} /> : <Barred icon="play" size={15} label="Present" why={ONLY_EDITORS.present} />)}
          {onMore && <IconButton className="bt" icon="more" size={17} label="More" aria-expanded={moreOn} onClick={onMore} />}
        </>
      )}
      {tail}
    </div>
  );
}

/**
 * Anything the whole board shares, in one place: a timer, a vote, following, a room's time, someone presenting. `soon` turns it
 * amber. `second` is a second thing to do after `action`, for someone who has more to do there: the organizer stopping someone
 * else's presentation. It says what it says as it arrives and as its words change; a time ticking isn't read out every second,
 * and is there to read.
 */
export function BoardPill({ icon = 'clock', title, text, time, soon = false, action, onAction, second, said, className }: {
  /** `null` for no icon. */
  icon?: IconName | null | undefined;
  title?: string | undefined; text?: string | undefined; time?: string | undefined; soon?: boolean | undefined;
  action?: string | undefined; onAction?: (() => void) | undefined; second?: { label: string; onClick: () => void } | undefined;
  /**
   * For words that change too often to read out each time, as a countdown's do: what a screen reader is told instead, each time
   * this changes ('' for nothing yet). Given, the pill's own words change on screen only, and are there to read.
   */
  said?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn('bd-pill', 'dark', soon && 'is-soon', action && 'has-act', className)} role={said === undefined ? 'status' : undefined}>
      {icon && <Icon name={icon} size={16} fill="none" />}
      {title && <b className="ac-clamp-1">{title}</b>}
      {text && <span>{text}</span>}
      {time && (title || text) && <span className="sep" />}
      {time && <span className="t" aria-live="off">{time}</span>}
      {said !== undefined && <p className="sr-only" role="status">{said}</p>}
      {action && <button type="button" onClick={onAction}>{action}</button>}
      {second && <button type="button" onClick={second.onClick}>{second.label}</button>}
    </div>
  );
}

/** What whoever's presenting a board has around it: where they are, the next frame, their notes, and the way on. */
export interface BoardPresenting {
  /** Which frame everyone is on, from 1, and how many there are. */
  at: number;
  total: number;
  /** A picture of the next frame, drawn at `NEXT_FRAME` and shrunk to fit; null at the end. */
  next: ReactNode | null;
  /** Their notes beside this frame, or null for someone without an account, who has nowhere to keep them. */
  notes: string | null;
  onNotes: (notes: string) => void;
  onBack: () => void;
  onNext: () => void;
  onStop: () => void;
}

/** The size the next frame's picture is drawn at before it's shrunk into its place: the canvas's board on a call's stage. */
export const NEXT_FRAME = { w: 1114, h: 674 } as const;
/** The room the next frame's picture has, beside the board. */
const NEXT_W = 248;

/**
 * The board on a call's stage, and, while you're presenting it, your view of it: the frame as everyone sees it, ringed and
 * marked so, with where it is, Back a frame, Next frame and Stop presenting under it, and beside it, for you alone, the next
 * frame and your notes. `children` is the board, which stays where it is in the page whether you're presenting or not, so it's
 * never drawn afresh: what you were doing on it is as you left it when you stop. On a narrow stage the notes go under it.
 */
export function BoardPresenter({ presenting, className, children }: { presenting: BoardPresenting | null; className?: string | undefined; children: ReactNode }) {
  const p = presenting;
  return (
    <div className={cn('bd-pres', p && 'is-on', className)}>
      <div className="bd-pres-in">
        <div className="pm">
          <div className="shown">
            {p && <span className="tag"><Icon name="eye" size={15} />Everyone sees this</span>}
            {children}
          </div>
          {p && (
            // aria-disabled, not disabled, at either end: the keys stay on the button pressed.
            <div className="ctl">
              <button type="button" className="go" aria-label="Back a frame" title="Back a frame · ←" aria-keyshortcuts="ArrowLeft" aria-disabled={p.at <= 1 || undefined} onClick={() => { if (p.at > 1) p.onBack(); }}><Icon name="chevronLeft" size={20} /></button>
              <span className="at" aria-live="polite">{p.at} of {p.total}</span>
              <button type="button" className="go" aria-label="Next frame" title="Next frame · →" aria-keyshortcuts="ArrowRight" aria-disabled={p.at >= p.total || undefined} onClick={() => { if (p.at < p.total) p.onNext(); }}><Icon name="chevron" size={20} /></button>
              <button type="button" className="stop" onClick={p.onStop}>Stop presenting</button>
            </div>
          )}
        </div>
        {p && (
          <aside className="side" aria-label="Only you see this">
            <span className="lab">Next</span>
            <div className="nx">
              {p.next ? <span className="bd-mini" style={{ width: NEXT_FRAME.w, height: NEXT_FRAME.h, transform: `scale(${NEXT_W / NEXT_FRAME.w})` }}>{p.next}</span>
                : <span className="end">That’s the end</span>}
            </div>
            {p.notes !== null && (
              <label className="pn">
                <span className="lab">Only you see this</span>
                <textarea value={p.notes} placeholder="Notes for this frame" aria-label="Your notes" spellCheck onChange={(e) => p.onNotes(e.target.value)} />
              </label>
            )}
          </aside>
        )}
      </div>
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
  /** A choice of up to three. Each `id` is unique among them, and the same for as long as the choice is there. */
  options?: { id: string; label: string; on: boolean; onPick: () => void }[] | undefined;
  /**
   * Things to do. Each `id` is unique among them, and the same for as long as the item is there, so a press never lands on
   * another item's action as items come and go. `small` sits at the end of the line.
   */
  items?: { id: string; icon: IconName; label: string; small?: string | undefined; onPick: () => void }[] | undefined;
  /** The one button at the bottom. */
  action?: { label: string; onPick: () => void } | undefined;
  /** Moves it from where `left` puts it, as `BoardSelectionBar` does to keep its menu on the sheet. */
  translate?: string | undefined;
  className?: string | undefined;
}

/**
 * A small menu on the sheet, opened from the bar. Say where with `left` or `right`, and `top`. For a moment after what's in
 * it moves, a press does nothing (`useSettledPress`), as in every menu.
 */
export const BoardPop = forwardRef<HTMLDivElement, BoardPopProps>(function BoardPop({ left, right, top, title, sub, label, rows, options, items, action, translate, className }, ref) {
  const settled = useSettledPress([
    title ? 'title' : '', sub ? 'sub' : '', ...(rows ?? []).map((_, i) => `row:${i}`), ...(options ?? []).map((o) => `option:${o.id}`),
    ...(items ?? []).map((i) => `item:${i.id}`), action ? 'action' : ''
  ].join('\n'));
  return (
    <div ref={ref} className={cn('bp', className)} style={{ left, right, top, translate }} role="dialog" aria-label={title ?? label}>
      {title && <div className="hd">{title}</div>}
      {sub && <div className="sub">{sub}</div>}
      {rows && <div className="rows">{rows.map((r, i) => <div key={i}><Icon name={r.icon} size={15} /><span>{r.text}</span></div>)}</div>}
      {options && <div className="opts">{options.map((o) => <button key={o.id} type="button" className="opt" aria-pressed={o.on} onClick={settled(o.onPick)}>{o.label}</button>)}</div>}
      {items?.map((i) => <button key={i.id} type="button" className="mi" onClick={settled(i.onPick)}><Icon name={i.icon} size={17} /><span>{i.label}</span>{i.small && <small>{i.small}</small>}</button>)}
      {action && <div className="ft"><Button variant="primary" onClick={settled(action.onPick)}>{action.label}</Button></div>}
    </div>
  );
});

/* ---------- A tool's options ---------- */

export type BoardMoreItem = 'image' | 'workspace' | 'table' | 'mindMap' | 'comment' | 'templates';
/** More's items in the canvas's order, each with what the rail's More calls a few of them. */
const MORE: { id: BoardMoreItem; icon: IconName; label: string; many: string; key?: string }[] = [
  { id: 'image', icon: 'image', label: 'Image', many: 'images' },
  { id: 'workspace', icon: 'fileText', label: 'From your workspace', many: 'documents' },
  { id: 'table', icon: 'table', label: 'Table', many: 'tables' },
  { id: 'mindMap', icon: 'workflow', label: 'Mind map', many: 'mind maps' },
  { id: 'comment', icon: 'commentBubble', label: 'Comment', many: 'comments', key: 'K' },
  { id: 'templates', icon: 'layoutTemplate', label: 'Templates', many: 'templates' }
];
/** Everything More can hold, in its order. */
export const BOARD_MORE: readonly BoardMoreItem[] = MORE.map((m) => m.id);
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
  | { kind: 'more'; items: readonly BoardMoreItem[]; onMore: (item: BoardMoreItem) => void }
);

/** A tool's options, beside the rail and level with that tool. */
export function BoardFlyout(props: BoardFlyoutProps) {
  const cls = cn('bfly', `is-${props.kind}`, props.className);
  if (props.kind === 'more') {
    const { items } = props;
    return (
      <div className={cn(cls, items.length < MORE.length && 'is-few')}>
        {MORE.filter((m) => items.includes(m.id)).map((m) => <button key={m.id} type="button" className="item" aria-keyshortcuts={m.key} onClick={() => props.onMore(m.id)}><Icon name={m.icon} size={18} />{m.label}{m.key && <kbd aria-hidden="true">{m.key}</kbd>}</button>)}
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
  /** Sort into themes is waiting for its answer: it says so, and can't be pressed again. */
  sorting?: boolean | undefined;
  className?: string | undefined;
}

/** Centres something on `x`, and keeps it `gap` inside a sheet `room` wide. */
const centredOn = (x: number, room: number | undefined, gap = 8): string => (room === undefined ? '-50% 0' : `clamp(${gap - x}px, -50%, calc(${room - gap - x}px - 100%)) 0`);
/** How far below where the bar starts its row of colours and its menu sit. */
const UNDER_BAR = 48;
const POP_GAP = 12;

/** A small bar that only appears on what you've picked, with its row of colours and its menu under it. */
export function BoardSelectionBar({ x, y, room, count = 1, things = 'stickies', colour, textSize = false, picking = false, lineStyle, moreItems, onColour, onPick, onTextSize, onLineStyle, onLine, onDuplicate, onDelete, onMore, onSort, onTidy, sorting = false, className }: BoardSelectionBarProps) {
  return (
    <>
      <div className={cn('bx', className)} style={{ left: x, top: y, translate: centredOn(x, room) }} role="toolbar" aria-label="Selected">
        {count > 1 && <><span className="n">{count} {things}</span><span className="bd-sep" /></>}
        {count > 1 && (onSort || onTidy) && (
          <>
            {onSort && (
              <button type="button" className="wide" title="Written in confidential compute" disabled={sorting} aria-busy={sorting} onClick={onSort}>
                <Icon name="group" size={17} />{sorting ? 'Sorting…' : 'Sort into themes'}
              </button>
            )}
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
  /** Arrives from a room with its frame, `delay` ms from now. */
  land?: boolean | undefined;
  delay?: number | undefined;
  /** Picked up, while it's dragged. */
  lift?: boolean | undefined;
  /** A `BoardEdit` while it's being typed in: it takes the place of the text. */
  editor?: ReactNode;
}

function objectAttrs(o: ObjectProps, kind: string, ...more: (string | false | undefined)[]) {
  return {
    'data-id': o.id,
    className: cn('bo', kind, ...more, o.selected && 'is-sel', o.other && 'is-other', o.glide && 'is-glide', o.land ? 'is-land' : o.pop && 'is-pop', o.lift && 'is-lift', o.editor ? 'is-live-edit' : false),
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
export const BoardSticky = memo(function BoardSticky({ colour, text, size = 'm', votes = 0, dots = 0, top = false, muted = false, ballot, ...o }: ObjectProps & {
  colour: BoardColour; text: string; size?: 's' | 'm' | 'l' | undefined;
  /** Everyone's votes, once a vote has ended. */
  votes?: number | undefined;
  /** Your own votes while one runs. */
  dots?: number | undefined;
  /** One of the most voted. */
  top?: boolean | undefined;
  /** Didn't make it: it steps back. */
  muted?: boolean | undefined;
  /**
   * In a vote you can vote in: the keys can be put on it (the board moves them from sticky to sticky with Tab), and Enter or
   * Space votes for it or takes the vote back, as a press does. A screen reader hears its words as a toggle button: pressed
   * once it has your vote (`voted`), and dimmed while you've no vote left to give it (`spent`).
   */
  ballot?: 'voted' | 'open' | 'spent' | undefined;
}) {
  const votable = ballot ? {
    role: 'button', tabIndex: -1, 'aria-pressed': ballot === 'voted', 'aria-disabled': ballot === 'spent' || undefined,
    'aria-label': text.trim() ? undefined : 'A sticky with nothing on it'
  } : {};
  return (
    <div {...objectAttrs(o, 'k-note', `c-${colour}`, size !== 'm' && `is-${size}`, votes > 0 && 'has-v', dots > 0 && 'has-dots', top && 'is-top', muted && 'is-muted', ballot && 'is-ballot')} {...votable}>
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

/* ---------- More's objects: a table, a mind map's ideas, and something from the workspace ---------- */

/** A row or a column of a `BoardTable`: its id, which its cells are keyed by, and its share of the table's size. */
export interface BoardTableLine { id: string; size: number }

/**
 * A table, in board units. Its columns and rows share its width and height by their sizes, and each cell says its words, read
 * by `<rowId>:<colId>` and written to `data-cell`, which is how a double-click finds the cell to type in. While it's selected,
 * it offers a row at the bottom and a column at the right.
 */
export const BoardTable = memo(function BoardTable({ cols, rows, cells, editing, onAddRow, onAddCol, ...o }: ObjectProps & {
  cols: readonly BoardTableLine[]; rows: readonly BoardTableLine[];
  cells: Readonly<Record<string, string>>;
  /** The cell being typed in, by its key, and its `BoardEdit`. */
  editing?: { key: string; editor: ReactNode } | undefined;
  onAddRow?: (() => void) | undefined; onAddCol?: (() => void) | undefined;
}) {
  const share = (lines: readonly BoardTableLine[]) => lines.map((l) => `${Math.max(1, l.size)}fr`).join(' ');
  return (
    <div {...objectAttrs({ ...o, editor: undefined }, 'k-table')}>
      <div className="bo-grid" style={{ gridTemplateColumns: share(cols), gridTemplateRows: share(rows) }}>
        {rows.flatMap((row, r) => cols.map((col) => {
          const key = `${row.id}:${col.id}`, live = editing?.key === key;
          return (
            <div key={key} className={cn('bo-cell', r === 0 && 'is-head', live && 'is-live-edit')} data-cell={key}>
              {live && editing.editor}
              <p className="bo-t">{cells[key] ?? ''}</p>
            </div>
          );
        }))}
      </div>
      {o.selected && onAddRow && <button type="button" className="bo-add is-row" aria-label="Add a row" title="Add a row" onClick={onAddRow}><Icon name="plus" size={14} /></button>}
      {o.selected && onAddCol && <button type="button" className="bo-add is-col" aria-label="Add a column" title="Add a column" onClick={onAddCol}><Icon name="plus" size={14} /></button>}
    </div>
  );
});

/** An idea in a mind map. `first`: the one the map starts from, which has nothing it branches from. */
export const BoardNode = memo(function BoardNode({ text, first = false, ...o }: ObjectProps & { text: string; first?: boolean | undefined }) {
  return (
    <div {...objectAttrs(o, 'k-node', first && 'is-first')}>
      {o.editor}
      <p className="bo-t">{text}</p>
    </div>
  );
});

/**
 * Something from the workspace on the board: a document or a board, by its reader's own name for it. Someone who can't open
 * it is told so, and nothing of its name. `onOpen` opens it, for whoever can.
 */
export const BoardLink = memo(function BoardLink({ name, kind = 'document', onOpen, ...o }: Omit<ObjectProps, 'editor'> & {
  /** What it's called for whoever's looking, or null if they can't open it. */
  name: string | null;
  kind?: 'document' | 'board' | undefined;
  onOpen?: (() => void) | undefined;
}) {
  const icon: IconName = name === null ? 'lock' : kind === 'board' ? 'presentation' : 'fileText';
  return (
    <div {...objectAttrs(o, 'k-link', name === null && 'is-closed')}>
      <span className="bo-li"><Icon name={icon} size={20} /></span>
      <p className="bo-t">{name === null ? 'A document you can’t open' : name.trim() || (kind === 'board' ? 'Untitled board' : 'Untitled')}</p>
      {name !== null && onOpen && <button type="button" className="bo-open" aria-label={`Open ${name.trim() || 'it'}`} title="Open it" onClick={onOpen}><Icon name="right" size={15} /></button>}
    </div>
  );
});

/**
 * What one of More's items offers, beside the rail where More was: the templates, or what's in the workspace. Each choice has an
 * id, and for a moment after the choices move (the workspace's items coming in as it opens) a press does nothing.
 */
export function BoardFlyList({ label, items, empty, className }: {
  label: string;
  items: readonly { id: string; icon: IconName; label: string; small?: string | undefined; onPick: () => void }[];
  /** What it says with nothing to choose. */
  empty: string;
  className?: string | undefined;
}) {
  const press = useSettledPress(items.map((i) => i.id).join('\n'));
  return (
    <div className={cn('bfly', 'is-list', className)} role="menu" aria-label={label}>
      <div className="hd">{label}</div>
      {items.length ? items.map((i) => (
        <button key={i.id} type="button" className="item" role="menuitem" onClick={press(i.onPick)}><Icon name={i.icon} size={18} /><span className="lb">{i.label}</span>{i.small && <small>{i.small}</small>}</button>
      )) : <p className="none">{empty}</p>}
    </div>
  );
}

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

/**
 * A comment pinned to something, with their face on the pin. `x` and `y`, in board units, are where its point goes: the
 * top right corner of what it's on. In `BoardWorld`'s `pointers`, it stays one size however near the camera is, as a pointer
 * does. `open` shows what they said beside it; `count` how many have replied since. `data-thread` names it, to anchor a sheet to.
 */
export const BoardComment = memo(function BoardComment({ id, x, y, person, name, text, count = 0, open = false, expanded = open, controls, under = false, onOpen }: {
  id: string; x: number; y: number; person: AvatarPerson; name: string; text: string; count?: number | undefined;
  /** Its first message beside it, in a bubble of its own. */
  open?: boolean | undefined;
  /** Its thread is open, wherever that's shown: `controls` names what shows it. */
  expanded?: boolean | undefined; controls?: string | undefined;
  /** It hangs down from where it's pinned, inside the corner, instead of standing over it, to keep clear of what's above. */
  under?: boolean | undefined;
  onOpen?: ((id: string) => void) | undefined;
}) {
  return (
    <span className={cn('bo-at', under && 'is-under')} style={{ left: x, top: y }}>
      <button type="button" className="bo-pin" data-thread={id} aria-label={count > 0 ? `Comment from ${name}, and ${count === 1 ? '1 reply' : `${count} replies`}` : `Comment from ${name}`} aria-expanded={expanded}
        aria-controls={expanded ? controls : undefined} onClick={() => onOpen?.(id)}><Avatar person={person} size={22} />{count > 0 && <b className="n">{count}</b>}</button>
      {open && <div className="bo-th"><b>{name}</b><p>{text}</p></div>}
    </span>
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

/**
 * Ideas the call heard, each with who said it. Those added stay, saying so, and Add all adds the rest. It stays open while
 * people work on the board, so it's a region, not a dialog: the call's keys and Escape go on working round it.
 */
export function BoardTray({ ideas, onClose, onAdd, onAddAll, className }: { ideas: BoardIdea[]; onClose: () => void; onAdd: (id: string) => void; onAddAll: () => void; className?: string | undefined }) {
  const left = ideas.filter((l) => !l.added).length;
  return (
    <div className={cn('bd-tray', className)} role="region" aria-label="Ideas from the call">
      <div className="hd"><Icon name="waveform" size={16} />From the call<span className="sp"><Icon name="sealed" size={13} />Written in confidential compute</span><IconButton className="bt" icon="x" size={16} label="Close" onClick={onClose} /></div>
      {ideas.map((l) => (
        <div key={l.id} className="ln">
          <Avatar person={l.person} size={24} />
          <p>{l.text}<small>{l.sub}</small></p>
          <Button variant="secondary" size="sm" disabled={l.added} onClick={() => onAdd(l.id)}>{l.added ? 'Added' : 'Add'}</Button>
        </div>
      ))}
      {left > 1 && <div className="ft"><Button variant="primary" size="sm" onClick={onAddAll}>{addAllLabel(left)}</Button></div>}
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

/**
 * What a blank board says. To someone who can add to it, how to start, and with `everyone`, that everyone here can too: `page` says
 * it of everyone who can open the board, as a page has nobody "here". To someone who can only look, that what's added shows here.
 */
export function BoardEmpty({ fading = false, reader = false, everyone = true, page = false, className }: {
  fading?: boolean | undefined; reader?: boolean | undefined; everyone?: boolean | undefined; page?: boolean | undefined; className?: string | undefined;
}) {
  const also = !everyone ? '' : page ? ' Everyone who can open it can add to it too.' : ' Everyone here can add to this board.';
  return (
    <div className={cn('bd-empty', fading && 'is-faded', className)}>
      <EmptyArch />
      {reader ? <b>Nothing on this board yet</b> : <b>Double-click anywhere to add a sticky</b>}
      <span>{reader ? 'What people add shows up here as they add it.' : `Or press N.${also}`}</span>
    </div>
  );
}

/** What a board's own page has that a call doesn't: who else is here, and Start a call here. It goes at the end of the bar, as `BoardBar`'s `tail`. */
export function BoardPageActions({ people, onCall, className }: { people: AvatarPerson[]; onCall: () => void; className?: string | undefined }) {
  return (
    <div className={cn('bpg-acts', className)}>
      {people.length > 0 && <Faces people={people} size={30} max={2} />}
      <Button variant="primary" icon="video" aria-label="Start a call here" onClick={onCall}><span className="lb">Start a call here</span></Button>
    </div>
  );
}

/**
 * In the board's place for someone it wasn't opened to: who brought it, and nothing about what's on it. `who` is whoever
 * opened it, while they're in the call; `onAsk` asks them, and without it there's no button.
 */
export function BoardNoAccess({ who, onAsk, className }: { who: string | null; onAsk?: (() => void) | undefined; className?: string | undefined }) {
  return (
    <div className={cn('bd-noaccess', className)}>
      <div>
        <Icon name="lock" size={28} />
        <h3>A board you can’t open</h3>
        <p>{who ? `${who} brought it. Ask them to let you in.` : 'Ask whoever brought it to let you in.'}</p>
        {who && onAsk && <Button variant="secondary" onClick={onAsk}>Ask {who} for access</Button>}
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
  /** Only for someone who may share the board: without it, the one way on is without them. */
  onLetIn?: (() => void) | undefined;
  onWithout: () => void;
}

const namesList = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/** What the Board menu offers: a new board from a template, the team's recent boards and, in place of those, the access step. */
export interface BoardMenuContent {
  /** It's only for this room, and leaves the saved boards out. */
  inRoom?: boolean | undefined;
  recents?: BoardMenuRecents | undefined;
  access?: BoardMenuAccess | undefined;
  /** Something chosen is on its way, so nothing else can be. */
  busy?: boolean | undefined;
  onTemplate: (template: BoardTemplate) => void;
  onRecent?: ((id: string) => void) | undefined;
}

/** Who here can't open the saved board, and the ways on: let them in for this call (for someone who may share it), or go on without them. */
function AccessAsk({ access, busy, press, without }: { access: BoardMenuAccess; busy: boolean; press: (act: () => void) => () => void; without: string }) {
  return (
    <div className="bl-q">
      <p><b>{namesList(access.names)} can’t open {access.board}.</b> It’s in {access.where}.</p>
      <div className="acts">
        {access.onLetIn && <Button variant="primary" disabled={busy} onClick={press(access.onLetIn)}>Let them in for this call</Button>}
        <Button variant={access.onLetIn ? 'secondary' : 'primary'} disabled={busy} onClick={press(access.onWithout)}>{without}</Button>
      </div>
    </div>
  );
}

/**
 * What the Board menu holds, wherever it opens: in a popover with the class `bl`, from the dock's button or from More. Each row
 * is told apart by what it is, a template or a board by its `id`, and for a moment after the rows move, as the recent boards
 * come in or the access step takes their place, a press does nothing (`useSettledPress`).
 */
export function BoardMenuBody({ inRoom = false, recents, access, busy = false, onTemplate, onRecent }: BoardMenuContent) {
  const saved = !access && !inRoom && recents ? recents.boards : [];
  const press = useSettledPress([
    ...TEMPLATES.map((t) => `template:${t.id}`), ...saved.map((r) => `board:${r.id}`),
    ...(access ? [...(access.onLetIn ? ['access:let-in'] : []), 'access:without'] : [])
  ].join('\n'));
  return (
    <>
      <div className="bl-h"><span>New board</span><small>{inRoom ? 'Only this room sees it' : 'Opens for everyone here'}</small></div>
      <div className="bl-tpl">
        {TEMPLATES.map((t) => <button key={t.id} type="button" className="bl-c" disabled={busy} onClick={press(() => onTemplate(t.id))}><span className="bl-th"><svg viewBox="0 0 80 60" aria-hidden="true">{t.art}</svg></span><span className="lb">{t.label}</span></button>)}
      </div>
      {recents && saved.length > 0 && (
        <>
          <div className="bl-sub">From {recents.workspace}</div>
          {saved.map((r) => <button key={r.id} type="button" className="bl-r" disabled={busy} onClick={press(() => onRecent?.(r.id))}><span className="bl-th">{r.thumb}</span><span><b>{r.name}</b><small>{r.by}</small></span><span className="when">{r.when}</span></button>)}
        </>
      )}
      {access && <AccessAsk access={access} busy={busy} press={press} without="Open without them" />}
      <div className="bl-f"><Icon name="sealed" size={15} /><span>{inRoom ? 'Comes back with you when rooms close. Alcove can’t read it.' : 'Sealed. Alcove can’t read boards.'}</span></div>
    </>
  );
}

/**
 * The Board button's menu, rising from `anchor` (the dock's button), with what `BoardMenuBody` holds. `tip` names the button on
 * hover, as a dock button's does. `inRoom` says it's only for this room, and leaves the saved boards out. `busy`: something
 * chosen is on its way, so nothing else can be.
 */
export function BoardMenu({ open, onOpenChange, anchor, tip, side = 'bottom', align = 'end', className, ...content }: BoardMenuContent & {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: ReactNode; tip?: ReactNode;
  /** Where it opens from its button: under Board at the top right of the call. */
  side?: 'top' | 'bottom' | undefined; align?: 'start' | 'center' | 'end' | undefined; className?: string | undefined;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} tip={tip} side={side} align={align} label="Open a board" className={cn('bl', content.busy && 'is-busy', className)}>
      <BoardMenuBody {...content} />
    </Popover>
  );
}

/* ---------- The board picker ---------- */

/** The board this call has, first in the picker. */
export interface BoardPickerInCall {
  name: string;
  /** "Priya · brought it", "Priya is presenting it", "You’re presenting it". */
  by: string;
  onOpen: () => void;
}

export interface BoardPickerProps {
  /** Share › A board: Share's step head in place of the picker's own, and the board opens for everyone here. */
  step?: { onBack: () => void } | undefined;
  /** In this call: the board the call has, if it has one. */
  inCall?: BoardPickerInCall | undefined;
  /**
   * Why a new board and the team's boards can't be picked now, said quietly over them: "Priya is presenting a board. You can
   * start one once they stop.", "Guests can’t start a board here."
   */
  blocked?: string | undefined;
  /** A breakout room: a new board is only this room's, and the saved boards are left out. */
  inRoom?: boolean | undefined;
  /** The team's boards. An empty `workspace` says they come from several places: each one's `by` can say where ("Priya · Product"). */
  recents?: BoardMenuRecents | undefined;
  /** Some people here can't open the saved board picked in Share › A board: the question in place of the saved boards. */
  access?: BoardMenuAccess | undefined;
  /** Something chosen is on its way, so nothing else can be. */
  busy?: boolean | undefined;
  onTemplate: (template: BoardTemplate) => void;
  onRecent?: ((id: string) => void) | undefined;
}

/**
 * Board, at the top right of the call, opens this under itself (a popover with the class `bl`): a board opens just for you
 * until you present it. Share › A board shows it as its step (`step`), where what's picked opens for everyone. The board the
 * call has comes first, then a new one from Blank, Retro, Ideas or Flow, then the team's. As in every menu, a press does
 * nothing for a moment after the rows move (`useSettledPress`).
 */
export function BoardPicker({ step, inCall, blocked, inRoom = false, recents, access, busy = false, onTemplate, onRecent }: BoardPickerProps) {
  const saved = !access && !inRoom && recents ? recents.boards : [];
  const now = access ? undefined : inCall;
  const off = busy || !!blocked;
  const press = useSettledPress([
    ...(now ? ['in-call'] : []), ...TEMPLATES.map((t) => `template:${t.id}`), ...saved.map((r) => `board:${r.id}`),
    ...(access ? [...(access.onLetIn ? ['access:let-in'] : []), 'access:without'] : [])
  ].join('\n'));
  return (
    <>
      {step ? <ShareStepHead title="A board" onBack={step.onBack} /> : <div className="bl-hd"><b>Open a board</b><span>Only you see it until you present it.</span></div>}
      {now && (
        <>
          <div className="bl-sub">In this call</div>
          <button type="button" className="bl-r bl-now" disabled={busy} onClick={press(now.onOpen)}>
            <span className="bl-th is-icon"><Icon name="presentation" size={18} /></span>
            <span><b>{now.name}</b><small>{now.by}</small></span>
          </button>
        </>
      )}
      {blocked && <p className="bl-why"><Icon name="info" size={15} /><span>{blocked}</span></p>}
      <div className="bl-sub">New</div>
      <div className="bl-tpl">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className={cn('bl-c', blocked && 'is-off')} disabled={off} onClick={press(() => onTemplate(t.id))}>
            <span className="bl-th"><svg viewBox="0 0 80 60" aria-hidden="true">{t.art}</svg></span><span className="lb">{t.label}</span>
          </button>
        ))}
      </div>
      {recents && saved.length > 0 && (
        <>
          <div className="bl-sub">{recents.workspace ? `From ${recents.workspace}` : 'Your team’s boards'}</div>
          {saved.map((r) => (
            <button key={r.id} type="button" className={cn('bl-r', blocked && 'is-off')} disabled={off} onClick={press(() => onRecent?.(r.id))}>
              <span className={cn('bl-th', !r.thumb && 'is-icon')}>{r.thumb ?? <Icon name="presentation" size={18} />}</span>
              <span><b>{r.name}</b><small>{r.by}</small></span><span className="when">{r.when}</span>
            </button>
          ))}
        </>
      )}
      {access && <AccessAsk access={access} busy={busy} press={press} without="Present without them" />}
      <div className="bl-f">
        <Icon name="sealed" size={15} />
        <span>{inRoom ? 'Comes back with you when rooms close. Alcove can’t read it.' : step ? 'Opens for everyone here. Alcove can’t read boards.' : 'Sealed. Alcove can’t read boards.'}</span>
      </div>
    </>
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
      <textarea className={cn('pc-note', `c-${colour}`)} aria-label="What the sticky says" placeholder="Type your sticky" autoFocus value={text} onChange={(e) => onText(e.target.value)} />
      <div className="row">
        {PHONE_COLOURS.map((c) => <button key={c} type="button" className={cn('sw', `c-${c}`)} aria-pressed={colour === c} aria-label={colourName(c)} onClick={() => onColour(c)}><i className="swatch" /></button>)}
      </div>
      <Button variant="primary" disabled={!text.trim()} onClick={onAdd}>Add to {target}</Button>
    </div>
  );
}
