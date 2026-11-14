/*
 * A note's writing, for operators (operator.ts): where it stands, and retrying its notes or its Drive exports. Each route is
 * registered through operatorRoute() (http/operator.ts), which checks the signed request, the key's scope and an action's
 * reason before it runs. A note is named by its ID, from the address of a call's page (/calls/<id>), and nothing else.
 */
import { type Context, type Hono } from 'hono';
import { NotFoundError, ValidationError } from '../../../platform/errors';
import { ID128 } from '../../../http/body';
import { type Env } from '../../../http/context';
import { operatorRoute } from '../../../http/operator';
import type { HttpRuntime } from '../../../http/runtime';
import { lookUpNote, noteOwner, retryExports, retryNotes, type ExportsRetryAnswer, type NoteRetryAnswer } from './operator';

/** The note an operator named, and whose it is. Anything but a note's ID is refused without being said back or logged. */
async function noteOf(c: Context<Env>, runtime: HttpRuntime): Promise<{ noteId: string; ownerId: string }> {
  const noteId = c.req.param('noteId') ?? '';
  if (!ID128.test(noteId)) throw new ValidationError('That isn’t a note’s ID: it’s the last part of the address of a call’s page, /calls/<id>.', { context: { field: 'noteId' } });
  const ownerId = await noteOwner(runtime.d, noteId);
  if (!ownerId) throw new NotFoundError('No note has that ID.');
  return { noteId, ownerId };
}

export function registerNoteOperatorRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;

  /* Why aren't these notes written? Counts, states and times from their rows, nothing sealed read, and this instance's lines about it. */
  operatorRoute(app, runtime, 'GET', '/v1/operator/notes/:noteId', 'read', async (c, op) => {
    const { noteId, ownerId } = await noteOf(c, runtime);
    return c.json(await lookUpNote(d, ownerId, noteId, op.instance));
  });

  /* Makes the notes job due now, if it waits on the model or to be tried again, and starts the writer. */
  operatorRoute(app, runtime, 'POST', '/v1/operator/notes/:noteId/retry', 'write', async (c, op) => {
    const { noteId, ownerId } = await noteOf(c, runtime);
    const r = await retryNotes(d, ownerId, noteId);
    return c.json({ instance: op.instance, at: new Date().toISOString(), noteId, ...r } satisfies NoteRetryAnswer);
  });

  /* Makes the Drive exports that wait to be tried again due now, and starts their exporters. */
  operatorRoute(app, runtime, 'POST', '/v1/operator/notes/:noteId/exports/retry', 'write', async (c, op) => {
    const { noteId, ownerId } = await noteOf(c, runtime);
    const retried = await retryExports(d, ownerId, noteId);
    return c.json({ instance: op.instance, at: new Date().toISOString(), noteId, retried } satisfies ExportsRetryAnswer);
  });
}
