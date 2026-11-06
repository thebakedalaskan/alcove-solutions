/*
 * Breakout rooms, in the side panel: a board to set them up (how many, how long, what they have to work on, who goes
 * where), then an overview while they're open (the shared timer, each room and whether it's on its board, renaming it,
 * moving someone to another room, a message to every room, and bringing everyone back). The rooms themselves are call
 * state on the server, each with its own encryption keys; only the organizer opens them, and only people invited to the
 * call are sent to one. Guests stay in the main room. A room's board is sealed to it, so the overview says only that a
 * room is on it.
 */
import type { BoardTemplate, BreakoutBoard, BreakoutBoardMode, Breakouts, Person } from '@alcove/api';
import { Avatar, Button, EmptyState, Icon, IconButton, Popover, Segmented, cn } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { callName, sameEmail } from '~/lib/people';

/** Someone who can be sent to a room: an invited person in the call, by their email address. */
export interface RoomCandidate { id: string; person: Person }
/** What the call says about open rooms: who is talking in each, who in each raised a hand for help, and the room you're in. */
export interface RoomActivity { talking: (string | null)[]; help: (string | null)[]; joined: number | null }

const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;
const RING = 169.6;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** What a board for rooms can start from, as the Board menu names them. */
const TEMPLATES: { id: BoardTemplate; label: string }[] = [
  { id: 'what-why-next', label: 'What, why, next' }, { id: 'retro', label: 'Retro' }, { id: 'ideas', label: 'Ideas' }, { id: 'flow', label: 'Flow' }, { id: 'blank', label: 'Blank' }
];
/** What the Board row's line says about each choice. */
const BOARD_LINE: Record<Exclude<BreakoutBoardMode, 'none'>, string> = {
  each: 'Only that room sees its board. When rooms close, every board comes back to the main room.',
  shared: 'One board, a frame for each room. Everyone can see every frame while they work.'
};

/** What a new board for the rooms starts from: a choice, in the line under the Board row. */
function StartsFrom({ template, onPick }: { template: BoardTemplate; onPick: (t: BoardTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const label = TEMPLATES.find((t) => t.id === template)?.label ?? 'Blank';
  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="start" label="What it starts from" className="ic-menu narrow"
      anchor={<button type="button" className="from" aria-label={`Starts from ${label}. Change it`}><Icon name="layoutTemplate" size={15} /><span>{label}</span><Icon name="down" size={14} /></button>}>
      {TEMPLATES.map((t) => (
        <button key={t.id} type="button" className="mi" aria-pressed={t.id === template} onClick={() => { setOpen(false); onPick(t.id); }}>
          <Icon name={t.id === template ? 'check' : 'layoutTemplate'} size={17} /><span className="t">{t.label}</span>
        </button>
      ))}
    </Popover>
  );
}

function shuffled(ids: string[], n: number): string[][] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; const u = a[j]; if (t !== undefined && u !== undefined) { a[i] = u; a[j] = t; } }
  return Array.from({ length: n }, (_, k) => a.filter((_, i) => i % n === k));
}

