import { type HttpTransport } from '../transport/http';
import { type AlcoveApi, AttestationSchema, CreditBalanceSchema, PersonSuggestionSchema, PreferencesSchema, SessionSchema, SignInResultSchema, TeamSchema } from '@alcove/api';
import { z } from 'zod';

export function createAccountApi(t: HttpTransport): Pick<AlcoveApi, 'auth' | 'account' | 'people' | 'credits' | 'trust'> {
  const { base, req } = t;
  return {
    auth: {
      getSession: () => req(SessionSchema.nullable(), 'GET', '/session'),
      signInUrl: (provider, opts) => `${base}/auth/${provider}${opts?.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`,
      signIn: (provider, opts) => req(SignInResultSchema, 'POST', '/auth/sign-in', { provider, ...(opts?.email ? { email: opts.email } : {}) }),
      signOut: async () => { await req(z.unknown(), 'POST', '/session/sign-out', {}); }
    },
    account: {
      preferences: () => req(PreferencesSchema, 'GET', '/account/preferences'),
      updatePreferences: (p) => req(PreferencesSchema, 'PATCH', '/account/preferences', p),
      delete: async () => { await req(z.unknown(), 'DELETE', '/account'); }
    },
    people: {
      // The query goes in the body so it never appears in URLs or access logs.
      search: (query) => req(z.array(PersonSuggestionSchema), 'POST', '/people/search', { query }),
      team: () => req(TeamSchema.nullable(), 'GET', '/team'),
      inviteToTeam: (emails) => req(TeamSchema, 'POST', '/team/invites', { emails })
    },
    credits: {
      balance: () => req(CreditBalanceSchema, 'GET', '/credits')
    },
    trust: {
      attestation: (nonce) => req(AttestationSchema, 'GET', `/attestation?nonce=${encodeURIComponent(nonce)}`)
    }
  };
}
