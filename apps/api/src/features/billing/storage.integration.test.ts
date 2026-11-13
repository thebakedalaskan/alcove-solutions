/**
 * Storage (docs: Plans and usage › Storage), end to end: the real API over HTTP via @alcove/api-http, real Postgres, the
 * object store and, for calls, LiveKit. What refuses more once an account's storage is full, and what each refusal logs;
 * who pays for a workspace once whoever did isn't in it any more; and what others can add to whoever pays.
 */
import { AlcoveApiError, type AlcoveApi, type CallSession, type CallState } from '@alcove/api';
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

async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 200 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** A call `org` is in, notes off, and `names` joining by its link as guests and let in, each with their seat. */
async function callWith(org: Account, names: string[]) {
  const { code } = await org.api.calls.startNow({ notes: 'off' });
  const host = await org.api.calls.join(code, { mic: false, cam: false });
  await inGroup(host);
  const guests: { api: AlcoveApi; call: CallSession; pass: string; seat: string }[] = [];
  for (const name of names) {
    const b = h.browser();
    const call = await b.api.calls.join(code, { mic: false, cam: false, name });
    await settle(host, (s) => s.waiting.some((w) => w.id === call.ticket.identity));
    await host.admit(call.ticket.identity);
    await inGroup(call);
    const seat = (await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity))).participants.find((p) => p.id === call.ticket.identity)?.seat ?? '';
    guests.push({ api: b.api, call, pass: call.ticket.pass, seat });
  }
  return { host, guests };
}

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

