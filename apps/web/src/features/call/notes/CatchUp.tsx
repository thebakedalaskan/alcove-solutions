/*
 * Catching up during a call, for you alone: what to read (a range), what a catch-up or an answer says with the
 * transcript moments behind each point, how complete and how current it is, and the transcript at one of those
 * moments. Nothing here goes into the call, and nothing is kept unless you keep an answer in your own notes: answers come
 * from what was said while notes were on, and point only at lines that were really said.
 */
import { type CallAnswer, type CallMoment, type CatchUp, type CatchUpItem, type CatchUpRange, type CatchUpRead, type CatchUpWindow, type Evidence, type SeriesAnswerPart, type TranscriptMoment } from '@alcove/api';
import { Avatar, Button, Dots, EmptyState, Icon, Notice, Popover, Scope, Segmented, TimeChip, Unencrypted, cn } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { NotesApart, SourceLink } from '~/features/notes/parts';
import { KeepAnswer } from '~/features/notes/personal/parts';
import { gapLabel } from '~/lib/capture';
import { spokenName } from '~/lib/people';
import { hm, hms } from '~/lib/time';
import { useDraft, type Draft } from '../layout/side';

const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;

/**
 * A question or catch-up asked in the Ask view, what it read, and its answer once it's back. `room`: the breakout
 * room it was asked in, whose lines alone it reads (null in the main room). A question about earlier calls reads the
 * notes you had then (`held`), so its answer stays on screen only while you still have them.
 */
export type Asked =
  | { id: number; kind: 'question'; q: string; range: CatchUpRange; room: string | null; a: CallAnswer | null; error: string | null }
  | { id: number; kind: 'catch-up'; range: CatchUpRange; room: string | null; c: CatchUp | null; error: string | null }
  | { id: number; kind: 'earlier'; q: string; held: string[]; parts: SeriesAnswerPart[] | null; error: string | null };

/** What questions read: this call, or the earlier calls in its series whose notes you have. */
export type AskScope = 'call' | 'earlier';

/** A transcript moment being opened from a catch-up or an answer: what was asked for, and what came back. */
export interface Moment { evidence: TranscriptMoment; found: CallMoment | null; error: string | null }

/**
 * Times in catching up, shown as times of day like the gaps in the transcript and the changes to what's captured
 * (lib/capture.ts). The API counts seconds since the call started; they're placed by when it started. Stretches and
 * "as of" go to the minute, moments to the second, since several can fall in one minute.
 */
export interface CallTimes {
  /** "10:04" */
  minute: (s: number) => string;
  /** "10:04:12" */
  second: (s: number) => string;
  /** "10:04–10:09", or to the second when both ends fall in one minute. */
  stretch: (from: number, to: number) => string;
  /** A time of day (a gap's) in seconds since the call started. */
  at: (iso: string) => number;
}
export function callTimes(startedAt: string): CallTimes {
  const t0 = Date.parse(startedAt);
  const minute = (s: number) => hm(new Date(t0 + s * 1000));
  const second = (s: number) => hms(new Date(t0 + s * 1000));
  return {
    minute, second,
    stretch: (from, to) => (minute(from) === minute(to) ? `${second(from)}–${second(to)}` : `${minute(from)}–${minute(to)}`),
    at: (iso) => (Date.parse(iso) - t0) / 1000
  };
}

/** Questions read the whole call unless you pick otherwise. */
export const WHOLE_CALL: CatchUpRange = { kind: 'all' };

/**
 * What someone most likely missed, for the one-tap Catch up: their time away if it was in the last ten minutes, what
 * was said before they came if they just joined late, or else the last five minutes. A guest with the link reads only
 * what they were there for, so for them it's always the last few minutes.
 */
export function likelyMissed(w: CatchUpWindow | null): CatchUpRange {
  if (w && w.here === null && w.away && w.now - w.away.to < 600) return { kind: 'away' };
  if (w && w.here === null && w.joined >= 60 && w.now - w.joined < 600) return { kind: 'before-joined' };
  return { kind: 'recent', minutes: 5 };
}

