/* The app's building blocks: cards, rows, navigation, the composer line, fields, notes and transcript lines. */
import { forwardRef, useId, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Avatar, Faces, type AvatarPerson } from './people';

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

/**
 * A call on Home: the time (and how soon, or when it ends, underneath), the title and who's coming,
 * then whatever belongs at the end (its notes setting, Join). Rows sit in a Card between hairlines.
 */
export const CalendarRow = forwardRef<HTMLDivElement, Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  when: ReactNode; whenNote?: ReactNode; title: ReactNode; people?: AvatarPerson[] | undefined; who?: ReactNode; end?: ReactNode;
}>(function CalendarRow({ when, whenNote, title, people, who, end, className, ...rest }, ref) {
  return (
    <div ref={ref} className={cn('ac-row', className)} {...rest}>
      <div className="when">{when}{whenNote !== undefined && <small>{whenNote}</small>}</div>
      <div className="what">
        <b>{title}</b>
        {(who !== undefined || (people && people.length > 0)) && <span>{people && people.length > 0 && <Faces people={people} size={20} max={3} />}<span>{who}</span></span>}
      </div>
      {end !== undefined && <div className="end">{end}</div>}
    </div>
  );
});

/** The app's sections. Put router links inside, each with className="ac-nav-item"; the current one carries aria-current="page". */
export function SidebarNav({ label = 'Main', children, className }: { label?: string; children: ReactNode; className?: string | undefined }) {
  return <nav className={cn('ac-nav', className)} aria-label={label}>{children}</nav>;
}
/** What goes inside a nav link: the icon, the label and an optional count. */
export function NavItemContent({ icon, label, count }: { icon: IconName; label: string; count?: number | undefined }) {
  return <><Icon name={icon} /><span>{label}</span>{count ? <span className="count">{count}</span> : null}</>;
}

/** The one line calls are scheduled in. Put an input with className="text" inside, and the action after it. */
export function ComposerLine({ icon = 'cal', children, action, className }: { icon?: IconName; children: ReactNode; action?: ReactNode; className?: string | undefined }) {
  return <div className={cn('ac-composer', className)}><Icon name={icon} size={20} />{children}{action}</div>;
}

/** A labelled text input, for the rare places that need one. Never stack fields into a form in a dialog. */
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
 * One spoken line: the speaker's arch, their name, what they said and when. Without a person (the
 * same speaker again, or a room recording) the avatar column stays empty. `id` makes it a place a
 * link can go to.
 */
export function TranscriptLine({ person, name, time, children, className, id }: {
  person?: AvatarPerson | undefined; name?: ReactNode; time?: ReactNode; children: ReactNode; className?: string | undefined; id?: string | undefined;
}) {
  return (
    <div id={id} className={cn('ac-line', className)}>
      {person ? <Avatar person={person} size={26} /> : <span />}
      <div className="min-w-0">{name && <b>{name}</b>}{children}{time}</div>
    </div>
  );
}
