import {
  ActionPatchSchema, AUDIO_HEADERS, CallIdentity, AskBodySchema, CallActionSchema, CallCommitBodySchema, CallJoinBodySchema, CallKeyPackageBodySchema, CallMessageBodySchema, CatchUpBodySchema, TranslateBodySchema, ClientLogBatchSchema, DecisionPatchSchema, InstantCallInputSchema, MAX_AUDIO_PIECE_BYTES, MAX_TRANSCRIPT_CLIP_BYTES, MAX_TRANSCRIPT_CLIP_MS,
  MeetingInputSchema, NextCallBodySchema, NoteKindSchema, NotesSettingSchema, OPERATION_HEADER, PeopleSearchBodySchema, PreferencesSchema, QuestionPatchSchema, REQUEST_ID_HEADER, RecordingActionSchema, SeriesAskBodySchema, ShareBodySchema,
  SignInBodySchema, TeamInviteBodySchema, MoveByClaimBodySchema, MoveClaimBodySchema, MoveConfirmBodySchema, MoveReadyBodySchema, MoveStartBodySchema
} from '@alcove/api';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
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
import { CALL_PASS_HEADER, readPass } from './callPass';
import { attest } from './tee';
import { openOwner } from './owners';
import { ABSOLUTE_MS, cookieName, findSession } from './sessions';
import * as account from './modules/account';
import * as audioMod from './modules/audio';
import * as billing from './modules/billing';
import * as calendar from './modules/calendar';
import * as calls from './modules/calls';
import * as meetings from './modules/meetings';
import * as moves from './modules/moves';
import * as notes from './modules/notes';
import * as people from './modules/people';
import * as photos from './modules/photos';
import * as recordings from './modules/recordings';
import * as series from './modules/series';
import type { Clip } from './modules/transcripts';

type Env = { Variables: { owner: Owner; viewer: calls.Viewer; requestId: string } };
const rlog = log.child({ component: 'http' });
const clog = log.child({ component: 'client', source: 'browser' });
/**
 * Call codes are join tokens, and a Google event's ID names its recurring series: keep both out of
 * logs. Every other path segment is a random ID.
 */
const safePath = (p: string) => p.replace(/^\/v1\/calls\/(?!$)[^/]+/, '/v1/calls/:code').replace(/^\/v1\/calendar\/events\/(?!$)[^/]+/, '/v1/calendar/events/:id');
const QUIET = new Set(['/health', '/healthz']);
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/**
 * Mutations that keep no stored receipt. Searching, asking and translating captions only read. Audio
 * pieces and transcript clips are already idempotent by their place in the recording (and their
 * answers carry the live transcript, which shouldn't be copied into receipts). Changing a note's
 * decisions, open questions and follow-ups, and sharing it, each set an explicit state, so a retry
 * changes nothing; and their answer is the whole note, which a receipt kept under someone it was given
 * to would still hold after the organizer deleted it.
 */
const NO_RECEIPT = [
  /^\/v1\/notes\/search$/, /^\/v1\/(?:notes|series)\/[^/]+\/ask$/, /^\/v1\/live\/calls\/[^/]+\/(?:catch-up|ask|translate)$/,
  /^\/v1\/(?:live\/calls|recordings)\/[^/]+\/(?:audio|transcribe)$/,
  /^\/v1\/notes\/[^/]+\/(?:(?:decisions|questions|actions)\/[^/]+|share)$/
];
const keepsReceipt = (path: string) => !NO_RECEIPT.some((r) => r.test(path));
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);

/**
 * A small fixed-window limiter: at most `max` hits per key in each window. Unauthenticated requests
 * are keyed by client address; the ones that cost inference by account.
 */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string, what = 'request') => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.until < now) { hits.set(key, { n: 1, until: now + windowMs }); if (hits.size > 50_000) hits.clear(); return; }
    if (++h.n > max) throw new UnavailableError('Too many attempts. Wait a minute and try again.', { context: { limit: what, max, windowMs } });
  };
}
/**
 * The client's address as the front end saw it: the last x-forwarded-for entry, which Cloud Run's front end
 * appends. Anything before it came from the client, so it can't be trusted to tell people apart.
 */
