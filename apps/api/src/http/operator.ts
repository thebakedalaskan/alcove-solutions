/*
 * Operator requests: every route an operator calls from outside the enclave is registered through `operatorRoute()`, which
 * checks the request before its handler runs, cheapest first:
 *
 *   1. the client address's own limit, before any work: past it, 503;
 *   2. a body of 64 KiB at most, by its stated length and then as read: past it, 400;
 *   3. an Authorization header that parses and names a key OPERATOR_KEYS lists (keys/operator-keys.ts);
 *   4. a signed time within a minute of the server's, either way: VMs' clocks have run seconds behind;
 *   5. the body's hash and the signature, over the audience the API is (API_URL's origin), and the method and path it got;
 *   6. a nonce never used before, on any instance (operator_nonces). With the database out of reach, a request that only
 *      reads is checked against this instance's memory instead; one that changes something is refused with a 503;
 *   7. the key's scope covering the route: 403 when it doesn't;
 *   8. the key's own limit: 503.
 *
 * Steps 3 to 6 refuse with the same 401, whichever failed, so probing learns nothing; the log line names the step (`why`).
 * An action also needs a reason, a ticket's reference. Each request, allowed or refused, logs one audit line: the key's ID,
 * the route's template (never the IDs in its path), the outcome and the reason. Operator routes take no cookie and no
 * Origin, so another site's page has nothing of anyone's to send them. Without OPERATOR_KEYS there are none: every one
 * answers 404, as if it weren't there.
 */
import { type Context, type Hono } from 'hono';
import { hostname } from 'node:os';
import { z, ZodError } from 'zod';
import type { Deps } from '../platform/context';
import { exec, unreachable } from '../platform/db';
import { AuthError, ForbiddenError, NotFoundError, UnavailableError, ValidationError, toAppError } from '../platform/errors';
import { addLogContext, log } from '../platform/log';
import { INSTANCE_HEADER, REASON, REASON_SHAPE, bodyHash, parseAuthorization, verify, type OperatorScope } from '../keys/operator-keys';
import { clientAddress, type Env } from './context';
import type { HttpRuntime } from './runtime';

const olog = log.child({ component: 'operator' });
/**
 * The audit line: in the log, kept where §8 of the design keeps it, and not in the operators' ring (platform/recent.ts), where
 * the request's own line says the route, the status and the code already: anyone can send an unsigned request.
 */
const audit = olog.child({}, { ring: false });

/** Who's asking, once their request checks out: the key's ID and scope, the action's reason, and the instance answering. */
export interface Operator { keyId: string; scope: OperatorScope; reason: string | undefined; instance: string }
/**
 * What a route needs of a key: a scope, or one decided by a command's words, the `words` of the request's JSON body (feature
 * flags, limits, billing). A body that holds no words needs `write`.
 */
export type ScopeOf = OperatorScope | ((words: string[]) => OperatorScope);
const Words = z.object({ words: z.array(z.string()) });
function scopeNeeded(scope: ScopeOf, json: unknown): OperatorScope {
  if (typeof scope !== 'function') return scope;
  const parsed = Words.safeParse(json);
  return parsed.success ? scope(parsed.data.words) : 'write';
}
/**
 * What a command route answers, whichever feature owns it (feature flags and limits, billing's support): the lines its
 * command line prints. The CLI parses the answer with it too.
 */
export const LinesAnswer = z.object({ lines: z.array(z.string()) });
export type LinesAnswer = z.infer<typeof LinesAnswer>;

/** This instance's name, as every operator answer says it: in production, the VM's host name. */
export const instanceName = (): string => process.env['HOSTNAME'] || hostname();

/** How far a request's signed time may be from the server's, either way. Every other token the API checks allows a minute too. */
const WINDOW_MS = 60_000;
/** The most an operator request's body may be: a command's words, or an ID and a reason. */
const MAX_BODY = 64 * 1024;
const REFUSED = 'That isn’t a signed operator request.';
/** Why a request was refused, as its audit line says: never sent back, since every refusal before scope answers alike. */
type Why = 'no-key' | 'unknown-key' | 'stale' | 'bad-signature' | 'replayed' | 'scope' | 'limit';

