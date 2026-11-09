/*
 * Shared screens in a note: a frame as it was shown, the part of it something points at, how well it could be read,
 * and the moment of the call it belongs to. Calm by design: a thumbnail beside the lines said while it was up, never a
 * wall of images.
 */
import type { ScreenLegible, ScreenRegion } from '@alcove/api';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon } from './icon';
import { Chip, IconButton } from './primitives';

/**
 * Where a part's label goes: above its box, or under it when the box starts near the frame's top (the frame clips
 * what's outside it), or inside it when it runs from top to bottom; and from the box's right edge when the box sits on
 * the frame's right, so a long label doesn't run off it.
 */
const labelAt = (r: ScreenRegion) => cn(r.y < 0.16 && (r.y + r.h < 0.84 ? 'is-below' : 'is-inside'), r.x > 0.5 && 'is-end');

/**
 * A frame of a shared screen at its own shape. `focus` outlines one of its parts (what something points at), with its
 * label; `parts` outlines all of them, quietly.
 */
export function ScreenShot({ src, alt, width, height, regions = [], focus, parts = false, className }: {
  src: string; alt: string; width: number; height: number; regions?: ScreenRegion[] | undefined; focus?: number | undefined; parts?: boolean | undefined; className?: string | undefined;
}) {
  return (
    <span className={cn('ac-shot', className)} style={{ aspectRatio: `${Math.max(1, width)} / ${Math.max(1, height)}` }}>
      <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} />
      {regions.map((r, i) => (parts || i === focus) && (
        <span key={`${i}-${r.label}`} aria-hidden="true" className={cn('ac-shot-part', i === focus && 'is-focus')}
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
          {i === focus && <span className={cn('lbl', labelAt(r))}>{r.label}</span>}
        </span>
      ))}
    </span>
  );
}

const LEGIBLE: Record<Exclude<ScreenLegible, 'clear'>, string> = { partly: 'Partly readable', unreadable: 'Couldn’t be read', unread: 'Not read' };
/** How well a frame could be read, when it wasn't all: said calmly, so nothing on it is taken for more than it shows. */
export function ScreenLegibility({ legible, className }: { legible: ScreenLegible; className?: string | undefined }) {
  if (legible === 'clear') return null;
  return <Chip tone={legible === 'unread' ? 'outline' : 'caution'} icon="eyeOff" className={cn('ac-screen-legible', className)}>{LEGIBLE[legible]}</Chip>;
}

/**
 * One moment a shared screen changed, among the lines said while it was up: its thumbnail, what it is, whose screen and
 * when (`meta`), what it shows, and how legible it was. Opens the frame.
 */
export function ScreenMomentCard({ src, width, height, title, meta, description, legible, onOpen, className }: {
  src: string; width: number; height: number; title: string; meta: ReactNode; description?: string | undefined; legible?: ScreenLegible | undefined;
  onOpen: () => void; className?: string | undefined;
}) {
  const name = title.trim() || 'A shared screen';
  return (
    <button type="button" className={cn('ac-screen', className)} onClick={onOpen} aria-label={`Open the screen: ${name}`}>
      <ScreenShot src={src} alt="" width={width} height={height} className="thumb" />
      <span className="what">
        <span className="t"><Icon name="monitor" size={14} />{name}</span>
        <span className="m">{meta}</span>
        {description && <span className="d">{description}</span>}
        {legible && <ScreenLegibility legible={legible} />}
      </span>
    </button>
  );
}

/** How long the full screen controls stay up without the pointer moving, in ms. */
const IDLE = 2500;

/** A share replay can switch to: one going on at the moment the recording is at. */
export interface ReplayShare { id: string; label: string }

/**
 * A note's shared screens played back in step with its recording, on a black stage (night in both themes, like the
 * call). `video` is the app's own `<video>`, kept mounted so it can follow the audio; with `nothing` it's hidden and
 * the stage says nothing was shared then. When more than one share was going on, chips switch between them; with
 * one, its label says whose it is. Where the browser allows it, a button in the corner fills the screen with it;
 * `controls` (play and pause, the time, a `ReplayScrub`) show along its foot only then, since the page's own player is
 * out of view. While `playing`, they slip away after a moment without the pointer moving, and come back on a move,
 * a key, focus or a pause; they stay while one is being pressed or has keyboard focus.
 */
