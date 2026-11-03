import {
  AUDIO_HEADERS, CallActionSchema, ClientLogBatchSchema, InstantCallInputSchema, MAX_AUDIO_PIECE_BYTES, MeetingInputSchema, NoteKindSchema, OPERATION_HEADER,
  PeopleSearchBodySchema, PreferencesSchema, REQUEST_ID_HEADER, RecordingActionSchema, ShareBodySchema, SignInBodySchema, TeamInviteBodySchema
} from '@alcove/api';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { z, ZodError } from 'zod';
import type { Deps, Owner } from './context';
import { b64u, equalBytes, mac, random, operationCommitKey, operationResultKey, openJson, sealJson, utf8 } from './crypto';
import { bytea, exec, maybeOne } from './db';
import { AuthError, ConflictError, ForbiddenError, NotFoundError, UnavailableError, ValidationError, toAppError, type AppError } from './errors';
import { addLogContext, log, withLogContext } from './log';
import * as google from './google';
import { inference } from './inference';
import { openOwner } from './owners';
import { ABSOLUTE_MS, cookieName, findSession } from './sessions';
import * as account from './modules/account';
import * as audioMod from './modules/audio';
import * as billing from './modules/billing';
import * as calls from './modules/calls';
import * as meetings from './modules/meetings';
import * as notes from './modules/notes';
import * as people from './modules/people';
import * as recordings from './modules/recordings';

type Env = { Variables: { owner: Owner; requestId: string } };
const rlog = log.child({ component: 'http' });
const clog = log.child({ component: 'client', source: 'browser' });
/** Call codes are join tokens: keep them out of logs. Every other path segment is a random ID. */
const safePath = (p: string) => p.replace(/^\/v1\/calls\/(?!$)[^/]+/, '/v1/calls/:code');
const QUIET = new Set(['/health', '/healthz']);
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/** POSTs that read rather than change state, so they don't need a stored receipt. */
const NO_RECEIPT = new Set(['/v1/notes/search']);
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);

/** A small fixed-window limiter for unauthenticated requests, keyed by client address. */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (c: Context, what = 'request') => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'direct';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.until < now) { hits.set(key, { n: 1, until: now + windowMs }); if (hits.size > 50_000) hits.clear(); return; }
    if (++h.n > max) throw new UnavailableError('Too many attempts. Wait a minute and try again.', { context: { limit: what, max, windowMs } });
  };
}
const StoredResult = z.object({ status: z.number(), body: z.string() });

