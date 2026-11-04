/**
 * Catching up during a call, for the person asking alone: which stretch of the live transcript a range reads, what
 * it's missing, the transcript moments behind each point (only real lines, from what was read), what a guest with
 * the link may read, the grants checked again once an answer is written, and that nothing of it reaches the call's
 * state, its rows or the logs. The real API over HTTP via @alcove/api-http, real Postgres, the object store, the
 * local LiveKit server, and main's fake NEAR AI (whose notes model also points at lines that aren't there).
 */
import { AlcoveApiError, type AudioPiece, type CallSession, type CallState, type CatchUp, type Evidence, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { speechWav } from './testing/fake-near';
import { ORIGIN, startHarness, type Harness } from './testing/harness';
import { connect, disposeLiveKit, signWebhook, type TestParticipant } from './testing/livekit';

// Calls set up MLS groups and LiveKit rooms, which a busy runner can be slow to do: every wait says what it waited for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
/** Test participants in a call's LiveKit room, gone after each test. */
const open: TestParticipant[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const message = (e: unknown) => (e instanceof AlcoveApiError ? e.message : '');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const guestBrowser = () => h.browser().api;
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, s: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq: s, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, segment: number, startMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, startMs, durationMs: ms });
/** Milliseconds into a segment that started with the call: a line said `s` seconds in. */
const at = (s: number) => Math.max(0, Math.round(s * 1000));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await sleep(30); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** Waits until the organizer no longer lists someone in the call: the goodbye their page sent as it went has arrived. */
async function gone(host: CallSession, who: CallSession) {
  const s = await settle(host, (x) => !x.participants.some((p) => p.id === who.ticket.identity));
  expect(s.participants.map((p) => p.id), 'the organizer no longer lists them').not.toContain(who.ticket.identity);
}
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
async function hook(event: string, roomName: string, identity: string) {
  const body = JSON.stringify({ event, room: { name: roomName }, participant: { identity } });
  return fetch(`${h.baseUrl}/hooks/livekit`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await signWebhook(h.deps.cfg, body) }, body });
}
/** The live transcript's line IDs by what was said, as the organizer sees it. */
async function lineIds(host: CallSession, n: number): Promise<Map<string, string>> {
  return new Map((await settle(host, (s) => s.transcript.length >= n)).transcript.map((l) => [l.text, l.id]));
}
const id = (ids: Map<string, string>, text: string) => ids.get(text) ?? `missing: ${text}`;
/** Every moment a catch-up points at. */
const cited = (c: CatchUp): Evidence[] => [...c.decided, ...c.proposed, ...c.open, ...c.next].flatMap((x) => x.evidence);
const texts = (c: CatchUp) => [...c.decided, ...c.proposed, ...c.open, ...c.next].map((x) => x.text);
const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
/** The API's log lines since `from`, parsed. */
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const logsSince = (from: number) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });

