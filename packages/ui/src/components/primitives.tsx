import { motion, useReducedMotion } from 'motion/react';
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { ProviderMark } from './brand';
import { Icon, type IconName } from './icon';
import { CheckDraw, EASE } from './motion';

/* ---------- Button ---------- */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** The button classes, for a link that looks like a button. */
export function buttonClass({ variant = 'secondary', size = 'md' }: { variant?: ButtonVariant | undefined; size?: ButtonSize | undefined } = {}): string {
  return cn('ac-btn', `is-${variant}`, size !== 'md' && `is-${size}`);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one thing the view is for (solid sun). secondary: the second choice. quiet: Not now, Back, cancels. */
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  icon?: IconName | undefined;
  iconRight?: IconName | undefined;
  /** Busy: the icon becomes a spinner. Say what's happening in the label. */
  loading?: boolean | undefined;
  /** A keyboard hint after the label, e.g. "↵". */
  kb?: string | undefined;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, kb, className, children, disabled, type = 'button', ...rest }, ref
) {
  const iconSize = size === 'sm' ? 16 : 18;
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={cn(buttonClass({ variant, size }), className)} {...rest}>
      {loading ? <Spinner /> : icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={iconSize} />}
      {kb && <span className="kb">{kb}</span>}
    </button>
  );
});

/** A 36px square tool button with one icon. `on` marks a toggled tool. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string; size?: number; on?: boolean | undefined }>(
  function IconButton({ icon, label, size = 18, on = false, className, type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} aria-label={label} title={label} className={cn('ac-icon-btn', on && 'is-on', className)} {...rest}><Icon name={icon} size={size} /></button>;
  });

/** Continue with Google or Microsoft: a full-width pill with the provider's own mark pinned left. */
export const ProviderButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { provider: 'google' | 'microsoft'; busy?: boolean | undefined }>(
  function ProviderButton({ provider, busy = false, className, children, type = 'button', disabled, ...rest }, ref) {
    return (
      <button ref={ref} type={type} disabled={disabled || busy} className={cn('ac-provider', busy && 'is-busy', className)} {...rest}>
        {busy ? <Spinner /> : <ProviderMark provider={provider} />}
        {children}
      </button>
    );
  });

export const Spinner = ({ className }: { className?: string }) => <span aria-hidden="true" className={cn('ac-spin', className)} />;

/* ---------- Status ---------- */
export type ChipTone = 'neutral' | 'sun' | 'horizon' | 'caution' | 'outline';
/** A fact about something: sun for chosen or ready, horizon for information, caution for a problem, outline for switched off. Never clickable. */
export function Chip({ tone = 'neutral', icon, children, className }: { tone?: ChipTone; icon?: IconName | undefined; children: ReactNode; className?: string | undefined }) {
  return <span className={cn('ac-chip', tone !== 'neutral' && `is-${tone}`, className)}>{icon && <Icon name={icon} size={14} />}{children}</span>;
}

/** The pulsing dot of the notes sign. Only ever means notes or recording. */
export const RecDot = ({ className }: { className?: string }) => <i aria-hidden="true" className={cn('ac-rec-dot', className)} />;

/**
 * The one sign that notes are being taken, in the same place for everyone. `requested`: someone asked
 * for notes and nothing is recording yet. `stage`: on the call stage.
 */
export function NotesSign({ requested = false, stage = false, children, className }: { requested?: boolean; stage?: boolean; children: ReactNode; className?: string | undefined }) {
  return <span className={cn('ac-notes-sign', requested && 'is-requested', stage && 'is-stage', className)}><RecDot />{children}</span>;
}

/** Where something was written and what was checked, as product state. Inline in a note's footer. */
export function SealedBadge({ title, detail, inline = false, className }: { title: ReactNode; detail?: ReactNode; inline?: boolean; className?: string | undefined }) {
  if (inline) return <span className={cn('ac-sealed is-inline', className)}><Icon name="sealed" size={16} /><span>{title}</span></span>;
  return (
    <span className={cn('ac-sealed', className)}>
      <span className="ic"><Icon name="sealed" size={18} /></span>
      <span><b>{title}</b>{detail && <small>{detail}</small>}</span>
    </span>
  );
}

/** A calm sentence with a way forward. Caution for problems (there is no alarm red), info for information. */
export function Notice({ tone = 'info', icon, children, className }: { tone?: 'info' | 'caution'; icon?: IconName | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('ac-notice', `is-${tone}`, className)} role={tone === 'caution' ? 'status' : undefined}>
      <Icon name={icon ?? (tone === 'caution' ? 'clock' : 'lock')} size={18} />
      <div>{children}</div>
    </div>
  );
}

export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => <kbd className={cn('ac-kbd', className)}>{children}</kbd>;

/** A moment in a recording you can jump to. */
export function TimeChip({ seconds, onSeek }: { seconds: number; onSeek?: ((s: number) => void) | undefined }) {
  const label = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  return onSeek ? <button type="button" className="ac-time-chip" title={`Play from ${label}`} onClick={() => onSeek(seconds)}>{label}</button> : <span className="ac-time-chip">{label}</span>;
}

/* ---------- Check ---------- */
export function Check({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={cn('ac-check', checked && 'on')} onClick={() => onChange(!checked)}>
      <CheckDraw done={checked} />
    </button>
  );
}

/* ---------- Segmented and Tabs ---------- */
export interface Choice<T extends string> { value: T; label: ReactNode; icon?: IconName | undefined }

/** A choice of two to four modes. The chosen one sits on a surface pill that slides between them. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: Choice<T>[]; label: string; className?: string }) {
  const pill = useId();
  const reduce = useReducedMotion();
  return (
    <div className={cn('ac-seg', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={pill} className="pill" aria-hidden="true" transition={reduce ? { duration: 0 } : { duration: 0.55, ease: EASE.inOut }} />}
          <span className="lbl">{o.icon && <Icon name={o.icon} size={16} />}{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Views of the same thing. The selected tab is ink with a sun underline. Use Segmented for a setting. */
export function Tabs<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: Choice<T>[]; label: string; className?: string }) {
  return (
    <div className={cn('ac-tabs', className)} role="tablist" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" role="tab" className="ac-tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/* ---------- Meter ---------- */
export const Meter = ({ value, className }: { value: number; className?: string }) => (
  <span className={cn('ac-meter', className)}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></span>
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
  return <span aria-hidden="true" className={cn('ac-arch-thumb', room && 'in-room', className)} style={{ '--w': `${width}px`, '--cover': `var(--cover-${cover})` }} />;
}
