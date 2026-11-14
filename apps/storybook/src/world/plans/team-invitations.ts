/*
 * Invitations to teams in the demo world (docs/superpowers/specs/2026-11-14-team-invitations-design.md, 3.3, 3.4 and 4): who's
 * invited to the team Art is on, the teams Art isn't on (`otherTeams`) with their invitations to Art among their own, and where
 * someone's invite link leads. This is the world as it stands, and the helpers stories put invitations in it with; what asking
 * Alcove does to it is src/api/account/team-invitations.ts. Everyone and every team here is made up.
 */
import type { InvitationForYou, InvitePeek, Person, Team, TeamGlimpse } from '@alcove/api';
import type { InviteLinkWorld, World } from '../world';
import { iso, on } from '../clock';
import { asOthersSee, jonasLink, priyasLink, PRIYA_INVITATION_SECRET, secretOf } from '../invite-links';
import { AIKO, ANA, ART, BRUNO, COMPANY, DIEGO, JONAS, KOFI, LENA, LOTTE, MALIK, MAYA, portraitFrom, PRIYA, SAM, THEO } from '../people';
import { freeTeamOf, INVITATION_MS, liveInvitations, meOn, sentTo, teamMember, type InvitationWorld, type TeamWorld } from './teams';

const DAY_MS = 86_400_000;
/** How many of a team's people a glimpse shows. */
const FACES = 4;

/** A number from some words, the same every time: what makes an invitation's made-up ID and secret its own. */
const hashOf = (words: string): number => [...words].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_000, 7);
/** The part of someone's address before the @: what their ID on another team is made from. */
const handleOf = (p: Person): string => p.email.replace(/@.*$/, '');
/** `sends` sends of an invitation, the last `at` and each before it a day earlier, newest first (none: made and not sent). */
const sendsUpTo = (at: string, sends = 1): string[] => Array.from({ length: Math.max(0, sends) }, (_, k) => new Date(Date.parse(at) - k * DAY_MS).toISOString());

/**
 * `person` invited to `t` by `by` (the member's ID on it), made or last sent again `at`, and sent `sends` times in all, the
 * team's sends (once, unless said; the first among them, a day apart before `at`; none for one made and not sent), in place
 * of any invitation the address had there: one per address per team. They were first invited at the first of those sends
 * (or `at`), unless `madeAt` says. Its ID is made up from the team and the address, and its link's secret from its ID, unless
 * they're given.
 */
export function inviteOn(t: TeamWorld, o: {
  person: Person; by: string; at: string; sends?: number | undefined; madeAt?: string | undefined; id?: string | undefined; secret?: string | undefined; putAside?: boolean | undefined;
}): InvitationWorld {
  const id = o.id ?? `inv-${hashOf(`${t.id} ${o.person.email}`)}`;
  const sent = sendsUpTo(o.at, o.sends);
  const made: InvitationWorld = {
    id, person: o.person, by: o.by, madeAt: o.madeAt ?? sent[sent.length - 1] ?? o.at, at: o.at,
    expiresAt: new Date(Date.parse(o.at) + INVITATION_MS).toISOString(), secret: o.secret ?? secretOf(o.person.email, 'Invitation', hashOf(`${t.id} ${id}`)), putAside: o.putAside ?? false
  };
  t.invitations = [made, ...t.invitations.filter((i) => i.person.email !== o.person.email)];
  for (const s of sent) sentTo(t, o.person.email, s);
  return made;
}
/**
 * An invitation on `t` sent again at `now`, asked again by `by` (whoever invites them again; Resend keeps whoever asked): its
 * 30 days start again, it's the team's send of it, and its link and when they were first invited stay as they were.
 */
export function sendAgain(t: TeamWorld, i: InvitationWorld, now: number, by = i.by): InvitationWorld {
  const at = new Date(now).toISOString();
  const again: InvitationWorld = { ...i, by, at, expiresAt: new Date(now + INVITATION_MS).toISOString() };
  t.invitations = t.invitations.map((x) => (x === i ? again : x));
  sentTo(t, i.person.email, at);
  return again;
}

/**
 * A team as someone not on it sees it on an invitation or a link (team-records.ts › glimpseOf): its name, how many are on it,
 * and up to 4 of them, `sender` first (the member ID of whoever sent the invitation, or whose link it is), then in the order
 * they joined, its admin first of those who joined together, and otherwise as the world lists them. Each is named and never
 * addressed: their `email` is empty, their ID the member's, and their portrait drawn from that ID, which names nobody; but for
 * the sender, whose address the card shows anyway, who looks as they do everywhere.
 */
