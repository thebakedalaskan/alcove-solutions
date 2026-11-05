import {
  ActionPatchSchema, AUDIO_HEADERS, CallIdentity, AskBodySchema, AskSoFarBodySchema, BusyBodySchema, CallActionSchema, CallCommitBodySchema, CallJoinBodySchema, CallKeyPackageBodySchema, CallBackBodySchema, CallMessageBodySchema, CatchUpBodySchema, TranslateBodySchema, ClientLogBatchSchema, DecisionPatchSchema, FRAME_HEADERS, InstantCallInputSchema, MAX_AUDIO_PIECE_BYTES, MAX_FRAME_AGE_MS, MAX_FRAME_BYTES, MAX_TRANSCRIPT_CLIP_BYTES, MAX_TRANSCRIPT_CLIP_MS, CallHandOffBodySchema, CallLeaveBodySchema, ChangeScopeSchema,
  LinePatchSchema, MeetingInputSchema, NextCallBodySchema, NoteKindSchema, NotesSettingSchema, OPERATION_HEADER, PeopleSearchBodySchema, PickTimeBodySchema, PreferencesSchema, QuestionPatchSchema, REQUEST_ID_HEADER, RecordingActionSchema, RoomRecordingInputSchema, RsvpBodySchema, SeriesAskBodySchema, ShareInputSchema, RingAnswerBodySchema, PersonalEditSchema, PersonalInputSchema, PromoteBodySchema,
  ShareEndedBodySchema, ShareIdSchema, SignInBodySchema, TeamInviteBodySchema, MoveByClaimBodySchema, MoveClaimBodySchema, MoveConfirmBodySchema, MoveReadyBodySchema, MoveStartBodySchema, type CallAction
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
import { AuthError, ConflictError, ForbiddenError, NotFoundError, UnavailableError, ValidationError, notFound, toAppError, type AppError } from './errors';
import { addLogContext, log, withLogContext } from './log';
import * as google from './google';
import { inference } from './inference';
import { CALL_PASS_HEADER, readPass } from './callPass';
import { attest } from './tee';
import { openOwner } from './owners';
import { ABSOLUTE_MS, cookieName, findSession } from './sessions';
import * as account from './modules/account';
import * as additions from './modules/additions';
import * as audioMod from './modules/audio';
import * as billing from './modules/billing';
import * as calendar from './modules/calendar';
import * as calls from './modules/calls';
import * as documents from './modules/documents';
import * as meetings from './modules/meetings';
import * as moves from './modules/moves';
import * as notes from './modules/notes';
import * as people from './modules/people';
import * as personal from './modules/personal';
import * as photos from './modules/photos';
import * as recordings from './modules/recordings';
import * as rings from './modules/rings';
import { jpegSize } from './modules/screens';
import * as series from './modules/series';
import * as writer from './modules/writer';
import type { Clip } from './modules/transcripts';

type Env = { Variables: { owner: Owner; viewer: calls.Viewer; requestId: string } };
const rlog = log.child({ component: 'http' });
const clog = log.child({ component: 'client', source: 'browser' });
/**
 * Call codes are join tokens, and a Google event's ID names its recurring series: keep both out of
 * logs. Every other path segment is a random ID.
 */
const safePath = (p: string) => p.replace(/^\/v1\/calls\/(?!$)[^/]+/, '/v1/calls/:code').replace(/^\/v1\/calendar\/events\/(?!$)[^/]+/, '/v1/calendar/events/:id');
const QUIET = new Set(['/health', '/healthz', '/v1/rings']);
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/**
 * Mutations that keep no stored receipt. Searching, asking, translating captions and reading who's busy only read. Audio
 * pieces and transcript clips are already idempotent by their place in the recording (and their
 * answers carry the live transcript, which shouldn't be copied into receipts). Changing a note's
 * decisions, open questions, follow-ups and transcript lines, sharing it, and having it written again
 * each set an explicit state, so a retry changes nothing; and their answer is the whole note, which a
 * receipt kept under someone it was given to would still hold after the organizer deleted it. Saying
 * whether you're coming to a call is the same: it sets one value, and what comes back is the organizer's
 * call. Someone's own notes, and what they add to the shared notes, keep none either: deleting them must
 * leave no copy of what they said for a day. Deleting the account deletes its receipts, so there is no
 * account left to keep one under. Answering a ring sets an explicit state too, and a receipt's clear
 * method and time would say an account was rung for a day after the ring had gone.
 */
const NO_RECEIPT = [
  /^\/v1\/calendar\/busy$/,
  /^\/v1\/notes\/search$/, /^\/v1\/notes\/(?:[^/]+\/)?ask$/, /^\/v1\/series\/[^/]+\/ask$/, /^\/v1\/live\/calls\/[^/]+\/(?:catch-up|ask|translate)$/,
  /^\/v1\/(?:live\/calls|recordings)\/[^/]+\/(?:audio|transcribe)$/,
  /^\/v1\/notes\/[^/]+\/(?:(?:decisions|questions|actions|lines)\/[^/]+|share|rewrite)$/, /^\/v1\/meetings\/[^/]+\/answer$/, /^\/v1\/account$/, /^\/v1\/rings\/[^/]+\/answer$/,
  /^\/v1\/notes\/[^/]+\/(?:personal(?:\/[^/]+(?:\/(?:preview|add))?)?|additions\/[^/]+)$/
];
const keepsReceipt = (path: string) => !NO_RECEIPT.some((r) => r.test(path));
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);
/** The one route that takes an image: a frame of someone's own shared screen. */
const FRAMES = /^\/v1\/live\/calls\/[^/]+\/frames$/;
/** IDs in paths are 22 characters of base64url; anything else names nothing. */
const ID128 = /^[A-Za-z0-9_-]{22}$/;

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

