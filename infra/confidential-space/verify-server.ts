/**
 * Checks a deployed Alcove server the way the web app does, and checks what only something outside a browser can see: the
 * key of the TLS certificate the server presents. The deploy workflows run it after every rollout; run it by hand too:
 *
 *   pnpm --filter @alcove/confidential-space exec tsx verify-server.ts <https://api.origin> [--web <https://web.origin>]
 *     [--connect <address>] [--commit <40 hex>] [--digest sha256:<64 hex>] [--wait <seconds>] [--skip-livekit]
 *
 * 1. GET /v1/attestation over one TLS connection. The SHA-256 of that connection's certificate key (its DER
 *    SubjectPublicKeyInfo, base64url) must be the attestation's tls.spkiSha256: the key TLS ends with is the TEE's.
 * 2. verifyServer, from @alcove/api-http, the app's own check: the Confidential Space token's certificate chain,
 *    signature and claims, with the API's origin as its audience, and the image's entry in Rekor, signed by our key for
 *    the commit the server reports.
 * 3. /health answers on the same key and reaches LiveKit, which calls need. --skip-livekit leaves LiveKit out, for staging,
 *    which has no LiveKit credentials.
 * 4. With --web, the web app's origin presents the same key. With --commit and --digest, the server runs that build.
 *
 * --connect sends both connections to that address rather than the one DNS gives (the load balancer's, before DNS points
 * at it), still checking the certificate against the origin's name. A check that fails is tried again until --wait runs
 * out (300 seconds by default): a new VM may still be ordering its first certificate. Exits 0 only once every check passes.
 */
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { TLSSocket } from 'node:tls';
import { parseArgs } from 'node:util';
import { AttestationSchema, errorMessage } from '@alcove/api';
import { verifyServer } from '@alcove/api-http';

const USAGE = 'usage: verify-server.ts <https://api.origin> [--web <https://web.origin>] [--connect <address>] [--commit <40 hex>] [--digest sha256:<64 hex>] [--wait <seconds>] [--skip-livekit]';

function fail(message: string): never {
  process.stderr.write(`verify-server: ${message}\n`);
  process.exit(1);
}

function origin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { fail(`${value} isn't a URL\n${USAGE}`); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search !== '' || url.username !== '') fail(`${value} isn't an https origin`);
  return url;
}

function options() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        web: { type: 'string' },
        connect: { type: 'string' },
        commit: { type: 'string' },
        digest: { type: 'string' },
        wait: { type: 'string', default: '300' },
        'skip-livekit': { type: 'boolean', default: false }
      }
    });
  } catch (e) {
    fail(`${errorMessage(e)}\n${USAGE}`);
  }
}

const { values, positionals } = options();
const first = positionals[0];
if (first === undefined || positionals.length > 1) fail(USAGE);
const api = origin(first);
const web = values.web === undefined ? undefined : origin(values.web);
const connect = values.connect;
const commit = values.commit;
const digest = values.digest;
const livekit = !values['skip-livekit'];
if (commit !== undefined && !/^[0-9a-f]{40}$/.test(commit)) fail('--commit takes a commit SHA, 40 lowercase hex characters');
if (digest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(digest)) fail('--digest takes an image digest, sha256:<64 hex>');
const waitSeconds = Number(values.wait);
if (!Number.isInteger(waitSeconds) || waitSeconds < 0) fail('--wait takes a whole number of seconds');

interface Fetched { status: number; body: string; spki: string }

/** One GET on a new connection, with the SHA-256 (base64url) of the DER SubjectPublicKeyInfo of the certificate it used. */
function fetchOnce(url: URL): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: connect ?? url.hostname,
      servername: url.hostname,
      port: url.port === '' ? 443 : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { host: url.host, accept: 'application/json' },
      agent: false,
      timeout: 20_000
    }, (res) => {
      const socket = res.socket;
      if (!(socket instanceof TLSSocket)) { res.resume(); reject(new Error(`${url.href} didn't answer over TLS`)); return; }
      const certificate = socket.getPeerX509Certificate();
      if (certificate === undefined) { res.resume(); reject(new Error(`${url.href} presented no certificate`)); return; }
      const spki = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64url');
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, spki }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`${url.href} timed out`)));
    req.on('error', reject);
    req.end();
  });
}

async function check(): Promise<string> {
  const fetched = await fetchOnce(new URL('/v1/attestation', api));
  if (fetched.status !== 200) throw new Error(`/v1/attestation answered ${fetched.status}`);
  const json: unknown = JSON.parse(fetched.body);
  const attestation = AttestationSchema.parse(json);
  if (attestation.tee !== 'confidential-space') throw new Error(`the server isn't in Confidential Space (tee: ${attestation.tee})`);
  if (attestation.tls.spkiSha256 !== fetched.spki) {
    throw new Error(`the certificate's key (${fetched.spki}) isn't the one the attestation names (${attestation.tls.spkiSha256})`);
  }
  const health = await fetchOnce(new URL('/health', api));
  if (health.status !== 200) throw new Error(`/health answered ${health.status}`);
  if (health.spki !== fetched.spki) throw new Error(`/health came with another key (${health.spki})`);
  const report: unknown = JSON.parse(health.body);
  if (livekit && (typeof report !== 'object' || report === null || !('livekit' in report) || report.livekit !== 'reachable')) {
    throw new Error('/health says LiveKit isn’t reachable');
  }
  if (web !== undefined) {
    const page = await fetchOnce(web);
    if (page.status !== 200) throw new Error(`${web.origin} answered ${page.status}`);
    if (page.spki !== fetched.spki) throw new Error(`${web.origin} presents another key (${page.spki})`);
  }
  const trust = await verifyServer(attestation, { audience: api.origin });
  if (trust.state !== 'verified') throw new Error(`the app wouldn't trust it: ${trust.state}${trust.reason === undefined ? '' : `, ${trust.reason}`}`);
  if (commit !== undefined && trust.commit !== commit) throw new Error(`it runs commit ${trust.commit}, not ${commit}`);
  if (digest !== undefined && trust.digest !== digest) throw new Error(`it runs image ${trust.digest ?? 'unknown'}, not ${digest}`);
  return `${api.origin} verified: commit ${trust.commit}, image ${trust.digest ?? 'unknown'}, TLS key ${fetched.spki}`;
}

const deadline = Date.now() + waitSeconds * 1000;
for (;;) {
  try {
    process.stdout.write(`${await check()}\n`);
    break;
  } catch (e) {
    if (Date.now() >= deadline) fail(errorMessage(e));
    process.stderr.write(`verify-server: not yet (${errorMessage(e)}); trying again in 15 seconds\n`);
    await new Promise<void>((resolve) => { setTimeout(resolve, 15_000); });
  }
}
