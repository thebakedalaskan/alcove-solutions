/*
 * The pieces of starting and scheduling a call: one modal that asks one thing at a time, and the card a scheduled
 * call opens. What each says and does is the app's; how each looks and moves is here (styles/flow.css).
 */
import type { ChangeScope, NotesChoices, NotesSetting } from '@alcove/api';
import { forwardRef, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Avatar, Faces, type AvatarPerson } from './people';
import { IconButton, Kbd, Segmented, Switch, Unencrypted } from './primitives';

/* ---------- what's on every view ---------- */

/** One view of the modal: its title bar and the foot stay put, and the body between them scrolls when it has to. */
export function FlowView({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <div className={cn('cf-view', className)}>{children}</div>;
}

/** A view with one heading, and the way out. */
export function FlowHead({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return <div className="cf-head"><h2 className="ac-clamp-2">{title}</h2><IconButton icon="x" label="Close" onClick={onClose} /></div>;
}

/** Where someone is in a few steps, with Back and the way out. `busy` holds Back while what's on this step is saving. */
export function FlowSteps({ steps, at, busy = false, onBack, onClose }: { steps: readonly string[]; at: number; busy?: boolean | undefined; onBack: () => void; onClose: () => void }) {
  return (
    <div className="cf-steps">
      <IconButton icon="left" size={17} label="Back" disabled={busy} onClick={onBack} />
      {steps.length > 0 ? (
        <ol aria-label="Steps">
          {steps.map((s, i) => <li key={s} className={i === at ? 'on' : i < at ? 'done' : undefined} aria-current={i === at ? 'step' : undefined}>{s}</li>)}
        </ol>
      ) : <span />}
      <IconButton icon="x" size={17} label="Close" onClick={onClose} />
    </div>
  );
}

/** The part of a view that scrolls. It slides in from the side it's coming from. */
export function FlowBody({ back = false, children, className }: { back?: boolean | undefined; children: ReactNode; className?: string | undefined }) {
  return <div className={cn('cf-body', back && 'is-back', className)}>{children}</div>;
}

/** A view's foot: what will happen, or a quiet way out, then what to press. */
export function FlowFoot({ summary, lead, children }: { summary?: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="cf-foot">
      {lead}
      {summary !== undefined && summary !== '' && <span className="sum">{summary}</span>}
      {children !== undefined && <span className="acts">{children}</span>}
    </div>
  );
}

/**
 * Something to know, in place: `caution` for what needs an answer or went wrong, `info` for the rest. `action`s are
 * what can be done about it.
 */
export function FlowNote({ tone = 'caution', icon, children, actions, className }: {
  tone?: 'caution' | 'info' | undefined; icon: IconName; children: ReactNode; actions?: ReactNode; className?: string | undefined;
}) {
  return (
    <div className={cn('cf-note', tone === 'info' && 'is-info', className)} role={tone === 'caution' ? 'alert' : undefined}>
      <Icon name={icon} size={16} /><span className="m">{children}</span>{actions !== undefined && <span className="do">{actions}</span>}
    </div>
  );
}

/**
 * Lets the modal `box` change height smoothly when `key` changes, instead of jumping (it's centred, so a jump moves both
 * edges at once). Heights changed by anything else, such as a row opening, are left to happen.
 */
export function useSmoothHeight(box: HTMLElement | null, key: string, ms = 240) {
  const reduce = useReducedMotion();
  const last = useRef(0);
  const seen = useRef(key);
  useLayoutEffect(() => {
    if (!box) return undefined;
    const now = box.getBoundingClientRect().height;
    if (seen.current !== key && last.current && Math.abs(last.current - now) > 1 && !reduce) {
      box.animate({ height: [`${last.current}px`, `${now}px`] }, { duration: ms, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)' });
    }
    seen.current = key;
    last.current = now;
    const watch = new ResizeObserver(() => { last.current = box.offsetHeight; });
    watch.observe(box);
    return () => watch.disconnect();
  }, [box, key, ms, reduce]);
}

/* ---------- the two ways in ---------- */

/* Arches at dawn and before it: the sun rises a little as a choice is pointed at. Illustrations, so their colours are the sky's. */
function ArchDawn() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg width="66" height="74" viewBox="0 0 66 74" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2A2373" /><stop offset=".45" stopColor="#5847DA" /><stop offset=".72" stopColor="#C470A9" /><stop offset=".9" stopColor="#FFA06A" /></linearGradient>
        <clipPath id={`${id}c`}><path d="M7 72V32a26 26 0 0 1 52 0v40z" /></clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}><rect width="66" height="74" fill={`url(#${id}g)`} /><circle className="sunup" cx="33" cy="54" r="12" fill="#FFD58A" /><rect y="56" width="66" height="18" fill="#231C5E" /></g>
    </svg>
  );
}
function ArchNight() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg width="66" height="74" viewBox="0 0 66 74" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141148" /><stop offset="1" stopColor="#3B2EA6" /></linearGradient>
        <clipPath id={`${id}c`}><path d="M7 72V32a26 26 0 0 1 52 0v40z" /></clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="66" height="74" fill={`url(#${id}g)`} /><rect className="dawn" y="42" width="66" height="16" fill="#C46CA8" opacity=".5" />
        <circle cx="24" cy="24" r="1.2" fill="#FFF" /><circle cx="42" cy="17" r="1" fill="#FFF" /><circle cx="46" cy="33" r="1.3" fill="#FFF" /><circle cx="19" cy="40" r=".9" fill="#FFF" /><circle cx="33" cy="38" r="1" fill="#FFF" />
        <rect y="56" width="66" height="18" fill="#231C5E" />
      </g>
    </svg>
  );
}

