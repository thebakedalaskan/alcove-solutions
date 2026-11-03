/*
 * NEAR AI Cloud (I01): speech to text for the live transcript, and the model that writes notes and
 * answers questions about them. This is the only module that holds the key or talks to the provider, and
 * nothing with content leaves it except encrypted to a model whose evidence checked out (evidence.ts):
 *
 *  - chat goes end-to-end encrypted (NEAR AI's E2EE v2) to the notes model's attested key, so NEAR AI's
 *    gateway passes it on without being able to read it; the reply comes back encrypted to a key made for
 *    that one request, and its signature by the model's key over the exact request and reply is checked;
 *  - speech goes by Oblivious HTTP (ohttp.ts) sealed to the speech model's attested OHTTP key, at the
 *    model's own endpoint, with the API key inside the seal; the reply is sealed under the same exchange.
 *
 * There is no plaintext way, and no setting that turns either off. What passes through is speech and
 * what was said, so log lines carry only models, sizes, durations, counts, statuses, codes and timings.
 */
import type { InferenceEvidence } from '@alcove/api';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';
import type { Config } from './config';
import { concat, equalBytes, fromUtf8, random, utf8 } from './crypto';
import { AppError, InternalError, UnavailableError, UnverifiedError, ValidationError } from './errors';
import { fingerprint, forget, hex, unhex, verified, type Task, type Verified } from './evidence';
import { log } from './log';
import { decodeResponse, encapsulate, encodeRequest, type KeyConfig } from './ohttp';

const ilog = log.child({ component: 'inference' });

export interface Inference { configured: boolean; baseUrl: string }
export const inference = (cfg: Config): Inference => ({ configured: !!cfg.NEAR_AI_API_KEY, baseUrl: cfg.NEAR_AI_BASE_URL });

type Ready = Config & { NEAR_AI_API_KEY: string };
const ready = (cfg: Config): cfg is Ready => !!cfg.NEAR_AI_API_KEY;
const notConnected = (what: string) => new UnavailableError('Alcove’s notes service isn’t connected on this server.', { context: { what } });

/** NEAR AI didn't take the key a request was encrypted to (it rotated, or another instance answered): verify again and retry once. */
class KeyRefused extends Error {
  constructor(readonly error: AppError) { super(error.message); }
}

/** An answer's status as Alcove's error: what was sent was unreadable, the key was refused, or the service is busy or down. */
function statusError(status: number, context: Record<string, string | number>): AppError {
  if (status === 400 || status === 413 || status === 422) return new ValidationError('The notes service couldn’t read that.', { context });
  if (status === 401 || status === 403) return new InternalError('The notes service turned Alcove away.', { context });
  return new UnavailableError('Alcove’s notes service is busy. Try again in a moment.', { context });
}

/** Sends one request. Timeouts and NEAR AI's own errors become AppErrors; a refused key, or a connection NEAR AI cut, becomes KeyRefused. */
async function send(url: string, init: { body: Uint8Array<ArrayBuffer>; headers: Record<string, string> }, timeoutMs: number, what: string, refusedKey: (status: number) => boolean): Promise<Response> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: init.headers, body: init.body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    const error = new UnavailableError('Alcove’s notes service can’t be reached right now.', { cause: e, context: { what, timedOut, ms: Math.round(performance.now() - t0) } });
    // NEAR AI answers a key it no longer holds before reading the body, which fetch reports as a failed request.
    if (timedOut) throw error;
    throw new KeyRefused(error);
  }
  if (res.ok) return res;
  await res.body?.cancel().catch(() => undefined);
  const context = { what, status: res.status, ms: Math.round(performance.now() - t0) };
  if (refusedKey(res.status)) throw new KeyRefused(new UnavailableError('The notes service didn’t accept the key it vouched for.', { context }));
  throw statusError(res.status, context);
}

