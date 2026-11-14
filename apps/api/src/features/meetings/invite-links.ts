/*
 * Your own invite link (docs: Privacy, keys and sessions › Invite links; user-flows 10): the link a company's Team page copies
 * and its invitations carry, `<web app>/invite#<secret>`. Its page says who it's from, and once someone's account is made
 * from it, the Team page says they joined.
 *
 * The secret is worked out from the account's root key and the link's generation (`inviteLinkSecret`), so it's the same on
 * every ask until its owner makes a new link, the next generation, and it's never stored: only its SHA-256 is a column, and a
 * new link replaces it, so the old one leads nowhere. Who it's from is sealed under a key worked out from the secret
 * (`inviteLinkKey`), so whoever holds the link, or its owner, can open it. Who joined, and when, are sealed under the owner's
 * own keys (state key `invite-link-joins`), so the link alone opens none of them, the rows keep no time, and a new link keeps
 * the list. A joiner's row is found by a keyed hash of their account (`invite-joiner`), opening nothing: deleting that account
 * takes it, and upkeep takes any a release before this one left. The link and its joins go with their owner's account. The
 * routes keep no receipt (http/receipts.ts): their answer or body holds a secret.
 */
import type { InviteJoined, InviteLink, InvitePeek, Person } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../platform/context';
import { b64u, blindIndex, inviteLinkKey, inviteLinkSecret, jcs, openJson, sealJson, sha, stateKey, toJson, utf8 } from '../../keys/crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../../platform/db';
import { ForbiddenError, NotFoundError } from '../../platform/errors';
import { log } from '../../platform/log';
import { indexKey, lockOwner, openRootKey } from '../../keys/owners';
import { photoUrl } from '../profile/photos';
import { personOf } from '../profile/portraits';
import { profile, type Profile } from '../profile/profile';
import { hasCompany } from './people';

const ilog = log.child({ component: 'invite-links' });

/** How long after an account is made it can say it came from someone's link: its first sign-in, and the arrival after it. */
const NEW_FOR_SECONDS = 3600;

/** Who a link is from: their name, address and photo, as their profile has them. */
const From = z.object({ name: z.string(), email: z.string(), photoUrl: z.string().optional() });
type From = z.infer<typeof From>;
/** Someone who joined from a link, as they were then, and when. */
const Joiner = From.extend({ at: z.string() });
const fromOf = (p: Profile): From => ({ name: p.name, email: p.email, ...(p.photoUrl ? { photoUrl: p.photoUrl } : {}) });
/**
 * Someone a link keeps, as anyone else is shown: known by their address, never by their account's ID, with their photo
 * through Alcove (features/profile/photos.ts) when they have one.
 */
function personFrom(d: Deps, s: From): Person {
  const photo = photoUrl(d, s.photoUrl);
  return { ...personOf(s.email, s.name), ...(photo ? { photoUrl: photo } : {}) };
}

const fromHeader = (ownerId: string, generation: number) => ({ v: 1 as const, kind: 'invite-link-from', ownerId, generation });
const joinHeader = (ownerId: string, joiner: Uint8Array) => ({ v: 1 as const, kind: 'invite-link-join', ownerId, joiner: b64u(joiner) });
/** The key who joined from someone's links is sealed under: their own, never the link's. The caller zeroes it. */
const joinsKey = (root: Uint8Array, ownerId: string) => stateKey(root, ownerId, 'invite-link-joins');
const hashOf = (secret: string) => sha(utf8(secret));
/** Finds every join an account said, on anyone's link, without opening any of them. */
const joinerOf = (key: Uint8Array, ownerId: string) => blindIndex(key, 'invite-joiner', ownerId);
const linkOf = (o: Owner, generation: number) => `${o.cfg.WEB_ORIGIN}/invite#${inviteLinkSecret(o.root, o.ownerId, generation)}`;

const LinkRow = z.object({ owner_id: z.string(), generation: z.number(), from_ciphertext: bytea });
type LinkRow = z.infer<typeof LinkRow>;
const LINK = 'owner_id, generation, from_ciphertext';
const JoinRow = z.object({ joiner_index: bytea, who_ciphertext: bytea });