export function glimpseOf(t: TeamWorld, sender: string | undefined): TeamGlimpse {
  const joined = [...t.members].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || Number(b.role === 'admin') - Number(a.role === 'admin'));
  const ordered = [...joined.filter((m) => m.id === sender), ...joined.filter((m) => m.id !== sender)];
  const faces = ordered.slice(0, FACES).map((m): Person => (m.id === sender
    ? { id: m.id, name: m.person.name, email: '', ...(m.person.portrait ? { portrait: m.person.portrait } : {}) }
    : { id: m.id, name: m.person.name, email: '', portrait: portraitFrom(m.id) }));
  return { name: t.name, people: t.members.length, faces };
}

/** Every team in the world: Art's, then the others. */
export const teamsIn = (w: World): TeamWorld[] => [...(w.myTeam ? [w.myTeam] : []), ...(w.otherTeams ?? [])];
/** The team someone is on, if any: one at most. */
export const teamWith = (w: World, email: string): TeamWorld | undefined => teamsIn(w).find((t) => meOn(t, email));
/** Every invite link in the world, Art's own first. */
export const linksIn = (w: World): InviteLinkWorld[] => [...(w.inviteLink ? [w.inviteLink] : []), ...(w.invites ?? [])];

/**
 * Where someone's invite link leads (design 3.4): the team they run; nowhere while they're on someone else's; or, while
 * they're on none, a team made for them as someone joins from it (`new`).
 */
export type LinkLeads = { to: 'team'; team: TeamWorld } | { to: 'new' } | { to: 'nowhere' };
export function whereLinkLeads(w: World, owner: Person): LinkLeads {
  const t = teamWith(w, owner.email);
  if (!t) return { to: 'new' };
  return meOn(t, owner.email)?.role === 'admin' ? { to: 'team', team: t } : { to: 'nowhere' };
}
/** An invitation by its own link's secret, with its team, while it stands. */
export function invitationBySecret(w: World, secret: string, now = Date.now()): { team: TeamWorld; invitation: InvitationWorld } | undefined {
  for (const team of teamsIn(w)) {
    const invitation = liveInvitations(team, now).find((i) => i.secret === secret);
    if (invitation) return { team, invitation };
  }
  return undefined;
}
/** Whoever asked, on the invitation's team. */
const askedBy = (t: TeamWorld, i: InvitationWorld): Person | undefined => t.members.find((m) => m.id === i.by)?.person;

/**
 * What a secret after `/invite#` says (`people.peekInvite`), looked up as an invite link and then as an invitation's own, or
 * null when it leads nowhere. `viewer`: the address signed in, if anyone is. A link is theirs (`yours`) when it's their own,
 * or their team's; an invitation, when it's to the team they're on. An invitation's own ID is said only to whoever it's to.
 */
export function peekOf(w: World, secret: string, viewer: string | null, now = Date.now()): InvitePeek | null {
  const link = linksIn(w).find((l) => l.secret === secret);
  if (link) {
    const leads = whereLinkLeads(w, link.from);
    if (leads.to === 'nowhere') return null;
    const team = leads.to === 'team' ? leads.team : null;
    const yours = viewer !== null && (viewer === link.from.email || (team !== null && meOn(team, viewer) !== undefined));
    return { kind: 'link', from: asOthersSee(link.from), yours, team: team ? glimpseOf(team, meOn(team, link.from.email)?.id) : null, invitationId: null };
  }
  const found = invitationBySecret(w, secret, now);
  const from = found ? askedBy(found.team, found.invitation) : undefined;
  if (!found || !from) return null;
  return {
    kind: 'invitation', from: asOthersSee(from), yours: viewer !== null && meOn(found.team, viewer) !== undefined, team: glimpseOf(found.team, found.invitation.by),
    invitationId: viewer !== null && found.invitation.person.email === viewer ? found.invitation.id : null
  };
}

