/*
 * Invitations to a team and invite links, in the stand-in (docs/superpowers/specs/2026-11-14-team-invitations-design.md, 4 and
 * 6): inviting by email, which makes your team first if you're on none, up to what's left of the day's; Resend and Cancel; the
 * invitations to you; joining a team by one, or by its link's secret, leaving or deleting the team you're on as you go when you
 * say so; and what a link says before it's opened. What it does to the world is the server's, with its refusals in its own
 * words; the world's side is src/world/plans/team-invitations.ts, and a team's own is teams.ts.
 */
import { InviteByEmailBodySchema, InviteSecretSchema, type InvitationForYou, type InvitationsMade, type InviteLink, type InvitePeek, type MyTeam, type Person } from '@alcove/api';
import type { InviteLinkWorld, World } from '../../world/world';
import { artsLink, asOthersSee, linkOf, madeAgain } from '../../world/invite-links';
import { companyOf, personAt } from '../../world/people';
import { invitationBySecret, invitationsFor, invitationTo, inviteOn, linksIn, peekOf, sendAgain, whereLinkLeads } from '../../world/plans/team-invitations';
import {
  adminOf, freeTeamOf, INVITES_A_DAY, liveInvitations, meOn, memberFrom, MOST_SENT, resendAtOf, resendWhyOf, sendsNew, type InvitationWorld, type TeamMemberWorld, type TeamWorld
} from '../../world/plans/teams';
import { refused } from '../answer';
import { me, nextId } from '../state';
import { deleteTeam, leaveTeam, settled, visit, yours } from './teams';

const DAY_MS = 86_400_000;
/** What anything after `/invite#` that leads nowhere says, invitation or link: made up, used, cancelled, run out or made again. */
const NOWHERE = 'This link doesn’t lead anywhere any more. Ask whoever sent it for a new one.';
/** An invitation by its ID that isn't there: another team's, one that ended, one that never was. */
const ENDED = 'That invitation doesn’t exist, or it has ended.';
const NO_LINK = 'Only someone at a company, or on a team, has an invite link. Start a team to have one.';
const NOT_ON_ONE = 'You’re not on a team.';
const NOT_YOURS = 'Only whoever invited them, or the team’s admin, can do that.';
/** Past the day's invitations and resends (`team.invitations_per_day`), as the server refuses them. */
const DAY_FULL = `You’ve invited ${INVITES_A_DAY} people today. Invite more tomorrow, or copy your link.`;

/** A link as the server answers with it: the page at /invite, with the secret after the #. */
const linkOut = (secret: string): InviteLink => ({ link: new URL(`/invite#${secret}`, location.origin).href });
/**
 * What a team made for someone is called (design 3.1): their company's name (the company page's, for Art), or their first
 * name's at a personal address.
 */
const nameFor = (company: string | null, p: Person): string => company ?? `${p.name.split(' ')[0] ?? p.name}’s team`;
/** Someone on a team just made, as its admin: an ID of their own on it, and no license yet. */
const maker = (person: Person, now: number): TeamMemberWorld =>
  ({ id: nextId('tm'), person, role: 'admin', license: null, wanted: null, joinedAt: new Date(now).toISOString() });

/** The team you're on and you on it, or null. */
function onTeam(w: World): { t: TeamWorld; mine: TeamMemberWorld } | null {
  const t = w.myTeam;
  const mine = t ? meOn(t, me().email) : undefined;
  return t && mine ? { t, mine } : null;
}

/** What's left of the day's invitations and resends you send (20: `team.invitations_per_day`), in the day to `now`. */
const leftToday = (w: World, now: number): number => Math.max(0, INVITES_A_DAY - (w.invitedByYou ?? []).filter((at) => Date.parse(at) > now - DAY_MS).length);
/** `n` more of Art's sends, now: invitations made or sent again. */
function sentByYou(w: World, n: number, now: number): void {
  const at = new Date(now).toISOString();
  w.invitedByYou = [...Array.from({ length: n }, () => at), ...(w.invitedByYou ?? [])];
}
/** Whether you can Resend or Cancel it: you asked them, or you're the admin. */
const manages = (mine: TeamMemberWorld, i: InvitationWorld): boolean => i.by === mine.id || mine.role === 'admin';
/** An invitation of the team's that still stands, by its ID: anyone else's is the same as one that never was. */
function standing(t: TeamWorld, id: string): InvitationWorld {
  const i = liveInvitations(t).find((x) => x.id === id);
  if (!i) throw refused('not-found', ENDED);
  return i;
}

