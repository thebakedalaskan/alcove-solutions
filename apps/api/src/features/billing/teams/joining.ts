/*
 * Getting people on a team (docs: Plans and usage › Team › Invitations, and › The team's link): inviting addresses, which makes
 * your team first if you're on none (named for your company page, or "Sam’s team"); accepting an invitation in the app, as
 * the account that signs in with its address; and joining by a secret after `/invite#`, an invitation's own link or a team's
 * link (where a link with no team yet makes its owner's then). Each is one transaction. Joining holds the joiner's account
 * first, as making a team and deleting an account do (and a link's owner's, the two in the order of their IDs), then the rows
 * of the teams it touches in the order of their IDs, then the joiner's place and the invitation it uses, then the plans: a
 * team's row is always held before what hangs off it, as a visit and taking someone off a team hold it. So two at once never
 * put someone on two teams, and joining someone else's link while they join yours never waits on itself. Someone on a team
 * already joins another only when they asked to leave theirs (`leave`): a member leaves it, its admin alone on it deletes it
 * (and its link, theirs, is made again), and its admin with others on it can't. Nobody joins the team they're on by an
 * invitation: that's left for whoever it's for. A license is taken on joining as on any visit. What two changes at once can
 * still run into is a conflict to try again (`raced`).
 */
import type { InvitationsMade, InvitePeek, MyTeam, Person } from '@alcove/api';
import type { Deps, Owner } from '../../../platform/context';
import { exec, tx, type Db } from '../../../platform/db';
import { conflict, InternalError, NotFoundError, ValidationError } from '../../../platform/errors';
import { limitsNow } from '../../../platform/limits';
import { log } from '../../../platform/log';
import { kickMail } from '../../../platform/mail';
import { lockOwner } from '../../../keys/owners';
import { teamNameFor } from '../../profile/companies';
import { bySecret, forYouById, holdInvitation, inviteeIndex, inviteIn, peekInvitation, usedUp } from './invitations';
import { leadOf, peekLink, remadeIn } from './invite-links';
import { addMember, membership, raced, teamRow, withTeam, type TeamRow } from './team-records';
import { createIn, deleteAlone, drop, othersOn, requireTeam, visit } from './teams';

const jlog = log.child({ component: 'teams' });

/** A secret that leads nowhere: made up, used, cancelled, run out, made again since, or its sender gone. One answer for all. */
const nowhere = (context: Record<string, string>) =>
  new NotFoundError('This link doesn’t lead anywhere any more. Ask whoever sent it for a new one.', { context });
const ended = (ownerId: string, invitationId: string) => new NotFoundError('That invitation doesn’t exist, or it has ended.', { context: { ownerId, invitationId } });

/* ---------- inviting ---------- */

/**
 * Invites these addresses to the caller's team, making it first if they're on none, with them as its admin (invitations.ts ›
 * inviteIn), in the order asked, up to what's left of their invitations today: the rest are `over`. Refused for their own
 * address, and when none are left today, before anything changes. What's to email is sent once it's all committed.
 */
export async function invite(o: Owner, me: Person, emails: string[]): Promise<InvitationsMade> {
  if (emails.some((e) => e.trim().toLowerCase() === me.email.trim().toLowerCase())) throw new ValidationError('That’s you.', { context: { ownerId: o.ownerId, why: 'own-address' } });
  const r = await raced({ ownerId: o.ownerId }, () => tx(o.pool, async (c) => {
    // One at a time for an account: two at once can't both make it a team, nor count past its day's invitations.
    await lockOwner(o, c);
    const was = await membership(c, o.ownerId);
    if (!was) await createIn(o, c, { ownerId: o.ownerId, who: me }, teamNameFor(me));
    const m = was ?? await membership(c, o.ownerId);
    const t = m && await teamRow(c, m.team_id);
    if (!m || !t) throw new InternalError('A team was made and isn’t there.', { context: { ownerId: o.ownerId } });
    const now = Date.now();
    const l = await limitsNow(o, c);
    return withTeam(o, t, (team) => inviteIn(o, c, team, t, o.ownerId, emails, l, now), c);
  }));
  kickMail(o);
  return { team: await requireTeam(o, o.ownerId), invited: r.invited, already: r.already, over: r.over };
}

/* ---------- joining ---------- */

