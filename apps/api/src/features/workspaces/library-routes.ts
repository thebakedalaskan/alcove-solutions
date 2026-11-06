import { Hono } from 'hono';
import * as documents from './library';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerDocumentLibraryRoute(app: Hono<Env>, runtime: HttpRuntime): void {
  const { workspaceListLimiter } = runtime.limits;

  /* documents people can bring to calls */
  app.get('/v1/documents', async (c) => {
    workspaceListLimiter(c.get('owner').ownerId, 'documents');
    return c.json(await documents.library(c.get('owner')));
  });
}