/**
 * Art onto `target` (design 4.4 to 4.6): never the team Art is on already; from another, only with `leave` (asked first, in
 * place), which leaves it as a member or deletes it as its admin alone on it, and never while Art runs one others are on. The
 * invitation it came by is used up, with any other to Art there, and joining is a visit: it takes a license if one is there,
 * unless Art left the team with one that's still live, which is Art's again.
 */
function joining(w: World, target: TeamWorld, leave: boolean, used: InvitationWorld | null): MyTeam {
  const you = me();
  const now = Date.now();
  const was = onTeam(w);
  if (was && (was.t === target || was.t.id === target.id)) throw refused('conflict', 'You’re on that team already.');
  if (was) {
    // Named nowhere, as the server's: what a refusal says is logged, and the app has both teams' names.
    if (!leave) throw refused('conflict', 'You’re on a team already. Leave it to join this one.');
    const others = was.t.members.length - 1;
    if (was.mine.role === 'admin' && others > 0) {
      throw refused('conflict', `You admin your team, and ${others} ${others === 1 ? 'other is' : 'others are'} on it. You can join another once nobody else is on yours.`);
    }
    if (was.mine.role === 'admin') deleteTeam(w, was.t);
    else leaveTeam(w, was.t, was.mine);
  }
  target.members = [...target.members, memberFrom(target, you, 'member', nextId('tm'), now)];
  target.invitations = target.invitations.filter((i) => i !== used && i.person.email !== you.email);
  w.otherTeams = (w.otherTeams ?? []).filter((t) => t !== target);
  w.myTeam = target;
  visit(w);
  return settled(w);
}

/** Someone's own link as the world has it, or made for them now if a story hasn't given them one. */
function linkFor(w: World, p: Person): InviteLinkWorld {
  const had = (w.invites ?? []).find((l) => l.from.email === p.email);
  if (had) return had;
  const made = linkOf(p);
  w.invites = [...(w.invites ?? []), made];
  return made;
}

/** `people.inviteLink`, `newInviteLink` and `peekInvite`: the links after `/invite#`. */
export const linksApi = {
  /** What Copy link copies (design 3.4): on a team its one link, its admin's; on none, your own. */
  inviteLink: (w: World): InviteLink => {
    const on = onTeam(w);
    const admin = on && on.mine.role !== 'admin' ? adminOf(on.t) : undefined;
    if (admin) return linkOut(linkFor(w, admin.person).secret);
    if (!on && !w.team) throw refused('forbidden', NO_LINK);
    w.inviteLink ??= artsLink(me());
    return linkOut(w.inviteLink.secret);
  },
  /** The next generation of your own link: the one before leads nowhere from now, for everybody. The admin's, or with no team. */
  newInviteLink: (w: World): InviteLink => {
    const on = onTeam(w);
    if (on && on.mine.role !== 'admin') throw refused('forbidden', 'Only the team’s admin can make a new link: it’s everyone’s on the team.');
    if (!on && !w.team) throw refused('forbidden', NO_LINK);
    w.inviteLink = madeAgain(w.inviteLink ?? artsLink(me()));
    return linkOut(w.inviteLink.secret);
  },
  /** Signed in or not: yours when it's your own link or your team's, or an invitation to your team, as the server knows by the account. */
  peekInvite: (w: World, secret: string): InvitePeek => {
    const peek = peekOf(w, secret, w.session?.user.email ?? null);
    if (!peek) throw refused('not-found', NOWHERE);
    return peek;
  }
};

