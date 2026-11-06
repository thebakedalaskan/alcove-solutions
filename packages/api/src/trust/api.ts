import { type Attestation } from './schema';
export interface TrustApi {
  /** What the API is running on, attested inside a TEE, for a nonce of 32 random bytes in hex. */
  attestation(nonce: string): Promise<Attestation>;
}
