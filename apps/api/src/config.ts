import { X509Certificate } from 'node:crypto';
import { MAX_DOC_ITEMS } from '@alcove/api';
import type pg from 'pg';
import { z } from 'zod';
import { KeyError } from './errors';
import { INTEL_SGX_ROOT_CA, NVIDIA_NRAS_ROOT_CA } from './roots';
import { resolveKeys, type KeyWrapper, type LegacyKeys } from './serverKeys';

/** An optional setting: unset, or set to nothing (as in .env.example), means it isn't configured. */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = z.preprocess(blank, z.string().min(1).optional());

const Key = (name: string) => z.string().regex(/^[A-Za-z0-9_-]{43}$/, `${name} must be 32 bytes, base64url`);
/** A secret's name in Secret Manager. */
const SECRET_NAME = '[A-Za-z0-9_-]{1,255}';
/** A host name, as a certificate names it: lower case, labels of letters, digits and hyphens. */
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
/** Hosts, comma-separated: each one the certificate names, and every `www.` one's apex beside it, which it's sent on to. */
const Hosts = z.string().transform((value) => value.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)).pipe(
  z.array(z.string().regex(HOST, 'TLS_HOSTS must be host names, comma-separated')).min(1, 'TLS_HOSTS names no host')
    .refine((hosts) => new Set(hosts).size === hosts.length, 'TLS_HOSTS names a host twice')
    .refine((hosts) => hosts.every((h) => !h.startsWith('www.') || hosts.includes(h.slice(4))), 'TLS_HOSTS has a www. host without the host it sends people on to')
).readonly();
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
   * Where the API runs. `none`: an ordinary server, with KMASTER and KSERVICE from the environment. `confidential-space`:
   * Google Cloud Confidential Space on Intel TDX, where the master key is made inside the TEE and kept wrapped by Cloud KMS,
   * and seals the server's other keys in the database (serverKeys.ts). Neither KMASTER nor KSERVICE may be in the
   * environment there, and nothing secret should be: Confidential Space puts the environment's values in its attestation.
   */
  TEE: z.enum(['none', 'confidential-space']).default('none'),
  /** The commit this image was built from, baked in at build time; /health and /v1/attestation report it. */
  ALCOVE_COMMIT: z.string().regex(/^(?:[0-9a-f]{7,40}|dev)$/).default('dev'),
  /** Wraps every account's root key. Outside a TEE only; inside, the master is made there and kept wrapped by Cloud KMS. */
  KMASTER: Key('KMASTER').optional(),
  /** Seals billing state. Separate from KMASTER: billing never needs owner keys. Outside a TEE only; inside, the server keys carry it. */
  KSERVICE: Key('KSERVICE').optional(),
  /** Inside a TEE: forget the old master for good, which it refuses while any account's root key is only under the old one. */
  RETIRE_LEGACY_KMASTER: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  /** Inside a TEE: the Google Cloud project whose Secret Manager holds the provider secrets. */
  GCP_PROJECT: z.preprocess(blank, z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'GCP_PROJECT must be a project ID').optional()),
  /** Inside a TEE: the Cloud KMS key that wraps the master, projects/…/locations/…/keyRings/…/cryptoKeys/…. */
  KMS_MASTER_KEY: z.preprocess(blank, z.string().regex(/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/, 'KMS_MASTER_KEY must be projects/…/locations/…/keyRings/…/cryptoKeys/…').optional()),
  /**
   * Inside a TEE: the Workload Identity Federation provider its attestation token is exchanged with, for the identity Cloud
   * KMS and Secret Manager serve: projects/<number>/locations/global/workloadIdentityPools/…/providers/….
   */
  WIF_PROVIDER: z.preprocess(blank, z.string().regex(/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[^/]+\/providers\/[^/]+$/, 'WIF_PROVIDER must be projects/<number>/locations/global/workloadIdentityPools/…/providers/…').optional()),
  /**
   * Inside a TEE: the settings that are secrets, each read from Secret Manager at start (gcp.ts), never from the environment,
   * whose values Confidential Space puts in its attestation: ENV_NAME=secret-name, comma-separated.
   */
  SECRETS: z.preprocess(blank, z.string().regex(new RegExp(`^[A-Z][A-Z0-9_]*=${SECRET_NAME}(?:,[A-Z][A-Z0-9_]*=${SECRET_NAME})*$`), 'SECRETS must be ENV_NAME=secret-name, comma-separated')
    .transform((v) => v.split(',').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), secret: pair.slice(pair.indexOf('=') + 1) }))).optional()),
  /** Inside a TEE, until the old master is retired: the secrets that hold the old KMASTER and KSERVICE, comma-separated. */
  LEGACY_SECRETS: z.preprocess(blank, z.string().regex(new RegExp(`^${SECRET_NAME},${SECRET_NAME}$`), 'LEGACY_SECRETS must be kmaster-secret,kservice-secret')
    .transform((v) => ({ kmaster: v.slice(0, v.indexOf(',')), kservice: v.slice(v.indexOf(',') + 1) })).optional()),
  /**
   * The hosts TLS ends here for, comma-separated (edge/): the API serves its own HTTPS on HTTPS_PORT, `api.` hosts are the
   * API, `www.` ones are sent on to the host without it, and the rest are the web app from WEB_DIR. Unset, it listens on
   * API_PORT, plain, behind something else's TLS.
   */
  TLS_HOSTS: z.preprocess(blank, Hosts.optional()),
  /**
   * HTTPS, where the load balancer sends 443. Every connection starts with a PROXY protocol v1 line saying whose it is, and
   * one that doesn't is closed. The process runs unprivileged, so it can't take a port below 1024 itself.
   */
  HTTPS_PORT: z.coerce.number().int().min(0).max(65_535).default(8443),
  /** Plain HTTP, where the load balancer sends 80 and its health checks: /health, and everything else sent on to https. */
  HTTP_PORT: z.coerce.number().int().min(0).max(65_535).default(8080),
  /** The web app's built files (apps/web's dist/client, with its _headers), served on the hosts that aren't api. or www. */
  WEB_DIR: z.string().min(1).default('/app/web'),
  /** Where certificates come from: an ACME directory, Let's Encrypt's by default. */
  ACME_DIRECTORY: z.string().url().default('https://acme-v02.api.letsencrypt.org/directory'),
  /** The Cloudflare zone the TLS hosts are in, where ACME's dns-01 challenges go: its ID, or its name if the token may read zones. */
  CLOUDFLARE_ZONE: optional,
  /** A Cloudflare API token that can edit that zone's DNS. A secret: inside a TEE it comes through SECRETS. */
  CLOUDFLARE_API_TOKEN: optional,
  /**
   * The SHA-256, as 64 lowercase hex characters, of the token operators switch feature flags with through the API
   * (POST /v1/operator/feature-flags). A hash, never the token. Unset, that route isn't there.
   */
  OPERATOR_TOKEN_SHA256: z.preprocess(blank, z.string().regex(/^[0-9a-f]{64}$/, 'OPERATOR_TOKEN_SHA256 must be 64 lowercase hex characters, a SHA-256').optional()),
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
  /**
   * How long a browser's stream of rings lasts, at most, before it opens a new one: well inside the load balancer's idle
   * timeout (CS_LB_TIMEOUT), and at most 280, a limit kept from Cloud Run's 300-second request timeout.
   */
  RING_STREAM_SECONDS: z.coerce.number().int().min(1).max(280).default(240),
  /** How often a live stream says it's still there, and checks who's reading it, in ms. */
  LIVE_PING_MS: z.coerce.number().int().min(10).default(25_000),
  /** How long the API keeps a live stream open before letting go, for the browser to open it again: well inside the load balancer's idle timeout (CS_LB_TIMEOUT), so nothing is cut. */
  LIVE_STREAM_MS: z.coerce.number().int().min(10).default(280_000),
  /** How long a read of a file lasts, at most, in ms: well inside the load balancer's idle timeout (CS_LB_TIMEOUT), so a read that stopped can't hold its place for good. A player asks on from where it got to. */
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
   * limit (live/hub.ts): one just opened is likelier a tab that's still there than one that went unheard. It's also how often
   * room is made for them, at most: the tab that gave up its place is refused meanwhile, so tabs take turns slowly.
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
  /** json in production, one object a line, which Cloud Logging reads; pretty for a terminal. */
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
});
type Settings = z.infer<typeof EnvSchema>;

