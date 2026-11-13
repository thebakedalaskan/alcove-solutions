/*
 * Stand-ins for what the API reaches inside Google Cloud Confidential Space, for integration tests (docs:
 * privacy-keys-and-sessions › Moving to confidential computing):
 * - the launcher, on a unix socket: PKI attestation tokens for an audience and nonces, signed RS256 by a leaf whose x5c
 *   chain (leaf, intermediate, root) ends at a test root standing in for Google's Confidential Space root, with the claims
 *   a production image on Intel TDX gives, naming the release key it found the image signed with; and the token file it
 *   keeps fresh for Workload Identity Federation. `mint` makes the same tokens spoiled one way, for a check to refuse;
 * - one HTTP server for Google's Security Token Service, which exchanges only a token the launcher wrote for the provider,
 *   and Secret Manager and Cloud KMS, which answer only the access tokens it gave out, never anyone else's.
 * Cloud KMS wraps under a key of its own with AES-256-GCM, binding the associated data it's given, so what it wraps is
 * real ciphertext that it alone unwraps.
 */
import { SignJWT } from 'jose';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { GoogleCloud } from '../gcp';
import { issue, type Issued } from './pki';

export const PRODUCTION_IMAGE = 'us-central1-docker.pkg.dev/alcove-solutions/alcove/api';
const STS_AUDIENCE = 'https://sts.googleapis.com';
const PROJECT_NUMBER = '123456789012';

/**
 * One way a token can be wrong, each of which a client refuses: debuggable, not on Google's stable image, not TDX, not
 * Confidential Space, from another issuer, expired, dated ahead, too old, an image from elsewhere, no signature of the
 * release key on it, from another project; signed under another root, by an intermediate that isn't a CA, by a leaf that's
 * run out, or with a signature that doesn't check out.
 */
export type TokenSpoil =
  | 'debuggable' | 'not-stable' | 'not-tdx' | 'not-confidential-space' | 'another-issuer' | 'expired' | 'ahead' | 'too-old'
  | 'another-image' | 'unsigned' | 'another-project' | 'another-root' | 'not-a-ca' | 'run-out' | 'bad-signature';

export interface FakeGcp {
  /** Where the API reaches Google Cloud here, and the token file the launcher keeps. */
  google: GoogleCloud;
  /** The launcher's socket. */
  launcher: string;
  /** The root the launcher's PKI tokens chain to, standing in for Google's Confidential Space root. */
  rootPem: string;
  /** The image the attested VM runs, by digest, and that digest. */
  image: string;
  digest: string;
  /** The project the VM runs in, by number, as tokens name it. */
  projectNumber: string;
  /** A PKI token as the launcher makes one for `audience` and `nonces`, but for `spoil`. */
  mint(audience: string, nonces: string[], spoil?: TokenSpoil): Promise<string>;
  /** What Cloud KMS has given back from encrypt, oldest first. */
  wrapped: Uint8Array[];
  /** When set, Cloud KMS refuses, as it does a build the key's policy doesn't allow. */
  refuse: boolean;
  /** Every attestation token the Security Token Service exchanged, the access tokens it gave for them, and every secret Secret Manager gave, by name. */
  exchanged: string[];
  accessTokens: string[];
  read: string[];
  /** Every PKI token the launcher made, and every request it was sent. */
  tokens: string[];
  asked: number;
  /** How far back the launcher dates the tokens it makes, how long it takes, and whether it fails. */
  backdateMs: number;
  delayMs: number;
  fail: boolean;
  /** How far Google's clock is ahead of the API's: the Security Token Service's answers say it in their Date header. */
  clockAheadMs: number;
  /** Writes a fresh token to the token file, as the launcher does before the last one runs out. */
  refresh(): Promise<string>;
  close(): Promise<void>;
}

