import { AUDIO_HEADERS, DOC_UPDATE_TYPE, MEDIA_PIECE_BYTES, HEARD_HEADERS, LIVE_STREAM_HEADER, OPERATION_HEADER, REQUEST_ID_HEADER, VIDEO_HEADERS } from '@alcove/api';
import type { HttpBindings } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { matchedRoutes } from 'hono/route';
import { ZodError } from 'zod';
import { b64u, random } from '../keys/crypto';
import { ForbiddenError, ValidationError, toAppError, type AppError } from '../platform/errors';
import { log, withLogContext, type LogContext } from '../platform/log';
import { RING_IDS, recent, withClient } from '../platform/recent';
import { CALL_PASS_HEADER } from '../keys/call-pass';
import { capped } from './body';
import { clientAddress, type Env } from './context';
import type { HttpRuntime } from './runtime';

const rlog = log.child({ component: 'http' });
/**
 * Lines the operators' ring doesn't take (platform/recent.ts): a request's error, which its own line says in its place, and
 * the line of a request that matched no route, which is only counted.
 */
const unringed = rlog.child({}, { ring: false });

/**
 * Call codes are join tokens, a Google event's ID names its recurring series, and a file's token reads it, as a photo's
 * shows whose face it is: keep them all out of logs. So is whatever an operator typed past an operator route's name, which
 * may be a code where an ID goes: once the route is known, its lines say its template (http/operator.ts). Every other path
 * segment is a random ID.
 */
const safePath = (p: string) => p.replace(/^\/v1\/calls\/(?!$)[^/]+/, '/v1/calls/:code').replace(/^\/v1\/calendar\/events\/(?!$)[^/]+/, '/v1/calendar/events/:id').replace(/^\/v1\/media\/(?!$)[^/]+/, '/v1/media/:token')
  .replace(/^\/v1\/photos\/(?!$)[^/]+/, '/v1/photos/:token').replace(/^(\/v1\/operator\/[^/]+)\/.+$/, '$1/…');

/**
 * The route a request matched, as its method and template (`GET /v1/notes/:id`), from the routes registered, never from
 * what was sent; null for one that matched none, which only middleware answers. The route that answers is the first
 * registered for it that isn't middleware (`app.use`'s are for every method).
 */
function routeOf(c: Context<Env>): string | null {
  const route = matchedRoutes(c).find((r) => r.method !== 'ALL');
  return route ? `${route.method} ${route.path}` : null;
}

/** What a request's error says that its own line repeats for the ring: its class and code, another service's status, what was asked, and the IDs. */
function failureOf(err: AppError): LogContext {
  const said: LogContext = { errorClass: err.name, code: err.code };
  for (const key of ['upstreamStatus', 'what', ...RING_IDS]) {
    const value = err.context[key];
    if (value !== undefined) said[key] = value;
  }
  return said;
}

const QUIET = new Set(['/health', '/healthz', '/v1/rings']);

export const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** The one route that takes video: a piece of someone's own shared screen, kept for the notes. */
export const VIDEO = /^\/v1\/live\/calls\/[^/]+\/shares\/[^/]+\/video$/;

/** What holds a document's content, as it is: a paste can be megabytes, and it has a limit of its own. */
const DOC_UPDATES = /^\/v1\/workspaces\/[^/]+\/documents\/[^/]+\/(?:updates|adopt)$/;

/** The one route that takes a picture's preview: a small JPEG, kept beside a picture in a workspace. */
const MEDIA_PREVIEW = /^\/v1\/workspaces\/[^/]+\/documents\/[^/]+\/media\/[^/]+\/preview$/;

/** The one route that takes bytes as they are: a piece of a file going into a workspace. */
const MEDIA_PIECES = /^\/v1\/workspaces\/[^/]+\/documents\/[^/]+\/media\/[^/]+\/pieces\/[^/]+$/;

/**
 * Routes only operators call, with the operator CLI (http/operator.ts): they take a signed request and no cookie, so another
 * site's page has nothing of anyone's to send them, and the CLI sends no Origin.
 */
const OPERATOR = /^\/v1\/operator\//;

/**
 * Reads what's left of a request that was answered before all of it arrived, as a refused piece is, once the answer has
 * gone, and drops it, so the connection is ready for the next request. The Node adapter means to do this itself, but the
 * request's body stream keeps the request paused. So on its own the adapter reads one chunk and closes the connection
 * half a second later, and a client may already have sent its next request down it. The adapter's limits still hold: a
 * body that's still arriving after 500 ms, or past 64 MiB, goes with its connection.
 */
function dropTheRest({ incoming, outgoing }: HttpBindings, body: ReadableStream<Uint8Array> | null, requestId: string): void {
  if (!body || body.locked) return;
  outgoing.once('finish', () => {
    const reader = body.getReader();
    const socket = incoming.socket;
    const failed = (e: unknown) => rlog.debug('the rest of a request couldn’t be read', { requestId, err: e });
    // The connection can go first, when the client gives up or the adapter's limits end it. Then there's nothing to drop.
    const gone = () => { void reader.cancel().catch(failed); };
    socket.once('close', gone);
    const drop = async (): Promise<void> => { for (;;) if ((await reader.read()).done) return; };
    void drop().catch(failed).finally(() => socket.off('close', gone));
  });
}

