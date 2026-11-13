import { z } from '../shared/zod';
/* ---------- what's running ---------- */

/**
 * The release's entry in Sigstore's public log (Rekor), as the API found it there for its own image and commit and hands it
 * on, so no browser asks the log itself: the entry (a `hashedrekord`, base64), when and where the log put it, the log's
 * signed promise to include it, and the proof it did, an RFC 6962 inclusion proof to a checkpoint the log signed. Nothing
 * here is trusted for having come from the API: a client checks all of it against the keys it pins (docs:
 * privacy-keys-and-sessions › How a client checks the server).
 */
export const ReleaseEntrySchema = z.object({
  body: z.string(),
  integratedTime: z.number().int(),
  logID: z.string(),
  logIndex: z.number().int().nonnegative(),
  signedEntryTimestamp: z.string(),
  inclusionProof: z.object({
    checkpoint: z.string(),
    hashes: z.array(z.string()),
    logIndex: z.number().int().nonnegative(),
    rootHash: z.string(),
    treeSize: z.number().int().positive()
  })
});
export type ReleaseEntry = z.infer<typeof ReleaseEntrySchema>;

/**
 * What the API says it is, for anyone to check before trusting it. Outside a TEE it says so plainly. Inside Google Cloud
 * Confidential Space (Intel TDX) it hands out the launcher's PKI attestation token: a JWT whose x5c chain ends at the
 * Confidential Space root, saying which signed image runs, on what, with debugging off. Its nonces carry the API's TLS
 * key (`spki:` and the base64url SHA-256 of its DER SubjectPublicKeyInfo) and the build (`commit:`). One token serves
 * every caller for a few minutes, since Google limits how many it issues (docs: privacy-keys-and-sessions). Beside it,
 * `release`: the image's entry in Sigstore's public log for that commit, or null when the API couldn't find one.
 */
export const AttestationSchema = z.discriminatedUnion('tee', [
  z.object({ tee: z.literal('none'), build: z.object({ commit: z.string() }) }),
  z.object({
    tee: z.literal('confidential-space'), build: z.object({ commit: z.string() }),
    tls: z.object({ spkiSha256: z.string() }),
    token: z.string(),
    release: ReleaseEntrySchema.nullable()
  })
]);

export type Attestation = z.infer<typeof AttestationSchema>;

/**
 * What a client made of an Attestation (`verifyServer` in @alcove/api-http), at `at`, in milliseconds. `verified` only when
 * the token checks out to Google's Confidential Space root, every claim holds, and Sigstore's public log has the image
 * signed with Alcove's release key for the commit the server reports: it names the image (`digest`). `unverified` says why
 * in a short sentence that may be shown, with the image once the token checked out. `none` is a server that says it isn't
 * in a TEE.
 */
export type Trust =
  | { state: 'verified'; commit: string; digest: string; at: number }
  | { state: 'unverified'; reason: string; commit: string; digest?: string | undefined; at: number }
  | { state: 'none'; commit: string; at: number; reason?: undefined; digest?: undefined };
