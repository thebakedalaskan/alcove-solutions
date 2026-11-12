import { IconButton, WsDoc, WsOfflineEmpty, WsPane, cn } from '@alcove/ui';
import { Outlet, createFileRoute, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CallFlowHost, useCallFlowHost } from '~/features/calls/flow/CallFlow';
import { useKeptUploads } from '~/features/record/uploads';
import { useKeptEdits } from '~/features/workspace/sendKept';
import { useArrival } from '~/features/onboarding/store';
import { TourHost } from '~/features/onboarding/Tour';
import { Palette } from '~/features/shell/Palette';
import { OfflinePage } from '~/features/shell/OfflinePage';
import { inWorkspace } from '~/features/shell/places';
import { useSignedOutElsewhere } from '~/features/shell/signedOutElsewhere';
import { Offline, Sidebar, useSidePanel } from '~/features/shell/Sidebar';
import { PhoneTop, TabBar } from '~/features/shell/TabBar';
import { TopActions } from '~/features/shell/TopActions';
import { CallFlowContext, type PaletteStart } from '~/features/shell/context';
import { ownerOf, requireAccount } from '~/lib/guards';
import { takeArrival } from '~/lib/live';
import { overlayOpen, typing, withMod } from '~/lib/keys';

/*
 * Everything in the frame: the side panel (on a phone, the top bar and the tab bar) beside Home, Notes, a note, the
 * workspace, Record, Team and Settings. Opened without a connection by someone signed in here, Record works and every
 * other page says it's offline; once the connection is back, everything is read again.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, preload }) => requireAccount(context.queryClient, preload),
  component: Shell
});

/**
 * What the frame's arrival from a call's page moves (`data-arrive` in shell.css): the night lifting off the frame (the shell's own
 * `::before`), the page, the side panel and the tab bar. Their own animations only, never what plays inside them.
 */
function arrivalOf(shell: HTMLElement): Animation[] {
  const parts = new Set<Element>([shell, ...shell.querySelectorAll(':scope > .main, .sb-in, :scope > .tabbar')]);
  return shell.getAnimations({ subtree: true })
    .filter((a) => a instanceof CSSAnimation && a.effect instanceof KeyframeEffect && a.effect.target !== null && parts.has(a.effect.target));
}

function Shell() {
  const { account } = Route.useRouteContext();
  const router = useRouter();
  useKeptUploads(ownerOf(account));
  useKeptEdits(ownerOf(account));
  useSignedOutElsewhere(ownerOf(account));
  useEffect(() => {
    if (!account.offline) return;
    const back = () => { void router.invalidate(); };
    addEventListener('online', back);
    return () => removeEventListener('online', back);
  }, [account.offline, router]);
  const calls = useCallFlowHost();
  const { flow } = calls;
  const [palette, setPalette] = useState(false);
  const [start, setStart] = useState<PaletteStart>({ mode: 'find' });
  const side = useSidePanel();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { stage, opened } = useArrival();
  const openPalette = useCallback((s: PaletteStart = { mode: 'find' }) => { setStart(s); setPalette(true); }, []);
  const paletteOpen = useRef(false);
  useEffect(() => { paletteOpen.current = palette; }, [palette]);
  const pathNow = useRef(path);
  pathNow.current = path;
  const full = inWorkspace(path);
  /*
   * Come from a call's page (Go to Home, Open the notes), the frame settles in once, its side panel easing in after it, in
   * place of its usual fade: the fade isn't put back afterwards, or it would play again. The page said so on its way out, and
   * the frame takes it as it first shows; the arrival ends once what it moves has played out, however long the stylesheet
   * makes it (short fades with reduced motion).
   */
  const shell = useRef<HTMLDivElement>(null);
  const [arrival, setArrival] = useState<'none' | 'from-call' | 'arrived'>('none');
  useLayoutEffect(() => { if (takeArrival()) setArrival('from-call'); }, []);
  useLayoutEffect(() => {
    const el = shell.current;
    if (arrival !== 'from-call' || !el) return undefined;
    let live = true;
    void Promise.allSettled(arrivalOf(el).map((a) => a.finished)).then(() => { if (live) setArrival('arrived'); });
    return () => { live = false; };
  }, [arrival]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // Something on the page took it: ⌘K with words selected in a document, or anywhere on a workspace's page, is that page's.
      if (e.defaultPrevented) return;
      if (withMod(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // ⌘K (Ctrl+K off a Mac) closes the palette again; it never opens it over a call being started or anything else.
        if (paletteOpen.current) setPalette(false);
        else if (!overlayOpen()) openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || overlayOpen()) return;
      if (e.key === 'n' && !inWorkspace(pathNow.current)) { e.preventDefault(); flow.start(); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [flow, openPalette]);

  return (
    <CallFlowContext.Provider value={flow}>
        {/* Behind a new account's arrival screen until it opens; then in again, as the arch opens. */}
        <div key={opened} ref={shell} className={cn('shell', arrival === 'none' && 'world-in', side.hidden && 'is-bare')} data-arrive={arrival === 'from-call' ? 'call' : undefined} inert={stage === 'creating'}>
          <Sidebar hidden={side.hidden} hideRef={side.hideRef} onHide={side.hide} onNew={() => flow.start()} onPin={() => openPalette({ mode: 'pin' })} />
          {side.hidden && <IconButton ref={side.showRef} icon="panel" label="Show the side panel" className="sb-show" onClick={side.show} />}
          <PhoneTop onSearch={() => openPalette()} onNew={() => flow.start()} />
          <main className={cn('main', full && 'is-full')}>
            {/* With the side panel hidden, its offline notice moves to the top of the page. */}
            <Offline show={side.hidden} className="main-offline" />
            <div className="main-top"><TopActions onSearch={() => openPalette()} keyed={!full} /></div>
            <div key={full ? '/drive/' : path} className="main-in enter">
              {account.offline && full ? <WsPane page><WsDoc><WsOfflineEmpty /></WsDoc></WsPane> : account.offline && path !== '/record' ? <OfflinePage /> : <Outlet />}
            </div>
          </main>
          <TabBar />
        </div>
        <CallFlowHost opened={calls.opened} open={calls.open} close={calls.close} />
        <Palette open={palette} onOpenChange={setPalette} start={start} />
        <TourHost />
    </CallFlowContext.Provider>
  );
}