describe('what others can add', () => {
  const KEPT = 'plan-limit: This workspace can’t take more files now: the rest of the storage it counts against is kept for notes and recordings.';
  const OTHERS_FULL = 'plan-limit: This workspace can’t take more files: the storage it counts against is full.';
  const OTHERS_DAY = 'conflict: That’s all you can add today to the storage this workspace counts against. You can add more tomorrow.';
  const today = () => new Date().toISOString().slice(0, 10);

  it('counts what anyone adds against whoever pays, and keeps the last of the payer’s room for their own notes and recordings', async () => {
    const ann = await account();
    const bob = await account();
    const ours = await workspace(ann, 'Ours', [bob]);
    // The file size is the payer's plan's.
    await h.setLimit('plan.free.file_bytes', MiB);
    expect(await upload(bob.api, ours, MiB + 1)).toBe('invalid: This file is bigger than 1 MiB, the most a file can be here.');
    await h.resetLimits();
    await h.setLimit('plan.free.storage_bytes', 4 * MiB);
    await h.setLimit('media.payer_reserve_bytes', 2 * MiB);
    // Bob adds what leaves Ann her 2 MiB: Ann's to pay for, not his.
    expect(await upload(bob.api, ours, MiB)).toBe('succeeded');
    expect((await storage(ann)).usedBytes).toBeGreaterThan(MiB);
    expect((await storage(bob)).usedBytes).toBe(0);
    // Another MiB would reach into the room kept for Ann's notes and recordings: refused, saying nobody's amounts or name.
    const from = h.logs.length;
    expect(await upload(bob.api, ours, MiB)).toBe(KEPT);
    expect(logged(from, KEPT.slice('plan-limit: '.length))).toEqual([expect.objectContaining({
      reason: 'storage', why: 'kept for notes', limit: 'plan.free.storage_bytes', limitBytes: 4 * MiB, reserveBytes: 2 * MiB, addingBytes: MiB, ownerId: ann.session.ownerId, theirs: false
    })]);
    // Ann's own upload into it works: the room is hers.
    expect(await upload(ann.api, ours, MiB + MiB / 2)).toBe('succeeded');
    // Full: Bob hears the workspace can't take more, and Ann that her storage is full.
    expect(await upload(bob.api, ours, 2 * MiB)).toBe(OTHERS_FULL);
    expect(await upload(ann.api, ours, 2 * MiB)).toBe(FULL);
  });

  it('holds someone signed in to what they add to another’s storage in a day, and guests to much less between them', async () => {
    const org = await account();
    const bob = await account();
    const ours = await workspace(org, 'Ours', [bob]);
    await h.setLimit('media.others_day_bytes', 3 * MiB);
    await h.setLimit('media.guests_day_bytes', 2 * MiB);
    expect(await upload(bob.api, ours, 2 * MiB)).toBe('succeeded');
    expect(await upload(bob.api, ours, 2 * MiB)).toBe(OTHERS_DAY);
    expect(await upload(bob.api, ours, MiB)).toBe('succeeded');
    // In a workspace he pays for, nothing of the kind.
    const his = await workspace(bob, 'His');
    expect(await upload(bob.api, his, 2 * MiB)).toBe('succeeded');
    // Guests in Org's call add 2 MiB between them, however many there are.
    const { host, guests } = await callWith(org, ['Sam Guest', 'Jo Guest']);
    const [sam, jo] = guests;
    if (!sam || !jo) throw new Error('nobody joined');
    await org.api.workspaces.share.set(ours.id, ours.doc, [{ seat: sam.seat }, { seat: jo.seat }], 'edit', { pass: host.ticket.pass });
    expect(await upload(sam.api, ours, MiB, sam.pass)).toBe('succeeded');
    expect(await upload(jo.api, ours, MiB + MiB / 2, jo.pass)).toBe(OTHERS_DAY);
    expect(await upload(jo.api, ours, MiB / 2, jo.pass)).toBe('succeeded');
    // The organizer is held to neither.
    expect(await upload(org.api, ours, 4 * MiB)).toBe('succeeded');
    // Counted by the payer and the account, or the payer alone for guests: IDs, days and sizes, nothing that names a guest.
    const others = await h.pool.query<{ day: string; bytes: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, bytes::text AS bytes FROM media_others_days WHERE payer_owner_id = $1 AND owner_id = $2", [org.session.ownerId, bob.session.ownerId]);
    expect(others.rows).toEqual([{ day: today(), bytes: String(3 * MiB) }]);
    const guestsAdded = await h.pool.query<{ day: string; bytes: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, bytes::text AS bytes FROM media_guest_payer_days WHERE payer_owner_id = $1", [org.session.ownerId]);
    expect(guestsAdded.rows).toEqual([{ day: today(), bytes: String(MiB + MiB / 2) }]);
    // Upkeep keeps today and yesterday, and nothing older.
    await h.pool.query("INSERT INTO media_guest_payer_days (payer_owner_id, day, bytes) VALUES ($1, current_date - 2, 1)", [org.session.ownerId]);
    await maintain(h.deps);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM media_guest_payer_days WHERE payer_owner_id = $1', [org.session.ownerId])).rows[0]).toEqual({ n: 1 });
  });

  it('lets people licensed on the payer’s team add to its pool as to their own, and nobody else', async () => {
    const ann = await account();
    const bob = await account();
    const cy = await account();
    await ann.api.teams.create('Vandelay Industries');
    // Money for two licenses, sent as a person sends it: a top-up the fake 1Click settles in full.
    const t = await ann.api.plans.startTopUp('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', 2 * 40_000_000);
    h.oneclick.set(t.address ?? '', 'SUCCESS', { depositedAmount: String(2 * 40_000_000), amountOut: String(2 * 40_000_000), intentHashes: [`licenses-${t.id}`] });
    await ann.api.plans.topUp(t.id);
    await ann.api.teams.buyLicenses(2, 40_000_000);
    await ann.api.auth.visit();
    const link = (await ann.api.teams.invite()).link;
    await bob.api.teams.join(link.slice(link.indexOf('#') + 1));
    const ours = await workspace(ann, 'Ours', [bob, cy]);
    await h.setLimit('media.others_day_bytes', MiB);
    expect(await upload(bob.api, ours, 2 * MiB)).toBe('succeeded');
    expect(await upload(cy.api, ours, 2 * MiB)).toBe(OTHERS_DAY);
  });
});
