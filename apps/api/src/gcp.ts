/*
 * Google Cloud, as the API reaches it inside Confidential Space (docs: privacy-keys-and-sessions › Moving to confidential
 * computing). Nothing here asks as the VM. Secret Manager and Cloud KMS answer only the identity the VM's attestation is
 * exchanged for through Workload Identity Federation, so they serve a build Google attests to and the key's policy allows,
 * never whoever runs the VM. The launcher keeps a fresh attestation token in a file, and Google's Security Token Service
 * exchanges it for an access token for that identity. Plain fetch, and every answer parsed.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { SecretSetting, TeeBoot, TeeKeys } from './config';
import { InternalError, KeyError, UnavailableError } from './errors';
import { log } from './log';
import type { KeyWrapper } from './serverKeys';

const glog = log.child({ component: 'gcp' });

/**
 * Where Google Cloud's services are: Google's own, or a test's stand-ins, chosen in one place (start.ts › OUTSIDE) and passed
 * down to every call. Never from the environment, which whoever runs the VM sets: what goes to these is the attestation token
 * and the access token it's exchanged for, either of which opens the master's key to whoever holds it.
 */
export interface GoogleCloud {
  sts: string;
  secretManager: string;
  kms: string;
  /** The attestation token the launcher keeps fresh, for the Security Token Service (its audience). */
  tokenFile: string;
}
export const GOOGLE_CLOUD: GoogleCloud = {
  sts: 'https://sts.googleapis.com',
  secretManager: 'https://secretmanager.googleapis.com',
  kms: 'https://cloudkms.googleapis.com',
  tokenFile: '/run/container_launcher/attestation_verifier_claims_token'
};

/** An access token is exchanged again this long before it runs out. */
const EARLY_MS = 5 * 60_000;
const TIMEOUT_MS = 15_000;
/** Binds what Cloud KMS wraps to what it's for: a master wrapped for anything else doesn't unwrap as one. */
const MASTER_AAD = Buffer.from('alcove/master/v1').toString('base64');

const StsAnswer = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() });
const StsRefusal = z.object({ error: z.string() });
/** Google's APIs say why they refused in `error.status`, such as PERMISSION_DENIED or NOT_FOUND. */
const ApiRefusal = z.object({ error: z.object({ status: z.string() }) });
const SecretAnswer = z.object({ payload: z.object({ data: z.string() }) });
const Encrypted = z.object({ ciphertext: z.string().min(1) });
const Decrypted = z.object({ plaintext: z.string() });

/** An access token for the attested identity. */
type AttestedIdentity = () => Promise<string>;

/** Google's answer: its status, for the caller to read, and the time Google said it answered at, with when this asked and heard back. */
interface Answer { status: number; ok: boolean; body: unknown; date: string | null; sent: number; received: number }

/** One request to Google, with a time limit, timed in the log. */
async function ask(service: string, url: string, init: RequestInit): Promise<Answer> {
  const t0 = performance.now();
  const sent = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new UnavailableError('Google Cloud couldn’t be reached.', { cause: e, context: { service, ms: Math.round(performance.now() - t0) } });
  }
  const received = Date.now();
  const body: unknown = await res.json().catch(() => undefined);
  glog.debug('google cloud answered', { service, status: res.status, ms: Math.round(performance.now() - t0) });
  return { status: res.status, ok: res.ok, body, date: res.headers.get('date'), sent, received };
}

/**
 * How far this VM's clock is behind Google's, in whole seconds, by the time Google answered `a` at (its Date header), logged
 * at every exchange. Confidential Space's VMs ran 7–9.5 s behind on 2026-11-13, drifting about a second a day, and every
 * check of a token another service dated by its own clock allows a minute for it (evidence.ts, livekit.ts, google.ts), so
 * past half that it warns.
 */
function logClockOffset(a: Answer): void {
  const google = a.date === null ? Number.NaN : Date.parse(a.date);
  if (!Number.isFinite(google)) return;
  // The header is in whole seconds: Google's clock read within the second after it, while the request was out.
  const behindGoogleS = Math.round((google + 500 - (a.sent + a.received) / 2) / 1000);
  glog.at(Math.abs(behindGoogleS) > 30 ? 'warn' : 'info', 'clock offset', { behindGoogleS, roundTripMs: a.received - a.sent });
}
const refusal = (body: unknown) => { const r = ApiRefusal.safeParse(body); return r.success ? r.data.error.status : undefined; };

/**
 * The identity this VM's attestation is exchanged for (`provider`, a Workload Identity Federation provider): an access
 * token for it, kept until shortly before it runs out, and one exchange at a time.
 */
