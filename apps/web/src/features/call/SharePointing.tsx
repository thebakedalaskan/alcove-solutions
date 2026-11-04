/*
 * Pointing on one shared screen (docs: Calls and recordings › Pointing at shared screens): everyone's pointers and marks
 * drawn over the picture, and, while you point, what your mouse, finger or keys do on it. It's drawn on this screen only,
 * over the video: nothing of it is in the shared picture, so the presenter's browser never captures it for the notes.
 *
 * Spots are fractions of the picture (marks.ts), placed in this screen's pixels from where the picture sits in the tile,
 * so a mark stays on the same spot of the picture at any size. You point at a share shown big: a click leaves a ring, a
 * drag a line, both fading after a few seconds; from the keyboard, the arrow keys move your pointer, Enter leaves a ring,
 * Backspace takes back your last mark, and Escape stops.
 */
import { SHARE_MARK_FADE_MS, type Person } from '@alcove/api';
import { Icon, PointerTag, SharePointer, Tooltip, cn } from '@alcove/ui';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { callName } from '~/lib/people';
import { NO_MARKS, type Mark, type ShareMarks, type ShareMarksView, type SharePoint } from './marks';

/** A focused share's keys while you point on it: Stage hands them here first. True when a key was used. */
export type PointingKeys = (e: ReactKeyboardEvent<HTMLElement>) => boolean;

const quiet = () => () => undefined;
/** What's on one share now. Only a change on that share draws again, not one on another. */
export function useShareMarks(marks: ShareMarks | null, share: string | null): ShareMarksView {
  return useSyncExternalStore(marks?.subscribe ?? quiet, () => (marks && share ? marks.getSnapshot().shares.get(share) ?? NO_MARKS : NO_MARKS));
}

interface Box { x: number; y: number; w: number; h: number }
/**
 * Where the picture is drawn in the tile: as big as it fits, in the middle, as the video's `object-fit: contain` draws
 * it. Before the picture's size is known, the whole tile.
 */
