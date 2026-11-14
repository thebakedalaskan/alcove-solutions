/*
 * Invite links (docs: Privacy, keys and sessions › Invite links; Plans and usage › Team › The team's link; user-flows 10): the
 * link a Team page copies, `<web app>/invite#<secret>`, the same until it's made again. A team has one, its admin's, which
 * everyone on it copies and only the admin makes again; someone on no team at a company has their own. Whoever opens it, new
 * to Alcove or not, can join the team it leads to (./joining.ts): the team its owner admins, or, while its owner is on no team,
 * one made for them then. A member's own link leads nowhere while they're on someone else's team, nor does the link of
 * someone on no team with no company page, who has nothing to copy it from.
 *
 * The secret is worked out from its owner's root key and the link's generation (`inviteLinkSecret`), so it's the same on
 * every ask until its owner makes a new link, the next generation, and it's never stored: only its SHA-256 is a column, and a
 * new link replaces it, so the old one leads nowhere. Who it's from is sealed under a key worked out from the secret
 * (`inviteLinkKey`), so whoever holds the link, or its owner, can open it. The link goes with its owner's account. The routes
 * keep no receipt (http/receipts.ts): their answer or body holds a secret.
 */
import type { InviteLink, InvitePeek, Person } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../../platform/context';
import { inviteLinkKey, inviteLinkSecret, jcs, openJson, sealJson, sha, toJson, utf8 } from '../../../keys/crypto';
import { bytea, exec, maybeOne, tx, type Db } from '../../../platform/db';
import { ForbiddenError, NotFoundError } from '../../../platform/errors';
import { log } from '../../../platform/log';
import { findOwner, lockOwner } from '../../../keys/owners';
import { hasCompany } from '../../profile/companies';
import { photoUrl } from '../../profile/photos';
import { personOf } from '../../profile/portraits';
import { profile, type Profile } from '../../profile/profile';
import { glimpseOf, membership, teamRow, withTeam, type Service } from './team-records';

const ilog = log.child({ component: 'invite-links' });

/** Who a link is from: their name, address and photo, as their profile has them. */
const From = z.object({ name: z.string(), email: z.string(), photoUrl: z.string().optional() });
export type From = z.infer<typeof From>;
const fromOf = (p: Profile): From => ({ name: p.name, email: p.email, ...(p.photoUrl ? { photoUrl: p.photoUrl } : {}) });
/**
 * Someone a link keeps, as anyone else is shown: known by their address, never by their account's ID, with their photo
 * through Alcove (features/profile/photos.ts) when they have one.
 */
export function personFrom(d: Pick<Deps, 'cfg'>, s: From): Person {
  const photo = photoUrl(d, s.photoUrl);
  return { ...personOf(s.email, s.name), ...(photo ? { photoUrl: photo } : {}) };
}

const fromHeader = (ownerId: string, generation: number) => ({ v: 1 as const, kind: 'invite-link-from', ownerId, generation });
const hashOf = (secret: string) => sha(utf8(secret));
const linkOf = (o: Owner, generation: number) => `${o.cfg.WEB_ORIGIN}/invite#${inviteLinkSecret(o.root, o.ownerId, generation)}`;

const LinkRow = z.object({ owner_id: z.string(), generation: z.number(), from_ciphertext: bytea });
type LinkRow = z.infer<typeof LinkRow>;
const LINK = 'owner_id, generation, from_ciphertext';

const noLink = (ownerId: string) =>
  new ForbiddenError('Only someone at a company, or on a team, has an invite link. Start a team to have one.', { context: { ownerId }, level: 'info' });

/** Who the link of this generation is from, sealed under its key, and the hash its row is found by. */
function sealedFrom(o: Owner, generation: number, from: From): { hash: Uint8Array; sealed: Uint8Array } {
  const secret = inviteLinkSecret(o.root, o.ownerId, generation);
  const key = inviteLinkKey(secret);
  try { return { hash: hashOf(secret), sealed: sealJson(key, fromHeader(o.ownerId, generation), toJson(from)) }; }
  finally { key.fill(0); }
}
/** Whether a link's row says it's from someone as they are now. */
function saysNow(o: Owner, row: LinkRow, from: From): boolean {
  const key = inviteLinkKey(inviteLinkSecret(o.root, o.ownerId, row.generation));
  try { return jcs(toJson(openJson(key, fromHeader(o.ownerId, row.generation), row.from_ciphertext, From))) === jcs(toJson(from)); }
  finally { key.fill(0); }
}

