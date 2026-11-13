/*
 * A stand-in for Sigstore's public log (Rekor), for integration tests (docs: privacy-keys-and-sessions › How a client checks
 * the server). One HTTP server answering the two requests the API makes to find its own release (POST /api/v1/index/retrieve
 * for the entries with a hash and a key, GET /api/v1/log/entries/{uuid} for one), as Rekor answers them: each entry with the
 * log's signed entry timestamp and an RFC 6962 inclusion proof to a checkpoint the log signed, under a log key of its own.
 *
 * It also holds Alcove's release key, as CI does, and records releases with it as cosign v2 does: the simple-signing payload,
 * written out here as `cosign generate` prints it (never with the code under test), signed and logged as a `hashedrekord`.
 * `entryFor` makes an entry for any release in a log of any shape, signed with any of its keys, for a test to hand a client.
 */
import type { ReleaseEntry } from '@alcove/api';
import type { ReleaseLog } from '@alcove/api-http/release';
import { createHash, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { z } from 'zod';

/** How the log names itself: its checkpoints' first line (with its tree's ID), and the key that signs them. */
const NAME = 'rekor.alcove.test';
const ORIGIN = `${NAME} - 2605523413`;

export interface FakeRekor {
  url: string;
  /** The log as the API reaches it (start.ts › Outside): here, with the log's key and the release key. */
  log: ReleaseLog;
  /** What a client pins: the log's key and Alcove's release key, DER SubjectPublicKeyInfo. */
  logKeySpki: Uint8Array;
  releaseKeySpki: Uint8Array;
  /** Logs a release of `repo@digest` from `commit`, as CI's cosign does at a deploy: signed with the release key, or another. */
  release(repo: string, digest: string, commit: string, signer?: Signer): void;
  /** An entry for a release in a log of `size` entries, at `at`: signed with the release key or another, logged by this log or another. */
  entryFor(repo: string, digest: string, commit: string, o?: { size?: number; at?: number; signer?: Signer; log?: Signer }): ReleaseEntry;
  /** While set, the log answers nothing but 503. */
  down: boolean;
  /** Every request it was sent. */
  asked: number;
  close(): Promise<void>;
}
/** Whose key: Alcove's release key (or the log's own), or another nobody pins. */
export type Signer = 'ours' | 'another';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
const spkiOf = (key: KeyObject) => createPublicKey(key).export({ type: 'spki', format: 'der' });
const pemOf = (key: KeyObject) => createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
const ecKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
/** An ECDSA P-256 signature, DER, as cosign and Rekor make them. */
const signed = (key: KeyObject, data: Uint8Array) => sign('sha256', data, key);

// RFC 6962: a leaf's hash, an inner node's, and the tree's (MTH) and a leaf's audit path (PATH), by their definitions.
const leafHash = (d: Uint8Array) => sha256(Buffer.concat([Buffer.from([0]), d]));
const nodeHash = (l: Uint8Array, r: Uint8Array) => sha256(Buffer.concat([Buffer.from([1]), l, r]));
const half = (n: number) => { let k = 1; while (k * 2 < n) k *= 2; return k; };
function treeHash(d: Uint8Array[]): Buffer {
  if (d.length <= 1) return leafHash(d[0] ?? new Uint8Array(0));
  const k = half(d.length);
  return nodeHash(treeHash(d.slice(0, k)), treeHash(d.slice(k)));
}
function auditPath(m: number, d: Uint8Array[]): Buffer[] {
  if (d.length <= 1) return [];
  const k = half(d.length);
  return m < k ? [...auditPath(m, d.slice(0, k)), treeHash(d.slice(k))] : [...auditPath(m - k, d.slice(k)), treeHash(d.slice(0, k))];
}

const Search = z.object({ hash: z.string(), publicKey: z.object({ format: z.literal('x509'), content: z.string() }), operator: z.literal('and') });
const read = async (req: IncomingMessage) => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c)); return Buffer.concat(chunks).toString('utf8'); };

