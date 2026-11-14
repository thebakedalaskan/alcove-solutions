/*
 * The email Alcove sends (docs: Privacy, keys and sessions › Email), through an outbox, so a slow or failing Resend never
 * fails what asked for an email: whatever needs one writes it in its own transaction (`queueMail`), sealed under a key worked
 * out from KSERVICE (`alcove/mail-outbox/v1`), its header bound to the row's ID. After that commits it's sent at once
 * (`kickMail`), without holding the request's answer, and every upkeep pass sends what's due (`sendMail`). A send is claimed
 * for a few minutes first, so two instances never send one row at once, and carries the row's ID as its idempotency key, so
 * a send tried again after an answer that never came goes once. Sent: the row goes. Resend busy, failing or not answering:
 * tried again later, at most TRIES times over a day, then given up on at warn. Refused: given up on at error, with Resend's
 * name for why. Without RESEND_API_KEY nothing is sent: each row goes as it's due, said at info. Resend's status and its
 * error's name are `upstreamStatus` and `upstreamError` in a line, as another service's are: `status` is Alcove's answer.
 *
 * Whether an email goes is decided here, as it's claimed, never by whoever asked for it, so nothing in a request's path
 * (its answer, or how long it takes) depends on it: an address that stopped Alcove's emails (`stopMail`, with the token every
 * email carries, `stopToken`) is sent nothing; an address that's had `mail.address_per_day` emails in a day from all of Alcove
 * is sent no more that day; and an email its sender's own limits held back (`send: null`) never goes. Each address is taken
 * in its canonical form for these (`canonicalAddress`), so the ways of writing one mailbox share them, while every email goes
 * to the address exactly as it was typed. Who sent what to which address is `mail_sends` (`recordSend`), by keyed hashes
 * alone. At most `mail.per_day` emails go in a day (UTC), all of Alcove's (`mail_days`): past it, what's due waits for the
 * next day. Logs carry a row's ID, Resend's status and its name for an error, never an address or a word of what an email
 * says.
 */
import { z } from 'zod';
import type { Config } from './config';
import type { Deps } from './context';
import { b64u, blindIndex, concat, equalBytes, id128, mac, mailOutboxKey, mailStopKey, openJson, sealJson, toJson, unb64u, utf8 } from '../keys/crypto';
import { indexKey } from '../keys/owners';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from './db';
import { limitsNow } from './limits';
import { log } from './log';
import { sendWithResend, type ResendEmail } from '../providers/resend';

const mlog = log.child({ component: 'mail' });

/** What sending reads of the service: the database, KSERVICE and the index key, the limits, and Resend's settings. */
export type Mailer = Pick<Deps, 'pool'> & { cfg: Pick<Config, 'KSERVICE' | 'INDEX_KEY' | 'LIMITS_CACHE_MS' | 'RESEND_API_KEY' | 'RESEND_API_URL' | 'MAIL_FROM'> };

/** How many sends one email gets, and how long after each that didn't go the next is tried: about 15 hours in all. */
export const TRIES = 8;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 3_600_000, 2 * 3_600_000, 4 * 3_600_000, 8 * 3_600_000];
/** How long a claimed row is held while it's sent: past it, a send that never finished (its instance went) is tried again. */
const CLAIM_MS = 5 * 60_000;
/** How many emails one pass sends at most. */
const BATCH = 100;
const DAY_MS = 86_400_000;

/**
 * An email as the outbox keeps it, sealed: everything Resend is sent but who it's from, which is MAIL_FROM; and the send it's
 * of (`mail_sends`), which is null when its sender's own limits held it back, so it never goes.
 */
