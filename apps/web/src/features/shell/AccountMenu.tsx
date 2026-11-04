/*
 * The menu under your name, in the side panel and on the phone's top bar: your account, the tour of Home
 * again, the theme, and signing out.
 */
import { errorMessage } from '@alcove/api';
import { Icon, Popover, useTheme, useToast, type IconName } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { arrival } from '~/features/onboarding/store';
import { useSignOut } from '~/lib/queries';

/** `anchor` is the button that opens it: it opens above it in the side panel, and below it on a phone. */
export function AccountMenu({ anchor, side, align }: { anchor: ReactNode; side: 'top' | 'bottom'; align: 'start' | 'end' }) {
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
    <Popover open={open} onOpenChange={setOpen} side={side} align={align} label="Account" className="me-menu" anchor={anchor}>
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