/** Where joining puts someone: a team there is, or the team a link's owner on no team gets now (`maker`). */
type Target = { teamId: string; invitationId: string | null } | { maker: { ownerId: string; who: { name: string; email: string } } };
/** What joining did, for the log: which team, whether it was made for this, and what became of the team they were on. */
interface Joined { teamId: string; made: boolean; already: boolean; left: 'none' | 'left' | 'deleted' }

/** The rows of these teams, held in the order of their IDs: every join that holds two takes them in the same order. */
async function holdTeams(c: Db, ids: string[]): Promise<Map<string, TeamRow>> {
  const held = new Map<string, TeamRow>();
  for (const id of [...new Set(ids)].sort()) {
    const t = await teamRow(c, id, true);
    if (t) held.set(id, t);
  }
  return held;
}

/**
 * Puts the caller on the team `to` names, in the caller's transaction, which holds their account (and a link's owner's).
 * Someone on it already stays as they are by its link, and is refused by an invitation, which is left as it is for whoever
 * it's for. Someone on another team is refused unless they asked to leave it (`leave`): then a member leaves it, and its
 * admin deletes it once nobody else is on it (its link made again with it), or is refused. The invitation used, and any to
 * the address they sign in with, are used up.
 */
async function joinIn(d: Deps, c: Db, o: Owner, me: Person, to: Target, leave: boolean): Promise<Joined> {
  // The teams' rows before the caller's place on one, as a visit and taking someone off take them: then it's held as it is.
  // Only its admin taking them off can change it meanwhile, which leaves them on none.
  const seen = await membership(c, o.ownerId);
  const teams = await holdTeams(c, [...(seen ? [seen.team_id] : []), ...('teamId' in to ? [to.teamId] : [])]);
  const was = await membership(c, o.ownerId, true);
  // The invitation, after its team's row: used, cancelled, run out or gone with whoever made it meanwhile, it leads nowhere.
  if ('teamId' in to && to.invitationId !== null && !(await holdInvitation(c, to.invitationId, Date.now()))) throw ended(o.ownerId, to.invitationId);
  if (was && 'teamId' in to && was.team_id === to.teamId) {
    // An invitation is someone's way onto the team: one opened by someone on it already is left for whoever it's for.
    if (to.invitationId !== null) throw conflict('You’re on that team already.', { ownerId: o.ownerId, teamId: to.teamId, invitationId: to.invitationId, why: 'on-it' });
    await usedUp(c, to.teamId, inviteeIndex(d, me.email), null);
    return { teamId: to.teamId, made: false, already: true, left: 'none' };
  }
  let left: Joined['left'] = 'none';
  if (was) {
    // Named nowhere here: what a refusal says is logged, and the app has both teams' names.
    if (!leave) throw conflict('You’re on a team already. Leave it to join this one.', { ownerId: o.ownerId, teamId: was.team_id, why: 'on-a-team' });
    const old = teams.get(was.team_id);
    if (!old) throw new NotFoundError('You’re not on a team.', { context: { ownerId: o.ownerId } });
    if (was.role === 'admin') {
      const others = await othersOn(c, old, was);
      if (others > 0) throw conflict(`You admin your team, and ${others} ${others === 1 ? 'other is' : 'others are'} on it. You can join another once nobody else is on yours.`, { ownerId: o.ownerId, teamId: old.team_id, members: others, why: 'admin' });
      const r = await deleteAlone(d, c, old, was);
      // Its link was theirs: the deleted team's leads nowhere from now, as when it's deleted on its own.
      await remadeIn(o, c, 'deleted');
      jlog.info('team deleted', { ownerId: o.ownerId, teamId: old.team_id, licensesRefunded: r.licenses, microUsd: r.microUsd, why: 'joining-another' });
      left = 'deleted';
    } else {
      await drop(d, c, old, was, 'left');
      left = 'left';
    }
  }
  const teamId = 'teamId' in to ? to.teamId : await createIn(d, c, { ownerId: to.maker.ownerId, who: to.maker.who }, teamNameFor(to.maker.who));
  const t = 'teamId' in to ? teams.get(to.teamId) : await teamRow(c, teamId);
  if (!t) throw nowhere({ ownerId: o.ownerId, why: 'team-gone' });
  await withTeam(d, t, (team) => addMember(c, team, t.team_id, o.ownerId, { name: me.name, email: me.email }, 'member'), c);
  await usedUp(c, t.team_id, inviteeIndex(d, me.email), 'teamId' in to ? to.invitationId : null);
  return { teamId: t.team_id, made: !('teamId' in to), already: false, left };
}

