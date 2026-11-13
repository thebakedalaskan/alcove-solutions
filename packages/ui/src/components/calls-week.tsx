/*
 * The week: the Calls page's, Monday to Sunday, and the week a call is scheduled on, seven days from today. A box of all 24
 * hours that scrolls, ten of them filling its height and 08:00 at its top to start, with the day row staying above them.
 * Every block says its time first. It takes plain data (days, minutes from midnight, blocks) and handlers: what's in a week
 * and what pressing it does are the app's. Its head, `CallsWeekHead`, is the days it shows and the way to the others.
 * Styles in styles/calls-week.css (cw-).
 *
 * Browsing, pressing a block opens it; pressing a free half hour, or dragging across free time, starts scheduling there.
 * Scheduling, pressing anywhere free or inside the call starts it at that half hour; dragging the call carries it in quarter
 * hours to any day, and held at the edge of the days it turns the week; its grip sets where it ends; dragging across free
 * time gives it that stretch; pressing an offered time that isn't the active one makes it the active one. A finger scrolls
 * the week and only presses. Every half hour is a button (one tab stop, the arrow keys, Home and End; Shift with ↑ or ↓ on
 * the call's first half hour moves its end), and a status line says where the call went.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon } from './icon';
import { Button, IconButton } from './primitives';

/* ---------- what the week is given ---------- */

export interface CallsWeekDay {
  /** "Thu" */
  weekday: string;
  /** The day of the month. */
  date: number;
  /** The whole day as it's said, "Thursday 12 November": what a screen reader hears. */
  label: string;
  /** The day as the pill over the hours says it: "Today", "Tomorrow", "Mon 16 Nov". The label when there's none. */
  short?: string | undefined;
  today?: boolean | undefined;
  /** Saturday or Sunday: outside the working day from start to end, and left out when only the weekdays fit. */
  weekend?: boolean | undefined;
}

/** A stretch of one day: `day` is an index into `days`; `start` and `end` are minutes from its midnight (570 is 09:30, 1440 its end). */
export interface CallsWeekSpan { day: number; start: number; end: number }

/**
 * What a block is: a call that happened (with notes), an Alcove call ahead, a meeting from your calendar, an invitation
 * waiting for your answer, a time held until a guest picks, or a call just scheduled or moved.
 */
export type CallsWeekKind = 'past' | 'soon' | 'cal' | 'invite' | 'hold' | 'fresh';

export interface CallsWeekBlock extends CallsWeekSpan {
  id: string;
  title: string;
  kind: CallsWeekKind;
  /** What waits on you from it: a decision to confirm (a rose diamond) or a follow-up (a blue dot). */
  wait?: 'dec' | 'fu' | undefined;
}

/** Other people's busy time, merged into one band where it overlaps: hatched, and labelled with whose it is ("Priya, Kofi"), never what. */
export interface CallsWeekBusy extends CallsWeekSpan { who: string }

/** The call being made, or one of the times offered to a guest. */
export interface CallsWeekCall extends CallsWeekSpan {
  /** The one the week moves: always the one call. */
  active: boolean;
  /** Letting a guest pick: its number, 1 to 3. */
  n?: number | undefined;
  /** Letting a guest pick: left out. */
  off?: boolean | undefined;
  /** It clashes with you, or with someone whose calendar can be read: a caution ring. */
  clash?: boolean | undefined;
  /** The call's name, under its time when there's room. */
  title?: string | undefined;
}

/** Who's free at a time, as the outline under the pointer and each half hour's name say it: "All 3 free", "Kofi busy". */
export interface CallsWeekFree { text: string; busy: boolean }

/** What the key under the week names. */
export interface CallsWeekKeyItem { kind: CallsWeekKind; label: string }

export interface CallsWeekProps {
  /** The days the week can show, in order: seven. Fewer show where there's no room for them. */
  days: readonly CallsWeekDay[];
  /** Your calls and meetings. */
  blocks: readonly CallsWeekBlock[];
  /**
   * Now, as a day (an index into `days`, below 0 when the week is still to come, past the last when it's over) and a minute.
   * The sun on a line and its time in the hours; nothing before it can be pressed.
   */
  now?: { day: number; minute: number } | null | undefined;
  /** `browse`, the Calls page's; `schedule`, the week a call is made on. */
  mode?: 'browse' | 'schedule' | undefined;
  /** What the half hours are, for a screen reader: "Pick a time", or browsing, the days. */
  label: string;
  /** Browsing: the key under the week. */
  legend?: readonly CallsWeekKeyItem[] | undefined;
  /** Scheduling: the working day, in minutes. Outside it is greyed, and the weekend all day. */
  work?: { from: number; to: number } | undefined;
  /** Scheduling: other people's busy time. */
  busy?: readonly CallsWeekBusy[] | undefined;
  /** Scheduling: the call being made, or the times offered to a guest. */
  calls?: readonly CallsWeekCall[] | undefined;
  /** Moving a call: where it is now, dashed, with what it says ("Now 10:00"). */
  was?: (CallsWeekSpan & { label: string }) | null | undefined;
  /** Browsing: how long the outline under the pointer is, in minutes, as long as a call starts. Scheduling, it's the active call's. */
  length?: number | undefined;
  /** The longest the call can be, in minutes: the grip, Shift with ↑ or ↓, and free time dragged across stop there. */
  longest?: number | undefined;
  /** Scheduling: who's free at a time. */
  free?: ((day: number, start: number, end: number) => CallsWeekFree) | undefined;
  /** Scheduling: the call can be carried into the week before (not before today's). */
  canGoBack?: boolean | undefined;
  /** Browsing: a block pressed. */
  onBlock?: ((id: string) => void) | undefined;
  /** A half hour pressed, or the call dropped (scheduling, to the quarter hour): the active call starts there. Browsing, a call is scheduled there. */
  onPick?: ((day: number, start: number) => void) | undefined;
  /** Free time dragged across, in quarter hours: the active call takes it. Browsing, a call is scheduled for it. */
  onRange?: ((day: number, start: number, end: number) => void) | undefined;
  /** The grip dragged, or Shift and ↑ or ↓: where the active call ends now, in minutes from its midnight. */
  onResize?: ((end: number) => void) | undefined;
  /** Letting a guest pick: an offered time that isn't the active one pressed. Its index in `calls`. */
  onSelect?: ((index: number) => void) | undefined;
  /** The call held at the edge of the days while it's dragged: the week before (-1) or after (1). */
  onTurn?: ((step: -1 | 1) => void) | undefined;
  className?: string | undefined;
}

