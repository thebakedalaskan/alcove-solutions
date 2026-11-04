/*
 * The tour's art: one short loop per slide on the dawn sky, with the illustrated people from Alcove's
 * example calls. Each loop runs on one clock; under reduced motion it holds a single finished frame.
 */
import { Avatar, CallTile, Icon, NotesSign, type IconName } from '@alcove/ui';
import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { CAST, firstOf, type CastId } from '~/features/notes/cast';
import { shortDay } from '~/lib/time';

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
const backOut = (s: number) => (x: number) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
/** Progress from `at` over `dur` seconds, eased. */
const ramp = (t: number, at: number, dur: number, ease: (x: number) => number = out3) => ease(clamp01((t - at) / dur));
/** In at `a`, out at `b`. */
const span = (t: number, a: number, inDur: number, b: number, outDur: number) => ramp(t, a, inDur) * (1 - ramp(t, b, outDur, in2));

function GlassChip({ icon, children }: { icon: IconName; children: string }) {
  return <span className="ta-chip ta-glass"><Icon name={icon} size={14} />{children}</span>;
}

/** Schedule in one line: a sentence types itself and turns into the call's chips. */
export function ArtSchedule() {
  const text = 'Design review with Theo tomorrow at 3';
  const t = useClock(5.7, 4.5);
  const typed = Math.round(text.length * clamp01((t - 0.35) / 1.7));
  const gone = 1 - ramp(t, 4.9, 0.3, in2);
  const tomorrow = new Date(Date.now() + 86_400_000);
  const chips = [
    <GlassChip key="d" icon="cal">{shortDay(tomorrow)}</GlassChip>,
    <GlassChip key="t" icon="clock">15:00 – 15:30</GlassChip>,
    <span key="p" className="ta-chip ta-glass"><Avatar person={CAST.theo} size={18} />Theo</span>,
    <span key="n" className="ta-chip is-notes"><Icon name="notes" size={14} />Notes on</span>
  ];
  return (
    <div className="ta">
      <div className="ta-stack">
        <div className="ta-cmp ta-glass"><Icon name="video" size={16} /><span style={{ opacity: gone }}>{text.slice(0, typed)}</span><i className="ta-caret" /></div>
        <div className="ta-chips">
          {chips.map((c, i) => {
            const p = ramp(t, 2.23 + i * 0.12, 0.42, (x) => x);
            return <span key={c.key ?? i} style={{ opacity: clamp01(p) * gone, translate: `0 ${8 * (1 - out3(p))}px`, scale: String(0.94 + 0.06 * backOut(1.7)(p)) }}>{c}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

/** Notes for your calls: decisions and follow-ups write themselves into a call's notes. */
export function ArtNotes() {
  const t = useClock(4.95, 3);
  const rows: { owner?: CastId; text: string }[] = [{ text: 'Launch moves to the 18th' }, { text: 'Waitlist stays open' }, { owner: 'kofi', text: 'Sends the screens by Wednesday' }];
  const gone = 1 - ramp(t, 4.15, 0.3, in2);
  return (
    <div className="ta">
      <div className="ta-notes ta-glass">
        <div className="hd"><span>Weekly product call</span><NotesSign stage>Notes on</NotesSign></div>
        <div className="ta-rows">
          {rows.map((r, i) => {
            const p = ramp(t, 0.4 + i * 0.7, 0.55);
            const pop = 0.4 + 0.6 * backOut(2.2)(clamp01((t - 0.5 - i * 0.7) / 0.5));
            return (
              <div key={r.text} className="ta-row" style={{ height: 26 * p, opacity: p * gone, translate: `0 ${8 * (1 - p)}px` }}>
                {r.owner
                  ? <span className="ta-owner" style={{ scale: String(pop) }}><Avatar person={CAST[r.owner]} size={16} />{firstOf(r.owner)}</span>
                  : <span className="ta-tick" style={{ scale: String(pop) }}><Icon name="check" size={13} /></span>}
                <span>{r.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Join a call: people talking, with live captions. */
export function ArtCall() {
  const lines: [CastId, string][] = [['priya', 'The sign-in step tested well.'], ['theo', 'Then we ship it on Thursday.'], ['kofi', 'I’ll send the screens tonight.']];
  const t = useClock(6.6, 1.5);
  const k = Math.min(2, Math.floor(t / 2.2));
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
            <span className="rec"><i />Rec 04:12</span>
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

/** Your notes stay yours: audio and words go into the sealed vault; only the people invited get notes out. */
export function ArtSeal() {
  const t = useClock(4.7, 0);
  const into = [0, 1].map((k) => {
    const a = 0.3 + k * 0.25;
    const p = ramp(t, a, 0.9, inOut2);
    return { left: 80 + (168 - 80) * p, top: (k ? 95 : 59) + (78 - (k ? 95 : 59)) * p, opacity: ramp(t, a, 0.15) * (1 - ramp(t, 1.05 + k * 0.25, 0.2)), scale: 1 - 0.6 * ramp(t, 1.05 + k * 0.25, 0.2) };
  });
  const outOf = [52, 82, 112].map((ty, j) => {
    const a = 1.7 + j * 0.14;
    const p = ramp(t, a, 0.75, inOut2);
    return { left: 212 + 100 * p, top: 78 + (ty - 78) * p, opacity: t < 1.6 ? 0 : ramp(t, a, 0.15) * (1 - ramp(t, 2.3 + j * 0.14, 0.2)), scale: 1 };
  });
  const g1 = ramp(t, 1.25, 0.45);
  const g2 = ramp(t, 1.7, 0.6);
  const glow = t < 1.25 ? 'none' : `0 0 0 ${10 + 8 * g2}px rgb(255 199 116 / ${(0.18 * g1 * (1 - g2)).toFixed(3)})`;
  const pulse = 1 + 0.12 * Math.sin(Math.PI * clamp01((t - 1.25) / 0.5));
  return (
    <div className="ta">
      <div className="ta-seal">
        <div className="ta-src"><span className="ta-glass"><Icon name="mic" size={13} />Audio</span><span className="ta-glass"><Icon name="captions" size={13} />Words</span></div>
        <div className="ta-vault-glow" style={{ boxShadow: glow }} />
        <div className="ta-vault ta-glass"><span className="ic" style={{ scale: String(pulse) }}><Icon name="lock" size={19} /></span></div>
        <div className="ta-dst"><Avatar person={CAST.maya} size={22} /><Avatar person={CAST.theo} size={22} /><Avatar person={CAST.priya} size={22} /></div>
        {[...into, ...outOf].map((k, i) => <i key={i} className="ta-pk" style={{ left: k.left, top: k.top, opacity: k.opacity, scale: String(k.scale) }} />)}
      </div>
      <div className="ta-label"><Icon name="eyeOff" size={12} />Sealed · Alcove can’t read it</div>
    </div>
  );
}

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
      <g opacity={ramp(t, 1.4, 1, (x) => x) * fade}>
        <rect x="150" y="155" width="100" height="3.5" rx="1.75" fill="#FFB36E" opacity=".85" />
        <rect x="172" y="165" width="56" height="3" rx="1.5" fill="#FFB36E" opacity=".5" />
      </g>
    </svg>
  );
}
