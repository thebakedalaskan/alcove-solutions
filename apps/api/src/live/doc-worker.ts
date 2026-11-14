/*
 * How one worker of live/doc-pool.ts answers: it does what it's asked, one job at a time, and hands back what came of it.
 * The module a worker runs brings the tasks and calls `answerJobs` (features/workspaces/documents/worker.ts). A job's key
 * comes with it and is wiped when it's done, so nothing here outlives a request. Nothing here logs: what's worth saying goes
 * back in the result, for the API to log with what it knows. What a job says went wrong is plain, because nothing in a
 * document is in it.
 */
import { parentPort } from 'node:worker_threads';
import { z } from 'zod';

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

/** One thing a worker can be asked, by name: it takes what it's sent, as it arrives, and gives back what it came to. */
export interface WorkerTask { call(input: unknown): unknown }

/** Answers the pool's jobs from now on, each with the task it names (`taskOf`), and says this worker is ready. */
export function answerJobs(taskOf: (name: string) => WorkerTask | undefined): void {
  const port = parentPort;
  port?.on('message', (raw: unknown) => {
    const { id, task, input } = Job.parse(raw);
    try {
      const run = taskOf(task);
      if (!run) throw new Error('There’s no such job.');
      const value = run.call(input);
      port.postMessage({ id, ok: true, value }, moving(value));
    } catch (e) {
      port.postMessage({ id, ok: false, failure: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown' });
    } finally {
      WithKey.safeParse(input).data?.key.fill(0);
    }
  });
  port?.postMessage({ ready: true });
}
