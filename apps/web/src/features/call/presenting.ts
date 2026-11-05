/*
 * Presenting a document in a call, as this browser sees it (docs: Calls and recordings › Presenting). The call says what's
 * presented in the part of it you're in (`CallWorkspace.present`), the same for everyone who can open it. What's kept here is
 * yours alone: whether you're watching or working on your own, and whether the workspace was opened for the presentation,
 * so it's put away again when it ends. Your own page is never moved: what's presented is drawn over it (Presentation.tsx),
 * so when it stops, everyone's back exactly where they were.
 *
 * A board is presented on the board's own surface, by the whiteboards work: nothing here draws one.
 */
import { errorCode, firstName, type CallParticipant, type CallPresent, type CallSession, type Person } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspacePresenting } from '~/features/workspace/context';
import { log } from '~/lib/log';

const plog = log.child({ component: 'presenting' });

/** Who started what's presented, and what it is: a new presentation is a new key, even of the same document. */
const keyOf = (p: CallPresent | null): string | null => (p ? `${p.by.seat} ${p.kind ?? ''} ${p.id ?? ''}` : null);

export function usePresenting({ session, present, participants, open, inSight, show, hide, say, failed }: {
  session: CallSession;
  present: CallPresent | null;
  participants: readonly CallParticipant[];
  /** The workspace is open, and in sight while nothing it takes turns with is in front. */
  open: boolean;
  inSight: boolean;
  show: () => void;
  hide: () => void;
  say: (toast: WsToastData) => void;
  failed: (e: unknown) => void;
}): WorkspacePresenting {
  const key = keyOf(present);
  const presenter: Person | null = useMemo(() => (present ? participants.find((p) => p.seat === present.by.seat)?.person ?? null : null), [present, participants]);
  /** The presentation you're working on your own during, by its key. */
  const [ownWay, setOwnWay] = useState<string | null>(null);
  const away = key !== null && ownWay === key;
  const isDocument = present?.kind === 'document' && present.id !== null;
  const watching = isDocument && (present.mine || !away);

  /* Next and Back show at once for whoever presses them; once the call has answered, what it says is what's so. */
  const [moved, setMoved] = useState<{ key: string; section: number; n: number } | null>(null);
  const moves = useRef(0);
  const section = moved && moved.key === key ? moved.section : present?.section ?? 0;

  /*
   * The workspace opens for a presentation if it wasn't open, and is put away again when it ends with you watching. Put
   * away by hand meanwhile, it stays put away; working on your own when it ends, you stay where you are.
   */
  const opened = useRef(false);
  const openNow = useRef(open);
  openNow.current = open;
  useEffect(() => {
    if (!watching || openNow.current) return;
    opened.current = true;
    show();
  }, [watching, key, show]);
  useEffect(() => { if (!open) opened.current = false; }, [open]);
  const presented = isDocument ? key : null;
  const awayAtEnd = useRef(false);
  useEffect(() => { if (presented !== null) awayAtEnd.current = away; }, [presented, away]);
  const last = useRef(presented);
  useEffect(() => {
    const was = last.current;
    last.current = presented;
    if (was === null || presented !== null) return;
    if (opened.current && openNow.current && !awayAtEnd.current) hide();
    opened.current = false;
    awayAtEnd.current = false;
    setOwnWay(null);
  }, [presented, hide]);

  /* Someone who can't open what's presented is told who's presenting, and nothing else: in the strip, or here if the workspace isn't in sight. */
  const toldOf = useRef<string | null>(null);
  const inSightNow = useRef(inSight);
  inSightNow.current = inSight;
  useEffect(() => {
    if (!present || present.id !== null || key === toldOf.current) return;
    toldOf.current = key;
    if (!inSightNow.current) say(wsToast.presentingPrivate(firstName(present.by.name)));
  }, [present, key, say]);

  const presentNow = useRef(present);
  presentNow.current = present;
  const start = useCallback((documentId: string) => { session.startPresenting('document', documentId, 0).catch(failed); }, [session, failed]);
  const move = useCallback((to: number) => {
    const k = keyOf(presentNow.current);
    if (k === null) return;
    const n = ++moves.current;
    setMoved({ key: k, section: to, n });
    const settle = () => setMoved((m) => (m?.n === n ? null : m));
    session.movePresenting(to).then(settle, (e: unknown) => { settle(); failed(e); });
  }, [session, failed]);
  const stop = useCallback(() => {
    const p = presentNow.current;
    if (!p) return;
    session.stopPresenting().then(() => say(p.mine ? wsToast.stoppedPresenting() : wsToast.stoppedTheirPresenting(firstName(p.by.name))), (e: unknown) => {
      plog.info('presenting didn’t stop', { code: errorCode(e) });
      failed(e);
    });
  }, [session, say, failed]);
  const setAway = useCallback((on: boolean) => { setOwnWay(on ? keyOf(presentNow.current) : null); }, []);

  return useMemo(() => ({ present, presenter, watching, away, section, inSight, start, move, stop, setAway }), [present, presenter, watching, away, section, inSight, start, move, stop, setAway]);
}
