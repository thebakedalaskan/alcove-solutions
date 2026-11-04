/*
 * A share you see big, or in its own window, looked at your own way: zoom, pan, a picture held still and earlier
 * pictures, for you only (shareLook.ts holds the state, shareFrame.ts the coordinates). Pinching, or Ctrl/⌘ with the
 * wheel, zooms where the pointer is; a drag, or the wheel, moves around once zoomed in; a double-click goes in to 200% or
 * back to the whole picture. The bar does the same, and so do the keys on the focused share (+, −, 0, arrows, F, comma and
 * full stop), which its ⋯ menu lists, so in the call the bar's buttons are for pointers and touch and the stage stays one
 * tab stop. While a picture is held still, a bar at the top says how far behind live it is, with Back to live.
 *
 * Nothing here uses motion's frame loop or anything else timed by the call's tab: in its own window a share keeps
 * working while that tab is in the background.
 */
import type { Person } from '@alcove/api';
import { Avatar, Icon, Tooltip, cn, type IconName } from '@alcove/ui';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { CallRoom } from './livekit';
import { POP_HEADER, type PopKind } from './popOut';
import { WHOLE, ZOOM_MAX, centreOn, inView, isZoomed, panBy, place, zoomLabel, zoomTo, type Framing, type Point, type Size } from './shareFrame';
import { HISTORY, type HistoryOff, type ShareLook, type ShareLookState } from './shareLook';
import { ShareMenu } from './TileMenu';
import { useLive } from '~/lib/live';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
/** A change from a key or a button glides; a drag, a pinch or the wheel follows at once. */
const DIRECT_MS = 250;

/** One short line on earlier pictures: what's kept and where, or why nothing is. */
export function historyNote(off: HistoryOff | null): string {
  switch (off) {
    case null: return `Up to ${HISTORY.pictures} earlier pictures stay in this browser’s memory until the share stops. Nothing is saved or sent.`;
    case 'paused': return 'Notes are paused, so no earlier pictures are kept. Zoom and freeze still work.';
    case 'memory': return 'This device is low on memory, so no earlier pictures are kept. Zoom and freeze still work.';
    case 'unsupported': return 'This browser can’t keep earlier pictures. Zoom and freeze still work.';
  }
}
/** What the framing is now, said: for the tile's description and screen readers. */
function framingSaid(s: ShareLookState): string {
  const zoom = isZoomed(s.framing) ? `zoomed to ${zoomLabel(Math.round(s.framing.zoom * 4) / 4)}` : 'the whole picture';
  if (!s.held) return `Live, ${zoom}`;
  const which = s.held.index === null || s.held.index === s.count - 1 ? 'Frozen picture' : `Earlier picture, ${s.held.index + 1} of ${s.count}`;
  return `${which}, behind live, ${zoom}. F goes back to live`;
}
const picOf = (s: ShareLookState): Size => (s.held ? { w: s.held.w, h: s.held.h } : s.pic);

/** How long ago the held picture was on the share, counting each second by the timers of the window it's in. */
function Behind({ seen }: { seen: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const win = ref.current?.ownerDocument.defaultView ?? window;
    const t = win.setInterval(() => setNow(Date.now()), 1000);
    return () => { try { win.clearInterval(t); } catch { /* its window has closed */ } };
  }, []);
  return <span ref={ref} className="when">{mmss(Math.max(0, Math.floor((now - seen) / 1000)))} behind live</span>;
}

/** A button on the share's bar: a tooltip in the call; in its own window, the browser's (the call's tooltips live in the call's tab). */
function BarButton({ icon, label, keys, onClick, disabled = false, where, className, children }: {
  icon?: IconName | undefined; label: string; keys?: string | undefined; onClick: () => void; disabled?: boolean; where: 'stage' | 'window'; className?: string | undefined; children?: ReactNode;
}) {
  const tip = keys ? `${label} (${keys})` : label;
  const b = (
    <button type="button" className={className} aria-label={label} aria-keyshortcuts={keys} disabled={disabled} tabIndex={where === 'stage' ? -1 : 0}
      title={where === 'window' ? tip : undefined} onClick={onClick}>
      {icon && <Icon name={icon} size={16} />}{children}
    </button>
  );
  return where === 'stage' && !disabled ? <Tooltip label={tip} side="top">{b}</Tooltip> : b;
}

