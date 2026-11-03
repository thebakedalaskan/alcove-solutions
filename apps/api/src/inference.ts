/*
 * NEAR AI Cloud (I01): speech to text for the live transcript, and the model that writes notes and
 * answers questions about them. This is the only module that holds the key or talks to the provider.
 * What passes through it is speech and what was said, so its log lines carry only models, sizes,
 * durations, counts, statuses and timings, never text.
 */
import { z } from 'zod';
import type { Config } from './config';
import { InternalError, UnavailableError, ValidationError } from './errors';
import { log } from './log';

const ilog = log.child({ component: 'inference' });

export interface Inference { configured: boolean; baseUrl: string }
export const inference = (cfg: Config): Inference => ({ configured: !!cfg.NEAR_AI_API_KEY, baseUrl: cfg.NEAR_AI_BASE_URL });

type Ready = Config & { NEAR_AI_API_KEY: string };
const ready = (cfg: Config): cfg is Ready => !!cfg.NEAR_AI_API_KEY;

/** Calls the provider; network failures, rate limits and its own errors become UnavailableError. */
async function call(cfg: Config, path: string, init: { body: BodyInit; headers?: Record<string, string> }, timeoutMs: number, what: string): Promise<Response> {
  if (!ready(cfg)) throw new UnavailableError('Alcove’s notes service isn’t connected on this server.', { context: { what } });
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${cfg.NEAR_AI_BASE_URL.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${cfg.NEAR_AI_API_KEY}`, accept: 'application/json', ...init.headers }, body: init.body, signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    throw new UnavailableError('Alcove’s notes service can’t be reached right now.', { cause: e, context: { what, timedOut, ms: Math.round(performance.now() - t0) } });
  }
  const ms = Math.round(performance.now() - t0);
  if (res.ok) return res;
  const context = { what, status: res.status, ms };
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 400 || res.status === 413 || res.status === 422) throw new ValidationError('The notes service couldn’t read that.', { context });
  if (res.status === 401 || res.status === 403) throw new InternalError('The notes service turned Alcove away.', { context });
  throw new UnavailableError('Alcove’s notes service is busy. Try again in a moment.', { context });
}

/* ---------- speech to text ---------- */

/** One stretch of speech, in seconds from the start of the clip. */
export interface Heard { start: number; end: number; text: string }

const Segment = z.object({
  start: z.number(), end: z.number(), text: z.string(),
  avg_logprob: z.number().optional(), compression_ratio: z.number().optional(), no_speech_prob: z.number().optional()
});
const Transcription = z.object({ text: z.string().default(''), segments: z.array(Segment).optional() });

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

/** Transcribes one clip of 16 kHz mono WAV. */
export async function transcribe(cfg: Config, wav: Uint8Array, durationMs: number): Promise<Heard[]> {
  const form = new FormData();
  form.set('model', cfg.NEAR_AI_STT_MODEL);
  form.set('response_format', 'verbose_json');
  form.set('temperature', '0');
  form.set('file', new Blob([wav.slice()], { type: 'audio/wav' }), 'clip.wav');
  const t0 = performance.now();
  const res = await call(cfg, '/audio/transcriptions', { body: form }, 20_000, 'transcribe');
  const r = Transcription.safeParse(await res.json().catch(() => null));
  if (!r.success) throw new UnavailableError('The notes service sent back something unexpected.', { context: { what: 'transcribe', reply: 'unparseable' } });
  const segments = r.data.segments ?? (r.data.text.trim() ? [{ start: 0, end: durationMs / 1000, text: r.data.text }] : []);
  const heard = keepSpeech(segments);
  ilog.debug('clip transcribed', { model: cfg.NEAR_AI_STT_MODEL, bytes: wav.length, durationMs, segments: segments.length, kept: heard.length, ms: Math.round(performance.now() - t0) });
  return heard;
}

/* ---------- the notes model ---------- */

export interface Message { role: 'system' | 'user'; content: string }
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

/** Asks the notes model for one JSON object and returns it unparsed for the caller's schema. */
export async function completeJson(cfg: Config, messages: Message[], o: { what: string; maxTokens: number; timeoutMs?: number }): Promise<unknown> {
  const t0 = performance.now();
  const res = await call(cfg, '/chat/completions', {
    headers: { 'content-type': 'application/json' },
    // Thinking out loud first takes the model a minute on a long call and isn't needed for notes.
    body: JSON.stringify({ model: cfg.NEAR_AI_NOTES_MODEL, messages, temperature: 0.2, max_tokens: o.maxTokens, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } })
  }, o.timeoutMs ?? 90_000, o.what);
  const r = Chat.safeParse(await res.json().catch(() => null));
  const choice = r.success ? r.data.choices[0] : undefined;
  const json = jsonIn(choice?.message.content ?? '');
  const context = { what: o.what, model: cfg.NEAR_AI_NOTES_MODEL, ms: Math.round(performance.now() - t0), finish: choice?.finish_reason ?? null, promptTokens: r.success ? r.data.usage?.prompt_tokens ?? null : null, outputTokens: r.success ? r.data.usage?.completion_tokens ?? null : null };
  if (json === null) throw new UnavailableError('The notes service sent back something unexpected.', { context: { ...context, reply: 'no-json' } });
  ilog.debug('notes model answered', context);
  return json;
}
