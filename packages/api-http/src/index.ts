import { createAgentsApi } from './agents/api';
import { createAccountApi } from './account/api';
import { createCallsApi } from './calls/api';
import { createMeetingsApi } from './meetings/api';
import { createNotesApi } from './notes/api';
import { createRecordingsApi } from './recordings/api';
import { createDiagnosticsApi } from './transport/diagnostics';
import { createHttpTransport } from './transport/http';
import { type HttpOptions } from './transport/options';
import { createWorkspacesApi } from './workspaces/api';
import { type AlcoveApi } from '@alcove/api';

export type { HttpOptions, ClientEvent } from './transport/options';
export { keyIndex } from './calls/session';

/** Constructs one HTTP client from its feature implementations. */
export function createHttpApi(o: HttpOptions): AlcoveApi {
  const t = createHttpTransport(o);
  return {
    ...createAccountApi(t),
    ...createAgentsApi(t),
    ...createMeetingsApi(t),
    ...createCallsApi(t, o),
    ...createRecordingsApi(t),
    ...createNotesApi(t),
    ...createWorkspacesApi(t, o),
    ...createDiagnosticsApi(t),
  };
}
