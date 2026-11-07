import type { AgentsApi } from './agents/api';
import { type CallsApi, type RingsApi } from './calls/api';
import { type CreditsApi } from './credits/api';
import { type AccountApi, type AuthApi, type PeopleApi } from './identity/api';
import { type CalendarApi, type MeetingsApi } from './meetings/api';
import { type NotesApi, type SeriesApi } from './notes/api';
import { type ModelsApi } from './notes/models';
import { type RecordingsApi } from './recordings/api';
import { type DiagnosticsApi } from './telemetry/api';
import { type TrustApi } from './trust/api';
import { type DocumentsApi, type WorkspacesApi } from './workspaces/api';
/** A partial update: any field may be missing or explicitly undefined. */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };
/** Everything the frontend can ask of the backend. */
export interface AlcoveApi {
  auth: AuthApi;
  account: AccountApi;
  agents: AgentsApi;
  people: PeopleApi;
  meetings: MeetingsApi;
  calendar: CalendarApi;
  calls: CallsApi;
  rings: RingsApi;
  documents: DocumentsApi;
  recordings: RecordingsApi;
  notes: NotesApi;
  series: SeriesApi;
  workspaces: WorkspacesApi;
  credits: CreditsApi;
  models: ModelsApi;
  trust: TrustApi;
  diagnostics: DiagnosticsApi;
}
