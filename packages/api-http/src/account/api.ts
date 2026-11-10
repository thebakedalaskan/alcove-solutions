import { type HttpTransport } from '../transport/http';
import { type AlcoveApi, AttestationSchema, CreditBalanceSchema, FeatureFlagsSchema, PersonSuggestionSchema, PreferencesSchema, SessionSchema, SignInResultSchema, TeamSchema, TopUpRoutesSchema, TopUpSchema } from '@alcove/api';
import { z } from 'zod';

export function createAccountApi(t: HttpTransport): Pick<AlcoveApi, 'auth' | 'account' | 'people' | 'credits' | 'trust' | 'featureFlags'> {
  const { base, req } = t;
  return {
    auth: {
      getSession: () => req(SessionSchema.nullable(), 'GET', '/session'),
      signInUrl: (provider, opts) => {
        const search = new URLSearchParams();
        if (opts?.next) search.set('next', opts.next);
        if (opts?.popup) search.set('popup', opts.popup);
        return `${base}/auth/${provider}${search.size ? `?${search}` : ''}`;
      },
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
      balance: () => req(CreditBalanceSchema, 'GET', '/credits'),
      routes: () => req(TopUpRoutesSchema, 'GET', '/credits/routes'),
      startTopUp: (routeId, credits) => req(TopUpSchema, 'POST', '/credits/top-ups', { routeId, credits }),
      topUp: (id) => req(TopUpSchema, 'GET', `/credits/top-ups/${encodeURIComponent(id)}`),
      cancelTopUp: (id) => req(TopUpSchema, 'POST', `/credits/top-ups/${encodeURIComponent(id)}/cancel`),
      topUps: () => req(z.array(TopUpSchema), 'GET', '/credits/top-ups')
    },
    trust: {
      attestation: (nonce) => req(AttestationSchema, 'GET', `/attestation?nonce=${encodeURIComponent(nonce)}`)
    },
    featureFlags: {
      on: async () => (await req(FeatureFlagsSchema, 'GET', '/feature-flags')).on
    }
  };
}
