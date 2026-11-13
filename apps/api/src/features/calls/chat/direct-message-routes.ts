import { CallMessageBodySchema, DirectAckSchema, DirectSendSchema } from '@alcove/api';
import { type Context, type Hono } from 'hono';
import { body, capped } from '../../../http/body';
import { type Env } from '../../../http/context';
import { type HttpRuntime } from '../../../http/runtime';
import * as direct from './direct-messages';
import { mlsMessage } from '../mls/mls';
import type { Viewer } from '../participants';

/** Composed after the call-pass boundary; neither host powers nor a vault grant opens another inbox. */
export function registerDirectMessageRoutes(app: Hono<Env>, runtime: HttpRuntime, viewerIn: (c: Context<Env>) => Viewer): void {
  app.use('/v1/live/calls/:id/direct/*', capped(128 * 1024));
  app.post('/v1/live/calls/:id/direct/key', async (c) => {
    const v = viewerIn(c);
    runtime.limits.chatLimiter(v.pass.identity, 'private-message-key');
    await mlsMessage(v, c.req.param('id'), await body(c, CallMessageBodySchema), false);
    return c.json({ sent: true });
  });
  app.post('/v1/live/calls/:id/direct/messages', async (c) => {
    const v = viewerIn(c);
    runtime.limits.chatLimiter(v.pass.identity, 'private-message');
    return c.json(await direct.send(v, c.req.param('id'), await body(c, DirectSendSchema)));
  });
  app.post('/v1/live/calls/:id/direct/sync', async (c) => {
    const b = await body(c, DirectAckSchema);
    return c.json(await direct.sync(viewerIn(c), c.req.param('id'), b.ids, b.after));
  });
}
