import { errorMessage } from '@alcove/api';
import { Avatar, Icon, Kbd, Logo, Meter, NavItemContent, Popover, SidebarNav, buttonClass, cn, useTheme, useToast, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { arrival } from '~/features/onboarding/store';
import { q, useSignOut } from '~/lib/queries';
import { hoursAndMinutes } from '~/lib/time';

export function Sidebar({ onNew }: { onNew: () => void }) {
  const session = useQuery(q.session()).data;
  const notes = useQuery(q.notes()).data;
  const credits = useQuery(q.balance()).data;
  return (
    <aside className="side">
      <Logo />
      <button type="button" className={cn(buttonClass({ variant: 'primary' }), 'new')} onClick={onNew} aria-label="New call" data-tour="new-call"><Icon name="plus" size={18} /><span>New call</span><Kbd>N</Kbd></button>
      <SidebarNav>
        <Link to="/home" className="ac-nav-item"><NavItemContent icon="home" label="Home" /></Link>
        <Link to="/notes" className="ac-nav-item"><NavItemContent icon="notes" label="Notes" count={notes?.length} /></Link>
        <Link to="/record" className="ac-nav-item" aria-label="In the room" data-tour="room"><NavItemContent icon="room" label="In the room" /></Link>
      </SidebarNav>
      <div className="side-foot">
        {credits && (
          <Link to="/account" className="credits">
            <span><b>{hoursAndMinutes(credits.balance / credits.perMinute)}</b> of notes left</span>
            <Meter value={credits.balance / Math.max(1, credits.granted)} />
          </Link>
        )}
        {session && <AccountMenu name={session.user.name} avatar={<Avatar person={session.user} size={28} />} />}
      </div>
    </aside>
  );
}

/** Under your name: your account, the tour of Home again, the theme, and signing out. */
function AccountMenu({ name, avatar }: { name: string; avatar: ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const signOut = useSignOut();
  const { resolved, setTheme } = useTheme();
  const dark = resolved === 'dark';
  const items: { icon: IconName; title: string; detail: string; run: () => void }[] = [
    { icon: 'key', title: 'Account', detail: 'Sign-in, notes default, credits and team', run: () => void navigate({ to: '/account' }) },
    { icon: 'compass', title: 'Take the tour', detail: 'A few short slides about Home', run: () => arrival.askTour() },
    { icon: dark ? 'sun' : 'moon', title: dark ? 'Light theme' : 'Dark theme', detail: 'Also on your account page', run: () => setTheme(dark ? 'light' : 'dark') },
    {
      icon: 'signOut', title: 'Sign out', detail: 'Back to the welcome page',
      run: () => signOut.mutate(undefined, { onSuccess: () => void navigate({ to: '/welcome', replace: true }), onError: (e) => toast(errorMessage(e), { icon: 'x' }) })
    }
  ];
  /* Up and down move between the items. */
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = Array.from(e.currentTarget.querySelectorAll('button'));
    const i = all.findIndex((b) => b === document.activeElement);
    e.preventDefault();
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  return (
    <Popover open={open} onOpenChange={setOpen} side="top" align="start" label="Account" className="me-menu"
      anchor={<button type="button" className="me-row" aria-label={`${name}: account menu`}>{avatar}<span>{name}</span><Icon name="up" size={16} /></button>}>
      <div role="menu" aria-label="Account" onKeyDown={move}>
        {items.map((it, i) => (
          <div key={it.title}>
            {i === items.length - 1 && <div className="ac-pop-sep" />}
            <button type="button" role="menuitem" className="ac-pop-item" onClick={() => { setOpen(false); it.run(); }}>
              <Icon name={it.icon} size={18} /><span><b>{it.title}</b><small>{it.detail}</small></span>
            </button>
          </div>
        ))}
      </div>
    </Popover>
  );
}
