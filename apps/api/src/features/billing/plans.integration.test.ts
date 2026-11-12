/**
 * Plans (docs: Plans and usage), end to end: the real API over HTTP via @alcove/api-http, real Postgres, the object store,
 * LiveKit and the fakes. Free's limits on storage and files; accounts from before plans, carried onto Free with time to
 * get within its limits; what's over them taking no more once that time is up; a call's
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
import { creditByEmail, standingOf } from './support';
import { createHttpApi } from '@alcove/api-http';

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
const FULL = 'plan-limit: Your storage is full. Delete something, or move to a plan with more room.';

describe('Free', () => {
  it('a new account starts on Free, with every number from the limits, and picks a plan first', async () => {
    const ann = await account();
    const plan = await ann.api.plans.plan();
    expect(plan).toMatchObject({
      kind: 'free', choose: true, grace: null, over: { storage: false },
      notes: { minutesLeft: 300, minutesPerPeriod: 300, stopped: false },
      storage: { usedBytes: 0, limitBytes: 10 * 1024 * MiB, fileBytes: 512 * MiB },
      balance: { microUsd: 0, history: [] }
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

  it('makes as many shared workspaces as it likes, and every one works', async () => {
    const ann = await account();
    const bob = await account();
    const made = [await workspace(ann, 'One'), await workspace(ann, 'Two'), await workspace(ann, 'Three')];
    for (const w of made) {
      expect(await addDoc(ann, w.id)).toBe('succeeded');
      expect(await upload(ann, w, 1024)).toBe('succeeded');
    }
    const his = await workspace(bob, 'His', [ann]);
    expect(await addDoc(ann, his.id)).toBe('succeeded');
    expect((await ann.api.workspaces.list()).length).toBe(4);
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
  it('carries one over onto Free, works as before during the grace, then takes no more files', async () => {
    const ann = await account();
    const bob = await account();
    const ours = await workspace(ann, 'Ours', [bob]);
    expect(await upload(bob, ours, MiB)).toBe('succeeded');
    // Plans arrive: Free's storage is smaller than what Ann already stores, and an hour's grace for an account over it.
    await setLimit('plan.free.storage_bytes', MiB / 2);
    await setLimit('plan.grace_seconds', 3600);
    await beforePlans(ann);
    const carried = await ann.api.plans.plan();
    expect(carried).toMatchObject({ kind: 'free', choose: true, grace: { storage: true }, over: { storage: false } });
    expect(Date.parse(carried.grace?.until ?? '')).toBeGreaterThan(Date.now() + 3_500_000);
    // Everything works as it did: more files go in.
    expect(await upload(bob, ours, MiB)).toBe('succeeded');
    // Upkeep, once the grace is over: nothing more is stored, but what's there stays readable and can be deleted.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * 3_600_000 });
    await h.pool.query('UPDATE plan_accounts SET due_at = now() WHERE owner_id = $1', [ann.session.ownerId]);
    await maintain(h.deps);
    expect(await ann.api.plans.plan()).toMatchObject({ grace: null, over: { storage: true } });
    expect(await upload(bob, ours, 1024)).toBe(FULL);
    expect(await upload(ann, ours, 1024)).toBe(FULL);
    expect(await addDoc(ann, ours.id)).toBe('succeeded');
  });

  it('carries over an account within Free’s limits without a grace, and shows the plans once', async () => {
    const ann = await account();
    await beforePlans(ann);
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', choose: true, grace: null });
  });

  it('gives every account from before plans its plan in upkeep, so a grace runs out even for someone who never comes back', async () => {
    const ann = await account();
    const ours = await workspace(ann, 'Ours');
    expect(await upload(ann, ours, MiB)).toBe('succeeded');
    await setLimit('plan.free.storage_bytes', MiB / 2);
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

const GiB = 1024 * MiB;
const PRICE = 20_000_000;
const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
/** Money in, as a person adds it: a top-up the fake 1Click settles in full. */
async function deposit(who: Account, microUsd: number): Promise<void> {
  const t = await who.api.plans.startTopUp(BASE_USDC, microUsd);
  h.oneclick.set(t.address ?? '', 'SUCCESS', { depositedAmount: String(microUsd), amountOut: String(microUsd), intentHashes: [`intent-${t.id}`] });
  await who.api.plans.topUp(t.id);
}
/** Money in for a test that isn't about adding it: as support adds it (`pnpm billing credit`). */
const give = (who: Account, microUsd: number) => creditByEmail(h.deps, who.email, microUsd);
/** Upkeep at `at`, with the account due. */
async function upkeepAt(who: Account, at: number): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'], now: at });
  await h.pool.query('UPDATE plan_accounts SET due_at = now() WHERE owner_id = $1', [who.session.ownerId]);
  await maintain(h.deps);
}
const labels = async (who: Account) => (await who.api.plans.plan()).balance.history.map((e) => e.label);

