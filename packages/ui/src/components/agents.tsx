/*
 * Agents: what one can do (chips you press), what it receives, and the sheet an agent's `/connect` signs you in on
 * (`ac-agent-`); then the Agents page's own parts (`ag-`): agents standing on the horizon as windows, the popover each
 * opens, the question an agent asks on the sky with the levels you can lower, you and the agent joined on the horizon,
 * and on the water what your agents did and things to ask them. Stateless: the page passes data and handlers. Styles in
 * agents.css.
 */
import { forwardRef, useEffect, useId, useRef, useState, type AnchorHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { Logo } from './brand';
import { Icon, type IconName } from './icon';
import { Dots } from './motion';
import { Popover, PopoverClose } from './overlay';
import { Avatar, type AvatarPerson } from './people';
import { Button, IconButton, buttonClass, type ButtonProps, type ButtonVariant } from './primitives';

export interface AgentPermission {
  id: string;
  label: string;
  /** What it lets the agent do, said when the pointer rests on it. */
  detail: string;
}

/**
 * What an agent can do, chosen explicitly: a chip for each, ticked when it's allowed, with what it lets the agent do when
 * the pointer rests on it. On Agents, in a connected agent's popover (where each press changes it at once, and `aside`
 * says Saved beside the heading) and in making a token.
 */
export function AgentPermissions({ permissions, selected, onChange, disabled = false, aside }: {
  permissions: readonly AgentPermission[];
  selected: readonly string[];
  onChange: (id: string, on: boolean) => void;
  disabled?: boolean | undefined;
  /** Beside the heading, at its end: Saved, once a change is kept. */
  aside?: ReactNode;
}) {
  return (
    <fieldset className="ac-agent-permissions" disabled={disabled}>
      <legend>What it can do</legend>
      {aside !== undefined && <span className="ac-agent-aside">{aside}</span>}
      <div className="ac-agent-perms">
        {permissions.map((p) => {
          const on = selected.includes(p.id);
          return (
            <button key={p.id} type="button" aria-pressed={on} title={p.detail} className="ac-agent-perm" onClick={() => onChange(p.id, !on)}>
              <Icon name="check" size={13} />{p.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * What an agent receives, in one line: when an agent asks (`who` is its name), and at the foot of making a token, whose
 * script is your own (`maker={false}`).
 */
export function AgentDisclosure({ who = 'Your agent', maker = true, className }: { who?: string | undefined; maker?: boolean | undefined; className?: string | undefined }) {
  return <span className={cn('ac-agent-disclosure', className)}>{who} gets readable information from Alcove{maker ? ', under its maker’s own policies' : ''}.</span>;
}

/**
 * The sheet `/connect` shows before Agents asks: signing in, no request, or the sign-in being checked. One quiet column
 * on the theme's ground, with the mark above it.
 */
export function AgentConsentFrame({ title, children }: { title: string; children: ReactNode }) {
  return <main className="ac-agent-connect"><a href="/" aria-label="Alcove home"><Logo /></a>
    <section className="ac-agent-sheet"><h1>{title}</h1>{children}</section>
  </main>;
}

/* ------------------------------------------------------------------ the Agents page (ag-) */

/** How an agent's window stands: connected (`solid`), not yet (`dashed`), asking to connect (`asking`, in rose), or just allowed. */
export type AgentLook = 'solid' | 'dashed' | 'asking' | 'allowed';

/**
 * An agent, as a window: a square with a rounded top, as people are arches. Its mark is a plain icon for its kind, never
 * its maker's logo. `dot` says something's wrong (its access is ending, in caution) and `tick` that it's just connected.
 * `small` is the mark at the head of its popover. Decoration: the words beside it say who it is.
 */
export function AgentWindow({ icon, look = 'solid', dot = false, tick = false, small = false, className }: {
  icon: IconName; look?: AgentLook | undefined; dot?: boolean | undefined; tick?: boolean | undefined; small?: boolean | undefined; className?: string | undefined;
}) {
  return (
    <span aria-hidden="true" className={cn('ag-win', `is-${look}`, small && 'is-small', className)}>
      <Icon name={icon} />
      {dot && <i className="ag-dot" />}
      {tick && <span className="ag-tick"><Icon name="check" /></span>}
    </span>
  );
}

/** The agents on the horizon, in one line: connected ones, a half-place gap (`AgentGap`), the ones people use, then any other. */
export function AgentLine({ label, loading = false, children }: { label: string; loading?: boolean | undefined; children: ReactNode }) {
  return <ul className={cn('ag-row', loading && 'is-loading')} aria-label={label} aria-busy={loading || undefined}>{children}</ul>;
}

/** Half a place between the agents you've connected and the ones you haven't. */
export const AgentGap = () => <li aria-hidden="true" className="ag-gap" />;

/** A place on the line while it loads: an empty dashed window, breathing. */
export const AgentWaitingPlace = ({ at }: { at: number }) => (
  <li aria-hidden="true" className="ag-p is-ghost" style={{ '--d': at }}>
    <span className="ag-who"><AgentWindow icon="agent" look="dashed" /><span className="ag-n" /><span className="ag-s" /></span>
  </li>
);

/**
 * A place on the line: the agent's window is the button, its name and a quiet line under it on the water. It opens a
 * popover under the window (`children`), with a caret, sliding to stay in the window; a sheet on a phone. `caution` puts
 * the line in caution with a dot on the window. On a phone the line slides, so the one opened comes into the middle.
 */
export function AgentPlace({ place, icon, name, line, look = 'solid', caution = false, tick = false, label, popLabel, open, onOpenChange, at = 0, children }: {
  /** What the page knows this place by, to find it again (`data-place`). */
  place: string;
  icon: IconName; name: string; line?: string | undefined; look?: AgentLook | undefined; caution?: boolean | undefined; tick?: boolean | undefined;
  /** What the window says to a screen reader: its name and its line. */
  label: string;
  popLabel: string;
  open: boolean; onOpenChange: (open: boolean) => void;
  /** Its place along the line, for the order it rises in. */
  at?: number | undefined;
  children: ReactNode;
}) {
  const here = useRef<HTMLLIElement>(null);
  /* The popover keeps to the page, never over the side panel beside it. */
  const [page, setPage] = useState<Element | null>(null);
  useEffect(() => { setPage(here.current?.closest('.ag') ?? null); }, []);
  useEffect(() => { if (open) here.current?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [open]);
  return (
    <li ref={here} data-place={place} className={cn('ag-p', look === 'dashed' && 'is-yet', open && 'is-on')} style={{ '--d': at }}>
      <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="center" caret label={popLabel} within={page} className="ag-pop"
        anchor={(
          <button type="button" className="ag-who" aria-label={label}>
            <AgentWindow icon={icon} look={look} dot={caution} tick={tick} />
            <span className="ag-n">{name}</span>
            <span className={cn('ag-s', caution && 'is-caution')}>{line}</span>
          </button>
        )}>
        {children}
      </Popover>
    </li>
  );
}

/** The head of an agent's popover: its mark, what it's about and a line under it, and Close. `onBack` puts a way back first. */
export function AgentPopHead({ icon, title, sub, caution = false, tick = false, onBack }: {
  icon: IconName; title: string; sub?: string | undefined; caution?: boolean | undefined; tick?: boolean | undefined; onBack?: (() => void) | undefined;
}) {
  return (
    <header className={cn('ag-pop-h', onBack && 'has-back')}>
      {onBack && <IconButton icon="chevronLeft" size={18} label="Back" className="ag-ib is-back" onClick={onBack} />}
      <AgentWindow icon={icon} small tick={tick} />
      <span className="ag-pop-w"><b className="ac-clamp-1">{title}</b>{sub && <small className={cn('ac-clamp-1', caution && 'is-caution')}>{sub}</small>}</span>
      <PopoverClose asChild><IconButton icon="x" size={16} label="Close" className="ag-x" /></PopoverClose>
    </header>
  );
}

/** One line in a popover: what to do, or what happened. */
export const AgentPopLine = ({ children }: { children: ReactNode }) => <p className="ag-say">{children}</p>;

/** Shows only a value's first and last four characters, for a token: what's needed to tell two apart. */
const masked = (value: string) => (value.length > 12 ? `${value.slice(0, 4)}${'•'.repeat(24)}${value.slice(-4)}` : '•'.repeat(value.length));

/**
 * A value in a quiet well: Alcove's address or a command, in mono, to select whole; with `onCopy`, a copy icon at its end
 * (`copyLabel` names it). `words` is something to ask an agent, in the page's own face. `hidden` shows a token only by its ends.
 */
export function AgentWell({ value, words = false, hidden = false, onCopy, copyLabel = 'Copy', copyFocus = false }: {
  value: string; words?: boolean | undefined; hidden?: boolean | undefined; onCopy?: (() => void) | undefined; copyLabel?: string | undefined;
  /** Its copy icon takes focus as it comes: it's what to do next. */
  copyFocus?: boolean | undefined;
}) {
  const shown = hidden ? masked(value) : value;
  if (!onCopy) return <code className="ag-well">{shown}</code>;
  return (
    <div className={cn('ag-well is-copy', words && 'is-words')}>
      {words ? <span className="ac-clamp-2">{shown}</span> : <code aria-hidden={hidden || undefined}>{shown}</code>}
      {hidden && <span className="sr-only">Hidden. Copy it to use it.</span>}
      <IconButton icon="copy" size={17} label={copyLabel} className="ag-ib" autoFocus={copyFocus} onClick={onCopy} />
    </div>
  );
}

/**
 * A popover's one action, full width: a button, or with `href` a link that opens another app or, with `newTab`, a page in
 * a new tab. A link says so with an arrow.
 */
export const AgentAction = forwardRef<HTMLButtonElement, ButtonProps>(function AgentAction({ variant = 'primary', className, ...rest }, ref) {
  return <Button ref={ref} variant={variant} className={cn('ag-go', className)} {...rest} />;
});
export function AgentLink({ href, newTab = false, variant = 'primary', autoFocus = false, children, className, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'> & {
  href: string; newTab?: boolean | undefined; variant?: ButtonVariant | undefined;
}) {
  /* A link isn't focused by autoFocus as a button is: it takes focus itself, before the popover would give it to Close. */
  const here = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (autoFocus) here.current?.focus({ preventScroll: true }); }, [autoFocus]);
  return (
    <a ref={here} href={href} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={cn(buttonClass({ variant }), 'ag-go', className)} {...rest}>
      {children}<Icon name="external" size={15} />
    </a>
  );
}

/**
 * In the action's place while what it needs is on its way (Alcove's address): three dots, which fade instead with reduced
 * motion. Focus with nowhere else to be comes here, so the keys keep their place in the popover.
 */
export function AgentWaiting({ children }: { children: ReactNode }) {
  const here = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const at = document.activeElement;
    if (!at || at === document.body) here.current?.focus({ preventScroll: true });
  }, []);
  return <p ref={here} className="ag-wait" role="status" tabIndex={-1}><Dots />{children}</p>;
}

/** A row at a popover's foot that leads somewhere else: the question it answers, then where it goes. */
export function AgentPopMore({ ask, go, onClick }: { ask: string; go: string; onClick: () => void }) {
  return <button type="button" className="ag-more" onClick={onClick}><span>{ask}</span><b>{go}</b><Icon name="right" size={14} /></button>;
}

/** A popover's foot, under a hairline: a quiet action, and a fact at the other end. */
export function AgentPopFoot({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className="ag-pop-f">{children}{aside && <p>{aside}</p>}</div>;
}

/** Asked in place, inside the popover: the question, what it means, and its answers, the one that loses nothing filled. */
export function AgentAsked({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  const id = useId();
  return (
    <div className="ag-asked" role="group" aria-labelledby={id}>
      <b id={id}>{title}</b>
      <p>{children}</p>
      <div className="ag-asked-a">{actions}</div>
    </div>
  );
}

/** Saved, beside what was changed, once it's kept. Screen readers hear it as it comes. */
export const AgentSaved = ({ saved }: { saved: boolean }) => <span className="ag-saved" role="status">{saved && <><Icon name="check" size={14} />Saved</>}</span>;

/* ---------- the question an agent asks */

export interface AgentLevel { id: string; title: string; detail: string }
export interface AgentSwitch { id: string; title: string; detail: string; on: boolean }
/**
 * A part of Alcove an agent asked for, at the level it'll have: one level to choose (`levels`, with `chosen`), or things
 * to turn on one by one (`switches`). `value` says it at the row's edge, and `off` steps it back.
 */
export type AgentLevelRow = { id: string; icon: IconName; name: string; value: string; off: boolean } & (
  | { kind: 'levels'; levels: readonly AgentLevel[]; chosen: string }
  | { kind: 'switches'; switches: readonly AgentSwitch[] }
);

/** Arrow keys, Home and End go through a menu's choices. */
function onMenuKeys(e: KeyboardEvent<HTMLDivElement>) {
  const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"], [role="switch"]'));
  const at = all.findIndex((el) => el === document.activeElement);
  const to = e.key === 'ArrowDown' ? all[Math.min(all.length - 1, at + 1)] : e.key === 'ArrowUp' ? all[Math.max(0, at - 1)]
    : e.key === 'Home' ? all[0] : e.key === 'End' ? all.at(-1) : undefined;
  if (!to) return;
  e.preventDefault();
  to.focus();
}

/**
 * The parts of Alcove an agent asked for, one row each with its level at the right edge, which opens a menu of the levels
 * and what each allows, or of switches. Lowering one gives the agent less; nothing here gives it more than it asked for.
 */
export function AgentLevels({ rows, open, onOpen, onPick, onSwitch, disabled = false }: {
  rows: readonly AgentLevelRow[];
  /** The row whose menu is open. */
  open: string | undefined;
  onOpen: (row: string | undefined) => void;
  onPick: (row: string, level: string) => void;
  onSwitch: (row: string, id: string, on: boolean) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <div className="ag-lv">
      {rows.map((r) => (
        <div key={r.id} className="ag-lv-r">
          <span className="ag-lv-i"><Icon name={r.icon} size={16} /></span>
          <span className="ag-lv-n">{r.name}</span>
          <Popover open={open === r.id} onOpenChange={(on) => onOpen(on ? r.id : undefined)} side="bottom" align="end" label={r.name} className="ag-menu"
            anchor={<button type="button" className={cn('ag-lv-b', r.off && 'is-off')} aria-label={`${r.name}: ${r.value}`} disabled={disabled}><span>{r.value}</span><Icon name="down" size={15} /></button>}>
            {r.kind === 'levels' ? (
              <div role="listbox" aria-label={r.name} onKeyDown={onMenuKeys}>
                {r.levels.map((l) => {
                  const on = l.id === r.chosen;
                  return (
                    <button key={l.id} type="button" role="option" aria-selected={on} tabIndex={on ? 0 : -1} className="ag-o" onClick={() => onPick(r.id, l.id)}>
                      <span><b>{l.title}</b><small>{l.detail}</small></span>
                      <span className="ag-o-k">{on && <Icon name="check" size={16} />}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div role="group" aria-label={r.name} onKeyDown={onMenuKeys}>
                {r.switches.map((x) => (
                  <button key={x.id} type="button" role="switch" aria-checked={x.on} className="ag-o is-sw" onClick={() => onSwitch(r.id, x.id, !x.on)}>
                    <span><b>{x.title}</b><small>{x.detail}</small></span>
                    <span className="ac-switch" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </Popover>
        </div>
      ))}
    </div>
  );
}

/** How the agent and you stand together on the horizon: it's asking, you've let it in, or its request ended. */
export type AgentPairState = 'asking' | 'joined' | 'ended';
const PAIR_LINK: Record<AgentPairState, IconName> = { asking: 'plug', joined: 'check', ended: 'hourglass' };
const PAIR_LOOK: Record<AgentPairState, AgentLook> = { asking: 'asking', joined: 'allowed', ended: 'dashed' };

/**
 * The agent and you, together on the horizon in place of the line: its window and your arch, joined by a line with a
 * mark in the middle. While it asks, the line is dashed rose with a plug (a decision waiting on you) and its window is
 * outlined in rose; allowed, the line closes, solid, with a tick; a request that ended leaves it dashed and grey.
 */
export function AgentPair({ icon, name, line, me, email, state }: {
  icon: IconName; name: string; line: string; me: AvatarPerson; email: string; state: AgentPairState;
}) {
  const label = state === 'joined' ? `${name} and you, connected` : state === 'ended' ? `${name}, not connected` : `${name} is asking to connect to you`;
  return (
    <div className={cn('ag-pair', `is-${state}`)} role="img" aria-label={label}>
      <div className="ag-pp"><AgentWindow icon={icon} look={PAIR_LOOK[state]} /><span className="ag-n">{name}</span><span className="ag-s">{line}</span></div>
      <span className="ag-link"><span className="ag-link-c"><Icon name={PAIR_LINK[state]} /></span></span>
      <div className="ag-pp"><span className="ag-arch"><Avatar person={me} size={76} /></span><span className="ag-n">You</span><span className="ag-s">{email}</span></div>
    </div>
  );
}

/* ---------- on the water */

/** What a row of what your agents did is about: reading (quiet), a booked call (time), a follow-up, or a decision. */
export type AgentDidTone = 'quiet' | 'time' | 'follow' | 'decision';

/** A day of what your agents did: Today, Yesterday, Mon 2 Nov. */
export function AgentDay({ day, children }: { day: string; children: ReactNode }) {
  return <><h3 className="ag-day">{day}</h3><ul className="ag-rows">{children}</ul></>;
}

/**
 * One thing an agent did: a mark tinted by what it's about, a sentence (`children`, with what it's about a link to open
 * it), a quiet second line, and the time in a fixed column.
 */
export function AgentDid({ icon, tone = 'quiet', at, time, sub, children }: {
  icon: IconName; tone?: AgentDidTone | undefined; at: string; time: string; sub?: ReactNode; children: ReactNode;
}) {
  return (
    <li className="ag-r">
      <span className={cn('ag-k', `is-${tone}`)}><Icon name={icon} size={16} /></span>
      <p className="ag-r-t">{children}{sub && <small>{sub}</small>}</p>
      <time className="ag-r-w" dateTime={at}>{time}</time>
    </li>
  );
}

/**
 * What your agents did while there's nothing in it: one row where the first will be, in a row's own shape, never a
 * drawing in the middle of the column. Its mark is an empty window waiting for an agent, or a caution mark when it didn't
 * load (`problem`); `children` is its quiet second line, and `action` (Try again) sits at its end.
 */
export function AgentNone({ title, problem = false, action, children }: {
  title: string; problem?: boolean | undefined; action?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="ag-none">
      <span className={cn('ag-k', problem ? 'is-caution' : 'is-wait')}><Icon name={problem ? 'alert' : 'agent'} size={problem ? 16 : 15} /></span>
      <p className="ag-r-t"><b>{title}</b>{children && <small>{children}</small>}</p>
      {action}
    </div>
  );
}

/**
 * Something to ask an agent: a mark for what the agent will do, tinted as the row it will make in what your agents did,
 * the question, and Copy at its end. Once an agent is connected, `sub` says which can do it (`can`, with a tick) or what
 * they can't.
 */
export function AgentQuestion({ icon, tone = 'quiet', question, sub, can = false, onCopy }: {
  icon: IconName; tone?: AgentDidTone | undefined; question: string; sub?: string | undefined; can?: boolean | undefined; onCopy: () => void;
}) {
  const id = useId();
  return (
    <li className="ag-q">
      <span className={cn('ag-k', `is-${tone}`)}><Icon name={icon} size={16} /></span>
      <p><span id={id}>“{question}”</span>{sub && <small>{can && <Icon name="check" size={13} />}{sub}</small>}</p>
      <IconButton icon="copy" size={17} label="Copy the question" aria-describedby={id} className="ag-ib" onClick={onCopy} />
    </li>
  );
}

