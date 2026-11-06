/*
 * Signing out, or deleting the account, in one tab is heard in every other tab of this browser at once (BroadcastChannel
 * `alcove-account`). From then on nothing is kept here for that account, in any tab: what was kept was deleted on purpose,
 * and nothing may bring it back, nor the device key that sealed it. The other tabs leave for the welcome page, so none of
 * them goes on saying that what's written there is safe. Signing in again is heard the same way, and keeping starts again.
 */
import { AccountDeviceStateSchema, AccountSignalSchema, type AccountDeviceState, type AccountSignal } from '@alcove/api';
import { log } from './log';

const slog = log.child({ component: 'account-device-state' });
const STATE_PREFIX = 'alcove.account-state.';
const stateKey = (owner: string) => `${STATE_PREFIX}${owner}`;
let warnedStorage = false;
const failedStates = new Map<string, AccountDeviceState>();

function storageFailed(): void {
  if (warnedStorage) return;
  warnedStorage = true;
  slog.warn('account revocation storage is unavailable');
}

function deviceState(owner: string): { available: boolean; state: AccountDeviceState | null } {
  if (typeof window === 'undefined') return { available: false, state: null };
  try {
    const raw = localStorage.getItem(stateKey(owner));
    if (raw === null) return { available: true, state: null };
    const value: unknown = JSON.parse(raw);
    const parsed = AccountDeviceStateSchema.safeParse(value);
    if (!parsed.success) { storageFailed(); return { available: false, state: null }; }
    return { available: true, state: parsed.data };
  } catch {
    storageFailed();
    return { available: false, state: null };
  }
}

function remember(owner: string, out: boolean): void {
  const previous = deviceState(owner);
  const generation = out ? crypto.randomUUID() : failedStates.get(owner)?.generation ?? previous.state?.generation ?? crypto.randomUUID();
  // The revocation nonce survives sign-in; a new activation also revokes work from before a failed sign-out write.
  const activation = out ? previous.state?.activation ?? crypto.randomUUID() : crypto.randomUUID();
  const state: AccountDeviceState = { generation, activation, signedOut: out };
  try {
    localStorage.setItem(stateKey(owner), JSON.stringify(state));
    failedStates.delete(owner);
  } catch {
    // Signing out must still finish when browser storage is unavailable. Picture writes fail closed instead.
    storageFailed();
    failedStates.set(owner, state);
  }
}

/* Only in a browser: prerendering runs this in Node, where an open channel with a listener keeps the build from ever exiting. */
const channel = typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('alcove-account');
const gone = new Set<string>();
const listeners = new Set<(owner: string, deleted: boolean) => void>();

channel?.addEventListener('message', (e: MessageEvent<unknown>) => {
  const signal = AccountSignalSchema.safeParse(e.data);
  if (!signal.success) return;
  const s = signal.data;
  if (s.type === 'signed-in') { gone.delete(s.owner); return; }
  gone.add(s.owner);
  listeners.forEach((l) => l(s.owner, s.deleted));
});
const say = (signal: AccountSignal) => { channel?.postMessage(signal); };

/** Whether `owner` signed out in this browser since this page loaded, in this tab or another. */
export const signedOut = (owner: string): boolean => gone.has(owner);

/** Capture before any asynchronous work; null means revocation cannot be checked and private pictures must stay closed. */
export function accountGeneration(owner: string): string | null {
  if (failedStates.has(owner)) return null;
  const current = deviceState(owner);
  if (!current.available || current.state?.signedOut) return null;
  const state = current.state ?? { generation: crypto.randomUUID(), activation: crypto.randomUUID(), signedOut: false };
  try {
    // Check writability too. A read-only storage context must not accept an upload it cannot later revoke.
    localStorage.setItem(stateKey(owner), JSON.stringify(state));
    return `${state.generation}\n${state.activation}`;
  } catch {
    storageFailed();
    failedStates.set(owner, state);
    return null;
  }
}

/** A session response's owner is unknown until it arrives. Capture each account's state before starting that request. */
export function accountReadFence(): (owner: string) => boolean {
  const before = new Map<string, AccountDeviceState | null>();
  let available = false;
  if (typeof window !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(STATE_PREFIX)) continue;
        const owner = key.slice(STATE_PREFIX.length);
        const current = deviceState(owner);
        before.set(owner, current.available ? current.state : null);
      }
      available = true;
    } catch {
      storageFailed();
    }
  }
  return (owner) => {
    if (!available || signedOut(owner)) return false;
    const current = deviceState(owner);
    if (!current.available) return false;
    const previous = before.get(owner);
    if (previous === undefined) return current.state === null;
    if (previous === null || current.state === null) return false;
    return previous.generation === current.state.generation && previous.activation === current.state.activation && previous.signedOut === current.state.signedOut;
  };
}

/** A verified session reopens pictures only; it never clears another flow's sign-out or announces a new sign-in. */
export function activatePictureAccount(owner: string): void {
  remember(owner, false);
}

/** This tab is signing `owner` out, or deleting the account: from now on nothing is kept for them, here or in any other tab. */
export function announceSignOut(owner: string, deleted: boolean): void {
  gone.add(owner);
  remember(owner, true);
  say({ type: 'signed-out', owner, deleted });
}

/** `owner` signed in here: every tab keeps what's written for them again. */
export function announceSignIn(owner: string): void {
  gone.delete(owner);
  remember(owner, false);
  say({ type: 'signed-in', owner });
}

/** Another tab signed someone out, or deleted their account. */
export function onSignedOutElsewhere(listener: (owner: string, deleted: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
