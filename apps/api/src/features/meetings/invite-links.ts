/*
 * Your own invite link (docs: Privacy, keys and sessions › Invite links; user-flows 10): the link a company's Team page copies
 * and its invitations carry, `<web app>/invite#<secret>`. Its page says who it's from, and once someone's account is made
 * from it, the Team page says they joined.
 *
 * The secret is worked out from the account's root key (`inviteLinkSecret`), so it's the same on every ask and never stored:
 * only its SHA-256 is a column. Who it's from, and who joined from it, are sealed under a key worked out from the secret
 * (`inviteLinkKey`), so only someone holding the link, or its owner, can open them. A joiner's row is found by a keyed hash of
 * their account (`invite-joiner`), opening nothing, so deleting that account takes it; the link's own row goes with its
 * owner's account, and its joins with it. The routes keep no receipt (http/receipts.ts): their answer or body holds the secret.
 */
import type { InviteJoined, InviteLink, InvitePeek, Person } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../platform/context';
import { b64u, blindIndex, inviteLinkKey, inviteLinkSecret, jcs, openJson, sealJson, sha, toJson, utf8 } from '../../keys/crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../platform/db';
import { ForbiddenError, NotFoundError } from '../../platform/errors';
import { log } from '../../platform/log';
import { indexKey } from '../../keys/owners';
import { photoUrl } from '../profile/photos';
import { personOf } from '../profile/portraits';
import { profile, type Profile } from '../profile/profile';
import { hasCompany } from './people';

const ilog = log.child({ component: 'invite-links' });

/** How long after an account is made it can say it came from someone's link: its first sign-in, and the arrival after it. */
const NEW_FOR_SECONDS = 3600;

/** Someone as a link keeps them: their name, address and photo, as their profile had them then. */
const Someone = z.object({ name: z.string(), email: z.string(), photoUrl: z.string().optional() });
type Someone = z.infer<typeof Someone>;
const someoneIn = (p: Profile): Someone => ({ name: p.name, email: p.email, ...(p.photoUrl ? { photoUrl: p.photoUrl } : {}) });
/**
 * Someone a link keeps, as anyone else is shown: known by their address, never by their account's ID, with their photo
 * through Alcove (features/profile/photos.ts) when they have one.
 */
function personFrom(d: Deps, s: Someone): Person {
  const photo = photoUrl(d, s.photoUrl);
  return { ...personOf(s.email, s.name), ...(photo ? { photoUrl: photo } : {}) };
}

const fromHeader = (ownerId: string) => ({ v: 1 as const, kind: 'invite-link-from', ownerId });
const joinHeader = (ownerId: string, joiner: Uint8Array) => ({ v: 1 as const, kind: 'invite-link-join', ownerId, joiner: b64u(joiner) });
const hashOf = (secret: string) => sha(utf8(secret));
/** Finds every join an account said, on anyone's link, without opening any of them. */
const joinerOf = (o: Owner) => blindIndex(indexKey(o), 'invite-joiner', o.ownerId);

const LinkRow = z.object({ owner_id: z.string(), from_ciphertext: bytea });
const JoinRow = z.object({ joiner_index: bytea, who_ciphertext: bytea, joined_at: timestamp });

/** The same answer for a link that never was and one whose sender has deleted their account: it says nothing about which. */
const nowhere = (context: Record<string, string>) =>
  new NotFoundError('This invite link doesn’t lead anywhere. Ask whoever sent it to copy it again from their Team page.', { context });

/**
 * Your own invite link, and who joined Alcove from it, newest first. Asking for it keeps who it's from as your profile has
 * you now, so a new name or photo shows on the link's page from then on. Only at a company: someone at a personal address
 * has no Team page to send it from.
 */
