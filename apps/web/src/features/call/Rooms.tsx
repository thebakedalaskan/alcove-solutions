/*
 * Breakout rooms, in the side panel: a board to set them up (how many, how long, who goes where),
 * then an overview while they're open (the shared timer, each room, a message to every room, and
 * bringing everyone back). The rooms themselves are call state on the server; only the organizer
 * opens them, and only people invited to the call are sent to one.
 */
import type { Breakouts, Person } from '@alcove/api';
import { Avatar, Button, Faces, Icon, IconButton, Segmented, cn } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { callName } from '~/lib/people';

/** Someone who can be sent to a room. */
export interface RoomCandidate { id: string; person: Person }
/** What the preview adds to open rooms: who is talking in each, how many notes, who asked for help. */
export interface RoomActivity { talking: (string | null)[]; notes: number[]; help: { room: number; id: string } | null; joined: number | null }

const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;
const RING = 169.6;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

function shuffled(ids: string[], n: number): string[][] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; const u = a[j]; if (t !== undefined && u !== undefined) { a[i] = u; a[j] = t; } }
  return Array.from({ length: n }, (_, k) => a.filter((_, i) => i % n === k));
}

export function RoomsSetup({ people, onOpen }: { people: RoomCandidate[]; onOpen: (rooms: { name: string; ids: string[] }[], minutes: number) => void }) {
  const [n, setN] = useState<'2' | '3'>('2');
  const [len, setLen] = useState<'5' | '10' | '15'>('5');
  const [names, setNames] = useState(['Room 1', 'Room 2', 'Room 3']);
  const [assign, setAssign] = useState<string[][]>(() => shuffled(people.map((p) => p.id), 2));
  const [move, setMove] = useState<{ id: string; x: number; y: number; over: number | null } | null>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const reduce = useReducedMotion();
  const byId = new Map(people.map((p) => [p.id, p]));
  const rooms = Number(n);
  const roomOf = (id: string) => assign.findIndex((r) => r.includes(id));
  const moveTo = (id: string, to: number) => setAssign((a) => a.map((r, k) => (k === to ? (r.includes(id) ? r : [...r, id]) : r.filter((x) => x !== id))));
  const colAt = (x: number, y: number) => cols.current.findIndex((c) => { const r = c?.getBoundingClientRect(); return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });

  useEffect(() => {
    if (!move) return;
    const go = (e: PointerEvent) => setMove((m) => (m ? { ...m, x: e.clientX, y: e.clientY, over: colAt(e.clientX, e.clientY) } : m));
    const up = (e: PointerEvent) => { const to = colAt(e.clientX, e.clientY); if (to >= 0) moveTo(move.id, to); setMove(null); };
    addEventListener('pointermove', go);
    addEventListener('pointerup', up);
    return () => { removeEventListener('pointermove', go); removeEventListener('pointerup', up); };
  }, [move]);

  const start = (e: ReactPointerEvent, id: string) => { if (e.button === 0) setMove({ id, x: e.clientX, y: e.clientY, over: null }); };
  const mover = move ? byId.get(move.id) : undefined;
  return (
    <>
      <div className="ic-scroll ic-pad">
        <div className="ic-rtop">
          <span>Rooms</span>
          <Segmented label="How many rooms" value={n} onChange={(v) => { setN(v); setAssign(shuffled(people.map((p) => p.id), Number(v))); }} options={[{ value: '2', label: '2' }, { value: '3', label: '3' }]} />
          <span>Length</span>
          <Segmented label="How long" value={len} onChange={setLen} options={[{ value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }]} />
        </div>
        <div className="ic-boardh"><span className="ac-eyebrow">Who goes where</span><IconButton icon="shuffle" label="Shuffle people" onClick={() => setAssign(shuffled(people.map((p) => p.id), rooms))} /></div>
        <div className="ic-board" style={{ gridTemplateColumns: `repeat(${rooms}, minmax(0, 1fr))` }}>
          {assign.slice(0, rooms).map((ids, k) => (
            <div key={k} ref={(el) => { cols.current[k] = el; }} className={cn('ic-col', move && move.over === k && roomOf(move.id) !== k && 'is-drop')}>
              <div className="ch">
                <Icon name="pen" size={13} />
                <input className="ic-rname" value={names[k] ?? ''} maxLength={24} aria-label="Room name"
                  onChange={(e) => setNames((x) => x.map((v, i) => (i === k ? e.target.value : v)))}
                  onBlur={() => setNames((x) => x.map((v, i) => (i === k && !v.trim() ? `Room ${k + 1}` : v)))}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                <span className="cnt">{ids.length}</span>
              </div>
              {ids.map((id) => {
                const p = byId.get(id);
                if (!p) return null;
                return (
                  <motion.div key={id} layout={!reduce} transition={UI} className={cn('ic-rp', move?.id === id && 'is-ghost')} tabIndex={0}
                    aria-label={`${p.person.name}, in ${names[k] ?? 'this room'}. Drag, or use the arrow keys, to move`}
                    onPointerDown={(e) => start(e, id)}
                    onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); moveTo(id, (k + (e.key === 'ArrowRight' ? 1 : rooms - 1)) % rooms); } }}>
                    <Avatar person={p.person} size={22} /><span className="nm">{callName(p.person)}</span><Icon name="grip" size={14} />
                  </motion.div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="ic-rnote"><Icon name="swap" size={15} /><span>Drag people between rooms. Click a name to rename a room. You stay in the main room and can join any room.</span></div>
      </div>
      <div className="ic-foot">
        <Button variant="primary" icon="door" className="w-full" disabled={!people.length}
          onClick={() => onOpen(assign.slice(0, rooms).map((ids, k) => ({ name: (names[k] ?? '').trim() || `Room ${k + 1}`, ids })), Number(len))}>
          Open {rooms} rooms
        </Button>
      </div>
      {move && mover && (
        <div className="ic-rp is-float" style={{ left: move.x - 40, top: move.y - 17 }}><Avatar person={mover.person} size={22} /><span className="nm">{callName(mover.person)}</span></div>
      )}
    </>
  );
}

export function RoomsLive({ open, elapsed, members, people, activity, me, onJoin, onMessage, onClose }: {
  open: NonNullable<Breakouts['open']>; elapsed: number;
  /** Who is in each room: the invited people the server sent there, and anyone else in the call. */
  members: Person[][];
  people: Map<string, Person>; activity: RoomActivity | null; me: Person;
  onJoin: (room: number | null) => void; onMessage: (text: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const total = Math.max(1, open.until - open.from);
  const left = Math.max(0, open.until - elapsed);
  const soon = left <= 30;
  return (
    <>
      <div className="ic-scroll ic-pad">
        <div className={cn('ic-rtimer', soon && 'is-soon')}>
          <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
            <circle className="trk" cx="32" cy="32" r="27" fill="none" strokeWidth="6" />
            <circle className="prg" cx="32" cy="32" r="27" fill="none" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 32 32)" strokeDasharray={RING} strokeDashoffset={(RING * (1 - left / total)).toFixed(1)} />
          </svg>
          <div><div className="t">{mmss(left)}</div><div className="s">{soon ? `Rooms close in ${Math.ceil(left)} seconds` : 'Everyone comes back when time is up'}</div></div>
        </div>
        <div className="ic-rcards">
          {open.rooms.map((r, k) => {
            const here = activity?.joined === k;
            const help = activity?.help?.room === k ? activity.help : null;
            const talking = activity?.talking[k] ?? null;
            const inRoom = members[k] ?? r.people;
            return (
              <div key={r.id} className={cn('ic-rcard', here && 'is-here', help && 'is-help')}>
                <div className="top1">
                  <b>{r.name}</b>
                  <Faces people={inRoom} size={22} />
                  <Button size="sm" variant={help && !here ? 'primary' : 'secondary'} onClick={() => onJoin(here ? null : k)}>{here ? 'Back to main room' : 'Join room'}</Button>
                </div>
                <div className="line2">
                  {help ? <span className="ac-chip"><Icon name="hand" size={13} />{callName(people.get(help.id) ?? { name: 'Someone', email: '' })} asked for help</span>
                    : talking ? <><span className="ac-level" aria-hidden="true"><i /><i /><i /></span><span>{callName(people.get(talking) ?? { name: 'Someone', email: '' })} is talking</span></>
                      : <span>{inRoom.length ? `${inRoom.length} ${inRoom.length === 1 ? 'person' : 'people'}` : 'Nobody in this room'}</span>}
                  {activity && <span className="end ac-chip">{activity.notes[k] ?? 0} {(activity.notes[k] ?? 0) === 1 ? 'note' : 'notes'}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <form className="ic-bc" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const t = text.trim() || 'Two minutes left'; onMessage(t); setSent(t); setText(''); }}>
          <div className="lab">Message every room</div>
          <div className="inrow">
            <input className="ac-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Two minutes left" aria-label="Message every room" />
            <button type="submit" className="ac-btn is-primary" aria-label="Send to every room"><Icon name="sendLine" size={18} /></button>
          </div>
          {sent && <motion.div className="sent" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={UI}><Icon name="check" size={15} /><span>Sent to {open.rooms.length} rooms: “{sent}”</span></motion.div>}
        </form>
        <p className="ic-rnote"><Avatar person={me} size={18} /><span>{activity?.joined === null || !activity ? 'You’re in the main room.' : `You’re in ${open.rooms[activity.joined]?.name ?? 'a room'}.`} Rooms with notes on go into the call’s notes.</span></p>
      </div>
      <div className="ic-foot"><Button variant="secondary" className="w-full" onClick={onClose}>Bring everyone back now</Button></div>
    </>
  );
}