const sameRange = (a: CatchUpRange, b: CatchUpRange): boolean => {
  if (a.kind === 'recent' && b.kind === 'recent') return a.minutes === b.minutes;
  if (a.kind === 'between' && b.kind === 'between') return a.from === b.from && a.to === b.to;
  return a.kind === b.kind;
};

/** A range in a few words, for the chip that picks it and the card that read it. */
function rangeName(r: CatchUpRange, t: CallTimes): string {
  switch (r.kind) {
    case 'recent': return `Last ${r.minutes} min`;
    case 'since-joined': return 'Since you joined';
    case 'before-joined': return 'Before you joined';
    case 'away': return 'While you were away';
    case 'between': return r.to === null ? `From ${t.minute(r.from)}` : t.stretch(r.from, r.to);
    case 'all': return 'Whole call';
  }
}
/** What to say when a range had nothing in it, in the breakout room it was read in, if any. */
function nothingIn(r: CatchUpRange, room: string | null): string {
  const where = room ? ` in ${room}` : '';
  switch (r.kind) {
    case 'recent': return `Nothing was said${where} in the last ${r.minutes} minutes.`;
    case 'since-joined': return `Nothing has been said${where} since you joined.`;
    case 'before-joined': return `Nothing was said${where} before you joined.`;
    case 'away': return `Nothing was said${where} while you were away.`;
    case 'between': return `Nothing was said${where} in that stretch.`;
    case 'all': return `Nothing has been said${where} yet.`;
  }
}

/** The ranges someone can pick now: the ones that mean something for them, with the times they cover. */
function choices(w: CatchUpWindow | null, t: CallTimes): { range: CatchUpRange; label: string; sub?: string | undefined }[] {
  const out: { range: CatchUpRange; label: string; sub?: string | undefined }[] = [
    { range: { kind: 'recent', minutes: 5 }, label: 'Last 5 minutes' },
    { range: { kind: 'recent', minutes: 15 }, label: 'Last 15 minutes' }
  ];
  // What was said before you came, and while you were away, goes to the people invited; a guest wasn't there for it.
  if (w && w.here === null && w.joined >= 60) out.push({ range: { kind: 'before-joined' }, label: 'Before you joined', sub: `until ${t.minute(w.joined)}` });
  if (w && w.joined >= 30) out.push({ range: { kind: 'since-joined' }, label: 'Since you joined', sub: t.minute(w.joined) });
  if (w?.away && w.here === null) out.push({ range: { kind: 'away' }, label: 'While you were away', sub: t.stretch(w.away.from, w.away.to) });
  out.push({ range: WHOLE_CALL, label: 'The whole call' });
  return out;
}

/* ---------- picking a range ---------- */

const STEP = 15;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A stretch of the call picked on its timeline: two handles, dragged or moved with the keys (arrows by 15 seconds,
 * Page Up and Page Down by five minutes, Home and End to the ends). When nothing was captured (notes off or paused) is
 * hatched; your time away is marked; for a guest, what was said before they came or while they were away is dimmed,
 * since they can't read it.
 */
