/**
 * Files in a workspace: who can put one in a document, who can read one and for how long, and how they go, through
 * browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres, the real object store and, for
 * guests, a real call. A file's bytes are read as an `<img>` or a player reads them: from its URL, with whatever cookies
 * that browser has and no other headers but `Range`.
 */
import { AlcoveApiError, FILE_TYPE, MAX_MEDIA_BYTES, MAX_MEDIA_PREVIEW_BYTES, MEDIA_PIECE_BYTES, REQUEST_ID_HEADER, errorCode, type AlcoveApi, type CallSession, type CallState, type ItemKind, type WorkspaceRole } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { resolveObjectURL } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { request, type ClientRequest } from 'node:http';
import { connect } from 'node:net';
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { z } from 'zod';
import { readPass } from '../../callPass';
import { blindIndex } from '../../crypto';
import { LIMITS } from '../../limits';
import { maintain } from '../../maintenance';
import { MEDIA_LIMITS } from './media';
import { masterKey } from '../../owners';
import { withWorkspace } from '../../testing/call-workspace';
import { pictureJpeg } from '../../testing/video';
import { ORIGIN, cookieFetch, startHarness, type Browser, type Harness } from '../../testing/harness';

// Guests need real calls; every wait below is bounded and says what it was waiting for.
vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => {
  // A file here is megabytes, and the bucket outlives this run: whatever reads all of it next, upkeep or the leakage test, would pay for each one left.
  if (h) for await (const o of h.objects.list()) await h.objects.delete(o.id);
  await h?.close();
});
// A limit a test set is gone before the next starts: tests read the limits afresh on every request (LIMITS_CACHE_MS is 0 here).
afterEach(async () => { h.closeCalls(); vi.restoreAllMocks(); await h.resetLimits(); });

const PIECE = MEDIA_PIECE_BYTES;
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
/** A fresh account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(o: { email?: string | undefined; fetch?: typeof fetch | undefined } = {}): Promise<Account> {
  const b = h.browser({ fetch: o.fetch });
  const { session } = await b.api.auth.signIn('sso', { email: o.email ?? unique() });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
/** What each storage limit refuses with, as a browser hears it: a file says how big one can be, and a limit of zero that nothing can be uploaded. */
const tooBig = (most: string) => ({ code: 'invalid', message: `This file is bigger than ${most}, the most a file can be here.`, status: 400 });
const NO_FILES = { code: 'invalid', message: 'Files can’t be uploaded right now.', status: 400 };
const NO_UPLOADS = { code: 'conflict', message: 'Files can’t be uploaded right now.', status: 409 };
const FULL = { code: 'plan-limit', message: 'Your storage is full. Delete something, or move to a plan with more room.', status: 402 };
const TODAYS = { code: 'conflict', message: 'That’s all you can upload today. You can upload more tomorrow.', status: 409 };
const SEAT_ONLY = { code: 'forbidden', message: 'You can work on this in the call, but you can’t delete its files for good.', status: 403 };
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const logsSince = (from: number) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
const madeUp = () => randomBytes(16).toString('base64url');
/** How a request was refused, as a browser sees it, or null when it wasn't. */
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AlcoveApiError ? { code: e.code, message: e.message, status: e.status } : { code: 'not-an-api-error', message: String(e), status: 0 }));
const code = async (p: Promise<unknown>) => (await refusal(p))?.code ?? 'allowed';
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
const ownerOf = async (workspaceId: string) => (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]?.owner_id ?? '';
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const make = async (who: Account, id: string, kind: ItemKind, name: string, parent: string | null = null) => (await who.api.workspaces.items.create(id, { kind, name, parent })).id;
const bytesOf = (n: number) => new Uint8Array(randomBytes(n));
const fileOf = (bytes: Uint8Array<ArrayBuffer>, name = 'harbour.png', type = 'image/png') => new File([bytes], name, { type });
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;

/** Reads a file's URL as a browser's `<img>` or player does. */
async function read(who: { fetch: typeof fetch }, url: string, range?: string) {
  const res = await who.fetch(url, range ? { headers: { range } } : {});
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}
const Refused = z.object({ code: z.string(), message: z.string(), requestId: z.string() });
/** What a refused read answers, without the request's own ID. */
async function refused(who: { fetch: typeof fetch }, url: string, range?: string) {
  const res = await who.fetch(url, range ? { headers: { range } } : {});
  const { code: c, message } = Refused.parse(await res.json());
  return { status: res.status, code: c, message };
}
/** Someone with their session in hand, for a request of their own that says what `fetch` won't. */
async function withCookie() {
  const browser = cookieFetch(ORIGIN);
  let cookie = '';
  const tap: typeof fetch = async (input, init) => {
    const res = await browser(input, init);
    cookie = /(__Host-alcove_session=[^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? cookie;
    return res;
  };
  const who = await account({ fetch: tap });
  return { ...who, cookie: () => cookie };
}
/**
 * How much of a response's body came on a connection, and whether all of it did: by its length, or, past 16 MiB where it
 * has none, by the chunk that ends it.
 */
function bodyOf(all: Buffer): { body: number; whole: boolean } {
  const at = all.indexOf('\r\n\r\n');
  if (at < 0) return { body: 0, whole: false };
  const head = all.subarray(0, at).toString('latin1');
  const rest = all.subarray(at + 4);
  const length = /\r\ncontent-length: *(\d+)/i.exec(head)?.[1];
  if (length !== undefined) return { body: rest.length, whole: rest.length === Number(length) };
  if (!/\r\ntransfer-encoding: *chunked/i.test(head)) return { body: rest.length, whole: false };
  let body = 0;
  for (let i = 0; ;) {
    const eol = rest.indexOf('\r\n', i);
    const size = eol < 0 ? Number.NaN : Number.parseInt(rest.subarray(i, eol).toString('latin1'), 16);
    if (Number.isNaN(size)) return { body, whole: false };
    if (size === 0) return { body, whole: true };
    body += Math.min(size, rest.length - (eol + 2));
    i = eol + 2 + size + 2;
    if (i > rest.length) return { body, whole: false };
  }
}
/** The status the server answered a request with, by the ID it was sent with, from its request line; 0 until it has. */
const answered = (from: number, requestId: string): number => {
  for (const raw of h.logs.slice(from)) {
    if (!raw.includes(requestId)) continue;
    const l = LogLine.safeParse(JSON.parse(raw));
    if (l.success && ['request', 'request refused', 'request failed'].includes(l.data.msg)) return Number(l.data['status']);
  }
  return 0;
};
/**
 * A read whose browser has stopped taking it, as a tab that stalled has: a connection of its own that sends the request
 * and reads nothing back, so only what the operating system holds leaves the server, which is less than a piece. A
 * fetch reads on into buffers of its own, and on Linux that can be the whole of a file of two pieces: the read ends by
 * itself and gives its place back, and nothing has stopped. It's under way once the server has answered it, which its
 * request line says, so that's what this waits for, not the answer reaching the browser.
 */
async function stopped(who: { cookie: () => string }, url: string) {
  const requestId = randomBytes(12).toString('base64url');
  const { hostname, port, pathname, host } = new URL(url);
  const from = h.logs.length;
  const socket = connect({ host: hostname, port: Number(port) });
  socket.on('error', () => undefined);
  socket.pause();
  socket.write(`GET ${pathname} HTTP/1.1\r\nhost: ${host}\r\ncookie: ${who.cookie()}\r\n${REQUEST_ID_HEADER}: ${requestId}\r\nconnection: close\r\n\r\n`);
  let status = 0;
  await until(() => { status = answered(from, requestId); return status > 0; }, 'the server to answer a read');
  let received = 0;
  /**
   * Takes the rest of the answer: all at once, or a chunk at a time `ms` apart, as a browser on a slow line does. How much
   * of the body came, or `cut` when the connection ended short of its length.
   */
  const take = (ms = 0) => new Promise<number | 'cut'>((resolve) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      if (ms) { socket.pause(); setTimeout(() => socket.resume(), ms).unref(); }
    });
    socket.once('close', () => {
      const { body, whole } = bodyOf(Buffer.concat(chunks));
      received = body;
      resolve(whole ? body : 'cut');
    });
    socket.resume();
  });
  return { requestId, status, rest: () => take(), slowly: (ms: number) => take(ms), received: () => received, end: () => { socket.destroy(); } };
}
/** The answer for a URL nobody made: every refusal of a read must look just like it. */
const nothing = () => refused({ fetch }, `${h.baseUrl}/v1/media/${randomBytes(120).toString('base64url')}.${randomBytes(32).toString('base64url')}`);
const place = (id: string, doc: string) => `${h.baseUrl}/v1/workspaces/${id}/documents/${doc}/media`;
const json = (who: { fetch: typeof fetch }, url: string, body: unknown, headers: Record<string, string> = {}) => who.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const sendPiece = (who: { fetch: typeof fetch }, url: string, bytes: Uint8Array<ArrayBuffer>, type = 'application/octet-stream') => who.fetch(url, { method: 'POST', headers: { 'content-type': type }, body: bytes });
/**
 * A piece that says it's over the limit, and sends none of it: the API has to answer from its declared length alone. On a
 * connection of its own, because one left with a body unread isn't one a later request should share. It's refused before
 * anyone's asked who they are, so it needs no session.
 */
const oversized = (url: string, bytes: number) => new Promise<number>((resolve, reject) => {
  const req = request(url, { method: 'POST', agent: false, headers: { origin: ORIGIN, 'content-type': 'application/octet-stream', 'content-length': String(bytes) } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); req.destroy(); });
  req.on('error', reject);
  req.flushHeaders();
});
const Made = z.object({ id: z.string() });
/** Starts an upload and leaves it there, as a browser does when its tab goes. */
async function started(who: { fetch: typeof fetch }, id: string, doc: string, size: number) {
  return Made.parse(await (await json(who, place(id, doc), { name: 'dropped.png', type: 'image/png', size })).json()).id;
}
const objectsOf = async (ownerId: string) => (await h.pool.query<{ object_id: string }>('SELECT object_id FROM workspace_media_pieces WHERE owner_id = $1 ORDER BY media_id, seq', [ownerId])).rows.map((r) => r.object_id);
const stored = (id: string) => h.objects.get(id).then(() => true, () => false);
const storedBytes = async (ownerId: string) => Number((await h.pool.query<{ stored_bytes: string }>('SELECT stored_bytes FROM owners WHERE owner_id = $1', [ownerId])).rows[0]?.stored_bytes ?? -1);
const rowsOf = async (ownerId: string) => Object.fromEntries(await Promise.all(['workspace_media', 'workspace_media_pieces', 'workspace_media_uses'].map(async (t) => [t, await count(`SELECT count(*)::int AS n FROM ${t} WHERE owner_id = $1`, [ownerId])] as const)));
const NO_ROWS = { workspace_media: 0, workspace_media_pieces: 0, workspace_media_uses: 0 };
/** An age every upload so far has reached, whatever the database's clock says against this one's. */
const ALREADY = -60_000;
const queued = (ownerId: string) => count('SELECT count(*)::int AS n FROM object_gc WHERE owner_id = $1', [ownerId]);

