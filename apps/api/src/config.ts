import { X509Certificate } from 'node:crypto';
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
  /** NEAR AI's gateway, which serves the attestation reports models are verified with. */
  NEAR_AI_BASE_URL: z.string().url().default('https://cloud-api.near.ai/v1'),
  /** Speech to text for the live transcript. */
  NEAR_AI_STT_MODEL: z.string().min(1).default('openai/whisper-large-v3'),
  /** The speech model's own endpoint: clips go to its /ohttp, sealed to the key its attestation vouches for. */
  NEAR_AI_STT_URL: z.string().url().default('https://whisper-large-v3.completions.near.ai'),
  /** Writes the notes from a transcript and answers questions about them. */
  NEAR_AI_NOTES_MODEL: z.string().min(1).default('z-ai/glm-5.3-flash'),
  /** The notes model's own endpoint: requests go to its /ohttp, sealed to the key its attestation vouches for. */
  NEAR_AI_NOTES_URL: z.string().url().default('https://glm-5-3-flash.completions.near.ai'),
  /** Intel's Provisioning Certification Service: the TCB info, QE identity and revocation lists a TDX quote is checked against. */
  INTEL_PCS_URL: z.string().url().default(INTEL_PCS),
  /** The root every TDX quote and Intel collateral must chain to: Intel's SGX Root CA. Tests set their own. */
  INTEL_ROOT_CA: RootCa('INTEL_ROOT_CA', INTEL_SGX_ROOT_CA),
  /** NVIDIA's Remote Attestation Service, which checks a model's GPU evidence and signs its verdict. */
  NVIDIA_NRAS_URL: z.string().url().default(NVIDIA_NRAS),
  /** The root NRAS's signing keys must chain to: NVIDIA Attestation Service CA 001. Tests set their own. */
  NVIDIA_ROOT_CA: RootCa('NVIDIA_ROOT_CA', NVIDIA_NRAS_ROOT_CA),
  /** At most this many shared-screen frames in one call's notes: about one a minute for four hours. Then screen notes turn off for everyone, saying why. */
  SCREEN_FRAMES_MAX: z.coerce.number().int().min(1).max(10_000).default(240),
  /** How long a browser's stream of rings lasts, at most, before it opens a new one: under Cloud Run's 300-second request timeout. */
  RING_STREAM_SECONDS: z.coerce.number().int().min(1).max(280).default(240),
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