export function ShareSurface({ look, feed, where, label, popOut, describe }: {
  look: ShareLook;
  feed: { room: CallRoom; sid: string };
  /** On the stage, or in its own window. */
  where: 'stage' | 'window';
  /** What it is, as menus call it: "Ana’s screen". */
  label: string;
  /** Opening it in its own window, or bringing it back; null where this browser can't. */
  popOut: { open: boolean; toggle: () => void } | null;
  /** The id of the line that describes how it's framed, for the tile's aria-describedby. */
  describe?: string | undefined;
}) {
  const s = useLive(look);
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // When the framing last changed under a pointer or the wheel: such changes follow it at once instead of gliding.
  const directAt = useRef(0);
  // On touch screens the bar shows after a tap, as there's no hover.
  const [tapped, setTapped] = useState(false);

  /* The live picture, and earlier pictures kept from it while it's on screen. */
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const detach = feed.room.attach(feed.sid, el);
    const unwatch = look.watch(el);
    return () => { unwatch(); detach(); };
  }, [feed.room, feed.sid, look]);

  /* The view's size and the live picture's, with the observer of the window it's in. */
  useLayoutEffect(() => {
    const el = root.current;
    const v = video.current;
    if (!el || !v) return;
    const win = el.ownerDocument.defaultView ?? window;
    const read = () => look.measure({ w: el.clientWidth, h: el.clientHeight }, { w: v.videoWidth, h: v.videoHeight });
    read();
    const ro = new win.ResizeObserver(read);
    ro.observe(el);
    v.addEventListener('resize', read);
    v.addEventListener('loadedmetadata', read);
    return () => { ro.disconnect(); v.removeEventListener('resize', read); v.removeEventListener('loadedmetadata', read); };
  }, [look]);

  /* The held picture, drawn once it's ready. Until then the one before stays, so nothing flashes. */
  const heldN = s.held?.n ?? null;
  const heldReady = s.held?.ready ?? false;
  useEffect(() => {
    const c = canvas.current;
    const b = look.heldBitmap();
    if (!c || !b || !heldReady) return;
    if (c.width !== b.width) c.width = b.width;
    if (c.height !== b.height) c.height = b.height;
    c.getContext('2d')?.drawImage(b, 0, 0);
  }, [heldN, heldReady, look]);

  /* Pointers, pinches, the wheel and double-clicks. The wheel is listened to directly, so Ctrl and the wheel zooms the share, not the page. */
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const points = new Map<number, Point>();
    let from: { f: Framing; points: Map<number, Point>; moved: boolean } | null = null;
    const local = (e: { clientX: number; clientY: number }): Point => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onUi = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, [data-ui]');
    const restart = () => { from = { f: look.getSnapshot().framing, points: new Map(points), moved: from?.moved ?? false }; };
    const down = (e: PointerEvent) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || onUi(e.target)) return;
      points.set(e.pointerId, local(e));
      try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      restart();
    };
    const move = (e: PointerEvent) => {
      const start = from;
      if (!start || !points.has(e.pointerId)) return;
      const p = local(e);
      points.set(e.pointerId, p);
      const st = look.getSnapshot();
      const pic = picOf(st);
      const [a, b] = [...points.values()];
      const [a0, b0] = [...start.points.values()];
      directAt.current = performance.now();
      if (a && b && a0 && b0) {
        // Two fingers: zoom by how far apart they are, around where they started, and move with them.
        const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, Math.hypot(b0.x - a0.x, b0.y - a0.y));
        start.moved = true;
        look.setFraming(panBy(zoomTo(start.f, start.f.zoom * k, st.view, pic, m0), m.x - m0.x, m.y - m0.y, st.view, pic));
        return;
      }
      const p0 = start.points.get(e.pointerId);
      if (!p0) return;
      if (Math.abs(p.x - p0.x) + Math.abs(p.y - p0.y) > 4) start.moved = true;
      if (isZoomed(start.f)) look.setFraming(panBy(start.f, p.x - p0.x, p.y - p0.y, st.view, pic));
    };
    const up = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) return;
      points.delete(e.pointerId);
      const tap = from !== null && !from.moved && points.size === 0 && e.pointerType !== 'mouse';
      if (points.size) restart(); else from = null;
      if (tap) setTapped((v) => !v);
    };
    const wheel = (e: WheelEvent) => {
      const st = look.getSnapshot();
      const pic = picOf(st);
      if (e.ctrlKey || e.metaKey) {
        // A pinch on a trackpad, or Ctrl/⌘ and a mouse wheel (a notch is a step).
        e.preventDefault();
        directAt.current = performance.now();
        const k = Math.abs(e.deltaY) >= 40 ? (e.deltaY < 0 ? 1.25 : 0.8) : Math.exp(-e.deltaY * 0.01);
        look.setFraming(zoomTo(st.framing, st.framing.zoom * k, st.view, pic, local(e)));
        return;
      }
      if (!isZoomed(st.framing)) return;
      e.preventDefault();
      directAt.current = performance.now();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? st.view.h : 1;
      look.setFraming(panBy(st.framing, -e.deltaX * unit, -e.deltaY * unit, st.view, pic));
    };
    const double = (e: MouseEvent) => {
      if (onUi(e.target)) return;
      const st = look.getSnapshot();
      look.setFraming(isZoomed(st.framing) ? WHOLE : zoomTo(st.framing, 2, st.view, picOf(st), local(e)));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', double);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', double);
    };
  }, [look]);

  /* The minimap: press or drag in it to look at that part of the picture. */
  const mapAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const st = look.getSnapshot();
    directAt.current = performance.now();
    look.setFraming(centreOn(st.framing, { x: (e.clientX - r.left) / Math.max(1, r.width), y: (e.clientY - r.top) / Math.max(1, r.height) }, st.view, picOf(st)));
  };

  const pic = picOf(s);
  const box = place(s.framing, s.view, pic);
  const zoomed = isZoomed(s.framing);
  const held = s.held;
  const newest = held !== null && (held.index === null || held.index === s.count - 1);
  // The clock only decides whether this change glides: not right after a drag, a pinch or the wheel.
  const glide = performance.now() - directAt.current > DIRECT_MS;
  const seen = inView(s.framing, s.view, pic);
  const aspect = pic.w > 0 && pic.h > 0 ? pic.w / pic.h : 1.6;
  const mapW = Math.round(Math.max(72, Math.min(132, s.view.w * 0.16)));
  const mapH = Math.round(Math.min(96, mapW / aspect));
  const said = framingSaid(s);
  return (
    <div ref={root} tabIndex={where === 'window' ? 0 : undefined} role={where === 'window' ? 'group' : undefined}
      aria-roledescription={where === 'window' ? 'shared screen' : undefined} aria-label={where === 'window' ? `${label}. ${said}` : undefined}
      aria-keyshortcuts={where === 'window' ? '+ - 0 F , .' : undefined}
      className={cn('ic-sv', zoomed && 'is-zoomed', held && 'is-held', (zoomed || held || tapped || where === 'window') && 'is-on', where === 'window' && 'in-window')}
      onKeyDown={where === 'window' ? (e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey && look.key(e.key)) e.preventDefault(); } : undefined}>
      <div className={cn('ic-sv-pic', glide && 'is-glide')} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
        <video ref={video} className="is-remote" autoPlay playsInline muted />
        {held && <canvas ref={canvas} aria-hidden="true" />}
      </div>
      {held && (
        <div className="ic-svheld" data-ui>
          <Icon name={newest ? 'pause' : 'history'} size={15} />
          <Behind key={held.n} seen={held.seen} />
          {held.index !== null && s.count > 1 && <span className="ct">{held.index + 1} of {s.count}</span>}
          <button type="button" tabIndex={where === 'stage' ? -1 : 0} aria-keyshortcuts="F" onClick={() => look.live()}>Back to live</button>
        </div>
      )}
      {zoomed && (
        <div className="ic-svmap" data-ui aria-hidden="true" style={{ width: mapW, height: mapH }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); mapAt(e); }}
          onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) mapAt(e); }}>
          <i style={{ left: pct(seen.x), top: pct(seen.y), width: pct(seen.w), height: pct(seen.h) }} />
        </div>
      )}
      <div className="ic-svbar" data-ui>
        <BarButton where={where} icon="stepBack" label="Earlier picture" keys="," disabled={!s.canEarlier} onClick={() => void look.earlier()} />
        <BarButton where={where} icon={held ? 'play' : 'pause'} label={held ? 'Back to live' : 'Freeze the picture'} keys="F" onClick={() => (held ? look.live() : void look.freeze())} />
        {held && <BarButton where={where} icon="stepForward" label={newest ? 'Back to live' : 'Later picture'} keys="." onClick={() => look.later()} />}
        <span className="sep" aria-hidden="true" />
        <BarButton where={where} icon="zoomOut" label="Zoom out" keys="-" disabled={!zoomed} onClick={() => look.zoomStep(-1)} />
        <BarButton where={where} className="lv" label={zoomed ? `Zoomed to ${zoomLabel(s.framing.zoom)}. Show the whole picture` : 'The whole picture'} keys="0" disabled={!zoomed} onClick={() => look.whole()}>
          {zoomLabel(s.framing.zoom)}
        </BarButton>
        <BarButton where={where} icon="zoomIn" label="Zoom in" keys="+" disabled={s.framing.zoom >= ZOOM_MAX - 0.001} onClick={() => look.zoomStep(1)} />
        {popOut && (
          <>
            <span className="sep" aria-hidden="true" />
            <BarButton where={where} icon={popOut.open ? 'popIn' : 'pip'} label={popOut.open ? 'Bring it back to the call' : 'Open in its own window'} onClick={popOut.toggle} />
          </>
        )}
      </div>
      <span id={describe} className="sr-only" aria-live="polite">{said}</span>
    </div>
  );
}

