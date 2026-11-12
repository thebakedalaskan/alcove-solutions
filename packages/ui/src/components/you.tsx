/*
 * Your menu, at the top right of every page and in the phone's top bar. Your face (YouButton) opens it: you, standing on the
 * horizon in the last of the light, Settings' own moment in small (YouMenu), then what you reach for from any page, a row
 * each (YouRow): Pause notifications, whose choices open in place under it (YouPause), the theme as three small evenings
 * (YouTheme), Settings (a link, which the app's router renders: YouLink), Take the tour and Sign out, with a hairline
 * between the groups (YouRule). When signing out would delete something on this device, it asks in place of the rows
 * (YouAsk). A popover on a wide screen; on a phone the same menu in the kit's Sheet (`sheet`), which then rises from the
 * foot of the window. ↓ and ↑ move between everything in it. Escape is the popover's or the sheet's, and steps back one
 * thing at a time before the menu closes through their `onEscapeKeyDown`: the question goes back to the rows, and the
 * pause's choices shut. Everything here is stateless, taking plain data and handlers. styles/you.css (`ym-`).
 */
import { forwardRef, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Avatar, type AvatarPerson } from './people';
import { Button, Spinner } from './primitives';
import { ThemePreview } from './settings';
import { THEMES, type ThemeChoice } from './theme';

/** Everything the arrows move between is marked `data-ym-row`: each row, choice, evening and button. */
const ROWS = '[data-ym-row]';

/** Whether focus moving away (`e.relatedTarget`) stays inside what lost it. */
const staysIn = (e: FocusEvent<HTMLElement>): boolean => e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget);

/**
 * Your face at the top right, and in the phone's top bar: the button that opens your menu. It forwards its ref and every
 * button prop, so a Popover's trigger can take it. A ring follows the arch while it's hovered, and while the menu is open
 * (`aria-expanded`). Its label is your name and your menu. While notifications are paused, `until` says until when, as
 * YouPause takes it ("17:12", "tomorrow 9:00"): a small crossed-out bell sits on its lower right, and its label and its
 * tooltip say until when.
 */
export const YouButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'> & {
  person: AvatarPerson; size?: number | undefined; until?: string | null | undefined;
}>(function YouButton({ person, size = 32, until, className, style, type = 'button', ...rest }, ref) {
  const name = person.name || person.email || 'You';
  const paused = until ? `Notifications paused until ${until}` : undefined;
  return (
    <button ref={ref} type={type} aria-haspopup="dialog" {...rest} aria-label={paused ? `${name}, your menu. ${paused}` : `${name}, your menu`} title={paused}
      className={cn('ym-me', className)} style={{ '--ym-size': `${size}px`, ...style }}>
      <Avatar person={person} size={size} />
      {paused && <span className="ym-zz" aria-hidden="true"><Icon name="bellOff" size={11} /></span>}
    </button>
  );
});

/**
 * Your menu: you, standing on the horizon in the last of the light (Settings' moment, in small), your name and address
 * beside you, then `children`, its rows. ↓ and ↑ move between everything in it, round from either end. It's 300px wide, so
 * the popover round it is 312. `sheet` is for the phone, inside the kit's Sheet: taller rows and larger evenings, no width
 * of its own, and the Sheet holding it rises from the foot of the window with a grab handle.
 */