function attestedIdentity(provider: string, at: GoogleCloud): AttestedIdentity {
  let held: { token: string; until: number } | undefined;
  let asking: Promise<string> | undefined;
  const exchange = async (): Promise<string> => {
    // Read each time: the launcher puts a fresh token there well before the last one runs out.
    let subjectToken: string;
    try {
      subjectToken = (await readFile(at.tokenFile, 'utf8')).trim();
    } catch (e) {
      throw new KeyError('There’s no attestation token to exchange: this isn’t running in Confidential Space.', { cause: e, context: { tokenFile: at.tokenFile } });
    }
    const r = await ask('sts', `${at.sts}/v1/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grantType: 'urn:ietf:params:oauth:grant-type:token-exchange', audience: `//iam.googleapis.com/${provider}`,
        scope: 'https://www.googleapis.com/auth/cloud-platform', requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
        subjectToken, subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt'
      })
    });
    if (!r.ok) {
      // Its error code (unauthorized_client when the attestation doesn't meet the provider's condition), never its description.
      const why = StsRefusal.safeParse(r.body);
      throw new KeyError(`Google’s Security Token Service refused this VM’s attestation for ${provider}.`, { context: { status: r.status, error: why.success ? why.data.error : undefined } });
    }
    const answer = StsAnswer.safeParse(r.body);
    if (!answer.success) throw new InternalError('Google’s Security Token Service answered with something that isn’t a token.', { context: { issues: answer.error.issues.length } });
    held = { token: answer.data.access_token, until: Date.now() + answer.data.expires_in * 1000 - EARLY_MS };
    glog.info('attestation exchanged for an access token', { expiresInS: answer.data.expires_in });
    logClockOffset(r);
    return answer.data.access_token;
  };
  return () => {
    if (held && held.until > Date.now()) return Promise.resolve(held.token);
    asking ??= exchange().finally(() => { asking = undefined; });
    return asking;
  };
}

/** The latest version of a secret in `project`'s Secret Manager, as the attested identity reads it, trimmed. */
async function readSecret(project: string, name: string, identity: AttestedIdentity, at: GoogleCloud): Promise<string> {
  const r = await ask('secret-manager', `${at.secretManager}/v1/projects/${project}/secrets/${name}/versions/latest:access`, {
    headers: { authorization: `Bearer ${await identity()}` }
  });
  if (!r.ok) throw new KeyError(`Secret Manager didn’t give this VM’s attested identity the secret ${name}.`, { context: { secret: name, status: r.status, reason: refusal(r.body) } });
  const answer = SecretAnswer.safeParse(r.body);
  if (!answer.success) throw new InternalError(`Secret Manager answered with something that isn’t the secret ${name}.`, { context: { secret: name } });
  return Buffer.from(answer.data.payload.data, 'base64').toString('utf8').trim();
}

/**
 * Cloud KMS's `key` (projects/…/cryptoKeys/…) as the master's wrapper: it wraps and unwraps only for the attested identity,
 * which the key's policy grants to the builds it allows. What's stored is Cloud KMS's ciphertext, as it returns it.
 */
function cloudKmsWrapper(key: string, identity: AttestedIdentity, at: GoogleCloud): KeyWrapper {
  const use = async (op: 'encrypt' | 'decrypt', value: Uint8Array): Promise<string> => {
    const field = op === 'encrypt' ? 'plaintext' : 'ciphertext';
    const r = await ask('kms', `${at.kms}/v1/${key}:${op}`, {
      method: 'POST', headers: { authorization: `Bearer ${await identity()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ [field]: Buffer.from(value).toString('base64'), additionalAuthenticatedData: MASTER_AAD })
    });
    if (!r.ok) throw new KeyError(`Cloud KMS refused to ${op} with ${key}.`, { context: { key, op, status: r.status, reason: refusal(r.body) } });
    const answer = (op === 'encrypt' ? Encrypted.transform((a) => a.ciphertext) : Decrypted.transform((a) => a.plaintext)).safeParse(r.body);
    if (!answer.success) throw new InternalError(`Cloud KMS answered ${op} with ${key} with something it doesn’t say.`, { context: { key, op } });
    return answer.data;
  };
  return {
    key,
    wrap: async (plaintext) => new Uint8Array(Buffer.from(await use('encrypt', plaintext), 'base64')),
    unwrap: async (ciphertext) => new Uint8Array(Buffer.from(await use('decrypt', ciphertext), 'base64'))
  };
}

/** What a server in Confidential Space reads before it starts, through its attested identity. */
export interface FromGoogleCloud extends TeeKeys {
  /** The settings that are secrets (SECRETS), by setting: given to the configuration beside the environment, never put in it. */
  secrets: Partial<Record<SecretSetting['setting'], string>>;
}

/** The settings that are secrets, the old keys and Cloud KMS, for a server starting in Confidential Space (`tee`), from Google Cloud (`at`). */
export async function fromGoogleCloud(tee: TeeBoot, at: GoogleCloud): Promise<FromGoogleCloud> {
  const identity = attestedIdentity(tee.provider, at);
  const read = (name: string) => readSecret(tee.project, name, identity, at);
  const secrets: Partial<Record<SecretSetting['setting'], string>> = {};
  await Promise.all(tee.secrets.map(async ({ setting, secret }) => { secrets[setting] = await read(secret); }));
  const legacy = tee.legacy ? { kmaster: await read(tee.legacy.kmaster), kservice: await read(tee.legacy.kservice) } : undefined;
  glog.info('secrets read', { settings: tee.secrets.map((w) => w.setting), oldKeys: legacy !== undefined });
  return { secrets, legacy, wrapper: cloudKmsWrapper(tee.kmsKey, identity, at) };
}