/** The same answer for a link that never was, one made again since, and one whose sender has gone: it says nothing about which. */
const nowhere = (context: Record<string, string>) =>
  new NotFoundError('This invite link doesn’t lead anywhere. Ask whoever sent it to copy it again from their Team page.', { context });
const noCompany = (ownerId: string) =>
  new ForbiddenError('Only someone at a company has an invite link. Yours is a personal address.', { context: { ownerId }, level: 'info' });

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
 * Keeps your link as `generationAfter` says from the generation there now (null: none yet), sealed from you as you are now,
 * with your account held: asking for it, making a new one and a sign-in that changed you take turns. `onlyKept`: change a
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

/** Who joined from your links, newest first, opened with your own keys. */
async function joinsOf(o: Owner): Promise<InviteJoined[]> {
  const found = await rows(o.pool, JoinRow, 'SELECT joiner_index, who_ciphertext FROM invite_link_joins WHERE owner_id = $1', [o.ownerId]);
  if (!found.length) return [];
  const key = joinsKey(o.root, o.ownerId);
  try {
    const joiners = found.map((j) => openJson(key, joinHeader(o.ownerId, j.joiner_index), j.who_ciphertext, Joiner));
    return joiners.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.email.localeCompare(b.email)).map((j) => ({ person: personFrom(o, j), at: j.at }));
  } finally { key.fill(0); }
}

/**
 * Your own invite link, and who joined Alcove from it, newest first. Asking for it keeps who it's from as your profile has
 * you now, so a new name or photo shows on the link's page from then on. Only at a company: someone at a personal address
 * has no Team page to send it from.
 */
export async function mine(o: Owner): Promise<InviteLink> {
  const p = await profile(o);
  if (!hasCompany(p.email)) throw noCompany(o.ownerId);
  const from = fromOf(p);
  const kept = await maybeOne(o.pool, LinkRow, `SELECT ${LINK} FROM invite_links WHERE owner_id = $1`, [o.ownerId]);
  // Written when it's new, or when who it's from has changed: opening the Team page again and again writes nothing.
  let generation = kept?.generation ?? 0;
  if (!kept || !saysNow(o, kept, from)) {
    generation = await keep(o, from, (was) => was ?? 0) ?? 0;
    ilog.info(kept ? 'invite link updated' : 'invite link made', { ownerId: o.ownerId, generation });
  }
  const joined = await joinsOf(o);
  ilog.debug('invite link read', { ownerId: o.ownerId, generation, joined: joined.length });
  return { link: linkOf(o, generation), joined };
}

