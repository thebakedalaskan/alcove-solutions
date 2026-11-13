import { RecordingActionSchema, RoomRecordingInputSchema } from '@alcove/api';
import { Hono } from 'hono';
import * as recordings from './service';
import { body } from '../../../http/body';
import { clip, piece } from '../../recordings/requests';
import { type Env } from '../../../http/context';
import type { HttpRuntime } from '../../../http/runtime';



export function registerRecordingRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { speechLimiter } = runtime.limits;

  /* room recordings */
  app.post('/v1/recordings', async (c) => c.json(await recordings.start(c.get('owner'), await body(c, RoomRecordingInputSchema))));

  app.post('/v1/recordings/:id/actions', async (c) => c.json(await recordings.act(c.get('owner'), c.req.param('id'), await body(c, RecordingActionSchema))));

  app.post('/v1/recordings/:id/audio', async (c) => c.json(await recordings.audio(c.get('owner'), c.req.param('id'), await piece(c))));

  app.post('/v1/recordings/:id/transcribe', async (c) => {
    speechLimiter(c.get('owner').ownerId, 'transcribe');
    return c.json(await recordings.transcribe(c.get('owner'), c.req.param('id'), await clip(c)));
  });

  app.post('/v1/recordings/:id/stop', async (c) => c.json(await recordings.stop(c.get('owner'), c.req.param('id'))));

  app.delete('/v1/recordings/:id', async (c) => { await recordings.discard(c.get('owner'), c.req.param('id')); return c.json({ discarded: true }); });
}
