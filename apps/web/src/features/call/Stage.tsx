/*
 * The stage: everyone's tiles, a shared screen, the bar that says what's shared or spotlighted, and
 * the captions. Tiles sit where the layout engine (view.ts) puts them and glide there; you can drag
 * them into another order, make one bigger from its corner or its menu, and drag the line beside a
 * shared screen. All of that changes your view only. With rooms open, the organizer's stage shows every room;
 * everyone else's shows the people in their own room.
 */
import type { Person } from '@alcove/api';
import { Avatar, CallTile, Icon, NotesSign, Popover, Scope, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { callName } from '~/lib/people';
import { FeedVideo, type Feed } from './Video';
import { fitGrid, layout, ordered, type CallView, type Rect } from './view';

export interface StageParticipant {
  id: string; person: Person; isMe: boolean; mic: boolean; hand: boolean; speaking: boolean;
  /** Their camera, when it's on and this browser plays their media. */
  video: Feed | null;
}
/** Open rooms, as the organizer oversees them: who's in each, and who in a room raised a hand for help. */
export interface StageRooms {
  rooms: { name: string; ids: string[]; help: string | null }[];
  /** Everyone in no room: the organizer while there, guests, and anyone not sent to a room. */
  main: string[];
  /** The room you're in, or null for the main room. */
  joined: number | null;
  left: number;
  message: { from: Person; text: string } | null;
  notesOn: boolean;
}

const GLIDE = { duration: 0.5, ease: [0.45, 0, 0.2, 1] } as const;
const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const box = (r: Rect) => ({ left: r[0], top: r[1], width: r[2], height: r[3] });

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

export function Stage({ people, spotlight, view, organizer, screen, bar, caption, rooms, onSpotlight, onCustom }: {
  people: StageParticipant[];
  spotlight: string | null;
  view: CallView;
  organizer: boolean;
  /** The screen being shared, and whose it is ("You’re sharing a tab"). */
  screen: { feed: Feed; label: string } | null;
  /** The status bar's pills: what you share, who is spotlighted. */
  bar: ReactNode;
  caption: ReactNode;
  rooms: StageRooms | null;
  onSpotlight: (id: string | null) => void;
  /** The first time you arrange your own view. */
  onCustom: () => void;
}) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const reduce = useReducedMotion();
  const narrow = w > 0 && w < 760;
  const v = view.view;
  const ids = ordered(people.map((p) => p.id), v, spotlight);
  const speaker = people.find((p) => p.speaking && !p.isMe)?.id ?? null;
  // Auto goes to speaker view only for someone who has been doing most of the talking, not every new voice.
  const heard = useRef<string[]>([]);
  if (speaker && heard.current.at(-1) !== speaker) heard.current = [...heard.current, speaker].slice(-5);
  const counts = new Map<string, number>();
  for (const x of heard.current) counts.set(x, (counts.get(x) ?? 0) + 1);
  const dominant = [...counts].find(([, n]) => n >= 4)?.[0] ?? null;
  const lead = spotlight ?? v.pinned ?? (v.mode === 'speaker' ? speaker ?? heard.current.at(-1) ?? null : dominant);
  const top = bar ? 46 : 0;
  const bottom = caption ? (w < 700 ? 150 : 124) : 0;
  const L = layout({ ids, big: new Set(narrow ? [] : v.big), mode: v.mode, lead, screen: !!screen, ratio: v.ratio, width: w, height: h, top, bottom });
  const resizable = !narrow && L.shape !== 'speaker' && !rooms;
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ id: string; w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const press = useRef<{ id: string; x: number; y: number; dx: number; dy: number; on: boolean } | null>(null);
  const grow = useRef<{ id: string; x: number; y: number; w: number; h: number; big: boolean } | null>(null);
  const divider = useRef(false);
  const spotlightRef = useRef(spotlight);
  spotlightRef.current = spotlight;
  const latest = useRef({ L, ids, v, view, onCustom, w, room: h - top - bottom, top });
  latest.current = { L, ids, v, view, onCustom, w, room: h - top - bottom, top };

  /* Dragging a tile, its corner, or the line beside a shared screen: pointer moves anywhere on the page. */
  useEffect(() => {
    const local = (e: PointerEvent) => { const r = ref.current?.getBoundingClientRect(); return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }; };
    const move = (e: PointerEvent) => {
      const { L: lay, ids: order, v: cur, view: vw, w: width, room, top: above } = latest.current;
      const p = local(e);
      if (divider.current && lay.divider) {
        vw.setRatio(lay.divider.vertical ? (p.y - above) / Math.max(1, room - 12) : p.x / Math.max(1, width - 12));
        return;
      }
      const g = grow.current;
      if (g) {
        const nw = Math.max(g.w * 0.5, g.w + e.clientX - g.x);
        const nh = Math.max(g.h * 0.5, g.h + e.clientY - g.y);
        setSize({ id: g.id, w: nw, h: nh });
        const by = Math.max(nw / g.w, nh / g.h);
        const want = g.big ? by > 0.72 : by > 1.35;
        if (want !== cur.big.includes(g.id)) vw.setBig(g.id, want);
        return;
      }
      const d = press.current;
      if (!d) return;
      if (!d.on && Math.abs(p.x - d.x) + Math.abs(p.y - d.y) < 6) return;
      d.on = true;
      const x = p.x - d.dx;
      const y = p.y - d.dy;
      setDrag({ id: d.id, x, y });
      const mine = lay.slots.get(d.id);
      if (!mine) return;
      const cx = x + mine[2] / 2;
      const cy = y + mine[3] / 2;
      let near: string | null = null;
      let best = Infinity;
      for (const [id, r] of lay.slots) {
        const dist = (r[0] + r[2] / 2 - cx) ** 2 + (r[1] + r[3] / 2 - cy) ** 2;
        if (dist < best) { best = dist; near = id; }
      }
      const leaders = [spotlightRef.current, cur.pinned];
      if (!near || near === d.id || leaders.includes(near) || leaders.includes(d.id)) return;
      const next = order.filter((x2) => x2 !== d.id);
      next.splice(order.indexOf(near), 0, d.id);
      vw.setOrder(next.filter((x2) => !leaders.includes(x2)));
    };
    const up = () => {
      const moved = press.current?.on || grow.current || divider.current;
      press.current = null; grow.current = null; divider.current = false;
      setDrag(null); setSize(null);
      if (moved) latest.current.onCustom();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  }, [ref]);

  const startDrag = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0 || L.shape === 'speaker' || rooms || narrow) return;
    if (e.target instanceof Element && e.target.closest('button, [data-handle]')) return;
    const r = L.slots.get(id);
    const at = ref.current?.getBoundingClientRect();
    if (!r || !at) return;
    const x = e.clientX - at.left;
    const y = e.clientY - at.top;
    press.current = { id, x, y, dx: x - r[0], dy: y - r[1], on: false };
  };
  const startGrow = (e: ReactPointerEvent, id: string) => {
    const r = L.slots.get(id);
    if (!r || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    grow.current = { id, x: e.clientX, y: e.clientY, w: r[2], h: r[3], big: v.big.includes(id) };
  };

  if (rooms) return <div ref={ref} className="ic-stage"><RoomsStage people={people} rooms={rooms} w={w} h={h} reduce={!!reduce} /></div>;

  const name = (p: StageParticipant) => (p.isMe ? <>{callName(p.person)} <span className="you">(you)</span></> : callName(p.person));
  return (
    <div ref={ref} className="ic-stage">
      <AnimatePresence>
        {bar && <motion.div key="bar" className="ic-sbar" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={UI}>{bar}</motion.div>}
      </AnimatePresence>
      {screen && L.screen && (
        <motion.div className="ic-scr" initial={{ ...box(L.screen), opacity: 0 }} animate={{ ...box(L.screen), opacity: 1 }} transition={reduce || divider.current ? { duration: 0 } : GLIDE}>
          <FeedVideo feed={screen.feed} className="screen" />
          <span className="ac-tile-name"><Icon name="screen" size={14} />{screen.label}</span>
        </motion.div>
      )}
      {L.divider && !narrow && (
        <motion.div className={cn('ic-divider', L.divider.vertical && 'is-v')} role="separator" tabIndex={0} aria-label="Resize the shared screen. Only your view changes" data-handle
          initial={false} animate={L.divider.vertical ? { left: L.divider.x - 28, top: L.divider.y - 12 } : { left: L.divider.x - 12, top: L.divider.y - 28 }} transition={reduce || divider.current ? { duration: 0 } : GLIDE}
          onPointerDown={(e) => { e.preventDefault(); divider.current = true; }}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -0.03 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.03 : 0;
            if (!d) return;
            e.preventDefault(); view.setRatio(v.ratio + d); onCustom();
          }}><i /></motion.div>
      )}
      {people.map((p) => {
        const r = L.slots.get(p.id);
        if (!r) return null;
        const dragging = drag?.id === p.id;
        const sizing = size?.id === p.id;
        const pinned = v.pinned === p.id;
        const spot = spotlight === p.id;
        const at = dragging ? { left: drag.x, top: drag.y, width: r[2], height: r[3] } : sizing ? { left: r[0], top: r[1], width: size.w, height: size.h } : box(r);
        return (
          <motion.div key={p.id} className={cn('ic-slot', dragging && 'is-drag', sizing && 'is-sizing', resizable && 'can-drag')} onPointerDown={(e) => startDrag(e, p.id)}
            initial={{ ...at, opacity: 0, scale: 0.97 }} animate={{ ...at, opacity: 1, scale: dragging ? 1.03 : 1 }}
            transition={reduce || dragging || sizing ? { duration: 0 } : { ...GLIDE, opacity: UI, scale: UI }}>
            <CallTile person={p.person} name={name(p)} label={p.person.name} speaking={p.speaking} muted={!p.mic} hand={p.hand} className={cn(p.isMe && 'is-me', pinned && 'is-pinned', spot && 'is-spot')}
              chrome={(
                <>
                  <div className="ic-tstate">
                    {spot && (
                      <span className="ic-tch is-spot"><Icon name="spotlight" size={13} />Spotlight · everyone
                        {organizer && <button type="button" className="tx" aria-label="Stop spotlight for everyone" onClick={() => onSpotlight(null)}><Icon name="x" size={12} /></button>}
                      </span>
                    )}
                    {pinned && (
                      <span className="ic-tch"><Icon name="pin" size={13} />Pinned for you
                        <button type="button" className="tx" aria-label={`Unpin ${callName(p.person)} (Esc)`} onClick={() => view.setPinned(null)}><Icon name="x" size={12} /></button>
                      </span>
                    )}
                  </div>
                  <TileMenu p={p} open={menu === p.id} onOpenChange={(o) => setMenu(o ? p.id : null)} pinned={pinned} spot={spot} organizer={organizer}
                    big={v.big.includes(p.id)} canSize={resizable}
                    onPin={() => view.setPinned(pinned ? null : p.id)} onSpot={() => onSpotlight(spot ? null : p.id)}
                    onSize={() => { view.setBig(p.id, !v.big.includes(p.id)); onCustom(); }} />
                  {resizable && <span className="ic-rs" data-handle aria-hidden="true" onPointerDown={(e) => startGrow(e, p.id)}><Icon name="resize" size={14} /></span>}
                </>
              )}>
              {p.video ? <FeedVideo feed={p.video} /> : undefined}
            </CallTile>
          </motion.div>
        );
      })}
      <AnimatePresence>
        {caption && <motion.div key="cap" className="ic-cap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={UI}>{caption}</motion.div>}
      </AnimatePresence>
    </div>
  );
}

