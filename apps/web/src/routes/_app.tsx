import type { Meeting } from '@alcove/api';
import { IconButton, cn } from '@alcove/ui';
import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Composer } from '~/features/shell/Composer';
import { useArrival } from '~/features/onboarding/store';
import { TourHost } from '~/features/onboarding/Tour';
import { Palette } from '~/features/shell/Palette';
import { Offline, Sidebar, useSidePanel } from '~/features/shell/Sidebar';
import { PhoneTop, TabBar } from '~/features/shell/TabBar';
import { ComposerContext, PaletteContext, type PaletteStart } from '~/features/shell/context';
import { requireAccount } from '~/lib/guards';
import { withMod } from '~/lib/keys';

/* Everything in the frame: the side panel (on a phone, the top bar and the tab bar) beside Home, Notes, a note and Account. */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, preload }) => requireAccount(context.queryClient, preload),
  component: Shell
});

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, [contenteditable="true"]');
/** A dialog, a menu or a list of choices is open: shortcuts leave the page alone, and nothing opens on top. */
const overlayOpen = () => !!document.querySelector('[role="dialog"], [role="listbox"]');

function Shell() {
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<Meeting | undefined>(undefined);
  const [palette, setPalette] = useState(false);
  const [start, setStart] = useState<PaletteStart>({ mode: 'find' });
  const side = useSidePanel();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { stage, opened } = useArrival();
  const openComposer = useCallback((meeting?: Meeting) => { setEditing(meeting); setComposer(true); }, []);
  const openPalette = useCallback((s: PaletteStart = { mode: 'find' }) => { setStart(s); setPalette(true); }, []);
  const paletteOpen = useRef(false);
  useEffect(() => { paletteOpen.current = palette; }, [palette]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (withMod(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // ⌘K (Ctrl+K off a Mac) closes the palette again; it never opens it over the composer or anything else.
        if (paletteOpen.current) setPalette(false);
        else if (!overlayOpen()) openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || overlayOpen()) return;
      if (e.key === 'n') { e.preventDefault(); openComposer(); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [openComposer, openPalette]);

  return (
    <ComposerContext.Provider value={openComposer}>
      <PaletteContext.Provider value={openPalette}>
        {/* Behind a new account's arrival screen until it opens; then in again, as the arch opens. */}
        <div key={opened} className={cn('shell world-in', side.hidden && 'is-bare')} inert={stage === 'creating'}>
          <Sidebar hidden={side.hidden} hideRef={side.hideRef} onHide={side.hide} onNew={() => openComposer()} onSearch={() => openPalette()} onPin={() => openPalette({ mode: 'pin' })} />
          {side.hidden && <IconButton ref={side.showRef} icon="panel" label="Show the side panel" className="sb-show" onClick={side.show} />}
          <PhoneTop onSearch={() => openPalette()} onNew={() => openComposer()} />
          <main className="main">
            {/* With the side panel hidden, its offline notice moves to the top of the page. */}
            <Offline show={side.hidden} className="main-offline" />
            <div key={path} className="main-in enter"><Outlet /></div>
          </main>
          <TabBar />
        </div>
        <Composer open={composer} onOpenChange={setComposer} editing={editing} />
        <Palette open={palette} onOpenChange={setPalette} start={start} />
        <TourHost />
      </PaletteContext.Provider>
    </ComposerContext.Provider>
  );
}
