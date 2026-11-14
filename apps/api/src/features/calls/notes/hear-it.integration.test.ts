/**
 * Hear it, during a call: anyone in the call hears a quoted line of its recording, but only one they may read, said while
 * they were there, and only the pieces of the recording they were there for. A guest with the link never hears what was
 * said while they were away, however their page went. What's sent is a file of its own that starts at 0, so a line from
 * minutes in plays its own words wherever the browser counts a file from, and that keeps the end of its last piece, which
 * the next piece starts with. A line whose piece hasn't come is "not yet" only while it still can come. After the call it's
 * the note's audio, for people with the note. The real API over HTTP via @alcove/api-http, real Postgres, the object store,
 * the local LiveKit server and the stand-in NEAR AI.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type AudioPiece, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from '../../../testing/fakes/near';
import { startHarness, type Harness } from '../../../testing/harness';
import { disposeLiveKit } from '../../../testing/livekit';

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

/* ---------- a real recording ---------- */

/**
 * Four pieces Chrome 157's MediaRecorder made with the notes recorder's settings (WebM with Opus, 32 kbit/s, a piece every
 * 5 seconds) of a tone that changes pitch every half second, so what plays says when it was recorded. As Chrome cuts them,
 * each piece after the first starts with the end of the piece before it, and its own Cluster 1,967 bytes in; and each
 * Cluster keeps its time from the start of the recording.
 */
const WEBM = 'audio/webm;codecs=opus';
const TONE = [{ atMs: 0, durationMs: 5061 }, { atMs: 5061, durationMs: 5060 }, { atMs: 10_121, durationMs: 5040 }, { atMs: 15_161, durationMs: 5040 }]
  .map((p, s) => ({ ...p, bytes: new Uint8Array(readFileSync(new URL(`./hear-it-recording/piece-${s}.webm`, import.meta.url))) }));
const toneOf = (s: number) => {
  const t = TONE[s];
  if (!t) throw new Error(`The recording has no piece ${s}.`);
  return t;
};
/** The tone's pitch in the half second `ms` into the recording falls in: 300 + 40·(i mod 24) Hz for the i-th. */
const pitchAt = (ms: number) => 300 + 40 * (Math.floor(ms / 500) % 24);
function audioPiece(bytes: Uint8Array, s: number, atMs: number, durationMs: number, mimeType: string): AudioPiece {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return { data: new Blob([out]), segment: 0, seq: s, at: atMs / 1000, durationMs, mimeType };
}
const piece = (s: number): AudioPiece => { const t = toneOf(s); return audioPiece(t.bytes, s, t.atMs, t.durationMs, WEBM); };

/* ---------- reading what's sent: EBML, as a WebM is laid out ---------- */

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const TIMESTAMP = 0xe7;
const SIMPLE_BLOCK = 0xa3;
function vint(b: Uint8Array, i: number, id: boolean): { value: number; length: number; unknown: boolean } | null {
  const first = b[i];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (i + length > b.length) return null;
  let value = id ? first : first & (0xff >> length);
  let ones = (first & (0xff >> length)) === 0xff >> length;
  for (let k = 1; k < length; k++) { value = value * 256 + (b[i + k] ?? 0); if (b[i + k] !== 0xff) ones = false; }
  return { value, length, unknown: !id && ones };
}
interface Element { id: number; at: number; data: Uint8Array }
/** Every element, as laid out: a Segment's and a Cluster's children follow them. `whole` if it ends on the end of one. */
function elements(b: Uint8Array): { all: Element[]; whole: boolean } {
  const all: Element[] = [];
  let i = 0;
  while (i < b.length) {
    const id = vint(b, i, true);
    const size = id ? vint(b, i + id.length, false) : null;
    if (!id || !size) return { all, whole: false };
    const dataAt = i + id.length + size.length;
    const container = id.value === SEGMENT || id.value === CLUSTER;
    if (!container && (size.unknown || dataAt + size.value > b.length)) return { all, whole: false };
    all.push({ id: id.value, at: i, data: b.subarray(dataAt, container ? dataAt : dataAt + size.value) });
    i = container ? dataAt : dataAt + size.value;
  }
  return { all, whole: true };
}
const uint = (d: Uint8Array) => d.reduce((n, x) => n * 256 + x, 0);
/** Each Cluster's Timestamp, in ms. */
const clusterTimes = (b: Uint8Array) => elements(b).all.filter((e) => e.id === TIMESTAMP).map((e) => uint(e.data));
/** The sound: every whole block, as it was recorded. */
const blocks = (b: Uint8Array) => elements(b).all.filter((e) => e.id === SIMPLE_BLOCK).map((e) => Buffer.from(e.data).toString('hex'));
const cat = (...xs: Uint8Array[]) => new Uint8Array(Buffer.concat(xs));
/** What the recording says it is, before its first Cluster: the first piece's first 146 bytes. */
const setUp = () => toneOf(0).bytes.subarray(0, 146);
/** A piece from its own first Cluster, without the end of the piece before it. */
const ownSound = (s: number) => toneOf(s).bytes.subarray(s === 0 ? 0 : 1967);
/** What a piece starts with, before its own first Cluster: the end of the piece before's last block and Cluster. */
const leadOf = (s: number) => toneOf(s).bytes.subarray(0, 1967);

