/*
 * Pointing on one shared screen (docs: Calls and recordings › Pointing at shared screens): everyone's pointers and marks
 * drawn on the picture (ShareMarksDrawing), and, while you point, what your mouse, finger or keys do on it
 * (SharePointing). It's drawn on this screen only, over the video: nothing of it is in the shared picture, so the
 * presenter's browser never captures it for the notes.
 *
 * Spots are fractions of the picture (shareFrame.ts), the same on every screen. The drawing sits on the picture itself
 * and places everything in parts of it, so it stays on the same spot at any size and however you frame the share: one you
 * look at closer (ShareSurface.tsx) carries it on the picture it zooms and moves, and hides it while a picture is held
 * still, as pointers and marks are about the live one. Where you press goes the other way, through your framing
 * (`toShare`). You point at a share on your stage, live: a click leaves a ring, a drag a line, both fading after a few
 * seconds; from the keyboard, the arrow keys move your pointer, Enter leaves a ring, Backspace takes back your last mark,
 * and Escape stops. While you point, a drag draws rather than moving the picture; the wheel, a pinch, the share's bar and
 * its keys still zoom and move it.
 */
import { SHARE_MARK_FADE_MS, type Person } from '@alcove/api';
import { Icon, PointerTag, SharePointer, Tooltip, cn } from '@alcove/ui';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { callName } from '~/lib/people';
import { NO_MARKS, type Mark, type ShareMarks, type ShareMarksView } from './marks';
import { WHOLE, place, toShare, type Framing, type SharePoint, type Size } from './shareFrame';
import type { ShareLook, ShareLookState } from './shareLook';

/** A focused share's keys while you point on it: its frame (ShareInFrame.tsx) hands them here first. True when a key was used. */
export type PointingKeys = (e: ReactKeyboardEvent<HTMLElement>) => boolean;

const quiet = () => () => undefined;
/** What's on one share now. Only a change on that share draws again, not one on another. */
export function useShareMarks(marks: ShareMarks | null, share: string | null): ShareMarksView {
  return useSyncExternalStore(marks?.subscribe ?? quiet, () => (marks && share ? marks.getSnapshot().shares.get(share) ?? NO_MARKS : NO_MARKS));
}
/**
 * How many marks are on a share now (only your own: `mine`), and nothing else: what reads it draws again when a mark
 * comes or goes, not each time a pointer on the share moves.
 */
