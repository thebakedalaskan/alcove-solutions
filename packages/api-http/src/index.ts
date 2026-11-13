import { createAgentsApi } from './agents/api';
import { createAccountApi } from './account/api';
import { createCallsApi } from './calls/api';
import { createMeetingsApi } from './meetings/api';
import { createNotesApi } from './notes/api';
import { createDriveApi } from './notes/drive';
import { createRecordingsApi } from './recordings/api';
import { createDiagnosticsApi } from './transport/diagnostics';
import { createHttpTransport } from './transport/http';
import { type HttpOptions } from './transport/options';
import { createTrustApi } from './trust/api';
import { createWorkspacesApi } from './workspaces/api';
import { type AlcoveApi } from '@alcove/api';

export type { HttpOptions, ClientEvent } from './transport/options';
export { keyIndex } from './calls/session';
export { verifyServer, type VerifyOptions } from './trust/verify';

/** Constructs one HTTP client from its feature implementations. */
export function createHttpApi(o: HttpOptions): AlcoveApi {
  const t = createHttpTransport(o);
  return {
    ...createAccountApi(t),
    ...createTrustApi(t),
    ...createAgentsApi(t),
    ...createMeetingsApi(t),
    ...createCallsApi(t, o),
    ...createRecordingsApi(t),
    ...createNotesApi(t),
    ...createDriveApi(t),
    ...createWorkspacesApi(t, o),
    ...createDiagnosticsApi(t),
  };
}
