/*
 * Links to a call's notes (docs: Privacy, keys and sessions › Who can read a note). Anyone who has a call's notes can make
 * one once the call has ended. A link reads nothing by itself: opened by someone signed in, it gives that account the
 * notes, as shared by whoever made the link, the way sharing by address does (a note_access row, and the note's sealed
 * list of who it was shared with, saying it was a link). So every reader is still an account the note lists, and the
 * same rule as letting someone in from a call's link decides which accounts the notes may go to.
 *
 * The link's secret travels only in its fragment, which browsers never send, and then in a POST body: only its SHA-256 is
 * stored. Who made it and when are sealed under the note's organizer's keys (record kind `note-link`, bound to the note
 * and the link). A link runs out after NOTE_LINK_DAYS, its maker or the organizer can revoke it, and it stops working once
 * its maker no longer has the notes. It's deleted when it's revoked, once it's run out (upkeep), when its maker removes
 * the note from theirs or deletes their account (found by a keyed hash of the maker, opening nothing), and with the note.
 */
import { MAX_NOTE_LINKS, NOTE_LINK_DAYS, type NewNoteLink, type NoteLink, type NoteLinkClaimed, type Person } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, blindIndex, id128, openJson, random, sealJson, sha, stateKey, toJson, utf8 } from '../../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, notFound } from '../../errors';
import { log } from '../../log';
import { findOwner, masterKey } from '../../owners';
import { lockItem } from '../../vault';
import { me, profile } from '../account/account';
import { personOf } from '../account/portraits';
import { notesCanGo } from '../meetings/access';
import { giveByLink, holdAccess, locate, type Located } from './service';

const llog = log.child({ component: 'note-links' });

/** Who made a link, as they were then (their account's ID says who may revoke it), and when. */
const Made = z.object({ by: z.object({ id: z.string(), name: z.string(), email: z.string() }), at: z.string() });
type Made = z.infer<typeof Made>;
const Row = z.object({ owner_id: z.string(), note_item_id: z.string(), link_id: z.string(), expires_at: timestamp, body_ciphertext: bytea });
type Row = z.infer<typeof Row>;
const COLUMNS = 'owner_id, note_item_id, link_id, expires_at, body_ciphertext';

const key = (owner: Owner, noteId: string) => stateKey(owner.root, owner.ownerId, `note-links:${noteId}`);
const header = (owner: Owner, noteId: string, linkId: string) => ({ v: 1 as const, kind: 'note-link', ownerId: owner.ownerId, noteId, linkId });
const opened = (owner: Owner, r: Row): Made => openJson(key(owner, r.note_item_id), header(owner, r.note_item_id, r.link_id), r.body_ciphertext, Made);
const hashOf = (secret: string) => sha(utf8(secret));
/** Finds every link an account made, on anyone's notes, without opening any of them. */
const makerIndex = (o: Owner) => blindIndex(masterKey(o), 'note-link-maker', o.ownerId);

/** The same answer for a link that's run out, been revoked, or never was: it says nothing about which. */
const gone = (context: Record<string, string | number | boolean>) => new NotFoundError('This link has run out or been revoked. Ask whoever sent it for a new one.', { context });

/** A note's links that still work, as `readerId` sees them: whoever made each, the organizer as they are now. */
async function linksOf(l: Located, readerId: string, db: Db = l.owner.pool): Promise<NoteLink[]> {
  const found = await rows(db, Row, `SELECT ${COLUMNS} FROM note_links WHERE owner_id = $1 AND note_item_id = $2 AND expires_at > now() ORDER BY expires_at DESC, link_id`, [l.owner.ownerId, l.note.itemId]);
  if (!found.length) return [];
  const organizer = await me(l.owner);
  const person = (by: Made['by']): Person => (by.id === organizer.id ? organizer : { ...personOf(by.email, by.name), id: by.id });
  return found.map((r) => {
    const m = opened(l.owner, r);
    return { id: r.link_id, by: person(m.by), at: m.at, expiresAt: r.expires_at.toISOString(), revocable: l.mine || m.by.id === readerId };
  });
}

/** The links to a note that still work, for anyone who has it. */
export async function list(o: Owner, noteId: string): Promise<NoteLink[]> {
  return linksOf(await locate(o, noteId), o.ownerId);
}

/**
 * Makes a link to a note, once its call has ended: anyone who has the notes can, as sharing them on by address. The secret
 * is said once, in the answer, and only its hash is kept.
 */
