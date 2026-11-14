/*
 * A call, for operators (operator.ts, lifecycle.ts): looking it up by a call's, a meeting's or a note's ID; ending it, only
 * when it's stuck; and closing the room of one that has ended. Each route is registered through operatorRoute()
 * (http/operator.ts), which checks the signed request, the key's scope and an action's reason before it runs. A call's code
 * is a join secret and is never taken: anything but an ID is refused without being said back or logged.
 */
import { type Context, type Hono } from 'hono';
import { ConflictError, NotFoundError, UnavailableError, ValidationError } from '../../../platform/errors';
import { ID128 } from '../../../http/body';
import { type Env } from '../../../http/context';
import { operatorRoute } from '../../../http/operator';
import type { HttpRuntime } from '../../../http/runtime';
import { endStuckCall } from '../lifecycle';
import { callExists, closeRoom, lookUpCall, type CallEndAnswer, type RoomCloseAnswer } from './operator';

const NOT_AN_ID = 'That isn’t a call’s, a meeting’s or a note’s ID. A join link’s code is never taken: ask for the address of the call’s page.';
const RUN_IDS = 'operator call <address> gives the ID of each of a call’s runs.';
const NOT_A_CALL = `That isn’t a call’s ID: ${RUN_IDS}`;

/** The ID in the path, which must be one: 22 characters of base64url. Anything else is refused, never said back or logged. */
function idOf(c: Context<Env>, name: 'id' | 'callId', refusal: string): string {
  const id = c.req.param(name) ?? '';
  if (!ID128.test(id)) throw new ValidationError(refusal, { context: { field: name } });
  return id;
}

export function registerCallOperatorRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;

  /* Is this call still on, and why won't it end? Each run's facts, counts, recorder, notes job, room and signals. */
  operatorRoute(app, runtime, 'GET', '/v1/operator/calls/:id', 'read', async (c, op) => {
    const found = await lookUpCall(d, idOf(c, 'id', NOT_AN_ID), op.instance);
    if (found === 'room-recording') throw new NotFoundError('That note is a room recording’s, not a call’s: operator note <id> says where its writing stands.');
    if (found === 'nothing') throw new NotFoundError('No call, meeting or note has that ID.');
    return c.json(found);
  });

  /*
   * Ends a call that's stuck, as when its host leaves; a call that isn't is left as it is, and so is one that only LiveKit could
   * say is stuck, while it doesn't answer.
   */
  operatorRoute(app, runtime, 'POST', '/v1/operator/calls/:callId/end', 'write', async (c, op) => {
    const callId = idOf(c, 'callId', NOT_A_CALL);
    if (!(await callExists(d, callId))) throw new NotFoundError(`No call has that ID: ${RUN_IDS}`);
    const outcome = await endStuckCall(d, callId);
    if (outcome === 'not-stuck') throw new ConflictError('That call isn’t stuck; nothing was done.', { context: { callId } });
    if (outcome === 'unanswered') {
      throw new UnavailableError('LiveKit didn’t say whether the call’s room is up, or who’s in it, so nothing was done. Try again in a moment.', { context: { callId } });
    }
    if (outcome === 'not-live') throw new ConflictError('That call has ended already; nothing was done.', { context: { callId } });
    return c.json({ instance: op.instance, at: new Date().toISOString(), callId, ended: true } satisfies CallEndAnswer);
  });

  /* Closes the LiveKit room of a call that has ended, which disconnects whoever is still in it. */
  operatorRoute(app, runtime, 'POST', '/v1/operator/calls/:callId/room/close', 'write', async (c, op) => {
    const callId = idOf(c, 'callId', NOT_A_CALL);
    const deleted = await closeRoom(d, callId);
    return c.json({ instance: op.instance, at: new Date().toISOString(), callId, deleted } satisfies RoomCloseAnswer);
  });
}
