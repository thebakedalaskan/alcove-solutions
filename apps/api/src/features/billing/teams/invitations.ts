/*
 * Invitations to a team (docs: Plans and usage › Team › Invitations; Privacy, keys and sessions › Invitations): someone on a
 * team asks one address to join it, whether or not it's on Alcove. Alcove emails it (platform/mail.ts), and an account that
 * signs in with the address sees it in the app. Who's invited is sealed under the team's key (`team-invitation`): their
 * address and when it was made. A row finds it by a blind index of the address (`team-invitee`, never the `email` index
 * sign-in keeps, so neither table joins the other), and by the SHA-256 of its own link's secret, which is worked out from the
 * team's root and the invitation's ID (`teamInvitationSecret`), so every email of it carries the same link. One for each
 * address on a team; it goes when it's used, cancelled or runs out (`team.invitation_seconds`), with its team, and with
 * whoever made it, once they're off the team. Whether whoever it's to put it aside is theirs alone, in their own profile.
 *
 * A team sends an invitation (inviting, or sending it again) at most once in `team.invitation_resend_seconds`, and one
 * address at most `mail.address_per_team` times in `team.invitation_seconds`, by the address in its canonical form, so
 * `sam+work@` is `sam@` (platform/mail.ts › canonicalAddress); each counts against the `team.invitations_per_day` of whoever
 * does it. Every invitation made or sent again is written as an email, sealed, and queued alike, whatever will become of it:
 * whether it goes is the sender's to decide as it goes (an address that stopped Alcove's emails, one that's had its emails
 * for the day from all of Alcove, or one this team's own limits held back), so nothing a request does, nor how long it takes,
 * says whether an email went. Nobody on a team learns either.
 */
import type { InvitationForYou, InvitePeek, TeamInvitation } from '@alcove/api';
import { invitationEmail } from '@alcove/mail';
import { z } from 'zod';
import type { Deps, Owner } from '../../../platform/context';
import { b64u, blindIndex, id128, openJson, sealJson, sha, teamInvitationSecret, toJson, utf8 } from '../../../keys/crypto';
import { indexKey, lockOwner } from '../../../keys/owners';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../../platform/db';
import { conflict, ForbiddenError, NotFoundError } from '../../../platform/errors';
import { limitsNow, type Limits } from '../../../platform/limits';
import { log } from '../../../platform/log';
import { kickMail, mailAddressIndex, pruneSends, queueMail, recordSend, sendsBy, stopToken } from '../../../platform/mail';
import { personOf } from '../../profile/portraits';
import { profile, updateProfile } from '../../profile/profile';
import { glimpseOf, membership, membersOf, raced, teamRow, whoIn, withTeam, type MemberRow, type Service, type TeamKey, type TeamRow, type Who } from './team-records';

const ilog = log.child({ component: 'team-invitations' });
const DAY_MS = 86_400_000;

/* ---------- records ---------- */

/** Who an invitation is to, and when it was first made, sealed under its team's key. */
const Invited = z.object({ email: z.string(), madeAt: z.string() });
const header = (team: TeamKey, teamId: string, invitationId: string) => ({ v: 1 as const, kind: 'team-invitation', ownerId: team.ownerId, teamId, invitationId });
const sealed = (team: TeamKey, teamId: string, invitationId: string, invited: z.infer<typeof Invited>) => sealJson(team.key, header(team, teamId, invitationId), toJson(invited));
const openOf = (team: TeamKey, r: Row) => openJson(team.key, header(team, r.team_id, r.invitation_id), r.ciphertext, Invited);

export const Row = z.object({
  invitation_id: z.string(), team_id: z.string(), invited_by: z.string(), invitee_index: bytea, ciphertext: bytea,
  sent_at: timestamp, expires_at: timestamp
});
export type Row = z.infer<typeof Row>;
const COLUMNS = 'invitation_id, team_id, invited_by, invitee_index, ciphertext, sent_at, expires_at';

/** How an invited address is found, opening nothing: its blind index, `team-invitee`. */
export function inviteeIndex(d: Pick<Deps, 'cfg'>, email: string): Uint8Array {
  const key = indexKey(d);
  try { return blindIndex(key, 'team-invitee', email); } finally { key.fill(0); }
}
/** An invitation's own link's secret, worked out from its team's root, and the hash its row is found by. */
const secretOf = (team: TeamKey, invitationId: string) => teamInvitationSecret(team.root, team.ownerId, invitationId);
export const hashOf = (secret: string): Uint8Array => sha(utf8(secret));

