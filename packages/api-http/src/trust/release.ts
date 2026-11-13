/*
 * The release in Sigstore's public log (Rekor). CI signs every image it deploys with Alcove's release key (Cloud KMS),
 * with cosign v2.6.5, annotating the commit it was built from and, for Confidential Space, the key and its algorithm;
 * cosign records the signature in Rekor, an append-only log no one can rewrite:
 *
 *   cosign sign --key gcpkms://…/alcove-image-signing/cryptoKeyVersions/1 --tlog-upload=true -a commit=<40 hex>
 *     -a dev.cosignproject.cosign/sigalg=ECDSA_P256_SHA256 -a dev.cosignproject.cosign/pub=<PUB> <repo>@sha256:<digest>
 *
 * The token proves which image runs; this proves Alcove released that image, from that commit, in public. The commit the
 * server reports is its own word until an entry signed with our key maps its digest to it.
 *
 * The API looks its own release up (`findRelease`, which tee.ts runs) and hands the entry on with its token, so no browser
 * asks the log itself. Whoever relays it can only withhold it: an entry counts only when the log signed it (its signed entry
 * timestamp), its inclusion proof leads to a checkpoint the log signed, and it's a `hashedrekord` of exactly the payload
 * rebuilt here, signed with our key (`checkRelease`, offline, against the keys the caller pins).
 *
 * The API imports this file as `@alcove/api-http/release`, and nothing else of the client.
 */
import type { ReleaseEntry } from '@alcove/api';
import { z } from 'zod';
import { ecdsaRaw } from './der';
import { concatBytes, fromBase64, fromHex, fromPem, fromUtf8, sameBytes, sha256, toBase64, toHex, toPem, utf8, type Bytes } from './encoding';
import { ALCOVE_RELEASE_KEY, REKOR, REKOR_KEY } from './pins';
import { Refused } from './refusal';

export const LOG_UNCHECKED = 'Sigstore’s public log couldn’t be checked.';
const NOT_GIVEN = 'The server didn’t hand over its build’s entry in Sigstore’s public log.';
const UNREACHABLE = 'Sigstore’s public log couldn’t be reached.';
const NOT_RELEASED = 'This build isn’t in Sigstore’s public log.';
const NOT_SIGNED = 'The public log’s entry for this build isn’t signed with Alcove’s release key.';
const NOT_LOGGED = 'Sigstore’s public log didn’t sign its entry for this build.';
const NOT_INCLUDED = 'Sigstore’s public log can’t prove it holds this build.';

/** How many of the entries the log finds for a release are looked at, the first that checks out counting. */
const MOST_ENTRIES = 8;
/** How long one request to the log may take. */
const ASK_MS = 15_000;

/** What an entry is checked against: where releases are named, Alcove's release key and the log's key, each DER SubjectPublicKeyInfo. */
export interface ReleaseAnchors { imageRepo: string; signingKeySpki: Uint8Array; logKeySpki: Uint8Array }

/**
 * cosign v2's simple-signing payload for a release, byte for byte: what the `cosign sign` above signs, and what
 * `cosign generate -a commit=<sha> -a dev.cosignproject.cosign/sigalg=ECDSA_P256_SHA256 -a dev.cosignproject.cosign/pub=<PUB>
 * <repo>@<digest>` prints (checked with cosign v2.6.5). It's Go's encoding/json of sigstore's `payload.Cosign`: no
 * spaces, every object's keys in order, no newline at the end:
 *
 * {"critical":{"identity":{"docker-reference":"<repo>"},"image":{"docker-manifest-digest":"sha256:<64 hex>"},"type":"cosign container image signature"},"optional":{"commit":"<40 hex>","dev.cosignproject.cosign/pub":"<PUB>","dev.cosignproject.cosign/sigalg":"ECDSA_P256_SHA256"}}
 *
 * PUB is base64 of the release key's PEM as `openssl pkey -pubin -outform PEM` writes it (64 characters a line, a
 * newline at the end) without its `=` padding, since cosign splits an annotation at `=`. The digest and commit are
 * checked as hex before they get here, and nothing else needs escaping in Go's JSON either.
 */
export function releasePayload(repo: string, digest: string, commit: string, releaseKey: Uint8Array): Bytes {
  const pub = toBase64(utf8(toPem(releaseKey, 'PUBLIC KEY'))).replace(/=+$/, '');
  return utf8(JSON.stringify({
    critical: { identity: { 'docker-reference': repo }, image: { 'docker-manifest-digest': digest }, type: 'cosign container image signature' },
    optional: { commit, 'dev.cosignproject.cosign/pub': pub, 'dev.cosignproject.cosign/sigalg': 'ECDSA_P256_SHA256' }
  }));
}

