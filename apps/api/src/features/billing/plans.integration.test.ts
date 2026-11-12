/**
 * Plans (docs: Plans and usage), end to end: the real API over HTTP via @alcove/api-http, real Postgres, the object store,
 * LiveKit and the fakes. Free's limits on storage, files and shared workspaces; accounts from before plans, carried onto
 * Free with time to get within its limits; what's over them going read-only for everyone once that time is up; a call's
 * longest and its most people; top-ups the previous release settled while this one deployed; and nothing of a plan
 * outliving its account.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import type { LimitName } from '../../limits';
import { maintain } from '../../maintenance';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';
import { creditCarried, DepositRecord } from './deposits';
import { endOverdue } from '../calls/lifecycle';
import { header as callHeader, key as callKey } from '../calls/state';
import { openOwner } from '../../owners';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(async () => { h.closeCalls(); vi.useRealTimers(); await h.resetLimits(); });

const MiB = 1024 * 1024;
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const refusal = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
const setLimit = (name: LimitName, value: number) => h.pool.query('INSERT INTO service_limits (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()', [name, value]);
const audioBytes = (n: number) => { const out = new Uint8Array(new ArrayBuffer(n)); out.set(randomBytes(n)); return out; };
const piece = (at: number, bytes = 2048): AudioPiece => ({ data: new Blob([audioBytes(bytes)]), segment: 0, seq: at, at: at * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, atMs: number): TranscriptClip => ({ data: new Blob([speechWav(words, 6000)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: 6000 });
const fileOf = (n: number) => new File([audioBytes(n)], 'harbour.png', { type: 'image/png' });
async function written(api: AlcoveApi, noteId: string): Promise<void> { for await (const p of api.notes.progress(noteId)) if (p.ready) return; }
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 200 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 25)); }
  return call.getSnapshot();
}
/** A shared workspace with a document in it, and `people` let in to edit. */
async function workspace(who: Account, name: string, people: Account[] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const p of people) await who.api.workspaces.addPerson(id, p.email, 'edit');
  const doc = (await who.api.workspaces.items.create(id, { kind: 'document', name: 'Plan', parent: null })).id;
  return { id, doc };
}
const addDoc = (who: Account, id: string) => refusal(who.api.workspaces.items.create(id, { kind: 'document', name: 'More', parent: null }));
const upload = (who: Account, at: { id: string; doc: string }, bytes: number) => refusal(who.api.workspaces.media.upload(at.id, at.doc, fileOf(bytes)));
/** As if the account had been made before plans: its plan's row is made the next time it's touched. */
const beforePlans = (who: Account) => h.pool.query('DELETE FROM plan_accounts WHERE owner_id = $1', [who.session.ownerId]);
const READ_ONLY = 'plan-limit: This workspace is read-only: its owner has more shared workspaces than their plan has. It works again once they upgrade or delete one.';
const FULL = 'plan-limit: Your storage is full. Delete something, or move to a plan with more room.';