function StretchPicker({ w, times: t, onPick }: { w: CatchUpWindow; times: CallTimes; onPick: (r: CatchUpRange) => void }) {
  const end = Math.max(w.now, STEP * 2);
  const gaps = w.gaps.map((g) => ({ from: t.at(g.from), to: g.to ? t.at(g.to) : end }));
  const kinds = new Set(w.gaps.map((g) => g.kind));
  const gapName = kinds.size > 1 ? 'Notes off or paused' : kinds.has('paused') ? 'Paused' : 'Notes off';
  const [from, setFrom] = useState(() => Math.max(0, end - 600));
  const [to, setTo] = useState(end);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<'from' | 'to' | null>(null);
  const pct = (s: number) => `${(clamp(s, 0, end) / end) * 100}%`;
  const move = (which: 'from' | 'to', v: number) => (which === 'from' ? setFrom(clamp(v, 0, to - STEP)) : setTo(clamp(v, from + STEP, end)));
  const valueAt = (x: number) => {
    const r = track.current?.getBoundingClientRect();
    return r && r.width ? Math.round((clamp((x - r.left) / r.width, 0, 1) * end) / 5) * 5 : 0;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const v = valueAt(e.clientX);
    const which = Math.abs(v - from) <= Math.abs(v - to) ? 'from' : 'to';
    dragging.current = which;
    e.currentTarget.setPointerCapture(e.pointerId);
    move(which, v);
  };
  const key = (which: 'from' | 'to') => (e: KeyboardEvent<HTMLSpanElement>) => {
    const now = which === 'from' ? from : to;
    const by = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -STEP : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? STEP
      : e.key === 'PageDown' ? -300 : e.key === 'PageUp' ? 300 : e.key === 'Home' ? -end : e.key === 'End' ? end : 0;
    if (!by) return;
    e.preventDefault();
    move(which, now + by);
  };
  const outside = w.here ? between(w.here, end) : [];
  const thumb = (which: 'from' | 'to', v: number, label: string) => (
    <span role="slider" tabIndex={0} className="thumb" style={{ left: pct(v) }} aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(end)}
      aria-valuenow={Math.round(v)} aria-valuetext={which === 'to' && v >= end ? 'now' : t.second(v)} onKeyDown={key(which)} />
  );
  return (
    <div className="cu-pick">
      <div ref={track} className="cu-track" onPointerDown={down} onPointerMove={(e) => { if (dragging.current) move(dragging.current, valueAt(e.clientX)); }}
        onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
        <span className="rail" />
        <span className="sel" style={{ left: pct(from), width: pct(to - from) }} />
        {outside.map((x) => <span key={`o${x.from}`} className="out" style={{ left: pct(x.from), width: pct(x.to - x.from) }} />)}
        {gaps.map((g) => <span key={`g${g.from}`} className="gap" style={{ left: pct(g.from), width: pct(g.to - g.from) }} />)}
        {w.away && <span className="away" style={{ left: pct(w.away.from), width: pct(w.away.to - w.away.from) }} />}
        {thumb('from', from, 'Start of the stretch')}
        {thumb('to', to, 'End of the stretch')}
      </div>
      <div className="cu-ends"><span>{t.minute(0)}</span><span className="sel">{t.second(from)} to {to >= end ? 'now' : t.second(to)}</span><span>now</span></div>
      {(w.gaps.length > 0 || w.away || outside.length > 0) && (
        <div className="cu-legend">
          {w.gaps.length > 0 && <span><i className="gap" />{gapName}</span>}
          {w.away && <span><i className="away" />You were away</span>}
          {outside.length > 0 && <span><i className="out" />You weren’t here</span>}
        </div>
      )}
      <Button size="sm" variant="secondary" className="cu-use" onClick={() => onPick(from <= 0 && to >= end ? WHOLE_CALL : { kind: 'between', from, to: to >= end ? null : to })}>Read this stretch</Button>
    </div>
  );
}
/** The stretches between `xs` (in order) from the start until `end`. */
function between(xs: { from: number; to: number }[], end: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let at = 0;
  for (const x of xs) { if (x.from > at) out.push({ from: at, to: x.from }); at = Math.max(at, x.to); }
  if (end > at + 1) out.push({ from: at, to: end });
  return out;
}

