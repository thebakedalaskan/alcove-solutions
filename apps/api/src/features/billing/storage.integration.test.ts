/**
 * Storage (docs: Plans and usage › Storage), end to end: the real API over HTTP via @alcove/api-http, real Postgres, the
 * object store and, for calls, LiveKit. What refuses more once an account's storage is full, and what each refusal logs;
 * and who pays for a workspace once whoever did isn't in it any more.
 */
import { AlcoveApiError, type AlcoveApi } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LIMITS } from '../../limits';
import { maintain } from '../../maintenance';
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
const NOBODY = 'conflict: Files can’t be added until one of this workspace’s admins signs in to Alcove.';
const HOUR = 3_600_000;
/** Free's storage, as the limits table has it by default. */
const LIMITS_FREE = LIMITS['plan.free.storage_bytes'].default;
/** What an account stores, and what it's held to, as its plan says. */
const storage = async (who: Account) => (await who.api.plans.plan()).storage;
/** Someone's place in a workspace, as another person in it sees them. */
const memberOf = async (asking: Account, id: string, who: Account) => (await asking.api.workspaces.people(id)).find((p) => p.person.email === who.email)?.id ?? 'nobody';
/** What a workspace stores, by its sealed pieces: what its payer is counted as storing for it. */
const storedBy = async (id: string) => Number((await h.pool.query<{ bytes: string }>('SELECT o.stored_bytes::text AS bytes FROM workspaces w JOIN owners o ON o.owner_id = w.owner_id WHERE w.workspace_id = $1', [id])).rows[0]?.bytes);
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

