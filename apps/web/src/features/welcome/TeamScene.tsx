/*
 * Find a time: the team stands on the horizon with the sun low just past the end of the line, and their week is on the
 * water. Press people and they step up; the week gives each of them a lane with when they're busy (never what), and
 * where everyone is free. Pick a free time, and Schedule. The first time the week comes on screen a pointer plays it once:
 * three people step up, the free times appear, it picks Thursday at 15:00 and schedules. Touching anything stops it, and
 * from then on it's yours. With reduced motion it's the picture just before Schedule. What the pointer does is shown, not
 * said: only scheduling it yourself moves focus to what took Schedule's place, which is where it's read out.
 */
import { Avatar, Button, CheckDraw, EASE, Faces, GhostArch, Icon, Segmented, Switch, cn, useSceneLoop, type Choice } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CAST, firstOf } from '~/features/notes/cast';
import { Sky } from './Sky';
import { CLOSES, DAYS, LINE, OPENS, busyOn, clock, freeOn, type Member, type Span } from './week';

type Length = '30' | '45' | '60';
const LENGTHS: Choice<Length>[] = [{ value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '1 h' }];
const MINUTES: Record<Length, number> = { '30': 30, '45': 45, '60': 60 };
const HOURS = Array.from({ length: CLOSES - OPENS }, (_, i) => OPENS + i);
/** A free time of an hour or more has room to say its whole span; a shorter one says when it starts. */
const bandLabel = ([a, b]: Span) => (b - a >= 1 ? `${clock(a)}–${clock(b)}` : clock(a));

/** The call being planned. `people` are who you've picked; you're always in. */
interface Plan { people: Member[]; length: Length; at: { day: number; from: number } | null; notes: boolean; booked: boolean }
const everyoneIn = (p: Plan): Member[] => ['art', ...p.people];
const freeIn = (p: Plan): Span[][] => DAYS.map((_, day) => (p.people.length ? freeOn(everyoneIn(p), day, MINUTES[p.length]) : []));
/** Drops a picked time that no longer fits who's coming or how long it is. */
function settle(p: Plan): Plan {
  const at = p.at;
  if (!at) return p;
  const end = at.from + MINUTES[p.length] / 60;
  return (freeIn(p)[at.day] ?? []).some(([a, b]) => at.from >= a && end <= b) ? p : { ...p, at: null, booked: false };
}

/** What the pointer picks: Priya, Kofi and Aiko, then Thursday at 15:00. */
const PICKS: readonly Member[] = ['priya', 'kofi', 'aiko'];
const PICK_AT = { day: 3, from: 15 };
const STILL: Plan = { people: [...PICKS], length: '45', at: PICK_AT, notes: true, booked: false };
const START: Plan = { ...STILL, people: [], at: null };

/** The pointer that plays the week once: where it is in the window, whether it glides there, and how many times it has pressed. */
interface Pointer { x: number; y: number; on: boolean; glide: boolean; taps: number }