export function useShareMarkCount(marks: ShareMarks | null, share: string | null, mine = false): number {
  return useSyncExternalStore(marks?.subscribe ?? quiet, () => {
    const v = marks && share ? marks.getSnapshot().shares.get(share) : undefined;
    return v ? (mine ? v.marks.filter((m) => m.mine).length : v.marks.length) : 0;
  });
}
/** How you look at a share closer (ShareSurface.tsx), or null for one you don't: your own. */
function useLook(look: ShareLook | null): ShareLookState | null {
  return useSyncExternalStore(look?.subscribe ?? quiet, () => look?.getSnapshot() ?? null);
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const MIDDLE: SharePoint = { x: 0.5, y: 0.5 };
/** A ring's size on screen, whatever the picture's or the zoom: it says "here", not how big something is. */
const RING = 17;
const RING_BOX = 48;
const FADE: CSSProperties = { '--fade': `${SHARE_MARK_FADE_MS}ms` };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const at = (p: SharePoint): CSSProperties => ({ left: pct(p.x), top: pct(p.y) });

/**
 * Everyone's pointers and marks on a share, for the box its picture is drawn in: places are parts of that box, so they
 * follow the picture at any size, zoom or pan, and as it glides. A ring and a line keep their size on screen at any
 * zoom. Below a small width, names stay off the tags (call.css): the arch says who it is.
 */
export function ShareMarksDrawing({ marks, share, whoIs, me }: { marks: ShareMarks; share: string; whoIs: (id: string) => Person; me: Person }) {
  const view = useShareMarks(marks, share);
  if (!view.marks.length && !view.pointers.length && !view.mine) return null;
  return (
    <div className="ic-mdraw" style={FADE} aria-hidden="true">
      {view.marks.map((m) => <MarkShape key={m.key} m={m} />)}
      {view.marks.map((m) => {
        // Whose it is, by the ring, or where the line starts: its author's pointer is usually at its end.
        const start = m.points[0];
        if (!start) return null;
        return <PointerTag key={`t-${m.key}`} person={m.mine ? me : whoIs(m.from)} name={m.mine ? 'You' : callName(whoIs(m.from))}
          className={cn('ic-mtag', m.fading && 'is-fading', m.kind === 'ring' ? 'is-ring' : 'is-line')} style={at(start)} />;
      })}
      {view.pointers.map((p) => <SharePointer key={p.from} person={whoIs(p.from)} name={callName(whoIs(p.from))} className="ic-pointer" style={at(p.at)} />)}
      {view.mine && <SharePointer person={me} name="You" className="ic-pointer is-mine" style={at(view.mine)} />}
    </div>
  );
}

/** A ring where someone clicked, or a line where they dragged, outlined so it reads on any picture. */
function MarkShape({ m }: { m: Mark }) {
  const cls = cn('ic-mark', m.fading && 'is-fading');
  if (m.kind === 'ring') {
    const p = m.points[0];
    if (!p) return null;
    const half = RING_BOX / 2;
    return (
      <svg className={cn(cls, 'ic-mring')} style={at(p)} width={RING_BOX} height={RING_BOX} viewBox={`${-half} ${-half} ${RING_BOX} ${RING_BOX}`}>
        <circle className="under" r={RING} />
        <circle className="over" r={RING} />
      </svg>
    );
  }
  // In parts of the picture, stretched to its box; the stroke keeps its width on screen.
  const points = m.points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
  return (
    <svg className={cn(cls, 'ic-mline')} viewBox="0 0 1 1" preserveAspectRatio="none">
      <polyline className="under" points={points} />
      <polyline className="over" points={points} />
    </svg>
  );
}

/**
 * Where you point on a share: the layer that takes your mouse, finger and keys while you point, the button that starts
 * it, and the bar while you do. A share you look at closer has it inside its surface, so the wheel and a pinch still
 * reach the surface; otherwise it sits over the video, with the drawing (`children`) placed where the video shows the
 * picture.
 */
export function SharePointing({ marks, share, look, mine, can, active, onActive, onKeys, children }: {
  marks: ShareMarks;
  /** The share's picture's track sid: what pointers and marks name it by. */
  share: string;
  /** How you frame it, when you look at it closer: zoomed, moved, or a picture held still. */
  look: ShareLook | null;
  /** It's your own share: you can clear everyone's marks on it. */
  mine: boolean;
  /** You may point at it now (the call's switch, and its presenter's choice). */
  can: boolean;
  active: boolean;
  onActive: (on: boolean) => void;
  /** Gives the share's frame the keys to hand over while you point here, or takes them back (null). */
  onKeys: (keys: PointingKeys | null) => void;
  /** Without a look: what's drawn on the picture, placed where the video shows it. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useLook(look);
  // Without a look, the picture is the video's, as big as it fits the frame (object-fit: contain): the frame's size and the
  // picture's, as either changes (the layout moves, the presenter shares something else).
  const [sizes, setSizes] = useState<{ view: Size; pic: Size }>({ view: { w: 0, h: 0 }, pic: { w: 0, h: 0 } });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || look) return;
    const video = el.parentElement?.querySelector('video') ?? null;
    const read = () => setSizes({ view: { w: el.clientWidth, h: el.clientHeight }, pic: { w: video?.videoWidth ?? 0, h: video?.videoHeight ?? 0 } });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    video?.addEventListener('loadedmetadata', read);
    video?.addEventListener('resize', read);
    return () => { ro.disconnect(); video?.removeEventListener('loadedmetadata', read); video?.removeEventListener('resize', read); };
  }, [look]);
  const frame: { framing: Framing; view: Size; pic: Size } = seen ? { framing: seen.framing, view: seen.view, pic: seen.pic } : { framing: WHOLE, ...sizes };
  const held = seen !== null && seen.held !== null;
  const pointing = active && can && !held;
  // A picture held still while you point ends it: pointers and marks are about the live picture.
  useEffect(() => { if (active && held) onActive(false); }, [active, held, onActive]);

  /** The spot of the picture under a point of the screen, through your framing; `edge` keeps it on the picture (a line dragged past its edge). */
  const spotAt = (clientX: number, clientY: number, edge = false): SharePoint | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const s = toShare({ x: clientX - r.left, y: clientY - r.top }, frame.framing, frame.view, frame.pic);
    if (edge) return { x: clamp01(s.x), y: clamp01(s.y) };
    return s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1 ? s : null;
  };

  /* Your pointer by keys (drawn here by the store, as there's no mouse to see), the last spot under your mouse, and the press under way. */
  const kb = useRef<SharePoint | null>(null);
  const last = useRef<SharePoint | null>(null);
  const press = useRef<{ id: number; start: SharePoint; x: number; y: number; line: string | null } | null>(null);
  const finish = () => {
    const p = press.current;
    press.current = null;
    if (p?.line) marks.end(p.line);
  };
  // Stopping (the ×, Escape, a picture held still, the share no longer open to you, or its frame going) takes your pointer away.
  useEffect(() => {
    if (pointing) return;
    finish();
    kb.current = null;
    marks.point(share, null);
  }, [pointing, marks, share]);
  useEffect(() => () => { finish(); marks.point(share, null); }, [marks, share]);

  const keys = useRef<PointingKeys>(() => false);
  keys.current = (e) => {
    if (!pointing || e.metaKey || e.ctrlKey || e.altKey) return false;
    const dir = ARROWS[e.key];
    if (dir) {
      const from = kb.current ?? last.current ?? MIDDLE;
      const step = e.shiftKey ? 0.08 : 0.02;
      kb.current = { x: clamp01(from.x + dir[0] * step), y: clamp01(from.y + dir[1] * step) };
      marks.point(share, kb.current, true);
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const spot = kb.current ?? last.current ?? MIDDLE;
      kb.current = spot;
      marks.point(share, spot, true);
      marks.ring(share, spot);
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
    const spot = spotAt(e.clientX, e.clientY);
    if (!spot) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: e.pointerId, start: spot, x: e.clientX, y: e.clientY, line: null };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointing) return;
    const spot = spotAt(e.clientX, e.clientY);
    // A finger has no pointer to show; a mouse or pen points wherever it is on the picture, and stops off it.
    if (e.pointerType !== 'touch') { kb.current = null; marks.point(share, spot); }
    if (spot) last.current = spot;
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

  const box = look ? null : place(WHOLE, frame.view, frame.pic);
  return (
    <>
      {/* data-ui while you point: the surface leaves presses here to you, and still zooms with the wheel or a pinch. */}
      <div ref={ref} className={cn('ic-marks', pointing && 'is-on')} data-ui={pointing ? '' : undefined} aria-hidden="true"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={finish}
        onPointerLeave={(e) => { if (pointing && e.pointerType !== 'touch' && !press.current) marks.point(share, null); }}
        onClick={pointing ? (e) => e.stopPropagation() : undefined}>
        {box && children && <div className="ic-marks-pic" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>{children}</div>}
      </div>
      <PointingBar marks={marks} share={share} mine={mine} offer={can && !held && !pointing} pointing={pointing} onActive={onActive} />
    </>
  );
}

/** The button that starts pointing at a share you may point at, and the bar while you point: Undo, Clear on your own share, and Stop. */
function PointingBar({ marks, share, mine, offer, pointing, onActive }: {
  marks: ShareMarks; share: string; mine: boolean; offer: boolean; pointing: boolean; onActive: (on: boolean) => void;
}) {
  const mineHere = useShareMarkCount(marks, share, true);
  const all = useShareMarkCount(marks, share);
  if (offer) {
    return (
      <Tooltip label="Point and mark · L">
        <button type="button" tabIndex={-1} className="ic-more ic-spoint" aria-label="Point and mark" aria-keyshortcuts="L" onClick={() => onActive(true)}><Icon name="pointer" size={16} /></button>
      </Tooltip>
    );
  }
  if (!pointing) return null;
  return (
    <div className="ic-pointing" role="toolbar" aria-label="Pointing" data-ui>
      <Icon name="pointer" size={15} /><span className="t">Pointing</span>
      <Tooltip label="Take back your last mark · Backspace">
        <button type="button" className="pb" aria-label="Take back your last mark" disabled={!mineHere} onClick={() => marks.undo(share)}><Icon name="undo" size={16} /></button>
      </Tooltip>
      {mine && (
        <Tooltip label="Clear everyone’s marks on your screen">
          <button type="button" className="pb" aria-label="Clear everyone’s marks on your screen" disabled={!all} onClick={() => marks.clear(share)}><Icon name="eraser" size={16} /></button>
        </Tooltip>
      )}
      <Tooltip label="Stop pointing · Esc">
        <button type="button" className="pb" aria-label="Stop pointing" onClick={() => onActive(false)}><Icon name="x" size={16} /></button>
      </Tooltip>
    </div>
  );
}

/**
 * The marks store follows the call: the shares shown here (by their picture's track sid, with whose each is and whether others
 * may point at it), who's in your part of the call, which part that is, and whether pointing is on at all. The part of the call
 * is the one whose keys this browser holds (the main room, or a room by its ID): someone coming or going changes who's in it, and
 * only their own pointer and marks go.
 */
export function useMarksFollow(marks: ShareMarks | null, { on, shares, people, part }: { on: boolean; shares: readonly { sid: string; owner: string; others: boolean }[]; people: readonly string[]; part: string }): void {
  const key = [on, part, shares.map((s) => `${s.sid}:${s.owner}:${s.others}`).join(','), [...people].sort().join(',')].join('|');
  useEffect(() => {
    marks?.use({ on, shares: new Map(shares.map((s) => [s.sid, { owner: s.owner, others: s.others }])), people: new Set(people), part });
    // `key` says everything this reads.
  }, [marks, key]);
}

/**
 * Something else shared in place of what was (Change: the same share, a new picture): marks on it were about the old picture, so
 * they go, for everyone. `screen`: what you share now; `share`: its picture's track sid in the call.
 */
export function useMarksGoWithPicture(marks: ShareMarks | null, screen: MediaStream | null, share: string | null): void {
  const lastScreen = useRef<MediaStream | null>(null);
  useEffect(() => {
    const was = lastScreen.current;
    lastScreen.current = screen;
    if (was && screen && was !== screen && share) marks?.clear(share);
  }, [screen, share, marks]);
}
