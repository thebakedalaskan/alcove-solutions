import type { HttpBindings } from '@hono/node-server';
import { type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Deps, Owner } from '../context';
import { AuthError } from '../errors';
import { addLogContext, type Level } from '../log';
import { CALL_PASS_HEADER } from '../callPass';
import { openOwner } from '../owners';
import { ABSOLUTE_MS, cookieName, findSession } from '../sessions';
import * as access from '../features/workspaces/access';
import * as callsParticipants from '../features/calls/participants';

export type Env = { Bindings: HttpBindings; Variables: { owner: Owner; viewer: callsParticipants.Viewer; requestId: string; receipt: string | undefined; refusedAt: Level | undefined } };

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

  /*
   * A workspace, by session or call pass: a guest in a call has only their pass, so what they may reach comes before the
   * sign-in below. All of it reads, or sets something a retry can't do twice, so none of it keeps a receipt: a title
   * changes as it's typed, and a guest has no account to keep one under. features/workspaces/access.ts decides everything from here on.
   */
  const credentials = (c: Context): access.Credentials => ({ session: getCookie(c, COOKIE), pass: c.req.header(CALL_PASS_HEADER) });

  const readerOf = async (c: Context): Promise<access.Reader> => {
    const r = await access.readerOf(d, credentials(c));
    addLogContext({ ...(r.account ? { ownerId: r.account.owner.ownerId } : {}), ...(r.seat ? { callId: r.seat.callId } : {}) });
    return r;
  };
  return { secure, COOKIE, startSession, optionalOwner, signedIn, credentials, readerOf };
}