/** Settings only a TEE reads, before anything else: how it reaches Google Cloud through its attestation (gcp.ts). */
const TEE_ONLY = ['GCP_PROJECT', 'KMS_MASTER_KEY', 'WIF_PROVIDER', 'SECRETS', 'LEGACY_SECRETS'] as const;
/**
 * The settings SECRETS may name, inside a TEE: the credentials the providers give Alcove, and Google's tester list, which
 * holds addresses. Nothing else comes from Secret Manager: what decides where people sign in, or what's trusted, is the
 * environment's, which the image's launch policy limits and the attestation shows.
 */
const SECRET_SETTINGS = [
  'DATABASE_URL', 'OBJECTS_ACCESS_KEY', 'OBJECTS_SECRET_KEY', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'NEAR_AI_API_KEY',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_SIGNUP_TESTERS', 'CLOUDFLARE_API_TOKEN'
] as const satisfies readonly (keyof Settings)[];
type SecretName = (typeof SECRET_SETTINGS)[number];
const isSecretName = (name: string): name is SecretName => SECRET_SETTINGS.some((s) => s === name);

/** Where TLS ends in the process (edge/): the hosts its one certificate names, and the Cloudflare zone and token its certificates are got through. */
export interface EdgeSettings { hosts: readonly string[]; zone: string; token: string }
/**
 * Where the keys come from: outside a TEE, KMASTER and KSERVICE from the environment; inside one, Cloud KMS and the server keys
 * in the database (serverKeys.ts), and whether to forget the old master for good.
 */
