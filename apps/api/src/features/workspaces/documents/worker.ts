/*
 * The documents' worker: the module live/doc-pool.ts starts in each of its threads (./pool.ts › DOC_WORKER), built as
 * dist/live/doc-worker.js. It answers the pool's jobs with the documents' tasks (./work.ts); how a job comes and goes is
 * live/doc-worker.ts's.
 */
import { answerJobs } from '../../../live/doc-worker';
import { DOC_TASKS, isDocTask } from './work';

answerJobs((task) => (isDocTask(task) ? DOC_TASKS[task] : undefined));
