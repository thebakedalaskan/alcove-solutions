import { X509Certificate } from 'node:crypto';
import { MAX_DOC_ITEMS } from '@alcove/api';
import { z } from 'zod';
import { INTEL_SGX_ROOT_CA, NVIDIA_NRAS_ROOT_CA } from './roots';
import { teeKeys } from './tee';

/** An optional setting: unset, or set to nothing (as in .env.example), means it isn't configured. */
const optional = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(1).optional());

const Key = (name: string) => z.string().regex(/^[A-Za-z0-9_-]{43}$/, `${name} must be 32 bytes, base64url`);
const INTEL_PCS = 'https://api.trustedservices.intel.com';
const NVIDIA_NRAS = 'https://nras.attestation.nvidia.com';
/** One X.509 certificate, PEM: a root verification ends at. */
const isCert = (pem: string) => { try { return new X509Certificate(pem).ca; } catch { return false; } };
const RootCa = (name: string, fallback: string) => z.string().refine(isCert, `${name} must be a CA certificate, PEM`).default(fallback);

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  OBJECTS_ENDPOINT: z.string().url(),
  OBJECTS_BUCKET: z.string().min(3),
  OBJECTS_ACCESS_KEY: z.string(),
  OBJECTS_SECRET_KEY: z.string(),
  API_PORT: z.coerce.number().int().default(8787),
  /** 127.0.0.1 locally; 0.0.0.0 in a container. */
  API_HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().url(),
  /** The API as browsers reach it, e.g. https://api.alcove.solutions, or http://localhost:3000/api behind the dev proxy. Google returns here. */
  API_URL: z.string().url(),
  /** Sign-in with Google. Without both, the Google button explains that it isn't set up here. */
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  /** Local demo sign-in and its sessions. Set to false when serving the public app. */
  DEMO_AUTH_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  /** Public requires Google-hosted addresses. Testers admits new accounts only from the private tester list. */
  GOOGLE_SIGNUP_MODE: z.enum(['open', 'testers', 'public']).default('open'),
  /** One tester email per line. Blank lines are ignored, and an empty list admits no new accounts. */
  GOOGLE_SIGNUP_TESTERS: z.string().default('').transform((value) => value.split('\n').map((email) => email.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.email().max(254))).readonly(),
  /** Google's OpenID Connect issuer. Tests point it at a local stand-in (src/testing/fake-google.ts). */
  GOOGLE_ISSUER: z.string().url().default('https://accounts.google.com'),
  /** Google's APIs (Calendar). Tests point it at the same local stand-in. */
  GOOGLE_API_URL: z.string().url().default('https://www.googleapis.com'),
  /** Where sign-in photos may come from: host suffixes, comma-separated. Alcove fetches them itself, so browsers never do. */
  PHOTO_HOSTS: z.string().min(1).default('googleusercontent.com'),
  /**
   * Where the API runs. `none`: an ordinary server, with KMASTER and KSERVICE from the environment.
   * `dstack`: a confidential VM (Intel TDX under Phala's dstack), where both keys come from the TEE's key
   * service, bound to the app's identity, and must not be in the environment at all.
   */
  TEE: z.enum(['none', 'dstack']).default('none'),
  /** The dstack guest agent's Unix socket, which only the VM can reach. Never a URL: keys come only from inside. */
  DSTACK_SOCKET: z.string().regex(/^\//, 'DSTACK_SOCKET must be the guest agent’s socket path').default('/var/run/dstack.sock'),
  /** The commit this image was built from, baked in at build time; /health and /v1/attestation report it. */
  ALCOVE_COMMIT: z.string().regex(/^(?:[0-9a-f]{7,40}|dev)$/).default('dev'),
  /** Wraps every account's root key. Outside a TEE only; inside, the TEE's key service derives it. */
  KMASTER: Key('KMASTER').optional(),
  /** Seals billing state. Separate from KMASTER: billing never needs owner keys. */
  KSERVICE: Key('KSERVICE').optional(),
  /** ws:// or wss:// URL of the LiveKit server, handed to clients with their join tickets. */
  LIVEKIT_URL: z.string().regex(/^wss?:\/\/\S+$/, 'LIVEKIT_URL must be a ws:// or wss:// URL'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(32, 'LIVEKIT_API_SECRET must be at least 32 characters'),
  /** NEAR AI Cloud: the live transcript and written notes. Without a key, recordings are kept but not transcribed. */
  NEAR_AI_API_KEY: optional,
  /**
   * NEAR AI's gateway: the attestation reports models are verified with, its catalog of models, and the plain chat
   * route a model marked unencrypted is asked through, when an organizer chose one (features/notes/models.ts).
   */
  NEAR_AI_BASE_URL: z.string().url().default('https://cloud-api.near.ai/v1'),
  /** Speech to text for the live transcript. */
  NEAR_AI_STT_MODEL: z.string().min(1).default('openai/whisper-large-v3'),
  /** The speech model's own endpoint: clips go to its /ohttp, sealed to the key its attestation vouches for. */
  NEAR_AI_STT_URL: z.string().url().default('https://whisper-large-v3.completions.near.ai'),
  /** The default model for everything after transcription: writing notes, reading screens, answering questions. */
  NEAR_AI_NOTES_MODEL: z.string().min(1).default('deepseek-ai/DeepSeek-V4.1-Flash-1017'),
  /** The default model's own endpoint: requests go to its /ohttp, sealed to the key its attestation vouches for. */
  NEAR_AI_NOTES_URL: z.string().url().default('https://deepseek-v4-1-flash.completions.near.ai'),
  /** The most a model offered as a choice may cost, in US dollars per million input tokens (NEAR AI's catalog price). */
  NEAR_AI_MAX_INPUT_PRICE: z.coerce.number().nonnegative().default(1),
  /**
   * NEAR AI's registry of the hosts that serve the models it runs itself, in its TEEs: a model listed there is private
   * and is sent requests sealed to its attested key; any other is unencrypted (features/notes/models.ts).
   */
  NEAR_AI_ENDPOINTS_URL: z.string().url().default('https://completions.near.ai/endpoints'),
  /** NEAR Intents 1Click, for credit top-ups: the partner JWT from partners.near-intents.org. Optional: without it 1Click still quotes, with a higher fee. */
  ONECLICK_API_KEY: optional,
  /** The NEAR account whose Intents balance receives every top-up, and every refund. Top-ups are off without it. */
  TREASURY_INTENTS_ACCOUNT: optional,
  /** 1Click's API. Tests point it at their stand-in. */
  ONECLICK_BASE_URL: z.string().url().default('https://1click.chaindefuser.com'),
  /** Intel's Provisioning Certification Service: the TCB info, QE identity and revocation lists a TDX quote is checked against. */
  INTEL_PCS_URL: z.string().url().default(INTEL_PCS),
  /** The root every TDX quote and Intel collateral must chain to: Intel's SGX Root CA. Tests set their own. */
  INTEL_ROOT_CA: RootCa('INTEL_ROOT_CA', INTEL_SGX_ROOT_CA),
  /** NVIDIA's Remote Attestation Service, which checks a model's GPU evidence and signs its verdict. */
  NVIDIA_NRAS_URL: z.string().url().default(NVIDIA_NRAS),
  /** The root NRAS's signing keys must chain to: NVIDIA Attestation Service CA 001. Tests set their own. */
  NVIDIA_ROOT_CA: RootCa('NVIDIA_ROOT_CA', NVIDIA_NRAS_ROOT_CA),
  /** How long a browser's stream of rings lasts, at most, before it opens a new one: under Cloud Run's 300-second request timeout. */
  RING_STREAM_SECONDS: z.coerce.number().int().min(1).max(280).default(240),
  /** How often a live stream says it's still there, and checks who's reading it, in ms. */
  LIVE_PING_MS: z.coerce.number().int().min(10).default(25_000),
  /** How long the API keeps a live stream open before letting go, for the browser to open it again: inside Cloud Run's request timeout, so nothing is cut. */
  LIVE_STREAM_MS: z.coerce.number().int().min(10).default(280_000),
  /** How long a read of a file lasts, at most, in ms: inside Cloud Run's request timeout, so a read that stopped can't hold its place for good. A player asks on from where it got to. */
  MEDIA_READ_MS: z.coerce.number().int().min(10).max(290_000).default(280_000),
  /** How long an instance keeps the service limits it read (limits.ts) before reading them again, in ms: a change made in the database is in force everywhere within this, with no restart. */
  LIMITS_CACHE_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
  /** How long an instance keeps the feature flags it read (feature-flags.ts) before reading them again, in ms: a flag switched on or off is in force everywhere within this, with no restart. */
  FEATURE_FLAGS_CACHE_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
  /** How often the hub checks its LISTEN connection is alive, in ms, and how long that connection has to answer. */
  HUB_CHECK_MS: z.coerce.number().int().min(10).default(15_000),
  HUB_TIMEOUT_MS: z.coerce.number().int().min(10).default(5_000),
  /** The most workspace and document streams an instance holds, everyone's together: each holds a request, and calls need the rest. */
  LIVE_STREAMS_MAX: z.coerce.number().int().min(1).default(500),
  /** The most of them from one address, whoever's signed in, so a handful of accounts can't take them all. */
  LIVE_STREAMS_PER_ADDRESS: z.coerce.number().int().min(1).default(64),
  /**
   * How long one of someone's streams has been open, in ms, before it can be ended to make room for another of theirs at their
   * limit (live/hub.ts): one just opened is likelier a tab that's still there than one that went unheard.
   */
  LIVE_MAKE_ROOM_MS: z.coerce.number().int().min(0).default(20_000),
  /** How many workers open documents. The first takes big ones. */
  DOC_WORKERS: z.coerce.number().int().min(1).max(8).default(2),
  /** How long a worker has for one job on a document, in ms. */
  DOC_WORK_MS: z.coerce.number().int().min(1).default(20_000),
  /** How much memory the worker for big documents has, in MiB. A document at its ceilings, of the worst shapes measured, peaks at about 550. */
  DOC_HEAP_MB: z.coerce.number().int().min(16).default(640),
  /** The most separate items a document's page can hold, which is what its memory follows: real blocks hold about 650 to 1,000 bytes an item once open, and a document opens and folds at its ceilings inside DOC_HEAP_MB. */
  DOC_ITEMS_MAX: z.coerce.number().int().min(1).default(MAX_DOC_ITEMS),
  /** How many jobs one person can have waiting for a worker: past this their browser is told to try again. */
  DOC_WAITING_PER_PERSON: z.coerce.number().int().min(1).default(32),
  /** How much of documents can be on its way to browsers at once, in MiB, and a quarter of that for any one person or address: past it, opening a big one waits for the browser to try again, and a stream that can't have its next line is let go of. */
  DOC_SENDING_MB: z.coerce.number().int().min(1).default(64),
  /** How many reads of a version an instance serves at once: each holds a request for as long as its reader takes. */
  DOC_VERSION_READS: z.coerce.number().int().min(1).default(8),
  /** How long someone stays here in a workspace after their browser last said so, in ms. Browsers say so every 10 seconds. */
  LIVE_PRESENCE_MS: z.coerce.number().int().min(10).default(30_000),
  /** debug | info | warn | error | silent. */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  /** json for log collectors (Cloud Run), pretty for a terminal. */
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
});
export type Env = z.infer<typeof EnvSchema>;
/** The settings the server runs with: the environment, and its two keys from wherever they come from. */
export type Config = Omit<Env, 'KMASTER' | 'KSERVICE'> & { KMASTER: string; KSERVICE: string };

