/**
 * Storage (docs: Plans and usage › Storage), end to end: the real API over HTTP via @alcove/api-http, real Postgres, the
 * object store and, for calls, LiveKit. What refuses more once an account's storage is full, and what each refusal logs.
 */
import { AlcoveApiError, type AlcoveApi } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => {
  // Files here are megabytes, and the bucket outlives this run: whatever reads all of it next would pay for each one left.
  if (h) for await (const o of h.objects.list()) await h.objects.delete(o.id);
  await h?.close();
  await disposeLiveKit();
});
afterEach(async () => { h.closeCalls(); vi.useRealTimers(); await h.resetLimits(); });

const MiB = 1024 * 1024;
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
/** How a request ended, as a browser hears it: `succeeded`, or its code and words. */
const said = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
const bytesOf = (n: number) => { const out = new Uint8Array(new ArrayBuffer(n)); out.set(randomBytes(n)); return out; };
const fileOf = (n: number) => new File([bytesOf(n)], 'harbour.png', { type: 'image/png' });
/** A shared workspace with a document in it, and `people` let in at `role`. */
async function workspace(who: Account, name: string, people: Account[] = [], role: 'edit' | 'admin' = 'edit') {
  const { id } = await who.api.workspaces.create(name);
  for (const p of people) await who.api.workspaces.addPerson(id, p.email, role);
  const doc = (await who.api.workspaces.items.create(id, { kind: 'document', name: 'Plan', parent: null })).id;
  return { id, doc };
}
const upload = (api: AlcoveApi, at: { id: string; doc: string }, bytes: number, pass?: string) => said(api.workspaces.media.upload(at.id, at.doc, fileOf(bytes), pass === undefined ? {} : { pass }));
const FULL = 'plan-limit: Your storage is full. Delete something, or move to a plan with more room.';
/** The API's log line that said `msg` since `from`, parsed: a refusal's line is its words, with its context beside them. */
const LogLine = z.object({ msg: z.string() }).passthrough();
const logged = (from: number, msg: string) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success && r.data.msg === msg ? [r.data] : []; });

describe('a refusal for room', () => {
  it('logs the plan’s limit by its name and the sizes: a file too big, and storage that’s full', async () => {
    const ann = await account();
    const ours = await workspace(ann, 'Ours');
    await h.setLimit('plan.free.file_bytes', MiB);
    const from = h.logs.length;
    expect(await upload(ann.api, ours, MiB + 1)).toBe('invalid: This file is bigger than 1 MiB, the most a file can be here.');
    expect(logged(from, 'This file is bigger than 1 MiB, the most a file can be here.')).toEqual([
      expect.objectContaining({ limit: 'plan.free.file_bytes', limitBytes: MiB, sizeBytes: MiB + 1, workspaceId: ours.id })
    ]);
    expect(await upload(ann.api, ours, MiB / 2)).toBe('succeeded');
    await h.setLimit('plan.free.storage_bytes', MiB);
    expect(await upload(ann.api, ours, MiB)).toBe(FULL);
    const [full] = logged(from, 'Your storage is full. Delete something, or move to a plan with more room.');
    expect(full).toMatchObject({ reason: 'storage', limit: 'plan.free.storage_bytes', addingBytes: MiB, limitBytes: MiB, grace: false, ownerId: ann.session.ownerId });
    expect(z.object({ usedBytes: z.number() }).parse(full).usedBytes).toBeGreaterThan(MiB / 2);
  });
});
