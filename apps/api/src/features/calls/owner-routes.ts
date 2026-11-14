import { CallAheadBodySchema, InstantCallInputSchema, RingAnswerBodySchema } from '@alcove/api';
import { Hono } from 'hono';
import { notFound } from '../../platform/errors';
import * as ahead from './workspace/ahead';
import * as callsJoining from './joining';
import * as meetings from '../meetings/service';
import * as rings from './ringing/rings';
import { ID128, body } from '../../http/body';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerCallOwnerRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d, stopping } = runtime;
  const { makeLimiter, ringStreamLimiter, ringAnswerLimiter, workspaceLimiter } = runtime.limits;

  const ringStreams = new rings.RingStreams(d, stopping);

  /* calls */
  app.post('/v1/calls', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    return c.json(await meetings.startNow(c.get('owner'), await body(c, InstantCallInputSchema)));
  });

  /* a call before it starts: its home settled, and an agenda or a board made there, from the call's page */
  app.post('/v1/meetings/:id/home', async (c) => {
    workspaceLimiter(c.get('owner').ownerId, 'workspace');
    const id = c.req.param('id');
    if (!ID128.test(id)) throw notFound('That meeting');
    return c.json(await ahead.ready(c.get('owner'), id, await body(c, CallAheadBodySchema)));
  });

  /* rings: who's ringing you, as it changes. Nothing here keeps the request's context or the account's keys: the stream outlives both. */
  app.get('/v1/rings', async (c) => {
    ringStreamLimiter(c.get('owner').ownerId, 'rings');
    return new Response(await ringStreams.connect(await rings.listenerOf(c.get('owner'))), { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
  });

  app.post('/v1/rings/:id/answer', async (c) => {
    ringAnswerLimiter(c.get('owner').ownerId, 'ring answer');
    const id = c.req.param('id');
    if (!ID128.test(id)) throw notFound('That ring');
    await callsJoining.answerRing(c.get('owner'), id, (await body(c, RingAnswerBodySchema)).reply);
    return c.json({ answered: true });
  });
}
