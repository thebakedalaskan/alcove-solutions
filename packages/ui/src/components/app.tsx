/*
 * The app's building blocks: cards, navigation, the palette's line, fields, notes and transcript lines, the
 * mic level, and what a transcript isn't sure of.
 */
import { forwardRef, useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Tooltip } from './overlay';
import { Avatar, type AvatarPerson } from './people';

/**
 * A part of a page that opens and closes in place, closed until someone opens it: its heading row (`summary`, the
 * whole row is what you press) and what's under it. Built on the browser's own details element, so the keyboard and
 * screen readers work as they expect. Folds stacked one after another sit close together. `open` starts it open, and
 * closes it again when it changes back; between changes it stays as whoever is reading left it.
 */
export function Fold({ summary, children, className, open, id }: { summary: ReactNode; children: ReactNode; className?: string | undefined; open?: boolean | undefined; id?: string | undefined }) {
  return (
    <details className={cn('ac-fold', className)} open={open} id={id}>
      <summary className="ac-fold-h">{summary}<Icon name="down" size={16} className="ac-fold-i" /></summary>
      <div className="ac-fold-b">{children}</div>
    </details>
  );
}

/**
 * The container for one thing on a page: surface, a line edge, shadow-2. A `title` heading with an
 * optional `aside` on the right (a count, a link). Don't nest cards; use rows inside.
 */
export function Card({ title, aside, children, className, style, label }: {
  title?: ReactNode; aside?: ReactNode; children?: ReactNode; className?: string | undefined; style?: CSSProperties | undefined;
  /** Names the card for assistive tech when it has no title. */
  label?: string | undefined;
}) {
  const id = useId();
  return (
    <section className={cn('ac-card', className)} style={style} aria-labelledby={title ? id : undefined} aria-label={title ? undefined : label}>
      {title && <div className="ac-card-head"><h3 id={id}>{title}</h3>{aside}</div>}
      {children}
    </section>
  );
}

/** The app's sections. Put router links inside, each with className="ac-nav-item"; the current one carries aria-current="page". */
export function SidebarNav({ label = 'Main', children, className }: { label?: string; children: ReactNode; className?: string | undefined }) {
  return <nav className={cn('ac-nav', className)} aria-label={label}>{children}</nav>;
}
/** What goes inside a nav link: the icon, the label and an optional count. */
export function NavItemContent({ icon, label, count }: { icon: IconName; label: string; count?: number | undefined }) {
  return <><Icon name={icon} /><span>{label}</span>{count ? <span className="count">{count}</span> : null}</>;
}

/**
 * One line to type in, for finding something: the palette's. Put an input with className="text" inside, and the
 * action after it. Anything that needs more than a line asks one thing at a time in a Modal instead.
 */
export function ComposerLine({ icon = 'cal', children, action, className }: { icon?: IconName; children: ReactNode; action?: ReactNode; className?: string | undefined }) {
  return <div className={cn('ac-composer', className)}><Icon name={icon} size={20} />{children}{action}</div>;
}

