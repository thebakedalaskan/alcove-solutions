/*
 * Operators' diagnostics: what's running (`release`), what's behind and failing in the background (`work`), what's failing
 * and how often (`errors`), and why one request failed (`requests/:requestId`). Each is registered through
 * operatorRoute() (http/operator.ts), so only a request signed by a listed key reaches it; each only reads, and answers
 * with the instance that answered and when. All of it but work's queues and release's migrations is this instance's
 * memory, so they answer with the database out of reach. The answers' schemas are in wire.ts.
 */
import { type Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../platform/errors';
import { type Env } from '../../http/context';
import { operatorRoute } from '../../http/operator';
import type { HttpRuntime } from '../../http/runtime';
import { REQUEST_FAILED, REQUEST_REFUSED, recent, type RingLine } from '../../platform/recent';
import { releaseOf, type ReadMigrations } from './release';
import type { ErrorsAnswer, RequestAnswer } from './wire';
import { workOf } from './work';

/** The window `errors` counts over: 1 to 240 minutes, 60 unless asked. */
const MINUTES = z.coerce.number().int().min(1).max(240);
/** The most groups each part of `errors` lists: the most frequent. */
const MOST_GROUPS = 100;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));
/** The route a request's line matched, its method and template; every request the ring keeps matched one. */
const routeOf = (l: RingLine): string => l.route ?? 'no route';

/** Lines counted in groups by `key`, each with its newest time and one request ID to follow: the most frequent first. */
function grouped<G extends object>(lines: readonly RingLine[], key: (l: RingLine) => string, group: (l: RingLine) => G): (G & { count: number; lastAt: string; requestId: string | null })[] {
  const by = new Map<string, { group: G; count: number; lastAt: number; requestId: string | null }>();
  for (const l of lines) {
    const k = key(l);
    const known = by.get(k);
    if (!known) by.set(k, { group: group(l), count: 1, lastAt: l.at, requestId: l.requestId });
    else {
      known.count++;
      known.lastAt = l.at;
      known.requestId = l.requestId ?? known.requestId;
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, MOST_GROUPS)
    .map((g) => ({ ...g.group, count: g.count, lastAt: iso(g.lastAt), requestId: g.requestId }));
}

export function registerDiagnostics(app: Hono<Env>, runtime: HttpRuntime, readMigrations: ReadMigrations): void {
  const { d } = runtime;

  /* Is it up, which release is serving, and did it start cleanly? */
  operatorRoute(app, runtime, 'GET', '/v1/operator/release', 'read', async (c, op) => c.json(await releaseOf(d, op.instance, readMigrations)));

  /* What's behind, and what's failing? */
  operatorRoute(app, runtime, 'GET', '/v1/operator/work', 'read', async (c, op) => c.json(await workOf(runtime, op.instance)));

  /* What's failing, and how often? Refused and failed requests by route, status and code; every line by what it says. */
  operatorRoute(app, runtime, 'GET', '/v1/operator/errors', 'read', async (c, op) => {
    const asked = MINUTES.safeParse(c.req.query('minutes') ?? '60');
    if (!asked.success) throw new ValidationError('minutes is a whole number from 1 to 240.', { context: { field: 'minutes' } });
    const lines = recent.since(asked.data * 60_000);
    const requests = lines.filter((l) => l.msg === REQUEST_REFUSED || l.msg === REQUEST_FAILED);
    const held = recent.reachesBackTo();
    return c.json({
      instance: op.instance, at: iso(Date.now()), minutes: asked.data, lines: lines.length,
      notKept: recent.notKept(asked.data), heldFrom: { requests: isoOrNull(held.requests), failures: isoOrNull(held.failures) },
      requests: grouped(requests, (l) => JSON.stringify([routeOf(l), l.status, l.code]), (l) => ({ route: routeOf(l), status: l.status, code: l.code })),
      groups: grouped(lines, (l) => JSON.stringify([l.component, l.msg, l.code, l.upstreamStatus]),
        (l) => ({ component: l.component, msg: l.msg, code: l.code, upstreamStatus: l.upstreamStatus }))
    } satisfies ErrorsAnswer);
  });

  /* Why did this request fail? Its lines on this instance: another instance's, or older ones, are in Cloud Logging. */
  operatorRoute(app, runtime, 'GET', '/v1/operator/requests/:requestId', 'read', async (c, op) => {
    const requestId = c.req.param('requestId') ?? '';
    if (!REQUEST_ID.test(requestId)) throw new ValidationError('That isn’t a request’s ID.', { context: { field: 'requestId' } });
    const lines = recent.byRequest(requestId);
    if (!lines.length) throw new NotFoundError('This instance holds nothing for that request: it’s older than what it keeps, or another instance served it. Cloud Logging has it.');
    return c.json({ instance: op.instance, at: iso(Date.now()), requestId, lines: lines.map((l) => ({ ...l, at: iso(l.at) })) } satisfies RequestAnswer);
  });
}
