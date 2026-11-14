/*
 * The ring: this instance's newest lines that say something went wrong, for operators to count (GET /v1/operator/errors),
 * to follow one request by (GET /v1/operator/requests/:requestId) and to find work given up for good by (the work report's
 * finals). The logger feeds it as it writes (log.ts): every warn and error line, and every request's own line once it's
 * refused or failed, scrubbed as the log is, then reduced to fields that hold no free text: the time and level; the
 * component and message; the request's ID and the route it matched, by its template (`GET /v1/notes/:id`), never the path
 * as sent, which holds whatever the client typed; the status; the error's class and code; another service's status
 * (`upstreamStatus`) and what it was asked (`what`); the kind of work given up for good (`final`); and the IDs among the
 * line's fields. Everything else on the line stays in the log alone, which holds more.
 *
 * A request is one line here, its own (http/middleware.ts): its error's line isn't kept, since what it says (its class,
 * code, upstream status and IDs) goes on the request's line.
 *
 * What a client sends can't push out what the server says about itself:
 * - requests' lines and the server's own warn and error lines are kept apart, the newest 5,000 of each;
 * - lines given up for good (a note finished without a summary, an export that failed for good) are kept a third time, apart;
 * - what's logged while answering one client's requests (`withClient`), and the work they start, is kept up to that
 *   client's share, SHARE lines a minute, and only counted past it;
 * - a request that matched no route isn't kept at all, only counted (`unrouted`).
 *
 * Nothing a browser chose reaches it: a logger made with `{ ring: false }` never feeds it, whatever its lines carry. The
 * browser's telemetry is logged that way, since its fields can say any component or request ID. Nothing here imports the
 * logger, which imports this.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type RingLevel = 'info' | 'warn' | 'error';
/** The IDs a ring line keeps, when the line carries them: random IDs, none of which lets anyone in. */
export type RingIdKey = 'ownerId' | 'callId' | 'noteId' | 'jobId' | 'depositId' | 'recordingId' | 'grantId';
export const RING_IDS: readonly RingIdKey[] = ['ownerId', 'callId', 'noteId', 'jobId', 'depositId', 'recordingId', 'grantId'];

/** One line as the ring keeps it. `at` is Unix ms. */
export interface RingLine {
  at: number;
  level: RingLevel;
  component: string | null;
  msg: string;
  requestId: string | null;
  /** The route the line's request matched, its method and template (`POST /v1/recordings/:id/actions`). */
  route: string | null;
  status: number | null;
  code: string | null;
  errorClass: string | null;
  upstreamStatus: number | null;
  what: string | null;
  /** The kind of work the line says was given up for good (its `final`): `notes-without-summary`, say. */
  final: string | null;
  ids: Partial<Record<RingIdKey, string>>;
}

/** What a request's own line says once it's answered, refused or failed (http/middleware.ts). */
export const REQUEST_REFUSED = 'request refused';
export const REQUEST_FAILED = 'request failed';
/** How many lines each part keeps: the newest. */
const KEPT = 5_000;
const FINALS_KEPT = 1_000;
/** The most lines one client's requests, and the work they start, add in a minute. */
const SHARE = 120;
/** The most clients whose share is counted at once: past it, every share starts again. */
const CLIENTS_KEPT = 10_000;
/** How far back what isn't kept is counted, by the minute: as far as `errors` asks. */
const MINUTES_COUNTED = 240;
const MINUTE_MS = 60_000;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const COMPONENT = /^[A-Za-z0-9_.:-]{1,40}$/;
/** A route's method and template: printable, and the template is the server's own, never what a client typed. */
const ROUTE = /^[A-Z]{3,7} \/[\x21-\x7e]{0,200}$/;
const LONGEST_MSG = 200;
/** What a terminal acts on rather than shows: no message keeps one. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** A field of something logged, read without trusting its shape. */
function fieldOf(o: unknown, key: string): unknown {
  if (typeof o !== 'object' || o === null) return undefined;
  const value: unknown = Object.getOwnPropertyDescriptor(o, key)?.value;
  return value;
}
const matching = (v: unknown, pattern: RegExp): string | null => (typeof v === 'string' && pattern.test(v) ? v : null);
const statusIn = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599 ? v : null);