/** A labelled text input, for the rare places that need one. A dialog asks one thing at a time: several questions are steps of one modal, not a stack of fields. */
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }>(function Field({ label, hint, id, className, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={cn('ac-field', className)}>
      <label htmlFor={fid}>{label}</label>
      <input ref={ref} id={fid} className="ac-input" {...rest} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
});

/** A call's notes: a head with the title and meta, labelled sections, and a footer. */
export function NotesPanel({ title, meta, end, children, foot, className }: { title: ReactNode; meta?: ReactNode; end?: ReactNode; children: ReactNode; foot?: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('ac-notes', className)}>
      <div className="ac-notes-head"><div><div className="t">{title}</div>{meta && <div className="m">{meta}</div>}</div>{end && <span className="end">{end}</span>}</div>
      <div className="ac-notes-body">{children}</div>
      {foot && <div className="ac-notes-foot">{foot}</div>}
    </div>
  );
}
export function NotesSection({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="ac-eyebrow">{label}</div>{children}</div>;
}
/** One row of notes: a decision gets a tick, a follow-up its owner. New rows rise in. */
export function NoteRow({ owner, isNew = false, children }: { owner?: AvatarPerson | undefined; isNew?: boolean; children: ReactNode }) {
  return (
    <div className={cn('ac-note-row', isNew && 'is-new')}>
      {owner ? <span className="ac-owner"><Avatar person={owner} size={18} />{owner.name.split(' ')[0] ?? owner.name}</span> : <span className="ac-tick"><Icon name="check" size={13} /></span>}
      <span>{children}</span>
    </div>
  );
}

/**
 * One spoken line of a note's transcript: when, the speaker's arch, their name, what they said, and `tools` for what can
 * be done with it, which wait under the pointer. Without a person (the same speaker again, or a room recording) the arch's
 * place stays empty. `id` makes it a place a link can go to.
 */
export function TranscriptLine({ time, person, name, tools, children, className, id }: {
  time: ReactNode; person?: AvatarPerson | undefined; name?: ReactNode; tools?: ReactNode; children: ReactNode; className?: string | undefined; id?: string | undefined;
}) {
  return (
    <div id={id} className={cn('nd-l', className)}>
      {time}
      <span className="nd-la">{person && <Avatar person={person} size={24} />}</span>
      <div className="nd-lb">{name && <p className="nd-ln">{name}</p>}<p className="nd-lp">{children}</p></div>
      <div className="nd-lx">{tools}</div>
    </div>
  );
}

/* ---------- Tiles and cards ---------- */

/* ---------- Minutes ---------- */

/**
 * How loud the microphone is, from `level` (0 to 1): `bars` that fill with horizon, beside a microphone
 * choice. It doesn't open the microphone: pass it the level you measure, as often as you like.
 */
export function MicLevel({ level, bars = 8, label = 'Microphone level', className }: { level: number; bars?: number | undefined; label?: string | undefined; className?: string | undefined }) {
  const v = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const lit = Math.round(v * bars);
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={cn('ac-mic-level', className)}>
      {Array.from({ length: bars }, (_, i) => <i key={i} className={i < lit ? 'on' : undefined} />)}
    </span>
  );
}

/* ---------- Groups ---------- */

/**
 * One of your groups, as a fact: its name after a hash, and how many people are in it. `onRemove` adds an
 * × to take it back out, as a chosen group in a picker. A long name ends in an ellipsis.
 */
export function GroupChip({ name, count, onRemove, className }: { name: string; count?: number | undefined; onRemove?: (() => void) | undefined; className?: string | undefined }) {
  return (
    <span className={cn('ac-group-chip', onRemove && 'has-x', className)}>
      <Icon name="hash" size={14} />
      <span className="name ac-clamp-1" title={name}>{name}</span>
      {count !== undefined && <span className="n">{count}<span className="sr-only"> {count === 1 ? 'person' : 'people'}</span></span>}
      {onRemove && <button type="button" aria-label={`Remove ${name}`} onClick={onRemove}><Icon name="x" size={12} /></button>}
    </span>
  );
}

/** What the transcript can't vouch for in a line: words that were hard to hear, or who said them. */
export type UnsureOf = 'words' | 'speaker';
const UNSURE: Record<UnsureOf, { tip: string; said: string }> = {
  words: { tip: 'Hard to hear. It may not be exactly what was said.', said: 'hard to hear, may not be exact' },
  speaker: { tip: 'Heard on more than one microphone. Someone else may have said it.', said: 'may have been someone else' }
};
/**
 * Something in a transcript it can't vouch for: a dotted underline (never colour alone), the reason on hover or focus,
 * and in words for screen readers. Calm on purpose: it says the transcript isn't sure, not that anything is wrong.
 */
export function Unsure({ of, children, className }: { of: UnsureOf; children: ReactNode; className?: string | undefined }) {
  return (
    <Tooltip label={UNSURE[of].tip}>
      <span tabIndex={0} className={cn('ac-unsure', className)}>{children}<span className="sr-only"> ({UNSURE[of].said})</span></span>
    </Tooltip>
  );
}
/** One quiet line under a transcript saying what its dotted marks mean, for the kinds it has; nothing when it has none. */
export function UnsureKey({ words, speaker, className }: { words: boolean; speaker: boolean; className?: string | undefined }) {
  if (!words && !speaker) return null;
  return (
    <p className={cn('ac-unsure-key', className)}>
      {words && <><span className="ac-unsure">Dotted</span> words were hard to hear and may not be exact. </>}
      {speaker && <>A <span className="ac-unsure">dotted</span> name was heard on more than one microphone.</>}
    </p>
  );
}
