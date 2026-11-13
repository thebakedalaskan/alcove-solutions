/*
 * The documents' side of the worker pool (live/doc-pool.ts): the module its workers run (./worker.ts), and running one of
 * the documents' tasks there (./work.ts), with what comes back checked against that task's own shape.
 */
import type { z } from 'zod';
import type { DocPool, JobOptions, WorkerEntry } from '../../../live/doc-pool';
import { DOC_TASKS, type DocTasks } from './work';

/** In the bundle the worker is a file of its own beside `server.js`; from source it's TypeScript, as everything is there. */
export const DOC_WORKER: WorkerEntry = import.meta.url.endsWith('.js')
  ? { url: new URL('./live/doc-worker.js', import.meta.url), execArgv: [] }
  : { url: new URL('./worker.ts', import.meta.url), execArgv: ['--import', 'tsx'] };

type TaskName = keyof DocTasks;
type InputOf<K extends TaskName> = DocTasks[K] extends { input: z.ZodType<infer I> } ? I : never;
type OutputOf<K extends TaskName> = DocTasks[K] extends { output: z.ZodType<infer O> } ? O : never;
const outputs: { [K in TaskName]: { output: z.ZodType<OutputOf<K>> } } = DOC_TASKS;

/** Runs one of the documents' tasks in this instance's workers, which know it only by its name: what comes back is checked here. */
export async function runDoc<K extends TaskName>(pool: DocPool, task: K, input: InputOf<K>, o: JobOptions): Promise<OutputOf<K>> {
  return outputs[task].output.parse(await pool.run(task, input, o));
}
