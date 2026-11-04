/*
 * NEAR AI Cloud (I01): speech to text for the live transcript, and the model that writes notes,
 * answers questions about them and reads frames of shared screens. This module and evidence.ts are the only code that talks to NEAR AI, and
 * this is the only one that sends it anything with content. Nothing leaves here except sealed to a model
 * whose evidence checked out (evidence.ts):
 *
 *  - every request, speech and chat alike, goes by Oblivious HTTP (ohttp.ts) to the model's own endpoint
 *    (NEAR_AI_STT_URL, NEAR_AI_NOTES_URL), sealed to the OHTTP key the model's attested key signed. The
 *    whole HTTP request is sealed, the API key included, so whatever relays it, NEAR AI's TLS termination
 *    and load balancers included, sees only ciphertext;
 *  - the reply is sealed under the same exchange, so only Alcove can open it, and only whoever opened the
 *    request could have written it.
 *
 * There is no plaintext way, and no setting that turns this off. What passes through is speech and what
 * was said, so log lines carry only models, sizes, durations, counts, statuses, codes and timings.
 */
import type { InferenceEvidence } from '@alcove/api';
import { z } from 'zod';
import type { Config } from './config';
import { equalBytes, fromUtf8, utf8 } from './crypto';
import { AppError, InternalError, UnansweredError, UnavailableError, UnverifiedError, ValidationError } from './errors';
import { fingerprint, forget, unhex, verified, type Task, type Verified } from './evidence';
import { log } from './log';
import { decodeResponse, encapsulate, encodeRequest, type KeyConfig } from './ohttp';

const ilog = log.child({ component: 'inference' });

export interface Inference { configured: boolean; baseUrl: string }
export const inference = (cfg: Config): Inference => ({ configured: !!cfg.NEAR_AI_API_KEY, baseUrl: cfg.NEAR_AI_BASE_URL });

type Ready = Config & { NEAR_AI_API_KEY: string };
const ready = (cfg: Config): cfg is Ready => !!cfg.NEAR_AI_API_KEY;
const notConnected = (what: string) => new UnavailableError('Alcove’s notes service isn’t connected on this server.', { context: { what } });

/** The model didn't open a request sealed to the key it vouched for (it rotated, or another instance answered): verify again and retry once. */
class KeyRefused extends Error {
  constructor(readonly error: AppError) { super(error.message); }
}

/** An answer's status as Alcove's error: what was sent was unreadable, the key was refused, or the service is busy or down. */
function statusError(status: number, context: Record<string, string | number>): AppError {
  if (status === 400 || status === 413 || status === 422) return new ValidationError('The notes service couldn’t read that.', { context });
  if (status === 401 || status === 403) return new InternalError('The notes service turned Alcove away.', { context });
  return new UnansweredError('Alcove’s notes service is busy. Try again in a moment.', { context });
}

/**
 * Sends one request sealed to the model's verified OHTTP key, at its own endpoint, and opens the sealed
 * reply. A request the model can't open, or a connection cut, may mean it holds another key now: KeyRefused.
 */
async function sealed(cfg: Ready, v: Verified, endpoint: string, o: { path: string; type: string; body: Uint8Array; timeoutMs: number; what: string }): Promise<{ status: number; body: Uint8Array }> {
  const url = new URL(endpoint);
  // The API key travels inside the seal: only the model's VM sees it, or anything else in the request.
  const request = encapsulate(v.ohttp, encodeRequest({
    method: 'POST', scheme: 'https', authority: url.host, path: o.path, body: o.body,
    headers: [['content-type', o.type], ['accept', 'application/json'], ['authorization', `Bearer ${cfg.NEAR_AI_API_KEY}`]]
  }));
  const t0 = performance.now();
  try {
    let res: Response;
    try {
      res = await fetch(`${endpoint.replace(/\/$/, '')}/ohttp`, {
        method: 'POST', headers: { 'content-type': 'message/ohttp-req', accept: 'message/ohttp-res' }, body: new Uint8Array(request.wire), signal: AbortSignal.timeout(o.timeoutMs)
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
      const error = new UnansweredError('Alcove’s notes service can’t be reached right now.', { cause: e, context: { what: o.what, timedOut, ms: Math.round(performance.now() - t0) } });
      if (timedOut) throw error;
      throw new KeyRefused(error);
    }
    const context = { what: o.what, status: res.status, ms: Math.round(performance.now() - t0) };
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 400 || res.status === 421 || res.status === 422) throw new KeyRefused(new UnavailableError('The notes service didn’t open what was sealed to the key it vouched for.', { context }));
      throw statusError(res.status, context);
    }
    try {
      return decodeResponse(request.open(new Uint8Array(await res.arrayBuffer())));
    } catch (e) {
      ilog.error('reply refused', { what: o.what, model: v.model, code: 'reply-sealed' });
      throw new UnavailableError('The notes service’s reply couldn’t be opened, so it wasn’t used.', { cause: e, context: { ...context, check: 'reply-sealed' }, level: 'error' });
    }
  } finally {
    request.wipe();
  }
}