export type KeyMode = { tee: 'none'; kmaster: string; kservice: string } | { tee: 'confidential-space'; retire: boolean };
/** The settings, from the environment and the secrets, with what depends on where the API runs parsed once, here. */
export type Env = Omit<Settings, 'KMASTER' | 'KSERVICE' | 'RETIRE_LEGACY_KMASTER' | 'TLS_HOSTS' | 'CLOUDFLARE_ZONE' | 'CLOUDFLARE_API_TOKEN' | (typeof TEE_ONLY)[number]> & {
  keys: KeyMode;
  /** With TLS_HOSTS, which a TEE always has: where TLS ends in the process. Unset, it listens on API_PORT, plain, behind something else's TLS. */
  edge: EdgeSettings | undefined;
};
/** The settings the server runs with: the environment, and its keys from wherever they come from (serverKeys.ts). Each key is base64url of 32 bytes. */
export type Config = Omit<Env, 'keys'> & {
  /**
   * The master key now: the environment's outside a TEE; inside one, made there and kept wrapped by Cloud KMS. Inside a TEE it
   * wraps root keys (root_envelope_v2); the keys of call passes, media tokens and sign-in attempts derive from it, and the TLS
   * and ACME account keys. Nothing those seal or sign is kept: what is, is under the keys carried over beside it.
   */
  KMASTER: string;
  KSERVICE: string;
  /** Keys the blind indexes: the one the database's indexes were made with, whatever the master is now. */
  INDEX_KEY: string;
  /** Seals the provider URL in a photo's URL (features/account/photos.ts), which notes keep: the one they were made with, whatever the master is now. */
  PHOTO_KEY: string;
  /** The master from before the TEE, while one is held: it opens root_envelope, and new accounts get one under it too. Outside a TEE it's KMASTER. */
  LEGACY_KMASTER: string | undefined;
};

const invalid = (lines: string[]) => new Error(`Invalid environment:\n${lines.map((l) => `  ${l}`).join('\n')}`);
const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

/** What the server reads of the environment first: enough to log, and inside a TEE to reach Google Cloud for its secrets and keys. */
const BootSchema = EnvSchema.pick({
  TEE: true, ALCOVE_COMMIT: true, WEB_ORIGIN: true, LOG_LEVEL: true, LOG_FORMAT: true, RETIRE_LEGACY_KMASTER: true,
  GCP_PROJECT: true, KMS_MASTER_KEY: true, WIF_PROVIDER: true, SECRETS: true, LEGACY_SECRETS: true
});
type BootSettings = z.infer<typeof BootSchema>;
/** A setting that's a secret, and the secret in Secret Manager it's read from. */
export interface SecretSetting { setting: SecretName; secret: string }
/** Inside a TEE, what it reads through its attestation before anything else (gcp.ts), as names, never values. */
export interface TeeBoot {
  /** The project whose Secret Manager holds the secrets. */
  project: string;
  /** The Cloud KMS key that wraps the master. */
  kmsKey: string;
  /** The Workload Identity Federation provider its attestation is exchanged with. */
  provider: string;
  /** The settings that are secrets, each with its secret. */
  secrets: SecretSetting[];
  /** The secrets that hold the old KMASTER and KSERVICE, while the TEE carries a database's accounts over (LEGACY_SECRETS). */
  legacy: { kmaster: string; kservice: string } | undefined;
}
export type Boot = Pick<BootSettings, 'TEE' | 'ALCOVE_COMMIT' | 'WEB_ORIGIN' | 'LOG_LEVEL' | 'LOG_FORMAT'> & { tee: TeeBoot | undefined };

