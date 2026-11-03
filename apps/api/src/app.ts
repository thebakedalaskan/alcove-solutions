import {
  AddPasskeyFinishBodySchema, AUDIO_HEADERS, CallActionSchema, MAX_AUDIO_PIECE_BYTES, MeetingInputSchema, MeetingNotesSettingSchema, NoteKindSchema,
  NotesAudienceSchema, NotesModeSchema, OPERATION_HEADER, PreferencesSchema, RecordingActionSchema, RegisterFinishBodySchema, RegisterStartBodySchema,
  StepUpFinishBodySchema, UnlockFinishBodySchema, isAlcoveErrorCode
} from '@alcove/api';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { z, ZodError } from 'zod';
import type { Deps, Owner } from './context';
import { equalBytes, fromUtf8, mac, operationCommitKey, operationResultKey, openJson, sealJson, utf8 } from './crypto';
import { bytea, exec, maybeOne } from './db';
import { ApiError } from './errors';
import { inference } from './inference';
import { ABSOLUTE_MS, cookieName } from './sessions';
import * as account from './modules/account';
import * as audioMod from './modules/audio';
import * as billing from './modules/billing';
import * as calls from './modules/calls';
import * as meetings from './modules/meetings';
import * as notes from './modules/notes';
import * as recordings from './modules/recordings';
import * as stats from './modules/stats';

type Env = { Variables: { owner: Owner } };
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/** POSTs that read rather than change state, so they don't need a stored receipt. */
const NO_RECEIPT = new Set(['/v1/notes/search']);
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);

/** A small fixed-window limiter for unauthenticated ceremony starts, keyed by client address. */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (c: Context) => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'direct';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.until < now) { hits.set(key, { n: 1, until: now + windowMs }); if (hits.size > 50_000) hits.clear(); return; }
    if (++h.n > max) throw new ApiError('unavailable', 'Too many attempts. Wait a minute and try again.');
  };
}
const StoredResult = z.object({ status: z.number(), body: z.string() });