/** What a line's error says, serialized as the log serializes it (its class as `type`), or as thrown. */
function errorOf(err: unknown): { errorClass: string | null; code: string | null; upstreamStatus: number | null; what: string | null } {
  const context = fieldOf(err, 'context');
  return {
    errorClass: matching(fieldOf(err, 'type') ?? fieldOf(err, 'name'), CODE),
    code: matching(fieldOf(err, 'code'), CODE),
    upstreamStatus: statusIn(fieldOf(context, 'upstreamStatus')),
    what: matching(fieldOf(context, 'what'), CODE)
  };
}

function lineOf(fields: Record<string, unknown>, level: RingLevel, msg: string, at: number): RingLine {
  const err = errorOf(fields['err']);
  const ids: Partial<Record<RingIdKey, string>> = {};
  for (const key of RING_IDS) {
    const id = matching(fields[key], ID);
    if (id !== null) ids[key] = id;
  }
  return {
    at, level, msg: msg.replace(CONTROL, '?').slice(0, LONGEST_MSG),
    component: matching(fields['component'], COMPONENT),
    requestId: matching(fields['requestId'], ID),
    route: matching(fields['route'], ROUTE),
    status: statusIn(fields['status']),
    code: matching(fields['code'], CODE) ?? err.code,
    errorClass: matching(fields['errorClass'], CODE) ?? err.errorClass,
    upstreamStatus: statusIn(fields['upstreamStatus']) ?? err.upstreamStatus,
    what: matching(fields['what'], CODE) ?? err.what,
    final: matching(fields['final'], CODE),
    ids
  };
}

const isRequestLine = (msg: string): boolean => msg === REQUEST_REFUSED || msg === REQUEST_FAILED;

/** The newest lines of one kind, oldest first, and whether any were pushed out to keep the newest. */
class Kept {
  private readonly lines: (RingLine | undefined)[] = [];
  private next = 0;
  private wrapped = false;
  constructor(private readonly most: number) {}
  push(line: RingLine): void {
    this.lines[this.next] = line;
    this.next = (this.next + 1) % this.most;
    if (this.next === 0) this.wrapped = true;
  }
  all(): RingLine[] {
    const out: RingLine[] = [];
    for (let i = 0; i < this.most; i++) {
      const line = this.lines[(this.next + i) % this.most];
      if (line) out.push(line);
    }
    return out;
  }
  /** When the oldest line kept was logged, once lines older than it have been pushed out; null while none has. */
  reachesBackTo(): number | null {
    return this.wrapped ? this.lines[this.next]?.at ?? null : null;
  }
}

/** Something counted by the minute, over the last MINUTES_COUNTED minutes. */
class PerMinute {
  private readonly counts: number[] = new Array<number>(MINUTES_COUNTED).fill(0);
  /** The minute (since the epoch) the newest count is for. */
  private minute = 0;
  add(now: number): void {
    this.roll(now);
    const i = this.minute % MINUTES_COUNTED;
    this.counts[i] = (this.counts[i] ?? 0) + 1;
  }
  /** How many in the last `minutes` minutes, this one included. */
  since(minutes: number, now: number): number {
    this.roll(now);
    let n = 0;
    for (let k = 0; k < Math.min(minutes, MINUTES_COUNTED); k++) n += this.counts[(this.minute - k + MINUTES_COUNTED) % MINUTES_COUNTED] ?? 0;
    return n;
  }
  private roll(now: number): void {
    const minute = Math.floor(now / MINUTE_MS);
    if (minute <= this.minute) return;
    const steps = Math.min(minute - this.minute, MINUTES_COUNTED);
    for (let j = 1; j <= steps; j++) this.counts[(minute - steps + j) % MINUTES_COUNTED] = 0;
    this.minute = minute;
  }
}

