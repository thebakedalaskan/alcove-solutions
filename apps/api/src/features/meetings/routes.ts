import { BusyBodySchema, ChangeScopeSchema, FileNotesSchema, MeetingCreateSchema, MeetingInputSchema, NextCallBodySchema, NotesSettingSchema, RsvpBodySchema, type Meeting } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../../errors';
import * as calendar from './calendar';
import * as meetings from './service';
import { fileNotes } from '../calls/workspace';
import { type Env } from '../../http/context';
import { body } from '../../http/body';
import type { HttpRuntime } from '../../http/runtime';



export function registerMeetingRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { makeLimiter, workspaceLimiter, workspaceListLimiter, busyLimiter } = runtime.limits;

  /* meetings */
  /**
   * A call as the answer to a change. Its receipt keeps it without its documents: a retry can come after one has been
   * deleted or the account has lost it, and a receipt filed under someone in a workspace can't hold a name.
   */
  const changedCall = (c: Context<Env>, m: Meeting) => { c.set('receipt', JSON.stringify({ ...m, documents: [] })); return c.json(m); };

  app.get('/v1/meetings', async (c) => c.json(c.req.query('range') === 'past' ? await meetings.past(c.get('owner')) : await meetings.upcoming(c.get('owner'))));

  app.get('/v1/meetings/:id', async (c) => c.json(await meetings.get(c.get('owner'), c.req.param('id'))));

  app.post('/v1/meetings', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    const input = await body(c, MeetingCreateSchema);
    if (input.newWorkspace) workspaceLimiter(c.get('owner').ownerId, 'workspace');
    return changedCall(c, await meetings.create(c.get('owner'), input));
  });

  /* How far a change to a call in a series reaches. */
  const scopeOf = (c: Context) => {
    const scope = ChangeScopeSchema.optional().safeParse(c.req.query('scope'));
    if (!scope.success) throw new ValidationError('A change reaches this call, or this and later calls.');
    return scope.data;
  };

  app.patch('/v1/meetings/:id', async (c) => {
    const patch = await body(c, MeetingInputSchema.partial());
    // Making a call repeat, or how it repeats, makes calls.
    if (patch.repeat) makeLimiter(c.get('owner').ownerId, 'calls');
    // Checking what's brought reads the library.
    if (patch.documents?.length) workspaceListLimiter(c.get('owner').ownerId, 'documents');
    return changedCall(c, await meetings.update(c.get('owner'), c.req.param('id'), patch, scopeOf(c)));
  });

  app.delete('/v1/meetings/:id', async (c) => { await meetings.cancel(c.get('owner'), c.req.param('id'), scopeOf(c)); return c.json({ cancelled: true }); });

  app.post('/v1/meetings/:id/next', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    return changedCall(c, await meetings.scheduleNext(c.get('owner'), c.req.param('id'), (await body(c, NextCallBodySchema)).startsAt));
  });

  /* An ended call's notes, filed in a workspace by its organizer when it had none (features/calls/workspace.ts). */
  app.post('/v1/meetings/:id/file', async (c) => {
    const o = c.get('owner');
    const to = await body(c, FileNotesSchema);
    if ('newWorkspace' in to) workspaceLimiter(o.ownerId, 'workspace');
    await fileNotes(o, c.req.param('id'), 'workspaceId' in to ? { workspaceId: to.workspaceId } : { newWorkspace: true }, to.timeZone);
    return changedCall(c, await meetings.get(o, c.req.param('id')));
  });

  app.post('/v1/meetings/:id/answer', async (c) => c.json(await meetings.answer(c.get('owner'), c.req.param('id'), (await body(c, RsvpBodySchema)).answer)));

  /* calendar: someone's other events, and making one of them an Alcove call */
  app.get('/v1/calendar', async (c) => { const o = c.get('owner'); return c.json(await calendar.view(o, () => meetings.recurringSeries(o))); });

  app.delete('/v1/calendar', async (c) => { const o = c.get('owner'); return c.json(await calendar.disconnect(o, () => meetings.recurringSeries(o))); });

  app.post('/v1/calendar/busy', async (c) => {
    const o = c.get('owner');
    busyLimiter(o.ownerId, 'busy');
    return c.json(await calendar.busy(o, await body(c, BusyBodySchema), () => meetings.all(o)));
  });

  app.post('/v1/calendar/events/:id/adopt', async (c) => {
    const { notes } = await body(c, z.object({ notes: NotesSettingSchema.optional() }));
    return changedCall(c, await meetings.adopt(c.get('owner'), c.req.param('id'), notes));
  });

  app.get('/v1/calls/:code/meeting', async (c) => c.json(await meetings.byCode(c.get('owner'), c.req.param('code'))));
}