/** After a join commits: a license is taken if there's one to take, as on any visit, and the team is said as its new member sees it. */
async function joined(o: Owner, j: Joined): Promise<MyTeam> {
  if (!j.already) await visit(o, o.ownerId);
  return requireTeam(o, o.ownerId);
}

/**
 * Accepts an invitation to the address the caller signs in with: they're on its team from now (`joinIn`). Another account's,
 * one that ran out and one that never was are the same `not-found`.
 */
export async function acceptInvitation(o: Owner, me: Person, invitationId: string, leave: boolean): Promise<MyTeam> {
  const j = await raced({ ownerId: o.ownerId, invitationId }, () => tx(o.pool, async (c) => {
    await lockOwner(o, c);
    const r = await forYouById(o, c, invitationId, Date.now());
    if (!r) throw ended(o.ownerId, invitationId);
    return joinIn(o, c, o, me, { teamId: r.team_id, invitationId: r.invitation_id }, leave);
  }));
  jlog.info('team invitation accepted', { ownerId: o.ownerId, teamId: j.teamId, invitationId, left: j.left });
  return joined(o, j);
}

/**
 * Joins the team a secret after `/invite#` leads to (`joinIn`): a link's (the team its owner admins, or one made for its owner,
 * who's on none), else an invitation's own, which anyone holding it can use once. Your own link with no team is refused: it's
 * for whoever you send it to. Anything that leads nowhere is the same `not-found`.
 */
export async function joinBySecret(o: Owner, me: Person, secret: string, leave: boolean): Promise<MyTeam> {
  const j = await raced({ ownerId: o.ownerId }, () => tx(o.pool, async (c): Promise<Joined & { kind: 'link' | 'invitation' }> => {
    const seen = await leadOf(c, secret);
    if (seen) {
      if (seen.ownerId === o.ownerId && seen.teamId === null) throw new ValidationError('That’s your own invite link: whoever you send it to joins you.', { context: { ownerId: o.ownerId, why: 'own-link' } });
      // Both accounts, in the order of their IDs, so two people joining each other's links at once never wait on each other.
      for (const id of [...new Set([o.ownerId, seen.ownerId])].sort()) await exec(c, 'SELECT 1 FROM owners WHERE owner_id = $1 FOR NO KEY UPDATE', [id]);
      // As it leads now both are held: made again, or its owner on another team or gone, meanwhile, it leads nowhere.
      const lead = await leadOf(c, secret, true);
      if (!lead || lead.ownerId !== seen.ownerId || lead.teamId !== seen.teamId) throw nowhere({ ownerId: o.ownerId, why: 'moved-meanwhile' });
      const to: Target = lead.teamId === null ? { maker: { ownerId: lead.ownerId, who: { name: lead.from.name, email: lead.from.email } } } : { teamId: lead.teamId, invitationId: null };
      return { ...await joinIn(o, c, o, me, to, leave), kind: 'link' };
    }
    await lockOwner(o, c);
    const r = await bySecret(c, secret, Date.now());
    if (!r) throw nowhere({ ownerId: o.ownerId, why: 'nowhere' });
    return { ...await joinIn(o, c, o, me, { teamId: r.team_id, invitationId: r.invitation_id }, leave), kind: 'invitation' };
  }));
  jlog.info('team joined from a link', { ownerId: o.ownerId, teamId: j.teamId, kind: j.kind, made: j.made, already: j.already, left: j.left });
  return joined(o, j);
}

/**
 * What a secret after `/invite#` says to whoever opens it, signed in or not (`askedBy`): as a link first, then as an
 * invitation's own, which says its ID to whoever it's to and whether they're on its team. Anything that leads nowhere is
 * the same `not-found`.
 */
export async function peek(d: Pick<Deps, 'cfg' | 'pool'>, secret: string, askedBy: Owner | undefined): Promise<InvitePeek> {
  const link = await peekLink(d, secret, askedBy?.ownerId);
  if (link) return link;
  const invitation = await peekInvitation(d, secret, askedBy);
  if (invitation) return invitation;
  throw nowhere({ why: 'nowhere' });
}
