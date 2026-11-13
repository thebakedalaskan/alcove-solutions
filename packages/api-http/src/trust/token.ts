/*
 * The server's Confidential Space attestation token: a PKI token, which is a JWT (RS256) whose `x5c` header carries the
 * certificate that signed it, the intermediate and Google's root. It's checked as Google's own sample checks one
 * (Confidential Space › Connect to external resources › PKI attestation tokens), but without its lifetime helper, which
 * lets expired certificates through: the root must be the pinned one, byte for byte; each certificate must be current
 * and signed by the next, the issuers certificate authorities; the leaf an RSA key signed with SHA-256; and the token
 * signed by the leaf. Only then are its claims read: who it's for, how old it is, what runs (an image of Alcove's that
 * Confidential Space found signed with Alcove's release key), where (Alcove's Google Cloud project), and the nonces: that it
 * was asked for to attest to Alcove's server, and the server's TLS key and build.
 */
import type { Attestation } from '@alcove/api';
import { z } from 'zod';
import { certificate, OIDS, type Certificate } from './der';
import { fromBase64, fromBase64Url, fromUtf8, sameBytes, sha256, toHex, utf8, type Bytes } from './encoding';
import { Refused } from './refusal';
import type { VerifyOptions } from './verify';

export const TOKEN_UNREADABLE = 'The server’s attestation token can’t be read.';
const NOT_GOOGLE = 'The token isn’t signed by Google’s Confidential Space root.';
const OUT_OF_DATE = 'A certificate the token is signed under isn’t valid at this time.';
const BAD_SIGNATURE = 'The token’s signature doesn’t check out.';
const NOT_ATTESTATION = 'The token wasn’t issued by Google Cloud Attestation.';
const NOT_FOR_US = 'The token was made for another server.';
const AHEAD = 'The token is dated after this device’s clock.';
const EXPIRED = 'The token has expired.';
const NOT_CONFIDENTIAL_SPACE = 'The server isn’t running Confidential Space.';
const NOT_TDX = 'The server isn’t on Intel TDX.';
const DEBUGGABLE = 'The server could be debugged.';
const NOT_STABLE = 'The server’s Confidential Space image isn’t one Google supports as stable.';
const NOT_OURS = 'The server runs an image from outside Alcove’s registry.';
const UNSIGNED = 'Confidential Space didn’t find Alcove’s release key’s signature on the server’s image.';
const NOT_OUR_PROJECT = 'The server runs in a Google Cloud project that isn’t Alcove’s.';
const NOT_ASKED_FOR_THIS = 'The token wasn’t asked for to attest to Alcove’s server.';
const NOT_A_COMMIT = 'The server’s build isn’t a commit.';
const NO_TLS_KEY = 'The token doesn’t name the server’s TLS key.';
const NO_BUILD = 'The token doesn’t name the build the server reports.';

/** How far this device's clock may be from Google's before a token or certificate looks dated ahead of it, or too old. */
const SKEW_SECONDS = 5 * 60;
/** What the API's token request says the nonces are for (apps/api/src/tee/tee.ts), so a token asked for anything else isn't taken. */
const PURPOSE = 'alcove:attestation:v1';

const Header = z.object({ alg: z.string(), x5c: z.array(z.string()) });
const Claims = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number(),
  exp: z.number(),
  nbf: z.number().optional(),
  eat_nonce: z.union([z.string(), z.array(z.string())]).optional(),
  swname: z.string().optional(),
  hwmodel: z.string().optional(),
  dbgstat: z.string().optional(),
  submods: z.object({
    confidential_space: z.object({ support_attributes: z.array(z.string()).optional() }).optional(),
    container: z.object({
      image_reference: z.string(),
      image_digest: z.string(),
      image_signatures: z.array(z.object({ key_id: z.string(), signature_algorithm: z.string() })).optional()
    }).optional(),
    gce: z.object({ project_number: z.union([z.string(), z.number()]).transform(String) }).optional()
  }).optional()
});

const json = (part: string): unknown => JSON.parse(fromUtf8(fromBase64Url(part)));
/** An API's address as a token names it, whether or not it ends in a slash. */
const address = (s: string): string => s.replace(/\/+$/, '');
const RSA_HASHES = [[OIDS.sha256WithRSA, 'SHA-256'], [OIDS.sha384WithRSA, 'SHA-384'], [OIDS.sha512WithRSA, 'SHA-512']] as const;

/** Whether `issuer`'s RSA key signed `child`. */
async function signedBy(child: Certificate, issuer: Certificate): Promise<boolean> {
  const hash = RSA_HASHES.find(([oid]) => sameBytes(oid, child.signatureAlgorithm))?.[1];
  if (!hash || !sameBytes(issuer.keyAlgorithm, OIDS.rsaEncryption)) return false;
  const key = await crypto.subtle.importKey('spki', issuer.spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, child.signature, child.tbs);
}

