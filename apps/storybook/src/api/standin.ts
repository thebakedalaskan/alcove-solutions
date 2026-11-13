/*
 * The stand-in backend: the whole AlcoveApi, so the compiler keeps it in step with the contract, answering from the
 * story's world (state.ts). It keeps the server's behaviour simple: it answers from the scenario, a change changes the
 * world for the rest of the story, and it doesn't reimplement search ranking, scheduling or permissions. Like the real
 * client it takes a moment to answer, refuses everything without a connection (`network`) and everything but the public
 * calls without a session (`unauthenticated`), and says `not-found` for what isn't there (answer.ts).
 *
 * Each part of it answers from a folder of its own, laid out as @alcove/api-http's are: account/ (signing in, preferences,
 * people, your plan, a team), agents/, meetings/ (calls ahead and calendars), calls/ (making and entering calls, and being
 * rung; the call itself is played in call/), recordings/, notes/ (and Google Drive exports), workspaces/ and trust/. A
 * method nothing renders yet answers with something sensible and empty. When the contract grows, this grows with it.
 */
import type { AlcoveApi } from '@alcove/api';
import { accountApi } from './account/api';
import { agentsApi } from './agents/api';
import { callsApi, stopCalls } from './calls/api';
import { meetingsApi } from './meetings/api';
import { notesApi } from './notes/api';
import { driveApi } from './notes/drive';
import { recordingsApi, stopRecordings } from './recordings/api';
import { trustApi } from './trust/api';
import { workspacesApi } from './workspaces/api';

export const standIn: AlcoveApi = {
  ...accountApi, ...agentsApi, ...meetingsApi, ...callsApi, ...recordingsApi, ...notesApi, ...driveApi, ...workspacesApi, ...trustApi,
  /* What the app's logger reports goes nowhere: Storybook keeps no logs. */
  diagnostics: { report: () => Promise.resolve() }
};

/** Whatever the last story left open stops: its calls (and those it left going), its rings, a move on its way, its recordings. */
export function stopLive(): void {
  stopCalls();
  stopRecordings();
}
