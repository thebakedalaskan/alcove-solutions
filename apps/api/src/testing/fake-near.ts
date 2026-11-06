/*
 * A stand-in for NEAR AI Cloud, for integration tests, with the evidence it takes to trust it. On one
 * server, under different paths:
 *
 *  - NEAR AI's gateway (/v1): attestation reports for the gateway and each model, as dstack reports with
 *    TDX quotes of the dstack images NEAR AI runs and GPU evidence; and plain speech-to-text and chat,
 *    which real NEAR AI also takes and Alcove must never use.
 *  - Each model's own endpoint (/direct/whisper, /direct/glm): Oblivious HTTP to the model's attested key.
 *  - Intel's certification service (/intel) and NVIDIA's attestation service (/nvidia), under test roots
 *    (fake-tee.ts), so the API checks the evidence with the code it checks NEAR AI's real evidence with.
 *
 * Speech is "recognised" from a marker a test writes into the WAV samples (see `speechWav`), so a test
 * decides exactly what was said and in which language; a clip without one is heard the way Whisper hears
 * silence. Each transcription's language and prompt are kept, so tests can see what a clip was sent with. A
 * shared screen is "read" the same way, from a marker in its JPEG's comment segment (see `screenJpeg`); a frame
 * without one can't be made out. The notes model writes from the transcript it was sent, screens included, so
 * tests can see the transcript arrived intact and the reply was checked before use; asked across notes, it
 * answers from the lines of each note it was sent and cites them by note, plus a note it wasn't sent, as a model
 * can make one up; and asked to compare a call with earlier ones in its series, it reads "instead" in a decision and
 * "Answer:" at the start of a line, with labels and moments that aren't there among them, as a model can make them up.
 * Every request body is kept as it arrived, so tests can show that nothing readable crossed the
 * wire; each request with content records the attested key it was sealed to; and the evidence can be made to lie,
 * so tests can show what Alcove refuses.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha256, sha384 } from '@noble/hashes/sha2.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DSTACK_IMAGES, type DstackImage } from '../dstack-images';
import { fakeIntel, fakeNvidia, type Answer, type FakeIntel, type FakeNvidia } from './fake-tee';

const STT_MODEL = 'openai/whisper-large-v3';
const NOTES_MODEL = 'z-ai/glm-5.3-flash';

/**
 * What the evidence (or the models' endpoints) can be made to get wrong. On the gateway's report or a
 * model's: a tampered quote, a replayed nonce, a substituted key, an unmeasured compose, an event log that
 * doesn't replay, another OS or machine. On a model's only: an unsigned OHTTP key, GPU evidence or a verdict
 * for another nonce, a failed GPU verdict, another model's report, a tampered report ahead of an honest one.
 * Intel's side: collateral that's stale, a platform out of date, a quote that names no platform, unreachable. NVIDIA: a verdict signed under another root,
 * through an expired or non-CA intermediate, or unreachable. The models' endpoints: refusing what was sealed
 * to the key they vouched for, or sealing their replies wrong.
 */
export type Tamper =
  | 'quote' | 'nonce' | 'key' | 'compose' | 'rtmr3' | 'os-image'
  | 'ohttp-key' | 'gpu-nonce' | 'verdict-nonce' | 'gpu' | 'model-mismatch' | 'extra-candidate'
  | 'expired' | 'tcb' | 'pcs-down' | 'unnamed-platform'
  | 'nvidia-root' | 'nvidia-expired' | 'nvidia-not-ca' | 'nras-down' | 'jwks-down'
  | 'report-down' | 'refuse' | 'reply-sealed';
export type Task = 'transcript' | 'notes';
/** How a reply can fail: the service down, prose instead of JSON, empty notes, or a reply that ran out of tokens part way. */
export type Failure = 'down' | 'prose' | 'stub' | 'cut-off' | 'empty' | 'partial' | 'lines';

export interface FakeNear {
  /** What the API is configured with to use this NEAR AI, and the stand-in Intel and NVIDIA that vouch for it. */
  settings: {
    NEAR_AI_BASE_URL: string; NEAR_AI_API_KEY: string; NEAR_AI_STT_URL: string; NEAR_AI_NOTES_URL: string;
    INTEL_PCS_URL: string; INTEL_ROOT_CA: string; NVIDIA_NRAS_URL: string; NVIDIA_ROOT_CA: string;
  };
  /**
   * Every request with content, oldest first: which endpoint, which model, how many bytes, how it was
   * protected, and, when it was sealed, the attested signing key (hex) of the model whose OHTTP key opened it.
   */
  calls: { path: string; model: string; bytes: number; encryption: 'ohttp' | 'none'; key: string | null }[];
  /** Every request body exactly as it arrived, before anything was opened. */
  received: { path: string; body: Buffer }[];
  /** What the notes model was sent (the user message's text, once opened), oldest first. */
  prompts: string[];
  /** The system messages the notes model was sent, in the same order as `prompts`. */
  instructions: string[];
  /** Every image the notes model was sent, once opened: its size, what a test put on it (null for nothing legible) and the salt that tells it apart. */
  images: { bytes: number; marker: string | null; salt: string }[];
  /** What each clip was transcribed with besides its audio, once opened, oldest first: the language it named and its prompt, or null. */
  transcriptions: { language: string | null; prompt: string | null }[];
  /** The models' attested signing keys right now, hex. */
  keys(): Record<Task, string>;
  /** The hashes of the configurations the quotes measure. */
  composes(): Record<Task | 'gateway', string>;
  /** Makes the evidence, or the models' endpoints, lie; null makes them honest again. */
  tamper(how: Tamper | null, of?: 'model' | 'gateway'): void;
  /** A model gets a new signing key and OHTTP key; the old ones stop being accepted. */
  rotate(task: Task): void;
  /** How long NVIDIA's verdicts hold, in seconds. */
  verdictLifetime(seconds: number): void;
  /**
   * The next `n` chat replies fail: the service is down, the model answers in prose instead of JSON, with the shape and
   * nothing in it, with an empty object, with an object that has a summary and nothing else that's any use, with every
   * point's lines in the wrong shape, or runs out of tokens part way. With `only`, just the requests with that in their
   * prompt fail, and count: one part of a note goes wrong while the rest is written.
   */
  failNext(n: number, how: Failure, only?: string | undefined): void;
  /** The next chat reply takes this long, as a busy model does. */
  slowNext(ms: number, only?: string | undefined): void;
  /** The next request to the notes model waits for this before it's answered, as if something happened while the model wrote. */
  holdNext(then: () => Promise<void>): void;
  /**
   * From now on the notes model writes the follow-up it hears in `line` as `text`, in catch-ups and in the notes, as a
   * model words a thing afresh each time; '' and it no longer lists it; null and it goes back to the words it hears.
   */
  reword(line: string, text: string | null): void;
  /**
   * What the notes model says the follow-up it hears in `line` is, from now on, when it's told the follow-ups so far or
   * what was ticked. By default it knows its own, however it worded them. 'new' leaves the label out, as for something it
   * doesn't recognise; 'invented' gives one it wasn't told; any other text is a line, and it gives the label of that
   * line's follow-up, so one can take another's, or two can claim one. null goes back to knowing its own.
   */
  identify(line: string, as: string | null): void;
  close(): Promise<void>;
}

