import { CallTimerControlSchema } from '@alcove/api';
import { type Context, type Hono } from 'hono';
import { ConflictError, ForbiddenError } from '../../errors';
import { body, capped } from '../../http/body';
import { type Env } from '../../http/context';
import { type HttpRuntime } from '../../http/runtime';
import * as timers from './timers';

/** Composed after call-pass middleware, before signed-in-only routes: admitted guests read the timer but never control it. */
export function registerLiveTimerRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const host = (c: Context<Env>) => {
    const v = c.get('viewer');
    if (!v.isHost) {
      const context = { callId: v.pass.callId, action: 'timer' };
      if (v.stale) throw new ConflictError('You’re not hosting this call from here any more.', { context });
      throw new ForbiddenError('Only the host can change the timer.', { context });
    }
    runtime.limits.spaceLimiter(v.pass.person, 'timer');
    return v;
  };
  app.use('/v1/live/calls/:id/timer', capped(1024));
  app.post('/v1/live/calls/:id/timer', async (c) => c.json(await timers.control(host(c), c.req.param('id'), await body(c, CallTimerControlSchema))));
}
