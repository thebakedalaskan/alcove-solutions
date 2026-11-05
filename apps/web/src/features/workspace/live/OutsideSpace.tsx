/*
 * Someone in the call who can open nothing in its workspace. Being in a call opens nothing, so the page says what it says
 * (`children`), and the call's own notes, follow-ups and transcript are still theirs, in the same place as everyone's.
 */
import { WsDoc, WsList, WsPane, WsSection } from '@alcove/ui';
import { useMemo, type ReactNode } from 'react';
import type { WorkspaceCall, WorkspacePlace } from '../context';
import { LiveHostContext, type LiveHost } from './host';
import { LivePage } from './LivePage';
import { LiveRows } from './LiveRows';
import type { LiveCall } from './types';

export function OutsideSpace({ live, at, go, say, closed, zen, list, children }: {
  live: LiveCall; at: WorkspacePlace; go: (to: WorkspacePlace) => void; say: WorkspaceCall['say']; closed: boolean; zen: WorkspaceCall['zen'];
  list: WorkspaceCall['list'];
  /** What the page says while none of the call's pages is open. */
  children: ReactNode;
}) {
  const host = useMemo((): LiveHost => ({ live, at, go, say, here: [], workspaceId: null, put: null, lastDocument: null, closed, toggleList: list.onToggle, zen }), [live, at, go, say, closed, list.onToggle, zen]);
  return (
    <LiveHostContext value={host}>
      <WsPane listOff={list.off} listPeek={list.peek} zen={zen?.on}>
        <WsList label="This call">
          <WsSection key="call" label="This call" area="pins" />
          <LiveRows key="rows" />
        </WsList>
        {at.kind === 'live' ? <LivePage page={at.page} line={at.line} /> : <WsDoc className="is-bare">{children}</WsDoc>}
      </WsPane>
    </LiveHostContext>
  );
}