/**
 * Keeps `o`'s link as `generationAfter` says from the generation there now (null: none yet), sealed from them as they are now,
 * with their account held: asking for it, making a new one and a sign-in that changed them take turns. `onlyKept`: change a
 * link that's there, and make none. Says which generation it is now (null: none).
 */
async function keep(o: Owner, from: From, generationAfter: (was: number | null) => number, onlyKept = false): Promise<number | null> {
  return tx(o.pool, async (c) => {
    await lockOwner(o, c);
    const was = await maybeOne(c, z.object({ generation: z.number() }), 'SELECT generation FROM invite_links WHERE owner_id = $1', [o.ownerId]);
    if (!was && onlyKept) return null;
    const generation = generationAfter(was?.generation ?? null);
    const { hash, sealed } = sealedFrom(o, generation, from);
    await exec(c, `INSERT INTO invite_links (owner_id, secret_sha256, generation, from_ciphertext) VALUES ($1,$2,$3,$4)
      ON CONFLICT (owner_id) DO UPDATE SET secret_sha256 = excluded.secret_sha256, generation = excluded.generation, from_ciphertext = excluded.from_ciphertext, updated_at = now()`,
    [o.ownerId, hash, generation, sealed]);
    return generation;
  });
}

/**
 * `o`'s own link, made the first time it's asked for. Asking keeps who it's from as their profile has them now, so a new name
 * or photo shows on the link's page from then on; opening the Team page again and again writes nothing.
 */
async function ownLink(o: Owner): Promise<string> {
  const from = fromOf(await profile(o));
  const kept = await maybeOne(o.pool, LinkRow, `SELECT ${LINK} FROM invite_links WHERE owner_id = $1`, [o.ownerId]);
  let generation = kept?.generation ?? 0;
  if (!kept || !saysNow(o, kept, from)) {
    generation = await keep(o, from, (was) => was ?? 0) ?? 0;
    ilog.info(kept ? 'invite link updated' : 'invite link made', { ownerId: o.ownerId, generation });
  }
  return linkOf(o, generation);
}

/**
 * The link the caller's Team page copies: on a team, the team's, its admin's, for everyone on it; on none, their own, at a
 * company. Someone on no team at a personal address has none.
 */
export async function linkFor(o: Owner): Promise<InviteLink> {
  const m = await membership(o.pool, o.ownerId);
  if (m && m.role === 'member') {
    const t = await teamRow(o.pool, m.team_id);
    const admin = t && await findOwner(o, t.admin_owner_id, undefined);
    if (!admin) throw new NotFoundError('You’re not on a team.', { context: { ownerId: o.ownerId } });
    try { return { link: await ownLink(admin) }; } finally { admin.root.fill(0); admin.wrapKey.fill(0); }
  }
  if (!m && !hasCompany((await profile(o)).email)) throw noLink(o.ownerId);
  return { link: await ownLink(o) };
}

/**
 * A new link in place of the caller's: the one sent before leads nowhere from now on. On a team only its admin makes one, as
 * it's everyone's; on no team, someone at a company.
 */
export async function renew(o: Owner): Promise<InviteLink> {
  const m = await membership(o.pool, o.ownerId);
  if (m && m.role === 'member') throw new ForbiddenError('Only the team’s admin can make a new link: it’s everyone’s on the team.', { context: { ownerId: o.ownerId, teamId: m.team_id } });
  const p = await profile(o);
  if (!m && !hasCompany(p.email)) throw noLink(o.ownerId);
  const generation = await keep(o, fromOf(p), (was) => (was === null ? 0 : was + 1)) ?? 0;
  ilog.info('invite link made again', { ownerId: o.ownerId, generation });
  return { link: linkOf(o, generation) };
}