describe('a file in a document', () => {
  it('goes up in pieces and comes back whole and by range, with nothing sniffed, cached or taken from the request', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const bytes = bytesOf(2 * PIECE + 1234);
    const seen: number[] = [];
    const media = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes), { width: 1600, height: 900, onProgress: (p) => { seen.push(p.sent); expect(p.total).toBe(bytes.length); } });
    expect(media).toMatchObject({ name: 'harbour.png', type: 'image/png', size: bytes.length, width: 1600, height: 900, documents: [doc] });
    expect(media.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(seen).toEqual([PIECE, 2 * PIECE, bytes.length]);

    const url = await ann.api.workspaces.media.url(id, doc, media.id);
    expect(url.startsWith(`${h.baseUrl}/v1/media/`)).toBe(true);
    const whole = await read(ann, url);
    expect(whole.status).toBe(200);
    expect(same(whole.bytes, bytes)).toBe(true);
    expect(Object.fromEntries(['content-type', 'content-length', 'accept-ranges', 'cache-control', 'x-content-type-options'].map((k) => [k, whole.headers.get(k)]))).toEqual({
      'content-type': 'image/png', 'content-length': String(bytes.length), 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
    });
    expect(whole.headers.get('content-disposition')).toMatch(/^inline/);
    expect(whole.headers.get('content-range')).toBeNull();
    // Nothing in a file can run, whatever it holds, even opened by itself.
    expect(whole.headers.get('content-security-policy')).toBe("default-src 'none'; img-src 'self'; media-src 'self'");

    // The first byte, within a piece, across each edge of one, across all of them, to the end, and from the end.
    const size = bytes.length;
    const ranges: [string, number, number][] = [
      ['bytes=0-0', 0, 0], ['bytes=10-19', 10, 19], [`bytes=${PIECE - 1}-${PIECE}`, PIECE - 1, PIECE], [`bytes=${PIECE}-${2 * PIECE - 1}`, PIECE, 2 * PIECE - 1],
      [`bytes=5-${2 * PIECE + 5}`, 5, 2 * PIECE + 5], [`bytes=${2 * PIECE + 1}-`, 2 * PIECE + 1, size - 1], ['bytes=-100', size - 100, size - 1], [`bytes=${size - 2}-${size + 500}`, size - 2, size - 1], ['bytes=0-', 0, size - 1]
    ];
    for (const [range, start, end] of ranges) {
      const r = await read(ann, url, range);
      expect(`${range} → ${r.status}`).toBe(`${range} → 206`);
      expect(r.headers.get('content-range')).toBe(`bytes ${start}-${end}/${size}`);
      expect(r.headers.get('content-length')).toBe(String(end - start + 1));
      expect(same(r.bytes, bytes.subarray(start, end + 1)), range).toBe(true);
      expect(r.headers.get('content-type')).toBe('image/png');
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    // Past the end there's nothing to send; a range that isn't one is ignored, as is asking for several.
    const past = await read(ann, url, `bytes=${size}-`);
    expect([past.status, past.headers.get('content-range'), past.bytes.length]).toEqual([416, `bytes */${size}`, 0]);
    expect((await read(ann, url, 'bytes=-0')).status).toBe(416);
    for (const ignored of ['bytes=9-3', 'bytes=0-1,4-5', 'lines=0-3', 'bytes=x-y']) {
      const r = await read(ann, url, ignored);
      expect([ignored, r.status, r.bytes.length]).toEqual([ignored, 200, size]);
    }

    // What a request says about itself changes nothing about how it's served.
    const asked = await ann.fetch(`${url}?type=text/html&content-type=text/html`, { headers: { accept: 'text/html' } });
    expect(asked.headers.get('content-type')).toBe('image/png');
    await asked.arrayBuffer();
    // Asking only about it reads no piece.
    const get = vi.spyOn(h.deps.objects, 'get');
    const head = await ann.fetch(url, { method: 'HEAD' });
    expect([head.status, head.headers.get('content-length'), head.headers.get('accept-ranges')]).toEqual([200, String(size), 'bytes']);
    // Only a GET has a range: anything else is answered as if it hadn't asked for one.
    for (const range of ['bytes=0-9', `bytes=${size}-`]) {
      const asking = await ann.fetch(url, { method: 'HEAD', headers: { range } });
      expect([range, asking.status, asking.headers.get('content-range'), asking.headers.get('content-length')]).toEqual([range, 200, null, String(size)]);
    }
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();

    // It's a board's as much as a document's, and another API instance reads it just the same.
    const board = await make(ann, id, 'board', 'Map');
    const onBoard = await ann.api.workspaces.media.upload(id, board, fileOf(bytesOf(10), 'pin.webp', 'image/webp'));
    const second = await h.secondServer();
    const there = await read(ann, url.replace(h.baseUrl, second.baseUrl), 'bytes=0-9');
    await second.close();
    expect([there.status, same(there.bytes, bytes.subarray(0, 10))]).toEqual([206, true]);
    expect((await read(ann, await ann.api.workspaces.media.url(id, board, onBoard.id))).status).toBe(200);
  });

  it('answers a long range a few pieces at a time, so it’s asked for again as it plays, and streams a big file whole without saying its length', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const bytes = bytesOf(4 * PIECE + 100);
    const size = bytes.length;
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes, 'film.mp4', 'video/mp4'));
    const url = await theo.api.workspaces.media.url(id, doc, m.id);

    // A player asks for everything from the start, and gets as much as one answer sends, which says so.
    const opening = await read(theo, url, 'bytes=0-');
    expect([opening.status, opening.headers.get('content-range'), opening.headers.get('content-length')]).toEqual([206, `bytes 0-${4 * PIECE - 1}/${size}`, String(4 * PIECE)]);
    expect(same(opening.bytes, bytes.subarray(0, 4 * PIECE))).toBe(true);
    // It stops where a piece does, wherever it began, so the next answer opens no piece twice.
    const within = await read(theo, url, `bytes=5-${size - 1}`);
    expect(within.headers.get('content-range')).toBe(`bytes 5-${4 * PIECE - 1}/${size}`);
    expect(same(within.bytes, bytes.subarray(5, 4 * PIECE))).toBe(true);
    // Asking on from there finishes it.
    const rest = await read(theo, url, `bytes=${4 * PIECE}-`);
    expect([rest.status, rest.headers.get('content-range')]).toEqual([206, `bytes ${4 * PIECE}-${size - 1}/${size}`]);
    expect(same(rest.bytes, bytes.subarray(4 * PIECE))).toBe(true);

    // Someone who didn't ask for a range gets all of it, in one answer that doesn't say how long it is.
    const whole = await read(theo, url);
    expect([whole.status, whole.headers.get('content-length'), whole.headers.get('content-range')]).toEqual([200, null, null]);
    expect(same(whole.bytes, bytes)).toBe(true);

    // A player that loses the document stops at the next answer, however much it asked for.
    const person = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email)?.id ?? '';
    await ann.api.workspaces.removePerson(id, person);
    expect(await refused(theo, url, `bytes=${4 * PIECE}-`)).toEqual(await nothing());
  });

  it('lets a download that stopped pick up where it was, with the file’s ETag, and starts it again for anything else', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const bytes = bytesOf(5 * PIECE + 100);
    const size = bytes.length;
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes, 'walkthrough.mp4', 'video/mp4'));
    const url = await ann.api.workspaces.media.url(id, doc, m.id, { download: true });
    const asking = async (headers: Record<string, string>) => {
      const res = await ann.fetch(url, { headers });
      return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
    };

    // The whole file says what it is with a strong ETag, made from nothing readable, the same however it's asked for.
    const whole = await read(ann, url);
    const etag = whole.headers.get('etag') ?? '';
    expect([whole.status, same(whole.bytes, bytes)]).toEqual([200, true]);
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    const again = await read(ann, await ann.api.workspaces.media.url(id, doc, m.id), 'bytes=0-0');
    expect(again.headers.get('etag')).toBe(etag);

    // Cut off part way, it asks for the rest against that ETag, and the rest comes in one answer, past four pieces and
    // without a length, where a player's range would stop at four.
    const from = PIECE + 7;
    const rest = await asking({ range: `bytes=${from}-`, 'if-range': etag });
    expect([rest.status, rest.headers.get('content-range'), rest.headers.get('content-length'), rest.headers.get('etag')]).toEqual([206, `bytes ${from}-${size - 1}/${size}`, null, etag]);
    expect(same(rest.bytes, bytes.subarray(from))).toBe(true);
    const played = await read(ann, await ann.api.workspaces.media.url(id, doc, m.id), `bytes=${from}-`);
    expect(played.headers.get('content-range')).toBe(`bytes ${from}-${5 * PIECE - 1}/${size}`);

    // Against anything but this file's ETag, a weak one included, the range doesn't count: it gets the whole file again.
    for (const other of ['"another-file"', `W/${etag}`, 'Wed, 11 Nov 2026 09:00:00 GMT']) {
      const r = await asking({ range: `bytes=${from}-`, 'if-range': other });
      expect([other, r.status, r.headers.get('content-range'), same(r.bytes, bytes)]).toEqual([other, 200, null, true]);
    }
  });

  it('opens only a few pieces at a time, however many are asked for at once, and gets to all of them', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const pictures = await Promise.all(Array.from({ length: 15 }, async (_, i) => {
      const bytes = bytesOf(1000 + i);
      const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
      return { bytes, url: await ann.api.workspaces.media.url(id, doc, m.id) };
    }));
    const get = h.deps.objects.get;
    let open = 0;
    let most = 0;
    h.deps.objects.get = async (o) => {
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 15));
      const b = await get(o);
      open--;
      return b;
    };
    try {
      // A page of 30 pictures: an `<img>` can't try again, so they all have to get there.
      const everyone = await Promise.all([...pictures, ...pictures].map(async (p) => same((await read(ann, p.url)).bytes, p.bytes)));
      expect(everyone.every(Boolean)).toBe(true);
    } finally { h.deps.objects.get = get; }
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(MEDIA_LIMITS.working);
  });

  it('is served as what it says only if that’s on the list: anything else is a download, and so is anything asked for as one', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const types: [string, string, string][] = [
      ['a.jpg', 'image/jpeg', 'image/jpeg'], ['a.jpg', 'image/jpg', 'image/jpeg'], ['a.png', 'IMAGE/PNG', 'image/png'], ['a.webp', 'image/webp', 'image/webp'], ['a.gif', 'image/gif', 'image/gif'], ['a.avif', 'image/avif', 'image/avif'],
      ['a.mp4', 'video/mp4', 'video/mp4'], ['a.webm', 'video/webm; codecs="vp9"', 'video/webm'],
      ['a.mp3', 'audio/mpeg', 'audio/mpeg'], ['a.mp3', 'audio/mp3', 'audio/mpeg'], ['a.m4a', 'audio/mp4', 'audio/mp4'], ['a.m4a', 'audio/x-m4a', 'audio/mp4'], ['a.weba', 'audio/webm', 'audio/webm'], ['a.ogg', 'audio/ogg', 'audio/ogg']
    ];
    for (const [name, declared, served] of types) {
      const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(16), name, declared));
      expect([declared, m.type]).toEqual([declared, served]);
      const r = await read(ann, await ann.api.workspaces.media.url(id, doc, m.id));
      expect([declared, r.headers.get('content-type'), r.headers.get('content-disposition')?.split(';')[0]]).toEqual([declared, served, 'inline']);
      // Asked for as a download (a photo's or a video's Download), it's one, under the name it came with, and still what it is.
      const saved = await read(ann, await ann.api.workspaces.media.url(id, doc, m.id, { download: true }));
      expect([declared, saved.status, saved.headers.get('content-type'), saved.headers.get('content-disposition')]).toEqual([declared, 200, served, `attachment; filename*=UTF-8''${encodeURIComponent(name)}`]);
    }
    // The app saves a download in a hidden frame on its own page: the API is on an origin of its own, where a link's
    // `download` doesn't count, and following the link in the page would navigate it and end a call on it. So nothing in
    // the answer to that frame keeps it out of one.
    const framedFile = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(16), 'harbour.png', 'image/png'));
    const framed = await ann.fetch(await ann.api.workspaces.media.url(id, doc, framedFile.id, { download: true }), { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-site' } });
    await framed.arrayBuffer();
    expect([framed.status, framed.headers.get('content-disposition'), framed.headers.get('x-frame-options')]).toEqual([200, 'attachment; filename*=UTF-8\'\'harbour.png', null]);
    expect(framed.headers.get('content-security-policy') ?? '').not.toContain('frame-ancestors');
    // What could run in a page, and whatever nobody can show, only ever downloads, under the name it came with.
    for (const [name, declared] of [['page.html', 'text/html'], ['logo.svg', 'image/svg+xml'], ['app.js', 'text/javascript'], ['notes.pdf', 'application/pdf'], ['clip.mov', 'video/quicktime'], ['mystery', '']] as const) {
      const m = await ann.api.workspaces.media.upload(id, doc, fileOf(new TextEncoder().encode('<script>alert(1)</script>'), name, declared));
      expect([declared, m.type]).toEqual([declared, FILE_TYPE]);
      const r = await read(ann, await ann.api.workspaces.media.url(id, doc, m.id));
      expect([declared, r.headers.get('content-type'), r.headers.get('x-content-type-options')]).toEqual([declared, FILE_TYPE, 'nosniff']);
      expect(r.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    // A name can't reach anything else in the header, however it's written.
    const odd = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(4), 'Q3 “final”;\r\nx-evil: yes (1).txt', 'text/plain'));
    expect(odd.name).toBe('Q3 “final”; x-evil: yes (1).txt');
    const r = await read(ann, await ann.api.workspaces.media.url(id, doc, odd.id));
    expect(r.headers.get('x-evil')).toBeNull();
    const encoded = /^attachment; filename\*=UTF-8''([A-Za-z0-9%._~-]+)$/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? '';
    expect(decodeURIComponent(encoded)).toBe(odd.name);
  });

  it('keeps to its limits, and can’t be read until all of it is there', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const at = place(id, doc);
    const owner = await ownerOf(id);
    const limit = LIMITS['plan.free.file_bytes'].default;
    for (const body of [{ name: 'big.mp4', type: 'video/mp4', size: MAX_MEDIA_BYTES + 1 }, { name: 'over.mp4', type: 'video/mp4', size: limit + 1 }, { name: 'none.png', type: 'image/png', size: 0 }, { name: '   ', type: 'image/png', size: 4 }, { name: 'x'.repeat(256), type: 'image/png', size: 4 }, { name: 'half.png', type: 'image/png', size: 1.5 }, { name: 'tall.png', type: 'image/png', size: 4, width: 0 }]) {
      expect([body.name.slice(0, 8), (await json(ann, at, body)).status]).toEqual([body.name.slice(0, 8), 400]);
    }
    expect((await json(ann, at, { name: 'fits.mp4', type: 'video/mp4', size: limit })).status).toBe(200);

    const size = PIECE + 10;
    const m = await started(ann, id, doc, size);
    const bytes = bytesOf(size);
    const first = bytes.slice(0, PIECE);
    const last = bytes.slice(PIECE);
    // Each piece is its own length exactly, in a place the file has.
    expect((await sendPiece(ann, `${at}/${m}/pieces/0`, bytes.slice(0, PIECE - 1))).status).toBe(400);
    expect((await sendPiece(ann, `${at}/${m}/pieces/1`, bytes.slice(0, 11))).status).toBe(400);
    expect((await sendPiece(ann, `${at}/${m}/pieces/2`, last)).status).toBe(400);
    expect((await sendPiece(ann, `${at}/${m}/pieces/first`, last)).status).toBe(400);
    expect(await oversized(`${at}/${m}/pieces/0`, PIECE + 1)).toBe(400);
    // Only the bytes of a file go there as bytes: the API takes no other kind of body from a browser.
    expect((await sendPiece(ann, `${at}/${m}/pieces/1`, last, 'text/plain')).status).toBe(400);
    expect((await sendPiece(ann, `${h.baseUrl}/v1/workspaces/${id}/items/${doc}/share`, last)).status).toBe(400);
    expect(await count('SELECT count(*)::int AS n FROM workspace_media_pieces WHERE owner_id = $1', [owner])).toBe(0);

    // In any order, but none of it can be read, listed or reused until it's finished.
    expect((await sendPiece(ann, `${at}/${m}/pieces/1`, last)).status).toBe(200);
    const finish = () => json(ann, `${at}/${m}/finish`, {});
    expect((await finish()).status).toBe(409);
    const other = await make(ann, id, 'document', 'Other');
    expect(await refusal(ann.api.workspaces.media.url(id, doc, m))).toEqual(await refusal(ann.api.workspaces.media.url(id, doc, madeUp())));
    expect(await code(ann.api.workspaces.media.attach(id, other, m))).toBe('not-found');
    expect((await ann.api.workspaces.media.list(id)).map((x) => x.id)).not.toContain(m);
    expect((await sendPiece(ann, `${at}/${m}/pieces/0`, first)).status).toBe(200);
    expect((await finish()).status).toBe(200);
    // Saying so again, or sending a piece again, as a retry does, changes nothing.
    expect((await finish()).status).toBe(200);
    expect((await sendPiece(ann, `${at}/${m}/pieces/1`, last)).status).toBe(200);
    expect(await count('SELECT count(*)::int AS n FROM workspace_media_pieces WHERE owner_id = $1 AND media_id = $2', [owner, m])).toBe(2);
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, m))).bytes, bytes)).toBe(true);
  });

  it('counts what it takes up towards the workspace’s stored bytes, once however it’s kept', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    expect(await storedBytes(owner)).toBe(0);
    await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 5)));
    const bytes = await storedBytes(owner);
    expect(bytes).toBeGreaterThan(PIECE);
    const sealed = (await h.pool.query<{ length: string }>('SELECT sum(length)::text AS length FROM workspace_media_pieces WHERE owner_id = $1', [owner])).rows[0]?.length;
    expect(String(bytes)).toBe(sealed);
    expect(await count('SELECT bytes::int AS n FROM workspace_media WHERE owner_id = $1', [owner])).toBe(bytes);
    // The account that put it there isn't charged for what the workspace holds.
    expect(await storedBytes(ann.ownerId)).toBe(0);
  });
});

describe('a failure on the way', () => {
  it('tries a failed piece again, and keeps the file once', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const bytes = bytesOf(2 * PIECE + 1);
    // The store refuses the second piece, once.
    const put = h.deps.objects.put;
    let puts = 0;
    h.deps.objects.put = async (objectId, b) => { if (++puts === 2) throw new Error('the store is busy'); return put(objectId, b); };
    let media;
    try { media = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes)); } finally { h.deps.objects.put = put; }
    expect(puts).toBe(4);
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, media.id))).bytes, bytes)).toBe(true);
    expect((await rowsOf(owner))['workspace_media_pieces']).toBe(3);
    // Its one failure is on record, by request ID like any other; the browser only ever heard it failed.
    expect(h.logs.some((l) => l.includes('"level":50') && l.includes('the store is busy') && l.includes('/pieces/'))).toBe(true);
  });

  it('keeps a piece once when the answer to it is what got lost', async () => {
    let lost = false;
    const browser = cookieFetch(ORIGIN);
    // The first piece reaches the API and its answer never comes back.
    const flaky: typeof fetch = async (input, init) => {
      const res = await browser(input, init);
      if (!lost && String(input).includes('/pieces/0')) { lost = true; await res.arrayBuffer(); throw new TypeError('fetch failed'); }
      return res;
    };
    const ann = await account({ fetch: flaky });
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const bytes = bytesOf(PIECE + 3);
    const made = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    expect(lost).toBe(true);
    expect(await rowsOf(owner)).toEqual({ workspace_media: 1, workspace_media_pieces: 2, workspace_media_uses: 1 });
    // Nothing was stored twice, and nothing's left for upkeep to find.
    const sealed = (await h.pool.query<{ length: string }>('SELECT sum(length)::text AS length FROM workspace_media_pieces WHERE owner_id = $1', [owner])).rows[0]?.length;
    expect(String(await storedBytes(owner))).toBe(sealed);
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, made.id))).bytes, bytes)).toBe(true);
  });

  it('keeps going through a lost connection, longer than a moment, without sending again what got there', async () => {
    const browser = cookieFetch(ORIGIN);
    let down = false;
    const sent: string[] = [];
    const flaky: typeof fetch = async (input, init) => {
      const piece = /\/pieces\/(\d+)/.exec(String(input))?.[1];
      if (piece !== undefined && down) throw new TypeError('fetch failed');
      if (piece !== undefined) sent.push(piece);
      return browser(input, init);
    };
    const ann = await account({ fetch: flaky });
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const bytes = bytesOf(2 * PIECE + 1);
    // Wi-Fi hands over after the first piece, for longer than the few seconds a failure on the server gets.
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes), { onProgress: (p) => { if (p.sent === PIECE) { down = true; setTimeout(() => { down = false; }, 3500); } } });
    expect(sent).toEqual(['0', '1', '2']);
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, m.id))).bytes, bytes)).toBe(true);
  });

  it('keeps going through a front end’s own error pages, which say nothing but their status', async () => {
    const pages = [429, 502, 503, 504];
    const seen: number[] = [];
    const browser = cookieFetch(ORIGIN);
    const flaky: typeof fetch = async (input, init) => {
      const status = String(input).includes('/pieces/') ? pages.shift() : undefined;
      if (!status) return browser(input, init);
      seen.push(status);
      return new Response(`<html><body>${status}</body></html>`, { status, headers: { 'content-type': 'text/html' } });
    };
    const ann = await account({ fetch: flaky });
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const bytes = bytesOf(1000);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    expect(seen).toEqual([429, 502, 503, 504]);
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, m.id))).bytes, bytes)).toBe(true);
  });

  it('stops trying in the end, and takes back what got there', async () => {
    const browser = cookieFetch(ORIGIN);
    const flaky: typeof fetch = async (input, init) => {
      if (/\/pieces\/1/.test(String(input))) throw new TypeError('fetch failed');
      return browser(input, init);
    };
    const ann = await account({ fetch: flaky });
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const patient = createHttpApi({ baseUrl: h.baseUrl, fetch: flaky, mediaPatienceMs: 300 });
    expect(await patient.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 1))).catch((e: unknown) => errorCode(e))).toBe('network');
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
  });

  it('gives up on a piece that keeps failing and leaves nothing behind', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const put = h.deps.objects.put;
    let puts = 0;
    h.deps.objects.put = async (objectId, b) => { if (++puts > 1) throw new Error('the store has gone'); return put(objectId, b); };
    let outcome;
    try { outcome = await refusal(ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 1)))); } finally { h.deps.objects.put = put; }
    expect(outcome?.code).toBe('unknown');
    expect(outcome?.message).not.toContain('the store has gone');
    expect(puts).toBeGreaterThan(2);
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
    expect(await storedBytes(owner)).toBe(0);
    expect(await queued(owner)).toBe(0);
  });

  it('stops at once when the browser gives up, and takes back what got there', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const stop = new AbortController();
    const outcome = await refusal(ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(2 * PIECE + 1)), { signal: stop.signal, onProgress: () => stop.abort() }));
    expect(outcome?.code).toBe('network');
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
    expect(await storedBytes(owner)).toBe(0);
    // Never starts, once it's been given up on.
    expect(await code(ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(1)), { signal: stop.signal }))).toBe('network');
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
  });

  it('sweeps an upload whose browser went, with its objects, a day later', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const m = await started(ann, id, doc, 2 * PIECE);
    expect((await sendPiece(ann, `${place(id, doc)}/${m}/pieces/0`, bytesOf(PIECE))).status).toBe(200);
    const [object] = await objectsOf(owner);
    const kept = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(7)));
    expect(await stored(object ?? '')).toBe(true);
    expect(await storedBytes(owner)).toBeGreaterThan(PIECE);

    // Not while it could still be going, and only what nobody finished.
    expect((await maintain(h.deps)).uploads).toBe(0);
    expect((await rowsOf(owner))['workspace_media']).toBe(2);
    expect((await maintain(h.deps, { uploadAgeMs: ALREADY })).uploads).toBeGreaterThanOrEqual(1);
    expect(await rowsOf(owner)).toEqual({ workspace_media: 1, workspace_media_pieces: 1, workspace_media_uses: 1 });
    expect(await stored(object ?? '')).toBe(false);
    expect(await storedBytes(owner)).toBeLessThan(PIECE);
    expect((await read(ann, await ann.api.workspaces.media.url(id, doc, kept.id))).status).toBe(200);
    // A last piece on its way when it went has nowhere to land, whatever it holds.
    expect((await sendPiece(ann, `${place(id, doc)}/${m}/pieces/1`, bytesOf(8))).status).toBe(404);
  });

  it('sweeps each workspace on its own: one that fails stops none of the others, and goes next time', async () => {
    const ann = await account();
    const stuck = await workspace(ann, 'Stuck');
    const fine = await workspace(ann, 'Fine');
    await started(ann, stuck, await make(ann, stuck, 'document', 'Plan'), 8);
    await started(ann, fine, await make(ann, fine, 'document', 'Plan'), 8);
    const [stuckOwner, fineOwner] = [await ownerOf(stuck), await ownerOf(fine)];
    await h.pool.query(`CREATE FUNCTION refuse_a_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'not this one'; END $$ LANGUAGE plpgsql`);
    await h.pool.query(`CREATE TRIGGER refuse_a_delete BEFORE DELETE ON workspace_media FOR EACH ROW WHEN (OLD.owner_id = '${stuckOwner}') EXECUTE FUNCTION refuse_a_delete()`);
    try {
      await maintain(h.deps, { uploadAgeMs: ALREADY });
      expect((await rowsOf(fineOwner))['workspace_media']).toBe(0);
      expect((await rowsOf(stuckOwner))['workspace_media']).toBe(1);
      expect(h.logs.some((l) => l.includes('unfinished uploads not swept') && l.includes(stuck))).toBe(true);
    } finally {
      await h.pool.query('DROP TRIGGER refuse_a_delete ON workspace_media');
      await h.pool.query('DROP FUNCTION refuse_a_delete');
    }
    await maintain(h.deps, { uploadAgeMs: ALREADY });
    expect((await rowsOf(stuckOwner))['workspace_media']).toBe(0);
  });

  it('takes back an unfinished upload when asked', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const m = await started(ann, id, doc, PIECE + 1);
    expect((await sendPiece(ann, `${place(id, doc)}/${m}/pieces/0`, bytesOf(PIECE))).status).toBe(200);
    const [object] = await objectsOf(owner);
    const reader = await account();
    await ann.api.workspaces.addPerson(id, reader.email, 'read');
    expect(await code(reader.api.workspaces.media.remove(id, doc, m))).toBe('forbidden');
    await ann.api.workspaces.media.remove(id, doc, m);
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
    expect(await stored(object ?? '')).toBe(false);
    expect(await storedBytes(owner)).toBe(0);
    expect(await code(ann.api.workspaces.media.remove(id, doc, m))).toBe('not-found');
  });

  it('breaks the response when a piece can’t be read part way, so a file is never taken for whole, and says why by request ID', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(4 * PIECE + 1)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const [first, second] = await objectsOf(owner);
    const get = h.deps.objects.get;
    const failing = (objectId: string, ms: number) => { h.deps.objects.get = async (o) => { if (o === objectId) { if (ms) await new Promise((r) => setTimeout(r, ms)); throw new Error('the store has gone'); } return get(o); }; };

    // The first piece is read before anything is sent, so its failure is an answer like any other.
    failing(first ?? '', 0);
    try {
      const res = await ann.fetch(url);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain('the store has gone');
    } finally { h.deps.objects.get = get; }

    // A later one can only cut the response off, whether it said how long it would be or not, and however soon it fails.
    // Sooner than the first bytes reach the browser, there's no response at all: what matters is that it's never a whole one.
    const asked: [string, Record<string, string>][] = [['a range', { range: 'bytes=0-' }], ['the whole file', {}]];
    for (const [what, headers] of asked) {
      for (const ms of [0, 25]) {
        failing(second ?? '', ms);
        const requestId = `media-${ms}-${randomBytes(6).toString('hex')}`;
        try {
          const outcome = await ann.fetch(url, { headers: { ...headers, 'x-request-id': requestId } }).then((res) => res.arrayBuffer()).then((b) => `all ${b.byteLength} bytes`, () => 'cut off');
          expect([what, ms, outcome]).toEqual([what, ms, 'cut off']);
          await until(() => h.logs.some((l) => l.includes('couldn’t be read to the end') && l.includes(requestId)), 'the failure to be logged');
          expect(h.logs.find((l) => l.includes('couldn’t be read to the end') && l.includes(requestId))).toContain(m.id);
        } finally { h.deps.objects.get = get; }
      }
    }
    // It was never the file: it reads whole once the store is back.
    expect((await read(ann, url)).bytes.length).toBe(4 * PIECE + 1);
  });

  it('cuts a response off when a piece fails after the browser has been slow, as well as straight away', async () => {
    const ann = await withCookie();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(4 * PIECE + 1)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const third = (await objectsOf(owner))[2] ?? '';
    // The browser takes no more than is on its way and stops, so the server is waiting for it to catch up when the store goes.
    const paused = await stopped(ann, url);
    await new Promise((r) => setTimeout(r, 200));
    const get = h.deps.objects.get;
    h.deps.objects.get = async (o) => { if (o === third) throw new Error('the store has gone'); return get(o); };
    try {
      expect(await paused.rest()).toBe('cut');
    } finally { h.deps.objects.get = get; }
    // It got as far as the piece that failed, and no further.
    expect(paused.received()).toBeLessThanOrEqual(2 * PIECE);
    expect((await read(ann, url)).bytes.length).toBe(4 * PIECE + 1);
  });

  it('keeps a piece as bytes, a little over its own size, with nothing of it left to read', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const bytes = bytesOf(PIECE + 5);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    const [first, last] = await objectsOf(owner);
    const whole = Buffer.from(await h.objects.get(first ?? ''));
    expect(whole.length).toBeGreaterThan(PIECE);
    expect(whole.length).toBeLessThan(PIECE + 1024);
    expect((await h.objects.get(last ?? '')).length).toBeLessThan(1024);
    // Sealed, not just kept: no run of what was sent is in what's stored, and it reads back whole.
    for (const at of [0, 1000, PIECE - 64]) expect(whole.includes(Buffer.from(bytes.subarray(at, at + 32)))).toBe(false);
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, m.id))).bytes, bytes)).toBe(true);
  });

  it('refuses a piece that was changed or moved, whatever its digest says', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 1)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const [first, last] = await objectsOf(owner);
    const original = await h.objects.get(first ?? '');

    // Changed in the store.
    await h.objects.put(first ?? '', new Uint8Array([...original.slice(0, -1), 0]));
    expect((await refused(ann, url, 'bytes=0-1')).code).toBe('key-unavailable');
    await h.objects.put(first ?? '', original);
    expect((await read(ann, url, 'bytes=0-1')).status).toBe(206);

    // Changed, with its row saying so, so only its seal can tell: in what it says it is, in what it holds, in its last byte.
    const digestIs = (bytes: Uint8Array) => h.pool.query('UPDATE workspace_media_pieces SET sha256 = $2 WHERE object_id = $1', [first, createHash('sha256').update(bytes).digest()]);
    const digest = createHash('sha256').update(original).digest();
    for (const at of [10, Math.floor(original.length / 2), original.length - 1]) {
      const changed = new Uint8Array(original);
      changed[at] = (changed[at] ?? 0) ^ 1;
      await h.objects.put(first ?? '', changed);
      await digestIs(changed);
      expect((await refused(ann, url, 'bytes=0-1')).code).toBe('key-unavailable');
    }
    await h.objects.put(first ?? '', original);
    await h.pool.query('UPDATE workspace_media_pieces SET sha256 = $2 WHERE object_id = $1', [first, digest]);

    // Moved: a real piece of this file, with its row saying so, in another piece's place.
    const moved = await h.objects.get(last ?? '');
    await h.objects.put(first ?? '', moved);
    await h.pool.query(`UPDATE workspace_media_pieces SET sha256 = (SELECT sha256 FROM workspace_media_pieces WHERE object_id = $2) WHERE object_id = $1`, [first, last]);
    expect((await refused(ann, url, 'bytes=0-1')).code).toBe('key-unavailable');
  });
});

