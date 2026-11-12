/**
 * The AI allowance (docs: Plans and usage › Notes), end to end: the real API over HTTP via @alcove/api-http, real Postgres,
 * the object store, LiveKit and the fake NEAR AI, whose catalog prices each model as NEAR AI's does. Who pays for each
 * request, what it's charged, how a call's notes stop when the organizer's allowance is spent, the one note written past
 * it, and holds keeping requests at once from spending the same money twice.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type AlcoveApi, type AnswerPart, type AudioPiece, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HALF_PRICED_MODEL, UNENCRYPTED_MODEL, speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';
import { standing } from './meter';
import { creditByEmail } from './support';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(async () => { h.closeCalls(); vi.useRealTimers(); await h.resetLimits(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
/** The API's log lines since `from`, read. */
const linesSince = (from: number) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
const refusal = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
const meter = (who: Account) => standing(h.deps, h.pool, who.session.ownerId);
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (marker: string, at: number, durationMs = 5000): AudioPiece => ({ data: new Blob([audioBytes(marker)]), segment: 0, seq: at, at: at * 5, durationMs, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, atMs: number, ms = 6000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: ms });
async function written(api: AlcoveApi, noteId: string): Promise<void> { for await (const p of api.notes.progress(noteId)) if (p.ready) return; }
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 200 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 25)); }
  return call.getSnapshot();
}
/** The call as it is now. */
async function now(call: CallSession): Promise<CallState> { await call.refresh(); return call.getSnapshot(); }
async function answer(parts: AsyncIterable<AnswerPart>): Promise<AnswerPart[]> {
  const out: AnswerPart[] = [];
  for await (const p of parts) out.push(p);
  return out;
}
/** A call with notes on from the start, its organizer hosting, and `guests` invited. */
async function call(org: Account, guests: string[] = []) {
  const meeting = await org.api.meetings.create({
    title: 'Supplier review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests, notes: 'on', choices: DEFAULT_NOTES_CHOICES
  });
  return { meeting, host: await org.api.calls.join(meeting.code, { mic: true, cam: false }) };
}
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await settle(who, (s) => s.participants.some((p) => p.isMe));
}