export function TeamScene({ head, children }: { head: ReactNode; children?: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  const [plan, setPlan] = useState<Plan>(() => (reduce ? STILL : START));
  const [demo, setDemo] = useState(!reduce);
  const [pointer, setPointer] = useState<Pointer>({ x: 0, y: 0, on: false, glide: false, taps: 0 });
  const win = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLButtonElement>(null);

  const stop = () => setDemo(false);
  const change = (next: (p: Plan) => Plan) => {
    stop();
    setPlan((p) => settle({ ...next(p), booked: false }));
  };

  useSceneLoop(win, async (c) => {
    const point = (el: Element, glide: boolean, on: boolean, dx = 0, dy = 0) => {
      const box = win.current;
      if (!box) return;
      const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
      setPointer((p) => ({ ...p, x: a.left - b.left + Math.min(40, a.width / 2) + dx, y: a.top - b.top + a.height / 2 + dy, on, glide }));
    };
    const press = () => setPointer((p) => ({ ...p, taps: p.taps + 1 }));
    await c.sleep(700);
    for (const who of PICKS) {
      setPlan((p) => settle({ ...p, people: [...p.people, who] }));
      await c.sleep(800);
    }
    const band = win.current?.querySelector(`[data-band="${PICK_AT.day}-${PICK_AT.from}"]`);
    if (!band) { stop(); return; }
    point(band, false, false, 120, 130);
    await c.sleep(80);
    point(band, true, true);
    await c.sleep(950);
    press();
    setPlan((p) => settle({ ...p, at: PICK_AT }));
    await c.sleep(1100);
    if (!go.current) { stop(); return; }
    point(go.current, true, true);
    await c.sleep(950);
    press();
    setPlan((p) => ({ ...p, booked: true }));
    await c.sleep(900);
    setPointer((p) => ({ ...p, on: false }));
    await c.sleep(400);
    stop();
  }, demo);

  return (
    <Sky moment="team" id="time" className="lp-team" sky={(
      <div className="lp-wrap lp-team-up">
        {head}
        <Line people={plan.people} onTouch={stop}
          onToggle={(who) => change((p) => ({ ...p, people: p.people.includes(who) ? p.people.filter((x) => x !== who) : [...p.people, who] }))} />
      </div>
    )}>
      <div className="lp-wrap lp-team-water">
        <Week plan={plan} box={win} go={go} pointer={demo ? pointer : null} onTouch={stop}
          onPick={(day, from) => change((p) => ({ ...p, at: { day, from } }))}
          onLength={(length) => change((p) => ({ ...p, length }))}
          onNotes={(notes) => change((p) => ({ ...p, notes }))}
          onBook={() => { stop(); setPlan((p) => ({ ...p, booked: true })); }} />
      </div>
      {children}
    </Sky>
  );
}

/** The team on the horizon, feet on the line and names on the water. You're always in; the people invited haven't joined yet. */
function Line({ people, onToggle, onTouch }: { people: readonly Member[]; onToggle: (who: Member) => void; onTouch: () => void }) {
  const reduce = useReducedMotion() ?? false;
  const line = useRef<HTMLDivElement>(null);
  /* The low sun stands just past the left end of the line, wherever the line starts at this width; where the line runs
     nearly to the edge, the sun goes down past it. */
  useLayoutEffect(() => {
    const el = line.current;
    const sky = el?.closest<HTMLElement>('.lp-sky');
    if (!el || !sky) return undefined;
    const place = () => {
      const first = Array.from(el.children).find((p) => p instanceof HTMLElement && p.offsetParent !== null);
      if (!first) return;
      const r = first.getBoundingClientRect(), s = sky.getBoundingClientRect();
      sky.style.setProperty('--lp-sun-at', `${Math.round(Math.max(r.left - (s.left + s.width / 2) - 54, -s.width / 2))}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    ro.observe(sky);
    return () => ro.disconnect();
  }, []);
  const tick = (on: boolean) => <span className="ck" aria-hidden="true"><CheckDraw done={on} size={12} duration={reduce ? 0 : 0.36} /></span>;
  return (
    <div ref={line} className="lp-team-line" role="group" aria-label="Who to meet" onClickCapture={onTouch}>
      {LINE.map((p) => {
        if (p.kind === 'invited') {
          return <span key={p.name} className="lp-team-p is-far"><GhostArch size={56} initial={p.name} /><span className="nm">{p.name}, invited</span></span>;
        }
        if (p.id === 'art') return <span key={p.id} className="lp-team-p is-on"><Avatar person={CAST.art} size={56} />{tick(true)}<span className="nm">You</span></span>;
        const on = people.includes(p.id);
        return (
          <button key={p.id} type="button" className={cn('lp-team-p', on && 'is-on', p.far && 'is-far')} aria-pressed={on} aria-label={firstOf(p.id)} onClick={() => onToggle(p.id)}>
            <Avatar person={CAST[p.id]} size={56} />{tick(on)}<span className="nm" aria-hidden="true">{firstOf(p.id)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The week on the water: a lane for each person in every day, the times everyone is free, and the new call beside it. */
function Week({ plan, box, go, pointer, onPick, onLength, onNotes, onBook, onTouch }: {
  plan: Plan; box: RefObject<HTMLDivElement | null>; go: RefObject<HTMLButtonElement | null>;
  /** The pointer while it plays the week, or null once it's yours. */
  pointer: Pointer | null;
  onPick: (day: number, from: number) => void; onLength: (l: Length) => void; onNotes: (on: boolean) => void; onBook: () => void; onTouch: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const done = useRef<HTMLDivElement>(null);
  /** Whether you pressed Schedule, rather than the pointer playing the week. */
  const pressed = useRef(false);
  /* Scheduling takes away the button you pressed: focus moves to what took its place, not the page. */
  useEffect(() => {
    if (!plan.booked || !pressed.current) return;
    pressed.current = false;
    done.current?.focus({ preventScroll: true });
  }, [plan.booked]);
  const everyone = everyoneIn(plan);
  const people = everyone.map((who) => CAST[who]);
  const free = freeIn(plan);
  const at = plan.at;
  const day = at ? DAYS[at.day] : undefined;
  const when = everyone.length < 2 ? 'Pick who to meet'
    : at && day ? `${day.day} ${day.date} · ${clock(at.from)}–${clock(at.from + MINUTES[plan.length] / 60)}`
      : free.some((f) => f.length) ? 'Pick a free time' : 'No time this week fits everyone';
  const glide = { duration: 0.85, ease: EASE.inOut };
  return (
    <div ref={box} className="lp-wk" onClickCapture={onTouch}>
      <div className="lp-wk-main">
        <div className="lp-wk-head">
          <h3>Find a time</h3>
          <Faces people={people} size={26} max={7} />
          <div className="end">
            <Segmented value={plan.length} onChange={onLength} options={LENGTHS} label="How long" />
            <span className="lp-wk-wk"><Icon name="cal" size={16} />9–13 Nov</span>
          </div>
        </div>
        <div className="lp-wk-grid" style={{ '--rows': HOURS.length }}>
          <span />
          {DAYS.map((d) => <div key={d.day} className="lp-wk-dh">{d.day}<small>{d.date}</small></div>)}
          <div className="lp-wk-hours" aria-hidden="true">{HOURS.map((h) => <span key={h} style={{ '--at': h - OPENS }}>{clock(h)}</span>)}</div>
          {DAYS.map((d, i) => (
            <div key={d.day} className="lp-wk-day">
              <div className="lp-wk-lanes" aria-hidden="true">
                <AnimatePresence initial={false}>
                  {everyone.map((who) => (
                    <motion.div key={who} className="lp-wk-lane" initial={{ flexGrow: 0, opacity: 0 }} animate={{ flexGrow: 1, opacity: 1 }} exit={{ flexGrow: 0, opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.5, ease: EASE.inOut }}>
                      {busyOn(who, i).map(([a, b]) => <i key={a} className="lp-wk-busy" style={{ '--at': a - OPENS, '--for': b - a }} />)}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <AnimatePresence initial={false}>
                {(free[i] ?? []).map(([a, b]) => (
                  <motion.button key={`${a}-${b}`} type="button" className="lp-wk-free" data-band={`${i}-${a}`} style={{ '--at': a - OPENS, '--for': b - a }}
                    aria-pressed={at?.day === i && at.from >= a && at.from < b} aria-label={`${d.day} ${d.date}, everyone’s free ${clock(a)} to ${clock(b)}`}
                    initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: reduce ? 0 : 0.45, ease: EASE.out }} onClick={() => onPick(i, a)}>
                    <span className="full">{bandLabel([a, b])}</span>
                    <span className="short">{clock(a)}</span>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          ))}
        </div>
        <div className="lp-wk-key"><span><i className="is-busy" />Busy</span><span><i className="is-free" />Everyone’s free</span><span>Times in London</span></div>
      </div>
      <div className="lp-wk-side">
        <span className="lbl">New call</span>
        <div className={cn('lp-wk-call', !at && 'is-wait')}>
          <h4>Launch review</h4>
          <div className="lp-wk-when"><Icon name="calClock" size={17} /><span>{when}</span></div>
          <div className="lp-wk-who"><Faces people={people} size={26} max={5} /><span>{everyone.length === 1 ? 'Just you' : `${everyone.length} people`}</span></div>
        </div>
        <div className="lp-wk-sw"><span>Write notes</span><Switch checked={plan.notes} onChange={onNotes} label="Write notes" /></div>
        <div className="lp-wk-act">
          {plan.booked ? (
            <motion.div ref={done} tabIndex={-1} className="lp-wk-done" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE.out }}>
              <Icon name="circleCheck" size={18} /><span>Scheduled. The invite goes out from your calendar.</span>
            </motion.div>
          ) : (
            <Button ref={go} variant="primary" className="lp-wk-go" disabled={!at || everyone.length < 2} onClick={() => { pressed.current = true; onBook(); }}>Schedule</Button>
          )}
        </div>
      </div>
      {pointer && (
        <motion.span className="lp-wk-cur" aria-hidden="true" initial={false} animate={{ x: pointer.x, y: pointer.y, opacity: pointer.on ? 1 : 0 }}
          transition={pointer.glide ? { x: glide, y: glide, opacity: { duration: 0.3 } } : { duration: 0 }}>
          <Icon name="pointer" size={22} />
          {pointer.taps > 0 && <motion.i key={pointer.taps} className="lp-wk-tap" initial={{ scale: 0.5, opacity: 0.9 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 0.5, ease: EASE.out }} />}
        </motion.span>
      )}
    </div>
  );
}
