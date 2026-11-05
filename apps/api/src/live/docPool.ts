/*
 * Where documents are opened (docs: Data and storage › Documents). What's in a document came from browsers, and Yjs has no
 * limit on what opening one can cost, so it never happens on the event loop: a few worker threads do it, each with a limit on
 * its memory, and each job with a limit on its time. A worker that runs out of either takes one job with it, and the API
 * doesn't notice.
 *
 * Only the first worker takes big documents, so one person's enormous document leaves the others free for everyone else's,
 * and an instance never holds more than one at a time. The rest have less memory, which is all a small document needs. A
 * document that turns out slow for its size goes the way of a big one, for a while.
 *
 * People take turns. Each has a line of their own, and a free worker goes to the next person in turn who has nothing running,
 * so someone opening a document waits behind one job, however much anyone else has asked for. There's a limit to how much of
 * one person's work can wait, past which their browser is told to try again.
 */
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { UnavailableError } from '../errors';
import { log } from '../log';
import { DOC_TASKS, type DocTasks } from '../modules/documentWork';

const plog = log.child({ component: 'doc-pool' });

/** How long a worker stays around with nothing to do: its memory goes back when it does. One that's held a big document goes at once, because that's most of what an instance has, and a new one takes moments. */
const IDLE_MS = 30_000;
const IDLE_AFTER_BIG_MS = 1_000;
/** How much can wait for a worker: past this, a browser is told to try again. */
const MAX_WAITING = 256;
const MAX_WAITING_BYTES = 128 * 1024 * 1024;
/** One person's share of that, in bytes: in jobs it's `waitingPerPerson`. Someone's first is taken whatever it comes to. */
const MAX_WAITING_BYTES_EACH = 32 * 1024 * 1024;
/** What a worker that only takes small documents needs. */
const SMALL_HEAP_MB = 96;
/** A job this long says a document is slow, whatever its size says, and how long that's remembered, for how many documents. */
const SLOW_JOB_MS = 1_000;
const SLOW_FOR_MS = 10 * 60_000;
const SLOW_DOCUMENTS = 1_000;
const STACK_MB = 8;

type TaskName = keyof DocTasks;
type InputOf<K extends TaskName> = DocTasks[K] extends { input: z.ZodType<infer I> } ? I : never;
type OutputOf<K extends TaskName> = DocTasks[K] extends { output: z.ZodType<infer O> } ? O : never;
const outputs: { [K in TaskName]: { output: z.ZodType<OutputOf<K>> } } = DOC_TASKS;

export interface DocPoolSettings { workers: number; timeoutMs: number; heapMb: number; waitingPerPerson: number }
/**
 * What a job says about itself. `big`: only the worker for big documents takes it. `who`: whose turn it's on: a person, or a
 * workspace for what nobody asked for. `doc`: the document, if it's one that can prove slow. `first`: something's holding a
 * lock until this is done, so it goes ahead of everyone.
 */
export interface JobOptions { big: boolean; bytes: number; who: string; doc?: string | undefined; first?: boolean | undefined }

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
interface Job { id: number; task: TaskName; input: unknown; big: boolean; bytes: number; who: string; doc: string | undefined; first: boolean; started: number; done(value: unknown): void; failed(e: unknown): void }
/** One person's line. */
interface Line { jobs: Job[]; bytes: number }
interface Slot { big: boolean; worker: Worker | null; ready: boolean; job: Job | null; heavy: boolean; limit: ReturnType<typeof setTimeout> | undefined; idle: ReturnType<typeof setTimeout> | undefined }

/** In the bundle the worker is a file of its own beside `server.js`; from source it's TypeScript, as everything is there. */
const entry = () => (import.meta.url.endsWith('.js')
  ? { url: new URL('./live/docWorker.js', import.meta.url), execArgv: [] }
  : { url: new URL('./docWorker.ts', import.meta.url), execArgv: ['--import', 'tsx'] });

class WorkerPool implements DocPool {
  private readonly slots: Slot[];
  /** What something's holding a lock for. */
  private readonly urgent: Job[] = [];
  /** Everyone with something waiting, whoever's next first. */
  private readonly lines = new Map<string, Line>();
  /** How many jobs each person has running. */
  private readonly running = new Map<string, number>();
  private waiting = 0;
  private waitingBytes = 0;
  /** Documents that proved slow, and until when, the oldest first. */
  private readonly slow = new Map<string, number>();
  private nextId = 1;
  private closed = false;

  constructor(private readonly settings: DocPoolSettings) {
    this.slots = Array.from({ length: Math.max(settings.workers, 1) }, (_, i) => ({ big: i === 0, worker: null, ready: false, job: null, heavy: false, limit: undefined, idle: undefined }));
  }