export async function create(o: Owner, noteId: string): Promise<NewNoteLink> {
  const l = await locate(o, noteId);
  const ctx = { noteId };
  if (l.note.manifest.status === 'recording') throw new ValidationError('These notes can be shared once the call ends.', { context: ctx });
  const who = await profile(o);
  const secret = b64u(random(16));
  const linkId = id128();
  const made: Made = { by: { id: o.ownerId, name: who.name, email: who.email }, at: new Date().toISOString() };
  const expires = new Date(Date.parse(made.at) + NOTE_LINK_DAYS * 86_400_000);
  await tx(l.owner.pool, async (c) => {
    await lockItem(l.owner, c, noteId);
    // Removing the note from theirs waits for this, then takes the links they made with it.
    await holdAccess(o, l, c);
    const n = await maybeOne(c, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM note_links WHERE owner_id = $1 AND note_item_id = $2 AND expires_at > now()', [l.owner.ownerId, noteId]);
    if ((n?.n ?? 0) >= MAX_NOTE_LINKS) throw new ConflictError('These notes have as many links as they can. Revoke one to make another.', { context: ctx });
    await exec(c, 'INSERT INTO note_links (owner_id, note_item_id, link_id, secret_hash, maker_index, expires_at, body_ciphertext) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [l.owner.ownerId, noteId, linkId, hashOf(secret), makerIndex(o), expires, sealJson(key(l.owner, noteId), header(l.owner, noteId, linkId), toJson(made))]);
  });
  llog.info('note link made', { ...ctx, linkId, mine: l.mine, days: NOTE_LINK_DAYS });
  const by: Person = l.mine ? await me(l.owner) : { ...personOf(who.email, who.name), id: o.ownerId };
  return { link: { id: linkId, by, at: made.at, expiresAt: expires.toISOString(), revocable: true }, secret };
}

/** Revokes a link, so it opens nothing from now on: whoever made it can, and so can the organizer. Whoever it gave the notes to keeps them. */
export async function revoke(o: Owner, noteId: string, linkId: string): Promise<NoteLink[]> {
  const l = await locate(o, noteId);
  const ctx = { noteId, linkId };
  await tx(l.owner.pool, async (c) => {
    await lockItem(l.owner, c, noteId);
    const r = await maybeOne(c, Row, `SELECT ${COLUMNS} FROM note_links WHERE owner_id = $1 AND note_item_id = $2 AND link_id = $3 FOR UPDATE`, [l.owner.ownerId, noteId, linkId]);
    if (!r) throw notFound('That link', ctx);
    if (!l.mine && opened(l.owner, r).by.id !== o.ownerId) throw new ForbiddenError('Only whoever made a link, or the organizer, can revoke it.', { context: ctx });
    await exec(c, 'DELETE FROM note_links WHERE owner_id = $1 AND note_item_id = $2 AND link_id = $3', [l.owner.ownerId, noteId, linkId]);
  });
  llog.info('note link revoked', { ...ctx, mine: l.mine });
  return linksOf(l, o.ownerId);
}

/**
 * Opens a link for the account signed in: its notes join theirs, as shared by whoever made the link. A link that's run
 * out, been revoked or whose maker no longer has the notes opens nothing, and says so the same way as one that never
 * was. The notes go only to an account they may go to: a real one, or any when the organizer's own is a demo one. The
 * organizer, and anyone who has the notes already, are just told which they are.
 */
export async function claim(o: Owner, secret: string): Promise<NoteLinkClaimed> {
  const r = await maybeOne(o.pool, Row, `SELECT ${COLUMNS} FROM note_links WHERE secret_hash = $1 AND expires_at > now()`, [hashOf(secret)]);
  if (!r) throw gone({ reason: 'no-link' });
  const owner = await findOwner(o, r.owner_id, undefined);
  if (!owner) throw gone({ reason: 'no-organizer' });
  const noteId = r.note_item_id;
  const ctx = { noteId, linkId: r.link_id };
  try {
    if (owner.ownerId === o.ownerId) return { noteId };
    const [reader, organizer] = await Promise.all([profile(o), profile(owner)]);
    if (!notesCanGo(reader, organizer)) throw new ForbiddenError('These notes go only to an account signed in with Google. Sign in with Google to open them.', { context: { ...ctx, reason: 'demo-account' } });
    const made = opened(owner, r);
    const added = await tx(owner.pool, async (c) => {
      await lockItem(owner, c, noteId);
      // Still working, read holding the note: one revoked or run out meanwhile gives nothing.
      const still = await maybeOne(c, z.object({ n: z.number() }), 'SELECT 1 AS n FROM note_links WHERE owner_id = $1 AND note_item_id = $2 AND link_id = $3 AND expires_at > now() FOR KEY SHARE', [owner.ownerId, noteId, r.link_id]);
      if (!still) throw gone({ ...ctx, reason: 'gone-meanwhile' });
      // A link hands on only what its maker has: once they don't, it stops.
      const maker = made.by.id === owner.ownerId || !!(await maybeOne(c, z.object({ n: z.number() }), `SELECT 1 AS n FROM note_access a JOIN identities i ON i.email_index = a.email_index
        WHERE a.owner_id = $1 AND a.note_item_id = $2 AND i.owner_id = $3 LIMIT 1`, [owner.ownerId, noteId, made.by.id]));
      if (!maker) throw gone({ ...ctx, reason: 'maker-gone' });
      return giveByLink(owner, c, noteId, reader.email, organizer.email, made.by, new Date().toISOString());
    });
    llog.info('note link opened', { ...ctx, added });
    return { noteId };
  } finally { owner.root.fill(0); owner.wrapKey.fill(0); }
}

/** Takes the links someone made to a note out, when they remove it from theirs, in that transaction. Opens nothing. */
export const forgetMade = (o: Owner, db: Db, noteOwnerId: string, noteId: string) =>
  exec(db, 'DELETE FROM note_links WHERE owner_id = $1 AND note_item_id = $2 AND maker_index = $3', [noteOwnerId, noteId, makerIndex(o)]);

/** Takes every link an account made out of everyone's notes, in the transaction that deletes it. Opens nothing. */
export const forgetAllMade = (o: Owner, db: Db) => exec(db, 'DELETE FROM note_links WHERE maker_index = $1', [makerIndex(o)]);

/** Links that have run out are deleted (upkeep). */
export function sweep(d: Deps): Promise<number> {
  return exec(d.pool, 'DELETE FROM note_links WHERE expires_at <= now()');
}
