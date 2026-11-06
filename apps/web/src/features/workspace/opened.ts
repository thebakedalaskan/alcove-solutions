/*
 * A document or a board open on the page: its one session, opened again when asked or when it can't be opened right now, and
 * what's said when a connection comes back. DocumentPane and BoardPane both hold theirs through these, so the two can't drift,
 * and a board in a call opens again the same way (features/call/boards/callBoard.ts).
 */
import type { DocSession, DocStatus } from '@alcove/api';
import { wsToast } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';
import type { Ws } from './context';
import { openDocument } from './session';

const olog = log.child({ component: 'workspace' });

/** A session for one document, and whether its first sync is in. Why it ended, if it has, is in its status. */
export interface Opened { session: DocSession; ready: boolean; round: number }

/** One session at a time for a document. `reopen`: a fresh one, from what Alcove has and anything kept here. */
export function useSession(ws: Ws, documentId: string) {
  const { workspaceId, pass, owner } = ws;
  const [round, setRound] = useState(0);
  const reopen = useCallback(() => setRound((r) => r + 1), []);
  const [opened, setOpened] = useState<Opened | null>(null);
  useEffect(() => {
    let left = false;
    let held: DocSession | null = null;
    const open = () => {
      openDocument(workspaceId, documentId, owner, pass).then((session) => {
        if (left) { session.close(); return; }
        held = session;
        setOpened({ session, ready: false, round });
        // A session that never opens says why in its status.
        session.ready.then(() => { if (!left) setOpened({ session, ready: true, round }); }, () => undefined);
      }, (e: unknown) => {
        olog.warn('a document didn’t open', { workspaceId, documentId, err: e });
        addEventListener('online', open, { once: true });
      });
    };
    open();
    return () => { left = true; removeEventListener('online', open); held?.close(); };
  }, [workspaceId, documentId, pass, owner, round]);
  return { opened, reopen };
}

/** How long a document that can't be opened right now waits before it's opened again, a little longer each time. */
const UNAVAILABLE_WAITS = [2_000, 5_000, 15_000, 30_000];

/** A document that can't be opened right now opens again by itself, a little later each time. `status`: null while none is. */
export function useOpensAgain(status: Pick<DocStatus, 'closed'> | null, ready: boolean, reopen: () => void): void {
  const tries = useRef(0);
  const closed = status?.closed ?? null;
  useEffect(() => { if (ready) tries.current = 0; }, [ready]);
  useEffect(() => {
    if (closed !== 'unavailable') return undefined;
    const wait = UNAVAILABLE_WAITS[Math.min(tries.current, UNAVAILABLE_WAITS.length - 1)] ?? 30_000;
    tries.current += 1;
    const timer = setTimeout(reopen, wait);
    return () => clearTimeout(timer);
  }, [closed, reopen]);
}

/**
 * Back from being offline, and everything's in: in the session that was offline. Not once what was written was refused or
 * the session ended, so a document opened again after Discard doesn't say its edits saved.
 */
export function useBackOnline(ws: Ws, session: DocSession, offline: boolean, status: DocStatus): void {
  const wasOffline = useRef<DocSession | null>(null);
  useEffect(() => {
    if (offline) wasOffline.current = session;
    else if (wasOffline.current !== session || status.status === 'failed' || status.closed !== null) wasOffline.current = null;
    else if (status.status === 'saved') { wasOffline.current = null; ws.say(wsToast.backOnline()); }
  }, [offline, session, status.status, status.closed, ws.say]);
}
