/*
 * Where documents are opened (docs: Data and storage › Documents). What's in a document came from browsers, and Yjs has no
 * limit on what opening one can cost, so it never happens on the event loop: a few worker threads do it, each with a limit on
 * its memory, and each job with a limit on its time. A worker that runs out of either takes one job with it, and the API
 * doesn't notice.
 *
 * Only the first worker takes big documents, so one person's enormous document leaves the others free for everyone else's,
 * and an instance never holds more than one at a time. The rest have less memory, which is all a small document needs.
 */
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { UnavailableError } from '../errors';
import { log } from '../log';
import { DOC_TASKS, type DocTasks } from '../modules/documentWork';

const plog = log.child({ component: 'doc-pool' });

/** How long a worker stays around with nothing to do: its memory goes back when it does. */
const IDLE_MS = 30_000;
/** How much can wait for a worker: past this, a browser is told to try again. */
const MAX_WAITING = 256;
const MAX_WAITING_BYTES = 128 * 1024 * 1024;
/** What a worker that only takes small documents needs. */
const SMALL_HEAP_MB = 96;
const STACK_MB = 8;

type TaskName = keyof DocTasks;
type InputOf<K extends TaskName> = DocTasks[K] extends { input: z.ZodType<infer I> } ? I : never;
type OutputOf<K extends TaskName> = DocTasks[K] extends { output: z.ZodType<infer O> } ? O : never;
const outputs: { [K in TaskName]: { output: z.ZodType<OutputOf<K>> } } = DOC_TASKS;

export interface DocPoolSettings { workers: number; timeoutMs: number; heapMb: number }
/** What a job says about itself. `big`: only the worker for big documents takes it. `first`: something's holding a lock until this is done. */
export interface JobOptions { big: boolean; bytes: number; first?: boolean | undefined }

/** Why a job didn't finish. `time` and `memory`: it was too much. `failed`: something in it won't open. */
export type DocFailureReason = 'time' | 'memory' | 'failed';
export class DocFailure extends UnavailableError {
  constructor(readonly reason: DocFailureReason, detail: string) {
    super('This document can’t be opened right now.', { context: { reason, detail } });
  }
}

export interface DocPool {
  run<K extends TaskName>(task: K, input: InputOf<K>, o: JobOptions): Promise<OutputOf<K>>;
  close(): Promise<void>;
}

const Reply = z.union([
  z.object({ ready: z.literal(true) }),
  z.object({ id: z.number(), ok: z.literal(true), value: z.unknown() }),
  z.object({ id: z.number(), ok: z.literal(false), failure: z.string() })
]);
interface Job { id: number; task: TaskName; input: unknown; big: boolean; bytes: number; done(value: unknown): void; failed(e: unknown): void }
interface Slot { big: boolean; worker: Worker | null; ready: boolean; job: Job | null; limit: ReturnType<typeof setTimeout> | undefined; idle: ReturnType<typeof setTimeout> | undefined }

/** In the bundle the worker is a file of its own beside `server.js`; from source it's TypeScript, as everything is there. */
const entry = () => (import.meta.url.endsWith('.js')
  ? { url: new URL('./live/docWorker.js', import.meta.url), execArgv: [] }
  : { url: new URL('./docWorker.ts', import.meta.url), execArgv: ['--import', 'tsx'] });

class WorkerPool implements DocPool {
  private readonly slots: Slot[];
  private readonly waiting: Job[] = [];
  private waitingBytes = 0;
  private nextId = 1;
  private closed = false;

  constructor(private readonly settings: DocPoolSettings) {
    this.slots = Array.from({ length: Math.max(settings.workers, 1) }, (_, i) => ({ big: i === 0, worker: null, ready: false, job: null, limit: undefined, idle: undefined }));
  }

  run<K extends TaskName>(task: K, input: InputOf<K>, o: JobOptions): Promise<OutputOf<K>> {
    return new Promise<unknown>((done, failed) => {
      if (this.closed) throw new UnavailableError('This server is shutting down. Try again.');
      if (this.waiting.length >= MAX_WAITING || this.waitingBytes + o.bytes > MAX_WAITING_BYTES) throw new UnavailableError('Alcove is very busy right now. This will carry on by itself in a moment.', { context: { task, waiting: this.waiting.length, bytes: this.waitingBytes } });
      const job: Job = { id: this.nextId++, task, input, big: o.big, bytes: o.bytes, done, failed };
      if (o.first) this.waiting.unshift(job);
      else this.waiting.push(job);
      this.waitingBytes += o.bytes;
      this.pump();
    }).then((raw) => outputs[task].output.parse(raw));
  }

