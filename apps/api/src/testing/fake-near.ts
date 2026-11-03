/*
 * A stand-in for NEAR AI Cloud, for integration tests, with the evidence it takes to trust it. On one
 * server, under different paths:
 *
 *  - NEAR AI's gateway (/v1): attestation reports for the gateway and each model, as dstack reports with
 *    TDX quotes and GPU evidence; end-to-end encrypted chat (E2EE v2) and the model's signatures over each
 *    reply; and plain speech-to-text and chat, which real NEAR AI also takes and Alcove must never use.
 *  - The speech model's own endpoint (/direct/whisper): Oblivious HTTP to the model's attested key.
 *  - Intel's certification service (/intel) and NVIDIA's attestation service (/nvidia), under test roots
 *    (fake-tee.ts), so the API checks the evidence with the code it checks NEAR AI's real evidence with.
 *
 * Speech is "recognised" from a marker a test writes into the WAV samples (see `speechWav`), so a test
 * decides exactly what was said; a clip without one is heard the way Whisper hears silence. The notes
 * model writes from the transcript it was sent, so tests can see the transcript arrived intact and the
 * reply was checked before use. Every request body is kept as it arrived, so tests can show that nothing
 * readable crossed the wire, and the reports can be tampered with, so tests can show what Alcove refuses.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { expand, extract, hkdf } from '@noble/hashes/hkdf.js';
import { sha256, sha384 } from '@noble/hashes/sha2.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fakeIntel, fakeNvidia, type Answer, type FakeIntel, type FakeNvidia } from './fake-tee';

const STT_MODEL = 'openai/whisper-large-v3';
const NOTES_MODEL = 'z-ai/glm-5.3-flash';

/** What a report can be made to get wrong. */
export type Tamper = 'quote' | 'nonce' | 'key' | 'compose' | 'rtmr3' | 'ohttp-key' | 'expired' | 'gpu' | 'reply-signature';
export type Task = 'transcript' | 'notes';

export interface FakeNear {
  /** What the API is configured with to use this NEAR AI, and the stand-in Intel and NVIDIA that vouch for it. */
  settings: { NEAR_AI_BASE_URL: string; NEAR_AI_API_KEY: string; NEAR_AI_STT_URL: string; INTEL_PCS_URL: string; INTEL_ROOT_CA: string; NVIDIA_NRAS_URL: string; NVIDIA_ROOT_CA: string };
  /** Every request with content, oldest first: which endpoint, which model, how many bytes, and how it was protected. */
  calls: { path: string; model: string; bytes: number; encryption: 'e2ee' | 'ohttp' | 'none' }[];
  /** Every request body exactly as it arrived, before anything was opened. */
  received: { path: string; body: Buffer }[];
  /** What the notes model was sent (the user message, once opened), oldest first. */
  prompts: string[];
  /** The models' attested signing keys right now, hex. */
  keys(): Record<Task, string>;
  /** The hashes of the configurations the quotes measure. */
  composes(): Record<Task | 'gateway', string>;
  /** Makes the next reports (and, for reply-signature, signatures) lie; null makes them honest again. */
  tamper(how: Tamper | null, of?: 'model' | 'gateway'): void;
  /** A model gets a new signing key (and the speech model a new OHTTP key); the old ones stop being accepted. */
  rotate(task: Task): void;
  /** How long NVIDIA's verdicts hold, in seconds. */
  verdictLifetime(seconds: number): void;
  /** The next `n` chat replies fail: the service is down, or the model answers in prose instead of JSON. */
  failNext(n: number, how: 'down' | 'prose'): void;
  /** The next chat reply takes this long, as a busy model does. */
  slowNext(ms: number): void;
  close(): Promise<void>;
}

/**
 * A clip of "speech" for the fake: 16 kHz mono 16-bit WAV of `ms` milliseconds whose samples carry
 * the words. Sentences separated by " // " come back as separate lines, two seconds apart.
 */
