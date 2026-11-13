/*
 * The API in Google Cloud Confidential Space (docs: privacy-keys-and-sessions › Moving to confidential computing, and
 * system-architecture › The edge), started as production starts it (start.ts), against stand-ins for Google Cloud and the
 * launcher (testing/fake-gcp.ts), Sigstore's public log (testing/fake-rekor.ts), an ACME CA and Cloudflare's DNS
 * (testing/fake-acme.ts). Its secrets and the old keys come from Secret Manager through its attestation and nowhere else, its
 * master is wrapped by Cloud KMS, it carries the accounts made before it, it hands out one attestation token naming its TLS
 * key and build with its release from the log, which a browser checks (`verifyServer`) without asking anyone, and it serves
 * the web app and the API over its own TLS, behind the load balancer's PROXY protocol. Browsers reach it as they would:
 * through that TLS, over HTTP/2.
 */
import { AlcoveApiError, type Attestation, type ReleaseEntry } from '@alcove/api';
import { createHttpApi, verifyServer, type VerifyOptions } from '@alcove/api-http';
import { compactVerify, decodeJwt, decodeProtectedHeader } from 'jose';
import { X509Certificate, createPublicKey, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { unb64u } from '../crypto';
import { acmeAccountKey, tlsKey } from '../edge/tlsKeys';
import { KeyError } from '../errors';
import { startServer, type Outside, type Running } from '../start';
import { edgeFetch, edgeHttp1, edgeSession, plainRequest, presented, rawConnection, withoutProxyLine, type EdgeTarget } from '../testing/edge-client';
import { startFakeAcme, type FakeAcme } from '../testing/fake-acme';
import { PRODUCTION_IMAGE, spkiHash, startFakeGcp, type FakeGcp, type TokenSpoil } from '../testing/fake-gcp';
import type { GoogleUser } from '../testing/fake-google';
import { startFakeRekor, type FakeRekor } from '../testing/fake-rekor';
import { cookieFetch, startHarness, type Browser, type Harness } from '../testing/harness';

const COMMIT = '3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345';
const PROJECT = 'alcove-tests';
const KEY = `projects/${PROJECT}/locations/us-central1/keyRings/alcove/cryptoKeys/alcove-master`;
const PROVIDER = 'projects/123456789012/locations/global/workloadIdentityPools/alcove/providers/confidential-space';
const WEB = 'https://alcove.test';
const API = 'https://api.alcove.test';
const marker = (what: string) => `${what}-${randomBytes(24).toString('base64url')}`;
const LIVEKIT_KEY = marker('livekit-key');
const LIVEKIT_SECRET = marker('livekit-secret');
/** The settings that are secrets, each with the secret it's read from. */
const SECRET_NAMES = {
  DATABASE_URL: 'alcove-database-url', OBJECTS_ACCESS_KEY: 'alcove-objects-access-key', OBJECTS_SECRET_KEY: 'alcove-objects-secret-key',
  LIVEKIT_API_KEY: 'alcove-livekit-api-key', LIVEKIT_API_SECRET: 'alcove-livekit-api-secret', GOOGLE_CLIENT_ID: 'alcove-google-client-id',
  GOOGLE_CLIENT_SECRET: 'alcove-google-client-secret', CLOUDFLARE_API_TOKEN: 'alcove-cloudflare-api-token'
};

let h: Harness;
let gcp: FakeGcp;
let acme: FakeAcme;
let rekor: FakeRekor;
let web: string;
const running: Running[] = [];

/** The web app as the image holds it: its build, with the _headers apps/web keeps, the CSP added as csp.mjs adds it. */
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://api.alcove.test; frame-ancestors 'none'";
const SCRIPT = `export const lines = [${Array.from({ length: 200 }, (_, i) => `'line ${i} of the app'`).join(', ')}];\n`;
/** As big as MediaPipe's model, which a call's camera background loads on the same connection as the call's own requests. */
const MODEL_BYTES = 16_400_000;
async function webApp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'alcove-web-'));
  await mkdir(join(dir, 'assets'));
  await mkdir(join(dir, 'people'));
  await mkdir(join(dir, 'mediapipe'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><head><title>Alcove</title><script type="module" src="/assets/app-3f2a1b.js"></script></head><body><div id="app"></div></body></html>');
  await writeFile(join(dir, 'welcome.html'), '<!doctype html><title>Welcome to Alcove</title>');
  await writeFile(join(dir, 'assets', 'app-3f2a1b.js'), SCRIPT);
  await writeFile(join(dir, 'people', 'art-vandelay.jpg'), randomBytes(2048));
  await writeFile(join(dir, 'mediapipe', 'selfie_multiclass_256x256.tflite'), randomBytes(MODEL_BYTES));
  await writeFile(join(dir, '.secret'), 'not served');
  const lines = (await readFile(new URL('../../../web/public/_headers', import.meta.url), 'utf8')).split('\n');
  lines.splice(lines.indexOf('/*') + 1, 0, `  Content-Security-Policy: ${CSP}`);
  await writeFile(join(dir, '_headers'), lines.join('\n'));
  return dir;
}

/** The environment the image and the VM give it: names and flags only, never a secret. */
const env = (more: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  TEE: 'confidential-space', ALCOVE_COMMIT: COMMIT, GCP_PROJECT: PROJECT, KMS_MASTER_KEY: KEY, WIF_PROVIDER: PROVIDER,
  SECRETS: Object.entries(SECRET_NAMES).map(([setting, secret]) => `${setting}=${secret}`).join(','), LEGACY_SECRETS: 'alcove-kmaster,alcove-kservice',
  TLS_HOSTS: 'alcove.test,www.alcove.test,api.alcove.test', HTTPS_PORT: '0', HTTP_PORT: '0', API_HOST: '127.0.0.1', WEB_DIR: web,
  WEB_ORIGIN: WEB, API_URL: API, OBJECTS_ENDPOINT: h.deps.cfg.OBJECTS_ENDPOINT, OBJECTS_BUCKET: h.deps.cfg.OBJECTS_BUCKET,
  LIVEKIT_URL: h.deps.cfg.LIVEKIT_URL, GOOGLE_ISSUER: h.google.issuer, GOOGLE_API_URL: h.google.issuer, PHOTO_HOSTS: 'googleusercontent.com,127.0.0.1',
  DEMO_AUTH_ENABLED: 'false', LIMITS_CACHE_MS: '0', FEATURE_FLAGS_CACHE_MS: '0', DOC_WORKERS: '1', CLOUDFLARE_ZONE: acme.zone, ACME_DIRECTORY: acme.directory,
  ...more
});
/** What the server reaches here in place of production's: the stand-ins. */
const outside = (): Outside => ({ google: gcp.google, launcher: gcp.launcher, dns: acme.dns, log: rekor.log });
const start = async (more: Record<string, string> = {}) => {
  const r = await startServer(env(more), outside());
  running.push(r);
  return r;
};
const ports = (r: Running) => {
  if (!('https' in r.ports)) throw new Error('This server isn’t behind its own TLS.');
  return r.ports;
};
/** A connection to `r`'s edge, from `from` as the load balancer says. */
const via = (r: Running, from?: string): EdgeTarget => ({ port: ports(r).https, ca: acme.rootPem, from });