describe('who can read a file', () => {
  it('is whoever can open a document that has it: everyone else gets what they’d get for an ID nobody has', async () => {
    const ann = await account();
    const theo = await account();
    const kofi = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const folder = await make(ann, id, 'folder', 'Folder');
    const bytes = bytesOf(64);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes, 'CANARY-NAME.png'));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const nobody = await nothing();
    expect(nobody).toMatchObject({ status: 404, code: 'not-found' });

    // Someone in the workspace reads it with their own URL.
    const theirs = await theo.api.workspaces.media.url(id, doc, m.id);
    expect(same((await read(theo, theirs)).bytes, bytes)).toBe(true);

    // Nobody signed in, in a call or in the workspace gets anything, and no answer tells them it's there.
    const media = kofi.api.workspaces.media;
    expect(await refusal(media.url(id, doc, m.id))).toEqual(await refusal(media.url(madeUp(), doc, m.id)));
    expect(await refusal(media.list(id))).toEqual(await refusal(media.list(madeUp())));
    expect(await code(h.browser().api.workspaces.media.url(id, doc, m.id))).toBe('unauthenticated');
    expect(await code(h.browser().api.workspaces.media.list(id))).toBe('unauthenticated');

    // Within a workspace it's open to you: a document or file that doesn't exist, or isn't a document, all read the same.
    const w = theo.api.workspaces.media;
    expect(await refusal(w.url(id, doc, madeUp()))).toEqual(await refusal(w.url(id, doc, 'not an id')));
    expect(await refusal(w.url(id, madeUp(), m.id))).toEqual(await refusal(w.url(id, folder, m.id)));

    // Having a URL is nothing: it's someone else's, so it opens nothing in anyone else's browser or in none.
    expect(await refused(kofi, url)).toEqual(nobody);
    expect(await refused(theo, url)).toEqual(nobody);
    expect(await refused({ fetch }, url)).toEqual(nobody);
    expect(await refused({ fetch }, url, 'bytes=0-1')).toEqual(nobody);
  });

  it('takes `edit` to add one, in the tree, and only reading to read one in Trash', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const other = await make(ann, id, 'document', 'Other');
    const bytes = bytesOf(32);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    const reads = theo.api.workspaces.media;
    expect(await code(reads.upload(id, doc, fileOf(bytesOf(4))))).toBe('forbidden');
    expect(await code(reads.attach(id, other, m.id))).toBe('forbidden');
    const going = await started(ann, id, doc, 8);
    expect((await sendPiece(theo, `${place(id, doc)}/${going}/pieces/0`, bytesOf(8))).status).toBe(403);
    expect((await json(theo, `${place(id, doc)}/${going}/finish`, {})).status).toBe(403);
    expect(await count('SELECT count(*)::int AS n FROM workspace_media WHERE owner_id = $1', [await ownerOf(id)])).toBe(2);

    // Someone given a document at `edit` can add to it, and to nothing else.
    const priya = await account();
    await ann.api.workspaces.share.set(id, other, [{ email: priya.email }], 'edit');
    const hers = await priya.api.workspaces.media.upload(id, other, fileOf(bytesOf(4)));
    expect(hers.documents).toEqual([other]);
    expect(await code(priya.api.workspaces.media.upload(id, doc, fileOf(bytesOf(4))))).toBe('not-found');

    await ann.api.workspaces.items.trash(id, doc);
    expect(same((await read(theo, await reads.url(id, doc, m.id))).bytes, bytes)).toBe(true);
    expect(await code(ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(4))))).toBe('conflict');
    expect(await code(ann.api.workspaces.media.attach(id, doc, hers.id))).toBe('conflict');
    expect((await sendPiece(ann, `${place(id, doc)}/${going}/pieces/0`, bytesOf(8))).status).toBe(409);
  });

  it('stops at once for someone who loses the document: their very next range gets not-found, and comes back if it does', async () => {
    const ann = await account();
    const priya = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const bytes = bytesOf(PIECE + 100);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    await ann.api.workspaces.share.set(id, doc, [{ email: priya.email }], 'read');
    const url = await priya.api.workspaces.media.url(id, doc, m.id);
    expect((await read(priya, url, 'bytes=0-99')).status).toBe(206);
    expect((await read(priya, url, `bytes=${PIECE}-`)).status).toBe(206);

    const entry = (await ann.api.workspaces.share.list(id, doc)).entries[0]?.id ?? '';
    await ann.api.workspaces.share.remove(id, doc, entry);
    const nobody = await nothing();
    expect(await refused(priya, url, 'bytes=100-199')).toEqual(nobody);
    expect(await refused(priya, url)).toEqual(nobody);
    expect(await refusal(priya.api.workspaces.media.url(id, doc, m.id))).toEqual(await refusal(priya.api.workspaces.media.url(madeUp(), doc, m.id)));

    // It only ever said who was asking, so the same URL answers again the moment they have it again.
    await ann.api.workspaces.share.set(id, doc, [{ email: priya.email }], 'read');
    expect(same((await read(priya, url, 'bytes=0-9')).bytes, bytes.subarray(0, 10))).toBe(true);

    // A workspace's people lose it the same ways: restricted away from them, or taken out.
    const theirs = await theo.api.workspaces.media.url(id, doc, m.id);
    expect((await read(theo, theirs, 'bytes=0-0')).status).toBe(206);
    await ann.api.workspaces.share.restrict(id, doc, true);
    expect(await refused(theo, theirs, 'bytes=1-1')).toEqual(nobody);
    await ann.api.workspaces.share.restrict(id, doc, false);
    expect((await read(theo, theirs, 'bytes=1-1')).status).toBe(206);
    const person = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email)?.id ?? '';
    await ann.api.workspaces.removePerson(id, person);
    expect(await refused(theo, theirs, 'bytes=2-2')).toEqual(nobody);
  });

  it('keeps a file in a restricted document from everyone it’s restricted from, in the list too', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const secret = await make(ann, id, 'document', 'Secret');
    const open = await make(ann, id, 'document', 'Open');
    await ann.api.workspaces.share.restrict(id, secret, true);
    const hidden = await ann.api.workspaces.media.upload(id, secret, fileOf(bytesOf(8), 'CANARY-RESTRICTED.png'));
    const shown = await ann.api.workspaces.media.upload(id, open, fileOf(bytesOf(8), 'shown.png'));

    expect((await ann.api.workspaces.media.list(id)).map((m) => m.name)).toEqual(['shown.png', 'CANARY-RESTRICTED.png']);
    const theirs = await theo.api.workspaces.media.list(id);
    expect(theirs.map((m) => m.id)).toEqual([shown.id]);
    expect(JSON.stringify(theirs)).not.toContain('CANARY');
    expect(await refusal(theo.api.workspaces.media.url(id, secret, hidden.id))).toEqual(await refusal(theo.api.workspaces.media.url(id, madeUp(), hidden.id)));

    // A file in both shows only what you can open of where it is.
    await ann.api.workspaces.media.attach(id, open, hidden.id);
    expect((await theo.api.workspaces.media.list(id)).find((m) => m.id === hidden.id)?.documents).toEqual([open]);
    expect((await ann.api.workspaces.media.list(id)).find((m) => m.id === hidden.id)?.documents.sort()).toEqual([open, secret].sort());
    expect(await code(theo.api.workspaces.media.url(id, secret, hidden.id))).toBe('not-found');
    expect((await theo.api.workspaces.media.url(id, open, hidden.id))).toMatch(/\/v1\/media\//);
  });

  it('never reaches across workspaces, or from one document to another, whatever ID comes in', async () => {
    const ann = await account();
    const one = await workspace(ann, 'One');
    const two = await workspace(ann, 'Two');
    const docOne = await make(ann, one, 'document', 'Here');
    const sibling = await make(ann, one, 'document', 'Next to it');
    const docTwo = await make(ann, two, 'document', 'There');
    const here = await ann.api.workspaces.media.upload(one, docOne, fileOf(bytesOf(8)));
    const there = await ann.api.workspaces.media.upload(two, docTwo, fileOf(bytesOf(8)));
    const unfinished = await started(ann, two, docTwo, 8);
    const media = ann.api.workspaces.media;

    // Ann has both workspaces, so nothing here is stopped by who she is: an ID from elsewhere just names nothing.
    const none = await refusal(media.url(one, docOne, madeUp()));
    expect(none?.code).toBe('not-found');
    expect(await refusal(media.url(one, docOne, there.id))).toEqual(none);
    expect(await refusal(media.url(one, sibling, here.id))).toEqual(none);
    expect(await refusal(media.attach(one, docOne, there.id))).toEqual(none);
    expect(await refusal(media.remove(one, docOne, unfinished))).toEqual(none);
    expect(await code(media.url(one, docTwo, there.id))).toBe('not-found');
    expect(await code(media.upload(one, docTwo, fileOf(bytesOf(4))))).toBe('not-found');
    expect(await code(media.attach(two, docOne, here.id))).toBe('not-found');
    for (const url of [`${place(one, docOne)}/${unfinished}/finish`, `${place(one, docTwo)}/${unfinished}/finish`]) expect((await json(ann, url, {})).status).toBe(404);
    for (const url of [`${place(one, docOne)}/${unfinished}/pieces/0`, `${place(one, docTwo)}/${unfinished}/pieces/0`]) expect((await sendPiece(ann, url, bytesOf(8))).status).toBe(404);
    expect((await media.list(one)).map((m) => m.id)).toEqual([here.id]);
    expect((await media.list(two)).map((m) => m.id)).toEqual([there.id]);
  });
});

