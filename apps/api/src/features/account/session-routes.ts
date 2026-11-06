import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';
import * as account from './account';
import * as photos from './photos';

export function registerAccountSessionRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { COOKIE, secure } = runtime.context;

  app.post('/v1/session/sign-out', async (c) => {
    await account.signOut(c.get('owner'));
    deleteCookie(c, COOKIE, { path: '/', secure });
    return c.json({ signedOut: true });
  });

  app.get('/v1/photos/:token', async (c) => {
    const p = await photos.photo(d, c.req.param('token'));
    return new Response(p.bytes.slice(), { headers: { 'content-type': p.type, 'cache-control': 'private, max-age=86400, immutable', 'x-content-type-options': 'nosniff' } });
  });
}
