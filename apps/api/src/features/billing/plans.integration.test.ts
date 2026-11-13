/**
 * Plans (docs: Plans and usage), end to end: the real API over HTTP via @alcove/api-http, real Postgres, the object store,
 * LiveKit and the fakes. Free's limits on storage and files; accounts from before plans, carried onto Free with time to
 * get within its limits; what's over them taking no more once that time is up; a call's
 * longest and its most people; and nothing of a plan outliving its account.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { maintain } from '../../maintenance';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';
import { endOverdue } from '../calls/lifecycle';
import { header as callHeader, key as callKey } from '../calls/state';
import { openOwner } from '../../owners';
import { creditBySupport } from './support';
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
    // The plans stay to be shown until the app says they were, and reading the plan or the session doesn't say so.
    await ann.api.auth.getSession();
    expect((await ann.api.plans.plan()).choose).toBe(true);
    expect(await ann.api.plans.chose()).toMatchObject({ kind: 'free', choose: false, notes: { minutesLeft: 300 } });
    // Saying it again changes nothing, and nobody else's is touched.
    const bob = await account();
    expect((await ann.api.plans.chose()).choose).toBe(false);
    expect((await ann.api.plans.plan()).choose).toBe(false);
    expect((await bob.api.plans.plan()).choose).toBe(true);
  });

  it('renews its notes every period from when it began, and what was left doesn’t carry over', async () => {
    // Periods of an hour here (30 days unless the limit says otherwise), and notes reckoned at a tenth of a cent a minute.
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('ai.hour_micro_usd', 60_000);
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

  it('counts call recordings against the organizer, and stops notes for everyone when they fill it', async () => {
    const org = await account();
    const meeting = await org.api.meetings.create({ title: 'Review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: DEFAULT_NOTES_CHOICES });
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    await host.appendAudio(piece(0, 40 * 1024));
    // Storage that the next piece won't fit in.
    await h.setLimit('plan.free.storage_bytes', 64 * 1024);
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
    await h.setLimit('plan.free.storage_bytes', MiB / 2);
    await h.setLimit('plan.grace_seconds', 3600);
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
    // Bob hears the workspace can't take more; Ann, whose storage it is, that hers is full.
    expect(await upload(bob, ours, 1024)).toBe('plan-limit: This workspace can’t take more files: the storage it counts against is full.');
    expect(await upload(ann, ours, 1024)).toBe(FULL);
    expect(await addDoc(ann, ours.id)).toBe('succeeded');
  });

  it('carries over an account within Free’s limits without a grace, and shows the plans once', async () => {
    const ann = await account();
    await beforePlans(ann);
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', choose: true, grace: null });
    // Once shown, not again: the carried-over plan keeps that.
    await ann.api.plans.chose();
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', choose: false, grace: null });
  });

  it('gives every account from before plans its plan in upkeep, so a grace runs out even for someone who never comes back', async () => {
    const ann = await account();
    const ours = await workspace(ann, 'Ours');
    expect(await upload(ann, ours, MiB)).toBe('succeeded');
    await h.setLimit('plan.free.storage_bytes', MiB / 2);
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
    await h.setLimit('call.max_people', 2);
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect(await refusal(h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Lee' }))).toBe('conflict: This call is full: 2 people are in it, the most a call can have.');
    const told = await settle(host, (s) => s.notices.some((n) => n.text.startsWith('Someone tried to join')));
    expect(told.notices.map((n) => n.text)).toContain('Someone tried to join, but this call is full: 2 people is the most a call can have.');
  });
});

const GiB = 1024 * MiB;
const PRICE = 20_000_000;
/** A month of Pro bought 12 or more at once: 20% off. */
const YEARLY = 16_000_000;
/** A pack of more notes: 10 hours for $15. */
const HOURS = 15_000_000;
const PACK = 600;
const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
/** Money in, as a person adds it: a top-up the fake 1Click settles in full. */
async function deposit(who: Account, microUsd: number): Promise<void> {
  const t = await who.api.plans.startTopUp(BASE_USDC, microUsd);
  h.oneclick.set(t.address ?? '', 'SUCCESS', { depositedAmount: String(microUsd), amountOut: String(microUsd), intentHashes: [`intent-${t.id}`] });
  await who.api.plans.topUp(t.id);
}
/** Money in for a test that isn't about adding it: as support adds it (`pnpm billing credit`). */
const give = (who: Account, microUsd: number) => creditBySupport(h.deps, who.email, microUsd);
/** Upkeep at `at`, with the account due. */
async function upkeepAt(who: Account, at: number): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'], now: at });
  await h.pool.query('UPDATE plan_accounts SET due_at = now() WHERE owner_id = $1', [who.session.ownerId]);
  await maintain(h.deps);
}
const labels = async (who: Account) => (await who.api.plans.plan()).balance.history.map((e) => e.label);
/** When upkeep next looks at an account, as upkeep reads it (null: nothing to do). */
const dueAt = async (who: Account) =>
  z.object({ due_at: z.date().nullable() }).parse((await h.pool.query('SELECT due_at FROM plan_accounts WHERE owner_id = $1', [who.session.ownerId])).rows[0]).due_at?.toISOString() ?? null;
const HOUR = 3_600_000;

