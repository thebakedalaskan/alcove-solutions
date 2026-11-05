/*
 * Layouts: a real stage you can rearrange. Drag people to new spots, pull the divider to resize the
 * shared screen, double-click someone to make them the speaker, or switch layout. Left alone it plays
 * itself, and it pauses while someone is using it, carrying on a few seconds after they stop.
 */
import { CallTile, EASE, Fit, Icon, Segmented, cn, useSceneLoop, type IconName } from '@alcove/ui';
import { AnimatePresence, animate, motion, useReducedMotion, type Transition } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { CAST, firstOf, type CastId } from '~/features/notes/cast';
import { SceneDock, SceneFrame, SceneHead, box, type Rect } from './parts';

type Mode = 'side' | 'speaker' | 'grid';
const W = 1180, X0 = 24, Y0 = 72, WW = W - 48, HH = 432;
const FIRST: CastId[] = ['kofi', 'priya', 'theo', 'maya', 'lena'];
const IDLE_MS = 7000;
const BACK = [0.34, 1.36, 0.64, 1] as const;

function gridRects(n: number, x: number, y: number, w: number, h: number, cols: number): Rect[] {
  const rows = Math.ceil(n / cols), tw = (w - (cols - 1) * 12) / cols, th = (h - (rows - 1) * 12) / rows;
  return Array.from({ length: n }, (_, i) => [x + (i % cols) * (tw + 12), y + Math.floor(i / cols) * (th + 12), tw, th] as const);
}

/** Where everything goes in a mode: the shared screen, the divider and one slot per person, in order. */
function layout(mode: Mode, ratio: number, n: number): { scr: Rect; scrOn: boolean; bar: readonly [number, number] | null; slots: Rect[] } {
  if (mode === 'side') {
    const sw = Math.round(WW * ratio), pw = WW - sw - 12;
    return { scr: [X0, Y0, sw, HH], scrOn: true, bar: [X0 + sw + 6, Y0 + HH / 2 - 28], slots: gridRects(n, X0 + sw + 12, Y0, pw, HH, pw >= 380 ? 2 : 1) };
  }
  if (mode === 'speaker') {
    return { scr: [X0 + WW / 2 - 160, Y0 + 100, 320, 200], scrOn: false, bar: null, slots: [[X0, Y0, WW, HH - 148] as const, ...gridRects(n - 1, X0 + (WW - 4 * 200 - 36) / 2, Y0 + HH - 136, 4 * 200 + 36, 136, 4)] };
  }
  const g = gridRects(n + 1, X0, Y0, WW, HH, 3);
  return { scr: g[0] ?? [X0, Y0, 0, 0], scrOn: true, bar: null, slots: g.slice(1) };
}

const moveTo = (order: CastId[], id: CastId, to: number) => { const o = order.filter((x) => x !== id); o.splice(to, 0, id); return o; };
const center = (r: Rect) => ({ x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 });

interface State {
  mode: Mode; order: CastId[]; ratio: number;
  /** Follow the pointer or a sliding divider with no glide. */
  instant: boolean;
  /** Picked up: lifts and casts a shadow. */
  lifted: CastId | null;
  /** Being dragged by hand, with its top-left in design pixels. */
  drag: { id: CastId; x: number; y: number } | null;
  /** A slow, carried move (the demo) or a settle after a drop. */
  glide: { id: CastId; kind: 'carry' | 'drop' } | null;
  pressed: CastId | null; resizing: boolean; touched: boolean; picked: CastId | null;
  say: { icon: IconName; text: string } | null;
}
const START: State = { mode: 'side', order: FIRST, ratio: 0.68, instant: false, lifted: null, drag: null, glide: null, pressed: null, resizing: false, touched: false, picked: null, say: null };

/** The shared screen: Kofi's design file (illustration). */
function SharedScreen() {
  return (
    <div className="ac-tile">
      <svg className="shot" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect width="640" height="400" fill="#F3F7FC" /><rect width="640" height="34" fill="#FFFFFF" />
        <circle cx="20" cy="17" r="5" fill="#D9E1E9" /><circle cx="36" cy="17" r="5" fill="#D9E1E9" /><circle cx="52" cy="17" r="5" fill="#D9E1E9" />
        <text x="78" y="22" fontFamily="Hanken Grotesk, sans-serif" fontSize="13" fontWeight="600" fill="#394967">Onboarding · v3</text>
        {(['#17294A', '#AF5E7F', '#F18E6B'] as const).map((c, i) => {
          const x = 92 + i * 160;
          return (
            <g key={c}>
              <rect x={x} y="70" width="136" height="290" rx="20" fill="#FFFFFF" stroke="#D9E1E9" />
              <path d={`M${x + 22} 200V140a46 46 0 0 1 92 0v60z`} fill={c} />
              <rect x={x + 18} y="222" width="100" height="10" rx="5" fill="#D9E1E9" /><rect x={x + 18} y="242" width="72" height="10" rx="5" fill="#E7EEF5" />
              <rect x={x + 18} y="312" width="100" height="30" rx="13" fill="#153166" />
            </g>
          );
        })}
      </svg>
      <span className="ac-tile-name"><Icon name="screen" size={14} />Kofi’s screen</span>
    </div>
  );
}

