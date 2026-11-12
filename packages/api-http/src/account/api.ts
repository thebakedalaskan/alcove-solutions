import { type HttpTransport } from '../transport/http';
import { type AlcoveApi, AttestationSchema, FeatureFlagsSchema, PersonSuggestionSchema, PlanOffersSchema, PlanSchema, PreferencesSchema, SessionSchema, SignInResultSchema, TeamSchema, TopUpRoutesSchema, TopUpSchema } from '@alcove/api';
import { z } from 'zod';

export function createAccountApi(t: HttpTransport): Pick<AlcoveApi, 'auth' | 'account' | 'people' | 'plans' | 'trust' | 'featureFlags'> {
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
    plans: {
      plan: () => req(PlanSchema, 'GET', '/plan'),
      offers: () => req(PlanOffersSchema, 'GET', '/plan/offers'),
      buyPro: (months, microUsdPerMonth) => req(PlanSchema, 'POST', '/plan/pro', { months, microUsdPerMonth }),
      buyHours: (packs, microUsdPerPack, minutesPerPack) => req(PlanSchema, 'POST', '/plan/hours', { packs, microUsdPerPack, minutesPerPack }),
      refundPro: () => req(PlanSchema, 'POST', '/plan/pro/refund', {}),
      setRenew: (renew) => req(PlanSchema, 'PUT', '/plan/renew', { renew }),
      dismissNotice: (id) => req(PlanSchema, 'POST', `/plan/notices/${encodeURIComponent(id)}/dismiss`, {}),
      routes: () => req(TopUpRoutesSchema, 'GET', '/plan/routes'),
      startTopUp: (routeId, microUsd, buys) => req(TopUpSchema, 'POST', '/plan/top-ups', { routeId, microUsd, buys: buys ?? null }),
      topUp: (id) => req(TopUpSchema, 'GET', `/plan/top-ups/${encodeURIComponent(id)}`),
      cancelTopUp: (id) => req(TopUpSchema, 'POST', `/plan/top-ups/${encodeURIComponent(id)}/cancel`),
      topUps: () => req(z.array(TopUpSchema), 'GET', '/plan/top-ups')
    },
    trust: {
      attestation: (nonce) => req(AttestationSchema, 'GET', `/attestation?nonce=${encodeURIComponent(nonce)}`)
    },
    featureFlags: {
      on: async () => (await req(FeatureFlagsSchema, 'GET', '/feature-flags')).on
    }
  };
}