function fitted(view: { w: number; h: number }, pic: { w: number; h: number }): Box {
  if (view.w <= 0 || view.h <= 0 || pic.w <= 0 || pic.h <= 0) return { x: 0, y: 0, w: Math.max(0, view.w), h: Math.max(0, view.h) };
  const s = Math.min(view.w / pic.w, view.h / pic.h);
  return { x: (view.w - pic.w * s) / 2, y: (view.h - pic.h * s) / 2, w: pic.w * s, h: pic.h * s };
}
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const MIDDLE: SharePoint = { x: 0.5, y: 0.5 };
/** A ring's size on screen, whatever the picture's: it says "here", not how big something is. */
const RING = 17;
/** Below this width, names stay off the tags: the arch says who it is. */
const SMALL = 320;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function SharePointing({ marks, share, mine, big, can, active, onActive, whoIs, me, onKeys }: {
  marks: ShareMarks;
  /** The share's picture's track sid: what pointers and marks name it by. */
  share: string;
  /** It's your own share: you can clear everyone's marks on it. */
  mine: boolean;
  /** Shown big: only there can you point. */
  big: boolean;
  /** You may point at it now (the call's switch, and its presenter's choice). */
  can: boolean;
  active: boolean;
  onActive: (on: boolean) => void;
  whoIs: (id: string) => Person;
  me: Person;
  /** Gives Stage the keys to hand over while you point here, or takes them back (null). */
  onKeys: (keys: PointingKeys | null) => void;
}) {
  const view = useShareMarks(marks, share);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ view: { w: 0, h: 0 }, pic: { w: 0, h: 0 } });
  // The tile's size and the picture's, as either changes (the layout moves, the presenter shares something else).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const video = el.parentElement?.querySelector('video') ?? null;
    const read = () => setSize({ view: { w: el.clientWidth, h: el.clientHeight }, pic: { w: video?.videoWidth ?? 0, h: video?.videoHeight ?? 0 } });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    video?.addEventListener('loadedmetadata', read);
    video?.addEventListener('resize', read);
    return () => { ro.disconnect(); video?.removeEventListener('loadedmetadata', read); video?.removeEventListener('resize', read); };
  }, []);
  const box = fitted(size.view, size.pic);
  const pointing = active && can && big;

  /** The spot of the picture under a point of the screen; `edge` keeps it on the picture (a line dragged past its edge). */
  const spotAt = (clientX: number, clientY: number, edge = false): SharePoint | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || box.w <= 0 || box.h <= 0) return null;
    const x = (clientX - r.left - box.x) / box.w;
    const y = (clientY - r.top - box.y) / box.h;
    if (edge) return { x: clamp01(x), y: clamp01(y) };
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };

  /* Your pointer by keys: where it is (drawn here, since there's no mouse there), and the press under way. */
  const [kb, setKb] = useState<SharePoint | null>(null);
  const last = useRef<SharePoint | null>(null);
  const press = useRef<{ id: number; start: SharePoint; x: number; y: number; line: string | null } | null>(null);
  const finish = () => {
    const p = press.current;
    press.current = null;
    if (p?.line) marks.end(p.line);
  };
  // Stopping (Done, Escape, the share no longer big or open to you, or the tile going) takes your pointer away.
  useEffect(() => {
    if (pointing) return;
    finish();
    setKb(null);
    marks.point(share, null);
  }, [pointing, marks, share]);
  useEffect(() => () => { finish(); marks.point(share, null); }, [marks, share]);

  const keys = useRef<PointingKeys>(() => false);
  keys.current = (e) => {
    if (!pointing || e.metaKey || e.ctrlKey || e.altKey) return false;
    const dir = ARROWS[e.key];
    if (dir) {
      const from = kb ?? last.current ?? MIDDLE;
      const step = e.shiftKey ? 0.08 : 0.02;
      const at = { x: clamp01(from.x + dir[0] * step), y: clamp01(from.y + dir[1] * step) };
      setKb(at);
      marks.point(share, at);
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const at = kb ?? MIDDLE;
      setKb(at);
      marks.point(share, at);
      marks.ring(share, at);
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') { marks.undo(share); return true; }
    if (e.key === 'Escape') { onActive(false); return true; }
    return false;
  };
  useEffect(() => { onKeys((e) => keys.current(e)); return () => onKeys(null); }, [onKeys]);
  // Escape stops pointing wherever focus is, once nothing above it (a menu, a dialog) takes it first, and before it
  // unpins anyone (the call screen's own Escape).
  const stop = useRef(onActive);
  stop.current = onActive;
  useEffect(() => {
    if (!pointing) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
      e.stopPropagation();
      stop.current(false);
    };
    addEventListener('keydown', esc, { capture: true });
    return () => removeEventListener('keydown', esc, { capture: true });
  }, [pointing]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointing || e.button !== 0) return;
    const at = spotAt(e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: e.pointerId, start: at, x: e.clientX, y: e.clientY, line: null };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointing) return;
    const at = spotAt(e.clientX, e.clientY);
    // A finger has no pointer to show; a mouse or pen points wherever it is on the picture, and stops off it.
    if (e.pointerType !== 'touch') { marks.point(share, at); if (kb) setKb(null); }
    if (at) last.current = at;
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.line && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.line = marks.startLine(share, p.start);
    const edge = spotAt(e.clientX, e.clientY, true);
    if (p.line && edge) marks.draw(p.line, edge);
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (p.line) { finish(); return; }
    press.current = null;
    marks.ring(share, p.start);
  };

  const small = box.w < SMALL;
  const nameOf = (id: string, isMe: boolean) => (small ? '' : isMe ? 'You' : callName(whoIs(id)));
  const fade = { '--fade': `${SHARE_MARK_FADE_MS}ms` };
  const mineHere = view.marks.filter((m) => m.mine).length;
  const showing = view.marks.length > 0 || view.pointers.length > 0 || (pointing && kb !== null);
  return (
    <>
      <div ref={ref} className={cn('ic-marks', pointing && 'is-on', small && 'is-small')} style={fade} aria-hidden="true"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={finish}
        onPointerLeave={(e) => { if (pointing && e.pointerType !== 'touch' && !press.current) marks.point(share, null); }}
        onClick={pointing ? (e) => e.stopPropagation() : undefined}>
        {showing && (
          <div className="ic-marks-pic" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
            <svg width={box.w} height={box.h}>
              {view.marks.map((m) => <MarkShape key={m.key} m={m} w={box.w} h={box.h} />)}
            </svg>
            {view.marks.map((m) => {
              // Whose it is, by the ring, or where the line starts: its author's pointer is usually at its end.
              const at = m.points[0];
              if (!at) return null;
              return <PointerTag key={`t-${m.key}`} person={m.mine ? me : whoIs(m.from)} name={nameOf(m.from, m.mine)} className={cn('ic-mtag', m.fading && 'is-fading', m.kind === 'ring' ? 'is-ring' : 'is-line')}
                style={{ left: at.x * box.w, top: at.y * box.h }} />;
            })}
            {view.pointers.map((p) => (
              <SharePointer key={p.from} person={whoIs(p.from)} name={nameOf(p.from, false)} className="ic-pointer" style={{ transform: `translate(${p.at.x * box.w}px, ${p.at.y * box.h}px)` }} />
            ))}
            {pointing && kb && <SharePointer person={me} name={nameOf('', true)} className="ic-pointer is-mine" style={{ transform: `translate(${kb.x * box.w}px, ${kb.y * box.h}px)` }} />}
          </div>
        )}
      </div>
      {big && can && !pointing && (
        <Tooltip label="Point and mark · L">
          <button type="button" tabIndex={-1} className="ic-more ic-spoint" aria-label="Point and mark" aria-keyshortcuts="L" onClick={() => onActive(true)}><Icon name="pointer" size={16} /></button>
        </Tooltip>
      )}
      {pointing && (
        <div className="ic-pointing" role="toolbar" aria-label="Pointing">
          <Icon name="pointer" size={15} /><span className="t">Pointing</span>
          <Tooltip label="Take back your last mark · Backspace">
            <button type="button" className="pb" aria-label="Take back your last mark" disabled={!mineHere} onClick={() => marks.undo(share)}><Icon name="undo" size={16} /></button>
          </Tooltip>
          {mine && (
            <Tooltip label="Clear everyone’s marks on your screen">
              <button type="button" className="pb" aria-label="Clear everyone’s marks on your screen" disabled={!view.marks.length} onClick={() => marks.clear(share)}><Icon name="eraser" size={16} /></button>
            </Tooltip>
          )}
          <Tooltip label="Stop pointing · Esc">
            <button type="button" className="pb" aria-label="Stop pointing" onClick={() => onActive(false)}><Icon name="x" size={16} /></button>
          </Tooltip>
        </div>
      )}
    </>
  );
}

/** A ring where someone clicked, or a line where they dragged: in the screen's pixels, outlined so it reads on any picture. */
function MarkShape({ m, w, h }: { m: Mark; w: number; h: number }) {
  const cls = cn('ic-mark', m.kind === 'ring' && 'is-ring', m.fading && 'is-fading');
  if (m.kind === 'ring') {
    const at = m.points[0];
    if (!at) return null;
    return (
      <g className={cls} style={{ transformOrigin: `${at.x * w}px ${at.y * h}px` }}>
        <circle className="under" cx={at.x * w} cy={at.y * h} r={RING} />
        <circle className="over" cx={at.x * w} cy={at.y * h} r={RING} />
      </g>
    );
  }
  const points = m.points.map((p) => `${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`).join(' ');
  return (
    <g className={cls}>
      <polyline className="under" points={points} />
      <polyline className="over" points={points} />
    </g>
  );
}