/** Each client's lines this minute, so one client's requests can't take more than their share of what's kept. */
class Shares {
  private readonly used = new Map<string, { n: number; until: number }>();
  /** Whether `client` may add one more line now. */
  take(client: string, now: number): boolean {
    const u = this.used.get(client);
    if (!u || u.until <= now) {
      if (this.used.size >= CLIENTS_KEPT) this.used.clear();
      this.used.set(client, { n: 1, until: now + MINUTE_MS });
      return true;
    }
    u.n++;
    return u.n <= SHARE;
  }
}

/** Whose requests are being answered: their client's address, held in memory for their share and never logged. */
const clients = new AsyncLocalStorage<string>();

class Ring {
  private readonly requests = new Kept(KEPT);
  private readonly failures = new Kept(KEPT);
  private readonly finals = new Kept(FINALS_KEPT);
  private readonly shares = new Shares();
  private readonly unroutedCount = new PerMinute();
  private readonly overShare = new PerMinute();

  /** Whether `record` would take a line at `level` saying `msg`: cheap, so the logger asks before scrubbing anything for it. */
  keeps(level: RingLevel, msg: string): boolean {
    return level !== 'info' || msg === REQUEST_REFUSED;
  }

  /** Takes one line, as logged: `fields` with the request's context, scrubbed; `msg` scrubbed. */
  record(fields: Record<string, unknown>, level: RingLevel, msg: string): void {
    if (!this.keeps(level, msg)) return;
    const now = Date.now();
    const line = lineOf(fields, level, msg, now);
    // Work given up for good is the server's own word, whoever's request started the work: kept whatever their share.
    if (line.final !== null) this.finals.push(line);
    const client = clients.getStore();
    if (client !== undefined && !this.shares.take(client, now)) { this.overShare.add(now); return; }
    (isRequestLine(msg) ? this.requests : this.failures).push(line);
  }

  /** Counts a request that matched no route, which nothing keeps: what someone typed, refused before anything read it. */
  unrouted(): void {
    this.unroutedCount.add(Date.now());
  }

  /** The lines of the last `ms` milliseconds, oldest first: requests' and the server's own. */
  since(ms: number): RingLine[] {
    const from = Date.now() - ms;
    return [...this.requests.all(), ...this.failures.all()].filter((l) => l.at >= from).sort((a, b) => a.at - b.at);
  }

  /** The lines given up for good of the last `ms` milliseconds, oldest first. */
  finalsSince(ms: number): RingLine[] {
    const from = Date.now() - ms;
    return this.finals.all().filter((l) => l.at >= from);
  }

  /** Every line of one request, oldest first. */
  byRequest(id: string): RingLine[] {
    return this.since(Infinity).filter((l) => l.requestId === id);
  }

  /** Every line naming one ID of a kind (a note's, a call's), oldest first, each once. */
  forId(key: RingIdKey, id: string): RingLine[] {
    const lines = new Set([...this.since(Infinity), ...this.finals.all()].filter((l) => l.ids[key] === id));
    return [...lines].sort((a, b) => a.at - b.at);
  }

  /** What wasn't kept in the last `minutes` minutes: requests that matched no route, and lines past their client's share. */
  notKept(minutes: number): { unrouted: number; overShare: number } {
    const now = Date.now();
    return { unrouted: this.unroutedCount.since(minutes, now), overShare: this.overShare.since(minutes, now) };
  }

  /** How far back each part reaches, once it's full and has pushed older lines out: Unix ms, or null while it hasn't. */
  reachesBackTo(): { requests: number | null; failures: number | null } {
    return { requests: this.requests.reachesBackTo(), failures: this.failures.reachesBackTo() };
  }
}

/** This instance's ring: one per process. */
export const recent = new Ring();

/**
 * Runs `fn` as the answer to a request from `client`, its address (http/middleware.ts): what it logs, and what the work it
 * starts logs, counts against that client's share of the ring.
 */
export const withClient = <T>(client: string, fn: () => T): T => clients.run(client, fn);
