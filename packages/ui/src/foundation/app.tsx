/*
 * The app's building blocks: cards and widgets, a part of a page that opens in place, fields, Show more and Read more, the
 * mic level, and one of your groups as a chip. The side panel's parts are in shell/sidebar.tsx, and a note's in notes/.
 */
import { forwardRef, useId, useState, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icon';

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
 * The container for one thing on a page: surface and a line edge, no shadow. A `title` heading with an
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
 * One card on a page's water, the way the big apps build a home: its head (an icon in a tile, the `title`, then `end`, what
 * the head holds after the title: tabs, or a quiet button at its end), its body, and, only while the list in it is longer
 * than it shows, a foot that says how many more and shows them (`more`). `footEnd` sits at that foot's end, after Show N
 * more, and keeps the foot there once everything shows: a quiet toggle, as Upcoming's count of events with only you on them.
 * `foot` sits at the card's foot, under the body and before that. `bare` leaves the card out: the head and what's under it sit
 * on the page, as a row of cards does. `body` makes the body something more than a list (a tab's panel). The heading can take
 * focus (`headingRef`), for when the row that had it goes.
 */
export function Widget({ icon, title, end, foot, footEnd, more, bare = false, headingRef, body, className, children }: {
  icon: IconName; title: string; end?: ReactNode; foot?: ReactNode; footEnd?: ReactNode;
  more?: { count: number; onShow: () => void } | undefined;
  bare?: boolean | undefined; headingRef?: Ref<HTMLHeadingElement> | undefined;
  body?: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'> | undefined;
  className?: string | undefined; children: ReactNode;
}) {
  const h = useId();
  return (
    <section className={cn('ac-widget', bare && 'is-bare', className)} aria-labelledby={h}>
      <header className="ac-widget-h">
        <span className="ac-widget-ic" aria-hidden="true"><Icon name={icon} size={15} /></span>
        <h2 id={h} ref={headingRef} tabIndex={-1}>{title}</h2>
        {end}
      </header>
      <div {...body} className="ac-widget-b">{children}</div>
      {foot}
      {(more || footEnd) && (
        <footer className="ac-widget-f">
          {more && <button type="button" className="ac-widget-more" onClick={more.onShow}>Show {more.count} more</button>}
          {footEnd}
        </footer>
      )}
    </section>
  );
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

/** Show N more under a list, and Show fewer once it's all shown: a quiet text button, centred under the rows. */
export function ShowMore({ all, more, onToggle, className }: { all: boolean; more: number; onToggle: () => void; className?: string | undefined }) {
  return (
    <div className={cn('ac-more', className)}>
      <button type="button" className="lk" aria-expanded={all} onClick={onToggle}>
        {all ? 'Show fewer' : `Show ${more} more`}<Icon name={all ? 'up' : 'down'} size={15} />
      </button>
    </div>
  );
}

/**
 * More prose under a short passage, behind a quiet text button: the note's full summary under its short one. Closed
 * until pressed (`defaultOpen` starts it open). What's inside is kept out of reach of the keyboard and screen readers
 * while it's closed. The button is named by `label`.
 */
export function ReadMore({ label, children, defaultOpen = false, className }: { label: string; children: ReactNode; defaultOpen?: boolean | undefined; className?: string | undefined }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn('ac-readmore', open && 'is-open', className)}>
      <button type="button" className="ac-readmore-b" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {label}<Icon name="down" size={15} className="ac-readmore-i" />
      </button>
      <div className="ac-readmore-r">
        <div id={id} className="ac-readmore-in" inert={!open}>{children}</div>
      </div>
    </div>
  );
}

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
