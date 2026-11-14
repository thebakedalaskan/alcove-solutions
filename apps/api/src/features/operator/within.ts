/*
 * A report's read of something that may be out of reach (the database, LiveKit), raced against a time limit, so an
 * operator's answer never waits on it: what was read, or why not, as a code. When the time is up the read's signal is
 * aborted, so a read of several steps takes no more of them (`signal.throwIfAborted()` before each); the step running then
 * is left to end by itself, and nothing waits for it.
 */
import { log } from '../../platform/log';
import { failureCode } from '../../platform/runs';

const olog = log.child({ component: 'operator' });

/** What a read came to: its value, or the code of why not (`timeout` when the time ran out). */
export type Within<T> = { ok: true; value: T } | { ok: false; code: string };

/** Runs `read` for `ms` at most, with a signal aborted once the time is up. `what`: which read, as its line says when it fails. */
export async function within<T>(what: string, ms: number, read: (signal: AbortSignal) => Promise<T>): Promise<Within<T>> {
  const stop = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => { stop.abort(); resolve('late'); }, ms); });
  const reading = read(stop.signal).then((value) => ({ value }));
  // What the read does once nobody waits for it is its own: a step it stops at, or one that failed late, isn't an error.
  reading.catch((e: unknown) => { if (stop.signal.aborted) olog.debug('an operator report’s read stopped after its time ran out', { what, code: failureCode(e) }); });
  try {
    const got = await Promise.race([reading, late]);
    if (got !== 'late') return { ok: true, value: got.value };
    olog.warn('an operator report’s read ran out of time', { what, ms });
    return { ok: false, code: 'timeout' };
  } catch (e) {
    const code = failureCode(e);
    olog.warn('an operator report’s read failed', { what, code, err: e });
    return { ok: false, code };
  } finally {
    clearTimeout(timer);
  }
}
