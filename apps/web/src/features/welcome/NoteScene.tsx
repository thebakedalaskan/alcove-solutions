/*
 * The note a call leaves, on the hero's water: a design review's note page, in a window. A slim band of the note's evening
 * holds its title, and its horizon is the call: chapters stand on the line, what was decided (rose) and what's to do
 * (horizon) sit on it, the sun is the playhead and the strokes of light under it are where people spoke. Under the band
 * are the summary, Decided and Follow-ups, each with the moment it was said, and beside them the transcript, following
 * the recording.
 *
 * The first time it comes on screen it writes itself: the summary a word at a time, then each row. Then the sun visits
 * each moment in turn, lighting its row and moving the transcript while the time plays on. A moment, a press on the line
 * or the arrow keys go somewhere and stay there a while; Play and Pause stop and start the tour. With reduced motion it's
 * a still at the first decision until someone presses Play. Off screen nothing runs.
 */
import { Avatar, Button, Check, Chip, Dots, EASE, Faces, Icon, SealedBadge, TranscriptLine, Unsure, Words, buttonClass, cn, useSceneLoop } from '@alcove/ui';
import { animate, motion, useReducedMotion, type Transition } from 'motion/react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { CAST, firstOf, type CastId } from '~/features/notes/cast';
import { position } from '~/lib/time';
import { CHAPTERS, DECIDED, FOLLOW_UPS, GLINTS, HEAD, LENGTH, SAID, START, STOPS, SUMMARY, type Said } from './note';

/** How the sun gets somewhere: the tour's glide, a press on a moment or the line, an arrow key, or at once. */
type Glide = 'tour' | 'seek' | 'step' | 'jump';
const GLIDES: Record<Glide, Transition> = {
  tour: { duration: 1.5, ease: EASE.inOut },
  seek: { duration: 0.8, ease: EASE.inOut },
  step: { duration: 0.3, ease: EASE.out },
  jump: { duration: 0 }
};
/** Somewhere someone went stays this long before the tour goes on, in ms. */
const HOLD = 9000;
/** At each moment the time plays on for this many seconds before the sun goes on to the next. */
const DWELL = 3;
/** A row stays lit for this many seconds of the recording after its moment. */
const LIT = 15;
/** The transcript keeps the line being said this far below its top, in px. */
const LEAD = 70;
/** The summary writes itself a word this often, and the rows rise this often after it, in ms. */
const WORD_MS = 38;
const ROW_MS = 240;

const ROWS = DECIDED.length + FOLLOW_UPS.length;
const WORDS = SUMMARY.split(' ').length;

interface Mark { at: number; kind: 'decide' | 'follow' }
const MARKS: readonly Mark[] = [...DECIDED.map((d): Mark => ({ at: d.at, kind: 'decide' })), ...FOLLOW_UPS.map((f): Mark => ({ at: f.at, kind: 'follow' }))];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pct = (at: number) => `${((at / LENGTH) * 100).toFixed(3)}%`;
const nameOf = (id: CastId) => (id === 'art' ? 'You' : firstOf(id));
/** The next moment the sun visits after `t`, going round to the first after the last. */
const nextStop = (t: number) => STOPS.find((s) => s > t + 0.5) ?? STOPS[0] ?? START;
/** The line being said at `t`: the last to have started, or the first before any has. */
const lineAt = (t: number) => Math.max(0, SAID.findLastIndex((l) => l.at <= t + 0.5));

/**
 * Where the recording is (`t`) and where the sun stands (`pin`), with how it got there. A second played (a tick) moves
 * the sun less than a pixel, so the sun stays put rather than cut short a glide on its way.
 */
interface Here { t: number; pin: number; glide: Glide }