/** The chip that says what's read, and the menu that changes it. */
export function RangeMenu({ range, window: w, times, onOpen, onPick }: {
  range: CatchUpRange; window: CatchUpWindow | null; times: CallTimes;
  /** The menu opened: a good moment to learn the window again. */
  onOpen: () => void;
  onPick: (r: CatchUpRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [stretch, setStretch] = useState(false);
  const pick = (r: CatchUpRange) => { setOpen(false); setStretch(false); onPick(r); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) onOpen(); else setStretch(false); }} side="top" align="start" label="What to read" className="ic-menu cu-menu"
      anchor={<button type="button" className="cu-range" aria-label={`Reading: ${rangeName(range, times)}. Change what to read`}><Icon name="history" size={14} /><span>{rangeName(range, times)}</span><Icon name="down" size={14} /></button>}>
      <div className="ac-eyebrow cu-h">Read from</div>
      {choices(w, times).map((c) => (
        <button key={c.label} type="button" role="menuitemradio" aria-checked={sameRange(c.range, range)} className="ic-opt" onClick={() => pick(c.range)}>
          <span className="nm">{c.label}{c.sub && <span className="sub"> · {c.sub}</span>}</span><Icon name="check" size={16} className="tick" />
        </button>
      ))}
      <button type="button" role="menuitemradio" aria-checked={range.kind === 'between'} aria-expanded={stretch} className="ic-opt" disabled={!w} onClick={() => setStretch((s) => !s)}>
        <span className="nm">Pick a stretch{range.kind === 'between' && <span className="sub"> · {rangeName(range, times)}</span>}</span><Icon name={stretch ? 'up' : 'down'} size={16} className="cu-more" />
      </button>
      {stretch && w && <StretchPicker w={w} times={times} onPick={pick} />}
      {w?.here && <p className="hint">You joined with the link, so you can catch up on what was said while you were here. The notes go to the people invited.</p>}
    </Popover>
  );
}

/* ---------- what came back ---------- */

/** The transcript moments behind a point, to the second: each opens the transcript there. */
export function Moments({ evidence, times, onOpen }: { evidence: Evidence[]; times: CallTimes; onOpen: (e: TranscriptMoment) => void }) {
  if (!evidence.length) return null;
  return (
    <span className="cu-ev">
      {evidence.map((e) => {
        const t = times.second(e.said);
        return <TimeChip key={e.lineId} seconds={e.said} label={t} title={`Open the transcript at ${t}`} onSeek={() => onOpen(e)} />;
      })}
    </span>
  );
}

/**
 * How complete and current an answer is: the stretch it read, how many lines it read, as of when, and what it can't
 * have in it, the middle of a stretch too long to read whole included.
 */
function ReadNote({ read, room, times: t }: { read: CatchUpRead; room: string | null; times: CallTimes }) {
  const span = (xs: { from: number; to: number }[]) => xs.slice(0, 3).map((x) => t.stretch(x.from, x.to)).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '');
  const skipped = read.skipped;
  return (
    <div className="cu-read">
      <p className="cu-when">{t.stretch(read.from, read.to)} · {read.lines} {read.lines === 1 ? 'line' : 'lines'} read · as of {t.minute(read.asOf)}</p>
      {skipped && <p className="cu-note"><Icon name="more" size={13} />This stretch was too long to read whole: {skipped.lines} {skipped.lines === 1 ? 'line' : 'lines'} said {t.stretch(skipped.from, skipped.to)} were left out.</p>}
      {read.gaps.length > 0 && <p className="cu-note"><Icon name="pause" size={13} />{read.gaps.slice(0, 3).map(gapLabel).join(' · ')}{read.gaps.length > 3 ? ` and ${read.gaps.length - 3} more` : ''}. Nothing said then is in this.</p>}
      {read.missed.length > 0 && <p className="cu-note"><Icon name="wifiOff" size={13} />Nothing was transcribed {span(read.missed)}, {room ? `while nobody’s browser in ${room} could hear it` : 'while the host’s connection was away'}.</p>}
      {room && <p className="cu-note"><Icon name="door" size={13} />Only what was said in {room} while you were in it.</p>}
      {read.whileHere && <p className="cu-note"><Icon name="lock" size={13} />Only what was said while you were here.</p>}
    </div>
  );
}

