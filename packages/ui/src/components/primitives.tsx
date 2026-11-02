import { Switch as RSwitch } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';

/* ---------- Button ---------- */
const VARIANT = {
  primary: 'bg-btn text-btn-ink shadow-soft hover:shadow-lift',
  secondary: 'bg-card text-ink shadow-[inset_0_0_0_1px_var(--hair-2),var(--sh-soft)] hover:shadow-[inset_0_0_0_1px_var(--ink-3),var(--sh-soft)]',
  ghost: 'text-ink-2 hover:bg-well hover:text-ink',
  lamp: 'bg-lamp text-[#2A1700] shadow-[0_10px_30px_-10px_rgba(255,166,43,.8)] hover:bg-[#FFB547]',
  danger: 'bg-bad text-white hover:brightness-105',
  'danger-ghost': 'text-bad hover:bg-bad-soft',
  /* For dark surfaces (call stage, feature cards) regardless of theme. */
  glass: 'bg-white/[.08] text-stage-ink hover:bg-white/[.14]',
  light: 'bg-stage-ink text-[#17140F] hover:bg-white'
} as const;
const SIZE = { sm: 'h-[34px] px-3 text-[13.5px] rounded-[10px] gap-1.5', md: 'h-[42px] px-[18px] text-[14.5px] rounded-xl gap-2', lg: 'h-[50px] px-6 text-base rounded-[14px] gap-2' } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, block, className, children, disabled, type = 'button', ...rest }, ref
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading}
      className={cn('inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-[transform,background-color,box-shadow,color,opacity] duration-200 ease-soft active:scale-[.97] disabled:opacity-55 disabled:active:scale-100',
        VARIANT[variant], SIZE[size], block && 'w-full', className)} {...rest}>
      {loading ? <Spinner /> : icon && <Icon name={icon} className={size === 'sm' ? 'size-4' : 'size-[18px]'} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} className="size-[18px]" />}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string; tone?: 'default' | 'stage'; size?: 'sm' | 'md' }>(
  function IconButton({ icon, label, tone = 'default', size = 'md', className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-label={label} title={label}
        className={cn('inline-flex shrink-0 items-center justify-center rounded-[11px] transition-colors duration-150',
          size === 'sm' ? 'size-8' : 'size-[38px]',
          tone === 'stage' ? 'text-[#BEB5A9] hover:bg-[#2A2621] hover:text-stage-ink' : 'text-ink-2 hover:bg-well hover:text-ink', className)} {...rest}>
        <Icon name={icon} className={size === 'sm' ? 'size-[18px]' : 'size-5'} />
      </button>
    );
  });

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-[15px] animate-spin-fast rounded-full border-2 border-current border-r-transparent', className)} />;
}

/* ---------- Chip ---------- */
const TONE = {
  neutral: 'bg-well text-ink-2',
  ok: 'bg-ok-soft text-ok',
  lamp: 'bg-lamp-soft text-lamp-ink',
  bad: 'bg-bad-soft text-bad',
  rec: 'bg-rec/15 text-rec',
  stage: 'bg-white/[.08] text-[#D9D2C7]',
  'stage-rec': 'bg-rec/[.16] text-rec-ink'
} as const;
export function Chip({ tone = 'neutral', icon, children, className, as: As = 'span', ...rest }: { tone?: keyof typeof TONE; icon?: IconName; children: ReactNode; className?: string; as?: 'span' | 'button' } & Record<string, unknown>) {
  return (
    <As className={cn('inline-flex h-7 items-center gap-[7px] whitespace-nowrap rounded-full px-[11px] text-[13px] font-semibold', TONE[tone], As === 'button' && 'cursor-pointer', className)} {...rest}>
      {icon && <Icon name={icon} className="size-3.5" />}
      {children}
    </As>
  );
}
export const RecDot = ({ className }: { className?: string }) => <i aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full bg-rec animate-recpulse', className)} />;
export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-md border border-hair-2 px-1.5 font-mono text-[11.5px] text-ink-3">{children}</kbd>;

