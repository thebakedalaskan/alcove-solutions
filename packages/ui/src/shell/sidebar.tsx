/* The side panel's parts: its places (SidebarNav, a link's insides in NavItemContent) and a paid plan's small sun (SunMark, sb-sun in shell.css). */
import type { ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';

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