export function YouMenu({ person, children, sheet = false }: { person: AvatarPerson; children: ReactNode; sheet?: boolean | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  /** Focus is somewhere in the menu. */
  const inside = useRef(false);
  /* What had focus went away with what it was part of (the question, a choice): the menu keeps it, so the keys still work. */
  useLayoutEffect(() => {
    const el = root.current;
    const at = document.activeElement;
    if (el && inside.current && (at === null || at === document.body)) el.focus({ preventScroll: true });
  });
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ROWS))
      .filter((el) => el.getClientRects().length > 0 && !(el instanceof HTMLButtonElement && el.disabled));
    if (!all.length) return;
    e.preventDefault();
    const at = all.findIndex((el) => el === document.activeElement);
    const to = e.key === 'ArrowDown' ? all[(at + 1) % all.length] : all[at <= 0 ? all.length - 1 : at - 1];
    to?.focus();
  };
  const name = person.name || person.email || '';
  const mail = person.name ? person.email : undefined;
  return (
    <div ref={root} tabIndex={-1} className={cn('ym', sheet && 'is-sheet')} onKeyDown={keys}
      onFocus={() => { inside.current = true; }} onBlur={(e) => { if (!staysIn(e)) inside.current = false; }}>
      <div className="ym-head">
        <span className="ym-sky" aria-hidden="true"><i className="sky" /><i className="sea" /><i className="glow" /><i className="rim" /></span>
        <span className="ym-you"><Avatar person={person} size={40} /><span className="ym-gl" aria-hidden="true"><i /><i /><i /></span></span>
        <div className="ym-who">
          <p className="ym-name ac-clamp-1" title={name}>{name}</p>
          {mail && <p className="ym-mail ac-clamp-1" title={mail}>{mail}</p>}
        </div>
      </div>
      <div className="ym-rows">{children}</div>
    </div>
  );
}

/**
 * One row: an 18px icon, its words, and what ends it (`end`) in a column of its own at the right. `expanded` makes it a
 * row that opens something under it, as Pause notifications does: a chevron at its end, which turns while it's open, and
 * the row stays lit.
 */
export const YouRow = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName; label: ReactNode; end?: ReactNode | undefined; expanded?: boolean | undefined;
}>(function YouRow({ icon, label, end, expanded, className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-expanded={expanded} className={cn('ym-row', expanded && 'is-open', className)} data-ym-row="" {...rest}>
      <Icon name={icon} size={18} />
      <span className="ac-clamp-1">{label}</span>
      <span className="ym-end">{end}{expanded !== undefined && <Icon name="down" size={16} className="ym-chev" />}</span>
    </button>
  );
});

/**
 * What a row that goes somewhere gives the app's router link to render, as the Calls page's parts give theirs (`LinkRender`):
 * its class, what it shows, and the mark ↓ and ↑ move by.
 */
export interface YouLinkProps { className: string; children: ReactNode; 'data-ym-row': '' }

/**
 * A row that goes somewhere, as Settings does: YouRow's icon and words, as a link. `link` renders it as the app's own router
 * link with the props it's given, so it stays a link: ⌘-click, Ctrl-click and the middle button open it in a new tab. Close
 * the menu in its `onClick` only when the press isn't one of those.
 */
export function YouLink({ icon, label, link }: { icon: IconName; label: ReactNode; link: (props: YouLinkProps) => ReactNode }) {
  return <>{link({ className: 'ym-row', 'data-ym-row': '', children: <><Icon name={icon} size={18} /><span className="ac-clamp-1">{label}</span></> })}</>;
}

/** A hairline between the menu's groups of rows. */
export function YouRule() {
  return <div className="ym-rule" role="separator" />;
}

/**
 * Pause notifications. Closed, a row that opens its `choices` in place under it (`open`), each with the time it would end
 * (`ends`) in a column of its own. Paused (`until`, as it's said: "17:12", "tomorrow 9:00"), a row that says until when,
 * its bell crossed out, with Resume at its end. `pending` while a change saves: a choice or Resume pressed meanwhile does
 * nothing. Escape should shut the choices before it closes the menu: the popover's or sheet's `onEscapeKeyDown` calls
 * `onOpenChange(false)` while they're open. Focus never falls out of it as one row takes another's place.
 */
