/*
 * Someone in the call who can open nothing in its workspace. Being in a call opens nothing, so the page says what it says
 * (`children`), and the call's own notes, follow-ups and transcript are still theirs, in the same place as everyone's. With
 * so little in it the list is all there is to go by, so where there's no room for it, the page has its button.
 */
import { WsDoc, WsDocHead, WsList, WsPane, WsSection } from '@alcove/ui';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceCall, WorkspacePlace } from '../context';
import { LiveHostContext, type LiveHost } from './host';
import { NO_IDS } from '../ids';
import { LivePage } from './LivePage';
import { LiveRows } from './LiveRows';
import type { LiveCall } from './types';

export function OutsideSpace({ live, at, go, say, closed, zen, list, children }: {
  live: LiveCall; at: WorkspacePlace; go: (to: WorkspacePlace) => void; say: WorkspaceCall['say']; closed: boolean; zen: WorkspaceCall['zen'];
  list: WorkspaceCall['list'];
  /** What the page says while none of the call's pages is open. */
  children: ReactNode;
}) {
  /* A phone shows the list or the page, and that's its own to say, as it is in a workspace. */
  const [phoneList, setPhoneList] = useState(false);
  const toggleList = useCallback(() => {
    if (matchMedia('(max-width: 640px)').matches) setPhoneList((on) => !on);
    else list.onToggle();
  }, [list.onToggle]);
  const goAndClose = useCallback<LiveHost['go']>((to) => { setPhoneList(false); go(to); }, [go]);
  const host = useMemo((): LiveHost => ({ live, at, go: goAndClose, say, here: [], workspaceId: null, put: null, lastDocument: null, closed, toggleList, zen, ids: NO_IDS, following: null, stopFollowing: () => undefined }), [live, at, goAndClose, say, closed, toggleList, zen]);
  return (
    <LiveHostContext value={host}>
      <WsPane listOff={list.off} listPeek={list.peek} phoneList={phoneList} zen={zen?.on}>
        <WsList label="This call">
          <WsSection key="call" label="This call" area="pins" />
          <LiveRows key="rows" />
        </WsList>
        {at.kind === 'live' ? <LivePage page={at.page} line={at.line} /> : (
          <WsDoc className={list.off ? undefined : 'is-bare'}>
            <WsDocHead crumbs={[]} save="quiet" onToggleList={toggleList} zen={zen?.on} onZen={zen?.onToggle} />
            {children}
          </WsDoc>
        )}
      </WsPane>
    </LiveHostContext>
  );
}
