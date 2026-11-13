import { type HttpTransport } from '../transport/http';
import { type AlcoveApi, AttestationSchema } from '@alcove/api';

export function createTrustApi(t: HttpTransport): Pick<AlcoveApi, 'trust'> {
  return {
    trust: {
      attestation: () => t.req(AttestationSchema, 'GET', '/attestation')
    }
  };
}
