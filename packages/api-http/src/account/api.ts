import { type HttpTransport } from '../transport/http';
import { type AlcoveApi, AttestationSchema, FeatureFlagsSchema, MyTeamSchema, NoteSummarySchema, PersonSuggestionSchema, PlanOffersSchema, PlanSchema, PreferencesSchema, SessionSchema, SignInResultSchema, TeamInvitePeekSchema, TeamInviteSchema, TeamSchema, TopUpRoutesSchema, TopUpSchema } from '@alcove/api';
import { z } from 'zod';

export function createAccountApi(t: HttpTransport): Pick<AlcoveApi, 'auth' | 'account' | 'people' | 'plans' | 'teams' | 'trust' | 'featureFlags'> {
  const { base, req } = t;
  return {
    auth: {
      getSession: () => req(SessionSchema.nullable(), 'GET', '/session'),
      visit: async () => { await req(z.unknown(), 'POST', '/session/visit', {}); },
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
      chose: () => req(PlanSchema, 'POST', '/plan/chosen', {}),
      buyPro: (months, microUsdPerMonth) => req(PlanSchema, 'POST', '/plan/pro', { months, microUsdPerMonth }),
      refundPro: () => req(PlanSchema, 'POST', '/plan/pro/refund', {}),
      setRenew: (renew) => req(PlanSchema, 'PUT', '/plan/renew', { renew }),
      dismissNotice: (id) => req(PlanSchema, 'POST', `/plan/notices/${encodeURIComponent(id)}/dismiss`, {}),
      routes: () => req(TopUpRoutesSchema, 'GET', '/plan/routes'),
      startTopUp: (routeId, microUsd) => req(TopUpSchema, 'POST', '/plan/top-ups', { routeId, microUsd }),
      topUp: (id) => req(TopUpSchema, 'GET', `/plan/top-ups/${encodeURIComponent(id)}`),
      cancelTopUp: (id) => req(TopUpSchema, 'POST', `/plan/top-ups/${encodeURIComponent(id)}/cancel`),
      topUps: () => req(z.array(TopUpSchema), 'GET', '/plan/top-ups')
    },
    // A team's own routes are under /team/ with names of their own: GET /team and POST /team/invites are the people directory's.
    teams: {
      mine: () => req(MyTeamSchema.nullable(), 'GET', '/team/mine'),
      create: (name) => req(MyTeamSchema, 'POST', '/team/new', { name }),
      invite: () => req(TeamInviteSchema, 'POST', '/team/invite', {}),
      // An invite's secret goes in the body, never in a URL, so no log can keep it.
      peek: (secret) => req(TeamInvitePeekSchema, 'POST', '/team/peek', { secret }),
      join: (secret) => req(MyTeamSchema, 'POST', '/team/join', { secret }),
      remove: (memberId) => req(MyTeamSchema, 'DELETE', `/team/members/${encodeURIComponent(memberId)}`),
      leave: async () => { await req(z.unknown(), 'POST', '/team/leave', {}); },
      delete: async () => { await req(z.unknown(), 'DELETE', '/team/mine'); },
      buyLicenses: (count, microUsdPerLicense) => req(MyTeamSchema, 'POST', '/team/licenses', { count, microUsdPerLicense }),
      refundLicenses: () => req(MyTeamSchema, 'POST', '/team/licenses/refund', {}),
      setAutoPurchase: (on) => req(MyTeamSchema, 'PUT', '/team/auto-purchase', { on }),
      notes: () => req(z.array(NoteSummarySchema), 'GET', '/team/notes')
    },
    trust: {
      attestation: (nonce) => req(AttestationSchema, 'GET', `/attestation?nonce=${encodeURIComponent(nonce)}`)
    },
    featureFlags: {
      on: async () => (await req(FeatureFlagsSchema, 'GET', '/feature-flags')).on
    }
  };
}