describe('who pays', () => {
  it('charges the organizer for what the call does, and each signed-in person for their own questions', async () => {
    const org = await account(unique('organizer'));
    const kofi = await account(unique('kofi'));
    const { host, meeting } = await call(org, [kofi.email]);
    const theirs = await kofi.api.calls.join(meeting.code, { mic: true, cam: false });
    await settle(theirs, (s) => s.participants.some((p) => p.isMe));
    await host.appendAudio(piece('paid', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    const line = (await settle(theirs, (s) => s.transcript.length > 0)).transcript[0]?.id ?? '';
    // Captions are the call's, whoever reads them: the organizer pays.
    await theirs.translate([line], 'de');
    // A question, and a catch-up, are Kofi's own: his plan pays.
    await theirs.askSoFar('When do we ship?', { kind: 'all' });
    await theirs.catchUp({ kind: 'since-joined' });
    const o = await meter(org);
    const k = await meter(kofi);
    expect(o.byKind['transcript']).toBeGreaterThan(0);
    expect(o.byKind['captions']).toBeGreaterThan(0);
    expect(o.byKind['ask'] ?? 0).toBe(0);
    expect(k.byKind['ask']).toBeGreaterThan(0);
    expect(k.byKind['catch-up']).toBeGreaterThan(0);
    expect(k.byKind['transcript'] ?? 0).toBe(0);
    // The notes, when the call ends, are the organizer's too.
    const ended = await host.leave();
    await written(org.api, ended?.pendingNoteId ?? '');
    expect((await meter(org)).byKind['notes']).toBeGreaterThan(0);
    expect((await meter(kofi)).byKind['notes'] ?? 0).toBe(0);
  });

  it('charges the organizer for a guest’s question, and asks after notes from the asker', async () => {
    const org = await account(unique('organizer'));
    const { host, meeting } = await call(org);
    const guest = await h.browser().api.calls.join(meeting.code, { mic: true, cam: false, name: 'Sam Guest' });
    await letIn(host, guest);
    await host.appendAudio(piece('guest', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    await settle(guest, (s) => s.transcript.length > 0);
    const before = (await meter(org)).byKind['ask'] ?? 0;
    await guest.askSoFar('When do we ship?', { kind: 'all' });
    expect((await meter(org)).byKind['ask']).toBeGreaterThan(before);
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    await written(org.api, noteId);
    // Asking a note, or every note, after the call: whoever asks.
    const sam = await account(unique('sam'));
    await org.api.notes.share(noteId, { emails: [sam.email] });
    await answer(sam.api.notes.ask(noteId, 'When do we ship?'));
    await answer(sam.api.notes.askAll('When do we ship?'));
    expect((await meter(sam)).byKind['ask']).toBeGreaterThan(0);
  });

  it('charges what NEAR AI says a request used, at its model’s listed price, and reckons it when NEAR AI doesn’t say', async () => {
    const ann = await account();
    const sent = h.near.prompts.length;
    await answer(ann.api.notes.askAll('Anything?'));
    // No notes yet: nothing went to the model, and nothing was charged.
    expect(h.near.prompts.length).toBe(sent);
    expect((await meter(ann)).spentNano).toBe(0);
    const rec = await ann.api.recordings.start({ title: 'Priced' });
    await rec.appendAudio(piece('priced', 0));
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    const after = await meter(ann);
    // The fake answers each chat with its prompt's length a quarter and 200 tokens out, at DeepSeek's $0.30 and $1.20 a
    // million: 200 out alone is 240,000 nano-USD. So each request costs at least that, and the notes took at least one.
    expect(after.byKind['notes']).toBeGreaterThanOrEqual(240_000);
    // Whisper is $0.01 a million each way, reckoned from the clip's length: a 6-second clip is one 30-second window.
    expect(after.byKind['transcript']).toBeGreaterThan(0);
    expect(after.byKind['transcript']).toBeLessThan(50_000);
    // A reply that doesn't say what it used is reckoned, and still charged.
    h.near.withoutUsageNext(1);
    const was = (await meter(ann)).byKind['ask'] ?? 0;
    await answer(ann.api.notes.askAll('When do we ship?'));
    expect((await meter(ann)).byKind['ask']).toBeGreaterThan(was);
  });

  it('charges at the price of the model that answered: a dearer one spends more for the same question', async () => {
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Priced' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    const asked = async () => {
      const before = (await meter(ann)).byKind['ask'] ?? 0;
      await answer(ann.api.notes.askAll('When do we ship?'));
      return ((await meter(ann)).byKind['ask'] ?? 0) - before;
    };
    const cheap = await asked();
    // Asked across notes with their own choice of model: one at $0.50 and $2 a million, against $0.30 and $1.20.
    await ann.api.account.updatePreferences({ model: UNENCRYPTED_MODEL });
    const dear = await asked();
    expect(dear).toBeGreaterThan(cheap);
  });

  it('charges a request still on its way after five minutes what it held, and once it’s answered what it used, never both', async () => {
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Late' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    const asked = async () => {
      const before = (await meter(ann)).byKind['ask'] ?? 0;
      await answer(ann.api.notes.askAll('When do we ship?'));
      return ((await meter(ann)).byKind['ask'] ?? 0) - before;
    };
    // What the question costs answered at once.
    const once = await asked();
    const before = (await meter(ann)).spentNano;
    // Asked again, it's answered only six minutes later, and the same question goes meanwhile.
    let overdue = 0;
    let meanwhile = 0;
    h.near.holdNext(async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * 60_000 });
      // What it held is charged in full once it's overdue: shown so before the meter is next touched, as it will be then.
      overdue = (await meter(ann)).spentNano - before;
      meanwhile = await asked();
    });
    await answer(ann.api.notes.askAll('When do we ship?'));
    expect(overdue).toBeGreaterThan(once);
    expect(meanwhile).toBe(once);
    // Answered after all, it's charged what it used instead of what it held: the two questions cost what one did twice.
    const after = await meter(ann);
    expect(after.spentNano - before).toBe(2 * once);
    expect(after.leftNano).toBe(after.unspentNano);
  });

  it('charges a model the catalog prices only one way at the fallback, and says which once each time the catalog is read', async () => {
    const ann = await account();
    // Offered: it reads text and images, under the price cap, and the catalog gives its input price alone.
    expect((await ann.api.models.list()).models.map((m) => m.id)).toContain(HALF_PRICED_MODEL);
    const warned = () => h.logs.filter((l) => l.includes('models not priced; charged at the fallback') && l.includes(HALF_PRICED_MODEL)).length;
    const said = warned();
    expect(said).toBeGreaterThan(0);
    const rec = await ann.api.recordings.start({ title: 'Fallback' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    await ann.api.account.updatePreferences({ model: HALF_PRICED_MODEL });
    const asked = async () => {
      const before = (await meter(ann)).byKind['ask'] ?? 0;
      await answer(ann.api.notes.askAll('When do we ship?'));
      // What the fake says each answer used: its prompt's length a quarter, and 200 out.
      return { cost: ((await meter(ann)).byKind['ask'] ?? 0) - before, tokens: Math.round((h.near.prompts.at(-1) ?? '').length / 4) };
    };
    // At the fallback's $1 and $4 a million.
    const one = await asked();
    expect(one.cost).toBe(Math.ceil((one.tokens * 1_000_000 + 200 * 4_000_000) / 1000));
    // The fallback is a limit: raised, the next is charged at it.
    await h.setLimit('ai.fallback_output_micro_usd', 40_000_000);
    const two = await asked();
    expect(two.cost).toBe(Math.ceil((two.tokens * 1_000_000 + 200 * 40_000_000) / 1000));
    // Said when the catalog was read, not again with each request.
    expect(warned()).toBe(said);
  });

  it('charges a clip what NEAR AI says it used, and cached input at the catalog’s cache price', async () => {
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Cached' });
    // NEAR AI says the clip used a million tokens in and a thousand out: charged that, at Whisper's $0.01 a million each
    // way, not reckoned from its length (which would be a few thousand).
    h.near.speechUsageNext({ input: 1_000_000, output: 1_000 });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    expect((await meter(ann)).byKind['transcript']).toBe(Math.ceil((1_000_000 * 10_000 + 1_000 * 10_000) / 1000));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    const asked = async () => {
      const before = (await meter(ann)).byKind['ask'] ?? 0;
      await answer(ann.api.notes.askAll('When do we ship?'));
      return { cost: ((await meter(ann)).byKind['ask'] ?? 0) - before, prompt: h.near.prompts.at(-1) ?? '' };
    };
    // The same question twice, the second with all of its prompt cached: input at $0.30 a million, then at the catalog's
    // cache-read price, $0.000000006 a token ($0.006 a million). Output at $1.20 a million both times.
    const full = await asked();
    h.near.cachedNext(Number.MAX_SAFE_INTEGER);
    const cached = await asked();
    expect(cached.prompt).toBe(full.prompt);
    const tokens = Math.round(full.prompt.length / 4);
    expect(full.cost).toBe(Math.ceil((tokens * 300_000 + 200 * 1_200_000) / 1000));
    expect(cached.cost).toBe(Math.ceil((tokens * 6_000 + 200 * 1_200_000) / 1000));
  });

  it('charges at the price it has without waiting on NEAR AI’s catalog, and reads the catalog again behind it', async () => {
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Listed' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    // The list of models is more than ten minutes old, and NEAR AI's catalog doesn't answer until the question has been.
    let reading = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = () => resolve(); });
    h.near.holdCatalogNext(async () => { reading = true; await gate; });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11 * 60_000 });
    const from = h.logs.length;
    const before = (await meter(ann)).byKind['ask'] ?? 0;
    try {
      // Answered and charged at the price it had, while the catalog is still being read.
      expect((await answer(ann.api.notes.askAll('When do we ship?'))).length).toBeGreaterThan(0);
      expect((await meter(ann)).byKind['ask']).toBeGreaterThan(before);
      await expect.poll(() => reading).toBe(true);
      expect(h.logs.slice(from).some((l) => l.includes('models not listed'))).toBe(false);
    } finally {
      release();
    }
  });

  it('charges nothing for a request NEAR AI turned away', async () => {
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Down' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    const before = await meter(ann);
    h.near.failNext(1, 'down');
    expect(code(await answer(ann.api.notes.askAll('When do we ship?')).catch((e: unknown) => e))).not.toBe('succeeded');
    expect((await meter(ann)).spentNano).toBe(before.spentNano);
  });
});

