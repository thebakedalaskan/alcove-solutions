/*
 * Catching up during a call (docs: Notes and inference › Catching up during a call): someone's time in the call,
 * the stretch of the live transcript a range asks for, narrowed to what they may read, what it's missing, and which
 * real lines back what the notes model says. Plain functions over what calls.ts reads; nothing here is kept.
 * Times are seconds since the call started, to a tenth.
 */
import type { CallStretch, CaptureGap, CatchUpRange, CatchUpRead, CatchUpWindow, Evidence } from '@alcove/api';
import type { Cut } from './drafting';
import { ConflictError, ValidationError } from '../errors';

/** How long before someone dropped out a catch-up on their time away starts: a browser that drops without a word is noticed late, and the last thing heard picks the thread up. */
export const AWAY_LEAD_IN = 30;
/** Comings and goings closer together than this are one stretch in the call (a reload's own blink). */
const MERGE = 1;
/** Stretches without a hosting browser shorter than this aren't worth saying: a reload hands over within it. */
const MISSED_MIN = 2;

const tenth = (s: number) => Math.round(s * 10) / 10;

/** A stretch that may still be going: `to` null runs to now (and past it, for a line placed by a clock running a little ahead). */
export interface Open { from: number; to: number | null }

/** A connection to the call as calls.ts keeps it: whose, whether it was let in, and when it came and went (ms). */
export interface Connection {
  identity: string; person: string; role: 'host' | 'invited' | 'guest'; email?: string | undefined;
  status: 'waiting' | 'in' | 'left' | 'denied'; since: number; left: number | null;
  /** Earlier stretches of a connection that came back in as it was after a drop (`mls/back`). */
  earlier: { since: number; left: number }[];
}
/** A connection's stretches hosting the call (ms; `to` null while it still hosts). */
export interface Hosting { hosting: { from: number; to: number | null }[] }
/** A line of the live transcript with when it was said, if the call placed it. */
export interface Placed { id: string; said?: number | undefined }

/**
 * Which connections are one person's: every one of the organizer's; someone on the invite's by their address (a
 * second device included); anyone else's by the person their pass names (reloads keep it).
 */
function sameAs(me: Connection): (j: Connection) => boolean {
  if (me.role === 'host') return (j) => j.role === 'host';
  const email = me.email?.toLowerCase();
  if (email) return (j) => j.email?.toLowerCase() === email;
  return (j) => j.person === me.person;
}

/** Stretches in order with those that overlap or nearly touch made one. */
function merged(xs: Open[]): Open[] {
  const out: Open[] = [];
  for (const x of [...xs].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && (last.to === null || x.from - last.to < MERGE)) out[out.length - 1] = { from: last.from, to: last.to === null || x.to === null ? null : Math.max(last.to, x.to) };
    else out.push(x);
  }
  return out;
}

/**
 * Someone's time in the call: the stretches any of their connections was let in, merged. The last is open while
 * they're still in. `startedAt` is when the call started (ms).
 */
export function presence(people: Connection[], me: Connection, startedAt: number): Open[] {
  const at = (ms: number) => Math.max(0, tenth((ms - startedAt) / 1000));
  return merged(people.filter(sameAs(me)).flatMap((j): Open[] => {
    const before = j.earlier.map((e): Open => ({ from: at(e.since), to: Math.max(at(e.since), at(e.left)) }));
    if (j.status === 'in') return [...before, { from: at(j.since), to: null }];
    // Only people who were let in leave: someone who only asked is forgotten, or turned away.
    if (j.status === 'left') return [...before, { from: at(j.since), to: Math.max(at(j.since), at(j.left ?? j.since)) }];
    return before;
  }));
}

/** When a hosting browser, which sends what's said, was in the call: every connection's stretches hosting, merged. */
export function hostingOf(people: Hosting[], startedAt: number): Open[] {
  const at = (ms: number) => Math.max(0, tenth((ms - startedAt) / 1000));
  return merged(people.flatMap((j) => j.hosting.map((h): Open => ({ from: at(h.from), to: h.to === null ? null : Math.max(at(h.from), at(h.to)) }))));
}