export function RoomsSetup({ people, guests, boardName, onOpen }: {
  people: RoomCandidate[];
  /** How many people here joined with the link: they stay in the main room. */
  guests: number;
  /** The board open in the main room now, by name: rooms sharing a board share that one. Null when there's none. */
  boardName: string | null;
  onOpen: (rooms: { name: string; ids: string[] }[], minutes: number, board: BreakoutBoard) => void;
}) {
  const [n, setN] = useState<'2' | '3'>('2');
  const [len, setLen] = useState<'5' | '10' | '15'>('5');
  const [mode, setMode] = useState<BreakoutBoardMode>('none');
  const [template, setTemplate] = useState<BoardTemplate>('what-why-next');
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
  // Someone invited joins while the board is open: they go to the room with the fewest people; anyone who left comes off it.
  const ids = people.map((p) => p.id).join(' ');
  useEffect(() => {
    const here = new Set(ids.split(' ').filter(Boolean));
    setAssign((a) => {
      const kept = a.map((r) => r.filter((id) => here.has(id)));
      for (const id of here) {
        if (kept.some((r) => r.includes(id))) continue;
        const room = kept.slice(0, Number(n)).reduce((best, r, k, all) => (r.length < (all[best]?.length ?? Infinity) ? k : best), 0);
        kept[room] = [...(kept[room] ?? []), id];
      }
      return kept;
    });
  }, [ids, n]);

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
  if (!people.length) {
    return (
      <div className="ic-scroll ic-pad">
        <EmptyState title="Nobody to send to a room yet" className="ic-empty">
          Rooms are for people you invited. They appear here once they join.{guests > 0 ? ` ${guests === 1 ? 'The guest here stays' : `The ${guests} guests here stay`} in the main room with you.` : ''}
        </EmptyState>
      </div>
    );
  }
  return (
    <>
      <div className="ic-scroll ic-pad">
        <div className="ic-rtop">
          <span>Rooms</span>
          <Segmented label="How many rooms" value={n} onChange={(v) => { setN(v); setAssign(shuffled(people.map((p) => p.id), Number(v))); }} options={[{ value: '2', label: '2' }, { value: '3', label: '3' }]} />
          <span>Length</span>
          <Segmented label="How long" value={len} onChange={setLen} options={[{ value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }]} />
          <span>Board</span>
          <Segmented label="Board" className="ic-seg3" value={mode} onChange={setMode} options={[{ value: 'none', label: 'None' }, { value: 'each', label: 'In each room' }, { value: 'shared', label: 'Shared' }]} />
        </div>
        {mode !== 'none' && (
          <div key={mode} className="ic-rline">
            <span>{BOARD_LINE[mode]}</span>
            {mode === 'shared' && boardName !== null
              ? <span className="from is-fixed"><Icon name="presentation" size={15} /><span className="ac-clamp-1">{boardName}</span></span>
              : <StartsFrom template={template} onPick={setTemplate} />}
          </div>
        )}
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
        <div className="ic-rnote"><Icon name="swap" size={15} /><span>Drag people between rooms. Click a name to rename a room. You stay in the main room and can join any room.{guests > 0 ? ` ${guests === 1 ? 'The guest who joined with the link stays' : `The ${guests} guests who joined with the link stay`} in the main room with you.` : ''}</span></div>
        <div className="ic-rnote"><Icon name="notesPen" size={15} /><span>While notes are on, what’s said in each room is transcribed by one browser there, never recorded, and goes into the call’s notes as that room’s own section.</span></div>
      </div>
      <div className="ic-foot">
        <Button variant="primary" icon="door" className="w-full" disabled={!people.length}
          onClick={() => onOpen(assign.slice(0, rooms).map((ids, k) => ({ name: (names[k] ?? '').trim() || `Room ${k + 1}`, ids })), Number(len), { mode, template })}>
          Open {rooms} rooms
        </Button>
      </div>
      {move && mover && (
        <div className="ic-rp is-float" style={{ left: move.x - 40, top: move.y - 17 }}><Avatar person={mover.person} size={22} /><span className="nm">{callName(mover.person)}</span></div>
      )}
    </>
  );
}

/**
 * A room's name, edited where it's shown: Enter or leaving the field keeps it; Escape, or an empty name, puts the old
 * one back.
 */
function RoomName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  // Escape leaves the field too: that blur mustn't keep what was typed, which it still sees.
  const dropped = useRef(false);
  useEffect(() => { setDraft(name); }, [name]);
  const keep = () => {
    if (dropped.current) { dropped.current = false; return; }
    const t = draft.trim();
    if (!t) setDraft(name);
    else if (t !== name) onRename(t);
  };
  return (
    <input className="ic-rname is-live" value={draft} maxLength={40} aria-label={`Rename ${name}`}
      onChange={(e) => setDraft(e.target.value)} onBlur={keep}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { dropped.current = true; setDraft(name); e.currentTarget.blur(); }
      }} />
  );
}

