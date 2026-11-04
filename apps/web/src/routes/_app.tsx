import type { Meeting } from '@alcove/api';
import { Outlet, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { Composer } from '~/features/shell/Composer';
import { useArrival } from '~/features/onboarding/store';
import { TourHost } from '~/features/onboarding/Tour';
import { ComposerContext } from '~/features/shell/context';
import { Sidebar } from '~/features/shell/Sidebar';
import { requireAccount } from '~/lib/guards';

/* Everything with the sidebar: Home, Notes, a note, Account. */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  component: Shell
});

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, [contenteditable="true"]');

function Shell() {
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<Meeting | undefined>(undefined);
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { stage, opened } = useArrival();
  const open = useCallback((meeting?: Meeting) => { setEditing(meeting); setComposer(true); }, []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setComposer(false); void navigate({ to: '/notes', search: { find: true } }); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'n') { e.preventDefault(); setEditing(undefined); setComposer(true); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [navigate]);

  return (
    <ComposerContext.Provider value={open}>
      {/* Behind a new account's arrival screen until it opens; then in again, as the arch opens. */}
      <div key={opened} className="shell world-in" inert={stage === 'creating'}>
        <Sidebar onNew={() => open()} />
        <main className="main"><div key={path} className="main-in enter"><Outlet /></div></main>
      </div>
      <Composer open={composer} onOpenChange={setComposer} editing={editing} />
      <TourHost />
    </ComposerContext.Provider>
  );
}