export function createApp(d: Deps) {
  const app = new Hono<Env>();
  const secure = d.cfg.WEB_ORIGIN.startsWith('https://');
  const COOKIE = cookieName(secure);
  const startSession = (c: Context, o: Owner) => setCookie(c, COOKIE, o.session.id, { httpOnly: true, sameSite: 'Strict', path: '/', secure, maxAge: ABSOLUTE_MS / 1000 });
  const limiter = rateLimit(30, 60_000);
  const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => schema.parse(await c.req.json().catch(() => { throw new ApiError('invalid', 'Expected a JSON body.'); }));

  // Only the web app's own origin may call the API with credentials (matters when they're on different subdomains).
  app.use('*', cors({ origin: d.cfg.WEB_ORIGIN, credentials: true, allowHeaders: ['content-type', OPERATION_HEADER, ...Object.values(AUDIO_HEADERS)], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'], maxAge: 600 }));

  /* State changes only from the app itself: its Origin, and a JSON or audio body. This blocks blind
     cross-site POSTs from sibling ports/subdomains that SameSite=Strict still allows. */
  app.use('/v1/*', async (c, next) => {
    if (!MUTATING.has(c.req.method)) return next();
    const origin = c.req.header('origin');
    if (origin !== d.cfg.WEB_ORIGIN) throw new ApiError('forbidden', 'Requests must come from the Alcove app.');
    const type = (c.req.header('content-type') ?? '').toLowerCase();
    const hasBody = c.req.header('content-length') !== '0' && c.req.header('content-length') !== undefined;
    if (hasBody && !type.startsWith('application/json') && !type.startsWith('audio/')) throw new ApiError('invalid', 'Unsupported content type.');
    return next();
  });

  app.onError((e, c) => {
    if (e instanceof ApiError) return c.json({ code: e.code, message: e.message }, e.status);
    if (e instanceof ZodError) {
      const issues = e.issues.map((i) => `${i.path.join('.')}: ${i.code}`);
      // Field names and issue codes only, never values: enough to see why a passkey manager's response was refused.
      if (c.req.path.startsWith('/v1/auth') || c.req.path.startsWith('/v1/passkeys')) console.warn(`rejected ${c.req.method} ${c.req.path}:`, issues.join('; '));
      return c.json({ code: 'invalid', message: 'Some of that input isn’t valid.', issues }, 400);
    }
    console.error(e);
    return c.json({ code: 'unknown', message: 'Something went wrong on our side.' }, 500);
  });

  app.get('/healthz', async (c) => {
    await exec(d.pool, 'SELECT 1');
    return c.json({ ok: true, inference: inference(d.cfg).configured ? 'configured' : 'missing' });
  });

  /* ---------- public: session and passkey ceremonies ---------- */
  app.get('/v1/session', async (c) => {
    const s = d.sessions.touch(getCookie(c, COOKIE));
    return c.json(s ? await account.sessionFor(account.ownerOf(d, s)) : null);
  });
  app.post('/v1/auth/register/start', async (c) => { limiter(c); return c.json(await account.registerStart(d, (await body(c, RegisterStartBodySchema)).name)); });
  app.post('/v1/auth/register/finish', async (c) => {
    const o = await account.registerFinish(d, await body(c, RegisterFinishBodySchema));
    startSession(c, o);
    return c.json(await account.sessionFor(o));
  });
  app.post('/v1/auth/unlock/start', async (c) => { limiter(c); return c.json(await account.unlockStart(d)); });
  app.post('/v1/auth/unlock/finish', async (c) => {
    const o = await account.unlockFinish(d, await body(c, UnlockFinishBodySchema));
    startSession(c, o);
    return c.json(await account.sessionFor(o));
  });

  /* ---------- everything below needs an unlocked owner ---------- */
  app.use('/v1/*', async (c, next) => {
    const cookie = getCookie(c, COOKIE);
    const s = d.sessions.touch(cookie);
    if (!s) {
      if (cookie) deleteCookie(c, COOKIE, { path: '/' });
      throw cookie ? new ApiError('locked', 'Your session ended. Unlock with your passkey to continue.') : new ApiError('unauthenticated', 'Unlock Alcove with your passkey first.');
    }
    c.set('owner', account.ownerOf(d, s));
    await next();
  });

  /* Mutations are idempotent by operation ID (docs: Network and API contract). */
  app.use('/v1/*', async (c, next) => {
    const opId = c.req.header(OPERATION_HEADER);
    if (!opId || !MUTATING.has(c.req.method) || NO_RECEIPT.has(c.req.path)) return next();
    if (!/^[A-Za-z0-9_-]{22}$/.test(opId)) throw new ApiError('invalid', 'Malformed operation ID.');
    const o = c.get('owner');
    const reqBytes = new Uint8Array(await c.req.raw.clone().arrayBuffer());
    const commitment = mac(operationCommitKey(o.root, o.ownerId), new Uint8Array([...utf8(`${c.req.method} ${c.req.path}\n`), ...reqBytes]));
    const hdr = { v: 1 as const, kind: 'operation-result', ownerId: o.ownerId, operationId: opId };
    const prior = await maybeOne(d.pool, z.object({ request_commitment: bytea, result_ciphertext: bytea }), 'SELECT request_commitment, result_ciphertext FROM operations WHERE owner_id = $1 AND operation_id = $2', [o.ownerId, opId]);
    if (prior) {
      if (!equalBytes(prior.request_commitment, commitment)) throw new ApiError('conflict', 'That operation ID was already used for a different request.');
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

  app.post('/v1/session/lock', (c) => {
    d.sessions.close(c.get('owner').session.id);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ locked: true });
  });

  /* account */
  app.get('/v1/account/preferences', async (c) => c.json(await account.preferences(c.get('owner'))));
  app.patch('/v1/account/preferences', async (c) => c.json((await account.updateProfile(c.get('owner'), { preferences: await body(c, PreferencesSchema.partial()) })).preferences));
  app.post('/v1/account/name', async (c) => {
    const o = c.get('owner');
    await account.updateProfile(o, { name: (await body(c, z.object({ name: z.string().trim().min(1).max(80) }))).name });
    return c.json(await account.sessionFor(o));
  });
  app.get('/v1/account/setup', async (c) => c.json(await account.setupSteps(c.get('owner'))));
  app.get('/v1/passkeys', async (c) => c.json(await account.passkeys(c.get('owner'))));
  app.post('/v1/passkeys/verify/start', async (c) => c.json(await account.stepUpStart(c.get('owner'))));
  app.post('/v1/passkeys/verify/finish', async (c) => { await account.stepUpFinish(c.get('owner'), await body(c, StepUpFinishBodySchema)); return c.json({ verified: true }); });
  app.post('/v1/passkeys/start', async (c) => c.json(await account.addPasskeyStart(c.get('owner'))));
  app.delete('/v1/passkeys/:id', async (c) => { await account.removePasskey(c.get('owner'), c.req.param('id')); return c.json({ removed: true }); });
  app.post('/v1/passkeys/finish', async (c) => c.json(await account.addPasskeyFinish(c.get('owner'), await body(c, AddPasskeyFinishBodySchema))));

  /* meetings */
  app.get('/v1/meetings', async (c) => c.json(c.req.query('range') === 'past' ? await meetings.past(c.get('owner')) : await meetings.upcoming(c.get('owner'))));
  app.get('/v1/meetings/:id', async (c) => c.json(await meetings.get(c.get('owner'), c.req.param('id'))));
  app.post('/v1/meetings', async (c) => c.json(await meetings.create(c.get('owner'), await body(c, MeetingInputSchema))));
  app.patch('/v1/meetings/:id', async (c) => c.json(await meetings.update(c.get('owner'), c.req.param('id'), await body(c, MeetingInputSchema.partial()))));
  app.delete('/v1/meetings/:id', async (c) => { await meetings.cancel(c.get('owner'), c.req.param('id')); return c.json({ cancelled: true }); });
  app.get('/v1/calls/:code/meeting', async (c) => c.json(await meetings.byCode(c.get('owner'), c.req.param('code'))));
  app.post('/v1/links', async (c) => c.json(await meetings.createLink(c.get('owner'), (await body(c, z.object({ notes: MeetingNotesSettingSchema }))).notes)));

  /* calls */
  app.post('/v1/calls', async (c) => c.json(await meetings.startNow(c.get('owner'))));
  app.post('/v1/calls/:code/join', async (c) => c.json(await calls.join(c.get('owner'), c.req.param('code'),
    await body(c, z.object({ mic: z.boolean(), cam: z.boolean(), notes: NotesModeSchema.optional(), audience: NotesAudienceSchema.optional() })))));
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
    if (!seg) throw new ApiError('not-found', 'No audio in that part of the recording.');
    const recordingId = await notes.recordingOf(o, n.id);
    const mime = seg.mimeType.split(';')[0] ?? '';
    c.header('content-type', AUDIO_TYPES.has(mime) ? mime : 'application/octet-stream');
    c.header('x-content-type-options', 'nosniff');
    c.header('cache-control', 'no-store');
    return stream(c, async (s) => { for await (const chunk of audioMod.stream(o, recordingId, segment)) await s.write(chunk); });
  });
  app.patch('/v1/notes/:id/actions/:actionId', async (c) => {
    await notes.setActionDone(c.get('owner'), c.req.param('id'), c.req.param('actionId'), (await body(c, z.object({ done: z.boolean() }))).done);
    return c.json({ ok: true });
  });
  app.post('/v1/notes/:id/ask', () => { throw new ApiError('unavailable', 'Asking about notes needs the notes service, which isn’t connected yet.'); });
  app.delete('/v1/notes/:id', async (c) => { await notes.remove(c.get('owner'), c.req.param('id')); return c.json({ deleted: true }); });

  /* credits and stats */
  app.get('/v1/credits', async (c) => c.json(await billing.balance(d, c.get('owner').ownerId)));
  app.get('/v1/credits/history', async (c) => c.json(await billing.history(d, c.get('owner').ownerId)));
  app.get('/v1/credits/packs', (c) => c.json(billing.PACKS));
  app.post('/v1/credits/purchases', () => { throw new ApiError('unavailable', 'Buying credits needs payments, which aren’t connected yet.'); });
  app.get('/v1/stats/week', async (c) => c.json(await stats.week(c.get('owner'))));

  return app;
}

/** Reads a raw audio piece and its position headers. */
async function piece(c: Context): Promise<audioMod.Piece> {
  const num = (name: string) => z.coerce.number().int().min(0).parse(c.req.header(name));
  const mimeType = c.req.header('content-type') ?? '';
  if (!/^audio\/(webm|mp4|ogg)/.test(mimeType)) throw new ApiError('invalid', 'Audio must be WebM, MP4 or Ogg.');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_PIECE_BYTES) throw new ApiError('invalid', 'That piece of audio is empty or too large.');
  return { segment: num(AUDIO_HEADERS.segment), seq: num(AUDIO_HEADERS.seq), durationMs: num(AUDIO_HEADERS.duration), mimeType, bytes };
}
export { fromUtf8, isAlcoveErrorCode };
