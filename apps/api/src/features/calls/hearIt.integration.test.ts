/**
 * Hear it, during a call: anyone in the call hears a quoted line of its recording, but only one they may read, said while
 * they were there, and only the pieces of the recording they were there for. A guest with the link never hears what was
 * said while they were away, however their page went. After the call it's the note's audio, for people with the note. The
 * real API over HTTP via @alcove/api-http, real Postgres, the object store, the local LiveKit server and the stand-in NEAR AI.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type AudioPiece, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => h.closeCalls());

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : `not an API error: ${String(e)}`);
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean, ms = 15_000): Promise<CallState> {
  const until = Date.now() + ms;
  while (!pred(call.getSnapshot()) && Date.now() < until) { await call.refresh(); await sleep(30); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
const gone = (host: CallSession, who: CallSession) => settle(host, (x) => !x.participants.some((p) => p.id === who.ticket.identity));

/** What a WebM says it is before its first Cluster: the recording's set-up, which carries no sound. */
const SET_UP = 'WEBM-SET-UP';
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const sound = (s: number) => `SOUND-OF-PIECE-${s}|`;
/** A 5-second piece of the recording: the first starts with the set-up, then a Cluster, as MediaRecorder's first piece does. */
function piece(s: number): AudioPiece {
  const body = Buffer.from(sound(s).repeat(40));
  const bytes = s === 0 ? Buffer.concat([Buffer.from(SET_UP), Buffer.from(CLUSTER), body]) : Buffer.concat([Buffer.from(CLUSTER), body]);
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return { data: new Blob([out]), segment: 0, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
}
const speech = (words: string, atMs: number): TranscriptClip => ({ data: new Blob([speechWav(words, 4000)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: 4000, heardAt: performance.now() - 50 });
/** Something said now, at `atMs` into the recording, and its line once it's in the transcript. */
async function sayNow(host: CallSession, words: string, atMs: number): Promise<string> {
  await host.transcribe(speech(words, atMs), host.ticket.identity);
  const s = await settle(host, (x) => x.transcript.some((l) => l.text === words));
  const line = s.transcript.find((l) => l.text === words);
  if (!line) throw new Error(`“${words}” isn’t in the transcript`);
  return line.id;
}
const heard = async (call: CallSession, note: string, line: string) => {
  const got = await call.hear(note, line);
  return { ...got, text: Buffer.from(await got.audio.arrayBuffer()).toString('latin1'), type: got.audio.type };
};

async function callWithRecording(guests: string[] = []) {
  const org = await account();
  const { code: c } = await org.api.calls.startNow({ notes: 'on', guests });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  await inGroup(host);
  for (const s of [0, 1, 2, 3, 4, 5]) await host.appendAudio(piece(s));
  const note = (await settle(host, (s) => s.notes.noteId !== null)).notes.noteId ?? '';
  return { org, host, code: c, note };
}

describe('Hear it during a call', () => {
  it('plays the line’s own pieces for the organizer, with the recording’s set-up and none of its first piece’s sound', async () => {
    const { host, note } = await callWithRecording();
    const line = await sayNow(host, 'We agreed on the venue.', 12_000);
    const got = await heard(host, note, line);
    // Pieces 2 (10–15 s) of segment 0: the line starts 2 s into it, and lasts what its words did.
    expect(got.text.startsWith(SET_UP)).toBe(true);
    expect(got.text).toContain(sound(2));
    for (const other of [0, 1, 3, 4, 5]) expect(got.text).not.toContain(sound(other));
    expect(got.from).toBe(2);
    expect(got.seconds).toBeCloseTo(1.8, 1);
    expect(got.type).toContain('audio/webm');
    // A line from the start of the recording is its first piece, whole, which already says what the recording is.
    const first = await sayNow(host, 'Welcome, everyone.', 1000);
    const start = await heard(host, note, first);
    expect(start.text).toContain(sound(0));
    expect(start.text.indexOf(SET_UP)).toBe(start.text.lastIndexOf(SET_UP));
    await host.leave();
  });

  it('lets someone invited hear it, and nobody hears another note’s line or one that isn’t there', async () => {
    const email = unique('kofi');
    const { host, note } = await callWithRecording([email]);
    const kofi = await (await account(email)).api.calls.join(host.getSnapshot().code, { mic: true, cam: false });
    await inGroup(kofi);
    const line = await sayNow(host, 'Kofi takes the budget.', 15_000);
    expect((await heard(kofi, note, line)).text).toContain(sound(3));
    expect(code(await kofi.hear('AAAAAAAAAAAAAAAAAAAAAA', line).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await kofi.hear(note, 'AAAAAAAAAAAAAAAAAAAAAA').catch((e: unknown) => e))).toBe('not-found');
    // Someone in another call can't reach this one's lines by naming them.
    const other = await callWithRecording();
    expect(code(await other.host.hear(note, line).catch((e: unknown) => e))).toBe('not-found');
    await other.host.leave();
    await host.leave();
  });

  it('refuses a guest with the link a line said before they came, and lets them hear one said while they were there', async () => {
    const { host, note, code: c } = await callWithRecording();
    const before = await sayNow(host, 'We agreed on the price before Sam came.', 5000);
    const sam = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sleep(300);
    const after = await sayNow(host, 'We agreed on the date with Sam here.', 20_000);
    expect(code(await sam.hear(note, before).catch((e: unknown) => e))).toBe('not-found');
    const got = await heard(sam, note, after);
    expect(got.text).toContain(sound(4));
    expect(got.text).not.toContain(sound(1));
    // The organizer hears both.
    expect((await heard(host, note, before)).text).toContain(sound(1));
    await host.leave();
  });

  it('never lets a guest hear what was said while they were away, whether their page said goodbye or went without a word', async () => {
    const { host, note, code: c } = await callWithRecording();
    const browser = h.browser().api;
    const sam = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sleep(300);
    const here = await sayNow(host, 'Sam hears this.', 0);
    // Through to the end of the piece that line is in: a piece is heard whole or not at all.
    await sleep(5200);
    // Goes with a goodbye.
    sam.closing();
    await gone(host, sam);
    await sleep(1200);
    const away = await sayNow(host, 'We agreed on the price while Sam was away.', 10_000);
    const back = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: sam.ticket.pass });
    await inGroup(back);
    await sleep(300);
    expect(code(await back.hear(note, away).catch((e: unknown) => e))).toBe('not-found');
    expect((await heard(back, note, here)).text).toContain(sound(0));
    // Goes without a word: as far as the call knows they're still in it until they're back, and the stay ends when they were last heard from.
    back.close();
    await sleep(1200);
    const unheard = await sayNow(host, 'We agreed on the date while Sam’s page was gone.', 20_000);
    const again = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: back.ticket.pass });
    await inGroup(again);
    await sleep(300);
    expect(code(await again.hear(note, unheard).catch((e: unknown) => e))).toBe('not-found');
    // The organizer, who reads the whole call, hears all of it.
    expect((await heard(host, note, unheard)).text).toContain(sound(4));
    await host.leave();
  });

  it('has nothing to play of a call that doesn’t keep its recording, and nothing once someone has left or the call has ended', async () => {
    const org = await account();
    const m = await org.api.meetings.create({ title: 'No recording', startsAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: { ...DEFAULT_NOTES_CHOICES, keepRecording: false } });
    const host = await org.api.calls.join(m.code, { mic: true, cam: false });
    await inGroup(host);
    for (const s of [0, 1]) await host.appendAudio(piece(s));
    const note = (await settle(host, (s) => s.notes.noteId !== null)).notes.noteId ?? '';
    const line = await sayNow(host, 'Nobody keeps this.', 1000);
    expect(code(await host.hear(note, line).catch((e: unknown) => e))).toBe('not-found');

    const kept = await callWithRecording();
    const said = await sayNow(kept.host, 'Said once.', 1000);
    const sam = await h.browser().api.calls.join(kept.code, { mic: true, cam: false, name: 'Sam' });
    await letIn(kept.host, sam);
    sam.closing();
    await gone(kept.host, sam);
    expect(code(await sam.hear(kept.note, said).catch((e: unknown) => e))).not.toBe('allowed');
    await kept.host.leave();
    expect(code(await kept.host.hear(kept.note, said).catch((e: unknown) => e))).not.toBe('allowed');
    await host.leave();
  });

  it('logs no words and no audio', async () => {
    const { host, note } = await callWithRecording();
    const line = await sayNow(host, 'CANARY-HEARD words.', 5000);
    await heard(host, note, line);
    const logs = h.logs.join('');
    expect(logs).toContain('a line heard');
    for (const secret of ['CANARY-HEARD', SET_UP, 'SOUND-OF-PIECE', host.ticket.pass]) expect(logs.includes(secret), secret).toBe(false);
    await host.leave();
  });
});
