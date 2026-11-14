/*
 * What the stand-in's server runs on: Confidential Space, attested with anchors Storybook makes for itself, so the app's
 * real check (`verifyServer` from @alcove/api-http) runs in full and says verified. At first use it makes, with
 * WebCrypto, a root and an intermediate CA and a leaf that signs tokens (RSA, like Google's), a release key and a log
 * key (P-256, like Alcove's and Rekor's), and records the stand-in's release in a log of its own: a `hashedrekord` with
 * its signed entry timestamp, inclusion proof and signed checkpoint, which the stand-in's server hands on with its token,
 * as Alcove's does.
 *
 * `checkServer` (src/api/api.ts hands it to the app in place of apps/web/src/lib/api.ts's) checks with these anchors. The app's
 * own module only ever checks with production's: Storybook swaps the module, never a flag in it.
 *
 * A check that fails (`attested(broken)`) gets one token wrong in one way: signed under another root, too old, from a
 * server that could be debugged, naming another build, or of an image the log doesn't have.
 */
import type { Attestation, ReleaseEntry, Trust } from '@alcove/api';
import { verifyServer, type VerifyOptions } from '@alcove/api-http';

export type Broken = 'another-root' | 'too-old' | 'debuggable' | 'another-build' | 'unreleased';

const AUDIENCE = 'https://api.vandelay.storybook';
const IMAGES = 'registry.storybook.test/alcove/api';
const DIGEST = `sha256:${'5b'.repeat(32)}`;
const UNRELEASED = `sha256:${'0d'.repeat(32)}`;
const COMMIT = `${'c0ffee'.repeat(6)}c0ff`;
const ELSEWHERE = `${'beef'.repeat(10)}`;
/** The stand-in's Google Cloud project, by number. */
const PROJECT = '271828182845';

/* ---------- DER, as little as a certificate needs ---------- */

const text = new TextEncoder();
const join = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = join(...parts);
  const n = body.length;
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return join(new Uint8Array([tag, ...length]), body);
}
const seq = (...parts: Uint8Array[]) => tlv(0x30, ...parts);
const oid = (...b: number[]) => tlv(0x06, new Uint8Array(b));
const SHA256_WITH_RSA = seq(oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b), new Uint8Array([0x05, 0x00]));
const name = (cn: string) => seq(tlv(0x31, seq(oid(0x55, 0x04, 0x03), tlv(0x0c, text.encode(cn)))));
const utcTime = (iso: string) => tlv(0x17, text.encode(`${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}000000Z`));
const critical = (id: Uint8Array, value: Uint8Array) => seq(id, tlv(0x01, new Uint8Array([0xff])), tlv(0x04, value));
/** basicConstraints CA, and keyUsage keyCertSign and cRLSign. */
const CA_EXTENSIONS = tlv(0xa3, seq(
  critical(oid(0x55, 0x1d, 0x13), seq(tlv(0x01, new Uint8Array([0xff])))),
  critical(oid(0x55, 0x1d, 0x0f), tlv(0x03, new Uint8Array([0x01, 0x06])))
));

const RSA: RsaHashedKeyGenParams = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
const rsaSign = async (key: CryptoKey, data: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data));
const spkiOf = async (key: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('spki', key));

/** A v3 certificate for `subject`'s key, signed by `issuer`'s, valid 2020–2040 so the demo clock is always inside it. */
async function certify(serial: number, subject: string, key: CryptoKey, issuer: string, signer: CryptoKey, ca: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const tbs = seq(
    tlv(0xa0, tlv(0x02, new Uint8Array([2]))), tlv(0x02, new Uint8Array([serial])), SHA256_WITH_RSA, name(issuer),
    seq(utcTime('2020-01-01'), utcTime('2040-01-01')), name(subject), await spkiOf(key), ...(ca ? [CA_EXTENSIONS] : [])
  );
  return seq(tbs, SHA256_WITH_RSA, tlv(0x03, new Uint8Array([0]), await rsaSign(signer, tbs)));
}