/** The invitation methods of `api.teams`. */
export const invitationsApi = {
  /**
   * Invites these addresses (whole ones, 50 at most), making your team first if you're on none (invitations.ts › inviteIn):
   * anyone on it counts as `already`; anyone invited is invited again, sent again (and their 30 days started again) only once
   * its sends allow, and otherwise left as it is; anyone else gets an invitation, sent unless this team has sent the address 3
   * in 30 days (it's made all the same). What's made or sent again takes one of the day's 20 each, the first addresses in the
   * order sent, and those past what's left aren't invited (`over`). With none left at all, nothing changes and it's refused.
   */
  invite: (w: World, emails: string[]): InvitationsMade => {
    const parsed = InviteByEmailBodySchema.safeParse({ emails });
    if (!parsed.success) throw refused('invalid', emails.length === 0 ? 'Add someone to invite.' : emails.length > 50 ? 'Invite at most 50 people at a time.' : 'Type each one as a whole email address.');
    const asked = [...new Set(parsed.data.emails)];
    const you = me();
    if (asked.includes(you.email)) throw refused('invalid', 'That’s you.');
    const now = Date.now();
    const on = onTeam(w);
    const outside = asked.filter((e) => !(on && meOn(on.t, e)));
    // What each would do: one invited already is sent again only when its sends allow, and counts only then.
    const plans = outside.map((email) => {
      const live = on ? liveInvitations(on.t, now).find((i) => i.person.email === email) : undefined;
      const again = live !== undefined && on !== null && resendAtOf(on.t, live, now) === null;
      return { email, live, again, counts: live === undefined || again };
    });
    let left = leftToday(w, now);
    if (left === 0 && plans.some((p) => p.counts)) throw refused('conflict', DAY_FULL);
    const going = plans.filter((p) => {
      if (!p.counts) return true;
      if (left === 0) return false;
      left -= 1;
      return true;
    });
    const t = on?.t ?? freeTeamOf(nextId('team'), nameFor(w.team?.name ?? null, you), [maker(you, now)], w.plan.storage.usedBytes);
    w.myTeam = t;
    const mine = meOn(t, you.email);
    if (!mine) throw refused('not-found', NOT_ON_ONE);
    for (const p of going) {
      if (p.live && p.again) sendAgain(t, p.live, now, mine.id);
      else if (!p.live) inviteOn(t, { person: personAt(p.email), by: mine.id, at: new Date(now).toISOString(), id: nextId('inv'), sends: sendsNew(t, p.email, now) ? 1 : 0 });
    }
    sentByYou(w, going.filter((p) => p.counts).length, now);
    return { team: settled(w), invited: going.length, already: asked.length - outside.length, over: plans.length - going.length };
  },
  /**
   * Sends it again and starts its 30 days again, still from whoever asked them: whoever asked them or the admin, once a day,
   * and 3 times in 30 days from this team to the address, taking one of the day's 20.
   */
  resendInvitation: (w: World, id: string): MyTeam => {
    const { t, mine } = yours(w);
    const i = standing(t, id);
    if (!manages(mine, i)) throw refused('forbidden', NOT_YOURS);
    const now = Date.now();
    const why = resendWhyOf(t, i, now);
    if (why) throw refused('conflict', why === 'most' ? `That invitation has been sent ${MOST_SENT} times, so it can’t be sent again yet.` : 'That invitation was sent too recently to send again yet.');
    if (leftToday(w, now) === 0) throw refused('conflict', DAY_FULL);
    sendAgain(t, i, now);
    sentByYou(w, 1, now);
    return settled(w);
  },
  /** Cancels it, so its link stops working: whoever asked them or the admin. What the team sent it still counts. */
  cancelInvitation: (w: World, id: string): MyTeam => {
    const { t, mine } = yours(w);
    const i = standing(t, id);
    if (!manages(mine, i)) throw refused('forbidden', NOT_YOURS);
    t.invitations = t.invitations.filter((x) => x !== i);
    return settled(w);
  },
  invitations: (w: World): InvitationForYou[] => invitationsFor(w, me().email),
  acceptInvitation: (w: World, id: string, leave: boolean): MyTeam => {
    const found = invitationTo(w, me().email, id);
    if (!found) throw refused('not-found', ENDED);
    return joining(w, found.team, leave, found.invitation);
  },
  /** Not now: out of your count, still yours to accept until it runs out. Nobody is told. */
  putInvitationAside: (w: World, id: string): void => {
    const found = invitationTo(w, me().email, id);
    if (!found) throw refused('not-found', ENDED);
    found.invitation.putAside = true;
  },
  /**
   * Joins by a secret after `/invite#`: someone's invite link (their team; one made for them now, named for them with them its
   * admin, while they're on none) or an invitation's own link, used up by joining. Anything leading nowhere is `not-found`.
   */
  join: (w: World, secret: string, leave: boolean): MyTeam => {
    if (!InviteSecretSchema.safeParse(secret).success) throw refused('not-found', NOWHERE);
    const link = linksIn(w).find((l) => l.secret === secret);
    if (link) {
      const leads = whereLinkLeads(w, link.from);
      if (leads.to === 'nowhere') throw refused('not-found', NOWHERE);
      if (leads.to === 'team') return joining(w, leads.team, leave, null);
      if (link.from.email === me().email) throw refused('invalid', 'That’s your own invite link: whoever you send it to joins you.');
      const now = Date.now();
      return joining(w, freeTeamOf(nextId('team'), nameFor(companyOf(link.from.email), link.from), [maker(asOthersSee(link.from), now)]), leave, null);
    }
    const found = invitationBySecret(w, secret);
    if (!found) throw refused('not-found', NOWHERE);
    return joining(w, found.team, leave, found.invitation);
  }
};
