/*
 * Owner sessions (docs: privacy-keys-and-sessions › Active delegation). The owner root lives only
 * here, in memory: 15 minutes idle, 60 minutes absolute, gone on restart.
 */
import { id128, ownerWrapKey } from './crypto';
import { log } from './log';

/** Session IDs are bearer secrets and never logged; the owner ID identifies the session in logs. */
const slog = log.child({ component: 'sessions' });
export type CloseReason = 'lock' | 'replaced' | 'idle' | 'absolute' | 'shutdown';

export const IDLE_MS = 15 * 60_000;
export const ABSOLUTE_MS = 60 * 60_000;
export const COOKIE = 'alcove_session';
/** Over HTTPS the cookie gets the __Host- prefix: Secure, host-only, path /. */
export const cookieName = (secure: boolean) => (secure ? `__Host-${COOKIE}` : COOKIE);

export interface OwnerSession {
  id: string;
  ownerId: string;
  root: Uint8Array;
  wrapKey: Uint8Array;
  rootSource: 'prf' | 'device';
  createdAt: number;
  lastActive: number;
  /** Until when a fresh passkey proof allows changing passkeys. */
  stepUpUntil?: number;
}

export class SessionStore {
  private byId = new Map<string, OwnerSession>();
  constructor(private readonly now: () => number = Date.now) {}

  open(ownerId: string, root: Uint8Array, rootSource: 'prf' | 'device'): OwnerSession {
    // One current session per owner: a new unlock closes the old one.
    for (const s of this.byId.values()) if (s.ownerId === ownerId) this.close(s.id, 'replaced');
    const t = this.now();
    const s: OwnerSession = { id: id128() + id128(), ownerId, root, wrapKey: ownerWrapKey(root, ownerId), rootSource, createdAt: t, lastActive: t };
    this.byId.set(s.id, s);
    slog.info('session opened', { ownerId, rootSource, open: this.byId.size });
    return s;
  }
  /** Returns the live session and extends its idle deadline, or undefined if expired. */
  touch(id: string | undefined): OwnerSession | undefined {
    if (!id) return undefined;
    const s = this.byId.get(id);
    if (!s) return undefined;
    const t = this.now();
    const expired = this.expiry(s, t);
    if (expired) { this.close(id, expired); return undefined; }
    s.lastActive = t;
    return s;
  }
  expiresAt(s: OwnerSession): Date { return new Date(s.createdAt + ABSOLUTE_MS); }
  /** Closes every expired session, so idle roots leave memory even if the browser never returns. */
  sweep(): number {
    const t = this.now(); let n = 0;
    for (const s of [...this.byId.values()]) { const why = this.expiry(s, t); if (why) { this.close(s.id, why); n++; } }
    return n;
  }
  get size() { return this.byId.size; }
  close(id: string, reason: CloseReason = 'lock') {
    const s = this.byId.get(id);
    if (!s) return;
    s.root.fill(0); s.wrapKey.fill(0);
    this.byId.delete(id);
    slog.info('session closed', { ownerId: s.ownerId, reason, ageS: Math.round((this.now() - s.createdAt) / 1000), open: this.byId.size });
  }
  /** Zeroes every session's keys (process shutdown). */
  closeAll() { for (const id of [...this.byId.keys()]) this.close(id, 'shutdown'); }
  private expiry(s: OwnerSession, t: number): CloseReason | undefined {
    if (t - s.createdAt > ABSOLUTE_MS) return 'absolute';
    if (t - s.lastActive > IDLE_MS) return 'idle';
    return undefined;
  }
}