function CatchUpCard({ c, range, room, times, onOpen }: { c: CatchUp; range: CatchUpRange; room: string | null; times: CallTimes; onOpen: (e: TranscriptMoment) => void }) {
  const list = (title: string, xs: CatchUpItem[]) => xs.length > 0 && (
    <div className="cu-grp"><b>{title}</b><ul>{xs.map((x) => (
      <li key={x.text}>
        {x.text} <Moments evidence={x.evidence} times={times} onOpen={onOpen} />
        {(x.owner || x.due) && <span className="cu-meta">{[x.owner, x.due].filter(Boolean).join(' · ')}</span>}
      </li>
    ))}</ul></div>
  );
  if (!c.read.lines) return <><div className="txt">{nothingIn(range, room)}</div><ReadNote read={c.read} room={room} times={times} /></>;
  const none = !c.decided.length && !c.proposed.length && !c.open.length && !c.next.length;
  return (
    <>
      {c.summary && <div className="txt">{c.summary}</div>}
      {list('Decided', c.decided)}{list('Suggested, not agreed', c.proposed)}{list('Still open', c.open)}{list('Next', c.next)}
      {none && <p className="ic-quiet">Nothing decided, suggested or left open in this stretch.</p>}
      <ReadNote read={c.read} room={room} times={times} />
    </>
  );
}

function AnswerCard({ a, range, room, times, onOpen, keep }: { a: CallAnswer; range: CatchUpRange; room: string | null; times: CallTimes; onOpen: (e: TranscriptMoment) => void; keep?: ReactNode }) {
  if (!a.read.lines) return <><div className="txt">{nothingIn(range, room)}</div><ReadNote read={a.read} room={room} times={times} /></>;
  return (
    <>
      <div className="txt">{a.text}</div>
      {a.evidence.length > 0 && <div className="cites"><Moments evidence={a.evidence} times={times} onOpen={onOpen} /></div>}
      <ReadNote read={a.read} room={room} times={times} />
      {keep}
    </>
  );
}

/** Back to the call as it is now, from a catch-up or a moment of the transcript. */
function LiveBar({ children, onLive }: { children: ReactNode; onLive: () => void }) {
  return (
    <div className="cu-bar">
      <span className="t">{children}</span>
      <Button size="sm" variant="secondary" icon="live" onClick={onLive}>Back to live</Button>
    </div>
  );
}

/** An answer about earlier calls: its text, and where it comes from. Each source's link opens beside the call, with your access checked again. */
function EarlierAnswer({ parts }: { parts: SeriesAnswerPart[] }) {
  const sources = parts.flatMap((p) => (p.type === 'source' ? [p] : []));
  return (
    <NotesApart.Provider value={true}>
      {parts.map((p) => (p.type === 'text' ? <div key="text" className="txt">{p.text}</div> : null))}
      {sources.length > 0 && <div className="cites">{sources.map((c) => <SourceLink key={`${c.noteId}/${c.room?.id ?? ''}@${c.at ?? ''}`} c={c} />)}</div>}
    </NotesApart.Provider>
  );
}

const SUGGESTED = ['What did we decide?', 'Who’s doing what?'];
const SUGGESTED_EARLIER = ['Why did we choose this?', 'What’s still open?'];

