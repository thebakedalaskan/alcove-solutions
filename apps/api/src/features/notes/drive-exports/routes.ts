import { DriveExportInputSchema } from '@alcove/api';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { body } from '../../../http/body';
import type { Env } from '../../../http/context';
import type { HttpRuntime } from '../../../http/runtime';
import { log } from '../../../platform/log';
import { findSession } from '../../../keys/sessions';
import * as oauth from './oauth';
import * as drive from './service';

const dlog = log.child({ component: 'drive-exports' });
const attemptCookie = (secure: boolean) => secure ? '__Host-alcove_drive' : 'alcove_drive';
export function registerDrivePublicRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { secure } = runtime.context;
  app.get('/v1/drive/callback', async (c) => {
    const attempt = getCookie(c, attemptCookie(secure));
    deleteCookie(c, attemptCookie(secure), { path: '/', secure });
    let result: 'connected' | 'cancelled' | 'failed' = 'failed';
    try { const session = await findSession(d, getCookie(c, runtime.context.COOKIE)); result = await oauth.finish(d, c.req.query(), attempt, session?.hash); }
    catch { dlog.warn('drive consent could not finish', { reason: 'provider-unavailable' }); }
    return c.redirect(`${d.cfg.WEB_ORIGIN}/settings?drive=${result}`, 302);
  });
}
export function registerDriveRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { secure } = runtime.context;
  app.get('/v1/drive', async (c) => c.json(await drive.get(c.get('owner'))));
  app.put('/v1/drive', async (c) => c.json(await drive.update(c.get('owner'), await body(c, DriveExportInputSchema))));
  app.delete('/v1/drive', async (c) => c.json(await drive.disconnect(c.get('owner'))));
  for (const path of ['/v1/drive/connect', '/v1/drive/pick-folder']) app.post(path, async (c) => {
    const { url, attempt } = await oauth.begin(c.get('owner'));
    setCookie(c, attemptCookie(secure), attempt, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: 600 });
    return c.json({ url });
  });
  app.get('/v1/drive/folders', async (c) => c.json(await drive.folders(c.get('owner'))));
  app.get('/v1/drive/jobs', async (c) => c.json(await drive.listJobs(c.get('owner'))));
  app.get('/v1/drive/notes/:id', async (c) => c.json(await drive.forNote(c.get('owner'), c.req.param('id'))));
  app.put('/v1/drive/notes/:id', async (c) => c.json(await drive.setForNote(c.get('owner'), c.req.param('id'), await body(c, DriveExportInputSchema.nullable()))));
  app.post('/v1/drive/jobs/:id/retry', async (c) => c.json(await drive.retry(c.get('owner'), c.req.param('id'))));
}
