/*
 * Your account, as the stand-in answers for it (packages/api-http/src/account/api.ts is the real client's): signing in and
 * out, preferences, deleting it, people to find and invite, your invite link and other people's, your plan and paying for
 * it, a team, and the feature flags on for you.
 */
import { AlcoveApiError, StartTopUpBodySchema, type AlcoveApi, type DemoProvider, type ID, type Patch, type Plan, type Preferences, type Purchase, type SignInResult, type TopUp } from '@alcove/api';
import { artsLink } from '../../world/invite-links';
import { personAt } from '../../world/people';
import { boughtFromBalance, freshEntryId, PREVIEW_BASE_ADDRESS, PREVIEW_DEPOSIT_ADDRESS } from '../../world/plans/payments';
import { withProMonths, withRenewal } from '../../world/plans/plans';
import { session as sessionFor, type World } from '../../world/world';
import { forgetAgents } from '../agents/agents';
import { answer, refused } from '../answer';
import { me, nextId } from '../state';
import { playPayment, refusalOf, settlePayments, shortOf } from './payments';
import { teamsApi, visit } from './teams';

const noPayments = () => new AlcoveApiError('unavailable', 'Top-ups aren’t available right now.', { requestId: nextId('sb-req') });
const NOWHERE = 'This invite link doesn’t lead anywhere. Ask whoever sent it to copy it again from their Team page.';
/** Every invite link the world has, Art's own among them, as the server finds one by its secret. */
const inviteLinks = (w: World) => [...(w.inviteLink ? [w.inviteLink] : []), ...(w.invites ?? [])];
const paymentRoutes = (w: World) => { if (!w.payments.routes) throw noPayments(); return w.payments.routes; };
const paymentIn = (w: World, id: string): TopUp => {
  paymentRoutes(w);
  const t = w.payments.topUps.find((x) => x.id === id);
  if (!t) throw refused('not-found', 'That top-up isn’t there any more.');
  return t;
};
/** Refuses a purchase as the server does before anything is bought or a payment opened for it (account/payments.ts has the terms). */
function checkPurchase(w: World, buys: Purchase): void {
  const r = refusalOf(w, buys);
  if (r) throw refused(r.code, r.asked);
}
/** The plan as the server answers with it: saying whether renewing will buy the next month, at the prices in force now. */
const planOf = (w: World): Plan => withRenewal(w.plan, w.payments.offers.pro.microUsdPerMonth, w.payments.proMonthly);
/** Buys from the balance once the purchase checks out, refused with nothing charged when the balance is short. */
function buyNow(w: World, buys: Purchase) {
  checkPurchase(w, buys);
  const short = shortOf(w, buys);
  if (short) throw refused('conflict', short);
  boughtFromBalance(w, buys, freshEntryId(w));
  return planOf(w);
}