/** The stretches between `xs` (merged, in order) from the start of the call until `now`. */
function between(xs: Open[], now: number): Open[] {
  const out: Open[] = [];
  let from = 0;
  for (const x of xs) {
    if (x.from > from) out.push({ from, to: x.from });
    if (x.to === null) return out;
    from = Math.max(from, x.to);
  }
  if (now > from) out.push({ from, to: null });
  return out;
}

/** Where two lists of stretches overlap. */
function overlap(a: Open[], b: Open[]): Open[] {
  return a.flatMap((x) => b.flatMap((y): Open[] => {
    const from = Math.max(x.from, y.from);
    const to = x.to === null ? y.to : y.to === null ? x.to : Math.min(x.to, y.to);
    return to === null || to > from ? [{ from, to }] : [];
  })).sort((p, q) => p.from - q.from);
}

const closed = (x: Open, now: number): CallStretch => ({ from: x.from, to: tenth(Math.max(x.from, x.to ?? now)) });
const length = (x: Open, now: number) => Math.max(0, (x.to ?? now) - x.from);
const inside = (xs: Open[], s: number) => xs.some((x) => s >= x.from && (x.to === null || s <= x.to));

/**
 * What someone can catch up on: now, when the call started (ms), when they came in, their latest time away, for a guest
 * the stretches they were here, and the stretches with nothing captured (capture.gapsOf: notes off or paused).
 */
export interface Window { now: number; startedAt: number; joined: number; away: CallStretch | null; here: Open[] | null; gaps: CaptureGap[] }

/**
 * Builds someone's window. `mine` is their own time in the call (presence); `readsAll` is false for a guest with the
 * link, who reads only that.
 */
export function windowOf(now: number, startedAt: number, mine: Open[], readsAll: boolean, gaps: CaptureGap[]): Window {
  const away = mine.length > 1 ? between(mine, now).filter((g) => g.from > 0 && g.to !== null).at(-1) ?? null : null;
  return { now, startedAt, joined: mine[0]?.from ?? now, away: away ? closed(away, now) : null, here: readsAll ? null : mine, gaps };
}
/** A window as the person sees it. */
export const shown = (w: Window): CatchUpWindow => ({
  now: w.now, joined: w.joined, away: w.away, here: w.here ? w.here.map((x) => closed(x, w.now)) : null, gaps: w.gaps
});

/** A stretch with nothing captured, in seconds since the call started (gaps carry times of day). */
const stretchOf = (g: CaptureGap, startedAt: number): Open => {
  const at = (iso: string) => Math.max(0, tenth((Date.parse(iso) - startedAt) / 1000));
  return { from: at(g.from), to: g.to === null ? null : at(g.to) };
};

/**
 * Stretches with notes on and nothing transcribed: no hosting browser, which sends what's said, was in the call.
 * `host` is when any connection hosted it. Stretches with notes off or paused are gaps, not this.
 */
export function missedOf(host: Open[], w: Window): Open[] {
  return overlap(between(host, w.now), between(merged(w.gaps.map((g) => stretchOf(g, w.startedAt))), w.now)).filter((x) => length(x, w.now) >= MISSED_MIN);
}

/** The stretch a range asks for. */
export function spanOf(range: CatchUpRange, w: Window, ctx: Record<string, string | number | null>): Open {
  const context = { ...ctx, range: range.kind };
  switch (range.kind) {
    case 'recent': return { from: Math.max(0, tenth(w.now - range.minutes * 60)), to: null };
    case 'since-joined': return { from: w.joined, to: null };
    case 'before-joined': return { from: 0, to: w.joined };
    case 'all': return { from: 0, to: null };
    case 'away':
      if (!w.away) throw new ConflictError('You haven’t been away from this call.', { context });
      return { from: Math.max(0, w.away.from - AWAY_LEAD_IN), to: w.away.to };
    case 'between':
      if (range.from > w.now + MERGE) throw new ValidationError('That part of the call hasn’t happened yet.', { context });
      if (range.to !== null && range.to < range.from) throw new ValidationError('That stretch ends before it starts.', { context });
      return { from: range.from, to: range.to };
  }
}