/** The certificate that signed the token, once its chain ends at the pinned root and every link in it holds. */
async function signer(x5c: string[], root: Bytes, now: number): Promise<Certificate> {
  const [leafDer, middleDer, rootDer, ...more] = x5c.map(fromBase64);
  if (!leafDer || !middleDer || !rootDer || more.length || !sameBytes(rootDer, root)) throw new Refused(NOT_GOOGLE);
  const chain = [certificate(leafDer), certificate(middleDer), certificate(root)] as const;
  const [leaf] = chain;
  if (!sameBytes(leaf.keyAlgorithm, OIDS.rsaEncryption) || !sameBytes(leaf.signatureAlgorithm, OIDS.sha256WithRSA)) throw new Refused(NOT_GOOGLE);
  for (const [child, issuer] of [[chain[0], chain[1]], [chain[1], chain[2]]] as const) {
    const mayIssue = issuer.ca && (issuer.keyUsage === null || (issuer.keyUsage & 0x04) !== 0);
    if (!mayIssue || !sameBytes(child.issuer, issuer.subject) || !(await signedBy(child, issuer))) throw new Refused(NOT_GOOGLE);
  }
  const skew = SKEW_SECONDS * 1000;
  if (chain.some((c) => now + skew < c.notBefore || now - skew > c.notAfter)) throw new Refused(OUT_OF_DATE);
  return leaf;
}

/**
 * Checks the token in a Confidential Space attestation and returns the image digest it names, or refuses with why. The
 * commit and TLS key it must carry are the ones the attestation reports beside it.
 */
export async function checkToken(
  a: Extract<Attestation, { tee: 'confidential-space' }>,
  o: Pick<VerifyOptions, 'audience' | 'imageRepo' | 'projectNumber' | 'rootCertDer' | 'signingKeySpki' | 'maxAgeSeconds'>,
  now: number
): Promise<string> {
  const [head, body, signature, ...more] = a.token.split('.');
  if (head === undefined || body === undefined || signature === undefined || more.length) throw new Refused(TOKEN_UNREADABLE);
  const header = Header.parse(json(head));
  if (header.alg !== 'RS256') throw new Refused(NOT_GOOGLE);
  const leaf = await signer(header.x5c, new Uint8Array(o.rootCertDer), now);
  const key = await crypto.subtle.importKey('spki', leaf.spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(signature), utf8(`${head}.${body}`)))) throw new Refused(BAD_SIGNATURE);

  const c = Claims.parse(json(body));
  if (c.iss !== 'https://confidentialcomputing.googleapis.com') throw new Refused(NOT_ATTESTATION);
  if (!(typeof c.aud === 'string' ? [c.aud] : c.aud).some((aud) => address(aud) === address(o.audience))) throw new Refused(NOT_FOR_US);
  const seconds = now / 1000;
  if (c.iat > seconds + SKEW_SECONDS || (c.nbf ?? c.iat) > seconds + SKEW_SECONDS) throw new Refused(AHEAD);
  if (seconds - c.iat > o.maxAgeSeconds + SKEW_SECONDS) throw new Refused(`The token is more than ${Math.round(o.maxAgeSeconds / 60)} minutes old.`);
  if (c.exp <= seconds) throw new Refused(EXPIRED);

  if (c.swname !== 'CONFIDENTIAL_SPACE') throw new Refused(NOT_CONFIDENTIAL_SPACE);
  if (c.hwmodel !== 'GCP_INTEL_TDX') throw new Refused(NOT_TDX);
  if (c.dbgstat !== 'disabled-since-boot') throw new Refused(DEBUGGABLE);
  if (!c.submods?.confidential_space?.support_attributes?.includes('STABLE')) throw new Refused(NOT_STABLE);
  const image = c.submods.container;
  if (!image || !/^sha256:[0-9a-f]{64}$/.test(image.image_digest) || image.image_reference !== `${o.imageRepo}@${image.image_digest}`) throw new Refused(NOT_OURS);
  // Confidential Space names the keys whose signatures on the image it checked, by the hex SHA-256 of their DER.
  const keyId = toHex(await sha256(new Uint8Array(o.signingKeySpki)));
  if (!image.image_signatures?.some((s) => s.key_id.toLowerCase() === keyId && s.signature_algorithm === 'ECDSA_P256_SHA256')) throw new Refused(UNSIGNED);
  if (c.submods.gce?.project_number !== o.projectNumber) throw new Refused(NOT_OUR_PROJECT);

  // The nonces are matched by what they start with, never by where they are: Google doesn't promise to keep their order.
  const nonces = typeof c.eat_nonce === 'string' ? [c.eat_nonce] : c.eat_nonce ?? [];
  if (!nonces.includes(PURPOSE)) throw new Refused(NOT_ASKED_FOR_THIS);
  const only = (prefix: string, value: string) => nonces.includes(`${prefix}${value}`) && nonces.every((n) => !n.startsWith(prefix) || n === `${prefix}${value}`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(a.tls.spkiSha256) || !only('spki:', a.tls.spkiSha256)) throw new Refused(NO_TLS_KEY);
  if (!/^[0-9a-f]{40}$/.test(a.build.commit)) throw new Refused(NOT_A_COMMIT);
  if (!only('commit:', a.build.commit)) throw new Refused(NO_BUILD);
  return image.image_digest;
}