describe('Pro', () => {
  it('a new account buys Pro once it has the money, and gets all of Pro’s allowance, whatever it spent on Free', async () => {
    await setLimit('ai.hour_micro_usd', 60_000);
    const ann = await account();
    expect(await ann.api.plans.offers()).toEqual({
      periodDays: 30,
      free: { notesMinutes: 300, storageBytes: 10 * GiB, fileBytes: 512 * MiB },
      pro: { notesMinutes: 3000, storageBytes: 100 * GiB, fileBytes: 512 * MiB, microUsdPerMonth: PRICE, maxMonths: 12 }
    });
    expect(await refusal(ann.api.plans.buyPro(1, PRICE))).toBe('conflict: Your balance is short: 1 month of Pro costs $20 and your balance is $0. Add money first.');
    const rec = await ann.api.recordings.start({ title: 'Used' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    expect((await ann.api.plans.plan()).notes.minutesLeft).toBeLessThan(300);
    await deposit(ann, PRICE);
    const before = Date.now();
    const pro = await ann.api.plans.buyPro(1, PRICE);
    expect(pro).toMatchObject({
      kind: 'pro', grace: null, over: { storage: false },
      notes: { minutesLeft: 3000, minutesPerPeriod: 3000, stopped: false },
      storage: { limitBytes: 100 * GiB, fileBytes: 512 * MiB },
      balance: { microUsd: 0 },
      pro: { renew: false, refundableMicroUsd: 0, until: pro.period.to },
      notices: []
    });
    expect(pro.pro.months).toEqual([{ from: pro.period.from, to: pro.period.to, microUsd: PRICE }]);
    expect(Date.parse(pro.period.from)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(pro.period.to) - Date.parse(pro.period.from)).toBe(30 * 86_400_000);
    expect(pro.balance.history.map((e) => [e.label, e.microUsd])).toEqual([['Pro, 1 month', -PRICE], ['Added, 20 USDC', PRICE]]);
  });

  it('refuses a buy the balance is short for, and changes nothing', async () => {
    const ann = await account();
    await give(ann, 50_000_000);
    const before = await ann.api.plans.plan();
    expect(await refusal(ann.api.plans.buyPro(3, PRICE))).toBe('conflict: Your balance is short: 3 months of Pro cost $60 and your balance is $50. Add money first.');
    expect(await ann.api.plans.plan()).toEqual(before);
    expect(before).toMatchObject({ kind: 'free', balance: { microUsd: 50_000_000 }, pro: { months: [], until: null } });
  });

  it('refuses a buy at a price that has changed since it was shown, charging nothing', async () => {
    const ann = await account();
    await give(ann, 50_000_000);
    const shown = (await ann.api.plans.offers()).pro.microUsdPerMonth;
    await setLimit('plan.pro.price_micro_usd', 25_000_000);
    expect(await refusal(ann.api.plans.buyPro(1, shown))).toBe('conflict: The price of Pro has changed. Look at it again before buying.');
    expect((await ann.api.plans.plan())).toMatchObject({ kind: 'free', balance: { microUsd: 50_000_000 } });
    // Looked at again, it's bought at the new price.
    const now = (await ann.api.plans.offers()).pro.microUsdPerMonth;
    expect(now).toBe(25_000_000);
    expect(await ann.api.plans.buyPro(1, now)).toMatchObject({ kind: 'pro', balance: { microUsd: 25_000_000 }, pro: { months: [{ microUsd: 25_000_000 }] } });
  });

  it('two buys at once on two instances, with money for one: one goes through, the other is refused, and nothing is spent twice', async () => {
    const ann = await account();
    await give(ann, PRICE);
    const second = await h.secondServer({});
    const gate = await h.pool.connect();
    let pending: Promise<string>[] = [];
    try {
      const there = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
      // Both buys wait on the account's row, held here, and go once it's let go.
      await gate.query('BEGIN');
      await gate.query('SELECT 1 FROM plan_accounts WHERE owner_id = $1 FOR UPDATE', [ann.session.ownerId]);
      pending = [ann.api, there].map((api) => refusal(api.plans.buyPro(1, PRICE)));
      await expect.poll(async () => (await h.pool.query<{ n: number }>(`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%plan_accounts%'`)).rows[0]?.n, { timeout: 5000 }).toBe(2);
      await gate.query('COMMIT');
      const outcomes = await Promise.all(pending);
      expect(outcomes.sort()).toEqual(['conflict: Your balance is short: 1 month of Pro costs $20 and your balance is $0. Add money first.', 'succeeded']);
      expect(await ann.api.plans.plan()).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, pro: { months: [{ microUsd: PRICE }] } });
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
      await Promise.all(pending);
      await second.close();
    }
  });

  it('buys 1 to 12 months at a time, and refuses 13', async () => {
    const ann = await account();
    await give(ann, 13 * PRICE);
    expect((await ann.api.plans.buyPro(1, PRICE)).pro.months).toHaveLength(1);
    const twelve = await ann.api.plans.buyPro(12, PRICE);
    expect(twelve.pro.months).toHaveLength(13);
    expect(twelve).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, pro: { refundableMicroUsd: 12 * PRICE } });
    expect(Date.parse(twelve.pro.until ?? '') - Date.parse(twelve.period.from)).toBe(13 * 30 * 86_400_000);
    await give(ann, 13 * PRICE);
    expect(await refusal(ann.api.plans.buyPro(13, PRICE))).toBe('invalid: Buy 1 to 12 months at a time.');
    expect((await ann.api.plans.plan()).balance.microUsd).toBe(13 * PRICE);
  });

  it('runs months back to back, refunds the ones that haven’t started, and never the running one', async () => {
    await setLimit('plan.period_seconds', 3600);
    const ann = await account();
    await give(ann, 3 * PRICE);
    await ann.api.plans.buyPro(1, PRICE);
    const three = await ann.api.plans.buyPro(2, PRICE);
    const [first, second, third] = three.pro.months;
    expect(second?.from).toBe(first?.to);
    expect(third?.from).toBe(second?.to);
    expect(Date.parse(third?.to ?? '') - Date.parse(third?.from ?? '')).toBe(3_600_000);
    expect(three.pro).toMatchObject({ until: third?.to, refundableMicroUsd: 2 * PRICE });
    const refunded = await ann.api.plans.refundPro();
    expect(refunded).toMatchObject({ kind: 'pro', balance: { microUsd: 2 * PRICE }, pro: { months: [first], until: first?.to, refundableMicroUsd: 0 } });
    expect(refunded.balance.history[0]).toMatchObject({ label: 'Pro refunded, 2 months', microUsd: 2 * PRICE });
    expect(await refusal(ann.api.plans.refundPro())).toBe('conflict: There’s no month of Pro to refund that hasn’t started. A month that has started isn’t refunded.');
    // Bought again, they follow the running month, and a fresh account with nothing bought has nothing to refund.
    expect((await ann.api.plans.buyPro(1, PRICE)).pro.months[1]?.from).toBe(first?.to);
    expect(await refusal((await account()).api.plans.refundPro())).toBe('conflict: There’s no month of Pro to refund that hasn’t started. A month that has started isn’t refunded.');
  });

  it('renews from the balance before Pro ends while renewing is on, and ends it when the balance is short', async () => {
    await setLimit('plan.period_seconds', 3600);
    await setLimit('plan.pro_remind_seconds', 600);
    // With money for the next month: bought at the reminder, after the last.
    const ann = await account();
    await give(ann, 2 * PRICE);
    await ann.api.plans.buyPro(1, PRICE);
    const on = await ann.api.plans.setRenew(true);
    expect(on.pro.renew).toBe(true);
    const end = Date.parse(on.pro.until ?? '');
    await upkeepAt(ann, end - 300_000);
    const renewed = await ann.api.plans.plan();
    expect(renewed).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, pro: { until: new Date(end + 3_600_000).toISOString(), renew: true } });
    expect(renewed.pro.months.map((m) => m.from)).toEqual([new Date(end - 3_600_000).toISOString(), new Date(end).toISOString()]);
    expect(renewed.notices).toEqual([{ id: expect.any(String), kind: 'pro-renewed', at: expect.any(String), until: new Date(end + 3_600_000).toISOString() }]);
    expect(renewed.balance.history[0]).toMatchObject({ label: 'Pro, renewed for a month', microUsd: -PRICE });
    // Once: upkeep again changes nothing, and past the old end the new month is a fresh period.
    await upkeepAt(ann, end - 200_000);
    expect((await ann.api.plans.plan()).notices).toHaveLength(1);
    vi.useFakeTimers({ toFake: ['Date'], now: end + 60_000 });
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'pro', period: { from: new Date(end).toISOString() }, notes: { minutesLeft: 3000 } });
    vi.useRealTimers();

    // Without money: told at the reminder, then on Free at the end, its periods from there.
    const bob = await account();
    await give(bob, PRICE);
    await bob.api.plans.buyPro(1, PRICE);
    const bobEnd = Date.parse((await bob.api.plans.setRenew(true)).pro.until ?? '');
    await upkeepAt(bob, bobEnd - 300_000);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'pro', notices: [{ kind: 'pro-ending', until: new Date(bobEnd).toISOString() }] });
    await upkeepAt(bob, bobEnd + 60_000);
    const ended = await bob.api.plans.plan();
    expect(ended).toMatchObject({ kind: 'free', period: { from: new Date(bobEnd).toISOString() }, balance: { microUsd: 0 }, pro: { months: [], until: null, renew: true } });
    expect(ended.notices.map((n) => [n.kind, n.until])).toEqual([['pro-ended', new Date(bobEnd).toISOString()], ['pro-ending', new Date(bobEnd).toISOString()]]);
    vi.useRealTimers();

    // Money added after the reminder: bought at the end instead.
    const cy = await account();
    await give(cy, PRICE);
    await cy.api.plans.buyPro(1, PRICE);
    const cyEnd = Date.parse((await cy.api.plans.setRenew(true)).pro.until ?? '');
    await upkeepAt(cy, cyEnd - 300_000);
    vi.useRealTimers();
    await give(cy, PRICE);
    await upkeepAt(cy, cyEnd + 60_000);
    expect(await cy.api.plans.plan()).toMatchObject({
      kind: 'pro', period: { from: new Date(cyEnd).toISOString() }, balance: { microUsd: 0 },
      notices: [{ kind: 'pro-renewed', until: new Date(cyEnd + 3_600_000).toISOString() }, { kind: 'pro-ending' }]
    });
  });

  it('tells its owner before Pro ends and when it has, until they dismiss it, and nobody else can', async () => {
    await setLimit('plan.period_seconds', 3600);
    await setLimit('plan.pro_remind_seconds', 600);
    const ann = await account();
    const bob = await account();
    await give(ann, PRICE);
    const end = Date.parse((await ann.api.plans.buyPro(1, PRICE)).pro.until ?? '');
    // Not before the reminder.
    await upkeepAt(ann, end - 900_000);
    expect((await ann.api.plans.plan()).notices).toEqual([]);
    await upkeepAt(ann, end - 300_000);
    const [ending] = (await ann.api.plans.plan()).notices;
    expect(ending).toMatchObject({ kind: 'pro-ending', until: new Date(end).toISOString() });
    expect(await refusal(bob.api.plans.dismissNotice(ending?.id ?? ''))).toMatch(/^not-found: /);
    expect(await refusal(ann.api.plans.dismissNotice('no-such-notice'))).toMatch(/^not-found: /);
    expect((await ann.api.plans.dismissNotice(ending?.id ?? '')).notices).toEqual([]);
    await upkeepAt(ann, end + 60_000);
    const ended = await ann.api.plans.plan();
    expect(ended).toMatchObject({ kind: 'free', notices: [{ kind: 'pro-ended', until: new Date(end).toISOString() }] });
    // Once each: upkeep again tells nothing more.
    await upkeepAt(ann, end + 120_000);
    expect((await ann.api.plans.plan()).notices).toHaveLength(1);
  });

  it('holds storage to Pro’s through the grace after Pro ends, then takes no more files until Pro is bought again', async () => {
    await setLimit('plan.period_seconds', 3600);
    await setLimit('plan.grace_seconds', 1800);
    await setLimit('plan.free.storage_bytes', MiB / 2);
    const ann = await account();
    await give(ann, 2 * PRICE);
    const end = Date.parse((await ann.api.plans.buyPro(1, PRICE)).pro.until ?? '');
    const ours = await workspace(ann, 'Ours');
    const kept = await ann.api.workspaces.media.upload(ours.id, ours.doc, fileOf(MiB));
    // Pro ends, over Free's storage: the grace, and files still go in.
    await upkeepAt(ann, end + 60_000);
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', grace: { until: new Date(end + 1_800_000).toISOString(), storage: true }, over: { storage: false } });
    expect(await upload(ann, ours, 1024)).toBe('succeeded');
    // After it: nothing more goes in, and what's there is read and deleted.
    await upkeepAt(ann, end + 1_860_000);
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', grace: null, over: { storage: true } });
    expect(await upload(ann, ours, 1024)).toBe(FULL);
    expect((await ann.fetch(await ann.api.workspaces.media.url(ours.id, ours.doc, kept.id))).status).toBe(200);
    // Bought again, at once: only Pro's limits.
    expect(await ann.api.plans.buyPro(1, PRICE)).toMatchObject({ kind: 'pro', grace: null, over: { storage: false } });
    expect(await upload(ann, ours, 1024)).toBe('succeeded');
    await ann.api.workspaces.media.remove(ours.id, ours.doc, kept.id);
    vi.useRealTimers();

    // Bought during the release's grace (no limit), that grace ends: Pro's storage is the limit from then.
    await h.resetLimits();
    const bob = await account();
    const his = await workspace(bob, 'His');
    expect(await upload(bob, his, MiB)).toBe('succeeded');
    await setLimit('plan.free.storage_bytes', MiB / 2);
    await setLimit('plan.pro.storage_bytes', MiB / 2);
    await beforePlans(bob);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'free', grace: { storage: true } });
    expect(await upload(bob, his, 1024)).toBe('succeeded');
    await give(bob, PRICE);
    expect(await bob.api.plans.buyPro(1, PRICE)).toMatchObject({ kind: 'pro', grace: null, over: { storage: true } });
    expect(await upload(bob, his, 1024)).toBe(FULL);
  });

  it('holds an account on Pro to Pro’s storage and file size, and offers Pro’s files at 512 MiB until downloads resume', async () => {
    const ann = await account();
    await give(ann, PRICE);
    await ann.api.plans.buyPro(1, PRICE);
    // Pro's 2 GiB, or any more, is held at 512 MiB.
    await setLimit('plan.pro.file_bytes', 4 * GiB);
    expect((await ann.api.plans.offers()).pro.fileBytes).toBe(512 * MiB);
    expect((await ann.api.plans.plan()).storage.fileBytes).toBe(512 * MiB);
    await setLimit('plan.pro.file_bytes', MiB);
    await setLimit('plan.pro.storage_bytes', 2 * MiB);
    // Free's are larger, and don't count while on Pro.
    await setLimit('plan.free.storage_bytes', 10 * MiB);
    expect((await ann.api.plans.plan()).storage).toMatchObject({ limitBytes: 2 * MiB, fileBytes: MiB });
    const ours = await workspace(ann, 'Ours');
    expect(await upload(ann, ours, MiB + 1)).toBe('invalid: This file is bigger than 1 MiB, the most a file can be here.');
    expect(await upload(ann, ours, MiB)).toBe('succeeded');
    expect(await upload(ann, ours, MiB)).toBe(FULL);
  });

  it('reads a plan the previous release stored, with no months, renewing or notices, and buys Pro on it', async () => {
    const ann = await account();
    const key = serviceKey(unb64u(h.deps.cfg.KSERVICE, 32), 'accounting');
    const header = { v: 1 as const, kind: 'plan-account', ownerId: ann.session.ownerId, keyVersion: '1' };
    const previous = { balanceMicroUsd: 30_000_000, history: [{ id: 'old', at: new Date().toISOString(), label: 'Added, 30 USDC', microUsd: 30_000_000 }], freeFrom: new Date().toISOString(), choose: true, grace: null };
    await h.pool.query('UPDATE plan_accounts SET state_ciphertext = $2 WHERE owner_id = $1', [ann.session.ownerId, sealJson(key, header, toJson(previous))]);
    expect(await ann.api.plans.plan()).toMatchObject({
      kind: 'free', balance: { microUsd: 30_000_000 }, pro: { months: [], until: null, renew: false, refundableMicroUsd: 0 }, notices: []
    });
    expect(await ann.api.plans.buyPro(1, PRICE)).toMatchObject({ kind: 'pro', balance: { microUsd: 10_000_000 } });
    expect(await labels(ann)).toEqual(['Pro, 1 month', 'Added, 30 USDC']);
  });
});

describe('support', () => {
  it('finds an account by its address, adds dollars as support, and says where its plan stands', async () => {
    const ann = await account();
    await creditByEmail(h.deps, ann.email.toUpperCase(), 4_500_000);
    expect(await labels(ann)).toEqual(['Added by support']);
    const lines = await standingOf(h.deps, ann.session.ownerId);
    expect(lines).toContain('Balance: $4.50');
    expect(lines.join('\n')).not.toContain(ann.email);
    await expect(creditByEmail(h.deps, unique('nobody'), 1)).rejects.toThrow('No account has signed in with that address.');
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
