import type { LiveStore } from '@alcove/api';
import { useEffect, useState } from 'react';
import { useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { openPop } from '../screen-sharing/popOut';
import type { ShareLooks } from '../screen-sharing/shareLook';

const flog = log.child({ component: 'floating-call' });
type Origin = 'manual' | 'auto';
interface FloatingWindowState {
  target: Window | null;
  origin: Origin | null;
  pending: boolean;
  error: string | null;
  mainVisible: boolean;
}

/* This action belongs to the active call only. Playback owns its other Media Session actions and metadata. */
let nativeOwner: FloatingWindow | null = null;
const mainVisible = () => document.visibilityState === 'visible' && document.hasFocus();

/** Owns the child document, browser callbacks and their cleanup. It owns no call connection, capture or media track. */
class FloatingWindow implements LiveStore<FloatingWindowState> {
  readonly supported = typeof window !== 'undefined' && Boolean(window.documentPictureInPicture);
  private state: FloatingWindowState = { target: null, origin: null, pending: false, error: null, mainVisible: typeof document !== 'undefined' && mainVisible() };
  private listeners = new Set<() => void>();
  private generation = 0;
  private running = false;
  private active = false;
  private eligible = false;
  private dismissedAuto = false;
  private stopChild: (() => void) | null = null;
  constructor(private readonly shares: ShareLooks) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<FloatingWindowState>) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(); }

  start(): () => void {
    this.running = true;
    const visible = () => {
      const shown = mainVisible();
      this.set({ mainVisible: shown });
      if (shown) {
        this.dismissedAuto = false;
        if (this.state.origin === 'auto') this.close();
      }
    };
    const leave = () => this.close();
    const stopShares = this.shares.subscribe(() => {
      // A share explicitly opened after this request wins, including while the call's request is still pending.
      if (this.shares.getSnapshot().popped) this.close();
    });
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('blur', visible);
    window.addEventListener('pagehide', leave);
    visible();
    return () => {
      this.running = false;
      this.active = false;
      this.close();
      this.unregister();
      stopShares();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      window.removeEventListener('blur', visible);
      window.removeEventListener('pagehide', leave);
    };
  }

  configure(active: boolean, eligible: boolean): void {
    this.active = active;
    this.eligible = eligible;
    if (!active) this.close();
    this.unregister();
    if (!active || !eligible || !this.supported || !('mediaSession' in navigator)) return;
    // Chrome's native automatic-PiP policy requires HTTPS or file, even where localhost supports manual PiP.
    if (location.protocol !== 'https:' && location.protocol !== 'file:') return;
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', (details) => {
        const reason = details.enterPictureInPictureReason === 'useraction' ? 'useraction' : details.enterPictureInPictureReason === 'contentoccluded' ? 'contentoccluded' : 'unspecified';
        flog.info('browser requested floating call', { reason, owned: nativeOwner === this, active: this.active, eligible: this.eligible });
        if (nativeOwner !== this || !this.running || !this.active || !this.eligible) return;
        // Only the browser invokes this. Older browsers supply no reason, so treat those requests as automatic.
        void this.open(reason === 'useraction' ? 'manual' : 'auto');
      });
      nativeOwner = this;
      flog.debug('automatic floating call action registered');
    } catch (e) {
      flog.debug('automatic floating call unavailable', { err: e });
    }
  }
  private unregister() {
    if (nativeOwner !== this) return;
    nativeOwner = null;
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture', null); flog.debug('automatic floating call action unregistered'); }
    catch (e) { flog.debug('floating call action already unavailable', { err: e }); }
  }

  open = async (origin: Origin = 'manual'): Promise<void> => {
    if (!this.running || !this.active || this.state.pending) return;
    if (!this.supported) { this.set({ error: 'This browser can’t open a floating call. Keep using the call in this tab.' }); return; }
    if (this.state.target && !this.state.target.closed) {
      if (origin === 'manual') { this.set({ origin: 'manual' }); this.state.target.focus(); }
      return;
    }
    if (origin === 'auto' && (this.dismissedAuto || this.shares.getSnapshot().popped || window.documentPictureInPicture?.window)) return;
    // Manual choice may replace the share window; a native automatic request may never replace it.
    if (origin === 'manual') this.shares.popIn();
    const generation = ++this.generation;
    this.set({ pending: true, origin, error: null });
    try {
      const target = await openPop('pip', 'Alcove call', 1.6, { width: 400, height: 360 });
      if (!target) { if (generation === this.generation) this.set({ pending: false, origin: null, error: 'Your browser didn’t open the floating call. Try again.' }); return; }
      if (!this.running || !this.active || generation !== this.generation || this.shares.getSnapshot().popped || window.documentPictureInPicture?.window !== target) {
        target.close();
        if (generation === this.generation) this.set({ pending: false, origin: null });
        return;
      }
      // A real return event cancels even a pending request through close()/generation above. Do not recheck current
      // visibility here: Chrome can invoke its authorized callback before the old tab's visibility event arrives.
      const shut = () => {
        if (this.state.target !== target) return;
        if (this.state.origin === 'auto') this.dismissedAuto = true;
        this.close();
      };
      target.addEventListener('pagehide', shut);
      const poll = window.setInterval(() => { if (target.closed) shut(); }, 1000);
      this.stopChild = () => { window.clearInterval(poll); target.removeEventListener('pagehide', shut); };
      this.set({ target, origin, pending: false });
      flog.info('floating call opened', { origin });
    } catch (e) {
      flog.info('floating call not opened', { err: e, origin });
      if (generation === this.generation) this.set({ pending: false, origin: null, error: 'Your browser didn’t open the floating call. Try again from View.' });
    }
  };
  close = (): void => {
    this.generation++;
    const target = this.state.target;
    this.stopChild?.();
    this.stopChild = null;
    if (target || this.state.pending || this.state.origin) this.set({ target: null, origin: null, pending: false });
    if (target && !target.closed) target.close();
  };
  returnToCall = (): void => { this.close(); window.focus(); };
}

/** The mounted call owns the window; reconnects retain it, terminal transitions and unmount always close it. */
export function useFloatingWindow(shares: ShareLooks, active: boolean, eligible: boolean) {
  const [owner] = useState(() => new FloatingWindow(shares));
  const state = useLive(owner);
  useEffect(() => owner.start(), [owner]);
  useEffect(() => { owner.configure(active, eligible); }, [owner, active, eligible]);
  return { owner, ...state, supported: owner.supported };
}