const invalid = (lines: string[]) => new Error(`Invalid environment:\n${lines.map((l) => `  ${l}`).join('\n')}`);

/** The environment as settings, before the keys are resolved. */
export function loadEnv(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const r = EnvSchema.safeParse({ ...env, ...overrides });
  if (!r.success) throw invalid(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  return r.data;
}

/**
 * The settings with the server's keys. Outside a TEE they come from the environment. Inside one they
 * come only from the TEE's key service, and keys in the environment are refused: whoever can set
 * them would hold them too. For the same reason, inside a TEE inference is verified only against the
 * built-in roots, with Intel's and NVIDIA's own services.
 */
export async function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Record<keyof Env, string>> = {}): Promise<Config> {
  const e = loadEnv(env, overrides);
  if (e.TEE === 'dstack') {
    if (e.KMASTER || e.KSERVICE) throw invalid(['KMASTER, KSERVICE: inside a TEE the keys come from its key service. Remove them from the environment.']);
    const set = [
      ...(e.INTEL_ROOT_CA !== INTEL_SGX_ROOT_CA ? ['INTEL_ROOT_CA'] : []), ...(e.NVIDIA_ROOT_CA !== NVIDIA_NRAS_ROOT_CA ? ['NVIDIA_ROOT_CA'] : []),
      ...(e.INTEL_PCS_URL !== INTEL_PCS ? ['INTEL_PCS_URL'] : []), ...(e.NVIDIA_NRAS_URL !== NVIDIA_NRAS ? ['NVIDIA_NRAS_URL'] : [])
    ];
    if (set.length) throw invalid([`${set.join(', ')}: inside a TEE, inference is verified only against the built-in roots and Intel’s and NVIDIA’s own services. Remove them from the environment.`]);
    return { ...e, ...(await teeKeys(e.DSTACK_SOCKET)) };
  }
  if (!e.KMASTER || !e.KSERVICE) throw invalid(['KMASTER, KSERVICE: both are required outside a TEE.']);
  return { ...e, KMASTER: e.KMASTER, KSERVICE: e.KSERVICE };
}