export function YouPause({ until, open, onOpenChange, choices, onPause, onResume, pending = false }: {
  until: string | null; open: boolean; onOpenChange: (open: boolean) => void;
  choices: readonly { id: string; label: string; ends: string }[];
  onPause: (id: string) => void; onResume: () => void; pending?: boolean | undefined;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const inside = useRef(false);
  const paused = until !== null;
  const showing = !paused && open;
  /* A choice pressed becomes Resume, and Resume or Escape becomes the row: focus goes to what took its place. */
  useLayoutEffect(() => {
    const el = box.current;
    const at = document.activeElement;
    if (!el || !inside.current || (at && el.contains(at))) return;
    el.querySelector<HTMLElement>(ROWS)?.focus({ preventScroll: true });
  }, [paused, showing]);
  return (
    <div ref={box} className="ym-pause" onFocus={() => { inside.current = true; }} onBlur={(e) => { if (!staysIn(e)) inside.current = false; }}>
      {paused ? (
        <div className="ym-row is-paused">
          <Icon name="bellOff" size={18} />
          <span className="ac-clamp-2">Paused until <b>{until}</b></span>
          <span className="ym-end">
            <Button size="xs" className="ym-resume" aria-label="Resume notifications" aria-disabled={pending || undefined} data-ym-row=""
              onClick={() => { if (!pending) onResume(); }}>Resume</Button>
          </span>
        </div>
      ) : (
        <YouRow icon="bell" label="Pause notifications" expanded={open} aria-controls={showing ? id : undefined} onClick={() => onOpenChange(!open)} />
      )}
      {showing && (
        <div id={id} className="ym-opts" role="group" aria-label="How long to pause">
          {choices.map((c) => (
            <button key={c.id} type="button" className="ym-opt" aria-disabled={pending || undefined} data-ym-row="" onClick={() => { if (!pending) onPause(c.id); }}>
              <span className="ac-clamp-1">{c.label}</span><span className="ym-ends">{c.ends}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Theme: the three small evenings Settings › You › Appearance draws, small and named by their tooltips, the one in use ringed. */
export function YouTheme({ theme, onChange }: { theme: ThemeChoice; onChange: (theme: ThemeChoice) => void }) {
  return (
    <div className="ym-row">
      <Icon name="sunMoon" size={18} />
      <span className="ac-clamp-1">Theme</span>
      <span className="ym-end">
        <span className="ym-eves" role="group" aria-label="Theme">
          {THEMES.map((t) => <ThemePreview key={t} small theme={t} pressed={theme === t} data-ym-row="" onClick={() => onChange(t)} />)}
        </span>
      </span>
    </div>
  );
}

/**
 * Sign out, asking in place of the rows when it would delete something on this device, in the words Settings' sky uses:
 * what it deletes (`says`), each of `lines` under it, then Stay signed in (focused, the filled one), Copy what you wrote
 * (only with `onCopy`; `copying` while it copies) and the way out (`signOutLabel`). While it signs out (`pending`) it says
 * so, and presses do nothing, with focus staying where it is. Escape should stay too, through the popover's or sheet's
 * `onEscapeKeyDown`, and do nothing while it signs out. Once `onStay` puts the rows back, focus belongs on Sign out: give
 * its YouRow `autoFocus`, or focus it by its ref.
 */
export function YouAsk({ says, lines, signOutLabel, onStay, onSignOut, onCopy, copying = false, pending = false }: {
  says: string; lines: readonly string[]; signOutLabel: string;
  onStay: () => void; onSignOut: () => void; onCopy?: (() => void) | undefined;
  copying?: boolean | undefined; pending?: boolean | undefined;
}) {
  const title = useId();
  const stay = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { stay.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="ym-ask" role="group" aria-labelledby={title}>
      <b id={title}>{says}</b>
      {lines.map((l) => <p key={l}>{l}</p>)}
      <div className="ym-ask-a">
        {/* aria-disabled, not disabled, while it signs out: focus stays on what was pressed. */}
        <Button ref={stay} variant="primary" aria-disabled={pending || undefined} data-ym-row="" onClick={() => { if (!pending) onStay(); }}>Stay signed in</Button>
        {onCopy && (
          <Button icon={copying ? undefined : 'copy'} aria-disabled={pending || copying || undefined} data-ym-row="" onClick={() => { if (!pending && !copying) onCopy(); }}>
            {copying && <Spinner />}{copying ? 'Copying' : 'Copy what you wrote'}
          </Button>
        )}
        <Button variant="quiet" className="ym-out" aria-disabled={pending || undefined} data-ym-row="" onClick={() => { if (!pending) onSignOut(); }}>
          {pending && <Spinner />}{pending ? 'Signing out' : signOutLabel}
        </Button>
      </div>
    </div>
  );
}
