import { Hono } from 'hono';
import type { Deps } from './context';
import type { Env } from './http/context';
import { createHttpRuntime } from './http/runtime';
import { registerMiddleware } from './http/middleware';
import { registerSystemRoutes } from './http/system-routes';
import { registerAuthRoutes } from './features/account/auth-routes';
import { registerCallRoutes } from './features/calls/routes';
import { registerWorkspaceReaderRoutes } from './features/workspaces/reader-routes';
import { registerOwnerMiddleware } from './http/authorization';
import { registerReceiptMiddleware } from './http/receipts';
import { registerAccountRoutes } from './features/account/routes';
import { registerMeetingRoutes } from './features/meetings/routes';
import { registerDocumentLibraryRoute } from './features/workspaces/library-routes';
import { registerCallOwnerRoutes } from './features/calls/owner-routes';
import { registerRecordingRoutes } from './features/recordings/routes';
import { registerNoteRoutes } from './features/notes/routes';
import { registerWorkspaceRoutes } from './features/workspaces/routes';
import { registerBillingRoutes } from './features/billing/routes';

/** Registration order is an access boundary: guest routes precede sign-in and stored receipts. */
export function createApp(d: Deps, stopping?: AbortSignal | undefined) {
  const app = new Hono<Env>();
  const runtime = createHttpRuntime(d, stopping);

  registerMiddleware(app, runtime);
  registerSystemRoutes(app, runtime);
  registerAuthRoutes(app, runtime);
  registerCallRoutes(app, runtime);
  registerWorkspaceReaderRoutes(app, runtime);
  registerOwnerMiddleware(app, runtime);
  registerReceiptMiddleware(app, runtime);
  registerAccountRoutes(app, runtime);
  registerMeetingRoutes(app, runtime);
  registerDocumentLibraryRoute(app, runtime);
  registerCallOwnerRoutes(app, runtime);
  registerRecordingRoutes(app, runtime);
  registerNoteRoutes(app, runtime);
  registerWorkspaceRoutes(app, runtime);
  registerBillingRoutes(app, runtime);

  return app;
}