/**
 * Runs a request with the model's verification. If the model no longer takes its key, verifies again
 * and, if the key changed, sends the request once more, to the new key.
 */
async function withVerified<T>(cfg: Ready, model: string, task: Task, run: (v: Verified) => Promise<T>): Promise<T> {
  const v = await verified(cfg, model, task);
  try {
    return await run(v);
  } catch (e) {
    // No answer: the next request verifies again, so it may reach a model that answers.
    if (e instanceof UnansweredError) { forget(cfg, v); throw e; }
    if (!(e instanceof KeyRefused)) throw e;
    forget(cfg, v);
    let again: Verified;
    try {
      again = await verified(cfg, model, task);
    } catch (refusal) {
      // The first request went out, sealed; it's the second that doesn't.
      if (refusal instanceof UnverifiedError) {
        throw new UnverifiedError('NEAR AI’s private model changed, and its new evidence didn’t check out, so the request wasn’t sent again. Try again in a moment.', { cause: refusal, context: refusal.context, level: refusal.level });
      }
      throw refusal;
    }
    const changed = again.key !== v.key || !sameKeyConfig(again.ohttp, v.ohttp);
    ilog.info('model key not accepted; verified again', { model, task, changed, keyHash: keyHash(v), nowKeyHash: keyHash(again) });
    if (!changed) throw e.error;
    try { return await run(again); } catch (retry) { throw retry instanceof KeyRefused ? retry.error : retry; }
  }
}
const keyHash = (v: Verified) => fingerprint(unhex(v.key) ?? new Uint8Array(0));
const sameKeyConfig = (a: KeyConfig, b: KeyConfig) => a.keyId === b.keyId && equalBytes(a.publicKey, b.publicKey);
const parsed = (b: Uint8Array): unknown => { try { return JSON.parse(fromUtf8(b)); } catch { return null; } };

/* ---------- speech to text ---------- */

/** One stretch of speech, in seconds from the start of the clip. */
export interface Heard { start: number; end: number; text: string }

const Segment = z.object({
  start: z.number(), end: z.number(), text: z.string(),
  avg_logprob: z.number().nullish(), compression_ratio: z.number().nullish(), no_speech_prob: z.number().nullish()
});
const Transcription = z.object({ text: z.string().default(''), segments: z.array(Segment).nullish() });

/**
 * What Whisper is known to "hear" in silence and noise: closing lines from the videos it was
 * trained on. A clip that is nothing but one of these is dropped, and so is any line that credits
 * subtitlers or is only music marks or bracketed sound descriptions.
 */
const SILENCE = new Set(['you', 'thank you', 'thank you very much', 'thanks for watching', 'thank you for watching', 'thank you so much for watching', 'please subscribe', 'bye', 'bye bye']);
const NOT_SPEECH = /amara\.org|subtitles? by|transcri(?:bed|ption) by|captions? by/i;
const MARKS_ONLY = /^[\s\p{P}\p{S}]*$|^\s*[[(][^\])]*[\])]\s*$/u;
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Keeps what was plausibly said: confident, not looping, not a known hallucination. */
function keepSpeech(segments: z.infer<typeof Segment>[]): Heard[] {
  const kept = segments
    .filter((s) => (s.avg_logprob ?? 0) >= -1 && (s.compression_ratio ?? 0) <= 2.4 && !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.5))
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(s.start, s.end), text: s.text.replace(/\s+/g, ' ').trim() }))
    .filter((s) => s.text && !NOT_SPEECH.test(s.text) && !MARKS_ONLY.test(s.text));
  if (SILENCE.has(plain(kept.map((s) => s.text).join(' ')))) return [];
  return kept;
}