/* ---------- reading what's sent: what a decoder plays ---------- */

const FFMPEG: unknown = process.env['FFMPEG_PATH'] || createRequire(import.meta.url)('ffmpeg-static');
/** The audio decoded from 0, as 16 kHz mono samples, by the ffmpeg the API runs for shared screens. */
async function decode(bytes: Uint8Array): Promise<Float32Array> {
  if (typeof FFMPEG !== 'string') throw new Error('No ffmpeg on this platform.');
  const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
  const out: Buffer[] = [];
  p.stdout.on('data', (c: Buffer) => out.push(c));
  const exit = new Promise<number | null>((r) => p.on('close', r));
  p.stdin.end(Buffer.from(bytes));
  expect(await exit).toBe(0);
  const all = Buffer.concat(out);
  return Float32Array.from({ length: Math.floor(all.length / 4) }, (_, i) => all.readFloatLE(i * 4));
}
/** Which of the tone's pitches is loudest in the 150 ms from `seconds` in. */
function pitchIn(samples: Float32Array, seconds: number): number {
  const x = samples.subarray(Math.round(seconds * 16_000), Math.round((seconds + 0.15) * 16_000));
  const power = (hz: number) => {
    const c = 2 * Math.cos((2 * Math.PI * hz) / 16_000);
    let s1 = 0, s2 = 0;
    for (const v of x) { const s = v + c * s1 - s2; s2 = s1; s1 = s; }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  return Array.from({ length: 24 }, (_, i) => 300 + 40 * i).reduce((a, b) => (power(b) > power(a) ? b : a));
}

/* ---------- a call that's recording ---------- */

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
  return { ...got, bytes: new Uint8Array(await got.audio.arrayBuffer()), type: got.audio.type };
};
/** Whether `got` has the sound of piece `s` of the recording: its own blocks, all of them. */
const hasPiece = (got: Uint8Array, s: number) => {
  const all = new Set(blocks(got));
  return blocks(cat(setUp(), ownSound(s))).every((b) => all.has(b));
};

async function callWithRecording(guests: string[] = [], count = TONE.length) {
  const org = await account();
  const { code: c } = await org.api.calls.startNow({ notes: 'on', guests });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  await inGroup(host);
  for (let s = 0; s < count; s++) await host.appendAudio(piece(s));
  const note = (await settle(host, (s) => s.notes.noteId !== null)).notes.noteId ?? '';
  return { org, host, code: c, note };
}