export function AskView({ asks, ready, paused, modelPrivate, startedAt, range, window: w, catching, draft, earlier, scope, onScope, onRange, onWindow, onAsk, onAskEarlier, onCatchUp, onOpen, onLive, keeping }: {
  asks: Asked[];
  /** There's a transcript to ask about. */
  ready: boolean;
  /** Notes are paused: nothing goes to the AI, questions included. */
  paused: boolean;
  /** The call's AI model runs in a secure enclave. When it doesn't, questions go to a model Alcove can't guarantee is private. */
  modelPrivate: boolean;
  /** When the call started, which places its times of day. */
  startedAt: string;
  /** What questions and catch-ups read. */
  range: CatchUpRange;
  window: CatchUpWindow | null;
  /** You came here to catch up, so the view offers the way back to the call as it is now. */
  catching: boolean;
  draft: Draft;
  /** The written notes you have from earlier calls in this call's series; null when you can't ask about any. */
  earlier: string[] | null;
  scope: AskScope;
  onScope: (s: AskScope) => void;
  onRange: (r: CatchUpRange) => void; onWindow: () => void;
  onAsk: (q: string) => void; onAskEarlier: (q: string) => void; onCatchUp: () => void; onOpen: (e: TranscriptMoment) => void; onLive: () => void;
  /** Keeping answers in your own notes, for someone with an account in the call: which you have, and keeping one. Answers about this call only: one from earlier calls quotes notes that can go. */
  keeping?: { kept: ReadonlySet<number>; keep: (asked: number, question: string, answer: CallAnswer) => Promise<void> } | undefined;
}) {
  const [text, setText] = useDraft(draft);
  const end = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const busy = asks.some((a) => (a.kind === 'question' ? a.a === null && !a.error : a.kind === 'earlier' ? a.parts === null && !a.error : a.c === null && !a.error));
  const times = callTimes(startedAt);
  // Asking about earlier calls reads nothing of this one, so it doesn't wait for a transcript; while notes are paused nothing goes.
  const backwards = scope === 'earlier' && earlier !== null;
  const can = backwards ? !paused : ready;
  const ask = backwards ? onAskEarlier : onAsk;
  const what = backwards ? 'Ask about earlier calls' : 'Ask about this call';
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' }); }, [asks, reduce]);
  const keepFor = (x: Extract<Asked, { kind: 'question' }>) => {
    const answer = x.a;
    return keeping && answer ? <KeepAnswer kept={keeping.kept.has(x.id)} onKeep={() => keeping.keep(x.id, x.q, answer)} /> : null;
  };
  return (
    <>
      {catching && <LiveBar onLive={onLive}><Icon name="history" size={14} />Catching up · only you</LiveBar>}
      <div className="ic-scroll ic-pad">
        {!modelPrivate && <Notice tone="caution" icon="shieldOff"><b>Not in a secure enclave.</b> Questions go to an AI model Alcove can’t guarantee keeps them private. <Unencrypted compact /></Notice>}
        <div className="ic-qa">
          {!asks.length && paused && <EmptyState title="Notes are paused" className="ic-empty">Nothing goes to the AI, questions included, until they resume.</EmptyState>}
          {!asks.length && !paused && !backwards && !ready && <EmptyState title="Nothing to ask about yet" className="ic-empty">Turn notes on and talk for a bit. Answers come from what’s been transcribed.</EmptyState>}
          {!asks.length && !paused && backwards && <EmptyState title="Ask about earlier calls" className="ic-empty">Why something was decided, or who took what on. Each answer says which call it comes from.</EmptyState>}
          {asks.map((a) => (
            <div key={a.id} className="ic-qa-item">
              {a.kind !== 'catch-up' && <div className="q">{a.q}</div>}
              <motion.div className={cn('a', a.kind === 'catch-up' && 'is-catch')} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : UI}>
                {a.kind === 'earlier' ? <div className="by"><Icon name="history" size={14} />From earlier calls · only you</div>
                  : <div className="by"><Icon name={a.kind === 'catch-up' ? 'history' : 'sealed'} size={14} />{a.kind === 'catch-up' ? 'Catch up' : 'From this call'} · {rangeName(a.range, times)} · only you</div>}
                {a.error ? <div className="txt bad">{a.error}</div>
                  : a.kind === 'earlier' ? (a.parts === null ? <div className="txt ic-writing"><Dots />Reading your earlier notes</div>
                    : a.held.every((id) => earlier?.includes(id)) ? <EarlierAnswer parts={a.parts} />
                      : <div className="txt ic-quiet">Notes this read aren’t yours any more, so it isn’t shown.</div>)
                    : a.kind === 'question' ? (a.a === null ? <div className="txt ic-writing"><Dots />Reading the call</div> : <AnswerCard a={a.a} range={a.range} room={a.room} times={times} onOpen={onOpen} keep={keepFor(a)} />)
                      : a.c === null ? <div className="txt ic-writing"><Dots />Reading {rangeName(a.range, times).toLowerCase()}</div> : <CatchUpCard c={a.c} range={a.range} room={a.room} times={times} onOpen={onOpen} />}
              </motion.div>
            </div>
          ))}
          <div ref={end} />
        </div>
      </div>
      <form className="ic-foot" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); if (q && !busy && can) { ask(q); setText(''); } }}>
        {earlier !== null && <Segmented className="cu-scope" label="What to ask about" value={scope} onChange={onScope} options={[{ value: 'call', label: 'This call' }, { value: 'earlier', label: 'Earlier calls' }]} />}
        <div className="chips">
          <Scope>Only you</Scope>
          {backwards ? SUGGESTED_EARLIER.map((s) => <button key={s} type="button" className="ac-chip" disabled={busy || !can} onClick={() => ask(s)}>{s}</button>) : (
            <>
              <RangeMenu range={range} window={w} times={times} onOpen={onWindow} onPick={onRange} />
              <button type="button" className="ac-chip" disabled={busy || !ready} onClick={onCatchUp}>Catch me up</button>
              {SUGGESTED.map((s) => <button key={s} type="button" className="ac-chip" disabled={busy || !ready} onClick={() => onAsk(s)}>{s}</button>)}
            </>
          )}
        </div>
        <div className="inrow">
          <input className="ac-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={what} aria-label={what} />
          <button type="submit" className="ac-btn is-primary" aria-label="Ask" disabled={!text.trim() || busy || !can}><Icon name="sendLine" size={18} /></button>
        </div>
      </form>
    </>
  );
}