  run<K extends TaskName>(task: K, input: InputOf<K>, o: JobOptions): Promise<OutputOf<K>> {
    return new Promise<unknown>((done, failed) => {
      if (this.closed) throw new UnavailableError('This server is shutting down. Try again.');
      const line = this.lines.get(o.who);
      const theirs = line && !o.first && (line.jobs.length >= this.settings.waitingPerPerson || line.bytes + o.bytes > MAX_WAITING_BYTES_EACH);
      if (theirs || this.waiting >= MAX_WAITING || this.waitingBytes + o.bytes > MAX_WAITING_BYTES) throw new UnavailableError('Alcove is very busy right now. This will carry on by itself in a moment.', { context: { task, waiting: this.waiting, bytes: this.waitingBytes, theirs: line?.jobs.length ?? 0 } });
      const job: Job = { id: this.nextId++, task, input, big: o.big || this.isSlow(o.doc), bytes: o.bytes, who: o.who, doc: o.doc, first: o.first === true, started: 0, done, failed };
      if (job.first) this.urgent.push(job);
      else this.joinLine(job, line);
      this.waiting++;
      this.waitingBytes += o.bytes;
      this.pump();
    }).then((raw) => outputs[task].output.parse(raw));
  }

  private joinLine(job: Job, line: Line | undefined): void {
    const joined = line ?? { jobs: [], bytes: 0 };
    joined.jobs.push(job);
    joined.bytes += job.bytes;
    this.lines.set(job.who, joined);
  }
  /** Whose turn it is on this worker: what's holding a lock, then each person in turn. Someone with something running waits for everyone else, and takes a worker nobody else wants. */
  private nextFor(slot: Slot): Job | undefined {
    const fits = (j: Job) => slot.big || !j.big;
    const urgent = this.urgent.find(fits);
    if (urgent) return urgent;
    let busy: Job | undefined;
    for (const [who, line] of this.lines) {
      const job = line.jobs.find(fits);
      if (!job) continue;
      if (!this.running.has(who)) return job;
      busy ??= job;
    }
    return busy;
  }
  /** Out of the line it's in, and whoever it belonged to goes to the back. */
  private leaveLine(job: Job): void {
    this.waiting--;
    this.waitingBytes -= job.bytes;
    if (job.first) { this.urgent.splice(this.urgent.indexOf(job), 1); return; }
    const line = this.lines.get(job.who);
    if (!line) return;
    line.jobs.splice(line.jobs.indexOf(job), 1);
    line.bytes -= job.bytes;
    this.lines.delete(job.who);
    if (line.jobs.length) this.lines.set(job.who, line);
  }
  /** Gives each free worker whoever's next. */
  private pump(): void {
    for (const slot of this.slots) {
      if (slot.job) continue;
      const job = this.nextFor(slot);
      if (!job) continue;
      if (!slot.worker) this.start(slot);
      if (!slot.ready) continue;
      this.leaveLine(job);
      this.begin(slot, job);
    }
  }

  private isSlow(doc: string | undefined): boolean {
    const until = doc === undefined ? undefined : this.slow.get(doc);
    return until !== undefined && Date.now() < until;
  }
  /** What a job that's over says of its document. */
  private tookThisLong(job: Job): void {
    if (job.doc === undefined || Date.now() - job.started < SLOW_JOB_MS) return;
    this.slow.delete(job.doc);
    this.slow.set(job.doc, Date.now() + SLOW_FOR_MS);
    for (const doc of this.slow.keys()) {
      if (this.slow.size <= SLOW_DOCUMENTS) break;
      this.slow.delete(doc);
    }
  }
  private over(job: Job): void {
    const left = (this.running.get(job.who) ?? 1) - 1;
    if (left > 0) this.running.set(job.who, left);
    else this.running.delete(job.who);
    this.tookThisLong(job);
  }

  private start(slot: Slot): void {
    const { url, execArgv } = entry();
    const worker = new Worker(url, { execArgv, resourceLimits: { maxOldGenerationSizeMb: slot.big ? this.settings.heapMb : Math.min(this.settings.heapMb, SMALL_HEAP_MB), stackSizeMb: STACK_MB } });
    slot.worker = worker;
    slot.ready = false;
    slot.heavy = false;
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
    slot.heavy ||= job.big;
    job.started = Date.now();
    this.running.set(job.who, (this.running.get(job.who) ?? 0) + 1);
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
      slot.idle = setTimeout(() => { if (!slot.job) this.stop(slot, worker); }, slot.heavy ? IDLE_AFTER_BIG_MS : IDLE_MS);
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
    this.over(job);
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
      this.over(job);
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
    const waiting = [...this.urgent.splice(0), ...[...this.lines.values()].flatMap((line) => line.jobs)];
    this.lines.clear();
    for (const job of waiting) job.failed(new UnavailableError('This server is shutting down. Try again.'));
    this.waiting = 0;
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