/**
 * A clip of "speech" for the fake: 16 kHz mono 16-bit WAV of `ms` milliseconds whose samples carry
 * the words, said in `language`. Sentences separated by " // " come back as separate lines, two seconds apart, and
 * one written with a leading "~" comes back heard with little confidence, as Whisper hears a mumble or a noisy line.
 * Not `sure`: heard with less confidence, as Whisper hears accented speech it takes for another language.
 */
export function speechWav(words: string, ms = 4000, language = 'en', sure = true): Uint8Array<ArrayBuffer> {
  const samples = Math.max(1, Math.round((ms / 1000) * 16_000));
  const marker = Buffer.from(words ? `TEXT:${words}|LANG:${language}|${sure ? '' : 'UNSURE|'}` : '', 'utf8');
  const data = Buffer.alloc(Math.max(samples * 2, marker.length + (marker.length % 2)));
  marker.copy(data);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii'); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16_000, 24); head.writeUInt32LE(32_000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40);
  const out = new Uint8Array(new ArrayBuffer(44 + data.length));
  out.set(head); out.set(data, 44);
  return out;
}

/** What a test puts on a shared screen: its title, the lines on it, how legible it is, and the parts worth pointing at ([left, top, right, bottom]). */
export interface ScreenShown { title: string; lines: string[]; legible?: 'clear' | 'partly' | 'unreadable'; regions?: { label: string; box: [number, number, number, number] }[] }
/**
 * A frame of a shared screen for the fake: a JPEG's header (start, a comment carrying what's on the screen, the frame
 * header with its size, end), which is all the server reads of one. Without `shown`, nothing on it can be made out.
 */
