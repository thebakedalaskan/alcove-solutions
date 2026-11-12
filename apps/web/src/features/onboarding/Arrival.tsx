/*
 * The account being created, after a first sign-in. One arch carries the moment: its outline draws
 * itself, dawn fills it from the horizon, the sun rises and the stars fade, while what came with the
 * account arrives a row at a time, each with a check. Then "You’re in" and the arch opens into Home,
 * which has been loading behind it. Skip, Escape or Enter goes straight to the opening; under reduced
 * motion the finished screen shows for a moment and Home follows without the opening.
 */
import { firstName, type Meeting, type CalendarEvent, type SignInProvider } from '@alcove/api';
import { Button, CheckDraw, Faces, Icon, ProviderMark, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { listNames } from '~/lib/people';
import { q } from '~/lib/queries';
import { daysFromToday, hm } from '~/lib/time';
import { arrival, useArrival } from './store';

/* GSAP-style curves for the sky, as cubic beziers. */
const E = {
  expoOut: [0.16, 1, 0.3, 1],
  inOut2: [0.45, 0, 0.55, 1],
  inOut3: [0.65, 0, 0.35, 1],
  out2: [0.5, 1, 0.89, 1],
  out3: [0.33, 1, 0.68, 1],
  in2: [0.55, 0, 1, 0.45],
  out1: [0.25, 0.46, 0.45, 0.94]
} as const;

const VIA: Record<SignInProvider, string> = { google: 'with Google', microsoft: 'with Microsoft', sso: 'with single sign-on' };

interface Row { id: string; icon: ReactNode; text: ReactNode; sub: string }

export function Arrival() {
  const { stage } = useArrival();
  return stage === 'none' ? null : <Creating />;
}

/** Calls and calendar meetings that haven't ended yet today, soonest first. */
function today(calls: Meeting[], events: CalendarEvent[], now: number) {
  return [...calls.map((m) => ({ title: m.title, startsAt: m.startsAt, endsAt: m.endsAt })), ...events.map((e) => ({ title: e.title, startsAt: e.startsAt, endsAt: e.endsAt }))]
    .filter((i) => daysFromToday(new Date(i.startsAt)) === 0 && new Date(i.endsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function useRows(): Row[] {
  const session = useQuery(q.session()).data;
  const calendar = useQuery(q.calendar());
  const upcoming = useQuery(q.upcoming());
  // The team isn't waited for (a Google work account's can take a few seconds to put together), and the rows are laid
  // out once: it's a row only when it was here as the screen went up.
  const teamNow = useQuery(q.team()).data ?? null;
  const [team] = useState(teamNow);
  if (!session) return [];
  const rows: Row[] = [];
  const domain = session.user.email.split('@')[1] ?? '';
  rows.push({
    id: 'who',
    icon: session.provider === 'sso' ? <Icon name="key" size={18} /> : <ProviderMark provider={session.provider} />,
    text: <>Signed in as <b>{session.user.name}</b></>,
    sub: session.provider === 'sso' ? `Through ${domain} single sign-on` : session.user.email
  });
  const cal = calendar.data;
  const connected = cal ? cal.source === 'sample' || (cal.source === 'google' && !cal.needsAccess) : false;
  if (connected && cal) {
    if (upcoming.data) {
      const items = today(upcoming.data, cal.events, Date.now());
      const next = items[0];
      rows.push({
        id: 'cal', icon: <Icon name="cal" size={18} />,
        text: <>Your calendar: <b>{items.length === 0 ? 'no more calls today' : `${items.length} ${items.length === 1 ? 'call' : 'calls'} today`}</b></>,
        sub: next ? `Next is ${next.title} at ${hm(next.startsAt)}` : 'Calls you schedule show up on Home'
      });
    } else {
      rows.push({ id: 'cal', icon: <Icon name="cal" size={18} />, text: <>Your calendar is <b>connected</b></>, sub: 'Its calls show up on Home' });
    }
  }
  // Every work address has a team, even before anyone at it is known: a team is worth a row once it has people.
  if (team && team.members.length > 0) {
    const on = team.members.filter((m) => m.onAlcove).map((m) => m.person);
    rows.push({
      id: 'team', icon: <Faces people={team.members.slice(0, 3).map((m) => m.person)} size={14} max={3} />,
      text: <>Your team at {team.name}: <b>{team.members.length + 1} people</b></>,
      sub: on.length ? `${listNames(on)} already ${on.length > 1 ? 'use' : 'uses'} Alcove` : 'Invite them from Team'
    });
  }
  rows.push({
    id: 'seal', icon: <Icon name="sealed" size={18} />,
    text: <>Notes are <b>written in confidential compute</b></>,
    sub: 'Only the people invited to a call get its notes'
  });
  return rows;
}

const frames = (ms: number) => new Promise<boolean>((resolve) => {
  const until = performance.now() + ms;
  const tick = () => { if (document.querySelector('.shell')) resolve(true); else if (performance.now() > until) resolve(false); else requestAnimationFrame(tick); };
  tick();
});

/** The arch's inside, as a path: an evenodd hole in the night when it opens. */
const archHole = (x: number, y: number, w: number, h: number) => {
  const r = w / 2;
  const f = (n: number) => n.toFixed(1);
  return `M${f(x)} ${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h)}H${f(x)}Z`;
};

function Creating() {
  const reduce = useReducedMotion() ?? false;
  const session = useQuery(q.session()).data;
  const rows = useRows();
  const id = useId().replace(/:/g, '');
  const [done, setDone] = useState(0);
  const [inside, setInside] = useState(false);
  const phase = useRef<'create' | 'reveal'>('create');
  const anims = useRef<AnimationPlaybackControls[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const el = {
    root: useRef<HTMLDivElement>(null), sky: useRef<HTMLDivElement>(null), glow: useRef<HTMLDivElement>(null), arch: useRef<HTMLDivElement>(null),
    svg: useRef<SVGSVGElement>(null), rim: useRef<SVGPathElement>(null), fill: useRef<SVGRectElement>(null), dawn: useRef<SVGRectElement>(null),
    stars: useRef<SVGGElement>(null), sun: useRef<SVGGElement>(null), refl: useRef<SVGGElement>(null),
    head: useRef<HTMLDivElement>(null), title: useRef<HTMLHeadingElement>(null), sub: useRef<HTMLParagraphElement>(null),
    list: useRef<HTMLUListElement>(null), skip: useRef<HTMLButtonElement>(null)
  };
  const n = rows.length;
  const first = session ? firstName(session.user.name) : '';

  const later = (s: number, f: () => void) => { timers.current.push(setTimeout(f, s * 1000)); };
  const run = (c: AnimationPlaybackControls) => { anims.current.push(c); return c; };
  const halt = () => { for (const a of anims.current) a.stop(); anims.current = []; for (const t of timers.current) clearTimeout(t); timers.current = []; };

  /** "You’re in", then the arch opens into Home. `fast` when skipped. */
  const finish = useCallback(async (fast: boolean) => {
    if (phase.current !== 'create') return;
    phase.current = 'reveal';
    halt();
    setDone(Number.MAX_SAFE_INTEGER);
    setInside(true);
    if (reduce) { arrival.open(); await frames(4000); arrival.done(); return; }
    const svg = el.svg.current;
    const sky = el.sky.current;
    if (!svg || !sky) { arrival.open(); arrival.done(); return; }
    const box = svg.getBoundingClientRect();
    const k = box.width / 196;
    const from = { x: box.left + 8 * k, y: box.top + 16 * k, w: 180 * k, h: 220 * k };
    const vw = innerWidth;
    const vh = innerHeight;
    const W = vw + 120;
    const to = { x: vw / 2 - W / 2, y: -W / 2 - 60, w: W, h: vh + W / 2 + 140 };
    const clip = (p: number) => {
      const x = from.x + (to.x - from.x) * p;
      const y = from.y + (to.y - from.y) * p;
      const w = from.w + (to.w - from.w) * p;
      const h = from.h + (to.h - from.h) * p;
      sky.style.clipPath = `path(evenodd, "M0 0H${vw}V${vh}H0Z ${archHole(x, y, w, h)}")`;
    };
    // Home starts coming in behind the night before the arch opens.
    arrival.open();
    const ready = await frames(4000);
    scrollTo(0, 0);
    const dur = fast ? 0.8 : 1.15;
    const lead = fast ? 0.1 : 0.2;
    const out = [el.head.current, el.list.current, el.skip.current];
    out.forEach((o, i) => { if (o) run(animate(o, { opacity: 0, y: 10 }, { duration: fast ? 0.2 : 0.32, delay: i * 0.04, ease: E.in2 })); });
    const sun = el.sun.current;
    if (sun) run(animate(1, 1.35, { duration: 0.5, ease: E.out2, onUpdate: (s) => sun.setAttribute('transform', `translate(98 178) scale(${s}) translate(-98 -178)`) }));
    if (el.rim.current) run(animate(el.rim.current, { opacity: 0 }, { duration: 0.3, delay: 0.1 }));
    if (el.glow.current) run(animate(el.glow.current, { opacity: 0 }, { duration: dur, delay: lead }));
    if (el.arch.current) run(animate(el.arch.current, { opacity: 0 }, { duration: fast ? 0.3 : 0.45, delay: lead, ease: E.inOut2 }));
    if (!ready) { arrival.done(); return; }
    clip(0);
    await run(animate(0, 1, { duration: dur, delay: lead, ease: E.inOut3, onUpdate: clip }));
    arrival.done();
  }, [reduce]);

  /* The sky, the rows and the title, in one timeline. */
  useLayoutEffect(() => {
    if (reduce) {
      setDone(Number.MAX_SAFE_INTEGER);
      setInside(true);
      later(1.4, () => void finish(false));
      return halt;
    }
    const rim = el.rim.current;
    const len = rim ? rim.getTotalLength() : 0;
    if (rim) { rim.style.strokeDasharray = `${len}`; rim.style.strokeDashoffset = `${len}`; }
    const root = el.root.current;
    if (root) run(animate(root, { opacity: [0, 1] }, { duration: 0.5, ease: E.out2 }));
    if (rim) run(animate(rim, { strokeDashoffset: 0 }, { duration: 1.3, delay: 0.1, ease: E.inOut2 }));
    [el.title.current, el.sub.current].forEach((t, i) => { if (t) run(animate(t, { opacity: [0, 1], y: [12, 0] }, { duration: 0.8, delay: 0.3 + i * 0.07, ease: E.expoOut })); });
    if (el.skip.current) run(animate(el.skip.current, { opacity: [0, 1] }, { duration: 0.6, delay: 0.8, ease: E.out2 }));
    const fill = el.fill.current;
    if (fill) run(animate(242, 0, { duration: 1.35, delay: 0.7, ease: E.inOut3, onUpdate: (y) => fill.setAttribute('y', String(y)) }));
    const stars = Array.from(el.stars.current?.querySelectorAll('circle') ?? []);
    const order = stars.map((s, i) => ({ s, k: (i * 5) % stars.length }));
    // Each value gets one animation at a time: a later one replaces it, so the stars dim on a timer.
    for (const { s, k } of order) run(animate(s, { opacity: [0, 0.55 + ((k * 37) % 45) / 100] }, { duration: 0.5, delay: 1 + k * 0.07, ease: E.out1 }));
    later(2.4, () => { for (const s of stars) run(animate(s, { opacity: 0.15 }, { duration: 1.2, ease: E.inOut2 })); });
    if (el.dawn.current) run(animate(el.dawn.current, { opacity: [0, 1] }, { duration: 1.6, delay: 1.5, ease: E.inOut2 }));
    const sun = el.sun.current;
    if (sun) run(animate(64, 0, { duration: 2.1, delay: 1.6, ease: E.out3, onUpdate: (y) => sun.setAttribute('transform', `translate(0 ${y})`) }));
    if (el.refl.current) run(animate(el.refl.current, { opacity: [0, 1] }, { duration: 1, delay: 2.5, ease: E.out2 }));
    if (el.glow.current) run(animate(el.glow.current, { opacity: [0, 1] }, { duration: 1.8, delay: 1.9, ease: E.out2 }));
    return halt;
    // The timeline is laid out once, when the screen goes up.
  }, []);

  /* Each row arrives in turn and gets its check; then the title says you're in. Rows are known by now. */
  useEffect(() => {
    if (reduce || phase.current !== 'create' || n === 0) return;
    const items = Array.from(el.list.current?.children ?? []);
    items.forEach((li, i) => {
      const at = 1.3 + i * 0.55;
      run(animate(li, { opacity: [0, 1], y: [12, 0] }, { duration: 0.7, delay: at, ease: E.expoOut }));
      later(at + 0.28, () => setDone((d) => Math.max(d, i + 1)));
    });
    const swap = Math.max(1.3 + (n - 1) * 0.55 + 0.67, 2.6);
    const title = el.title.current;
    later(swap, () => { if (title) run(animate(title, { opacity: 0, y: -6 }, { duration: 0.22, ease: E.in2 })); });
    later(swap + 0.23, () => {
      setInside(true);
      if (title) run(animate(title, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.5, ease: E.expoOut }));
    });
    later(swap + 0.88, () => void finish(false));
    // Once: the rows were fetched before this screen went up.
  }, []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); void finish(true); } };
    addEventListener('keydown', on);
    el.root.current?.focus({ preventScroll: true });
    return () => removeEventListener('keydown', on);
  }, [finish]);

  const hidden = reduce ? undefined : { opacity: 0 };
  return (
    <div ref={el.root} className="cr dark" role="dialog" aria-modal="true" aria-labelledby={`${id}t`} tabIndex={-1} style={hidden}>
      <div ref={el.sky} className="cr-sky"><div ref={el.glow} className="cr-glow" style={reduce ? { opacity: 1 } : undefined} /></div>
      <div className="cr-box">
        <div ref={el.arch} className="cr-arch" aria-hidden="true">
          <svg ref={el.svg} viewBox="0 0 196 242">
            <defs>
              <clipPath id={`${id}c`}><path d="M8 236V106A90 90 0 0 1 188 106V236Z" /></clipPath>
              <clipPath id={`${id}u`}><rect x="0" y="0" width="196" height="178" /></clipPath>
              <clipPath id={`${id}f`}><rect ref={el.fill} x="0" y={reduce ? 0 : 242} width="196" height="242" /></clipPath>
              <linearGradient id={`${id}n`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141148" /><stop offset="1" stopColor="#2A2373" /></linearGradient>
              <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1A1660" /><stop offset=".38" stopColor="#3B2EA6" /><stop offset=".62" stopColor="#C470A9" /><stop offset=".76" stopColor="#FFA06A" /></linearGradient>
              <radialGradient id={`${id}s`} cx=".42" cy=".38" r=".72"><stop offset="0" stopColor="#FFF6E0" /><stop offset=".5" stopColor="#FFD58A" /><stop offset="1" stopColor="#FFB547" /></radialGradient>
              <radialGradient id={`${id}g`}><stop offset="0" stopColor="#FFD58A" stopOpacity=".9" /><stop offset="1" stopColor="#FF9E5E" stopOpacity="0" /></radialGradient>
            </defs>
            <g clipPath={`url(#${id}c)`}>
              <g clipPath={`url(#${id}f)`}>
                <rect width="196" height="242" fill={`url(#${id}n)`} />
                <rect ref={el.dawn} width="196" height="242" fill={`url(#${id}d)`} style={reduce ? undefined : { opacity: 0 }} />
                <g ref={el.stars} fill="#fff" style={reduce ? { opacity: 0.15 } : undefined}>
                  {[[58, 78, 1.3], [98, 50, 1], [134, 84, 1.5], [154, 122, 1], [74, 124, 1], [116, 140, 1.2], [40, 150, 0.9]].map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} style={reduce ? undefined : { opacity: 0 }} />)}
                </g>
                <g clipPath={`url(#${id}u)`}>
                  <g ref={el.sun} transform={reduce ? undefined : 'translate(0 64)'}><circle cx="98" cy="178" r="74" fill={`url(#${id}g)`} /><circle cx="98" cy="178" r="40" fill={`url(#${id}s)`} /></g>
                </g>
                <rect y="178" width="196" height="64" fill="#231C5E" />
                <g ref={el.refl} style={reduce ? undefined : { opacity: 0 }}>
                  <rect x="62" y="190" width="72" height="3.5" rx="1.75" fill="#FFB36E" opacity=".85" />
                  <rect x="76" y="203" width="44" height="3" rx="1.5" fill="#FFB36E" opacity=".5" />
                  <rect x="88" y="215" width="20" height="3" rx="1.5" fill="#FFB36E" opacity=".3" />
                </g>
              </g>
            </g>
            <path ref={el.rim} className="cr-rim" d="M8 236V106A90 90 0 0 1 188 106V236Z" />
          </svg>
        </div>
        <div ref={el.head} className="cr-head" aria-live="polite">
          <h2 ref={el.title} id={`${id}t`} className="cr-title" style={hidden}>{inside ? `You’re in, ${first}` : 'Creating your account'}</h2>
          <p ref={el.sub} className="cr-sub" style={hidden}>{inside ? 'Opening Home' : session ? VIA[session.provider] : ''}</p>
        </div>
        <ul ref={el.list} className="cr-list">
          {rows.map((r, i) => (
            <li key={r.id} className={cn('cr-row', i < done && 'is-done')} style={hidden}>
              <span className="ic">{r.icon}</span>
              <span className="t">{r.text}<small>{r.sub}</small></span>
              <span className="ck"><CheckDraw done={i < done} size={14} /></span>
            </li>
          ))}
        </ul>
      </div>
      <Button ref={el.skip} variant="quiet" size="sm" className="cr-skip" style={hidden} onClick={() => void finish(true)}>Skip</Button>
    </div>
  );
}
