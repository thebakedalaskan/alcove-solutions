import { CallTimerControlSchema, CallTimerPresetInputSchema, CallTimerPresetUpdateSchema, CallTimerSequenceInputSchema } from '@alcove/api';
import { type Context, type Hono } from 'hono';
import { ConflictError, ForbiddenError, notFound } from '../../errors';
import { body, capped, ID128 } from '../../http/body';
import { type Env } from '../../http/context';
import { type HttpRuntime } from '../../http/runtime';
import * as presets from './timer-presets';
import * as timers from './timers';

/** Composed after call-pass middleware, before signed-in-only routes: admitted guests may read but never control. */
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
  app.use('/v1/live/calls/:id/timer/*', capped(64 * 1024));
  app.patch('/v1/live/calls/:id/timer/sequence', async (c) => c.json(await timers.setSequence(host(c), c.req.param('id'), await body(c, CallTimerSequenceInputSchema))));
  app.post('/v1/live/calls/:id/timer/control', async (c) => c.json(await timers.control(host(c), c.req.param('id'), await body(c, CallTimerControlSchema))));
}
/** Owner-private preparation is available before joining and to signed-in hosts during a call. */
export function registerTimerPresetRoutes(app: Hono<Env>): void {
  const id = (c: Context<Env>) => {
    const value = c.req.param('preset');
    if (!value || !ID128.test(value)) throw notFound('That timer preset');
    return value;
  };
  app.use('/v1/timer-presets/*', capped(64 * 1024));
  app.get('/v1/timer-presets', async (c) => c.json(await presets.list(c.get('owner'))));
  app.post('/v1/timer-presets', async (c) => c.json(await presets.create(c.get('owner'), await body(c, CallTimerPresetInputSchema))));
  app.patch('/v1/timer-presets/:preset', async (c) => c.json(await presets.update(c.get('owner'), id(c), await body(c, CallTimerPresetUpdateSchema))));
  app.delete('/v1/timer-presets/:preset', async (c) => { await presets.remove(c.get('owner'), id(c)); return c.json({ removed: true }); });
}
