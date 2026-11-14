/*
 * The certificate the edge serves (docs: system-architecture › The edge), kept in tls_certificates: a certificate is public,
 * and Certificate Transparency logs publish it anyway. Every instance serves the one stored there, when it's for the TLS key
 * and names every TLS host. Until there's one, an instance can't serve TLS at all, so it gets one before it listens: one
 * instance orders it, holding an advisory lock, and the others wait for it to be stored. After that each instance looks
 * again every 12 hours: one orders the next certificate once fewer than 30 days are left, and each serves whichever is the
 * newest stored. The lock is held on a connection of its own, never one of the pool's, which requests need meanwhile.
 */
import { X509Certificate, createPublicKey, type KeyObject } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { equalBytes } from '../keys/crypto';
import { createPool, exec, maybeOne, timestamp, type Db } from '../platform/db';
import { log } from '../platform/log';
import { facts, failureCode, runs } from '../platform/runs';
import type { Ordered } from './acme';

const clog = log.child({ component: 'edge' });

/** Any fixed number: whichever instance holds this advisory lock is the one ordering a certificate. */
const LOCK = 4_120_773;
const RENEW_MS = 30 * 86_400_000;
const CHECK_MS = 12 * 3_600_000;
/** While another instance orders the first certificate, how often this one looks for it. */
const WAITING_MS = 3_000;
/** After an order fails, how long before the next, at first and at most. */
const FIRST_RETRY_MS = 30_000;
const LONGEST_RETRY_MS = 30 * 60_000;

/** A certificate, its chain as PEM, when it runs out, and when it was stored. */
export interface Certificate { chainPem: string; notAfter: Date; storedAt: Date }

const Stored = z.object({ chain_pem: z.string(), not_after: timestamp, updated_at: timestamp });
async function stored(db: Db): Promise<Certificate | undefined> {
  const r = await maybeOne(db, Stored, "SELECT chain_pem, not_after, updated_at FROM tls_certificates WHERE id = 'current'");
  return r ? { chainPem: r.chain_pem, notAfter: r.not_after, storedAt: r.updated_at } : undefined;
}
async function store(db: Db, c: Certificate): Promise<void> {
  await exec(db, `INSERT INTO tls_certificates (id, chain_pem, not_after) VALUES ('current', $1, $2)
    ON CONFLICT (id) DO UPDATE SET chain_pem = EXCLUDED.chain_pem, not_after = EXCLUDED.not_after, updated_at = now()`, [c.chainPem, c.notAfter]);
}

/** Why a certificate can't be served: it doesn't read as one, it's for another key, it leaves out a host, or it ran out. */
export type Unservable = 'unreadable' | 'other-key' | 'host-missing' | 'expired';
/**
 * What `c` is, for `hosts` and the TLS key: how many host names it names, whether it's for `key` (null without one), and why
 * it can't be served, or null when it can.
 */
function judged(c: Certificate, key: KeyObject | undefined, hosts: readonly string[]): { hosts: number; spkiMatches: boolean | null; unservable: Unservable | null } {
  let cert: X509Certificate;
  try { cert = new X509Certificate(c.chainPem); } catch { return { hosts: 0, spkiMatches: null, unservable: 'unreadable' }; }
  const named = (cert.subjectAltName ?? '').split(',').filter((n) => n.trim().startsWith('DNS:')).length;
  const spkiMatches = key === undefined ? null : equalBytes(cert.publicKey.export({ type: 'spki', format: 'der' }), createPublicKey(key).export({ type: 'spki', format: 'der' }));
  const unservable = spkiMatches === false ? 'other-key' : !hosts.every((h) => cert.checkHost(h) !== undefined) ? 'host-missing'
    : new Date(cert.validTo).getTime() <= Date.now() ? 'expired' : null;
  return { hosts: named, spkiMatches, unservable };
}
/** Whether `c` can be served: for this key, naming every host, and not run out. */
const servable = (c: Certificate, key: KeyObject, hosts: readonly string[]): boolean => judged(c, key, hosts).unservable === null;
const due = (c: Certificate) => c.notAfter.getTime() - Date.now() < RENEW_MS;

/**
 * Whether a certificate running out at `notAfter` (Unix ms) is due a new one, as this edge orders them: not due while more
 * than RENEW_MS is left; due for the day after that, two looks (CHECK_MS) in which one instance orders it; past due once
 * that day has gone by without a newer one being served (operator release).
 */
export function renewalOf(notAfter: number, now: number): 'not due' | 'due' | 'past due' {
  const late = now - (notAfter - RENEW_MS);
  return late < 0 ? 'not due' : late < 2 * CHECK_MS ? 'due' : 'past due';
}

/**
 * Records the certificate this instance serves, for operators (operator release): how many hosts it names, whether its key
 * is ours, and how the last look at whether a newer one is due went.
 */
function recordServing(c: Certificate, key: KeyObject, lastCheck: { at: number; ok: boolean; code: string | null } | null): void {
  const { hosts, spkiMatches, unservable } = judged(c, key, []);
  if (unservable === 'unreadable') clog.warn('the tls certificate served couldn’t be read for operators');
  facts.set('certificate', { notAfter: c.notAfter.getTime(), storedAt: c.storedAt.getTime(), hosts, spkiMatches: spkiMatches ?? false, lastCheck });
}