let seq = 0;
const person = (name: string): GoogleUser => { const n = seq++; return { sub: `cs-${name}-${n}-${Date.now()}`, email: `${name}.${n}@vandelay.test`, name: `${name} Example` }; };
/** A browser on the web app, its requests going to `base` through `transport`. */
function browser(base: string, transport: typeof fetch = fetch, origin = WEB): Browser {
  const f = cookieFetch(origin, transport);
  return { fetch: f, api: createHttpApi({ baseUrl: base, fetch: f }) };
}
/** Signs in with Google the way a browser does, following each redirect by hand. Where the app lands. */
async function viaGoogle(b: Browser, user: GoogleUser, app: string): Promise<string> {
  h.google.next(user);
  let url = new URL(b.api.auth.signInUrl('google'));
  for (let hop = 0; hop < 10; hop++) {
    if (url.origin === new URL(app).origin) return `${url.pathname}${url.search}`;
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  throw new Error('Too many redirects while signing in with Google.');
}
/** A port nothing's listening on now. */
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const at = s.address(); s.close(() => resolve(typeof at === 'object' && at ? at.port : 0)); });
});
async function until(ok: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`Timed out waiting for ${what}`);
}
const insideTee = (a: Attestation) => { if (a.tee !== 'confidential-space') throw new Error('Not attested inside a TEE.'); return a; };
const failure = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const Stored = z.object({ record: z.instanceof(Uint8Array) });
const storedCertificate = async () => z.object({ chain_pem: z.string() }).parse((await h.pool.query("SELECT chain_pem FROM tls_certificates WHERE id = 'current'")).rows[0]).chain_pem;
/** What a browser built for this API checks the server against: the stand-ins' root, release key, log key and project. */
const anchors = (): Partial<VerifyOptions> => ({
  audience: API, imageRepo: PRODUCTION_IMAGE, projectNumber: gcp.projectNumber, rootCertDer: new Uint8Array(new X509Certificate(gcp.rootPem).raw),
  signingKeySpki: rekor.releaseKeySpki, logKeySpki: rekor.logKeySpki
});
/** The attestation `r` hands a browser that reaches it from `from`. */
const attestationOf = async (r: Running, from: string) => insideTee(await browser(API, edgeFetch(via(r, from))).api.trust.attestation());

beforeAll(async () => {
  h = await startHarness();
  acme = await startFakeAcme();
  rekor = await startFakeRekor();
  web = await webApp();
  const url = process.env['TEST_DATABASE_URL'] ?? '';
  gcp = await startFakeGcp({
    project: PROJECT, provider: PROVIDER, key: KEY, releaseKeySpki: rekor.releaseKeySpki,
    secrets: {
      // As a secret made with echo has it, with a line end that's no part of it.
      [SECRET_NAMES.DATABASE_URL]: `${url}\n`, [SECRET_NAMES.OBJECTS_ACCESS_KEY]: h.deps.cfg.OBJECTS_ACCESS_KEY, [SECRET_NAMES.OBJECTS_SECRET_KEY]: h.deps.cfg.OBJECTS_SECRET_KEY,
      [SECRET_NAMES.LIVEKIT_API_KEY]: LIVEKIT_KEY, [SECRET_NAMES.LIVEKIT_API_SECRET]: LIVEKIT_SECRET,
      [SECRET_NAMES.GOOGLE_CLIENT_ID]: h.google.clientId, [SECRET_NAMES.GOOGLE_CLIENT_SECRET]: h.google.clientSecret, [SECRET_NAMES.CLOUDFLARE_API_TOKEN]: acme.token,
      // The keys the database's accounts were made under, until the old master is retired.
      'alcove-kmaster': h.deps.cfg.KMASTER, 'alcove-kservice': h.deps.cfg.KSERVICE
    }
  });
  // CI signed the image the VM runs, from COMMIT, and cosign logged it.
  rekor.release(PRODUCTION_IMAGE, gcp.digest, COMMIT);
  h.google.register(`${API}/v1/auth/google/callback`);
});
afterAll(async () => {
  for (const r of running.splice(0)) await r.close();
  await gcp?.close();
  await acme?.close();
  await rekor?.close();
  if (web) await rm(web, { recursive: true, force: true });
  await h?.close();
});