/**
 * The lines a range asks for, in order, and what that read was: the stretch, how many lines, the newest, what's
 * missing in it, and whether being a guest left part of it out. `all` is what this person may read (calls.ts
 * readableBy); a guest's own time in the call is `w.here`.
 */
export function readOf<L extends Placed>(all: L[], range: CatchUpRange, w: Window, missed: Open[], ctx: Record<string, string | number | null>): { lines: (L & { said: number })[]; read: CatchUpRead } {
  const span = spanOf(range, w, ctx);
  const lines = all.flatMap((l) => (l.said !== undefined && l.said >= span.from && (span.to === null || l.said <= span.to) ? [{ ...l, said: l.said }] : []));
  const through = lines.length ? Math.max(...lines.map((l) => l.said)) : null;
  const end = span.to ?? Math.max(w.now, through ?? 0);
  const stretch: Open[] = [{ from: span.from, to: end }];
  const within = (xs: Open[]) => overlap(xs, stretch).map((x) => closed(x, end));
  // Part of the range fell outside this guest's time in the call.
  const covered = w.here ? overlap(w.here, stretch).reduce((n, x) => n + length(x, end), 0) : end - span.from;
  return {
    lines,
    read: {
      from: span.from, to: tenth(end), lines: lines.length, through,
      // Each stretch with nothing captured that touches what was read, as a whole.
      gaps: w.gaps.filter((g) => overlap([stretchOf(g, w.startedAt)], stretch).length > 0), missed: within(missed),
      whileHere: w.here !== null && end - span.from - covered > 0.5, skipped: null, asOf: w.now
    }
  };
}

/**
 * What was read once the model had it: a stretch too long to send whole keeps its beginning and end, and the lines
 * left out of the middle (`cut`, by their place in `lines`) are said, and not counted as read.
 */
export function withCut(read: CatchUpRead, cut: Cut | null, lines: { said: number }[]): CatchUpRead {
  const first = cut ? lines[cut.first] : undefined;
  const last = cut ? lines[cut.last] : undefined;
  if (!cut || !first || !last) return read;
  return { ...read, lines: read.lines - cut.count, skipped: { from: first.said, to: last.said, lines: cut.count } };
}

/** The moments behind a point: the lines the model pointed at, by their place in what it was sent. */
export const evidenceOf = (refs: number[], lines: { id: string; said: number }[]): Evidence[] =>
  refs.flatMap((i) => { const l = lines[i]; return l ? [{ kind: 'transcript' as const, lineId: l.id, said: l.said }] : []; });

/** Whether a line was said within someone's time in the call. */
export const readable = (here: Open[] | null, said: number | undefined): boolean => here === null || (said !== undefined && inside(here, said));

/** Whether everything said between `from` and `to` was said within one of someone's stretches in the call. */
export const covers = (here: Open[] | null, from: number, to: number): boolean => here === null || here.some((x) => x.from <= from && (x.to === null || to <= x.to));

/** What the model is told it's reading, so it can say "while you were away" when that's what it was. */
export function describe(range: CatchUpRange, whileHere: boolean): string {
  const what = range.kind === 'recent' ? `the last ${range.minutes} minute${range.minutes === 1 ? '' : 's'}`
    : range.kind === 'since-joined' ? 'what was said since the asker joined'
      : range.kind === 'before-joined' ? 'what was said before the asker joined'
        : range.kind === 'away' ? 'what was said while the asker was away from the call, from just before they dropped out until they were back'
          : range.kind === 'between' ? 'a stretch of the call the asker picked'
            : 'the whole call so far';
  return whileHere ? `${what}, only the parts the asker was in the call for` : what;
}
