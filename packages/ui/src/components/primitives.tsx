import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { CheckDraw } from './motion';

/* ---------- Button ---------- */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: IconName | undefined;
  iconRight?: IconName | undefined;
  loading?: boolean | undefined;
  /** A keyboard hint after the label, e.g. "↵". */
  kb?: string | undefined;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, kb, className, children, disabled, type = 'button', ...rest }, ref
) {
  const iconSize = size === 'sm' ? 15 : size === 'xl' ? 18 : 17;
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={cn('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, className)} {...rest}>
      {loading ? <Spinner /> : icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={iconSize} />}
      {kb && <span className="kb">{kb}</span>}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string; size?: number }>(
  function IconButton({ icon, label, size = 18, className, type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} aria-label={label} title={label} className={cn('btn btn-ghost btn-icon', className)} {...rest}><Icon name={icon} size={size} /></button>;
  });

export const Spinner = ({ className }: { className?: string }) => <span aria-hidden="true" className={cn('spin', className)} />;

/* ---------- Chips ---------- */
export function Chip({ tone = 'neutral', icon, children, className }: { tone?: 'neutral' | 'accent' | 'rec' | 'quiet'; icon?: IconName | undefined; children: ReactNode; className?: string }) {
  return <span className={cn('chip', tone !== 'neutral' && `chip-${tone}`, className)}>{tone === 'rec' && <span className="dot" />}{icon && <Icon name={icon} size={13} />}{children}</span>;
}
/** The recording sign. Never used for anything but recording. */
export const RecDot = ({ className }: { className?: string }) => <i aria-hidden="true" className={cn('rec-dot', className)} />;
export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => <kbd className={cn('kbd', className)}>{children}</kbd>;

/** A moment in a recording you can jump to. */
export function TimeChip({ seconds, onSeek }: { seconds: number; onSeek?: ((s: number) => void) | undefined }) {
  const label = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  return onSeek ? <button type="button" className="time-chip" title={`Play from ${label}`} onClick={() => onSeek(seconds)}>{label}</button> : <span className="time-chip">{label}</span>;
}

/* ---------- Check ---------- */
export function Check({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={cn('check', checked && 'on')} onClick={() => onChange(!checked)}>
      <CheckDraw done={checked} />
    </button>
  );
}

/* ---------- Segmented ---------- */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; className?: string }) {
  return (
    <div className={cn('seg', className)} role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/* ---------- Meter ---------- */
export const Meter = ({ value, className }: { value: number; className?: string }) => (
  <span className={cn('meter block', className)}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></span>
);

/* ---------- Covers ---------- */
export const COVERS = ['dawn', 'first', 'morning', 'dusk', 'haze', 'night'] as const;
export type Cover = (typeof COVERS)[number];
/** A stable cover for an ID, so a call or note always gets the same sky. */
export function coverFor(id: string): Cover {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COVERS[h % COVERS.length] ?? 'dawn';
}
/** The alcove motif: a small arched window with the sun coming up. */
export function ArchThumb({ cover, width = 34, room = false, className }: { cover: Cover; width?: number; room?: boolean; className?: string }) {
  return <span aria-hidden="true" className={cn('arch-thumb', `cover-${cover}`, room && 'in-room', className)} style={{ '--w': `${width}px` }} />;
}