export function createApp(d: Deps) {
  const app = new Hono<Env>();
  const secure = d.cfg.WEB_ORIGIN.startsWith('https://');
  const COOKIE = cookieName(secure);
  const startSession = (c: Context, sessionId: string) => setCookie(c, COOKIE, sessionId, { httpOnly: true, sameSite: 'Strict', path: '/', secure, maxAge: ABSOLUTE_MS / 1000 });
  const limiter = rateLimit(30, 60_000);
  /* Carries the sealed sign-in attempt to Google and back. Lax, because Google's redirect back is a cross-site navigation. */
  const ATTEMPT = secure ? '__Host-alcove_google' : 'alcove_google';
  const backToWelcome = (reason: google.Refusal) => `${d.cfg.WEB_ORIGIN}/welcome?signin=${reason}`;
  const telemetryLimiter = rateLimit(60, 60_000);

  /* Request context and access log. Runs first, so every later log line carries the request ID. */
  app.use('*', async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : b64u(random(12));
    c.set('requestId', requestId);
    const path = safePath(c.req.path);
    const t0 = performance.now();
    await withLogContext({ requestId, method: c.req.method, path }, async () => {
      rlog.debug('request started', { bytes: Number(c.req.header('content-length') ?? 0) || undefined });
      await next();
      c.res.headers.set(REQUEST_ID_HEADER, requestId);
      const ms = Math.round(performance.now() - t0);
      const status = c.res.status;
      const line = { status, ms };
      if (QUIET.has(c.req.path) && status < 400) rlog.debug('request', line);
      else if (status >= 500) rlog.error('request failed', line);
      else if (status >= 400) rlog.info('request refused', line);
      else rlog.info('request', line);
    });
  });
  const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => schema.parse(await c.req.json().catch(() => { throw new ValidationError('Expected a JSON body.'); }));

  // Only the web app's own origin may call the API with credentials (matters when they're on different subdomains).
  app.use('*', cors({ origin: d.cfg.WEB_ORIGIN, credentials: true, exposeHeaders: [REQUEST_ID_HEADER], allowHeaders: ['content-type', OPERATION_HEADER, REQUEST_ID_HEADER, ...Object.values(AUDIO_HEADERS)], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'], maxAge: 600 }));

  /* State changes only from the app itself: its Origin, and a JSON or audio body. This blocks blind
     cross-site POSTs from sibling ports/subdomains that SameSite=Strict still allows. */
  app.use('/v1/*', async (c, next) => {
    if (!MUTATING.has(c.req.method)) return next();
    const origin = c.req.header('origin');
    if (origin !== d.cfg.WEB_ORIGIN) throw new ForbiddenError('Requests must come from the Alcove app.', { context: { origin: origin ?? 'none' } });
    const type = (c.req.header('content-type') ?? '').toLowerCase();
    const hasBody = c.req.header('content-length') !== '0' && c.req.header('content-length') !== undefined;
    if (hasBody && !type.startsWith('application/json') && !type.startsWith('audio/')) throw new ValidationError('Unsupported content type.', { context: { contentType: type.slice(0, 60) } });
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
    rlog.at(err.level, err.message, { errorClass: err.name, code: err.code, status: err.status, ...err.context, ...(withStack ? { err } : {}) });
    return c.json({ code: err.code, message: err.message, requestId, ...(issues ? { issues } : {}) }, err.status);
  });

  /* The browser's own warnings and errors, so one request ID tells the whole story. Public and rate limited. */
  app.post('/v1/telemetry', async (c) => {
    telemetryLimiter(c, 'telemetry');
    const { entries } = await body(c, ClientLogBatchSchema);
    for (const en of entries) clog.at(en.level, en.msg, { ...en.context, clientAt: en.at });
    return c.json({ received: entries.length });
  });

  // Cloud Run's front end keeps /healthz for itself, so /health answers the same.
  app.on('GET', ['/health', '/healthz'], async (c) => {
    await exec(d.pool, 'SELECT 1');
    return c.json({ ok: true, inference: inference(d.cfg).configured ? 'configured' : 'missing' });
  });

  /* ---------- public: the session and signing in ---------- */
  app.get('/v1/session', async (c) => {
    const s = await findSession(d, getCookie(c, COOKIE));
    return c.json(s ? await account.sessionFor(await openOwner(d, s.ownerId, s)) : null);
  });
  app.post('/v1/auth/sign-in', async (c) => {
    limiter(c, 'sign-in');
    const r = await account.demoSignIn(d, await body(c, SignInBodySchema));
    startSession(c, r.sessionId);
    return c.json({ session: await account.sessionFor(r.owner), isNew: r.isNew });
  });

  /* Google: away to Google and back. Both ends are top-level navigations, so both answer with redirects. */
  const allowed = (c: Context) => {
    try { limiter(c, 'sign-in'); return true; } catch { rlog.info('google sign-in refused', { reason: 'busy' }); return false; }
  };
  app.get('/v1/auth/google', async (c) => {
    if (!allowed(c)) return c.redirect(backToWelcome('busy'), 302);
    if (!google.configured(d.cfg)) return c.redirect(backToWelcome('unavailable'), 302);
    try {
      const { url, attempt } = await google.begin(d);
      setCookie(c, ATTEMPT, attempt, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: google.ATTEMPT_MINUTES * 60 });
      return c.redirect(url, 302);
    } catch (e) {
      rlog.warn('google sign-in could not start', { err: e });
      return c.redirect(backToWelcome('failed'), 302);
    }
  });
  app.get('/v1/auth/google/callback', async (c) => {
    const attempt = getCookie(c, ATTEMPT);
    deleteCookie(c, ATTEMPT, { path: '/', secure });
    if (!allowed(c)) return c.redirect(backToWelcome('busy'), 302);
    try {
      const r = await google.finish(d, c.req.query(), attempt);
      if (!r.ok) return c.redirect(backToWelcome(r.reason), 302);
      const s = await account.signIn(d, r.identity, 'google');
      startSession(c, s.sessionId);
      return c.redirect(`${d.cfg.WEB_ORIGIN}${s.isNew ? '/ready' : '/home'}`, 302);
    } catch (e) {
      rlog.error('google sign-in failed', { err: e });
      return c.redirect(backToWelcome('failed'), 302);
    }
  });

  /* ---------- everything below needs a signed-in owner ---------- */
  app.use('/v1/*', async (c, next) => {
    const cookie = getCookie(c, COOKIE);
    const s = await findSession(d, cookie);
    if (!s) {
      if (cookie) deleteCookie(c, COOKIE, { path: '/', secure });
      throw new AuthError(cookie ? 'Your session ended. Sign in again to carry on.' : 'Sign in to Alcove first.');
    }
    addLogContext({ ownerId: s.ownerId });
    c.set('owner', await openOwner(d, s.ownerId, s));
    await next();
  });

  /* Mutations are idempotent by operation ID (docs: Network and API contract). */
  app.use('/v1/*', async (c, next) => {
    const opId = c.req.header(OPERATION_HEADER);
    if (!opId || !MUTATING.has(c.req.method) || NO_RECEIPT.has(c.req.path)) return next();
    if (!/^[A-Za-z0-9_-]{22}$/.test(opId)) throw new ValidationError('Malformed operation ID.');
    const o = c.get('owner');
    const reqBytes = new Uint8Array(await c.req.raw.clone().arrayBuffer());
    const commitment = mac(operationCommitKey(o.root, o.ownerId), new Uint8Array([...utf8(`${c.req.method} ${c.req.path}\n`), ...reqBytes]));
    const hdr = { v: 1 as const, kind: 'operation-result', ownerId: o.ownerId, operationId: opId };
    const prior = await maybeOne(d.pool, z.object({ request_commitment: bytea, result_ciphertext: bytea }), 'SELECT request_commitment, result_ciphertext FROM operations WHERE owner_id = $1 AND operation_id = $2', [o.ownerId, opId]);
    if (prior) {
      if (!equalBytes(prior.request_commitment, commitment)) throw new ConflictError('That operation ID was already used for a different request.');
      const r = openJson(operationResultKey(o.root, o.ownerId), hdr, prior.result_ciphertext, StoredResult);
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
    }
    await next();
    if (c.res.ok && (c.res.headers.get('content-type') ?? '').includes('application/json')) {
      const text = await c.res.clone().text();
      await exec(d.pool, `INSERT INTO operations (owner_id, operation_id, method, request_commitment, result_ciphertext, completed_at) VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT DO NOTHING`,
        [o.ownerId, opId, `${c.req.method} ${c.req.routePath}`, commitment, sealJson(operationResultKey(o.root, o.ownerId), hdr, { status: c.res.status, body: text })]);
    }
    return undefined;
  });

  app.post('/v1/session/sign-out', async (c) => {
    await account.signOut(c.get('owner'));
    deleteCookie(c, COOKIE, { path: '/', secure });
    return c.json({ signedOut: true });
  });

  /* account */
  app.get('/v1/account/preferences', async (c) => c.json(await account.preferences(c.get('owner'))));
  app.patch('/v1/account/preferences', async (c) => c.json(await account.updatePreferences(c.get('owner'), await body(c, PreferencesSchema.partial()))));

  /* people: search terms travel in the body, never the URL */
  app.post('/v1/people/search', async (c) => c.json(await people.search(c.get('owner'), (await body(c, PeopleSearchBodySchema)).query)));
  app.get('/v1/team', async (c) => c.json(await people.team(c.get('owner'))));
  app.post('/v1/team/invites', async (c) => c.json(await people.inviteToTeam(c.get('owner'), (await body(c, TeamInviteBodySchema)).emails)));

  /* meetings */
  app.get('/v1/meetings', async (c) => c.json(c.req.query('range') === 'past' ? await meetings.past(c.get('owner')) : await meetings.upcoming(c.get('owner'))));
  app.get('/v1/meetings/:id', async (c) => c.json(await meetings.get(c.get('owner'), c.req.param('id'))));
  app.post('/v1/meetings', async (c) => c.json(await meetings.create(c.get('owner'), await body(c, MeetingInputSchema))));
  app.patch('/v1/meetings/:id', async (c) => c.json(await meetings.update(c.get('owner'), c.req.param('id'), await body(c, MeetingInputSchema.partial()))));
  app.delete('/v1/meetings/:id', async (c) => { await meetings.cancel(c.get('owner'), c.req.param('id')); return c.json({ cancelled: true }); });
  app.get('/v1/calls/:code/meeting', async (c) => c.json(await meetings.byCode(c.get('owner'), c.req.param('code'))));

  /* calls */
  app.post('/v1/calls', async (c) => c.json(await meetings.startNow(c.get('owner'), await body(c, InstantCallInputSchema))));
  app.post('/v1/calls/:code/join', async (c) => c.json(await calls.join(c.get('owner'), c.req.param('code'), await body(c, z.object({ mic: z.boolean(), cam: z.boolean() })))));
  app.get('/v1/live/calls/:id', async (c) => c.json(await calls.state(c.get('owner'), c.req.param('id'))));
  app.post('/v1/live/calls/:id/actions', async (c) => c.json(await calls.act(c.get('owner'), c.req.param('id'), await body(c, CallActionSchema))));
  app.post('/v1/live/calls/:id/audio', async (c) => c.json(await calls.audio(c.get('owner'), c.req.param('id'), await piece(c))));
  app.post('/v1/live/calls/:id/leave', async (c) => c.json(await calls.leave(c.get('owner'), c.req.param('id'))));

  /* room recordings */
  app.post('/v1/recordings', async (c) => c.json(await recordings.start(c.get('owner'), (await body(c, z.object({ title: z.string().max(160).optional() }))).title ?? 'Untitled recording')));
  app.post('/v1/recordings/:id/actions', async (c) => c.json(await recordings.act(c.get('owner'), c.req.param('id'), await body(c, RecordingActionSchema))));
  app.post('/v1/recordings/:id/audio', async (c) => c.json(await recordings.audio(c.get('owner'), c.req.param('id'), await piece(c))));
  app.post('/v1/recordings/:id/stop', async (c) => c.json(await recordings.stop(c.get('owner'), c.req.param('id'))));
  app.delete('/v1/recordings/:id', async (c) => { await recordings.discard(c.get('owner'), c.req.param('id')); return c.json({ discarded: true }); });

  /* notes */
  // Search terms travel in the body, never the URL, so they can't end up in access logs.
  app.post('/v1/notes/search', async (c) => {
    const q = await body(c, z.object({ kind: NoteKindSchema.optional(), text: z.string().max(200).optional() }));
    return c.json(await notes.list(c.get('owner'), { kind: q.kind, text: q.text }));
  });
  app.get('/v1/notes/actions', async (c) => c.json(await notes.openActions(c.get('owner'))));
  app.get('/v1/notes/:id', async (c) => c.json(await notes.get(c.get('owner'), c.req.param('id'))));
  app.get('/v1/notes/:id/progress', async (c) => {
    const o = c.get('owner'); const id = c.req.param('id');
    c.header('content-type', 'application/x-ndjson');
    return stream(c, async (s) => {
      for (let i = 0; i < 120; i++) {
        const p = await notes.progress(o, id);
        await s.write(`${JSON.stringify(p)}\n`);
        if (p.ready) return;
        await s.sleep(1000);
      }
    });
  });
  app.get('/v1/notes/:id/audio/:segment', async (c) => {
    const o = c.get('owner');
    const segment = z.coerce.number().int().min(0).parse(c.req.param('segment'));
    const n = await notes.get(o, c.req.param('id'));
    const seg = n.audio.find((a) => a.index === segment);
    if (!seg) throw new NotFoundError('No audio in that part of the recording.');
    const source = await notes.audioSource(o, n.id);
    const mime = seg.mimeType.split(';')[0] ?? '';
    c.header('content-type', AUDIO_TYPES.has(mime) ? mime : 'application/octet-stream');
    c.header('x-content-type-options', 'nosniff');
    c.header('cache-control', 'no-store');
    return stream(c, async (s) => { for await (const chunk of audioMod.stream(source.owner, source.recordingId, segment)) await s.write(chunk); });
  });
  app.patch('/v1/notes/:id/actions/:actionId', async (c) => {
    await notes.setActionDone(c.get('owner'), c.req.param('id'), c.req.param('actionId'), (await body(c, z.object({ done: z.boolean() }))).done);
    return c.json({ ok: true });
  });
  app.post('/v1/notes/:id/ask', () => { throw new UnavailableError('Asking about notes needs the notes service, which isn’t connected yet.'); });
  app.post('/v1/notes/:id/share', async (c) => c.json(await notes.share(c.get('owner'), c.req.param('id'), (await body(c, ShareBodySchema)).emails)));
  app.delete('/v1/notes/:id', async (c) => { await notes.remove(c.get('owner'), c.req.param('id')); return c.json({ deleted: true }); });

  /* credits */
  app.get('/v1/credits', async (c) => c.json(await billing.balance(d, c.get('owner').ownerId)));

  return app;
}

/** Reads a raw audio piece and its position headers. */
async function piece(c: Context): Promise<audioMod.Piece> {
  const num = (name: string) => z.coerce.number().int().min(0).parse(c.req.header(name));
  const mimeType = c.req.header('content-type') ?? '';
  if (!/^audio\/(webm|mp4|ogg)/.test(mimeType)) throw new ValidationError('Audio must be WebM, MP4 or Ogg.');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_PIECE_BYTES) throw new ValidationError('That piece of audio is empty or too large.');
  return { segment: num(AUDIO_HEADERS.segment), seq: num(AUDIO_HEADERS.seq), durationMs: num(AUDIO_HEADERS.duration), mimeType, bytes };
}
