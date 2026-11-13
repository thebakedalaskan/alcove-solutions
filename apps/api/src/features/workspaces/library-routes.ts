import { Hono } from 'hono';
import * as drive from './drive';
import * as documents from './library';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



/** What's read across all of someone's workspaces at once, for someone signed in: each opens every workspace they're in. */
export function registerLibraryRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { workspaceListLimiter } = runtime.limits;

  /* documents people can bring to calls */
  app.get('/v1/documents', async (c) => {
    workspaceListLimiter(c.get('owner').ownerId, 'documents');
    return c.json(await documents.library(c.get('owner')));
  });

  /* The Drive's Trash: what's in Trash in every workspace someone can open something in. */
  app.get('/v1/trash', async (c) => {
    workspaceListLimiter(c.get('owner').ownerId, 'trash');
    return c.json(await drive.trashed(c.get('owner')));
  });
}
