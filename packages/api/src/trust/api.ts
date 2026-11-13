import { type Attestation } from './schema';
export interface TrustApi {
  /** What the API is running on, and inside a TEE the token that attests to it. */
  attestation(): Promise<Attestation>;
}