describe('Hear it during a call', () => {
  it('plays a line from minutes in from its own piece, as a file that opens on its first Cluster at 0 with the recording’s set-up', async () => {
    const { host, note } = await callWithRecording();
    // 1.679 s into the third piece, which starts 10.121 s in.
    const line = await sayNow(host, 'We agreed on the venue.', 11_800);
    const got = await heard(host, note, line);
    expect(got.from).toBeCloseTo(1.679, 3);
    expect(got.seconds).toBeCloseTo(1.8, 1);
    expect(got.type).toContain('audio/webm');
    // What the recording is, then the piece's own first Cluster, counted from 0: nothing of the end of the piece before it.
    expect(Buffer.from(got.bytes.subarray(0, 146)).equals(Buffer.from(setUp()))).toBe(true);
    const { all, whole } = elements(got.bytes);
    expect(all.find((e) => e.id === CLUSTER)?.at).toBe(146);
    expect(clusterTimes(got.bytes)).toEqual([0]);
    expect(whole).toBe(true);
    // Its sound is that piece's own, all of it there is, its end from the next piece's first bytes, and nothing of any other.
    expect(blocks(got.bytes)).toEqual(blocks(cat(setUp(), ownSound(2), leadOf(3))));
    for (const other of [0, 1, 3]) expect(hasPiece(got.bytes, other)).toBe(false);
    // Played from where the line is in it, it's the tone that was recorded as the line was said.
    expect(pitchIn(await decode(got.bytes), got.from)).toBe(pitchAt(11_800));

    // A line that runs into the next piece: both, their Clusters' times still apart by what they were. The second is the
    // recording's last piece so far, so there's nothing after it to finish its last block with.
    const longer = await sayNow(host, 'And the date, after that.', 14_800);
    const both = await heard(host, note, longer);
    expect(clusterTimes(both.bytes)).toEqual([0, 5040]);
    expect(elements(both.bytes).whole).toBe(true);
    expect(blocks(both.bytes)).toEqual(blocks(cat(setUp(), ownSound(2), toneOf(3).bytes)));
    expect(pitchIn(await decode(both.bytes), both.from)).toBe(pitchAt(14_800));

    // A line from the start of the recording is its first piece, whole, which already says what the recording is.
    const first = await sayNow(host, 'Welcome, everyone.', 1200);
    const start = await heard(host, note, first);
    expect(start.from).toBeCloseTo(1.2, 3);
    expect(elements(start.bytes).all.filter((e) => e.id === EBML_HEADER)).toHaveLength(1);
    expect(clusterTimes(start.bytes)).toEqual([0]);
    expect(elements(start.bytes).whole).toBe(true);
    expect(blocks(start.bytes)).toEqual(blocks(cat(toneOf(0).bytes, leadOf(1))));
    expect(pitchIn(await decode(start.bytes), start.from)).toBe(pitchAt(1200));
    await host.leave();
  });

  it('keeps the end of a line said in its piece’s last half second, which Chrome put at the start of the next piece', async () => {
    const { host, note } = await callWithRecording();
    // From 3 s to 4.8 s into the first piece: Chrome put that piece's sound from 4.56 s on before the next piece's own Cluster.
    const line = await sayNow(host, 'Said at the end of the first piece.', 3000);
    const got = await heard(host, note, line);
    expect(got.from).toBeCloseTo(3, 3);
    expect(got.seconds).toBeCloseTo(1.8, 1);
    // The first piece's own sound, then the rest of its last block and Cluster from the next piece, and nothing of that one's own.
    expect(blocks(got.bytes)).toEqual(blocks(cat(toneOf(0).bytes, leadOf(1))));
    expect(blocks(got.bytes).length).toBeGreaterThan(blocks(toneOf(0).bytes).length);
    expect(clusterTimes(got.bytes)).toEqual([0]);
    expect(elements(got.bytes).whole).toBe(true);
    expect(hasPiece(got.bytes, 1)).toBe(false);
    // Played, the line's last moments are the tone recorded then, not the silence after a clip cut short.
    expect(pitchIn(await decode(got.bytes), 4.7)).toBe(pitchAt(4700));
    await host.leave();
  });

  it('says a line isn’t in the recording yet until its piece arrives, then plays it', async () => {
    const { host, note } = await callWithRecording([], 2);
    const line = await sayNow(host, 'Said before its piece went up.', 11_800);
    expect(code(await host.hear(note, line).catch((e: unknown) => e))).toBe('conflict');
    await host.appendAudio(piece(2));
    const got = await heard(host, note, line);
    expect(hasPiece(got.bytes, 2)).toBe(true);
    expect(clusterTimes(got.bytes)).toEqual([0]);
    await host.leave();
  });

  it('stops saying a line isn’t in the recording yet once its piece can’t come any more, and says it can’t be played', async () => {
    const { host, note } = await callWithRecording([], 2);
    const earlier = await sayNow(host, 'Said while it all went up.', 6000);
    const line = await sayNow(host, 'Said just before notes were paused.', 11_800);
    // Notes on, in the segment the line was said in: its piece may still be on its way.
    expect(code(await host.hear(note, line).catch((e: unknown) => e))).toBe('conflict');
    // Paused, nothing more of that segment is taken, so the piece that didn't come never will.
    await host.pause();
    expect(code(await host.hear(note, line).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await host.appendAudio(piece(2)).catch((e: unknown) => e))).toBe('conflict');
    // Nor once notes are on again, in a segment of their own.
    await host.resume();
    expect(code(await host.hear(note, line).catch((e: unknown) => e))).toBe('not-found');
    // What did go up still plays.
    expect(hasPiece((await heard(host, note, earlier)).bytes, 1)).toBe(true);
    await host.leave();
  });

  it('plays a stretch of an MP4 recording from its own first fragment, its decode times from 0', async () => {
    // As Safari records: a fragmented MP4, a movie fragment for each piece, with its decode time from the start.
    const box = (type: string, ...body: Uint8Array[]) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(8 + body.reduce((n, x) => n + x.length, 0));
      head.write(type, 4, 'latin1');
      return cat(head, ...body);
    };
    const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
    const full = (type: string, version: number, flags: number, ...body: Uint8Array[]) => box(type, u32(version * 0x1000000 + flags), ...body);
    const fragment = (n: number, decodeTime: number) => cat(
      box('moof', full('mfhd', 0, 0, u32(n)), box('traf', full('tfhd', 0, 0x020000, u32(1)), full('tfdt', 1, 0, u64(decodeTime)))),
      box('mdat', Buffer.from(`SOUND-OF-FRAGMENT-${n}|`.repeat(40)))
    );
    const head = cat(box('ftyp', Buffer.from('iso6'), u32(0)), box('moov', box('mvex', full('trex', 0, 0, u32(1)))));
    const pieces = [cat(head, fragment(1, 0)), fragment(2, 5 * 48_000), fragment(3, 10 * 48_000)];
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    for (const [s, bytes] of pieces.entries()) await host.appendAudio(audioPiece(bytes, s, s * 5000, 5000, 'audio/mp4'));
    const note = (await settle(host, (s) => s.notes.noteId !== null)).notes.noteId ?? '';
    const got = await heard(host, note, await sayNow(host, 'From the third fragment.', 11_000));
    expect(got.from).toBe(1);
    expect(got.type).toContain('audio/mp4');
    const text = Buffer.from(got.bytes).toString('latin1');
    expect(text.startsWith(Buffer.from(head).toString('latin1'))).toBe(true);
    expect(text).toContain('SOUND-OF-FRAGMENT-3');
    for (const other of [1, 2]) expect(text).not.toContain(`SOUND-OF-FRAGMENT-${other}`);
    const tfdt = text.indexOf('tfdt');
    expect(tfdt).toBeGreaterThan(head.length);
    expect(Buffer.from(got.bytes).readBigUInt64BE(tfdt + 8)).toBe(0n);
    await host.leave();
  });

  it('lets someone invited hear it, and nobody hears another note’s line or one that isn’t there', async () => {
    const email = unique('kofi');
    const { host, note } = await callWithRecording([email]);
    const kofi = await (await account(email)).api.calls.join(host.getSnapshot().code, { mic: true, cam: false });
    await inGroup(kofi);
    const line = await sayNow(host, 'Kofi takes the budget.', 15_200);
    expect(hasPiece((await heard(kofi, note, line)).bytes, 3)).toBe(true);
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
    const before = await sayNow(host, 'We agreed on the price before Sam came.', 5100);
    const sam = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sleep(300);
    const after = await sayNow(host, 'We agreed on the date with Sam here.', 15_200);
    expect(code(await sam.hear(note, before).catch((e: unknown) => e))).toBe('not-found');
    const got = await heard(sam, note, after);
    expect(hasPiece(got.bytes, 3)).toBe(true);
    expect(hasPiece(got.bytes, 1)).toBe(false);
    // The organizer hears both.
    expect(hasPiece((await heard(host, note, before)).bytes, 1)).toBe(true);
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
    const away = await sayNow(host, 'We agreed on the price while Sam was away.', 10_200);
    const back = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: sam.ticket.pass });
    await inGroup(back);
    await sleep(300);
    expect(code(await back.hear(note, away).catch((e: unknown) => e))).toBe('not-found');
    expect(hasPiece((await heard(back, note, here)).bytes, 0)).toBe(true);
    // Goes without a word: as far as the call knows they're still in it until they're back, and the stay ends when they were last heard from.
    back.close();
    await sleep(1200);
    const unheard = await sayNow(host, 'We agreed on the date while Sam’s page was gone.', 15_200);
    const again = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: back.ticket.pass });
    await inGroup(again);
    await sleep(300);
    expect(code(await again.hear(note, unheard).catch((e: unknown) => e))).toBe('not-found');
    // The organizer, who reads the whole call, hears all of it.
    expect(hasPiece((await heard(host, note, unheard)).bytes, 3)).toBe(true);
    await host.leave();
  });

  it('has nothing to play of a call that doesn’t keep its recording, and nothing once someone has left or the call has ended', async () => {
    const org = await account();
    const m = await org.api.meetings.create({ title: 'No recording', startsAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: { ...DEFAULT_NOTES_CHOICES, keepRecording: false } });
    const host = await org.api.calls.join(m.code, { mic: true, cam: false });
    await inGroup(host);
    for (const s of [0, 1]) await host.appendAudio(piece(s));
    const state = await settle(host, (s) => s.notes.noteId !== null);
    // The call says so, so nobody is offered Hear it.
    expect(state.notes.keepsRecording).toBe(false);
    const note = state.notes.noteId ?? '';
    const line = await sayNow(host, 'Nobody keeps this.', 1000);
    expect(code(await host.hear(note, line).catch((e: unknown) => e))).toBe('not-found');

    const kept = await callWithRecording();
    expect(kept.host.getSnapshot().notes.keepsRecording).toBe(true);
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
    const line = await sayNow(host, 'CANARY-HEARD words.', 5100);
    await heard(host, note, line);
    const logs = h.logs.join('');
    expect(logs).toContain('a line heard');
    const sound = Buffer.from(ownSound(1).subarray(200, 248));
    for (const secret of ['CANARY-HEARD', sound.toString('hex'), sound.toString('base64'), host.ticket.pass]) expect(logs.includes(secret), secret).toBe(false);
    await host.leave();
  });
});