/**
 * The certificate stored, as a start would find it, read only (the checks job, operator-job.ts): when it runs out, when it
 * was stored, and what it is for `hosts` and the TLS key (judged). A start that can't serve it orders another, which this
 * never does. `key`: the TLS key, when the master opened. Undefined when none is stored.
 */
export async function storedCertificate(db: Db, hosts: readonly string[], key: KeyObject | undefined) {
  const c = await stored(db);
  return c ? { notAfter: c.notAfter.getTime(), storedAt: c.storedAt.getTime(), ...judged(c, key, hosts) } : undefined;
}

/**
 * As the one instance holding the lock, orders a certificate unless one stored meanwhile will do: what's stored then.
 * `busy` while another instance holds it.
 */
async function orderAsTheOne(lock: pg.Pool, wanted: (c: Certificate | undefined) => boolean, order: () => Promise<Ordered>): Promise<Certificate | 'busy'> {
  const c = await lock.connect();
  let broken = false;
  try {
    const got = await maybeOne(c, z.object({ got: z.boolean() }), 'SELECT pg_try_advisory_lock($1) AS got', [LOCK]);
    if (!got?.got) return 'busy';
    try {
      const now = await stored(c);
      if (now && !wanted(now)) return now;
      const { chainPem, notAfter } = await order();
      const ordered = { chainPem, notAfter, storedAt: new Date() };
      await store(c, ordered);
      return ordered;
    } finally {
      await exec(c, 'SELECT pg_advisory_unlock($1)', [LOCK]).catch((e: unknown) => {
        // A connection that may still hold the lock never goes back to the pool.
        broken = true;
        clog.warn('certificate lock release failed; closing its connection', { err: e });
      });
    }
  } finally {
    c.release(broken);
  }
}

export interface Certificates {
  current(): Certificate;
  stop(): Promise<void>;
}

/**
 * The certificate to serve, got before anything listens: the stored one if it'll do, else one ordered by whichever instance
 * gets there first. Then, while running, the next one when it's due, which `replaced` is told of to serve it at once.
 * `databaseUrl`: where the lock is held, on a connection of its own.
 */
export async function certificates(o: { pool: pg.Pool; databaseUrl: string; hosts: readonly string[]; key: KeyObject; order: () => Promise<Ordered>; replaced(c: Certificate): void }): Promise<Certificates> {
  const usable = (c: Certificate | undefined): c is Certificate => c !== undefined && servable(c, o.key, o.hosts);
  const lock = createPool(o.databaseUrl, 1);
  let current = await stored(o.pool);
  if (usable(current)) clog.info('tls certificate found', { notAfter: current.notAfter.toISOString() });
  else clog.info('no tls certificate to serve yet; getting one', { stored: current !== undefined });
  let retry = FIRST_RETRY_MS;
  try {
    while (!usable(current)) {
      const got = await orderAsTheOne(lock, (c) => !usable(c), o.order).catch((e: unknown) => {
        clog.error('tls certificate not ordered; trying again', { retryMs: retry, err: e });
        return 'failed' as const;
      });
      if (got === 'busy' || got === 'failed') {
        if (got === 'busy') clog.debug('another instance is getting the tls certificate; waiting for it');
        await new Promise((r) => setTimeout(r, got === 'busy' ? WAITING_MS : retry));
        if (got === 'failed') retry = Math.min(retry * 2, LONGEST_RETRY_MS);
        current = await stored(o.pool);
      } else {
        current = got;
      }
    }
  } catch (e) {
    await lock.end();
    throw e;
  }
  let serving: Certificate = current;
  recordServing(serving, o.key, null);

  let checking = false;
  // Each check is a run operators see (`certificates`), and how it went is this instance's last check (operator release).
  const check = async () => {
    if (checking) return;
    checking = true;
    const run = runs.begin('certificates');
    let code: string | null = null;
    try {
      const latest = await stored(o.pool);
      if (usable(latest) && latest.chainPem !== serving.chainPem && latest.notAfter >= serving.notAfter) {
        serving = latest;
        o.replaced(latest);
        clog.info('tls certificate replaced', { notAfter: latest.notAfter.toISOString() });
      }
      if (!due(serving)) return;
      const got = await orderAsTheOne(lock, (c) => !usable(c) || due(c), o.order);
      if (got !== 'busy' && got.chainPem !== serving.chainPem && usable(got)) {
        serving = got;
        o.replaced(got);
        clog.info('tls certificate renewed', { notAfter: got.notAfter.toISOString() });
      }
    } catch (e) {
      code = failureCode(e);
      clog.error('tls certificate not renewed; trying again later', { notAfter: serving.notAfter.toISOString(), err: e });
    } finally {
      checking = false;
      run.end(code === null ? { ok: true } : { ok: false, code });
      recordServing(serving, o.key, { at: Date.now(), ok: code === null, code });
    }
  };
  // Once now, for a certificate that's already due, then twice a day.
  void check();
  const timer = setInterval(() => void check(), CHECK_MS);
  timer.unref();
  return { current: () => serving, stop: async () => { clearInterval(timer); await lock.end(); } };
}
