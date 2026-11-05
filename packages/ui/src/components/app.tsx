/*
 * The app's building blocks: cards, navigation, the palette's line, fields, notes and transcript lines,
 * note tiles, person cards, settings, theme previews, the mic level, and what a
 * transcript isn't sure of.
 */
import { Slot } from 'radix-ui';
import { forwardRef, useId, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Tooltip } from './overlay';
import { Avatar, Faces, type AvatarPerson } from './people';
import { ArchThumb, Chip, Meter, type Cover } from './primitives';
import type { ThemeChoice } from './theme';

/**
 * A part of a page that opens and closes in place, closed until someone opens it: its heading row (`summary`, the
 * whole row is what you press) and what's under it. Built on the browser's own details element, so the keyboard and
 * screen readers work as they expect. Folds stacked one after another sit close together.
 */
export function Fold({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string | undefined }) {
  return (
    <details className={cn('ac-fold', className)}>
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

/* ---------- Tiles and cards ---------- */

/** `children` inside `link` (an element such as the router's Link, which keeps its own props) when there is one, otherwise in a div. */
function LinkOrDiv({ link, className, children, ...aria }: {
  link: ReactElement | undefined; className: string; children: ReactNode;
  'aria-labelledby'?: string | undefined; 'aria-describedby'?: string | undefined;
}) {
  if (!link) return <div className={className}>{children}</div>;
  return <Slot.Root className={className} {...aria}><Slot.Slottable>{link}</Slot.Slottable>{children}</Slot.Root>;
}

/**
 * A note as a tile, for Record's recordings: its cover, title and `meta` (when, how long), the start of
 * the summary, then who has it and a count or state at the `end`. `faces` draws the people; `who` says it
 * in words, beside them or instead ("Only you"). Pass the router's Link as `link` and the tile opens the note.
 */
export function NoteTile({ cover, room = false, title, meta, excerpt, faces, who, end, link, className }: {
  cover: Cover; room?: boolean | undefined; title: ReactNode; meta?: ReactNode; excerpt?: ReactNode;
  faces?: AvatarPerson[] | undefined; who?: ReactNode; end?: ReactNode; link?: ReactElement | undefined; className?: string | undefined;
}) {
  const people = faces && faces.length > 0 ? faces : undefined;
  const id = useId();
  /* As a link, it's named by its title alone and described by when and its state, not by every word in it. */
  const named = link ? { 'aria-labelledby': `${id}t`, 'aria-describedby': [meta !== undefined && `${id}m`, end !== undefined && `${id}e`].filter(Boolean).join(' ') || undefined } : {};
  return (
    <LinkOrDiv link={link} className={cn('ac-note-tile', className)} {...named}>
      <div className="top">
        <ArchThumb cover={cover} room={room} width={32} />
        <div className="t"><b id={`${id}t`}>{title}</b>{meta !== undefined && <small id={`${id}m`}>{meta}</small>}</div>
      </div>
      {excerpt !== undefined && <div className="ex ac-clamp-2">{excerpt}</div>}
      {(people || who !== undefined || end !== undefined) && (
        <div className="foot">
          <span className="who">{people && <Faces people={people} size={22} />}{who}</span>
          {end !== undefined && <span id={`${id}e`} className="end ac-clamp-1">{end}</span>}
        </div>
      )}
    </LinkOrDiv>
  );
}

/** A name with no spaces (someone known only by their address) may break after its dots and @, never mid-word. */
function breakable(text: string): ReactNode {
  if (/\s/.test(text)) return text;
  const parts = text.split(/(?<=[.@])/);
  return parts.map((part, i) => <span key={i}>{part}{i < parts.length - 1 && <wbr />}</span>);
}

/**
 * Someone on your team: their arch, name, `title` (or their address) and when you last met ("Last call ·
 * today"), with icon buttons at the foot (`actions`: start a call, their notes). `tag` marks the card, as
 * "You". In a grid, every card's actions line up at the bottom.
 */
export function PersonCard({ person, name, title, last, tag, actions, className }: {
  person: AvatarPerson; name?: ReactNode; title?: ReactNode; last?: ReactNode; tag?: string | undefined; actions?: ReactNode; className?: string | undefined;
}) {
  const shown = name ?? (person.name || person.email || '');
  return (
    <div className={cn('ac-person-card', className)}>
      {tag && <Chip tone="outline" className="tag">{tag}</Chip>}
      <Avatar person={person} size={64} />
      <b className="ac-clamp-2">{typeof shown === 'string' ? breakable(shown) : shown}</b>
      {title !== undefined && <small className="ac-clamp-1">{title}</small>}
      {last !== undefined && <span className="last">{last}</span>}
      {actions !== undefined && <div className="acts">{actions}</div>}
    </div>
  );
}

/* ---------- Minutes ---------- */

/**
 * The minutes of notes left, as a card: the time left in the display face, a meter of how much of everything granted is
 * left, and what was used this month (`used`), then `children` (a row, a link). Team and Settings both show it; `id` is
 * where a link to it lands.
 */
export function MinutesCard({ id, title, left, share, used, children, className }: {
  id?: string | undefined; title: ReactNode; left: string; share: number; used: ReactNode; children?: ReactNode; className?: string | undefined;
}) {
  const h = useId();
  return (
    <section id={id} className={cn('ac-card ac-minutes', className)} aria-labelledby={h}>
      <h3 id={h}>{title}</h3>
      <p className="big">{left}<small>of notes left</small></p>
      <Meter value={share} />
      <p className="used">{used}</p>
      {children}
    </section>
  );
}

/* ---------- Settings ---------- */

/** One part of Settings: a title, a line under it if it needs one (`lead`), then its SettingRows. `id` is where the settings nav jumps to. */
export function SettingsCard({ id, title, lead, children, className }: { id?: string | undefined; title: ReactNode; lead?: ReactNode; children: ReactNode; className?: string | undefined }) {
  const h = useId();
  return (
    <section id={id} className={cn('ac-card ac-set-card', className)} aria-labelledby={h}>
      <h3 id={h}>{title}</h3>
      {lead !== undefined && <p className="lead">{lead}</p>}
      {children}
    </section>
  );
}

/**
 * One setting: what it is (`label`) and what it does (`help`) on the left, its `control` on the right: a
 * Switch, Segmented, Select or a link. A control too wide to sit beside the words goes under them. Screen
 * readers hear the label and help when they reach the control. `tone="caution"` for deleting things.
 */
export function SettingRow({ label, help, control, tone, className }: { label: ReactNode; help?: ReactNode; control: ReactNode; tone?: 'caution' | undefined; className?: string | undefined }) {
  const id = useId();
  return (
    <div className={cn('ac-set-row', tone === 'caution' && 'is-caution', className)} role="group" aria-labelledby={`${id}l`} aria-describedby={help !== undefined ? `${id}h` : undefined}>
      <div className="txt"><b id={`${id}l`}>{label}</b>{help !== undefined && <small id={`${id}h`}>{help}</small>}</div>
      <div className="ctl">{control}</div>
    </div>
  );
}

const THEME_NAME: Record<ThemeChoice, string> = { system: 'Match system', light: 'Light', dark: 'Dark' };

/** A small window drawn in one theme's own colours, whatever the page's theme is. */
function ThemeWindow({ theme }: { theme: 'light' | 'dark' }) {
  return <span className={cn('pane', theme)}><span className="w-side dark"><i /><i /><i /></span><span className="w-main"><i /><i /></span></span>;
}

/**
 * One choice of appearance: a small window in the light or the dark theme's own colours (both, side by
 * side, for `system`), named underneath. `pressed` rings the one in use. Three sit in a row.
 */
export const ThemePreview = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { theme: ThemeChoice; pressed: boolean }>(
  function ThemePreview({ theme, pressed, className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-pressed={pressed} className={cn('ac-theme', className)} {...rest}>
        <span className={cn('win', theme === 'system' && 'is-split')} aria-hidden="true">
          {theme === 'system' ? <><ThemeWindow theme="light" /><ThemeWindow theme="dark" /></> : <ThemeWindow theme={theme} />}
        </span>
        {THEME_NAME[theme]}
      </button>
    );
  });

/** The night recorder's waveform: each bar's height at full voice. */
const WAVE = [0.35, 0.65, 1, 0.73, 0.47, 0.82, 0.33];

/**
 * How loud the microphone is, from `level` (0 to 1): eight bars that fill with horizon, beside a
 * microphone choice. `stage` draws the night recorder's waveform in speak instead. It doesn't open the
 * microphone: pass it the level you measure, as often as you like.
 */
export function MicLevel({ level, stage = false, label = 'Microphone level', className }: { level: number; stage?: boolean | undefined; label?: string | undefined; className?: string | undefined }) {
  const v = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const lit = Math.round(v * 8);
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={cn('ac-mic-level', stage && 'is-stage', className)}>
      {stage
        ? WAVE.map((h, i) => <i key={i} style={{ height: `${Math.round(Math.max(0.14, h * v) * 100)}%` }} />)
        : Array.from({ length: 8 }, (_, i) => <i key={i} className={i < lit ? 'on' : undefined} />)}
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
