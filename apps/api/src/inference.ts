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

/**
 * What a clip is sent with besides its audio. `language`: the call's language, once its clips agree on it
 * (Whisper's code for it), so a short or accented clip isn't taken for another language. `prompt`: who's in
 * the call and what was said just before (see speechPrompt), so names are spelled right and a clip cut
 * mid-sentence carries on from it.
 */
export interface SpeechContext { language?: string | undefined; prompt?: string | undefined }

/** Whisper's codes for its languages ("en", "de", "yue"). It answers 400 to anything else, names included. */
const LANGUAGE_CODE = /^[a-z]{2,3}$/;
/**
 * A prompt's parts, in UTF-8 bytes: the names, and what was said before (about 55 words of English). NEAR
 * AI refuses a prompt that fills Whisper's 448-token context, and long ones make it skip what it hears or
 * repeat itself: measured, 375 bytes or more of what was said before lost whole sentences, 150 to 330 didn't.
 */
const NAMES_BYTES = 120;
const SAID_BYTES = 250;
/** The most of any prompt sent. */
const PROMPT_BYTES = NAMES_BYTES + 1 + SAID_BYTES;
/**
 * The language Whisper picked for a clip says what the call is in only with this much speech, heard this surely:
 * it takes short clips, and whole clips of accented speech, for another language, and then it's less sure.
 */
const SURE = { words: 4, logprob: -0.25 };

/** The end of `text` that fits in `bytes` of UTF-8, from a word boundary. */
function endWithin(text: string, bytes: number): string {
  const b = utf8(text);
  if (b.length <= bytes) return text;
  if (bytes <= 0) return '';
  // Cut on a character boundary (continuation bytes are 10xxxxxx), then at the first space after it.
  let from = b.length - bytes;
  while (from < b.length && ((b[from] ?? 0) & 0xc0) === 0x80) from++;
  const end = fromUtf8(b.subarray(from));
  const space = end.indexOf(' ');
  return space >= 0 && space < end.length - 1 ? end.slice(space + 1) : end;
}

/**
 * A prompt as Whisper takes it: the people in the call by name ("Priya Raman, Kofi Mensah."), as many as fit
 * in NAMES_BYTES, then the end of what was said before, up to SAID_BYTES. It reads the prompt as what came
 * before the clip, in the clip's language, so it is only for clips sent with the call's: even names alone,
 * when they read as words ("Measure After"), draw a clip into their language.
 */
export function speechPrompt(names: readonly string[], before: string): string {
  let named = '';
  for (const n of new Set(names.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))) {
    const next = named ? `${named}, ${n}` : n;
    if (utf8(next).length + 1 > NAMES_BYTES) break;
    named = next;
  }
  const head = named ? `${named}.` : '';
  const said = endWithin(before.replace(/\s+/g, ' ').trim(), SAID_BYTES);
  return [head, said].filter(Boolean).join(' ');
}

const Segment = z.object({
  start: z.number(), end: z.number(), text: z.string(),
  avg_logprob: z.number().nullish(), compression_ratio: z.number().nullish(), no_speech_prob: z.number().nullish()
});
const Transcription = z.object({ text: z.string().default(''), language: z.string().nullish(), segments: z.array(Segment).nullish() });

/**
 * What Whisper is known to "hear" in silence and noise: closing lines from the videos it was trained on,
 * in the languages it most often hears them in. A clip that is nothing but one of these is dropped, and so
 * is any line that credits subtitlers (see CREDITS) or is only music marks or bracketed sound descriptions.
 */
const SILENCE = new Set([
  'you', 'thank you', 'thank you very much', 'thank you so much', 'thanks for watching', 'thank you for watching', 'thank you so much for watching', 'please subscribe', 'to be continued', 'bye', 'bye bye',
  'gracias', 'muchas gracias', 'gracias por ver', 'gracias por ver el video', 'obrigado', 'obrigada', 'muito obrigado', 'obrigado por assistir',
  'merci', 'merci beaucoup', "merci d'avoir regardé", "merci d'avoir regardé cette vidéo", 'danke', 'vielen dank', 'danke schön', 'danke fürs zuschauen',
  'grazie', 'grazie mille', 'grazie per la visione', 'bedankt', 'bedankt voor het kijken', 'спасибо', 'спасибо за просмотр', 'продолжение следует',
  'ご視聴ありがとうございました', 'ありがとうございました', '谢谢观看', '感谢观看', '감사합니다', '시청해주셔서 감사합니다'
]);
/**
 * The subtitle credits Whisper invents, in the languages it invents them in. They open the line ("Subtitles by the
 * Amara.org community", "Sous-titrage ST' 501", "Untertitel im Auftrag des ZDF", "Субтитры сделал DimaTorzok",
 * "字幕by索兰娅", "자막 제공"), so a sentence that only talks about subtitles or captions is kept.
 */