/** The invitations to an address, as `teams.invitations()` gives them: from the teams it isn't on, not run out, newest first. */
export function invitationsFor(w: World, email: string, now = Date.now()): InvitationForYou[] {
  return (w.otherTeams ?? []).flatMap((t) => liveInvitations(t, now).filter((i) => i.person.email === email).flatMap((i): InvitationForYou[] => {
    const from = askedBy(t, i);
    return from ? [{ id: i.id, from: asOthersSee(from), team: glimpseOf(t, i.by), at: i.at, expiresAt: i.expiresAt, putAside: i.putAside }] : [];
  })).sort((a, b) => b.at.localeCompare(a.at));
}
/**
 * An invitation to an address, by its ID, with its team, on any team (the one they're on too, which joining by it refuses):
 * anyone else's is the same as one that never was.
 */
export function invitationTo(w: World, email: string, id: string, now = Date.now()): { team: TeamWorld; invitation: InvitationWorld } | undefined {
  for (const team of teamsIn(w)) {
    const invitation = liveInvitations(team, now).find((i) => i.id === id && i.person.email === email);
    if (invitation) return { team, invitation };
  }
  return undefined;
}

/** The company as `people.team()` gives it: each colleague `invited` while the team Art is on has a live invitation for them. */
export function directoryOf(w: World, now = Date.now()): Team | null {
  if (!w.team) return null;
  const asked = new Set(w.myTeam ? liveInvitations(w.myTeam, now).map((i) => i.person.email) : []);
  return { ...w.team, members: w.team.members.map((m) => ({ ...m, invited: asked.has(m.person.email) })) };
}

/* ---------- the teams Art isn't on ---------- */

/** Weber Design's team, free: Jonas its admin for two months, Lotte, and Malik since three weeks ago. */
export const weberDesign = (): TeamWorld => freeTeamOf('team-weber', 'Weber Design', [
  teamMember('weber-jonas', JONAS, 'admin', null, 60), teamMember('weber-lotte', LOTTE, 'member', null, 55), teamMember('weber-malik', MALIK, 'member', null, 21)
]);
/** Souza Law's team, free: Ana its admin, and Bruno. */
export const souzaLaw = (): TeamWorld => freeTeamOf('team-souza', 'Souza Law', [teamMember('souza-ana', ANA, 'admin', null, 90), teamMember('souza-bruno', BRUNO, 'member', null, 80)]);
/**
 * Priya's own Vandelay Industries team, free, for a world she's on no team in: Priya its admin, with Kofi, Aiko and Maya (those
 * of them on no team there already).
 */
export function priyasOwnTeam(w: World): TeamWorld {
  const others = [KOFI, AIKO, MAYA].filter((p) => !teamWith(w, p.email)).map((p) => teamMember(`priya-${handleOf(p)}`, p, 'member', null, 30));
  return freeTeamOf('team-priya', COMPANY.name, [teamMember('priya-priya', PRIYA, 'admin', null, 40), ...others]);
}
/** The team Priya is on, wherever she is; with her on none, her own (`priyasOwnTeam`), put with the other teams. */
export function priyasTeamIn(w: World): TeamWorld {
  const t = teamWith(w, PRIYA.email);
  if (t) return t;
  const made = priyasOwnTeam(w);
  w.otherTeams = [...(w.otherTeams ?? []), made];
  return made;
}
/**
 * Priya's and Jonas's invite links in the world, and Priya's team wherever she's on none, so her link leads to its people.
 * Jonas's leads to Weber Design where the world has it, and asks you to join him while he's on no team.
 */
export function withLinks(w: World): void {
  const have = new Set(linksIn(w).map((l) => l.secret));
  w.invites = [...(w.invites ?? []), ...[priyasLink(), jonasLink()].filter((l) => !have.has(l.secret))];
  priyasTeamIn(w);
}

/* ---------- invitations a story puts in the world ---------- */

/**
 * An invitation to Art from `from`, on `team` (put with the other teams if the world hasn't one by its ID, and `from` on it if
 * they aren't), made or last emailed `at` (now, unless said), put aside or not. It's to `to`, Art at whichever address Art is
 * signed in at unless said, and its own link's secret is made up unless it's given.
 */