const clientAddress = (c: Context) => c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'direct';
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
  const attestLimiter = rateLimit(30, 60_000);
  /*
   * Speech and questions go to NEAR AI. A browser sends a clip every few seconds while someone talks: in a call the
   * organizer's browser sends one stream of clips per voice it hears, each limited on its own, all within the account's.
   */
  const speechLimiter = rateLimit(240, 60_000);
  const voiceLimiter = rateLimit(40, 60_000);
  const askLimiter = rateLimit(20, 60_000);
  /** Reading call cards and joining by link: public, so limited per client address. */
  const callLimiter = rateLimit(120, 60_000);
  /** Encrypted chat in a call, per person in it. */
  const chatLimiter = rateLimit(120, 60_000);
  /** Fresh key packages to rejoin a call's new group, per person in it (one each time the organizer's connection changes). */
  const rejoinLimiter = rateLimit(20, 60_000);
  /** Moving to another device: new codes per person in a call; opening links per client address (codes are 128-bit, so this only keeps it calm); and the new device checking on its move about once a second. */
  const moveLimiter = rateLimit(12, 60_000);
  const moveOpenLimiter = rateLimit(30, 60_000);
  const moveCheckLimiter = rateLimit(240, 60_000);
  /** Request bodies are read whole, so each route takes no more than it needs. */
  const capped = (maxSize: number) => bodyLimit({ maxSize, onError: () => { throw new ValidationError('That request is too large.', { context: { maxSize } }); } });
  /** Captions ask for each new line in someone's language, so they get their own, larger allowance. */
  const captionLimiter = rateLimit(90, 60_000);

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
  app.use('*', cors({ origin: d.cfg.WEB_ORIGIN, credentials: true, exposeHeaders: [REQUEST_ID_HEADER], allowHeaders: ['content-type', OPERATION_HEADER, REQUEST_ID_HEADER, CALL_PASS_HEADER, ...Object.values(AUDIO_HEADERS)], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'], maxAge: 600 }));

  /* State changes only from the app itself: its Origin, and a JSON or audio body. This blocks blind
     cross-site POSTs from sibling ports/subdomains that SameSite=Strict still allows. */
  // Audio pieces (2 MiB) are the largest bodies; call commits and chat have their own, tighter caps below.
  app.use('/v1/*', capped(4 * 1024 * 1024));
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
    telemetryLimiter(clientAddress(c), 'telemetry');
    const { entries } = await body(c, ClientLogBatchSchema);
    for (const en of entries) clog.at(en.level, en.msg, { ...en.context, clientAt: en.at });
    return c.json({ received: entries.length });
  });

  // Cloud Run's front end keeps /healthz for itself, so /health answers the same.
  app.on('GET', ['/health', '/healthz'], async (c) => {
    await exec(d.pool, 'SELECT 1');
    return c.json({ ok: true, inference: inference(d.cfg).configured ? 'configured' : 'missing', livekit: (await d.livekit.reachable()) ? 'reachable' : 'unreachable', tee: d.cfg.TEE, commit: d.cfg.ALCOVE_COMMIT });
  });

  /* What's running, for anyone to check before trusting it: outside a TEE it says so; inside, a fresh TDX quote binds the caller's nonce to this build. */
  app.get('/v1/attestation', async (c) => {
    attestLimiter(clientAddress(c), 'attestation');
    const nonce = c.req.query('nonce') ?? '';
    if (!/^[0-9a-f]{64}$/.test(nonce)) throw new ValidationError('Ask with a nonce: 32 random bytes, as lowercase hex.');
    return c.json(await attest(d.cfg, nonce));
  });

  /* ---------- public: the session and signing in ---------- */
  app.get('/v1/session', async (c) => {
    const s = await findSession(d, getCookie(c, COOKIE));
    return c.json(s ? await account.sessionFor(await openOwner(d, s.ownerId, s)) : null);
  });
  app.post('/v1/auth/sign-in', async (c) => {
    limiter(clientAddress(c), 'sign-in');
    const r = await account.demoSignIn(d, await body(c, SignInBodySchema));
    startSession(c, r.sessionId);
    return c.json({ session: await account.sessionFor(r.owner), isNew: r.isNew });
  });

  /* Google: away to Google and back. Both ends are top-level navigations, so both answer with redirects. */
  const allowed = (c: Context) => {
    try { limiter(clientAddress(c), 'sign-in'); return true; } catch { rlog.info('google sign-in refused', { reason: 'busy' }); return false; }
  };
  app.get('/v1/auth/google', async (c) => {
    if (!allowed(c)) return c.redirect(backToWelcome('busy'), 302);
    if (!google.configured(d.cfg)) return c.redirect(backToWelcome('unavailable'), 302);
    try {
      // ?consent=1 asks Google again, e.g. to connect the calendar of the account already signed in.
      const consent = c.req.query('consent') === '1';
      const s = consent ? await findSession(d, getCookie(c, COOKIE)) : undefined;
      const hint = s ? (await account.profile(await openOwner(d, s.ownerId, s))).email : undefined;
      // ?next=/move comes back to a move to this device that was waiting for its owner to sign in here.
      const next = c.req.query('next') === '/move' ? '/move' as const : s ? '/home' as const : undefined;
      const { url, attempt } = await google.begin(d, { consent, hint, ...(next ? { next } : {}) });
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
      const conn = await calendar.connect(s.owner, r.grant);
      startSession(c, s.sessionId);
      const next = r.next ?? (s.isNew ? '/ready' : '/home');
      // Google sends a refresh token only the first time someone agrees. If it remembered an earlier
      // yes, ask once more, explicitly, so the calendar keeps working after this hour.
      if (r.grant.scopes.includes(google.CALENDAR_SCOPE) && !conn.refreshToken && !r.consented) {
        const again = await google.begin(d, { consent: true, hint: r.identity.email, next });
        setCookie(c, ATTEMPT, again.attempt, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: google.ATTEMPT_MINUTES * 60 });
        return c.redirect(again.url, 302);
      }
      return c.redirect(`${d.cfg.WEB_ORIGIN}${next}`, 302);
    } catch (e) {
      rlog.error('google sign-in failed', { err: e });
      return c.redirect(backToWelcome('failed'), 302);
    }
  });

  /* LiveKit's webhooks: outside /v1 (no Origin, no session); trusted only by their signature. */
  app.post('/hooks/livekit', async (c) => {
    await calls.onRoomEvent(d, await d.livekit.verifyWebhook(await c.req.text(), c.req.header('authorization')));
    return c.json({ ok: true });
  });

  /* ---------- group calls: by link (no account needed) and by call pass ---------- */
  const optionalOwner = async (c: Context): Promise<Owner | undefined> => {
    const s = await findSession(d, getCookie(c, COOKIE));
    return s ? openOwner(d, s.ownerId, s) : undefined;
  };
  app.get('/v1/calls/:code/card', async (c) => { callLimiter(clientAddress(c), 'call card'); return c.json(await calls.card(d, c.req.param('code'))); });
  app.post('/v1/calls/:code/join', async (c) => {
    callLimiter(clientAddress(c), 'call join');
    const b = await body(c, CallJoinBodySchema);
    return c.json(await calls.join(d, c.req.param('code'), { owner: await optionalOwner(c), name: b.name, mic: b.mic, cam: b.cam, identity: b.identity, keyPackage: b.keyPackage, previous: b.previous }));
  });
  /*
   * Moving to another device, from the new device's side: no account or pass yet, only the code from its link and
   * then its claim, both in the body (never the path or query, so never in a log). Signed-in devices send their
   * session, which the organizer and invited people need on the device they move to.
   */
  app.use('/v1/moves/*', capped(32 * 1024));
  app.post('/v1/moves/claim', async (c) => {
    moveOpenLimiter(clientAddress(c), 'move open');
    return c.json(await moves.claim(d, (await body(c, MoveClaimBodySchema)).code, await optionalOwner(c)));
  });
  app.post('/v1/moves/status', async (c) => { moveCheckLimiter(clientAddress(c), 'move'); return c.json(await moves.status(d, (await body(c, MoveByClaimBodySchema)).claim, await optionalOwner(c))); });
  app.post('/v1/moves/ready', async (c) => { moveCheckLimiter(clientAddress(c), 'move'); return c.json(await moves.ready(d, await body(c, MoveReadyBodySchema), await optionalOwner(c))); });
  app.post('/v1/moves/arrive', async (c) => { moveCheckLimiter(clientAddress(c), 'move'); return c.json(await moves.arrive(d, (await body(c, MoveByClaimBodySchema)).claim, await optionalOwner(c))); });
  app.post('/v1/moves/cancel', async (c) => { moveCheckLimiter(clientAddress(c), 'move'); await moves.cancelIn(d, (await body(c, MoveByClaimBodySchema)).claim); return c.json({ cancelled: true }); });
  /* Everything about a live call needs that call's pass; the organizer's keys are opened for the request. */
  const viewerFor = async (c: Context<Env>, next: () => Promise<void>) => {
    const pass = readPass(d.cfg, c.req.header(CALL_PASS_HEADER));
    if (!pass || pass.callId !== c.req.param('id')) throw new AuthError('Join the call again to carry on.', { context: { hasPass: Boolean(pass) } });
    // The organizer's pass counts as the organizer's only together with the organizer's own session.
    const owner = pass.role === 'host' ? await optionalOwner(c) : undefined;
    addLogContext({ callId: pass.callId, role: pass.role });
    c.set('viewer', await calls.viewerOf(d, pass, owner?.ownerId));
    await next();
  };
  // Also matches the call itself (/v1/live/calls/:id): the pass is checked once per request.
  app.use('/v1/live/calls/:id/*', viewerFor);
  app.use('/v1/calls/:code/join', capped(64 * 1024));
  app.use('/v1/live/calls/:id/mls/commits', capped(3 * 1024 * 1024));
  app.use('/v1/live/calls/:id/mls/messages', capped(128 * 1024));
  app.use('/v1/live/calls/:id/mls/keypackages', capped(32 * 1024));
  const organizerOnly = (c: Context<Env>) => {
    const v = c.get('viewer');
    if (!v.isOrganizer) throw new ForbiddenError('Only the organizer can do that.', { context: { callId: v.pass.callId, role: v.pass.role } });
    return v;
  };
  app.get('/v1/live/calls/:id', async (c) => c.json(await calls.state(c.get('viewer'), c.req.param('id'))));
  app.post('/v1/live/calls/:id/actions', async (c) => {
    const a = await body(c, CallActionSchema);
    // A raised hand is anyone's in the call; every other action is the organizer's.
    if (a.type === 'hand') calls.requireIn(c.get('viewer'), 'hand');
    else organizerOnly(c);
    return c.json(await calls.act(c.get('viewer'), c.req.param('id'), a));
  });
  /*
   * End-to-end encryption: the call's MLS log, which the API orders and relays and can't read. Everyone keeps
   * up with it; only the organizer's browser commits (adds and removes people); anyone in the group can chat.
   */
  app.get('/v1/live/calls/:id/mls', async (c) => {
    const after = z.coerce.number().int().nonnegative().safeParse(c.req.query('after') ?? '0');
    if (!after.success) throw new ValidationError('Ask from a position in the log.');
    return c.json(await calls.mlsSync(c.get('viewer'), c.req.param('id'), after.data));
  });
  app.post('/v1/live/calls/:id/mls/commits', async (c) => c.json(await calls.mlsCommit(organizerOnly(c), c.req.param('id'), await body(c, CallCommitBodySchema))));
  app.post('/v1/live/calls/:id/mls/messages', async (c) => {
    const v = c.get('viewer');
    chatLimiter(v.pass.identity, 'chat');
    await calls.mlsMessage(v, c.req.param('id'), await body(c, CallMessageBodySchema));
    return c.json({ sent: true });
  });
  app.post('/v1/live/calls/:id/mls/keypackages', async (c) => {
    rejoinLimiter(c.get('viewer').pass.identity, 'rejoin');
    await calls.mlsKeyPackage(c.get('viewer'), c.req.param('id'), await body(c, CallKeyPackageBodySchema));
    return c.json({ sent: true });
  });
  /* Back in after this connection was taken out while it was away (its connection dropped, or its tab slept). */
  app.post('/v1/live/calls/:id/mls/back', async (c) => {
    rejoinLimiter(c.get('viewer').pass.identity, 'rejoin');
    await calls.mlsBack(c.get('viewer'), c.req.param('id'), await body(c, CallKeyPackageBodySchema));
    return c.json({ sent: true });
  });
  /* Moving to another device, from the device being left: by its pass (and, for invited people, their session). */
  app.post('/v1/live/calls/:id/moves', async (c) => {
    const v = c.get('viewer');
    moveLimiter(v.pass.identity, 'move');
    return c.json(await moves.start(v, c.req.param('id'), (await body(c, MoveStartBodySchema)).media, v.pass.role === 'invited' ? await optionalOwner(c) : undefined));
  });
  app.get('/v1/live/calls/:id/moves', async (c) => c.json({ move: await moves.current(c.get('viewer'), c.req.param('id')) }));
  app.post('/v1/live/calls/:id/moves/confirm', async (c) => { await moves.confirm(c.get('viewer'), c.req.param('id'), (await body(c, MoveConfirmBodySchema)).media); return c.json({ released: true }); });
  app.delete('/v1/live/calls/:id/moves', async (c) => { await moves.cancelOut(c.get('viewer'), c.req.param('id')); return c.json({ cancelled: true }); });
  app.get('/v1/live/calls/:id/room', async (c) => c.json(await calls.roomToken(c.get('viewer'), c.req.param('id'))));
  app.post('/v1/live/calls/:id/audio', async (c) => c.json(await calls.audio(organizerOnly(c), c.req.param('id'), await piece(c))));
  app.post('/v1/live/calls/:id/transcribe', async (c) => {
    const v = organizerOnly(c);
    const speaker = speakerOf(c);
    voiceLimiter(`${v.pass.callId}:${speaker}`, 'transcribe');
    speechLimiter(v.organizer.ownerId, 'transcribe');
    return c.json(await calls.transcribe(v, c.req.param('id'), await clip(c), speaker));
  });
  /* Catching up and asking during a call: answers go to the person who asked, and nothing is kept. */
  app.post('/v1/live/calls/:id/catch-up', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'catch-up');
    askLimiter(v.pass.identity, 'catch-up');
    return c.json(await calls.catchUp(v, c.req.param('id'), (await body(c, CatchUpBodySchema)).minutes));
  });
  app.post('/v1/live/calls/:id/ask', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'ask');
    askLimiter(v.pass.identity, 'ask');
    return c.json(await calls.askSoFar(v, c.req.param('id'), (await body(c, AskBodySchema)).question));
  });
  /* The organizer leaving ends the call for everyone; anyone else leaving is taken out of the call's group. */
  /* Captions in someone's own language: translated for them alone, so no receipt keeps a copy. */
  app.post('/v1/live/calls/:id/translate', async (c) => {
    const v = c.get('viewer');
    const { language, lines } = await body(c, TranslateBodySchema);
    captionLimiter(v.pass.identity, 'translate');
    return c.json(await calls.translate(v, c.req.param('id'), language, lines));
  });
  app.post('/v1/live/calls/:id/leave', async (c) => c.json({ ended: await calls.leave(c.get('viewer'), c.req.param('id')) }));

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
    if (!opId || !MUTATING.has(c.req.method) || !keepsReceipt(c.req.path)) return next();
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

  /* Sign-in photos, fetched by Alcove so a browser never asks the provider for anyone's face. */
  app.get('/v1/photos/:token', async (c) => {
    const p = await photos.photo(d, c.req.param('token'));
    return new Response(p.bytes.slice(), { headers: { 'content-type': p.type, 'cache-control': 'private, max-age=86400, immutable', 'x-content-type-options': 'nosniff' } });
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
  app.post('/v1/meetings/:id/next', async (c) => c.json(await meetings.scheduleNext(c.get('owner'), c.req.param('id'), (await body(c, NextCallBodySchema)).startsAt)));

  /* calendar: someone's other events, and making one of them an Alcove call */
  app.get('/v1/calendar', async (c) => { const o = c.get('owner'); return c.json(await calendar.view(o, () => meetings.recurringSeries(o))); });
  app.post('/v1/calendar/events/:id/adopt', async (c) => {
    const { notes } = await body(c, z.object({ notes: NotesSettingSchema.optional() }));
    return c.json(await meetings.adopt(c.get('owner'), c.req.param('id'), notes));
  });
  app.get('/v1/calls/:code/meeting', async (c) => c.json(await meetings.byCode(c.get('owner'), c.req.param('code'))));

  /* calls */
  app.post('/v1/calls', async (c) => c.json(await meetings.startNow(c.get('owner'), await body(c, InstantCallInputSchema))));

  /* room recordings */
  app.post('/v1/recordings', async (c) => c.json(await recordings.start(c.get('owner'), (await body(c, z.object({ title: z.string().max(160).optional() }))).title ?? 'Untitled recording')));
  app.post('/v1/recordings/:id/actions', async (c) => c.json(await recordings.act(c.get('owner'), c.req.param('id'), await body(c, RecordingActionSchema))));
  app.post('/v1/recordings/:id/audio', async (c) => c.json(await recordings.audio(c.get('owner'), c.req.param('id'), await piece(c))));
  app.post('/v1/recordings/:id/transcribe', async (c) => {
    speechLimiter(c.get('owner').ownerId, 'transcribe');
    return c.json(await recordings.transcribe(c.get('owner'), c.req.param('id'), await clip(c)));
  });
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
  /* Confirming what the notes say: anyone who has them can, and everyone sees who did. */
  app.patch('/v1/notes/:id/decisions/:decisionId', async (c) => c.json(await notes.updateDecision(c.get('owner'), c.req.param('id'), c.req.param('decisionId'), await body(c, DecisionPatchSchema))));
  app.patch('/v1/notes/:id/actions/:actionId', async (c) => c.json(await notes.updateAction(c.get('owner'), c.req.param('id'), c.req.param('actionId'), await body(c, ActionPatchSchema))));
  app.patch('/v1/notes/:id/questions/:questionId', async (c) => c.json(await notes.updateQuestion(c.get('owner'), c.req.param('id'), c.req.param('questionId'), await body(c, QuestionPatchSchema))));
  app.post('/v1/notes/:id/ask', async (c) => {
    askLimiter(c.get('owner').ownerId, 'ask');
    return c.json(await notes.ask(c.get('owner'), c.req.param('id'), (await body(c, AskBodySchema)).question));
  });
  app.post('/v1/notes/:id/share', async (c) => c.json(await notes.share(c.get('owner'), c.req.param('id'), (await body(c, ShareBodySchema)).emails)));
  app.delete('/v1/notes/:id', async (c) => { await notes.remove(c.get('owner'), c.req.param('id')); return c.json({ deleted: true }); });

  /* series: what carries over between calls, from the notes the person asking has */
  app.get('/v1/series/:id', async (c) => c.json(await series.get(c.get('owner'), c.req.param('id'))));
  app.post('/v1/series/:id/ask', async (c) => {
    askLimiter(c.get('owner').ownerId, 'ask-series');
    const { question, timeZone } = await body(c, SeriesAskBodySchema);
    return c.json(await series.ask(c.get('owner'), c.req.param('id'), question, timeZone));
  });

  /* credits */
  app.get('/v1/credits', async (c) => c.json(await billing.balance(d, c.get('owner').ownerId)));

  return app;
}

/** Reads a raw audio piece and its position headers. */
async function piece(c: Context): Promise<audioMod.Piece> {
  const num = (name: string) => z.coerce.number().int().min(0).parse(c.req.header(name));
  const mimeType = c.req.header('content-type') ?? '';
  if (!/^audio\/(webm|mp4|ogg)/.test(mimeType)) throw new ValidationError('Audio must be WebM, MP4 or Ogg.');
  if (Number(c.req.header('content-length') ?? 0) > MAX_AUDIO_PIECE_BYTES) throw new ValidationError('That piece of audio is empty or too large.');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_PIECE_BYTES) throw new ValidationError('That piece of audio is empty or too large.');
  return { segment: num(AUDIO_HEADERS.segment), seq: num(AUDIO_HEADERS.seq), durationMs: num(AUDIO_HEADERS.duration), mimeType, bytes };
}