export function speechWav(words: string, ms = 4000): Uint8Array<ArrayBuffer> {
  const samples = Math.max(1, Math.round((ms / 1000) * 16_000));
  const marker = Buffer.from(words ? `TEXT:${words}|` : '', 'utf8');
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

/** The words in a clip's samples, or null when it's "silence". */
function wordsIn(wav: Buffer): string | null {
  const m = /TEXT:([^|]*)\|/.exec(wav.subarray(44).toString('utf8'));
  return m ? (m[1] ?? '') : null;
}

/** Whisper's answer to a multipart transcription request. */
async function transcription(contentType: string, body: Uint8Array, calls: FakeNear['calls'], path: string, encryption: 'ohttp' | 'none'): Promise<{ status: number; body: unknown }> {
  const form = await new Request('http://fake', { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(body) }).formData();
  const file = form.get('file');
  const model = str(form.get('model'));
  if (!(file instanceof Blob) || !model) return { status: 400, body: { error: { message: 'file and model are required' } } };
  const wav = Buffer.from(await file.arrayBuffer());
  calls.push({ path, model, bytes: wav.length, encryption });
  if (wav.subarray(0, 4).toString('ascii') !== 'RIFF') return { status: 400, body: { error: { message: 'Unsupported audio format' } } };
  const seconds = Math.max(0, wav.length - 44) / 32_000;
  const words = wordsIn(wav);
  // Silence: Whisper's favourite hallucination, with high confidence, as the real one does.
  const said = words === null ? [' Thank you.'] : words.split(' // ').map((w) => ` ${w}`);
  const segments = said.map((text, i) => ({ id: i, seek: 0, start: i * 2, end: Math.min(seconds, i * 2 + 1.8), text, tokens: [], temperature: 0, avg_logprob: -0.2, compression_ratio: 1.1, no_speech_prob: null }));
  return { status: 200, body: { text: said.join(''), duration: String(seconds), language: 'en', segments, id: `trans-${randomUUID()}` } };
}

interface Heard { at: number; who: string; text: string }
/** Reads back "[mm:ss] Name: words" lines from a prompt. */
function heardIn(prompt: string): Heard[] {
  return prompt.split('\n').flatMap((l) => {
    const m = /^\[(\d+):(\d\d)\] (?:([^:]+): )?(.*)$/.exec(l);
    return m ? [{ at: Number(m[1]) * 60 + Number(m[2]), who: m[3] ?? '', text: m[4] ?? '' }] : [];
  });
}

/** What the notes model writes for a system prompt and a user message. */
function notesReply(system: string, user: string): unknown {
  const heard = heardIn(user);
  const item = (h: Heard) => ({ text: h.text, at: h.at });
  if (system.startsWith('You help someone catch up')) {
    return {
      summary: `Catching up on ${heard.length} lines.`,
      decided: heard.filter((h) => /\b(agreed|decided)\b/i.test(h.text)).map(item),
      proposed: heard.filter((h) => /\b(should|let's|what if|propose)\b/i.test(h.text)).map(item),
      open: heard.filter((h) => h.text.trim().endsWith('?')).map(item),
      next: heard.filter((h) => /\bwill\b/i.test(h.text)).map(item)
    };
  }
  if (system.startsWith('You write the notes')) {
    return {
      summary: `Heard ${heard.length} lines. It ended on: ${heard.at(-1)?.text ?? ''}`,
      decisions: heard.filter((h) => /\b(agreed|decided)\b/i.test(h.text)).map((h) => ({ text: h.text, at: h.at })),
      actions: heard.flatMap((h) => {
        const m = /^(\w+) will (.+?)\.?$/.exec(h.text);
        if (!m) return [];
        const rest = m[2] ?? '';
        return [{ text: rest.charAt(0).toUpperCase() + rest.slice(1), owner: m[1] ?? null, due: /\bby (\w+day)\b/i.exec(rest)?.[1] ?? null, at: h.at }];
      }),
      chapters: heard.filter((_, i) => i % 2 === 0).map((h, i) => ({ at: h.at, title: `Part ${i + 1}`, summary: h.text })),
      suggestedQuestions: ['What did we decide?', 'Who is doing what?', 'What happens next?']
    };
  }
  const question = /\nQuestion: (.*)$/s.exec(user)?.[1] ?? '';
  const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const hit = heard.find((h) => words.some((w) => h.text.toLowerCase().includes(w)));
  return { answer: hit ? `From the call: ${hit.text}` : 'That wasn’t covered in the call.', moments: hit ? [hit.at] : [] };
}

/* ---------- the attested machines ---------- */

interface Event { imr: number; event_type: number; digest: string; event: string; event_payload: string }
interface Machine {
  name: string;
  seed: Uint8Array;
  key: Uint8Array;
  /** The dstack app compose its quote measures (MRCONFIGID and the compose-hash event). */
  compose: string;
  appId: string;
  ohttp: { id: number; secret: Uint8Array; key: Uint8Array } | null;
}
const DSTACK_EVENT = 0x08000001;
const digestOf = (type: number, event: string, payload: Uint8Array) => { const t = Buffer.alloc(4); t.writeUInt32LE(type); return sha384(cat(t, utf8(':'), utf8(event), utf8(':'), payload)); };
const event = (name: string, payload: Uint8Array): Event => ({ imr: 3, event_type: DSTACK_EVENT, digest: hex(digestOf(DSTACK_EVENT, name, payload)), event: name, event_payload: hex(payload) });
/** The boot measurements (ignored by the replay) and the runtime events dstack extends RTMR3 with, compose hash included. */
const eventsOf = (m: Machine): Event[] => [
  { imr: 0, event_type: 0x80000001, digest: hex(randomBytes(48)), event: '', event_payload: '' },
  { imr: 1, event_type: 0x80000003, digest: hex(randomBytes(48)), event: '', event_payload: '' },
  event('system-preparing', new Uint8Array()), event('app-id', Buffer.from(m.appId, 'hex')), event('compose-hash', sha256(utf8(m.compose))),
  event('instance-id', randomBytes(20)), event('boot-mr-done', new Uint8Array()), event('key-provider', utf8('{"name":"kms"}')), event('system-ready', new Uint8Array())
];
function replay(events: Event[]): Uint8Array {
  let r: Uint8Array = new Uint8Array(48);
  for (const e of events) if (e.imr === 3) r = sha384(cat(r, Buffer.from(e.digest, 'hex')));
  return r;
}
function machine(name: string, compose: string, ohttpId: number | null): Machine {
  const seed = randomBytes(32);
  const ohttpSecret = randomBytes(32);
  return {
    name, seed, key: ed25519.getPublicKey(seed), compose, appId: hex(randomBytes(20)),
    ohttp: ohttpId === null ? null : { id: ohttpId, secret: ohttpSecret, key: x25519.getPublicKey(ohttpSecret) }
  };
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

/* ---------- E2EE v2 (Ed25519 keys as X25519, HKDF-SHA256 "ed25519_encryption", XChaCha20-Poly1305) ---------- */

const e2eeKey = (secret: Uint8Array, pub: Uint8Array) => hkdf(sha256, x25519.getSharedSecret(secret, pub), undefined, utf8('ed25519_encryption'), 32);
function e2eeOpen(modelSeed: Uint8Array, sealedHex: string): string {
  const b = Buffer.from(sealedHex, 'hex');
  return Buffer.from(xchacha20poly1305(e2eeKey(ed25519.utils.toMontgomerySecret(modelSeed), b.subarray(0, 32)), b.subarray(32, 56)).decrypt(b.subarray(56))).toString('utf8');
}
function e2eeSeal(clientEd25519: Uint8Array, text: string): string {
  const eph = randomBytes(32);
  const nonce = randomBytes(24);
  return hex(cat(x25519.getPublicKey(eph), nonce, xchacha20poly1305(e2eeKey(eph, ed25519.utils.toMontgomery(clientEd25519)), nonce).encrypt(utf8(text))));
}

export async function startFakeNear(): Promise<FakeNear> {
  const apiKey = `near-test-${randomBytes(12).toString('hex')}`;
  const calls: FakeNear['calls'] = [];
  const received: FakeNear['received'] = [];
  const prompts: string[] = [];
  const signatures = new Map<string, { text: string; signature: string; key: string }>();
  let failing = 0;
  let failure: 'down' | 'prose' = 'down';
  let slow = 0;
  let tampered: { how: Tamper; of: 'model' | 'gateway' } | null = null;
  let ohttpIds = 1;

  const gateway = machine('cloud-api', composeFor('cloud-api'), null);
  const models: Record<Task, Machine> = { transcript: machine('whisper', composeFor('whisper'), ohttpIds++), notes: machine('vllm', composeFor('vllm'), null) };
  const taskOf = (model: string): Task | undefined => (model === STT_MODEL ? 'transcript' : model === NOTES_MODEL ? 'notes' : undefined);

  // Set once the server is listening and its address is known.
  let intel: FakeIntel | undefined;
  let nvidia: FakeNvidia | undefined;

  /** A dstack report for one machine, answering `nonce`, as honest or as tampered as asked. */
  function report(m: Machine, nonce: Buffer, lie: Tamper | undefined, i: FakeIntel, gatewayFields: boolean) {
    const composeHash = sha256(utf8(m.compose));
    const events = eventsOf(m);
    // The quote binds the key and a nonce: ours, or one from an earlier report someone replays.
    const reportData = cat(m.key, lie === 'nonce' ? randomBytes(32) : nonce);
    let quote = i.quote({ reportData, mrConfigId: cat(Buffer.from([1]), composeHash, Buffer.alloc(15)), rtmr3: replay(events) });
    if (lie === 'quote') { quote = Buffer.from(quote); quote[48 + 584 + 4 + 8] = (quote[48 + 584 + 4 + 8] ?? 0) ^ 0xff; }
    const shown = lie === 'rtmr3' ? events.map((e) => (e.event === 'instance-id' ? event('instance-id', randomBytes(20)) : e)) : events;
    const compose = lie === 'compose' ? m.compose.replace('docker-compose', 'docker-compose ') : m.compose;
    const signer = lie === 'key' ? ed25519.getPublicKey(randomBytes(32)) : m.key;
    return {
      signing_address: hex(signer), signing_algo: 'ed25519', intel_quote: hex(quote), event_log: JSON.stringify(shown), request_nonce: hex(nonce),
      ...(gatewayFields ? { report_data: hex(reportData) } : {}),
      info: {
        app_id: m.appId, instance_id: hex(randomBytes(20)), app_name: m.name, compose_hash: hex(composeHash),
        tcb_info: JSON.stringify({ rtmr3: hex(replay(events)), compose_hash: hex(composeHash), app_compose: compose, event_log: shown })
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

      // The speech model's own endpoint: Oblivious HTTP, with the API key inside the seal.
      if (req.method === 'POST' && url.pathname === '/direct/whisper/ohttp') {
        const own = models.transcript.ohttp;
        if (req.headers['content-type'] !== 'message/ohttp-req' || !own || body[0] !== own.id) return send(res, 400, { error: { message: 'OHTTP decapsulation failed: unknown key' } });
        let opened: ReturnType<typeof openRequest>;
        try { opened = openRequest(own.secret, body); } catch { return send(res, 400, { error: { message: 'OHTTP decapsulation failed: a problem occurred with HPKE: Failed to open ciphertext' } }); }
        const inner = parseRequest(opened.request);
        const respond = (status: number, v: unknown) => reply(res, 200, opened.sealReply(encodeResponse(status, 'application/json', utf8(JSON.stringify(v)))), 'message/ohttp-res');
        if (inner.headers.get('authorization') !== `Bearer ${apiKey}`) return respond(401, { error: { message: 'Invalid or missing Authorization header' } });
        if (inner.method !== 'POST' || inner.path !== '/v1/audio/transcriptions') return respond(404, { error: { message: 'Not found' } });
        const t = await transcription(inner.headers.get('content-type') ?? '', inner.body, calls, inner.path, 'ohttp');
        return respond(t.status, t.body);
      }

      if (req.headers.authorization !== `Bearer ${apiKey}`) return send(res, 401, { error: { message: 'Invalid API key' } });

      if (req.method === 'GET' && url.pathname === '/v1/attestation/report') {
        const nonce = Buffer.from(url.searchParams.get('nonce') ?? '', 'hex');
        if (nonce.length !== 32 || url.searchParams.get('signing_algo') !== 'ed25519' || req.headers['x-no-aliasing'] !== 'true') return send(res, 400, { error: { message: 'Ask with a 32-byte nonce, ed25519 and x-no-aliasing.' } });
        const task = taskOf(url.searchParams.get('model') ?? '');
        const lie = (of: 'model' | 'gateway') => (tampered?.of === of ? tampered.how : undefined);
        const m = task ? models[task] : undefined;
        const shown = m ? report(m, nonce, lie('model'), I, false) : undefined;
        const modelReport = m && shown ? {
          model_name: url.searchParams.get('model'), ...shown, signing_public_key: shown.signing_address, nvidia_payload: N.payload(hex(nonce)),
          ...(m.ohttp ? (() => {
            const config = keyConfigOf(m.ohttp);
            const attestation = { signing_algo: 'ed25519', signing_key: hex(m.key), key_config: hex(config), signature: hex(ed25519.sign(lie('model') === 'ohttp-key' ? randomBytes(config.length) : config, m.seed)) };
            return { ohttp_attestation: attestation, ohttp_key_config: hex(config) };
          })() : {})
        } : undefined;
        const gatewayConfig = keyConfigOf({ id: 1, key: x25519.getPublicKey(gateway.seed) });
        return send(res, 200, {
          gateway_attestation: report(gateway, nonce, lie('gateway'), I, true), ...(modelReport ? { model_attestations: [modelReport] } : {}),
          ohttp_key_config: hex(gatewayConfig), ohttp_attestation: { signing_algo: 'ed25519', signing_key: hex(gateway.key), key_config: hex(gatewayConfig), signature: hex(ed25519.sign(gatewayConfig, gateway.seed)) }
        });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/v1/signature/')) {
        const s = signatures.get(decodeURIComponent(url.pathname.slice('/v1/signature/'.length)));
        if (!s) return send(res, 404, { error: { message: 'Signature not found' } });
        return send(res, 200, { text: s.text, signature: s.signature, signing_address: s.key, signing_algo: 'ed25519', signature_kind: 'provider_tee' });
      }

      if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
        const t = await transcription(req.headers['content-type'] ?? '', body, calls, url.pathname, 'none');
        return send(res, t.status, t.body);
      }

      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const parsed: unknown = JSON.parse(body.toString('utf8'));
        const o = typeof parsed === 'object' && parsed !== null ? parsed : {};
        const model = 'model' in o ? str(o.model) : '';
        const e2ee = req.headers['x-encryption-version'] !== undefined || req.headers['x-model-pub-key'] !== undefined;
        const notes = models.notes;
        const client = Buffer.from(str(req.headers['x-client-pub-key']), 'hex');
        if (e2ee) {
          if (req.headers['x-encryption-version'] !== '2' || req.headers['x-signing-algo'] !== 'ed25519' || req.headers['x-no-aliasing'] !== 'true' || client.length !== 32) {
            return send(res, 400, { error: { message: 'Malformed E2EE request' } });
          }
          // A key the model no longer holds: as NEAR AI says it.
          if (req.headers['x-model-pub-key'] !== hex(notes.key)) return send(res, 421, { error: { message: 'The encryption key is no longer valid. Please refresh your attestation report and retry.', type: 'provider_error' } });
        }
        const messages = 'messages' in o && Array.isArray(o.messages) ? o.messages : [];
        const text = (role: string) => {
          const content = str(messages.map((m: unknown) => (typeof m === 'object' && m !== null && 'role' in m && m.role === role && 'content' in m ? m.content : '')).find(Boolean));
          return e2ee && content ? e2eeOpen(notes.seed, content) : content;
        };
        const system = text('system');
        const user = text('user');
        calls.push({ path: url.pathname, model, bytes: body.length, encryption: e2ee ? 'e2ee' : 'none' });
        prompts.push(user);
        if (slow) { const ms = slow; slow = 0; await new Promise((r) => setTimeout(r, ms)); }
        let content: string;
        if (failing > 0) {
          failing--;
          if (failure === 'down') return send(res, 503, { error: { message: 'Service unavailable' } });
          content = 'Here are your notes! The team talked about a few things.';
        } else content = JSON.stringify(notesReply(system, user));
        const id = `chatcmpl-${randomUUID().replace(/-/g, '')}`;
        const out = JSON.stringify({
          id, object: 'chat.completion', model, created: Math.floor(Date.now() / 1000),
          choices: [{ index: 0, message: { role: 'assistant', content: e2ee ? e2eeSeal(client, content) : content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: Math.round(user.length / 4), completion_tokens: 200 }
        });
        if (e2ee) {
          const signed = `${model}:${hex(sha256(body))}:${hex(sha256(utf8(out)))}`;
          const said = tampered?.how === 'reply-signature' ? `${model}:${hex(sha256(body))}:${hex(randomBytes(32))}` : signed;
          signatures.set(id, { text: said, signature: hex(ed25519.sign(utf8(said), notes.seed)), key: hex(notes.key) });
        }
        return reply(res, 200, out);
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
      NEAR_AI_BASE_URL: `${origin}/v1`, NEAR_AI_API_KEY: apiKey, NEAR_AI_STT_URL: `${origin}/direct/whisper`,
      INTEL_PCS_URL: i.pcsUrl, INTEL_ROOT_CA: i.rootPem, NVIDIA_NRAS_URL: n.nrasUrl, NVIDIA_ROOT_CA: n.rootPem
    },
    calls, received, prompts,
    keys: () => ({ transcript: hex(models.transcript.key), notes: hex(models.notes.key) }),
    composes: () => ({ transcript: hex(sha256(utf8(models.transcript.compose))), notes: hex(sha256(utf8(models.notes.compose))), gateway: hex(sha256(utf8(gateway.compose))) }),
    tamper(how, of = 'model') {
      tampered = how ? { how, of } : null;
      i.expired = how === 'expired';
      n.verdict = how === 'gpu' ? 'fail' : 'pass';
    },
    rotate(task) {
      const m = models[task];
      models[task] = { ...machine(m.name, m.compose, m.ohttp ? ohttpIds++ : null), compose: m.compose, appId: m.appId };
    },
    verdictLifetime(seconds) { n.lifetime = seconds; },
    failNext(count, how) { failing = count; failure = how; },
    slowNext(ms) { slow = ms; },
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}