/* ---------- Inputs ---------- */
export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: 'md' | 'lg' }>(function Input({ className, size = 'md', ...rest }, ref) {
  return <input ref={ref}
    className={cn('w-full rounded-xl border-0 bg-card px-3.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--hair-2)] outline-none transition-shadow placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_4px_color-mix(in_oklab,var(--ink)_8%,transparent)]',
      size === 'lg' ? 'h-[52px] rounded-[14px] text-base' : 'h-[46px]', className)} {...rest} />;
});

export function Field({ label, hint, htmlFor, children, className }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-[7px]', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-2">{label}</label>
      {children}
      {hint && <span className="text-[12.5px] text-ink-3">{hint}</span>}
    </div>
  );
}

/* ---------- Segmented ---------- */
export function Segmented<T extends string | number>({ value, onChange, options, className, tone = 'default', label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string; tone?: 'default' | 'stage'; label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex gap-[3px] rounded-xl p-[3px]', tone === 'stage' ? 'bg-[#2A2621]' : 'bg-well', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cn('inline-flex h-[34px] items-center gap-[7px] rounded-[9px] px-[13px] text-[13.5px] font-semibold transition-[background-color,color,box-shadow] duration-200',
              tone === 'stage' ? (on ? 'bg-stage-ink text-[#17140F]' : 'text-[#BEB5A9] hover:text-stage-ink') : (on ? 'bg-card text-ink shadow-soft' : 'text-ink-2 hover:text-ink'))}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Switch ---------- */
export function Switch({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string }) {
  return (
    <RSwitch.Root checked={checked} onCheckedChange={onCheckedChange} aria-label={label}
      className="relative h-6 w-[42px] shrink-0 rounded-full bg-hair-2 transition-colors duration-200 data-[state=checked]:bg-ok">
      <RSwitch.Thumb className="block size-[18px] translate-x-[3px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-transform duration-250 ease-soft data-[state=checked]:translate-x-[21px]" />
    </RSwitch.Root>
  );
}

/* ---------- Radio card ---------- */
export function OptionCard({ selected, onSelect, title, description, className, children }: { selected: boolean; onSelect: () => void; title: ReactNode; description?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cn('flex flex-col gap-[3px] rounded-[14px] p-3 text-left transition-[box-shadow,background-color] duration-200 hover:bg-raised',
        selected ? 'bg-card shadow-[inset_0_0_0_2px_var(--ink)]' : 'shadow-[inset_0_0_0_1px_var(--hair-2)]', className)}>
      {children}
      <b className="text-sm font-semibold">{title}</b>
      {description && <span className="text-[12.5px] leading-[1.35] text-ink-3">{description}</span>}
    </button>
  );
}

export function RadioRow({ selected, onSelect, title, description }: { selected: boolean; onSelect: () => void; title: ReactNode; description?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cn('grid grid-cols-[20px_1fr] items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-raised', selected && 'bg-well hover:bg-well')}>
      <span className={cn('size-5 rounded-full transition-shadow duration-200', selected ? 'shadow-[inset_0_0_0_6px_var(--ink)]' : 'shadow-[inset_0_0_0_1.6px_var(--hair-2)]')} />
      <span><b className="block text-[14.5px] font-semibold">{title}</b>{description && <span className="text-[13px] text-ink-3">{description}</span>}</span>
    </button>
  );
}

/* ---------- Surfaces ---------- */
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return <section className={cn('relative overflow-hidden rounded-3xl bg-card p-5 shadow-[inset_0_0_0_1px_var(--hair),var(--sh-soft)]', className)} {...rest}>{children}</section>;
}
export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cn('mb-3 flex items-center justify-between gap-2.5', className)}><h3 className="font-sans text-[16.5px] font-bold tracking-[-.01em]">{title}</h3>{action}</div>;
}
/** The dark, lamp-lit card used for the single most important thing on a page. */
export function FeatureCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('relative flex min-h-[300px] flex-col gap-2.5 overflow-hidden rounded-3xl bg-feature p-6 text-[#F5F1EA] shadow-[inset_0_0_0_1px_var(--feature-line),var(--sh-lift)] [--avatar-ring:var(--feature)]', className)}>
      <div aria-hidden className="pointer-events-none absolute -right-[120px] -top-[140px] size-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(255,166,43,.34),rgba(255,166,43,.08)_55%,transparent)] animate-glow" />
      <div className="relative flex flex-1 flex-col gap-2.5">{children}</div>
    </section>
  );
}