/** `stopping`: the process is shutting down, so what holds a connection open lets it go. */
export function createApp(d: Deps, stopping?: AbortSignal | undefined) {
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
   * host's browser sends one stream of clips per voice it hears, each limited on its own, all within the account's.
   */
  const speechLimiter = rateLimit(240, 60_000);
  const voiceLimiter = rateLimit(40, 60_000);
  const askLimiter = rateLimit(20, 60_000);
  /** Joining by link: public, so limited per client address. */
  const callLimiter = rateLimit(120, 60_000);
  /** Picking one of the times a call offers: public too, and one person does it once. */
  const pickLimiter = rateLimit(30, 60_000);
  /**
   * Reading a call's card: public too, and every pre-join keeps reading it while it waits, once every 4 s on average
   * (15 a minute) until the organizer is there. This lets 40 people wait behind one address, as an office does.
   */
  const cardLimiter = rateLimit(600, 60_000);
  /** Encrypted chat in a call, per person in it. */
  const chatLimiter = rateLimit(120, 60_000);
  /** Fresh key packages to rejoin a call's new group, per person in it (one each time the connection that hosts changes). */
  const rejoinLimiter = rateLimit(20, 60_000);
  /** Asking for notes (and taking it back), per person in a call. */
  const askNotesLimiter = rateLimit(10, 60_000);
  /** Saying whether others may point at what you share, per person in a call: each change makes every browser fetch the call again. */
  const othersPointLimiter = rateLimit(20, 60_000);
  /**
   * Moving to another device: new codes per person in a call; opening links per client address (codes are 128-bit, so
   * this only keeps it calm); and the new device checking on its move, at most twice a second, per client address. Each
   * move is counted too, by its secret's hash: checking on it the same, and changing it (opening, ready, coming in,
   * calling off) a handful of times, with room for coming in to be tried again each second while the organizer's
   * connection comes back.
   */
  const moveLimiter = rateLimit(12, 60_000);
  const moveOpenLimiter = rateLimit(30, 60_000);
  const moveCheckLimiter = rateLimit(240, 60_000);
  const moveSecretCheckLimiter = rateLimit(240, 60_000);
  const moveSecretChangeLimiter = rateLimit(60, 60_000);
  /** Request bodies are read whole, so each route takes no more than it needs. */
  const capped = (maxSize: number) => bodyLimit({ maxSize, onError: () => { throw new ValidationError('That request is too large.', { context: { maxSize } }); } });
  /** Captions ask for each new line in someone's language, so they get their own, larger allowance. */
  const captionLimiter = rateLimit(90, 60_000);
  /** Frames of a shared screen, per person in a call: browsers send one only when the screen changed, at most every few seconds. */
  const frameLimiter = rateLimit(24, 60_000);
  const shareEndLimiter = rateLimit(30, 60_000);
  /** Opening a moment of the live transcript reads all of it, per connection to the call. */
  const momentLimiter = rateLimit(60, 60_000);
  /**
   * Making calls, per account, however it's done: anyone can invite any address, and each call lands on the Home of
   * everyone invited, as many as 60 of them at a time for a call that repeats.
   */
  const makeLimiter = rateLimit(30, 60_000);
  /** Reading who's busy asks Google, for up to 300 people at a time, per account. */
  const busyLimiter = rateLimit(60, 60_000);
  /**
   * Ringing, per organizer: each ring reaches someone's screen, with a sound. Answering, per person: each answer tells
   * the room. And opening the stream of rings, per person: a tab opens one every few minutes, so this leaves room for
   * plenty of tabs, and keeps tabs taking turns over an account's streams from going round too fast. How many streams
   * can be open at once is `RingStreams`'.
   */
  const ringLimiter = rateLimit(20, 60_000);
  const ringAnswerLimiter = rateLimit(30, 60_000);
  const ringStreamLimiter = rateLimit(30, 60_000);
  const ringStreams = new rings.RingStreams(d, stopping);
  /** Your own notes, per connection to a call or per account: reading them in a call reads its live transcript too. */
  const personalLimiter = rateLimit(120, 60_000);

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
  app.use('*', cors({ origin: d.cfg.WEB_ORIGIN, credentials: true, exposeHeaders: [REQUEST_ID_HEADER], allowHeaders: ['content-type', OPERATION_HEADER, REQUEST_ID_HEADER, CALL_PASS_HEADER, ...Object.values(AUDIO_HEADERS), ...Object.values(FRAME_HEADERS)], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'], maxAge: 600 }));

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
    const image = type.startsWith('image/jpeg') && FRAMES.test(c.req.path);
    if (hasBody && !type.startsWith('application/json') && !type.startsWith('audio/') && !image) throw new ValidationError('Unsupported content type.', { context: { contentType: type.slice(0, 60) } });
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
  app.get('/v1/calls/:code/card', async (c) => { cardLimiter(clientAddress(c), 'call card'); return c.json(await calls.card(d, c.req.param('code'), await optionalOwner(c))); });
  app.use('/v1/calls/:code/pick', capped(1024));
  app.post('/v1/calls/:code/pick', async (c) => {
    pickLimiter(clientAddress(c), 'call pick');
    return c.json(await calls.pick(d, c.req.param('code'), (await body(c, PickTimeBodySchema)).at, await optionalOwner(c)));
  });
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
    const { code } = await body(c, MoveClaimBodySchema);
    moveSecretChangeLimiter(moves.limitKey(code), 'move change');
    return c.json(await moves.claim(d, code, await optionalOwner(c)));
  });
  app.post('/v1/moves/status', async (c) => {
    moveCheckLimiter(clientAddress(c), 'move');
    const { claim } = await body(c, MoveByClaimBodySchema);
    moveSecretCheckLimiter(moves.limitKey(claim), 'move check');
    return c.json(await moves.status(d, claim, await optionalOwner(c)));
  });
  app.post('/v1/moves/ready', async (c) => {
    moveCheckLimiter(clientAddress(c), 'move');
    const b = await body(c, MoveReadyBodySchema);
    moveSecretChangeLimiter(moves.limitKey(b.claim), 'move change');
    return c.json(await moves.ready(d, b, await optionalOwner(c)));
  });
  app.post('/v1/moves/arrive', async (c) => {
    moveCheckLimiter(clientAddress(c), 'move');
    const { claim } = await body(c, MoveByClaimBodySchema);
    moveSecretChangeLimiter(moves.limitKey(claim), 'move change');
    return c.json(await moves.arrive(d, claim, await optionalOwner(c)));
  });
  app.post('/v1/moves/cancel', async (c) => {
    moveCheckLimiter(clientAddress(c), 'move');
    const { claim } = await body(c, MoveByClaimBodySchema);
    moveSecretChangeLimiter(moves.limitKey(claim), 'move change');
    await moves.cancelIn(d, claim);
    return c.json({ cancelled: true });
  });
  /* Everything about a live call needs that call's pass; the organizer's keys are opened for the request. */
  const viewerFor = async (c: Context<Env>, next: () => Promise<void>) => {
    const pass = readPass(d.cfg, c.req.header(CALL_PASS_HEADER));
    if (!pass || pass.callId !== c.req.param('id')) throw new AuthError('Join the call again to carry on.', { context: { hasPass: Boolean(pass) } });
    // The organizer's pass, and the pass of whoever hosts, count as theirs only together with the same account's session,
    // opened only for them.
    addLogContext({ callId: pass.callId, role: pass.role });
    c.set('viewer', await calls.viewerOf(d, pass, () => optionalOwner(c)));
    await next();
  };
  // Also matches the call itself (/v1/live/calls/:id): the pass is checked once per request.
  app.use('/v1/live/calls/:id/*', viewerFor);
  app.use('/v1/calls/:code/join', capped(64 * 1024));
  app.use('/v1/live/calls/:id/mls/commits', capped(3 * 1024 * 1024));
  app.use('/v1/live/calls/:id/mls/messages', capped(128 * 1024));
  app.use('/v1/live/calls/:id/mls/keypackages', capped(32 * 1024));
  app.use('/v1/live/calls/:id/frames', capped(MAX_FRAME_BYTES));
  /*
   * What only the organizer may do (what the notes capture, and planning breakout rooms), and what whoever hosts may do
   * (the organizer, or someone standing in for them). A connection that hosted before, which the call has gone on from
   * (another tab or device, or someone else hosting), is told it's out of date (409, as for audio after a pause), so
   * its last audio, speech and changes stop there quietly rather than retry a refusal; anyone else is refused (403).
   */
  const refused = (v: calls.Viewer, only: string) => (v.stale
    ? new ConflictError('You’re not hosting this call from here any more.', { context: { callId: v.pass.callId, role: v.pass.role, only } })
    : new ForbiddenError(only === 'host' ? 'Only the host can do that.' : 'Only the organizer can do that.', { context: { callId: v.pass.callId, role: v.pass.role, only } }));
  const organizerOnly = (c: Context<Env>) => {
    const v = c.get('viewer');
    if (!v.isOrganizer) throw refused(v, 'organizer');
    return v;
  };
  const hostOnly = (c: Context<Env>) => {
    const v = c.get('viewer');
    if (!v.isHost) throw refused(v, 'host');
    return v;
  };
  /** What whoever hosts may do while standing in for the organizer: keep the call running, but not change its notes or rooms' plan. */
  const HOST_ACTIONS: ReadonlySet<CallAction['type']> = new Set(['deny', 'mute', 'remove', 'lock', 'spotlight', 'rooms-close', 'unavailable']);
  app.get('/v1/live/calls/:id', async (c) => c.json(await calls.state(c.get('viewer'), c.req.param('id'))));
  app.post('/v1/live/calls/:id/actions', async (c) => {
    const a = await body(c, CallActionSchema);
    // A raised hand, an ask for notes and whether others may point at your share are anyone's in the call; keeping the
    // call running is whoever hosts'; the rest is the organizer's.
    if (a.type === 'hand' || a.type === 'request-notes' || a.type === 'others-point') calls.requireIn(c.get('viewer'), a.type);
    else if (HOST_ACTIONS.has(a.type)) hostOnly(c);
    else organizerOnly(c);
    // Each ask reaches the organizer, so nobody can keep asking.
    if (a.type === 'request-notes') askNotesLimiter(c.get('viewer').pass.person, 'request-notes');
    if (a.type === 'others-point') othersPointLimiter(c.get('viewer').pass.person, 'others-point');
    if (a.type === 'ring') ringLimiter(c.get('viewer').organizer.ownerId, 'ring');
    return c.json(await calls.act(c.get('viewer'), c.req.param('id'), a));
  });
  /*
   * End-to-end encryption: the call's MLS log, which the API orders and relays and can't read. Everyone keeps
   * up with it; only the host's browser commits (adds and removes people); anyone in the group can chat.
   */
  app.get('/v1/live/calls/:id/mls', async (c) => {
    const after = z.coerce.number().int().nonnegative().safeParse(c.req.query('after') ?? '0');
    if (!after.success) throw new ValidationError('Ask from a position in the log.');
    return c.json(await calls.mlsSync(c.get('viewer'), c.req.param('id'), after.data));
  });
  app.post('/v1/live/calls/:id/mls/commits', async (c) => c.json(await calls.mlsCommit(hostOnly(c), c.req.param('id'), await body(c, CallCommitBodySchema))));
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
    await calls.mlsBack(c.get('viewer'), c.req.param('id'), await body(c, CallBackBodySchema));
    return c.json({ sent: true });
  });
  /*
   * Moving to another device, from the device being left: by its pass, and for invited people their session too: by
   * the role the call has for them, which can be more than their pass says (someone signed in let in from the link).
   */
  app.post('/v1/live/calls/:id/moves', async (c) => {
    const v = c.get('viewer');
    moveLimiter(v.pass.identity, 'move');
    return c.json(await moves.start(v, c.req.param('id'), (await body(c, MoveStartBodySchema)).media, v.role === 'invited' ? await optionalOwner(c) : undefined));
  });
  app.get('/v1/live/calls/:id/moves', async (c) => c.json({ move: await moves.current(c.get('viewer'), c.req.param('id')) }));
  app.post('/v1/live/calls/:id/moves/confirm', async (c) => { await moves.confirm(d, c.get('viewer'), c.req.param('id'), (await body(c, MoveConfirmBodySchema)).media); return c.json({ released: true }); });
  app.delete('/v1/live/calls/:id/moves', async (c) => { await moves.cancelOut(c.get('viewer'), c.req.param('id')); return c.json({ cancelled: true }); });
  app.get('/v1/live/calls/:id/room', async (c) => c.json(await calls.roomToken(c.get('viewer'), c.req.param('id'))));
  /* The notes, from the browser of whoever hosts: the recording and the speech it hears. */
  app.post('/v1/live/calls/:id/audio', async (c) => c.json(await calls.audio(hostOnly(c), c.req.param('id'), await piece(c))));
  /*
   * Speech for a call's transcript: from the browser of whoever hosts for the main room, or from a breakout room's scribe
   * for its room, someone invited who was sent there. A guest with the link is never either; the call takes the rest only
   * from whoever hears the part of the call it was said in.
   */
  app.post('/v1/live/calls/:id/transcribe', async (c) => {
    const v = c.get('viewer');
    if (!v.inCall || v.role === 'guest') throw refused(v, 'host');
    const speaker = speakerOf(c);
    // When the speech began, on this server's clock: measured as the request arrives, before its audio is read.
    const began = Date.now() - agoOf(c);
    // Counted once the call has said it's this browser's to send: speech it refuses can't use up the organizer's allowance.
    const count = () => { voiceLimiter(`${v.pass.callId}:${speaker}`, 'transcribe'); speechLimiter(v.organizer.ownerId, 'transcribe'); };
    return c.json(await calls.transcribe(v, c.req.param('id'), await clip(c), speaker, began, count));
  });
  /*
   * Shared screens: a frame of someone's own share, from their own browser, while screen notes are on. Anyone let in
   * can be the one sharing; whose share it is, and that it's a screen, is checked with LiveKit.
   */
  app.post('/v1/live/calls/:id/frames', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'screen');
    frameLimiter(v.pass.identity, 'frames');
    return c.json(await calls.shareFrame(v, c.req.param('id'), await frame(c)));
  });
  app.post('/v1/live/calls/:id/frames/ended', async (c) => {
    const v = c.get('viewer');
    shareEndLimiter(v.pass.identity, 'share-ended');
    await calls.shareEnded(v, c.req.param('id'), (await body(c, ShareEndedBodySchema)).share);
    return c.json({ ended: true });
  });
  /*
   * Catching up and asking during a call: answers go to the person who asked, from what they may read, and nothing
   * is kept. GET says what they can catch up on; a moment of the transcript is opened with their access checked again.
   */
  app.get('/v1/live/calls/:id/catch-up', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'catch-up');
    return c.json(await calls.catchUpWindow(v, c.req.param('id')));
  });
  app.post('/v1/live/calls/:id/catch-up', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'catch-up');
    askLimiter(v.pass.identity, 'catch-up');
    return c.json(await calls.catchUp(v, c.req.param('id'), (await body(c, CatchUpBodySchema)).range));
  });
  app.post('/v1/live/calls/:id/ask', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'ask');
    askLimiter(v.pass.identity, 'ask');
    const { question, range } = await body(c, AskSoFarBodySchema);
    return c.json(await calls.askSoFar(v, c.req.param('id'), question, range));
  });
  app.get('/v1/live/calls/:id/transcript/:line', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'moment');
    momentLimiter(v.pass.identity, 'moment');
    const line = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).safeParse(c.req.param('line'));
    if (!line.success) throw new ValidationError('That isn’t a moment of this call.');
    return c.json(await calls.moment(v, c.req.param('id'), line.data));
  });
  /*
   * Your own notes from inside a call: your account's, with your session, on the call's note. Nothing here goes into the
   * call's state or tells anyone else's browser.
   */
  app.use('/v1/live/calls/:id/personal/*', capped(32 * 1024));
  const ownInCall = (c: Context<Env>) => {
    const v = c.get('viewer');
    personalLimiter(v.pass.identity, 'personal');
    return calls.personalIn(v, c.req.param('id') ?? '', () => optionalOwner(c));
  };
  app.get('/v1/live/calls/:id/personal', async (c) => c.json(await personal.read(await ownInCall(c))));
  app.post('/v1/live/calls/:id/personal', async (c) => c.json(await personal.add(await ownInCall(c), await body(c, PersonalInputSchema))));
  app.patch('/v1/live/calls/:id/personal/:entryId', async (c) => c.json(await personal.edit(await ownInCall(c), c.req.param('entryId'), (await body(c, PersonalEditSchema)).text)));
  app.delete('/v1/live/calls/:id/personal/:entryId', async (c) => c.json(await personal.remove(await ownInCall(c), c.req.param('entryId'))));
  /* Captions in someone's own language: translated for them alone, so no receipt keeps a copy. */
  app.post('/v1/live/calls/:id/translate', async (c) => {
    const v = c.get('viewer');
    const { language, lines } = await body(c, TranslateBodySchema);
    captionLimiter(v.pass.identity, 'translate');
    return c.json(await calls.translate(v, c.req.param('id'), language, lines));
  });
  /* Whoever hosts leaving ends the call for everyone, unless they hand it to someone; anyone else leaving is taken out of the call's group. */
  app.post('/v1/live/calls/:id/leave', async (c) => c.json({ ended: await calls.leave(c.get('viewer'), c.req.param('id'), (await body(c, CallLeaveBodySchema)).end) }));
  app.post('/v1/live/calls/:id/hand-off', async (c) => {
    const v = hostOnly(c);
    await calls.handOff(v, c.req.param('id'), (await body(c, CallHandOffBodySchema)).to);
    return c.json({ left: true });
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
  /* Every session goes with the account; this browser's cookie goes too. */
  app.delete('/v1/account', async (c) => {
    await account.deleteAccount(c.get('owner'));
    deleteCookie(c, COOKIE, { path: '/', secure });
    return c.json({ deleted: true });
  });

  /* people: search terms travel in the body, never the URL */
  app.post('/v1/people/search', async (c) => c.json(await people.search(c.get('owner'), (await body(c, PeopleSearchBodySchema)).query)));
  app.get('/v1/team', async (c) => c.json(await people.team(c.get('owner'))));
  app.post('/v1/team/invites', async (c) => c.json(await people.inviteToTeam(c.get('owner'), (await body(c, TeamInviteBodySchema)).emails)));

  /* meetings */
  app.get('/v1/meetings', async (c) => c.json(c.req.query('range') === 'past' ? await meetings.past(c.get('owner')) : await meetings.upcoming(c.get('owner'))));
  app.get('/v1/meetings/:id', async (c) => c.json(await meetings.get(c.get('owner'), c.req.param('id'))));
  app.post('/v1/meetings', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    return c.json(await meetings.create(c.get('owner'), await body(c, MeetingInputSchema)));
  });
  /* How far a change to a call in a series reaches. */
  const scopeOf = (c: Context) => {
    const scope = ChangeScopeSchema.optional().safeParse(c.req.query('scope'));
    if (!scope.success) throw new ValidationError('A change reaches this call, or this and later calls.');
    return scope.data;
  };
  app.patch('/v1/meetings/:id', async (c) => {
    const patch = await body(c, MeetingInputSchema.partial());
    // Making a call repeat, or how it repeats, makes calls.
    if (patch.repeat) makeLimiter(c.get('owner').ownerId, 'calls');
    return c.json(await meetings.update(c.get('owner'), c.req.param('id'), patch, scopeOf(c)));
  });
  app.delete('/v1/meetings/:id', async (c) => { await meetings.cancel(c.get('owner'), c.req.param('id'), scopeOf(c)); return c.json({ cancelled: true }); });
  app.post('/v1/meetings/:id/next', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    return c.json(await meetings.scheduleNext(c.get('owner'), c.req.param('id'), (await body(c, NextCallBodySchema)).startsAt));
  });
  app.post('/v1/meetings/:id/answer', async (c) => c.json(await meetings.answer(c.get('owner'), c.req.param('id'), (await body(c, RsvpBodySchema)).answer)));

  /* calendar: someone's other events, and making one of them an Alcove call */
  app.get('/v1/calendar', async (c) => { const o = c.get('owner'); return c.json(await calendar.view(o, () => meetings.recurringSeries(o))); });
  app.delete('/v1/calendar', async (c) => { const o = c.get('owner'); return c.json(await calendar.disconnect(o, () => meetings.recurringSeries(o))); });
  app.post('/v1/calendar/busy', async (c) => {
    const o = c.get('owner');
    busyLimiter(o.ownerId, 'busy');
    return c.json(await calendar.busy(o, await body(c, BusyBodySchema), () => meetings.all(o)));
  });
  app.post('/v1/calendar/events/:id/adopt', async (c) => {
    const { notes } = await body(c, z.object({ notes: NotesSettingSchema.optional() }));
    return c.json(await meetings.adopt(c.get('owner'), c.req.param('id'), notes));
  });
  app.get('/v1/calls/:code/meeting', async (c) => c.json(await meetings.byCode(c.get('owner'), c.req.param('code'))));

  /* documents people can bring to calls */
  app.get('/v1/documents', async (c) => c.json(await documents.library(c.get('owner'))));

  /* calls */
  app.post('/v1/calls', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    return c.json(await meetings.startNow(c.get('owner'), await body(c, InstantCallInputSchema)));
  });

  /* rings: who's ringing you, as it changes. Nothing here keeps the request's context or the account's keys: the stream outlives both. */
  app.get('/v1/rings', async (c) => {
    ringStreamLimiter(c.get('owner').ownerId, 'rings');
    return new Response(await ringStreams.connect(await rings.listenerOf(c.get('owner'))), { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
  });
  app.post('/v1/rings/:id/answer', async (c) => {
    ringAnswerLimiter(c.get('owner').ownerId, 'ring answer');
    const id = c.req.param('id');
    if (!ID128.test(id)) throw notFound('That ring');
    await calls.answerRing(c.get('owner'), id, (await body(c, RingAnswerBodySchema)).reply);
    return c.json({ answered: true });
  });

  /* room recordings */
  app.post('/v1/recordings', async (c) => c.json(await recordings.start(c.get('owner'), await body(c, RoomRecordingInputSchema))));
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
  app.get('/v1/notes/inbox', async (c) => c.json(await notes.inbox(c.get('owner'))));
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
  /* A note's shared-screen frame, for anyone who has the note: decrypted here, never cached by the browser. */
  app.get('/v1/notes/:id/screens/:frameId', async (c) => {
    const frameId = c.req.param('frameId');
    if (!ID128.test(frameId)) throw new NotFoundError('That frame doesn’t exist.');
    const jpeg = await notes.screenImage(c.get('owner'), c.req.param('id'), frameId);
    return new Response(jpeg.slice(), { headers: { 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'" } });
  });
  /* Confirming what the notes say: anyone who has them can, and everyone sees who did. */
  app.patch('/v1/notes/:id/decisions/:decisionId', async (c) => c.json(await notes.updateDecision(c.get('owner'), c.req.param('id'), c.req.param('decisionId'), await body(c, DecisionPatchSchema))));
  app.patch('/v1/notes/:id/actions/:actionId', async (c) => c.json(await notes.updateAction(c.get('owner'), c.req.param('id'), c.req.param('actionId'), await body(c, ActionPatchSchema))));
  app.patch('/v1/notes/:id/questions/:questionId', async (c) => c.json(await notes.updateQuestion(c.get('owner'), c.req.param('id'), c.req.param('questionId'), await body(c, QuestionPatchSchema))));
  app.patch('/v1/notes/:id/lines/:lineId', async (c) => c.json(await notes.correctLine(c.get('owner'), c.req.param('id'), c.req.param('lineId'), await body(c, LinePatchSchema))));
  app.post('/v1/notes/:id/rewrite', async (c) => {
    const o = c.get('owner');
    // Writing the notes again costs inference and isn't charged, so it shares the questions' allowance.
    askLimiter(o.ownerId, 'rewrite');
    const note = await notes.rewrite(o, c.req.param('id'));
    writer.kick(o, o.ownerId);
    return c.json(note);
  });
  app.post('/v1/notes/:id/ask', async (c) => {
    askLimiter(c.get('owner').ownerId, 'ask');
    return c.json(await notes.ask(c.get('owner'), c.req.param('id'), (await body(c, AskBodySchema)).question));
  });
  /* Asking across every note you have, under the same limit as asking about one. */
  app.post('/v1/notes/ask', async (c) => {
    askLimiter(c.get('owner').ownerId, 'ask');
    return c.json(await notes.askAll(c.get('owner'), (await body(c, AskBodySchema)).question));
  });
  app.post('/v1/notes/:id/share', async (c) => c.json(await notes.share(c.get('owner'), c.req.param('id'), await body(c, ShareInputSchema))));
  /*
   * Your own notes on a note you have: only ever your own, so there's nothing here to ask for by anyone else's ID. Adding
   * something to the shared notes takes a preview first, then saying so with the preview's seal.
   */
  app.use('/v1/notes/:id/personal/*', capped(32 * 1024));
  const ownOnNote = (c: Context<Env>) => {
    const o = c.get('owner');
    personalLimiter(o.ownerId, 'personal');
    return personal.ofNote(o, c.req.param('id') ?? '');
  };
  app.get('/v1/notes/:id/personal', async (c) => c.json(await personal.read(await ownOnNote(c))));
  app.post('/v1/notes/:id/personal', async (c) => c.json(await personal.add(await ownOnNote(c), await body(c, PersonalInputSchema))));
  app.patch('/v1/notes/:id/personal/:entryId', async (c) => c.json(await personal.edit(await ownOnNote(c), c.req.param('entryId'), (await body(c, PersonalEditSchema)).text)));
  app.delete('/v1/notes/:id/personal/:entryId', async (c) => c.json(await personal.remove(await ownOnNote(c), c.req.param('entryId'))));
  app.post('/v1/notes/:id/personal/:entryId/preview', async (c) => {
    const o = c.get('owner');
    personalLimiter(o.ownerId, 'personal');
    return c.json(await additions.preview(o, c.req.param('id'), c.req.param('entryId')));
  });
  app.post('/v1/notes/:id/personal/:entryId/add', async (c) => {
    const o = c.get('owner');
    personalLimiter(o.ownerId, 'personal');
    await additions.addToShared(o, c.req.param('id'), c.req.param('entryId'), await body(c, PromoteBodySchema));
    return c.json(await notes.get(o, c.req.param('id')));
  });
  app.delete('/v1/notes/:id/additions/:additionId', async (c) => {
    const o = c.get('owner');
    await additions.takeBack(o, c.req.param('id'), c.req.param('additionId'));
    return c.json(await notes.get(o, c.req.param('id')));
  });
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

/** A position header: a whole number that fits the integer columns it's stored in. */
const position = (c: Context, name: string) => z.coerce.number().int().min(0).max(2_147_483_647).parse(c.req.header(name));

/** Reads a raw audio piece and its position headers. */
async function piece(c: Context): Promise<audioMod.Piece> {
  const num = (name: string) => position(c, name);
  const mimeType = c.req.header('content-type') ?? '';
  if (!/^audio\/(webm|mp4|ogg)/.test(mimeType)) throw new ValidationError('Audio must be WebM, MP4 or Ogg.');
  if (Number(c.req.header('content-length') ?? 0) > MAX_AUDIO_PIECE_BYTES) throw new ValidationError('That piece of audio is empty or too large.');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_PIECE_BYTES) throw new ValidationError('That piece of audio is empty or too large.');
  return { segment: num(AUDIO_HEADERS.segment), seq: num(AUDIO_HEADERS.seq), atMs: num(AUDIO_HEADERS.at), durationMs: num(AUDIO_HEADERS.duration), mimeType, bytes };
}

/**
 * Reads a frame of a shared screen: a JPEG of at most MAX_FRAME_BYTES (refused from its declared size before the body
 * is read), between 64 and 4096 pixels on each side, which share it's from and how long ago it was taken.
 */
async function frame(c: Context): Promise<calls.FrameUpload> {
  if ((c.req.header('content-type') ?? '').toLowerCase().split(';')[0]?.trim() !== 'image/jpeg') throw new ValidationError('A frame must be a JPEG image.');
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_FRAME_BYTES) throw new ValidationError('That frame is too large.', { context: { bytes: declared } });
  const share = ShareIdSchema.safeParse(c.req.header(FRAME_HEADERS.share));
  if (!share.success) throw new ValidationError('Say which shared screen the frame is from.', { context: { header: FRAME_HEADERS.share } });
  const age = z.coerce.number().int().min(0).safeParse(c.req.header(FRAME_HEADERS.age) ?? '0');
  if (!age.success) throw new ValidationError('Say how long ago the frame was taken.', { context: { header: FRAME_HEADERS.age } });
  // When it was taken, on this server's clock: measured as the request arrives, before its image is read.
  const takenAt = Date.now() - Math.min(age.data, MAX_FRAME_AGE_MS);
  const jpeg = new Uint8Array(await c.req.arrayBuffer());
  if (!jpeg.length || jpeg.length > MAX_FRAME_BYTES) throw new ValidationError('That frame is empty or too large.', { context: { bytes: jpeg.length } });
  const size = jpegSize(jpeg);
  if (!size) throw new ValidationError('A frame must be a JPEG image.', { context: { bytes: jpeg.length } });
  if (Math.min(size.width, size.height) < 64 || Math.max(size.width, size.height) > 4096) throw new ValidationError('That frame is too small or too large.', { context: { width: size.width, height: size.height } });
  return { share: share.data, takenAt, jpeg, ...size };
}

/** True for the WAV the live transcript takes: uncompressed 16-bit PCM, one channel, 16 kHz. */
function isSpeechWav(b: Uint8Array): boolean {
  if (b.length < 44) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (at: number) => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
  return tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 16_000 && v.getUint16(34, true) === 16;
}

/**
 * How long before this request a call's clip of speech began, in ms (at most ten minutes): the call places the speech
 * where its speaker was then.
 */
function agoOf(c: Context): number {
  const ago = z.coerce.number().int().min(0).max(600_000).safeParse(c.req.header(AUDIO_HEADERS.ago));
  if (!ago.success) throw new ValidationError('Speech for a call’s transcript must say when it began.', { context: { header: AUDIO_HEADERS.ago } });
  return ago.data;
}

/** Whose speech a call's clip is: a participant ID, which the call checks is someone in it. */
function speakerOf(c: Context): string {
  const s = CallIdentity.safeParse(c.req.header(AUDIO_HEADERS.speaker));
  if (!s.success) throw new ValidationError('Speech for a call’s transcript must say whose it is.', { context: { header: AUDIO_HEADERS.speaker } });
  return s.data;
}

/** Reads a transcript clip: 16 kHz mono WAV, and where it starts in its segment. */
async function clip(c: Context): Promise<Clip> {
  const num = (name: string) => position(c, name);
  if (!/^audio\/(?:wav|x-wav|wave)\b/.test((c.req.header('content-type') ?? '').toLowerCase())) throw new ValidationError('Speech for the transcript must be WAV audio.');
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_TRANSCRIPT_CLIP_BYTES) throw new ValidationError('That clip of speech is too long.', { context: { bytes: declared } });
  const wav = new Uint8Array(await c.req.arrayBuffer());
  if (wav.length <= 44 || wav.length > MAX_TRANSCRIPT_CLIP_BYTES) throw new ValidationError('That clip of speech is empty or too long.', { context: { bytes: wav.length } });
  if (!isSpeechWav(wav)) throw new ValidationError('Speech for the transcript must be 16 kHz mono 16-bit WAV.', { context: { bytes: wav.length } });
  const durationMs = num(AUDIO_HEADERS.duration);
  if (durationMs > MAX_TRANSCRIPT_CLIP_MS) throw new ValidationError('That clip of speech is too long.', { context: { durationMs } });
  return { segment: num(AUDIO_HEADERS.segment), atMs: num(AUDIO_HEADERS.at), durationMs, wav };
}
