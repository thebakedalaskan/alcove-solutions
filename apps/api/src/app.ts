import {
  ActionPatchSchema, ActionProposalSchema, AUDIO_HEADERS, CallIdentity, AskBodySchema, DOC_UPDATE_TYPE, DocAwarenessBodySchema, ItemInputSchema, ItemPlaceSchema, ItemRenameSchema, MediaInputSchema, MAX_DOC_AWARENESS_BYTES, MAX_DOC_BYTES, MAX_DOC_UPDATE_BYTES, MentionBodySchema, PersonIdsBodySchema, PresenceBodySchema, RestrictBodySchema, ShareBodySchema, WorkspaceInputSchema, WorkspacePersonInputSchema, WorkspaceRolePatchSchema, AskSoFarBodySchema, BusyBodySchema, CallActionSchema, CallCommitBodySchema, CallJoinBodySchema, CallKeyPackageBodySchema, CallBackBodySchema, CallMessageBodySchema, CatchUpBodySchema, TranslateBodySchema, ClientLogBatchSchema, DecisionPatchSchema, DecisionProposalSchema, FRAME_HEADERS, InstantCallInputSchema, MAX_AUDIO_PIECE_BYTES, MAX_FRAME_AGE_MS, MAX_FRAME_BYTES, MAX_TRANSCRIPT_CLIP_BYTES, MAX_TRANSCRIPT_CLIP_MS, MAX_MEDIA_PREVIEW_BYTES, MEDIA_PIECE_BYTES, HEARD_HEADERS, CallHandOffBodySchema, CallLeaveBodySchema, ChangeScopeSchema, DocAskBodySchema, BoardSortBodySchema, DocFollowUpTickSchema, PresenterFrameNoteBodySchema, PresenterNotesBodySchema,
  LinePatchSchema, MeetingInputSchema, NextCallBodySchema, NoteKindSchema, NotesSettingSchema, OPERATION_HEADER, PeopleSearchBodySchema, PickTimeBodySchema, PreferencesSchema, QuestionPatchSchema, REQUEST_ID_HEADER, RecordingActionSchema, RevisitPatchSchema, RoomRecordingInputSchema, RsvpBodySchema, SeriesAskBodySchema, ShareInputSchema, RingAnswerBodySchema, PersonalEditSchema, PersonalInputSchema, PromoteBodySchema,
  ShareEndedBodySchema, ShareIdSchema, SignInBodySchema, TeamInviteBodySchema, MoveByClaimBodySchema, MoveClaimBodySchema, MoveConfirmBodySchema, MoveReadyBodySchema, MoveStartBodySchema, type Meeting, type CallAction
} from '@alcove/api';
import type { HttpBindings } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { z, ZodError } from 'zod';
import type { Deps, Owner } from './context';
import { b64u, equalBytes, mac, random, operationCommitKey, operationResultKey, openJson, sealJson, unb64u, utf8 } from './crypto';
import { bytea, exec, maybeOne } from './db';
import { AuthError, ConflictError, ForbiddenError, NotFoundError, TooLargeError, UnavailableError, ValidationError, notFound, toAppError, type AppError } from './errors';
import { addLogContext, log, withLogContext, type Level } from './log';
import * as google from './google';
import { inference } from './inference';
import { CALL_PASS_HEADER, readPass } from './callPass';
import { attest } from './tee';
import { openOwner } from './owners';
import { ABSOLUTE_MS, cookieName, findSession } from './sessions';
import * as access from './modules/workspaceAccess';
import * as account from './modules/account';
import * as additions from './modules/additions';
import * as audioMod from './modules/audio';
import * as billing from './modules/billing';
import * as calendar from './modules/calendar';
import * as calls from './modules/calls';
import * as documents from './modules/documents';
import * as media from './modules/media';
import * as meetings from './modules/meetings';
import * as moves from './modules/moves';
import * as notes from './modules/notes';
import * as people from './modules/people';
import * as personal from './modules/personal';
import * as photos from './modules/photos';
import * as presenterNotes from './modules/presenterNotes';
import * as recordings from './modules/recordings';
import * as rings from './modules/rings';
import { jpegSize } from './modules/screens';
import * as series from './modules/series';
import * as workspaceDocuments from './modules/workspaceDocuments';
import * as mentions from './modules/workspaceMentions';
import * as workspaces from './modules/workspaces';
import * as writer from './modules/writer';
import type { Clip } from './modules/transcripts';

type Env = { Bindings: HttpBindings; Variables: { owner: Owner; viewer: calls.Viewer; requestId: string; receipt: string | undefined; refusedAt: Level | undefined } };
const rlog = log.child({ component: 'http' });
const clog = log.child({ component: 'client', source: 'browser' });
/**
 * Call codes are join tokens, a Google event's ID names its recurring series, and a file's token reads it: keep all three
 * out of logs. Every other path segment is a random ID.
 */
const safePath = (p: string) => p.replace(/^\/v1\/calls\/(?!$)[^/]+/, '/v1/calls/:code').replace(/^\/v1\/calendar\/events\/(?!$)[^/]+/, '/v1/calendar/events/:id').replace(/^\/v1\/media\/(?!$)[^/]+/, '/v1/media/:token');
const QUIET = new Set(['/health', '/healthz', '/v1/rings']);
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/**
 * Mutations that keep no stored receipt. Searching, asking, translating captions and reading who's busy only read. Audio
 * pieces and transcript clips are already idempotent by their place in the recording (and their
 * answers carry the live transcript, which shouldn't be copied into receipts). Proposing a decision or
 * follow-up, changing a note's decisions, open questions, follow-ups and transcript lines, sharing it,
 * and having it written again each set an explicit state (the same words proposed again add nothing),
 * so a retry changes nothing; and their answer is the whole note, which a receipt kept under someone
 * it was given to would still hold after the organizer deleted it. Saying whether you're coming to a
 * call is the same: it sets one value, and what comes back is the organizer's call. Someone's own
 * notes, and what they add to the shared notes, keep none either: deleting them must leave no copy of
 * what they said for a day. Deleting the account deletes its receipts, so there is no account left to
 * keep one under. Answering a ring sets an explicit state too, and a receipt's clear method and time
 * would say an account was rung for a day after the ring had gone. What a guest can reach of a workspace
 * comes before receipts altogether, so it isn't listed here: see the routes.
 */