  /** Gives each free worker the first thing it can take. */
  private pump(): void {
    for (const slot of this.slots) {
      if (slot.job) continue;
      const at = this.waiting.findIndex((j) => slot.big || !j.big);
      const job = this.waiting[at];
      if (!job) continue;
      if (!slot.worker) this.start(slot);
      if (!slot.ready) continue;
      this.waiting.splice(at, 1);
      this.waitingBytes -= job.bytes;
      this.begin(slot, job);
    }
  }

  private start(slot: Slot): void {
    const { url, execArgv } = entry();
    const worker = new Worker(url, { execArgv, resourceLimits: { maxOldGenerationSizeMb: slot.big ? this.settings.heapMb : Math.min(this.settings.heapMb, SMALL_HEAP_MB), stackSizeMb: STACK_MB } });
    slot.worker = worker;
    slot.ready = false;
    worker.on('message', (raw: unknown) => this.heard(slot, worker, raw));
    worker.on('error', (e: Error & { code?: string }) => this.lost(slot, worker, e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'memory' : 'failed', e.message));
    worker.on('exit', (code) => this.lost(slot, worker, 'failed', `exited with ${code}`));
    worker.unref();
  }

  private begin(slot: Slot, job: Job): void {
    const { worker } = slot;
    if (!worker) return;
    clearTimeout(slot.idle);
    slot.job = job;
    worker.ref();
    slot.limit = setTimeout(() => this.lost(slot, worker, 'time', `over ${this.settings.timeoutMs} ms`), this.settings.timeoutMs);
    worker.postMessage({ id: job.id, task: job.task, input: job.input });
  }

  private finished(slot: Slot): void {
    clearTimeout(slot.limit);
    slot.job = null;
    const { worker } = slot;
    if (worker) {
      worker.unref();
      slot.idle = setTimeout(() => { if (!slot.job) this.stop(slot, worker); }, IDLE_MS);
      slot.idle.unref();
    }
    this.pump();
  }

  private heard(slot: Slot, worker: Worker, raw: unknown): void {
    const reply = Reply.parse(raw);
    if ('ready' in reply) {
      slot.ready = true;
      this.pump();
      if (!slot.job) this.finished(slot);
      return;
    }
    const { job } = slot;
    if (slot.worker !== worker || !job || job.id !== reply.id) return;
    if (reply.ok) job.done(reply.value);
    else job.failed(new DocFailure('failed', reply.failure));
    this.finished(slot);
  }

  /** A worker that's gone takes its job with it, and whoever's next gets a new one. */
  private lost(slot: Slot, worker: Worker, reason: DocFailureReason, detail: string): void {
    if (slot.worker !== worker) return;
    const { job } = slot;
    clearTimeout(slot.limit);
    clearTimeout(slot.idle);
    slot.worker = null;
    slot.ready = false;
    slot.job = null;
    void worker.terminate();
    if (job) {
      plog.warn('a worker gave up on a document', { task: job.task, reason, detail, bytes: job.bytes });
      job.failed(new DocFailure(reason, detail));
    } else if (!this.closed) plog.warn('a worker went', { reason, detail });
    if (!this.closed) this.pump();
  }

  private stop(slot: Slot, worker: Worker): void {
    if (slot.worker !== worker) return;
    slot.worker = null;
    slot.ready = false;
    void worker.terminate();
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.waiting.splice(0)) job.failed(new UnavailableError('This server is shutting down. Try again.'));
    this.waitingBytes = 0;
    await Promise.all(this.slots.map(async (slot) => {
      clearTimeout(slot.limit);
      clearTimeout(slot.idle);
      const { worker, job } = slot;
      slot.worker = null;
      slot.job = null;
      job?.failed(new UnavailableError('This server is shutting down. Try again.'));
      await worker?.terminate();
    }));
  }
}

/** This instance's workers. None starts until a document needs one. */
export const createDocPool = (settings: DocPoolSettings): DocPool => new WorkerPool(settings);