/** Runs a request with the model's verification. If NEAR AI no longer takes its key, verifies again and, if the key changed, retries once. */
async function withVerified<T>(cfg: Ready, model: string, task: Task, run: (v: Verified) => Promise<T>): Promise<T> {
  const v = await verified(cfg, model, task);
  try {
    return await run(v);
  } catch (e) {
    if (!(e instanceof KeyRefused)) throw e;
    forget(cfg, v);
    const again = await verified(cfg, model, task);
    const changed = again.key !== v.key || !sameKeyConfig(again.ohttp, v.ohttp);
    ilog.info('model key not accepted; verified again', { model, task, changed, keyHash: keyHash(v), nowKeyHash: keyHash(again) });
    if (!changed) throw e.error;
    try { return await run(again); } catch (retry) { throw retry instanceof KeyRefused ? retry.error : retry; }
  }
}
const keyHash = (v: Verified) => fingerprint(unhex(v.key) ?? new Uint8Array(0));
const sameKeyConfig = (a: KeyConfig | null, b: KeyConfig | null) => a === b || (!!a && !!b && a.keyId === b.keyId && equalBytes(a.publicKey, b.publicKey));

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
  const endpoint = new URL(cfg.NEAR_AI_STT_URL);
  const form = new FormData();
  form.set('model', cfg.NEAR_AI_STT_MODEL);
  form.set('response_format', 'verbose_json');
  form.set('temperature', '0');
  form.set('file', new Blob([wav.slice()], { type: 'audio/wav' }), 'clip.wav');
  const multipart = new Request(new URL('/v1/audio/transcriptions', endpoint), { method: 'POST', body: form });
  const body = new Uint8Array(await multipart.arrayBuffer());
  const t0 = performance.now();
  return withVerified(cfg, cfg.NEAR_AI_STT_MODEL, 'transcript', async (v) => {
    if (!v.ohttp) throw new InternalError('The speech model was verified without an OHTTP key.', { context: { what: 'transcribe' } });
    // The API key travels inside the seal too: only the model's TEE sees it, or anything else in the request.
    const sealed = encapsulate(v.ohttp, encodeRequest({
      method: 'POST', scheme: 'https', authority: endpoint.host, path: '/v1/audio/transcriptions', body,
      headers: [['content-type', multipart.headers.get('content-type') ?? 'multipart/form-data'], ['accept', 'application/json'], ['authorization', `Bearer ${cfg.NEAR_AI_API_KEY}`]]
    }));
    // A request the model can't open (another key) is refused before it's read: verify again.
    const res = await send(`${cfg.NEAR_AI_STT_URL.replace(/\/$/, '')}/ohttp`, { body: new Uint8Array(sealed.wire), headers: { 'content-type': 'message/ohttp-req', accept: 'message/ohttp-res' } },
      20_000, 'transcribe', (s) => s === 400 || s === 421 || s === 422);
    let reply: ReturnType<typeof decodeResponse>;
    try {
      reply = decodeResponse(sealed.open(new Uint8Array(await res.arrayBuffer())));
    } catch (e) {
      ilog.error('reply refused', { what: 'transcribe', model: v.model, code: 'reply-sealed' });
      throw new UnverifiedError('The speech model’s reply couldn’t be opened, so it wasn’t used.', { cause: e, context: { what: 'transcribe', check: 'reply-sealed' }, level: 'error' });
    }
    const ms = Math.round(performance.now() - t0);
    if (reply.status !== 200) throw statusError(reply.status, { what: 'transcribe', ms });
    const r = Transcription.safeParse((() => { try { return JSON.parse(fromUtf8(reply.body)); } catch { return null; } })());
    if (!r.success) throw new UnavailableError('The notes service sent back something unexpected.', { context: { what: 'transcribe', reply: 'unparseable' } });
    const segments = r.data.segments ?? (r.data.text.trim() ? [{ start: 0, end: durationMs / 1000, text: r.data.text }] : []);
    const heard = keepSpeech(segments);
    ilog.debug('clip transcribed', { model: v.model, encryption: 'ohttp', bytes: wav.length, sealedBytes: sealed.wire.length, durationMs, segments: segments.length, kept: heard.length, ms });
    return { heard, evidence: v.evidence };
  });
}