describe('Pro', () => {
  it('a new account buys Pro once it has the money, and gets all of Pro’s allowance, whatever it spent on Free', async () => {
    await h.setLimit('ai.hour_micro_usd', 60_000);
    const ann = await account();
    expect(await ann.api.plans.offers()).toEqual({
      periodDays: 30,
      free: { notesMinutes: 300, storageBytes: 10 * GiB, fileBytes: 512 * MiB },
      pro: { notesMinutes: 3000, storageBytes: 100 * GiB, fileBytes: 512 * MiB, microUsdPerMonth: PRICE, maxMonths: 12, yearly: { fromMonths: 12, microUsdPerMonth: YEARLY } },
      hours: { minutes: 600, microUsd: HOURS, maxPacks: 5 },
      team: { notesMinutes: 3000, storageBytes: 100 * GiB, fileBytes: 512 * MiB, microUsdPerLicense: 40_000_000, maxLicenses: 500 }
    });
    expect(await refusal(ann.api.plans.buyPro(1, PRICE))).toBe('conflict: Your balance is short of what 1 month of Pro costs ($20). Add money first.');
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
    expect(await refusal(ann.api.plans.buyPro(3, PRICE))).toBe('conflict: Your balance is short of what 3 months of Pro cost ($60). Add money first.');
    expect(await ann.api.plans.plan()).toEqual(before);
    expect(before).toMatchObject({ kind: 'free', balance: { microUsd: 50_000_000 }, pro: { months: [], until: null } });
  });

  it('refuses a buy at a price that has changed since it was shown, charging nothing', async () => {
    const ann = await account();
    await give(ann, 50_000_000);
    const shown = (await ann.api.plans.offers()).pro.microUsdPerMonth;
    await h.setLimit('plan.pro.price_micro_usd', 25_000_000);
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
      expect(outcomes.sort()).toEqual(['conflict: Your balance is short of what 1 month of Pro costs ($20). Add money first.', 'succeeded']);
      expect(await ann.api.plans.plan()).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, pro: { months: [{ microUsd: PRICE }] } });
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
      await Promise.all(pending);
      await second.close();
    }
  });

  it('refuses no months, fewer than none, part of one, or a price below nothing as invalid, charging nothing', async () => {
    const ann = await account();
    await give(ann, 12 * PRICE);
    const before = await ann.api.plans.plan();
    const asked: [number, number][] = [[0, PRICE], [-1, PRICE], [1.5, PRICE], [1, -1], [-12, YEARLY]];
    for (const [months, price] of asked) expect(await refusal(ann.api.plans.buyPro(months, price)), `${months} at ${price}`).toMatch(/^invalid: /);
    expect(await ann.api.plans.plan()).toEqual(before);
  });

  it('lets the organizer turn a call’s notes on again once Pro is bought after the spent allowance stopped them', async () => {
    // A minute of notes at $0.0036 an hour and no stop short of nothing: the call's first clip, holding what writing its
    // notes will cost, spends it.
    await h.setLimit('plan.free.notes_minutes', 1);
    await h.setLimit('ai.hour_micro_usd', 3600);
    await h.setLimit('ai.stop_micro_usd', 0);
    const org = await account();
    const meeting = await org.api.meetings.create({ title: 'Review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: DEFAULT_NOTES_CHOICES });
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    await host.appendAudio(piece(0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    expect((await settle(host, (s) => s.capture.stopped !== null)).capture).toMatchObject({ mode: 'off', stopped: { reason: 'notes' } });
    expect(await refusal(host.setNotes(true))).toBe('plan-limit: Your notes for this period have run out. They start again when your plan renews.');
    // Pro starts a period of its own, with all of Pro's notes: the stop lifts, and notes come on when the organizer says.
    await give(org, PRICE);
    expect(await org.api.plans.buyPro(1, PRICE)).toMatchObject({ kind: 'pro', notes: { minutesPerPeriod: 3000, stopped: false } });
    // Nothing turns them on by itself.
    await host.refresh();
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'off', stopped: { reason: 'notes' } });
    await host.setNotes(true);
    expect((await settle(host, (s) => s.capture.mode === 'on')).capture).toMatchObject({ mode: 'on', stopped: null });
  });

  it('buys 1 to 12 months at a time, and refuses 13', async () => {
    const ann = await account();
    await give(ann, PRICE + 12 * YEARLY);
    expect((await ann.api.plans.buyPro(1, PRICE)).pro.months).toHaveLength(1);
    const twelve = await ann.api.plans.buyPro(12, YEARLY);
    expect(twelve.pro.months).toHaveLength(13);
    expect(twelve).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, pro: { refundableMicroUsd: 12 * YEARLY } });
    expect(Date.parse(twelve.pro.until ?? '') - Date.parse(twelve.period.from)).toBe(13 * 30 * 86_400_000);
    await give(ann, 13 * PRICE);
    expect(await refusal(ann.api.plans.buyPro(13, PRICE))).toBe('invalid: Buy 1 to 12 months at a time.');
    expect(await refusal(ann.api.plans.buyPro(13, YEARLY))).toBe('invalid: Buy 1 to 12 months at a time.');
    expect((await ann.api.plans.plan()).balance.microUsd).toBe(13 * PRICE);
  });

  it('sells a year or more for less: the yearly price from 12 months, a month’s under it, each refused at the other’s', async () => {
    const ann = await account();
    expect((await ann.api.plans.offers()).pro.yearly).toEqual({ fromMonths: 12, microUsdPerMonth: YEARLY });
    await give(ann, 12 * YEARLY);
    // The price for that many months, and no other: 12 at a month's price, or 11 at the yearly one, has changed.
    const changed = 'conflict: The price of Pro has changed. Look at it again before buying.';
    expect(await refusal(ann.api.plans.buyPro(12, PRICE))).toBe(changed);
    expect(await refusal(ann.api.plans.buyPro(11, YEARLY))).toBe(changed);
    expect((await ann.api.plans.plan())).toMatchObject({ kind: 'free', balance: { microUsd: 12 * YEARLY } });
    const year = await ann.api.plans.buyPro(12, YEARLY);
    expect(year).toMatchObject({ kind: 'pro', balance: { microUsd: 0 } });
    expect(year.pro.months.map((m) => m.microUsd)).toEqual(Array.from({ length: 12 }, () => YEARLY));
    expect(year.balance.history[0]).toMatchObject({ label: 'Pro, 12 months', microUsd: -12 * YEARLY });
    // Under a year, a month's price.
    await give(ann, 2 * PRICE);
    expect(await ann.api.plans.buyPro(2, PRICE)).toMatchObject({ balance: { microUsd: 0 }, pro: { months: { length: 14 } } });
  });

  it('refunds a year bought at its lower price less the difference on the months kept, once fewer than 12 are left, and only then', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    // A year refunded at once: the 11 months that haven't started come back at $16, less the $4 a month's price is above
    // that on the one kept, since a month is all that's left of it. $172, not $176.
    const ann = await account();
    await give(ann, 12 * YEARLY);
    expect((await ann.api.plans.buyPro(12, YEARLY)).pro.refundableMicroUsd).toBe(172_000_000);
    const refunded = await ann.api.plans.refundPro();
    expect(refunded).toMatchObject({ kind: 'pro', balance: { microUsd: 172_000_000 }, pro: { months: [{ microUsd: YEARLY }], refundableMicroUsd: 0 } });
    expect(refunded.balance.history[0]).toMatchObject({ label: 'Pro refunded, 11 months', microUsd: 172_000_000 });

    // Two years back to back, the first's last month running: refunding the second, which none of has been had, gives all
    // of it back, and the first keeps its price.
    const bob = await account();
    await give(bob, 24 * YEARLY);
    const first = await bob.api.plans.buyPro(12, YEARLY);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(first.pro.months[11]?.from ?? '') + 60_000 });
    const second = await bob.api.plans.buyPro(12, YEARLY);
    expect(second.pro).toMatchObject({ months: { length: 13 }, refundableMicroUsd: 12 * YEARLY });
    const back = await bob.api.plans.refundPro();
    expect(back).toMatchObject({ balance: { microUsd: 12 * YEARLY }, pro: { months: [{ microUsd: YEARLY }], refundableMicroUsd: 0 } });
    expect(back.balance.history[0]).toMatchObject({ label: 'Pro refunded, 12 months', microUsd: 12 * YEARLY });
    vi.useRealTimers();

    // Ten months of a year had: the two left come to $32, less than the $40 the ten kept would cost more at a month's price.
    // Nothing would come back, so nothing is refunded.
    const cy = await account();
    await give(cy, 12 * YEARLY);
    const year = await cy.api.plans.buyPro(12, YEARLY);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(year.pro.months[9]?.from ?? '') + 60_000 });
    expect((await cy.api.plans.plan()).pro).toMatchObject({ months: { length: 3 }, refundableMicroUsd: 0 });
    expect(await refusal(cy.api.plans.refundPro())).toBe('conflict: Refunding now would give nothing back: kept for fewer than 12 months, Pro bought at its lower price costs a month’s price for each month you’ve had.');
    expect((await cy.api.plans.plan()).pro.months).toHaveLength(3);
    vi.useRealTimers();

    // Months bought at a month's price refund at what was paid, however few are kept.
    const di = await account();
    await give(di, 3 * PRICE);
    expect((await di.api.plans.buyPro(3, PRICE)).pro.refundableMicroUsd).toBe(2 * PRICE);
    expect(await di.api.plans.refundPro()).toMatchObject({ balance: { microUsd: 2 * PRICE }, pro: { months: [{ microUsd: PRICE }], refundableMicroUsd: 0 } });
  });

  it('offers no yearly price while it’s 0, isn’t below a month’s, or is for more months than one purchase buys: a year is then a month’s price', async () => {
    const ann = await account();
    const yearly = async () => (await ann.api.plans.offers()).pro.yearly;
    await h.setLimit('plan.pro.yearly_from_months', 6);
    expect(await yearly()).toEqual({ fromMonths: 6, microUsdPerMonth: YEARLY });
    await h.setLimit('plan.pro.yearly_price_micro_usd', PRICE);
    expect(await yearly()).toBeNull();
    await h.setLimit('plan.pro.yearly_price_micro_usd', 0);
    expect(await yearly()).toBeNull();
    await give(ann, 12 * PRICE);
    expect(await refusal(ann.api.plans.buyPro(12, 0))).toBe('conflict: The price of Pro has changed. Look at it again before buying.');
    expect(await ann.api.plans.buyPro(12, PRICE)).toMatchObject({ kind: 'pro', balance: { microUsd: 0 } });
    await h.setLimit('plan.pro.yearly_price_micro_usd', YEARLY);
    await h.setLimit('plan.pro.yearly_from_months', 13);
    expect(await yearly()).toBeNull();
  });

  it('runs months back to back, refunds the ones that haven’t started, and never the running one', async () => {
    await h.setLimit('plan.period_seconds', 3600);
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
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.pro.remind_seconds', 600);
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
    expect(renewed.notices).toEqual([{ id: expect.any(String), kind: 'pro-renewed', at: expect.any(String), until: new Date(end + 3_600_000).toISOString(), count: null, workspaceId: null }]);
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

    // Money added after the reminder: bought at the end instead, from when upkeep came.
    const cy = await account();
    await give(cy, PRICE);
    await cy.api.plans.buyPro(1, PRICE);
    const cyEnd = Date.parse((await cy.api.plans.setRenew(true)).pro.until ?? '');
    await upkeepAt(cy, cyEnd - 300_000);
    vi.useRealTimers();
    await give(cy, PRICE);
    await upkeepAt(cy, cyEnd + 60_000);
    expect(await cy.api.plans.plan()).toMatchObject({
      kind: 'pro', period: { from: new Date(cyEnd + 60_000).toISOString() }, balance: { microUsd: 0 },
      notices: [{ kind: 'pro-renewed', until: new Date(cyEnd + 3_660_000).toISOString() }, { kind: 'pro-ending' }]
    });
  });

  it('renews at a price no higher than a month cost when the last was bought, and tells its owner before paying a higher one', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.pro.remind_seconds', 600);
    const logged = (from: number, msg: string) => h.logs.slice(from).flatMap((l) => { const r = z.object({ msg: z.string() }).passthrough().safeParse(JSON.parse(l)); return r.success && r.data.msg === msg ? [r.data] : []; });
    // A year bought at $16 a month renews at a month's price as it was then, $20: what a month cost, not what was paid.
    const cy = await account();
    await give(cy, 12 * YEARLY + PRICE);
    const yearEnd = Date.parse((await cy.api.plans.buyPro(12, YEARLY)).pro.until ?? '');
    await cy.api.plans.setRenew(true);
    await upkeepAt(cy, yearEnd - 300_000);
    expect(await cy.api.plans.plan()).toMatchObject({ balance: { microUsd: 0 }, pro: { until: new Date(yearEnd + 3_600_000).toISOString() }, notices: [{ kind: 'pro-renewed' }] });
    vi.useRealTimers();

    // Lower than the $20 a month cost: renewed at $15. Then $15 again, no higher than the month renewed: renewed again.
    const LOWER = 15_000_000;
    const ann = await account();
    await give(ann, PRICE + 2 * LOWER);
    await ann.api.plans.buyPro(1, PRICE);
    const end = Date.parse((await ann.api.plans.setRenew(true)).pro.until ?? '');
    await h.setLimit('plan.pro.price_micro_usd', LOWER);
    await upkeepAt(ann, end - 300_000);
    await upkeepAt(ann, end + 3_300_000);
    const twice = await ann.api.plans.plan();
    expect(twice).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, pro: { until: new Date(end + 7_200_000).toISOString() } });
    expect(twice.pro.months.map((m) => m.microUsd)).toEqual([LOWER, LOWER]);
    vi.useRealTimers();

    // Higher than the $20 a month cost when it was bought: not paid from the balance, though it has the money; its owner is
    // told Pro is ending, and it ends.
    const DEARER = 25_000_000;
    const bob = await account();
    await h.setLimit('plan.pro.price_micro_usd', PRICE);
    await give(bob, 3 * PRICE);
    await bob.api.plans.buyPro(1, PRICE);
    const bobEnd = Date.parse((await bob.api.plans.setRenew(true)).pro.until ?? '');
    await h.setLimit('plan.pro.price_micro_usd', DEARER);
    const from = h.logs.length;
    await upkeepAt(bob, bobEnd - 300_000);
    expect(await bob.api.plans.plan()).toMatchObject({
      kind: 'pro', balance: { microUsd: 2 * PRICE }, pro: { until: new Date(bobEnd).toISOString(), renew: true }, notices: [{ kind: 'pro-ending', until: new Date(bobEnd).toISOString() }]
    });
    expect(logged(from, 'pro ending')).toEqual([expect.objectContaining({ ownerId: bob.session.ownerId, why: 'price' })]);
    await upkeepAt(bob, bobEnd + 60_000);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'free', balance: { microUsd: 2 * PRICE }, notices: [{ kind: 'pro-ended' }, { kind: 'pro-ending' }] });
    expect(logged(from, 'pro ended')).toEqual([expect.objectContaining({ why: 'price' })]);
    // Bought by its owner at the new price, that's what renewing goes by: $15 left, and $10 more for a month at $25.
    const again = await bob.api.plans.buyPro(1, DEARER);
    await give(bob, 10_000_000);
    await upkeepAt(bob, Date.parse(again.pro.until ?? '') - 300_000);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, notices: [{ kind: 'pro-renewed' }, { kind: 'pro-ended' }, { kind: 'pro-ending' }] });
  });

  it('says with the plan whether renewing will buy the next month, and why not: off, a higher price, or a short balance', async () => {
    const ann = await account();
    expect((await ann.api.plans.plan()).pro.renewal).toBeNull();
    await give(ann, 2 * PRICE);
    expect((await ann.api.plans.buyPro(1, PRICE)).pro.renewal).toBe('off');
    expect((await ann.api.plans.setRenew(true)).pro.renewal).toBe('buys');
    // A month costs more now than the $20 the last did: renewing won't pay it, though the balance has it.
    await h.setLimit('plan.pro.price_micro_usd', 25_000_000);
    expect((await ann.api.plans.plan()).pro).toMatchObject({ renew: true, renewal: 'price' });
    await h.setLimit('plan.pro.price_micro_usd', PRICE);
    expect((await ann.api.plans.plan()).pro.renewal).toBe('buys');
    // A month more bought from the balance leaves it short of the next.
    expect((await ann.api.plans.buyPro(1, PRICE)).pro.renewal).toBe('short');
    // Refunded, renewing is off.
    expect((await ann.api.plans.refundPro()).pro).toMatchObject({ renew: false, renewal: 'off' });
  });

  it('renews at the end from when upkeep comes, so a late pass buys one month that has yet to run, never months already over', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.pro.remind_seconds', 600);
    const ann = await account();
    await give(ann, PRICE);
    await ann.api.plans.buyPro(1, PRICE);
    const end = Date.parse((await ann.api.plans.setRenew(true)).pro.until ?? '');
    await upkeepAt(ann, end - 300_000);
    vi.useRealTimers();
    // Money for two more months, and upkeep comes two and a half months late.
    await give(ann, 2 * PRICE);
    const late = end + 9_000_000;
    await upkeepAt(ann, late);
    const renewed = await ann.api.plans.plan();
    expect(renewed).toMatchObject({
      kind: 'pro', period: { from: new Date(late).toISOString(), to: new Date(late + 3_600_000).toISOString() }, balance: { microUsd: PRICE },
      pro: { months: [{ from: new Date(late).toISOString(), to: new Date(late + 3_600_000).toISOString(), microUsd: PRICE }] },
      notices: [{ kind: 'pro-renewed', until: new Date(late + 3_600_000).toISOString() }, { kind: 'pro-ending' }]
    });
    expect(await labels(ann)).toEqual(['Pro, renewed for a month', 'Added by support', 'Pro, 1 month', 'Added by support']);
  });

  it('turns renewing off with a refund, so upkeep never buys back what was refunded, and takes back the notice it renewed', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.pro.remind_seconds', 600);
    // Renewed at the reminder, then refunded before that month starts: Pro ends at the old end, and nothing is bought there.
    const ann = await account();
    await give(ann, 2 * PRICE);
    await ann.api.plans.buyPro(1, PRICE);
    const end = Date.parse((await ann.api.plans.setRenew(true)).pro.until ?? '');
    await upkeepAt(ann, end - 300_000);
    expect(await ann.api.plans.plan()).toMatchObject({ balance: { microUsd: 0 }, pro: { until: new Date(end + 3_600_000).toISOString() }, notices: [{ kind: 'pro-renewed' }] });
    expect(await ann.api.plans.refundPro()).toMatchObject({
      kind: 'pro', balance: { microUsd: PRICE }, pro: { until: new Date(end).toISOString(), renew: false, refundableMicroUsd: 0 }, notices: []
    });
    await upkeepAt(ann, end + 60_000);
    expect(await ann.api.plans.plan()).toMatchObject({
      kind: 'free', balance: { microUsd: PRICE }, pro: { months: [], renew: false }, notices: [{ kind: 'pro-ended', until: new Date(end).toISOString() }]
    });
    expect(await labels(ann)).toEqual(['Pro refunded, 1 month', 'Pro, renewed for a month', 'Pro, 1 month', 'Added by support']);
    vi.useRealTimers();

    // A month bought by hand inside the reminder's window, before upkeep came, then refunded: not bought straight back.
    const bob = await account();
    await give(bob, 3 * PRICE);
    await bob.api.plans.buyPro(1, PRICE);
    const bobEnd = Date.parse((await bob.api.plans.setRenew(true)).pro.until ?? '');
    vi.useFakeTimers({ toFake: ['Date'], now: bobEnd - 300_000 });
    await bob.api.plans.buyPro(1, PRICE);
    expect(await bob.api.plans.refundPro()).toMatchObject({ balance: { microUsd: 2 * PRICE }, pro: { until: new Date(bobEnd).toISOString(), renew: false } });
    await upkeepAt(bob, bobEnd - 240_000);
    expect(await bob.api.plans.plan()).toMatchObject({
      kind: 'pro', balance: { microUsd: 2 * PRICE }, pro: { until: new Date(bobEnd).toISOString() }, notices: [{ kind: 'pro-ending', until: new Date(bobEnd).toISOString() }]
    });
  });

  it('tells its owner before Pro ends and when it has, until they dismiss it, and nobody else can', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.pro.remind_seconds', 600);
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
    // Within Free's storage, the grace after Pro has nothing to hold: none is shown, and nothing is over.
    expect(ended).toMatchObject({ kind: 'free', grace: null, over: { storage: false }, notices: [{ kind: 'pro-ended', until: new Date(end).toISOString() }] });
    // Once each: upkeep again tells nothing more.
    await upkeepAt(ann, end + 120_000);
    expect((await ann.api.plans.plan()).notices).toHaveLength(1);
  });

  it('is due in upkeep at the reminder, at the next one once renewed, at Pro’s end once reminded, and not at all once it has ended', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.pro.remind_seconds', 600);
    const ann = await account();
    expect(await dueAt(ann)).toBeNull();
    await give(ann, 2 * PRICE);
    const end = Date.parse((await ann.api.plans.buyPro(1, PRICE)).pro.until ?? '');
    expect(await dueAt(ann)).toBe(new Date(end - 600_000).toISOString());
    await ann.api.plans.setRenew(true);
    expect(await dueAt(ann)).toBe(new Date(end - 600_000).toISOString());
    // Renewed at the reminder: the next month's reminder.
    await upkeepAt(ann, end - 300_000);
    expect(await dueAt(ann)).toBe(new Date(end + HOUR - 600_000).toISOString());
    // Reminded with the balance short: its end.
    await upkeepAt(ann, end + HOUR - 300_000);
    expect((await ann.api.plans.plan()).notices[0]).toMatchObject({ kind: 'pro-ending' });
    expect(await dueAt(ann)).toBe(new Date(end + HOUR).toISOString());
    // Ended: nothing more to do.
    await upkeepAt(ann, end + HOUR + 60_000);
    expect((await ann.api.plans.plan()).kind).toBe('free');
    expect(await dueAt(ann)).toBeNull();
  });

  it('renews month after month while the balance lasts, tells and ends at the last, and reminds again once Pro is bought again', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.pro.remind_seconds', 600);
    const ann = await account();
    await give(ann, 3 * PRICE);
    await ann.api.plans.buyPro(1, PRICE);
    const first = Date.parse((await ann.api.plans.setRenew(true)).pro.until ?? '');
    // Each reminder buys the next month, while there's money for it.
    await upkeepAt(ann, first - 300_000);
    await upkeepAt(ann, first + HOUR - 300_000);
    const third = first + 2 * HOUR;
    const twice = await ann.api.plans.plan();
    expect(twice).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, pro: { until: new Date(third).toISOString() } });
    expect(twice.notices.map((n) => [n.kind, n.until])).toEqual([['pro-renewed', new Date(third).toISOString()], ['pro-renewed', new Date(first + HOUR).toISOString()]]);
    // The third end, with the balance short: told before it, and on Free at it.
    await upkeepAt(ann, third - 300_000);
    await upkeepAt(ann, third + 60_000);
    const ended = await ann.api.plans.plan();
    expect(ended).toMatchObject({ kind: 'free', period: { from: new Date(third).toISOString() }, pro: { months: [], until: null, renew: true } });
    expect(ended.notices.map((n) => n.kind)).toEqual(['pro-ended', 'pro-ending', 'pro-renewed', 'pro-renewed']);
    // Bought again once it ended: its own end is told too.
    await give(ann, PRICE);
    const again = Date.parse((await ann.api.plans.buyPro(1, PRICE)).pro.until ?? '');
    await upkeepAt(ann, again - 300_000);
    expect((await ann.api.plans.plan()).notices[0]).toMatchObject({ kind: 'pro-ending', until: new Date(again).toISOString() });
  });

  it('renews only once in an upkeep pass when the reminder is longer than a month, its reminder never coming before it starts', async () => {
    // Told 4 hours before the end of 1-hour months: each month's reminder comes as it starts.
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.pro.remind_seconds', 4 * 3600);
    const ann = await account();
    await give(ann, 5 * PRICE);
    const end = Date.parse((await ann.api.plans.buyPro(1, PRICE)).pro.until ?? '');
    await ann.api.plans.setRenew(true);
    // Due at once, with money for four months: one pass buys the next month, and no more.
    await maintain(h.deps);
    const renewed = await ann.api.plans.plan();
    expect(renewed).toMatchObject({ balance: { microUsd: 3 * PRICE }, pro: { until: new Date(end + HOUR).toISOString() } });
    expect(renewed.notices.map((n) => n.kind)).toEqual(['pro-renewed']);
    // The month bought is reminded about as it starts, at this one's end.
    expect(await dueAt(ann)).toBe(new Date(end).toISOString());
  });

  it('holds storage to Pro’s through the grace after Pro ends, then takes no more files until Pro is bought again', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.grace_seconds', 1800);
    await h.setLimit('plan.free.storage_bytes', MiB / 2);
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
    await h.setLimit('plan.free.storage_bytes', MiB / 2);
    await h.setLimit('plan.pro.storage_bytes', MiB / 2);
    await beforePlans(bob);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'free', grace: { storage: true } });
    expect(await upload(bob, his, 1024)).toBe('succeeded');
    await give(bob, PRICE);
    expect(await bob.api.plans.buyPro(1, PRICE)).toMatchObject({ kind: 'pro', grace: null, over: { storage: true } });
    expect(await upload(bob, his, 1024)).toBe(FULL);
  });

  it('holds an account on Pro to Pro’s storage and file size, and every plan’s files to 512 MiB until downloads resume', async () => {
    const ann = await account();
    await give(ann, PRICE);
    expect((await ann.api.plans.buyPro(1, PRICE)).storage.fileBytes).toBe(512 * MiB);
    // 512 MiB is each plan's file limit, and its ceiling: set any higher, it's held there.
    for (const kind of ['free', 'pro', 'team'] as const) await h.setLimit(`plan.${kind}.file_bytes`, 4 * GiB);
    const offers = await ann.api.plans.offers();
    expect([offers.free.fileBytes, offers.pro.fileBytes, offers.team.fileBytes]).toEqual([512 * MiB, 512 * MiB, 512 * MiB]);
    expect((await ann.api.plans.plan()).storage.fileBytes).toBe(512 * MiB);
    // Lower, Pro's limit is what's enforced.
    await h.setLimit('plan.pro.file_bytes', MiB);
    await h.setLimit('plan.pro.storage_bytes', 2 * MiB);
    // Free's are larger, and don't count while on Pro.
    await h.setLimit('plan.free.storage_bytes', 10 * MiB);
    expect((await ann.api.plans.plan()).storage).toMatchObject({ limitBytes: 2 * MiB, fileBytes: MiB });
    const ours = await workspace(ann, 'Ours');
    expect(await upload(ann, ours, MiB + 1)).toBe('invalid: This file is bigger than 1 MiB, the most a file can be here.');
    expect(await upload(ann, ours, MiB)).toBe('succeeded');
    expect(await upload(ann, ours, MiB)).toBe(FULL);
  });

  it('reads a plan the previous release stored, with no months, renewing, notices or more notes, and buys Pro and more notes on it', async () => {
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
    await give(ann, HOURS);
    expect(await ann.api.plans.buyHours(1, HOURS, PACK)).toMatchObject({ kind: 'pro', notes: { minutesPerPeriod: 3600 }, balance: { microUsd: 10_000_000 } });
    expect(await labels(ann)).toEqual(['10 more hours of notes', 'Added by support', 'Pro, 1 month', 'Added, 30 USDC']);
  });
});