describe('a picture’s preview', () => {
  /** A small JPEG, as the uploading browser makes one, with words in it that must never be readable anywhere but here. */
  const previewOf = (words: string, width = 320, height = 213) => pictureJpeg(width, height, words);
  /** What `preview` hands back, read as bytes: null when there's none. */
  async function previewBytes(who: Account, id: string, doc: string, mediaId: string): Promise<Buffer | null> {
    const url = await who.api.workspaces.media.preview(id, doc, mediaId);
    if (url === null) return null;
    const blob = resolveObjectURL(url);
    URL.revokeObjectURL(url);
    return blob ? Buffer.from(await blob.arrayBuffer()) : null;
  }
  const previewRows = (owner: string) => h.pool.query<{ media_id: string; object_id: string; length: number }>('SELECT media_id, object_id, length FROM workspace_media_previews WHERE owner_id = $1', [owner]).then((r) => r.rows);
  const keep = (who: { fetch: typeof fetch }, id: string, doc: string, mediaId: string, body: Uint8Array<ArrayBuffer>, type = 'image/jpeg') =>
    who.fetch(`${place(id, doc)}/${mediaId}/preview`, { method: 'POST', headers: { 'content-type': type }, body });

  it('is kept sealed beside a picture as it’s uploaded, and read back by whoever can read the picture', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const jpeg = previewOf('CANARY-PREVIEW-WORDS');
    const before = await storedBytes(owner);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(4096)), { width: 1600, height: 1066, preview: new Blob([jpeg], { type: 'image/jpeg' }) });
    expect(same(await previewBytes(ann, id, doc, m.id) ?? new Uint8Array(), jpeg)).toBe(true);
    // One row, one object under a random name, sealed: the words are in no row, no object and no log.
    const [row] = await previewRows(owner);
    expect(row).toMatchObject({ media_id: m.id });
    const sealed = Buffer.from(await h.objects.get(row?.object_id ?? ''));
    expect(sealed.includes(Buffer.from('CANARY-PREVIEW-WORDS'))).toBe(false);
    expect(sealed.includes(Buffer.from(jpeg.subarray(0, 64)))).toBe(false);
    expect(h.logs.join('').includes('CANARY-PREVIEW-WORDS')).toBe(false);
    // It's counted with the file, towards what the workspace stores.
    expect(await storedBytes(owner)).toBe(before + (await count('SELECT bytes::int AS n FROM workspace_media WHERE owner_id = $1 AND media_id = $2', [owner, m.id])));
    expect(await count('SELECT bytes::int AS n FROM workspace_media WHERE owner_id = $1 AND media_id = $2', [owner, m.id])).toBeGreaterThan(4096 + (row?.length ?? 0) - 1);

    // Sealed to its file and its place: put under another file's row, it doesn't open.
    const other = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(64)), { preview: new Blob([previewOf('other')], { type: 'image/jpeg' }) });
    const otherRow = (await previewRows(owner)).find((r) => r.media_id === other.id);
    const theirs = await h.objects.get(otherRow?.object_id ?? '');
    await h.objects.put(otherRow?.object_id ?? '', sealed);
    await h.pool.query('UPDATE workspace_media_previews SET sha256 = (SELECT sha256 FROM workspace_media_previews WHERE owner_id = $1 AND media_id = $3) WHERE owner_id = $1 AND media_id = $2', [owner, other.id, m.id]);
    expect(await code(ann.api.workspaces.media.preview(id, doc, other.id))).not.toBe('allowed');
    await h.objects.put(otherRow?.object_id ?? '', theirs);
  });

  it('isn’t there for a picture uploaded before previews, which is still read whole, and is kept once', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const bytes = bytesOf(2048);
    const old = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    expect(await ann.api.workspaces.media.preview(id, doc, old.id)).toBeNull();
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, old.id))).bytes, bytes)).toBe(true);
    // Kept once: whatever's sent after the first changes nothing.
    expect((await keep(ann, id, doc, old.id, previewOf('first'))).status).toBe(200);
    expect((await keep(ann, id, doc, old.id, previewOf('second'))).status).toBe(200);
    expect((await previewBytes(ann, id, doc, old.id))?.toString('latin1')).toContain('first');
    expect(await previewRows(owner)).toHaveLength(1);
  });

  it('is a small JPEG of a finished picture, kept by someone who can edit it', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const picture = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(64)));
    const file = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(64), 'brief.pdf', 'application/pdf'));
    const unfinished = await started(ann, id, doc, 64);
    const status = async (r: Promise<Response>) => (await r).status;
    expect(await status(keep(ann, id, doc, picture.id, new Uint8Array(randomBytes(64)), 'image/jpeg'))).toBe(400);
    expect(await status(keep(ann, id, doc, picture.id, previewOf('png'), 'image/png'))).toBe(400);
    expect(await status(keep(ann, id, doc, picture.id, previewOf('big', 1600, 1066)))).toBe(400);
    expect(await status(keep(ann, id, doc, picture.id, new Uint8Array(MAX_MEDIA_PREVIEW_BYTES + 1)))).toBe(400);
    expect(await status(keep(ann, id, doc, file.id, previewOf('pdf')))).toBe(400);
    expect(await status(keep(ann, id, doc, unfinished, previewOf('unfinished')))).toBe(404);
    // Theo can read it, so he reads the preview Ann keeps, but he can't keep one himself.
    expect(await status(keep(theo, id, doc, picture.id, previewOf('theo')))).toBe(403);
    expect(await previewRows(owner)).toEqual([]);
    expect(await status(keep(ann, id, doc, picture.id, previewOf('ann')))).toBe(200);
    expect((await previewBytes(theo, id, doc, picture.id))?.toString('latin1')).toContain('ann');
  });

  it('is read only by people who can read the picture, through a document that has it, and never across owners', async () => {
    const ann = await account();
    const theo = await account();
    const kofi = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const elsewhere = await workspace(kofi, 'Theirs');
    const kofisDoc = await make(kofi, elsewhere, 'document', 'Theirs');
    const secret = await make(ann, id, 'document', 'Secret');
    const open = await make(ann, id, 'document', 'Open');
    await ann.api.workspaces.share.restrict(id, secret, true);
    const m = await ann.api.workspaces.media.upload(id, secret, fileOf(bytesOf(64)), { preview: new Blob([previewOf('secret')], { type: 'image/jpeg' }) });
    // Each refusal is the one for something that isn't there: a document nobody has, or a file nobody has in it.
    expect(await refusal(theo.api.workspaces.media.preview(id, secret, m.id))).toEqual(await refusal(theo.api.workspaces.media.preview(id, madeUp(), m.id)));
    expect(await refusal(theo.api.workspaces.media.preview(id, open, m.id))).toEqual(await refusal(theo.api.workspaces.media.preview(id, open, madeUp())));
    expect(await code(kofi.api.workspaces.media.preview(id, secret, m.id))).toBe('not-found');
    expect(await code(kofi.api.workspaces.media.preview(elsewhere, kofisDoc, m.id))).toBe('not-found');
    expect(await code(h.browser().api.workspaces.media.preview(id, secret, m.id))).not.toBe('allowed');
    // Reused where Theo can read it, he reads its preview there, and only there.
    await ann.api.workspaces.media.attach(id, open, m.id);
    expect((await previewBytes(theo, id, open, m.id))?.toString('latin1')).toContain('secret');
    expect(await code(theo.api.workspaces.media.preview(id, secret, m.id))).toBe('not-found');
  });

  it('goes with its picture, object and all', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const owner = await ownerOf(id);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(64)), { preview: new Blob([previewOf('gone')], { type: 'image/jpeg' }) });
    const [row] = await previewRows(owner);
    await ann.api.workspaces.media.remove(id, doc, m.id);
    expect(await previewRows(owner)).toEqual([]);
    expect(await stored(row?.object_id ?? '')).toBe(false);
    expect(await storedBytes(owner)).toBe(0);
    // And with its workspace.
    const again = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(64)), { preview: new Blob([previewOf('again')], { type: 'image/jpeg' }) });
    const [kept] = await previewRows(owner);
    expect(kept?.media_id).toBe(again.id);
    await ann.api.workspaces.remove(id);
    await maintain(h.deps);
    expect(await stored(kept?.object_id ?? '')).toBe(false);
  });
});

describe('a file’s URL', () => {
  const payloadOf = (url: string): unknown => JSON.parse(Buffer.from((url.split('/').at(-1) ?? '').split('.')[0] ?? '', 'base64url').toString());

  it('says only who is asking and what for, and is signed, so changing a word of it opens nothing', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const a = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8), 'CANARY-URL-NAME.png'));
    const b = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const url = await ann.api.workspaces.media.url(id, doc, a.id);
    expect(url).not.toContain('CANARY');
    const said = z.object({ v: z.literal(1), account: z.string(), seat: z.null(), workspaceId: z.string(), documentId: z.string(), mediaId: z.string(), exp: z.number() }).strict().parse(payloadOf(url));
    expect(said).toMatchObject({ account: ann.ownerId, workspaceId: id, documentId: doc, mediaId: a.id });

    // Pointed at another file, with the signature it came with.
    const token = url.split('/').at(-1) ?? '';
    const [, tag] = token.split('.');
    const changed = Buffer.from(JSON.stringify({ ...said, mediaId: b.id })).toString('base64url');
    const nobody = await nothing();
    expect(await refused(ann, url.replace(token, `${changed}.${tag}`))).toEqual(nobody);
    // Or with no signature, a signature made up, or not a token at all.
    for (const bad of [changed, `${changed}.`, `${changed}.${randomBytes(32).toString('base64url')}`, 'x', 'x.y.z', 'x'.repeat(5000), '%00']) expect([bad.slice(0, 8), await refused(ann, url.replace(token, bad))]).toEqual([bad.slice(0, 8), nobody]);
    expect((await read(ann, url)).status).toBe(200);
  });

  it('lasts 12 hours, and is as good at the end as at the start', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const nobody = await nothing();
    const at = Date.now();
    // Only as far as the token: the object store's client signs by the same clock, and it must never see this one.
    const asked = (head: boolean) => ann.fetch(url, { method: head ? 'HEAD' : 'GET' });
    const later = vi.spyOn(Date, 'now');
    later.mockReturnValue(at + 12 * 60 * 60_000 - 60_000);
    expect((await asked(true)).status).toBe(200);
    later.mockReturnValue(at + 12 * 60 * 60_000 + 60_000);
    const res = await asked(false);
    later.mockRestore();
    expect([res.status, Refused.parse(await res.json()).message]).toEqual([404, nobody.message]);
    // Asking again gives one that works.
    expect((await read(ann, await ann.api.workspaces.media.url(id, doc, m.id))).status).toBe(200);
  });

  it('works only with its account’s own session, so it stops when that does', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const nobody = await nothing();
    // Her other browser is her too.
    const elsewhere = await account({ email: ann.email });
    expect(elsewhere.ownerId).toBe(ann.ownerId);
    expect((await read(elsewhere, url)).status).toBe(200);
    await ann.api.auth.signOut();
    expect(await refused(ann, url)).toEqual(nobody);
    expect((await read(elsewhere, url)).status).toBe(200);
  });

  it('never reaches a log, a failed request’s included', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const token = url.split('/').at(-1) ?? '';
    const before = h.logs.length;
    await read(ann, url);
    await refused({ fetch }, url);
    await read(ann, `${url}x`);
    // A page that reports a picture it couldn't load might quote where it was: as much as a browser's report takes of a URL.
    const quoted = url.slice(0, 300);
    await ann.api.diagnostics.report([{ level: 'warn', msg: 'picture failed', context: { src: quoted }, at: new Date().toISOString() }]);
    await until(() => h.logs.slice(before).some((l) => l.includes('picture failed')), 'the browser’s report');
    const lines = h.logs.slice(before);
    expect(lines.filter((l) => l.includes('"path":"/v1/media/:token"')).length).toBeGreaterThanOrEqual(6);
    expect(lines.find((l) => l.includes('picture failed'))).toContain('/v1/media/[token]');
    expect(lines.join('')).not.toContain('/v1/media/ey');
    for (const part of [token, ...token.split('.'), quoted.split('/').at(-1) ?? 'nothing quoted']) expect(h.logs.join('').includes(part), 'a token in the logs').toBe(false);
  });
});

describe('guests in a call', () => {
  const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
  async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
    for (let i = 0; i < 200 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
    return call.getSnapshot();
  }
  /** A call `org` is in, and `guests` joining by its link and let in. */
  async function callWith(org: Account, guests: string[]) {
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    await inGroup(host);
    const joined: { api: AlcoveApi; fetch: typeof fetch; call: CallSession; pass: string; seat: string }[] = [];
    for (const name of guests) {
      const b = h.browser();
      const call = await b.api.calls.join(c, { mic: false, cam: false, name });
      await settle(host, (s) => s.waiting.some((w) => w.id === call.ticket.identity));
      await host.admit(call.ticket.identity);
      await inGroup(call);
      const seat = (await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity))).participants.find((p) => p.id === call.ticket.identity)?.seat ?? '';
      joined.push({ api: b.api, fetch: b.fetch, call, pass: call.ticket.pass, seat });
    }
    return { code: c, host, guests: joined };
  }

  it('see the pictures of the document their seat covers, and no others, for as long as they’re in the seat', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const agenda = await make(org, id, 'document', 'Agenda');
    const other = await make(org, id, 'document', 'Not for guests');
    const bytes = bytesOf(PIECE + 50);
    const shown = await org.api.workspaces.media.upload(id, agenda, fileOf(bytes));
    const hidden = await org.api.workspaces.media.upload(id, other, fileOf(bytesOf(8), 'CANARY-GUEST.png'));
    const { host, guests } = await callWith(org, ['Sam Guest', 'Jo Guest']);
    const [sam, jo] = guests;
    if (!sam || !jo) throw new Error('nobody joined');
    const m = sam.api.workspaces.media;
    const opts = { pass: sam.pass };

    // Joining a call gives nothing.
    expect(await refusal(m.url(id, agenda, shown.id, opts))).toEqual(await refusal(m.url(madeUp(), agenda, shown.id, opts)));
    expect(await code(m.list(id, opts))).toBe('not-found');
    await org.api.workspaces.share.set(id, agenda, [{ seat: sam.seat }, { seat: jo.seat }], 'read', { pass: host.ticket.pass });

    // No cookie and no header, as an `<img>` in a guest's browser reads it, by its URL alone.
    const url = await m.url(id, agenda, shown.id, opts);
    expect(same((await read({ fetch }, url)).bytes, bytes)).toBe(true);
    const part = await read({ fetch }, url, `bytes=${PIECE - 5}-${PIECE + 4}`);
    expect([part.status, same(part.bytes, bytes.subarray(PIECE - 5, PIECE + 5))]).toEqual([206, true]);
    // The URL names a seat: nothing of a call's pass, which never goes in a URL, and nothing of who's in the seat.
    const [, passTag] = sam.pass.split('.');
    expect(url).not.toContain(sam.pass);
    expect(url).not.toContain(passTag);
    // And a pass is no token: signed under another key, it reads nothing here, with or without the header it belongs in.
    const passUrl = `${h.baseUrl}/v1/media/${sam.pass}`;
    expect(await refused({ fetch }, passUrl)).toEqual(await nothing());
    expect(await refused({ fetch: (u, init) => fetch(u, { ...init, headers: { 'x-alcove-call': sam.pass } }) }, passUrl)).toEqual(await nothing());
    const said = z.object({ account: z.null(), seat: z.object({ callId: z.string(), organizer: z.string(), seat: z.string() }).strict() }).parse(JSON.parse(Buffer.from((url.split('/').at(-1) ?? '').split('.')[0] ?? '', 'base64url').toString()));
    expect(said.seat.seat).toBe(sam.seat);
    expect(said.seat.callId).toBe(sam.call.ticket.callId);

    // Its pictures and no others: not through their document, not through the other one, and not in the list.
    expect(await refusal(m.url(id, agenda, hidden.id, opts))).toEqual(await refusal(m.url(id, agenda, madeUp(), opts)));
    expect(await refusal(m.url(id, other, hidden.id, opts))).toEqual(await refusal(m.url(id, madeUp(), hidden.id, opts)));
    const theirs = await m.list(id, opts);
    expect(theirs.map((x) => [x.id, x.documents])).toEqual([[shown.id, [agenda]]]);
    expect(JSON.stringify(theirs)).not.toContain('CANARY');
    // Without their pass they're nobody.
    expect(await code(m.url(id, agenda, shown.id))).toBe('unauthenticated');

    // A seat at `read` adds nothing. One at `edit` adds to its document, and reads what it added.
    expect(await code(m.upload(id, agenda, fileOf(bytesOf(4)), opts))).toBe('forbidden');
    await org.api.workspaces.share.set(id, agenda, [{ seat: sam.seat }], 'edit', { pass: host.ticket.pass });
    const fromGuest = await m.upload(id, agenda, fileOf(bytesOf(PIECE + 1), 'from-a-guest.png'), opts);
    expect((await read({ fetch }, await m.url(id, agenda, fromGuest.id, opts), 'bytes=0-3')).status).toBe(206);
    expect(await code(m.upload(id, other, fileOf(bytesOf(4)), opts))).toBe('not-found');
    expect(await code(m.attach(id, other, fromGuest.id, opts))).toBe('not-found');
    expect((await org.api.workspaces.media.list(id)).map((x) => x.name)).toContain('from-a-guest.png');

    // Taken out of the call: at once, on the next range. The other guest's seat stands.
    URL.revokeObjectURL(await sam.api.workspaces.media.picture(id, agenda, shown.id, { pass: sam.pass }));
    const joUrl = await jo.api.workspaces.media.url(id, agenda, shown.id, { pass: jo.pass });
    expect((await read({ fetch }, joUrl, 'bytes=0-0')).status).toBe(206);
    await host.remove(jo.call.ticket.identity);
    const nobody = await nothing();
    expect(await refused({ fetch }, joUrl, 'bytes=1-1')).toEqual(nobody);
    expect((await read({ fetch }, url, 'bytes=1-1')).status).toBe(206);

    // The call ending ends every seat.
    await host.leave();
    expect(await refused({ fetch }, url, 'bytes=2-2')).toEqual(nobody);
  });

  it('have one allowance for asking for URLs and reading them, however they spend it', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const doc = await make(org, id, 'document', 'Agenda');
    const m = await org.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const { host, guests } = await callWith(org, ['Sam Guest']);
    const [sam] = guests;
    if (!sam) throw new Error('nobody joined');
    await org.api.workspaces.share.set(id, doc, [{ seat: sam.seat }], 'read', { pass: host.ticket.pass });
    const media = sam.api.workspaces.media;
    const opts = { pass: sam.pass };
    const url = await media.url(id, doc, m.id, opts);
    let spent = 1;
    for (; spent < MEDIA_LIMITS.readsAMinute; spent += 2) {
      expect((await read({ fetch }, url, 'bytes=0-0')).status).toBe(206);
      if (spent + 1 < MEDIA_LIMITS.readsAMinute) await media.url(id, doc, m.id, opts);
    }
    expect((await refused({ fetch }, url, 'bytes=0-0')).code).toBe('unavailable');
    expect(await code(media.url(id, doc, m.id, opts))).toBe('unavailable');
    await host.leave();
  });

  it('lose a picture when they leave, even if what the call gave them is still on its row', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const doc = await make(org, id, 'document', 'Agenda');
    const m = await org.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const { host, guests } = await callWith(org, ['Sam Guest']);
    const [sam] = guests;
    if (!sam) throw new Error('nobody joined');
    await org.api.workspaces.share.set(id, doc, [{ seat: sam.seat }], 'read', { pass: host.ticket.pass });
    const url = await sam.api.workspaces.media.url(id, doc, m.id, { pass: sam.pass });
    expect((await read({ fetch }, url)).status).toBe(200);
    await sam.call.leave();
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE kind = 'seat' AND document_id = $1", [doc])).toBe(1);
    expect(await refused({ fetch }, url)).toEqual(await nothing());
    await host.leave();
  });

  it('put a picture on a board the call opens, which takes it when it’s deleted, as any document does', async () => {
    const org = await account();
    const { host, guests } = await callWith(org, ['Sam Guest']);
    const [sam] = guests;
    if (!sam) throw new Error('nobody joined');
    // A board the call opens is made in its workspace, the one the organizer makes in it, in the call's folder.
    await withWorkspace(host);
    await host.openBoard({ template: 'blank' });
    const id = host.getSnapshot().board.open?.workspaceId ?? '';
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const owner = await ownerOf(id);
    // Everyone in the call can work on it, so the guest's seat is enough to put a picture on it and see it.
    await until(async () => (await count("SELECT count(*)::int AS n FROM document_access WHERE owner_id = $1 AND document_id = $2 AND kind = 'seat'", [owner, board])) === 1, 'the guest’s seat on the board');
    const opts = { pass: sam.pass };
    const bytes = bytesOf(PIECE + 1);
    const picture = await sam.api.workspaces.media.upload(id, board, fileOf(bytes), opts);
    expect(same((await read({ fetch }, await sam.api.workspaces.media.url(id, board, picture.id, opts))).bytes, bytes)).toBe(true);
    const objects = await objectsOf(owner);
    expect(objects).toHaveLength(2);

    // Deleted for good, the board takes it: rows, stored bytes and objects.
    await org.api.workspaces.items.trash(id, board);
    await org.api.workspaces.items.deleteForever(id, board);
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
    for (const o of objects) expect(await stored(o)).toBe(false);
    expect(await storedBytes(owner)).toBe(0);
    expect(await queued(owner)).toBe(0);
  });

  it('have their day counted in the database by nothing that names them, so another instance or a restart counts it', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const agenda = await make(org, id, 'document', 'Agenda');
    const { host, guests } = await callWith(org, ['Sam Guest']);
    const [sam] = guests;
    if (!sam) throw new Error('nobody joined');
    await org.api.workspaces.share.set(id, agenda, [{ seat: sam.seat }], 'edit', { pass: host.ticket.pass });
    // Under a blind index of the person their pass names, never the pass, the person, the call or a name.
    const index = blindIndex(masterKey(h.deps), 'upload-guest', readPass(h.deps.cfg, sam.pass)?.person ?? '');
    const days = async () => (await h.pool.query<{ day: string; bytes: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, bytes::text AS bytes FROM media_guest_upload_days WHERE guest_index = $1 ORDER BY day", [index])).rows.map((r) => [r.day, Number(r.bytes)]);
    const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const send = (api: AlcoveApi, bytes: number) => api.workspaces.media.upload(id, agenda, fileOf(bytesOf(bytes)), { pass: sam.pass });
    await h.setLimit('media.account_day_bytes', 3 * MiB);
    await send(sam.api, 2 * MiB);
    expect(await days()).toEqual([[ago(0), 2 * MiB]]);
    // Another process, as after a restart, counts what this one did, because it reads it from the database every time.
    const second = await h.secondServer();
    try {
      const again = createHttpApi({ baseUrl: second.baseUrl, fetch: sam.fetch });
      expect(await refusal(send(again, 2 * MiB))).toEqual(TODAYS);
      await h.pool.query('DELETE FROM media_guest_upload_days WHERE guest_index = $1', [index]);
      await send(again, 2 * MiB);
    } finally { await second.close(); }
    // Upkeep keeps today and yesterday, and nothing older.
    await h.pool.query('INSERT INTO media_guest_upload_days (guest_index, day, bytes) VALUES ($1, $2, 1), ($1, $3, 1)', [index, ago(1), ago(2)]);
    await maintain(h.deps, { uploadAgeMs: ALREADY });
    expect((await days()).map(([d]) => d)).toEqual([ago(1), ago(0)]);
  });

  it('can’t delete a picture for good through their seat, so it stays where it’s reused, and the organizer still can', async () => {
    const org = await account();
    const { host, guests } = await callWith(org, ['Sam Guest']);
    const [sam] = guests;
    if (!sam) throw new Error('nobody joined');
    // The board is made in the call's workspace, and the document that reuses its picture is there too.
    await withWorkspace(host);
    await host.openBoard({ template: 'blank' });
    const id = host.getSnapshot().board.open?.workspaceId ?? '';
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const owner = await ownerOf(id);
    const reused = await make(org, id, 'document', 'Reused here');
    await until(async () => (await count("SELECT count(*)::int AS n FROM document_access WHERE owner_id = $1 AND document_id = $2 AND kind = 'seat'", [owner, board])) === 1, 'the guest’s seat on the board');
    const opts = { pass: sam.pass };
    const bytes = bytesOf(16);
    const picture = await sam.api.workspaces.media.upload(id, board, fileOf(bytes, 'CANARY-SEAT.png'), opts);
    await org.api.workspaces.media.attach(id, reused, picture.id);
    const objects = await objectsOf(owner);

    // A seat is for working on the board, and taking its picture out of it would be that. Deleting the file for everyone
    // isn't: an ordinary refusal, which names nothing, here or in the log.
    const from = h.logs.length;
    expect(await refusal(sam.api.workspaces.media.remove(id, board, picture.id, opts))).toEqual(SEAT_ONLY);
    expect(logsSince(from).filter((l) => l.msg === SEAT_ONLY.message).map((l) => l.level)).toEqual([30]);
    expect(h.logs.slice(from).join('\n')).not.toContain('CANARY-SEAT');
    // Nothing went: it's on the board for them still, and in the document that reuses it, which they can't open.
    expect(same((await read({ fetch }, await sam.api.workspaces.media.url(id, board, picture.id, opts))).bytes, bytes)).toBe(true);
    expect(same((await read(org, await org.api.workspaces.media.url(id, reused, picture.id))).bytes, bytes)).toBe(true);
    expect(await rowsOf(owner)).toEqual({ workspace_media: 1, workspace_media_pieces: 1, workspace_media_uses: 2 });

    // The organizer can edit the board as one of the workspace's people, so it's theirs to delete, from everywhere.
    await org.api.workspaces.media.remove(id, board, picture.id);
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
    for (const o of objects) expect(await stored(o)).toBe(false);
    expect(await code(org.api.workspaces.media.url(id, reused, picture.id))).toBe('not-found');
  });

  it('read with their seat and their account together, each counting for what it gives', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const bySeat = await make(org, id, 'document', 'By the seat');
    const byAccount = await make(org, id, 'document', 'By the account');
    const onSeat = await org.api.workspaces.media.upload(id, bySeat, fileOf(bytesOf(8)));
    const onAccount = await org.api.workspaces.media.upload(id, byAccount, fileOf(bytesOf(8)));
    const { code: c, host } = await callWith(org, []);
    const member = await account();
    const call = await member.api.calls.join(c, { mic: false, cam: false });
    await settle(host, (s) => s.waiting.some((w) => w.id === call.ticket.identity));
    await host.admit(call.ticket.identity);
    await inGroup(call);
    const seat = (await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity))).participants.find((p) => p.id === call.ticket.identity)?.seat ?? '';
    await org.api.workspaces.share.set(id, bySeat, [{ seat }], 'read', { pass: host.ticket.pass });
    await org.api.workspaces.share.set(id, byAccount, [{ email: member.email }], 'read');
    const opts = { pass: call.ticket.pass };
    const m = member.api.workspaces.media;

    const seatUrl = await m.url(id, bySeat, onSeat.id, opts);
    const accountUrl = await m.url(id, byAccount, onAccount.id, opts);
    expect((await read(member, seatUrl)).status).toBe(200);
    expect((await read(member, accountUrl)).status).toBe(200);
    expect((await m.list(id, opts)).map((x) => x.id).sort()).toEqual([onSeat.id, onAccount.id].sort());
    // The URL carries the seat; the account counts only with its session.
    expect((await read({ fetch }, seatUrl)).status).toBe(200);
    expect(await refused({ fetch }, accountUrl)).toEqual(await nothing());
    // Out of the call, what the seat gave goes and what the account gives stands.
    await host.leave();
    expect(await refused(member, seatUrl)).toEqual(await nothing());
    expect((await read(member, accountUrl)).status).toBe(200);
  });

  it('have the same limits as anyone, each with a day of their own', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const agenda = await make(org, id, 'document', 'Agenda');
    const { host, guests } = await callWith(org, ['Sam Guest', 'Jo Guest']);
    const [sam, jo] = guests;
    if (!sam || !jo) throw new Error('nobody joined');
    await org.api.workspaces.share.set(id, agenda, [{ seat: sam.seat }, { seat: jo.seat }], 'edit', { pass: host.ticket.pass });
    const send = (g: { api: AlcoveApi; pass: string }, bytes: number) => g.api.workspaces.media.upload(id, agenda, fileOf(bytesOf(bytes)), { pass: g.pass });
    // Each guest's day is their own, counted by the person their pass names.
    await h.setLimit('media.account_day_bytes', 2 * MiB);
    await send(sam, MiB);
    expect(await refusal(send(sam, MiB + MiB / 2))).toEqual(TODAYS);
    await send(jo, MiB + MiB / 2);
    // And the storage of whoever the workspace counts against holds what it holds, whoever’s adding to it.
    await h.setLimit('plan.free.storage_bytes', 2 * MiB);
    expect(await refusal(send(jo, 16))).toEqual(FULL);
  });
});