/**
 * The settings SECRETS names, each with its secret: the settings that are secrets (SECRET_SETTINGS), each once, and none
 * also in the environment, where Confidential Space would put it in its attestation.
 */
function secretSettings(named: { name: string; secret: string }[], env: NodeJS.ProcessEnv, problems: string[]): SecretSetting[] {
  const out: SecretSetting[] = [];
  for (const { name, secret } of named) {
    if (name in BootSchema.shape) problems.push(`SECRETS: ${name} is read before secrets are, so it can’t be one.`);
    else if (name === 'KMASTER' || name === 'KSERVICE') problems.push(`SECRETS: ${name} is never given to a TEE, which makes its own keys.`);
    else if (!isSecretName(name)) problems.push(`SECRETS: ${name} ${name in EnvSchema.shape ? 'isn’t a secret' : 'isn’t a setting'}. Only these come from Secret Manager: ${SECRET_SETTINGS.join(', ')}.`);
    else if (out.some((s) => s.setting === name)) problems.push(`SECRETS: ${name} is named twice.`);
    else if (blank(env[name]) !== undefined) problems.push(`SECRETS: ${name} is in the environment too. Remove it there: the environment is part of the attestation.`);
    else out.push({ setting: name, secret });
  }
  return out;
}

/**
 * Where the API runs, as the settings read first say: inside a TEE, how it reaches Google Cloud, which it can't start without;
 * outside one, none of that may be set. Problems go in `problems`.
 */
function teeBoot(b: BootSettings, env: NodeJS.ProcessEnv, problems: string[]): TeeBoot | undefined {
  if (b.TEE === 'none') {
    const set = TEE_ONLY.filter((name) => b[name] !== undefined);
    if (set.length) problems.push(`${set.join(', ')}: only inside a TEE (TEE=confidential-space), which reads its secrets and keys through its attestation. Remove them.`);
    if (b.RETIRE_LEGACY_KMASTER) problems.push('RETIRE_LEGACY_KMASTER: only inside a TEE (TEE=confidential-space), which carries a database’s accounts over to its own master. Remove it.');
    return undefined;
  }
  const secrets = secretSettings(b.SECRETS ?? [], env, problems);
  const { GCP_PROJECT: project, KMS_MASTER_KEY: kmsKey, WIF_PROVIDER: provider } = b;
  if (!project || !kmsKey || !provider) {
    const missing = Object.entries({ GCP_PROJECT: project, KMS_MASTER_KEY: kmsKey, WIF_PROVIDER: provider }).filter(([, v]) => !v).map(([k]) => k);
    problems.push(`${missing.join(', ')}: inside a TEE the master is wrapped by Cloud KMS, and secrets are read from Secret Manager, through the VM’s attestation, which need them.`);
    return undefined;
  }
  return { project, kmsKey, provider, secrets, legacy: b.LEGACY_SECRETS };
}

/** What the server reads of the environment first, checked: enough to log, and inside a TEE to read its secrets and keys. */
export function loadBoot(env: NodeJS.ProcessEnv = process.env): Boot {
  const r = BootSchema.safeParse(env);
  if (!r.success) throw invalid(issues(r.error));
  const problems: string[] = [];
  const tee = teeBoot(r.data, env, problems);
  if (problems.length) throw invalid(problems);
  const { TEE, ALCOVE_COMMIT, WEB_ORIGIN, LOG_LEVEL, LOG_FORMAT } = r.data;
  return { TEE, ALCOVE_COMMIT, WEB_ORIGIN, LOG_LEVEL, LOG_FORMAT, tee };
}

