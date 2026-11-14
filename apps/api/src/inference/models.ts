/*
 * The models someone can choose for everything after transcription (docs: notes-and-inference › Choosing the model):
 * found at runtime from NEAR AI, never sent anything with content. Two public lists are joined:
 *
 *  - NEAR AI's catalog (`${NEAR_AI_BASE_URL}/models`): each model's ID, name, `input_modalities`, input price and the
 *    settings its provider takes. Only models that take text and images, aren't marked not ready and cost at most
 *    NEAR_AI_MAX_INPUT_PRICE a million input tokens are offered.
 *  - NEAR AI's registry of the models it runs itself, in its TEEs (NEAR_AI_ENDPOINTS_URL): which host serves each
 *    one's "direct completions", `{"endpoints": [{"domain", "models": [id]}]}`. A model listed there is private:
 *    requests go sealed to its own endpoint, to the key its attestation vouches for (evidence.ts). Any other model is
 *    unencrypted: requests go through NEAR AI's gateway to its provider, and the app says so wherever it's chosen.
 *
 * The default (NEAR_AI_NOTES_MODEL at NEAR_AI_NOTES_URL) is always offered, first, and is what "null" means. The
 * joined list is kept for ten minutes, and a failure to fetch it for 30 seconds. Log lines carry counts, statuses
 * and model IDs. Every model's price in the catalog, the speech model's included, is kept too, as last listed, for what
 * each request is charged (features/billing/meter/meter.ts).
 */
import type { AiModel, AiModels } from '@alcove/api';
import { z } from 'zod';
import type { Config } from '../platform/config';
import { UnansweredError, UnverifiedError } from '../platform/errors';
import { verified } from './evidence';
import { defaultModel, inference, ready, type ChatModel } from './inference';
import { log } from '../platform/log';

const mlog = log.child({ component: 'models' });

/** How long the joined list is used before it's fetched again. */
const TTL_MS = 10 * 60_000;
/** How long a failure to fetch it stands before the next ask tries again. */
const REFUSED_MS = 30_000;

/** A model on offer, and how a request reaches it. */
export type ModelEntry = AiModel & { via: ChatModel };

/** One catalog entry, as much of it as is used; anything else in it is ignored, and an entry without an ID is skipped. */
const CatalogEntry = z.object({
  id: z.string().min(1),
  name: z.string().nullish().catch(null),
  input_modalities: z.array(z.string()).nullish().catch(null),
  architecture: z.object({ inputModalities: z.array(z.string()).nullish().catch(null) }).nullish().catch(null),
  is_ready: z.boolean().nullish().catch(null),
  // `input` and `output` are USD a million tokens; `input_cache_read` USD a token, as a decimal string.
  pricing: z.object({
    input: z.coerce.number().nullish().catch(null), output: z.coerce.number().nullish().catch(null), input_cache_read: z.coerce.number().nullish().catch(null)
  }).nullish().catch(null),
  supported_sampling_parameters: z.array(z.string()).nullish().catch(null),
  supported_features: z.array(z.string()).nullish().catch(null)
});
const Catalog = z.object({ data: z.array(z.unknown()) });
const Endpoint = z.object({ domain: z.string().regex(/^[A-Za-z0-9.-]+(?::\d+)?$/), models: z.array(z.string()) });
const Listed = z.object({ models: z.array(z.string()) });
const Registry = z.object({ endpoints: z.array(z.unknown()) });

/** What a model costs, in micro-USD a million tokens: what's sent, what's sent that NEAR AI had cached, and what comes back. */
export interface Price { input: number; cached: number; output: number }
/** Each model's price as NEAR AI last listed it: kept through a failure to list them again, so a price is never forgotten. */
const prices = new Map<string, Price>();
const micro = (usd: number) => Math.round(usd * 1_000_000);
/** How a request reaches each model NEAR AI's catalog lists, offered or not, as last listed: for the writing model. */
let routes = new Map<string, ChatModel>();

const kept =new Map<string, { until: number; models: ModelEntry[] }>();
const refused = new Map<string, { until: number; error: UnansweredError }>();
const running = new Map<string, Promise<ModelEntry[]>>();

async function fetchJson(url: string, apiKey: string | undefined, what: string): Promise<unknown> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new UnansweredError('NEAR AI’s list of models can’t be reached right now.', { cause: e, context: { what, ms: Math.round(performance.now() - t0) } });
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new UnansweredError('NEAR AI’s list of models can’t be reached right now.', { context: { what, upstreamStatus: res.status, ms: Math.round(performance.now() - t0) } });
  }
  return res.json().catch(() => null);
}