/** One of the two ways to start: `now` shows the sun coming up, `later` the night before it. */
export const WayCard = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & { art: 'now' | 'later'; title: ReactNode; children: ReactNode; kbd: string }>(function WayCard({ art, title, children, kbd, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className="cf-way" {...rest}>
      {art === 'now' ? <ArchDawn /> : <ArchNight />}
      <span><b>{title}</b><small>{children}</small></span>
      <Kbd>{kbd}</Kbd>
    </button>
  );
});

/* ---------- people ---------- */

/** A few people in one small square of arches, for a group or a list. */
export function QuadFaces({ people, size = 18 }: { people: AvatarPerson[]; size?: number | undefined }) {
  return <span className="cf-quad">{people.slice(0, 4).map((p, i) => <Avatar key={`${p.email ?? p.name}-${i}`} person={p} size={size} />)}</span>;
}

/** Someone, a group or a list in the Who field: one token, however many people it stands for (`count`). `held` shows it's selected, one press from going. */
export function PersonToken({ people, label, count, title, held = false, onRemove, removeLabel }: {
  people: AvatarPerson[]; label: string; count?: number | undefined; title?: string | undefined; held?: boolean | undefined; onRemove: () => void; removeLabel: string;
}) {
  return (
    <span className={cn('cf-tok', held && 'is-held')} title={title}>
      <span className="cf-face">{count === undefined ? <Faces people={people} size={26} max={1} /> : <QuadFaces people={people} size={12} />}</span>
      <span className="t ac-clamp-1">{label}</span>
      {count !== undefined && <small>{count}</small>}
      <button type="button" className="x" aria-label={removeLabel} onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="x" size={13} /></button>
    </span>
  );
}

/* ---------- times ---------- */