/* ---------- how often ---------- */

/** When this team sent each address an invitation in `team.invitation_seconds`, oldest first, by its canonical index. */
const sendsOf = (d: Pick<Deps, 'cfg'>, db: Db, teamId: string, l: Limits, now: number): Promise<Map<string, number[]>> =>
  sendsBy(d, db, teamId, now - l.get('team.invitation_seconds') * 1000);
/** An address's key into what `sendsOf` says: its canonical form's index. */
const addressOf = (d: Pick<Deps, 'cfg'>, email: string) => b64u(mailAddressIndex(d, email));

/**
 * When this team can next send an invitation it sent at `sentAt` to an address it sent `sends` to (oldest first, in the
 * window), and why not before: once `team.invitation_resend_seconds` has gone since (`recent`), and once fewer than
 * `mail.address_per_team` of them are in `team.invitation_seconds` (`most`, never while it's 0). `at` null: now. What's said
 * for it is only ever this team's own doing, never whether an email went.
 */
function holdOf(sentAt: number, sends: number[], l: Limits, now: number): { at: number | null; why: 'recent' | 'most' | null } {
  const most = l.get('mail.address_per_team');
  const window = l.get('team.invitation_seconds') * 1000;
  const wait = sentAt + l.get('team.invitation_resend_seconds') * 1000;
  // At most `most` in the window: the next goes once the oldest of the latest `most` is out of it.
  const oldest = most > 0 ? sends.at(-most) : undefined;
  const capped = most <= 0 ? Infinity : sends.length >= most && oldest !== undefined ? oldest + window : -Infinity;
  const at = Math.max(wait, capped);
  if (at <= now) return { at: null, why: null };
  return { at, why: capped >= wait ? 'most' : 'recent' };
}

/** How many invitations an account has made, and sent again, today (UTC), and how many more it may. */
const today = (now: number) => new Date(now).toISOString().slice(0, 10);
async function dayOf(db: Db, ownerId: string, l: Limits, now: number): Promise<{ made: number; most: number; left: number }> {
  const made = (await maybeOne(db, z.object({ made: z.number() }), 'SELECT made FROM team_invitation_days WHERE owner_id = $1 AND day = $2', [ownerId, today(now)]))?.made ?? 0;
  const most = l.get('team.invitations_per_day');
  return { made, most, left: Math.max(0, most - made) };
}
/** Nothing's left of today's invitations: refused, with nothing changed. */
function noneLeft(ownerId: string, day: { made: number; most: number }, asked: number) {
  const n = Math.max(day.made, day.most);
  return conflict(`You’ve invited ${n} ${n === 1 ? 'person' : 'people'} today. Invite more tomorrow, or copy your link.`, { ownerId, limit: 'team.invitations_per_day', made: day.made, most: day.most, asked });
}
/** Counts `n` more of today's invitations for an account. */
async function countMade(db: Db, ownerId: string, n: number, now: number): Promise<void> {
  if (n <= 0) return;
  await exec(db, `INSERT INTO team_invitation_days (owner_id, day, made) VALUES ($1, $2, $3)
    ON CONFLICT (owner_id, day) DO UPDATE SET made = team_invitation_days.made + excluded.made`, [ownerId, today(now), n]);
}

/* ---------- the email ---------- */

/** What one team's email to someone says of it and of who asked: worked out once for everyone it goes to. */
interface Sender { team: TeamKey; t: TeamRow; name: string; people: number; faces: { name: string }[]; from: Who }

/**
 * Writes an invitation's email to `email`, sealed, and queues it, in the caller's transaction: the same for every invitation
 * made or sent again, whatever becomes of it. `sendId`: the send it is (`recordSend`), or null when this team's own limits
 * hold it back, so it never goes. An earlier email of it still waiting goes, unsent: this one is the one to send.
 */