export async function mine(o: Owner): Promise<InviteLink> {
  const p = await profile(o);
  if (!hasCompany(p.email)) throw new ForbiddenError('Only someone at a company has an invite link. Yours is a personal address.', { context: { ownerId: o.ownerId }, level: 'info' });
  const secret = inviteLinkSecret(o.root, o.ownerId);
  const hash = hashOf(secret);
  const key = inviteLinkKey(secret);
  try {
    const from = someoneIn(p);
    const kept = await maybeOne(o.pool, LinkRow, 'SELECT owner_id, from_ciphertext FROM invite_links WHERE secret_sha256 = $1', [hash]);
    // Written when it's new, or when who it's from has changed: opening the link page after page writes nothing.
    if (!kept || jcs(toJson(openJson(key, fromHeader(o.ownerId), kept.from_ciphertext, Someone))) !== jcs(toJson(from))) {
      await exec(o.pool, `INSERT INTO invite_links (secret_sha256, owner_id, from_ciphertext) VALUES ($1,$2,$3)
        ON CONFLICT (owner_id) DO UPDATE SET from_ciphertext = excluded.from_ciphertext, updated_at = now()`, [hash, o.ownerId, sealJson(key, fromHeader(o.ownerId), toJson(from))]);
      ilog.info(kept ? 'invite link updated' : 'invite link made', { ownerId: o.ownerId });
    }
    const joins = await rows(o.pool, JoinRow, 'SELECT joiner_index, who_ciphertext, joined_at FROM invite_link_joins WHERE secret_sha256 = $1 ORDER BY joined_at DESC, joiner_index', [hash]);
    const joined = joins.map((j): InviteJoined => ({
      person: personFrom(o, openJson(key, joinHeader(o.ownerId, j.joiner_index), j.who_ciphertext, Someone)),
      at: j.joined_at.toISOString()
    }));
    ilog.debug('invite link read', { ownerId: o.ownerId, joined: joined.length });
    return { link: `${o.cfg.WEB_ORIGIN}/invite#${secret}`, joined };
  } finally { key.fill(0); }
}

/**
 * A sign-in brought a new name, address or photo: the link's page shows its sender as they are now, without their asking for
 * the link again, so nobody opening it sees an address they've left. Nothing for an account that hasn't asked for one.
 */
export async function senderChanged(o: Owner): Promise<void> {
  const secret = inviteLinkSecret(o.root, o.ownerId);
  const key = inviteLinkKey(secret);
  try {
    const from = sealJson(key, fromHeader(o.ownerId), toJson(someoneIn(await profile(o))));
    if (await exec(o.pool, 'UPDATE invite_links SET from_ciphertext = $2, updated_at = now() WHERE secret_sha256 = $1', [hashOf(secret), from])) ilog.info('invite link updated', { ownerId: o.ownerId });
  } finally { key.fill(0); }
}

/** Who a link is from, for anyone who opens it, signed in or not. */
export async function peek(d: Deps, secret: string): Promise<InvitePeek> {
  const r = await maybeOne(d.pool, LinkRow, 'SELECT owner_id, from_ciphertext FROM invite_links WHERE secret_sha256 = $1', [hashOf(secret)]);
  if (!r) throw nowhere({ why: 'no-link' });
  const key = inviteLinkKey(secret);
  try { return { from: personFrom(d, openJson(key, fromHeader(r.owner_id), r.from_ciphertext, Someone)) }; }
  finally { key.fill(0); }
}

/** What saying you joined from a link came to: kept, or nothing (your own link, an account from before, or said already). */
export type Joined = 'joined' | 'own-link' | 'not-new' | 'said-already';

/**
 * The account signed in was made from this link: its sender sees it joined, sealed under the link's key. It counts once for
 * each link, for an account made in the last NEW_FOR_SECONDS, and never on your own link; anything else changes nothing.
 * The link and the account are held while it's written, so deleting either waits for this and then takes the row with it.
 */
export async function joined(o: Owner, secret: string): Promise<Joined> {
  const hash = hashOf(secret);
  const outcome = await tx(o.pool, async (c): Promise<Joined> => {
    const link = await maybeOne(c, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM invite_links WHERE secret_sha256 = $1 FOR KEY SHARE', [hash]);
    if (!link) throw nowhere({ ownerId: o.ownerId, why: 'no-link' });
    if (link.owner_id === o.ownerId) return 'own-link';
    const made = await maybeOne(c, z.object({ fresh: z.boolean() }), 'SELECT created_at > now() - make_interval(secs => $2) AS fresh FROM owners WHERE owner_id = $1 FOR KEY SHARE', [o.ownerId, NEW_FOR_SECONDS]);
    if (!made?.fresh) return 'not-new';
    const joiner = joinerOf(o);
    const key = inviteLinkKey(secret);
    try {
      const who = sealJson(key, joinHeader(link.owner_id, joiner), toJson(someoneIn(await profile(o, c))));
      const n = await exec(c, 'INSERT INTO invite_link_joins (secret_sha256, joiner_index, who_ciphertext) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [hash, joiner, who]);
      return n ? 'joined' : 'said-already';
    } finally { key.fill(0); }
  });
  ilog.info('joined from an invite link', { ownerId: o.ownerId, outcome });
  return outcome;
}

/** Takes every join an account said, on anyone's link, out, in the transaction that deletes it. Opens nothing. */
export const forgetJoins = (o: Owner, db: Db) => exec(db, 'DELETE FROM invite_link_joins WHERE joiner_index = $1', [joinerOf(o)]);