/** True for the WAV the live transcript takes: uncompressed 16-bit PCM, one channel, 16 kHz. */
function isSpeechWav(b: Uint8Array): boolean {
  if (b.length < 44) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (at: number) => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
  return tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 16_000 && v.getUint16(34, true) === 16;
}

/** Whose speech a call's clip is: a participant ID, which the call checks is someone in it. */
function speakerOf(c: Context): string {
  const s = CallIdentity.safeParse(c.req.header(AUDIO_HEADERS.speaker));
  if (!s.success) throw new ValidationError('Speech for a call’s transcript must say whose it is.', { context: { header: AUDIO_HEADERS.speaker } });
  return s.data;
}

/** Reads a transcript clip: 16 kHz mono WAV, and where it starts in its segment. */
async function clip(c: Context): Promise<Clip> {
  const num = (name: string) => z.coerce.number().int().min(0).parse(c.req.header(name));
  if (!/^audio\/(?:wav|x-wav|wave)\b/.test((c.req.header('content-type') ?? '').toLowerCase())) throw new ValidationError('Speech for the transcript must be WAV audio.');
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_TRANSCRIPT_CLIP_BYTES) throw new ValidationError('That clip of speech is too long.', { context: { bytes: declared } });
  const wav = new Uint8Array(await c.req.arrayBuffer());
  if (wav.length <= 44 || wav.length > MAX_TRANSCRIPT_CLIP_BYTES) throw new ValidationError('That clip of speech is empty or too long.', { context: { bytes: wav.length } });
  if (!isSpeechWav(wav)) throw new ValidationError('Speech for the transcript must be 16 kHz mono 16-bit WAV.', { context: { bytes: wav.length } });
  const durationMs = num(AUDIO_HEADERS.duration);
  if (durationMs > MAX_TRANSCRIPT_CLIP_MS) throw new ValidationError('That clip of speech is too long.', { context: { durationMs } });
  return { segment: num(AUDIO_HEADERS.segment), startMs: num(AUDIO_HEADERS.start), durationMs, wav };
}
