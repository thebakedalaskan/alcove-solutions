/* What the stand-in's server runs on, as it answers for it (packages/api-http/src/trust/api.ts is the real client's). */
import type { AlcoveApi, Attestation } from '@alcove/api';
import { answer } from '../answer';
import { attested } from './attestation';

/**
 * As Alcove's server answers from Confidential Space: a token made now with Storybook's own anchors, which the app checks
 * in full with them (attestation.ts), so it says verified. Stories change it for a server outside a TEE, or a check that
 * fails (stories/pages/changes.ts).
 */
async function attest(): Promise<Attestation> {
  await answer(() => null, 'anyone');
  return attested();
}

export const trustApi: Pick<AlcoveApi, 'trust'> = {
  trust: { attestation: attest }
};
