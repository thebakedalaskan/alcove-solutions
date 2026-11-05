/*
 * What a call's own pages need from around them. Usually that's the workspace, but being in a call opens nothing in it, and the
 * call's notes and transcript are yours all the same: someone who can open nothing has these pages with no workspace at all.
 */
import { createContext, useContext } from 'react';
import type { Ws, WorkspaceCall, WorkspacePlace } from '../context';
import type { LiveCall, LivePut } from './types';

export interface LiveHost {
  live: LiveCall;
  at: WorkspacePlace;
  go: Ws['go'];
  say: Ws['say'];
  /** Who's in the workspace now, which is how it knows you. Nobody, with no workspace. */
  here: Ws['here'];
  /** The workspace, if you can open anything in it. */
  workspaceId: string | null;
  put: LivePut | null;
  lastDocument: string | null;
  /** The workspace is closed and kept as it was. */
  closed: boolean;
  toggleList: () => void;
  zen: WorkspaceCall['zen'];
}

export const LiveHostContext = createContext<LiveHost | null>(null);
export const useLiveHost = (): LiveHost | null => useContext(LiveHostContext);
