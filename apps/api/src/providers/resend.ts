/*
 * Resend, which sends Alcove's email (docs: Privacy, keys and sessions › Email): one email to one address, by its REST API
 * with `fetch`, its replies parsed here. Every send carries an `Idempotency-Key` (the outbox row's ID), so a send tried again
 * after an answer that never came is sent once. What came of it is all this says: sent; worth trying again (Resend is
 * busy, failing or didn't answer: after its `retry-after`, when it says one); or not, as Resend refused it, with Resend's
 * name for why. Its own words never leave here: they may quote the address.
 */
import { z } from 'zod';
import type { Keyless } from '../platform/config';

/** How long a send may take before it counts as no answer. */
const SEND_MS = 15_000;

/** An email as Resend takes it: one address, its reply-to, both bodies, its own headers and its pictures, attached inline. */
export interface ResendEmail {
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  inline: { contentId: string; filename: string; contentType: string; content: string }[];
}

/**
 * What came of a send. `id`: Resend's own for the email, which its dashboard finds it by and which names no one (null when its
 * answer didn't say). `afterMs`: when Resend said to try again (`retry-after`), if it did.
 */
export type SendOutcome =
  | { outcome: 'sent'; status: number; id: string | null }
  | { outcome: 'retry'; status: number | null; name: string | null; afterMs: number | null }
  | { outcome: 'drop'; status: number; name: string | null };

const Sent = z.object({ id: z.string().min(1).max(200) });
/** Resend's error: its `name` is a code (`validation_error`, `rate_limit_exceeded`), safe to log; its `message` isn't kept. */
const Failed = z.object({ name: z.string().regex(/^[a-z0-9_]{1,80}$/) }).catch({ name: 'unknown' });

/** `retry-after` as Resend sends it: seconds, or an HTTP date. Null when there's none, or it can't be read. */
function retryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Sends one email with Resend, from `from`, keyed by `idempotencyKey`. Never throws: whatever happens is an outcome. */
export async function sendWithResend(cfg: Pick<Keyless, 'RESEND_API_URL'> & { RESEND_API_KEY: string }, from: string, idempotencyKey: string, email: ResendEmail): Promise<SendOutcome> {
  const body = {
    from, to: [email.to], subject: email.subject, html: email.html, text: email.text,
    ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    ...(Object.keys(email.headers).length ? { headers: email.headers } : {}),
    ...(email.inline.length ? { attachments: email.inline.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType, content_id: a.contentId })) } : {})
  };
  let res: Response;
  try {
    res = await fetch(`${cfg.RESEND_API_URL.replace(/\/$/, '')}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_MS)
    });
  } catch {
    // It didn't answer, or couldn't be reached: the same email, under the same key, is tried again later.
    return { outcome: 'retry', status: null, name: null, afterMs: null };
  }
  if (res.ok) {
    // Sent, whatever it said: an answer that doesn't read is still a 2xx, and the same key never sends it twice.
    const sent = Sent.safeParse(await res.json().catch(() => null));
    return { outcome: 'sent', status: res.status, id: sent.success ? sent.data.id : null };
  }
  const { name } = Failed.parse(await res.json().catch(() => null));
  if (res.status === 429 || res.status >= 500) return { outcome: 'retry', status: res.status, name, afterMs: retryAfter(res.headers.get('retry-after'), Date.now()) };
  return { outcome: 'drop', status: res.status, name };
}