/** One person's menu: what each choice changes, said on the choice. */
function TileMenu({ p, open, onOpenChange, pinned, spot, organizer, big, canSize, onPin, onSpot, onSize }: {
  p: StageParticipant; open: boolean; onOpenChange: (o: boolean) => void; pinned: boolean; spot: boolean; organizer: boolean; big: boolean; canSize: boolean;
  onPin: () => void; onSpot: () => void; onSize: () => void;
}) {
  const first = callName(p.person);
  const pick = (f: () => void) => () => { onOpenChange(false); f(); };
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="start" label={`Options for ${first}`} className="ic-menu"
      anchor={<button type="button" className={cn('ic-more', open && 'is-on')} aria-label={`Options for ${first}`} aria-haspopup="menu"><Icon name="more" size={16} /></button>}>
      <div className="mh"><Avatar person={p.person} size={22} /><b>{p.person.name}{p.isMe ? ' (you)' : ''}</b></div>
      <button type="button" className="mi" onClick={pick(onPin)}><Icon name={pinned ? 'pinOff' : 'pin'} size={17} /><span className="t">{pinned ? 'Unpin for me' : 'Pin for me'}</span><Scope>Only you</Scope></button>
      {organizer && <button type="button" className="mi" onClick={pick(onSpot)}><Icon name="spotlight" size={17} /><span className="t">{spot ? 'Stop spotlight' : 'Spotlight for everyone'}</span><Scope everyone>Everyone</Scope></button>}
      {canSize && <button type="button" className="mi" onClick={pick(onSize)}><Icon name={big ? 'shrink' : 'grow'} size={17} /><span className="t">{big ? 'Make smaller' : 'Make bigger'}</span><Scope>Only you</Scope></button>}
      <p className="hint">{organizer ? 'Only the organizer can spotlight. You’re the organizer.' : 'Only the organizer can spotlight.'}</p>
    </Popover>
  );
}

