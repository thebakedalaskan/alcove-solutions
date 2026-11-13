import { Hono } from 'hono';
import { registerDrivePublicRoutes, registerDriveRoutes } from './features/notes/drive-exports/routes';
import type { Deps } from './platform/context';
import type { Env } from './http/context';
import { createHttpRuntime } from './http/runtime';
import { registerMiddleware } from './http/middleware';
import { registerSystemRoutes } from './http/system-routes';
import { registerAuthRoutes } from './features/account/auth-routes';
import { registerCallRoutes } from './features/calls/routes';
import { registerWorkspaceReaderRoutes } from './features/workspaces/reader-routes';
import { registerOwnerMiddleware } from './http/authorization';
import { registerReceiptMiddleware } from './http/receipts';
import { registerAgentPublicRoutes, registerAgentRoutes } from './features/agents/routes';
import { registerAccountSessionRoutes } from './features/account/session-routes';
import { registerAccountRoutes } from './features/account/routes';
import { registerMeetingRoutes } from './features/meetings/routes';
import { registerLibraryRoutes } from './features/workspaces/library/routes';
import { registerCallOwnerRoutes } from './features/calls/owner-routes';
import { workspaceCalls } from './features/calls/workspace/seats';
import { registerRecordingRoutes } from './features/notes/room-recordings/routes';
import { registerNoteRoutes } from './features/notes/routes';
import { registerWorkspaceRoutes } from './features/workspaces/routes';
import { registerBillingRoutes } from './features/billing/routes';
import { registerTeamRoutes } from './features/billing/teams/routes';
import { createAttester, type Attester } from './tee/tee';

/**
 * Registration order is an access boundary: guest routes precede sign-in and stored receipts. `attester`: what says what's
 * running, the launcher's token inside a TEE (tee.ts). What workspaces and meetings ask of calls, which sit above them, the
 * calls answer (`workspaceCalls`), handed in here.
 */
export function createApp(d: Deps, stopping?: AbortSignal | undefined, attester: Attester = createAttester(d)) {
  const app = new Hono<Env>();
  const runtime = createHttpRuntime(d, stopping, attester);

  registerMiddleware(app, runtime);
  registerAgentPublicRoutes(app, runtime);
  registerSystemRoutes(app, runtime);
  registerAuthRoutes(app, runtime);
  registerDrivePublicRoutes(app, runtime);
  registerCallRoutes(app, runtime);
  registerWorkspaceReaderRoutes(app, runtime, workspaceCalls);
  registerOwnerMiddleware(app, runtime);
  registerReceiptMiddleware(app, runtime);
  registerAccountSessionRoutes(app, runtime);
  registerAgentRoutes(app, runtime);
  registerAccountRoutes(app, runtime);
  registerMeetingRoutes(app, runtime, workspaceCalls);
  registerLibraryRoutes(app, runtime);
  registerCallOwnerRoutes(app, runtime);
  registerRecordingRoutes(app, runtime);
  registerNoteRoutes(app, runtime);
  registerDriveRoutes(app, runtime);
  registerWorkspaceRoutes(app, runtime, workspaceCalls);
  registerBillingRoutes(app, runtime);
  registerTeamRoutes(app, runtime);

  return app;
}