export function registerMiddleware(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;

  /*
   * Request context and access log. Runs first, so every later log line carries the request ID and the route it matched.
   * What's logged while answering is the client's to count against its share of the operators' ring (platform/recent.ts).
   */
  app.use('*', async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : b64u(random(12));
    c.set('requestId', requestId);
    const path = safePath(c.req.path);
    const route = routeOf(c);
    const t0 = performance.now();
    await withClient(clientAddress(c), () => withLogContext({ requestId, method: c.req.method, path, ...(route === null ? {} : { route }) }, async () => {
      rlog.debug('request started', { bytes: Number(c.req.header('content-length') ?? 0) || undefined });
      await next();
      c.res.headers.set(REQUEST_ID_HEADER, requestId);
      if (!c.env.incoming.complete) dropTheRest(c.env, c.req.raw.body, requestId);
      const ms = Math.round(performance.now() - t0);
      const status = c.res.status;
      // Its error's class, code and IDs, when it was refused or failed, said once more on its own line, written last.
      const line = { ...c.get('failure'), status, ms };
      const out = route === null ? unringed : rlog;
      if (route === null && status >= 400) recent.unrouted();
      if (QUIET.has(c.req.path) && status < 400) out.debug('request', line);
      // A 5xx is us failing, unless what answered it says it's an ordinary refusal: a browser that went mid-piece, say.
      else if (status >= 500 && c.get('refusedAt') !== 'info') out.error('request failed', line);
      else if (status >= 400) out.info('request refused', line);
      else out.info('request', line);
    }));
  });

  // Only the web app's own origin may call the API with credentials (matters when they're on different subdomains).
  app.use('*', cors({ origin: d.cfg.WEB_ORIGIN, credentials: true, exposeHeaders: [REQUEST_ID_HEADER, ...Object.values(HEARD_HEADERS)], allowHeaders: ['content-type', OPERATION_HEADER, REQUEST_ID_HEADER, CALL_PASS_HEADER, LIVE_STREAM_HEADER, ...Object.values(AUDIO_HEADERS), ...Object.values(VIDEO_HEADERS)], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 600 }));

  /* State changes only from the app itself: its Origin, and a JSON or audio body. This blocks blind
     cross-site POSTs from sibling ports/subdomains that SameSite=Strict still allows. */
  // Pieces of a file and of a shared screen's video (4 MiB each) are the largest bodies; call commits and chat have their own, tighter caps below. A document's updates can be as big as a document, and are capped where they arrive.
  const anyBody = capped(MEDIA_PIECE_BYTES);

  app.use('/v1/*', (c, next) => (DOC_UPDATES.test(c.req.path) ? next() : anyBody(c, next)));

  app.use('/v1/*', async (c, next) => {
    if (!MUTATING.has(c.req.method)) return next();
    const origin = c.req.header('origin');
    if (origin !== d.cfg.WEB_ORIGIN && !OPERATOR.test(c.req.path)) throw new ForbiddenError('Requests must come from the Alcove app.', { context: { origin: origin ?? 'none' } });
    const type = (c.req.header('content-type') ?? '').toLowerCase();
    const hasBody = c.req.header('content-length') !== '0' && c.req.header('content-length') !== undefined;
    const image = type.startsWith('image/jpeg') && MEDIA_PREVIEW.test(c.req.path);
    const video = type.startsWith('video/') && VIDEO.test(c.req.path);
    const update = type.startsWith(DOC_UPDATE_TYPE) && DOC_UPDATES.test(c.req.path);
    const fileBytes = type.startsWith('application/octet-stream') && MEDIA_PIECES.test(c.req.path);
    if (hasBody && !type.startsWith('application/json') && !type.startsWith('audio/') && !image && !video && !update && !fileBytes) throw new ValidationError('Unsupported content type.', { context: { contentType: type.slice(0, 60) } });
    return next();
  });

  /* One place turns every failure into { code, message, requestId } and one log line at the error's level. */
  app.onError((e, c) => {
    const requestId = c.get('requestId');
    // Field names and issue codes only, never values.
    const issues = e instanceof ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.code}`) : undefined;
    const err: AppError = e instanceof ZodError ? new ValidationError('Some of that input isn’t valid.', { cause: e, context: { issues } }) : toAppError(e);
    // Stacks and cause chains for anything unexpected; a one-liner for ordinary refusals.
    const withStack = err.level !== 'info' && !(e instanceof ZodError);
    // The line's `status` is the one Alcove answers with, written after the context so nothing in it can take its place.
    // Another service's answer is the context's `upstreamStatus`. The ring takes what it says from the request's own line.
    unringed.at(err.level, err.message, { errorClass: err.name, code: err.code, ...err.context, status: err.status, ...(withStack ? { err } : {}) });
    c.set('refusedAt', err.level);
    c.set('failure', failureOf(err));
    return c.json({ code: err.code, message: err.message, requestId, ...(issues ? { issues } : {}) }, err.status);
  });
}
