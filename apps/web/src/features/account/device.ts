/*
 * What this browser remembers about being signed in, so Alcove opens without a connection and Record works there
 * (docs: Privacy, keys and sessions › On this device): the account's opaque ID, when its session ends at the
 * latest, and whether it records without a connection. Never a name or an address. It follows the session and the
 * preferences as the app reads them, and goes when the session does (signing out, a 401, deleting the account).
 */
import { PreferencesSchema, SessionSchema, SignedInHereSchema, type SignedInHere } from '@alcove/api';
import { hashKey, type QueryClient } from '@tanstack/react-query';
import { log } from '~/lib/log';
import { accountKeys } from './queryKeys';

const KEY = 'alcove.signedIn';
const dlog = log.child({ component: 'device' });

function read(): SignedInHere | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const r = SignedInHereSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch (e) {
    dlog.warn('couldn’t read what this browser remembers about being signed in', { err: e });
    return null;
  }
}
function write(v: SignedInHere | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch (e) {
    dlog.debug('this browser’s storage is unavailable', { err: e });
  }
}

/** The account this browser was last signed in to, while its session can still be going; null otherwise. */
export function signedInHere(): SignedInHere | null {
  const v = read();
  return v && Date.parse(v.until) > Date.now() ? v : null;
}

/** Whether the account here records without a connection: yes, unless its preferences say otherwise. */
export const recordOfflineHere = (): boolean => read()?.recordOffline ?? true;

/** Keeps what this browser remembers in step with the session and the preferences the app reads. */
export function watchDevice(qc: QueryClient): () => void {
  const session = hashKey(accountKeys.session);
  const prefs = hashKey(accountKeys.prefs);
  return qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success') return;
    if (e.query.queryHash === session) {
      const s = SessionSchema.nullable().safeParse(e.query.state.data);
      if (!s.success) return;
      if (!s.data) { write(null); return; }
      const before = read();
      write({ ownerId: s.data.ownerId, until: s.data.expiresAt, recordOffline: before?.ownerId === s.data.ownerId ? before.recordOffline : true });
    } else if (e.query.queryHash === prefs) {
      const p = PreferencesSchema.safeParse(e.query.state.data);
      const v = read();
      if (p.success && v && v.recordOffline !== p.data.recordOffline) write({ ...v, recordOffline: p.data.recordOffline });
    }
  });
}