export function LayoutScene() {
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLDivElement>(null);
  const [s, setS] = useState<State>(START);
  const now = useRef(s);
  useEffect(() => { now.current = s; });
  const lastTouch = useRef(0);
  const grab = useRef<{ id: CastId; dx: number; dy: number } | null>(null);

  const L = layout(s.mode, s.ratio, s.order.length);
  const local = (e: PointerEvent) => {
    const r = stage.current?.getBoundingClientRect();
    const k = r ? r.width / W : 1;
    return { x: (e.clientX - (r?.left ?? 0)) / k, y: (e.clientY - (r?.top ?? 0)) / k };
  };
  const touch = () => { lastTouch.current = Date.now(); setS((x) => (x.touched ? x : { ...x, touched: true, say: null })); };
  const setMode = (mode: Mode) => setS((x) => ({ ...x, mode, instant: false }));

  /* By hand: pick someone up, move them, and the others make room. */
  const down = (id: CastId) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    e.preventDefault();
    touch();
    const p = local(e);
    const r = layout(now.current.mode, now.current.ratio, now.current.order.length).slots[now.current.order.indexOf(id)];
    if (!r) return;
    grab.current = { id, dx: p.x - r[0], dy: p.y - r[1] };
    e.currentTarget.setPointerCapture(e.pointerId);
    setS((x) => ({ ...x, lifted: id, glide: null, drag: { id, x: r[0], y: r[1] } }));
  };
  const move = (id: CastId) => (e: PointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || g.id !== id) return;
    lastTouch.current = Date.now();
    const p = local(e);
    setS((x) => {
      const { slots } = layout(x.mode, x.ratio, x.order.length);
      const at = x.order.indexOf(id);
      const mine = slots[at];
      if (!mine) return x;
      const c = { x: p.x - g.dx + mine[2] / 2, y: p.y - g.dy + mine[3] / 2 };
      let best = at, bd = Infinity;
      slots.forEach((r, i) => { const m = center(r), d = (m.x - c.x) ** 2 + (m.y - c.y) ** 2; if (d < bd) { bd = d; best = i; } });
      return { ...x, drag: { id, x: p.x - g.dx, y: p.y - g.dy }, order: best === at ? x.order : moveTo(x.order, id, best) };
    });
  };
  const drop = (id: CastId) => () => {
    if (grab.current?.id !== id) return;
    grab.current = null;
    lastTouch.current = Date.now();
    setS((x) => ({ ...x, drag: null, lifted: null, glide: { id, kind: 'drop' } }));
  };
  const toSpeaker = (id: CastId) => { touch(); setS((x) => ({ ...x, order: moveTo(x.order, id, 0), mode: 'speaker', instant: false })); };
  /* On touch screens: tap one person, then another, to swap them. */
  const tap = (id: CastId) => {
    if (!matchMedia('(pointer: coarse)').matches) return;
    touch();
    setS((x) => {
      if (!x.picked) return { ...x, picked: id };
      if (x.picked === id) return { ...x, picked: null };
      const a = x.order.indexOf(x.picked), b = x.order.indexOf(id), o = [...x.order];
      o[a] = id; o[b] = x.picked;
      return { ...x, order: o, picked: null };
    });
  };
  /* The divider: give the shared screen more or less room. */
  const barDown = (e: PointerEvent<HTMLDivElement>) => { e.preventDefault(); touch(); e.currentTarget.setPointerCapture(e.pointerId); setS((x) => ({ ...x, resizing: true, instant: true })); };
  const barMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!now.current.resizing) return;
    lastTouch.current = Date.now();
    const ratio = Math.max(0.42, Math.min(0.8, (local(e).x - X0) / WW));
    setS((x) => ({ ...x, ratio }));
  };
  const barUp = () => setS((x) => (x.resizing ? { ...x, resizing: false, instant: false } : x));

  /* Left alone, it plays itself. */
  useSceneLoop(stage, async (c) => {
    const free = async () => { await c.open(); while (Date.now() - lastTouch.current < IDLE_MS || grab.current || now.current.resizing) await c.sleep(400); };
    const say = (icon: IconName, text: string) => setS((x) => ({ ...x, say: { icon, text } }));
    const carry = async (id: CastId, to: number) => {
      if (now.current.order.indexOf(id) === to) return;
      setS((x) => ({ ...x, lifted: id, glide: null }));
      await c.sleep(350);
      setS((x) => ({ ...x, order: moveTo(x.order, id, to), glide: { id, kind: 'carry' } }));
      await c.sleep(1150);
      setS((x) => ({ ...x, lifted: null }));
      await c.sleep(450);
      setS((x) => ({ ...x, glide: null }));
    };
    const slide = async (to: number) => {
      setS((x) => ({ ...x, instant: true, resizing: false }));
      await c.wait(animate(now.current.ratio, to, { duration: 1.5, ease: EASE.inOut, onUpdate: (ratio) => setS((x) => ({ ...x, ratio })) }));
      setS((x) => ({ ...x, instant: false }));
    };
    await c.sleep(900);
    for (;;) {
      await free(); say('people', 'Drag anyone to a new spot'); await c.sleep(500);
      await free(); await carry('lena', 0); await c.sleep(700);
      await free(); await carry('priya', now.current.order.length - 1); await c.sleep(600);
      await free(); say('screen', 'Pull the divider to give the screen more room'); await c.sleep(400);
      await free(); await slide(0.5); await c.sleep(900);
      await free(); await slide(0.74); await c.sleep(700);
      await free(); say('people', 'Double-click to make someone the speaker'); await c.sleep(500);
      await free(); setS((x) => ({ ...x, pressed: 'theo' })); await c.sleep(280);
      setS((x) => ({ ...x, pressed: null, order: moveTo(x.order, 'theo', 0), mode: 'speaker' })); await c.sleep(2600);
      await free(); say('grid', 'Or see everyone at once'); setMode('grid'); await c.sleep(2600);
      await free(); setS((x) => ({ ...x, say: null, order: FIRST, ratio: 0.68, mode: 'side' })); await c.sleep(2400);
    }
  }, !reduce);

  const glide = (id: CastId | 'screen'): Transition => {
    if (reduce || s.instant || (s.drag && s.drag.id === id)) return { duration: 0 };
    if (s.glide && s.glide.id === id) return s.glide.kind === 'carry' ? { duration: 1.15, ease: EASE.inOut } : { duration: 0.6, ease: BACK };
    return { duration: 0.75, ease: EASE.expo };
  };
  const speaking = (id: CastId) => (s.mode === 'speaker' ? s.order[0] === id : id === 'kofi');

  return (
    <>
      <SceneFrame>
        <Fit width={W} height={600} stageRef={stage} interactive label="A call you can rearrange: drag people, pull the divider, or double-click someone to make them the speaker">
          <div className="lp-scene">
            <SceneHead title="Design review" time="18:42" />
            <motion.div className="lp-ly-screen" initial={false} animate={{ ...box(L.scr), opacity: L.scrOn ? 1 : 0 }} transition={{ default: glide('screen'), opacity: { duration: 0.5 } }}>
              <SharedScreen />
            </motion.div>
            {L.bar && (
              <div className={cn('lp-ly-bar', s.instant && 'is-on')} style={{ left: L.bar[0], top: L.bar[1] }}
                role="separator" aria-orientation="vertical" aria-label="Resize the shared screen"
                onPointerDown={barDown} onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}><i /></div>
            )}
            {s.order.map((id, i) => {
              const slot = L.slots[i];
              if (!slot) return null;
              const d = s.drag && s.drag.id === id ? s.drag : null;
              const r: Rect = d ? [d.x, d.y, slot[2], slot[3]] : slot;
              const up = s.lifted === id;
              return (
                <motion.div key={id} className={cn('lp-ly-tile', d && 'is-held', s.picked === id && 'is-picked')} style={{ zIndex: up || d || s.glide?.id === id ? 10 : 1 }}
                  initial={false}
                  animate={{ ...box(r), scale: s.pressed === id ? 0.97 : up ? 1.05 : 1, boxShadow: up ? '0 34px 60px -20px rgba(0,0,0,0.85)' : '0 0px 0px 0px rgba(0,0,0,0)' }}
                  transition={{ default: glide(id), scale: { duration: up ? 0.35 : 0.45, ease: up ? EASE.out : BACK }, boxShadow: { duration: 0.35 } }}
                  onPointerDown={down(id)} onPointerMove={move(id)} onPointerUp={drop(id)} onPointerCancel={drop(id)}
                  onDoubleClick={() => toSpeaker(id)} onClick={() => tap(id)}>
                  <CallTile person={CAST[id]} name={firstOf(id)} speaking={speaking(id)} />
                </motion.div>
              );
            })}
            <AnimatePresence>
              {s.say && (
                <motion.div key={s.say.text} className="lp-banner" style={{ top: 66, x: '-50%' }} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6, transition: { duration: 0.4, ease: EASE.in } }} transition={{ duration: 0.5, ease: EASE.expo }}>
                  <Icon name={s.say.icon} size={16} /><span>{s.say.text}</span>
                </motion.div>
              )}
            </AnimatePresence>
            <SceneDock on="layout" />
          </div>
        </Fit>
      </SceneFrame>
      <div className="lp-ctrls">
        <Segmented<Mode> label="Layout" value={s.mode} onChange={(m) => { touch(); setMode(m); }}
          options={[{ value: 'side', label: 'Side by side', icon: 'layout' }, { value: 'speaker', label: 'Speaker', icon: 'people' }, { value: 'grid', label: 'Grid', icon: 'grid' }]} />
        <p>{s.touched ? 'Double-click someone to make them the speaker.' : 'It plays on its own. Grab anyone or the divider to try it yourself.'}</p>
      </div>
    </>
  );
}