/**
 * Makes `o`'s link again, in the caller's transaction, which holds their account: the next generation, so the one sent before
 * leads nowhere. On a team it's the team's link, its admin's, so this is what taking someone off it, deleting it, and its
 * admin deleting it to join another team do, in their transactions: a link someone taken off the team copied, or a deleted
 * team's, leads nowhere from then on, even to a team made for its owner. Nothing for an account that never asked for one.
 */
export async function remadeIn(o: Owner, c: Db, why: 'removed' | 'deleted'): Promise<void> {
  const was = await maybeOne(c, z.object({ generation: z.number() }), 'SELECT generation FROM invite_links WHERE owner_id = $1 FOR UPDATE', [o.ownerId]);
  if (!was) return;
  const generation = was.generation + 1;
  const { hash, sealed } = sealedFrom(o, generation, fromOf(await profile(o, c)));
  await exec(c, 'UPDATE invite_links SET secret_sha256 = $2, generation = $3, from_ciphertext = $4, updated_at = now() WHERE owner_id = $1', [o.ownerId, hash, generation, sealed]);
  ilog.info('invite link made again', { ownerId: o.ownerId, generation, why });
}

/**
 * A sign-in brought a new name, address or photo: the link's page shows its sender as they are now, without their asking for
 * the link again, so nobody opening it sees an address they've left. Nothing for an account that hasn't asked for one.
 */
export async function senderChanged(o: Owner): Promise<void> {
  const kept = await maybeOne(o.pool, LinkRow, `SELECT ${LINK} FROM invite_links WHERE owner_id = $1`, [o.ownerId]);
  const from = fromOf(await profile(o));
  if (!kept || saysNow(o, kept, from)) return;
  const generation = await keep(o, from, (was) => was ?? 0, true);
  if (generation !== null) ilog.info('invite link updated', { ownerId: o.ownerId, generation });
}

/**
 * Where a link leads, by its secret: whose it is, who it's from as it says, and the team joining from it puts you on (null:
 * its owner is on no team, so joining makes theirs). Null for one that leads nowhere: never made, made again since, its owner
 * gone, a member's own link while they're on someone else's team, or the link of someone with neither a team nor a company
 * page. `lock` holds the link as it is for the rest of the caller's transaction.
 */
export async function leadOf(db: Db, secret: string, lock = false): Promise<{ ownerId: string; from: From; teamId: string | null } | null> {
  const r = await maybeOne(db, LinkRow, `SELECT ${LINK} FROM invite_links WHERE secret_sha256 = $1${lock ? ' FOR KEY SHARE' : ''}`, [hashOf(secret)]);
  if (!r) return null;
  const key = inviteLinkKey(secret);
  let from: From;
  try { from = openJson(key, fromHeader(r.owner_id, r.generation), r.from_ciphertext, From); } finally { key.fill(0); }
  const m = await membership(db, r.owner_id);
  if (m) return m.role === 'admin' ? { ownerId: r.owner_id, from, teamId: m.team_id } : null;
  return hasCompany(from.email) ? { ownerId: r.owner_id, from, teamId: null } : null;
}

/**
 * What a link says to whoever opens it, signed in or not: who it's from, the team it joins at a glimpse (null: one made for
 * its owner as someone joins), and whether it's `askedBy`'s own or their team's. Null for one that leads nowhere.
 */
export async function peekLink(d: Service, secret: string, askedBy: string | undefined): Promise<InvitePeek | null> {
  const lead = await leadOf(d.pool, secret);
  if (!lead) return null;
  const t = lead.teamId === null ? undefined : await teamRow(d.pool, lead.teamId);
  const team = t ? await withTeam(d, t, (k) => glimpseOf(d.pool, k, t, lead.ownerId)) : null;
  const mine = askedBy === undefined ? undefined : await membership(d.pool, askedBy);
  const yours = askedBy === lead.ownerId || (lead.teamId !== null && mine?.team_id === lead.teamId);
  return { kind: 'link', from: personFrom(d, lead.from), yours, team, invitationId: null };
}
