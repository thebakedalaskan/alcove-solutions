/*
 * Signed-in sessions (docs: privacy-keys-and-sessions › Sessions). The cookie carries a random
 * 256-bit ID; the database keeps only its SHA-256, so reading the database can't hijack anyone.
 * Sessions end after 14 days without use or 30 days in all, or when the person signs out.
 */
import { SignInProviderSchema, type SignInProvider } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from './context';
import { b64u, random, sha, utf8 } from './crypto';
import { exec, maybeOne, timestamp } from './db';
import { log } from './log';

/** Session IDs are bearer secrets and never logged; the owner ID identifies a session in logs. */
const slog = log.child({ component: 'sessions' });

export const IDLE_MS = 14 * 24 * 60 * 60_000;
export const ABSOLUTE_MS = 30 * 24 * 60 * 60_000;
/** Refresh the idle clock at most this often, so ordinary requests don't all write. */
const TOUCH_MS = 60_000;
export const COOKIE = 'alcove_session';
/** Over HTTPS the cookie gets the __Host- prefix: Secure, host-only, path /. */
export const cookieName = (secure: boolean) => (secure ? `__Host-${COOKIE}` : COOKIE);

export interface Session { hash: Uint8Array; ownerId: string; provider: SignInProvider; createdAt: Date; expiresAt: Date }

const hashOf = (id: string) => sha(utf8(id));
const Row = z.object({ owner_id: z.string(), provider: SignInProviderSchema, created_at: timestamp, last_seen_at: timestamp, expires_at: timestamp });

/** Opens a session and returns its ID, which only the browser's cookie keeps. */
export async function openSession(d: Deps, ownerId: string, provider: SignInProvider): Promise<{ id: string; session: Session }> {
  const id = b64u(random(32));
  const session: Session = { hash: hashOf(id), ownerId, provider, createdAt: new Date(), expiresAt: new Date(Date.now() + ABSOLUTE_MS) };
  await exec(d.pool, 'INSERT INTO sessions (session_hash, owner_id, provider, created_at, last_seen_at, expires_at) VALUES ($1,$2,$3,$4,$4,$5)',
    [session.hash, ownerId, provider, session.createdAt, session.expiresAt]);
  slog.info('session opened', { ownerId, provider });
  return { id, session };
}

/** The live session behind a cookie value, or undefined when there is none or it has ended. */
export async function findSession(d: Deps, id: string | undefined): Promise<Session | undefined> {
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return undefined;
  const hash = hashOf(id);
  const r = await maybeOne(d.pool, Row, 'SELECT owner_id, provider, created_at, last_seen_at, expires_at FROM sessions WHERE session_hash = $1', [hash]);
  if (!r) return undefined;
  const now = Date.now();
  const ended = r.expires_at.getTime() <= now ? 'absolute' : now - r.last_seen_at.getTime() > IDLE_MS ? 'idle' : undefined;
  if (ended) {
    await exec(d.pool, 'DELETE FROM sessions WHERE session_hash = $1', [hash]);
    slog.info('session ended', { ownerId: r.owner_id, reason: ended });
    return undefined;
  }
  if (now - r.last_seen_at.getTime() > TOUCH_MS) await exec(d.pool, 'UPDATE sessions SET last_seen_at = now() WHERE session_hash = $1', [hash]);
  return { hash, ownerId: r.owner_id, provider: r.provider, createdAt: r.created_at, expiresAt: r.expires_at };
}

/** Whether a session found earlier is still open: nobody has signed out of it, and its account is still here. */
export async function stillOpen(d: Deps, hash: Uint8Array): Promise<boolean> {
  return (await maybeOne(d.pool, z.object({ n: z.number() }), 'SELECT 1 AS n FROM sessions WHERE session_hash = $1 AND expires_at > now()', [hash])) !== undefined;
}

export async function closeSession(d: Deps, s: Session): Promise<void> {
  await exec(d.pool, 'DELETE FROM sessions WHERE session_hash = $1', [s.hash]);
  slog.info('session closed', { ownerId: s.ownerId, reason: 'sign-out', ageH: Math.round((Date.now() - s.createdAt.getTime()) / 3_600_000) });
}

/** Removes sessions that have ended, so they don't linger in the table. */
export function sweepSessions(d: Deps): Promise<number> {
  return exec(d.pool, `DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - interval '14 days'`);
}