export function invitationToArt(w: World, o: { from: Person; team: TeamWorld; at?: string | undefined; putAside?: boolean | undefined; secret?: string | undefined; to?: Person | undefined }): InvitationWorld {
  const known = teamsIn(w).find((t) => t.id === o.team.id);
  const team = known ?? o.team;
  if (!known) w.otherTeams = [...(w.otherTeams ?? []), team];
  let by = meOn(team, o.from.email);
  if (!by) {
    by = teamMember(`${team.id}-${handleOf(o.from)}`, o.from, 'member', null, 7);
    team.members = [...team.members, by];
  }
  return inviteOn(team, { person: asOthersSee(o.to ?? w.session?.user ?? ART), by: by.id, at: o.at ?? new Date().toISOString(), putAside: o.putAside, secret: o.secret, id: `inv-${team.id}-art` });
}
/**
 * An invitation on the team Art is on: `person` asked by `by` (someone on it), made or last sent again `at`, and sent `sends`
 * times in all, a day apart (once, unless said). What Art sent counts toward the 20 a day.
 */
export function invitationOnTeam(w: World, o: { person: Person; by: Person; at: string; sends?: number | undefined }): InvitationWorld {
  const t = w.myTeam;
  const by = t ? meOn(t, o.by.email) : undefined;
  if (!t || !by) throw new Error(`An invitation on Art’s team needs Art on a team, and ${o.by.name} on it.`);
  const made = inviteOn(t, { person: o.person, by: by.id, at: o.at, sends: o.sends });
  if (by.person.email === (w.session?.user ?? ART).email) w.invitedByYou = [...sendsUpTo(o.at, o.sends), ...(w.invitedByYou ?? [])].sort((a, b) => b.localeCompare(a));
  return made;
}
/**
 * Art has sent `n` invitations today already, invitations made or sent again, from 09:00 this morning a minute apart, in place
 * of whatever Art sent since yesterday morning: what's left of the 20 a day (`INVITES_A_DAY`) is what inviting takes next, the
 * first addresses in the order sent, and the rest aren't invited (`over`). At 20, inviting anyone is refused, and so is Resend.
 */
export function invitedToday(w: World, n: number): void {
  const morning = on(0, 9, 0).getTime();
  const today = Array.from({ length: Math.max(0, n) }, (_, k) => new Date(morning + k * 60_000).toISOString()).reverse();
  w.invitedByYou = [...today, ...(w.invitedByYou ?? []).filter((at) => Date.parse(at) <= morning - DAY_MS)];
}

/**
 * Who's invited to Vandelay's team: Sam, by Art two days ago, and Lena, by Priya 26 days ago, so it runs out in 4 days. Hers
 * was at 18:00, so its 30 days end after 16:12 four days on even where the clocks went back between (1 November in the US).
 */
export function invitedToVandelay(w: World): void {
  invitationOnTeam(w, { person: SAM, by: ART, at: iso(-2, 14, 0) });
  invitationOnTeam(w, { person: LENA, by: PRIYA, at: iso(-26, 18, 0) });
}
/**
 * The same, and Diego, invited by Art yesterday and sent again today: Resend waits until tomorrow ("Sent today"); and Theo,
 * invited by Art five days ago and sent again the two days after: sent as many times as 30 days take, so Resend waits until
 * 30 days after the first ("Sent 3 times").
 */
export function invitedToFreeTeam(w: World): void {
  invitedToVandelay(w);
  invitationOnTeam(w, { person: DIEGO, by: ART, at: iso(0, 10, 20), sends: 2 });
  invitationOnTeam(w, { person: THEO, by: ART, at: iso(-3, 11, 0), sends: 3 });
}
/**
 * Priya's invitation to art@vandelay.industries, to the team she's on (her own Vandelay Industries team, with its people, when
 * she's on none), made today at 10:05 unless said: its email's link is `PRIYA_INVITATION_SECRET`.
 */
export function priyaInvitesArt(w: World, at = iso(0, 10, 5)): InvitationWorld {
  return invitationToArt(w, { from: PRIYA, team: priyasTeamIn(w), at, secret: PRIYA_INVITATION_SECRET, to: ART });
}
/** Jonas's invitation to Art, to Weber Design (put with the other teams if it isn't there), made `at`, and put aside or not. */
export const jonasInvitesArt = (w: World, at: string, putAside = false): InvitationWorld =>
  invitationToArt(w, { from: JONAS, team: teamWith(w, JONAS.email) ?? weberDesign(), at, putAside });
/** Ana's invitation to Art, to Souza Law, made `at`, and put aside or not. */
export const anaInvitesArt = (w: World, at: string, putAside = false): InvitationWorld =>
  invitationToArt(w, { from: ANA, team: teamWith(w, ANA.email) ?? souzaLaw(), at, putAside });
