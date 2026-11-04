import { IconButton, cn } from '@alcove/ui';
import { Outlet, createFileRoute, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeptUploads } from '~/features/record/uploads';
import { Composer } from '~/features/shell/Composer';
import { useArrival } from '~/features/onboarding/store';
import { TourHost } from '~/features/onboarding/Tour';
import { Palette } from '~/features/shell/Palette';
import { OfflinePage } from '~/features/shell/OfflinePage';
import { Offline, Sidebar, useSidePanel } from '~/features/shell/Sidebar';
import { PhoneTop, TabBar } from '~/features/shell/TabBar';
import { ComposerContext, PaletteContext, type ComposerStart, type PaletteStart } from '~/features/shell/context';
import { ownerOf, requireAccount } from '~/lib/guards';
import { overlayOpen, typing, withMod } from '~/lib/keys';

/*
 * Everything in the frame: the side panel (on a phone, the top bar and the tab bar) beside Home, Notes, a note, Record,
 * Team and Settings. Opened without a connection by someone signed in here, Record works and every other page says it's
 * offline; once the connection is back, everything is read again.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, preload }) => requireAccount(context.queryClient, preload),
  component: Shell
});

function Shell() {
  const { account } = Route.useRouteContext();
  const router = useRouter();
  useKeptUploads(ownerOf(account));
  useEffect(() => {
    if (!account.offline) return;
    const back = () => { void router.invalidate(); };
    addEventListener('online', back);
    return () => removeEventListener('online', back);
  }, [account.offline, router]);
  const [composer, setComposer] = useState(false);
  const [composing, setComposing] = useState<ComposerStart>({});
  const [palette, setPalette] = useState(false);
  const [start, setStart] = useState<PaletteStart>({ mode: 'find' });
  const side = useSidePanel();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { stage, opened } = useArrival();
  const openComposer = useCallback((s: ComposerStart = {}) => { setComposing(s); setComposer(true); }, []);
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
            <div key={path} className="main-in enter">{account.offline && path !== '/record' ? <OfflinePage /> : <Outlet />}</div>
          </main>
          <TabBar />
        </div>
        <Composer open={composer} onOpenChange={setComposer} start={composing} />
        <Palette open={palette} onOpenChange={setPalette} start={start} />
        <TourHost />
      </PaletteContext.Provider>
    </ComposerContext.Provider>
  );
}