describe('running out', () => {
  it('tells the organizer alone when about the warning’s seconds are left at the call’s pace', async () => {
    // Thirty minutes of notes, told once there's under an hour of them left at this call's pace.
    await h.setLimit('plan.free.notes_minutes', 30);
    await h.setLimit('ai.warn_seconds', 3600);
    const org = await account(unique('organizer'));
    const kofi = await account(unique('kofi'));
    const { host, meeting } = await call(org, [kofi.email]);
    const theirs = await kofi.api.calls.join(meeting.code, { mic: true, cam: false });
    await settle(theirs, (s) => s.participants.some((p) => p.isMe));
    await host.appendAudio(piece('warn', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    const mine = await settle(host, (s) => s.capture.runningOut !== null);
    expect(mine.capture.runningOut).toEqual({ at: expect.any(String) });
    expect(mine.capture.stopped).toBeNull();
    expect(mine.capture.mode).toBe('on');
    expect((await settle(theirs, (s) => s.capture.runningOut !== null)).capture.runningOut).toBeNull();
  });

  it('tells the organizer once, whichever charge to the call brings it close: captions as much as a transcript clip', async () => {
    // Thirty minutes of notes, and no warning yet: the first clip says nothing.
    await h.setLimit('plan.free.notes_minutes', 30);
    await h.setLimit('ai.warn_seconds', 0);
    const org = await account(unique('organizer'));
    const kofi = await account(unique('kofi'));
    const { host, meeting } = await call(org, [kofi.email]);
    const theirs = await kofi.api.calls.join(meeting.code, { mic: true, cam: false });
    await settle(theirs, (s) => s.participants.some((p) => p.isMe));
    await host.appendAudio(piece('captions', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    const line = (await settle(theirs, (s) => s.transcript.length > 0)).transcript[0]?.id ?? '';
    expect((await now(host)).capture.runningOut).toBeNull();
    // Told once there's under an hour left at the call's pace: the next charge to the call is Kofi's captions, and it tells them.
    await h.setLimit('ai.warn_seconds', 3600);
    await theirs.translate([line], 'de');
    const told = (await settle(host, (s) => s.capture.runningOut !== null)).capture.runningOut;
    expect(told).toEqual({ at: expect.any(String) });
    // Once: the next clip doesn't tell them again.
    await host.transcribe(speech('And we test on staging first.', 6000), host.ticket.identity);
    await settle(host, (s) => s.transcript.length > 1);
    expect(host.getSnapshot().capture.runningOut).toEqual(told);
    expect((await now(theirs)).capture.runningOut).toBeNull();
  });

  it('refuses only a request too dear for what’s left: the allowance isn’t stopped, and a cheaper one still goes', async () => {
    // An hour of notes at whatever ai.hour_micro_usd says, and no stop short of nothing.
    await h.setLimit('plan.free.notes_minutes', 60);
    await h.setLimit('ai.stop_micro_usd', 0);
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Asked' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    // What the question holds on its way in the default model, seen while it is.
    let holds = 0;
    h.near.holdNext(async () => { const m = await meter(ann); holds = m.unspentNano - m.leftNano; });
    await answer(ann.api.notes.askAll('When do we ship?'));
    expect(holds).toBeGreaterThan(0);
    // Left: a third more than that. The same question in a model at 5/3 of the default's prices holds more than is left.
    const spent = (await meter(ann)).spentNano;
    await h.setLimit('ai.hour_micro_usd', Math.ceil((spent + (holds * 4) / 3) / 1000));
    await ann.api.account.updatePreferences({ model: UNENCRYPTED_MODEL });
    const sent = h.near.prompts.length;
    expect(await refusal(answer(ann.api.notes.askAll('When do we ship?')))).toBe('plan-limit: What’s left of your notes this period isn’t enough for this.');
    expect(h.near.prompts.length).toBe(sent);
    const after = await meter(ann);
    expect(after).toMatchObject({ stopped: false, spentNano: spent });
    // The cheaper one fits, and goes.
    await ann.api.account.updatePreferences({ model: null });
    expect((await answer(ann.api.notes.askAll('When do we ship?'))).length).toBeGreaterThan(0);
    expect((await meter(ann)).spentNano).toBeGreaterThan(spent);
  });

  it('in a call, refuses captions too dear for what’s left and leaves notes on: only a spent allowance stops them', async () => {
    await h.setLimit('plan.free.notes_minutes', 60);
    await h.setLimit('ai.stop_micro_usd', 0);
    const org = await account(unique('organizer'));
    const kofi = await account(unique('kofi'));
    const { host, meeting } = await call(org, [kofi.email]);
    const theirs = await kofi.api.calls.join(meeting.code, { mic: true, cam: false });
    await settle(theirs, (s) => s.participants.some((p) => p.isMe));
    await host.appendAudio(piece('dear', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    const line = (await settle(theirs, (s) => s.transcript.length > 0)).transcript[0]?.id ?? '';
    // Left, beside what the call holds for its notes: a twentieth of a cent. A clip holds far less; captions far more.
    const live = await meter(org);
    await h.setLimit('ai.hour_micro_usd', Math.ceil((live.spentNano + live.unspentNano - live.leftNano + 500_000) / 1000));
    expect(await refusal(theirs.translate([line], 'de'))).toBe('plan-limit: What’s left of the organizer’s notes this period isn’t enough for this.');
    expect((await meter(org)).stopped).toBe(false);
    expect((await now(host)).capture).toMatchObject({ mode: 'on', stopped: null });
    // The call goes on being transcribed.
    await host.transcribe(speech('And we test on staging first.', 6000), host.ticket.identity);
    expect((await settle(host, (s) => s.transcript.length > 1)).capture).toMatchObject({ mode: 'on', stopped: null });
  });

  it('stops notes for everyone when the organizer’s allowance is spent, writes the last note past it, and nothing more', async () => {
    // A minute of notes at $0.0036 an hour, and no stop short of nothing: the first clip, holding what writing the notes
    // will cost, spends it, and the notes cost more than it.
    await h.setLimit('plan.free.notes_minutes', 1);
    await h.setLimit('ai.hour_micro_usd', 3600);
    await h.setLimit('ai.stop_micro_usd', 0);
    const org = await account(unique('organizer'));
    const kofi = await account(unique('kofi'));
    const { host, meeting } = await call(org, [kofi.email]);
    const theirs = await kofi.api.calls.join(meeting.code, { mic: true, cam: false });
    await settle(theirs, (s) => s.participants.some((p) => p.isMe));
    const guest = await h.browser().api.calls.join(meeting.code, { mic: true, cam: false, name: 'Sam Guest' });
    await letIn(host, guest);
    await host.appendAudio(piece('before', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    // Everyone is told, guests included, and notes are off: the call goes on.
    for (const s of [host, theirs, guest]) {
      const now = await settle(s, (x) => x.capture.stopped !== null);
      expect(now.capture.stopped).toEqual({ reason: 'notes', at: expect.any(String) });
      expect(now.capture.mode).toBe('off');
      expect(now.phase).toBe('in-call');
    }
    // Anyone with the link sees notes are off, and not why: that's for the people in the call.
    expect((await h.browser().api.calls.card(meeting.code)).capture).toMatchObject({ mode: 'off', stopped: null, runningOut: null });
    // Nothing more is transcribed or recorded, and nothing the organizer pays for reaches the AI.
    expect(code(await host.transcribe(speech('This is never heard.', 7000), host.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await guest.askSoFar('When do we ship?', { kind: 'all' }).catch((e: unknown) => e))).toBe('plan-limit');
    expect(await refusal(host.setNotes(true))).toBe('plan-limit: Your notes for this period have run out. They start again when your plan renews.');
    // The last note is written from what was said before notes stopped, past the allowance.
    const ended = await host.leave();
    await written(org.api, ended?.pendingNoteId ?? '');
    const note = await org.api.notes.get(ended?.pendingNoteId ?? '');
    expect(note.decisions.map((d) => d.text)).toEqual(['We agreed to ship on Monday.']);
    expect(JSON.stringify(note)).not.toContain('This is never heard.');
    const spent = await meter(org);
    expect(spent.spentNano).toBeGreaterThan(spent.allowanceNano);
    expect(spent.stopped).toBe(true);
    expect((await org.api.plans.plan()).notes).toEqual({ minutesLeft: 0, minutesPerPeriod: 1, stopped: true });
    // And then nothing: the next call starts without notes, saying why, and the organizer's questions are refused.
    const next = await call(org);
    expect((await settle(next.host, () => true)).capture).toMatchObject({ mode: 'off', stopped: { reason: 'notes' } });
    expect(code(await answer(org.api.notes.askAll('When do we ship?')).catch((e: unknown) => e))).toBe('plan-limit');
    expect(code(await org.api.recordings.start({ title: 'More' }).catch((e: unknown) => e))).toBe('plan-limit');
    // Raised, as by a new period or a bigger plan, the allowance isn't spent any more: notes come on again.
    await h.setLimit('plan.free.notes_minutes', 300);
    await next.host.setNotes(true);
    expect((await settle(next.host, (s) => s.capture.mode === 'on')).capture).toMatchObject({ mode: 'on', stopped: null });
  });

  it('pays for writing a call’s notes from what the call held for them, so writing them stops nothing the call held enough for', async () => {
    // An hour of notes at whatever ai.hour_micro_usd says, and no stop short of nothing.
    await h.setLimit('plan.free.notes_minutes', 60);
    await h.setLimit('ai.stop_micro_usd', 0);
    const org = await account(unique('organizer'));
    const { host } = await call(org);
    await host.appendAudio(piece('held', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    // What the call has spent and holds for writing its notes, and a twentieth of a cent more: less than writing them costs.
    const live = await meter(org);
    const reserved = live.unspentNano - live.leftNano;
    expect(reserved).toBeGreaterThan(0);
    await h.setLimit('ai.hour_micro_usd', Math.ceil((live.spentNano + reserved + 50_000) / 1000));
    const room = (await meter(org)).leftNano;
    expect(room).toBeGreaterThanOrEqual(50_000);
    // While the notes are written, what each request holds is part of what the call held: nothing more is taken.
    let writing: { leftNano: number; stopped: boolean } | null = null;
    h.near.holdNext(async () => { writing = await meter(org); });
    const ended = await host.leave();
    await written(org.api, ended?.pendingNoteId ?? '');
    expect(writing).toEqual(expect.objectContaining({ leftNano: room, stopped: false }));
    const after = await meter(org);
    expect(after.byKind['notes']).toBeGreaterThan(room);
    expect(after.stopped).toBe(false);
    expect((await org.api.plans.plan()).notes.stopped).toBe(false);
  });

  it('holds what writing a call’s notes will cost at the model it’s set to, and refuses a dearer one the organizer can’t cover', async () => {
    await h.setLimit('plan.free.notes_minutes', 60);
    await h.setLimit('ai.stop_micro_usd', 0);
    const org = await account(unique('organizer'));
    const { host } = await call(org);
    await host.appendAudio(piece('model', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    const held = async () => { const m = await meter(org); return m.unspentNano - m.leftNano; };
    const theDefault = await held();
    // A model at 5/3 of the default's prices: what the call holds for its notes goes up with it, and down again after.
    await host.setModel(UNENCRYPTED_MODEL);
    const dearer = await held();
    expect(dearer).toBeGreaterThan(theDefault * 1.5);
    await host.setModel(null);
    expect(await held()).toBeLessThan(dearer);
    // With a hundredth of a cent left beside what's held, the dearer model is refused: the call keeps its model and its notes.
    const live = await meter(org);
    await h.setLimit('ai.hour_micro_usd', Math.ceil((live.spentNano + live.unspentNano - live.leftNano + 100_000) / 1000));
    expect(await refusal(host.setModel(UNENCRYPTED_MODEL))).toBe('plan-limit: What’s left of your notes this period won’t cover writing this call’s notes with that model. Keep the one it has, or choose one that costs less.');
    expect((await now(host)).capture).toMatchObject({ mode: 'on', model: null, stopped: null });
    expect(await meter(org)).toMatchObject({ stopped: false });
    expect(await held()).toBeLessThan(dearer);
  });

  it('stops notes when the organizer’s storage fills, logging the limit by name, what’s stored, what was adding and the limit', async () => {
    const org = await account(unique('organizer'));
    const { host } = await call(org);
    await host.appendAudio(piece('stored', 0));
    const stored = (await org.api.plans.plan()).storage.usedBytes;
    // Room for a kilobyte more: the next piece doesn't fit.
    await h.setLimit('plan.free.storage_bytes', stored + 1024);
    let from = h.logs.length;
    expect(code(await host.appendAudio(piece('full', 1)).catch((e: unknown) => e))).toBe('plan-limit');
    expect((await settle(host, (s) => s.capture.stopped !== null)).capture).toMatchObject({ mode: 'off', stopped: { reason: 'storage' } });
    const full = linesSince(from).find((l) => l.msg === 'The organizer’s storage is full, so notes have stopped.');
    expect(full).toMatchObject({ level: 30, reason: 'storage', limit: 'plan.free.storage_bytes', usedBytes: stored, limitBytes: stored + 1024, grace: false });
    expect(full?.['addingBytes']).toBeGreaterThan(1024);
    // Turning notes on again is refused while there's no room for them to come back, logged the same way.
    from = h.logs.length;
    const word = 'Your storage is full, so notes can’t be kept. Delete something, or move to a plan with more room.';
    expect(await refusal(host.setNotes(true))).toBe(`plan-limit: ${word}`);
    expect(linesSince(from).find((l) => l.msg === word)).toMatchObject({ level: 30, limit: 'plan.free.storage_bytes', usedBytes: stored, addingBytes: 1024 * 1024, limitBytes: stored + 1024 });
  });

  it('after a Free organizer’s notes stop, an invitee on Pro still asks from their own allowance, and a guest can’t', async () => {
    await h.setLimit('plan.free.notes_minutes', 1);
    await h.setLimit('ai.hour_micro_usd', 3600);
    await h.setLimit('ai.stop_micro_usd', 0);
    const org = await account(unique('organizer'));
    const kofi = await account(unique('kofi'));
    await creditByEmail(h.deps, kofi.email, 20_000_000);
    await kofi.api.plans.buyPro(1, 20_000_000);
    const { host, meeting } = await call(org, [kofi.email]);
    const theirs = await kofi.api.calls.join(meeting.code, { mic: true, cam: false });
    await settle(theirs, (s) => s.participants.some((p) => p.isMe));
    const guest = await h.browser().api.calls.join(meeting.code, { mic: true, cam: false, name: 'Sam Guest' });
    await letIn(host, guest);
    await host.appendAudio(piece('before', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    expect((await settle(theirs, (s) => s.capture.stopped !== null)).capture.stopped).toEqual({ reason: 'notes', at: expect.any(String) });
    // The guest is told whose notes ran out: theirs aren't.
    expect(await refusal(guest.askSoFar('When do we ship?', { kind: 'all' }))).toBe('plan-limit: The organizer’s notes for this period have run out, and this is paid from them.');
    await theirs.askSoFar('When do we ship?', { kind: 'all' });
    const k = await meter(kofi);
    expect(k.plan).toBe('pro');
    expect(k.byKind['ask']).toBeGreaterThan(0);
    expect((await meter(org)).byKind['ask'] ?? 0).toBe(0);
  });

  it('stops every call the organizer has going, not only the one that spent it', async () => {
    await h.setLimit('plan.free.notes_minutes', 1);
    await h.setLimit('ai.hour_micro_usd', 3600);
    await h.setLimit('ai.stop_micro_usd', 0);
    const org = await account(unique('organizer'));
    const first = await call(org);
    const second = await call(org);
    await first.host.transcribe(speech('We agreed to ship on Monday.', 0), first.host.ticket.identity);
    expect((await settle(first.host, (s) => s.capture.stopped !== null)).capture.stopped).toEqual({ reason: 'notes', at: expect.any(String) });
    // The other call's next clip finds it spent: refused, and that call stops too.
    expect(code(await second.host.transcribe(speech('Meanwhile, elsewhere.', 0), second.host.ticket.identity).catch((e: unknown) => e))).toBe('plan-limit');
    expect((await settle(second.host, (s) => s.capture.stopped !== null)).capture).toMatchObject({ mode: 'off', stopped: { reason: 'notes' } });
  });

  it('stops a room recording the same way: refused once its recorder’s allowance is spent', async () => {
    await h.setLimit('plan.free.notes_minutes', 1);
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Running out' });
    await rec.appendAudio(piece('room', 0));
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    expect(code(await rec.transcribe(speech('This is never heard.', 7000)).catch((e: unknown) => e))).toBe('plan-limit');
    await written(ann.api, (await rec.stop()).pendingNoteId);
    expect(code(await ann.api.recordings.start({ title: 'Again' }).catch((e: unknown) => e))).toBe('plan-limit');
  });

  it('holds what requests in flight may cost, so several at once never spend past the allowance', async () => {
    // A note to ask about, written while there's plenty.
    await h.setLimit('ai.stop_micro_usd', 0);
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Asked' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    // Then a minute of notes: room for a question or two held at once, not eight, each held at the most it can cost.
    await h.setLimit('plan.free.notes_minutes', 1);
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => answer(ann.api.notes.askAll('When do we ship?')).then(() => 'answered', code)));
    const after = await meter(ann);
    expect(outcomes).toContain('answered');
    expect(outcomes).toContain('plan-limit');
    expect(after.spentNano).toBeLessThanOrEqual(after.allowanceNano);
  });
});

describe('periods', () => {
  /** An account whose minute of notes a room recording's first clip spent, in periods of an hour. */
  async function spentInAnHour() {
    await h.setLimit('plan.period_seconds', 3600);
    await h.setLimit('plan.free.notes_minutes', 1);
    const ann = await account();
    const rec = await ann.api.recordings.start({ title: 'Spent' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(ann.api, (await rec.stop()).pendingNoteId);
    const spent = await meter(ann);
    expect(spent).toMatchObject({ stopped: true, to: spent.from + 3_600_000 });
    expect(code(await answer(ann.api.notes.askAll('When do we ship?')).catch((e: unknown) => e))).toBe('plan-limit');
    return { ann, spent };
  }

  it('starts the next period afresh: a request after the period ends is charged to the new one, and the stop is lifted', async () => {
    const { ann, spent } = await spentInAnHour();
    vi.useFakeTimers({ toFake: ['Date'], now: spent.to + 60_000 });
    // Shown so before anything touches it: all of the new period's notes.
    expect(await ann.api.plans.plan()).toMatchObject({ period: { from: new Date(spent.to).toISOString() }, notes: { minutesPerPeriod: 1, stopped: false } });
    const fresh = await meter(ann);
    expect(fresh).toMatchObject({ from: spent.to, spentNano: 0, unspentNano: fresh.allowanceNano, stopped: false });
    // A question is answered, and charged to the new period alone.
    expect((await answer(ann.api.notes.askAll('When do we ship?'))).length).toBeGreaterThan(0);
    const next = await meter(ann);
    expect(next).toMatchObject({ from: spent.to, to: spent.to + 3_600_000, stopped: false, byKind: { ask: next.spentNano } });
    expect(Object.keys(next.byKind)).toEqual(['ask']);
    // And notes can be kept again: a room recording starts.
    expect((await ann.api.recordings.start({ title: 'Again' })).getSnapshot().status).toBe('recording');
  });

  it('runs a period to its end as it began when plan.period_seconds changes, and the next one at the new length', async () => {
    const { ann, spent } = await spentInAnHour();
    // Half-hour periods from now on, forty minutes into the hour. Counted afresh from when the account began, it would be in
    // its second period with all its notes back; it's in the one that began, still spent, until that one ends.
    await h.setLimit('plan.period_seconds', 1800);
    vi.useFakeTimers({ toFake: ['Date'], now: spent.from + 40 * 60_000 });
    expect(await meter(ann)).toMatchObject({ from: spent.from, to: spent.to, stopped: true, spentNano: spent.spentNano });
    expect((await ann.api.plans.plan()).period).toEqual({ from: new Date(spent.from).toISOString(), to: new Date(spent.to).toISOString() });
    expect(code(await answer(ann.api.notes.askAll('When do we ship?')).catch((e: unknown) => e))).toBe('plan-limit');
    // Once it's over, the next is half an hour long, with all its notes.
    vi.setSystemTime(spent.to + 60_000);
    expect(await meter(ann)).toMatchObject({ from: spent.to, to: spent.to + 1_800_000, stopped: false, spentNano: 0 });
    await answer(ann.api.notes.askAll('When do we ship?'));
    expect(Object.keys((await meter(ann)).byKind)).toEqual(['ask']);
  });
});

describe('what’s shown', () => {
  it('says notes left from what was spent, so it only goes down while a call goes on and its notes are written', async () => {
    // A minute of notes is a tenth of a cent here: anything held for a request would show as many minutes if it counted.
    await h.setLimit('ai.hour_micro_usd', 6000);
    const minuteNano = 100_000;
    const org = await account(unique('organizer'));
    const shown = async () => (await org.api.plans.plan()).notes.minutesLeft;
    const seen = [await shown()];
    const { host } = await call(org);
    await host.appendAudio(piece('shown', 0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    // The call holds what writing its notes could cost at most. The meter decides by that; the plan shows what's spent.
    const during = await meter(org);
    expect(during.leftNano).toBeLessThan(during.unspentNano - minuteNano);
    seen.push(await shown());
    expect(seen.at(-1)).toBe(Math.floor(during.unspentNano / minuteNano));
    // While the notes are written, each request holds the most its reply could be, and the plan still says what's spent.
    let held = 0;
    h.near.holdNext(async () => {
      const m = await meter(org);
      held = m.unspentNano - m.leftNano;
      seen.push(await shown());
    });
    const ended = await host.leave();
    await written(org.api, ended?.pendingNoteId ?? '');
    seen.push(await shown());
    expect(held).toBeGreaterThan(minuteNano);
    expect(seen).toHaveLength(4);
    // Each reading is at most the one before: down as the allowance is spent, never back up.
    for (const [i, n] of seen.entries()) expect(n, `reading ${i}`).toBeLessThanOrEqual(seen[i - 1] ?? n);
    expect(seen.at(-1)).toBeLessThan(seen[0] ?? 0);
    expect((await org.api.plans.plan()).notes.stopped).toBe(false);
  });
});