interface Chain { root: Uint8Array<ArrayBuffer>; x5c: string[]; leaf: CryptoKey }
async function chain(rootName: string): Promise<Chain> {
  const rsa = () => crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
  const [root, middle, leaf] = await Promise.all([rsa(), rsa(), rsa()]);
  const rootDer = await certify(1, rootName, root.publicKey, rootName, root.privateKey, true);
  const middleDer = await certify(2, 'Storybook Attestation Intermediate', middle.publicKey, rootName, root.privateKey, true);
  const leafDer = await certify(3, 'Storybook Attestation Signer', leaf.publicKey, 'Storybook Attestation Intermediate', middle.privateKey, false);
  return { root: rootDer, x5c: [leafDer, middleDer, rootDer].map(base64), leaf: leaf.privateKey };
}

/* ---------- encodings, ECDSA and the log ---------- */

function base64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
const base64url = (b: Uint8Array) => base64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (b: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const pem = (der: Uint8Array) => `-----BEGIN PUBLIC KEY-----\n${(base64(der).match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----\n`;

const P256: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
/** An ECDSA signature as DER, from WebCrypto's r ‖ s. */
async function ecSign(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data));
  const int = (v: Uint8Array) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const t = v.subarray(i);
    return tlv(0x02, (t[0] ?? 0) & 0x80 ? join(new Uint8Array([0]), t) : t);
  };
  return seq(int(raw.subarray(0, 32)), int(raw.subarray(32)));
}

// RFC 6962: a leaf's hash, an inner node's, and the tree's (MTH) and a leaf's audit path (PATH) by their definitions.
const leafHash = (d: Uint8Array) => sha256(join(new Uint8Array([0]), d));
const nodeHash = (l: Uint8Array, r: Uint8Array) => sha256(join(new Uint8Array([1]), l, r));
const half = (n: number) => { let k = 1; while (k * 2 < n) k *= 2; return k; };
async function treeHash(d: Uint8Array[]): Promise<Uint8Array<ArrayBuffer>> {
  if (d.length <= 1) return leafHash(d[0] ?? new Uint8Array(0));
  const k = half(d.length);
  return nodeHash(await treeHash(d.slice(0, k)), await treeHash(d.slice(k)));
}
async function auditPath(m: number, d: Uint8Array[]): Promise<Uint8Array[]> {
  if (d.length <= 1) return [];
  const k = half(d.length);
  return m < k ? [...await auditPath(m, d.slice(0, k)), await treeHash(d.slice(k))] : [...await auditPath(m - k, d.slice(k)), await treeHash(d.slice(0, k))];
}

/**
 * The release as cosign v2 signs it and Rekor keeps it: the simple-signing payload (written out here as `cosign generate`
 * prints it), signed with the release key, recorded among three entries, with the log's timestamp and checkpoint, as the
 * server hands it on.
 */
async function released(release: CryptoKeyPair, log: CryptoKeyPair): Promise<ReleaseEntry> {
  const releaseKey = await spkiOf(release.publicKey);
  const pub = base64(text.encode(pem(releaseKey))).replace(/=+$/, '');
  const payload = text.encode(`{"critical":{"identity":{"docker-reference":"${IMAGES}"},"image":{"docker-manifest-digest":"${DIGEST}"},"type":"cosign container image signature"},"optional":{"commit":"${COMMIT}","dev.cosignproject.cosign/pub":"${pub}","dev.cosignproject.cosign/sigalg":"ECDSA_P256_SHA256"}}`);
  const hash = hex(await sha256(payload));
  const body = text.encode(JSON.stringify({
    apiVersion: '0.0.1', kind: 'hashedrekord',
    spec: { data: { hash: { algorithm: 'sha256', value: hash } }, signature: { content: base64(await ecSign(release.privateKey, payload)), publicKey: { content: base64(text.encode(pem(releaseKey))) } } }
  }));
  const leaves = [text.encode('an earlier entry'), text.encode('another earlier entry'), body];
  const root = await treeHash(leaves);
  const logKey = await spkiOf(log.publicKey);
  const keyHash = await sha256(logKey);
  const note = `rekor.storybook.test - 1\n${leaves.length}\n${base64(root)}\n`;
  const noteSignature = join(keyHash.subarray(0, 4), await ecSign(log.privateKey, text.encode(note)));
  const integratedTime = 1_793_800_000;
  const logIndex = 2;
  const logID = hex(keyHash);
  const stamp = await ecSign(log.privateKey, text.encode(JSON.stringify({ body: base64(body), integratedTime, logID, logIndex })));
  return {
    body: base64(body), integratedTime, logID, logIndex, signedEntryTimestamp: base64(stamp),
    inclusionProof: { checkpoint: `${note}\n— rekor.storybook.test ${base64(noteSignature)}\n`, hashes: (await auditPath(2, leaves)).map(hex), logIndex, rootHash: hex(root), treeSize: leaves.length }
  };
}