describe('a picture on a board', () => {
  const opened = async (url: string) => {
    const blob = resolveObjectURL(url);
    if (!blob) throw new Error('no such object URL');
    return { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
  };

  it('reaches everyone in a call opening a board of photos at once, each browser reading a few at a time', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const board = await make(ann, id, 'document', 'Board');
    const photos = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const bytes = bytesOf(3 * 1024 * 1024 + i);
      return { bytes, id: (await ann.api.workspaces.media.upload(id, board, fileOf(bytes, `photo-${i}.jpg`, 'image/jpeg'))).id };
    }));
    const room = await Promise.all(Array.from({ length: 12 }, async () => {
      const state = { reading: 0, most: 0, refused: 0 };
      const browser = cookieFetch(ORIGIN);
      const counted: typeof fetch = async (input, init) => {
        if (!String(input).includes('/v1/media/')) return browser(input, init);
        state.reading++;
        state.most = Math.max(state.most, state.reading);
        try {
          const res = await browser(input, init);
          if (res.status === 503) state.refused++;
          await res.clone().arrayBuffer();
          return res;
        } finally { state.reading--; }
      };
      const who = await account({ fetch: counted });
      await ann.api.workspaces.addPerson(id, who.email, 'read');
      return { who, state };
    }));
    let shown = 0;
    await Promise.all(room.flatMap(({ who }) => photos.map(async (p) => {
      const url = await who.api.workspaces.media.picture(id, board, p.id);
      const { type, bytes } = await opened(url);
      expect(type).toBe('image/jpeg');
      expect(same(bytes, p.bytes)).toBe(true);
      URL.revokeObjectURL(url);
      shown++;
    })));
    expect(shown).toBe(240);
    for (const { state } of room) expect(state.most).toBeLessThanOrEqual(4);
  });

  it('says a picture that’s gone is gone, straight away, and tries again for one that’s only busy', async () => {
    const pages = [503, 429];
    const browser = cookieFetch(ORIGIN);
    const busy: typeof fetch = async (input, init) => {
      const status = String(input).includes('/v1/media/') ? pages.shift() : undefined;
      return status ? new Response('<html>busy</html>', { status }) : browser(input, init);
    };
    const ann = await account({ fetch: busy });
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const bytes = bytesOf(100);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    const url = await ann.api.workspaces.media.picture(id, doc, m.id);
    expect(pages).toEqual([]);
    expect(same((await opened(url)).bytes, bytes)).toBe(true);
    URL.revokeObjectURL(url);
    await ann.api.workspaces.media.remove(id, doc, m.id);
    const began = Date.now();
    expect(await code(ann.api.workspaces.media.picture(id, doc, m.id))).toBe('not-found');
    expect(Date.now() - began).toBeLessThan(1000);
  });

  it('stops when the block that wanted it goes, and lets the next one read', async () => {
    let stuck = true;
    const browser = cookieFetch(ORIGIN);
    // Held until it's stopped, as a slow network would: one stopped before it starts is refused at once, as fetch does.
    const held: typeof fetch = async (input, init) => {
      const signal = init?.signal;
      if (stuck && String(input).includes('/v1/media/')) {
        await new Promise((_, reject) => {
          if (signal?.aborted) reject(new Error('stopped'));
          signal?.addEventListener('abort', () => reject(new Error('stopped')));
        });
      }
      return browser(input, init);
    };
    const ann = await account({ fetch: held });
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(100)));
    const stops = Array.from({ length: 6 }, () => new AbortController());
    const asked = stops.map((stop) => refusal(ann.api.workspaces.media.picture(id, doc, m.id, { signal: stop.signal })));
    await new Promise((r) => setTimeout(r, 100));
    for (const stop of stops) stop.abort();
    expect(new Set((await Promise.all(asked)).map((r) => r?.code))).toEqual(new Set(['network']));
    stuck = false;
    URL.revokeObjectURL(await ann.api.workspaces.media.picture(id, doc, m.id));
  });

  it('keeps its URL out of what the browser logs', async () => {
    const said: string[] = [];
    const b = h.browser({ onEvent: (e) => { said.push(JSON.stringify(e)); } });
    await b.api.auth.signIn('sso', { email: unique() });
    const { id } = await b.api.workspaces.create('Ours');
    const doc = (await b.api.workspaces.items.create(id, { kind: 'document', name: 'Plan', parent: null })).id;
    const m = await b.api.workspaces.media.upload(id, doc, fileOf(bytesOf(100)));
    URL.revokeObjectURL(await b.api.workspaces.media.picture(id, doc, m.id));
    const token = (await b.api.workspaces.media.url(id, doc, m.id)).split('/').at(-1)?.split('.')[1] ?? 'no signature';
    expect(said.some((l) => l.includes('/media/:token'))).toBe(true);
    expect(said.some((l) => /"\/media\/(?!:token")/.test(l))).toBe(false);
    expect(said.join('')).not.toContain(token);
  });
});

describe('reusing a file', () => {
  it('puts it in another document of the workspace, for someone who can reach it and edit that one', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const first = await make(ann, id, 'document', 'First');
    const second = await make(ann, id, 'document', 'Second');
    const m = await ann.api.workspaces.media.upload(id, first, fileOf(bytesOf(8)));
    const owner = await ownerOf(id);
    const bytes = await storedBytes(owner);

    await ann.api.workspaces.media.attach(id, second, m.id);
    await ann.api.workspaces.media.attach(id, second, m.id);
    expect((await rowsOf(owner))['workspace_media_uses']).toBe(2);
    expect((await read(ann, await ann.api.workspaces.media.url(id, second, m.id))).status).toBe(200);
    expect((await ann.api.workspaces.media.list(id))[0]?.documents.sort()).toEqual([first, second].sort());
    // It's one file: nothing more is stored for it.
    expect(await storedBytes(owner)).toBe(bytes);

    // Only what someone can already reach: an ID doesn't open what's restricted from them, even into something they can edit.
    const secret = await make(ann, id, 'document', 'Secret');
    const third = await make(theo, id, 'document', 'Third');
    await ann.api.workspaces.share.restrict(id, secret, true);
    const hidden = await ann.api.workspaces.media.upload(id, secret, fileOf(bytesOf(8)));
    expect(await refusal(theo.api.workspaces.media.attach(id, third, hidden.id))).toEqual(await refusal(theo.api.workspaces.media.attach(id, third, madeUp())));
    expect(await code(theo.api.workspaces.media.url(id, third, hidden.id))).toBe('not-found');
    // Nor does remembering an ID bring back something someone lost.
    await ann.api.workspaces.media.attach(id, second, hidden.id);
    const url = await theo.api.workspaces.media.url(id, second, hidden.id);
    expect((await read(theo, url)).status).toBe(200);
    await ann.api.workspaces.share.restrict(id, second, true);
    expect(await code(theo.api.workspaces.media.attach(id, third, hidden.id))).toBe('not-found');
  });

  it('goes with a copy: duplicating holds its files, the document and every one in a folder', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    const folder = await make(ann, id, 'folder', 'Folder');
    const doc = await make(ann, id, 'document', 'Plan', folder);
    const board = await make(ann, id, 'board', 'Map', folder);
    const bytes = bytesOf(64);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    const pin = await ann.api.workspaces.media.upload(id, board, fileOf(bytesOf(8)));

    const copy = (await ann.api.workspaces.items.duplicate(id, doc)).id;
    expect((await read(ann, await ann.api.workspaces.media.url(id, copy, m.id))).status).toBe(200);
    expect((await rowsOf(owner))['workspace_media_uses']).toBe(3);

    const folderCopy = (await ann.api.workspaces.items.duplicate(id, folder)).id;
    const copies = (await ann.api.workspaces.get(id)).items.filter((i) => i.parent === folderCopy);
    expect(copies).toHaveLength(3);
    for (const item of copies) {
      const inIt = (await ann.api.workspaces.media.list(id)).filter((x) => x.documents.includes(item.id)).map((x) => x.id);
      expect(inIt, item.name).toEqual(item.kind === 'board' ? [pin.id] : [m.id]);
    }
    expect(await count('SELECT count(*)::int AS n FROM workspace_media WHERE owner_id = $1', [owner])).toBe(2);

    // The original can go: the copies hold the file.
    await ann.api.workspaces.items.trash(id, doc);
    await ann.api.workspaces.items.deleteForever(id, doc);
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, copy, m.id))).bytes, bytes)).toBe(true);

    // A copy someone made of a document only they could open can't see past what they could.
    const theo = await account();
    await ann.api.workspaces.addPerson(id, theo.email, 'edit');
    const hidden = await make(ann, id, 'document', 'Mine');
    await ann.api.workspaces.share.restrict(id, hidden, true);
    const mine = await ann.api.workspaces.media.upload(id, hidden, fileOf(bytesOf(8)));
    const myCopy = (await ann.api.workspaces.items.duplicate(id, hidden)).id;
    expect((await read(ann, await ann.api.workspaces.media.url(id, myCopy, mine.id))).status).toBe(200);
    expect(await code(theo.api.workspaces.media.url(id, myCopy, mine.id))).toBe('not-found');
  });
});

