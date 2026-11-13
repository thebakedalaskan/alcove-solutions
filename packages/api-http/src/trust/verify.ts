/*
 * Checking Alcove's server before trusting it, in a browser or in Node (CI checks every deploy with the same code). Two
 * stages, each of which can only refuse: the Confidential Space token (token.ts), then the release in Sigstore's public
 * log (release.ts), as the server hands its entry on. Nothing is fetched: everything is checked against the keys pinned
 * here. docs/engineering/privacy-keys-and-sessions.md › How a client checks the server.
 */
import type { Attestation, Trust } from '@alcove/api';
import { fromPem } from './encoding';
import { ALCOVE_API, ALCOVE_IMAGES, ALCOVE_PROJECT_NUMBER, ALCOVE_RELEASE_KEY, CONFIDENTIAL_SPACE_ROOT, REKOR_KEY } from './pins';
import { Refused, stage } from './refusal';
import { checkRelease, LOG_UNCHECKED } from './release';
import { checkToken, TOKEN_UNREADABLE } from './token';

/** What the check trusts. Every field defaults to production's. */
export interface VerifyOptions {
  /** The API the token must be made for: its `API_URL`, which the API asks Google to put in `aud`. */
  audience: string;
  /** Where Alcove's images are: the token must name one of them by digest, and the release log names it this way. */
  imageRepo: string;
  /** The Google Cloud project, by number, the server must run in. */
  projectNumber: string;
  /** The root every token's chain must end at, DER. */
  rootCertDer: Uint8Array;
  /** Alcove's release key, DER SubjectPublicKeyInfo: CI signs every image it deploys with it. */
  signingKeySpki: Uint8Array;
  /** The key Sigstore's public log signs its entries and checkpoints with, DER SubjectPublicKeyInfo. */
  logKeySpki: Uint8Array;
  /** Now, in milliseconds. */
  now: () => number;
  /** How old a token may be, beside the five minutes this device's clock may be off. The API hands out none over 15 minutes old. */
  maxAgeSeconds: number;
}

function production(): VerifyOptions {
  return {
    audience: ALCOVE_API,
    imageRepo: ALCOVE_IMAGES,
    projectNumber: ALCOVE_PROJECT_NUMBER,
    rootCertDer: fromPem(CONFIDENTIAL_SPACE_ROOT, 'CERTIFICATE'),
    signingKeySpki: fromPem(ALCOVE_RELEASE_KEY, 'PUBLIC KEY'),
    logKeySpki: fromPem(REKOR_KEY, 'PUBLIC KEY'),
    now: () => Date.now(),
    maxAgeSeconds: 20 * 60
  };
}

/**
 * What to make of the server's attestation: `verified` only when every check passes, `unverified` with the first
 * reason one didn't, and `none` when the server says it isn't in a TEE. Never throws, and asks nothing of anyone.
 */
export async function verifyServer(a: Attestation, opts?: Partial<VerifyOptions>): Promise<Trust> {
  const o: VerifyOptions = { ...production(), ...opts };
  const at = o.now();
  const commit = a.build.commit;
  if (a.tee === 'none') return { state: 'none', commit, at };
  // Known once the token checks out, so a release that doesn't still says which image it was.
  let named: string | undefined;
  try {
    const digest = await stage(TOKEN_UNREADABLE, () => checkToken(a, o, at));
    named = digest;
    await stage(LOG_UNCHECKED, () => checkRelease(o, a.release, digest, commit));
    return { state: 'verified', commit, digest, at };
  } catch (e) {
    return { state: 'unverified', reason: e instanceof Refused ? e.reason : TOKEN_UNREADABLE, commit, digest: named, at };
  }
}