describe('confidential space', () => {
  let a: Running;
  let ann: GoogleUser;
  let annId: string | undefined;
  let meetingId = '';
  let good: Extract<Attestation, { tee: 'confidential-space' }>;

  it('starts with its secrets and its master from Google Cloud, through its attestation alone, and carries the accounts made before it', async () => {
    // Someone with an account from before the TEE, made on the API as it runs today: signed in with Google, a call scheduled with a guest.
    ann = person('ann');
    const before = browser(h.baseUrl, fetch, h.deps.cfg.WEB_ORIGIN);
    expect(await viaGoogle(before, ann, h.deps.cfg.WEB_ORIGIN)).toBe('/ready');
    annId = (await before.api.auth.getSession())?.ownerId;
    meetingId = (await before.api.meetings.create({ title: 'Quarterly with Theo', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: ['guest@vandelay.test'], notes: 'on' })).id;
    // As the release before leaves an account: its root key under the old master alone.
    expect(z.object({ n: z.number() }).parse((await h.pool.query('SELECT count(*)::int AS n FROM owners WHERE root_envelope_v2 IS NOT NULL')).rows[0]).n).toBe(0);

    const environment = JSON.stringify(process.env);
    const given = env();
    const asGiven = JSON.stringify(given);
    // Google's clock is 8 s ahead of the VM's, as production's VMs ran behind (2026-11-13): the API says how far, at start.
    gcp.clockAheadMs = 8_000;
    const starting = h.logs.length;
    a = await start();
    gcp.clockAheadMs = 0;
    const offset = z.object({ level: z.number(), behindGoogleS: z.number() }).parse(JSON.parse(h.logs.slice(starting).find((l) => l.includes('"msg":"clock offset"')) ?? 'null'));
    // Info, not a warning: the checks of other services' tokens allow a minute (the header is in whole seconds).
    expect([Math.abs(offset.behindGoogleS - 8) <= 1, offset.level]).toEqual([true, 30]);
    // Nothing was put in the environment, its own or the process's: Confidential Space puts the environment in its attestation.
    expect(JSON.stringify(given)).toBe(asGiven);
    expect(JSON.stringify(process.env)).toBe(environment);
    // Every secret came from Secret Manager, read as the identity the attestation was exchanged for: the launcher's token, as the file had it.
    expect(a.deps.cfg.LIVEKIT_API_KEY).toBe(LIVEKIT_KEY);
    expect(a.deps.cfg.LIVEKIT_API_SECRET).toBe(LIVEKIT_SECRET);
    expect(a.deps.cfg.GOOGLE_CLIENT_SECRET).toBe(h.google.clientSecret);
    expect(a.deps.cfg.edge?.token).toBe(acme.token);
    expect(a.deps.cfg.DATABASE_URL).toBe(process.env['TEST_DATABASE_URL']);
    expect([...gcp.read].sort()).toEqual([...Object.values(SECRET_NAMES), 'alcove-kmaster', 'alcove-kservice'].sort());
    expect(gcp.exchanged).toEqual([await readFile(gcp.google.tokenFile, 'utf8')]);
    // The master is what Cloud KMS gave back, as it gave it; it isn't the old one, and what the database's accounts need is carried.
    expect(Buffer.from(Stored.parse((await h.pool.query("SELECT record FROM server_keys WHERE id = 'master'")).rows[0]).record)).toEqual(Buffer.from(gcp.wrapped[0] ?? []));
    expect(gcp.wrapped).toHaveLength(1);
    expect(a.deps.cfg.KMASTER).not.toBe(h.deps.cfg.KMASTER);
    expect([a.deps.cfg.INDEX_KEY, a.deps.cfg.PHOTO_KEY, a.deps.cfg.KSERVICE, a.deps.cfg.LEGACY_KMASTER]).toEqual([h.deps.cfg.INDEX_KEY, h.deps.cfg.PHOTO_KEY, h.deps.cfg.KSERVICE, h.deps.cfg.KMASTER]);

    // Ann signs in through the TEE's own TLS and finds her call, as she left it.
    const there = browser(API, edgeFetch(via(a, '198.51.100.1')));
    expect(await viaGoogle(there, ann, WEB)).toBe('/home');
    expect((await there.api.auth.getSession())?.ownerId).toBe(annId);
    expect((await there.api.meetings.get(meetingId)).guests.map((g) => g.email)).toEqual(['guest@vandelay.test']);
    // And every account is wrapped again under the TEE's master, in the background.
    await until(() => h.logs.some((l) => l.includes('"msg":"owners rewrapped"')), 'the accounts rewrapped');
    expect(z.object({ n: z.number() }).parse((await h.pool.query('SELECT count(*)::int AS n FROM owners WHERE root_envelope_v2 IS NULL')).rows[0]).n).toBe(0);

    // A stream stays open over HTTP/2 and carries what happens while it's open.
    const ws = await there.api.workspaces.create('Planning');
    const live = there.api.workspaces.live(ws.id);
    try {
      await until(() => live.getSnapshot().status === 'live' && live.getSnapshot().tree !== null, 'the workspace’s stream');
      await there.api.workspaces.items.create(ws.id, { kind: 'document', name: 'Agenda', parent: null });
      await until(() => (live.getSnapshot().tree?.items ?? []).some((i) => i.name === 'Agenda'), 'the new document on the stream');
    } finally { live.close(); }

    // None of the secrets, the old keys or the master is in any log line, nor what unlocks them: the launcher's attestation
    // token and the access token it's exchanged for, either of which opens the master's key, and the private keys TLS and
    // the ACME account are made from.
    const logs = h.logs.join('');
    const master = unb64u(a.deps.cfg.KMASTER, 32);
    const pemLines = (pem: string) => pem.split('\n').filter((l) => l.length === 64);
    const unlocking = [...gcp.exchanged, ...gcp.accessTokens, ...pemLines(tlsKey(master).privateKeyPem), ...pemLines(acmeAccountKey(master).privateKeyPem)];
    expect(gcp.accessTokens.length).toBeGreaterThan(0);
    for (const secret of [LIVEKIT_KEY, LIVEKIT_SECRET, h.google.clientSecret, acme.token, h.deps.cfg.KMASTER, h.deps.cfg.KSERVICE, a.deps.cfg.KMASTER, process.env['TEST_DATABASE_URL'] ?? 'no url', ...unlocking]) {
      expect(logs.includes(secret), 'a secret in the logs').toBe(false);
    }
    expect(logs).toContain('"msg":"secrets read"');
  });

  it('hands out one attestation token for every caller, naming its TLS key and its build, with its release from the log', async () => {
    const asked = gcp.asked;
    const first = await attestationOf(a, '198.51.100.2');
    expect(first.build.commit).toBe(COMMIT);
    // The key it names is the one the connection to it presents.
    const cert = await presented(via(a), 'api.alcove.test');
    expect(first.tls.spkiSha256).toBe(spkiHash(cert.spki));
    // A PKI token: signed by the leaf its x5c chain starts with, which chains to the (stand-in) Confidential Space root.
    const x5c = z.array(z.string()).length(3).parse(decodeProtectedHeader(first.token).x5c).map((c) => new X509Certificate(Buffer.from(c, 'base64')));
    const [leaf, intermediate, root] = x5c;
    if (!leaf || !intermediate || !root) throw new Error('A short chain.');
    expect(leaf.verify(intermediate.publicKey) && intermediate.verify(root.publicKey) && root.verify(root.publicKey)).toBe(true);
    expect(root.fingerprint256).toBe(new X509Certificate(gcp.rootPem).fingerprint256);
    await compactVerify(first.token, leaf.publicKey);
    // For this API, saying what it is, with the build and the TLS key among its nonces.
    const claims = decodeJwt(first.token);
    expect(claims.aud).toBe(API);
    expect(claims.iss).toBe('https://confidentialcomputing.googleapis.com');
    expect(z.array(z.string()).parse(claims['eat_nonce'])).toEqual(expect.arrayContaining(['alcove:attestation:v1', `spki:${first.tls.spkiSha256}`, `commit:${COMMIT}`]));
    // The release came with it, found in the log by the API itself.
    expect(first.release).not.toBeNull();
    expect(h.logs.some((l) => l.includes('"msg":"release found in the public log"'))).toBe(true);
    // The same token for the next caller, from elsewhere, and the launcher wasn't asked again.
    const second = await attestationOf(a, '198.51.100.3');
    expect(second.token).toBe(first.token);
    expect(second.release).toEqual(first.release);
    expect(gcp.asked).toBe(asked + 1);
    good = first;
  });

  it('a browser checks what it’s handed, the release included, and finds it verified without asking anyone', async () => {
    const askedTheLog = rekor.asked;
    expect(await verifyServer(good, anchors())).toEqual({ state: 'verified', commit: COMMIT, digest: gcp.digest, at: expect.any(Number) });
    // Nothing a browser checks is fetched: the token's chain and the log's entry are checked against what it pins.
    expect(rekor.asked).toBe(askedTheLog);
    // With production's pins, a server of the stand-ins' isn't Alcove's.
    expect(await verifyServer(good, { audience: API })).toMatchObject({ state: 'unverified', reason: 'The token isn’t signed by Google’s Confidential Space root.' });
  });

  it('shows unverified, saying why, for a token that isn’t one of Alcove’s servers’', async () => {
    const nonces = ['alcove:attestation:v1', `spki:${good.tls.spkiSha256}`, `commit:${COMMIT}`];
    const check = async (a: Attestation) => verifyServer(a, anchors());
    const spoiled: [TokenSpoil, string][] = [
      ['debuggable', 'The server could be debugged.'],
      ['not-stable', 'The server’s Confidential Space image isn’t one Google supports as stable.'],
      ['not-tdx', 'The server isn’t on Intel TDX.'],
      ['not-confidential-space', 'The server isn’t running Confidential Space.'],
      ['another-issuer', 'The token wasn’t issued by Google Cloud Attestation.'],
      ['expired', 'The token has expired.'],
      ['ahead', 'The token is dated after this device’s clock.'],
      ['too-old', 'The token is more than 20 minutes old.'],
      ['another-image', 'The server runs an image from outside Alcove’s registry.'],
      ['unsigned', 'Confidential Space didn’t find Alcove’s release key’s signature on the server’s image.'],
      ['another-project', 'The server runs in a Google Cloud project that isn’t Alcove’s.'],
      ['another-root', 'The token isn’t signed by Google’s Confidential Space root.'],
      ['not-a-ca', 'The token isn’t signed by Google’s Confidential Space root.'],
      ['run-out', 'A certificate the token is signed under isn’t valid at this time.'],
      ['bad-signature', 'The token’s signature doesn’t check out.']
    ];
    for (const [spoil, reason] of spoiled) {
      expect({ spoil, trust: await check({ ...good, token: await gcp.mint(API, nonces, spoil) }) }).toMatchObject({ spoil, trust: { state: 'unverified', reason } });
    }
    // The same token, as the launcher makes it, checks out; so it's each spoil that's refused, and nothing else.
    expect((await check({ ...good, token: await gcp.mint(API, nonces) })).state).toBe('verified');
    const refused = async (a: Attestation) => { const t = await check(a); return t.state === 'unverified' ? t.reason : t.state; };
    expect(await refused({ ...good, token: await gcp.mint('https://api.elsewhere.test', nonces) })).toBe('The token was made for another server.');
    // Its nonces: asked for to attest to Alcove's server, naming the TLS key and build the server reports, each once.
    expect(await refused({ ...good, token: await gcp.mint(API, nonces.slice(1)) })).toBe('The token wasn’t asked for to attest to Alcove’s server.');
    expect(await refused({ ...good, token: await gcp.mint(API, [nonces[0] ?? '', `commit:${COMMIT}`]) })).toBe('The token doesn’t name the server’s TLS key.');
    expect(await refused({ ...good, token: await gcp.mint(API, [...nonces, `spki:${'A'.repeat(43)}`]) })).toBe('The token doesn’t name the server’s TLS key.');
    expect(await refused({ ...good, token: await gcp.mint(API, nonces.slice(0, 2)) })).toBe('The token doesn’t name the build the server reports.');
    expect(await refused({ ...good, tls: { spkiSha256: 'B'.repeat(43) } })).toBe('The token doesn’t name the server’s TLS key.');
    expect(await refused({ ...good, build: { commit: 'f'.repeat(40) } })).toBe('The token doesn’t name the build the server reports.');
    expect(await refused({ ...good, build: { commit: 'dev' } })).toBe('The server’s build isn’t a commit.');
    expect(await refused({ ...good, token: 'not.a.token' })).toBe('The server’s attestation token can’t be read.');
  });

  it('shows unverified when the log can’t vouch for the release it’s handed, and checks proofs of any shape', async () => {
    const release = good.release;
    if (!release) throw new Error('No release was handed over.');
    const askedTheLog = rekor.asked;
    const refused = async (r: ReleaseEntry | null) => { const t = await verifyServer({ ...good, release: r }, anchors()); return t.state === 'unverified' ? t.reason : t.state; };
    const NOT_LOGGED = 'Sigstore’s public log didn’t sign its entry for this build.';
    const NOT_INCLUDED = 'Sigstore’s public log can’t prove it holds this build.';
    // None handed over: whoever relays the release can withhold it, and nothing more.
    expect(await refused(null)).toBe('The server didn’t hand over its build’s entry in Sigstore’s public log.');
    // Logged by another log, or its timestamp signed by another key, or for another entry.
    const elsewhere = rekor.entryFor(PRODUCTION_IMAGE, gcp.digest, COMMIT, { log: 'another' });
    expect(await refused(elsewhere)).toBe(NOT_LOGGED);
    expect(await refused({ ...release, signedEntryTimestamp: elsewhere.signedEntryTimestamp })).toBe(NOT_LOGGED);
    expect(await refused({ ...release, integratedTime: release.integratedTime + 1 })).toBe(NOT_LOGGED);
    // Its proof: one hash changed, for another place in the log, or a checkpoint for another size or signed by another key.
    const proof = release.inclusionProof;
    const changed = proof.hashes.map((x, i) => (i === 0 ? `${x.slice(0, -1)}${x.endsWith('0') ? '1' : '0'}` : x));
    expect(await refused({ ...release, inclusionProof: { ...proof, hashes: changed } })).toBe(NOT_INCLUDED);
    expect(await refused({ ...release, inclusionProof: { ...proof, logIndex: proof.logIndex - 1 } })).toBe(NOT_INCLUDED);
    const [origin, size, ...rest] = proof.checkpoint.split('\n');
    expect(await refused({ ...release, inclusionProof: { ...proof, checkpoint: [origin, String(Number(size) + 1), ...rest].join('\n') } })).toBe(NOT_INCLUDED);
    expect(await refused({ ...release, inclusionProof: { ...proof, checkpoint: elsewhere.inclusionProof.checkpoint } })).toBe(NOT_INCLUDED);
    // What it holds: signed with another key, or the release of another commit.
    expect(await refused(rekor.entryFor(PRODUCTION_IMAGE, gcp.digest, COMMIT, { signer: 'another' }))).toBe('The public log’s entry for this build isn’t signed with Alcove’s release key.');
    expect(await refused(rekor.entryFor(PRODUCTION_IMAGE, gcp.digest, 'e'.repeat(40)))).toBe('This build isn’t in Sigstore’s public log.');
    // Any entry the log holds proves itself, wherever it is in a log of any size.
    for (const total of [1, 2, 3, 4, 5, 8, 13]) {
      for (let at = 0; at < total; at++) expect({ total, at, trust: await refused(rekor.entryFor(PRODUCTION_IMAGE, gcp.digest, COMMIT, { size: total, at })) }).toEqual({ total, at, trust: 'verified' });
    }
    expect(rekor.asked).toBe(askedTheLog);
  });

  it('stops at start, naming the key, when Cloud KMS won’t unwrap its master for it', async () => {
    const master = Buffer.from(gcp.wrapped[0] ?? []);
    gcp.refuse = true;
    try {
      const refused = await start().then(() => undefined, (e: unknown) => e);
      expect(refused).toBeInstanceOf(KeyError);
      expect(refused instanceof KeyError ? refused.message : '').toContain(KEY);
    } finally {
      gcp.refuse = false;
    }
    // Nothing was made in its place.
    expect(Buffer.from(Stored.parse((await h.pool.query("SELECT record FROM server_keys WHERE id = 'master'")).rows[0]).record)).toEqual(master);
    // Nor does it start without its own TLS, or with a secret in its environment.
    await expect(start({ TLS_HOSTS: '' })).rejects.toThrow(/TLS_HOSTS: inside a TEE/);
    await expect(start({ LIVEKIT_API_SECRET: LIVEKIT_SECRET })).rejects.toThrow(/LIVEKIT_API_SECRET is in the environment too/);
  });

  it('stops at start, naming what refused, when its attestation isn’t exchanged, a secret isn’t there, or there’s no token', async () => {
    const from = h.logs.length;
    // A token the launcher didn't write: Google's Security Token Service won't exchange it.
    const foreign = `a token the launcher never wrote ${randomBytes(16).toString('base64url')}`;
    await writeFile(gcp.google.tokenFile, foreign);
    try {
      await expect(start()).rejects.toThrow(/Security Token Service refused this VM’s attestation/);
    } finally {
      await gcp.refresh();
    }
    // A secret Secret Manager doesn't hold for it.
    await expect(start({ SECRETS: `${env()['SECRETS'] ?? ''},NEAR_AI_API_KEY=alcove-near-ai-api-key` })).rejects.toThrow(/the secret alcove-near-ai-api-key/);
    // No token file: not in Confidential Space.
    const nowhere = { ...outside(), google: { ...gcp.google, tokenFile: join(tmpdir(), `no-such-token-${randomBytes(6).toString('hex')}`) } };
    await expect(startServer(env(), nowhere)).rejects.toThrow(/no attestation token to exchange/);
    // Nothing it was handed is in the log.
    expect(h.logs.slice(from).join('').includes(foreign)).toBe(false);
  });

  it('refuses settings it can’t start safely with', async () => {
    const refusals: [Record<string, string>, RegExp][] = [
      [{ SECRETS: 'KMASTER=alcove-kmaster' }, /SECRETS: KMASTER is never given to a TEE/],
      [{ SECRETS: 'TEE=alcove-tee' }, /SECRETS: TEE is read before secrets are/],
      [{ SECRETS: 'NOT_A_SETTING=alcove-x' }, /SECRETS: NOT_A_SETTING isn’t a setting/],
      // Only credentials come from Secret Manager: where sign-in goes is the environment's, which the attestation shows.
      [{ SECRETS: 'GOOGLE_ISSUER=alcove-issuer' }, /SECRETS: GOOGLE_ISSUER isn’t a secret/],
      [{ SECRETS: 'DATABASE_URL=alcove-database-url,DATABASE_URL=alcove-other' }, /SECRETS: DATABASE_URL is named twice/],
      [{ KMS_MASTER_KEY: '' }, /KMS_MASTER_KEY: inside a TEE the master is wrapped by Cloud KMS/],
      [{ RETIRE_LEGACY_KMASTER: 'true' }, /Retiring the old master takes the old keys away/],
      [{ CLOUDFLARE_ZONE: '' }, /CLOUDFLARE_ZONE, CLOUDFLARE_API_TOKEN: with TLS_HOSTS/],
      [{ TLS_HOSTS: 'www.alcove.test,api.alcove.test' }, /www\. host without/]
    ];
    for (const [more, said] of refusals) await expect(start(more)).rejects.toThrow(said);
  });

  it('serves the web app and the API over its own TLS, by host, to whoever the load balancer says the connection is from', async () => {
    const f = edgeFetch(via(a, '198.51.100.4'));
    // A link into the app is the app: its page, with the headers its _headers gives every page.
    const page = await f(`${WEB}/calls/3c2b1a`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="app">');
    expect(page.headers.get('content-security-policy')).toBe(CSP);
    expect(page.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate, no-transform');
    expect(page.headers.get('strict-transport-security')).toContain('max-age=');
    expect((await f(`${WEB}/welcome`)).headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await (await f(`${WEB}/welcome`)).text()).toContain('Welcome to Alcove');
    // Whatever a path holds, the app's headers come with it: a line break in a path is refused, and any other character matched.
    expect((await f(`${WEB}/%0A`)).status).toBe(400);
    const odd = await f(`${WEB}/x%E2%80%A8`);
    expect([odd.status, odd.headers.get('content-security-policy'), odd.headers.get('x-frame-options')]).toEqual([200, CSP, 'DENY']);
    // Pages' own files, and dot files, aren't served: the app is, in their place.
    for (const hidden of ['/_headers', '/.secret']) expect(await (await f(`${WEB}${hidden}`)).text()).toContain('<div id="app">');
    // A built file: compressed for a browser that takes it, kept a year (its name changes when it does), revalidated by its ETag.
    const script = await f(`${WEB}/assets/app-3f2a1b.js`, { headers: { 'accept-encoding': 'br, gzip' } });
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('content-encoding')).toBe('br');
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(script.headers.get('x-content-type-options')).toBe('nosniff');
    expect(brotliDecompressSync(Buffer.from(await script.arrayBuffer())).toString('utf8')).toBe(SCRIPT);
    const etag = script.headers.get('etag') ?? '';
    expect((await f(`${WEB}/assets/app-3f2a1b.js`, { headers: { 'accept-encoding': 'br', 'if-none-match': etag } })).status).toBe(304);
    const portrait = await f(`${WEB}/people/art-vandelay.jpg`);
    expect([portrait.status, portrait.headers.get('content-type'), portrait.headers.get('cache-control')]).toEqual([200, 'image/jpeg', null]);
    // A big file on its way, unread, crowds out nothing else on the same connection: the edge sends it as it's taken.
    const session = edgeSession(via(a, '198.51.100.4'), 'alcove.test');
    try {
      const model = session.start('/mediapipe/selfie_multiclass_256x256.tflite');
      model.pause();
      await new Promise<void>((resolve) => { model.once('response', () => resolve()); });
      await new Promise((r) => setTimeout(r, 200));
      expect(await Promise.all(Array.from({ length: 5 }, () => session.status('/welcome')))).toEqual([200, 200, 200, 200, 200]);
      let got = 0;
      model.on('data', (c: Buffer) => { got += c.length; });
      model.resume();
      await new Promise<void>((resolve) => { model.once('end', () => resolve()); });
      expect(got).toBe(MODEL_BYTES);
    } finally { session.close(); }
    // www. is sent on to the host without it.
    const www = await f('https://www.alcove.test/calls/3c2b1a?from=mail', { redirect: 'manual' });
    expect([www.status, www.headers.get('location')]).toEqual([301, `${WEB}/calls/3c2b1a?from=mail`]);
    // A client without HTTP/2 is served over HTTP/1.1.
    const old = await edgeHttp1(via(a, '198.51.100.4'), 'alcove.test', '/');
    expect([old.status, old.protocol, old.headers['content-security-policy']]).toEqual([200, 'http/1.1', CSP]);

    // Plain HTTP: the load balancer's health check, and everything else sent on to https.
    const health = await plainRequest(ports(a).http, 'api.alcove.test', '/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ ok: true, tee: 'confidential-space', commit: COMMIT });
    const insecure = await plainRequest(ports(a).http, 'alcove.test', '/calls/3c2b1a?from=mail');
    expect([insecure.status, insecure.headers.location]).toEqual([301, `${WEB}/calls/3c2b1a?from=mail`]);
    expect((await plainRequest(ports(a).http, 'www.alcove.test', '/')).headers.location).toBe(`${WEB}/`);
    expect((await plainRequest(ports(a).http, 'elsewhere.test', '/')).status).toBe(404);

    // A connection that doesn't start with the load balancer's PROXY line is closed, and so is one with a line that isn't one.
    expect(await withoutProxyLine(via(a), 'api.alcove.test')).toBe('refused');
    expect(await rawConnection(via(a), 'PROXY TCP4 999.1.1.1 10.128.0.2 51000 443\r\n')).toBe('closed');
    expect(await rawConnection(via(a), 'PROXY TCP4 203.0.113.9 10.128.0.2 99999 443\r\n')).toBe('closed');
    expect(await rawConnection(via(a), `PROXY TCP4 ${'1'.repeat(120)}`)).toBe('closed');
    // Rate limits go by the address the PROXY line gives, whatever the client says in x-forwarded-for, over either HTTP.
    const from = (address: string) => edgeFetch(via(a, address));
    const attest = (f2: typeof fetch, claimed: string) => f2(`${API}/v1/attestation`, { headers: { 'x-forwarded-for': claimed } });
    for (let i = 0; i < 30; i++) expect((await attest(from('203.0.113.7'), `192.0.2.${i}`)).status).toBe(200);
    const limited = await attest(from('203.0.113.7'), '192.0.2.200');
    expect([limited.status, z.object({ code: z.string() }).parse(await limited.json()).code]).toEqual([503, 'unavailable']);
    expect((await edgeHttp1(via(a, '203.0.113.7'), 'api.alcove.test', '/v1/attestation', { 'x-forwarded-for': '192.0.2.201' })).status).toBe(503);
    expect((await attest(from('203.0.113.8'), '203.0.113.7')).status).toBe(200);
    // With PROXY UNKNOWN (the load balancer's own connection), what the client says is dropped too: every such request is one address's.
    const unknown = edgeFetch(via(a));
    for (let i = 0; i < 30; i++) expect((await attest(unknown, `192.0.2.${i}`)).status).toBe(200);
    expect((await attest(unknown, '192.0.2.250')).status).toBe(503);
  });

  it('serves the certificate one instance stored on every other, and renews it when it’s due', async () => {
    // Its account's key is the one the master makes, and the account it is was logged, for the CAA record that pins it.
    const [account, jwk] = [...acme.accounts][0] ?? [];
    const ours = createPublicKey(acmeAccountKey(unb64u(a.deps.cfg.KMASTER, 32)).key).export({ format: 'jwk' });
    expect([jwk?.x, jwk?.y]).toEqual([ours.x, ours.y]);
    expect(h.logs.some((l) => l.includes('"msg":"acme account"') && l.includes(`"accountUri":"${account}"`))).toBe(true);
    // Its challenge records came down once the certificate was issued.
    expect(acme.records()).toEqual([]);
    expect(acme.issued).toHaveLength(1);

    // Another instance, started with the launcher's next token: it reads that one, and orders no certificate.
    const refreshed = await gcp.refresh();
    const b = await start();
    expect(gcp.exchanged.at(-1)).toBe(refreshed);
    expect(acme.issued).toHaveLength(1);
    expect((await presented(via(b), 'alcove.test')).serial).toBe((await presented(via(a), 'alcove.test')).serial);
    // Its attestation: while the launcher can't give a token, it says so (503); then many callers at once wait for the one it asks for.
    gcp.fail = true;
    expect(failure(await attestationOf(b, '198.51.100.5').catch((e: unknown) => e))).toBe('unavailable');
    gcp.fail = false;

    // Many callers at once on a new instance wait for the one token it asks for.
    const fresh = await start();
    gcp.delayMs = 300;
    const asked = gcp.asked;
    const tokens = await Promise.all(Array.from({ length: 5 }, (_, i) => attestationOf(fresh, `198.51.100.${10 + i}`)));
    gcp.delayMs = 0;
    expect(new Set(tokens.map((t) => t.token)).size).toBe(1);
    expect(gcp.asked).toBe(asked + 1);

    // An instance with no certificate to serve says it isn't ready, to the load balancer's health check, until it has one.
    acme.days = 20;
    await h.pool.query('DELETE FROM tls_certificates');
    let issue: () => void = () => undefined;
    acme.gate = new Promise<void>((resolve) => { issue = resolve; });
    const http = await freePort();
    const starting = start({ HTTP_PORT: String(http) });
    await until(async () => (await plainRequest(http, 'api.alcove.test', '/health').catch(() => undefined))?.status === 503, 'the health check saying it isn’t ready');
    expect(JSON.parse((await plainRequest(http, 'api.alcove.test', '/health')).body)).toEqual({ ok: false, tls: 'starting' });
    issue();
    acme.gate = undefined;
    const c = await starting;
    expect((await plainRequest(http, 'api.alcove.test', '/health')).status).toBe(200);
    // A certificate with less than 30 days left is renewed by whichever instance holds the lock, and served without a restart.
    await until(() => acme.issued.length === 3, 'the certificate ordered at start, then renewed');
    const renewed = acme.issued[2] ?? '';
    await until(async () => (await storedCertificate()) === renewed, 'the renewed certificate stored');
    await until(async () => (await presented(via(c), 'alcove.test')).serial === new X509Certificate(renewed).serialNumber, 'the renewed certificate served');
    expect(acme.records()).toEqual([]);
    acme.days = 90;
  });

  it('instances starting together order one certificate between them', async () => {
    await h.pool.query('DELETE FROM tls_certificates');
    const before = acme.issued.length;
    const [x, y] = await Promise.all([start(), start()]);
    expect(acme.issued).toHaveLength(before + 1);
    const serial = new X509Certificate(acme.issued.at(-1) ?? '').serialNumber;
    expect([(await presented(via(x), 'alcove.test')).serial, (await presented(via(y), 'alcove.test')).serial]).toEqual([serial, serial]);
    expect(acme.records()).toEqual([]);
  });

  it('gets its certificate after an order the CA refused, with records slow to show, and leaves none behind', async () => {
    await h.pool.query('DELETE FROM tls_certificates');
    const before = acme.issued.length;
    const from = h.logs.length;
    // The CA finds the first challenge invalid, and the resolver sees each record only a while after it's up.
    acme.invalidNext = 1;
    acme.resolverDelayMs = 2_500;
    const http = await freePort();
    try {
      const starting = start({ HTTP_PORT: String(http) });
      await until(() => h.logs.slice(from).some((l) => l.includes('"msg":"tls certificate not ordered; trying again"')), 'the refused order');
      // Not ready meanwhile, and the refused order's records came down with it.
      expect((await plainRequest(http, 'api.alcove.test', '/health')).status).toBe(503);
      expect(acme.records()).toEqual([]);
      // Tried again 30 seconds on: the certificate, and the instance ready with it.
      const d = await starting;
      expect(acme.issued).toHaveLength(before + 1);
      expect((await plainRequest(http, 'api.alcove.test', '/health')).status).toBe(200);
      expect((await presented(via(d), 'alcove.test')).serial).toBe(new X509Certificate(acme.issued.at(-1) ?? '').serialNumber);
      expect(acme.records()).toEqual([]);
    } finally {
      acme.invalidNext = 0;
      acme.resolverDelayMs = 0;
    }
  }, 90_000);

  it('hands out a token for at most 15 minutes, asks for the next at 5, and waits a while after the launcher fails', async () => {
    let caller = 60;
    const ask = (r: Running) => attestationOf(r, `198.51.100.${caller++}`);
    try {
      // A token 5 minutes old is still handed out, while the next one is asked for.
      gcp.backdateMs = 6 * 60_000;
      const d = await start();
      const asking = gcp.asked;
      const old = (await ask(d)).token;
      expect(gcp.asked).toBe(asking + 1);
      expect((await ask(d)).token).toBe(old);
      await until(() => gcp.asked === asking + 2, 'the next token asked for');
      await until(async () => (await ask(d)).token !== old, 'the next token handed out');

      // One 10 minutes old is still handed out while the launcher fails, which is then given a while before it's asked again.
      gcp.backdateMs = 10 * 60_000;
      const e = await start();
      const held = (await ask(e)).token;
      gcp.fail = true;
      const failing = gcp.asked;
      // Its own failure, logged from here on: an earlier instance's is in the log already, in the same words.
      const logged = h.logs.length;
      expect((await ask(e)).token).toBe(held);
      await until(() => h.logs.slice(logged).some((l) => l.includes('"msg":"no attestation token"') && l.includes('"retryInMs":30000')), 'the launcher’s failure');
      expect(gcp.asked).toBe(failing + 1);
      expect((await ask(e)).token).toBe(held);
      expect((await ask(e)).token).toBe(held);
      expect(gcp.asked).toBe(failing + 1);
      gcp.fail = false;

      // None 15 minutes old or more is handed out, even as the launcher makes it, and the launcher is given a while then too.
      gcp.backdateMs = 16 * 60_000;
      const g = await start();
      const before = gcp.asked;
      expect(failure(await ask(g).catch((err: unknown) => err))).toBe('unavailable');
      expect(failure(await ask(g).catch((err: unknown) => err))).toBe('unavailable');
      expect(gcp.asked).toBe(before + 1);
    } finally {
      gcp.backdateMs = 0;
      gcp.fail = false;
    }
  });

  it('hands over no release when the log can’t be reached, and a browser says so', async () => {
    rekor.down = true;
    try {
      const d = await start();
      const handed = await attestationOf(d, '198.51.100.90');
      expect(handed.release).toBeNull();
      expect(await verifyServer(handed, anchors())).toMatchObject({ state: 'unverified', reason: 'The server didn’t hand over its build’s entry in Sigstore’s public log.', digest: gcp.digest });
      expect(h.logs.some((l) => l.includes('"msg":"release not found in the public log"'))).toBe(true);
    } finally {
      rekor.down = false;
    }
  });
});