/** An entry as Rekor's API answers with it, which the API hands on as a ReleaseEntry. */
const LogEntry = z.object({
  body: z.string(),
  integratedTime: z.number().int(),
  logID: z.string(),
  logIndex: z.number().int().nonnegative(),
  verification: z.object({
    signedEntryTimestamp: z.string(),
    inclusionProof: z.object({
      checkpoint: z.string(),
      hashes: z.array(z.string()),
      logIndex: z.number().int().nonnegative(),
      rootHash: z.string(),
      treeSize: z.number().int().positive()
    })
  })
});
const HashedRekord = z.object({
  apiVersion: z.literal('0.0.1'),
  kind: z.literal('hashedrekord'),
  spec: z.object({
    data: z.object({ hash: z.object({ algorithm: z.literal('sha256'), value: z.string() }) }),
    signature: z.object({ content: z.string(), publicKey: z.object({ content: z.string() }) })
  })
});

/** An ECDSA P-256 signature (DER) over `data`, by the key in `spki`. */
async function signedWith(spki: Bytes, signature: Bytes, data: Bytes): Promise<boolean> {
  const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, ecdsaRaw(signature), data);
}

/** The key an entry was signed with (base64 of its PEM), or nothing when it's a certificate or can't be read. */
function keyIn(content: string): Bytes {
  try { return fromPem(fromUtf8(fromBase64(content)), 'PUBLIC KEY'); } catch { return new Uint8Array(0); }
}

const node = async (left: Bytes, right: Bytes): Promise<Bytes> => sha256(concatBytes(new Uint8Array([1]), left, right));

/** The root an RFC 6962 inclusion proof leads to from a leaf (RFC 9162 2.1.3.2), or null when the proof doesn't fit. */
async function rootFrom(leaf: Bytes, index: number, size: number, path: Bytes[]): Promise<Bytes | null> {
  if (index >= size) return null;
  let fn = BigInt(index);
  let sn = BigInt(size - 1);
  let r = await sha256(concatBytes(new Uint8Array([0]), leaf));
  for (const p of path) {
    if (sn === 0n) return null;
    if ((fn & 1n) === 1n || fn === sn) {
      r = await node(p, r);
      while ((fn & 1n) === 0n && fn !== 0n) { fn >>= 1n; sn >>= 1n; }
    } else {
      r = await node(r, p);
    }
    fn >>= 1n;
    sn >>= 1n;
  }
  return sn === 0n ? r : null;
}

/**
 * Whether a checkpoint (a signed note: origin, tree size and root hash, a blank line, then `— <name> <base64>` lines)
 * is signed by the log's key for this size and root. A signature names its key by the first four bytes of SHA-256 of
 * the key's DER, then the ECDSA signature over the note's text.
 */
async function checkpointHolds(checkpoint: string, logKey: Bytes, size: number, root: Bytes): Promise<boolean> {
  const split = checkpoint.indexOf('\n\n');
  if (split < 0) return false;
  const text = checkpoint.slice(0, split + 1);
  const [, sizeLine, rootLine] = text.split('\n');
  if (sizeLine !== String(size) || rootLine === undefined || !sameBytes(fromBase64(rootLine), root)) return false;
  const hint = (await sha256(logKey)).subarray(0, 4);
  for (const line of checkpoint.slice(split + 2).split('\n')) {
    const sig = /^— \S+ ([A-Za-z0-9+/=]+)$/.exec(line)?.[1];
    const bytes = sig === undefined ? null : fromBase64(sig);
    if (bytes && sameBytes(bytes.subarray(0, 4), hint)) return signedWith(logKey, bytes.subarray(4), utf8(text));
  }
  return false;
}

/** Checks one entry for the payload: first that the log holds it, then what it says. Refuses with why not. */
async function checkEntry(e: ReleaseEntry, payload: Bytes, payloadHash: string, o: ReleaseAnchors): Promise<void> {
  // The log's promise to include it: its signature over the entry as canonical JSON (keys in order, no spaces).
  const logKey = new Uint8Array(o.logKeySpki);
  const stamp = utf8(JSON.stringify({ body: e.body, integratedTime: e.integratedTime, logID: e.logID, logIndex: e.logIndex }));
  if (e.logID !== toHex(await sha256(logKey)) || !(await signedWith(logKey, fromBase64(e.signedEntryTimestamp), stamp))) throw new Refused(NOT_LOGGED);

  // And the proof it did: the path from this entry to a root the log signed in a checkpoint.
  const body = fromBase64(e.body);
  const proof = e.inclusionProof;
  const root = await rootFrom(body, proof.logIndex, proof.treeSize, proof.hashes.map(fromHex));
  const claimed = fromHex(proof.rootHash);
  if (!root || !sameBytes(root, claimed) || !(await checkpointHolds(proof.checkpoint, logKey, proof.treeSize, claimed))) throw new Refused(NOT_INCLUDED);

  // What it holds: this payload, signed with our key.
  const record = HashedRekord.parse(JSON.parse(fromUtf8(body)));
  if (record.spec.data.hash.value !== payloadHash) throw new Refused(NOT_RELEASED);
  const ours = new Uint8Array(o.signingKeySpki);
  if (!sameBytes(keyIn(record.spec.signature.publicKey.content), ours) || !(await signedWith(ours, fromBase64(record.spec.signature.content), payload))) throw new Refused(NOT_SIGNED);
}