const NO_RECEIPT = [
  /^\/v1\/calendar\/busy$/,
  /^\/v1\/notes\/search$/, /^\/v1\/notes\/(?:[^/]+\/)?ask$/, /^\/v1\/series\/[^/]+\/ask$/, /^\/v1\/live\/calls\/[^/]+\/(?:catch-up|ask|series\/ask|translate|notes\/watch)$/,
  /^\/v1\/(?:live\/calls|recordings)\/[^/]+\/(?:audio|transcribe)$/,
  /^\/v1\/notes\/[^/]+\/(?:(?:decisions|questions|actions|lines)(?:\/[^/]+)?|revisits\/[^/]+|share|rewrite)$/, /^\/v1\/meetings\/[^/]+\/answer$/, /^\/v1\/account$/, /^\/v1\/rings\/[^/]+\/answer$/,
  /^\/v1\/notes\/[^/]+\/(?:personal(?:\/[^/]+(?:\/(?:preview|add))?)?|additions\/[^/]+)$/
];
const keepsReceipt = (path: string) => !NO_RECEIPT.some((r) => r.test(path));
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);
/** The most audio one range carries, under Cloud Run's 32 MiB for a reply of a known length. A browser asks again for the rest. */
const MOST_AUDIO_PER_REPLY = 24 * 1024 * 1024;
/** The one route that takes an image: a frame of someone's own shared screen. */
const FRAMES = /^\/v1\/live\/calls\/[^/]+\/frames$/;
/** What holds a document's content, as it is: a paste can be megabytes, and it has a limit of its own. */
const DOC_UPDATES = /^\/v1\/workspaces\/[^/]+\/documents\/[^/]+\/(?:updates|adopt)$/;
/** The one route that takes a picture's preview: a small JPEG, kept beside a picture in a workspace. */
const MEDIA_PREVIEW = /^\/v1\/workspaces\/[^/]+\/documents\/[^/]+\/media\/[^/]+\/preview$/;
/** The one route that takes bytes as they are: a piece of a file going into a workspace. */
const MEDIA_PIECES = /^\/v1\/workspaces\/[^/]+\/documents\/[^/]+\/media\/[^/]+\/pieces\/[^/]+$/;
/** IDs in paths are 22 characters of base64url; anything else names nothing. */
const ID128 = /^[A-Za-z0-9_-]{22}$/;

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

