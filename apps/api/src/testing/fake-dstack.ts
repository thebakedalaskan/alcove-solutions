/*
 * A stand-in for the dstack guest agent, for integration tests: the same JSON-over-HTTP calls a
 * confidential VM's agent answers (GetKey, GetQuote, Info), on a Unix socket as in the VM. Keys are
 * derived from the path, as the real key service derives them from the app's identity and the path;
 * quotes carry the report data they were asked for, so tests can check what a quote vouches for.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeDstack {
  socket: string;
  appId: string;
  /** The key the agent derives for a path, as base64url (what KMASTER and KSERVICE look like). */
  key(path: string): string;
  close(): Promise<void>;
}

const derived = (path: string) => createHash('sha256').update(`fake-dstack-kms:${path}`).digest();
async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v)) : {};
}

export async function startFakeDstack(): Promise<FakeDstack> {
  const appId = createHash('sha256').update('fake-app').digest('hex').slice(0, 40);
  const server = createServer((req, res) => {
    void (async () => {
      const body = await json(req);
      const send = (v: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (req.method === 'POST' && req.url === '/GetKey') return send({ key: Buffer.concat([derived(String(body['path'] ?? '')), derived('pad')]).toString('hex'), signature_chain: ['00'] });
      if (req.method === 'POST' && req.url === '/GetQuote') {
        const reportData = String(body['report_data'] ?? '');
        return send({ quote: `${Buffer.from('FAKE-TDX-QUOTE').toString('hex')}${reportData}`, event_log: JSON.stringify([{ imr: 3, event_type: 134217729, digest: '00', event: 'compose-hash', event_payload: 'ab' }]) });
      }
      if (req.method === 'POST' && req.url === '/Info') return send({ app_id: appId, instance_id: 'fake-instance', compose_hash: 'ab'.repeat(32), os_image_hash: 'cd'.repeat(32) });
      res.writeHead(404); res.end();
    })().catch(() => { res.writeHead(500); res.end(); });
  });
  const dir = mkdtempSync(join(tmpdir(), 'alcove-dstack-'));
  const socket = join(dir, 'dstack.sock');
  await new Promise<void>((r) => server.listen(socket, () => r()));
  return {
    socket, appId,
    key: (path) => derived(path).toString('base64url'),
    close: () => new Promise<void>((r) => server.close(() => { rmSync(dir, { recursive: true, force: true }); r(); }))
  };
}
