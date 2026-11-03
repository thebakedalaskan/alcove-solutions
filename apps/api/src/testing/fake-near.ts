/*
 * A stand-in for NEAR AI Cloud, for integration tests: the OpenAI-style speech-to-text and chat
 * endpoints the API calls, behind a bearer key. Speech is "recognised" from a marker a test writes
 * into the WAV samples (see `speechWav`), so a test decides exactly what was said; a clip without
 * one is heard the way Whisper hears silence. The notes model writes from the transcript it was
 * sent, so tests can see the transcript arrived intact and the reply was checked before use.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface FakeNear {
  /** What the API is configured with: NEAR_AI_BASE_URL and NEAR_AI_API_KEY. */
  baseUrl: string;
  apiKey: string;
  /** Every request, oldest first: which endpoint, which model, and how many bytes came with it. */
  calls: { path: string; model: string; bytes: number }[];
  /** What the notes model was sent (the user message), oldest first. */
  prompts: string[];
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function raw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks);
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The words in a clip's samples, or null when it's "silence". */
function wordsIn(wav: Buffer): string | null {
  const m = /TEXT:([^|]*)\|/.exec(wav.subarray(44).toString('utf8'));
  return m ? (m[1] ?? '') : null;
}

interface Heard { at: number; who: string; text: string }
/** Reads back "[mm:ss] Name: words" lines from a prompt. */
function heardIn(prompt: string): Heard[] {
  return prompt.split('\n').flatMap((l) => {
    const m = /^\[(\d+):(\d\d)\] (?:([^:]+): )?(.*)$/.exec(l);
    return m ? [{ at: Number(m[1]) * 60 + Number(m[2]), who: m[3] ?? '', text: m[4] ?? '' }] : [];
  });
}

export async function startFakeNear(): Promise<FakeNear> {
  const apiKey = `near-test-${Math.random().toString(36).slice(2)}`;
  const calls: FakeNear['calls'] = [];
  const prompts: string[] = [];
  let failing = 0;
  let failure: 'down' | 'prose' = 'down';
  let slow = 0;

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const body = await raw(req);
      if (req.headers.authorization !== `Bearer ${apiKey}`) return send(res, 401, { error: { message: 'Invalid API key' } });

      if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
        const form = await new Request('http://fake', { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: new Uint8Array(body) }).formData();
        const file = form.get('file');
        const model = str(form.get('model'));
        if (!(file instanceof Blob) || !model) return send(res, 400, { error: { message: 'file and model are required' } });
        const wav = Buffer.from(await file.arrayBuffer());
        calls.push({ path: url.pathname, model, bytes: wav.length });
        if (wav.subarray(0, 4).toString('ascii') !== 'RIFF') return send(res, 400, { error: { message: 'Unsupported audio format' } });
        const seconds = Math.max(0, wav.length - 44) / 32_000;
        const words = wordsIn(wav);
        // Silence: Whisper's favourite hallucination, with high confidence, as the real one does.
        const said = words === null ? [' Thank you.'] : words.split(' // ').map((w) => ` ${w}`);
        const segments = said.map((text, i) => ({ id: i, seek: 0, start: i * 2, end: Math.min(seconds, i * 2 + 1.8), text, tokens: [], temperature: 0, avg_logprob: -0.2, compression_ratio: 1.1, no_speech_prob: 0.01 }));
        return send(res, 200, { text: said.join(''), duration: seconds, language: 'en', segments });
      }

      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const parsed: unknown = JSON.parse(body.toString('utf8'));
        const o = typeof parsed === 'object' && parsed !== null ? parsed : {};
        const model = 'model' in o ? str(o.model) : '';
        const messages = 'messages' in o && Array.isArray(o.messages) ? o.messages : [];
        const text = (role: string) => str(messages.map((m: unknown) => (typeof m === 'object' && m !== null && 'role' in m && m.role === role && 'content' in m ? m.content : '')).find(Boolean));
        const system = text('system');
        const user = text('user');
        calls.push({ path: url.pathname, model, bytes: body.length });
        prompts.push(user);
        if (slow) { const ms = slow; slow = 0; await new Promise((r) => setTimeout(r, ms)); }
        if (failing > 0) {
          failing--;
          if (failure === 'down') return send(res, 503, { error: { message: 'Service unavailable' } });
          return send(res, 200, { choices: [{ message: { role: 'assistant', content: 'Here are your notes! The team talked about a few things.' }, finish_reason: 'stop' }] });
        }
        const heard = heardIn(user);
        let reply: unknown;
        const item = (h: Heard) => ({ text: h.text, at: h.at });
        if (system.startsWith('You help someone catch up')) {
          reply = {
            summary: `Catching up on ${heard.length} lines.`,
            decided: heard.filter((h) => /\b(agreed|decided)\b/i.test(h.text)).map(item),
            proposed: heard.filter((h) => /\b(should|let's|what if|propose)\b/i.test(h.text)).map(item),
            open: heard.filter((h) => h.text.trim().endsWith('?')).map(item),
            next: heard.filter((h) => /\bwill\b/i.test(h.text)).map((h) => ({ ...item(h), owner: /^(\w+) will\b/.exec(h.text)?.[1] ?? null, due: /\bby (\w+day)\b/i.exec(h.text)?.[1] ?? null }))
          };
        } else if (system.startsWith('You translate')) {
          // "Translates" by tagging each line with the language, so tests can see which lines went and came back.
          const asked: unknown = JSON.parse(user);
          const o2 = typeof asked === 'object' && asked !== null ? asked : {};
          const language = 'language' in o2 ? str(o2.language) : '';
          const lines = 'lines' in o2 && Array.isArray(o2.lines) ? o2.lines : [];
          reply = { lines: lines.flatMap((l: unknown) => (typeof l === 'object' && l !== null && 'id' in l && 'text' in l ? [{ id: str(l.id), text: `[${language}] ${str(l.text)}` }] : [])) };
        } else if (system.startsWith('You write the notes')) {
          reply = {
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
        } else {
          const question = /\nQuestion: (.*)$/s.exec(user)?.[1] ?? '';
          const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
          const hit = heard.find((h) => words.some((w) => h.text.toLowerCase().includes(w)));
          reply = { answer: hit ? `From the call: ${hit.text}` : 'That wasn’t covered in the call.', moments: hit ? [hit.at] : [] };
        }
        return send(res, 200, { id: 'chatcmpl-test', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(reply) }, finish_reason: 'stop' }], usage: { prompt_tokens: Math.round(user.length / 4), completion_tokens: 200 } });
      }
      send(res, 404, { error: { message: 'Not found' } });
    })().catch(() => send(res, 500, { error: { message: 'fake failed' } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`, apiKey, calls, prompts,
    failNext(n, how) { failing = n; failure = how; },
    slowNext(ms) { slow = ms; },
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}