/**
 * A small fixed-window limiter: at most `max` hits per key in each window. Unauthenticated requests
 * are keyed by client address; the ones that cost inference by account.
 */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string, what = 'request', cost = 1) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.until < now) { hits.set(key, { n: cost, until: now + windowMs }); if (hits.size > 50_000) hits.clear(); return; }
    if ((h.n += cost) > max) throw new UnavailableError('Too many attempts. Wait a minute and try again.', { context: { limit: what, max, windowMs } });
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
  /** Changing what a note says: each change writes a whole new revision of it, so nobody can churn one, or its history. */
  const noteChangeLimiter = rateLimit(120, 60_000);
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
  /** Ticking follow-ups, per person in a call: the same. */
  const followUpLimiter = rateLimit(60, 60_000);
  /** Saying you're looking at the live notes, per connection to a call: a browser does every 5 seconds. Refreshes have their own limit, for each view of each part of the call. */
  const notesWatchLimiter = rateLimit(120, 60_000);
  /** Looking for ideas from the call: a browser with a board open looks every 15 seconds or so, and only one a minute reads anything. */
  const ideasWatchLimiter = rateLimit(30, 60_000);
  /** Sorting a board's stickies into themes, for each person. */
  const sortLimiter = rateLimit(20, 60_000);
  /** Reading the call's follow-ups, per connection to a call: a browser showing them does every 5 seconds, and each read opens the documents worked on. */
  const followUpsLimiter = rateLimit(30, 60_000);
  /** Asking to see the workspace, per person in a call: each ask reaches the organizer. */
  const askSpaceLimiter = rateLimit(10, 60_000);
  /** What goes on in a call's workspace, per person in it: each step makes every browser fetch the call again. */
  const spaceLimiter = rateLimit(240, 60_000);
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
  /**
   * What carries over into a call, per account. Each read opens every note the person has, not only the series' (which
   * of them are in it is sealed in them), and a pre-join or a call's panel reads it about once a minute.
   */
  const carryLimiter = rateLimit(60, 60_000);
  /** Changes to a workspace's tree and people, per person: a title follows what's typed, about three times a second at most. */
  const treeLimiter = rateLimit(600, 60_000);
  /** Opening a workspace's stream, per person. Browsers open it again by themselves, every few minutes when all's well. */
  const liveLimiter = rateLimit(120, 60_000);
  /** Making workspaces, per account: each is an owner with keys of its own. */
  const workspaceLimiter = rateLimit(20, 60_000);
  /** Reading your list of workspaces or your documents, per account: each opens every one you're in. */
  const workspaceListLimiter = rateLimit(120, 60_000);
  /** Opening a document's stream, per person: clicking through a list opens one each. */
  const documentLiveLimiter = rateLimit(240, 60_000);
  /** Updates to documents, per person: a browser sends at most about seven a second, and someone may have two or three open. */
  const updateLimiter = rateLimit(1200, 60_000);
  /** How much of them, in KiB: a long paste is megabytes, and nobody pastes one every second. */
  const updateBytesLimiter = rateLimit(64 * 1024, 60_000);
  /** Reading a version, per person: History reads one at a time, as someone clicks through them. */
  const versionLimiter = rateLimit(60, 60_000);
  /** Where a caret or pointer is, per person: a browser sends at most ten a second. */
  const awarenessLimiter = rateLimit(1800, 60_000);
  /** Where someone is in a workspace, per person: every 10 seconds and whenever they move or start typing. */
  const presenceLimiter = rateLimit(600, 60_000);
  /** Reading every document someone can open, for searching: once when search opens. */
  const searchLimiter = rateLimit(12, 60_000);
  /** Tagging people and saying you've heard, per person: a tag is typed, so this is far more than anyone writes. */
  const mentionLimiter = rateLimit(240, 60_000);
  /** People's IDs in a workspace, per person: asked as a document opens and as people come and go in a call. */
  const idsLimiter = rateLimit(120, 60_000);
  /** Saving someone's own notes on a document, per person: they save as they're typed. */
  const presenterLimiter = rateLimit(120, 60_000);
  /** Pieces of a file, per person: 4 MiB each, so about 40 MiB a second, more than any browser's upload. */
  const pieceLimiter = rateLimit(600, 60_000);
  /** Reading files, per person, by what it costs: each URL asked for and each piece opened. */
  const mediaLimiter = rateLimit(media.MEDIA_LIMITS.readsAMinute, 60_000);

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
      if (!c.env.incoming.complete) dropTheRest(c.env, c.req.raw.body, requestId);
      const ms = Math.round(performance.now() - t0);
      const status = c.res.status;
      const line = { status, ms };
      if (QUIET.has(c.req.path) && status < 400) rlog.debug('request', line);
      // A 5xx is us failing, unless what answered it says it's an ordinary refusal: a browser that went mid-piece, say.
      else if (status >= 500 && c.get('refusedAt') !== 'info') rlog.error('request failed', line);
      else if (status >= 400) rlog.info('request refused', line);
      else rlog.info('request', line);
    });
  });
  const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => schema.parse(await c.req.json().catch(() => { throw new ValidationError('Expected a JSON body.'); }));

  // Only the web app's own origin may call the API with credentials (matters when they're on different subdomains).
  app.use('*', cors({ origin: d.cfg.WEB_ORIGIN, credentials: true, exposeHeaders: [REQUEST_ID_HEADER, ...Object.values(HEARD_HEADERS)], allowHeaders: ['content-type', OPERATION_HEADER, REQUEST_ID_HEADER, CALL_PASS_HEADER, ...Object.values(AUDIO_HEADERS), ...Object.values(FRAME_HEADERS)], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'], maxAge: 600 }));

  /* State changes only from the app itself: its Origin, and a JSON or audio body. This blocks blind
     cross-site POSTs from sibling ports/subdomains that SameSite=Strict still allows. */
  // Pieces of a file (4 MiB) are the largest bodies; call commits and chat have their own, tighter caps below. A document's updates can be as big as a document, and are capped where they arrive.
  const anyBody = capped(MEDIA_PIECE_BYTES);
  app.use('/v1/*', (c, next) => (DOC_UPDATES.test(c.req.path) ? next() : anyBody(c, next)));
  app.use('/v1/*', async (c, next) => {
    if (!MUTATING.has(c.req.method)) return next();
    const origin = c.req.header('origin');
    if (origin !== d.cfg.WEB_ORIGIN) throw new ForbiddenError('Requests must come from the Alcove app.', { context: { origin: origin ?? 'none' } });
    const type = (c.req.header('content-type') ?? '').toLowerCase();
    const hasBody = c.req.header('content-length') !== '0' && c.req.header('content-length') !== undefined;
    const image = type.startsWith('image/jpeg') && (FRAMES.test(c.req.path) || MEDIA_PREVIEW.test(c.req.path));
    const update = type.startsWith(DOC_UPDATE_TYPE) && DOC_UPDATES.test(c.req.path);
    const fileBytes = type.startsWith('application/octet-stream') && MEDIA_PIECES.test(c.req.path);
    if (hasBody && !type.startsWith('application/json') && !type.startsWith('audio/') && !image && !update && !fileBytes) throw new ValidationError('Unsupported content type.', { context: { contentType: type.slice(0, 60) } });
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
    c.set('refusedAt', err.level);
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
  /*
   * What carries over into a call: its series as someone signed in sees it. It comes from their own notes, so it needs
   * their session, whatever pass they hold: a guest has no account, and nothing to carry over.
   */
  const signedIn = async (c: Context): Promise<Owner> => {
    const o = await optionalOwner(c);
    if (!o) throw new AuthError('Sign in to see what carries over from earlier calls.');
    return o;
  };
  app.get('/v1/calls/:code/series', async (c) => {
    const o = await signedIn(c);
    carryLimiter(o.ownerId, 'carry-over');
    const seriesId = await calls.seriesOf(d, c.req.param('code'));
    return c.json(seriesId ? await series.read(o, seriesId) : null);
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
    let session: Promise<Owner | undefined> | undefined;
    c.set('viewer', await calls.viewerOf(d, pass, () => { session ??= optionalOwner(c); return session; }));
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
  /*
   * The workspace a call uses, beyond what the call's actions do: what changing it would mean, for the organizer to decide,
   * and the call's follow-ups, which read documents and so aren't part of reading the call.
   */
  app.get('/v1/live/calls/:id/workspace/:workspace', async (c) => {
    const v = organizerOnly(c);
    spaceLimiter(v.pass.person, 'workspace');
    return c.json(await calls.previewWorkspace(v, c.req.param('id'), c.req.param('workspace')));
  });
  /* What opening a saved board would mean, for the menu to ask before anything opens. */
  app.get('/v1/live/calls/:id/boards/:workspace/:document', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'board-check');
    spaceLimiter(v.pass.person, 'workspace');
    return c.json(await calls.boardCheck(v, c.req.param('id'), c.req.param('workspace'), c.req.param('document')));
  });
  app.use('/v1/live/calls/:id/follow-ups', capped(1024));
  app.get('/v1/live/calls/:id/follow-ups', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'follow-ups');
    followUpsLimiter(v.pass.identity, 'follow-ups');
    return c.json(await calls.followUpsIn(v, c.req.param('id')));
  });
  app.post('/v1/live/calls/:id/follow-ups', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'follow-ups');
    followUpLimiter(v.pass.person, 'follow-up');
    return c.json(await calls.tickDocumentFollowUp(v, c.req.param('id'), await body(c, DocFollowUpTickSchema)));
  });
  app.post('/v1/live/calls/:id/actions', async (c) => {
    const a = await body(c, CallActionSchema);
    // A raised hand, an ask for notes, whether others may point at your share, ticking a follow-up, what goes by what you
    // can open in the workspace and a board are anyone's in the call (calls.act says who gets what); keeping the call running
    // is whoever hosts'; the rest is the organizer's.
    if (calls.anyone(a)) calls.requireIn(c.get('viewer'), a.type);
    else if (HOST_ACTIONS.has(a.type)) hostOnly(c);
    else organizerOnly(c);
    // Each ask reaches the organizer, so nobody can keep asking.
    if (a.type === 'request-notes') askNotesLimiter(c.get('viewer').pass.person, 'request-notes');
    if (a.type === 'others-point') othersPointLimiter(c.get('viewer').pass.person, 'others-point');
    if (a.type === 'ring') ringLimiter(c.get('viewer').organizer.ownerId, 'ring');
    if (a.type === 'follow-up' || a.type === 'follow-up-add') followUpLimiter(c.get('viewer').pass.person, 'follow-up');
    if (a.type === 'workspace-ask') askSpaceLimiter(c.get('viewer').pass.person, 'workspace-ask');
    else if (a.type.startsWith('workspace-') || a.type.startsWith('present-') || a.type.startsWith('play-') || a.type.startsWith('board-')) spaceLimiter(c.get('viewer').pass.person, 'workspace');
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
  /* Asking across the calls before this one, during it: from the asker's own notes, so it takes their session as well as their pass. */
  app.post('/v1/live/calls/:id/series/ask', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'ask-earlier');
    const o = await signedIn(c);
    askLimiter(o.ownerId, 'ask-earlier');
    const { question, timeZone } = await body(c, SeriesAskBodySchema);
    return c.json(await calls.askEarlier(v, c.req.param('id'), o, question, timeZone));
  });

  /*
   * The call's shared live notes: they come with the call. This says someone is looking at them, which is what keeps
   * them up to date: a look that finds them due refreshes them and answers once that's done, for everyone in that part
   * of the call, and any other look at the same time answers at once.
   */
  app.post('/v1/live/calls/:id/notes/watch', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'live-notes');
    notesWatchLimiter(v.pass.identity, 'live-notes');
    return c.json({ refreshed: await calls.watchNotes(v, c.req.param('id')) });
  });
  /**
   * Ideas from the call: they come with the call (`board.ideas`). This says someone has its board open, which is what has them
   * looked for: a look that finds it's time reads what was said lately, and answers once that's done, for everyone in that part
   * of the call; any other look answers at once.
   */
  app.post('/v1/live/calls/:id/ideas/watch', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'board-ideas');
    ideasWatchLimiter(v.pass.identity, 'board-ideas');
    return c.json({ found: await calls.watchIdeas(v, c.req.param('id')) });
  });
  app.get('/v1/live/calls/:id/transcript/:line', async (c) => {
    const v = c.get('viewer');
    calls.requireIn(v, 'moment');
    momentLimiter(v.pass.identity, 'moment');
    const line = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).safeParse(c.req.param('line'));
    if (!line.success) throw new ValidationError('That isn’t a moment of this call.');
    return c.json(await calls.moment(v, c.req.param('id'), line.data));
  });
  /* Hear it, during the call: one line's recording, for anyone in it who may hear it (calls.hear says who). */
  app.get('/v1/live/calls/:id/hear/:note/:line', async (c) => {
    const v = c.get('viewer');
    momentLimiter(v.pass.identity, 'hear');
    const ids = z.object({ note: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), line: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).safeParse({ note: c.req.param('note'), line: c.req.param('line') });
    if (!ids.success) throw new ValidationError('That isn’t a moment of this call.');
    const heard = await calls.hear(v, c.req.param('id'), ids.data.note, ids.data.line);
    const mime = heard.audio.mimeType.split(';')[0]?.trim() ?? '';
    return new Response(heard.audio.bytes.slice(), { headers: {
      'content-type': AUDIO_TYPES.has(mime) ? heard.audio.mimeType : 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
      [HEARD_HEADERS.from]: String(heard.from), [HEARD_HEADERS.seconds]: String(heard.seconds)
    } });
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
  app.post('/v1/live/calls/:id/leave', async (c) => {
    const { end, onPurpose } = await body(c, CallLeaveBodySchema);
    return c.json({ ended: await calls.leave(c.get('viewer'), c.req.param('id'), end, onPurpose) });
  });
  app.post('/v1/live/calls/:id/hand-off', async (c) => {
    const v = hostOnly(c);
    await calls.handOff(v, c.req.param('id'), (await body(c, CallHandOffBodySchema)).to);
    return c.json({ left: true });
  });

  /*
   * A workspace, by session or call pass: a guest in a call has only their pass, so what they may reach comes before the
   * sign-in below. All of it reads, or sets something a retry can't do twice, so none of it keeps a receipt: a title
   * changes as it's typed, and a guest has no account to keep one under. modules/workspaceAccess.ts decides everything from here on.
   */
  const credentials = (c: Context): access.Credentials => ({ session: getCookie(c, COOKIE), pass: c.req.header(CALL_PASS_HEADER) });
  const readerOf = async (c: Context): Promise<access.Reader> => {
    const r = await access.readerOf(d, credentials(c));
    addLogContext({ ...(r.account ? { ownerId: r.account.owner.ownerId } : {}), ...(r.seat ? { callId: r.seat.callId } : {}) });
    return r;
  };
  app.use('/v1/workspaces', capped(32 * 1024));
  app.use('/v1/workspaces/:id/items/*', capped(32 * 1024));
  app.use('/v1/workspaces/:id/people/*', capped(32 * 1024));
  app.get('/v1/workspaces/:id', async (c) => c.json(await workspaces.tree(d, await readerOf(c), c.req.param('id'))));
  /* Down: every line a reader may see of the tree, until they can't open it any more. Nothing is written before that's known. */
  app.get('/v1/workspaces/:id/live', async (c) => {
    const r = await readerOf(c);
    liveLimiter(access.limitKey(r), 'workspace stream');
    const run = await workspaces.open(d, credentials(c), r, c.req.param('id'), clientAddress(c));
    c.header('content-type', 'application/x-ndjson');
    c.header('cache-control', 'no-store');
    return stream(c, run);
  });
  /* Where someone is in the workspace, for whoever may know. A guest in a call is here too, in what they've been given. */
  app.use('/v1/workspaces/:id/presence', capped(1024));
  app.post('/v1/workspaces/:id/presence', async (c) => {
    const r = await readerOf(c);
    presenceLimiter(access.limitKey(r), 'presence');
    await workspaces.present(d, r, c.req.param('id'), await body(c, PresenceBodySchema));
    return c.json({ said: true });
  });
  /*
   * Tags: someone told they were tagged, and saying you've heard. No receipts: a retry tells them twice at worst, and a
   * receipt filed under someone in a workspace outlives whatever it was about.
   */
  app.use('/v1/workspaces/:id/documents/:doc/mentions', capped(1024));
  app.post('/v1/workspaces/:id/documents/:doc/mentions', async (c) => {
    const r = await readerOf(c);
    mentionLimiter(access.limitKey(r), 'tagging people');
    await mentions.mention(d, r, c.req.param('id'), c.req.param('doc'), await body(c, MentionBodySchema));
    return c.json({ said: true });
  });
  /* The IDs documents know people by: keyed here, so one in a document says nothing about anyone's address. */
  app.use('/v1/workspaces/:id/ids', capped(64 * 1024));
  app.post('/v1/workspaces/:id/ids', async (c) => {
    const r = await readerOf(c);
    idsLimiter(access.limitKey(r), 'people’s IDs');
    return c.json({ ids: await workspaces.idsOf(d, r, c.req.param('id'), (await body(c, PersonIdsBodySchema)).emails) });
  });
  app.delete('/v1/workspaces/:id/mentions/:mention', async (c) => {
    const r = await readerOf(c);
    mentionLimiter(access.limitKey(r), 'tagging people');
    await mentions.seen(d, r, c.req.param('id'), c.req.param('mention'));
    return c.json({ seen: true });
  });
  /*
   * A document or board: its stream down, its updates and carets up, and its versions. An update that arrives twice changes
   * nothing, and a receipt would hold a copy of it, so none of this keeps one.
   */
  /** What's over a document's own limit is too much, which a browser tells from what can never be. */
  const cappedContent = (maxSize: number) => bodyLimit({ maxSize, onError: () => { throw new TooLargeError('That’s more than a document can hold.', { context: { maxSize } }); } });
  app.use('/v1/workspaces/:id/documents/:doc/updates', cappedContent(MAX_DOC_UPDATE_BYTES));
  app.use('/v1/workspaces/:id/documents/:doc/adopt', cappedContent(MAX_DOC_BYTES));
  app.use('/v1/workspaces/:id/documents/:doc/awareness', capped(Math.ceil((MAX_DOC_AWARENESS_BYTES * 4) / 3) + 1024));
  app.get('/v1/workspaces/:id/documents/:doc/live', async (c) => {
    const r = await readerOf(c);
    documentLiveLimiter(access.limitKey(r), 'document stream');
    const after = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).safeParse(c.req.query('after') ?? '0');
    if (!after.success) throw new ValidationError('Ask from a place in the document.');
    const run = await workspaceDocuments.open(d, credentials(c), r, c.req.param('id'), c.req.param('doc'), after.data, clientAddress(c));
    c.header('content-type', 'application/x-ndjson');
    c.header('cache-control', 'no-store');
    return stream(c, run);
  });
  app.post('/v1/workspaces/:id/documents/:doc/updates', async (c) => {
    const r = await readerOf(c);
    updateLimiter(access.limitKey(r), 'document update');
    const length = Number(c.req.header('content-length') ?? MAX_DOC_UPDATE_BYTES);
    updateBytesLimiter(access.limitKey(r), 'document update bytes', Math.ceil(length / 1024) || 1);
    return c.json(await workspaceDocuments.appendUpdate(d, r, c.req.param('id'), c.req.param('doc'), length, () => c.req.arrayBuffer()));
  });
  app.post('/v1/workspaces/:id/documents/:doc/awareness', async (c) => {
    const r = await readerOf(c);
    awarenessLimiter(access.limitKey(r), 'document awareness');
    await workspaceDocuments.awareness(d, r, c.req.param('id'), c.req.param('doc'), unb64u((await body(c, DocAwarenessBodySchema)).update));
    return c.json({ said: true });
  });
  app.get('/v1/workspaces/:id/documents/:doc/versions', async (c) => {
    const r = await readerOf(c);
    versionLimiter(access.limitKey(r), 'document versions');
    return c.json(await workspaceDocuments.versions(d, r, c.req.param('id'), c.req.param('doc')));
  });
  app.get('/v1/workspaces/:id/documents/:doc/versions/:version', async (c) => {
    const r = await readerOf(c);
    versionLimiter(access.limitKey(r), 'document version');
    const run = await workspaceDocuments.version(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('version'), clientAddress(c));
    c.header('content-type', 'application/x-ndjson');
    c.header('cache-control', 'no-store');
    return stream(c, run);
  });
  app.post('/v1/workspaces/:id/documents/:doc/versions/:version/restore', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await workspaceDocuments.restoreVersion(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('version'));
    return c.json({ restored: true });
  });
  /* What someone keeps beside a document for presenting it, under their own account. */
  app.use('/v1/workspaces/:id/documents/:doc/presenter-notes', capped(128 * 1024));
  app.get('/v1/workspaces/:id/documents/:doc/presenter-notes', async (c) => c.json(await presenterNotes.read(d, await readerOf(c), c.req.param('id'), c.req.param('doc'))));
  app.post('/v1/workspaces/:id/documents/:doc/presenter-notes', async (c) => {
    const r = await readerOf(c);
    presenterLimiter(access.limitKey(r), 'presenter notes');
    await presenterNotes.write(d, r, c.req.param('id'), c.req.param('doc'), (await body(c, PresenterNotesBodySchema)).text);
    return c.json({ kept: true });
  });
  /* And beside each frame of a board, by frame: the frame goes in the body, never the path. */
  app.use('/v1/workspaces/:id/documents/:doc/presenter-notes/frames', capped(32 * 1024));
  app.get('/v1/workspaces/:id/documents/:doc/presenter-notes/frames', async (c) => c.json(await presenterNotes.readFrames(d, await readerOf(c), c.req.param('id'), c.req.param('doc'))));
  app.post('/v1/workspaces/:id/documents/:doc/presenter-notes/frames', async (c) => {
    const r = await readerOf(c);
    presenterLimiter(access.limitKey(r), 'presenter notes');
    const { frame, text } = await body(c, PresenterFrameNoteBodySchema);
    await presenterNotes.writeFrame(d, r, c.req.param('id'), c.req.param('doc'), frame, text);
    return c.json({ kept: true });
  });
  /* Asking Alcove about what's selected: what goes to the notes model isn't kept, here or anywhere, and it answers only someone who can edit. */
  app.use('/v1/workspaces/:id/documents/:doc/ask', capped(64 * 1024));
  app.post('/v1/workspaces/:id/documents/:doc/ask', async (c) => {
    const r = await readerOf(c);
    askLimiter(access.limitKey(r), 'ask-selection');
    return c.json(await workspaceDocuments.askAlcove(d, r, c.req.param('id'), c.req.param('doc'), await body(c, DocAskBodySchema)));
  });
  /* Sorting a board's stickies into themes: what goes to the notes model isn't kept, here or anywhere, and it answers only someone who can edit. */
  app.use('/v1/workspaces/:id/documents/:doc/sort', capped(64 * 1024));
  app.post('/v1/workspaces/:id/documents/:doc/sort', async (c) => {
    const r = await readerOf(c);
    sortLimiter(access.limitKey(r), 'board-sort');
    return c.json(await workspaceDocuments.sortStickies(d, r, c.req.param('id'), c.req.param('doc'), await body(c, BoardSortBodySchema)));
  });
  /* The words of everything a reader can open: for searching in the browser, one document a line. */
  app.get('/v1/workspaces/:id/search', async (c) => {
    const r = await readerOf(c);
    searchLimiter(access.limitKey(r), 'workspace search');
    const run = await workspaceDocuments.searchText(d, r, c.req.param('id'), clientAddress(c));
    c.header('content-type', 'application/x-ndjson');
    c.header('cache-control', 'no-store');
    return stream(c, run);
  });
  app.get('/v1/workspaces/:id/items/:item', async (c) => c.json(await workspaces.item(d, await readerOf(c), c.req.param('id'), c.req.param('item'))));
  app.patch('/v1/workspaces/:id/items/:item', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await workspaces.renameItem(d, r, c.req.param('id'), c.req.param('item'), (await body(c, ItemRenameSchema)).name);
    return c.json({ renamed: true });
  });
  app.post('/v1/workspaces/:id/items/:item/restore', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await workspaces.restoreItem(d, r, c.req.param('id'), c.req.param('item'));
    return c.json({ restored: true });
  });
  /*
   * Files in a workspace's documents, by session or call pass like the rest of it: a guest can read what's in a document
   * given to their seat, and add to one they can edit. Each route asks who can before it looks at what it was sent.
   * modules/media.ts does the rest.
   */
  app.use('/v1/workspaces/:id/documents/:doc/media', capped(32 * 1024));
  app.use('/v1/workspaces/:id/documents/:doc/media/:media/finish', capped(32 * 1024));
  app.use('/v1/workspaces/:id/documents/:doc/media/:media/attach', capped(32 * 1024));
  app.get('/v1/workspaces/:id/media', async (c) => c.json(await media.list(d, await readerOf(c), c.req.param('id'))));
  app.post('/v1/workspaces/:id/documents/:doc/media', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await media.mayAdd(d, r, c.req.param('id'), c.req.param('doc'));
    return c.json(await media.begin(d, r, c.req.param('id'), c.req.param('doc'), await body(c, MediaInputSchema)));
  });
  app.post('/v1/workspaces/:id/documents/:doc/media/:media/pieces/:seq', async (c) => {
    const r = await readerOf(c);
    pieceLimiter(access.limitKey(r), 'media piece');
    const sent = { declared: Number(c.req.header('content-length') ?? 0), body: () => c.req.raw.body };
    await media.storePiece(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'), c.req.param('seq'), sent);
    return c.json({ stored: true });
  });
  app.post('/v1/workspaces/:id/documents/:doc/media/:media/finish', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    return c.json(await media.finish(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media')));
  });
  app.post('/v1/workspaces/:id/documents/:doc/media/:media/attach', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await media.attach(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'));
    return c.json({ attached: true });
  });
  app.delete('/v1/workspaces/:id/documents/:doc/media/:media', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await media.remove(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'));
    return c.json({ removed: true });
  });
  /* A picture's preview, for a picker: kept once by whoever can edit, and read by whoever can read the picture. None is 204. */
  app.use('/v1/workspaces/:id/documents/:doc/media/:media/preview', capped(MAX_MEDIA_PREVIEW_BYTES));
  app.post('/v1/workspaces/:id/documents/:doc/media/:media/preview', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    // Who can, before what was sent: someone who can't edit the document hears what they'd hear for one that isn't there.
    await media.mayAdd(d, r, c.req.param('id'), c.req.param('doc'));
    if ((c.req.header('content-type') ?? '').toLowerCase().split(';')[0]?.trim() !== 'image/jpeg') throw new ValidationError('A preview must be a JPEG image.');
    await media.storePreview(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'), new Uint8Array(await c.req.arrayBuffer()));
    return c.json({ kept: true });
  });
  app.get('/v1/workspaces/:id/documents/:doc/media/:media/preview', async (c) => {
    const r = await readerOf(c);
    mediaLimiter(media.askerOf(r), 'media');
    const jpeg = await media.preview(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'));
    if (!jpeg) return c.body(null, 204, { 'cache-control': 'no-store' });
    return new Response(jpeg.slice(), { headers: { 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'" } });
  });
  app.get('/v1/workspaces/:id/documents/:doc/media/:media/token', async (c) => {
    const r = await readerOf(c);
    mediaLimiter(media.askerOf(r), 'media');
    return c.json({ token: await media.tokenFor(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media')) });
  });
  /* A file's bytes, for an `<img>` or a player: its token says who's asking, its cookie is all a browser sends, and modules/workspaceAccess.ts decides, every time. */
  app.get('/v1/media/:token', async (c) => {
    const { outgoing } = c.env;
    const closed = new AbortController();
    if (outgoing.destroyed) closed.abort();
    else outgoing.once('close', () => { closed.abort(); });
    return media.serve(d, media.tokenIn(d, c.req.param('token')), {
      session: getCookie(c, COOKIE), range: c.req.header('range'), head: c.req.method === 'HEAD',
      count: (who) => mediaLimiter(who, 'media'),
      closed: closed.signal,
      cut: () => { outgoing.destroy(); }
    });
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
      const text = c.get('receipt') ?? await c.res.clone().text();
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
  /**
   * A call as the answer to a change. Its receipt keeps it without its documents: a retry can come after one has been
   * deleted or the account has lost it, and a receipt filed under someone in a workspace can't hold a name.
   */
  const changedCall = (c: Context<Env>, m: Meeting) => { c.set('receipt', JSON.stringify({ ...m, documents: [] })); return c.json(m); };
  app.get('/v1/meetings', async (c) => c.json(c.req.query('range') === 'past' ? await meetings.past(c.get('owner')) : await meetings.upcoming(c.get('owner'))));
  app.get('/v1/meetings/:id', async (c) => c.json(await meetings.get(c.get('owner'), c.req.param('id'))));
  app.post('/v1/meetings', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    return changedCall(c, await meetings.create(c.get('owner'), await body(c, MeetingInputSchema)));
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
    // Checking what's brought reads the library.
    if (patch.documents?.length) workspaceListLimiter(c.get('owner').ownerId, 'documents');
    return changedCall(c, await meetings.update(c.get('owner'), c.req.param('id'), patch, scopeOf(c)));
  });
  app.delete('/v1/meetings/:id', async (c) => { await meetings.cancel(c.get('owner'), c.req.param('id'), scopeOf(c)); return c.json({ cancelled: true }); });
  app.post('/v1/meetings/:id/next', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    return changedCall(c, await meetings.scheduleNext(c.get('owner'), c.req.param('id'), (await body(c, NextCallBodySchema)).startsAt));
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
    return changedCall(c, await meetings.adopt(c.get('owner'), c.req.param('id'), notes));
  });
  app.get('/v1/calls/:code/meeting', async (c) => c.json(await meetings.byCode(c.get('owner'), c.req.param('code'))));

  /* documents people can bring to calls */
  app.get('/v1/documents', async (c) => {
    workspaceListLimiter(c.get('owner').ownerId, 'documents');
    return c.json(await documents.library(c.get('owner')));
  });

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
  /*
   * The first `pieces` of a segment, which stay the same file however much more is recorded. A range is for the
   * browser's own player; all of it, chunked, is for one that can't seek by range and fetches it whole.
   */
  app.get('/v1/notes/:id/audio/:segment', async (c) => {
    const gone = c.req.raw.signal;
    const o = c.get('owner');
    const segment = z.coerce.number().int().min(0).parse(c.req.param('segment'));
    const pieces = z.coerce.number().int().min(1).parse(c.req.query('pieces'));
    const n = await notes.get(o, c.req.param('id'));
    const seg = n.audio.find((a) => a.index === segment);
    if (!seg) throw new NotFoundError('No audio in that part of the recording.');
    const source = await notes.audioSource(o, n.id);
    const file = await audioMod.file(source.owner, source.recordingId, segment, pieces);
    const mime = seg.mimeType.split(';')[0] ?? '';
    const headers = { 'content-type': AUDIO_TYPES.has(mime) ? mime : 'application/octet-stream', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
    if (c.req.method === 'HEAD') return c.body(null, 200, { ...headers, 'content-length': String(file.bytes) });
    const range = byteRange(c.req.header('range'), file.bytes);
    if (range === null) return c.body(null, 416, { ...headers, 'content-range': `bytes */${file.bytes}` });
    if (!range) return c.body(await audioMod.body(file.read(0, file.bytes - 1), gone), 200, headers);
    const { from } = range;
    const to = Math.min(range.to, from + MOST_AUDIO_PER_REPLY - 1);
    return c.body(await audioMod.body(file.read(from, to), gone), 206, { ...headers, 'content-length': String(to - from + 1), 'content-range': `bytes ${from}-${to}/${file.bytes}` });
  });
  /* A note's shared-screen frame, for anyone who has the note: decrypted here, never cached by the browser. */
  app.get('/v1/notes/:id/screens/:frameId', async (c) => {
    const frameId = c.req.param('frameId');
    if (!ID128.test(frameId)) throw new NotFoundError('That frame doesn’t exist.');
    const jpeg = await notes.screenImage(c.get('owner'), c.req.param('id'), frameId);
    return new Response(jpeg.slice(), { headers: { 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'" } });
  });
  /* Confirming what the notes say, and adding to it: as far as the grants let them (packages/api/src/grants.ts), and everyone sees who did. */
  const changing = (c: Context<Env>) => { const o = c.get('owner'); noteChangeLimiter(o.ownerId, 'note-change'); return o; };
  app.post('/v1/notes/:id/decisions', async (c) => c.json(await notes.proposeDecision(changing(c), c.req.param('id'), await body(c, DecisionProposalSchema))));
  app.post('/v1/notes/:id/actions', async (c) => c.json(await notes.proposeAction(changing(c), c.req.param('id'), await body(c, ActionProposalSchema))));
  app.patch('/v1/notes/:id/decisions/:decisionId', async (c) => c.json(await notes.updateDecision(changing(c), c.req.param('id'), c.req.param('decisionId'), await body(c, DecisionPatchSchema))));
  app.patch('/v1/notes/:id/actions/:actionId', async (c) => c.json(await notes.updateAction(changing(c), c.req.param('id'), c.req.param('actionId'), await body(c, ActionPatchSchema))));
  app.patch('/v1/notes/:id/questions/:questionId', async (c) => c.json(await notes.updateQuestion(changing(c), c.req.param('id'), c.req.param('questionId'), await body(c, QuestionPatchSchema))));
  app.patch('/v1/notes/:id/lines/:lineId', async (c) => c.json(await notes.correctLine(changing(c), c.req.param('id'), c.req.param('lineId'), await body(c, LinePatchSchema))));
  app.patch('/v1/notes/:id/revisits/:revisitId', async (c) => c.json(await notes.updateRevisit(changing(c), c.req.param('id'), c.req.param('revisitId'), await body(c, RevisitPatchSchema))));
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

  /*
   * workspaces: what's for people in one. Every answer here is an ID or a yes, so the receipts they keep (a retry mustn't
   * make a second workspace, item or copy) hold nothing readable, however long they outlive what they were about.
   */
  const member = async (c: Context<Env>, pass?: string | undefined): Promise<access.Reader> => {
    const o = c.get('owner');
    treeLimiter(o.ownerId, 'workspace change');
    return access.accountReader(o, pass);
  };
  const ws = (c: Context<Env>) => c.req.param('id') ?? '';
  const itemOf = (c: Context<Env>) => c.req.param('item') ?? '';
  app.get('/v1/mentions', async (c) => {
    workspaceListLimiter(c.get('owner').ownerId, 'reading your tags');
    return c.json(await mentions.notices(d, await access.accountReader(c.get('owner'))));
  });
  app.get('/v1/workspaces', async (c) => {
    workspaceListLimiter(c.get('owner').ownerId, 'workspace list');
    return c.json(await workspaces.list(await access.accountReader(c.get('owner'))));
  });
  app.post('/v1/workspaces', async (c) => {
    workspaceLimiter(c.get('owner').ownerId, 'workspace');
    return c.json(await workspaces.create(c.get('owner'), (await body(c, WorkspaceInputSchema)).name));
  });
  app.patch('/v1/workspaces/:id', async (c) => { await workspaces.rename(d, await member(c), ws(c), (await body(c, WorkspaceInputSchema)).name); return c.json({ renamed: true }); });
  app.delete('/v1/workspaces/:id', async (c) => { await workspaces.remove(d, await member(c), ws(c)); return c.json({ deleted: true }); });
  app.get('/v1/workspaces/:id/people', async (c) => c.json(await workspaces.people(d, await access.accountReader(c.get('owner')), ws(c))));
  app.post('/v1/workspaces/:id/people', async (c) => {
    const { email, role } = await body(c, WorkspacePersonInputSchema);
    return c.json(await workspaces.addPerson(d, await member(c), ws(c), email, role));
  });
  app.patch('/v1/workspaces/:id/people/:person', async (c) => { await workspaces.setRole(d, await member(c), ws(c), c.req.param('person'), (await body(c, WorkspaceRolePatchSchema)).role); return c.json({ changed: true }); });
  app.delete('/v1/workspaces/:id/people/:person', async (c) => { await workspaces.removePerson(d, await member(c), ws(c), c.req.param('person')); return c.json({ removed: true }); });
  app.post('/v1/workspaces/:id/items', async (c) => c.json(await workspaces.createItem(d, await member(c), ws(c), await body(c, ItemInputSchema))));
  /*
   * Words that couldn't reach the document they were written in, as a new one's first state: the other half of making that new
   * document, so it takes an account as making it does. A call's pass doesn't reach it.
   */
  app.post('/v1/workspaces/:id/documents/:doc/adopt', async (c) => {
    const r = await member(c);
    const length = Number(c.req.header('content-length') ?? MAX_DOC_BYTES);
    updateBytesLimiter(access.limitKey(r), 'document update bytes', Math.ceil(length / 1024) || 1);
    return c.json(await workspaceDocuments.adoptState(d, r, c.req.param('id'), c.req.param('doc'), length, () => c.req.arrayBuffer()));
  });
  app.post('/v1/workspaces/:id/items/:item/move', async (c) => { await workspaces.moveItem(d, await member(c), ws(c), itemOf(c), await body(c, ItemPlaceSchema)); return c.json({ moved: true }); });
  app.post('/v1/workspaces/:id/items/:item/duplicate', async (c) => c.json(await workspaces.duplicateItem(d, await member(c), ws(c), itemOf(c))));
  app.post('/v1/workspaces/:id/items/:item/trash', async (c) => { await workspaces.trashItem(d, await member(c), ws(c), itemOf(c)); return c.json({ trashed: true }); });
  app.delete('/v1/workspaces/:id/items/:item', async (c) => { await workspaces.deleteItem(d, await member(c), ws(c), itemOf(c)); return c.json({ deleted: true }); });
  app.get('/v1/workspaces/:id/items/:item/share', async (c) => c.json(await workspaces.shareList(d, await access.accountReader(c.get('owner'), c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c))));
  app.post('/v1/workspaces/:id/items/:item/share', async (c) => {
    const { to, role } = await body(c, ShareBodySchema);
    // A seat is someone in the sharer's own call, so sharing with one comes with their pass.
    await workspaces.share(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c), to, role);
    return c.json({ shared: true });
  });
  // From a call, with its pass, a change to who has something is told to that call at once.
  app.delete('/v1/workspaces/:id/items/:item/share/:entry', async (c) => { await workspaces.unshare(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c), c.req.param('entry')); return c.json({ removed: true }); });
  app.post('/v1/workspaces/:id/items/:item/restrict', async (c) => { await workspaces.restrict(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c), (await body(c, RestrictBodySchema)).restricted); return c.json({ changed: true }); });

  /* credits */
  app.get('/v1/credits', async (c) => c.json(await billing.balance(d, c.get('owner').ownerId)));

  return app;
}

/** A position header: a whole number that fits the integer columns it's stored in. */
const position = (c: Context, name: string) => z.coerce.number().int().min(0).max(2_147_483_647).parse(c.req.header(name));

/**
 * What a Range header asks for in `size` bytes: one stretch, `null` if it starts past the end, or `undefined` for the
 * whole file, which is the answer to no header and to one this doesn't take, such as several ranges.
 */
function byteRange(header: string | undefined, size: number): { from: number; to: number } | null | undefined {
  const asked = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!asked) return undefined;
  const [, first = '', last = ''] = asked;
  if (!first && !last) return undefined;
  if (!first) return Number(last) > 0 && size > 0 ? { from: Math.max(0, size - Number(last)), to: size - 1 } : null;
  const from = Number(first);
  if (from >= size) return null;
  const to = last ? Math.min(Number(last), size - 1) : size - 1;
  return to >= from ? { from, to } : undefined;
}

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