describe('what a process takes on at once', () => {
  const { arriving, arrivingEach, arrivalMs, reading, readingEach, stalledMs, waiting, waitingEach, waitMs, working, readsAMinute } = MEDIA_LIMITS;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Someone with a file of three pieces and a URL to it. */
  async function reader() {
    const who = await withCookie();
    const id = await workspace(who, 'Ours');
    const doc = await make(who, id, 'document', 'Plan');
    const m = await who.api.workspaces.media.upload(id, doc, fileOf(bytesOf(2 * PIECE + 1)));
    return { ...who, url: await who.api.workspaces.media.url(id, doc, m.id) };
  }
  /** The store stops answering, so what's let in stays in, until `open()`, or the test ends however it ends. */
  function stuckStore() {
    const put = h.deps.objects.put;
    let open = () => {};
    const stuck = new Promise<void>((r) => { open = r; });
    const state = { storing: 0 };
    h.deps.objects.put = async (o, b) => { state.storing++; await stuck; return put(o, b); };
    const unstick = () => { open(); h.deps.objects.put = put; };
    onTestFinished(unstick);
    return { state, open: unstick };
  }

  /**
   * The store stops giving anything back, so a read that's let in stays in, with this process the one still working on it,
   * until `open()`, or the test ends however it ends: one that fails leaves nothing stuck for the next.
   */
  function stuckReads() {
    const get = h.deps.objects.get;
    let open = () => {};
    const stuck = new Promise<void>((r) => { open = r; });
    const state = { reading: 0 };
    h.deps.objects.get = async (o) => { state.reading++; await stuck; return get(o); };
    const unstick = () => { open(); h.deps.objects.get = get; };
    onTestFinished(unstick);
    return { state, open: unstick };
  }
  /** How many reads have had a place since `from`, by the server's own word. */
  const placed = (from: number) => logsSince(from).filter((l) => l.msg === 'a read has its place').length;
  /** Says a piece is 4 MiB and sends what it's told to: this is what the process is about to hold. */
  const pieceFrom = (cookie: string, url: string, first: number) => {
    const req = request(url, { method: 'POST', agent: false, headers: { origin: ORIGIN, cookie, 'content-type': 'application/octet-stream', 'content-length': String(PIECE) } });
    req.on('error', () => undefined);
    req.write(Buffer.alloc(first));
    return req;
  };
  const closed = (req: ClientRequest) => new Promise<void>((r) => { req.once('close', () => r()); });
  /**
   * Waits for `n` requests to be refused with `message`, and gives each refusal's level with what its request logged of
   * itself. A browser that stopped sending, or went while it waited, is nothing failing here.
   */
  async function refusals(from: number, message: string, n: number) {
    const lines = () => logsSince(from);
    const refused = () => lines().filter((l) => l.msg === message);
    const ended = (id: unknown) => lines().filter((l) => l['requestId'] === id && ['request', 'request refused', 'request failed'].includes(l.msg));
    await until(() => refused().length === n && refused().every((l) => ended(l['requestId']).length > 0), `${n} requests refused with “${message}” and logged`);
    return refused().map((l) => ({ refusal: l.level, request: ended(l['requestId']).map((r) => [r.msg, r.level, r['status']]) }));
  }
  /** What an ordinary refusal logs, for the refusal and for its request. */
  const ordinary = { refusal: 30, request: [['request refused', 30, 503]] };

  it('takes only so many pieces in, refusing the rest before reading them, and an upload just tries again', async () => {
    // Enough people that the limit on everyone is reached first, each sending more than their share.
    const people = await Promise.all(Array.from({ length: arriving / arrivingEach + 1 }, () => account()));
    const places = await Promise.all(people.map(async (who) => {
      const id = await workspace(who, 'Ours');
      const doc = await make(who, id, 'document', 'Plan');
      return Promise.all(Array.from({ length: arrivingEach + 1 }, async () => ({ who, id, doc, url: `${place(id, doc)}/${await started(who, id, doc, 16)}/pieces/0` })));
    }));
    const store = stuckStore();
    const statuses: number[] = [];
    let late;
    try {
      const all = places.flat().map(async ({ who, url }) => { const { status } = await sendPiece(who, url, bytesOf(16)); statuses.push(status); return status; });
      const over = all.length - arriving;
      await until(() => statuses.length === over, 'everything past the limit to be refused');
      // Answered while the rest are still in, and never read: nothing past the limit reached the store.
      expect(new Set(statuses)).toEqual(new Set([503]));
      expect(store.state.storing).toBeLessThanOrEqual(working);
      // An upload that comes along now isn't lost: it tries again until there's room.
      const first = places[0]?.[0];
      if (!first) throw new Error('nobody');
      late = first.who.api.workspaces.media.upload(first.id, first.doc, fileOf(bytesOf(8)));
      await pause(300);
      store.open();
      const done = await Promise.all(all);
      expect(done.filter((s) => s === 200)).toHaveLength(arriving);
      expect((await late).size).toBe(8);
    } finally { store.open(); }
  });

  it('takes only so many pieces from one person, however few anyone else is sending', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const urls = await Promise.all(Array.from({ length: arrivingEach + 3 }, async () => `${place(id, doc)}/${await started(ann, id, doc, 16)}/pieces/0`));
    const store = stuckStore();
    const statuses: number[] = [];
    try {
      const all = urls.map(async (url) => { const { status } = await sendPiece(ann, url, bytesOf(16)); statuses.push(status); return status; });
      await until(() => statuses.length === 3, 'one person’s extra pieces to be refused');
      expect(statuses).toEqual([503, 503, 503]);
      // Someone else isn't touched by it.
      const theo = await account();
      const theirs = await workspace(theo, 'Theirs');
      const theirDoc = await make(theo, theirs, 'document', 'Plan');
      const reaches = sendPiece(theo, `${place(theirs, theirDoc)}/${await started(theo, theirs, theirDoc, 16)}/pieces/0`, bytesOf(16));
      store.open();
      expect((await reaches).status).toBe(200);
      expect((await Promise.all(all)).filter((s) => s === 200)).toHaveLength(arrivingEach);
    } finally { store.open(); }
  });

  it('counts a piece from before its body is read, so one that’s slow to arrive holds its place like any other', async () => {
    const ann = await withCookie();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const urls = await Promise.all(Array.from({ length: arrivingEach + 1 }, async () => `${place(id, doc)}/${await started(ann, id, doc, PIECE)}/pieces/0`));
    const slow = urls.slice(1).map((url) => pieceFrom(ann.cookie(), url, 1024));
    const from = h.logs.length;
    try {
      await pause(300);
      expect((await sendPiece(ann, urls[0] ?? '', bytesOf(16))).status).toBe(503);
    } finally { for (const req of slow) req.destroy(); }
    await until(async () => (await sendPiece(ann, urls[0] ?? '', bytesOf(PIECE))).status === 200, 'their places to come back');
    // A browser that went while sending is nothing going wrong here: an ordinary refusal, and its request says so too.
    expect(h.logs.slice(from).filter((l) => l.includes('"status":500'))).toEqual([]);
    expect(await refusals(from, 'That piece stopped arriving. Try again.', slow.length)).toEqual(slow.map(() => ordinary));
  });

  it('cuts a piece that stops arriving, or only trickles, so nobody can hold a place by saying they’re about to send', async () => {
    const ann = await withCookie();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const urls = await Promise.all(Array.from({ length: arrivingEach + 1 }, async () => `${place(id, doc)}/${await started(ann, id, doc, PIECE)}/pieces/0`));
    const held = urls.slice(1).map((url) => pieceFrom(ann.cookie(), url, 1024));
    const [first, second] = held;
    // Half send nothing more. Half keep sending, too little to ever get there: 4 MiB at this rate is hours.
    const trickle = setInterval(() => { for (const req of [first, second]) if (req && !req.destroyed) req.write(Buffer.alloc(64)); }, 200);
    const from = h.logs.length;
    const began = Date.now();
    try {
      await pause(300);
      expect((await sendPiece(ann, urls[0] ?? '', bytesOf(16))).status).toBe(503);
      await Promise.all(held.map(closed));
      expect(Date.now() - began).toBeLessThan(arrivalMs + 3000);
      expect(Date.now() - began).toBeGreaterThanOrEqual(arrivalMs - 1000);
    } finally { clearInterval(trickle); for (const req of held) req.destroy(); }
    // Each was cut as an ordinary refusal, logged as one, and its request too.
    expect(await refusals(from, 'That piece stopped arriving. Try again.', held.length)).toEqual(held.map(() => ordinary));
    // Their places came back, and nothing was kept of what didn't arrive.
    expect((await sendPiece(ann, urls[0] ?? '', bytesOf(PIECE))).status).toBe(200);
    expect(await count('SELECT count(*)::int AS n FROM workspace_media_pieces WHERE owner_id = $1', [await ownerOf(id)])).toBe(1);
  });

  it('takes a piece that’s slow but keeps coming, however long it takes', async () => {
    const ann = await withCookie();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await started(ann, id, doc, PIECE);
    const req = pieceFrom(ann.cookie(), `${place(id, doc)}/${m}/pieces/0`, 0);
    const answered = new Promise<number>((resolve, reject) => { req.on('response', (res) => { res.resume(); resolve(res.statusCode ?? 0); }); req.once('error', reject); });
    // Well over `arrivalMs` from start to end, as a phone on a bad connection takes: a slice's worth in every stretch of it.
    const part = PIECE / 8;
    for (let i = 0; i < 8; i++) { req.write(Buffer.alloc(part)); await pause(arrivalMs / 5); }
    req.end();
    expect(await answered).toBe(200);
  });

  it('holds one piece for someone who stops reading, and only so many for each person; the next waits and gets their place', async () => {
    const ann = await reader();
    const theo = await reader();
    const get = vi.spyOn(h.deps.objects, 'get');
    const mine = await Promise.all(Array.from({ length: readingEach }, () => stopped(ann, ann.url)));
    expect(new Set(mine.map((s) => s.status))).toEqual(new Set([200]));
    await pause(300);
    // Nothing is read ahead for a browser that stopped, however long it's left: what's open is what it's on.
    const opened = get.mock.calls.length;
    expect(opened).toBeLessThanOrEqual(readingEach);
    await pause(300);
    expect(get.mock.calls.length).toBe(opened);
    get.mockRestore();
    try {
      // Their next read waits in line, holding nothing. Nobody else is held up by them.
      let answered = false;
      const next = read(ann, ann.url, 'bytes=0-9').then((r) => { answered = true; return r; });
      expect((await read(theo, theo.url, 'bytes=0-9')).status).toBe(206);
      await pause(200);
      expect(answered).toBe(false);
      // The moment one of theirs goes, however it went, its place is taken.
      mine[0]?.end();
      expect((await next).status).toBe(206);
    } finally { for (const s of mine) s.end(); }
    await until(async () => (await read(ann, ann.url, 'bytes=0-0')).status === 206, 'their places to come back');
  });

  it('holds a place for what’s still to reach the browser, a small picture too', async () => {
    const ann = await withCookie();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    // One piece, all opened and sent at once, so only the response itself says it's still going.
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const stoppedReads = await Promise.all(Array.from({ length: readingEach }, () => stopped(ann, url)));
    try {
      let answered = false;
      const next = ann.fetch(url, { headers: { range: 'bytes=0-0' } }).then(async (r) => { answered = true; await r.arrayBuffer(); });
      await pause(300);
      expect(answered).toBe(false);
      stoppedReads[0]?.end();
      await next;
    } finally { for (const s of stoppedReads) s.end(); }
  });

  it('cuts a read that has stopped when someone is waiting, and only the one they need', async () => {
    const newcomer = await reader();
    const people = await Promise.all(Array.from({ length: reading / readingEach }, () => reader()));
    const open = (await Promise.all(people.map((p) => Promise.all(Array.from({ length: readingEach }, () => stopped(p, p.url)))))).flat();
    try {
      // Every place is held by someone who took a little and stopped, as a paused video does. Someone new waits for no longer than that takes to tell.
      const began = Date.now();
      expect((await read(newcomer, newcomer.url, 'bytes=0-9')).status).toBe(206);
      expect(Date.now() - began).toBeLessThan(stalledMs + 2000);
      // One went for them. The rest read on as if nothing had happened.
      const outcomes = await Promise.all(open.map((s) => s.rest()));
      expect(outcomes.filter((o) => o === 'cut')).toHaveLength(1);
      expect(new Set(outcomes.filter((o) => o !== 'cut'))).toEqual(new Set([2 * PIECE + 1]));
    } finally { for (const s of open) s.end(); }
    expect(h.logs.some((l) => l.includes('a read was cut'))).toBe(true);
  });

  it('gives someone at their own limit one of their own back, and takes nobody else’s for them', async () => {
    const ann = await reader();
    const theo = await reader();
    // Theo's has been stopped the longest, so it's what anyone else would be given.
    const from = h.logs.length;
    const theirs = await stopped(theo, theo.url);
    await pause(200);
    const mine = await Promise.all(Array.from({ length: readingEach }, () => stopped(ann, ann.url)));
    try {
      expect(new Set([theirs, ...mine].map((s) => s.status))).toEqual(new Set([200]));
      expect((await read(ann, ann.url, 'bytes=0-9')).status).toBe(206);
      // One of hers was cut for it, and Theo's reads on to the end.
      const cut = logsSince(from).filter((l) => l.msg === 'a read was cut').map((l) => l['requestId']);
      expect(cut).toHaveLength(1);
      expect(mine.map((s) => s.requestId)).toContain(cut[0]);
      expect(await theirs.rest()).toBe(2 * PIECE + 1);
      const outcomes = await Promise.all(mine.map((s) => s.rest()));
      expect(outcomes.filter((o) => o === 'cut')).toHaveLength(1);
    } finally { for (const s of [...mine, theirs]) s.end(); }
  });

  it('leaves a read that has stopped alone while nobody is waiting, so a paused video plays on', async () => {
    const ann = await reader();
    const paused = await stopped(ann, ann.url);
    await pause(stalledMs + 1000);
    expect(await paused.rest()).toBe(2 * PIECE + 1);
  });

  it('ends a read at its own time, however it’s going, and takes the place back', async () => {
    const ann = await reader();
    const { cfg } = h.deps;
    h.deps.cfg = { ...cfg, MEDIA_READ_MS: 800 };
    try {
      // One that stopped, and one that keeps taking a little at a time, too slowly to finish in time.
      const paused = await stopped(ann, ann.url);
      const going = await stopped(ann, ann.url);
      expect(await going.slowly(100)).toBe('cut');
      expect(await paused.rest()).toBe('cut');
    } finally { h.deps.cfg = cfg; }
    const full = await Promise.all(Array.from({ length: readingEach }, () => read(ann, ann.url, 'bytes=0-9')));
    expect(new Set(full.map((r) => r.status))).toEqual(new Set([206]));
  });

  it('opens nothing for a browser that left while it waited, and gives its place in line to the next', async () => {
    const ann = await reader();
    const mine = await Promise.all(Array.from({ length: readingEach }, () => stopped(ann, ann.url)));
    try {
      // They fill all the line they're allowed, and go: an ordinary refusal for each, and for its request.
      const from = h.logs.length;
      const stops = Array.from({ length: waitingEach }, () => new AbortController());
      const left = stops.map((stop) => ann.fetch(ann.url, { signal: stop.signal, headers: { range: 'bytes=0-9' } }).catch(() => 'gone'));
      await pause(300);
      for (const stop of stops) stop.abort();
      await Promise.all(left);
      expect(await refusals(from, 'That browser has gone.', waitingEach)).toEqual(stops.map(() => ordinary));
      await pause(100);
      // A line they'd left full would refuse this at once. It waits, and only it gets a piece opened.
      const get = vi.spyOn(h.deps.objects, 'get');
      let answered = false;
      const next = read(ann, ann.url, 'bytes=0-9').then((r) => { answered = true; return r; });
      await pause(300);
      expect(answered).toBe(false);
      mine[0]?.end();
      expect((await next).status).toBe(206);
      expect(get).toHaveBeenCalledTimes(1);
    } finally { for (const s of mine) s.end(); }
  });

  it('asks again after a wait, so a session that ended in line reads nothing', async () => {
    const ann = await reader();
    const mine = await Promise.all(Array.from({ length: readingEach }, () => stopped(ann, ann.url)));
    try {
      const next = ann.fetch(ann.url, { headers: { range: 'bytes=0-9' } });
      await pause(300);
      await ann.api.auth.signOut();
      mine[0]?.end();
      const answer = await next;
      const { code: c, message } = Refused.parse(await answer.json());
      expect({ status: answer.status, code: c, message }).toEqual(await nothing());
    } finally { for (const s of mine) s.end(); }
  });

  it('refuses a read that gets no place, after a moment or at once when the line is full, and never more for someone than their share', async () => {
    const people = await Promise.all(Array.from({ length: reading / readingEach }, () => reader()));
    const newcomer = await reader();
    const first = await reader();
    const second = await reader();
    // Every place is taken, by reads this process hasn't finished with, so nothing can give way. That's once the server
    // says each has its place, however long their requests take to get there.
    const store = stuckReads();
    const from = h.logs.length;
    const taken = people.flatMap((p) => Array.from({ length: readingEach }, () => read(p, p.url, 'bytes=0-9')));
    const lined: AbortController[] = [];
    const inLine = (who: { fetch: typeof fetch; url: string }) => {
      const stop = new AbortController();
      lined.push(stop);
      return who.fetch(who.url, { signal: stop.signal, headers: { range: 'bytes=0-0' } }).then((r) => r.status, () => 0);
    };
    try {
      await until(() => placed(from) >= reading, 'every place to be taken');
      await until(() => store.state.reading >= working, 'every place to be working');
      // Someone new waits, for as long as it says, and is told.
      const began = Date.now();
      const told = await read(newcomer, newcomer.url, 'bytes=0-0');
      expect(told.status).toBe(503);
      expect(Date.now() - began).toBeGreaterThanOrEqual(waitMs - 500);
      // One person can't take the line, and once it's full nobody waits at all.
      const waitingReads = [...Array.from({ length: waitingEach }, () => inLine(first)), ...Array.from({ length: waiting - waitingEach }, () => inLine(second))];
      await pause(300);
      const overTheirShare = Date.now();
      expect((await read(first, first.url, 'bytes=0-0')).status).toBe(503);
      expect((await read(newcomer, newcomer.url, 'bytes=0-0')).status).toBe(503);
      expect(Date.now() - overTheirShare).toBeLessThan(waitMs / 2);
      store.open();
      expect(new Set(await Promise.all(waitingReads))).toEqual(new Set([206]));
      expect(new Set((await Promise.all(taken)).map((r) => r.status))).toEqual(new Set([206]));
    } finally {
      store.open();
      for (const s of lined) s.abort();
    }
    await until(async () => (await read(people[0] ?? { fetch }, people[0]?.url ?? '', 'bytes=0-0')).status === 206, 'every place to come back');
  });

  it('keeps to its share of the core, however many people are reading, each within their limit', async () => {
    const people = await Promise.all(Array.from({ length: 6 }, () => reader()));
    // A byte costs a whole piece, so this asks as much of the core as can be asked for as little as can be read here, on the same core.
    const from = performance.eventLoopUtilization();
    await Promise.all(people.flatMap((p) => Array.from({ length: readingEach }, async () => { for (let i = 0; i < 4; i++) await read(p, p.url, 'bytes=0-0'); })));
    expect(performance.eventLoopUtilization(from).utilization).toBeLessThan(0.7);
  });

  it('counts every piece opened against someone’s reads, because one byte costs a whole piece', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 1)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    // Two pieces a read, so half as many reads as a read of one piece would get.
    let whole = 0;
    for (let i = 0; i < readsAMinute / 2 + 5; i++) {
      const got = await ann.fetch(url, { headers: { range: 'bytes=0-' } }).then(async (r) => { await r.arrayBuffer(); return r.status; }).catch(() => 0);
      if (got === 206) whole++;
    }
    expect(whole).toBeLessThanOrEqual(readsAMinute / 2);
    expect(whole).toBeGreaterThan(readsAMinute / 2 - 5);
    expect((await refused(ann, url, 'bytes=0-0')).code).toBe('unavailable');
  });

  it('spends nobody’s reads for whoever else holds their URL', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const url = await ann.api.workspaces.media.url(id, doc, m.id);
    const nobody = await nothing();
    const kofi = await account();
    for (let i = 0; i < readsAMinute + 5; i++) expect(await refused(i % 2 ? kofi : { fetch }, url, 'bytes=0-0')).toEqual(nobody);
    expect((await read(ann, url, 'bytes=0-0')).status).toBe(206);
  });

  it('asks again as a long read goes on, so someone who loses the document part way through stops', async () => {
    const ann = await account();
    const priya = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const size = 9 * PIECE + 1;
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(size)));
    await ann.api.workspaces.share.set(id, doc, [{ email: priya.email }], 'read');
    const url = await priya.api.workspaces.media.url(id, doc, m.id);
    // All of it in one answer, as a download asks.
    const res = await priya.fetch(url);
    expect([res.status, res.headers.get('content-length')]).toEqual([200, null]);
    const body = res.body?.getReader();
    if (!body) throw new Error('no body');
    let taken = (await body.read()).value?.length ?? 0;
    const entry = (await ann.api.workspaces.share.list(id, doc)).entries[0]?.id ?? '';
    await ann.api.workspaces.share.remove(id, doc, entry);
    const outcome = await (async () => {
      for (;;) {
        const { done, value } = await body.read();
        if (done) return 'all of it';
        taken += value.length;
      }
    })().catch(() => 'cut off');
    expect(outcome).toBe('cut off');
    // It stopped at the next time it asked, every four pieces: well short of the file.
    expect(taken).toBeLessThanOrEqual(5 * PIECE);
  });
});

