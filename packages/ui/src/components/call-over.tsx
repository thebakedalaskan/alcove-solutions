/*
 * The page a call leaves you on, on the call's own night: the welcome page's cove after dark (Horizon moment `after`, with
 * `Cove` seed 17 as its land). The logo once at the top and what the call runs on at the top right; then who was in the call
 * (or who's still in it) in their arches, the title, one line, the notes and the buttons, the first of them filled. It never
 * moves on by itself, and it's stateless: plain data in, and the app's own buttons.
 *
 * The page is always night (the stage), in both themes, and takes the window as the call and the join page do. On a phone (the
 * page under 600px wide) the words stand at the top and the buttons go across the foot.
 *
 * The land keeps 24px clear of the words, measured where they rest and drawn again when they or the window change size or the
 * fonts arrive, as the welcome page's sky does (`restingBox`, `useCoveFit`). It keeps one box for every state the page turns
 * through (as tall as the tallest, unless what's there now is taller still), so the land stays put while the notes are
 * written. The stars keep off the same box and off the top bar.
 *
 * What moves: arriving from the call (`entering`) the scene and the top fade in and the words, the notes and the buttons rise
 * in after them, in about a second; going on to Home or the notes (`leaving`) the page fades, from wherever its arrival had
 * got to. It says when each has played out (`onEntered`, `onGone`), so whatever waits on them waits on the animations
 * themselves. When `turn` changes the head and the notes rise in again, and the notes do whenever they change from one kind
 * to another. With reduced motion they're short fades. Otherwise only the scene's own slow life moves, and the dots while
 * the notes are written.
 */
import { useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { cn } from '../cn';
import { Logo } from './brand';
import { Cove, restingBox, useCoveFit, type CoveWords, type RestingBox } from './cove';
import { Horizon } from './horizon';
import { Icon } from './icon';
import { DURATION, Dots, EASE } from './motion';
import { Avatar, Faces, type AvatarPerson } from './people';
import { Unencrypted } from './primitives';

/**
 * The notes, as the page shows them: being written (the step they're on, who gets them and their faces), written (the
 * summary's first lines and what was decided and is to follow up), still being written after a long while, while the call
 * goes on without you (on, paused or off as you left it: you get them when it ends), or none taken.
 */
export type CallOverNotes =
  | { kind: 'writing'; step: string; who: string; faces: AvatarPerson[] }
  | { kind: 'ready'; summary: string; decided: number; followUps: number }
  | { kind: 'slow' }
  | { kind: 'going'; mode: 'on' | 'paused' | 'off' }
  | { kind: 'none' };

export interface CallOverProps {
  /** "Team standup has ended", "You left Team standup". */
  title: string;
  /** The one line under it: "20 min with Priya, Kofi and Maya", "Kofi is hosting until you’re back". */
  meta: string;
  /** Who stands on the page: who was in the call, or who's still in it. */
  people: AvatarPerson[];
  /** While the call goes on: how long it's run, ticking ("19:42"), beside the line with a small live dot. */
  clock?: string | undefined;
  notes?: CallOverNotes | undefined;
  /** False: the notes say an unencrypted AI model writes them, with the `Unencrypted` badge. */
  modelPrivate: boolean;
  /** What the call runs on, at the top right after a sealed icon: "Confidential compute · verified". The icon alone on a phone. */
  trust: string;
  /** The buttons (`Button`s), the first one `primary`: in a row, or across the foot on a phone. */
  actions?: ReactNode;
  /**
   * A key for what the page says: when it changes, the head (people, title, line) and the notes rise in again, and the keys
   * land on the title (as they do when the page first shows), so what happened is read first and Tab goes on to the buttons.
   */
  turn?: string | undefined;
  /** Arriving from the call: the scene and the top fade in, then the head, the notes and the buttons rise in. */
  entering?: boolean | undefined;
  /** Going on to Home or the notes: the page fades out. */
  leaving?: boolean | undefined;
  /**
   * Once the arrival (`entering`) has played out, however long the stylesheet makes it: at once with nothing to play. Not
   * called when the page starts going (`leaving`) first: then only `onGone` comes.
   */
  onEntered?: (() => void) | undefined;
  /** Once the page has faded out (`leaving`), whether or not its arrival had finished. */
  onGone?: (() => void) | undefined;
}

/** Under this width the page is a phone's: one column, the buttons across the foot. */
const PHONE_W = 600;
/** Which cove: the welcome page's, another seed. */
const SEED = 17;
/** Where the horizon falls, as a share of the page's height. */
const LINE = 0.84;
const LINE_PHONE = 0.82;
/**
 * How much room the words are kept, whatever they hold now: the land and the stars keep off a box this tall, so they don't move
 * as the page turns. Centred on the column on a wide page; from the top of the words on a phone, where the buttons are on the sea.
 */
const KEEP = 480;
const KEEP_PHONE = 466;
/** Stars keep this far from the words. */
const STAR_CLEAR = 30;
/** At most this many arches in the row, the last a count of the rest. */
const MOST = 8;
const MOST_PHONE = 5;

/** What the land and the stars keep off, in the page's px: the words' box, and the top bar's words. */
interface Land { width: number; height: number; line: number; phone: boolean; box: RestingBox; top: CoveWords[] }

const sameBox = (a: RestingBox, b: RestingBox) => a.l === b.l && a.r === b.r && a.t === b.t && a.b === b.b;
const sameLand = (a: Land | null, b: Land) => a !== null && a.width === b.width && a.height === b.height && a.line === b.line && a.phone === b.phone &&
  sameBox(a.box, b.box) && a.top.length === b.top.length && a.top.every((w, i) => { const v = b.top[i]; return v !== undefined && v.l === w.l && v.r === w.r && v.b === w.b; });

/* What changed rises in again as the arrival's words do, or fades in with reduced motion: in ms, for the Web Animations API. */
const RISE: Keyframe[] = [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }];
const FADE: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const RISE_MS = DURATION['page-2'] * 1000;
const FADE_MS = DURATION[2] * 1000;
const RISE_EASE = `cubic-bezier(${EASE.out.join(', ')})`;

