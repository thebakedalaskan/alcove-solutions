/*
 * The pieces of starting and scheduling a call: one modal that asks one thing at a time, and the card a scheduled
 * call opens. What each says and does is the app's; how each looks and moves is here (calls/flow.css).
 */
import type { ChangeScope, NotesChoices, NotesSetting } from '@alcove/api';
import { forwardRef, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { Avatar, Faces, type AvatarPerson } from '../foundation/people';
import { IconButton, Kbd, Segmented, Switch, Unencrypted } from '../foundation/primitives';

/* ---------- what's on every view ---------- */

/** One view of the modal: its title bar and the foot stay put, and the body between them scrolls when it has to. */
export function FlowView({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <div className={cn('cf-view', className)}>{children}</div>;
}

/** A view with one heading, and the way out. */
export function FlowHead({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return <div className="cf-head"><h2 className="ac-clamp-2">{title}</h2><IconButton icon="x" label="Close" onClick={onClose} /></div>;
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

/**
 * Someone, a group or a list in the Who field: one token, however many people it stands for (`count`), in their arch.
 * `state` says what someone answered, beside the name ("Going"). `place` is what sits after the name for someone from
 * outside: where they are, a button that says so (Where? until it's said). `held` shows it's selected, one press from going.
 * Without `onRemove` it's only read: someone on a call being moved.
 */
export function PersonToken({ people, label, count, title, state, place, held = false, onRemove, removeLabel }: {
  people: AvatarPerson[]; label: string; count?: number | undefined; title?: string | undefined; state?: string | undefined; place?: ReactNode;
  held?: boolean | undefined; onRemove?: (() => void) | undefined; removeLabel?: string | undefined;
}) {
  return (
    <span className={cn('cf-tok', held && 'is-held', !onRemove && 'is-fixed')} title={title}>
      <span className="cf-face">{count === undefined ? <Faces people={people} size={20} max={1} /> : <QuadFaces people={people} size={10} />}</span>
      <span className="t ac-clamp-1">{label}</span>
      {count !== undefined && <small>{count}</small>}
      {state && <small>{state}</small>}
      {place}
      {onRemove && <button type="button" className="x" aria-label={removeLabel ?? `Remove ${label}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="x" size={13} /></button>}
    </span>
  );
}

/* ---------- switches ---------- */

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
      {on && <KeepSwitches choices={choices} modelPrivate={modelPrivate} onChoices={onChoices} />}
    </>
  );
}

/**
 * What a call's notes keep, each a switch with what it means: the transcript, the recording and shared screens, then who
 * writes the notes. On a scheduled call's card under Write notes, and in the organizer's lobby under What the notes keep.
 */
export function KeepSwitches({ choices, modelPrivate = true, onChoices }: {
  /** The organizer's AI model runs in a secure enclave. When it doesn't, the note under the switches says so. */
  modelPrivate?: boolean | undefined; choices: NotesChoices; onChoices: (c: NotesChoices) => void }) {
  return (
    <>
      <SwitchLine title="Keep the transcript" sub={choices.keepTranscript ? 'Who said what, and anyone invited can correct it' : 'Used to write the notes, then deleted'}
        control={<Switch checked={choices.keepTranscript} label="Keep the transcript" onChange={(keepTranscript) => onChoices({ ...choices, keepTranscript })} />} />
      <SwitchLine title="Keep the recording" sub={choices.keepRecording ? 'Play back any moment from the notes' : 'Deleted when the call ends'}
        control={<Switch checked={choices.keepRecording} label="Keep the recording" onChange={(keepRecording) => onChoices({ ...choices, keepRecording })} />} />
      <SwitchLine title="Read shared screens" sub="Whoever shares is asked whether it goes in the notes"
        control={<Switch checked={choices.allowScreens} label="Read shared screens" onChange={(allowScreens) => onChoices({ ...choices, allowScreens })} />} />
      {modelPrivate
        ? <p className="cf-sealed"><Icon name="sealed" size={14} />Written by an AI model in confidential compute.</p>
        : <p className="cf-sealed"><Icon name="shieldOff" size={14} />Written by an AI model outside a secure enclave. <Unencrypted compact /></p>}
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