/* ---------- the notes model, end-to-end encrypted ---------- */

export interface Message { role: 'system' | 'user'; content: string }
const Chat = z.object({
  id: z.string().min(1),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).partial().optional()
});
const ReplySignature = z.object({ text: z.string(), signature: z.string(), signing_address: z.string(), signing_algo: z.string(), signature_kind: z.string() });

/** E2EE v2: X25519 between a fresh key and the recipient's (from Ed25519), HKDF-SHA256, XChaCha20-Poly1305; hex of key ‖ nonce ‖ ciphertext. */
const sharedKey = (secret: Uint8Array, publicKey: Uint8Array) => hkdf(sha256, x25519.getSharedSecret(secret, publicKey), undefined, utf8('ed25519_encryption'), 32);
function sealTo(recipient: Uint8Array, text: string): string {
  const ephemeral = random(32);
  const key = sharedKey(ephemeral, recipient);
  const nonce = random(24);
  const sealed = concat(x25519.getPublicKey(ephemeral), nonce, xchacha20poly1305(key, nonce).encrypt(utf8(text)));
  ephemeral.fill(0);
  key.fill(0);
  return hex(sealed);
}
function openWith(secret: Uint8Array, sealedHex: string): string {
  const b = unhex(sealedHex);
  if (!b || b.length < 32 + 24 + 16) throw new Error('Not an encrypted field.');
  const key = sharedKey(secret, b.subarray(0, 32));
  try { return fromUtf8(xchacha20poly1305(key, b.subarray(32, 56)).decrypt(b.subarray(56))); } finally { key.fill(0); }
}

/** The JSON object inside a reply, tolerating code fences or a sentence around it. */
function jsonIn(text: string): unknown {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try { return JSON.parse(text.slice(from, to + 1)); } catch { return null; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The model's signature over exactly what was sent and what came back, by the key its evidence vouched
 * for: only then is the reply the model's. NEAR AI records it as the reply finishes, so a missing one is
 * asked for again, briefly.
 */
async function signed(cfg: Ready, v: Verified, id: string, request: Uint8Array, response: Uint8Array, what: string): Promise<NonNullable<InferenceEvidence['receipt']>> {
  const expected = `${v.model}:${hex(sha256(request))}:${hex(sha256(response))}`;
  const url = `${cfg.NEAR_AI_BASE_URL.replace(/\/$/, '')}/signature/${encodeURIComponent(id)}?${new URLSearchParams({ model: v.model, signing_algo: 'ed25519' })}`;
  const refused = (reason: string) => {
    ilog.error('reply refused', { what, model: v.model, code: 'reply-signature', reason });
    return new UnverifiedError('The notes service’s reply couldn’t be verified, so it wasn’t used.', { context: { what, check: 'reply-signature' }, level: 'error' });
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await sleep(300 * attempt);
    let res: Response;
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${cfg.NEAR_AI_API_KEY}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    } catch { continue; }
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); if (res.status === 404 || res.status >= 500 || res.status === 429) continue; throw refused(`NEAR AI answered ${res.status}`); }
    const s = ReplySignature.safeParse(await res.json().catch(() => null));
    if (!s.success) continue;
    const signature = unhex(s.data.signature);
    const key = unhex(v.key);
    if (s.data.signature_kind !== 'provider_tee' || s.data.signing_algo !== 'ed25519') throw refused('not signed by the model');
    if (s.data.signing_address.toLowerCase() !== v.key) throw refused('signed by another key');
    if (s.data.text !== expected) throw refused('signed over other bytes');
    if (!signature || !key || signature.length !== 64 || !ed25519.verify(signature, utf8(s.data.text), key)) throw refused('the signature doesn’t verify');
    return { completionId: id, signedText: s.data.text, signature: s.data.signature };
  }
  throw refused('no signature was recorded');
}

