import type { DriveFolder } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../../platform/context';
import { refreshAccess } from '../../../providers/google';
import { UnavailableError } from '../../../platform/errors';
import { reconnect, type Connection } from './state';

export class DriveFailure extends UnavailableError {
  readonly why: 'reconnect' | 'destination' | 'transient' | 'source';
  constructor(why: DriveFailure['why']) {
    const message = why === 'reconnect' ? 'Reconnect Google Drive to continue.' : why === 'destination' ? 'Choose a folder you can add files to. The previous folder is unavailable.' : why === 'source' ? 'This artifact is no longer available to export.' : 'Google Drive could not confirm the upload. It will be checked before trying again.';
    super(message, { context: { reason: why } });
    this.why = why;
  }
}
export const File = z.object({
  id: z.string(), name: z.string().default(''), mimeType: z.string().default(''), driveId: z.string().optional(),
  parents: z.array(z.string()).default([]), trashed: z.boolean().default(false), capabilities: z.object({ canAddChildren: z.boolean().default(false) }).default({ canAddChildren: false }),
  appProperties: z.record(z.string(), z.string()).default({}), webViewLink: z.string().optional()
});
export type File = z.infer<typeof File>;
export async function token(o: Owner, current: Connection): Promise<string> {
  if (!current.refreshToken || current.status === 'reconnect') throw new DriveFailure('reconnect');
  let reply: Awaited<ReturnType<typeof refreshAccess>>;
  try { reply = await refreshAccess(o, current.refreshToken); } catch { throw new DriveFailure('transient'); }
  if (reply.ok) return reply.accessToken;
  if (reply.revoked) {
    await reconnect(o, current);
    throw new DriveFailure('reconnect');
  }
  throw new DriveFailure('transient');
}
export async function request(o: Owner, access: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${o.cfg.GOOGLE_API_URL.replace(/\/$/, '')}${path}`;
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: 'manual', headers: { authorization: `Bearer ${access}`, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(8000) }); }
  catch { throw new DriveFailure('transient'); }
  // A resumable 308 without Location reports an acknowledged range. Actual redirects are never followed.
  if (response.status >= 300 && response.status < 400 && response.headers.has('location')) throw new DriveFailure('transient');
  if (response.status === 401) throw new DriveFailure('reconnect');
  return response;
}
/** Drive uses 403 for both permission refusals and rate limits. Only its safe reason codes choose the retry path. */
async function refusal(response: Response): Promise<DriveFailure> {
  if (response.status === 401) return new DriveFailure('reconnect');
  if (response.status !== 403 && response.status !== 404) return new DriveFailure('transient');
  if (response.status === 403) {
    const parsed = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string() })).default([]), status: z.string().optional() }) }).safeParse(await response.json().catch(() => null));
    const transient = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'sharingRateLimitExceeded', 'backendError']);
    if (parsed.success && (parsed.data.error.status === 'RESOURCE_EXHAUSTED' || parsed.data.error.errors.some((error) => transient.has(error.reason)))) return new DriveFailure('transient');
  }
  return new DriveFailure('destination');
}
export const FIELDS = 'id,name,mimeType,driveId,parents,trashed,capabilities(canAddChildren),appProperties,webViewLink';
export async function file(o: Owner, access: string, id: string): Promise<File | null> {
  const response = await request(o, access, `/drive/v3/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields: FIELDS, supportsAllDrives: 'true' })}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await refusal(response);
  const result = File.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new DriveFailure('transient');
  return result.data;
}
export async function folder(o: Owner, access: string, id: string): Promise<DriveFolder> {
  const found = await file(o, access, id);
  if (!found || found.trashed || found.mimeType !== 'application/vnd.google-apps.folder' || !found.capabilities.canAddChildren) throw new DriveFailure('destination');
  return { id: found.id, name: found.name, driveId: found.driveId ?? null };
}
export async function folders(o: Owner, access: string): Promise<DriveFolder[]> {
  const found: DriveFolder[] = [];
  let pageToken: string | undefined;
  do {
    const response = await request(o, access, `/drive/v3/files?${new URLSearchParams({ q: "mimeType='application/vnd.google-apps.folder' and trashed=false", spaces: 'drive', fields: `files(${FIELDS}),nextPageToken`, pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) })}`);
    if (!response.ok) throw await refusal(response);
    const parsed = z.object({ files: z.array(File), nextPageToken: z.string().optional() }).safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new DriveFailure('transient');
    found.push(...parsed.data.files.filter((x) => !x.trashed && x.capabilities.canAddChildren).map((x) => ({ id: x.id, name: x.name, driveId: x.driveId ?? null })));
    pageToken = parsed.data.nextPageToken;
  } while (pageToken && found.length < 1000);
  return found;
}
export async function generateId(o: Owner, access: string): Promise<string> {
  const response = await request(o, access, '/drive/v3/files/generateIds?count=1&space=drive&type=files');
  if (!response.ok) throw await refusal(response);
  const parsed = z.object({ ids: z.array(z.string()).min(1) }).safeParse(await response.json().catch(() => null));
  const id = parsed.success ? parsed.data.ids[0] : undefined;
  if (!id) throw new DriveFailure('transient');
  return id;
}
/** No permission endpoint is ever called: each file inherits its chosen parent's existing sharing. */
export async function upload(o: Owner, access: string, input: {
  id: string; destinationId: string; name: string; mimeType: string; jobId: string; hash: string; exists: boolean;
  bytes: AsyncIterable<Uint8Array>; size: number; session: { url: string; hash: string; size: number; offset: number } | null;
  check(): Promise<void>; saveSession(session: { url: string; hash: string; size: number; offset: number }): Promise<void>;
}): Promise<void> {
  const metadata = { ...(input.exists ? {} : { id: input.id, parents: [input.destinationId] }), name: input.name, mimeType: input.mimeType, appProperties: { alcoveJob: input.jobId, alcoveVersion: input.hash } };
  let session = input.session?.hash === input.hash && input.session.size === input.size ? input.session : null;
  let offset = 0;
  await input.check();
  if (session) {
    const response = await request(o, access, uploadPath(o, session.url), { method: 'PUT', headers: { 'content-length': '0', 'content-range': `bytes */${input.size}` } });
    if (response.ok) {
      // An ambiguous final reply is reconciled against the actual file and the exact finalized artifact.
      const saved = await file(o, access, input.id);
      if (saved?.appProperties['alcoveJob'] === input.jobId && saved.appProperties['alcoveVersion'] === input.hash) return;
      session = null;
    } else if (response.status === 308) {
      const range = response.headers.get('range');
      const match = range ? /^bytes=0-(\d+)$/.exec(range) : null;
      if (range && !match) throw new DriveFailure('transient');
      offset = match?.[1] ? Number(match[1]) + 1 : 0;
      if (!Number.isSafeInteger(offset) || offset >= input.size) throw new DriveFailure('transient');
      session = { ...session, offset };
      await input.saveSession(session);
    } else if (response.status === 404 || response.status === 410) session = null;
    else throw await refusal(response);
  }
  if (!session) {
    const initiated = await request(o, access, `/upload/drive/v3/files${input.exists ? `/${encodeURIComponent(input.id)}` : ''}?uploadType=resumable&supportsAllDrives=true`, { method: input.exists ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', 'x-upload-content-type': input.mimeType, 'x-upload-content-length': String(input.size) }, body: JSON.stringify(metadata) });
    if (!initiated.ok) throw await refusal(initiated);
    const location = initiated.headers.get('location');
    if (!location) throw new DriveFailure('transient');
    uploadPath(o, location);
    session = { url: location, size: input.size, hash: input.hash, offset: 0 };
    // The session is a bearer capability. It is sealed in the job before any audio or text is sent.
    await input.saveSession(session);
    offset = 0;
  }
  const sessionPath = uploadPath(o, session.url);
  for await (const chunk of chunks(after(input.bytes, offset))) {
    await input.check();
    const response = await request(o, access, sessionPath, { method: 'PUT', headers: { 'content-type': input.mimeType, 'content-length': String(chunk.length), 'content-range': `bytes ${offset}-${offset + chunk.length - 1}/${input.size}` }, body: chunk.slice(), signal: AbortSignal.timeout(60_000) });
    offset += chunk.length;
    if (!response.ok && response.status !== 308) throw await refusal(response);
    if (offset === input.size && !response.ok) throw new DriveFailure('transient');
    if (response.status === 308 && response.headers.get('range') !== `bytes=0-${offset - 1}`) throw new DriveFailure('transient');
    await input.saveSession({ ...session, offset });
  }
  if (offset !== input.size) throw new DriveFailure('source');
}
/** Only Google's configured origin may receive the access token, even for a session read back after a restart. */
function uploadPath(o: Owner, location: string): string {
  let session: URL;
  try { session = new URL(location); } catch { throw new DriveFailure('transient'); }
  if (session.origin !== new URL(o.cfg.GOOGLE_API_URL).origin) throw new DriveFailure('transient');
  return session.pathname + session.search;
}
/** Deterministic artifacts can be reopened after a restart and streamed past the bytes Drive already acknowledged. */
async function* after(source: AsyncIterable<Uint8Array>, skip: number): AsyncGenerator<Uint8Array> {
  let left = skip;
  for await (const part of source) {
    if (left >= part.length) { left -= part.length; continue; }
    yield part.subarray(left);
    left = 0;
  }
  if (left) throw new DriveFailure('source');
}
/** Drive accepts non-final chunks in multiples of 256 KiB. Memory is bounded to one 8 MiB chunk. */
async function* chunks(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const size = 8 * 1024 * 1024;
  let buffer = new Uint8Array(size);
  let used = 0;
  for await (const part of source) {
    let at = 0;
    while (at < part.length) {
      const take = Math.min(size - used, part.length - at);
      buffer.set(part.subarray(at, at + take), used);
      at += take; used += take;
      if (used === size) { yield buffer; buffer = new Uint8Array(size); used = 0; }
    }
  }
  if (used) yield buffer.subarray(0, used);
}