async function queueFor(d: Pick<Deps, 'cfg'>, c: Db, s: Sender, invitationId: string, email: string, sendId: string | null, l: Limits): Promise<void> {
  const token = stopToken(d, email);
  const made = invitationEmail({
    from: s.from, team: { name: s.name, people: s.people, faces: s.faces },
    link: `${d.cfg.WEB_ORIGIN}/invite#${secretOf(s.team, invitationId)}`,
    expiresInDays: Math.max(1, Math.round(l.get('team.invitation_seconds') / 86_400)),
    stopLink: `${d.cfg.WEB_ORIGIN}/stop-email#${token}`
  });
  await exec(c, 'DELETE FROM mail_outbox WHERE invitation_id = $1', [invitationId]);
  await queueMail(d, c, {
    to: email, replyTo: s.from.email, subject: made.subject, html: made.html, text: made.text,
    // One press stops them, from the mail app itself (RFC 8058): the token in the URL names nobody.
    headers: { 'List-Unsubscribe': `<${d.cfg.API_URL.replace(/\/$/, '')}/v1/mail/stop?token=${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    inline: made.inline.map((i) => ({ contentId: i.contentId, filename: i.filename, contentType: i.contentType, content: i.content }))
  }, { invitationId, sendId });
}

/** The team as an email from it says it, opened with its keys: its name, how many are on it, and up to 4 by name, `first` first. */
async function senderOf(c: Db, team: TeamKey, t: TeamRow, from: MemberRow): Promise<Sender> {
  const g = await glimpseOf(c, team, t, from.account_owner_id);
  return { team, t, name: g.name, people: g.people, faces: g.faces.map((f) => ({ name: f.name })), from: whoIn(team, from) };
}

/* ---------- inviting ---------- */

/** What inviting came to: invited or invited again, on the team already, and not invited as they'd go past today's limit. */
export interface InviteOutcome { invited: number; already: number; over: number }

/**
 * Invites these addresses to the team `t`, as the account `inviterId` on it, in the caller's transaction, which holds the
 * inviter's account: the team's row is held first, so two people inviting one address at once take turns, and the inviter's
 * place is read again once it is (taken off the team meanwhile, they invite nobody to it). Each on the team already is
 * counted as such; one invited already is invited again, sent again only once its sends allow (otherwise it stays as it
 * is); anyone else gets an invitation, sent unless this team has sent the address its most in `team.invitation_seconds`
 * already (it's made all the same, and its email held back). What's made and sent again counts against the inviter's
 * `team.invitations_per_day`, in the order asked, up to what's left of it today; the rest are `over`, and nothing at all is
 * done while none is left.
 */
export async function inviteIn(d: Deps, c: Db, team: TeamKey, t: TeamRow, inviterId: string, emails: string[], l: Limits, now: number): Promise<InviteOutcome> {
  await teamRow(c, t.team_id, true);
  const inviter = await membership(c, inviterId);
  if (!inviter || inviter.team_id !== t.team_id) throw conflict('You’re not on that team any more.', { ownerId: inviterId, teamId: t.team_id, why: 'off-the-team' });
  const everyone = await membersOf(c, t.team_id);
  const on = new Set(everyone.map((m) => whoIn(team, m).email.trim().toLowerCase()));
  const asked = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  const outside = asked.filter((e) => !on.has(e));
  const indexed = outside.map((email) => ({ email, index: inviteeIndex(d, email), address: addressOf(d, email) }));
  const there = await rows(c, Row, `SELECT ${COLUMNS} FROM team_invitations WHERE team_id = $1 AND invitee_index = ANY($2::bytea[]) FOR UPDATE`, [t.team_id, indexed.map((x) => x.index)]);
  const existing = new Map(there.map((r) => [b64u(r.invitee_index), r]));
  const sends = await sendsOf(d, c, t.team_id, l, now);
  const day = await dayOf(c, inviterId, l, now);
  const window = l.get('team.invitation_seconds') * 1000;
  let s: Sender | null = null;
  let left = day.left;
  const n = { invited: 0, over: 0, made: 0, again: 0, held: 0 };
  for (const x of indexed) {
    const row = existing.get(b64u(x.index));
    // One that ran out, and upkeep hasn't taken yet, is as good as none: it's made again, with a link of its own.
    const live = row && row.expires_at.getTime() > now ? row : undefined;
    const past = sends.get(x.address) ?? [];
    const sendable = holdOf(live?.sent_at.getTime() ?? -Infinity, past, l, now).at === null;
    // Invited already, and not to be sent again yet: it stays as it is, and counts nothing.
    if (live && !sendable) { n.invited++; continue; }
    if (left <= 0) {
      if (day.left <= 0) throw noneLeft(inviterId, day, indexed.length);
      n.over++;
      continue;
    }
    left--;
    n.invited++;
    const invitationId = live?.invitation_id ?? id128();
    if (live) {
      // Invited again: by whoever asked this time, from now, sent again.
      await exec(c, 'UPDATE team_invitations SET invited_by = $2, sent_at = $3, expires_at = $4 WHERE invitation_id = $1', [invitationId, inviter.member_id, new Date(now), new Date(now + window)]);
      n.again++;
    } else {
      if (row) await exec(c, 'DELETE FROM team_invitations WHERE invitation_id = $1', [row.invitation_id]);
      await exec(c, `INSERT INTO team_invitations (invitation_id, team_id, invited_by, invitee_index, secret_sha256, ciphertext, sent_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [invitationId, t.team_id, inviter.member_id, x.index, hashOf(secretOf(team, invitationId)), sealed(team, t.team_id, invitationId, { email: x.email, madeAt: new Date(now).toISOString() }), new Date(now), new Date(now + window)]);
      n.made++;
    }
    let sendId: string | null = null;
    if (sendable) {
      sendId = await recordSend(d, c, t.team_id, x.email, now);
      sends.set(x.address, [...past, now]);
    } else n.held++;
    s ??= await senderOf(c, team, t, inviter);
    await queueFor(d, c, s, invitationId, x.email, sendId, l);
  }
  await countMade(c, inviterId, n.made + n.again, now);
  const already = asked.length - outside.length;
  ilog.info('team invitations made', { teamId: t.team_id, memberId: inviter.member_id, count: n.invited, made: n.made, again: n.again, held: n.held, over: n.over, already });
  return { invited: n.invited, already, over: n.over };
}

/**
 * An invitation on the caller's team, by its ID, held with the team's row held first: another team's, one that ran out and
 * one that never was are the same `not-found`. The caller's place is read once the team's row is held, so someone taken off
 * it meanwhile reaches nothing of it.
 */
async function onYourTeam(c: Db, ownerId: string, invitationId: string, now: number): Promise<{ me: MemberRow; t: TeamRow; r: Row }> {
  const ended = () => new NotFoundError('That invitation doesn’t exist, or it has ended.', { context: { ownerId, invitationId } });
  const seen = await membership(c, ownerId);
  if (!seen) throw ended();
  await holdTeamFor(c, seen.team_id);
  const me = await membership(c, ownerId);
  if (!me || me.team_id !== seen.team_id) throw ended();
  const r = await maybeOne(c, Row, `SELECT ${COLUMNS} FROM team_invitations WHERE invitation_id = $1 AND team_id = $2 AND expires_at > $3 FOR UPDATE`, [invitationId, me.team_id, new Date(now)]);
  const t = r && await teamRow(c, r.team_id);
  if (!r || !t) throw ended();
  if (r.invited_by !== me.member_id && me.role !== 'admin') {
    throw new ForbiddenError('Only whoever invited them, or the team’s admin, can do that.', { context: { ownerId, teamId: t.team_id, invitationId } });
  }
  return { me, t, r };
}

/**
 * Sends an invitation again, and starts its `team.invitation_seconds` again: whoever made it or the team's admin, once its
 * sends allow (`holdOf`), counted against their `team.invitations_per_day`. It's still from whoever made it. Its email is
 * queued as any invitation's is, and goes once it's committed, if it goes.
 */
export async function resend(o: Owner, invitationId: string): Promise<void> {
  await raced({ ownerId: o.ownerId, invitationId }, () => tx(o.pool, async (c) => {
    // One at a time for an account, as its day's invitations are counted.
    await lockOwner(o, c);
    await resendIn(o, c, o, invitationId);
  }));
  kickMail(o);
}
async function resendIn(d: Deps, c: Db, o: Owner, invitationId: string): Promise<void> {
  const now = Date.now();
  const l = await limitsNow(d, c);
  const { t, r } = await onYourTeam(c, o.ownerId, invitationId, now);
  await withTeam(d, t, async (team) => {
    const email = openOf(team, r).email;
    const past = (await sendsOf(d, c, t.team_id, l, now)).get(addressOf(d, email)) ?? [];
    const hold = holdOf(r.sent_at.getTime(), past, l, now);
    if (hold.at !== null) {
      const most = l.get('mail.address_per_team');
      const message = hold.why === 'recent' ? 'That invitation was sent too recently to send again yet.'
        : most > 0 ? `That invitation has been sent ${most} ${most === 1 ? 'time' : 'times'}, so it can’t be sent again yet.` : 'That invitation can’t be sent again.';
      throw conflict(message, { ownerId: o.ownerId, teamId: t.team_id, invitationId, why: hold.why });
    }
    const day = await dayOf(c, o.ownerId, l, now);
    if (day.left <= 0) throw noneLeft(o.ownerId, day, 1);
    await countMade(c, o.ownerId, 1, now);
    await exec(c, 'UPDATE team_invitations SET sent_at = $2, expires_at = $3 WHERE invitation_id = $1', [invitationId, new Date(now), new Date(now + l.get('team.invitation_seconds') * 1000)]);
    // Whoever made it is on the team while it is: it goes with them (team_invitations.invited_by).
    const from = (await membersOf(c, t.team_id)).find((m) => m.member_id === r.invited_by);
    if (!from) throw new NotFoundError('That invitation doesn’t exist, or it has ended.', { context: { ownerId: o.ownerId, invitationId } });
    await queueFor(d, c, await senderOf(c, team, t, from), invitationId, email, await recordSend(d, c, t.team_id, email, now), l);
  }, c);
  ilog.info('team invitation resent', { ownerId: o.ownerId, teamId: t.team_id, invitationId, memberId: r.invited_by });
}

/** Cancels an invitation, so its link leads nowhere from now: whoever made it, or the team's admin. */
export async function cancel(o: Owner, invitationId: string): Promise<void> {
  const teamId = await raced({ ownerId: o.ownerId, invitationId }, () => tx(o.pool, async (c) => {
    const { t } = await onYourTeam(c, o.ownerId, invitationId, Date.now());
    await exec(c, 'DELETE FROM team_invitations WHERE invitation_id = $1', [invitationId]);
    return t.team_id;
  }));
  ilog.info('team invitation cancelled', { ownerId: o.ownerId, teamId, invitationId });
}

/* ---------- what the team sees ---------- */

/**
 * Who's been invited to a team and hasn't run out, newest first, as everyone on it sees them: who they are as the directory
 * knows them (or their address), who invited them, when they were first invited, whether `me` may send it again or cancel
 * it, and from when and why not before, with how many times this team has sent it in `team.invitation_seconds`: its own
 * sends alone, never whether an email went.
 */
export async function invitationsOf(d: Pick<Deps, 'cfg'>, db: Db, team: TeamKey, t: TeamRow, me: MemberRow, everyone: MemberRow[], l: Limits, now: number): Promise<TeamInvitation[]> {
  const found = await rows(db, Row, `SELECT ${COLUMNS} FROM team_invitations WHERE team_id = $1 AND expires_at > $2 ORDER BY sent_at DESC, invitation_id`, [t.team_id, new Date(now)]);
  if (!found.length) return [];
  const sends = await sendsOf(d, db, t.team_id, l, now);
  const by = new Map(everyone.map((m) => [m.member_id, m]));
  return found.flatMap((r): TeamInvitation[] => {
    const inviter = by.get(r.invited_by);
    if (!inviter) return [];
    const who = whoIn(team, inviter);
    const invited = openOf(team, r);
    const past = sends.get(addressOf(d, invited.email)) ?? [];
    const hold = holdOf(r.sent_at.getTime(), past, l, now);
    const you = r.invited_by === me.member_id;
    return [{
      id: r.invitation_id, person: personOf(invited.email), invitedBy: personOf(who.email, who.name), you, madeAt: invited.madeAt,
      at: r.sent_at.toISOString(), expiresAt: r.expires_at.toISOString(), manage: you || me.role === 'admin',
      // Never again while one team may send an address none: until it runs out, as far as its people can tell.
      resendAt: hold.at === null ? null : new Date(Number.isFinite(hold.at) ? hold.at : r.expires_at.getTime()).toISOString(),
      resendWhy: hold.why, sends: past.length
    }];
  });
}

/** Which of these addresses have an invitation to the team the caller is on that hasn't run out (none on no team). */
export async function invitedOnYourTeam(o: Owner, emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const me = await membership(o.pool, o.ownerId);
  if (!me) return new Set();
  const byIndex = new Map(emails.map((e) => [b64u(inviteeIndex(o, e)), e]));
  const found = await rows(o.pool, z.object({ invitee_index: bytea }), 'SELECT invitee_index FROM team_invitations WHERE team_id = $1 AND invitee_index = ANY($2::bytea[]) AND expires_at > $3',
    [me.team_id, [...byIndex.keys()].map((k) => Buffer.from(k, 'base64url')), new Date()]);
  return new Set(found.flatMap((r) => { const e = byIndex.get(b64u(r.invitee_index)); return e ? [e] : []; }));
}

/* ---------- what the invited see ---------- */

/** The index the caller's invitations are found by: of the address they sign in with, as their profile follows it. */
export async function yourIndex(o: Owner, db: Db = o.pool): Promise<Uint8Array> {
  return inviteeIndex(o, (await profile(o, db)).email);
}

/** An invitation as whoever it's to sees it: who asked (as the team has them now), the team at a glimpse, and when. */
async function asForYou(d: Service, db: Db, r: Row, putAside: boolean): Promise<InvitationForYou | null> {
  const t = await teamRow(db, r.team_id);
  if (!t) return null;
  return withTeam(d, t, async (team) => {
    const inviter = (await membersOf(db, t.team_id)).find((m) => m.member_id === r.invited_by);
    if (!inviter) return null;
    const who = whoIn(team, inviter);
    return {
      id: r.invitation_id, from: personOf(who.email, who.name), team: await glimpseOf(db, team, t, inviter.account_owner_id),
      at: r.sent_at.toISOString(), expiresAt: r.expires_at.toISOString(), putAside
    };
  }, db);
}

/**
 * The invitations to the address the caller signs in with that haven't run out, newest first, put aside or not; never one
 * to the team they're on. What they put aside is theirs, in their profile: any of it that's no invitation to them any more
 * (used, cancelled, run out, or to an address they've left) is forgotten here.
 */
export async function forYou(o: Owner): Promise<InvitationForYou[]> {
  const now = Date.now();
  const me = await membership(o.pool, o.ownerId);
  const p = await profile(o);
  const found = await rows(o.pool, Row, `SELECT ${COLUMNS} FROM team_invitations WHERE invitee_index = $1 AND expires_at > $2 ORDER BY sent_at DESC, invitation_id`, [inviteeIndex(o, p.email), new Date(now)]);
  const ids = new Set(found.map((r) => r.invitation_id));
  const gone = new Set(p.putAside.filter((id) => !ids.has(id)));
  if (gone.size) {
    await updateProfile(o, (q) => ({ ...q, putAside: q.putAside.filter((id) => !gone.has(id)) }));
    ilog.debug('put-aside invitations forgotten', { ownerId: o.ownerId, count: gone.size });
  }
  const aside = new Set(p.putAside);
  const out: InvitationForYou[] = [];
  for (const r of found) {
    if (me && r.team_id === me.team_id) continue;
    const seen = await asForYou(o, o.pool, r, aside.has(r.invitation_id));
    if (seen) out.push(seen);
  }
  return out;
}

/** Not now: puts an invitation to the caller aside, out of their count, in their own profile alone. Nobody is told. */
export async function putAside(o: Owner, invitationId: string): Promise<void> {
  if (!(await forYouById(o, o.pool, invitationId, Date.now()))) throw new NotFoundError('That invitation doesn’t exist, or it has ended.', { context: { ownerId: o.ownerId, invitationId } });
  await updateProfile(o, (p) => (p.putAside.includes(invitationId) ? p : { ...p, putAside: [...p.putAside, invitationId] }));
  ilog.info('team invitation put aside', { ownerId: o.ownerId, invitationId });
}

/** An invitation to the caller, by its ID; undefined for any other. */
export const forYouById = async (o: Owner, db: Db, invitationId: string, now: number): Promise<Row | undefined> =>
  maybeOne(db, Row, `SELECT ${COLUMNS} FROM team_invitations WHERE invitation_id = $1 AND invitee_index = $2 AND expires_at > $3`, [invitationId, await yourIndex(o, db), new Date(now)]);
/** An invitation by its link's secret; undefined for one that leads nowhere. */
export const bySecret = (db: Db, secret: string, now: number): Promise<Row | undefined> =>
  maybeOne(db, Row, `SELECT ${COLUMNS} FROM team_invitations WHERE secret_sha256 = $1 AND expires_at > $2`, [hashOf(secret), new Date(now)]);
/**
 * An invitation, held for the rest of the caller's transaction, which holds its team's row already (an invitation's row is
 * only ever held after its team's, as taking someone off a team deletes theirs); undefined once it's gone or run out.
 */
export const holdInvitation = (c: Db, invitationId: string, now: number): Promise<Row | undefined> =>
  maybeOne(c, Row, `SELECT ${COLUMNS} FROM team_invitations WHERE invitation_id = $1 AND expires_at > $2 FOR UPDATE`, [invitationId, new Date(now)]);
/**
 * Holds a team's row against its being changed under what's about to touch its invitations, in the caller's transaction:
 * taken before any invitation's, as a visit and taking someone off a team take its row before the rows that hang off it.
 */
export const holdTeamFor = (c: Db, teamId: string) => exec(c, 'SELECT 1 FROM teams WHERE team_id = $1 FOR KEY SHARE', [teamId]);

/**
 * What an invitation's link says to whoever opens it, signed in or not (`askedBy`): who asked, the team at a glimpse, its own
 * ID when `askedBy` is who it's to (the address they sign in with), and whether they're on its team already. Null for a link
 * that's no invitation's, or one that ended.
 */
export async function peekInvitation(d: Service, secret: string, askedBy: Owner | undefined): Promise<InvitePeek | null> {
  const r = await bySecret(d.pool, secret, Date.now());
  const seen = r && await asForYou(d, d.pool, r, false);
  if (!r || !seen) return null;
  const theirs = askedBy !== undefined && Buffer.from(await yourIndex(askedBy)).equals(Buffer.from(r.invitee_index));
  const on = askedBy === undefined ? undefined : await membership(d.pool, askedBy.ownerId);
  return { kind: 'invitation', from: seen.from, yours: on?.team_id === r.team_id, team: seen.team, invitationId: theirs ? r.invitation_id : null };
}

/** Someone joined the team: the invitation they used, if they used one, and any to the address they sign in with, are used up. */
export async function usedUp(c: Db, teamId: string, index: Uint8Array, invitationId: string | null): Promise<number> {
  const theirs = await exec(c, 'DELETE FROM team_invitations WHERE team_id = $1 AND invitee_index = $2', [teamId, index]);
  return theirs + (invitationId === null ? 0 : await exec(c, 'DELETE FROM team_invitations WHERE invitation_id = $1', [invitationId]));
}

/* ---------- upkeep ---------- */

/**
 * Upkeep for invitations: deletes those that ran out, the sends this team's limits and an address's day no longer count
 * (older than `team.invitation_seconds`, or a day), what accounts made before yesterday, and the one-time links to a team
 * the release before this one made (`team_invites`, which nothing here reads) once they've run out, as it can still make
 * them while a deploy rolls. Counts only.
 */
export async function upkeep(d: Service): Promise<{ invitations: number; sends: number; days: number; oneTime: number }> {
  const now = Date.now();
  const l = await limitsNow(d);
  const invitations = await exec(d.pool, 'DELETE FROM team_invitations WHERE expires_at <= $1', [new Date(now)]);
  const sends = await pruneSends(d, now - Math.max(l.get('team.invitation_seconds') * 1000, DAY_MS));
  const days = await exec(d.pool, 'DELETE FROM team_invitation_days WHERE day < $1', [today(now - DAY_MS)]);
  const oneTime = await exec(d.pool, 'DELETE FROM team_invites WHERE expires_at <= $1', [new Date(now)]);
  return { invitations, sends, days, oneTime };
}