describe('storage limits', () => {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const send = (who: { api: AlcoveApi }, id: string, doc: string, bytes: number) => who.api.workspaces.media.upload(id, doc, fileOf(bytesOf(bytes)));
  async function planIn(who: Account) {
    const id = await workspace(who, 'Ours');
    return { id, doc: await make(who, id, 'document', 'Plan') };
  }
  /** What a refused request answered, without its request ID. */
  const said = async (res: Response) => {
    const { code: c, message } = Refused.parse(await res.json());
    return { code: c, message, status: res.status };
  };

  it('refuses a file too big, a full workspace and a day’s allowance used, each in its own words, before anything is sent', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    const owner = await ownerOf(id);
    // Asked for at the start, so nothing of a file that won't fit is sent at all.
    const starting = async (at: { id: string; doc: string }, size: number) => said(await json(ann, place(at.id, at.doc), { name: 'a.png', type: 'image/png', size }));
    // A file over the limit in force hears how big one can be, which only the server knows: one past the most there can ever be too.
    expect(await starting({ id, doc }, MAX_MEDIA_BYTES + 1)).toEqual(tooBig('512 MiB'));
    await h.setLimit('plan.free.file_bytes', MiB);
    expect(await refusal(send(ann, id, doc, MiB + 1))).toEqual(tooBig('1 MiB'));
    expect(await starting({ id, doc }, MiB + 1)).toEqual(tooBig('1 MiB'));
    await send(ann, id, doc, MiB);
    // Storage that holds what its plan allows: what's stored, and what's coming.
    await h.setLimit('plan.free.storage_bytes', 2 * MiB);
    expect(await refusal(send(ann, id, doc, MiB))).toEqual(FULL);
    expect(await starting({ id, doc }, MiB)).toEqual(FULL);
    await send(ann, id, doc, MiB / 2);
    // What someone can upload in a day, in every workspace together. Storage is the account's, in every workspace it
    // pays for: with room again, only the day is in the way.
    const elsewhere = await planIn(ann);
    await h.setLimit('plan.free.storage_bytes', 10 * MiB);
    await h.setLimit('media.account_day_bytes', 2 * MiB);
    expect(await refusal(send(ann, elsewhere.id, elsewhere.doc, MiB))).toEqual(TODAYS);
    expect(await starting(elsewhere, MiB)).toEqual(TODAYS);
    await send(ann, elsewhere.id, elsewhere.doc, MiB / 2);
    expect(await refusal(send(ann, elsewhere.id, elsewhere.doc, 1))).toEqual(TODAYS);
    // Each was refused as it started: nothing of them was kept.
    expect(await count('SELECT count(*)::int AS n FROM workspace_media WHERE owner_id = $1', [owner])).toBe(2);
    // A limit of zero isn't someone having used theirs up: nothing can be uploaded, whoever's asking.
    await h.resetLimits();
    await h.setLimit('plan.free.file_bytes', 0);
    expect(await refusal(send(ann, id, doc, 1))).toEqual(NO_FILES);
    await h.resetLimits();
    await h.setLimit('plan.free.storage_bytes', 0);
    expect(await refusal(send(ann, id, doc, 1))).toEqual(FULL);
    await h.resetLimits();
    await h.setLimit('media.account_day_bytes', 0);
    expect(await refusal(send(ann, id, doc, 1))).toEqual(NO_UPLOADS);
  });

  it('asks again on every piece, so a limit lowered during an upload stops it there, and raising it lets it go on', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    const m = await started(ann, id, doc, 3 * PIECE);
    const at = (n: number) => `${place(id, doc)}/${m}/pieces/${n}`;
    expect((await sendPiece(ann, at(0), bytesOf(PIECE))).status).toBe(200);
    await h.setLimit('media.account_day_bytes', PIECE + 1);
    expect(await said(await sendPiece(ann, at(1), bytesOf(PIECE)))).toEqual(TODAYS);
    await h.setLimit('media.account_day_bytes', 3 * PIECE);
    await h.setLimit('plan.free.storage_bytes', 2 * PIECE);
    expect(await said(await sendPiece(ann, at(1), bytesOf(PIECE)))).toEqual(FULL);
    await h.setLimit('plan.free.storage_bytes', 4 * PIECE);
    await h.setLimit('plan.free.file_bytes', 2 * PIECE);
    expect(await said(await sendPiece(ann, at(1), bytesOf(PIECE)))).toEqual(tooBig('8 MiB'));
    await h.resetLimits();
    expect((await sendPiece(ann, at(1), bytesOf(PIECE))).status).toBe(200);
    expect((await sendPiece(ann, at(2), bytesOf(PIECE))).status).toBe(200);
    expect((await json(ann, `${place(id, doc)}/${m}/finish`, {})).status).toBe(200);
  });

  it('refuses a piece before reading it, and reads the rest, so its connection takes the next request', async () => {
    const ann = await withCookie();
    const { id, doc } = await planIn(ann);
    const m = await started(ann, id, doc, 2 * PIECE);
    await h.setLimit('media.account_day_bytes', 1);
    // A browser that has sent all of a piece sends its next request down the same connection once it has its answer.
    const { hostname, port, host } = new URL(h.baseUrl);
    const socket = connect({ host: hostname, port: Number(port) });
    socket.on('error', () => undefined);
    onTestFinished(() => { socket.destroy(); });
    const heard: Buffer[] = [];
    let closed = false;
    socket.on('data', (chunk: Buffer) => { heard.push(chunk); });
    socket.on('close', () => { closed = true; });
    const statuses = () => [...Buffer.concat(heard).toString('latin1').matchAll(/HTTP\/1\.1 (\d{3}) /g)].map((s) => Number(s[1]));
    socket.write(`POST ${new URL(`${place(id, doc)}/${m}/pieces/0`).pathname} HTTP/1.1\r\nhost: ${host}\r\norigin: ${ORIGIN}\r\ncookie: ${ann.cookie()}\r\ncontent-type: application/octet-stream\r\ncontent-length: ${PIECE}\r\n\r\n`);
    socket.write(bytesOf(PIECE));
    await until(() => statuses().length > 0 || closed, 'the piece to be answered');
    socket.write(`GET /v1/workspaces/${id}/media HTTP/1.1\r\nhost: ${host}\r\ncookie: ${ann.cookie()}\r\n\r\n`);
    await until(() => statuses().length > 1 || closed, 'the next request to be answered, or its connection to go');
    expect(statuses()).toEqual([409, 200]);
  });

  it('deletes nothing when a limit goes down: it only refuses what comes next', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    const owner = await ownerOf(id);
    const kept = await Promise.all([1, 2, 3].map(async (n) => {
      const bytes = bytesOf(n * 100_000);
      return { bytes, id: (await ann.api.workspaces.media.upload(id, doc, fileOf(bytes))).id };
    }));
    const objects = await objectsOf(owner);
    const before = await storedBytes(owner);
    // Below what's already there.
    await h.setLimit('plan.free.storage_bytes', 1);
    await h.setLimit('media.account_day_bytes', 1);
    expect(await refusal(send(ann, id, doc, 1))).toEqual(FULL);
    await h.setLimit('plan.free.file_bytes', 0);
    expect(await refusal(send(ann, id, doc, 1))).toEqual(NO_FILES);
    await maintain(h.deps, { uploadAgeMs: ALREADY });
    // Everything already there stays, and reads back as it went in.
    expect((await ann.api.workspaces.media.list(id)).map((x) => x.id).sort()).toEqual(kept.map((k) => k.id).sort());
    for (const k of kept) expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, k.id))).bytes, k.bytes)).toBe(true);
    expect(await objectsOf(owner)).toEqual(objects);
    expect(await storedBytes(owner)).toBe(before);
    expect(await queued(owner)).toBe(0);
  });

  it('takes a changed limit within the cache window, with no restart, and says so once', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    const { cfg } = h.deps;
    // Read now, so the window starts here.
    await send(ann, id, doc, 16);
    const from = h.logs.length;
    h.deps.cfg = { ...cfg, LIMITS_CACHE_MS: 3000 };
    try {
      await h.setLimit('media.account_day_bytes', 1);
      // Until the window ends, what was read holds...
      await send(ann, id, doc, 16);
      await pause(3100);
      // ...and once it has, what the database says.
      expect(await refusal(send(ann, id, doc, 16))).toEqual(TODAYS);
    } finally { h.deps.cfg = cfg; }
    const changed = logsSince(from).filter((l) => l.msg === 'service limit changed');
    expect(changed).toEqual([expect.objectContaining({ level: 30, limit: 'media.account_day_bytes', old: LIMITS['media.account_day_bytes'].default, new: 1 })]);
  });

  it('keeps what was in force when the limits can’t be read, and reads them again next time', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    await h.setLimit('media.account_day_bytes', 1);
    expect(await refusal(send(ann, id, doc, 16))).toEqual(TODAYS);
    const from = h.logs.length;
    await h.pool.query('ALTER TABLE service_limits RENAME TO service_limits_away');
    try {
      // Nothing can read them now: what was in force stays, and isn't put back to the defaults.
      expect(await refusal(send(ann, id, doc, 16))).toEqual(TODAYS);
      expect(logsSince(from).filter((l) => l.msg === 'service limits not read; keeping what was in force').map((l) => l.level)).toContain(40);
    } finally { await h.pool.query('ALTER TABLE service_limits_away RENAME TO service_limits'); }
    // Once they can be read, the next request does.
    await h.resetLimits();
    await send(ann, id, doc, 16);
  });

  it('takes the account’s row before the workspace’s, as deleting the account does, so neither waits on the other', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    const room = await ownerOf(id);
    const m = await started(ann, id, doc, 16);
    // Deleting an account holds its row first, and then the workspaces it's in (account.ts › deleteAccount).
    const deleting = await h.pool.connect();
    try {
      await deleting.query('BEGIN');
      await deleting.query('SELECT 1 FROM owners WHERE owner_id = $1 FOR UPDATE', [ann.ownerId]);
      const piece = sendPiece(ann, `${place(id, doc)}/${m}/pieces/0`, bytesOf(16));
      await until(async () => (await count("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")) > 0, 'the piece to wait for the account');
      // The piece waits holding nothing of the workspace, so deleting the account can take that next.
      await deleting.query('SELECT 1 FROM workspaces WHERE owner_id = $1 FOR NO KEY UPDATE NOWAIT', [room]);
      await deleting.query('ROLLBACK');
      expect((await piece).status).toBe(200);
    } finally {
      await deleting.query('ROLLBACK');
      deleting.release();
    }
  });

  it('ignores a row it can’t use, saying so once, and holds a value past its ceiling to the ceiling', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    const owner = await ownerOf(id);
    const from = h.logs.length;
    // A row no limit has, as a typo at the database's console makes it, and a value below a limit's floor.
    await h.pool.query('INSERT INTO service_limits (name, value) VALUES ($1, $2)', ['media.file_byte', 1]);
    await h.setLimit('media.account_day_bytes', -1);
    // Neither stops anything: each limit they meant is its default.
    await send(ann, id, doc, MiB);
    await send(ann, id, doc, MiB);
    const ignored = logsSince(from).filter((l) => l.msg === 'service limit ignored').map((l) => [l.level, l['limit'], l['value']]);
    expect(ignored.sort()).toEqual([[40, 'media.account_day_bytes', -1], [40, 'media.file_byte', 1]]);
    // Zero is a value like any other: none.
    await h.setLimit('media.account_day_bytes', 0);
    expect(await refusal(send(ann, id, doc, 1))).toEqual(NO_UPLOADS);
    await h.resetLimits();
    // Past its ceiling, a value is the ceiling: a workspace holding more than that is full, whatever the row says.
    const { ceiling } = LIMITS['plan.free.storage_bytes'];
    const before = await storedBytes(owner);
    await h.pool.query('UPDATE owners SET stored_bytes = $2 WHERE owner_id = $1', [owner, ceiling + GiB]);
    try {
      await h.setLimit('plan.free.storage_bytes', 1e15);
      expect(await refusal(send(ann, id, doc, 1))).toEqual(FULL);
    } finally { await h.pool.query('UPDATE owners SET stored_bytes = $2 WHERE owner_id = $1', [owner, before]); }
    expect(logsSince(from).filter((l) => l.msg === 'service limit clamped')).toEqual([expect.objectContaining({ level: 40, limit: 'plan.free.storage_bytes', value: 1e15, used: ceiling })]);
  });

  it('is set from the command line, against any database, saying what it was and what it is now', async () => {
    const cli = (...args: string[]) => new Promise<{ code: number | null; out: string }>((resolve, reject) => {
      const run = spawn(process.execPath, ['--import', 'tsx', 'src/limits-cli.ts', ...args], {
        env: { ...process.env, DATABASE_URL: process.env['TEST_DATABASE_URL'], LOG_FORMAT: 'json', LOG_LEVEL: 'info' }, stdio: ['ignore', 'pipe', 'pipe']
      });
      let out = '';
      run.stdout.on('data', (b: Buffer) => { out += b.toString(); });
      run.stderr.on('data', (b: Buffer) => { out += b.toString(); });
      run.on('error', reject);
      run.on('close', (c) => resolve({ code: c, out }));
    });
    const loggedBy = (out: string) => out.split('\n').filter((l) => l.startsWith('{')).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
    const stored = async () => (await h.pool.query<{ name: string; value: string }>('SELECT name, value::text AS value FROM service_limits ORDER BY name')).rows.map((r) => [r.name, Number(r.value)]);

    const day = await cli('set', 'media.account_day_bytes', '1048576');
    expect(day.code).toBe(0);
    expect(loggedBy(day.out).filter((l) => l.msg === 'service limit set')).toEqual([expect.objectContaining({ level: 30, limit: 'media.account_day_bytes', old: LIMITS['media.account_day_bytes'].default, new: MiB })]);
    // Set again, what it was is what it was set to.
    const again = await cli('set', 'media.account_day_bytes', '2MiB');
    expect(loggedBy(again.out).filter((l) => l.msg === 'service limit set')).toEqual([expect.objectContaining({ limit: 'media.account_day_bytes', old: MiB, new: 2 * MiB })]);
    // A value as `limits list` writes it is one it takes.
    const room = await cli('set', 'plan.free.storage_bytes', '5 GiB');
    expect(room.code).toBe(0);
    expect(loggedBy(room.out).filter((l) => l.msg === 'service limit set')).toEqual([expect.objectContaining({ limit: 'plan.free.storage_bytes', old: 10 * GiB, new: 5 * GiB })]);
    expect(await stored()).toEqual([['media.account_day_bytes', 2 * MiB], ['plan.free.storage_bytes', 5 * GiB]]);
    // The API holds to it on the next request it reads limits for.
    const ann = await account();
    const { id, doc } = await planIn(ann);
    expect(await refusal(send(ann, id, doc, 3 * MiB))).toEqual(TODAYS);
    // What's in force, for someone deciding what to change.
    const listed = await cli('list');
    expect(listed.code).toBe(0);
    for (const line of ['media.account_day_bytes', '2 MiB', 'plan.free.file_bytes', '512 MiB']) expect(listed.out).toContain(line);
    // Anything it can't set is refused, and nothing is stored: a typo is an ordinary refusal, said at warn.
    for (const args of [['set', 'media.file_byte', '1'], ['set', 'plan.free.file_bytes', '99GiB'], ['set', 'plan.free.file_bytes', '-5'], ['set', 'plan.free.file_bytes'], ['unset']]) {
      const refused = await cli(...args);
      expect([args.join(' '), refused.code, loggedBy(refused.out).filter((l) => l.level >= 50)]).toEqual([args.join(' '), 1, []]);
    }
    expect(await stored()).toEqual([['media.account_day_bytes', 2 * MiB], ['plan.free.storage_bytes', 5 * GiB]]);
  });

  it('warns once each time someone’s storage or their day passes 80% of its limit', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    await h.setLimit('plan.free.storage_bytes', 10 * MiB);
    await h.setLimit('media.account_day_bytes', 12 * MiB);
    const from = h.logs.length;
    const warned = () => logsSince(from).filter((l) => l.level === 40 && /past 80%/.test(l.msg));
    const files = [];
    for (let i = 0; i < 3; i++) files.push(await send(ann, id, doc, 3 * MiB));
    await send(ann, id, doc, MiB / 2);
    const first = files.pop();
    if (!first) throw new Error('no file');
    await ann.api.workspaces.media.remove(id, doc, first.id);
    await send(ann, id, doc, 2 * MiB);
    await send(ann, id, doc, MiB / 4);
    const lines = warned();
    // The account's storage passed it twice, once more after a file went; the day once, because what's uploaded stays uploaded.
    expect(lines.map((l) => l.msg)).toEqual(['an account is past 80% of its storage', 'an account is past 80% of its storage', 'someone is past 80% of what they can upload today']);
    expect(lines[0]).toEqual(expect.objectContaining({ workspaceId: id, ownerId: ann.ownerId, limitBytes: 10 * MiB }));
    expect(lines[2]).toEqual(expect.objectContaining({ ownerId: ann.ownerId, uploadedBytes: 11.5 * MiB, limitBytes: 12 * MiB }));
    // Sizes and IDs, and nothing anyone wrote.
    for (const l of lines) expect(Object.keys(l).filter((k) => !['level', 'time', 'service', 'msg', 'component', 'requestId', 'method', 'path', 'ownerId', 'workspaceId', 'storedBytes', 'uploadedBytes', 'limitBytes'].includes(k))).toEqual([]);
  });

  it('keeps a day’s count through a restart, forgets it after two days, and deletes it with the account', async () => {
    const ann = await account();
    const { id, doc } = await planIn(ann);
    await h.setLimit('media.account_day_bytes', 3 * MiB);
    await send(ann, id, doc, 2 * MiB);
    const days = async () => (await h.pool.query<{ day: string; bytes: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, bytes::text AS bytes FROM media_upload_days WHERE owner_id = $1 ORDER BY day", [ann.ownerId])).rows.map((r) => [r.day, Number(r.bytes)]);
    const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    expect(await days()).toEqual([[ago(0), 2 * MiB]]);
    // Another process, as after a restart, counts what this one did, because it reads it from the database every time.
    const second = await h.secondServer();
    try {
      const again = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
      expect(await refusal(again.workspaces.media.upload(id, doc, fileOf(bytesOf(2 * MiB))))).toEqual(TODAYS);
      await h.pool.query('DELETE FROM media_upload_days WHERE owner_id = $1', [ann.ownerId]);
      await again.workspaces.media.upload(id, doc, fileOf(bytesOf(2 * MiB)));
    } finally { await second.close(); }
    // Upkeep keeps today and yesterday, and nothing older.
    await h.pool.query('INSERT INTO media_upload_days (owner_id, day, bytes) VALUES ($1, $2, 1), ($1, $3, 1)', [ann.ownerId, ago(1), ago(2)]);
    await maintain(h.deps, { uploadAgeMs: ALREADY });
    expect((await days()).map(([d]) => d)).toEqual([ago(1), ago(0)]);
    // And it goes with the account.
    await ann.api.account.delete();
    expect(await days()).toEqual([]);
  });
});

