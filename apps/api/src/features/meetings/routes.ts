import { BusyBodySchema, CalendarRangeSchema, ChangeScopeSchema, MeetingInputSchema, NextCallBodySchema, NotesSettingSchema, ProposalAnswerBodySchema, ProposeBodySchema, RsvpBodySchema, type Meeting } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../../platform/errors';
import * as calendar from './calendar';
import * as meetings from './service';
import { type Env } from '../../http/context';
import { body } from '../../http/body';
import type { HttpRuntime } from '../../http/runtime';
import type { Calls } from '../workspaces/calls';



/** `calls`: what a change to an invite asks of the calls whose homes follow it (features/workspaces/calls.ts). */
export function registerMeetingRoutes(app: Hono<Env>, runtime: HttpRuntime, calls: Calls): void {
  const { makeLimiter, workspaceListLimiter, busyLimiter } = runtime.limits;

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
    return changedCall(c, await meetings.create(c.get('owner'), await body(c, MeetingInputSchema)));
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
    return changedCall(c, await meetings.update(c.get('owner'), c.req.param('id'), patch, scopeOf(c), calls));
  });

  app.delete('/v1/meetings/:id', async (c) => { await meetings.cancel(c.get('owner'), c.req.param('id'), scopeOf(c)); return c.json({ cancelled: true }); });

  app.post('/v1/meetings/:id/next', async (c) => {
    makeLimiter(c.get('owner').ownerId, 'calls');
    return changedCall(c, await meetings.scheduleNext(c.get('owner'), c.req.param('id'), (await body(c, NextCallBodySchema)).startsAt));
  });

  app.post('/v1/meetings/:id/answer', async (c) => c.json(await meetings.answer(c.get('owner'), c.req.param('id'), (await body(c, RsvpBodySchema)).answer)));

  /* Someone invited asking to move a call: it sets one value, and what comes back is the organizer's call, so it keeps no receipt. */
  app.post('/v1/meetings/:id/propose', async (c) => c.json(await meetings.propose(c.get('owner'), c.req.param('id'), (await body(c, ProposeBodySchema)).startsAt)));

  /* The organizer answering a request to move one of their calls: moving it is a change like any other. */
  app.post('/v1/meetings/:id/proposals/answer', async (c) => {
    const { email, answer } = await body(c, ProposalAnswerBodySchema);
    return changedCall(c, await meetings.answerProposal(c.get('owner'), c.req.param('id'), email, answer, calls));
  });

  /* calendar: someone's other events, and making one of them an Alcove call */
  app.get('/v1/calendar', async (c) => {
    const o = c.get('owner');
    const [from, to] = [c.req.query('from'), c.req.query('to')];
    if (from === undefined && to === undefined) return c.json(await calendar.view(o, () => meetings.recurringSeries(o)));
    const asked = CalendarRangeSchema.safeParse({ from, to });
    if (!asked.success) throw new ValidationError('Ask for a stretch of your calendar with both its start and its end.');
    return c.json(await calendar.view(o, () => meetings.recurringSeries(o), calendar.stretch(asked.data.from, asked.data.to)));
  });

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