describe('more notes', () => {
  it('adds notes to this period on any plan, from the balance, and they don’t carry into the next', async () => {
    await h.setLimit('plan.period_seconds', 3600);
    const ann = await account();
    await give(ann, 3 * HOURS);
    const more = await ann.api.plans.buyHours(2, HOURS, PACK);
    expect(more).toMatchObject({ kind: 'free', notes: { minutesLeft: 1500, minutesPerPeriod: 1500, stopped: false }, balance: { microUsd: HOURS } });
    expect(more.balance.history[0]).toMatchObject({ label: '20 more hours of notes', microUsd: -2 * HOURS });
    // More again this period: on top of what was bought.
    expect((await ann.api.plans.buyHours(1, HOURS, PACK)).notes).toEqual({ minutesLeft: 2100, minutesPerPeriod: 2100, stopped: false });
    // The next period has the plan's notes alone.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(more.period.to) + 60_000 });
    expect(await ann.api.plans.plan()).toMatchObject({ period: { from: more.period.to }, notes: { minutesLeft: 300, minutesPerPeriod: 300 } });
    vi.useRealTimers();

    // On Pro too. Buying Pro starts a period of its own, which more bought on Free don't reach.
    const bob = await account();
    await give(bob, HOURS + PRICE + HOURS);
    expect((await bob.api.plans.buyHours(1, HOURS, PACK)).notes).toMatchObject({ minutesLeft: 900, minutesPerPeriod: 900 });
    expect((await bob.api.plans.buyPro(1, PRICE)).notes).toMatchObject({ minutesLeft: 3000, minutesPerPeriod: 3000 });
    expect(await bob.api.plans.buyHours(1, HOURS, PACK)).toMatchObject({ kind: 'pro', notes: { minutesLeft: 3600, minutesPerPeriod: 3600 }, balance: { microUsd: 0 } });
    expect(await labels(bob)).toEqual(['10 more hours of notes', 'Pro, 1 month', '10 more hours of notes', 'Added by support']);
  });

  it('refuses no packs, fewer than none, part of one, a price below nothing or a pack of no minutes as invalid, charging nothing', async () => {
    const ann = await account();
    await give(ann, 5 * HOURS);
    const before = await ann.api.plans.plan();
    const asked: [number, number, number][] = [[0, HOURS, PACK], [-1, HOURS, PACK], [1.5, HOURS, PACK], [1, -1, PACK], [1, HOURS, 0], [1, HOURS, -PACK], [1, HOURS, 1.5]];
    for (const [packs, price, minutes] of asked) expect(await refusal(ann.api.plans.buyHours(packs, price, minutes)), `${packs} of ${minutes} at ${price}`).toMatch(/^invalid: /);
    expect(await ann.api.plans.plan()).toEqual(before);
  });

  it('refuses more than one purchase buys, a price that has changed, a short balance, and buying while none are offered, charging nothing', async () => {
    const ann = await account();
    await give(ann, 20_000_000);
    expect(await refusal(ann.api.plans.buyHours(6, HOURS, PACK))).toBe('invalid: Buy up to 50 hours of notes at a time.');
    expect(await refusal(ann.api.plans.buyHours(1, 10_000_000, PACK))).toBe('conflict: The price of more notes has changed. Look at it again before buying.');
    expect(await refusal(ann.api.plans.buyHours(2, HOURS, PACK))).toBe('conflict: Your balance is short of what 20 hours of notes cost ($30). Add money first.');
    await h.setLimit('plan.hours.pack_minutes', 60);
    await h.setLimit('plan.hours.price_micro_usd', 25_000_000);
    expect(await refusal(ann.api.plans.buyHours(1, 25_000_000, 60))).toBe('conflict: Your balance is short of what 1 hour of notes costs ($25). Add money first.');
    // A pack at no price: none are offered, and none can be had for nothing.
    await h.setLimit('plan.hours.price_micro_usd', 0);
    expect((await ann.api.plans.offers()).hours).toBeNull();
    expect(await refusal(ann.api.plans.buyHours(1, 0, PACK))).toBe('conflict: More notes can’t be bought right now.');
    expect(await ann.api.plans.plan()).toMatchObject({ notes: { minutesPerPeriod: 300 }, balance: { microUsd: 20_000_000, history: [{ label: 'Added by support' }] } });
  });

  it('refuses a pack whose hours changed since it was shown, at the same price, as a changed price, charging nothing', async () => {
    const ann = await account();
    await give(ann, HOURS);
    const shown = (await ann.api.plans.offers()).hours;
    expect(shown).toEqual({ minutes: PACK, microUsd: HOURS, maxPacks: 5 });
    // An hour a pack now, at the same $15: what was shown is a dearer pack.
    await h.setLimit('plan.hours.pack_minutes', 60);
    expect(await refusal(ann.api.plans.buyHours(1, HOURS, PACK))).toBe('conflict: The hours more notes bring have changed. Look at them again before buying.');
    expect(await ann.api.plans.plan()).toMatchObject({ notes: { minutesPerPeriod: 300 }, balance: { microUsd: HOURS, history: [{ label: 'Added by support' }] } });
    // Looked at again, it's bought as it is now.
    expect((await ann.api.plans.offers()).hours).toEqual({ minutes: 60, microUsd: HOURS, maxPacks: 5 });
    expect(await ann.api.plans.buyHours(1, HOURS, 60)).toMatchObject({ notes: { minutesPerPeriod: 360 }, balance: { microUsd: 0 } });
    expect(await labels(ann)).toEqual(['1 more hour of notes', 'Added by support']);
  });

  it('a buy of Pro and one of more notes at once, with money for one: they wait on the same lock, and one is refused', async () => {
    const ann = await account();
    await give(ann, PRICE);
    const gate = await h.pool.connect();
    let pending: Promise<string>[] = [];
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT 1 FROM plan_accounts WHERE owner_id = $1 FOR UPDATE', [ann.session.ownerId]);
      pending = [refusal(ann.api.plans.buyPro(1, PRICE)), refusal(ann.api.plans.buyHours(1, HOURS, PACK))];
      await expect.poll(async () => (await h.pool.query<{ n: number }>(`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%plan_accounts%'`)).rows[0]?.n, { timeout: 5000 }).toBe(2);
      await gate.query('COMMIT');
      const [pro, hours] = await Promise.all(pending);
      const plan = await ann.api.plans.plan();
      if (pro === 'succeeded') {
        expect(hours).toBe('conflict: Your balance is short of what 10 hours of notes cost ($15). Add money first.');
        expect(plan).toMatchObject({ kind: 'pro', balance: { microUsd: 0 }, notes: { minutesPerPeriod: 3000 } });
      } else {
        expect([pro, hours]).toEqual(['conflict: Your balance is short of what 1 month of Pro costs ($20). Add money first.', 'succeeded']);
        expect(plan).toMatchObject({ kind: 'free', balance: { microUsd: 5_000_000 }, notes: { minutesPerPeriod: 900 } });
      }
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
      await Promise.all(pending);
    }
  });

  it('lifts a stop the spent allowance caused, so the organizer can turn notes on again, and not one full storage caused', async () => {
    // A minute of notes at $0.0036 an hour and no stop short of nothing: the call's first clip, holding what writing its
    // notes will cost, spends it.
    await h.setLimit('plan.free.notes_minutes', 1);
    await h.setLimit('ai.hour_micro_usd', 3600);
    await h.setLimit('ai.stop_micro_usd', 0);
    const org = await account();
    const meeting = await org.api.meetings.create({ title: 'Review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: DEFAULT_NOTES_CHOICES });
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    await host.appendAudio(piece(0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    expect((await settle(host, (s) => s.capture.stopped !== null)).capture).toMatchObject({ mode: 'off', stopped: { reason: 'notes' } });
    expect((await org.api.plans.plan()).notes).toEqual({ minutesLeft: 0, minutesPerPeriod: 1, stopped: true });
    const ranOut = 'plan-limit: Your notes for this period have run out. They start again when your plan renews.';
    expect(await refusal(host.setNotes(true))).toBe(ranOut);
    await give(org, HOURS);
    const more = await org.api.plans.buyHours(1, HOURS, PACK);
    expect(more.notes).toMatchObject({ minutesPerPeriod: 601, stopped: false });
    // What the call spent before comes off what was bought.
    expect(more.notes.minutesLeft).toBeGreaterThan(590);
    expect(more.notes.minutesLeft).toBeLessThanOrEqual(601);
    await host.setNotes(true);
    expect((await settle(host, (s) => s.capture.mode === 'on')).capture).toMatchObject({ mode: 'on', stopped: null });

    // Notes stopped because the organizer's storage is full: more notes don't bring them back.
    const sam = await account();
    const theirs = await sam.api.meetings.create({ title: 'Full', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: DEFAULT_NOTES_CHOICES });
    const hers = await sam.api.calls.join(theirs.code, { mic: true, cam: false });
    await hers.appendAudio(piece(0, 40 * 1024));
    await h.setLimit('plan.free.storage_bytes', 64 * 1024);
    expect(code(await hers.appendAudio(piece(1, 40 * 1024)).catch((e: unknown) => e))).toBe('plan-limit');
    expect((await settle(hers, (s) => s.capture.stopped !== null)).capture).toMatchObject({ mode: 'off', stopped: { reason: 'storage' } });
    await give(sam, HOURS);
    expect((await sam.api.plans.buyHours(1, HOURS, PACK)).notes).toMatchObject({ minutesPerPeriod: 601, stopped: false });
    expect(await refusal(hers.setNotes(true))).toBe('plan-limit: Your storage is full, so notes can’t be kept. Delete something, or move to a plan with more room.');
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