async function load(cfg: Config): Promise<ModelEntry[]> {
  const t0 = performance.now();
  const [catalog, registry] = await Promise.all([
    fetchJson(`${cfg.NEAR_AI_BASE_URL.replace(/\/$/, '')}/models`, cfg.NEAR_AI_API_KEY, 'catalog'),
    fetchJson(cfg.NEAR_AI_ENDPOINTS_URL, undefined, 'endpoints')
  ]);
  const c = Catalog.safeParse(catalog);
  const r = Registry.safeParse(registry);
  if (!c.success || !r.success) {
    throw new UnansweredError('NEAR AI’s list of models came back in a shape Alcove doesn’t know.', { context: { what: 'models', catalog: c.success, endpoints: r.success } });
  }
  const scheme = new URL(cfg.NEAR_AI_ENDPOINTS_URL).protocol;
  const hosts = new Map<string, string>();
  // Every model the registry names, even with a host that can't be used: NEAR AI runs it privately, so it's never
  // offered unencrypted instead.
  const named = new Set<string>();
  for (const x of r.data.endpoints) {
    const loose = Listed.safeParse(x);
    if (loose.success) for (const m of loose.data.models) named.add(m);
    const e = Endpoint.safeParse(x);
    if (e.success) for (const m of e.data.models) if (!hosts.has(m)) hosts.set(m, `${scheme}//${e.data.domain}`);
  }
  const entries = c.data.data.flatMap((x) => { const e = CatalogEntry.safeParse(x); return e.success ? [e.data] : []; });
  for (const e of entries) {
    const input = e.pricing?.input;
    const output = e.pricing?.output;
    // A price only when it says both ways: half of one would charge nothing for the other.
    if (typeof input !== 'number' || typeof output !== 'number' || input < 0 || output < 0) continue;
    const cached = e.pricing?.input_cache_read;
    prices.set(e.id, { input: micro(input), output: micro(output), cached: typeof cached === 'number' && cached >= 0 ? micro(cached * 1_000_000) : micro(input) });
  }
  const nameOf = (id: string) => entries.find((e) => e.id === id)?.name?.trim() || id;
  const takes = (e: z.infer<typeof CatalogEntry>, what: string) => [...(e.input_modalities ?? []), ...(e.architecture?.inputModalities ?? [])].includes(what);
  // Sealed to its host when the registry lists one; through the gateway, with the settings its provider takes, when the
  // registry doesn't name it; none when the registry names it with no host that can be used.
  routes = new Map(entries.flatMap((e) => {
    const url = hosts.get(e.id);
    if (!url && named.has(e.id)) return [];
    const features = e.supported_features ?? [];
    const via: ChatModel = url ? { model: e.id, private: true, url }
      : { model: e.id, private: false, temperature: (e.supported_sampling_parameters ?? []).includes('temperature'), json: features.includes('json_mode') || features.includes('structured_outputs') };
    return [[e.id, via] as const];
  }));
  const others = entries
    // A model without a price isn't offered: nothing says what it costs.
    .filter((e) => e.id !== cfg.NEAR_AI_NOTES_MODEL && e.is_ready !== false && takes(e, 'text') && takes(e, 'image') && typeof e.pricing?.input === 'number' && e.pricing.input <= cfg.NEAR_AI_MAX_INPUT_PRICE)
    .flatMap((e): ModelEntry[] => {
      const via = routes.get(e.id);
      return via ? [{ id: e.id, name: nameOf(e.id), private: via.private, via }] : [];
    })
    // Private ones first, then by name.
    .sort((a, b) => Number(b.private) - Number(a.private) || a.name.localeCompare(b.name));
  const models: ModelEntry[] = [{ id: cfg.NEAR_AI_NOTES_MODEL, name: nameOf(cfg.NEAR_AI_NOTES_MODEL), private: true, via: defaultModel(cfg) }, ...others];
  // What can be charged with no price both ways is charged at the fallback (features/billing/meter/meter.ts): said here, once each
  // time the catalog is read, never with every request.
  const unpriced = [...new Set([cfg.NEAR_AI_STT_MODEL, ...models.map((m) => m.id)])].filter((id) => !prices.has(id));
  if (unpriced.length) mlog.warn('models not priced; charged at the fallback', { models: unpriced });
  mlog.info('models listed', { catalog: entries.length, endpoints: hosts.size, offered: others.length, unencrypted: others.filter((m) => !m.private).length, ms: Math.round(performance.now() - t0) });
  return models;
}

/**
 * Every model on offer, the default first: from NEAR AI's catalog and its registry of endpoints, kept for ten
 * minutes. Without NEAR AI configured there are none. NEAR AI not answering is thrown.
 */
export async function aiModels(cfg: Config): Promise<ModelEntry[]> {
  if (!inference(cfg).configured) return [];
  const id = `${cfg.NEAR_AI_BASE_URL}|${cfg.NEAR_AI_ENDPOINTS_URL}|${cfg.NEAR_AI_NOTES_MODEL}|${cfg.NEAR_AI_MAX_INPUT_PRICE}`;
  const hit = kept.get(id);
  if (hit && hit.until > Date.now()) return hit.models;
  const no = refused.get(id);
  if (no && no.until > Date.now()) throw no.error;
  const inFlight = running.get(id);
  if (inFlight) return inFlight;
  const made = load(cfg)
    .then((models) => { kept.set(id, { until: Date.now() + TTL_MS, models }); refused.delete(id); return models; }, (e: unknown) => {
      if (e instanceof UnansweredError) {
        mlog.warn('models not listed', { err: e });
        refused.set(id, { until: Date.now() + REFUSED_MS, error: e });
      }
      throw e;
    })
    .finally(() => running.delete(id));
  running.set(id, made);
  return made;
}

