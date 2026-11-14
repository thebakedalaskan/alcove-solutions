import type { HttpBindings } from '@hono/node-server';
import { type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Deps, Owner } from '../platform/context';
import { AuthError } from '../platform/errors';
import type { Level, LogContext } from '../platform/log';
import { openOwner } from '../keys/owners';
import { ABSOLUTE_MS, cookieName, findSession } from '../keys/sessions';

/**
 * `refusedAt`: the level a request's error was logged at; `failure`: what that error says that the request's own line says
 * again for the operators' ring (http/middleware.ts).
 */
export type Env = { Bindings: HttpBindings; Variables: { owner: Owner; requestId: string; receipt: string | undefined; refusedAt: Level | undefined; failure: LogContext | undefined } };

/**
 * The client's address as the front end saw it: the last x-forwarded-for entry. Behind the edge (edge/listen.ts) that's the
 * only entry: the edge sets it to the address the load balancer's PROXY line gives, and drops whatever the client sent.
 * Behind another front end that appends it, anything before it came from the client, so it can't be trusted to tell
 * people apart.
 */
export const clientAddress = (c: Context) => c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'direct';

export function createHttpContext(d: Deps) {
  const secure = d.cfg.WEB_ORIGIN.startsWith('https://');

  const COOKIE = cookieName(secure);

  const startSession = (c: Context, sessionId: string) => setCookie(c, COOKIE, sessionId, { httpOnly: true, sameSite: 'Strict', path: '/', secure, maxAge: ABSOLUTE_MS / 1000 });

  /* ---------- group calls: by link (no account needed) and by call pass ---------- */
  const optionalOwner = async (c: Context): Promise<Owner | undefined> => {
    const s = await findSession(d, getCookie(c, COOKIE));
    return s ? openOwner(d, s.ownerId, s) : undefined;
  };

  /*
   * What carries over into a call: its series as someone signed in sees it. It comes from their own notes, so it needs
   * their session, whatever pass they hold: a guest has no account, and nothing to carry over.
   */
  const signedIn = async (c: Context): Promise<Owner> => {
    const o = await optionalOwner(c);
    if (!o) throw new AuthError('Sign in to see what carries over from earlier calls.');
    return o;
  };
  return { secure, COOKIE, startSession, optionalOwner, signedIn };
}
