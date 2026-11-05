/*
 * Settings is one long page with no cards: a part is a heading over its rows, and every row is a label and a control on
 * one axis, so the eye runs straight down. Everything here is stateless, taking plain data and handlers. styles/settings.css.
 */
import { forwardRef, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type MouseEvent, type MouseEventHandler, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import type { ThemeChoice } from './theme';

/** One part of Settings: its heading, what it's limited to if that isn't the whole account (`tag`), then its rows. `id` is where the index jumps to. */
export function SettingsPart({ id, title, tag, children, className }: { id?: string | undefined; title: ReactNode; tag?: ReactNode; children: ReactNode; className?: string | undefined }) {
  const h = useId();
  return (
    <section id={id} tabIndex={-1} className={cn('set-part', className)} aria-labelledby={h}>
      <div className="set-ph"><h2 id={h}>{title}</h2>{tag !== undefined && <span>{tag}</span>}</div>
      {children}
    </section>
  );
}

export interface SettingRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode;
  /** Drawn before the label: a provider's mark, or an icon. */
  mark?: ReactNode;
  /** What it does, when that needs saying. */
  help?: ReactNode;
  /** The help says what's wrong. */
  problem?: boolean | undefined;
  /** On the axis every row shares: a Switch, Segmented, Select, SettingFact, a link. */
  control?: ReactNode;
  /** Beside the axis for a moment once a change is kept. */
  saved?: ReactNode;
  /** The control takes the width, under the label, on a phone. */
  wide?: boolean | undefined;
  /** Something sits under the control: the label stays level with the control itself. */
  stack?: boolean | undefined;
  /** Waiting on something else: its choice stays as it is, greyed out. */
  off?: boolean | undefined;
  /** Pressing the setting's name does what the control does. The help is there to read, and selecting either isn't a press. */
  onLabel?: MouseEventHandler<HTMLDivElement> | undefined;
  /** Drawn on the row itself, such as a SunLine on its hairline. */
  children?: ReactNode;
}

/** How far the pointer can move between going down and coming up and it's still a press. */
const STILL_PX = 4;
/** A drag ends in a click too, so one that moved or left words selected isn't a press. A double click stays two presses, as on a label. */
function pressed(e: MouseEvent, from: { x: number; y: number }): boolean {
  if (e.target instanceof Element && e.target.closest('.set-h')) return false;
  if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > STILL_PX) return false;
  return e.detail > 1 || getSelection()?.isCollapsed !== false;
}

/**
 * One setting: what it is and what it does, then its `control`. Screen readers hear the label and help when they reach
 * the control. A row that keeps focus when its control goes takes `tabIndex={-1}`, and `ref`.
 */
export const SettingRow = forwardRef<HTMLDivElement, SettingRowProps>(function SettingRow(
  { label, mark, help, problem = false, control, saved, wide = false, stack = false, off = false, onLabel, children, className, ...rest }, ref
) {
  const id = useId();
  const from = useRef({ x: 0, y: 0 });
  return (
    <div {...rest} ref={ref} className={cn('set-r', wide && 'is-wide', stack && 'is-stack', off && 'is-off', onLabel && 'is-press', className)}
      role="group" aria-labelledby={`${id}l`} aria-describedby={help === undefined ? undefined : `${id}h`}>
      <div className="set-l" onPointerDown={(e) => { from.current = { x: e.clientX, y: e.clientY }; }} onClick={onLabel && ((e) => { if (pressed(e, from.current)) onLabel(e); })}>
        <div className="set-tx">
          <p id={`${id}l`} className="set-t">{mark}{label}</p>
          {help !== undefined && <p id={`${id}h`} className={cn('set-h', problem && 'is-no')}>{help}</p>}
        </div>
        {saved !== undefined && <span className="set-sv" aria-hidden="true"><Icon name="check" size={14} />{saved}</span>}
      </div>
      <div className="set-c">{control}</div>
      {children}
    </div>
  );
});

/** What a control's place holds when there's nothing to change. `tone`: yes when it's in order, no when it's a problem. */
export function SettingFact({ icon, tone, title, children }: { icon?: IconName | undefined; tone?: 'yes' | 'no' | undefined; title?: string | undefined; children: ReactNode }) {
  return <span className={cn('set-f', tone && `is-${tone}`)} title={title}>{icon && <Icon name={icon} size={15} />}{children}</span>;
}

/**
 * How much of your time is left, drawn on a row's own hairline as a sun `share` of the way along it (0 to 1), with the
 * line lit behind it. At nothing it has set, and a little of its light is left at the start of the line.
 */
export function SunLine({ share }: { share: number }) {
  const v = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
  return (
    <span className={cn('set-on', v === 0 && 'is-set')} style={{ '--at': `calc(15px + (100% - 30px) * ${v})` }} aria-hidden="true">
      <span className="lit" /><span className="sun" /><span className="ref"><i /><i /></span>
    </span>
  );
}

const THEME_NAME: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** A small evening in one theme's colours, whatever the page's theme is. `corner`: only its far corner, laid over another. */
function SmallEvening({ theme, corner = false }: { theme: 'light' | 'dark'; corner?: boolean | undefined }) {
  return (
    <span className={cn('set-art', `is-${theme}`, corner && 'is-corner')}>
      <i className="sky" /><i className="sea" /><i className="glow" /><span className="up"><i className="sun" /></span><i className="rim" />
      <i className="g g1" /><i className="g g2" /><i className="g g3" />
      {theme === 'light' ? <><i className="cloud c1" /><i className="cloud c2" /></> : <>{!corner && <i className="star s1" />}<i className="star s2" /><i className="star s3" /></>}
    </span>
  );
}

/** One choice of appearance: a small evening in its own colours (both, for `system`), named underneath. `pressed` rings the one in use. Three sit in a row. */
export const ThemePreview = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { theme: ThemeChoice; pressed: boolean }>(
  function ThemePreview({ theme, pressed, className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-pressed={pressed} className={cn('set-eve', className)} {...rest}>
        <span className="set-win" aria-hidden="true">
          <SmallEvening theme={theme === 'dark' ? 'dark' : 'light'} />
          {theme === 'system' && <SmallEvening theme="dark" corner />}
        </span>
        {THEME_NAME[theme]}
      </button>
    );
  });
