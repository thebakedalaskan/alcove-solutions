/*
 * Settings is seven groups on one page: a group is a heading over one or two panels, and inside a panel each row is what
 * it is on the left and its control at the panel's right edge, with hairlines and space between them, never a card per
 * row. What you set up once opens in place inside its panel, with a foot that closes it. Payments list at a panel's foot,
 * each with what can be done with it (a receipt opens checkout's PaymentReceipt). Everything here is stateless, taking
 * plain data and handlers. styles/settings.css.
 */
import { forwardRef, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type MouseEvent, type MouseEventHandler, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Tooltip } from './overlay';
import { IconButton } from './primitives';
import type { ThemeChoice } from './theme';

/**
 * One group of Settings: its heading, what it's limited to when that isn't the whole account (`tag`: an icon and its
 * words, such as a laptop and This browser), then a panel or two. `id` is where the index and the address jump to.
 */
export function SettingsGroup({ id, title, tag, className, children }: { id: string; title: ReactNode; tag?: ReactNode; className?: string | undefined; children: ReactNode }) {
  const h = useId();
  return (
    <section id={id} tabIndex={-1} className={cn('set-grp', className)} aria-labelledby={h}>
      <div className="set-grh"><h2 id={h}>{title}</h2>{tag !== undefined && <span className="set-tag">{tag}</span>}</div>
      {children}
    </section>
  );
}

/**
 * One panel: a small heading over it when it needs one (`title`, with its own `tag`), then its rows, each after the first
 * on a hairline. Anything that shouldn't sit on a hairline takes `is-flush`. With `id` it's somewhere the address can
 * jump to.
 */
export function SettingsPanel({ id, title, tag, className, children }: { id?: string | undefined; title?: ReactNode; tag?: ReactNode; className?: string | undefined; children: ReactNode }) {
  const h = useId();
  const titled = title !== undefined;
  return (
    <div id={id} tabIndex={id === undefined ? undefined : -1} className={cn('set-blk', className)} role={titled ? 'group' : undefined} aria-labelledby={titled ? h : undefined}>
      {(titled || tag !== undefined) && <div className="set-bh">{titled && <h3 id={h}>{title}</h3>}{tag !== undefined && <span className="set-tag">{tag}</span>}</div>}
      <div className="set-pn">{children}</div>
    </div>
  );
}

export interface SettingRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode;
  /** Drawn before the label: a provider's mark, a SettingTile, or an icon. The help lines up under the label. */
  mark?: ReactNode;
  /** What it does, when that needs saying. */
  help?: ReactNode;
  /** The help says what's wrong. */
  problem?: boolean | undefined;
  /** The help says time is short (less than an hour of notes, a plan about to end), in the sun's warmth. */
  warm?: boolean | undefined;
  /** At the panel's right edge: a Switch, Segmented, Select, SettingFact, a link, a button or two. */
  control?: ReactNode;
  /** Beside the control for a moment once a change is kept. */
  saved?: ReactNode;
  /** A requested change is not saved until its own answer confirms it. */
  saveState?: 'saving' | 'saved' | 'failed' | undefined;
  /** The control takes a wider column (three evenings, a folder, files), and the width under the label on a phone. */
  wide?: boolean | undefined;
  /** On a phone the control goes under the label, so a long help keeps its measure: two buttons, or a fact and a button. */
  under?: boolean | undefined;
  /** Something sits under the control: the label stays level with the control itself. */
  stack?: boolean | undefined;
  /** Waiting on something else: its choice stays as it is, greyed out. */
  off?: boolean | undefined;
  /** Nested under the connection above it, and its hairline starts there too. Not on a phone. */
  sub?: boolean | undefined;
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