export function screenJpeg(shown: ScreenShown | null, width = 1280, height = 720, salt = ''): Uint8Array<ArrayBuffer> {
  const seg = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  const comment = seg(0xfe, Buffer.from(`${shown ? `SCREEN:${JSON.stringify(shown)}` : 'NOISE'}|${salt}`, 'utf8'));
  const sof = seg(0xc0, Buffer.from([8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  const all = Buffer.concat([Buffer.from([0xff, 0xd8]), comment, sof, Buffer.from([0xff, 0xd9])]);
  const out = new Uint8Array(new ArrayBuffer(all.length));
  out.set(all);
  return out;
}
/** A JPEG's comment segment, as text. */
function commentOf(jpeg: Buffer): string {
  for (let i = 2; i + 4 <= jpeg.length && jpeg[i] === 0xff;) {
    const length = jpeg.readUInt16BE(i + 2);
    if (jpeg[i + 1] === 0xfe) return jpeg.subarray(i + 4, i + 2 + length).toString('utf8');
    i += 2 + length;
  }
  return '';
}
/** What's on a frame, from its comment, or null when nothing can be made out. */
function shownIn(jpeg: Buffer): ScreenShown | null {
  const m = /^SCREEN:(\{.*\})\|/s.exec(commentOf(jpeg));
  if (!m) return null;
  const v: unknown = JSON.parse(m[1] ?? '{}');
  if (typeof v !== 'object' || v === null || !('title' in v) || !('lines' in v)) return null;
  const lines = Array.isArray(v.lines) ? v.lines.map((l: unknown) => str(l)) : [];
  const legible = 'legible' in v && (v.legible === 'partly' || v.legible === 'unreadable') ? v.legible : 'clear';
  const regions = 'regions' in v && Array.isArray(v.regions) ? v.regions.flatMap((r: unknown) => {
    if (typeof r !== 'object' || r === null || !('label' in r) || !('box' in r) || !Array.isArray(r.box)) return [];
    const [a = 0, b = 0, c = 0, d = 0] = r.box.map((x: unknown) => (typeof x === 'number' ? x : 0));
    return [{ label: str(r.label), box: [a, b, c, d] satisfies [number, number, number, number] }];
  }) : [];
  return { title: str(v.title), lines, legible, regions };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const utf8 = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => Buffer.concat(parts);
const i2osp = (n: number, w: number) => { const b = Buffer.alloc(w); b.writeUIntBE(n, 0, w); return b; };
function reply(res: ServerResponse, status: number, body: string | Uint8Array, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}
const send = (res: ServerResponse, status: number, body: unknown) => reply(res, status, JSON.stringify(body));
const answer = (res: ServerResponse, a: Answer) => { res.writeHead(a.status, a.headers); res.end(a.body); };
async function raw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks);
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/* ---------- what the models "hear" and write ---------- */

/** The words in a clip's samples and the language they're said in, or null when it's "silence". */
function speechIn(wav: Buffer): { words: string; language: string; sure: boolean } | null {
  const m = /TEXT:([^|]*)\|LANG:([^|]*)\|(UNSURE\|)?/.exec(wav.subarray(44).toString('utf8'));
  return m ? { words: m[1] ?? '', language: m[2] ?? 'en', sure: !m[3] } : null;
}

/** Whisper's answer to a multipart transcription request. */
async function transcription(contentType: string, body: Uint8Array, calls: FakeNear['calls'], heard: FakeNear['transcriptions'], path: string, encryption: 'ohttp' | 'none', key: string | null): Promise<{ status: number; body: unknown }> {
  const form = await new Request('http://fake', { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(body) }).formData();
  const file = form.get('file');
  const model = str(form.get('model'));
  if (!(file instanceof Blob) || !model) return { status: 400, body: { error: { message: 'file and model are required' } } };
  const wav = Buffer.from(await file.arrayBuffer());
  calls.push({ path, model, bytes: wav.length, encryption, key });
  const asked = { language: str(form.get('language')) || null, prompt: str(form.get('prompt')) || null };
  heard.push(asked);
  if (wav.subarray(0, 4).toString('ascii') !== 'RIFF') return { status: 400, body: { error: { message: 'Unsupported audio format' } } };
  // Like NEAR AI's Whisper, only Whisper's language codes name a language ("english" doesn't).
  if (asked.language && !/^[a-z]{2,3}$/.test(asked.language)) return { status: 400, body: { error: { message: `Unsupported language: ${asked.language}` } } };
  const seconds = Math.max(0, wav.length - 44) / 32_000;
  const speech = speechIn(wav);
  // Silence: Whisper's favourite hallucination, with high confidence, as the real one does.
  const said = speech === null ? [{ text: ' Thank you.', unclear: false }] : speech.words.split(' // ').map((w) => ({ text: ` ${w.replace(/^~/, '')}`, unclear: w.startsWith('~') }));
  const segments = said.map((x, i) => ({
    id: i, seek: 0, start: i * 2, end: Math.min(seconds, i * 2 + 1.8), text: x.text, tokens: [], temperature: 0,
    avg_logprob: x.unclear ? -0.8 : speech?.sure === false ? -0.45 : -0.2, compression_ratio: 1.1, no_speech_prob: null
  }));
  // The language it was told, or the one it hears.
  return { status: 200, body: { text: said.map((x) => x.text).join(''), duration: String(seconds), language: asked.language ?? speech?.language ?? 'en', segments, id: `trans-${randomUUID()}` } };
}

interface Shown { n: number; at: number; title: string; parts: number }
/**
 * A line of what was said, the shared screen up when it was (the last one above it in the transcript), and its number
 * when the lines are numbered ("L12 [mm:ss] …"; 0 when they aren't).
 */
interface Heard { at: number; who: string; text: string; screen: Shown | undefined; ref: number }
/** Reads back the "[mm:ss] [screen N from Name, legible] Title. Reads: … Parts: (1) …" lines, in order. */
function screensIn(prompt: string): Shown[] {
  return prompt.split('\n').flatMap((l) => {
    const m = /^\[(\d+):(\d\d)\] \[screen (\d+)[^\]]*\] (.*?)\.(?: Reads:| Parts:|$)/.exec(l);
    return m ? [{ at: Number(m[1]) * 60 + Number(m[2]), n: Number(m[3]), title: m[4] ?? '', parts: (l.match(/ \(\d+\) /g) ?? []).length }] : [];
  });
}
/** Reads back "[mm:ss] Name: words" lines from a prompt, numbered or not, each with the screen above it, as a reader takes them in. */
function heardIn(prompt: string): Heard[] {
  let screen: Shown | undefined;
  return prompt.split('\n').flatMap((l) => {
    const shown = screensIn(l)[0];
    if (shown) { screen = shown; return []; }
    const m = /^(?:L(\d+) )?\[(\d+):(\d\d)\] (?:([^:]+): )?(.*)$/.exec(l);
    return m ? [{ ref: Number(m[1] ?? 0), at: Number(m[2]) * 60 + Number(m[3]), who: m[4] ?? '', text: m[5] ?? '', screen }] : [];
  });
}
/** What was said about something shown points at the screen up then: plainly ("this chart", "the slide"), or maybe ("that"). */
const POINTS = /\b(this|that|chart|slide|screen)\b/i;
const PLAINLY = /\b(this|chart|slide)\b/i;

/** Reads back the "[Note n]" sections of a question across notes, each with the "[mm:ss]" transcript lines under it. */
function notesIn(prompt: string): { n: number; heard: Heard[] }[] {
  const notes: { n: number; heard: Heard[] }[] = [];
  for (const l of prompt.split('\n')) {
    const head = /^\[Note (\d+)\]$/.exec(l);
    if (head) notes.push({ n: Number(head[1]), heard: [] });
    else notes.at(-1)?.heard.push(...heardIn(l));
  }
  return notes;
}
/** The words of a question worth looking for in what was said. */
const wordsAsked = (user: string) => (/\nQuestion: (.*)$/s.exec(user)?.[1] ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);

/** What the notes model writes for a system prompt, a user message and the images sent with it. */
/** What's listed in a prompt with a label, as "F2 (Kofi) Send the deck". */
const labelledIn = (prompt: string, letter: string): { label: string; text: string }[] => prompt.split('\n').flatMap((l) => {
  const m = new RegExp(`^(${letter}\\d+) (?:\\([^)]*\\) )?(.*)$`).exec(l);
  return m ? [{ label: m[1] ?? '', text: m[2] ?? '' }] : [];
});

/** What the stand-in remembers between requests: how to word what it hears, every way it has worded it, and what it's been told to say each one is. */
interface Memory { reworded: Map<string, string>; worded: Map<string, Set<string>>; identified: Map<string, string> }

function notesReply(system: string, user: string, images: Buffer[], memory: Memory): unknown {
  const { reworded, worded, identified } = memory;
  /** How it words what it hears, remembered, as a model reads its own words back. */
  const remembered = (line: string, text: string) => { if (text) worded.set(line, (worded.get(line) ?? new Set()).add(text)); return text; };
  /** The label of the follow-up it hears in `line`, among those it was told: its own, unless it's been told to say otherwise. */
  const which = (line: string, listed: { label: string; text: string }[], letter: string): string | null => {
    const how = identified.get(line);
    if (how === 'new') return null;
    if (how === 'invented') return `${letter}99`;
    const of = how ?? line;
    return listed.find((k) => k.text === of || worded.get(of)?.has(k.text))?.label ?? null;
  };
  if (system.startsWith('You read one frame')) {
    // Reads what a test wrote on the frame, exactly; a frame without it can't be made out.
    const shown = images[0] ? shownIn(images[0]) : null;
    if (!shown) return { title: '', text: '', legible: 'unreadable', regions: [] };
    return { title: shown.title, text: shown.lines.join('\n'), legible: shown.legible ?? 'clear', regions: shown.regions ?? [] };
  }
  const heard = heardIn(user);
  const screens = screensIn(user);
  /** The screen up when a line was said, if the line is about something shown. */
  const shownAt = (h: Heard) => (POINTS.test(h.text) ? h.screen : undefined);
  const onScreen = (h: Heard) => { const x = shownAt(h); return x ? { screen: x.n, part: x.parts ? 1 : null, sure: PLAINLY.test(h.text) } : { screen: null, part: null, sure: false }; };
  const item = (h: Heard) => ({ text: h.text, at: h.at, ...onScreen(h) });
  if (system.startsWith('You answer a question from')) {
    // Answers from every line, in any note, that has a word of the question in it, and cites each by note and
    // second; then a note it wasn't sent, as a model can make one up, which Alcove must drop.
    const words = wordsAsked(user);
    const notes = notesIn(user);
    const hits = notes.flatMap((note) => note.heard.filter((h) => words.some((w) => h.text.toLowerCase().includes(w))).map((h) => ({ note: note.n, h })));
    return {
      answer: hits.length ? `From your notes: ${hits.map((x) => x.h.text).join(' ')}` : 'That isn’t in your notes.',
      cites: [...hits.map((x) => ({ note: x.note, at: x.h.at })), { note: notes.length + 1, at: 0 }]
    };
  }
  if (system.startsWith('You pick out ideas')) {
    // Offers each line that suggests something, unless it's on offer already, in the frame whose title shares a word with it
    // (else the first), with the line's words up to its first comma; and, as a model can, one from a line it wasn't sent,
    // which Alcove must drop, and words for a line about staging that weren't said there, which give way to the line's own.
    const frames = labelledIn(user, 'F');
    const offered = new Set(user.split('\n').flatMap((l) => (l.startsWith('- ') ? [l.slice(2)] : [])));
    const ideas = heard.filter((h) => /\b(should|let's|what if|idea|need to)\b/i.test(h.text) && !offered.has(h.text)).map((h) => {
      const words = new Set(h.text.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
      const frame = frames.find((f) => f.text.toLowerCase().split(/\W+/).some((w) => words.has(w)))?.label ?? frames[0]?.label ?? null;
      return { text: h.text, said: /staging/i.test(h.text) ? 'We agreed to drop staging.' : h.text.split(',')[0] ?? h.text, line: h.ref, frame };
    });
    return { ideas: [...ideas, { text: 'Something nobody said.', line: `L${heard.length + 9}`, frame: null }] };
  }
  if (system.startsWith('You sort the stickies')) {
    // Groups the stickies by their first word, naming each group after it; and, as a model can, names one it wasn't sent and
    // puts one in two themes, which Alcove must drop.
    const fence = /<stickies-([A-Za-z0-9_-]+)>\n([\s\S]*)\n<\/stickies-\1>/.exec(user)?.[2] ?? '';
    const stickies = labelledIn(fence, 'S');
    const groups = new Map<string, string[]>();
    for (const x of stickies) {
      const key = (x.text.split(/\s+/)[0] ?? '').toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), x.label]);
    }
    const first = stickies[0]?.label;
    return { themes: [...[...groups].map(([key, labels]) => ({ name: key.charAt(0).toUpperCase() + key.slice(1), stickies: labels })), { name: 'Strays', stickies: ['S99', ...(first ? [first] : [])] }] };
  }
  if (system.startsWith('You edit a passage')) {
    // Says what it was given, so tests can see what went and came back.
    const selection = /<selection-([A-Za-z0-9_-]+)>\n([\s\S]*)\n<\/selection-\1>/.exec(user)?.[2] ?? '';
    return user.includes('"items"') ? { items: selection.split(/\s*;\s*/) } : { text: `Shorter: ${selection}` };
  }
  if (system.startsWith('You help someone catch up')) {
    // Points at each line by its number and, as a model can, also at lines that aren't there, with one point it
    // can't back with any line it was sent: what Alcove shows must come only from lines that were read.
    const nowhere = heard.length + 7;
    const cited = (h: Heard) => ({ text: h.text, lines: [h.ref, `L${nowhere}`, 0] });
    const known = labelledIn(user, 'F');
    return {
      summary: `Catching up on ${heard.length} lines.`,
      decided: [...heard.filter((h) => /\b(agreed|decided)\b/i.test(h.text)).map(cited), { text: 'Everyone agreed to double the budget.', lines: [nowhere] }],
      proposed: heard.filter((h) => /\b(should|let's|what if|propose)\b/i.test(h.text)).map(cited),
      open: heard.filter((h) => h.text.trim().endsWith('?')).map(cited),
      next: heard.filter((h) => /\bwill\b|ます。$/i.test(h.text)).map((h) => ({
        ...cited(h), ...(known.length ? { id: which(h.text, known, 'F') } : {}), text: remembered(h.text, reworded.get(h.text) ?? h.text), owner: /^(\w+) will\b/.exec(h.text)?.[1] ?? null, due: /\bby (\w+day)\b/i.exec(h.text)?.[1] ?? null
      }))
    };
  }
  if (system.startsWith('You translate')) {
    // "Translates" by tagging each line with the language, so tests can see which lines went and came back.
    const asked: unknown = JSON.parse(user);
    const o = typeof asked === 'object' && asked !== null ? asked : {};
    const language = 'language' in o ? str(o.language) : '';
    const lines = 'lines' in o && Array.isArray(o.lines) ? o.lines : [];
    return { lines: lines.flatMap((l: unknown) => (typeof l === 'object' && l !== null && 'id' in l && 'text' in l ? [{ id: str(l.id), text: `[${language}] ${str(l.text)}` }] : [])) };
  }
  if (system.startsWith('You write the notes')) {
    // Written again, told what people already settled: like a model can, it lists the decisions again anyway, in other words.
    const again = user.includes('Already settled');
    /*
     * Each entry points at the line it came from and, as a model can, at lines that aren't there. A line that disagrees
     * ("No, ...") is pointed at as cutting against whatever came just before it. And like a model told what to do by
     * something said in the call, it says what only people can: that things are confirmed, and that someone took them on.
     */
    const nowhere = heard.length + 7;
    const ticks = labelledIn(user, 'T');
    /*
     * Each sticky in a board's Actions frame is a follow-up, labelled with the sticky it is, with whoever the sticky names
     * first ("Kofi: ..."). One that says "forgotten" is left out, as a model can leave one out.
     */
    const onBoards = labelledIn(user, 'B').filter((b) => !/\bforgotten\b/i.test(b.text)).map((b) => {
      const named = /^(\w+): (.+)$/.exec(b.text);
      return { text: named?.[2] ?? b.text, owner: named?.[1] ?? null, due: null, at: null, lines: [], against: [], board: b.label };
    });
    const boards = user.split('\n').filter((l) => l === '<board>').length;
    const refs = (h: Heard) => {
      const next = heard[heard.indexOf(h) + 1];
      return { lines: [h.ref, `L${nowhere}`, 0], against: next && /^no\b/i.test(next.text) ? [next.ref, nowhere] : [] };
    };
    const decided = (h: Heard) => ({ ...item(h), ...refs(h), text: again ? `Agreed: ${h.text.replace(/^we (?:agreed|decided) (?:to )?/i, '')}` : h.text, state: 'confirmed', disputes: [{ by: 'the model' }], changes: [{ what: 'confirmed' }] });
    /** A sentence nothing said backs: the model's word alone, which the notes must keep marked as that. */
    const unbacked = /\bunbacked\b/i.test(user) ? [{ text: 'Everyone agreed to double the budget.', at: heard[0]?.at ?? 0, lines: [nowhere], against: [] }] : [];
    return {
      summary: `Heard ${heard.length} lines.${boards ? ` Read ${boards} ${boards === 1 ? 'board' : 'boards'}.` : ''} It ended on: ${heard.at(-1)?.text ?? ''}`,
      decisions: [...heard.filter((h) => /\b(agreed|decided)\b/i.test(h.text)).map(decided), ...unbacked],
      questions: heard.filter((h) => h.text.trim().endsWith('?')).map((h) => ({ ...item(h), ...refs(h) })),
      actions: [...heard.flatMap((h) => {
        const m = /^(\w+) will (.+?)\.?$/.exec(h.text);
        const told = { ...(ticks.length ? { ticked: which(h.text, ticks, 'T') } : {}), takenOn: true, done: true, changes: [{ what: 'took-on' }] };
        if (!m) return /ます。$/.test(h.text) ? [{ text: reworded.get(h.text) ?? h.text, owner: null, due: null, at: h.at, ...onScreen(h), ...refs(h), ...told }] : [];
        const rest = m[2] ?? '';
        return [{ text: reworded.get(h.text) ?? rest.charAt(0).toUpperCase() + rest.slice(1), owner: m[1] ?? null, due: /\bby (\w+day)\b/i.exec(rest)?.[1] ?? null, at: h.at, ...onScreen(h), ...refs(h), ...told }];
      }), ...onBoards],
      chapters: heard.filter((_, i) => i % 2 === 0).map((h, i) => ({ at: h.at, title: `Part ${i + 1}`, summary: h.text })),
      suggestedQuestions: ['What did we decide?', 'Who is doing what?', 'What happens next?'],
      // Each screen, with what was said while it was up.
      screens: screens.map((x) => ({ n: x.n, description: `${x.title}, shown while: ${heard.find((h) => h.screen?.n === x.n)?.text ?? 'nothing was said'}` }))
    };
  }
  if (system.startsWith('You compare one meeting')) {
    // A decision saying "instead" replaces each earlier one it shares a long word with; a line starting "Answer:"
    // answers each earlier question it shares one with. Then a label and a moment that aren't there, as a model can make them up.
    const labelled = (letter: string) => user.split('\n').flatMap((l) => { const m = new RegExp(`^${letter}(\\d+): (.*)$`).exec(l); return m ? [{ label: `${letter}${m[1]}`, text: m[2] ?? '' }] : []; });
    const long = (s: string) => s.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    const shares = (a: string, b: string) => long(a).some((w) => long(b).includes(w));
    const mine = labelled('N').filter((n) => /\binstead\b/i.test(n.text));
    let room: number | null = null;
    const replies = user.split('\n').flatMap((l) => {
      const head = /^Breakout room (\d+), /.exec(l);
      if (head) room = Number(head[1]);
      return heardIn(l).filter((x) => /^Answer: /.test(x.text)).map((x) => ({ ...x, room }));
    });
    return {
      replaced: [...labelled('E').flatMap((e) => mine.filter((n) => shares(n.text, e.text)).map((n) => ({ earlier: e.label, by: n.label }))), { earlier: 'E99', by: 'N1' }, { earlier: 'E1', by: 'N99' }],
      answered: [...labelled('Q').flatMap((q) => replies.filter((r) => shares(r.text, q.text)).map((r) => ({ earlier: q.label, at: r.at, room: r.room }))), { earlier: 'Q99', at: 1, room: null }]
    };
  }
  const question = /\nQuestion: (.*)$/s.exec(user)?.[1] ?? '';
  const words = wordsAsked(user);
  if (system.startsWith('You answer a question about a series')) {
    // Answers from the first transcript line, newest meeting first, that shares a word with the question, in the call's
    // transcript or a breakout room's.
    const found = user.split(/\n(?=Meeting \d+: )/).flatMap((block) => {
      let room: number | null = null;
      return block.split('\n').flatMap((l) => {
        const head = /^Breakout room (\d+), .*, transcript:$/.exec(l);
        if (head) room = Number(head[1]);
        return heardIn(l).map((h) => ({ meeting: Number(/^Meeting (\d+): /.exec(block)?.[1] ?? 0), room, h }));
      });
    }).find(({ h }) => words.some((w) => h.text.toLowerCase().includes(w)));
    return { answer: found ? `From meeting ${found.meeting}: ${found.h.text}` : 'That wasn’t covered in these meetings.', sources: found ? [{ meeting: found.meeting, room: found.room, at: found.h.at }] : [] };
  }
  const hit = heard.find((h) => words.some((w) => h.text.toLowerCase().includes(w)));
  // A call still going on is asked about with its lines numbered: the answer points at them (and at one that isn't there).
  if (system.startsWith('You answer a question about a meeting that is still going on')) {
    return { answer: hit ? `From the call: ${hit.text}` : 'That wasn’t covered in the call.', lines: hit ? [hit.ref, heard.length + 3] : [] };
  }
  const shown = hit && /chart|slide|screen/i.test(question) ? hit.screen : undefined;
  return { answer: hit ? `From the call: ${hit.text}` : 'That wasn’t covered in the call.', moments: hit ? [hit.at] : [], screens: shown ? [shown.n] : [] };
}

/* ---------- the attested machines ---------- */

interface Event { imr: number; event_type: number; digest: string; event: string; event_payload: string }
interface Machine {
  name: string;
  seed: Uint8Array;
  key: Uint8Array;
  /** The dstack image it boots, measured as NEAR AI's machines measure it. */
  image: DstackImage;
  /** The dstack app compose its quote measures (MRCONFIGID and the compose-hash event). */
  compose: string;
  appId: string;
  ohttp: { id: number; secret: Uint8Array; key: Uint8Array };
}
const DSTACK_EVENT = 0x08000001;
const digestOf = (type: number, event: string, payload: Uint8Array) => { const t = Buffer.alloc(4); t.writeUInt32LE(type); return sha384(cat(t, utf8(':'), utf8(event), utf8(':'), payload)); };
const event = (name: string, payload: Uint8Array): Event => ({ imr: 3, event_type: DSTACK_EVENT, digest: hex(digestOf(DSTACK_EVENT, name, payload)), event: name, event_payload: hex(payload) });
/** The boot measurements (ignored by the replay) and the runtime events dstack extends RTMR3 with, compose hash included. */
const eventsOf = (m: Machine): Event[] => [
  { imr: 0, event_type: 0x80000001, digest: hex(randomBytes(48)), event: '', event_payload: '' },
  { imr: 1, event_type: 0x80000003, digest: hex(randomBytes(48)), event: '', event_payload: '' },
  event('system-preparing', new Uint8Array()), event('app-id', Buffer.from(m.appId, 'hex')), event('compose-hash', sha256(utf8(m.compose))),
  event('instance-id', randomBytes(20)), event('boot-mr-done', new Uint8Array()), event('os-image-hash', Buffer.from(m.image.osImageHash, 'hex')),
  event('key-provider', utf8('{"name":"kms"}')), event('system-ready', new Uint8Array())
];
function replay(events: Event[]): Uint8Array {
  let r: Uint8Array = new Uint8Array(48);
  for (const e of events) if (e.imr === 3) r = sha384(cat(r, Buffer.from(e.digest, 'hex')));
  return r;
}
const imageNamed = (name: string): DstackImage => {
  const image = DSTACK_IMAGES.find((i) => i.image === name);
  if (!image) throw new Error(`No measured dstack image ${name}`);
  return image;
};
function machine(name: string, image: DstackImage, compose: string, ohttpId: number): Machine {
  const seed = randomBytes(32);
  const ohttpSecret = randomBytes(32);
  return { name, seed, key: ed25519.getPublicKey(seed), image, compose, appId: hex(randomBytes(20)), ohttp: { id: ohttpId, secret: ohttpSecret, key: x25519.getPublicKey(ohttpSecret) } };
}
const keyConfigOf = (o: { id: number; key: Uint8Array }) => cat(Buffer.from([o.id]), i2osp(0x20, 2), o.key, i2osp(8, 2), i2osp(1, 2), i2osp(1, 2), i2osp(1, 2), i2osp(3, 2));
const composeFor = (service: string) => JSON.stringify({
  manifest_version: 2, name: `dstack-nvidia-0.5.12-${service}`, runner: 'docker-compose', kms_enabled: true, gateway_enabled: true,
  docker_compose_file: `services:\n  ${service}:\n    image: nearaidev/${service}@sha256:${hex(randomBytes(32))}\n`
}, null, 2);

/* ---------- HPKE and Oblivious HTTP, the receiving side (RFC 9180, RFC 9458) ---------- */

const KEM_SUITE = cat(utf8('KEM'), i2osp(0x20, 2));
const HPKE_SUITE = cat(utf8('HPKE'), i2osp(0x20, 2), i2osp(1, 2), i2osp(1, 2));
const lExtract = (suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array) => extract(sha256, cat(utf8('HPKE-v1'), suite, utf8(label), ikm), salt);
const lExpand = (suite: Uint8Array, prk: Uint8Array, label: string, info: Uint8Array, n: number) => expand(sha256, prk, cat(i2osp(n, 2), utf8('HPKE-v1'), suite, utf8(label), info), n);
/** Opens a sealed request with the receiver's key; returns the request and a way to seal the reply. */
function openRequest(secret: Uint8Array, wire: Buffer): { request: Uint8Array; sealReply(response: Uint8Array): Uint8Array } {
  const hdr = wire.subarray(0, 7);
  const enc = wire.subarray(7, 39);
  const none = new Uint8Array(0);
  const shared = lExpand(KEM_SUITE, lExtract(KEM_SUITE, none, 'eae_prk', x25519.getSharedSecret(secret, enc)), 'shared_secret', cat(enc, x25519.getPublicKey(secret)), 32);
  const ctx = cat(Buffer.from([0]), lExtract(HPKE_SUITE, none, 'psk_id_hash', none), lExtract(HPKE_SUITE, none, 'info_hash', cat(utf8('message/bhttp request'), Buffer.from([0]), hdr)));
  const s = lExtract(HPKE_SUITE, shared, 'secret', none);
  const request = gcm(lExpand(HPKE_SUITE, s, 'key', ctx, 16), lExpand(HPKE_SUITE, s, 'base_nonce', ctx, 12)).decrypt(wire.subarray(39));
  const exported = lExpand(HPKE_SUITE, lExpand(HPKE_SUITE, s, 'exp', ctx, 32), 'sec', utf8('message/bhttp response'), 16);
  return {
    request,
    sealReply(response) {
      const nonce = randomBytes(16);
      const prk = extract(sha256, exported, cat(enc, nonce));
      return cat(nonce, gcm(expand(sha256, prk, utf8('key'), 16), expand(sha256, prk, utf8('nonce'), 12)).encrypt(response));
    }
  };
}
function varint(b: Uint8Array, at: { i: number }): number {
  const first = b[at.i] ?? 0;
  const n = 1 << (first >> 6);
  let v = first & 0x3f;
  for (let k = 1; k < n; k++) v = v * 256 + (b[at.i + k] ?? 0);
  at.i += n;
  return v;
}
const enc = (n: number) => (n < 64 ? Buffer.from([n]) : n < 16384 ? Buffer.from([0x40 | (n >> 8), n & 255]) : cat(Buffer.from([0x80 | (n >>> 24), (n >>> 16) & 255, (n >>> 8) & 255, n & 255])));
const sized = (b: Uint8Array) => cat(enc(b.length), b);
/** A known-length Binary HTTP request (RFC 9292). */
function parseRequest(b: Uint8Array) {
  const at = { i: 0 };
  const take = () => { const n = varint(b, at); const out = b.subarray(at.i, at.i + n); at.i += n; return out; };
  const text = (x: Uint8Array) => Buffer.from(x).toString('utf8');
  if (varint(b, at) !== 0) throw new Error('not a known-length request');
  const method = text(take()); text(take()); text(take());
  const path = text(take());
  const fields = take();
  const headers = new Map<string, string>();
  const f = { i: 0 };
  while (f.i < fields.length) {
    const nameLength = varint(fields, f); const name = text(fields.subarray(f.i, f.i + nameLength)); f.i += nameLength;
    const valueLength = varint(fields, f); headers.set(name, text(fields.subarray(f.i, f.i + valueLength))); f.i += valueLength;
  }
  return { method, path, headers, body: take() };
}
const encodeResponse = (status: number, type: string, body: Uint8Array) => cat(enc(1), enc(status), sized(cat(sized(utf8('content-type')), sized(utf8(type)))), sized(body), enc(0));

export async function startFakeNear(): Promise<FakeNear> {
  const apiKey = `near-test-${randomBytes(12).toString('hex')}`;
  const calls: FakeNear['calls'] = [];
  const received: FakeNear['received'] = [];
  const prompts: string[] = [];
  const instructions: string[] = [];
  const images: FakeNear['images'] = [];
  const transcriptions: FakeNear['transcriptions'] = [];
  let failing = 0;
  let failure: Failure = 'down';
  let failingOnly: string | undefined;
  let slow = 0;
  let slowOnly: string | undefined;
  let holding: (() => Promise<void>) | null = null;
  const memory: Memory = { reworded: new Map(), worded: new Map(), identified: new Map() };
  let tampered: { how: Tamper; of: 'model' | 'gateway' } | null = null;
  let ohttpIds = 1;
  const lie = (of: 'model' | 'gateway') => (tampered?.of === of ? tampered.how : undefined);

  const gateway = machine('cloud-api', imageNamed('dstack-0.5.12'), composeFor('cloud-api'), ohttpIds++);
  const models: Record<Task, Machine> = {
    transcript: machine('whisper', imageNamed('dstack-nvidia-0.5.12'), composeFor('whisper'), ohttpIds++),
    notes: machine('vllm', imageNamed('dstack-nvidia-0.5.12'), composeFor('vllm'), ohttpIds++)
  };
  const taskOf = (model: string): Task | undefined => (model === STT_MODEL ? 'transcript' : model === NOTES_MODEL ? 'notes' : undefined);

  // Set once the server is listening and its address is known.
  let intel: FakeIntel | undefined;
  let nvidia: FakeNvidia | undefined;

  /** A dstack report for one machine, answering `nonce`, as honest or as tampered as asked. */
  function report(m: Machine, nonce: Buffer, how: Tamper | undefined, i: FakeIntel, gatewayFields: boolean) {
    const composeHash = sha256(utf8(m.compose));
    const events = eventsOf(m);
    // The quote binds the key and a nonce: ours, or one from an earlier report someone replays.
    const reportData = cat(m.key, how === 'nonce' ? randomBytes(32) : nonce);
    // The same image on a machine NEAR AI doesn't run: RTMR0 measures the machine.
    const booted = how === 'os-image' ? { ...m.image, rtmr0: hex(randomBytes(48)) } : m.image;
    let quote = i.quote({ ...booted, mrConfigId: cat(Buffer.from([1]), composeHash, Buffer.alloc(15)), rtmr3: replay(events), reportData });
    if (how === 'quote') { quote = Buffer.from(quote); quote[48 + 584 + 4 + 8] = (quote[48 + 584 + 4 + 8] ?? 0) ^ 0xff; }
    const shown = how === 'rtmr3' ? events.map((e) => (e.event === 'instance-id' ? event('instance-id', randomBytes(20)) : e)) : events;
    const compose = how === 'compose' ? m.compose.replace('docker-compose', 'docker-compose ') : m.compose;
    const signer = how === 'key' ? ed25519.getPublicKey(randomBytes(32)) : m.key;
    return {
      signing_address: hex(signer), signing_algo: 'ed25519', intel_quote: hex(quote), event_log: JSON.stringify(shown), request_nonce: hex(nonce),
      ...(gatewayFields ? { report_data: hex(reportData) } : {}),
      info: {
        app_id: m.appId, instance_id: hex(randomBytes(20)), app_name: m.name, compose_hash: hex(composeHash), os_image_hash: m.image.osImageHash,
        tcb_info: JSON.stringify({ mrtd: m.image.mrtd, rtmr0: m.image.rtmr0, rtmr1: m.image.rtmr1, rtmr2: m.image.rtmr2, rtmr3: hex(replay(events)), compose_hash: hex(composeHash), app_compose: compose, event_log: shown })
      }
    };
  }
  /** A model's report as the gateway lists it: its dstack report, GPU evidence and signed OHTTP key. */
  function modelReport(model: string, m: Machine, nonce: Buffer, how: Tamper | undefined, i: FakeIntel, n: FakeNvidia) {
    const shown = report(m, nonce, how, i, false);
    const config = keyConfigOf(m.ohttp);
    return {
      model_name: how === 'model-mismatch' ? 'acme/another-model' : model, ...shown, signing_public_key: shown.signing_address,
      nvidia_payload: n.payload(how === 'gpu-nonce' ? hex(randomBytes(32)) : hex(nonce)),
      ohttp_attestation: { signing_algo: 'ed25519', signing_key: hex(m.key), key_config: hex(config), signature: hex(ed25519.sign(how === 'ohttp-key' ? randomBytes(config.length) : config, m.seed)) },
      ohttp_key_config: hex(config)
    };
  }

  /** A model's own endpoint: opens what was sealed to its OHTTP key, answers, and seals the answer. */
  async function direct(res: ServerResponse, req: IncomingMessage, body: Buffer, task: Task, handle: (inner: ReturnType<typeof parseRequest>) => Promise<{ status: number; body: unknown }>) {
    const own = models[task].ohttp;
    // As NEAR AI's endpoints answer a request sealed to a key they don't hold.
    const refused = () => send(res, 400, { error: { message: 'OHTTP decapsulation failed: a problem occurred with HPKE: Failed to open ciphertext' } });
    if (req.headers['content-type'] !== 'message/ohttp-req' || body[0] !== own.id || tampered?.how === 'refuse') return refused();
    let opened: ReturnType<typeof openRequest>;
    try { opened = openRequest(own.secret, body); } catch { return refused(); }
    const inner = parseRequest(opened.request);
    const respond = (status: number, v: unknown) => {
      const sealed = opened.sealReply(encodeResponse(status, 'application/json', utf8(JSON.stringify(v))));
      // A reply sealed by someone who didn't open the request: it won't open.
      reply(res, 200, tampered?.how === 'reply-sealed' ? randomBytes(sealed.length) : sealed, 'message/ohttp-res');
    };
    if (inner.headers.get('authorization') !== `Bearer ${apiKey}`) return respond(401, { error: { message: 'Invalid or missing Authorization header' } });
    const out = await handle(inner);
    return respond(out.status, out.body);
  }

  /** What the notes model answers a chat request, as JSON. */
  async function chat(body: Uint8Array, path: string, encryption: 'ohttp' | 'none', key: string | null): Promise<{ status: number; body: unknown }> {
    const parsed: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
    const o = typeof parsed === 'object' && parsed !== null ? parsed : {};
    const model = 'model' in o ? str(o.model) : '';
    const messages = 'messages' in o && Array.isArray(o.messages) ? o.messages : [];
    // A message's content: text, or parts of text and images (data URLs), as the OpenAI chat format has them.
    const parts = (role: string): unknown[] => messages.flatMap((m: unknown) => {
      if (typeof m !== 'object' || m === null || !('role' in m) || m.role !== role || !('content' in m)) return [];
      return Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
    });
    const text = (role: string) => parts(role).flatMap((x) => (typeof x === 'object' && x !== null && 'type' in x && x.type === 'text' && 'text' in x ? [str(x.text)] : [])).join('\n');
    const sent = parts('user').flatMap((x) => {
      if (typeof x !== 'object' || x === null || !('type' in x) || x.type !== 'image_url' || !('image_url' in x) || typeof x.image_url !== 'object' || x.image_url === null || !('url' in x.image_url)) return [];
      const m = /^data:image\/jpeg;base64,(.+)$/s.exec(str(x.image_url.url));
      return m ? [Buffer.from(m[1] ?? '', 'base64')] : [];
    });
    const system = text('system');
    const user = text('user');
    calls.push({ path, model, bytes: body.length, encryption, key });
    prompts.push(user);
    instructions.push(system);
    for (const img of sent) {
      const comment = commentOf(img);
      images.push({ bytes: img.length, marker: /^SCREEN:(\{.*\})\|/s.exec(comment)?.[1] ?? null, salt: comment.slice(comment.lastIndexOf('|') + 1) });
    }
    if (slow && (slowOnly === undefined || user.includes(slowOnly))) { const ms = slow; slow = 0; await new Promise((r) => setTimeout(r, ms)); }
    if (holding) { const then = holding; holding = null; await then(); }
    let content: string;
    let finish = 'stop';
    if (failing > 0 && (failingOnly === undefined || user.includes(failingOnly))) {
      failing--;
      if (failure === 'down') return { status: 503, body: { error: { message: 'Service unavailable' } } };
      if (failure === 'cut-off') { finish = 'length'; content = JSON.stringify(notesReply(system, user, sent, memory)).slice(0, 60); }
      else content = failure === 'stub'
        ? JSON.stringify({ summary: '...', decisions: [], questions: [], actions: [], chapters: [], suggestedQuestions: [], screens: [] })
        : failure === 'empty' ? '{}'
          : failure === 'partial' ? JSON.stringify({ summary: 'Catching up.', decided: 'none of it' })
            : failure === 'lines' ? JSON.stringify({ summary: 'Catching up.', decided: [{ text: 'We agreed on something.', lines: 3 }], proposed: [], open: [], next: [{ text: 'Kofi will do something.', lines: 'L3' }] })
            : 'Here are your notes! The team talked about a few things.';
    } else content = JSON.stringify(notesReply(system, user, sent, memory));
    return {
      status: 200,
      body: {
        id: `chatcmpl-${randomUUID().replace(/-/g, '')}`, object: 'chat.completion', model, created: Math.floor(Date.now() / 1000),
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }], usage: { prompt_tokens: Math.round(user.length / 4), completion_tokens: 200 }
      }
    };
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const body = await raw(req);
      if (body.length) received.push({ path: url.pathname, body });
      const [I, N] = [intel, nvidia];
      if (!I || !N) return send(res, 503, { error: { message: 'starting' } });

      // Intel's and NVIDIA's stand-ins: public, as theirs are.
      const fromIntel = I.answer(url.pathname, url.searchParams);
      if (fromIntel) return answer(res, fromIntel);
      const fromNvidia = await N.answer(url.pathname, req.method ?? 'GET', body);
      if (fromNvidia) return answer(res, fromNvidia);

      // The models' own endpoints: Oblivious HTTP, with the API key inside the seal. Only the OHTTP key the
      // model's attested key signed opens a request, so what opens was sealed to that attested key.
      if (req.method === 'POST' && url.pathname === '/direct/whisper/ohttp') {
        return direct(res, req, body, 'transcript', async (inner) => (inner.method === 'POST' && inner.path === '/v1/audio/transcriptions'
          ? transcription(inner.headers.get('content-type') ?? '', inner.body, calls, transcriptions, inner.path, 'ohttp', hex(models.transcript.key)) : { status: 404, body: { error: { message: 'Not found' } } }));
      }
      if (req.method === 'POST' && url.pathname === '/direct/glm/ohttp') {
        return direct(res, req, body, 'notes', async (inner) => (inner.method === 'POST' && inner.path === '/v1/chat/completions'
          ? chat(inner.body, inner.path, 'ohttp', hex(models.notes.key)) : { status: 404, body: { error: { message: 'Not found' } } }));
      }

      if (req.headers.authorization !== `Bearer ${apiKey}`) return send(res, 401, { error: { message: 'Invalid API key' } });

      if (req.method === 'GET' && url.pathname === '/v1/attestation/report') {
        if (tampered?.how === 'report-down') return send(res, 503, { error: { message: 'Service unavailable' } });
        const nonce = Buffer.from(url.searchParams.get('nonce') ?? '', 'hex');
        if (nonce.length !== 32 || url.searchParams.get('signing_algo') !== 'ed25519' || req.headers['x-no-aliasing'] !== 'true') return send(res, 400, { error: { message: 'Ask with a 32-byte nonce, ed25519 and x-no-aliasing.' } });
        const model = url.searchParams.get('model') ?? '';
        const task = taskOf(model);
        const candidates = task ? [
          // A tampered report ahead of an honest one: the honest one is used.
          ...(lie('model') === 'extra-candidate' ? [modelReport(model, models[task], nonce, 'quote', I, N)] : []),
          modelReport(model, models[task], nonce, lie('model') === 'extra-candidate' ? undefined : lie('model'), I, N)
        ] : [];
        const gatewayConfig = keyConfigOf(gateway.ohttp);
        return send(res, 200, {
          gateway_attestation: report(gateway, nonce, lie('gateway'), I, true), ...(candidates.length ? { model_attestations: candidates } : {}),
          ohttp_key_config: hex(gatewayConfig), ohttp_attestation: { signing_algo: 'ed25519', signing_key: hex(gateway.key), key_config: hex(gatewayConfig), signature: hex(ed25519.sign(gatewayConfig, gateway.seed)) }
        });
      }

      // What real NEAR AI's gateway also takes, in plaintext. Alcove must never send these.
      if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
        const t = await transcription(req.headers['content-type'] ?? '', body, calls, transcriptions, url.pathname, 'none', null);
        return send(res, t.status, t.body);
      }
      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const c = await chat(body, url.pathname, 'none', null);
        return send(res, c.status, c.body);
      }
      send(res, 404, { error: { message: 'Not found' } });
    })().catch(() => send(res, 500, { error: { message: 'fake failed' } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const i = fakeIntel(origin);
  const n = fakeNvidia(origin);
  intel = i;
  nvidia = n;
  return {
    settings: {
      NEAR_AI_BASE_URL: `${origin}/v1`, NEAR_AI_API_KEY: apiKey, NEAR_AI_STT_URL: `${origin}/direct/whisper`, NEAR_AI_NOTES_URL: `${origin}/direct/glm`,
      INTEL_PCS_URL: i.pcsUrl, INTEL_ROOT_CA: i.rootPem, NVIDIA_NRAS_URL: n.nrasUrl, NVIDIA_ROOT_CA: n.rootPem
    },
    calls, received, prompts, instructions, images, transcriptions,
    keys: () => ({ transcript: hex(models.transcript.key), notes: hex(models.notes.key) }),
    composes: () => ({ transcript: hex(sha256(utf8(models.transcript.compose))), notes: hex(sha256(utf8(models.notes.compose))), gateway: hex(sha256(utf8(gateway.compose))) }),
    tamper(how, of = 'model') {
      tampered = how ? { how, of } : null;
      i.expired = how === 'expired';
      i.status = how === 'tcb' ? 'OutOfDate' : 'UpToDate';
      i.down = how === 'pcs-down';
      i.unnamed = how === 'unnamed-platform';
      n.verdict = how === 'gpu' ? 'fail' : 'pass';
      n.stale = how === 'verdict-nonce';
      n.signer = how === 'nvidia-root' ? 'other-root' : how === 'nvidia-expired' ? 'expired-intermediate' : how === 'nvidia-not-ca' ? 'intermediate-not-ca' : 'nvidia';
      n.down = how === 'nras-down' ? 'attest' : how === 'jwks-down' ? 'keys' : 'no';
    },
    rotate(task) {
      const m = models[task];
      models[task] = { ...machine(m.name, m.image, m.compose, ohttpIds++), appId: m.appId };
    },
    verdictLifetime(seconds) { n.lifetime = seconds; },
    failNext(count, how, only) { failing = count; failure = how; failingOnly = only; },
    slowNext(ms, only) { slow = ms; slowOnly = only; },
    holdNext(then) { holding = then; },
    reword(line, text) { if (text === null) memory.reworded.delete(line); else memory.reworded.set(line, text); },
    identify(line, as) { if (as === null) memory.identified.delete(line); else memory.identified.set(line, as); },
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}
