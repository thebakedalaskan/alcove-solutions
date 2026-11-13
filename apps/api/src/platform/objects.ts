/* O01: immutable ciphertext objects under random names. RustFS locally, R2 in production. */
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { errorMessage } from '@alcove/api';
import { z } from 'zod';
import type { Config } from './config';
import type { Owner } from './context';
import { exec, rows } from './db';
import { ObjectStoreError } from './errors';
import { log } from './log';

const olog = log.child({ component: 'objects' });
/** Times one object-store call and wraps its failure with the operation and object ID (IDs are random). */
async function call<T>(op: string, objectId: string | undefined, fn: () => Promise<T>, size?: number): Promise<T> {
  const t0 = performance.now();
  try {
    const out = await fn();
    const ms = Math.round(performance.now() - t0);
    const bytes = size ?? (out instanceof Uint8Array ? out.length : undefined);
    if (ms > 1000) olog.warn(`slow object ${op}`, { objectId, ms, bytes }); else if (olog.isDebug()) olog.debug(`object ${op}`, { objectId, ms, bytes });
    return out;
  } catch (e) {
    throw new ObjectStoreError(undefined, { cause: e, context: { op, objectId, ms: Math.round(performance.now() - t0) } });
  }
}

export interface ObjectStore {
  put(objectId: string, bytes: Uint8Array): Promise<void>;
  get(objectId: string): Promise<Uint8Array>;
  delete(objectId: string): Promise<void>;
  /** Every stored object with its upload time, for garbage collection. */
  list(): AsyncGenerator<{ id: string; lastModified: Date }>;
}

export async function createObjectStore(cfg: Pick<Config, 'OBJECTS_ENDPOINT' | 'OBJECTS_BUCKET' | 'OBJECTS_ACCESS_KEY' | 'OBJECTS_SECRET_KEY'>): Promise<ObjectStore> {
  const s3 = new S3Client({
    endpoint: cfg.OBJECTS_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: cfg.OBJECTS_ACCESS_KEY, secretAccessKey: cfg.OBJECTS_SECRET_KEY },
    // Checksums only where S3 requires one: Google Cloud Storage's S3 interoperability (staging) refuses the SDK's default
    // CRC32 trailers, and R2 and RustFS take either way.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED'
  });
  const Bucket = cfg.OBJECTS_BUCKET;
  try { await s3.send(new HeadBucketCommand({ Bucket })); } catch {
    olog.info('creating bucket', { bucket: Bucket });
    await call('create-bucket', undefined, () => s3.send(new CreateBucketCommand({ Bucket })));
  }
  const key = (id: string) => `o/${id}`;
  return {
    async put(id, bytes) { await call('put', id, () => s3.send(new PutObjectCommand({ Bucket, Key: key(id), Body: bytes, ContentType: 'application/octet-stream' })), bytes.length); },
    get: (id) => call('get', id, async () => {
      const r = await s3.send(new GetObjectCommand({ Bucket, Key: key(id) }));
      if (!r.Body) throw new ObjectStoreError('Stored object has no body.', { context: { objectId: id } });
      return r.Body.transformToByteArray();
    }),
    async delete(id) { await call('delete', id, () => s3.send(new DeleteObjectCommand({ Bucket, Key: key(id) }))); },
    async *list() {
      let token: string | undefined;
      do {
        const page = token;
        const r = await call('list', undefined, () => s3.send(new ListObjectsV2Command({ Bucket, Prefix: 'o/', ...(page ? { ContinuationToken: page } : {}) })));
        for (const o of r.Contents ?? []) if (o.Key && o.LastModified) yield { id: o.Key.slice(2), lastModified: o.LastModified };
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
    }
  };
}

/* ---------- deleting, and what the store refuses (object_gc) ---------- */

/** Object deletes log under the component they always have, wherever they're asked for, so a search for them finds them all. */
const alog = log.child({ component: 'audio' });

/** Deletes objects now; anything that fails is queued for the maintenance loop to retry. */
export async function queueDelete(o: Pick<Owner, 'pool' | 'objects' | 'ownerId'>, objectIds: string[]): Promise<void> {
  await Promise.all(objectIds.map(async (id) => {
    try { await o.objects.delete(id); } catch (e) {
      alog.warn('object delete failed; queued for retry', { objectId: id, err: e });
      await exec(o.pool, 'INSERT INTO object_gc (object_id, owner_id, last_error) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, o.ownerId, errorMessage(e).slice(0, 200)]);
    }
  }));
}

/** Objects queued at most this many at a time: upkeep comes back every few minutes for the rest. */
const QUEUE_BATCH = 500;
/** How many deletes go to the object store at once. */
const QUEUE_AT_ONCE = 25;
/**
 * Deletes what's queued in object_gc, the oldest first: everything, or for upkeep, or only these owners', straight after
 * the commit that queued it, so something deleted goes now rather than at the next run. What the store refuses stays
 * queued, with why. Returns how many went.
 */
export async function deleteQueued(d: Pick<Owner, 'pool' | 'objects'>, ownerIds?: string[] | undefined): Promise<number> {
  const due = await rows(d.pool, z.object({ object_id: z.string() }), `SELECT object_id FROM object_gc${ownerIds ? ' WHERE owner_id = ANY($2::text[])' : ''} ORDER BY queued_at LIMIT $1`, [QUEUE_BATCH, ...(ownerIds ? [ownerIds] : [])]);
  let deleted = 0;
  for (let i = 0; i < due.length; i += QUEUE_AT_ONCE) {
    await Promise.all(due.slice(i, i + QUEUE_AT_ONCE).map(async (g) => {
      try {
        await d.objects.delete(g.object_id);
        await exec(d.pool, 'DELETE FROM object_gc WHERE object_id = $1', [g.object_id]);
        deleted++;
      } catch (e) {
        alog.warn('object delete failed; it stays queued', { objectId: g.object_id, err: e });
        await exec(d.pool, 'UPDATE object_gc SET attempts = attempts + 1, last_error = $2 WHERE object_id = $1', [g.object_id, errorMessage(e).slice(0, 200)]);
      }
    }));
  }
  return deleted;
}