/* ---------- the rules ---------- */

const DAY = 1440;
const SLOTS = 48;
const QUARTER = 15;
/** A pointer that moves less than this, in pixels, presses. */
const PRESS = 5;
/** Held this close to the edge of the days (px) for this long (ms), a dragged call turns the week, again and again. */
const EDGE = 18;
const TURN = 650;
/** The day row: one line, or the weekday over the date where the days are narrow. */
const HEAD = 44;
const HEAD_NARROW = 50;
const NARROW_DAY = 76;
/** Scheduling, with less than this for the days, only Monday to Friday; browsing on a phone, three days. */
const FIVE = 392;
const PHONE = '(max-width: 860px)';
/** Dragging this close to the top or bottom of the hours (px) scrolls them, up to this fast (px a frame). */
const SCROLL_ZONE = 40;
const SCROLL_FAST = 14;
const HOURS_SHOWN = 10;
const OPENS_AT = 8;

const two = (n: number) => String(n).padStart(2, '0');
/** A minute of the day as a clock says it: 570 is "09:30", the end of the day "24:00". */
const clock = (m: number) => { const t = Math.round(m); return `${two(Math.floor(t / 60))}:${two(t % 60)}`; };
const quarter = (m: number) => Math.round(m / QUARTER) * QUARTER;
const half = (m: number) => Math.floor(m / 30) * 30;
const lengthWords = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const onPhoneChange = (f: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener('change', f);
  return () => m.removeEventListener('change', f);
};
const usePhone = () => useSyncExternalStore(onPhoneChange, () => window.matchMedia(PHONE).matches, () => false);

/** How a block this many pixels tall holds its words: 2 and up, its time over (n - 1) lines of name; 1, one line; -1, one small line; 0, none. */
function fit(h: number): number {
  if (h >= 36) return 1 + Math.max(1, Math.floor((h - 8 - 14) / 14));
  if (h >= 18) return 1;
  if (h >= 12) return -1;
  return 0;
}

type Role = 'block' | 'ev' | 'call' | 'opt' | 'none';

/** Something drawn on a day, laid out in lanes. */
interface Item {
  key: string;
  s: number;
  e: number;
  lane: number;
  of: number;
  cls: string;
  role: Role;
  /** Yours: a bar on its left, so its words start further in. */
  ev: boolean;
  /** Its index in `calls`. */
  i?: number | undefined;
  num?: number | undefined;
  /** On one line, only its start: the rest of the line is its name's. */
  startOnly?: boolean | undefined;
  name?: string | undefined;
  /** Said after its start when the range doesn't fit: "to 12:15". */
  endName?: string | undefined;
  range: string;
  start: string;
  grip?: boolean | undefined;
  block?: CallsWeekBlock | undefined;
}

