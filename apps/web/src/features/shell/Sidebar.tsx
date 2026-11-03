import { errorMessage } from '@alcove/api';
import { Avatar, Icon, IconButton, Logo, Menu, cn, useToast, useTheme, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { CountUp } from '@alcove/ui';
import { q, useLock } from '~/lib/queries';
import { hoursOfNotes } from '~/lib/time';
import { NewCallMenu } from './NewCallMenu';

const NAV: { to: '/home' | '/meetings' | '/notes' | '/record'; label: string; icon: IconName; match: string }[] = [
  { to: '/home', label: 'Home', icon: 'grid', match: '/home' },
  { to: '/meetings', label: 'Meetings', icon: 'cal', match: '/meetings' },
  { to: '/notes', label: 'Notes', icon: 'notes', match: '/notes' },
  { to: '/record', label: 'Record in the room', icon: 'room', match: '/record' }
];

export function Sidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: session } = useQuery(q.session());
  const { data: upcoming } = useQuery(q.upcoming());
  const { data: balance } = useQuery(q.balance());
  const { resolved, toggle } = useTheme();
  const lock = useLock();
  const toast = useToast();
  return (
    <aside className="sticky top-0 flex h-screen flex-col gap-1.5 border-r border-hair bg-sidebar px-3.5 pb-3.5 pt-[18px] max-[900px]:static max-[900px]:h-auto max-[900px]:flex-row max-[900px]:flex-wrap max-[900px]:items-center max-[900px]:border-b max-[900px]:border-r-0">
      <Link to="/home" aria-label="Alcove home" className="self-start rounded-[10px] px-2 pb-3.5 pt-1.5 max-[900px]:pb-1.5"><Logo size={24} /></Link>
      <NewCallMenu block className="mb-3.5 h-11 rounded-[13px] max-[900px]:mb-0 max-[900px]:w-auto" />
      <nav aria-label="Main" className="flex flex-col gap-0.5 max-[900px]:flex-row">
        {NAV.map((n) => {
          const on = path.startsWith(n.match);
          const count = n.to === '/meetings' ? upcoming?.length : undefined;
          return (
            <Link key={n.to} to={n.to} aria-current={on ? 'page' : undefined}
              className={cn('relative grid h-10 grid-cols-[20px_1fr_auto] items-center gap-3 rounded-[11px] px-3 text-[14.5px] font-semibold transition-colors max-[900px]:grid-cols-[20px]',
                on ? 'text-ink' : 'text-ink-2 hover:bg-well/70 hover:text-ink')}>
              {on && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-[11px] bg-card shadow-[var(--sh-soft),inset_0_0_0_1px_var(--hair)]" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
              <Icon name={n.icon} className="relative" />
              <span className="relative max-[900px]:hidden">{n.label}</span>
              {count ? <em className="relative rounded-md bg-well px-[7px] py-0.5 font-mono text-[11.5px] not-italic text-ink-3 max-[900px]:hidden">{count}</em> : <span />}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1" />
      <Link to="/account" className={cn('flex flex-col gap-2 rounded-2xl bg-card p-3.5 text-left shadow-[inset_0_0_0_1px_var(--hair)] transition-[transform,box-shadow] duration-200 ease-soft hover:-translate-y-px hover:shadow-[inset_0_0_0_1px_var(--hair-2),var(--sh-lift)] max-[900px]:hidden',
        path.startsWith('/account') && 'shadow-[inset_0_0_0_1.5px_var(--ink)]')}>
        <span className="flex items-baseline justify-between text-[13px] font-semibold text-ink-3">Credits<b className="font-mono text-[17px] text-ink">{balance ? <CountUp value={balance.balance} /> : '—'}</b></span>
        <span className="h-2 overflow-hidden rounded bg-well"><motion.i className="block h-full rounded bg-gradient-to-r from-lamp to-lamp-hot" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (balance?.balance ?? 0) / 100)}%` }} transition={{ duration: 1, ease: [0.22, 0.8, 0.24, 1] }} /></span>
        <span className="text-xs text-ink-3">About {hoursOfNotes(balance?.balance ?? 0, balance?.perMinute)} of notes</span>
      </Link>
      <div className="relative pt-2 max-[900px]:hidden">
        <Menu side="top" className="w-[var(--radix-dropdown-menu-trigger-width)]" trigger={
          <button type="button" className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-xl p-1 pr-11 text-left transition-colors hover:bg-well/70 data-[state=open]:bg-well">
            {session && <Avatar person={session.user} size={34} ring={false} />}
            <span className="min-w-0"><b className="block truncate text-[13.5px]">{session?.user.name}</b><span className="block truncate text-xs text-ink-3">{session?.user.email}</span></span>
          </button>
        } items={[
          { icon: 'pen', label: 'Edit profile', description: 'Not available yet', disabled: true, onSelect: () => undefined },
          { icon: 'signOut', label: 'Log out', onSelect: () => lock.mutate(undefined, { onError: (e) => toast(errorMessage(e), 'x') }) }
        ]} />
        <IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label="Switch theme" onClick={toggle} className="absolute right-1 top-1/2 mt-1 -translate-y-1/2" />
      </div>
    </aside>
  );
}