/** Transcribes one clip of 16 kHz mono WAV, sealed to the speech model's verified key, and says which verification it went to. */
export async function transcribe(cfg: Config, wav: Uint8Array, durationMs: number): Promise<{ heard: Heard[]; evidence: InferenceEvidence }> {
  if (!ready(cfg)) throw notConnected('transcribe');
  const form = new FormData();
  form.set('model', cfg.NEAR_AI_STT_MODEL);
  form.set('response_format', 'verbose_json');
  form.set('temperature', '0');
  form.set('file', new Blob([wav.slice()], { type: 'audio/wav' }), 'clip.wav');
  const multipart = new Request(new URL('/v1/audio/transcriptions', cfg.NEAR_AI_STT_URL), { method: 'POST', body: form });
  const body = new Uint8Array(await multipart.arrayBuffer());
  const t0 = performance.now();
  return withVerified(cfg, cfg.NEAR_AI_STT_MODEL, 'transcript', async (v) => {
    const reply = await sealed(cfg, v, cfg.NEAR_AI_STT_URL, { path: '/v1/audio/transcriptions', type: multipart.headers.get('content-type') ?? 'multipart/form-data', body, timeoutMs: 20_000, what: 'transcribe' });
    const ms = Math.round(performance.now() - t0);
    if (reply.status !== 200) throw statusError(reply.status, { what: 'transcribe', ms });
    const r = Transcription.safeParse(parsed(reply.body));
    if (!r.success) throw new UnavailableError('The notes service sent back something unexpected.', { context: { what: 'transcribe', reply: 'unparseable' } });
    const segments = r.data.segments ?? (r.data.text.trim() ? [{ start: 0, end: durationMs / 1000, text: r.data.text }] : []);
    const heard = keepSpeech(segments);
    ilog.debug('clip transcribed', { model: v.model, bytes: wav.length, requestBytes: body.length, durationMs, segments: segments.length, kept: heard.length, ms });
    return { heard, evidence: v.evidence };
  });
}

/* ---------- the notes model ---------- */

/**
 * What a message says: text, or text and images. An image is a JPEG as a data URL: it travels inside the sealed
 * request like everything else, so only the model's attested VM sees it.
 */
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface Message { role: 'system' | 'user'; content: string | ContentPart[] }
/** A JPEG as a message part. */
export const jpegPart = (jpeg: Uint8Array): ContentPart => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}` } });
const imagesIn = (messages: Message[]) => messages.reduce((n, m) => n + (typeof m.content === 'string' ? 0 : m.content.filter((p) => p.type === 'image_url').length), 0);
const Chat = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).partial().optional()
});

/** The JSON object inside a reply, tolerating code fences or a sentence around it. */
function jsonIn(text: string): unknown {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try { return JSON.parse(text.slice(from, to + 1)); } catch { return null; }
}

/**
 * Asks the notes model for one JSON object, sealed to its verified key at its own endpoint, and returns it
 * unparsed for the caller's schema, with the verification it went to.
 */
export async function complete(cfg: Config, messages: Message[], o: { what: string; maxTokens: number; timeoutMs?: number }): Promise<{ json: unknown; evidence: InferenceEvidence }> {
  if (!ready(cfg)) throw notConnected(o.what);
  const model = cfg.NEAR_AI_NOTES_MODEL;
  // Thinking out loud first takes the model a minute on a long call and isn't needed for notes.
  const body = utf8(JSON.stringify({
    model, messages, temperature: 0.2, max_tokens: o.maxTokens, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false }, stream: false
  }));
  return withVerified(cfg, model, 'notes', async (v) => {
    const t0 = performance.now();
    const reply = await sealed(cfg, v, cfg.NEAR_AI_NOTES_URL, { path: '/v1/chat/completions', type: 'application/json', body, timeoutMs: o.timeoutMs ?? 90_000, what: o.what });
    const ms = Math.round(performance.now() - t0);
    if (reply.status !== 200) throw statusError(reply.status, { what: o.what, ms });
    const r = Chat.safeParse(parsed(reply.body));
    const choice = r.success ? r.data.choices[0] : undefined;
    const context = { what: o.what, model, ms, finish: choice?.finish_reason ?? null, promptTokens: r.success ? r.data.usage?.prompt_tokens ?? null : null, outputTokens: r.success ? r.data.usage?.completion_tokens ?? null : null };
    const json = jsonIn(choice?.message.content ?? '');
    if (json === null) throw new UnavailableError('The notes service sent back something unexpected.', { context: { ...context, reply: r.success ? 'no-json' : 'unparseable' } });
    ilog.debug('notes model answered', { ...context, requestBytes: body.length, images: imagesIn(messages) });
    return { json, evidence: v.evidence };
  });
}

/** Asks the notes model for one JSON object, as `complete` does, for answers nothing keeps (questions, catching up). */
export async function completeJson(cfg: Config, messages: Message[], o: { what: string; maxTokens: number; timeoutMs?: number }): Promise<unknown> {
  return (await complete(cfg, messages, o)).json;
}
