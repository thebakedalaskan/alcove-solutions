import { ItemInputSchema, ItemPlaceSchema, LiveStreamEndBodySchema, MAX_DOC_BYTES, RestrictBodySchema, ShareBodySchema, TeamAccessBodySchema, TeamAccessSchema, WorkspaceAboutInputSchema, WorkspaceInputSchema, WorkspacePersonInputSchema, WorkspaceRolePatchSchema } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { CALL_PASS_HEADER } from '../../keys/call-pass';
import * as access from './access';
import type { Calls } from './calls';
import * as docUpdates from './documents/updates';
import * as docLive from './documents/live';
import * as mentions from './mentions';
import * as workspaces from './service';
import { type Env } from '../../http/context';
import { body, capped } from '../../http/body';
import type { HttpRuntime } from '../../http/runtime';



/** `calls`: what says whose seat a call pass is, and what else a workspace asks of calls (features/workspaces/calls.ts). */
export function registerWorkspaceRoutes(app: Hono<Env>, runtime: HttpRuntime, calls: Calls): void {
  const { d } = runtime;
  const { treeLimiter, workspaceListLimiter, workspaceLimiter, updateBytesLimiter, presenceLimiter } = runtime.limits;

  /*
   * workspaces: what's for people in one. Every answer here is an ID or a yes, so the receipts they keep (a retry mustn't
   * make a second workspace, item or copy) hold nothing readable, however long they outlive what they were about.
   */
  const member = async (c: Context<Env>, pass?: string | undefined): Promise<access.Reader> => {
    const o = c.get('owner');
    treeLimiter(o.ownerId, 'workspace change');
    return access.accountReader(o, { token: pass, calls });
  };

  const ws = (c: Context<Env>) => c.req.param('id') ?? '';

  const itemOf = (c: Context<Env>) => c.req.param('item') ?? '';

  app.get('/v1/mentions', async (c) => {
    workspaceListLimiter(c.get('owner').ownerId, 'reading your tags');
    return c.json(await mentions.notices(d, await access.accountReader(c.get('owner'))));
  });

  app.get('/v1/workspaces', async (c) => {
    workspaceListLimiter(c.get('owner').ownerId, 'workspace list');
    return c.json(await workspaces.list(await access.accountReader(c.get('owner'))));
  });

  // On a team, `access` says who's in it: the whole team (the default there) or only the people added. Elsewhere it's ignored.
  app.post('/v1/workspaces', async (c) => {
    workspaceLimiter(c.get('owner').ownerId, 'workspace');
    const { name, access } = await body(c, WorkspaceInputSchema.extend({ access: TeamAccessSchema.optional() }));
    return c.json(await workspaces.create(c.get('owner'), name, access));
  });

  app.put('/v1/workspaces/:id/team-access', async (c) => { await workspaces.setTeamAccess(d, await member(c), ws(c), (await body(c, TeamAccessBodySchema)).access); return c.json({ changed: true }); });

  app.patch('/v1/workspaces/:id', async (c) => { await workspaces.rename(d, await member(c), ws(c), (await body(c, WorkspaceInputSchema)).name); return c.json({ renamed: true }); });

  app.delete('/v1/workspaces/:id', async (c) => { await workspaces.remove(d, await member(c), ws(c)); return c.json({ deleted: true }); });

  /* What a workspace is for, in one line: it's said back in the answer, so nothing keeps it (`no-store`), as with a tree. */
  app.get('/v1/workspaces/:id/about', async (c) => {
    const line = await workspaces.about(d, await access.accountReader(c.get('owner')), ws(c));
    c.header('cache-control', 'no-store');
    return c.json({ about: line });
  });

  app.put('/v1/workspaces/:id/about', async (c) => { await workspaces.setAbout(d, await member(c), ws(c), (await body(c, WorkspaceAboutInputSchema)).about); return c.json({ changed: true }); });

  app.get('/v1/workspaces/:id/people', async (c) => c.json(await workspaces.people(d, await access.accountReader(c.get('owner')), ws(c))));

  app.post('/v1/workspaces/:id/people', async (c) => {
    const { email, role } = await body(c, WorkspacePersonInputSchema);
    return c.json(await workspaces.addPerson(d, await member(c), ws(c), email, role));
  });

  app.patch('/v1/workspaces/:id/people/:person', async (c) => { await workspaces.setRole(d, await member(c), ws(c), c.req.param('person'), (await body(c, WorkspaceRolePatchSchema)).role); return c.json({ changed: true }); });

  app.delete('/v1/workspaces/:id/people/:person', async (c) => { await workspaces.removePerson(d, await member(c), ws(c), c.req.param('person'), calls); return c.json({ removed: true }); });

  /*
   * Changing the tree, with the call's pass when it comes from a call: someone in a call that uses the workspace can, whether or
   * not they're in it. A guest, with no account, has the same in reader-routes.ts. Deleting for good is for its people alone.
   */
  app.post('/v1/workspaces/:id/items', async (c) => c.json(await workspaces.createItem(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), await body(c, ItemInputSchema))));

  /*
   * Words that couldn't reach the document they were written in, as a new one's first state: the other half of making that new
   * document, so it takes an account as making it does. A call's pass doesn't reach it.
   */
  app.post('/v1/workspaces/:id/documents/:doc/adopt', async (c) => {
    const r = await member(c);
    const length = Number(c.req.header('content-length') ?? MAX_DOC_BYTES);
    updateBytesLimiter(access.limitKey(r), 'document update bytes', Math.ceil(length / 1024) || 1);
    return c.json(await docUpdates.adoptState(d, r, c.req.param('id'), c.req.param('doc'), length, () => c.req.arrayBuffer()));
  });

  app.post('/v1/workspaces/:id/items/:item/move', async (c) => { await workspaces.moveItem(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c), await body(c, ItemPlaceSchema)); return c.json({ moved: true }); });

  app.post('/v1/workspaces/:id/items/:item/duplicate', async (c) => c.json(await workspaces.duplicateItem(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c))));

  app.post('/v1/workspaces/:id/items/:item/trash', async (c) => { await workspaces.trashItem(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c)); return c.json({ trashed: true }); });

  app.delete('/v1/workspaces/:id/items/:item', async (c) => { await workspaces.deleteItem(d, await member(c), ws(c), itemOf(c)); return c.json({ deleted: true }); });

  app.get('/v1/workspaces/:id/items/:item/share', async (c) => c.json(await workspaces.shareList(d, await access.accountReader(c.get('owner'), { token: c.req.header(CALL_PASS_HEADER), calls }), ws(c), itemOf(c))));

  app.post('/v1/workspaces/:id/items/:item/share', async (c) => {
    const { to, role } = await body(c, ShareBodySchema);
    // A seat is someone in the sharer's own call, so sharing with one comes with their pass.
    await workspaces.share(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c), to, role, calls);
    return c.json({ shared: true });
  });

  // From a call, with its pass, a change to who has something is told to that call at once.
  app.delete('/v1/workspaces/:id/items/:item/share/:entry', async (c) => { await workspaces.unshare(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c), c.req.param('entry'), calls); return c.json({ removed: true }); });

  app.post('/v1/workspaces/:id/items/:item/restrict', async (c) => { await workspaces.restrict(d, await member(c, c.req.header(CALL_PASS_HEADER)), ws(c), itemOf(c), (await body(c, RestrictBodySchema)).restricted, calls); return c.json({ changed: true }); });

  /*
   * A browser closed one of its streams, a workspace's or a document's, by the name it gave it: it ends here at once, as
   * Cloud Run never tells the API a browser went. Only the asker's own, counted under their account as their streams are
   * (`limitKey`); the same answer whether there was one or not. It takes an account, as everything past the sign-in check
   * does, so a call's pass alone is refused before anything's read: a guest's places come back as their oldest makes room,
   * or as the API lets go of a stream. It keeps no receipt (http/receipts.ts): ending one twice ends nothing more.
   */
  app.use('/v1/workspaces/:id/live/end', capped(1024));

  app.post('/v1/workspaces/:id/live/end', async (c) => {
    presenceLimiter(c.get('owner').ownerId, 'stream end');
    const { stream } = await body(c, LiveStreamEndBodySchema);
    workspaces.endStream(d, await access.accountReader(c.get('owner')), stream);
    return c.json({ said: true });
  });

  app.use('/v1/workspaces/:id/documents/:doc/live/end', capped(1024));

  app.post('/v1/workspaces/:id/documents/:doc/live/end', async (c) => {
    presenceLimiter(c.get('owner').ownerId, 'stream end');
    const { stream } = await body(c, LiveStreamEndBodySchema);
    docLive.endStream(d, await access.accountReader(c.get('owner')), stream);
    return c.json({ said: true });
  });
}