describe('deleting a file', () => {
  it('takes it away for everyone, for anyone who can edit a document that has it, and nobody else', async () => {
    const ann = await account();
    const theo = await account();
    const kofi = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [kofi, 'read']]);
    const owner = await ownerOf(id);
    const first = await make(ann, id, 'document', 'First');
    const second = await make(ann, id, 'document', 'Second');
    const elsewhere = await make(theo, id, 'document', 'Doesn’t have it');
    const m = await ann.api.workspaces.media.upload(id, first, fileOf(bytesOf(PIECE + 1), 'by-mistake.png'));
    const stays = await ann.api.workspaces.media.upload(id, first, fileOf(bytesOf(8), 'stays.png'));
    await ann.api.workspaces.media.attach(id, second, m.id);
    const gone = (await h.pool.query<{ object_id: string }>('SELECT object_id FROM workspace_media_pieces WHERE owner_id = $1 AND media_id = $2', [owner, m.id])).rows.map((r) => r.object_id);
    expect(gone).toHaveLength(2);
    const staysBytes = Number((await h.pool.query<{ bytes: string }>('SELECT bytes FROM workspace_media WHERE owner_id = $1 AND media_id = $2', [owner, stays.id])).rows[0]?.bytes);
    const annsUrl = await ann.api.workspaces.media.url(id, first, m.id);
    const theosUrl = await theo.api.workspaces.media.url(id, second, m.id);

    // Reading a document that has it isn't enough, and nor is editing one that doesn't.
    expect(await code(kofi.api.workspaces.media.remove(id, first, m.id))).toBe('forbidden');
    expect(await refusal(theo.api.workspaces.media.remove(id, elsewhere, m.id))).toEqual(await refusal(theo.api.workspaces.media.remove(id, elsewhere, madeUp())));
    expect(await code(theo.api.workspaces.media.remove(id, elsewhere, m.id))).toBe('not-found');
    expect((await read(ann, annsUrl)).status).toBe(200);

    // Someone who can edit one document that has it deletes it for all of them: rows, stored bytes and objects.
    await theo.api.workspaces.media.remove(id, second, m.id);
    expect(await rowsOf(owner)).toEqual({ workspace_media: 1, workspace_media_pieces: 1, workspace_media_uses: 1 });
    for (const o of gone) expect(await stored(o), 'its objects').toBe(false);
    expect(await storedBytes(owner)).toBe(staysBytes);
    expect(await queued(owner)).toBe(0);

    // Whatever still points at it hears what it'd hear for a file that never was, and that's the app's cue to show it as removed.
    const nobody = await nothing();
    expect(await refused(ann, annsUrl)).toEqual(nobody);
    expect(await refused(theo, theosUrl, 'bytes=0-0')).toEqual(nobody);
    for (const doc of [first, second]) expect(await refusal(ann.api.workspaces.media.url(id, doc, m.id))).toEqual(await refusal(ann.api.workspaces.media.url(id, doc, madeUp())));
    expect((await ann.api.workspaces.media.list(id)).map((x) => x.id)).toEqual([stays.id]);
    expect(await code(ann.api.workspaces.media.attach(id, elsewhere, m.id))).toBe('not-found');
    expect(await code(theo.api.workspaces.media.remove(id, second, m.id))).toBe('not-found');
    // The other file in the document never noticed.
    expect((await read(ann, await ann.api.workspaces.media.url(id, first, stays.id))).status).toBe(200);
  });

  it('takes being able to edit everywhere you can see it: reusing a picture doesn’t make it yours to delete', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const board = await make(ann, id, 'document', 'Ann’s board');
    const his = await make(ann, id, 'document', 'Theo’s page');
    await ann.api.workspaces.share.set(id, his, [{ email: theo.email }], 'edit');
    const m = await ann.api.workspaces.media.upload(id, board, fileOf(bytesOf(16), 'ann.png'));
    const url = await ann.api.workspaces.media.url(id, board, m.id);

    // Through her board it's refused. Putting it on his own page and going through that is refused the same way.
    expect(await code(theo.api.workspaces.media.remove(id, board, m.id))).toBe('forbidden');
    await theo.api.workspaces.media.attach(id, his, m.id);
    expect(await code(theo.api.workspaces.media.remove(id, his, m.id))).toBe('forbidden');
    expect((await read(ann, url)).status).toBe(200);

    // A picture only he sees goes, as it's his to delete, and so does hers, for Ann, who can edit both.
    const own = await theo.api.workspaces.media.upload(id, his, fileOf(bytesOf(16), 'theo.png'));
    await theo.api.workspaces.media.remove(id, his, own.id);
    await ann.api.workspaces.media.remove(id, board, m.id);
    expect((await ann.api.workspaces.media.list(id)).map((x) => x.id)).toEqual([]);
  });

  it('is stopped by a document someone can’t open, in the same words as one they can only read, naming neither', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const shared = await make(ann, id, 'document', 'Plan');
    await ann.api.workspaces.share.set(id, shared, [{ email: theo.email }], 'edit');
    const secret = await make(ann, id, 'document', 'CANARY-HIDDEN-DOC');
    await ann.api.workspaces.share.restrict(id, secret, true);
    const notes = await make(ann, id, 'document', 'Notes');
    // One picture Ann also put in her restricted document, which Theo was never shown. Another in one he can only read.
    const hidden = await ann.api.workspaces.media.upload(id, shared, fileOf(bytesOf(16)));
    await ann.api.workspaces.media.attach(id, secret, hidden.id);
    const readOnly = await ann.api.workspaces.media.upload(id, shared, fileOf(bytesOf(16)));
    await ann.api.workspaces.media.attach(id, notes, readOnly.id);
    expect(await code(theo.api.workspaces.media.url(id, secret, hidden.id))).toBe('not-found');

    // Both are refused, the same way: nothing says which kind of document kept it, or names it.
    const from = h.logs.length;
    const refused = await refusal(theo.api.workspaces.media.remove(id, shared, hidden.id));
    expect(refused).toEqual({ code: 'forbidden', message: 'This file is also in a document you can’t edit.', status: 403 });
    expect(await refusal(theo.api.workspaces.media.remove(id, shared, readOnly.id))).toEqual(refused);
    expect(h.logs.slice(from).join('\n')).not.toContain('CANARY-HIDDEN-DOC');
    // Ann's restricted copy is still there, and she, who can edit both, can still delete it.
    expect((await read(ann, await ann.api.workspaces.media.url(id, secret, hidden.id))).status).toBe(200);
    await ann.api.workspaces.media.remove(id, shared, hidden.id);
    expect(await code(ann.api.workspaces.media.url(id, secret, hidden.id))).toBe('not-found');
  });

  it('leaves a document in Trash as it is, like everything else in it', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    await ann.api.workspaces.items.trash(id, doc);
    expect(await code(ann.api.workspaces.media.remove(id, doc, m.id))).toBe('conflict');
    await ann.api.workspaces.items.restore(id, doc);
    await ann.api.workspaces.media.remove(id, doc, m.id);
    expect(await ann.api.workspaces.media.list(id)).toEqual([]);
  });

  it('queues what the object store refuses, as any other delete does', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const [object] = await objectsOf(owner);
    const del = h.deps.objects.delete;
    h.deps.objects.delete = () => Promise.reject(new Error('the store is busy'));
    try { await ann.api.workspaces.media.remove(id, doc, m.id); } finally { h.deps.objects.delete = del; }
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
    expect(await queued(owner)).toBe(1);
    await maintain(h.deps);
    expect(await queued(owner)).toBe(0);
    expect(await stored(object ?? '')).toBe(false);
  });
});

describe('deleting', () => {
  it('holds a file while anything could still show it, and takes it, rows and objects, when nothing can', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    const doc = await make(ann, id, 'document', 'Plan');
    const other = await make(ann, id, 'document', 'Other');
    const stays = await make(ann, id, 'document', 'Stays');
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 1)));
    const kept = await ann.api.workspaces.media.upload(id, stays, fileOf(bytesOf(8)));
    await ann.api.workspaces.media.attach(id, other, m.id);
    const objects = await objectsOf(owner);
    const mine = (await h.pool.query<{ object_id: string }>('SELECT object_id FROM workspace_media_pieces WHERE owner_id = $1 AND media_id = $2', [owner, m.id])).rows.map((r) => r.object_id);
    expect(objects).toHaveLength(3);
    const keptBytes = Number((await h.pool.query<{ bytes: string }>('SELECT bytes FROM workspace_media WHERE owner_id = $1 AND media_id = $2', [owner, kept.id])).rows[0]?.bytes);

    // In Trash it keeps what it has.
    await ann.api.workspaces.items.trash(id, doc);
    expect((await rowsOf(owner))['workspace_media_uses']).toBe(3);
    expect((await read(ann, await ann.api.workspaces.media.url(id, doc, m.id))).status).toBe(200);
    // Deleting one document goes on holding it through the other.
    await ann.api.workspaces.items.deleteForever(id, doc);
    expect(await rowsOf(owner)).toEqual({ workspace_media: 2, workspace_media_pieces: 3, workspace_media_uses: 2 });
    for (const o of objects) expect(await stored(o)).toBe(true);
    const url = await ann.api.workspaces.media.url(id, other, m.id);
    expect((await read(ann, url)).status).toBe(200);

    // The last one to go takes it.
    await ann.api.workspaces.items.trash(id, other);
    await ann.api.workspaces.items.deleteForever(id, other);
    expect(await rowsOf(owner)).toEqual({ workspace_media: 1, workspace_media_pieces: 1, workspace_media_uses: 1 });
    for (const o of mine) expect(await stored(o), 'its objects').toBe(false);
    expect(await storedBytes(owner)).toBe(keptBytes);
    expect(await queued(owner)).toBe(0);
    expect(await refused(ann, url)).toEqual(await nothing());
    expect((await ann.api.workspaces.media.list(id)).map((x) => x.id)).toEqual([kept.id]);
  });

  it('goes for good from Trash on time, and with a folder, what it holds with it', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    const folder = await make(ann, id, 'folder', 'Folder');
    const doc = await make(ann, id, 'document', 'In the folder', folder);
    await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(8)));
    const lone = await make(ann, id, 'document', 'On its own');
    await ann.api.workspaces.media.upload(id, lone, fileOf(bytesOf(8)));
    const objects = await objectsOf(owner);

    await ann.api.workspaces.items.trash(id, folder);
    await ann.api.workspaces.items.deleteForever(id, folder);
    expect(await rowsOf(owner)).toEqual({ workspace_media: 1, workspace_media_pieces: 1, workspace_media_uses: 1 });
    await ann.api.workspaces.items.trash(id, lone);
    expect((await maintain(h.deps, { trashAgeMs: 0 })).trash).toBeGreaterThanOrEqual(1);
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
    for (const o of objects) expect(await stored(o)).toBe(false);
    expect(await storedBytes(owner)).toBe(0);
    expect(await queued(owner)).toBe(0);
  });

  it('queues what the object store refuses, and upkeep finishes it, deleted account or not', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    const doc = await make(ann, id, 'document', 'Plan');
    await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 1)));
    const objects = await objectsOf(owner);
    await ann.api.workspaces.items.trash(id, doc);
    const del = h.deps.objects.delete;
    const refusedId = objects[0] ?? '';
    h.deps.objects.delete = async (o) => { if (o === refusedId) throw new Error('the store is busy'); return del(o); };
    try {
      // The store's trouble is nobody's error: the document is gone.
      await ann.api.workspaces.items.deleteForever(id, doc);
      expect(await rowsOf(owner)).toEqual(NO_ROWS);
      expect(await stored(objects[1] ?? '')).toBe(false);
      expect(await stored(refusedId)).toBe(true);
      expect((await h.pool.query<{ object_id: string; attempts: number; last_error: string | null }>('SELECT object_id, attempts, last_error FROM object_gc WHERE owner_id = $1', [owner])).rows).toEqual([{ object_id: refusedId, attempts: 1, last_error: expect.any(String) }]);
      await maintain(h.deps);
      expect(await queued(owner)).toBe(1);
    } finally { h.deps.objects.delete = del; }
    await ann.api.workspaces.remove(id);
    await maintain(h.deps);
    expect(await queued(owner)).toBe(0);
    expect(await stored(refusedId)).toBe(false);
  });

  it('queues every object in the transaction that deletes it, so a process that stops next strands nothing', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    const doc = await make(ann, id, 'document', 'Plan');
    await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 1)));
    const objects = await objectsOf(owner);
    await ann.api.workspaces.items.trash(id, doc);
    // By the first call to the store the rows have gone and all of it is already in the queue: had the process stopped
    // there, upkeep would finish the job. Every delete fails, as if the store weren't there, and the queue holds them.
    const del = h.deps.objects.delete;
    const atFirstDelete: { rows: Record<string, number>; queued: number }[] = [];
    h.deps.objects.delete = async () => {
      atFirstDelete.push({ rows: await rowsOf(owner), queued: await queued(owner) });
      throw new Error('the store is gone');
    };
    try { await ann.api.workspaces.items.deleteForever(id, doc); } finally { h.deps.objects.delete = del; }
    expect(atFirstDelete[0]).toEqual({ rows: NO_ROWS, queued: 2 });
    expect(await queued(owner)).toBe(2);
    await maintain(h.deps);
    expect(await queued(owner)).toBe(0);
    for (const o of objects) expect(await stored(o)).toBe(false);
  });

  it('takes a whole workspace’s files when it goes', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    const doc = await make(ann, id, 'document', 'Plan');
    await ann.api.workspaces.media.upload(id, doc, fileOf(bytesOf(PIECE + 1)));
    const dropped = await started(ann, id, doc, 2 * PIECE);
    expect((await sendPiece(ann, `${place(id, doc)}/${dropped}/pieces/0`, bytesOf(PIECE))).status).toBe(200);
    const objects = await objectsOf(owner);
    expect(objects).toHaveLength(3);
    await ann.api.workspaces.remove(id);
    expect(await rowsOf(owner)).toEqual(NO_ROWS);
    for (const o of objects) expect(await stored(o)).toBe(false);
    expect(await queued(owner)).toBe(0);
  });

  it('takes what a deleted account leaves behind: a workspace left empty, and a restricted document only it could open', async () => {
    const leaver = await account();
    const stayer = await account();
    const alone = await workspace(leaver, 'Alone');
    const aloneOwner = await ownerOf(alone);
    await leaver.api.workspaces.media.upload(alone, await make(leaver, alone, 'document', 'Doc'), fileOf(bytesOf(8)));
    const shared = await workspace(stayer, 'Shared', [[leaver, 'edit']]);
    const sharedOwner = await ownerOf(shared);
    const lost = await make(leaver, shared, 'document', 'Only theirs');
    await leaver.api.workspaces.share.restrict(shared, lost, true);
    await leaver.api.workspaces.media.upload(shared, lost, fileOf(bytesOf(8)));
    const open = await make(leaver, shared, 'document', 'Open');
    const kept = await leaver.api.workspaces.media.upload(shared, open, fileOf(bytesOf(8)));
    const aloneObjects = await objectsOf(aloneOwner);
    const sharedObjects = await objectsOf(sharedOwner);
    expect(sharedObjects).toHaveLength(2);

    // The store has trouble with one of them; the deletion doesn't wait for it, and upkeep gets it.
    const del = h.deps.objects.delete;
    const refusedId = aloneObjects[0] ?? '';
    h.deps.objects.delete = async (o) => { if (o === refusedId) throw new Error('the store is busy'); return del(o); };
    try { await leaver.api.account.delete(); } finally { h.deps.objects.delete = del; }

    expect(await rowsOf(aloneOwner)).toEqual(NO_ROWS);
    expect(await queued(aloneOwner)).toBe(1);
    expect(await rowsOf(sharedOwner)).toEqual({ workspace_media: 1, workspace_media_pieces: 1, workspace_media_uses: 1 });
    expect((await Promise.all(sharedObjects.map(stored))).filter(Boolean)).toHaveLength(1);
    await maintain(h.deps);
    expect(await queued(aloneOwner)).toBe(0);
    expect(await stored(refusedId)).toBe(false);
    // What was left in the open stays, for whoever's left.
    expect((await read(stayer, await stayer.api.workspaces.media.url(shared, open, kept.id))).status).toBe(200);
  });

  it('leaves nothing for upkeep to take by mistake: an object a file needs is never an orphan', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Plan');
    const bytes = bytesOf(PIECE + 1);
    const m = await ann.api.workspaces.media.upload(id, doc, fileOf(bytes));
    const going = await started(ann, id, doc, 2 * PIECE);
    expect((await sendPiece(ann, `${place(id, doc)}/${going}/pieces/0`, bytesOf(PIECE))).status).toBe(200);
    // Written and never recorded, as when a request dies between the two.
    await h.objects.put('mediaorphanmediaorphan', new Uint8Array([1, 2, 3]));
    // The object store's clock can run a few milliseconds ahead of ours.
    await new Promise((r) => setTimeout(r, 1100));
    const r = await maintain(h.deps, { orphanAgeMs: 0 });
    expect(r.orphans).toBeGreaterThanOrEqual(1);
    expect(await stored('mediaorphanmediaorphan')).toBe(false);
    for (const o of await objectsOf(await ownerOf(id))) expect(await stored(o)).toBe(true);
    expect(same((await read(ann, await ann.api.workspaces.media.url(id, doc, m.id))).bytes, bytes)).toBe(true);
  });

  it('never keeps a piece from someone who lost the document while it was on its way, and its object goes too', async () => {
    const ann = await account();
    const priya = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    const doc = await make(ann, id, 'document', 'Plan');
    await ann.api.workspaces.share.set(id, doc, [{ email: priya.email }], 'edit');
    const m = await started(priya, id, doc, 2 * PIECE);
    const entry = (await ann.api.workspaces.share.list(id, doc)).entries[0]?.id ?? '';
    // The piece passes every check and reaches the store, and only then is the document taken from them.
    const put = h.deps.objects.put;
    let written = '';
    h.deps.objects.put = async (objectId, b) => {
      written = objectId;
      await put(objectId, b);
      await ann.api.workspaces.share.remove(id, doc, entry);
    };
    let status = 0;
    try { status = (await sendPiece(priya, `${place(id, doc)}/${m}/pieces/0`, bytesOf(PIECE))).status; } finally { h.deps.objects.put = put; }
    expect(status).toBe(404);
    expect(written).not.toBe('');
    expect(await stored(written)).toBe(false);
    expect((await rowsOf(owner))['workspace_media_pieces']).toBe(0);
    expect(await storedBytes(owner)).toBe(0);
  });
});
