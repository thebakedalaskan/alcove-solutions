/*
 * This call's three rows, first in This call at the top of the list, whichever workspace everyone views. They stay whatever the
 * notes are doing, and say so by going quiet.
 */
import { WsRow } from '@alcove/ui';
import { useEffect } from 'react';
import { useLive } from '~/lib/live';
import { useLiveHost, type LiveHost } from './host';
import { modeHere } from './lines';
import type { LiveBeside, LivePageId } from './types';
import { useFollowUps } from './useFollowUps';

function Rows({ host }: { host: LiveHost }) {
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
    <WsRow key={page} id={`$${page}`} name={name} kind="live" icon={icon} area="pins" quiet={quiet} current={current(page)} onOpen={() => host.go({ kind: 'live', page })} {...more} />
  );
  return (
    <>
      {row('notes', 'Notes', 'notes', { onBeside: beside('notes', 'notes') })}
      {row('follow-ups', 'Follow-ups', 'todos', { count: open })}
      {row('transcript', 'Transcript', 'transcript', { onBeside: beside('transcript', 'transcript') })}
    </>
  );
}

export function LiveRows() {
  const host = useLiveHost();
  return host ? <Rows host={host} /> : null;
}