const CREDITS = /amara\.org|^[\s\p{P}]*(?:(?:(?:subtitles?|captions?|captioning|transcription|transcribed)(?: made)? by(?! default)|sous-titrage|sous-titres? réalisés? par|untertitel(?:ung)? (?:im auftrag|des|von)|subt[ií]tulos (?:(?:realizados|hechos|creados) )?por|sottotitoli (?:creati|a cura)|legendas? (?:pela|por)|ondertitel(?:d|ing) door|субтитры (?:сделал|создавал|подготовил)|редактор субтитров)(?!\p{L})|字幕\s*(?:by|志愿者|制作)|한글\s*자막|자막\s*(?:제공|제작))/iu;
const MARKS_ONLY = /^[\s\p{P}\p{S}]*$|^\s*[[(][^\])]*[\])]\s*$/u;
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** A text's runs of three words, as plain words. */
const trigrams = (s: string): string[] => { const w = plain(s).split(' ').filter(Boolean); return w.slice(2).map((x, i) => `${w[i] ?? ''} ${w[i + 1] ?? ''} ${x}`); };
/**
 * Whisper sometimes says back what it was told came before instead of what it heard, in noise and quiet
 * above all, word for word or with a word changed: a line of ECHO_WORDS words or more, four in five of whose
 * runs of three words the prompt has. Shorter lines are kept, because people say back what was just said to
 * agree to it ("Forty thousand dollars.", "Ship it on Friday."); someone picking up a phrase shares fewer runs.
 */
const ECHO_WORDS = 6;
function echoes(told: ReadonlySet<string>, text: string): boolean {
  const own = trigrams(text);
  return own.length >= ECHO_WORDS - 2 && own.filter((t) => told.has(t)).length >= 0.8 * own.length;
}
/**
 * Whisper looping, too rarely to cross the compression ratio: a run of sentences, three words or more in
 * all, said again straight after itself ("Okay. Can you hear me? Okay. Can you hear me?"). The repeat goes.
 */
function unlooped(text: string): string {
  const said = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  const words = said.map(plain);
  for (let k = Math.floor(said.length / 2); k >= 1; k--) {
    for (let i = 0; i + 2 * k <= said.length; i++) {
      const run = words.slice(i, i + k).join(' ');
      if (run.split(' ').length >= 3 && run === words.slice(i + k, i + 2 * k).join(' ')) { said.splice(i + k, k); words.splice(i + k, k); i--; }
    }
  }
  return said.join(' ');
}

/** Keeps what was plausibly said: confident, not looping, not a known hallucination, not the prompt said back. */
function keepSpeech(segments: z.infer<typeof Segment>[], prompt: string | undefined): Heard[] {
  const told = new Set(prompt ? trigrams(prompt) : []);
  let previous = '';
  const kept = segments
    .filter((s) => (s.avg_logprob ?? 0) >= -1 && (s.compression_ratio ?? 0) <= 2.4 && !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.5))
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(s.start, s.end), text: unlooped(s.text.replace(/\s+/g, ' ').trim()) }))
    .filter((s) => s.text && !CREDITS.test(s.text) && !MARKS_ONLY.test(s.text) && !echoes(told, s.text))
    // A line that only says the one before it again is the same loop, across Whisper's segments.
    .filter((s) => { const p = plain(s.text); const again = p === previous && p.split(' ').length >= 3; previous = p; return !again; });
  if (SILENCE.has(plain(kept.map((s) => s.text).join(' ')))) return [];
  return kept;
}

/**
 * Transcribes one clip of 16 kHz mono WAV, sealed to the speech model's verified key, and says which
 * verification it went to. `language` is the language Whisper picked for the clip itself (none was sent),
 * when there was enough confident speech in it to go by; otherwise null.
 */
export async function transcribe(cfg: Config, wav: Uint8Array, durationMs: number, context: SpeechContext = {}): Promise<{ heard: Heard[]; language: string | null; evidence: InferenceEvidence }> {
  if (!ready(cfg)) throw notConnected('transcribe');
  const language = context.language && LANGUAGE_CODE.test(context.language) ? context.language : undefined;
  const prompt = context.prompt?.trim() ? endWithin(context.prompt.trim(), PROMPT_BYTES) : undefined;
  const form = new FormData();
  form.set('model', cfg.NEAR_AI_STT_MODEL);
  form.set('response_format', 'verbose_json');
  form.set('temperature', '0');
  if (language) form.set('language', language);
  if (prompt) form.set('prompt', prompt);
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
    const heard = keepSpeech(segments, prompt);
    const words = heard.reduce((n, h) => n + h.text.split(/\s+/).filter(Boolean).length, 0);
    const sure = segments.length > 0 && segments.reduce((n, s) => n + (s.avg_logprob ?? -9), 0) / segments.length >= SURE.logprob;
    const picked = r.data.language ?? '';
    const detected = !language && LANGUAGE_CODE.test(picked) && words >= SURE.words && sure ? picked : null;
    // Which language is neither logged nor kept readable: only whether one was sent, found, and the prompt's size.
    ilog.debug('clip transcribed', { model: v.model, bytes: wav.length, requestBytes: body.length, durationMs, segments: segments.length, kept: heard.length, ms, languageSent: Boolean(language), languageFound: detected !== null, promptBytes: prompt ? utf8(prompt).length : 0 });
    return { heard, language: detected, evidence: v.evidence };
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