/** Side by side where they overlap, as calendars lay them out: each item's lane, and how many lanes its run needs. */
function lay(items: Item[]): void {
  let run: Item[] = [];
  let end = -1;
  const close = () => {
    const of = run.reduce((n, r) => Math.max(n, r.lane + 1), 1);
    for (const r of run) r.of = of;
    run = [];
    end = -1;
  };
  for (const b of [...items].sort((x, y) => x.s - y.s || y.e - x.e)) {
    if (run.length && b.s >= end) close();
    const taken = new Set(run.filter((r) => r.e > b.s).map((r) => r.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    b.lane = lane;
    run.push(b);
    end = Math.max(end, b.e);
  }
  if (run.length) close();
}

interface Words { n: number; time: string; num: boolean; name: string; lines: number }

/** The words a block has room for: its time first, the range when it fits on a line, a name only when a whole line of it fits. */
function wordsOf(o: Item, hp: number, colW: number): Words {
  const n = fit(((o.e - o.s) / 60) * hp - 2);
  const inner = (colW - 4) / o.of - 2 - (o.ev ? 16 : 14);
  const numW = o.num === undefined ? 0 : 19;
  const range = n !== -1 && !(o.startOnly && n === 1) && inner >= 64 + numW;
  const timeW = range ? 64 : n === -1 ? 24 : 28;
  const num = o.num !== undefined && inner >= timeW + numW;
  const room = inner - timeW - (num ? numW : 0) - 6;
  const name = o.name || (o.endName && !range ? o.endName : '');
  const named = !!name && (n >= 2 ? inner >= 30 : n === 1 ? room >= (o.name ? 28 : 46) : false);
  return { n, time: n === 0 ? '' : range ? o.range : o.start, num: num && n !== 0, name: named ? name : '', lines: Math.max(1, n - 1) };
}

function BlockWords({ item, w, children }: { item: Item; w: Words; children?: ReactNode }) {
  return (
    <>
      <span className={cn('cw-tx', w.n === 1 && 'is-one', w.n === -1 && 'is-tight')}>
        <b className="t">{w.num && <i className="nb">{item.num}</i>}{w.time}</b>
        {w.name && <span className="n" style={{ WebkitLineClamp: w.lines, maxHeight: 14 * w.lines }}>{w.name}</span>}
      </span>
      {item.grip && <i className="grip" data-role="grip" />}
      {children}
    </>
  );
}

const blockClass = (item: Item, w: Words) => cn('cw-bk', item.cls, w.n === -1 && 'is-tight', w.n === 0 && 'is-tiny');
const blockStyle = (item: Item) => ({ '--s': item.s, '--e': item.e, '--lane': item.lane, '--of': item.of });

/* ---------- pointing: one small store, so moving the pointer redraws one outline and nothing else ---------- */

interface Spot { day: number; start: number }
interface SpotStore { get: () => Spot | null; set: (s: Spot | null) => void; subscribe: (f: () => void) => () => void }
function spotStore(): SpotStore {
  let value: Spot | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (s) => {
      if (s === value || (s && value && s.day === value.day && s.start === value.start)) return;
      value = s;
      for (const f of subs) f();
    },
    subscribe: (f) => { subs.add(f); return () => { subs.delete(f); }; }
  };
}

/** Where a press would put the call, on the day pointed at: its outline at its length, its time, and who's free then. */
const Pointed = memo(function Pointed({ day, spots, hp, colW, length, scheduling, free }: {
  day: number; spots: SpotStore; hp: number; colW: number; length: number; scheduling: boolean;
  free: ((day: number, start: number, end: number) => CallsWeekFree) | undefined;
}) {
  const at = useSyncExternalStore(spots.subscribe, () => { const s = spots.get(); return s && s.day === day ? s : null; });
  if (!at) return null;
  const e = Math.min(DAY, at.start + length);
  const note = scheduling ? free?.(day, at.start, e) : undefined;
  const item: Item = {
    key: 'pointed', s: at.start, e, lane: 0, of: 1, ev: false, role: 'none', cls: cn('is-ghost', note?.busy && 'is-busy'),
    range: `${clock(at.start)} – ${clock(e)}`, start: clock(at.start), name: scheduling ? note?.text : 'New call'
  };
  const w = wordsOf(item, hp, colW);
  return <span className={blockClass(item, w)} style={blockStyle(item)} aria-hidden="true"><BlockWords item={item} w={w} /></span>;
});

interface HalfHoursProps {
  day: number;
  labels: readonly string[];
  cursor: number;
  /** The first half hour still to come: those before it are gone. */
  open: number;
  onKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onPress: (e: MouseEvent<HTMLButtonElement>) => void;
  onFocus: (e: FocusEvent<HTMLButtonElement>) => void;
}
const sameHalfHours = (a: HalfHoursProps, b: HalfHoursProps) =>
  a.day === b.day && a.cursor === b.cursor && a.open === b.open && a.onKey === b.onKey && a.onPress === b.onPress && a.onFocus === b.onFocus
  && a.labels.length === b.labels.length && a.labels.every((l, i) => l === b.labels[i]);

/** A day's half hours, each a button: drawn again only when what they say changes, never as the pointer moves. */
const HalfHours = memo(function HalfHours({ day, labels, cursor, open, onKey, onPress, onFocus }: HalfHoursProps) {
  return (
    <>
      {labels.map((label, slot) => (
        <button key={slot} type="button" className="cw-slot" style={{ '--i': slot }} data-d={day} data-s={slot} tabIndex={slot === cursor ? 0 : -1}
          aria-label={label} aria-disabled={slot < open ? true : undefined} onKeyDown={onKey} onClick={onPress} onFocus={onFocus} />
      ))}
    </>
  );
}, sameHalfHours);

/* ---------- the head ---------- */

/**
 * The week's head: the days it shows ("12 – 18 Nov"), Today while the week shown isn't the current one, ‹ and ›, and
 * whatever the page puts at its end (List and Week on Calls).
 */
export function CallsWeekHead({ title, onBefore, onAfter, onToday, canGoBack = true, end, className }: {
  title: string;
  onBefore: () => void;
  onAfter: () => void;
  /** Back to the current week: given only while another is shown. */
  onToday?: (() => void) | undefined;
  canGoBack?: boolean | undefined;
  end?: ReactNode;
  className?: string | undefined;
}) {
  /* Today goes once it's pressed: the keyboard goes on to The week after, which stays. */
  const after = useRef<HTMLButtonElement>(null);
  return (
    <div className={cn('cw-head', className)}>
      <h2>{title}</h2>
      <div className="cw-nav">
        {onToday && <Button variant="secondary" size="xs" className="cw-today" onClick={() => { after.current?.focus(); onToday(); }}>Today</Button>}
        <IconButton icon="chevronLeft" label="The week before" disabled={!canGoBack} onClick={onBefore} />
        <IconButton ref={after} icon="chevron" label="The week after" onClick={onAfter} />
        {end && <span className="cw-end">{end}</span>}
      </div>
    </div>
  );
}

/* ---------- the week ---------- */

type Gesture =
  | { kind: 'tap'; id: number; day: number; m0: number; x0: number; y0: number; role: Role | ''; i: number; slot: boolean }
  | { kind: 'press'; id: number; day: number; m0: number; x0: number; y0: number }
  | { kind: 'range'; id: number; day: number; m0: number }
  | { kind: 'grab'; id: number; day: number; m0: number; x0: number; y0: number; start0: number; length: number; moved: boolean }
  | { kind: 'resize'; id: number };

/** The call while it's dragged or stretched: where it will land (start, end), and where the pointer has it (top, bottom). */
interface Carried extends CallsWeekSpan { top: number; bottom: number }

interface Zone { k: 'off' | 'busy' | 'past'; s: number; e: number; who?: string | undefined; lt?: number | undefined; tall?: boolean | undefined }

const NO_BUSY: readonly CallsWeekBusy[] = [];
const NO_CALLS: readonly CallsWeekCall[] = [];
const NO_LABELS: readonly string[] = [];

/** Whether a minute of a day has gone. */
const pastFor = (now: { day: number; minute: number } | null, day: number, minute: number) => !!now && (day < now.day || (day === now.day && minute < now.minute));
/* Never into the past: a time gone becomes the next quarter hour from now. */
function notBefore(now: { day: number; minute: number } | null, day: number, start: number): { day: number; start: number } {
  if (!now || !pastFor(now, day, start)) return { day, start };
  const s = Math.ceil(now.minute / QUARTER) * QUARTER;
  return s < DAY ? { day: now.day, start: s } : { day: now.day + 1, start: 0 };
}

const roleOf = (t: EventTarget | null): { role: Role | ''; i: number } => {
  const el = t instanceof Element ? t.closest('[data-role]') : null;
  const role = el?.getAttribute('data-role');
  const known = role === 'block' || role === 'ev' || role === 'call' || role === 'opt' || role === 'grip' ? role : '';
  return { role: known === 'grip' ? 'none' : known, i: Number(el?.getAttribute('data-i') ?? -1) };
};
const onGrip = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-role="grip"]');