export function NoteScene() {
  const reduce = useReducedMotion() ?? false;
  const box = useRef<HTMLDivElement>(null);
  const [begun, setBegun] = useState(false);
  const [risen, setRisen] = useState(0);
  const [written, setWritten] = useState(false);
  const [pressed, setPressed] = useState<boolean | null>(null);
  const [here, setHere] = useState<Here>({ t: START, pin: START, glide: 'jump' });
  const [mine, setMine] = useState<readonly boolean[]>(() => DECIDED.map(() => false));
  const [done, setDone] = useState<readonly boolean[]>(() => FOLLOW_UPS.map((f) => f.done));
  const now = useRef(START);
  const hold = useRef(0);
  const ready = reduce || written;
  const playing = pressed ?? !reduce;

  const go = useCallback((t: number, how: Glide | 'tick') => {
    const to = clamp(Math.round(t), 0, LENGTH);
    now.current = to;
    setHere((h) => (how === 'tick' ? { ...h, t: to } : { t: to, pin: to, glide: how }));
  }, []);
  /** Someone went somewhere: it stays there a while before the tour goes on. */
  const seek = useCallback((t: number, glide: Glide) => { hold.current = Date.now() + HOLD; go(t, glide); }, [go]);

  /* Off screen, what runs by itself waits: the dots and the words with the loops. */
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((es) => { for (const e of es) el.toggleAttribute('data-on', e.isIntersecting); }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* The first time it's on screen it writes itself: the summary, then the rows one by one, then it's ready. */
  useSceneLoop(box, async (c) => {
    await c.sleep(500);
    setBegun(true);
    await c.sleep(WORDS * WORD_MS + 120);
    for (let i = 1; i <= ROWS; i++) {
      setRisen(i);
      await c.sleep(ROW_MS);
    }
    setWritten(true);
  }, !reduce && !written);

  /* Then the time plays on at each moment, and the sun goes on to the next, unless someone has just gone somewhere. */
  useSceneLoop(box, async (c) => {
    for (;;) {
      for (let s = 0; s < DWELL || Date.now() < hold.current; s++) {
        await c.sleep(1000);
        go(now.current + 1, 'tick');
      }
      await c.sleep(600);
      if (Date.now() < hold.current) continue;
      go(nextStop(now.current), 'tour');
      await c.sleep(1500);
    }
  }, ready && playing);

  const shown = ready ? ROWS : risen;
  const lit = (at: number) => here.t >= at && here.t < at + LIT;
  const playFrom = (at: number) => seek(at, 'seek');
  return (
    <div ref={box} className="lp-nw">
      <div className="lp-nw-band">
        <div className="lp-nw-head">
          <h3 className="lp-nw-title">{HEAD.title}</h3>
          <div className="lp-nw-acts">
            <State ready={ready} reduce={reduce} />
            <span className={cn(buttonClass({ size: 'sm' }), 'lp-nw-share')} aria-hidden="true"><Icon name="link" size={16} />Share</span>
          </div>
          <div className="lp-nw-meta">
            <span className="lp-nw-who"><Faces people={HEAD.people.map((id) => CAST[id])} size={22} /><span className="lp-nw-when">{HEAD.when}</span></span>
            <SealedBadge inline title={HEAD.sealed} />
          </div>
        </div>
        <CallLine here={here} playing={playing} reduce={reduce} onToggle={() => setPressed(!playing)} onSeek={seek} />
      </div>

      <div className="lp-nw-body">
        <div className="lp-nw-main">
          <p className={cn('lp-nw-sum', !(begun || reduce) && 'is-held')}><Words text={SUMMARY} /></p>
          <div className="lp-nw-list">
            <h4 className="lp-nw-k is-decide"><Icon name="decision" size={16} />Decided<span className="n">{DECIDED.length}</span></h4>
            {DECIDED.map((d, i) => {
              const by = d.confirmedBy ?? (mine[i] ? 'you' : null);
              return (
                <div key={d.at} className={cn('lp-nw-row', i >= shown && 'is-out', lit(d.at) && 'is-lit')} inert={i >= shown}>
                  <span className="lp-nw-ic"><Icon name="decision" size={13} /></span>
                  <span className="lp-nw-t">{d.text}<small>Proposed by {d.proposer}{by && ` · confirmed by ${by}`}</small></span>
                  <Moment at={d.at} onPlay={playFrom} />
                  <span className="lp-nw-end">
                    {by ? <span className="lp-nw-done"><Icon name="check" size={14} />Confirmed</span>
                      : <Button size="xs" onClick={() => setMine((m) => m.map((v, j) => v || j === i))}>Confirm</Button>}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="lp-nw-list">
            <h4 className="lp-nw-k is-follow"><Icon name="todos" size={16} />Follow-ups<span className="n">{FOLLOW_UPS.length}</span></h4>
            {FOLLOW_UPS.map((f, j) => {
              const i = DECIDED.length + j;
              const on = done[j] ?? f.done;
              return (
                <div key={f.at} className={cn('lp-nw-row', i >= shown && 'is-out', lit(f.at) && 'is-lit', on && 'is-done')} inert={i >= shown}>
                  <Check checked={on} onChange={(v) => setDone((d) => d.map((was, k) => (k === j ? v : was)))} label={`Done: ${f.text}`} />
                  <span className="lp-nw-t"><span>{f.text}</span></span>
                  <Moment at={f.at} onPlay={playFrom} />
                  <span className="lp-nw-end"><Avatar person={CAST[f.who]} size={20} />{nameOf(f.who)} · {f.due}</span>
                </div>
              );
            })}
          </div>
        </div>
        <Transcript current={lineAt(here.t)} reduce={reduce} onLine={(i) => { const l = SAID[i]; if (l) playFrom(l.at); }} />
      </div>
    </div>
  );
}

/** Whether the notes are still being written, or ready. */
function State({ ready, reduce }: { ready: boolean; reduce: boolean }) {
  return (
    <span className="lp-nw-state">
      <motion.span key={ready ? 'ready' : 'writing'} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE.out }}>
        {ready ? <><Icon name="circleCheck" size={14} />Ready</> : <><Dots />Being written</>}
      </motion.span>
    </span>
  );
}

/** A moment as a chip that plays from there. */
function Moment({ at, onPlay }: { at: number; onPlay: (at: number) => void }) {
  return (
    <button type="button" className="ac-time-chip lp-nw-mc" aria-label={`Play from ${position(at)}`} title={`Play from ${position(at)}`} onClick={() => onPlay(at)}>
      <Icon name="moment" size={13} />{position(at)}
    </button>
  );
}

/** The light under the line where people spoke. It never changes, so it's drawn once. */
const Glints = memo(function Glints() {
  return (
    <div className="lp-nw-said" aria-hidden="true">
      {GLINTS.map((g, i) => <i key={i} style={{ left: `${g.x.toFixed(1)}%`, top: 4 + g.row * 8, width: Math.round(g.width), '--o': g.o.toFixed(2), '--far': `${g.row * 28}%` }} />)}
    </div>
  );
});

/**
 * The call along the band's horizon: Play and the time, then the line with its chapters, decisions and follow-ups, the sun
 * where the recording is and the light under it. The line is a slider: a press goes there (to a mark's own moment, when
 * it's on one) and the arrow keys go back and on 30 seconds.
 */
function CallLine({ here, playing, reduce, onToggle, onSeek }: { here: Here; playing: boolean; reduce: boolean; onToggle: () => void; onSeek: (t: number, glide: Glide) => void }) {
  const press = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const x = e.clientX - r.left;
    const mark = MARKS.find((m) => Math.abs((m.at / LENGTH) * r.width - x) <= 8);
    onSeek(mark ? mark.at : clamp(x / r.width, 0, 1) * LENGTH, 'seek');
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? here.t + 30
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? here.t - 30
        : e.key === 'Home' ? 0 : e.key === 'End' ? LENGTH : undefined;
    if (to === undefined) return;
    e.preventDefault();
    onSeek(to, 'step');
  };
  return (
    <div className="lp-nw-hz">
      <div className="lp-nw-line">
        <button type="button" className="lp-nw-play" aria-label={playing ? 'Pause the recording' : 'Play the recording'} title={playing ? 'Pause' : 'Play'} onClick={onToggle}>
          <Icon name={playing ? 'pause' : 'play'} size={14} />
        </button>
        <span className="lp-nw-time">{position(here.t)} <span>/ {position(LENGTH)}</span></span>
        <div className="lp-nw-track">
          <div className="lp-nw-up" aria-hidden="true">
            <motion.div className="lp-nw-path" initial={false} animate={{ x: pct(here.pin) }} transition={reduce ? GLIDES.jump : GLIDES[here.glide]}><i className="lp-nw-sun" /></motion.div>
          </div>
          {CHAPTERS.map((c, i) => (
            <span key={c.at} className="lp-nw-ch" style={{ left: pct(c.at), '--room': pct((CHAPTERS[i + 1]?.at ?? LENGTH) - c.at) }}>{c.title}</span>
          ))}
          {MARKS.map((m) => <i key={`${m.kind}-${m.at}`} className={cn('lp-nw-mark', `is-${m.kind}`)} style={{ left: pct(m.at) }} aria-hidden="true" />)}
          <Glints />
          <div className="lp-nw-seek" role="slider" tabIndex={0} aria-label="Where the recording is" aria-valuemin={0} aria-valuemax={LENGTH}
            aria-valuenow={here.t} aria-valuetext={`${position(here.t)} of ${position(LENGTH)}`} onClick={press} onKeyDown={keys} />
        </div>
      </div>
    </div>
  );
}

/** What was said, with the word the transcript isn't sure of dotted. */
function Spoken({ line }: { line: Said }) {
  const word = line.unsure;
  const i = word ? line.text.indexOf(word) : -1;
  if (!word || i < 0) return <>{line.text}</>;
  return <>{line.text.slice(0, i)}<Unsure of="words">{word}</Unsure>{line.text.slice(i + word.length)}</>;
}

/**
 * The transcript, following the recording: the line being said is lit and kept near the top. Focusing something in a
 * line (a word it isn't sure of) plays from that line, so what has focus is always in view.
 */
function Transcript({ current, reduce, onLine }: { current: number; reduce: boolean; onLine: (i: number) => void }) {
  const view = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const at = useRef(current);
  const placed = useRef(false);

  /** How far the list moves up to keep line `i` near the top, without running past its end. */
  const offset = useCallback((i: number) => {
    const v = view.current, l = list.current;
    const line = l?.children.item(i);
    if (!v || !l || !(line instanceof HTMLElement)) return 0;
    return clamp(line.offsetTop - LEAD, 0, Math.max(0, l.offsetHeight - v.clientHeight));
  }, []);

  useLayoutEffect(() => {
    at.current = current;
    const l = list.current;
    if (!l) return undefined;
    const glide = placed.current && !reduce;
    placed.current = true;
    const c = animate(l, { y: -offset(current) }, glide ? { duration: 0.8, ease: EASE.inOut } : { duration: 0 });
    return () => c.stop();
  }, [current, reduce, offset]);

  /* When the column changes size, the lines wrap differently: the one being said is put back in place. */
  useEffect(() => {
    const v = view.current, l = list.current;
    if (!v || !l) return undefined;
    let size = '';
    const ro = new ResizeObserver(() => {
      const next = `${l.offsetWidth}:${l.offsetHeight}:${v.clientHeight}`;
      if (next === size) return;
      size = next;
      void animate(l, { y: -offset(at.current) }, { duration: 0 });
    });
    ro.observe(v);
    ro.observe(l);
    return () => ro.disconnect();
  }, [offset]);

  const focus = (e: FocusEvent<HTMLDivElement>) => {
    const l = list.current;
    const line = e.target instanceof Element ? e.target.closest('.nd-l') : null;
    if (!l || !line) return;
    const i = Array.from(l.children).indexOf(line);
    if (i >= 0 && i !== current) onLine(i);
  };

  return (
    <aside className="lp-nw-side" aria-label="Transcript">
      <h4>Transcript <small>Follows the recording</small></h4>
      <div ref={view} className="lp-nw-tx">
        <div ref={list} className="lp-nw-tx-in" onFocus={focus}>
          {SAID.map((l, i) => (
            <TranscriptLine key={l.at} time={null} person={CAST[l.who]} className={cn(i === current && 'is-now')}
              name={<>{nameOf(l.who)}<span className="lp-nw-at">{position(l.at)}</span></>}>
              <Spoken line={l} />
            </TranscriptLine>
          ))}
        </div>
      </div>
      <div className="lp-nw-ask"><Icon name="ask" size={17} /><span>Ask about this call</span><Chip icon="lock">Only you</Chip></div>
    </aside>
  );
}