export async function startFakeRekor(): Promise<FakeRekor> {
  const logKey = ecKey();
  const otherLogKey = ecKey();
  const releaseKey = ecKey();
  const otherKey = ecKey();
  const keyOf = (signer: Signer) => (signer === 'ours' ? releaseKey : otherKey);

  /** A release as cosign v2 signs it and logs it: the payload, then the `hashedrekord` that holds its hash and signature. */
  const record = (repo: string, digest: string, commit: string, signer: Signer) => {
    const pub = Buffer.from(pemOf(releaseKey)).toString('base64').replace(/=+$/, '');
    const payload = Buffer.from(`{"critical":{"identity":{"docker-reference":"${repo}"},"image":{"docker-manifest-digest":"${digest}"},"type":"cosign container image signature"},"optional":{"commit":"${commit}","dev.cosignproject.cosign/pub":"${pub}","dev.cosignproject.cosign/sigalg":"ECDSA_P256_SHA256"}}`);
    const hash = sha256(payload).toString('hex');
    const key = keyOf(signer);
    const body = Buffer.from(JSON.stringify({
      apiVersion: '0.0.1', kind: 'hashedrekord',
      spec: { data: { hash: { algorithm: 'sha256', value: hash } }, signature: { content: signed(key, payload).toString('base64'), publicKey: { content: Buffer.from(pemOf(key)).toString('base64') } } }
    }));
    return { body, hash, keySpki: spkiOf(key) };
  };
  /** The entry for `leaves[at]`, as a log with `key` answers for it: its timestamp, and its proof to a checkpoint it signed now. */
  const entry = (leaves: Buffer[], at: number, key: KeyObject): ReleaseEntry => {
    const body = leaves[at] ?? Buffer.alloc(0);
    const keyHash = sha256(spkiOf(key));
    const root = treeHash(leaves);
    const note = `${ORIGIN}\n${leaves.length}\n${root.toString('base64')}\n`;
    const noteSignature = Buffer.concat([keyHash.subarray(0, 4), signed(key, Buffer.from(note))]);
    const integratedTime = 1_793_800_000 + at;
    const logID = keyHash.toString('hex');
    const stamp = signed(key, Buffer.from(JSON.stringify({ body: body.toString('base64'), integratedTime, logID, logIndex: at })));
    return {
      body: body.toString('base64'), integratedTime, logID, logIndex: at, signedEntryTimestamp: stamp.toString('base64'),
      inclusionProof: { checkpoint: `${note}\n— ${NAME} ${noteSignature.toString('base64')}\n`, hashes: auditPath(at, leaves).map((h) => h.toString('hex')), logIndex: at, rootHash: root.toString('hex'), treeSize: leaves.length }
    };
  };
  const filler = (n: number) => Buffer.from(`an entry of someone else's, ${n}`);

  // The log as Rekor keeps it: others' entries, then Alcove's releases among them as they're logged.
  const leaves: Buffer[] = [0, 1, 2, 3, 4].map(filler);
  const logged: { uuid: string; hash: string; keySpki: Buffer; at: number }[] = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      self.asked++;
      const text = await read(req);
      const json = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (self.down) return json(503, { code: 503, message: 'unavailable' });
      const url = new URL(req.url ?? '/', 'http://rekor.invalid');
      if (req.method === 'POST' && url.pathname === '/api/v1/index/retrieve') {
        let asked: unknown;
        try { asked = JSON.parse(text); } catch { asked = undefined; }
        const s = Search.safeParse(asked);
        if (!s.success) return json(400, { code: 400, message: 'bad search' });
        const key = createPublicKey(Buffer.from(s.data.publicKey.content, 'base64').toString('utf8')).export({ type: 'spki', format: 'der' });
        return json(200, logged.filter((l) => `sha256:${l.hash}` === s.data.hash && l.keySpki.equals(key)).map((l) => l.uuid));
      }
      const uuid = /^\/api\/v1\/log\/entries\/([0-9a-f]+)$/.exec(url.pathname)?.[1];
      const found = logged.find((l) => l.uuid === uuid);
      if (req.method === 'GET' && found) {
        const { signedEntryTimestamp, inclusionProof, ...rest } = entry(leaves, found.at, logKey);
        return json(200, { [found.uuid]: { ...rest, verification: { signedEntryTimestamp, inclusionProof } } });
      }
      return json(404, { code: 404, message: 'not found' });
    })().catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  const self: FakeRekor = {
    url, logKeySpki: new Uint8Array(spkiOf(logKey)), releaseKeySpki: new Uint8Array(spkiOf(releaseKey)), down: false, asked: 0,
    log: { url, logKeySpki: new Uint8Array(spkiOf(logKey)), releaseKeySpki: new Uint8Array(spkiOf(releaseKey)), fetch: (input, init) => fetch(input, init) },
    release(repo, digest, commit, signer = 'ours') {
      const r = record(repo, digest, commit, signer);
      leaves.push(filler(leaves.length));
      const at = leaves.push(r.body) - 1;
      logged.push({ uuid: leafHash(r.body).toString('hex'), hash: r.hash, keySpki: r.keySpki, at });
    },
    entryFor(repo, digest, commit, o = {}) {
      const size = o.size ?? 7;
      const at = o.at ?? size - 1;
      const own = Array.from({ length: size }, (_, n) => filler(n));
      own[at] = record(repo, digest, commit, o.signer ?? 'ours').body;
      return entry(own, at, (o.log ?? 'ours') === 'ours' ? logKey : otherLogKey);
    },
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); })
  };
  return self;
}
