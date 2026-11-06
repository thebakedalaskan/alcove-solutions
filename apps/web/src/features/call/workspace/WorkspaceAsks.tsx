/*
 * Asking to see the call's workspace. Being in a call opens nothing, so someone who can't open its workspace asks the
 * organizer (`CallSession.askForWorkspace`), and the ask names nothing. The organizer answers with the document in front of
 * them, read only or to edit, or says not now. What's shared opens by itself for whoever asked, and lasts until the call
 * ends or Share takes it back.
 */
import { firstName, type CallSession, type CallWorkspace, type DocumentRole } from '@alcove/api';
import { WsKnock, wsToast, type WsToastData } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { WorkspacePlace } from '~/features/workspace/context';
import { nameOf } from '~/features/workspace/tree';
import { q } from '~/lib/queries';
import type { WorkspacePanelState } from './WorkspacePanel';

/** Whoever asked hears how it went: what's shared with them opens by itself, and a not now is said. */
export function useAskAnswered(workspace: CallWorkspace, act: { reveal: () => void; say: (t: WsToastData) => void }) {
  const was = useRef(workspace.asked);
  const organizer = firstName(workspace.chosenBy.name);
  useEffect(() => {
    const before = was.current;
    was.current = workspace.asked;
    if (before !== 'asking' || workspace.asked === 'asking') return;
    if (workspace.asked === 'declined') act.say(wsToast.saidNotNow(organizer));
    else if (workspace.canOpen) act.reveal();
  }, [workspace.asked, workspace.canOpen, organizer, act]);
}

/** What the organizer would share: the document in front of them, else this call's agenda, else the first thing brought to it. */
function offered(w: CallWorkspace, at: WorkspacePlace): string | null {
  if (at.kind === 'document') return at.id;
  const here = w.documents.filter((d) => d.workspaceId === w.id);
  return here.find((d) => d.id === w.agenda)?.id ?? here[0]?.id ?? null;
}

/**
 * The organizer's answer to whoever's asking, oldest first, at the top of the call, or above the dock on a phone, clear of the
 * list's button. It offers only what they can share: a document in the call's workspace they can edit. With none in front of
 * them, `onChoose` opens the workspace in front of whatever covers it, on the document they were last in there or the list.
 */
export function WorkspaceKnock({ session, workspace, at, act, onChoose }: { session: CallSession; workspace: CallWorkspace; at: WorkspacePlace; act: WorkspacePanelState['act']; onChoose: () => void }) {
  /** Asks answered here: each lifts away at once, while the call takes a moment to say so. */
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const ask = workspace.asks.find((a) => !answered.has(a.id)) ?? null;
  const space = workspace.id;
  const documentId = space === null ? null : offered(workspace, at);
  const item = useQuery({ ...q.workspaceItem(space ?? '', documentId ?? ''), enabled: ask !== null && space !== null && documentId !== null }).data;
  const shareable = item && item.id === documentId && item.kind === 'document' && item.role === 'edit' && item.trashedAt === null && workspace.role !== null ? item : null;

  const answer = (role: DocumentRole | null) => {
    if (!ask) return;
    const first = firstName(ask.person.name);
    const forget = () => setAnswered((was) => new Set([...was].filter((id) => id !== ask.id)));
    setAnswered((was) => new Set([...was, ask.id]));
    if (role === null) {
      session.declineWorkspaceAsk(ask.id).then(() => act.say(wsToast.toldNotNow(first)), (e: unknown) => { forget(); act.failed(e); });
      return;
    }
    if (!shareable) return;
    const name = nameOf(shareable);
    session.grantWorkspaceAsk(ask.id, shareable.id, role).then(() => act.say(wsToast.canOpen(first, role, name)), (e: unknown) => { forget(); act.failed(e); });
  };
  return (
    <WsKnock person={ask?.person ?? null} document={shareable ? nameOf(shareable) : null}
      onLet={() => answer('read')} onEdit={() => answer('edit')} onChoose={onChoose} onNotNow={() => answer(null)} />
  );
}
