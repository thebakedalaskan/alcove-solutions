/*
 * A move's claim, kept in this tab only (sessionStorage) while it goes to sign in with Google and comes back: Google
 * sends the browser away and back, and nothing else carries over. It's taken out as soon as the page is back, and
 * the move it belongs to runs out within minutes anyway.
 */
import { MoveSecretSchema } from '@alcove/api';
import { log } from '~/lib/log';

const slog = log.child({ component: 'move' });
const KEY = 'alcove.move-claim';

export function keepClaim(claim: string): void {
  try { sessionStorage.setItem(KEY, claim); } catch (e) { slog.debug('move claim not kept', { err: e }); }
}

/** The claim this tab kept, once: reading it removes it. */
export function takeClaim(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const r = MoveSecretSchema.safeParse(raw);
    return r.success ? r.data : null;
  } catch (e) {
    slog.debug('move claim not readable', { err: e });
    return null;
  }
}

/** The code from the link's fragment, once: it's taken out of the address bar (and so out of history) straight away. */
export function takeCode(): string | null {
  const raw = location.hash.slice(1);
  if (raw) history.replaceState(history.state, '', location.pathname);
  const r = MoveSecretSchema.safeParse(raw);
  return r.success ? r.data : null;
}