describe('catching up during a call', () => {
  it('reads what you missed: before you joined, since you joined, and while you were away, with both ends of a stretch in it', async () => {
    const org = await account();
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await host.appendAudio(piece(audioBytes('ranges'), 0, 0));
    const A = 'We agreed to start with the budget.';
    await host.transcribe(speech(A, 0, 0), host.ticket.identity);
    // Kofi, invited, comes in a little later.
    await sleep(1200);
    const kofiApi = (await account(kofiEmail)).api;
    const kofi = await kofiApi.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    const joined = (await kofi.catchUpWindow()).joined;
    expect(joined).toBeGreaterThanOrEqual(1);
    const B = 'Kofi will check the budget by Friday.';
    await host.transcribe(speech(B, 0, at(joined + 0.5)), host.ticket.identity);

    // Before you joined: what was said until you came in, and nothing after.
    const before = await kofi.catchUp({ kind: 'before-joined' });
    let ids = await lineIds(host, 2);
    expect(before.read).toMatchObject({ from: 0, to: joined, lines: 1, whileHere: false, skipped: null });
    expect(before.decided).toEqual([{ text: A, evidence: [{ kind: 'transcript', lineId: id(ids, A), said: expect.closeTo(0, 0) }] }]);
    // Since you joined: the rest.
    const since = await kofi.catchUp({ kind: 'since-joined' });
    expect(since.read).toMatchObject({ from: joined, lines: 1 });
    expect(since.next).toEqual([{ text: B, owner: 'Kofi', due: 'Friday', evidence: [{ kind: 'transcript', lineId: id(ids, B), said: expect.closeTo(joined + 0.5, 0) }] }]);

    // Kofi's page goes away and comes back: that's their time away.
    kofi.closing();
    await gone(host, kofi);
    await sleep(1200);
    const back = await kofiApi.calls.join(c, { mic: true, cam: false, previous: kofi.ticket.pass });
    await inGroup(back);
    const win = await back.catchUpWindow();
    const away = win.away ?? { from: 0, to: 0 };
    expect(away.to - away.from).toBeGreaterThanOrEqual(1);
    expect(win).toMatchObject({ joined, here: null });
    const C = 'Should we cut the travel line?';
    const D = 'We decided to keep the travel line.';
    await host.transcribe(speech(C, 0, at((away.from + away.to) / 2)), host.ticket.identity);
    await host.transcribe(speech(D, 0, at(away.to + 0.2)), host.ticket.identity);
    ids = await lineIds(host, 4);
    // While you were away: from a little before you dropped out until you were back, and nothing after.
    const missed = await back.catchUp({ kind: 'away' });
    expect(missed.read).toMatchObject({ from: Math.max(0, away.from - 30), to: away.to, lines: 3 });
    expect(texts(missed)).toEqual(expect.arrayContaining([A, B, C]));
    expect(texts(missed)).not.toContain(D);
    // Every moment it points at is a line it read: the model's invented decision, and its pointers at lines that
    // aren't there, never reach anyone.
    const read = new Set([A, B, C].map((t) => id(ids, t)));
    expect(cited(missed).length).toBeGreaterThan(0);
    for (const e of cited(missed)) expect(read.has(e.lineId)).toBe(true);
    expect(texts(missed)).not.toContain('Everyone agreed to double the budget.');

    // Both ends of a stretch are in it; a stretch with nothing said in it is answered without asking the model.
    const said = new Map((await host.moment(id(ids, A))).lines.map((l) => [l.text, l.said]));
    const saidC = said.get(C) ?? -1;
    const saidD = said.get(D) ?? -1;
    const exactly = await back.catchUp({ kind: 'between', from: saidC, to: saidC });
    expect(exactly.read).toMatchObject({ from: saidC, to: saidC, lines: 1 });
    expect(cited(exactly).map((e) => e.lineId)).toEqual([id(ids, C), id(ids, C)]);
    const sent = h.near.calls.length;
    expect(await back.catchUp({ kind: 'between', from: saidC + 0.1, to: saidD - 0.1 })).toMatchObject({ summary: '', decided: [], proposed: [], open: [], next: [], read: { lines: 0, through: null } });
    expect(await back.askSoFar('What did we decide?', { kind: 'between', from: saidC + 0.1, to: saidD - 0.1 })).toMatchObject({ text: '', evidence: [], read: { lines: 0 } });
    expect(h.near.calls.length).toBe(sent);
    // The whole call, and the last few minutes, run up to now.
    expect((await back.catchUp({ kind: 'all' })).read).toMatchObject({ from: 0, lines: 4 });
    expect((await back.catchUp({ kind: 'recent', minutes: 5 })).read).toMatchObject({ from: 0, lines: 4 });

    // Ranges that don't make sense are refused, and so is time away for someone who hasn't been.
    const refused = async (p: Promise<unknown>) => code(await p.catch((e: unknown) => e));
    expect(await refused(back.catchUp({ kind: 'between', from: win.now + 3600, to: null }))).toBe('invalid');
    expect(await refused(back.catchUp({ kind: 'between', from: 10, to: 5 }))).toBe('invalid');
    expect(await refused(host.catchUp({ kind: 'away' }))).toBe('conflict');
    const raw = await fetch(`${h.baseUrl}/v1/live/calls/${back.ticket.callId}/catch-up`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': back.ticket.pass }, body: JSON.stringify({ range: { kind: 'yesterday' } }) });
    expect(raw.status).toBe(400);
    await host.leave();
  });

  it('says what a stretch is missing: before notes came on, while they were off or paused, and while the organizer’s connection was away', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await sleep(1100);
    host.setNotes(true);
    await settle(host, (x) => x.capture.mode === 'on');
    await host.appendAudio(piece(audioBytes('gaps'), 0, 0));
    await host.transcribe(speech('We agreed to start late.', 0, 0), host.ticket.identity);
    host.setNotes(false);
    await settle(host, (x) => x.capture.mode === 'off');
    await sleep(1100);
    host.setNotes(true);
    await settle(host, (x) => x.capture.mode === 'on' && x.notes.recording.segment === 1);
    await host.transcribe(speech('Kofi will send the deck.', 1, 0), host.ticket.identity);
    await host.pause();
    await sleep(1100);
    await host.resume();

    const all = await host.catchUp({ kind: 'all' });
    expect(all.read.lines).toBe(2);
    // Off until notes first came on, off again for a while, then paused: the call's own gaps, each a second or more.
    expect(all.read.gaps.map((g) => g.kind)).toEqual(['off', 'off', 'paused']);
    expect(all.read.gaps).toEqual(host.getSnapshot().capture.gaps);
    for (const g of all.read.gaps) expect(Date.parse(g.to ?? '') - Date.parse(g.from)).toBeGreaterThanOrEqual(1000);
    // A pause is a gap, not time the organizer's browser was away.
    expect(all.read.missed).toEqual([]);
    // A stretch that ends before notes went off again has only the first of them in it.
    const startedAt = Date.parse(host.getSnapshot().startedAt);
    const offAt = (Date.parse(all.read.gaps[1]?.from ?? '') - startedAt) / 1000;
    expect((await host.catchUp({ kind: 'between', from: 0, to: Math.max(0, offAt - 0.5) })).read.gaps).toEqual(all.read.gaps.slice(0, 1));

    // The organizer's connection drops; its next one comes after a while. Nothing was sent to be transcribed meanwhile.
    expect((await hook('participant_left', host.ticket.roomName, host.ticket.identity)).status).toBe(200);
    await sleep(2200);
    const again = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(again);
    const missed = (await again.catchUp({ kind: 'all' })).read.missed;
    expect(missed).toHaveLength(1);
    expect((missed[0]?.to ?? 0) - (missed[0]?.from ?? 0)).toBeGreaterThanOrEqual(2);
    await again.leave();
  });

  it('lets a guest with the link read only what was said while they were in the call', async () => {
    const org = await account();
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    await host.appendAudio(piece(audioBytes('guest'), 0, 0));
    const A = 'We agreed on the budget before Sam came.';
    await host.transcribe(speech(A, 0, 0), host.ticket.identity);
    await sleep(1100);
    const browser = guestBrowser();
    const sam = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const joined = (await sam.catchUpWindow()).joined;
    // Said once Sam was in (and before Sam's page goes away below).
    await sleep(800);
    const B = 'Sam will review the plan by Monday.';
    await host.transcribe(speech(B, 0, at(joined + 0.5)), host.ticket.identity);
    let ids = await lineIds(host, 2);

    // Sam sees only what was said once they were in: in the live transcript, catching up, asking and moments.
    expect((await settle(sam, (x) => x.transcript.length === 1)).transcript.map((l) => l.text)).toEqual([B]);
    const sent = h.near.prompts.length;
    const all = await sam.catchUp({ kind: 'all' });
    expect(all.read).toMatchObject({ lines: 1, whileHere: true });
    expect(cited(all).map((e) => e.lineId)).toEqual([id(ids, B)]);
    expect(h.near.prompts.slice(sent).join('\n')).not.toContain(A);
    expect(await sam.askSoFar('What about the budget?', { kind: 'all' })).toMatchObject({ text: 'That wasn’t covered in the call.', evidence: [] });
    expect(code(await sam.moment(id(ids, A)).catch((e: unknown) => e))).toBe('not-found');
    expect((await sam.moment(id(ids, B))).lines.map((l) => l.text)).toEqual([B]);
    expect(await sam.translate([id(ids, A)], 'fr')).toEqual([]);
    // Nothing before they came, and their window says what they can read.
    expect(await sam.catchUp({ kind: 'before-joined' })).toMatchObject({ read: { lines: 0, whileHere: true } });
    expect((await sam.catchUpWindow()).here).toEqual([{ from: joined, to: expect.any(Number) }]);

    // Sam's page goes away and comes back: what was said meanwhile goes to the people invited, not to Sam.
    sam.closing();
    await gone(host, sam);
    await sleep(1200);
    const back = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: sam.ticket.pass });
    await inGroup(back);
    const win = await back.catchUpWindow();
    const away = win.away ?? { from: 0, to: 0 };
    expect(win.here).toHaveLength(2);
    const C = 'We decided to drop the old vendor.';
    await host.transcribe(speech(C, 0, at((away.from + away.to) / 2)), host.ticket.identity);
    ids = await lineIds(host, 3);
    expect((await settle(back, (x) => x.transcript.length === 1)).transcript.map((l) => l.text)).toEqual([B]);
    const meanwhile = await back.catchUp({ kind: 'away' });
    expect(meanwhile.read.whileHere).toBe(true);
    expect(texts(meanwhile)).not.toContain(C);
    expect(code(await back.moment(id(ids, C)).catch((e: unknown) => e))).toBe('not-found');
    // Kofi, on the invite, gets the notes, so reads all of it.
    expect((await kofi.catchUp({ kind: 'all' })).read).toMatchObject({ lines: 3, whileHere: false });
    expect((await kofi.moment(id(ids, C))).lines.map((l) => l.text)).toEqual([A, B, C]);
    expect((await settle(kofi, (x) => x.transcript.length === 3)).transcript.map((l) => l.text)).toEqual([A, B, C]);
    await host.leave();
  });

  // The shortest "last N minutes" is one, so this waits for a line to be more than a minute old.
  it('reads only the last few minutes when asked for them, and nothing said before', async () => {
    const org = await account();
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await inGroup(host);
    // The organizer's browser is in the room, as it is in a real call, or the call ends without them meanwhile.
    open.push(await connect(await host.room(), { sending: host.crypto }));
    await host.appendAudio(piece(audioBytes('recent'), 0, 0));
    const OLD = 'We agreed to open with the roadmap.';
    await host.transcribe(speech(OLD, 0, 0), host.ticket.identity);
    await sleep(61_500);
    const NEW = 'We agreed to finish with pricing.';
    await host.transcribe(speech(NEW, 0, at((await host.catchUpWindow()).now - 2)), host.ticket.identity);
    const ids = await lineIds(host, 2);

    const recent = await host.catchUp({ kind: 'recent', minutes: 1 });
    const said = new Map((await host.moment(id(ids, NEW))).lines.map((l) => [l.text, l.said]));
    expect(recent.read).toMatchObject({ lines: 1, through: said.get(NEW) });
    expect(recent.read.from).toBeGreaterThan(said.get(OLD) ?? Number.POSITIVE_INFINITY);
    expect(texts(recent)).toEqual([NEW]);
    expect(h.near.prompts.at(-1)).not.toContain(OLD);
    const answer = await host.askSoFar('What did we agree?', { kind: 'recent', minutes: 1 });
    expect(answer).toMatchObject({ evidence: [{ kind: 'transcript', lineId: id(ids, NEW) }], read: { lines: 1 } });
    // The whole call still has both.
    expect((await host.catchUp({ kind: 'all' })).read.lines).toBe(2);
    await host.leave();
  }, 120_000);

  it('says what it left out of a stretch too long to read at once, and points only at lines it read', async () => {
    const org = await account();
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await inGroup(host);
    await host.appendAudio(piece(audioBytes('long'), 0, 0));
    // Eight lines of 25,000 characters: more than the 120,000 the notes model is sent at once.
    const long = (n: number) => `We agreed on part ${n}. ${Array.from({ length: 3000 }, (_, k) => `w${n}k${k}`).join(' ')}`.slice(0, 25_000);
    for (let n = 0; n < 8; n++) await host.transcribe(speech(long(n), 0, n * 1000), host.ticket.identity);
    const lines = (await settle(host, (x) => x.transcript.length >= 8)).transcript;
    expect(lines).toHaveLength(8);
    const said = new Map((await host.moment(lines[3]?.id ?? '')).lines.map((l) => [l.id, l.said]));
    const middle = new Set([lines[3]?.id, lines[4]?.id]);

    const from = h.logs.length;
    const c = await host.catchUp({ kind: 'all' });
    // It read the beginning and the end, and says which lines from the middle it left out, and when they were said.
    expect(c.read).toMatchObject({ lines: 6, skipped: { from: said.get(lines[3]?.id ?? ''), to: said.get(lines[4]?.id ?? ''), lines: 2 } });
    expect(h.near.prompts.at(-1)).toContain('[… 2 lines left out …]');
    expect(cited(c).length).toBeGreaterThan(0);
    for (const e of cited(c)) expect(middle.has(e.lineId), 'a moment from the middle it never read').toBe(false);
    // An answer says the same.
    expect((await host.askSoFar('What did we agree?', { kind: 'all' })).read).toMatchObject({ lines: 6, skipped: { lines: 2 } });
    // The log says how many, never what.
    const logged = logsSince(from);
    expect(logged.find((l) => l.msg === 'caught up during a call')).toMatchObject({ lines: 8, cut: 2 });
    expect(logged.find((l) => l.msg === 'question answered during a call')).toMatchObject({ lines: 8, cut: 2 });
    expect(h.logs.slice(from).join('')).not.toContain('w3k1');
    await host.leave();
  });

  it('checks again once an answer is written: nobody removed, gone or past the end of the call gets one', async () => {
    const org = await account();
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    await host.appendAudio(piece(audioBytes('recheck'), 0, 0));
    await host.transcribe(speech('We agreed to sell the old van.', 0, 5000), host.ticket.identity);
    /** Asks while the notes model takes its time, and does `meanwhile` once the question has reached it. */
    const slowly = async (ask: () => Promise<unknown>, meanwhile: () => Promise<void>): Promise<unknown> => {
      const sent = h.near.prompts.length;
      h.near.slowNext(1500);
      const answer = ask().catch((e: unknown) => e);
      await waitFor(() => h.near.prompts.length > sent, 'the question to reach the notes model');
      await meanwhile();
      return answer;
    };
    const removed = await slowly(() => sam.catchUp({ kind: 'all' }), () => host.remove(sam.ticket.identity));
    expect([code(removed), message(removed)]).toEqual(['forbidden', 'The host removed you from this call.']);
    const gone = await slowly(() => kofi.askSoFar('Who buys the van?', { kind: 'all' }), async () => { await kofi.leave(); });
    expect([code(gone), message(gone)]).toEqual(['forbidden', 'You left the call while the answer was being written, so it isn’t shown.']);
    const ended = await slowly(() => host.catchUp({ kind: 'all' }), async () => { await host.leave(); });
    expect([code(ended), message(ended)]).toEqual(['conflict', 'The call ended while the answer was being written. Its notes have everything.']);
    expect(h.logs.join('')).not.toContain('old van');
  });

  it('refuses people waiting, other calls and other accounts, and finds no moment outside this call', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await host.appendAudio(piece(audioBytes('refusals'), 0, 0));
    await host.transcribe(speech('We agreed on the first call.', 0, 0), host.ticket.identity);
    const line = (await lineIds(host, 1)).get('We agreed on the first call.') ?? '';

    // Someone still asking to be let in gets nothing about what was said.
    const waiting = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    for (const attempt of [() => waiting.catchUp({ kind: 'all' }), () => waiting.askSoFar('Anything?', { kind: 'all' }), () => waiting.catchUpWindow(), () => waiting.moment(line)]) {
      expect(code(await attempt().catch((e: unknown) => e))).toBe('forbidden');
    }
    // The same organizer's other call, and another account's: a moment of this call isn't theirs to open.
    const other = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    expect(code(await other.moment(line).catch((e: unknown) => e))).toBe('not-found');
    const stranger = await account();
    const theirs = await stranger.api.calls.join((await stranger.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    expect(code(await theirs.moment(line).catch((e: unknown) => e))).toBe('not-found');
    // A pass is for its own call only, and a moment's ID is checked before anything is read.
    for (const path of ['/catch-up', `/transcript/${line}`]) {
      const r = await fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}${path}`, { headers: { origin: ORIGIN, 'x-alcove-call': theirs.ticket.pass } });
      expect(r.status).toBe(401);
    }
    const bad = await fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/transcript/${encodeURIComponent('../../notes')}`, { headers: { origin: ORIGIN, 'x-alcove-call': host.ticket.pass } });
    expect([400, 404]).toContain(bad.status);
    await other.leave();
    await theirs.leave();
    // Once the call ends, it's the notes' to tell.
    await host.leave();
    for (const attempt of [() => host.catchUp({ kind: 'all' }), () => host.catchUpWindow(), () => host.moment(line)]) {
      expect(code(await attempt().catch((e: unknown) => e))).toBe('conflict');
    }
  });

  it('keeps it to the person asking: nothing goes into the call, and nothing of it is kept or logged', async () => {
    const org = await account();
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    await host.appendAudio(piece(audioBytes('private'), 0, 0));
    await host.transcribe(speech('CANARY-CATCHUP-LINE we agreed to sell the lighthouse.', 0, 0), host.ticket.identity);
    const line = (await lineIds(host, 1)).get('CANARY-CATCHUP-LINE we agreed to sell the lighthouse.') ?? '';
    const version = async () => Number((await h.pool.query('SELECT version FROM calls WHERE call_id = $1', [host.ticket.callId])).rows[0]?.version);
    const rows = async () => Number((await h.pool.query(`SELECT (SELECT count(*) FROM operations) + (SELECT count(*) FROM transcript_translations) + (SELECT count(*) FROM transcript_clips) AS n`)).rows[0]?.n);
    const [v0, r0] = [await version(), await rows()];
    const seen = { ...host.getSnapshot(), elapsed: 0 };

    const caught = await kofi.catchUp({ kind: 'all' });
    expect(caught.decided[0]?.text).toContain('CANARY-CATCHUP-LINE');
    const answer = await kofi.askSoFar('CANARY-CATCHUP-QUESTION who buys the lighthouse?', { kind: 'recent', minutes: 5 });
    expect(answer.evidence).toEqual([{ kind: 'transcript', lineId: line, said: expect.any(Number) }]);
    await kofi.catchUpWindow();
    await kofi.moment(line);

    // The call's state wasn't written (its version didn't move) and everyone else's view of it is as it was.
    expect(await version()).toBe(v0);
    expect(await rows()).toBe(r0);
    await host.refresh();
    expect({ ...host.getSnapshot(), elapsed: 0 }).toEqual(seen);
    // No receipt, no row, no object and no log line holds the question or the answer.
    const dump = String((await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM operations x UNION ALL SELECT row_to_json(x)::text FROM calls x UNION ALL
      SELECT row_to_json(x)::text FROM transcript_clips x UNION ALL SELECT row_to_json(x)::text FROM items x UNION ALL
      SELECT row_to_json(x)::text FROM revisions x) q`)).rows[0]?.all ?? '');
    const logs = h.logs.join('');
    for (const canary of ['CANARY-CATCHUP-QUESTION', 'CANARY-CATCHUP-LINE', 'lighthouse']) {
      for (const enc of encodings(canary)) {
        expect(dump.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
      }
    }
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const enc of encodings('CANARY-CATCHUP-QUESTION')) expect(bytes.includes(Buffer.from(enc)), `the question in ${obj.id}`).toBe(false);
    }
    // And it crossed the wire to NEAR AI sealed to the verified notes model, never readable.
    const wire = Buffer.concat(h.near.received.map((r) => r.body));
    for (const enc of encodings('CANARY-CATCHUP-QUESTION')) expect(wire.includes(Buffer.from(enc)), `the question as ${enc} on the wire`).toBe(false);
    expect(h.near.prompts.some((p) => p.includes('CANARY-CATCHUP-QUESTION'))).toBe(true);
    await host.leave();
  });
});