type ShareMenuProps = Omit<Parameters<typeof ShareMenu>[0], 'look'>;
/** A share's ⋯ menu. For a share you see big it offers zoom, freeze and earlier pictures, following them while it's open. */
export function ShareMenuFor({ look, ...menu }: ShareMenuProps & { look: ShareLook | null }) {
  return look ? <LookedMenu look={look} {...menu} /> : <ShareMenu {...menu} />;
}
function LookedMenu({ look, ...menu }: ShareMenuProps & { look: ShareLook }) {
  const s = useLive(look);
  return (
    <ShareMenu {...menu} look={{
      zoomed: isZoomed(s.framing), max: s.framing.zoom >= ZOOM_MAX - 0.001,
      zoomIn: () => look.zoomStep(1), zoomOut: () => look.zoomStep(-1), whole: () => look.whole(),
      held: s.held !== null, canEarlier: s.canEarlier,
      freeze: () => { void look.freeze(); }, live: () => look.live(), earlier: () => { void look.earlier(); },
      note: historyNote(s.off)
    }} />
  );
}

/** A share open in its own window: the stage keeps its place as a tile, with a way to bring it back. */
export function ShareAway({ onBack }: { onBack: () => void }) {
  return (
    <div className="ic-svaway" data-ui>
      <Icon name="pip" size={22} />
      <b>In its own window</b>
      <button type="button" tabIndex={-1} onClick={onBack}>Bring it back</button>
    </div>
  );
}

/**
 * The share's own window: who shares it, the share to zoom, freeze and step back through, and Back to the call. A popup
 * window (not Picture-in-Picture) pauses with the call's tab, as LiveKit pauses every video there, so it says so.
 */
export function ShareWindow({ look, feed, presenter, name, kind, onBack }: {
  look: ShareLook; feed: { room: CallRoom; sid: string }; presenter: Person; name: string; kind: PopKind; onBack: () => void;
}) {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    if (kind !== 'window') return;
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [kind]);
  return (
    <div className="stage ic-pop" style={{ gridTemplateRows: `${POP_HEADER}px minmax(0, 1fr)` }}>
      <header className="ic-poph">
        <Avatar person={presenter} size={24} />
        <b>{name}</b>
        <span className="sub">Only you see this window</span>
        <button type="button" onClick={onBack}><Icon name="popIn" size={15} />Back to the call</button>
      </header>
      <div className="ic-popbox ic-scr">
        <ShareSurface look={look} feed={feed} where="window" label={name} popOut={null} />
        {kind === 'window' && hidden && <p className="ic-popwait">The share pauses while the call’s tab is hidden. Go back to it and the share carries on.</p>}
      </div>
    </div>
  );
}