export function CallsWeek({
  days, blocks, now = null, mode = 'browse', label, legend, work, busy = NO_BUSY, calls = NO_CALLS, was = null, length = 45, longest = DAY, free,
  canGoBack = true, onBlock, onPick, onRange, onResize, onSelect, onTurn, className
}: CallsWeekProps) {
  const scheduling = mode === 'schedule';
  const box = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  /* The box's height and the days' width, as laid out (before any zoom on the page). */
  const [size, setSize] = useState({ h: 0, w: 0 });
  const phone = usePhone();
  useLayoutEffect(() => {
    const b = box.current;
    const c = cols.current;
    if (!b || !c) return;
    const read = () => setSize((s) => (s.h === b.clientHeight && s.w === c.clientWidth ? s : { h: b.clientHeight, w: c.clientWidth }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(b);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  /* Which days fit: all seven; scheduling, only Monday to Friday when the days have less than about 392px; browsing on a phone, today and the next two. */
  const todayAt = now ? now.day : -1;
  const shown = useMemo(() => {
    const all = days.map((_, i) => i);
    if (!scheduling && phone) {
      const from = Math.max(0, Math.min(todayAt < 0 ? 0 : todayAt, days.length - 3));
      return all.slice(from, from + 3);
    }
    return scheduling && size.w && size.w < FIVE ? all.filter((i) => !days[i]?.weekend) : all;
  }, [days, scheduling, size.w, phone, todayAt]);
  const colW = (size.w || 640) / Math.max(1, shown.length);
  const narrow = colW < NARROW_DAY;
  const head = narrow ? HEAD_NARROW : HEAD;
  /* Ten hours fill the box, whatever its height. */
  const hp = size.h ? Math.max(30, Math.min(84, (size.h - head) / HOURS_SHOWN)) : 54;

  const activeIndex = calls.findIndex((c) => c.active);
  const active = calls[activeIndex];
  const ghostLength = scheduling && active ? active.end - active.start : length;

  /* A gesture under way, and what it draws: the call moved or stretched, or the free time dragged across. */
  const gesture = useRef<Gesture | null>(null);
  const [moving, setMovingState] = useState<Carried | null>(null);
  const movingRef = useRef<Carried | null>(null);
  const setMoving = (m: Carried | null) => { movingRef.current = m; setMovingState(m); };
  const [stretch, setStretchState] = useState<CallsWeekSpan | null>(null);
  const stretchRef = useRef<CallsWeekSpan | null>(null);
  const setStretch = (s: CallsWeekSpan | null) => { stretchRef.current = s; setStretchState(s); };
  const [edge, setEdgeState] = useState<'' | 'next' | 'prev'>('');
  const edgeRef = useRef<'' | 'next' | 'prev'>('');
  const edgeTimer = useRef(0);
  const frame = useRef(0);
  /* Where the pointer went down, and where it is now. */
  const origin = useRef({ x: 0, y: 0 });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /* A press a pointer has dealt with, or a drag: the click some browsers still send after it isn't another press. */
  const quietUntil = useRef(0);
  const [spots] = useState(spotStore);
  const [said, setSaid] = useState('');
  const [pill, setPill] = useState<'' | 'up' | 'down'>('');
  /* The hour at the top of the box, kept as the hours change height. */
  const topHour = useRef(OPENS_AT);
  const ready = useRef(false);

  /* The keyboard's place: one half hour is the week's tab stop. */
  const [cursor, setCursor] = useState(() => {
    const day = active && active.day >= 0 && active.day < days.length ? active.day : todayAt >= 0 && todayAt < days.length ? todayAt : 0;
    return { day, slot: active ? Math.floor(active.start / 30) : OPENS_AT * 2 };
  });
  const cur = shown.includes(cursor.day) ? cursor : { day: shown[0] ?? 0, slot: cursor.slot };

  /* What the handlers read: the latest of everything, without being made again on every render. */
  const latest = {
    days, shown, now, scheduling, hp, head, calls, active, activeIndex, canGoBack, free, longest,
    onBlock, onPick, onRange, onResize, onSelect, onTurn
  };
  const live = useRef(latest);
  useLayoutEffect(() => { live.current = latest; });

  const pastAt = (day: number, minute: number) => pastFor(live.current.now, day, minute);
  const say = (words: string) => setSaid(words);
  const dayName = (day: number) => live.current.days[day]?.label ?? '';

  /* Where the pointer is, from the layout itself, so a zoom or a scale on the page can't put it on the wrong day or hour. */
  const minuteAt = (y: number) => {
    const el = cols.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const py = (y - r.top) * (el.offsetHeight / (r.height || 1));
    return Math.max(0, Math.min(DAY - 1, (py / live.current.hp) * 60));
  };
  const dayAt = (x: number, fallback: number) => {
    const el = cols.current;
    if (!el) return fallback;
    const r = el.getBoundingClientRect();
    const px = (x - r.left) * (el.offsetWidth / (r.width || 1));
    const list = [...el.querySelectorAll<HTMLElement>(':scope > .cw-col')];
    for (const c of list) if (px >= c.offsetLeft && px < c.offsetLeft + c.offsetWidth) return Number(c.dataset['d'] ?? fallback);
    const edgeCol = px < 0 ? list[0] : list.at(-1);
    return edgeCol ? Number(edgeCol.dataset['d'] ?? fallback) : fallback;
  };

  /* Scroll the box so a stretch of a day is in view, if it isn't. */
  const show = (s: number, e: number, smooth: boolean) => {
    const b = box.current;
    if (!b) return;
    const { hp: h, head: top } = live.current;
    const a = (s / 60) * h;
    const z = (e / 60) * h;
    const vis = b.clientHeight - top;
    if (a >= b.scrollTop + 8 && z <= b.scrollTop + vis - 8) return;
    const to = Math.max(0, Math.min(24 * h - vis, a - Math.max(16, (vis - (z - a)) / 2)));
    b.scrollTo({ top: to, behavior: smooth && !reduced() ? 'smooth' : 'auto' });
  };

  /* ---- what a press does ---- */
  const press = (day: number, start: number) => {
    const L = live.current;
    if (pastAt(day, start)) return;
    if (!L.scheduling) { L.onPick?.(day, start); return; }
    const a = L.active;
    if (a && a.day === day && a.start === start) return;
    L.onPick?.(day, start);
    const end = a ? Math.min(DAY, start + (a.end - a.start)) : start;
    say(`${dayName(day)}, ${clock(start)} to ${clock(end)}`);
  };
  const select = (i: number) => {
    const c = live.current.calls[i];
    if (!c) return;
    live.current.onSelect?.(i);
    say(`Time ${c.n ?? i + 1} is the one the week moves`);
  };
  /* Pressing inside the call, or a finger on it: it starts at that half hour. */
  const pressInCall = (day: number, minute: number) => press(day, half(minute));

  /* ---- the edge of the days, while the call is carried ---- */
  const stopEdge = () => {
    window.clearTimeout(edgeTimer.current);
    if (edgeRef.current) { edgeRef.current = ''; setEdgeState(''); }
  };
  const arm = () => {
    window.clearTimeout(edgeTimer.current);
    edgeTimer.current = window.setTimeout(() => {
      const L = live.current;
      const g = gesture.current;
      const step = edgeRef.current === 'next' ? 1 : edgeRef.current === 'prev' ? -1 : 0;
      if (!g || g.kind !== 'grab' || !step || !L.onTurn) return;
      if (step === -1 && !L.canGoBack) { stopEdge(); return; }
      L.onTurn(step);
      /* The call goes with it, to the same day a week on or back: drawn there, and never in the past (see `notBefore`). */
      arm();
    }, TURN);
  };
  const edgeAt = (x: number) => {
    const el = cols.current;
    const L = live.current;
    if (!el || !L.onTurn) return;
    const r = el.getBoundingClientRect();
    const zone = EDGE * (r.width / (el.offsetWidth || 1));
    const next = x > r.right - zone ? 'next' : x < r.left + zone && L.canGoBack ? 'prev' : '';
    if (next === edgeRef.current) return;
    edgeRef.current = next;
    setEdgeState(next);
    window.clearTimeout(edgeTimer.current);
    if (next) arm();
  };

  /* ---- following the pointer ---- */
  const capture = (id: number) => {
    try { cols.current?.setPointerCapture(id); } catch { /* a pointer that's already gone can't be captured */ }
  };
  const track = (x: number, y: number) => {
    const g = gesture.current;
    const L = live.current;
    if (!g) return;
    const m = minuteAt(y);
    if (g.kind === 'press') {
      if (Math.abs(y - g.y0) <= PRESS) return;
      capture(g.id);
      quietUntil.current = Number.POSITIVE_INFINITY;
      gesture.current = { kind: 'range', id: g.id, day: g.day, m0: g.m0 };
      track(x, y);
      return;
    }
    if (g.kind === 'range') {
      const n = L.now;
      let a = Math.max(0, quarter(Math.min(g.m0, m)), n && g.day === n.day ? Math.ceil(n.minute / QUARTER) * QUARTER : 0);
      let b = quarter(Math.max(g.m0, m));
      /* No longer than a call can be: the end where it was pressed stays, and the other stops. */
      if (b - a > L.longest) { if (m >= g.m0) b = a + L.longest; else a = b - L.longest; }
      if (b - a < QUARTER) b = a + QUARTER;
      b = Math.min(b, DAY);
      if (b - a < QUARTER) a = b - QUARTER;
      const s = stretchRef.current;
      if (!s || s.day !== g.day || s.start !== a || s.end !== b) setStretch({ day: g.day, start: a, end: b });
      spots.set(null);
      return;
    }
    if (g.kind === 'grab') {
      if (!g.moved && Math.abs(y - g.y0) < PRESS && Math.abs(x - g.x0) < PRESS) return;
      if (!g.moved) { gesture.current = { ...g, moved: true }; quietUntil.current = Number.POSITIVE_INFINITY; }
      // Drawn where the pointer has it; it lands on the quarter hour (never in the past) when it's let go.
      const exact = Math.max(0, Math.min(DAY - QUARTER, g.start0 + (m - g.m0)));
      const day = dayAt(x, g.day);
      const to = notBefore(L.now, day, quarter(exact));
      const top = to.day === day && to.start === quarter(exact) ? exact : to.start;
      const mv = movingRef.current;
      if (!mv || mv.day !== to.day || mv.top !== top) {
        setMoving({ day: to.day, start: to.start, end: Math.min(DAY, to.start + g.length), top, bottom: Math.min(DAY, top + g.length) });
      }
      edgeAt(x);
      return;
    }
    if (g.kind === 'resize') {
      const a = L.active;
      if (!a) return;
      const most = Math.min(DAY, a.start + L.longest);
      const end = Math.min(most, Math.max(a.start + QUARTER, quarter(m)));
      const bottom = Math.min(most, Math.max(a.start + QUARTER, m));
      const mv = movingRef.current;
      if (!mv || mv.bottom !== bottom) setMoving({ day: a.day, start: a.start, end, top: a.start, bottom });
    }
  };
  /* Near the top or bottom of the hours, they scroll under whatever's being dragged. */
  const scrollLoop = () => {
    frame.current = 0;
    const g = gesture.current;
    const b = box.current;
    const p = pointer.current;
    if (!g || !b || g.kind === 'tap') return;
    // Only a drag scrolls them: a press near the edge of the box leaves the hours be.
    if (p && g.kind !== 'press' && Math.hypot(p.x - origin.current.x, p.y - origin.current.y) > PRESS) {
      const r = b.getBoundingClientRect();
      const scale = r.height / (b.offsetHeight || 1);
      const top = r.top + live.current.head * scale;
      const zone = SCROLL_ZONE * scale;
      const v = p.y < top + zone ? -SCROLL_FAST * Math.min(1, (top + zone - p.y) / zone)
        : p.y > r.bottom - zone ? SCROLL_FAST * Math.min(1, (p.y - (r.bottom - zone)) / zone) : 0;
      if (v) {
        const was0 = b.scrollTop;
        b.scrollTop += v;
        if (b.scrollTop !== was0) track(p.x, p.y);
      }
    }
    frame.current = requestAnimationFrame(scrollLoop);
  };
  const end = () => {
    gesture.current = null;
    pointer.current = null;
    if (quietUntil.current === Number.POSITIVE_INFINITY) quietUntil.current = performance.now() + 600;
    stopEdge();
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const L = live.current;
    if (e.button !== 0) return;
    // Whatever was under way and never ended (a press let go outside the week) is over.
    if (gesture.current) cancel();
    spots.set(null);
    const m = minuteAt(e.clientY);
    const day = dayAt(e.clientX, -1);
    if (day < 0) return;
    const { role, i } = roleOf(e.target);
    const grip = onGrip(e.target);
    const slot = e.target instanceof Element && e.target.classList.contains('cw-slot');
    quietUntil.current = 0;
    if (e.pointerType === 'touch') {
      // A finger scrolls the week: it only ever presses, when it lifts where it landed.
      gesture.current = { kind: 'tap', id: e.pointerId, day, m0: m, x0: e.clientX, y0: e.clientY, role: grip ? 'call' : role, i, slot };
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY };
    origin.current = { x: e.clientX, y: e.clientY };
    if (!L.scheduling) {
      if (role === 'block' || pastAt(day, half(m)) || (!L.onRange && !L.onPick)) return;
      e.preventDefault();
      gesture.current = { kind: 'press', id: e.pointerId, day, m0: m, x0: e.clientX, y0: e.clientY };
    } else if (grip && L.active && L.onResize) {
      e.preventDefault();
      capture(e.pointerId);
      quietUntil.current = Number.POSITIVE_INFINITY;
      gesture.current = { kind: 'resize', id: e.pointerId };
    } else if (role === 'opt' && i !== L.activeIndex) {
      e.preventDefault();
      select(i);
      return;
    } else if ((role === 'call' || grip) && L.active) {
      e.preventDefault();
      capture(e.pointerId);
      gesture.current = { kind: 'grab', id: e.pointerId, day, m0: m, x0: e.clientX, y0: e.clientY, start0: L.active.start, length: L.active.end - L.active.start, moved: false };
    } else {
      if (pastAt(day, half(m))) return;
      e.preventDefault();
      gesture.current = { kind: 'press', id: e.pointerId, day, m0: m, x0: e.clientX, y0: e.clientY };
    }
    if (!frame.current) frame.current = requestAnimationFrame(scrollLoop);
  };

  /* Pointing at a free half hour, with a mouse: where the call would go. Not over the call's own start, a time gone, or a block to open. */
  const point = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const L = live.current;
    const { role, i } = roleOf(e.target);
    const day = dayAt(e.clientX, -1);
    const start = half(minuteAt(e.clientY));
    const over = onGrip(e.target) || (role === 'opt' && i !== L.activeIndex) || (!L.scheduling && role === 'block');
    const a = L.active;
    const own = L.scheduling && !!a && a.day === day && a.start === start;
    spots.set(day < 0 || over || own || pastAt(day, start) || (!L.scheduling && !L.onPick) ? null : { day, start });
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) { point(e); return; }
    if (e.pointerId !== g.id) return;
    if (g.kind === 'tap') {
      if (Math.abs(e.clientX - g.x0) > PRESS || Math.abs(e.clientY - g.y0) > PRESS) { gesture.current = null; quietUntil.current = performance.now() + 600; }
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY };
    track(e.clientX, e.clientY);
  };

  const up = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const L = live.current;
    end();
    switch (g.kind) {
      case 'tap':
        // On a half hour, its click presses it. On the call, or an offered time, it's dealt with here.
        if (g.slot || !L.scheduling) return;
        quietUntil.current = performance.now() + 600;
        if (g.role === 'opt' && g.i !== L.activeIndex) select(g.i);
        else if (g.role === 'call') pressInCall(g.day, g.m0);
        return;
      case 'press':
        // Let go where it was pressed: the half hour's own click presses it (from the keyboard too).
        return;
      case 'range': {
        const s = stretchRef.current;
        setStretch(null);
        if (!s) return;
        L.onRange?.(s.day, s.start, s.end);
        if (L.scheduling) say(`${dayName(s.day)}, ${clock(s.start)} to ${clock(s.end)}`);
        return;
      }
      case 'grab': {
        const mv = movingRef.current;
        setMoving(null);
        quietUntil.current = performance.now() + 600;
        if (!g.moved) { pressInCall(g.day, g.m0); return; }
        if (!mv) return;
        const to = notBefore(L.now, mv.day, mv.start);
        const a = L.active;
        if (a && a.day === to.day && a.start === to.start) return;
        L.onPick?.(to.day, to.start);
        say(`${dayName(to.day)}, ${clock(to.start)} to ${clock(Math.min(DAY, to.start + g.length))}`);
        return;
      }
      case 'resize': {
        const mv = movingRef.current;
        setMoving(null);
        const a = L.active;
        if (!mv || !a || mv.end === a.end) return;
        L.onResize?.(mv.end);
        say(`Ends ${clock(mv.end)}`);
      }
    }
  };
  function cancel() {
    end();
    if (movingRef.current) setMoving(null);
    if (stretchRef.current) setStretch(null);
  }
  /* Out of the week: nothing pointed at, and a press that hasn't become a drag (so isn't held on to) is let go of. */
  const leave = () => {
    spots.set(null);
    const g = gesture.current;
    if (g && (g.kind === 'press' || g.kind === 'tap')) end();
  };
  useEffect(() => () => {
    window.clearTimeout(edgeTimer.current);
    if (frame.current) cancelAnimationFrame(frame.current);
  }, []);

  /* ---- the keyboard ---- */
  const focusSlot = (day: number, slot: number) => {
    setCursor({ day, slot });
    cols.current?.querySelector<HTMLElement>(`.cw-slot[data-d="${day}"][data-s="${slot}"]`)?.focus();
  };
  const slotOf = (el: HTMLElement) => ({ day: Number(el.dataset['d'] ?? 0), slot: Number(el.dataset['s'] ?? 0) });
  const onSlotKey = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    const L = live.current;
    const { day, slot } = slotOf(e.currentTarget);
    const a = L.active;
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && L.scheduling && a && a.day === day && Math.floor(a.start / 30) === slot && L.onResize) {
      e.preventDefault();
      const to = Math.min(DAY, a.start + L.longest, Math.max(a.start + QUARTER, a.end + (e.key === 'ArrowDown' ? QUARTER : -QUARTER)));
      if (to !== a.end) { L.onResize(to); say(`Ends ${clock(to)}`); }
      return;
    }
    const at = L.shown.indexOf(day);
    const go = (d: number, s: number) => { e.preventDefault(); focusSlot(d, Math.max(0, Math.min(SLOTS - 1, s))); };
    if (e.key === 'ArrowUp') go(day, slot - 1);
    else if (e.key === 'ArrowDown') go(day, slot + 1);
    else if (e.key === 'ArrowLeft') go(L.shown[Math.max(0, at - 1)] ?? day, slot);
    else if (e.key === 'ArrowRight') go(L.shown[Math.min(L.shown.length - 1, at + 1)] ?? day, slot);
    else if (e.key === 'Home') go(day, 0);
    else if (e.key === 'End') go(day, SLOTS - 1);
  }, []);
  /* Enter or Space, a screen reader's press, a tap, or a click let go where it was pressed. */
  const onSlotPress = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    if (performance.now() < quietUntil.current) return;
    const L = live.current;
    const { day, slot } = slotOf(e.currentTarget);
    // From the keyboard, the first half hour of an offered time that isn't the active one makes it the active one.
    const offered = L.scheduling && e.detail === 0 ? L.calls.findIndex((c) => !c.active && c.day === day && Math.floor(c.start / 30) === slot) : -1;
    if (offered >= 0) select(offered);
    else press(day, slot * 30);
  }, []);
  const onSlotFocus = useCallback((e: FocusEvent<HTMLButtonElement>) => {
    const { day, slot } = slotOf(e.currentTarget);
    setCursor((c) => (c.day === day && c.slot === slot ? c : { day, slot }));
  }, []);

  /*
   * What each half hour says: the day and the time, and scheduling, who's free then, or the call or time that starts in it.
   * Who's free is worked out once for the week and the call's length; the few half hours a call starts in are said over it,
   * so typing the call's name or moving it doesn't ask who's free all over again.
   */
  const freeLabels = useMemo(() => days.map((d, day) => Array.from({ length: SLOTS }, (_, slot) => {
    const start = slot * 30;
    const note = scheduling ? free?.(day, start, Math.min(DAY, start + ghostLength)) : undefined;
    return `${d.label}, ${clock(start)}${note ? `, ${note.text}` : ''}`;
  })), [days, scheduling, free, ghostLength]);
  const callsKey = calls.map((c) => `${c.day}.${c.start}.${c.end}.${c.n ?? ''}.${c.active ? 1 : 0}.${c.title ?? ''}`).join('|');
  const canResize = !!onResize;
  const labels = useMemo(() => (!scheduling ? freeLabels : freeLabels.map((row, day) => {
    const starting = calls.filter((c) => c.day === day);
    if (!starting.length) return row;
    const d = days[day];
    return row.map((said, slot) => {
      const c = starting.find((x) => Math.floor(x.start / 30) === slot);
      if (!c || !d) return said;
      const what = c.n === undefined ? c.title || 'the call' : `time ${c.n}${c.active ? ', the one the week moves' : ''}`;
      return `${d.label}, ${clock(c.start)} to ${clock(c.end)}, ${what}${c.active && canResize ? '. Shift and the up or down arrow change when it ends' : ''}`;
    });
  })), [freeLabels, days, scheduling, callsKey, canResize]);

  /* ---- scrolling: open on 08:00, keep the same hour at the top as the hours change height, and follow the call ---- */
  const onScreen = active && shown.includes(active.day) ? active : undefined;
  const checkPill = () => {
    const b = box.current;
    const a = live.current.scheduling && live.current.active && live.current.shown.includes(live.current.active.day) ? live.current.active : undefined;
    let next: '' | 'up' | 'down' = '';
    if (b && a) {
      const { hp: h, head: top } = live.current;
      const view = b.scrollTop;
      if ((a.end / 60) * h < view + 6) next = 'up';
      else if ((a.start / 60) * h > view + b.clientHeight - top - 6) next = 'down';
    }
    setPill((p) => (p === next ? p : next));
  };
  useLayoutEffect(() => {
    const b = box.current;
    if (!b || !size.h) return;
    if (!ready.current) {
      ready.current = true;
      b.scrollTop = OPENS_AT * hp - 2;
      if (onScreen) show(onScreen.start, onScreen.end, false);
    } else b.scrollTop = topHour.current * hp;
    topHour.current = b.scrollTop / hp;
    checkPill();
  }, [hp, size.h]);
  useLayoutEffect(checkPill);
  /* When the call moves (from here or from the editor), it's scrolled into view; turning to another week and back leaves the hours be. */
  const where = onScreen ? `${days[onScreen.day]?.label ?? ''} ${onScreen.start} ${onScreen.end}` : null;
  const shownWhere = useRef<string | null>(null);
  useEffect(() => {
    if (!where || where === shownWhere.current) return;
    const before = shownWhere.current;
    shownWhere.current = where;
    // Before the box is laid out, its first scroll shows the call.
    if (!ready.current || !onScreen || movingRef.current) return;
    show(onScreen.start, onScreen.end, before !== null);
  }, [where]);
  const onScroll = () => {
    const b = box.current;
    if (!b) return;
    topHour.current = b.scrollTop / hp;
    checkPill();
  };

  /* ---- what each day draws ---- */
  /* The call while it's carried or stretched: where the pointer has it, never in the past (the week may have turned back under it). */
  const carried = moving ? (() => {
    const to = notBefore(now, moving.day, moving.start);
    if (to.day === moving.day && to.start === moving.start) return moving;
    const end = Math.min(DAY, to.start + (moving.end - moving.start));
    return { day: to.day, start: to.start, end, top: to.start, bottom: end };
  })() : null;
  const goneAt = (day: number, minute: number) => !!now && (day < now.day || (day === now.day && minute <= now.minute));
  const itemsOf = (d: number): Item[] => {
    const items: Item[] = [];
    for (const b of blocks) {
      if (b.day !== d) continue;
      const s = Math.max(0, Math.min(DAY - QUARTER, b.start));
      const e = Math.min(DAY, Math.max(s + 5, b.end));
      items.push({
        key: `b-${b.id}`, s, e, lane: 0, of: 1, ev: true, role: scheduling ? 'ev' : 'block', block: b,
        cls: cn('is-ev', `is-${b.kind}`, goneAt(d, e) && 'is-gone'), startOnly: b.kind !== 'fresh', name: b.title,
        range: `${clock(s)} – ${clock(e)}`, start: clock(s)
      });
    }
    if (was && was.day === d) items.push({ key: 'was', s: was.start, e: was.end, lane: 0, of: 1, ev: false, role: 'none', cls: 'is-was', range: was.label, start: was.label });
    if (scheduling) calls.forEach((c, i) => {
      const at = c.active && carried ? carried : { ...c, top: c.start, bottom: c.end };
      if (at.day !== d) return;
      const range = `${clock(at.start)} – ${clock(at.end)}`;
      const endName = c.n === undefined ? undefined : `to ${clock(at.end)}`;
      if (c.active) {
        const clash = carried ? free?.(at.day, at.start, at.end).busy ?? !!c.clash : !!c.clash;
        items.push({
          key: `c-${i}`, s: at.top, e: at.bottom, lane: 0, of: 1, ev: false, role: 'call', i, num: c.n, name: c.title, endName, grip: !!onResize,
          cls: cn('is-call', clash && 'is-clash', carried && 'is-moving'), range, start: clock(at.start)
        });
      } else {
        items.push({ key: `c-${i}`, s: at.start, e: at.end, lane: 0, of: 1, ev: false, role: 'opt', i, num: c.n, endName, cls: cn('is-opt', c.off && 'is-off'), range, start: clock(at.start) });
      }
    });
    lay(items);
    return items;
  };
  const zonesOf = (d: number, items: readonly Item[]): Zone[] => {
    if (!scheduling) return [];
    const z: Zone[] = [];
    if (work) {
      if (days[d]?.weekend) z.push({ k: 'off', s: 0, e: DAY });
      else {
        if (work.from > 0) z.push({ k: 'off', s: 0, e: work.from });
        if (work.to < DAY) z.push({ k: 'off', s: work.to, e: DAY });
      }
    }
    /* Busy time that's gone isn't drawn; each band's label sits at the first stretch of it no block covers, or nowhere. */
    const from = now ? (d < now.day ? DAY : d === now.day ? now.minute : 0) : 0;
    for (const x of busy) {
      if (x.day !== d || x.end <= from) continue;
      const s = Math.max(x.start, from);
      let lt = s;
      for (let moved = true; moved;) {
        moved = false;
        for (const b of items) if (b.s <= lt + 4 && b.e > lt) { lt = b.e; moved = true; }
      }
      z.push({ k: 'busy', s, e: x.end, who: x.who, lt: lt - s, tall: ((x.end - lt) / 60) * hp >= 22 });
    }
    if (now && d <= now.day) z.push({ k: 'past', s: 0, e: d < now.day ? DAY : now.minute });
    return z;
  };

  const nowShown = !!now && shown.includes(now.day);
  const nowY = now ? (now.minute / 60) * hp : 0;
  const pillDay = onScreen ? days[onScreen.day] : undefined;

  return (
    <div className={cn('cw', scheduling ? 'is-schedule' : 'is-browse', narrow && 'is-narrow', className)}
      style={{ '--hp': `${hp.toFixed(2)}px`, '--n': shown.length }}>
      <span className="sr-only" role="status">{said}</span>
      <div className="cw-wk">
        <div ref={box} className="cw-box" onScroll={onScroll}>
          <div className="cw-dh" aria-hidden="true">
            <span />
            {shown.map((i) => {
              const d = days[i];
              return d && <span key={i} className={cn('cw-day', d.today && 'is-today', !!now && i < now.day && 'is-gone')}>{d.weekday}<b>{d.date}</b></span>;
            })}
          </div>
          <div className="cw-grid">
            <div className="cw-hours" aria-hidden="true">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className={cn('cw-hl', nowShown && Math.abs(h * hp + 10 - nowY) < 15 && 'is-hid')} style={{ '--h': h }}>{clock(h * 60)}</span>
              ))}
              {nowShown && now && <span className="cw-nowtag" style={{ '--s': now.minute }}>{clock(now.minute)}</span>}
            </div>
            <div ref={cols} className="cw-cols" role="group" aria-label={label}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={leave}>
              {shown.map((d) => {
                const day = days[d];
                if (!day) return null;
                const items = itemsOf(d);
                const open = !now || d > now.day ? 0 : d < now.day ? SLOTS : Math.ceil(now.minute / 30);
                const range = stretch && stretch.day === d ? stretch : null;
                const rangeNote = range && scheduling ? free?.(d, range.start, range.end) : undefined;
                return (
                  <div key={d} className={cn('cw-col', day.today && 'is-today', day.weekend && 'is-end')} data-d={d}>
                    {zonesOf(d, items).map((z, i) => (
                      <span key={`${z.k}-${i}`} className={cn('cw-z', `is-${z.k}`)} style={{ '--s': z.s, '--e': z.e, '--lt': z.lt ?? 0 }}>
                        {z.tall && z.who && <small>{z.who}</small>}
                      </span>
                    ))}
                    <HalfHours day={d} labels={labels[d] ?? NO_LABELS} cursor={cur.day === d ? cur.slot : -1} open={open} onKey={onSlotKey} onPress={onSlotPress} onFocus={onSlotFocus} />
                    {items.map((item) => {
                      const w = wordsOf(item, hp, colW);
                      const b = item.block;
                      if (b && item.role === 'block') {
                        const words = `${b.title}, ${day.label}, ${clock(item.s)} to ${clock(item.e)}${b.wait ? `, ${b.wait === 'dec' ? 'a decision to confirm' : 'a follow-up for you'}` : ''}`;
                        return (
                          <button key={item.key} type="button" className={cn(blockClass(item, w), b.wait && 'has-wait')} style={blockStyle(item)} data-role="block"
                            title={words} aria-label={words} onClick={() => onBlock?.(b.id)}>
                            <BlockWords item={item} w={w}>{b.wait && <i className={cn('wait', `is-${b.wait}`)} aria-hidden="true" />}</BlockWords>
                          </button>
                        );
                      }
                      return (
                        <span key={item.key} className={blockClass(item, w)} style={blockStyle(item)} data-role={item.role === 'none' ? undefined : item.role}
                          data-i={item.i} aria-hidden="true">
                          <BlockWords item={item} w={w} />
                        </span>
                      );
                    })}
                    {range && (() => {
                      const item: Item = {
                        key: 'range', s: range.start, e: range.end, lane: 0, of: 1, ev: false, role: 'none', cls: cn('is-ghost is-drag', rangeNote?.busy && 'is-busy'),
                        range: `${clock(range.start)} – ${clock(range.end)}`, start: clock(range.start), name: lengthWords(range.end - range.start)
                      };
                      const w = wordsOf(item, hp, colW);
                      return <span className={blockClass(item, w)} style={blockStyle(item)} aria-hidden="true"><BlockWords item={item} w={w} /></span>;
                    })()}
                    {!moving && !stretch && <Pointed day={d} spots={spots} hp={hp} colW={colW} length={ghostLength} scheduling={scheduling} free={free} />}
                    {now && now.day === d && <span className="cw-now" style={{ '--s': now.minute }} aria-hidden="true"><i /></span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {scheduling && pill && onScreen && (
          <button type="button" className={cn('cw-pill', `is-${pill}`)} onClick={() => show(onScreen.start, onScreen.end, true)}>
            <Icon name="arrowUp" size={14} />
            {pillDay?.short ?? pillDay?.label}, {clock(onScreen.start)} – {clock(onScreen.end)}
          </button>
        )}
        {moving && edge === 'next' && <span className="cw-edge is-next" aria-hidden="true"><Icon name="chevron" size={22} /></span>}
        {moving && edge === 'prev' && canGoBack && <span className="cw-edge is-prev" aria-hidden="true"><Icon name="chevronLeft" size={22} /></span>}
      </div>
      {!scheduling && legend && legend.length > 0 && (
        <p className="cw-key">
          {legend.map((k) => <span key={k.kind}><i className={cn('k', `is-${k.kind}`)} aria-hidden="true" />{k.label}</span>)}
        </p>
      )}
    </div>
  );
}
