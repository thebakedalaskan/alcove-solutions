import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { AuthError } from '../errors';
import { addLogContext } from '../log';
import { openOwner } from '../owners';
import { findSession } from '../sessions';
import { type Env } from './context';
import type { HttpRuntime } from './runtime';



export function registerOwnerMiddleware(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { COOKIE, secure } = runtime.context;

  /* ---------- everything below needs a signed-in owner ---------- */
  app.use('/v1/*', async (c, next) => {
    const cookie = getCookie(c, COOKIE);
    const s = await findSession(d, cookie);
    if (!s) {
      if (cookie) deleteCookie(c, COOKIE, { path: '/', secure });
      throw new AuthError(cookie ? 'Your session ended. Sign in again to carry on.' : 'Sign in to Alcove first.');
    }
    addLogContext({ ownerId: s.ownerId });
    c.set('owner', await openOwner(d, s.ownerId, s));
    await next();
  });
}
