/*
 * Breakout rooms, in the side panel: a board to set them up (how many, how long, what they have to work on, who goes
 * where, and whether you start in the main room or in a room), then an overview while they're open (the shared timer, the
 * main room and each room, whether it's on its board, renaming it, sending someone to another room, a message to every
 * room, and bringing everyone back). The rooms themselves are call state on the server, each with its own encryption keys;
 * only the organizer opens them. Anyone in the call can be sent to one, guests with the link too, but only someone invited
 * transcribes a room, so a room with nobody invited in it isn't transcribed, and the board says so before it opens. A
 * room's board is sealed to it, so the overview says only that a room is on it.
 */
import type { BoardTemplate, BreakoutBoard, BreakoutBoardMode, Breakouts, Person, RoomPerson } from '@alcove/api';
import { Avatar, Button, EmptyState, Icon, IconButton, Popover, Segmented, cn } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { callName } from '~/lib/people';

/**
 * Someone who can be sent to a room: anyone in the call but the organizer, by their place on the board (`id`): someone invited
 * by their address, a guest with the link by their seat (`by`), who can't transcribe a room.
 */
export interface RoomCandidate { id: string; person: Person; by: RoomPerson; guest: boolean }
/** Someone sent to an open room, as its card shows them: as the call knows them, whether they're in it now, and how a move names them. */
export interface RoomChip { key: string; person: Person; here: boolean; by: RoomPerson }
/** What the call says about open rooms: who is talking in each, who in each raised a hand for help, and the room you're in. */
export interface RoomActivity { talking: (string | null)[]; help: (string | null)[]; joined: number | null }

const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;
const RING = 169.6;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** What a board for rooms can start from, as the board picker names them. */
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

/** You, on the board: the organizer, in the main room until you put yourself in a room. */
const ME = 'me';
/** The main room's place on the board; each room's is its place among the rooms, plus one. */
const MAIN = 0;