/**
 * The settings, from the environment and `overrides` (inside a TEE, the secrets read through its attestation, which never go
 * in the environment), checked against where the API runs. Inside a TEE: no keys from the environment, since whoever can set
 * them would hold them too; inference verified only against the built-in roots, with Intel's and NVIDIA's own services, for
 * the same reason; and TLS ending in the process. Outside one: both keys from the environment, and nothing only a TEE reads.
 * With TLS_HOSTS, Cloudflare's zone and token, which certificates come through.
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Record<keyof Settings, string>> = {}): Env {
  const r = EnvSchema.safeParse({ ...env, ...overrides });
  if (!r.success) throw invalid(issues(r.error));
  const s = r.data;
  const problems: string[] = [];
  teeBoot(s, env, problems);
  let keys: KeyMode | undefined;
  if (s.TEE === 'confidential-space') {
    if (s.KMASTER || s.KSERVICE) problems.push('KMASTER, KSERVICE: inside a TEE its keys are made and kept there, and never come from the environment. Remove them.');
    const set = [
      ...(s.INTEL_ROOT_CA !== INTEL_SGX_ROOT_CA ? ['INTEL_ROOT_CA'] : []), ...(s.NVIDIA_ROOT_CA !== NVIDIA_NRAS_ROOT_CA ? ['NVIDIA_ROOT_CA'] : []),
      ...(s.INTEL_PCS_URL !== INTEL_PCS ? ['INTEL_PCS_URL'] : []), ...(s.NVIDIA_NRAS_URL !== NVIDIA_NRAS ? ['NVIDIA_NRAS_URL'] : [])
    ];
    if (set.length) problems.push(`${set.join(', ')}: inside a TEE, inference is verified only against the built-in roots and Intel’s and NVIDIA’s own services. Remove them from the environment.`);
    if (!s.TLS_HOSTS) problems.push('TLS_HOSTS: inside a TEE, TLS ends inside it, where nothing outside can read what browsers send.');
    keys = { tee: 'confidential-space', retire: s.RETIRE_LEGACY_KMASTER };
  } else if (!s.KMASTER || !s.KSERVICE) {
    problems.push('KMASTER, KSERVICE: both are required outside a TEE.');
  } else {
    keys = { tee: 'none', kmaster: s.KMASTER, kservice: s.KSERVICE };
  }
  let edge: EdgeSettings | undefined;
  if (s.TLS_HOSTS) {
    if (s.CLOUDFLARE_ZONE && s.CLOUDFLARE_API_TOKEN) edge = { hosts: s.TLS_HOSTS, zone: s.CLOUDFLARE_ZONE, token: s.CLOUDFLARE_API_TOKEN };
    else problems.push('CLOUDFLARE_ZONE, CLOUDFLARE_API_TOKEN: with TLS_HOSTS, certificates come through Cloudflare’s DNS, which needs both.');
  }
  if (problems.length || !keys) throw invalid(problems);
  const {
    KMASTER: _kmaster, KSERVICE: _kservice, RETIRE_LEGACY_KMASTER: _retire, TLS_HOSTS: _hosts, CLOUDFLARE_ZONE: _zone, CLOUDFLARE_API_TOKEN: _token,
    GCP_PROJECT: _project, KMS_MASTER_KEY: _kmsKey, WIF_PROVIDER: _provider, SECRETS: _secrets, LEGACY_SECRETS: _legacy, ...settings
  } = s;
  return { ...settings, keys, edge };
}

/** Inside a TEE, what its attestation gave it for the keys (gcp.ts): Cloud KMS for the master, and the old keys while it carries them. */
export interface TeeKeys { wrapper: KeyWrapper; legacy: LegacyKeys | undefined }

/**
 * The settings with the server's keys (serverKeys.ts). Outside a TEE they come from the environment. Inside one the master is
 * unwrapped by Cloud KMS (`tee.wrapper`), and the other keys come from what's sealed under it in the database (`pool`,
 * migrated), carried over the first time from the old keys a database's accounts were made under (`tee.legacy`).
 */
export async function loadConfig(e: Env, pool: pg.Pool, tee: TeeKeys | undefined): Promise<Config> {
  const { keys, ...settings } = e;
  if (keys.tee === 'none') return { ...settings, ...(await resolveKeys(pool, keys)) };
  if (!tee) throw new KeyError('Inside a TEE the master is wrapped by Cloud KMS, and nothing here can wrap or unwrap it.');
  return { ...settings, ...(await resolveKeys(pool, { tee: 'confidential-space', wrapper: tee.wrapper, legacy: tee.legacy, retire: keys.retire })) };
}
