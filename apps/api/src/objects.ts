/* O01: immutable ciphertext objects under random names. RustFS locally, R2 in production. */
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from './config';

export interface ObjectStore {
  put(objectId: string, bytes: Uint8Array): Promise<void>;
  get(objectId: string): Promise<Uint8Array>;
  delete(objectId: string): Promise<void>;
}

export async function createObjectStore(cfg: Pick<Config, 'OBJECTS_ENDPOINT' | 'OBJECTS_BUCKET' | 'OBJECTS_ACCESS_KEY' | 'OBJECTS_SECRET_KEY'>): Promise<ObjectStore> {
  const s3 = new S3Client({
    endpoint: cfg.OBJECTS_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: cfg.OBJECTS_ACCESS_KEY, secretAccessKey: cfg.OBJECTS_SECRET_KEY }
  });
  const Bucket = cfg.OBJECTS_BUCKET;
  try { await s3.send(new HeadBucketCommand({ Bucket })); } catch { await s3.send(new CreateBucketCommand({ Bucket })); }
  const key = (id: string) => `o/${id}`;
  return {
    async put(id, bytes) { await s3.send(new PutObjectCommand({ Bucket, Key: key(id), Body: bytes, ContentType: 'application/octet-stream' })); },
    async get(id) {
      const r = await s3.send(new GetObjectCommand({ Bucket, Key: key(id) }));
      if (!r.Body) throw new Error(`Object ${id} has no body`);
      return r.Body.transformToByteArray();
    },
    async delete(id) { await s3.send(new DeleteObjectCommand({ Bucket, Key: key(id) })); }
  };
}