/** What's playing on these elements now: each one's own, not what's inside it, so the scene's endless life isn't waited on. */
const playing = (els: readonly (HTMLElement | null)[]): Animation[] => els.flatMap((el) => el?.getAnimations() ?? []);
/** Settles once all of these have finished or been cancelled. */
const playedOut = (anims: readonly Animation[]): Promise<unknown> => Promise.allSettled(anims.map((a) => a.finished));

export function CallOver({ title, meta, people, clock, notes, modelPrivate, trust, actions, turn, entering = false, leaving = false, onEntered, onGone }: CallOverProps): ReactElement {
  const page = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLElement>(null);
  const col = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const said = useRef<HTMLDivElement>(null);
  const acts = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const [land, setLand] = useState<Land | null>(null);
  const told = useRef({ onEntered, onGone });
  useLayoutEffect(() => { told.current = { onEntered, onGone }; });

  /*
   * The page says when its arrival and its going have played out, from the animations themselves (the parts the arrival moves,
   * then the page's own fade), so nothing waits on a copy of how long the stylesheet makes them. Once the page is going, its
   * arrival isn't waited on: `onEntered` doesn't come, and `onGone` waits only on the fade that takes the page away, not on
   * the arrival's own, which plays on under it.
   */
  const arrival = useRef<readonly Animation[]>([]);
  useLayoutEffect(() => {
    if (!entering || leaving) return undefined;
    let live = true;
    arrival.current = playing([page.current, scene.current, top.current, head.current, said.current, acts.current]);
    void playedOut(arrival.current).then(() => { if (live) told.current.onEntered?.(); });
    return () => { live = false; };
  }, [entering, leaving]);
  useLayoutEffect(() => {
    if (!leaving) return undefined;
    let live = true;
    void playedOut(playing([page.current]).filter((a) => !arrival.current.includes(a))).then(() => { if (live) told.current.onGone?.(); });
    return () => { live = false; };
  }, [leaving]);

  /* The keys land on the title as the page shows and whenever it turns. It's only somewhere to start from, so it wears no ring. */
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [turn]);

  /*
   * The scene is drawn as the page is first laid out, before it shows, and again a moment after the window changes size, the
   * fonts arrive or the words outgrow the room they're kept.
   */
  useCoveFit(() => {
    const el = page.current;
    if (!el) return null;
    return () => {
      const watch = [el, col.current, words.current, top.current];
      const width = el.clientWidth;
      const height = el.clientHeight;
      const phone = width < PHONE_W;
      const line = Math.round(height * (phone ? LINE_PHONE : LINE));
      const held = phone ? words.current : col.current;
      const at = held ? restingBox(held, el) : null;
      if (!at || width === 0 || height === 0) return watch;
      const mid = (at.t + at.b) / 2;
      const box: RestingBox = phone
        ? { l: at.l, r: at.r, t: at.t, b: Math.max(at.b, at.t + KEEP_PHONE) }
        : { l: at.l, r: at.r, t: Math.min(at.t, Math.round(mid - KEEP / 2)), b: Math.max(at.b, Math.round(mid + KEEP / 2)) };
      const above = Array.from(top.current?.querySelectorAll(':scope > .co-logo, :scope > .co-trust') ?? []).flatMap((c) => {
        const b = c instanceof HTMLElement ? restingBox(c, el) : null;
        return b && b.r > b.l ? [{ l: b.l, r: b.r, b: b.b }] : [];
      });
      const next: Land = { width, height, line, phone, box, top: above };
      setLand((was) => (sameLand(was, next) ? was : next));
      return watch;
    };
  }, []);

  /* What changed rises in again: the head and the notes when the page turns, the notes alone when they change kind. */
  const kind = notes?.kind;
  const was = useRef({ turn, kind });
  useLayoutEffect(() => {
    const before = was.current;
    was.current = { turn, kind };
    const turned = before.turn !== turn;
    if (!turned && before.kind === kind) return;
    const rise = (el: HTMLElement | null, delay: number) => {
      el?.animate(reduce ? FADE : RISE, { duration: reduce ? FADE_MS : RISE_MS, delay: reduce ? 0 : delay, easing: RISE_EASE, fill: 'backwards' });
    };
    if (turned) rise(head.current, 0);
    rise(said.current, turned ? 90 : 0);
  }, [turn, kind, reduce]);

  const cove = useMemo(() => land && (
    <Cove width={land.width} line={land.line} foot={land.height} words={[{ l: land.box.l, r: land.box.r, b: land.box.b }, ...land.top]} seed={SEED} />
  ), [land]);

  const vars: CSSProperties | undefined = land ? {
    '--hz': `${land.line}px`,
    '--co-wl': `${land.box.l - STAR_CLEAR}px`, '--co-wr': `${land.box.r + STAR_CLEAR}px`,
    '--co-wt': `${land.box.t - STAR_CLEAR}px`, '--co-wb': `${land.box.b + STAR_CLEAR}px`
  } : undefined;

  const more = people.length > MOST ? people.length - (MOST - 1) : 0;
  const morePhone = people.length > MOST_PHONE ? people.length - (MOST_PHONE - 1) : 0;
  const shown = people.slice(0, more ? MOST - 1 : MOST);

  return (
    <div ref={page} className={cn('co stage', entering && 'is-entering', leaving && 'is-leaving')} style={vars}>
      <div ref={scene} className="co-scene" aria-hidden="true"><Horizon moment="after" land={cove} /></div>
      <header ref={top} className="co-top">
        <span className="co-top-l" />
        <Logo size={28} className="co-logo" />
        <span className="co-trust" title={trust}><Icon name="sealed" size={15} /><span className="co-trust-t">{trust}</span></span>
      </header>
      <div className="co-in">
        <div ref={col} className="co-col">
          <div ref={words} className="co-words">
            <div ref={head} className="co-head">
              {people.length > 0 && (
                <div className="co-people" aria-hidden="true">
                  {shown.map((p, i) => (
                    <Avatar key={`${p.email ?? p.name}-${i}`} person={p} size={54} style={{ '--size': 'var(--co-face)' }}
                      className={cn(morePhone > 0 && i >= MOST_PHONE - 1 && 'is-wide')} />
                  ))}
                  {more > 0 && <span className="co-more is-wide">+{more}</span>}
                  {morePhone > 0 && <span className="co-more is-phone">+{morePhone}</span>}
                </div>
              )}
              <h1 ref={heading} className="co-t" tabIndex={-1}>{title}</h1>
              <p className="co-m">
                <span>{meta}</span>
                {clock && <span className="co-clock"><i aria-hidden="true" />{clock}</span>}
              </p>
            </div>
            {notes && <div ref={said} className="co-notes"><Said notes={notes} modelPrivate={modelPrivate} /></div>}
          </div>
          {actions && <div ref={acts} className="co-acts">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/** The notes of a call that goes on without you, as they were when you left: whoever gets them gets them when it ends. */
const GOING = {
  on: 'Notes are on. You get them when it ends.',
  paused: 'Notes are paused. You get what was written when it ends.',
  off: 'Notes are off. You get what was written when it ends.'
} as const;

/** The notes as the page says them. */
function Said({ notes, modelPrivate }: { notes: CallOverNotes; modelPrivate: boolean }) {
  const sealed = modelPrivate ? 'sealed' : 'shieldOff';
  switch (notes.kind) {
    case 'writing':
      return (
        <section className="co-panel" aria-label="The notes">
          <div className="co-nh">
            <span className="co-ni"><Icon name={sealed} size={17} /></span>
            <span className="co-nt"><b>Notes are being written</b><small>{modelPrivate ? 'In confidential compute' : <>By an unencrypted AI model<Unencrypted compact /></>}</small></span>
          </div>
          <p className="co-step" role="status"><Dots />{notes.step}</p>
          {(notes.who || notes.faces.length > 0) && (
            <div className="co-who">{notes.faces.length > 0 && <Faces people={notes.faces} size={22} max={4} />}<span>{notes.who}</span></div>
          )}
        </section>
      );
    case 'ready':
      return (
        <section className="co-panel is-ready" aria-label="The notes">
          <div className="co-nh">
            <span className="co-ni"><Icon name={sealed} size={17} /></span>
            <span className="co-nt"><b>The notes are ready</b><small>{modelPrivate ? 'Written in confidential compute' : <>Written by an unencrypted AI model<Unencrypted compact /></>}</small></span>
          </div>
          <p className="co-sum">{notes.summary}</p>
          {(notes.decided > 0 || notes.followUps > 0) && (
            <div className="co-chips">
              {notes.decided > 0 && <span className="co-chip is-rose"><Icon name="circleCheck" size={14} />{notes.decided} decided</span>}
              {notes.followUps > 0 && <span className="co-chip is-horizon"><Icon name="listChecks" size={14} />{notes.followUps} {notes.followUps === 1 ? 'follow-up' : 'follow-ups'}</span>}
            </div>
          )}
        </section>
      );
    case 'slow':
      return (
        <section className="co-panel" aria-label="The notes">
          <div className="co-nh">
            <span className="co-ni"><Icon name="clock" size={17} /></span>
            <span className="co-nt"><b>Still being written{!modelPrivate && <Unencrypted compact />}</b><small>They’ll be in Notes when they’re ready. You don’t need to wait here.</small></span>
          </div>
        </section>
      );
    case 'going':
      return (
        <p className="co-line">
          {notes.mode === 'on' ? <i className="co-rec" aria-hidden="true" /> : notes.mode === 'paused' ? <Icon name="pause" size={15} /> : null}
          {GOING[notes.mode]}{!modelPrivate && <Unencrypted compact />}
        </p>
      );
    case 'none':
      return <p className="co-line">No notes were taken.</p>;
  }
}
