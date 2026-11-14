/*
 * How every answer comes back from the stand-in, as from the real client: after a moment, refused without a connection
 * (`network`) and, but for the public calls, without a session (`unauthenticated`), and as a copy, so what the app holds
 * never changes under it. Each part of the API (account/, notes/, workspaces/...) answers through these.
 */
import { AlcoveApiError } from '@alcove/api';
import { isOnline } from '../browser';
import type { World } from '../world/world';
import { pause } from './live';
import { current, nextId, openedAs } from './state';

/** What the server says when it won't: in its words, with a request ID, as the app shows it. */
export const refused = (code: 'not-found' | 'forbidden' | 'conflict' | 'invalid', message: string) => new AlcoveApiError(code, message, { requestId: nextId('sb-req') });
const offline = () => new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.');

/** Answers after a moment, from the world as it is then, as a copy: what the app holds never changes under it. */
export async function answer<T>(read: (w: World) => T, who: 'anyone' | 'signed-in' = 'signed-in'): Promise<T> {
  await pause(openedAs().latency);
  if (!isOnline()) throw offline();
  const w = current();
  if (who === 'signed-in' && !w.session) throw new AlcoveApiError('unauthenticated', 'Your session ended. Sign in again.');
  return structuredClone(read(w));
}
/** The same, for what streams: refused before the first part, like a request that never opened. */
export async function* stream<T>(parts: (w: World) => T[], every = 70): AsyncIterable<T> {
  const all = await answer(parts);
  for (const p of all) { await pause(every); yield p; }
}