/** Rooms are open: the main room while anyone is in it, and each room with the people in it. */
function RoomsStage({ people, rooms, w, h, reduce }: { people: StageParticipant[]; rooms: StageRooms; w: number; h: number; reduce: boolean }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const top = 52;
  const port = w < h * 0.9;
  const gap = port ? 10 : 14;
  const units = [
    ...(rooms.main.length ? [{ room: -1, weight: rooms.main.length > 1 ? 1 : 0.5, ids: rooms.main }] : []),
    ...rooms.rooms.map((r, k) => ({ room: k, weight: 1, ids: r.ids }))
  ];
  const total = units.reduce((n, u) => n + u.weight, 0);
  const avail = (port ? h - top : w) - (units.length - 1) * gap;
  let cur = port ? top : 0;
  const placed = units.map((u) => {
    const s = (avail * u.weight) / Math.max(1, total);
    const card: Rect = port ? [0, cur, w, s] : [cur, top, s, h - top];
    cur += s + gap;
    const grid = fitGrid(u.ids.length, card[0] + 12, card[1] + 55, card[2] - 24, card[3] - 67, port ? 1.3 : 0.9, 10);
    return { ...u, card, tiles: u.ids.map((id, k) => ({ id, r: grid[k] })) };
  });
  const soon = rooms.left <= 30;
  const t = mmss(rooms.left);
  return (
    <>
      <div className="ic-lane">
        <AnimatePresence mode="wait" initial={false}>
          {rooms.message ? (
            <motion.div key={`m-${rooms.message.text}`} className="ic-banner" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={UI}>
              <Avatar person={rooms.message.from} size={24} /><span><b>{callName(rooms.message.from)}</b> to all rooms: {rooms.message.text}</span>
            </motion.div>
          ) : (
            <motion.span key="quiet" className={cn('quiet', soon && 'is-soon')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI}>
              <Icon name={soon ? 'timer' : 'door'} size={16} />
              {soon ? `Rooms close in ${t}. Everyone comes back here.` : `${rooms.joined === null ? 'You’re in the main room' : `You’re in ${rooms.rooms[rooms.joined]?.name ?? 'a room'}`} · everyone comes back in ${t}`}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {placed.map((u, k) => {
        const room = u.room >= 0 ? rooms.rooms[u.room] : undefined;
        const here = rooms.joined === (room ? u.room : null);
        const justMe = !room && u.ids.length === 1 && byId.get(u.ids[0] ?? '')?.isMe === true;
        return (
          <motion.div key={`card-${u.room}`} className={cn('ic-roomc', u.room < 0 && 'is-main', here && room && 'is-here', room?.help && 'has-help')}
            initial={{ ...box(u.card), opacity: 0, scale: 0.97 }} animate={{ ...box(u.card), opacity: 1, scale: 1 }} transition={reduce ? { duration: 0 } : { ...GLIDE, delay: k * 0.03 }}>
            {room && <div className="bar" style={{ background: ROOMBAR[u.room % ROOMBAR.length] }} />}
            <div className="h">
              <b>{room ? room.name : 'Main room'}</b>
              <span>{justMe ? 'you' : `${u.ids.length} ${u.ids.length === 1 ? 'person' : 'people'}`}</span>
              {here && !justMe && <span className="here">· you’re here</span>}
              {room?.help && <span className="hand-chip"><Icon name="hand" size={13} />{callName(byId.get(room.help)?.person ?? { name: 'Someone', email: '' })} asked for help</span>}
              {room && <span className="ac-time">{t}</span>}
              {room && rooms.notesOn && <NotesSign stage>Notes</NotesSign>}
            </div>
            {!u.ids.length && <p className="empty">Nobody in this room</p>}
          </motion.div>
        );
      })}
      {placed.flatMap((u) => u.tiles).map(({ id, r }) => {
        const p = byId.get(id);
        if (!p || !r) return null;
        return (
          <motion.div key={id} className="ic-slot" initial={{ ...box(r), opacity: 0 }} animate={{ ...box(r), opacity: 1 }} transition={reduce ? { duration: 0 } : GLIDE}>
            <CallTile person={p.person} name={p.isMe ? <>{callName(p.person)} <span className="you">(you)</span></> : callName(p.person)} speaking={p.speaking} muted={!p.mic} hand={p.hand}>
              {p.video ? <FeedVideo feed={p.video} /> : undefined}
            </CallTile>
          </motion.div>
        );
      })}
    </>
  );
}
const ROOMBAR = ['linear-gradient(90deg,var(--dawn-2),var(--dawn-3))', 'linear-gradient(90deg,var(--dawn-3),var(--dawn-4))', 'linear-gradient(90deg,var(--dawn-1),var(--dawn-2))'];
