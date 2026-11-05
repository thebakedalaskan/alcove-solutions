/* This call's three rows, at the top of the list. They stay whatever the notes are doing, and say so by going quiet. */
import { WsRow } from '@alcove/ui';
import { useEffect } from 'react';
import { useLive } from '~/lib/live';
import { useWs } from '../context';
import { modeHere } from './lines';
import type { LiveBeside, LiveCall, LivePageId } from './types';
import { useFollowUps } from './useFollowUps';

function Rows({ live }: { live: LiveCall }) {
  const ws = useWs();
  const state = useLive(live.session);
  const { open } = useFollowUps(live, ws);
  const closed = ws.call?.closed ?? false;
  /* The count beside Follow-ups takes in what's written in documents, read every few seconds while the workspace is open. */
  useEffect(() => (closed ? undefined : live.session.watchFollowUps()), [closed, live.session]);

  const quiet = modeHere(state) === 'off';
  const at = ws.at;
  const current = (page: LivePageId) => at.kind === 'live' && at.page === page;
  const beside = (page: LivePageId, view: LiveBeside) => () => {
    live.beside(view);
    /* It can't be in two places: the page goes back to the document it was covering. */
    if (current(page)) ws.go(ws.lastDocument ? { kind: 'document', id: ws.lastDocument } : { kind: 'home' });
  };
  const row = (page: LivePageId, name: string, icon: 'notes' | 'todos' | 'transcript', more: { count?: number; onBeside?: () => void }) => (
    <WsRow key={page} id={`$${page}`} name={name} kind="live" icon={icon} area="pins" quiet={quiet} current={current(page)} onOpen={() => ws.go({ kind: 'live', page })} {...more} />
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
  const live = useWs().call?.live;
  return live ? <Rows live={live} /> : null;
}