/** A time to pick: the day, the time, and a line under it. It fills when it's picked, and its tick pops. */
export function TimeCard({ day, time, note, picked, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { day: ReactNode; time: ReactNode; note?: ReactNode; picked: boolean }) {
  return (
    <button type="button" aria-pressed={picked} className={cn('cf-time', picked && 'on')} {...rest}>
      <span className="d">{day}</span><b>{time}</b><small>{note}</small>
      {picked && <span className="tk"><Icon name="check" size={13} /></span>}
    </button>
  );
}
/** Where a time card will be, while calendars are being read. */
export const TimeCardWaiting = () => <span className="cf-time is-wait" aria-hidden="true"><i /><i /><i /></span>;

/** A day in the week. */
export interface WeekDay { weekday: string; date: number; today: boolean; label: string }
/** What's already in a day, in hours from midnight. `mine` is yours and can say what it is; `busy` is only that someone is. */
export interface WeekEvent { day: number; from: number; to: number; kind: 'mine' | 'busy'; title?: string | undefined }

/**
 * A week to pick a time in: a column for each day, with what's in it. Every half hour can be picked. Tab reaches the
 * grid once and arrow keys move around it, and each half hour says what it is to a screen reader, busy or not.
 */
export function WeekGrid({ days, events, pick, from, to, isBusy, isPast, onPick, label }: {
  days: WeekDay[]; events: WeekEvent[];
  /** The time picked, when it's on this week. */
  pick: { day: number; from: number; to: number; label: string } | null;
  /** The hours shown. Nine in the morning is the top of the view; anything earlier is scrolled to. */
  from: number; to: number;
  isBusy: (day: number, hour: number) => boolean;
  /** It's gone: it can't be picked. */
  isPast: (day: number, hour: number) => boolean;
  onPick: (day: number, hour: number) => void;
  label: string;
}) {
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const slots = (to - from) * 2;
  const box = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ day: pick?.day ?? 0, slot: pick ? Math.round((pick.from - from) * 2) : (9 - from) * 2 });
  /* Nine o'clock at the top of the view to begin with, or the pick if it's earlier, with its label clear of the days. */
  const top = Math.max(from, Math.min(pick?.from ?? 9, 9));
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = (top - from) * 34 - 10;
  }, [from, top]);
  const move = (day: number, slot: number) => {
    const next = { day: Math.max(0, Math.min(days.length - 1, day)), slot: Math.max(0, Math.min(slots - 1, slot)) };
    setCursor(next);
    box.current?.querySelector<HTMLElement>(`[data-at="${next.day}-${next.slot}"]`)?.focus();
  };
  const keys = (e: KeyboardEvent<HTMLButtonElement>, day: number, slot: number) => {
    const next = e.key === 'ArrowUp' ? [day, slot - 1] : e.key === 'ArrowDown' ? [day, slot + 1] : e.key === 'ArrowLeft' ? [day - 1, slot] : e.key === 'ArrowRight' ? [day + 1, slot] : null;
    if (!next) return;
    e.preventDefault();
    move(next[0] ?? day, next[1] ?? slot);
  };
  const clock = (slot: number) => { const h = from + slot / 2; return `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`; };
  return (
    <div ref={box} className="wk-scroll" role="group" aria-label={label}>
      <div className="wk" style={{ '--rows': to - from, '--from': from }}>
        <span className="wk-corner" />
        {days.map((d) => <span key={d.label} className={cn('wk-d', d.today && 'today')} aria-hidden="true">{d.weekday}<b>{d.date}</b></span>)}
        <div className="wk-hrs" aria-hidden="true">{hours.map((h) => <span key={h}>{String(h).padStart(2, '0')}</span>)}</div>
        {days.map((d, day) => (
          <div key={d.label} className="wk-c">
            {events.filter((e) => e.day === day).map((e, i) => <span key={i} className={cn('ev', e.kind)} style={{ '--s': e.from, '--d': e.to - e.from }}>{e.title}</span>)}
            {pick?.day === day && <span className="ev is-pick" style={{ '--s': pick.from, '--d': pick.to - pick.from }}>{pick.label}</span>}
            {Array.from({ length: slots }, (_, slot) => {
              const hour = from + slot / 2;
              const past = isPast(day, hour);
              return (
                <button key={slot} type="button" className="wk-slot" style={{ '--i': slot }} data-at={`${day}-${slot}`} tabIndex={cursor.day === day && cursor.slot === slot ? 0 : -1}
                  aria-label={`${d.label}, ${clock(slot)}${isBusy(day, hour) ? ', busy' : ''}`} aria-pressed={pick?.day === day && pick.from === hour} aria-disabled={past}
                  onFocus={() => setCursor({ day, slot })} onKeyDown={(e) => keys(e, day, slot)} onClick={() => { if (!past) onPick(day, hour); }} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- rows ---------- */

/**
 * A line of a call: an icon, what it says, and what's at its end. As a button it opens: `expanded` for what opens in
 * place, nothing for what steps to another view. `on` lights its icon. Without `onClick` it's only read; `disabled`
 * holds it for now.
 */
export function FlowRow({ icon, title, sub, end, on = false, expanded, onClick, chevron = true, id, disabled = false }: {
  icon: IconName; title: ReactNode; sub?: ReactNode; end?: ReactNode; on?: boolean | undefined; expanded?: boolean | undefined;
  onClick?: (() => void) | undefined; chevron?: boolean | undefined; id?: string | undefined; disabled?: boolean | undefined;
}) {
  const inside = (
    <>
      <Icon name={icon} size={18} />
      <span className="min-w-0"><b className="ac-clamp-1">{title}</b>{sub !== undefined && sub !== '' && <small className="ac-clamp-2">{sub}</small>}</span>
      <span className="cf-face">{end}</span>
      {onClick && chevron && <span className="chev"><Icon name="chevron" size={16} /></span>}
    </>
  );
  const cls = cn('cf-r', on && 'is-on', (!onClick || !chevron) && 'no-chev');
  return onClick ? <button type="button" id={id} className={cls} aria-expanded={expanded} disabled={disabled} onClick={onClick}>{inside}</button> : <div id={id} className={cls}>{inside}</div>;
}

/** A switch with what it does: `control` is the Switch. */
export function SwitchLine({ title, sub, control }: { title: ReactNode; sub?: ReactNode; control: ReactNode }) {
  return <div className="cf-sw"><span><b>{title}</b>{sub !== undefined && <small>{sub}</small>}</span>{control}</div>;
}

/* ---------- what a call keeps, and which calls ---------- */

/** Whether a call writes notes, and what they keep. Off, nothing else matters. */
export function NotesSwitches({ notes, choices, modelPrivate = true, onNotes, onChoices }: {
  /** The organizer's AI model runs in a secure enclave. When it doesn't, the note under the switches says so. */
  modelPrivate?: boolean | undefined; notes: NotesSetting; choices: NotesChoices; onNotes: (n: NotesSetting) => void; onChoices: (c: NotesChoices) => void }) {
  const on = notes === 'on';
  return (
    <>
      <SwitchLine title="Write notes" sub={on ? 'Everyone invited gets them' : 'Nothing is recorded. You can turn them on during the call.'}
        control={<Switch checked={on} label="Write notes" onChange={(o) => onNotes(o ? 'on' : 'off')} />} />
      {on && (
        <>
          <SwitchLine title="Keep the transcript" sub={choices.keepTranscript ? 'Who said what, and anyone invited can correct it' : 'Used to write the notes, then deleted'}
            control={<Switch checked={choices.keepTranscript} label="Keep the transcript" onChange={(keepTranscript) => onChoices({ ...choices, keepTranscript })} />} />
          <SwitchLine title="Keep the recording" sub={choices.keepRecording ? 'Play back any moment from the notes' : 'Deleted when the call ends'}
            control={<Switch checked={choices.keepRecording} label="Keep the recording" onChange={(keepRecording) => onChoices({ ...choices, keepRecording })} />} />
          <SwitchLine title="Read shared screens" sub="Whoever shares is asked whether it goes in the notes"
            control={<Switch checked={choices.allowScreens} label="Read shared screens" onChange={(allowScreens) => onChoices({ ...choices, allowScreens })} />} />
          {modelPrivate
            ? <p className="cf-sealed"><Icon name="sealed" size={14} />Written in confidential compute. Alcove can’t read them.</p>
            : <p className="cf-sealed"><Icon name="shieldOff" size={14} />Written by an AI model outside a secure enclave. <Unencrypted compact /></p>}
        </>
      )}
    </>
  );
}

/** In a series: which calls a change is for. */
export function ScopeBar({ value, onChange, label = 'Change' }: { value: ChangeScope; onChange: (s: ChangeScope) => void; label?: string | undefined }) {
  return (
    <div className="cf-scope">
      <b>{label}</b>
      <Segmented value={value} onChange={onChange} label="Which calls" options={[{ value: 'this', label: 'This call' }, { value: 'following', label: 'This and later calls' }]} />
    </div>
  );
}

/* ---------- the flood ---------- */

/**
 * Night flooding out from `at` (where in the window, in pixels), over everything, on the way to the stage. `back`
 * draws it away again when the stage didn't open. It's drawn over a dialog, so it goes straight into the page.
 */
export function Flood({ at, back = false }: { at: { x: number; y: number }; back?: boolean | undefined }) {
  return createPortal(<div aria-hidden="true" className={cn('cf-flood', back && 'is-back')} style={{ '--fx': `${at.x}px`, '--fy': `${at.y}px` }} />, document.body);
}
