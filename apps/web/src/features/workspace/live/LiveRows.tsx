/*
 * This call's three rows: in its folder in its home, or at the top of the list while everyone views another workspace. They
 * stay whatever the notes are doing, and say so by going quiet.
 */
import { WsRow } from '@alcove/ui';
import { useEffect } from 'react';
import type { WorkspaceArea } from '../context';
import { useLive } from '~/lib/live';
import { useLiveHost, type LiveHost } from './host';
import { modeHere } from './lines';
import type { LiveBeside, LivePageId } from './types';
import { useFollowUps } from './useFollowUps';

function Rows({ host, depth, area }: { host: LiveHost; depth: number; area: WorkspaceArea }) {
  const { live, at, closed } = host;
  const state = useLive(live.session);
  const { open } = useFollowUps({ ...host, session: live.session });
  /* The count beside Follow-ups takes in what's written in documents, read every few seconds while the workspace is open. */
  useEffect(() => (closed ? undefined : live.session.watchFollowUps()), [closed, live.session]);

  const quiet = modeHere(state) === 'off';
  const current = (page: LivePageId) => at.kind === 'live' && at.page === page;
  const beside = (page: LivePageId, view: LiveBeside) => () => {
    live.beside(view);
    /* It can't be in two places: the page goes back to the document it was covering. */
    if (current(page)) host.go(host.lastDocument ? { kind: 'document', id: host.lastDocument } : { kind: 'home' });
  };
  const row = (page: LivePageId, name: string, icon: 'notes' | 'todos' | 'transcript', more: { count?: number; onBeside?: () => void }) => (
    <WsRow key={page} id={`$${page}`} name={name} kind="live" icon={icon} depth={depth} area={area} quiet={quiet} current={current(page)} onOpen={() => host.go({ kind: 'live', page })} {...more} />
  );
  return (
    <>
      {row('notes', 'Notes', 'notes', { onBeside: beside('notes', 'notes') })}
      {row('follow-ups', 'Follow-ups', 'todos', { count: open })}
      {row('transcript', 'Transcript', 'transcript', { onBeside: beside('transcript', 'transcript') })}
    </>
  );
}

/** `depth` and `area`: where they sit, in the call's folder or pinned at the top. */
export function LiveRows({ depth = 0, area = 'pins' }: { depth?: number | undefined; area?: WorkspaceArea | undefined }) {
  const host = useLiveHost();
  return host ? <Rows host={host} depth={depth} area={area} /> : null;
}