describe('who pays for a workspace', () => {
  it('moves to its longest-standing admin with an account when whoever paid is taken out or leaves, who is told, and whose storage takes its files once a grace ends', async () => {
    const ann = await account();
    const bob = await account();
    const cy = await account();
    // Bob, an admin, takes Ann out of the workspace she made and pays for. Bob's storage is far too small for its files.
    const taken = await workspace(ann, 'Harbour launch', [bob], 'admin');
    expect(await upload(ann.api, taken, MiB)).toBe('succeeded');
    const held = await storedBy(taken.id);
    await h.setLimit('plan.free.storage_bytes', MiB / 2);
    await h.setLimit('workspaces.payer_grace_seconds', 3600);
    await bob.api.workspaces.removePerson(taken.id, await memberOf(bob, taken.id, ann));
    expect((await storage(ann)).usedBytes).toBe(0);
    // It's his to pay for now, and what it held is on top of his storage for the grace: nothing of his stops.
    const plan = await bob.api.plans.plan();
    expect(plan.storage).toMatchObject({ usedBytes: held, limitBytes: MiB / 2 + held });
    expect(Date.parse(plan.grace?.until ?? '')).toBeGreaterThan(Date.now() + HOUR - 60_000);
    expect(plan.grace?.until).not.toBeUndefined();
    expect(plan.notices).toEqual([expect.objectContaining({ kind: 'workspace-payer', workspaceId: taken.id, until: plan.grace?.until, count: null })]);
    // The plan says the workspace by its ID alone: its name is under its own keys.
    expect(JSON.stringify(plan.notices)).not.toContain('Harbour');
    expect(await upload(bob.api, taken, MiB / 4)).toBe('succeeded');
    // Once the grace is over, its files count: Bob is over his storage.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * HOUR });
    expect(await upload(bob.api, taken, 1024)).toBe(FULL);
    expect(await bob.api.plans.plan()).toMatchObject({ grace: null, over: { storage: true } });
    vi.useRealTimers();
    // Leaving one you pay for does the same, for the admin who's been in it longest with an account.
    await h.resetLimits();
    const left = await workspace(ann, 'Left', [cy, bob], 'admin');
    expect(await upload(ann.api, left, MiB)).toBe('succeeded');
    await ann.api.workspaces.removePerson(left.id, await memberOf(ann, left.id, ann));
    expect((await storage(ann)).usedBytes).toBe(0);
    expect((await storage(cy)).usedBytes).toBe(await storedBy(left.id));
    expect((await cy.api.plans.plan()).notices).toEqual([expect.objectContaining({ kind: 'workspace-payer', workspaceId: left.id })]);
    expect((await bob.api.plans.plan()).notices.filter((n) => n.workspaceId === left.id)).toEqual([]);
    // Dismissed, it's gone.
    const [told] = (await cy.api.plans.plan()).notices;
    expect((await cy.api.plans.dismissNotice(told?.id ?? '')).notices).toEqual([]);
  });

  it('passes a grace that’s running on as it was, so moving payment back and forth makes no more room', async () => {
    const ann = await account();
    const bob = await account();
    const ours = await workspace(ann, 'Ours', [bob], 'admin');
    expect(await upload(ann.api, ours, MiB)).toBe('succeeded');
    const held = await storedBy(ours.id);
    await ann.api.workspaces.removePerson(ours.id, await memberOf(ann, ours.id, ann));
    const first = (await bob.api.plans.plan()).notices.find((n) => n.workspaceId === ours.id);
    // Bob adds more, lets Ann back in as an admin, and leaves: Ann pays again, within the same grace, over the same bytes.
    expect(await upload(bob.api, ours, MiB)).toBe('succeeded');
    await bob.api.workspaces.addPerson(ours.id, ann.email, 'admin');
    await bob.api.workspaces.removePerson(ours.id, await memberOf(bob, ours.id, bob));
    const again = await ann.api.plans.plan();
    expect(again.notices.find((n) => n.workspaceId === ours.id)?.until).toBe(first?.until);
    expect(again.storage.limitBytes - again.storage.usedBytes).toBe(LIMITS_FREE - (await storedBy(ours.id) - held));
  });

  it('refuses its payer’s leaving while none of its other admins has an account, and lets them go once one has', async () => {
    const ann = await account();
    const later = unique('signs-in-later');
    const ours = await workspace(ann, 'Ours');
    await ann.api.workspaces.addPerson(ours.id, later, 'admin');
    const me = await memberOf(ann, ours.id, ann);
    expect(await said(ann.api.workspaces.removePerson(ours.id, me))).toBe('conflict: You pay for this workspace’s storage, and none of its other admins has an Alcove account to take that on. Make someone who has one an admin, then leave.');
    // Nothing changed: she's in it, and pays for it.
    expect((await ann.api.workspaces.people(ours.id)).some((p) => p.isMe)).toBe(true);
    expect(await upload(ann.api, ours, 1024)).toBe('succeeded');
    expect((await storage(ann)).usedBytes).toBeGreaterThan(1024);
    // The other admin signs in: now she can leave, and it's theirs to pay for.
    const admin = await account(later);
    expect(await said(ann.api.workspaces.removePerson(ours.id, me))).toBe('succeeded');
    expect((await storage(admin)).usedBytes).toBeGreaterThan(1024);
    expect((await admin.api.plans.plan()).notices).toEqual([expect.objectContaining({ kind: 'workspace-payer', workspaceId: ours.id })]);
  });

  it('moves one whose payer deletes their account as when they leave, and leaves one none of whose admins has an account to nobody until one signs in', async () => {
    const ann = await account();
    const bob = await account();
    const cy = await account();
    // One with another admin who has an account: theirs, told, with a grace.
    const kept = await workspace(ann, 'Kept', [bob], 'admin');
    expect(await upload(ann.api, kept, MiB)).toBe('succeeded');
    // One whose other admin hasn't signed in yet, where Cy edits: nobody's, so it takes no files.
    const later = unique('signs-in-later');
    const orphan = await workspace(ann, 'Orphan', [cy]);
    await ann.api.workspaces.addPerson(orphan.id, later, 'admin');
    expect(await upload(cy.api, orphan, 1024)).toBe('succeeded');
    await ann.api.account.delete();
    expect((await storage(bob)).usedBytes).toBe(await storedBy(kept.id));
    expect((await bob.api.plans.plan()).notices).toEqual([expect.objectContaining({ kind: 'workspace-payer', workspaceId: kept.id })]);
    expect(await upload(cy.api, orphan, 1024)).toBe(NOBODY);
    // Upkeep finds nobody to pay for it either.
    await maintain(h.deps);
    expect(await upload(cy.api, orphan, 1024)).toBe(NOBODY);
    // The admin signs in: from upkeep's next pass, files are taken again, and count against them.
    const admin = await account(later);
    await maintain(h.deps);
    expect(await upload(cy.api, orphan, 1024)).toBe('succeeded');
    expect((await storage(admin)).usedBytes).toBe(await storedBy(orphan.id));
  });
});