/** A new link in place of yours: the one you've sent leads nowhere from now on, and everyone who joined from it stays listed. */
export async function renew(o: Owner): Promise<InviteLink> {
  const p = await profile(o);
  if (!hasCompany(p.email)) throw noCompany(o.ownerId);
  const generation = await keep(o, fromOf(p), (was) => (was === null ? 0 : was + 1)) ?? 0;
  ilog.info('invite link made again', { ownerId: o.ownerId, generation });
  return { link: linkOf(o, generation), joined: await joinsOf(o) };
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

/** Who a link is from, for anyone who opens it, signed in or not; `yours` when whoever's signed in (`askedBy`) owns it. */
export async function peek(d: Deps, secret: string, askedBy: string | undefined): Promise<InvitePeek> {
  const r = await maybeOne(d.pool, LinkRow, `SELECT ${LINK} FROM invite_links WHERE secret_sha256 = $1`, [hashOf(secret)]);
  if (!r) throw nowhere({ why: 'no-link' });
  const key = inviteLinkKey(secret);
  try { return { from: personFrom(d, openJson(key, fromHeader(r.owner_id, r.generation), r.from_ciphertext, From)), yours: askedBy === r.owner_id }; }
  finally { key.fill(0); }
}

/** What saying you joined from a link came to: kept, or nothing (your own link, an account from before, or said already). */
export type Joined = 'joined' | 'own-link' | 'not-new' | 'said-already';

/**
 * The account signed in was made from this link: its sender sees it joined, with when, sealed under the sender's keys. It
 * counts once for each sender, for an account made in the last NEW_FOR_SECONDS, and never on your own link; anything else
 * changes nothing. The sender's account is held before their link, the order deleting it takes them in, and then the joiner's,
 * so deleting either waits for this and then takes the row with it.
 */
export async function joined(o: Owner, secret: string): Promise<Joined> {
  const hash = hashOf(secret);
  const outcome = await tx(o.pool, async (c): Promise<Joined> => {
    const seen = await maybeOne(c, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM invite_links WHERE secret_sha256 = $1', [hash]);
    if (!seen) throw nowhere({ ownerId: o.ownerId, why: 'no-link' });
    if (seen.owner_id === o.ownerId) return 'own-link';
    await exec(c, 'SELECT 1 FROM owners WHERE owner_id = $1 FOR KEY SHARE', [seen.owner_id]);
    const link = await maybeOne(c, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM invite_links WHERE secret_sha256 = $1 FOR KEY SHARE', [hash]);
    // Made again, or its sender's account deleted, while it was looked at.
    if (link?.owner_id !== seen.owner_id) throw nowhere({ ownerId: o.ownerId, why: 'gone-meanwhile' });
    const made = await maybeOne(c, z.object({ fresh: z.boolean() }), 'SELECT created_at > now() - make_interval(secs => $2) AS fresh FROM owners WHERE owner_id = $1 FOR KEY SHARE', [o.ownerId, NEW_FOR_SECONDS]);
    if (!made?.fresh) return 'not-new';
    const root = await openRootKey(o, link.owner_id, c);
    if (!root) throw nowhere({ ownerId: o.ownerId, why: 'sender-gone' });
    const key = joinsKey(root, link.owner_id);
    root.fill(0);
    const index = indexKey(o);
    try {
      const joiner = joinerOf(index, o.ownerId);
      const who = sealJson(key, joinHeader(link.owner_id, joiner), toJson({ ...fromOf(await profile(o, c)), at: new Date().toISOString() }));
      const n = await exec(c, 'INSERT INTO invite_link_joins (owner_id, joiner_index, who_ciphertext) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [link.owner_id, joiner, who]);
      return n ? 'joined' : 'said-already';
    } finally { key.fill(0); index.fill(0); }
  });
  ilog.info('joined from an invite link', { ownerId: o.ownerId, outcome });
  return outcome;
}

/** Takes every join an account said, on anyone's link, out, in the transaction that deletes it. Opens nothing. */
export async function forgetJoins(o: Owner, db: Db): Promise<number> {
  const index = indexKey(o);
  try { return await exec(db, 'DELETE FROM invite_link_joins WHERE joiner_index = $1', [joinerOf(index, o.ownerId)]); }
  finally { index.fill(0); }
}

/**
 * Upkeep: joins said by accounts that are gone, which a release before this one left as it deleted them. The joins are read
 * before the accounts: a join is said only by an account that's there, so one read here belongs to an account read after it,
 * unless that account has gone. Says how many went.
 */
export async function sweepJoins(d: Pick<Deps, 'cfg' | 'pool'>): Promise<number> {
  const said = await rows(d.pool, z.object({ joiner_index: bytea }), 'SELECT DISTINCT joiner_index FROM invite_link_joins');
  if (!said.length) return 0;
  const owners = await rows(d.pool, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM owners');
  const index = indexKey(d);
  let there: Set<string>;
  try { there = new Set(owners.map((r) => b64u(joinerOf(index, r.owner_id)))); } finally { index.fill(0); }
  const gone = said.map((r) => r.joiner_index).filter((i) => !there.has(b64u(i)));
  if (!gone.length) return 0;
  const n = await exec(d.pool, 'DELETE FROM invite_link_joins WHERE joiner_index = ANY($1::bytea[])', [gone]);
  ilog.info('joins of deleted accounts swept', { joins: n });
  return n;
}
