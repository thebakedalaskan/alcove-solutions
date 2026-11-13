/*
 * The app's building blocks: cards and widgets, navigation and a paid plan's small sun, the palette's line, fields, notes
 * and transcript lines, note cards, Read more, the mic level, and what a transcript isn't sure of.
 */
import { forwardRef, useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Tooltip } from './overlay';
import { Avatar, Faces, type AvatarPerson } from './people';
import type { Cover } from './primitives';

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

/** The app's sections. Put router links inside, each with className="ac-nav-item"; the current one carries aria-current="page". */
export function SidebarNav({ label = 'Main', children, className }: { label?: string; children: ReactNode; className?: string | undefined }) {
  return <nav className={cn('ac-nav', className)} aria-label={label}>{children}</nav>;
}
/** What goes inside a nav link: the icon, the label and an optional count. */
export function NavItemContent({ icon, label, count }: { icon: IconName; label: string; count?: number | undefined }) {
  return <><Icon name={icon} /><span>{label}</span>{count ? <span className="count">{count}</span> : null}</>;
}

/**
 * A paid plan's own small sun, in the side panel's icon column: a 12px half sun on a 16px hairline, with a glint under
 * it. `setting` sinks it to half of that, for a plan about to end. Drawn, so it never stands for anything you press.
 */
export function SunMark({ state = 'up', className }: { state?: 'up' | 'setting' | undefined; className?: string | undefined }) {
  return (
    <span className={cn('sb-sun', state === 'setting' && 'is-setting', className)} aria-hidden="true">
      <span className="sky"><i className="sun" /></span><i className="line" /><i className="g" />
    </span>
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

/** What in a line has a press, or a tip, of its own: its time, its tools, a marker. Words it isn't sure of are still words. */
const OWN_PRESS = 'a, button, input, textarea, select, label, [role="button"], .nd-lx, [tabindex]:not(.ac-unsure)';
/** How long a press on a line's words waits for a second click, which selects a word to copy instead. */
const SECOND_CLICK_MS = 250;
/** Whether some words on the page are selected, to copy. */
function selecting(): boolean {
  const picked = getSelection();
  return !!picked && !picked.isCollapsed && picked.toString().trim() !== '';
}

/**
 * One spoken line of a note's transcript: when, the speaker's arch, their name, what they said, and `tools` for what can
 * be done with it, which wait under the pointer. Without a person (the same speaker again, or a room recording) the arch's
 * place stays empty. `id` makes it a place a link can go to. With `onPress`, pressing the line does what its time does,
 * anywhere but on something with a press or a tip of its own, and not when the press ends selecting its words, so they can
 * still be copied: it waits a quarter of a second, and a double or triple click (a word or the line, selected) calls it
 * off. Its time goes at once. It takes no tab stop, since its time is the keyboard's way in.
 */
export function TranscriptLine({ time, person, name, tools, children, className, id, onPress }: {
  time: ReactNode; person?: AvatarPerson | undefined; name?: ReactNode; tools?: ReactNode; children: ReactNode; className?: string | undefined; id?: string | undefined;
  onPress?: (() => void) | undefined;
}) {
  /* The press waiting for a second click, if there is one: this line owns its timer, and it goes with the line. */
  const waiting = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(waiting.current), []);
  const press = onPress && ((e: MouseEvent<HTMLDivElement>) => {
    // What opens from the line (a tool's menu, over the page) passes its presses through it too: they aren't on it.
    if (!(e.target instanceof Element) || !e.currentTarget.contains(e.target)) return;
    const own = e.target.closest(OWN_PRESS);
    if (own && e.currentTarget.contains(own)) return;
    // A second or third click selects a word, or the line, to copy: the first one's press doesn't happen.
    window.clearTimeout(waiting.current);
    waiting.current = undefined;
    if (e.detail > 1 || selecting()) return;
    waiting.current = window.setTimeout(() => {
      waiting.current = undefined;
      if (!selecting()) onPress();
    }, SECOND_CLICK_MS);
  });
  return (
    <div id={id} className={cn('nd-l', onPress && 'is-press', className)} onClick={press}>
      {time}
      <span className="nd-la">{person && <Avatar person={person} size={24} />}</span>
      <div className="nd-lb">{name && <p className="nd-ln">{name}</p>}<p className="nd-lp">{children}</p></div>
      <div className="nd-lx">{tools}</div>
    </div>
  );
}

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

/* ---------- Tiles and cards ---------- */

/**
 * A note as a card, in a row of them: its own small sunset as the cover (`cover`, from `coverFor` its ID), the people on
 * the call standing on the cover's lower edge (the first two), or an arch with a microphone for a recording in the room
 * (a camera for a call with nobody else on it), then its title and `when` ("Today · 14 min"). `title` is the link that
 * opens it, and it takes the whole card. `tag` says something on the cover ("Example"), and while the notes are being
 * written (`writing`) the cover breathes.
 */
export function NoteCard({ title, when, cover, people = [], room = false, tag, writing = false, className, ...rest }: {
  title: ReactNode; when: ReactNode; cover: Cover; people?: AvatarPerson[] | undefined; room?: boolean | undefined;
  tag?: string | undefined; writing?: boolean | undefined; className?: string | undefined;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'className' | 'children'>) {
  const faces = room ? [] : people.slice(0, 2);
  return (
    <div {...rest} className={cn('ac-note-card', writing && 'is-writing', className)}>
      <span className={cn('ac-note-cover', `is-${cover}`)} aria-hidden="true">
        <i className="s" /><i className="w" /><i className="g" /><i className="g b" />{tag && <span className="tag">{tag}</span>}
      </span>
      <span className="ac-note-who" aria-hidden="true">
        {faces.length ? <Faces people={faces} size={28} max={2} /> : <span className="arch"><Icon name={room ? 'mic' : 'video'} size={14} /></span>}
      </span>
      <span className="ac-note-b"><b className="ac-clamp-2">{title}</b><small>{when}</small></span>
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
