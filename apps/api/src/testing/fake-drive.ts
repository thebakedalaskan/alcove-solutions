/** Google Drive's external HTTP boundary for the real API integration flows. */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'application/vnd.google-apps.folder';
export interface FakeDriveFolder { id: string; name: string; driveId?: string; canAddChildren?: boolean; trashed?: boolean }
export interface FakeDriveFile { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; bytes: Buffer; updates: number }
export interface FakeDrive {
  folder(sub: string, folder: FakeDriveFolder): void;
  pick(sub: string, folderId: string): void;
  picked(sub: string): string | undefined;
  files(sub: string): FakeDriveFile[];
  calls: { method: string; path: string; supportsAllDrives: boolean; contentRange: string | null; status: number | null }[];
  /** Refuses matching requests until cleared; upload changes are not committed. */
  refuse(match?: ((call: { method: string; path: string }) => boolean) | undefined, status?: number, reason?: string): void;
  /** Commits one upload but drops its reply, as when Google's response is lost in transit. */
  loseUploadReply(): void;
  /** Commits an intermediate resumable chunk but drops its 308 acknowledgment. */
  loseChunkReply(): void;
  /** Keeps one matching provider refusal in flight until the test releases its response. */
  holdRefusal(match: (call: { method: string; path: string }) => boolean, status: number): { arrived: Promise<void>; release(): void };
  handle(req: IncomingMessage, res: ServerResponse, url: URL, who: { sub: string; scopes: string[]; email: string } | undefined): Promise<void>;
}
const Metadata = z.object({ id: z.string().optional(), name: z.string().optional(), mimeType: z.string().optional(), parents: z.array(z.string()).optional(), appProperties: z.record(z.string(), z.string()).optional() });
const reply = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const failure = (res: ServerResponse, status: number, reason: string) => reply(res, status, { error: { code: status, errors: [{ reason }], message: reason } });
const fileInfo = (file: FakeDriveFile) => ({ id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents, appProperties: file.appProperties, webViewLink: `https://drive.google.com/file/d/${file.id}/view`, trashed: false });
async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks);
}
export function createFakeDrive(): FakeDrive {
  const folders = new Map<string, Map<string, FakeDriveFolder>>();
  const allFiles = new Map<string, FakeDriveFile[]>();
  const picks = new Map<string, string>();
  const generated = new Set<string>();
  const calls: FakeDrive['calls'] = [];
  const sessions = new Map<string, { sub: string; id: string; metadata: z.infer<typeof Metadata>; bytes: Buffer; complete: boolean }>();
  const holds: { match: (call: { method: string; path: string }) => boolean; arrived(): void; open: Promise<void>; status: number }[] = [];
  let refusing: ((call: { method: string; path: string }) => boolean) | undefined;
  let refusedStatus = 503;
  let refusedReason: string | undefined;
  let loseReply = false;
  let loseIntermediate = false;
  const files = (sub: string) => { let list = allFiles.get(sub); if (!list) { list = []; allFiles.set(sub, list); } return list; };
  const folderInfo = (folder: FakeDriveFolder) => ({ id: folder.id, name: folder.name, mimeType: FOLDER, driveId: folder.driveId, capabilities: { canAddChildren: folder.canAddChildren ?? true }, trashed: folder.trashed ?? false });
  return {
    calls, files,
    folder: (sub, folder) => { let held = folders.get(sub); if (!held) { held = new Map(); folders.set(sub, held); } held.set(folder.id, folder); },
    pick: (sub, id) => { picks.set(sub, id); },
    picked: (sub) => picks.get(sub),
    refuse: (match, status = 503, reason) => { refusing = match; refusedStatus = status; refusedReason = reason; },
    loseUploadReply: () => { loseReply = true; },
    loseChunkReply: () => { loseIntermediate = true; },
    holdRefusal(match, status) {
      let markArrived = (): void => undefined; let release = (): void => undefined;
      const arrived = new Promise<void>((resolve) => { markArrived = resolve; });
      const open = new Promise<void>((resolve) => { release = resolve; });
      holds.push({ match, status, arrived: markArrived, open });
      return { arrived, release };
    },
    async handle(req, res, url, who) {
      if (!who) return failure(res, 401, 'authError');
      if (!who.scopes.includes(DRIVE_SCOPE)) return failure(res, 403, 'insufficientPermissions');
      const call: FakeDrive['calls'][number] = { method: req.method ?? '', path: url.pathname, supportsAllDrives: url.searchParams.get('supportsAllDrives') === 'true', contentRange: typeof req.headers['content-range'] === 'string' ? req.headers['content-range'] : null, status: null };
      calls.push(call);
      res.once('finish', () => { call.status = res.statusCode; });
      const heldRefusal = holds.find((held) => held.match(call));
      if (heldRefusal) { holds.splice(holds.indexOf(heldRefusal), 1); heldRefusal.arrived(); await heldRefusal.open; return failure(res, heldRefusal.status, heldRefusal.status === 401 ? 'authError' : 'backendError'); }
      if (refusing?.(call)) return failure(res, refusedStatus, refusedReason ?? (refusedStatus === 403 ? 'insufficientFilePermissions' : 'backendError'));
      if (req.method === 'GET' && url.pathname === '/drive/v3/about') return reply(res, 200, { user: { emailAddress: who.email, permissionId: who.sub } });
      if (req.method === 'GET' && url.pathname === '/drive/v3/files/generateIds') {
        const id = `generated_${randomBytes(16).toString('hex')}`; generated.add(id); return reply(res, 200, { ids: [id], space: 'drive' });
      }
      if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
        const list = [...(folders.get(who.sub)?.values() ?? [])].filter((folder) => !folder.trashed).map(folderInfo);
        return reply(res, 200, { files: list });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/drive/v3/files/')) {
        const id = decodeURIComponent(url.pathname.slice('/drive/v3/files/'.length));
        const folder = folders.get(who.sub)?.get(id);
        if (folder) return folder.driveId && !call.supportsAllDrives ? failure(res, 404, 'notFound') : reply(res, 200, folderInfo(folder));
        const file = files(who.sub).find((entry) => entry.id === id);
        return file ? reply(res, 200, fileInfo(file)) : failure(res, 404, 'notFound');
      }
      if ((req.method === 'POST' || req.method === 'PATCH') && url.pathname.startsWith('/upload/drive/v3/files')) {
        if (url.searchParams.get('uploadType') !== 'resumable') return failure(res, 400, 'uploadType');
        const metadata = Metadata.parse(JSON.parse((await body(req)).toString('utf8')));
        const id = req.method === 'PATCH' ? decodeURIComponent(url.pathname.slice('/upload/drive/v3/files/'.length)) : metadata.id;
        if (!id) return failure(res, 400, 'missingId');
        const before = files(who.sub).find((entry) => entry.id === id);
        if (req.method === 'POST' && before) return failure(res, 409, 'alreadyExists');
        if (req.method === 'PATCH' && !before) return failure(res, 404, 'notFound');
        if (req.method === 'POST' && !generated.has(id)) return failure(res, 400, 'invalidId');
        const parents = metadata.parents ?? before?.parents ?? [];
        const folder = folders.get(who.sub)?.get(parents[0] ?? '');
        if (!folder || folder.trashed) return failure(res, 404, 'notFound');
        if (folder.canAddChildren === false) return failure(res, 403, 'insufficientFilePermissions');
        if (folder.driveId && !call.supportsAllDrives) return failure(res, 404, 'notFound');
        const sessionId = randomBytes(16).toString('hex');
        sessions.set(sessionId, { sub: who.sub, id, metadata: { ...metadata, parents }, bytes: Buffer.alloc(0), complete: false });
        res.writeHead(200, { location: `${url.origin}/drive-upload/${sessionId}` });
        res.end(); return;
      }
      if (req.method === 'PUT' && url.pathname.startsWith('/drive-upload/')) {
        const held = sessions.get(url.pathname.slice('/drive-upload/'.length));
        if (!held || held.sub !== who.sub) return failure(res, 404, 'notFound');
        const range = String(req.headers['content-range'] ?? '');
        if (range.startsWith('bytes */')) {
          if (held.complete) { const saved = files(who.sub).find((entry) => entry.id === held.id); return saved ? reply(res, 200, fileInfo(saved)) : failure(res, 404, 'notFound'); }
          res.writeHead(308, held.bytes.length ? { range: `bytes=0-${held.bytes.length - 1}` } : {}); res.end(); return;
        }
        const parsed = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(range);
        if (!parsed) return failure(res, 400, 'contentRange');
        const from = Number(parsed[1]); const to = Number(parsed[2]); const total = parsed[3] === '*' ? Infinity : Number(parsed[3]);
        const bytes = await body(req);
        if (from !== held.bytes.length || to - from + 1 !== bytes.length) return failure(res, 400, 'contentRange');
        held.bytes = Buffer.concat([held.bytes, bytes]);
        if (to + 1 < total) { if (loseIntermediate) { loseIntermediate = false; res.destroy(); return; } res.writeHead(308, { range: `bytes=0-${to}` }); res.end(); return; }
        const before = files(who.sub).find((entry) => entry.id === held.id);
        const folder = folders.get(who.sub)?.get(held.metadata.parents?.[0] ?? '');
        if (!folder || folder.trashed) return failure(res, 404, 'notFound');
        if (folder.canAddChildren === false) return failure(res, 403, 'insufficientFilePermissions');
        const file: FakeDriveFile = { id: held.id, name: held.metadata.name ?? before?.name ?? '', mimeType: held.metadata.mimeType ?? before?.mimeType ?? 'application/octet-stream', parents: held.metadata.parents ?? [], appProperties: held.metadata.appProperties ?? before?.appProperties ?? {}, bytes: held.bytes, updates: (before?.updates ?? 0) + 1 };
        const list = files(who.sub); const at = list.findIndex((entry) => entry.id === held.id); if (at < 0) list.push(file); else list[at] = file;
        held.complete = true;
        if (loseReply) { loseReply = false; res.destroy(); return; }
        return reply(res, 200, fileInfo(file));
      }
      return failure(res, 404, 'notFound');
    }
  };
}