/**
 * Asks the notes model for one JSON object, end-to-end encrypted to its verified key, and returns it
 * unparsed for the caller's schema, with the verification it went to and the model's signed receipt.
 */
export async function complete(cfg: Config, messages: Message[], o: { what: string; maxTokens: number; timeoutMs?: number }): Promise<{ json: unknown; evidence: InferenceEvidence }> {
  if (!ready(cfg)) throw notConnected(o.what);
  const model = cfg.NEAR_AI_NOTES_MODEL;
  return withVerified(cfg, model, 'notes', async (v) => {
    const t0 = performance.now();
    const modelKey = unhex(v.key);
    if (!modelKey) throw new InternalError('The notes model was verified with a malformed key.', { context: { what: o.what } });
    // A key for this request alone: the reply is encrypted to it, and it's wiped when the reply is read.
    const seed = random(32);
    const clientPublic = ed25519.getPublicKey(seed);
    const clientSecret = ed25519.utils.toMontgomerySecret(seed);
    seed.fill(0);
    try {
      const recipient = ed25519.utils.toMontgomery(modelKey);
      // Thinking out loud first takes the model a minute on a long call and isn't needed for notes.
      const request = utf8(JSON.stringify({
        model, messages: messages.map((m) => ({ role: m.role, content: sealTo(recipient, m.content) })), temperature: 0.2, max_tokens: o.maxTokens,
        response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false }, stream: false
      }));
      const res = await send(`${cfg.NEAR_AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        body: new Uint8Array(request),
        headers: {
          authorization: `Bearer ${cfg.NEAR_AI_API_KEY}`, 'content-type': 'application/json', accept: 'application/json',
          'x-signing-algo': 'ed25519', 'x-client-pub-key': hex(clientPublic), 'x-model-pub-key': v.key, 'x-encryption-version': '2', 'x-no-aliasing': 'true', 'x-encrypt-all-fields': 'true'
        }
      }, o.timeoutMs ?? 90_000, o.what, (s) => s === 421);
      const response = new Uint8Array(await res.arrayBuffer());
      const r = Chat.safeParse((() => { try { return JSON.parse(fromUtf8(response)); } catch { return null; } })());
      const choice = r.success ? r.data.choices[0] : undefined;
      const context = { what: o.what, model, ms: Math.round(performance.now() - t0), finish: choice?.finish_reason ?? null, promptTokens: r.success ? r.data.usage?.prompt_tokens ?? null : null, outputTokens: r.success ? r.data.usage?.completion_tokens ?? null : null };
      if (!r.success || !choice) throw new UnavailableError('The notes service sent back something unexpected.', { context: { ...context, reply: 'unparseable' } });
      let text = '';
      try { text = choice.message.content === null ? '' : openWith(clientSecret, choice.message.content); } catch (e) {
        ilog.error('reply refused', { what: o.what, model, code: 'reply-encryption' });
        throw new UnverifiedError('The notes service’s reply couldn’t be decrypted, so it wasn’t used.', { cause: e, context: { what: o.what, check: 'reply-encryption' }, level: 'error' });
      }
      const receipt = await signed(cfg, v, r.data.id, request, response, o.what);
      const json = jsonIn(text);
      if (json === null) throw new UnavailableError('The notes service sent back something unexpected.', { context: { ...context, reply: 'no-json' } });
      ilog.debug('notes model answered', { ...context, encryption: 'e2ee', reply: 'signed' });
      return { json, evidence: { ...v.evidence, receipt } };
    } finally {
      clientSecret.fill(0);
    }
  });
}

/** Asks the notes model for one JSON object, as `complete` does, for answers nothing keeps (questions, catching up). */
export async function completeJson(cfg: Config, messages: Message[], o: { what: string; maxTokens: number; timeoutMs?: number }): Promise<unknown> {
  return (await complete(cfg, messages, o)).json;
}
