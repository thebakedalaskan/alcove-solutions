/*
 * One worker of live/docPool.ts: it does what it's asked, one job at a time, and hands back what came of it. A job's key comes
 * with it and is wiped when it's done, so nothing here outlives a request. Nothing here logs: what's worth saying goes back in
 * the result, for the API to log with what it knows. What a job says went wrong is plain, because nothing in a document is
 * in it.
 */
import { parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { DOC_TASKS, isDocTask } from '../modules/documentWork';

const Job = z.object({ id: z.number(), task: z.string(), input: z.unknown() });
const WithKey = z.object({ key: z.instanceof(Uint8Array) });

/** Bytes this thread made go back without being copied. Part of a shared buffer stays here, and is copied. */
function moving(value: unknown, found: Set<ArrayBuffer> = new Set()): ArrayBuffer[] {
  if (value instanceof Uint8Array) {
    if (value.buffer instanceof ArrayBuffer && value.byteLength === value.buffer.byteLength) found.add(value.buffer);
  } else if (Array.isArray(value)) for (const v of value) moving(v, found);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) moving(v, found);
  return [...found];
}

const port = parentPort;
port?.on('message', (raw: unknown) => {
  const { id, task, input } = Job.parse(raw);
  try {
    if (!isDocTask(task)) throw new Error('There’s no such job.');
    const value = DOC_TASKS[task].call(input);
    port.postMessage({ id, ok: true, value }, moving(value));
  } catch (e) {
    port.postMessage({ id, ok: false, failure: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown' });
  } finally {
    WithKey.safeParse(input).data?.key.fill(0);
  }
});
port?.postMessage({ ready: true });