describe('Free', () => {
  it('a new account starts on Free, with every number from the limits, and picks a plan first', async () => {
    const ann = await account();
    const plan = await ann.api.plans.plan();
    expect(plan).toMatchObject({
      kind: 'free', choose: true, grace: null, over: { workspaces: false, storage: false },
      notes: { minutesLeft: 300, minutesPerPeriod: 300, stopped: false },
      storage: { usedBytes: 0, limitBytes: 10 * 1024 * MiB, fileBytes: 512 * MiB },
      sharedWorkspaces: { made: 0, limit: 1000 }, balance: { microUsd: 0, history: [] }
    });
    // Its period is 30 days from when it began.
    expect(Date.parse(plan.period.to) - Date.parse(plan.period.from)).toBe(30 * 86_400_000);
  });

  it('renews its notes every period from when it began, and what was left doesn’t carry over', async () => {
    // Periods of an hour here (30 days unless the limit says otherwise), and notes reckoned at a tenth of a cent a minute.
    await setLimit('plan.period_seconds', 3600);
    await setLimit('ai.hour_micro_usd', 60_000);
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Used' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    const used = await ann.api.plans.plan();
    expect(Date.parse(used.period.to) - Date.parse(used.period.from)).toBe(3_600_000);
    expect(used.notes.minutesLeft).toBeLessThan(300);
    // The next period has all its notes again.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(used.period.to) + 60_000 });
    const next = await ann.api.plans.plan();
    expect(next.period.from).toBe(used.period.to);
    expect(next.notes.minutesLeft).toBe(300);
  });

  it('makes one shared workspace, and joins any number; a call’s own doesn’t count', async () => {
    await setLimit('plan.free.shared_workspaces', 1);
    const ann = await account();
    const bob = await account();
    await workspace(ann, 'Ours');
    expect(await refusal(ann.api.workspaces.create('Another'))).toBe('plan-limit: Free has one shared workspace, and you have it. Move to Pro for as many as you like.');
    // Bob's is his one; Ann can be in it.
    const his = await workspace(bob, 'His', [ann]);
    expect(await addDoc(ann, his.id)).toBe('succeeded');
    // A call's own workspace is the call's: Ann starts one with notes and still has her one shared workspace.
    const c = await ann.api.calls.startNow({ notes: 'on' });
    const host = await ann.api.calls.join(c.code, { mic: true, cam: false });
    await host.leave();
    expect((await ann.api.plans.plan()).sharedWorkspaces).toEqual({ made: 1, limit: 1 });
  });

  it('takes files up to its plan’s size, while there’s room, counting a workspace’s files against whoever made it', async () => {
    const ann = await account();
    const bob = await account();
    const ours = await workspace(ann, 'Ours', [bob]);
    await setLimit('plan.free.file_bytes', MiB);
    expect(await upload(bob, ours, MiB + 1)).toBe('invalid: This file is bigger than 1 MiB, the most a file can be here.');
    await setLimit('plan.free.storage_bytes', 2 * MiB);
    expect(await upload(bob, ours, MiB)).toBe('succeeded');
    // Bob added it, but it's Ann's workspace: it's Ann's storage it takes.
    expect((await ann.api.plans.plan()).storage.usedBytes).toBeGreaterThan(MiB);
    expect((await bob.api.plans.plan()).storage.usedBytes).toBe(0);
    expect(await upload(bob, ours, MiB)).toBe(FULL);
  });

  it('counts call recordings against the organizer, and stops notes for everyone when they fill it', async () => {
    const org = await account();
    const meeting = await org.api.meetings.create({ title: 'Review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: DEFAULT_NOTES_CHOICES });
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    await host.appendAudio(piece(0, 40 * 1024));
    // Storage that the next piece won't fit in.
    await setLimit('plan.free.storage_bytes', 64 * 1024);
    expect(code(await host.appendAudio(piece(1, 40 * 1024)).catch((e: unknown) => e))).toBe('plan-limit');
    const now = await settle(host, (s) => s.capture.stopped !== null);
    expect(now.capture).toMatchObject({ mode: 'off', stopped: { reason: 'storage' } });
    expect(await refusal(host.setNotes(true))).toBe('plan-limit: Your storage is full, so notes can’t be kept. Delete something, or move to a plan with more room.');
    expect((await org.api.plans.plan()).storage.usedBytes).toBeGreaterThan(40 * 1024);
  });
});

describe('accounts from before plans', () => {
  it('carries one over onto Free, works as before during the grace, then makes what’s past Free read-only for everyone', async () => {
    const ann = await account();
    const bob = await account();
    const oldest = await workspace(ann, 'Oldest', [bob]);
    const middle = await workspace(ann, 'Middle', [bob]);
    const newest = await workspace(ann, 'Newest', [bob]);
    // Plans arrive: Free has one shared workspace, and an hour's grace for an account already over it.
    await setLimit('plan.free.shared_workspaces', 1);
    await setLimit('plan.grace_seconds', 3600);
    await beforePlans(ann);
    const carried = await ann.api.plans.plan();
    expect(carried).toMatchObject({ kind: 'free', choose: true, sharedWorkspaces: { made: 3, limit: 1 }, grace: { workspaces: true, storage: false }, over: { workspaces: false } });
    expect(Date.parse(carried.grace?.until ?? '')).toBeGreaterThan(Date.now() + 3_500_000);
    // Everything works as it did, a fourth workspace included.
    for (const w of [oldest, middle, newest]) expect(await addDoc(bob, w.id)).toBe('succeeded');
    const fourth = await workspace(ann, 'Fourth');
    // Upkeep, once the grace is over: the oldest stays as it was; the rest are read-only, for everyone in them.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * 3_600_000 });
    await h.pool.query('UPDATE plan_accounts SET due_at = now() WHERE owner_id = $1', [ann.session.ownerId]);
    await maintain(h.deps);
    expect(await ann.api.plans.plan()).toMatchObject({ grace: null, over: { workspaces: true } });
    expect(await addDoc(bob, oldest.id)).toBe('succeeded');
    for (const w of [middle, newest, fourth]) {
      expect(await addDoc(ann, w.id)).toBe(READ_ONLY);
      expect(await upload(ann, w, 1024)).toBe(READ_ONLY);
      expect((await ann.api.workspaces.get(w.id)).frozen).toBe(true);
    }
    expect(await addDoc(bob, middle.id)).toBe(READ_ONLY);
    expect((await bob.api.workspaces.get(oldest.id)).frozen).toBe(false);
    // An admin can still delete one: one fewer is still over, so the rest stay read-only, until only the oldest is left.
    await ann.api.workspaces.remove(fourth.id);
    await ann.api.workspaces.remove(newest.id);
    expect(await addDoc(ann, middle.id)).toBe(READ_ONLY);
    await ann.api.workspaces.remove(middle.id);
    expect(await ann.api.plans.plan()).toMatchObject({ over: { workspaces: false }, sharedWorkspaces: { made: 1 } });
  });

  it('carries over an account within Free’s limits without a grace, and shows the plans once', async () => {
    const ann = await account();
    await beforePlans(ann);
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', choose: true, grace: null });
  });

  it('gives every account from before plans its plan in upkeep, so a grace runs out even for someone who never comes back', async () => {
    const ann = await account();
    await workspace(ann, 'One');
    await workspace(ann, 'Two');
    await setLimit('plan.free.shared_workspaces', 1);
    await beforePlans(ann);
    await maintain(h.deps);
    expect((await h.pool.query('SELECT due_at IS NOT NULL AS due FROM plan_accounts WHERE owner_id = $1', [ann.session.ownerId])).rows[0]).toEqual({ due: true });
  });
});

describe('a call’s limits', () => {
  it('ends at its longest, when it said it would, and writes its notes', async () => {
    const org = await account();
    const meeting = await org.api.meetings.create({ title: 'Long', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: DEFAULT_NOTES_CHOICES });
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    const state = await settle(host, () => true);
    expect(Date.parse(state.endsAt) - Date.parse(state.startedAt)).toBe(10 * 3_600_000);
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    expect(await endOverdue(h.deps)).toBe(0);
    // Ten hours on.
    await h.pool.query("UPDATE calls SET started_at = now() - interval '10 hours 1 second' WHERE call_id = $1", [host.ticket.callId]);
    expect(await endOverdue(h.deps)).toBe(1);
    const [note] = (await org.api.notes.list()).filter((n) => n.title === 'Long');
    await written(org.api, note?.id ?? '');
    expect((await org.api.notes.get(note?.id ?? '')).decisions.map((d) => d.text)).toEqual(['We agreed to ship on Monday.']);
  });

  it('reads a live call the previous release stored, which knows nothing of plans, as not stopped', async () => {
    const org = await account();
    const meeting = await org.api.meetings.create({ title: 'Older', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: DEFAULT_NOTES_CHOICES });
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    const callId = host.ticket.callId;
    const o = await openOwner(h.deps, org.session.ownerId, undefined);
    const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE call_id = $1', [callId])).rows[0]);
    const stored = openJson(callKey(o, callId), callHeader(o, callId), row.state_ciphertext, z.object({ notes: z.record(z.string(), z.unknown()) }).passthrough());
    const { limit: _limit, ...notes } = stored.notes;
    await h.pool.query('UPDATE calls SET state_ciphertext = $2 WHERE call_id = $1', [callId, sealJson(callKey(o, callId), callHeader(o, callId), toJson({ ...stored, notes }))]);
    expect((await settle(host, () => true)).capture).toMatchObject({ mode: 'on', stopped: null, runningOut: null });
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    expect((await settle(host, (s) => s.transcript.length > 0)).transcript).toHaveLength(1);
  });

  it('turns away anyone past the most people a call can have, and tells whoever hosts', async () => {
    await setLimit('call.max_people', 2);
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect(await refusal(h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Lee' }))).toBe('conflict: This call is full: 2 people are in it, the most a call can have.');
    const told = await settle(host, (s) => s.notices.some((n) => n.text.startsWith('Someone tried to join')));
    expect(told.notices.map((n) => n.text)).toContain('Someone tried to join, but this call is full: 2 people is the most a call can have.');
  });
});

describe('money', () => {
  it('adds as dollars a top-up the previous release settled while this one deployed, once', async () => {
    const ann = await account();
    const t = await ann.api.plans.startTopUp('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', 25_000_000);
    h.oneclick.set(t.address ?? '', 'SUCCESS', { depositedAmount: '25000000', amountOut: '25000000', intentHashes: ['carried-intent'] });
    await ann.api.plans.topUp(t.id);
    expect((await ann.api.plans.plan()).balance.microUsd).toBe(25_000_000);
    // As the previous release left it: settled, its credits added, nothing in dollars; the balance as it was before.
    const key = serviceKey(unb64u(h.deps.cfg.KSERVICE, 32), 'accounting');
    const header = { v: 1 as const, kind: 'deposit', ownerId: ann.session.ownerId, depositId: t.id, keyVersion: '1' };
    const row = z.object({ record_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT record_ciphertext FROM deposits WHERE deposit_id = $1', [t.id])).rows[0]);
    const rec = openJson(key, header, row.record_ciphertext, DepositRecord);
    const old = { ...rec, settled: rec.settled && { ...rec.settled, addedMicroUsd: null } };
    await h.pool.query('UPDATE deposits SET record_ciphertext = $2, checked_at = (SELECT at FROM billing_cutover) + interval \'1 minute\' WHERE deposit_id = $1', [t.id, sealJson(key, header, toJson(old))]);
    await h.pool.query('DELETE FROM plan_accounts WHERE owner_id = $1', [ann.session.ownerId]);
    expect((await ann.api.plans.plan()).balance.microUsd).toBe(0);
    expect(await creditCarried(h.deps)).toBe(1);
    expect(await creditCarried(h.deps)).toBe(0);
    const plan = await ann.api.plans.plan();
    expect(plan.balance.microUsd).toBe(25_000_000);
    expect(plan.balance.history.map((e) => e.label)).toEqual(['Added, 25 USDC']);
  });
});

describe('deleting an account', () => {
  it('deletes its plan and its allowance with it', async () => {
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Used' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    const rows = async () => (await h.pool.query<{ n: number }>('SELECT (SELECT count(*) FROM plan_accounts WHERE owner_id = $1) + (SELECT count(*) FROM ai_meters WHERE owner_id = $1) AS n', [ann.session.ownerId])).rows[0]?.n;
    expect(Number(await rows())).toBe(2);
    await ann.api.account.delete();
    expect(Number(await rows())).toBe(0);
  });
});
