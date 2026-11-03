/*
 * Encrypted items and immutable revisions (docs: data-and-storage › Manifests; privacy-keys-and-sessions › Records
 * representation). Each revision gets a fresh random Krecord, wrapped under Kwrap with the
 * revision as its scope; the manifest record binds owner, item and revision in its header.
 */
import { z } from 'zod';
import type { Db } from './db';
import { exec, maybeOne, rows, timestamp, bytea } from './db';
import { id128, openJson, openKey, random, sealJson, sealKey, toJson, type RecordHeader } from './crypto';
import { conflict, notFound } from './errors';
import type { Owner } from './context';

export type ItemKind = 'profile' | 'meeting' | 'note';

const header = (o: Owner, itemId: string, revisionId: string): RecordHeader =>
  ({ v: 1, kind: 'manifest', ownerId: o.ownerId, itemId, revisionId, recordId: revisionId, keyVersion: '1' });

function sealManifest(o: Owner, itemId: string, revisionId: string, manifest: unknown) {
  const k = random(32);
  const envelope = sealKey(o.wrapKey, o.ownerId, `revision:${revisionId}`, k);
  const ct = sealJson(k, header(o, itemId, revisionId), toJson(manifest));
  k.fill(0);
  return { envelope, ct };
}

/** Creates an item and its first revision in the caller's transaction. */
export async function createItem(o: Owner, db: Db, kind: ItemKind, manifest: unknown): Promise<{ itemId: string; revisionId: string }> {
  const itemId = id128(); const revisionId = id128();
  const { envelope, ct } = sealManifest(o, itemId, revisionId, manifest);
  await exec(db, `INSERT INTO items (owner_id, item_id, kind, current_revision_id, version) VALUES ($1,$2,$3,$4,0)`, [o.ownerId, itemId, kind, revisionId]);
  await exec(db, `INSERT INTO revisions (owner_id, item_id, revision_id, parent_revision_id, key_envelope, manifest_ciphertext, created_at)
                  VALUES ($1,$2,$3,NULL,$4,$5,now())`, [o.ownerId, itemId, revisionId, envelope, ct]);
  return { itemId, revisionId };
}

/** Writes a full new revision if the head is still `expectedRevisionId` (compare-and-set). */
export async function saveRevision(o: Owner, db: Db, itemId: string, expectedRevisionId: string, manifest: unknown): Promise<string> {
  const revisionId = id128();
  const { envelope, ct } = sealManifest(o, itemId, revisionId, manifest);
  await exec(db, `INSERT INTO revisions (owner_id, item_id, revision_id, parent_revision_id, key_envelope, manifest_ciphertext, created_at)
                  VALUES ($1,$2,$3,$4,$5,$6,now())`, [o.ownerId, itemId, revisionId, expectedRevisionId, envelope, ct]);
  const n = await exec(db, `UPDATE items SET current_revision_id = $3, version = version + 1
                            WHERE owner_id = $1 AND item_id = $2 AND current_revision_id = $4 AND deleted_at IS NULL`, [o.ownerId, itemId, revisionId, expectedRevisionId]);
  if (n !== 1) throw conflict('That changed somewhere else. Reload and try again.');
  return revisionId;
}

const HeadRow = z.object({ item_id: z.string(), revision_id: z.string(), key_envelope: bytea, manifest_ciphertext: bytea, created_at: timestamp, first_at: timestamp });
export interface Loaded<T> { itemId: string; revisionId: string; manifest: T; updatedAt: Date; createdAt: Date }

const HEAD_SQL = `SELECT i.item_id, r.revision_id, r.key_envelope, r.manifest_ciphertext, r.created_at,
                    (SELECT min(f.created_at) FROM revisions f WHERE f.owner_id = i.owner_id AND f.item_id = i.item_id) AS first_at
                  FROM items i JOIN revisions r ON r.owner_id = i.owner_id AND r.revision_id = i.current_revision_id
                  WHERE i.owner_id = $1 AND i.kind = $2 AND i.deleted_at IS NULL`;

function decode<S extends z.ZodType>(o: Owner, r: z.infer<typeof HeadRow>, schema: S): Loaded<z.infer<S>> {
  const k = openKey(o.wrapKey, o.ownerId, `revision:${r.revision_id}`, r.key_envelope);
  const manifest = openJson(k, header(o, r.item_id, r.revision_id), r.manifest_ciphertext, schema);
  k.fill(0);
  return { itemId: r.item_id, revisionId: r.revision_id, manifest, updatedAt: r.created_at, createdAt: r.first_at };
}

/** Every live item of a kind, decrypted. Bounded by the vault's 500-item limit. */
export async function listItems<S extends z.ZodType>(o: Owner, db: Db, kind: ItemKind, schema: S): Promise<Loaded<z.infer<S>>[]> {
  return (await rows(db, HeadRow, HEAD_SQL, [o.ownerId, kind])).map((r) => decode(o, r, schema));
}
export async function getItem<S extends z.ZodType>(o: Owner, db: Db, kind: ItemKind, itemId: string, schema: S, what: string): Promise<Loaded<z.infer<S>>> {
  const r = await maybeOne(db, HeadRow, `${HEAD_SQL} AND i.item_id = $3`, [o.ownerId, kind, itemId]);
  if (!r) throw notFound(what);
  return decode(o, r, schema);
}
/** Locks the item row for the rest of the transaction, so concurrent writers queue. */
export async function lockItem(o: Owner, db: Db, itemId: string): Promise<void> {
  await exec(db, 'SELECT 1 FROM items WHERE owner_id = $1 AND item_id = $2 FOR UPDATE', [o.ownerId, itemId]);
}
export async function tombstone(o: Owner, db: Db, itemId: string): Promise<void> {
  await exec(db, 'UPDATE items SET deleted_at = now(), version = version + 1 WHERE owner_id = $1 AND item_id = $2 AND deleted_at IS NULL', [o.ownerId, itemId]);
}