const Outgoing = z.object({
  to: z.string(), replyTo: z.string().nullable(), subject: z.string(), html: z.string(), text: z.string(),
  headers: z.record(z.string(), z.string()),
  inline: z.array(z.object({ contentId: z.string(), filename: z.string(), contentType: z.string(), content: z.string() })),
  sendId: z.string().nullable()
});
type Outgoing = z.infer<typeof Outgoing>;
const header = (mailId: string) => ({ v: 1 as const, kind: 'mail', ownerId: '', mailId });
/** The outbox's key, for one use: the caller zeroes it. */
const outboxKey = (d: Pick<Mailer, 'cfg'>) => mailOutboxKey(unb64u(d.cfg.KSERVICE, 32));

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);
/** The next day (UTC) after `at` begins. */
const nextDay = (at: number): number => { const d = new Date(at); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

/* ---------- one mailbox ---------- */

/** Where a dot in the name means nothing, and the domain is one of two names for the same mail. */
const GMAIL = new Set(['gmail.com', 'googlemail.com']);
/**
 * An address as one mailbox, for its caps and for stopping Alcove's emails: lower-cased, without a `+tag` (at any domain),
 * and at Gmail without dots in the name and at gmail.com, which googlemail.com is too. So `Sam.Kowalski+work@googlemail.com`
 * is `samkowalski@gmail.com`. Never where an email goes, which is the address exactly as it was typed, nor how the app finds
 * an invitation for someone, which is the address they sign in with.
 */
export function canonicalAddress(address: string): string {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf('@');
  if (at <= 0) return a;
  let name = a.slice(0, at);
  let domain = a.slice(at + 1);
  const tag = name.indexOf('+');
  if (tag > 0) name = name.slice(0, tag);
  if (GMAIL.has(domain)) {
    name = name.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${name}@${domain}`;
}
/** How an address's sends are found, opening nothing: a blind index of its canonical form, `mail-address`. */
export function mailAddressIndex(d: Pick<Mailer, 'cfg'>, address: string): Uint8Array {
  const key = indexKey(d);
  try { return blindIndex(key, 'mail-address', canonicalAddress(address)); } finally { key.fill(0); }
}
/** Who sent them (a team, by its ID), as a keyed hash: `mail-sender`. */
export function mailSenderIndex(d: Pick<Mailer, 'cfg'>, sender: string): Uint8Array {
  const key = indexKey(d);
  try { return blindIndex(key, 'mail-sender', sender); } finally { key.fill(0); }
}

/**
 * Says that `sender` (a team) sent `address` something now, in the caller's transaction, whether or not an email of it goes:
 * what its own limits count (`sendsBy`). Says the send's ID, which the email of it carries, so the address's day counts it
 * once it goes.
 */
export async function recordSend(d: Pick<Mailer, 'cfg'>, db: Db, sender: string, address: string, now: number): Promise<string> {
  const sendId = id128();
  await exec(db, 'INSERT INTO mail_sends (send_id, address_index, sender_index, sent_at) VALUES ($1, $2, $3, $4)', [sendId, mailAddressIndex(d, address), mailSenderIndex(d, sender), new Date(now)]);
  return sendId;
}
/**
 * When `sender` sent each address something since `since`, oldest first, by the address's index (base64url): its own doing
 * alone, never whether an email went, nor what anyone else sent.
 */
export async function sendsBy(d: Pick<Mailer, 'cfg'>, db: Db, sender: string, since: number): Promise<Map<string, number[]>> {
  const found = await rows(db, z.object({ address_index: bytea, sent_at: timestamp }), 'SELECT address_index, sent_at FROM mail_sends WHERE sender_index = $1 AND sent_at > $2 ORDER BY sent_at, send_id',
    [mailSenderIndex(d, sender), new Date(since)]);
  const by = new Map<string, number[]>();
  for (const s of found) by.set(b64u(s.address_index), [...(by.get(b64u(s.address_index)) ?? []), s.sent_at.getTime()]);
  return by;
}
/** Forgets the sends made before `before`. Says how many went. */
export const pruneSends = (d: Pick<Deps, 'pool'>, before: number): Promise<number> =>
  exec(d.pool, 'DELETE FROM mail_sends WHERE sent_at <= $1', [new Date(before)]);

/* ---------- stopping them ---------- */

/** Each half of a stop token: what it names (a keyed hash of the address's canonical form), then a check that Alcove made it. */
const HALF = 16;
const named = (key: Uint8Array, address: string) => mac(key, utf8(`address\u0000${canonicalAddress(address)}`)).slice(0, HALF);
const check = (key: Uint8Array, name: Uint8Array) => mac(key, concat(utf8('check\u0000'), name)).slice(0, HALF);
/** Finds a stopped address by what its token names, never by the address: a blind index of it, `mail-stop`. */
function stopIndex(d: Pick<Mailer, 'cfg'>, name: Uint8Array): Uint8Array {
  const key = indexKey(d);
  try { return blindIndex(key, 'mail-stop', b64u(name)); } finally { key.fill(0); }
}

/**
 * The token that stops Alcove's emails to `address`, as every email to it carries it: the same each time, and for every way
 * of writing the address (`canonicalAddress`), naming nobody, and made only here (an HMAC under a key from KSERVICE,
 * `alcove/mail-stop/v1`, and a check of its own), so nobody can make one for someone else's address. 32 bytes, base64url.
 */
export function stopToken(d: Pick<Mailer, 'cfg'>, address: string): string {
  const key = mailStopKey(unb64u(d.cfg.KSERVICE, 32));
  try { const n = named(key, address); return b64u(concat(n, check(key, n))); } finally { key.fill(0); }
}

/** Whether `address`, or any way of writing it, stopped Alcove's emails. */
export async function stopped(d: Pick<Mailer, 'cfg'>, db: Db, address: string): Promise<boolean> {
  const key = mailStopKey(unb64u(d.cfg.KSERVICE, 32));
  let index: Uint8Array;
  try { index = stopIndex(d, named(key, address)); } finally { key.fill(0); }
  return (await maybeOne(db, z.object({ one: z.number() }), 'SELECT 1 AS one FROM mail_stops WHERE address_index = $1', [index])) !== undefined;
}

/**
 * Stops Alcove's emails to the address a token names: from then on nothing is sent to it, and nothing waiting goes. Says
 * what came of it, for its caller's log alone: whoever sent it is answered the same, whatever it was. `refused`: Alcove didn't
 * make the token (made up, or cut short).
 */
export async function stopMail(d: Mailer, token: string): Promise<'stopped' | 'already' | 'refused'> {
  let raw: Uint8Array;
  try { raw = unb64u(token, 2 * HALF); } catch { return 'refused'; }
  const name = raw.slice(0, HALF);
  const key = mailStopKey(unb64u(d.cfg.KSERVICE, 32));
  let made: boolean;
  try { made = equalBytes(raw.slice(HALF), check(key, name)); } finally { key.fill(0); }
  if (!made) return 'refused';
  const n = await exec(d.pool, 'INSERT INTO mail_stops (address_index) VALUES ($1) ON CONFLICT DO NOTHING', [stopIndex(d, name)]);
  return n ? 'stopped' : 'already';
}

/* ---------- the outbox ---------- */

/**
 * Puts an email in the outbox, in the caller's transaction: it's sent once that commits (`kickMail`), or by upkeep, if it
 * goes at all (`heldBack`). `of`: the invitation it's of, which it goes with if that goes first, unsent, and the send it is
 * (`recordSend`), or null when its sender's own limits hold it back. Says its ID.
 */
export async function queueMail(d: Pick<Mailer, 'cfg'>, db: Db, email: ResendEmail, of: { invitationId: string; sendId: string | null }): Promise<string> {
  const mailId = id128();
  const key = outboxKey(d);
  const outgoing: Outgoing = { ...email, sendId: of.sendId };
  try {
    await exec(db, 'INSERT INTO mail_outbox (mail_id, invitation_id, send_after, attempts, ciphertext) VALUES ($1, $2, $3, 0, $4)', [mailId, of.invitationId, new Date(), sealJson(key, header(mailId), toJson(outgoing))]);
  } finally { key.fill(0); }
  return mailId;
}

/** What one pass of the outbox did: emails sent, put off to try again, and given up on; and whether the day's were all sent. */
export interface MailPass { sent: number; retried: number; dropped: number; full: number }

/** One row claimed for a send: its ID, which try this is, what it says, and the day it counts against (null: none). */
interface Claimed { mailId: string; attempts: number; email: Outgoing; day: string | null }
const ClaimRow = z.object({ mail_id: z.string(), attempts: z.number(), ciphertext: bytea });

/**
 * Why an email doesn't go, decided as it's claimed (null: it goes): its sender's own limits held it back (`held`), its address
 * stopped Alcove's emails (`stopped`), or its address has had `mail.address_per_day` emails in the last day from all of Alcove
 * (`address`), this one's own earlier try aside. The address's sends are held for the rest of the claim, so two claims at
 * once never both take its last place in the day.
 */
async function heldBack(d: Mailer, c: Db, email: Outgoing, most: number, now: number): Promise<'held' | 'stopped' | 'address' | null> {
  if (email.sendId === null) return 'held';
  if (await stopped(d, c, email.to)) return 'stopped';
  const index = mailAddressIndex(d, email.to);
  await exec(c, "SELECT pg_advisory_xact_lock(hashtext('alcove/mail-address'), hashtext($1))", [b64u(index)]);
  const had = await maybeOne(c, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM mail_sends WHERE address_index = $1 AND emailed_at > $2 AND send_id <> $3',
    [index, new Date(now - DAY_MS), email.sendId]);
  return (had?.n ?? 0) >= most ? 'address' : null;
}

/**
 * Claims the next email that's due, in a transaction of its own: one nobody else is sending, that goes (`heldBack`; one that
 * doesn't is taken out, said at info), counted against the day's `mail.per_day` and its address's day, and held for
 * CLAIM_MS. Without a provider it's taken out as it is, said at info. With the day's all sent, everything due waits for the
 * next day. Null: nothing's due.
 */
async function claim(d: Mailer, now: number): Promise<Claimed | 'gone' | 'dropped' | 'full' | null> {
  return tx(d.pool, async (c) => {
    const row = await maybeOne(c, ClaimRow, 'SELECT mail_id, attempts, ciphertext FROM mail_outbox WHERE send_after <= $1 ORDER BY send_after LIMIT 1 FOR UPDATE SKIP LOCKED', [new Date(now)]);
    if (!row) return null;
    const at = { mailId: row.mail_id, attempts: row.attempts };
    const drop = () => exec(c, 'DELETE FROM mail_outbox WHERE mail_id = $1', [row.mail_id]);
    if (!d.cfg.RESEND_API_KEY) {
      await drop();
      mlog.info('mail not sent: no provider', { mailId: row.mail_id });
      return 'gone';
    }
    let email: Outgoing;
    const key = outboxKey(d);
    try {
      email = openJson(key, header(row.mail_id), row.ciphertext, Outgoing);
    } catch (e) {
      await drop();
      mlog.error('mail dropped', { ...at, why: 'unreadable', err: e });
      return 'dropped';
    } finally { key.fill(0); }
    const l = await limitsNow(d, c);
    const why = await heldBack(d, c, email, l.get('mail.address_per_day'), now);
    if (why) {
      await drop();
      mlog.info('mail dropped', { ...at, why });
      return 'dropped';
    }
    const day = dayOf(now);
    const most = l.get('mail.per_day');
    const counted = most > 0 ? await maybeOne(c, z.object({ sent: z.number() }), `INSERT INTO mail_days (day, sent) VALUES ($1, 1)
      ON CONFLICT (day) DO UPDATE SET sent = mail_days.sent + 1 WHERE mail_days.sent < $2 RETURNING sent`, [day, most]) : undefined;
    if (!counted) {
      const waiting = await exec(c, 'UPDATE mail_outbox SET send_after = $2 WHERE send_after <= $1', [new Date(now), new Date(nextDay(now))]);
      mlog.info('mail waits for tomorrow: the day’s emails have gone', { waiting, most });
      return 'full';
    }
    // Its address's place in the day is taken as it's claimed, and given back if it doesn't go.
    await exec(c, 'UPDATE mail_sends SET emailed_at = $2 WHERE send_id = $1', [email.sendId, new Date(now)]);
    await exec(c, 'UPDATE mail_outbox SET attempts = attempts + 1, send_after = $2 WHERE mail_id = $1', [row.mail_id, new Date(now + CLAIM_MS)]);
    return { mailId: row.mail_id, attempts: row.attempts + 1, email, day };
  });
}

/** An email that didn't go gives its place back: in the day, and, once it's given up on, in its address's day. */
const uncount = (d: Mailer, day: string | null) => (day === null ? Promise.resolve(0) : exec(d.pool, 'UPDATE mail_days SET sent = sent - 1 WHERE day = $1 AND sent > 0', [day]));
const unsent = (d: Mailer, m: Claimed) => exec(d.pool, 'UPDATE mail_sends SET emailed_at = NULL WHERE send_id = $1', [m.email.sendId]);

/** Sends one claimed email and says what came of it, taking the row out or putting it off. */
async function deliver(d: Mailer & { cfg: { RESEND_API_KEY: string } }, m: Claimed, now: number): Promise<'sent' | 'retried' | 'dropped'> {
  const at = { mailId: m.mailId, attempts: m.attempts };
  const r = await sendWithResend(d.cfg, d.cfg.MAIL_FROM, m.mailId, m.email);
  if (r.outcome === 'sent') {
    await exec(d.pool, 'DELETE FROM mail_outbox WHERE mail_id = $1', [m.mailId]);
    mlog.info('mail sent', { ...at, upstreamStatus: r.status, resendId: r.id });
    return 'sent';
  }
  await uncount(d, m.day);
  if (r.outcome === 'drop') {
    await exec(d.pool, 'DELETE FROM mail_outbox WHERE mail_id = $1', [m.mailId]);
    await unsent(d, m);
    mlog.error('mail dropped', { ...at, why: 'refused', upstreamStatus: r.status, upstreamError: r.name });
    return 'dropped';
  }
  if (m.attempts >= TRIES) {
    await exec(d.pool, 'DELETE FROM mail_outbox WHERE mail_id = $1', [m.mailId]);
    await unsent(d, m);
    mlog.warn('mail dropped', { ...at, why: 'tries', upstreamStatus: r.status, upstreamError: r.name });
    return 'dropped';
  }
  // The wait after this try, or longer when Resend says so; only this claim's, so one taken over by another instance is left.
  // Its address's place in the day stays taken meanwhile: Resend may have sent it, and its next try goes as the same email.
  const afterMs = Math.max(BACKOFF_MS[m.attempts - 1] ?? BACKOFF_MS.at(-1) ?? 0, r.afterMs ?? 0);
  await exec(d.pool, 'UPDATE mail_outbox SET send_after = $2 WHERE mail_id = $1 AND attempts = $3', [m.mailId, new Date(now + afterMs), m.attempts]);
  mlog.info('mail retried', { ...at, upstreamStatus: r.status, upstreamError: r.name, afterMs });
  return 'retried';
}

/**
 * Sends what's due in the outbox, up to BATCH, one claimed at a time: what right after a commit (`kickMail`) and upkeep
 * do. Once Resend is busy, failing or not answering the pass stops, so it isn't asked again at once: what's left goes when
 * its time comes. Never throws for an email that didn't go: each says what came of it in the log.
 */
export async function sendMail(d: Mailer): Promise<MailPass> {
  const pass: MailPass = { sent: 0, retried: 0, dropped: 0, full: 0 };
  for (let n = 0; n < BATCH; n++) {
    const now = Date.now();
    const m = await claim(d, now);
    if (m === null) break;
    if (m === 'full') { pass.full = 1; break; }
    if (m === 'gone' || m === 'dropped') { pass.dropped++; continue; }
    const { RESEND_API_KEY } = d.cfg;
    if (!RESEND_API_KEY) break;
    const outcome = await deliver({ ...d, cfg: { ...d.cfg, RESEND_API_KEY } }, m, now);
    pass[outcome]++;
    if (outcome === 'retried') break;
  }
  return pass;
}

/** Sends what's due now, once a transaction that queued mail has committed, without its request waiting for it. */
export function kickMail(d: Mailer): void {
  void sendMail(d).catch((e: unknown) => mlog.warn('mail not sent now; upkeep sends it', { err: e }));
}

/** Forgets the days before yesterday's count of emails sent. Says how many went. */
export const pruneMailDays = (d: Pick<Deps, 'pool'>): Promise<number> =>
  exec(d.pool, 'DELETE FROM mail_days WHERE day < $1', [dayOf(Date.now() - DAY_MS)]);