function shuffle(ids: string[]): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; const u = a[j]; if (t !== undefined && u !== undefined) { a[i] = u; a[j] = t; } }
  return a;
}
/** Everyone dealt into `n` rooms: everyone invited first, so a room gets someone who can transcribe it wherever there are enough, then guests. */
function dealt(people: RoomCandidate[], n: number): string[][] {
  const order = [...shuffle(people.filter((p) => !p.guest).map((p) => p.id)), ...shuffle(people.filter((p) => p.guest).map((p) => p.id))];
  return Array.from({ length: n }, (_, k) => order.filter((_, i) => i % n === k));
}
/** Who goes where: the main room, then each room. You stay where you put yourself, as long as that room's still there; everyone else is dealt again. */
const placed = (people: RoomCandidate[], n: number, you: number): string[][] => {
  const at = you <= n ? you : MAIN;
  return [[], ...dealt(people, n)].map((ids, k) => (k === at ? [ME, ...ids] : ids));
};
/** "Room 2", "Room 2 or Room 3". */
const either = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}` : names[0] ?? '');

export function RoomsSetup({ people, me, notes, boardName, onOpen }: {
  people: RoomCandidate[];
  /** You, the organizer: on the board in the main room, and in a room if you put yourself in one. */
  me: Person;
  /** Notes are on now: what's said in a room is transcribed, wherever someone invited is there to transcribe it. */
  notes: boolean;
  /** The board open in the main room now, by name: rooms sharing a board share that one. Null when there's none. */
  boardName: string | null;
  /** Opens the rooms with who goes to each (by their place on the board), and the one you go to (by its place), or null for the main room. */
  onOpen: (rooms: { name: string; ids: string[] }[], minutes: number, board: BreakoutBoard, visit: number | null) => void;
}) {
  const [n, setN] = useState<'2' | '3'>('2');
  const [len, setLen] = useState<'5' | '10' | '15'>('5');
  const [mode, setMode] = useState<BreakoutBoardMode>('none');
  const [template, setTemplate] = useState<BoardTemplate>('what-why-next');
  const [names, setNames] = useState(['Room 1', 'Room 2', 'Room 3']);
  const [assign, setAssign] = useState<string[][]>(() => placed(people, 2, MAIN));
  const [move, setMove] = useState<{ id: string; x: number; y: number; over: number | null } | null>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const reduce = useReducedMotion();
  const byId = new Map(people.map((p) => [p.id, p]));
  const rooms = Number(n);
  const colOf = (id: string) => assign.findIndex((r) => r.includes(id));
  const you = Math.max(MAIN, colOf(ME));
  const roomName = (k: number) => (names[k - 1] ?? '').trim() || `Room ${k}`;
  const where = (k: number) => (k === MAIN ? 'the main room' : roomName(k));
  const moveTo = (id: string, to: number) => setAssign((a) => a.map((r, k) => (k === to ? (r.includes(id) ? r : [...r, id]) : r.filter((x) => x !== id))));
  const colAt = (x: number, y: number) => cols.current.findIndex((c, k) => { const r = c?.getBoundingClientRect(); return k <= rooms && !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
  // Someone joins while the board is open: they go to the room with the fewest people; anyone who left comes off it.
  const ids = people.map((p) => p.id).join(' ');
  useEffect(() => {
    const here = new Set([ME, ...ids.split(' ').filter(Boolean)]);
    setAssign((a) => {
      const kept = a.map((r) => r.filter((id) => here.has(id)));
      for (const id of here) {
        if (kept.some((r) => r.includes(id))) continue;
        if (id === ME) { kept[MAIN] = [ME, ...(kept[MAIN] ?? [])]; continue; }
        const room = kept.slice(1, Number(n) + 1).reduce((best, r, k, all) => (r.length < (all[best]?.length ?? Infinity) ? k : best), 0) + 1;
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
  /** Who's on a chip: you, or someone by their place on the board. */
  const whoIs = (id: string): { person: Person; name: string; guest: boolean } | undefined => {
    if (id === ME) return { person: me, name: 'You', guest: false };
    const p = byId.get(id);
    return p ? { person: p.person, name: callName(p.person), guest: p.guest } : undefined;
  };
  const moving = move ? whoIs(move.id) : undefined;
  if (!people.length) {
    return (
      <div className="ic-scroll ic-pad">
        <EmptyState title="Nobody to send to a room yet" className="ic-empty">Everyone here shows on the board once they join.</EmptyState>
      </div>
    );
  }
  /** Someone's chip: dragged, or moved along with the arrow keys, from the main room through each room. */
  const chip = (id: string, k: number) => {
    const who = whoIs(id);
    if (!who) return null;
    return (
      <motion.div key={id} layout={!reduce} transition={UI} className={cn('ic-rp', move?.id === id && 'is-ghost')} tabIndex={0}
        aria-label={`${id === ME ? 'You' : who.person.name}${who.guest ? ', a guest' : ''}, in ${where(k)}. Drag, or use the arrow keys, to move`}
        onPointerDown={(e) => start(e, id)}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); moveTo(id, (k + (e.key === 'ArrowRight' ? 1 : rooms)) % (rooms + 1)); } }}>
        <Avatar person={who.person} size={22} /><span className="nm">{who.name}</span><Icon name="grip" size={14} />
      </motion.div>
    );
  };
  const shown = assign.slice(0, rooms + 1);
  // Only someone invited transcribes a room, never you or a guest: a room with nobody invited in it isn't transcribed.
  const unheard = notes ? shown.flatMap((ids, k) => (k !== MAIN && ids.some((id) => id !== ME) && !ids.some((id) => byId.get(id)?.guest === false) ? [roomName(k)] : [])) : [];
  return (
    <>
      <div className="ic-scroll ic-pad">
        <div className="ic-rtop">
          <span>Rooms</span>
          <Segmented label="How many rooms" value={n} onChange={(v) => { setN(v); setAssign(placed(people, Number(v), you)); }} options={[{ value: '2', label: '2' }, { value: '3', label: '3' }]} />
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
        <div className="ic-boardh"><span className="ac-eyebrow">Who goes where</span><IconButton icon="shuffle" label="Shuffle people" onClick={() => setAssign(placed(people, rooms, you))} /></div>
        <div ref={(el) => { cols.current[MAIN] = el; }} className={cn('ic-col is-main', move && move.over === MAIN && colOf(move.id) !== MAIN && 'is-drop')}>
          <div className="ch"><span className="ic-rname is-fixed">Main room</span><span className="cnt">{shown[MAIN]?.length ?? 0}</span></div>
          <div className="rps">{(shown[MAIN] ?? []).map((id) => chip(id, MAIN))}</div>
        </div>
        <div className="ic-board" style={{ gridTemplateColumns: `repeat(${rooms}, minmax(0, 1fr))` }}>
          {shown.slice(1).map((ids, i) => {
            const k = i + 1;
            return (
              <div key={k} ref={(el) => { cols.current[k] = el; }} className={cn('ic-col', move && move.over === k && colOf(move.id) !== k && 'is-drop')}>
                <div className="ch">
                  <Icon name="pen" size={13} />
                  <input className="ic-rname" value={names[i] ?? ''} maxLength={24} aria-label="Room name"
                    onChange={(e) => setNames((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
                    onBlur={() => setNames((x) => x.map((v, j) => (j === i && !v.trim() ? `Room ${k}` : v)))}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                  <span className="cnt">{ids.length}</span>
                </div>
                {ids.map((id) => chip(id, k))}
              </div>
            );
          })}
        </div>
        <div className="ic-rnote"><Icon name="swap" size={15} /><span>Drag people between the rooms, yourself too. Click a room’s name to rename it.</span></div>
        <div className="ic-rnote"><Icon name="notesPen" size={15} /><span>While notes are on, what’s said in each room is transcribed by the browser of someone you invited there, never recorded, and goes into the call’s notes as that room’s own section.</span></div>
        {unheard.length > 0 && <div className="ic-rnote is-caution"><Icon name="alert" size={15} /><span>Nothing said in {either(unheard)} will be transcribed: only someone you invited can transcribe a room.</span></div>}
        {notes && you !== MAIN && <div className="ic-rnote"><Icon name="door" size={15} /><span>While you’re in {roomName(you)}, nothing said in the main room goes into the notes.</span></div>}
      </div>
      <div className="ic-foot">
        <Button variant="primary" icon="door" className="w-full"
          onClick={() => onOpen(shown.slice(1).map((ids, i) => ({ name: roomName(i + 1), ids: ids.filter((id) => id !== ME) })), Number(len), { mode, template }, you === MAIN ? null : you - 1)}>
          Open {rooms} rooms
        </Button>
      </div>
      {move && moving && (
        <div className="ic-rp is-float" style={{ left: move.x - 40, top: move.y - 17 }}><Avatar person={moving.person} size={22} /><span className="nm">{moving.name}</span></div>
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

/**
 * Someone in a part of the call, and where else they can go: another room, or back to the main room. Their keys move with
 * them. `room`: the room they're in, or null for the main room.
 */
function RoomPerson({ person, here, room, rooms, onMove }: { person: Person; here: boolean; room: number | null; rooms: string[]; onMove: (room: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const go = (to: number | null) => { setOpen(false); onMove(to); };
  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="start" label={`Move ${callName(person)}`} className="ic-menu narrow"
      anchor={<button type="button" className={cn('ic-rchip', !here && 'is-away')} aria-label={`${callName(person)}${here ? '' : ', not here yet'}. ${room === null ? 'Send to a room' : 'Move to another room'}`}><Avatar person={person} size={18} /><span className="nm">{callName(person)}</span><Icon name="down" size={13} /></button>}>
      <div className="mh"><Avatar person={person} size={22} /><span className="t">{callName(person)}</span></div>
      {rooms.map((name, k) => (k === room ? null : <button key={k} type="button" className="mi" onClick={() => go(k)}><Icon name="door" size={17} /><span className="t">{room === null ? 'Send' : 'Move'} to {name}</span></button>))}
      {room !== null && <button type="button" className="mi" onClick={() => go(null)}><Icon name="left" size={17} /><span className="t">Back to the main room</span></button>}
    </Popover>
  );
}

export function RoomsLive({ open, elapsed, members, chips, main, people, activity, onJoin, onRename, onMove, onMessage, onClose }: {
  open: NonNullable<Breakouts['open']>; elapsed: number;
  /** Who is in each room now: the people sent there who are in the call, and you while you're there. */
  members: Person[][];
  /** Everyone sent to each room, here or not yet. */
  chips: RoomChip[][];
  /** Whoever's in the main room besides you: someone who came late, a guest, someone moved back. */
  main: RoomCandidate[];
  people: Map<string, Person>; activity: RoomActivity;
  onJoin: (room: number | null) => void;
  onRename: (room: number, name: string) => void;
  /** Sends someone to another room, or back to the main room (null). */
  onMove: (who: RoomPerson, room: number | null) => void;
  onMessage: (text: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const total = Math.max(1, open.until - open.from);
  // One primary action in the view: joining the first room that asked for help.
  const firstHelp = activity.help.findIndex((h, k) => h !== null && activity.joined !== k);
  const left = Math.max(0, open.until - elapsed);
  const soon = left <= 30;
  const names = open.rooms.map((x) => x.name);
  const inMain = activity.joined === null;
  const mainSays = inMain ? (main.length ? `${main.length + 1} people, you too` : 'Just you') : main.length ? `${main.length} ${main.length === 1 ? 'person' : 'people'}` : 'Nobody in the main room';
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
          {/* The main room: whoever's there can be sent to a room while the rooms are open. */}
          <div className={cn('ic-rcard is-main', inMain && 'is-here')}>
            <div className="top1"><span className="ic-rname is-fixed">Main room</span></div>
            <div className="line2"><span>{mainSays}</span></div>
            {main.length > 0 && (
              <div className="ic-rchips">
                {main.map((c) => <RoomPerson key={c.id} person={c.person} here room={null} rooms={names} onMove={(to) => onMove(c.by, to)} />)}
              </div>
            )}
          </div>
          {open.rooms.map((r, k) => {
            const here = activity.joined === k;
            const help = activity.help[k] ?? null;
            const talking = activity.talking[k] ?? null;
            const inRoom = members[k] ?? [];
            const sentHere = chips[k] ?? [];
            const coming = sentHere.filter((c) => !c.here).length;
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
                {sentHere.length > 0 && (
                  <div className="ic-rchips">
                    {/* Shown as the call knows them (their name and picture) once they're here; someone invited by address until then. */}
                    {sentHere.map((c) => <RoomPerson key={c.key} person={c.person} here={c.here} room={k} rooms={names} onMove={(to) => onMove(c.by, to)} />)}
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
        <p className="ic-rnote"><Icon name="lock" size={15} /><span>Each room has its own encryption keys and chat. While notes are on, each room with someone invited in it is transcribed into the call’s notes as its own section.</span></p>
      </div>
      <div className="ic-foot"><Button variant="secondary" className="w-full" onClick={onClose}>Bring everyone back now</Button></div>
    </>
  );
}