/** Saving…, Saved or Couldn't confirm, for a moment, beside what was pressed. Screen readers hear it from the page's own status line. */
function SaveSign({ saved, saveState, className }: { saved: ReactNode; saveState: 'saving' | 'saved' | 'failed' | undefined; className?: string | undefined }) {
  return (
    <span className={cn('set-sv', saveState === 'failed' && 'is-failed', className)} aria-hidden="true">
      {saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Couldn’t confirm' : <><Icon name="check" size={14} />{saved ?? 'Saved'}</>}
    </span>
  );
}

/**
 * One setting: what it is and what it does, then its `control` at the panel's right edge. Screen readers hear the label
 * and help when they reach the control. A row that keeps focus when its control goes takes `tabIndex={-1}`, and `ref`.
 */
export const SettingRow = forwardRef<HTMLDivElement, SettingRowProps>(function SettingRow(
  { label, mark, help, problem = false, warm = false, control, saved, saveState, wide = false, under = false, stack = false, off = false, sub = false, onLabel, children, className, ...rest }, ref
) {
  const id = useId();
  const from = useRef({ x: 0, y: 0 });
  return (
    <div {...rest} ref={ref} className={cn('set-r', wide && 'is-wide', under && 'is-under', stack && 'is-stack', off && 'is-off', sub && 'is-sub', onLabel && 'is-press', className)}
      role="group" aria-labelledby={`${id}l`} aria-describedby={help === undefined ? undefined : `${id}h`}>
      <div className="set-l" onPointerDown={(e) => { from.current = { x: e.clientX, y: e.clientY }; }} onClick={onLabel && ((e) => { if (pressed(e, from.current)) onLabel(e); })}>
        <p id={`${id}l`} className="set-t">{mark}{label}</p>
        {help !== undefined && <p id={`${id}h`} className={cn('set-h', problem && 'is-no', warm && !problem && 'is-warm')}>{help}</p>}
      </div>
      <div className="set-c">
        <div className="set-ctl">
          {control}
          {(saved !== undefined || saveState) && <SaveSign saved={saved} saveState={saveState} />}
        </div>
      </div>
      {children}
    </div>
  );
});

/** What a control's place holds when there's nothing to change. `tone`: yes when it's in order, no when it's a problem. */
export function SettingFact({ icon, tone, title, children }: { icon?: IconName | undefined; tone?: 'yes' | 'no' | undefined; title?: string | undefined; children: ReactNode }) {
  return <span className={cn('set-f', tone && `is-${tone}`)} title={title}>{icon && <Icon name={icon} size={15} />}{children}</span>;
}

/** A connection's own mark, as a row's `mark`: a small tile holding an icon, such as the agent on Agents' row. */
export function SettingTile({ icon }: { icon: IconName }) {
  return <span className="set-tile" aria-hidden="true"><Icon name={icon} size={17} /></span>;
}

/**
 * Something said inside a panel, on no hairline of its own: what just happened (back from Google, Pro renewed), or what's
 * in the way (`caution`). The icon says which unless `icon` says otherwise. `action` is what to do about it (Make room), at
 * the note's end and under its words on a phone. With `onDismiss` it stays until its × is pressed, named by `dismissLabel`.
 */
export function SettingNote({ icon, tone = 'info', children, className, action, onDismiss, dismissLabel = 'Dismiss', ...rest }: {
  icon?: IconName | undefined; tone?: 'info' | 'caution' | undefined; children: ReactNode; className?: string | undefined;
  action?: ReactNode; onDismiss?: (() => void) | undefined; dismissLabel?: string | undefined;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  const acts = action !== undefined && action !== null && action !== false;
  return (
    <div {...rest} className={cn('set-note is-flush', tone === 'caution' && 'is-caution', acts && 'has-a', onDismiss && 'has-x', className)}>
      <Icon name={icon ?? (tone === 'caution' ? 'alert' : 'info')} size={17} /><p>{children}</p>
      {acts && <div className="set-note-a">{action}</div>}
      {onDismiss && <IconButton icon="x" size={16} label={dismissLabel} className="set-note-x" onClick={onDismiss} />}
    </div>
  );
}

/**
 * Payments, at the foot of a panel: a small heading (`title`), then each a PaymentRow on its own hairline. A list longer
 * than a few puts ShowMore after its rows.
 */
export function SettingPayments({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string | undefined }) {
  const h = useId();
  return (
    <div className={cn('set-pays', className)} role="group" aria-labelledby={h}>
      <p id={h} className="set-pays-h">{title}</p>
      {children}
    </div>
  );
}

export interface PaymentRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The network's mark (a CryptoMark), or an Icon where there's no network to show. */
  mark: ReactNode;
  /** What it was for: Pro, 12 months. */
  label: ReactNode;
  /** How much and when, or how it stands: 144.00 USDC on Base · 4 Nov 2026. */
  detail: ReactNode;
  /** `wait`: on its way (horizon). `problem`: something isn't right (caution). */
  tone?: 'wait' | 'problem' | undefined;
  /** At the row's end: Receipt, Open, a cancel. */
  actions?: ReactNode;
}

/** One payment: its mark, what it was for, how much and when, and what can be done with it, in a fixed column. */
export function PaymentRow({ mark, label, detail, tone, actions, className, ...rest }: PaymentRowProps) {
  const id = useId();
  return (
    <div {...rest} className={cn('set-pay', className)} role="group" aria-labelledby={`${id}l`} aria-describedby={`${id}d`}>
      <span className="set-pay-m" aria-hidden="true">{mark}</span>
      <span className="set-pay-t">
        <b id={`${id}l`} className="ac-clamp-1">{label}</b>
        <small id={`${id}d`} className={tone && `is-${tone}`}>{detail}</small>
      </span>
      {actions !== undefined && <span className="set-pay-a">{actions}</span>}
    </div>
  );
}

/**
 * Something opened in place inside a panel, such as asking whether to refund Pro: its `title` and what it is (`help`), then
 * what to do. A SettingFoot after it closes it.
 */
export function SettingStep({ title, help, children, className }: { title: ReactNode; help?: ReactNode; children?: ReactNode; className?: string | undefined }) {
  const h = useId();
  return (
    <div className={cn('set-step', className)} role="group" aria-labelledby={h}>
      <p id={h} className="set-step-t">{title}</p>
      {help !== undefined && <p className="set-step-h">{help}</p>}
      {children}
    </div>
  );
}

/**
 * The foot of something open in place: a short line to know (`children`), and its buttons at the right (`actions`),
 * which go under the line on a phone. `sub` lines it up with the rows nested above it.
 */
export function SettingFoot({ children, actions, sub = false, className }: { children?: ReactNode; actions?: ReactNode; sub?: boolean | undefined; className?: string | undefined }) {
  return (
    <div className={cn('set-foot', sub && 'is-sub', className)}>
      {children !== undefined && <p>{children}</p>}
      {actions !== undefined && <div className="set-foot-a">{actions}</div>}
    </div>
  );
}

export interface AlertTableRow {
  /** What `onChange` names. */
  id: string;
  label: string;
  /** When it applies, under the label: When you host. */
  note?: string | undefined;
  icon: IconName;
  /** On or off, or null where an alert doesn't apply. */
  alert: boolean | null;
  /** On or off, or null where a sound doesn't apply. */
  sound: boolean | null;
  /** A change on its way, kept, or not confirmed: said at the end of the row's label. */
  saveState?: 'saving' | 'saved' | 'failed' | undefined;
}

export interface AlertTableGroup {
  /** In a call, Outside a call. The first group's title heads the columns. */
  title: string;
  rows: readonly AlertTableRow[];
}

/** The two ways something can reach you. */
export type AlertWay = 'alert' | 'sound';

/** One tick: a real checkbox, named for its row and its way (Mentions: alert). */
function Tick({ row, way, on, disabled, onChange }: { row: AlertTableRow; way: AlertWay; on: boolean; disabled: boolean; onChange: (id: string, way: AlertWay, on: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={`${row.label}: ${way}`} disabled={disabled} className="set-ck" onClick={() => onChange(row.id, way, !on)}>
      <Icon name="check" size={14} />
    </button>
  );
}

/**
 * What reaches you: each thing that can reach you said once, with its two ways side by side, Alert (from the browser when
 * Alcove is in another tab; for replies and mentions in a call, also a brief alert on screen) and Sound, in `groups` (In a
 * call, Outside a call). A way that
 * doesn't apply leaves its cell empty. `soundOff` dims the Sound column and holds its ticks as they are; `disabled` holds
 * every tick, while the choices aren't known yet. A row's Saving…, Saved or Couldn't confirm takes its note's line for a
 * moment, so it never needs room of its own. `label` names the whole table for screen readers. It sits in a SettingsPanel
 * of its own.
 */
export function AlertTable({ groups, soundOff = false, disabled = false, label, onChange }: {
  groups: readonly AlertTableGroup[]; soundOff?: boolean | undefined; disabled?: boolean | undefined; label: string; onChange: (id: string, way: AlertWay, on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="set-mx" role="group" aria-label={label}>
      {groups.map((g, gi) => (
        <div key={g.title} className="set-mx-grp" role="group" aria-labelledby={`${id}g${gi}`}>
          {gi === 0 ? (
            <div className="set-mx-h">
              <p id={`${id}g${gi}`} className="set-mx-g">{g.title}</p>
              <span className="set-mx-k" aria-hidden="true"><Icon name="bell" size={16} />Alert</span>
              <span className={cn('set-mx-k', soundOff && 'is-off')} aria-hidden="true"><Icon name={soundOff ? 'speakerOff' : 'speaker'} size={16} />Sound</span>
            </div>
          ) : <p id={`${id}g${gi}`} className="set-mx-g">{g.title}</p>}
          {g.rows.map((r) => (
            <div key={r.id} className="set-mx-r" data-row={r.id}>
              <div className="set-mx-t">
                <Icon name={r.icon} size={18} />
                <span className="set-mx-n">
                  {r.label}
                  {r.saveState ? <SaveSign saved={undefined} saveState={r.saveState} className={r.note === undefined ? 'is-under' : 'is-line'} />
                    : r.note !== undefined && <span className="set-mx-q">{r.note}</span>}
                </span>
              </div>
              <div className="set-mx-c">{r.alert !== null && <Tick row={r} way="alert" on={r.alert} disabled={disabled} onChange={onChange} />}</div>
              <div className="set-mx-c">{r.sound !== null && <Tick row={r} way="sound" on={r.sound} disabled={disabled || soundOff} onChange={onChange} />}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * How loud Alcove's sounds are: turn them all off (or on), how loud (`volume`, 0 to 1), and hear one. Muted, the level
 * steps back and keeps where it was. `playing` while a sound plays.
 */
export function SoundLevel({ volume, muted, playing = false, disabled = false, onVolume, onMute, onPlay }: {
  volume: number; muted: boolean; playing?: boolean | undefined; disabled?: boolean | undefined;
  onVolume: (volume: number) => void; onMute: (muted: boolean) => void; onPlay: () => void;
}) {
  const at = Math.round(Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0)) * 100);
  const mute = muted ? 'Turn sounds on' : 'Turn sounds off';
  return (
    <div className={cn('set-vol', muted && 'is-muted')}>
      <Tooltip label={mute}>
        <IconButton icon={muted ? 'speakerOff' : 'speaker'} label={mute} title={undefined} size={17} disabled={disabled} onClick={() => onMute(!muted)} />
      </Tooltip>
      <input type="range" className="set-range" min={0} max={100} step={5} value={at} style={{ '--v': `${at}%` }} aria-label="Sound volume" aria-valuetext={`${at}%`}
        disabled={disabled || muted} onChange={(e) => onVolume(Number(e.currentTarget.value) / 100)} />
      <Tooltip label="Play a sound">
        <IconButton icon="playLine" label="Play a sound" title={undefined} size={14} className={cn('is-play', playing && 'is-busy')} disabled={disabled || muted} onClick={onPlay} />
      </Tooltip>
    </div>
  );
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

/**
 * One choice of appearance: a small evening in its own colours (both, for `system`), named underneath. `pressed` rings the
 * one in use. Three sit in a row. `small` is the window alone, about 40 by 26 (your menu's Theme), named by its tooltip.
 */
export const ThemePreview = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { theme: ThemeChoice; pressed: boolean; small?: boolean | undefined }>(
  function ThemePreview({ theme, pressed, small = false, className, type = 'button', ...rest }, ref) {
    const name = THEME_NAME[theme];
    const art = (
      <span className="set-win" aria-hidden="true">
        <SmallEvening theme={theme === 'dark' ? 'dark' : 'light'} />
        {theme === 'system' && <SmallEvening theme="dark" corner />}
      </span>
    );
    if (!small) return <button ref={ref} type={type} aria-pressed={pressed} className={cn('set-eve', className)} {...rest}>{art}{name}</button>;
    return (
      <Tooltip label={name}>
        <button ref={ref} type={type} aria-pressed={pressed} aria-label={name} className={cn('set-eve is-small', className)} {...rest}>{art}</button>
      </Tooltip>
    );
  });