/**
 * What a model costs, as NEAR AI's catalog last listed it. Every metered request asks, so none waits on the catalog for a
 * price it has: that one is used at once, and the list is read again behind it once it's older than ten minutes. Only a
 * model never priced waits for the list, and is null when the catalog doesn't price it (both ways): the caller falls back
 * to its own price. NEAR AI not answering leaves the last price in force.
 */
export async function priceOf(cfg: Config, model: string): Promise<Price | null> {
  const known = prices.get(model);
  if (known) {
    // Not answering is logged where it's kept (`aiModels`); anything else is said here, as nobody waits on it.
    void aiModels(cfg).catch((e: unknown) => { if (!(e instanceof UnansweredError)) mlog.warn('models not listed', { err: e }); });
    return known;
  }
  try {
    await aiModels(cfg);
  } catch (e) {
    if (!(e instanceof UnansweredError)) throw e;
  }
  return prices.get(model) ?? null;
}

const shown = (m: ModelEntry): AiModel => ({ id: m.id, name: m.name, private: m.private });

/** The choices, for the app: the default, and every model on offer (the default among them, first). */
export async function list(cfg: Config): Promise<AiModels> {
  const all = await aiModels(cfg);
  const first = all[0];
  const fallback: AiModel = { id: cfg.NEAR_AI_NOTES_MODEL, name: cfg.NEAR_AI_NOTES_MODEL, private: true };
  return { default: first ? shown(first) : fallback, models: all.map(shown) };
}

/** Whether a choice goes to a private model: the default does, and so does anything that would fall back to it. */
export async function isPrivate(cfg: Config, chosen: string | null): Promise<boolean> {
  if (chosen === null || chosen === cfg.NEAR_AI_NOTES_MODEL || !ready(cfg)) return true;
  try {
    return (await aiModels(cfg)).find((m) => m.id === chosen)?.private ?? true;
  } catch (e) {
    if (!(e instanceof UnansweredError)) throw e;
    // The lists not answering: a request can't be sent anywhere but the default until they do.
    return true;
  }
}

/**
 * The model that does a job for a choice: the one chosen, or the default for null. A model NEAR AI no longer offers,
 * or a private one whose evidence doesn't check out, can't be sent anything, so the default does it instead (and a
 * note's list of verified models says so): one model never holds the notes up. An unencrypted model has no evidence
 * to check. If the default can't be verified either, its requests say so and the notes wait. NEAR AI's lists not
 * answering is thrown, so the notes wait for them.
 */
export async function resolveModel(cfg: Config, chosen: string | null): Promise<ChatModel> {
  const fallback = defaultModel(cfg);
  if (chosen === null || chosen === cfg.NEAR_AI_NOTES_MODEL || !ready(cfg)) return fallback;
  const found = (await aiModels(cfg)).find((m) => m.id === chosen);
  if (!found) {
    mlog.warn('model unavailable', { model: chosen, instead: fallback.model });
    return fallback;
  }
  return checked(cfg, found.via, 'model unverified');
}

/** A model's route once a private one's evidence checks out: an unencrypted one has none to check. The default otherwise. */
async function checked(cfg: Config & { NEAR_AI_API_KEY: string }, via: ChatModel, said: string): Promise<ChatModel> {
  if (!via.private) return via;
  try {
    await verified(cfg, via.model, 'notes');
  } catch (e) {
    if (!(e instanceof UnverifiedError)) throw e;
    const fallback = defaultModel(cfg);
    mlog.warn(said, { model: via.model, instead: fallback.model, err: e });
    return fallback;
  }
  return via;
}

/**
 * The model that writes the notes after a call or recording ends when the organizer chose none (notes/writing/writer.ts):
 * NEAR_AI_WRITING_MODEL, or the default when that's unset. It's the operator's choice, so any model NEAR AI's catalog lists
 * will do, whatever its price, and it goes as any model does: sealed to its endpoint once its evidence checks out when
 * the registry lists one, through the gateway when it doesn't. One the catalog doesn't list, or whose evidence doesn't
 * check out, leaves the default to write them. NEAR AI's lists not answering is thrown, so the notes wait.
 */
export async function writingModel(cfg: Config): Promise<ChatModel> {
  const id = cfg.NEAR_AI_WRITING_MODEL;
  if (id === undefined || id === cfg.NEAR_AI_NOTES_MODEL || !ready(cfg)) return defaultModel(cfg);
  await aiModels(cfg);
  const via = routes.get(id);
  if (!via) {
    mlog.warn('writing model unavailable', { model: id, instead: cfg.NEAR_AI_NOTES_MODEL });
    return defaultModel(cfg);
  }
  return checked(cfg, via, 'writing model unverified');
}