export const accountApi: Pick<AlcoveApi, 'auth' | 'account' | 'people' | 'plans' | 'teams' | 'featureFlags'> = {
  auth: {
    getSession: () => answer((w) => w.session, 'anyone'),
    // No provider in Storybook: the button previews waiting/cancellation; return pages have their own stories.
    signInUrl: (_provider, opts) => opts?.popup ? 'about:blank' : '#signing-in-with-google',
    signIn: (provider: DemoProvider, opts) => answer((w): SignInResult => {
      const email = provider === 'sso' ? opts?.email?.trim().toLowerCase() : undefined;
      const s = sessionFor(email ? { user: personAt(email), ownerId: `o-${email}`, provider: 'sso', sample: true } : { provider: 'microsoft', sample: true });
      w.session = s;
      return { session: s, isNew: w.notes.length === 0 };
    }, 'anyone'),
    signOut: () => answer((w) => { w.session = null; }),
    visit: () => answer(visit)
  },
  account: {
    preferences: () => answer((w) => w.prefs),
    updatePreferences: (patch: Patch<Preferences>) => answer((w) => {
      const p = w.prefs;
      w.prefs = {
        notesDefault: patch.notesDefault ?? p.notesDefault, notesLanguage: patch.notesLanguage ?? p.notesLanguage,
        addToCalendar: patch.addToCalendar ?? p.addToCalendar, showOtherMeetings: patch.showOtherMeetings ?? p.showOtherMeetings,
        showSoloEvents: patch.showSoloEvents ?? p.showSoloEvents, recordOffline: patch.recordOffline ?? p.recordOffline,
        sounds: patch.sounds ?? p.sounds, notifications: patch.notifications ?? p.notifications, pinned: patch.pinned ?? p.pinned, groups: patch.groups ?? p.groups, model: patch.model === undefined ? p.model : patch.model,
        notificationsPausedUntil: patch.notificationsPausedUntil === undefined ? p.notificationsPausedUntil : patch.notificationsPausedUntil
      };
      return w.prefs;
    }),
    delete: () => answer((w) => { forgetAgents(w); w.session = null; w.notes = []; w.meetings = []; })
  },
  people: {
    search: (query: string) => answer((w) => {
      const q = query.trim().toLowerCase();
      const pool = [...(w.team?.members ?? []).map((m) => ({ person: m.person, source: 'team' as const, onAlcove: m.onAlcove })),
        ...w.notes.flatMap((n) => n.people).filter((p, i, all) => p.email !== me().email && all.findIndex((o) => o.email === p.email) === i && !w.team?.members.some((m) => m.person.email === p.email))
          .map((person) => ({ person, source: 'met' as const, onAlcove: false }))];
      const hits = pool.filter((s) => !q || s.person.name.toLowerCase().includes(q) || s.person.email.includes(q)).slice(0, 8);
      const typed = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q) && !hits.some((h) => h.person.email === q) ? [{ person: personAt(q), source: 'new' as const, onAlcove: false }] : [];
      return [...typed, ...hits].slice(0, 8);
    }),
    team: () => answer((w) => w.team),
    inviteToTeam: (emails: string[]) => answer((w) => {
      if (!w.team) throw refused('invalid', 'You don’t have a team.');
      const asked = emails.map((e) => e.trim().toLowerCase());
      w.team = { ...w.team, members: w.team.members.map((m) => (asked.includes(m.person.email) ? { ...m, invited: true } : m)) };
      return w.team;
    }),
    /* Only someone at a company has one, as on the server; it's the same on every ask. */
    inviteLink: () => answer((w) => {
      if (!w.team) throw refused('forbidden', 'Only someone at a company has an invite link. Yours is a personal address.');
      w.inviteLink ??= artsLink();
      return { link: new URL(`/invite#${w.inviteLink.secret}`, location.origin).href, joined: w.inviteLink.joined };
    }),
    peekInvite: (secret: string) => answer((w) => {
      const found = inviteLinks(w).find((l) => l.secret === secret);
      if (!found) throw refused('not-found', NOWHERE);
      return { from: found.from };
    }, 'anyone'),
    /* An account made from someone's link counts once, never on your own: whoever sent it sees it on their Team page, not here. */
    joinedByInvite: (secret: string) => answer((w) => {
      const found = inviteLinks(w).find((l) => l.secret === secret);
      if (!found) throw refused('not-found', NOWHERE);
      const you = me();
      if (found === w.inviteLink || found.joined.some((j) => j.person.email === you.email)) return;
      found.joined = [{ person: { ...you, id: you.email }, at: new Date().toISOString() }, ...found.joined];
    })
  },
  plans: {
    // The payments playing out catch up with the clock whenever the plan or a payment is read (account/payments.ts).
    plan: () => answer((w) => { settlePayments(w); return planOf(w); }),
    offers: () => answer((w) => w.payments.offers),
    buyPro: (months, microUsdPerMonth) => answer((w) => buyNow(w, { kind: 'pro', months, microUsdPerMonth })),
    refundPro: () => answer((w) => {
      const now = Date.now();
      const later = w.plan.pro.months.filter((m) => Date.parse(m.from) > now);
      if (!later.length) throw refused('conflict', 'There’s no month of Pro to refund that hasn’t started. A month that has started isn’t refunded.');
      const back = later.reduce((sum, m) => sum + m.microUsd, 0);
      const { balance } = w.plan;
      const entry = { id: freshEntryId(w), at: new Date(now).toISOString(), label: `Pro refunded, ${later.length} ${later.length === 1 ? 'month' : 'months'}`, microUsd: back };
      // As the server does: renewing goes off, so what was refunded isn't bought back, and a notice that Pro was renewed
      // into a month refunded goes.
      const ends = new Set(later.map((m) => m.to));
      const refunded = {
        ...w.plan, balance: { microUsd: balance.microUsd + back, history: [entry, ...balance.history] }, pro: { ...w.plan.pro, renew: false },
        notices: w.plan.notices.filter((n) => !(n.kind === 'pro-renewed' && n.until !== null && ends.has(n.until)))
      };
      w.plan = withProMonths(refunded, w.plan.pro.months.filter((m) => Date.parse(m.from) <= now), now);
      return planOf(w);
    }),
    setRenew: (renew) => answer((w) => { w.plan = { ...w.plan, pro: { ...w.plan.pro, renew } }; return planOf(w); }),
    chose: () => answer((w) => { w.plan = { ...w.plan, choose: false }; return planOf(w); }),
    dismissNotice: (id) => answer((w) => {
      if (!w.plan.notices.some((n) => n.id === id)) throw refused('not-found', 'That notice doesn’t exist, or you don’t have access to it.');
      w.plan = { ...w.plan, notices: w.plan.notices.filter((n) => n.id !== id) };
      return planOf(w);
    }),
    routes: () => answer(paymentRoutes),
    buyHours: (packs, microUsdPerPack, minutesPerPack) => answer((w) => buyNow(w, { kind: 'hours', packs, microUsdPerPack, minutesPerPack })),
    startTopUp: (routeId, microUsd, buys) => answer((w) => {
      const choices = paymentRoutes(w);
      StartTopUpBodySchema.parse({ routeId, microUsd, buys: buys ?? null });
      const route = choices.routes.find((r) => r.id === routeId);
      if (!route) throw refused('invalid', 'That way to pay isn’t offered.');
      if (microUsd < Number(route.minimum) * 1_000_000) throw refused('invalid', `The least you can add with ${route.token} on ${route.chainName} is $${route.minimum}.`);
      // What it's for is checked first, as a purchase from the balance is, but for the balance: a refusal opens nothing.
      if (buys) checkPurchase(w, buys);
      // A token is added as a dollar. A payment to buy something is open for a day, as the server's are.
      const amount = String(microUsd / 1_000_000);
      const t: TopUp = {
        id: nextId('sb-top-up'), route, address: buys ? PREVIEW_BASE_ADDRESS : PREVIEW_DEPOSIT_ADDRESS, memo: null,
        expiresAt: new Date(Date.now() + (buys ? 86_400_000 : 3_600_000)).toISOString(), state: 'waiting',
        asked: { amount }, received: null,
        purchase: buys ? { buys, outcome: 'waiting', why: null } : null
      };
      w.payments.topUps.unshift(t);
      playPayment(w, t);
      return t;
    }),
    topUp: (id) => answer((w) => { settlePayments(w); return paymentIn(w, id); }),
    cancelTopUp: (id) => answer((w) => {
      settlePayments(w);
      const t = paymentIn(w, id);
      if (t.state !== 'waiting') throw refused('conflict', 'This top-up can’t be cancelled any more: a payment has already reached it.');
      const cancelled: TopUp = { ...t, state: 'cancelled', address: null, memo: null };
      w.payments.topUps = w.payments.topUps.map((x) => x.id === id ? cancelled : x);
      return cancelled;
    }),
    topUps: () => answer((w) => { paymentRoutes(w); settlePayments(w); return w.payments.topUps; })
  },
  teams: {
    mine: () => answer(teamsApi.mine),
    create: (name: string) => answer((w) => teamsApi.create(w, name)),
    invite: () => answer(teamsApi.invite),
    peek: (secret: string) => answer((w) => teamsApi.peek(w, secret)),
    join: (secret: string) => answer((w) => teamsApi.join(w, secret)),
    remove: (memberId: ID) => answer((w) => teamsApi.remove(w, memberId)),
    leave: () => answer(teamsApi.leave),
    delete: () => answer(teamsApi.delete),
    buyLicenses: (count: number, microUsdPerLicense: number, periods?: number) => answer((w) => teamsApi.buyLicenses(w, count, microUsdPerLicense, periods ?? 1)),
    refundLicenses: () => answer(teamsApi.refundLicenses),
    setAutoPurchase: (on: boolean) => answer((w) => teamsApi.setAutoPurchase(w, on)),
    notes: () => answer(teamsApi.notes)
  },
  /* Signed out too, as the API answers: a guest's call reads them as it opens. */
  featureFlags: { on: () => answer((w) => w.featureFlags ?? [], 'anyone') }
};