/** Nonces this instance has seen, for when the database can't say: the newest 10,000, each for 2 minutes, which outlasts the window either way. */
const NONCES_KEPT = 10_000;
const NONCE_MS = 120_000;
class NonceMemory {
  private readonly seen = new Map<string, number>();
  has(nonce: string, now: number): boolean { return (this.seen.get(nonce) ?? 0) > now; }
  add(nonce: string, now: number): void {
    // Oldest first: each is kept as long as the next, so what's run out, or the oldest when it's full, goes first.
    for (const [n, until] of this.seen) { if (until > now && this.seen.size < NONCES_KEPT) break; this.seen.delete(n); }
    this.seen.set(nonce, now + NONCE_MS);
  }
}
/** One memory per app, as an instance has one. */
const memories = new WeakMap<HttpRuntime, NonceMemory>();
function memoryOf(runtime: HttpRuntime): NonceMemory {
  const known = memories.get(runtime);
  if (known) return known;
  const made = new NonceMemory();
  memories.set(runtime, made);
  return made;
}

/**
 * The JSON a request's body holds, or undefined for none, or for one that isn't JSON: its route's schema refuses that, and
 * meanwhile it needs whatever a route's scope is without one.
 */
function jsonOf(bytes: Uint8Array): unknown {
  if (!bytes.length) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return parsed;
  } catch (e) {
    olog.debug('operator request’s body isn’t JSON', { bytes: bytes.length, errorClass: e instanceof Error ? e.name : 'unknown' });
    return undefined;
  }
}

/** A reason, as an action needs one: a ticket or incident reference, never prose. Never said back or logged when it isn't one. */
function reasonOf(json: unknown, needed: boolean): string | undefined {
  const given = typeof json === 'object' && json !== null && 'reason' in json ? json.reason : undefined;
  if (given === undefined && !needed) return undefined;
  if (typeof given === 'string' && REASON.test(given)) return given;
  throw new ValidationError(`An action needs a reason: ${REASON_SHAPE}.`, { context: { field: 'reason' } });
}

/** Removes nonces older than 10 minutes, well past the minute a signed request is good for (maintenance.ts). */
export const sweepNonces = (d: Deps): Promise<number> => exec(d.pool, `DELETE FROM operator_nonces WHERE seen_at < now() - interval '10 minutes'`);

/**
 * Registers an operator route: `handler` runs once the request is signed by a listed key whose scope covers `scope`, and
 * gets who's asking. Every owner registers its operator routes through this, before the signed-in routes (app.ts).
 */
