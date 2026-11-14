/*
 * A stand-in for Resend, for integration tests: POST /emails in Resend's own shapes, answered as Resend answers, and an email
 * sent once for each idempotency key, as Resend sends one, so a send tried again after an answer that never arrived is still
 * one email. Every request is kept (its idempotency key, its API key, and what came of it), and every email sent. It can be
 * made to answer what comes next as Resend busy (429, with a `retry-after`), failing (500) or refusing (422, with an error's
 * name), or to send an email and lose its answer (`lost`: the connection goes before it's answered), as a send whose answer
 * never arrived. Resend not there at all is a closed port.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';

/** An email as Resend takes it at POST /emails, and as this stand-in checks it: anything else is refused as Resend refuses it. */
const EmailBody = z.object({
  from: z.string().min(1),
  to: z.array(z.string().email()).min(1).max(50),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
  reply_to: z.string().email().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  attachments: z.array(z.object({ filename: z.string().min(1), content: z.string().min(1), content_type: z.string().min(1), content_id: z.string().min(1) })).optional()
}).strict();
export type SentEmail = z.infer<typeof EmailBody> & { id: string; key: string };

/** How the next requests are answered instead of sending (`lost`: sent, and the answer lost on the way). */
export type Failure = { status: 429; retryAfter?: number | undefined } | { status: 500 } | { status: 422; name?: string | undefined } | { status: 'lost' };

export interface FakeResend {
  /** What the API is configured with to use this Resend. */
  settings: { RESEND_API_URL: string; RESEND_API_KEY: string };
  /** Every request, oldest first: its idempotency key, the API key it carried, and the status it was answered with. */
  requests: { key: string | null; apiKey: string | null; status: number }[];
  /** Every email sent, once for each idempotency key, oldest first. */
  sent: SentEmail[];
  /** The next `n` requests are answered as `how`, and send nothing. */
  fail(n: number, how: Failure): void;
  close(): Promise<void>;
}

async function text(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString('utf8');
}
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export async function startFakeResend(): Promise<FakeResend> {
  const apiKey = `re_test_${randomUUID().replace(/-/g, '')}`;
  const requests: FakeResend['requests'] = [];
  const sent: SentEmail[] = [];
  /** Each idempotency key's first answer, which a send under it again gets, sending nothing more. */
  const answered = new Map<string, { id: string }>();
  const failures: Failure[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const body = await text(req);
      const key = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null;
      const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? null;
      const answer = (status: number, out: unknown, headers: Record<string, string> = {}) => { requests.push({ key, apiKey: bearer, status }); send(res, status, out, headers); };
      if (req.method !== 'POST' || req.url !== '/emails') return answer(404, { statusCode: 404, name: 'not_found', message: 'The requested endpoint does not exist.' });
      if (bearer !== apiKey) return answer(401, { statusCode: 401, name: 'missing_api_key', message: 'Missing API key in the authorization header.' });
      const failing = failures.shift();
      if (failing?.status === 429) return answer(429, { statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests.' }, failing.retryAfter === undefined ? {} : { 'retry-after': String(failing.retryAfter) });
      if (failing?.status === 500) return answer(500, { statusCode: 500, name: 'application_error', message: 'An unexpected error occurred.' });
      if (failing?.status === 422) return answer(422, { statusCode: 422, name: failing.name ?? 'validation_error', message: 'Invalid `to` field.' });
      const seen = key === null ? undefined : answered.get(key);
      if (seen) return answer(200, seen);
      const parsed = EmailBody.safeParse(JSON.parse(body || 'null'));
      if (!parsed.success) return answer(422, { statusCode: 422, name: 'validation_error', message: parsed.error.issues.map((i) => i.path.join('.')).join(', ') });
      const id = randomUUID();
      sent.push({ ...parsed.data, id, key: key ?? '' });
      if (key !== null) answered.set(key, { id });
      if (failing?.status === 'lost') { requests.push({ key, apiKey: bearer, status: 0 }); req.socket.destroy(); return; }
      return answer(200, { id });
    })().catch(() => { if (!res.headersSent) send(res, 500, { statusCode: 500, name: 'application_error', message: 'The stand-in failed.' }); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    settings: { RESEND_API_URL: `http://127.0.0.1:${port}`, RESEND_API_KEY: apiKey },
    requests, sent,
    fail(n, how) { for (let i = 0; i < n; i++) failures.push(how); },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })
  };
}