const read = async (req: IncomingMessage) => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c)); return Buffer.concat(chunks).toString('utf8'); };
const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const STATUS: Record<number, string> = { 400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND' };
const refused = (res: ServerResponse, status: number, reason: string) => json(res, status, { error: { code: status, message: reason, status: STATUS[status] ?? 'UNKNOWN' } });

const TokenRequest = z.object({ audience: z.string(), token_type: z.string(), nonces: z.array(z.string()).optional() }).strict();
const StsRequest = z.object({
  grantType: z.literal('urn:ietf:params:oauth:grant-type:token-exchange'), audience: z.string(), scope: z.literal('https://www.googleapis.com/auth/cloud-platform'),
  requestedTokenType: z.literal('urn:ietf:params:oauth:token-type:access_token'), subjectToken: z.string(), subjectTokenType: z.literal('urn:ietf:params:oauth:token-type:jwt')
});
const KmsRequest = z.object({ plaintext: z.string().optional(), ciphertext: z.string().optional(), additionalAuthenticatedData: z.string().default('') });

/**
 * Google Cloud as a VM in project `project` sees it: Secret Manager holding `secrets` (by name), Cloud KMS's `key`, and the
 * Workload Identity Federation `provider` the launcher's tokens are exchanged with. `releaseKeySpki`: the key Confidential
 * Space finds the image signed with (DER SubjectPublicKeyInfo); without it, one nobody has.
 */
export async function startFakeGcp(o: { project: string; provider: string; key: string; secrets: Record<string, string>; releaseKeySpki?: Uint8Array | undefined }): Promise<FakeGcp> {
  const dir = await mkdtemp(join(tmpdir(), 'alcove-cs-'));
  const tokenFile = join(dir, 'attestation_verifier_claims_token');
  const socket = join(dir, 'teeserver.sock');
  const org = 'Alcove Tests (Google stand-in)';
  const root = issue({ commonName: 'Alcove Test Confidential Space Root CA', organization: org, curve: 'RSA', ca: true });
  const intermediate = issue({ commonName: 'Alcove Test Confidential Space Intermediate CA', organization: org, curve: 'RSA', issuer: root, ca: true });
  const leaf = issue({ commonName: 'Alcove Test Confidential Space Signer', organization: org, curve: 'RSA', issuer: intermediate, ca: false });
  const x5c = [leaf.der, intermediate.der, root.der].map((d) => d.toString('base64'));
  const digest = `sha256:${randomBytes(32).toString('hex')}`;
  const releaseKeyId = o.releaseKeySpki ? createHash('sha256').update(o.releaseKeySpki).digest('hex') : randomBytes(32).toString('hex');
  const kmsKey = randomBytes(32);
  const stsIssued = new Set<string>();
  const defaultTokens = new Set<string>();
  /** Chains a spoiled token is signed under, made when first wanted: another root, an intermediate that isn't a CA, a leaf that ran out. */
  const elsewhere = new Map<'another-root' | 'not-a-ca' | 'run-out', { x5c: string[]; key: Issued['key'] }>();
  const chainFor = (spoil: TokenSpoil | undefined): { x5c: string[]; key: Issued['key'] } => {
    if (spoil !== 'another-root' && spoil !== 'not-a-ca' && spoil !== 'run-out') return { x5c, key: leaf.key };
    const made = elsewhere.get(spoil);
    if (made) return made;
    const top = spoil === 'another-root' ? issue({ commonName: 'Another Root CA', organization: 'Someone Else', curve: 'RSA', ca: true }) : root;
    const middle = issue({ commonName: 'Alcove Test Confidential Space Intermediate CA', organization: org, curve: 'RSA', issuer: top, ca: spoil !== 'not-a-ca' });
    const past = spoil === 'run-out' ? { notBefore: new Date(Date.now() - 30 * 86_400_000), notAfter: new Date(Date.now() - 86_400_000) } : {};
    const signer = issue({ commonName: 'Alcove Test Confidential Space Signer', organization: org, curve: 'RSA', issuer: middle, ca: false, ...past });
    const chain = { x5c: [signer.der, middle.der, top.der].map((d) => d.toString('base64')), key: signer.key };
    elsewhere.set(spoil, chain);
    return chain;
  };

  /** A token as the launcher makes it, for `audience`, carrying `nonces`; or spoiled one way. */
  const token = async (audience: string, nonces: string[] | undefined, pki: boolean, spoil?: TokenSpoil) => {
    const now = Math.floor((Date.now() - self.backdateMs) / 1000);
    const iat = spoil === 'too-old' ? now - 26 * 60 : spoil === 'ahead' ? now + 10 * 60 : now;
    const signer = chainFor(spoil);
    const signed = await new SignJWT({
      aud: audience, iss: spoil === 'another-issuer' ? 'https://attestation.example' : 'https://confidentialcomputing.googleapis.com',
      sub: `https://www.googleapis.com/compute/v1/projects/${o.project}/zones/us-central1-a/instances/alcove-api-test`,
      iat, nbf: iat, exp: spoil === 'expired' ? now - 60 : iat + 3600, jti: randomUUID(),
      ...(nonces?.length ? { eat_nonce: nonces.length === 1 ? nonces[0] : nonces } : {}),
      eat_profile: 'https://cloud.google.com/confidential-computing/confidential-space/docs/reference/token-claims',
      secboot: true, oemid: 11129, hwmodel: spoil === 'not-tdx' ? 'GCP_AMD_SEV' : 'GCP_INTEL_TDX', swname: spoil === 'not-confidential-space' ? 'GCE' : 'CONFIDENTIAL_SPACE',
      swversion: ['261001'], dbgstat: spoil === 'debuggable' ? 'enabled' : 'disabled-since-boot', attester_tcb: ['INTEL'],
      google_service_accounts: [`alcove-cs@${o.project}.iam.gserviceaccount.com`],
      submods: {
        confidential_space: { support_attributes: spoil === 'not-stable' ? ['EXPERIMENTAL'] : ['LATEST', 'STABLE', 'USABLE'], monitoring_enabled: { memory: false } },
        container: {
          image_reference: `${spoil === 'another-image' ? 'docker.io/someone/api' : PRODUCTION_IMAGE}@${digest}`, image_digest: digest, image_id: `sha256:${randomBytes(32).toString('hex')}`, restart_policy: 'OnFailure',
          args: ['node', 'dist/server.js'], env: { TEE: 'confidential-space', HOSTNAME: 'alcove-api-test' }, env_override: {},
          image_signatures: [{ key_id: spoil === 'unsigned' ? randomBytes(32).toString('hex') : releaseKeyId, signature: randomBytes(64).toString('base64'), signature_algorithm: 'ECDSA_P256_SHA256' }]
        },
        gce: { zone: 'us-central1-a', project_id: o.project, project_number: spoil === 'another-project' ? '999999999999' : PROJECT_NUMBER, instance_name: 'alcove-api-test', instance_id: '7341234567890123456' }
      }
    }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(pki ? { x5c: signer.x5c } : { kid: 'alcove-test-signer' }) }).sign(signer.key);
    if (spoil !== 'bad-signature') return signed;
    // Another token's signature: well formed, but not over this one.
    const other = await new SignJWT({ aud: audience }).setProtectedHeader({ alg: 'RS256' }).sign(signer.key);
    return `${signed.slice(0, signed.lastIndexOf('.'))}${other.slice(other.lastIndexOf('.'))}`;
  };

  /* The launcher: tokens on a unix socket, answered as it answers them (plain text, 400 for a bad request). */
  const launcher: Server = createServer((req, res) => {
    void (async () => {
      self.asked++;
      const text = await read(req);
      if (req.method !== 'POST' || req.url !== '/v1/token') { res.writeHead(404); res.end('not found'); return; }
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = undefined; }
      const r = TokenRequest.safeParse(body);
      const nonces = r.success ? r.data.nonces ?? [] : [];
      if (!r.success || !r.data.audience || r.data.audience === STS_AUDIENCE || r.data.audience.length > 512 || nonces.length > 6 || nonces.some((n) => Buffer.byteLength(n) < 10 || Buffer.byteLength(n) > 74)) {
        res.writeHead(400, { 'content-type': 'text/plain' }); res.end('invalid token request'); return;
      }
      if (r.data.token_type !== 'PKI') { res.writeHead(400, { 'content-type': 'text/plain' }); res.end('only PKI tokens here'); return; }
      await new Promise((resolve) => setTimeout(resolve, self.delayMs));
      if (self.fail) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('rpc error: code = Unavailable desc = the attestation service is unavailable'); return; }
      const t = await token(r.data.audience, nonces, true);
      self.tokens.push(t);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(t);
    })();
  });
  await new Promise<void>((resolve) => launcher.listen(socket, resolve));

  /* Google's APIs: the Security Token Service, Secret Manager and Cloud KMS. */
  const api: Server = createServer((req, res) => {
    void (async () => {
      const text = await read(req);
      const url = new URL(req.url ?? '/', 'http://google.invalid');
      let body: unknown;
      try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
      if (req.method === 'POST' && url.pathname === '/sts/v1/token') {
        const r = StsRequest.safeParse(body);
        if (!r.success) return json(res, 400, { error: 'invalid_request' });
        if (r.data.audience !== `//iam.googleapis.com/${o.provider}`) return json(res, 400, { error: 'invalid_target' });
        if (!defaultTokens.has(r.data.subjectToken)) return json(res, 400, { error: 'invalid_grant' });
        self.exchanged.push(r.data.subjectToken);
        const access = `ya29.federated-${randomBytes(24).toString('base64url')}`;
        stsIssued.add(access);
        self.accessTokens.push(access);
        res.setHeader('date', new Date(Date.now() + self.clockAheadMs).toUTCString());
        return json(res, 200, { access_token: access, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 3600 });
      }
      // Only the attested identity, never the VM's or anyone else's.
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!bearer || !stsIssued.has(bearer)) return refused(res, 401, 'Request had invalid authentication credentials.');
      const secret = new RegExp(`^/secretmanager/v1/projects/${o.project}/secrets/([A-Za-z0-9_-]+)/versions/latest:access$`).exec(url.pathname)?.[1];
      if (req.method === 'GET' && secret !== undefined) {
        const value = o.secrets[secret];
        if (value === undefined) return refused(res, 404, `Secret [projects/123456789012/secrets/${secret}] not found or has no versions.`);
        self.read.push(secret);
        return json(res, 200, { name: `projects/123456789012/secrets/${secret}/versions/1`, payload: { data: Buffer.from(value).toString('base64'), dataCrc32c: '0' } });
      }
      const op = new RegExp(`^/kms/v1/${o.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(encrypt|decrypt)$`).exec(url.pathname)?.[1];
      if (req.method === 'POST' && op) {
        if (self.refuse) return refused(res, 403, `Permission 'cloudkms.cryptoKeyVersions.useTo${op === 'encrypt' ? 'Encrypt' : 'Decrypt'}' denied on resource '${o.key}' (or it may not exist).`);
        const r = KmsRequest.safeParse(body);
        if (!r.success) return refused(res, 400, 'Invalid request.');
        const aad = Buffer.from(r.data.additionalAuthenticatedData, 'base64');
        if (op === 'encrypt' && r.data.plaintext !== undefined) {
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', kmsKey, iv).setAAD(aad);
          const sealed = Buffer.concat([iv, cipher.update(Buffer.from(r.data.plaintext, 'base64')), cipher.final(), cipher.getAuthTag()]);
          self.wrapped.push(new Uint8Array(sealed));
          return json(res, 200, { name: `${o.key}/cryptoKeyVersions/1`, ciphertext: sealed.toString('base64'), protectionLevel: 'SOFTWARE' });
        }
        if (op === 'decrypt' && r.data.ciphertext !== undefined) {
          const sealed = Buffer.from(r.data.ciphertext, 'base64');
          try {
            const decipher = createDecipheriv('aes-256-gcm', kmsKey, sealed.subarray(0, 12)).setAAD(aad);
            decipher.setAuthTag(sealed.subarray(sealed.length - 16));
            const plain = Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
            return json(res, 200, { plaintext: plain.toString('base64'), usedPrimary: true, protectionLevel: 'SOFTWARE' });
          } catch {
            return refused(res, 400, 'Decryption failed: the ciphertext is invalid.');
          }
        }
        return refused(res, 400, 'Invalid request.');
      }
      res.writeHead(404); res.end();
    })();
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const at = api.address();
  const origin = `http://127.0.0.1:${typeof at === 'object' && at ? at.port : 0}`;

  const self: FakeGcp = {
    google: { sts: `${origin}/sts`, secretManager: `${origin}/secretmanager`, kms: `${origin}/kms`, tokenFile },
    launcher: socket, rootPem: root.pem, image: `${PRODUCTION_IMAGE}@${digest}`, digest, projectNumber: PROJECT_NUMBER,
    mint: (audience, nonces, spoil) => token(audience, nonces, true, spoil),
    wrapped: [], refuse: false, exchanged: [], accessTokens: [], read: [], tokens: [], asked: 0, backdateMs: 0, delayMs: 0, fail: false, clockAheadMs: 0,
    async refresh() {
      const t = await token(STS_AUDIENCE, undefined, false);
      defaultTokens.add(t);
      await writeFile(tokenFile, t);
      return t;
    },
    async close() {
      await Promise.all([new Promise<void>((r) => launcher.close(() => r())), new Promise<void>((r) => api.close(() => r()))]);
      launcher.closeAllConnections();
      api.closeAllConnections();
      await rm(dir, { recursive: true, force: true });
    }
  };
  await self.refresh();
  return self;
}

/** The SHA-256 of a DER SubjectPublicKeyInfo, base64url, as the attestation's spki: nonce carries it. */
export const spkiHash = (spkiDer: Uint8Array) => createHash('sha256').update(spkiDer).digest('base64url');