export function ScreenReplay({ video, nothing, shares, current, onPick, controls, playing = false, className }: {
  video: ReactNode | null; nothing: boolean; shares: ReplayShare[]; current: string | null; onPick: (id: string) => void;
  controls?: ReactNode | undefined; playing?: boolean | undefined; className?: string | undefined;
}) {
  const shown = shares.find((s) => s.id === current);
  const root = useRef<HTMLDivElement | null>(null);
  const [can, setCan] = useState(false);
  const [full, setFull] = useState(false);
  // The browser says when it's full screen, however it got there or left (Escape included).
  useEffect(() => {
    setCan(document.fullscreenEnabled);
    const change = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  // The controls hide after IDLE ms of stillness while playing; a press on them holds them up until it ends.
  const [awake, setAwake] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const wake = useCallback(() => {
    window.clearTimeout(timer.current);
    setAwake(true);
    if (playing && !held.current) timer.current = window.setTimeout(() => setAwake(false), IDLE);
  }, [playing]);
  useEffect(() => { wake(); return () => window.clearTimeout(timer.current); }, [wake, full]);
  const hold = () => {
    held.current = true;
    wake();
    const release = () => { held.current = false; window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); wake(); };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  };
  // A refusal leaves things as they are: `fullscreenchange` never comes.
  const toggle = () => {
    if (full) void document.exitFullscreen().catch(() => undefined);
    else void root.current?.requestFullscreen().catch(() => undefined);
  };
  return (
    <div ref={root} className={cn('ac-replay', nothing && 'is-nothing', full && 'is-full', full && !awake && 'is-idle', className)} role="group" aria-label="Shared screens"
      onPointerMove={full ? wake : undefined} onKeyDown={full ? wake : undefined} onFocus={full ? wake : undefined}>
      <div className="ac-replay-stage">
        {video}
        {nothing && <span className="ac-replay-none"><Icon name="stopShare" size={18} />Nothing shared</span>}
        {can && <IconButton icon={full ? 'shrink' : 'grow'} label={full ? 'Exit full screen' : 'Full screen'} size={16} className="ac-replay-full" onClick={toggle} />}
        {full && controls && <div className="ac-replay-bar" onPointerDown={hold}>{controls}</div>}
      </div>
      {!nothing && shares.length > 1 && (
        <div className="ac-replay-picks" role="group" aria-label="Shared at this moment">
          {shares.map((s) => (
            <button key={s.id} type="button" className="ac-replay-pick" aria-pressed={s.id === current} onClick={() => onPick(s.id)}>
              <Chip icon="monitor"><span className="ac-clamp-1">{s.label}</span></Chip>
            </button>
          ))}
        </div>
      )}
      {!nothing && shares.length === 1 && shown && (
        <span className="ac-replay-who"><Icon name="monitor" size={14} /><span className="ac-clamp-1">{shown.label}</span></span>
      )}
    </div>
  );
}

/** A stretch of the recording to draw on a `ReplayScrub`'s track, in seconds. */
export interface ReplayMark { at: number; until: number }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * A scrub bar for the recording: click or drag to move through it, arrow keys (5 s), Page keys (30 s), Home and End.
 * While dragging it shows where the thumb is at once and asks for a move once per frame, and again where it's let go.
 * `marks` are faint spans for when something was shared. `format` says a time in words, for the bubble and for
 * assistive tech.
 */
export function ReplayScrub({ pos, total, onSeek, format, marks = [], className }: {
  pos: number; total: number; onSeek: (seconds: number) => void; format: (seconds: number) => string;
  marks?: ReplayMark[] | undefined; className?: string | undefined;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const latest = useRef(0);
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  const shown = clamp(drag ?? pos, 0, total);
  const pct = (t: number) => (total > 0 ? clamp(t / total, 0, 1) * 100 : 0);

  const at = (e: PointerEvent<HTMLDivElement>): number => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return clamp((e.clientX - r.left) / r.width, 0, 1) * total;
  };
  const move = (t: number) => {
    latest.current = t;
    setDrag(t);
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => { frame.current = undefined; onSeek(latest.current); });
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || total <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    move(at(e));
  };
  const drop = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    if (frame.current !== undefined) { cancelAnimationFrame(frame.current); frame.current = undefined; }
    const t = e.type === 'pointercancel' ? latest.current : at(e);
    setDrag(null);
    onSeek(t);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    const by = step[e.key];
    let to: number | null = null;
    if (by !== undefined) to = pos + by;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = total;
    if (to === null) return;
    e.preventDefault();
    onSeek(clamp(to, 0, total));
  };

  return (
    <div className={cn('ac-scrub', drag !== null && 'is-drag', className)} role="slider" tabIndex={0} aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(shown)} aria-valuetext={format(shown)}
      onPointerDown={down} onPointerMove={(e) => { if (drag !== null) move(at(e)); }} onPointerUp={drop} onPointerCancel={drop} onKeyDown={key}>
      <div ref={track} className="ac-scrub-track">
        {marks.map((m, i) => <span key={i} aria-hidden="true" className="ac-scrub-mark" style={{ left: `${pct(m.at)}%`, width: `${Math.max(0, pct(m.until) - pct(m.at))}%` }} />)}
        <span aria-hidden="true" className="ac-scrub-fill" style={{ width: `${pct(shown)}%` }} />
        <span aria-hidden="true" className="ac-scrub-thumb" style={{ left: `${pct(shown)}%` }}>
          {drag !== null && <span className="ac-scrub-tip">{format(shown)}</span>}
        </span>
      </div>
    </div>
  );
}