/* ---------- the anchors, made once ---------- */

interface Anchors { options: Partial<VerifyOptions>; google: Chain; release: Uint8Array<ArrayBuffer>; entry: ReleaseEntry }
let made: Promise<Anchors> | null = null;
let elsewhere: Promise<Chain> | null = null;
function anchors(): Promise<Anchors> {
  made ??= (async () => {
    const [google, release, log] = await Promise.all([chain('Storybook Confidential Space Root'), crypto.subtle.generateKey(P256, true, ['sign', 'verify']), crypto.subtle.generateKey(P256, true, ['sign', 'verify'])]);
    const releaseKey = await spkiOf(release.publicKey);
    return {
      google, release: releaseKey, entry: await released(release, log),
      options: { audience: AUDIENCE, imageRepo: IMAGES, projectNumber: PROJECT, rootCertDer: google.root, signingKeySpki: releaseKey, logKeySpki: await spkiOf(log.publicKey) }
    };
  })();
  return made;
}

/** What the stand-in's server answers: a token minted now, as the launcher's, unless a story breaks it one way. */
export async function attested(broken?: Broken): Promise<Attestation> {
  const a = await anchors();
  const signer = broken === 'another-root' ? await (elsewhere ??= chain('Storybook Confidential Space Root')) : a.google;
  const iat = Math.floor(Date.now() / 1000) - (broken === 'too-old' ? 30 * 60 : 30);
  const digest = broken === 'unreleased' ? UNRELEASED : DIGEST;
  const spki = base64url(await sha256(text.encode('the stand-in’s TLS key')));
  const claims = {
    aud: AUDIENCE, iss: 'https://confidentialcomputing.googleapis.com', sub: 'https://www.googleapis.com/compute/v1/projects/vandelay/zones/us-central1-a/instances/alcove-api-1',
    iat, nbf: iat, exp: iat + 3600, eat_nonce: ['alcove:attestation:v1', `spki:${spki}`, `commit:${COMMIT}`],
    secboot: true, oemid: 11129, hwmodel: 'GCP_INTEL_TDX', swname: 'CONFIDENTIAL_SPACE', swversion: ['261001'],
    dbgstat: broken === 'debuggable' ? 'enabled' : 'disabled-since-boot',
    submods: {
      confidential_space: { support_attributes: ['LATEST', 'STABLE', 'USABLE'] },
      container: {
        image_reference: `${IMAGES}@${digest}`, image_digest: digest,
        image_signatures: [{ key_id: hex(await sha256(a.release)), signature: 'storybook', signature_algorithm: 'ECDSA_P256_SHA256' }]
      },
      gce: { zone: 'us-central1-a', project_id: 'vandelay', project_number: PROJECT, instance_name: 'alcove-api-1' }
    }
  };
  const head = base64url(text.encode(JSON.stringify({ alg: 'RS256', kid: 'storybook', typ: 'JWT', x5c: signer.x5c })));
  const body = base64url(text.encode(JSON.stringify(claims)));
  const signature = await rsaSign(signer.leaf, text.encode(`${head}.${body}`));
  return { tee: 'confidential-space', build: { commit: broken === 'another-build' ? ELSEWHERE : COMMIT }, tls: { spkiSha256: spki }, token: `${head}.${body}.${base64url(signature)}`, release: a.entry };
}

/** The app's check of what the server says it runs on, with Storybook's anchors in place of production's. */
export const checkServer = async (a: Attestation): Promise<Trust> => verifyServer(a, (await anchors()).options);