/** The payload for a release, and its SHA-256 as hex, which is how the log knows it. */
async function payloadOf(o: Pick<ReleaseAnchors, 'imageRepo' | 'signingKeySpki'>, digest: string, commit: string): Promise<{ payload: Bytes; hash: string }> {
  const payload = releasePayload(o.imageRepo, digest, commit, o.signingKeySpki);
  return { payload, hash: toHex(await sha256(payload)) };
}

/**
 * Refuses unless `entry` is this image's release for this commit in Sigstore's public log, signed with Alcove's release key,
 * and the log signed it and proves it holds it. Offline: only the keys in `o` are trusted, never whoever handed it on.
 */
export async function checkRelease(o: ReleaseAnchors, entry: ReleaseEntry | null, digest: string, commit: string): Promise<void> {
  if (!entry) throw new Refused(NOT_GIVEN);
  const { payload, hash } = await payloadOf(o, digest, commit);
  await checkEntry(entry, payload, hash, o);
}

/** Sigstore's public log as the API reaches it, and the keys it checks what the log says with. */
export interface ReleaseLog {
  url: string;
  /** The log's key, DER SubjectPublicKeyInfo: its signed entry timestamps and checkpoints verify with it. */
  logKeySpki: Uint8Array;
  /** Alcove's release key, DER SubjectPublicKeyInfo: only entries signed with it are asked for. */
  releaseKeySpki: Uint8Array;
  fetch: typeof fetch;
}
/** Production's log: rekor.sigstore.dev, with the keys pinned here. */
export const productionLog = (): ReleaseLog => ({
  url: REKOR, logKeySpki: fromPem(REKOR_KEY, 'PUBLIC KEY'), releaseKeySpki: fromPem(ALCOVE_RELEASE_KEY, 'PUBLIC KEY'),
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)
});

/** Answers from the log as JSON, or refuses as unreachable. */
async function ask(log: ReleaseLog, signal: AbortSignal | undefined, path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    const limit = AbortSignal.timeout(ASK_MS);
    res = await log.fetch(`${log.url.replace(/\/+$/, '')}${path}`, { ...init, signal: signal ? AbortSignal.any([signal, limit]) : limit });
  } catch {
    throw new Refused(UNREACHABLE);
  }
  if (!res.ok) throw new Refused(UNREACHABLE);
  return res.json();
}

/**
 * The release's entry in `log` for the image `imageRepo@digest` built from `commit`, as `checkRelease` will check it, or a
 * refusal saying why there's none. Only entries with Alcove's release key are asked for: anyone can add an entry for a
 * hash, signed with a key of their own. `signal` ends the search.
 */
export async function findRelease(log: ReleaseLog, imageRepo: string, digest: string, commit: string, signal?: AbortSignal): Promise<ReleaseEntry> {
  const o: ReleaseAnchors = { imageRepo, signingKeySpki: log.releaseKeySpki, logKeySpki: log.logKeySpki };
  const { payload, hash } = await payloadOf(o, digest, commit);
  const ourKey = toBase64(utf8(toPem(log.releaseKeySpki, 'PUBLIC KEY')));
  const found = z.array(z.string()).parse(await ask(log, signal, '/api/v1/index/retrieve', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash: `sha256:${hash}`, publicKey: { format: 'x509', content: ourKey }, operator: 'and' })
  }));
  const ids = found.filter((id) => /^(?:[0-9a-f]{16})?[0-9a-f]{64}$/.test(id)).slice(0, MOST_ENTRIES);
  if (!ids.length) throw new Refused(NOT_RELEASED);
  let first: Refused | null = null;
  for (const id of ids) {
    try {
      const [answered] = Object.values(z.record(z.string(), LogEntry).parse(await ask(log, signal, `/api/v1/log/entries/${id}`)));
      if (!answered) throw new Refused(NOT_RELEASED);
      const { verification, ...rest } = answered;
      const entry: ReleaseEntry = { ...rest, signedEntryTimestamp: verification.signedEntryTimestamp, inclusionProof: verification.inclusionProof };
      await checkEntry(entry, payload, hash, o);
      return entry;
    } catch (e) {
      first ??= e instanceof Refused ? e : new Refused(LOG_UNCHECKED);
    }
  }
  throw first ?? new Refused(NOT_RELEASED);
}