export function operatorRoute(app: Hono<Env>, runtime: HttpRuntime, method: 'GET' | 'POST', path: string, scope: ScopeOf,
  handler: (c: Context<Env>, op: Operator) => Promise<Response>): void {
  const route = `${method} ${path}`;
  const { d } = runtime;
  const { operatorLimiter, operatorReadLimiter, operatorWriteLimiter } = runtime.limits;
  app.on(method, path, async (c) => {
    const keys = d.cfg.operatorKeys;
    if (!keys.length) throw new NotFoundError('That isn’t here.', { context: { operatorKeys: 0 } });
    // Every line from here on says the route's template, never what's in its path: an ID, or a code typed in its place.
    addLogContext({ path });
    const t0 = performance.now();
    const seen: { keyId?: string; scope?: OperatorScope; why?: Why; reason?: string; nonceIn?: 'database' | 'memory' } = {};
    const refuse = (why: Why) => { seen.why = why; return new AuthError(REFUSED, { context: { why } }); };
    const limited = (check: () => void) => { try { check(); } catch (e) { seen.why = 'limit'; throw e; } };
    let status = 500;
    let code: string | undefined;
    try {
      limited(() => operatorLimiter(clientAddress(c), 'operator'));
      if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) throw new ValidationError('That request is too large.', { context: { maxSize: MAX_BODY } });

      const auth = parseAuthorization(c.req.header('authorization'));
      if (!auth) throw refuse('no-key');
      seen.keyId = auth.keyId;
      const key = keys.find((k) => k.id === auth.keyId);
      if (!key) throw refuse('unknown-key');
      seen.scope = key.scope;
      if (Math.abs(Date.now() - auth.time) > WINDOW_MS) throw refuse('stale');

      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.length > MAX_BODY) throw new ValidationError('That request is too large.', { context: { maxSize: MAX_BODY } });
      const url = new URL(c.req.url);
      const signed = { audience: new URL(d.cfg.API_URL).origin, method: c.req.method, path: `${url.pathname}${url.search}`, time: auth.time, nonce: auth.nonce, bodySha256: bodyHash(bytes) };
      if (!verify(key, signed, auth.signature)) throw refuse('bad-signature');

      const json = jsonOf(bytes);
      const needs = scopeNeeded(scope, json);
      seen.nonceIn = await spendNonce(runtime, key.id, auth.nonce, needs === 'write', refuse);

      if (needs === 'write' && key.scope !== 'write') {
        seen.why = 'scope';
        throw new ForbiddenError('That key only reads: changing something takes a write key.', { context: { why: 'scope' } });
      }
      limited(() => (needs === 'write' ? operatorWriteLimiter(key.id, 'operator writes') : operatorReadLimiter(key.id, 'operator reads')));
      const reason = reasonOf(json, needs === 'write');
      if (reason !== undefined) seen.reason = reason;

      const op: Operator = { keyId: key.id, scope: key.scope, reason, instance: instanceName() };
      c.header(INSTANCE_HEADER, op.instance);
      const res = await handler(c, op);
      status = res.status;
      return res;
    } catch (e) {
      // As the app's error handler answers it (http/middleware.ts): a schema's refusal is a 400.
      const err = e instanceof ZodError ? new ValidationError('Some of that input isn’t valid.') : toAppError(e);
      status = err.status;
      code = err.code;
      throw e;
    } finally {
      const outcome = status < 400 ? 'ok' : status < 500 ? 'refused' : 'failed';
      // A warning when the check itself refused it (why), an error when it failed, and otherwise an ordinary line, as a
      // handler's own refusal is: that ID isn't here, that call isn't stuck.
      audit.at(seen.why ? 'warn' : outcome === 'failed' ? 'error' : 'info', 'operator call', {
        keyId: seen.keyId, scope: seen.scope, route, outcome, status, code, ms: Math.round(performance.now() - t0),
        reason: seen.reason, nonceIn: seen.nonceIn, why: seen.why
      });
    }
  });
}

/**
 * Spends a request's nonce, refusing one used before: in this instance's memory first, where it's taken at once, so a copy
 * sent at the same moment finds it there even while the database is slow to answer; then in the database, which every
 * instance shares, and which answers for every other instance. A nonce stays spent whatever comes of its request: the CLI
 * never sends one twice. Where it was checked comes back for the audit line.
 */
async function spendNonce(runtime: HttpRuntime, keyId: string, nonce: string, writes: boolean, refuse: (why: Why) => AuthError): Promise<'database' | 'memory'> {
  const memory = memoryOf(runtime);
  const now = Date.now();
  if (memory.has(nonce, now)) throw refuse('replayed');
  memory.add(nonce, now);
  let added: number;
  try {
    added = await exec(runtime.d.pool, 'INSERT INTO operator_nonces (nonce, key_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [nonce, keyId]);
  } catch (e) {
    if (!unreachable(e)) throw e;
    // A change needs the database anyway; a read can go on, checked against this instance alone, and its line says so.
    if (writes) throw new UnavailableError('Alcove can’t reach its database, so nothing can be changed now. Try again in a minute.', { cause: e, context: { step: 'nonce' } });
    olog.warn('operator nonce checked in memory: the database can’t be reached', { keyId, err: e });
    return 'memory';
  }
  if (added === 0) throw refuse('replayed');
  return 'database';
}
