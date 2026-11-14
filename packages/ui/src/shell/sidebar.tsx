/*
 * The side panel's parts: its places (SidebarNav, a link's insides in NavItemContent, and NavCount for a place whose count is
 * a link of its own) and a paid plan's small sun (SunMark, sb-sun in shell.css).
 */
import type { ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { Tooltip } from '../foundation/overlay';

/** The app's sections. Put router links inside, each with className="ac-nav-item"; the current one carries aria-current="page". */
export function SidebarNav({ label = 'Main', children, className }: { label?: string; children: ReactNode; className?: string | undefined }) {
  return <nav className={cn('ac-nav', className)} aria-label={label}>{children}</nav>;
}
/** What goes inside a nav link: the icon, the label and an optional count. */
export function NavItemContent({ icon, label, count }: { icon: IconName; label: string; count?: number | undefined }) {
  return <><Icon name={icon} /><span>{label}</span>{count ? <span className="count">{count}</span> : null}</>;
}

/** What NavCount hands the router link that renders the count. */
export interface NavCountLinkProps { className: string; 'aria-label': string; children: ReactNode }

/**
 * A place whose count leads to what it counts, somewhere the place's own link doesn't go: Home's count, to For you under the
 * horizon. `row` is the place's link as ever, holding NavItemContent with no count. Over the row's end, where a count sits,
 * the count `n` is a link of its own: pointing at it says what it counts (`says`, also its name), and pressing it goes to
 * them. `link` renders that link as the app's router link with the props it's given, so it stays a link.
 */
export function NavCount({ row, n, says, link }: { row: ReactNode; n: number; says: string; link: (props: NavCountLinkProps) => ReactNode }) {
  return (
    <div className="ac-nav-place">
      {row}
      <Tooltip label={says} side="right">{link({ className: 'ac-nav-count', 'aria-label': says, children: n })}</Tooltip>
    </div>
  );
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