/** Someone sent to a room, and where else they can go: another room, or back to the main room. Their keys move with them. */
function RoomPerson({ person, here, room, rooms, onMove }: { person: Person; here: boolean; room: number; rooms: string[]; onMove: (room: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const go = (to: number | null) => { setOpen(false); onMove(to); };
  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="start" label={`Move ${callName(person)}`} className="ic-menu narrow"
      anchor={<button type="button" className={cn('ic-rchip', !here && 'is-away')} aria-label={`${callName(person)}${here ? '' : ', not here yet'}. Move to another room`}><Avatar person={person} size={18} /><span className="nm">{callName(person)}</span><Icon name="down" size={13} /></button>}>
      <div className="mh"><Avatar person={person} size={22} /><span className="t">{callName(person)}</span></div>
      {rooms.map((name, k) => (k === room ? null : <button key={k} type="button" className="mi" onClick={() => go(k)}><Icon name="door" size={17} /><span className="t">Move to {name}</span></button>))}
      <button type="button" className="mi" onClick={() => go(null)}><Icon name="left" size={17} /><span className="t">Back to the main room</span></button>
    </Popover>
  );
}

export function RoomsLive({ open, elapsed, members, people, activity, me, onJoin, onRename, onMove, onMessage, onClose }: {
  open: NonNullable<Breakouts['open']>; elapsed: number;
  /** Who is in each room now: the invited people sent there who are in the call, and you while you're there. */
  members: Person[][];
  people: Map<string, Person>; activity: RoomActivity; me: Person;
  onJoin: (room: number | null) => void;
  onRename: (room: number, name: string) => void;
  /** Sends someone invited (by email) to another room, or back to the main room (null). */
  onMove: (email: string, room: number | null) => void;
  onMessage: (text: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const total = Math.max(1, open.until - open.from);
  // One primary action in the view: joining the first room that asked for help.
  const firstHelp = activity.help.findIndex((h, k) => h !== null && activity.joined !== k);
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
            const here = activity.joined === k;
            const help = activity.help[k] ?? null;
            const talking = activity.talking[k] ?? null;
            const inRoom = members[k] ?? [];
            const coming = r.people.length - inRoom.filter((p) => r.people.some((x) => sameEmail(x, p))).length;
            return (
              <div key={r.id} className={cn('ic-rcard', here && 'is-here', help && 'is-help')}>
                <div className="top1">
                  <RoomName name={r.name} onRename={(name) => onRename(k, name)} />
                  <Button size="sm" variant={k === firstHelp ? 'primary' : 'secondary'} onClick={() => onJoin(here ? null : k)}>{here ? 'Back to main room' : 'Join room'}</Button>
                </div>
                <div className="line2">
                  {help ? <span className="ac-chip"><Icon name="hand" size={13} />{callName(people.get(help) ?? { name: 'Someone', email: '' })} asked for help</span>
                    : talking ? <><span className="ac-level" aria-hidden="true"><i /><i /><i /></span><span>{callName(people.get(talking) ?? { name: 'Someone', email: '' })} is talking</span></>
                      : <span>{inRoom.length ? `${inRoom.length} ${inRoom.length === 1 ? 'person' : 'people'}${here ? ', you too' : ''}` : 'Nobody in this room'}</span>}
                  {r.paused ? <span className="end ac-chip"><Icon name="pause" size={13} />Notes paused</span> : coming > 0 && <span className="end">{coming} not here yet</span>}
                </div>
                {/* What's on a room's board is sealed to the room: the organizer sees it only by joining. */}
                {r.board && <div className="onb"><Icon name="presentation" size={15} /><span>{here ? 'You’re here, so you can see it' : 'On the board now. Join to see it.'}</span></div>}
                {r.people.length > 0 && (
                  <div className="ic-rchips">
                    {r.people.map((p) => {
                      // Shown as the call knows them (their name and picture) once they're here; by address until then.
                      const known = [...people.values()].find((x) => x.email !== '' && sameEmail(x, p)) ?? p;
                      return <RoomPerson key={p.email} person={known} here={inRoom.some((x) => sameEmail(x, p))} room={k} rooms={open.rooms.map((x) => x.name)} onMove={(to) => onMove(p.email, to)} />;
                    })}
                  </div>
                )}
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
        <p className="ic-rnote"><Avatar person={me} size={18} /><span>{activity.joined === null ? 'You’re in the main room.' : `You’re in ${open.rooms[activity.joined]?.name ?? 'a room'}.`} Each room has its own encryption keys and chat. While notes are on, what’s said in each room goes into the call’s notes as its own section.</span></p>
      </div>
      <div className="ic-foot"><Button variant="secondary" className="w-full" onClick={onClose}>Bring everyone back now</Button></div>
    </>
  );
}
