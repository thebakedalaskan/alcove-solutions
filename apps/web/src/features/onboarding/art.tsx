/*
 * The tour's art: one short loop per slide on the dawn sky, with the illustrated people from Alcove's example calls (and
 * you, where the art is about you). Each loop runs on one clock; under reduced motion it holds a single finished frame.
 */
import { Avatar, CallTile, Icon, NotesSign, cn, type AvatarPerson, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useState, type CSSProperties } from 'react';
import { CAST, firstOf, type CastId } from '~/features/examples/cast';
import { shortcut } from '~/lib/keys';
import { accountQueries } from '~/features/account/queries';

/** Seconds into a loop of `period` seconds, or `still` under reduced motion. */
function useClock(period: number, still: number): number {
  const reduce = useReducedMotion() ?? false;
  const [t, setT] = useState(reduce ? still : 0);
  useEffect(() => {
    if (reduce) { setT(still); return; }
    const c = animate(0, period, { duration: period, ease: 'linear', repeat: Infinity, onUpdate: setT });
    return () => c.stop();
  }, [period, still, reduce]);
  return t;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const out3 = (x: number) => 1 - (1 - x) ** 3;
const in2 = (x: number) => x * x;
const inOut2 = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const linear = (x: number) => x;
const backOut = (s: number) => (x: number) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
/** Progress from `at` over `dur` seconds, eased. */
const ramp = (t: number, at: number, dur: number, ease: (x: number) => number = out3) => ease(clamp01((t - at) / dur));
/** In at `a`, out at `b`. */
const span = (t: number, a: number, inDur: number, b: number, outDur: number) => ramp(t, a, inDur) * (1 - ramp(t, b, outDur, in2));
/** Comes up `dy` pixels into its place as `p` goes 0 → 1. */
const rise = (p: number, dy: number): CSSProperties => ({ opacity: p, translate: `0 ${dy * (1 - p)}px` });
/** Pops into its place as `p` goes 0 → 1. */
const pop = (p: number, s = 1.7): CSSProperties => ({ opacity: clamp01(p), scale: String(0.6 + 0.4 * backOut(s)(clamp01(p))) });

/** A line along the foot of the art: what the loop is about. */
function Label({ icon, children }: { icon: IconName; children: string }) {
  return <div className="ta-label"><span className="ta-lab"><Icon name={icon} size={13} />{children}</span></div>;
}

/* ---------------------------------------------------------------------------------------- Start or schedule a call */

/** The scheduler's week: busy time (top and height, in % of the day), a free time lit, and the one picked. */
const WEEK: { day: string; busy: [number, number][]; lit?: [number, number]; picked?: [number, number] }[] = [
  { day: 'Wed', busy: [[8, 28], [58, 26]] },
  { day: 'Thu', busy: [[6, 30]], picked: [50, 30] },
  { day: 'Fri', busy: [[44, 36]], lit: [8, 28] },
  { day: 'Mon', busy: [[20, 36]] },
  { day: 'Tue', busy: [[8, 24], [62, 30]] }
];
const box = ([top, height]: [number, number]): CSSProperties => ({ top: `${top}%`, height: `${height}%` });

/** Start or schedule a call: who's in, everyone's busy time, the free times lit, one picked, and the invites sent. */
export function ArtStart() {
  const t = useClock(6.4, 4.9);
  const gone = 1 - ramp(t, 5.95, 0.3, in2);
  const busy = ramp(t, 1.55, 0.5) * gone;
  const glow = ramp(t, 2.15, 0.45);
  const picked = ramp(t, 3.05, 0.38, linear);
  const unlit = 1 - ramp(t, 3.05, 0.3);
  const named = t < 0.6 ? '' : t < 1.2 ? 'Call with Maya' : 'Call with Maya and Kofi';
  return (
    <div className="ta">
      <div className="ta-stack">
        <div className="ta-sched ta-glass">
          <div className="ta-sh">
            <span className={cn('ta-sh-t', !named && 'is-empty')} style={{ opacity: gone }}>{named || 'Schedule a call'}</span>
            <span className="ta-sh-who">
              <span style={pop(ramp(t, 0.5, 0.42, linear) * gone)}><Avatar person={CAST.maya} size={20} /></span>
              <span style={pop(ramp(t, 1.1, 0.42, linear) * gone)}><Avatar person={CAST.kofi} size={20} /></span>
            </span>
          </div>
          <div className="ta-wk">
            {WEEK.map((d) => (
              <div key={d.day} className="ta-d">
                <small>{d.day}</small>
                <span className="ta-col">
                  {d.busy.map((b) => <i key={b[0]} className="ta-busy" style={{ ...box(b), opacity: busy }} />)}
                  {d.lit && <i className="ta-lit" style={{ ...box(d.lit), opacity: glow * unlit * gone }} />}
                  {d.picked && <i className="ta-lit" style={{ ...box(d.picked), opacity: glow * (1 - picked) * gone }} />}
                  {d.picked && <i className="ta-picked" style={{ ...box(d.picked), opacity: picked * gone, scale: String(0.82 + 0.18 * backOut(1.6)(picked)) }} />}
                </span>
              </div>
            ))}
          </div>
        </div>
        <span className="ta-chip ta-glass" style={rise(ramp(t, 3.7, 0.45) * gone, 8)}><span className="ta-ok"><Icon name="check" size={11} /></span>Thu 15:00 · Invites sent</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- Notes for your calls */

const WRITTEN: { text: string; at: string; owner?: CastId }[] = [
  { text: 'Launch moves to the 18th', at: '6:12' },
  { text: 'Waitlist stays open', at: '14:40' },
  { text: 'Sends the screens by Wednesday', at: '22:05', owner: 'kofi' }
];

/** Notes for your calls: decisions and a follow-up write themselves into a call's notes, each with its moment. */
export function ArtNotes() {
  const t = useClock(5.4, 3.6);
  const gone = 1 - ramp(t, 4.6, 0.3, in2);
  return (
    <div className="ta">
      <div className="ta-top">
        <div className="ta-notes ta-glass">
          <div className="hd"><span>Weekly product call</span><NotesSign stage>Notes on</NotesSign></div>
          <div className="ta-rows">
            {WRITTEN.map((r, i) => {
              const p = ramp(t, 0.4 + i * 0.7, 0.55);
              const mark: CSSProperties = { scale: String(0.4 + 0.6 * backOut(2.2)(clamp01((t - 0.5 - i * 0.7) / 0.5))) };
              return (
                <div key={r.text} className="ta-row" style={{ height: 26 * p, opacity: p * gone, translate: `0 ${8 * (1 - p)}px` }}>
                  {r.owner
                    ? <span className="ta-owner" style={mark}><Avatar person={CAST[r.owner]} size={16} />{firstOf(r.owner)}</span>
                    : <span className="ta-dec" style={mark}><Icon name="diamond" size={12} /></span>}
                  <span className="ta-rt">{r.text}</span>
                  <span className="ta-at" style={{ opacity: ramp(t, 0.9 + i * 0.7, 0.4) }}><Icon name="play" size={9} />{r.at}</span>
                </div>
              );
            })}
          </div>
        </div>
        <Label icon="sealed">Written in confidential compute</Label>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- Search or ask */

const QUESTION = 'What did we decide on pricing?';
const ANSWER = 'Keep the free plan, and Pro goes up in January. Maya sends the new pricing page by Friday.'.split(' ');

/** Search or ask: a question typed into the palette, Ask lit, then the answer with the moments it came from. */
export function ArtAsk() {
  const t = useClock(6.8, 5.2);
  const gone = 1 - ramp(t, 6.3, 0.3, in2);
  const typed = QUESTION.slice(0, Math.round(clamp01((t - 0.35) / 1.45) * QUESTION.length));
  const caret = t < 2.3 && Math.floor(t * 2.4) % 2 === 0 ? 1 : t < 2.3 ? 0.2 : 0;
  const moment = (at: number): CSSProperties => {
    const p = ramp(t, at, 0.4);
    return { opacity: p * gone, translate: `0 ${6 * (1 - p)}px`, scale: String(0.94 + 0.06 * backOut(1.7)(p)) };
  };
  return (
    <div className="ta">
      <div className="ta-pal ta-glass">
        <div className="ta-pl">
          <Icon name="search" size={16} />
          <span className="ta-q" style={{ opacity: gone }}>{typed || <span className="ta-ph">Search or ask</span>}</span>
          <i className="ta-caret" style={{ opacity: caret * gone }} />
          <span className="ta-k">{shortcut('K')}</span>
        </div>
        <div className="ta-pa">
          <div className="ta-askrow" style={{ opacity: span(t, 1.95, 0.25, 2.6, 0.2) }}><Icon name="ask" size={14} /><span>Ask “{QUESTION}”</span></div>
          <p className="ta-ans">{ANSWER.map((w, i) => { const p = ramp(t, 2.7 + i * 0.045, 0.32); return <span key={i} style={{ opacity: p * gone, translate: `0 ${4 * (1 - p)}px` }}>{w} </span>; })}</p>
          <div className="ta-moms">
            <span className="ta-mom" style={moment(3.75)}><Icon name="play" size={9} />Pricing sync · 6:12</span>
            <span className="ta-mom" style={moment(3.95)}><Icon name="play" size={9} />Design review · 31:40</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- Documents and boards */

/** The document's lines (how wide, in % of the page, and how far down), written in turn. */
const LINES = [{ at: 0.4, w: 84, y: 37 }, { at: 1.05, w: 68, y: 51 }, { at: 1.7, w: 46, y: 65 }];
/** The board's stickies, landing in turn, each with its paper. */
const STICKIES = [{ at: 1.9, x: 16, y: 22, turn: -5, tone: 'is-a' }, { at: 2.35, x: 62, y: 14, turn: 4, tone: 'is-b' }, { at: 2.8, x: 40, y: 56, turn: -2, tone: 'is-c' }];

/** Documents and boards: a document writes itself beside a board where stickies land, each with someone's pointer. */
export function ArtDrive() {
  const t = useClock(6.8, 5.2);
  const gone = 1 - ramp(t, 6.3, 0.3, in2);
  const written = LINES.map((l) => ramp(t, l.at, 0.6, linear));
  /* Priya's pointer writes the line that's being written. */
  const at = LINES.reduce((k, l, i) => (t >= l.at ? i : k), 0);
  const line = LINES[at] ?? { w: 0, y: 37 };
  const px = 12 + 150 * (line.w / 100) * (written[at] ?? 0);
  /* Kofi's pointer carries each sticky to where it lands. */
  let kx = 96;
  let ky = 90;
  for (const s of STICKIES) { const p = ramp(t, s.at - 0.4, 0.42, inOut2); kx += (s.x + 24 - kx) * p; ky += (s.y + 24 - ky) * p; }
  return (
    <div className="ta">
      <div className="ta-top">
        <div className="ta-dr">
          <div className="ta-doc ta-glass">
            <b>Launch plan</b>
            {LINES.map((l, i) => <i key={l.y} className="ta-ln" style={{ top: l.y, width: `${l.w * (written[i] ?? 0)}%`, opacity: gone }} />)}
            <span className="ta-cur" style={{ translate: `${px}px ${line.y - 3}px`, opacity: ramp(t, 0.2, 0.3) * (1 - ramp(t, 2.7, 0.4)) * gone }}><Icon name="pointer" size={14} /><em>Priya</em></span>
          </div>
          <div className="ta-brd ta-glass">
            {STICKIES.map((s) => { const p = ramp(t, s.at, 0.42, linear); return <i key={s.tone} className={cn('ta-st', s.tone)} style={{ left: s.x, top: s.y, opacity: p * gone, rotate: `${s.turn}deg`, scale: String(1.3 - 0.3 * backOut(1.8)(p)) }} />; })}
            <span className="ta-cur is-kofi" style={{ translate: `${kx}px ${ky}px`, opacity: ramp(t, 1.3, 0.3) * (1 - ramp(t, 4.4, 0.4)) * gone }}><Icon name="pointer" size={14} /><em>Kofi</em></span>
          </div>
        </div>
        <Label icon="folderOpen">Kept with the call, and in the Drive</Label>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- Join a call */

/** Join a call: people talking, with live captions. */
export function ArtCall() {
  const lines: [CastId, string][] = [['priya', 'The sign-in step tested well.'], ['theo', 'Then we ship it on Thursday.'], ['kofi', 'I’ll send the screens tonight.']];
  const t = useClock(6.6, 1.5);
  const k = Math.max(0, Math.min(2, Math.floor(t / 2.2)));
  const local = t - k * 2.2;
  const [who, said] = lines[k] ?? lines[0] ?? ['priya', ''];
  return (
    <div className="ta">
      <div className="ta-call">
        <div className="ta-tiles">{lines.map(([id], i) => <CallTile key={id} person={CAST[id]} name={firstOf(id)} speaking={i === k} />)}</div>
        <div className="ta-cap ta-glass">
          <div className="who"><Avatar person={CAST[who]} size={14} />{firstOf(who)}<span className="lbl">Captions</span></div>
          <p>{said.split(' ').map((w, i) => { const p = ramp(local, i * 0.11, 0.3); return <span key={`${k}-${i}`} style={{ opacity: p, translate: `0 ${4 * (1 - p)}px` }}>{w}&nbsp;</span>; })}</p>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- Record in the room */

/** Record in the room: a phone records offline, then sends the sealed recording once it's back online. */
export function ArtRoom() {
  const t = useClock(6.8, 4.5);
  const pills: { icon: IconName; gold?: boolean; title: string; sub: string; a: number; b: number }[] = [
    { icon: 'wifiOff', title: 'Offline', sub: 'Saved on this phone, encrypted', a: 0.2, b: 2.1 },
    { icon: 'wifi', title: 'Back online', sub: 'Sending the sealed recording', a: 2.3, b: 3.7 },
    { icon: 'sealed', gold: true, title: 'Notes written', sub: 'In confidential compute', a: 3.9, b: 6 }
  ];
  return (
    <div className="ta">
      <div className="ta-room">
        <div className="ta-phone">
          <div className="scr">
            <span className="ta-rec"><i />Rec 04:12</span>
            <div className="ta-wave">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ scale: `1 ${0.25 + 0.75 * Math.abs(Math.sin(t * (2.4 + (i % 5) * 0.55) + i * 1.7))}` }} />)}</div>
          </div>
        </div>
        <div className="ta-status">
          {pills.map((p) => {
            const show = span(t, p.a, 0.45, p.b, 0.3);
            return (
              <div key={p.title} className="ta-pill ta-glass" style={{ opacity: show, translate: `0 ${t < p.b ? 8 * (1 - ramp(t, p.a, 0.45)) : -8 * ramp(t, p.b, 0.3, in2)}px` }}>
                <span className={p.gold ? 'ic is-gold' : 'ic'}><Icon name={p.icon} size={15} /></span>
                <span><b>{p.title}</b><small>{p.sub}</small></span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- Bring your agent */

/** Bring your agent: its window and you on the horizon, joined while it asks; you allow Book calls, and it books one. */
export function ArtAgents() {
  const t = useClock(6.8, 5.3);
  const session = useQuery(accountQueries.session()).data;
  const you: AvatarPerson = session?.user ?? CAST.art;
  const gone = 1 - ramp(t, 6.3, 0.3, in2);
  const asking = span(t, 0.6, 0.45, 2.85, 0.3) * gone;
  const allowed = ramp(t, 2.95, 0.45);
  const turnedOn = ramp(t, 1.85, 0.28, inOut2);
  const tick = ramp(t, 3.05, 0.4, linear);
  return (
    <div className="ta">
      <div className="ta-ag">
        <span className="ta-hz" />
        <svg className="ta-join" viewBox="0 0 400 180" aria-hidden="true"><path d="M150 124C188 94 216 94 254 124" style={{ opacity: ramp(t, 0.2, 0.7, inOut2) * (1 - ramp(t, 3, 0.4)) * gone }} /></svg>
        <span className="ta-win">
          <span className="ta-halo" style={{ opacity: allowed * gone, scale: String(0.86 + 0.14 * allowed) }} />
          <span className="ta-asks" style={{ opacity: (1 - allowed) * ramp(t, 0.6, 0.4) * gone }} />
          <Icon name="agent" size={22} />
          <span className="ta-tk" style={{ opacity: clamp01(tick) * gone, scale: String(Math.max(0, backOut(2)(tick))) }}><Icon name="check" size={11} /></span>
        </span>
        <span className="ta-me"><Avatar person={you} size={46} /></span>
        <div className="ta-bub ta-glass" style={rise(asking, 8)}>
          <b>Claude asks to use your Alcove</b>
          <span className="ta-sw"><span className="ta-tr is-on"><i /></span>Find notes</span>
          <span className="ta-sw"><span className="ta-tr"><span className="on" style={{ opacity: turnedOn }} /><i style={{ translate: `${11 * turnedOn}px 0` }} /></span>Book calls</span>
        </div>
        <div className="ta-did ta-glass" style={rise(ramp(t, 3.5, 0.45) * gone, 8)}><span className="ta-ok"><Icon name="check" size={11} /></span>Claude booked Pricing review · Thu 15:00</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- You're ready */

/** You're ready: the sun comes up over the horizon. */
export function ArtSun() {
  const t = useClock(5.2, 3);
  const up = ramp(t, 0.2, 2.6);
  const fade = 1 - ramp(t, 4.4, 0.5, in2);
  const stars: [number, number, number][] = [[60, 34, 1.3], [130, 22, 1], [250, 30, 1.4], [320, 52, 1], [352, 24, 1.2], [96, 70, 0.9]];
  return (
    <svg className="ta-sky" viewBox="0 0 400 180" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="ta-sun-n" cx=".42" cy=".38" r=".72"><stop offset="0" stopColor="#FFF6E0" /><stop offset=".5" stopColor="#FFD58A" /><stop offset="1" stopColor="#FFB547" /></radialGradient>
        <radialGradient id="ta-sun-g"><stop offset="0" stopColor="#FFD58A" stopOpacity=".9" /><stop offset="1" stopColor="#FF9E5E" stopOpacity="0" /></radialGradient>
        <clipPath id="ta-sun-u"><rect width="400" height="146" /></clipPath>
      </defs>
      <g fill="#fff">{stars.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} opacity={0.9 - 0.75 * ramp(t, 0.8 + i * 0.08, 1.6, inOut2)} />)}</g>
      <g clipPath="url(#ta-sun-u)">
        <g transform={`translate(0 ${70 * (1 - up)})`} opacity={fade}><circle cx="200" cy="146" r="112" fill="url(#ta-sun-g)" /><circle cx="200" cy="146" r="44" fill="url(#ta-sun-n)" /></g>
      </g>
      <rect y="146" width="400" height="34" fill="#231C5E" />
      <g opacity={ramp(t, 1.4, 1, linear) * fade}>
        <rect x="150" y="155" width="100" height="3.5" rx="1.75" fill="#FFB36E" opacity=".85" />
        <rect x="172" y="165" width="56" height="3" rx="1.5" fill="#FFB36E" opacity=".5" />
      </g>
    </svg>
  );
}