/* ---------- the transcript at a moment ---------- */

/**
 * The transcript at a moment a catch-up or an answer pointed at: that line, marked, and what was said around it, each
 * at its time of day to the second. Your access to it was checked again when it was opened. Back to live returns to
 * the call as it is now.
 */
export function MomentView({ moment, startedAt, me, onLive }: { moment: Moment; startedAt: string; me: string | undefined; onLive: () => void }) {
  const t = callTimes(startedAt);
  const hit = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const found = moment.found;
  useEffect(() => { hit.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); }, [found, reduce]);
  return (
    <>
      <LiveBar onLive={onLive}><Icon name="transcript" size={14} />Said at {t.second(moment.evidence.said)}</LiveBar>
      <div className="ic-scroll">
        {moment.error ? <div className="cu-moment-msg"><Notice tone="caution">{moment.error}</Notice></div>
          : !found ? <div className="cu-moment-msg ic-writing"><Dots />Opening the transcript</div> : (
            <div className="tx-log cu-moment" role="log" aria-label="What was said around that moment">
              {found.lines.map((l, i) => {
                const prev = found.lines[i - 1];
                const marked = l.id === found.lineId;
                // A new speaker, the marked line, or the line after it starts a group, so the marked line stands on its own with its time.
                const start = marked || !prev || prev.id === found.lineId || prev.speaker?.name !== l.speaker?.name;
                return (
                  <div key={l.id} ref={marked ? hit : undefined} className={cn('tx-l', start && 'tx-start', marked && 'is-hit')} aria-current={marked ? 'true' : undefined}>
                    {start && l.speaker ? <Avatar person={l.speaker.person ?? { name: l.speaker.name }} size={26} /> : <span />}
                    <div className="min-w-0">
                      {start && <div className="tx-h">{l.speaker && <b>{spokenName(l.speaker, me)}</b>}<span className="ac-time">{t.second(l.said)}</span>{l.room && <span className="ac-time">· {l.room.name}</span>}</div>}
                      <p>{l.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
      <div className="ic-nf"><Icon name="lock" size={15} /><span className="lbl">Only you see this</span></div>
    </>
  );
}
