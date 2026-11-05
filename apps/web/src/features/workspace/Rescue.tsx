/*
 * Words that didn't reach Alcove, and what someone can do with them: copy them, save them as a new document, or let them go.
 * They're offered wherever the words may not get there by themselves: a document that refused them, or one that can't be
 * opened any more, including one that's left the list while this device still holds something written in it.
 */
import { errorMessage } from '@alcove/api';
import { WsCantOpen, WsDiscardAsk, WsRescue, wsToast, type WsToastData } from '@alcove/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { useSaveCopy } from '~/lib/queries';
import { keptDocuments } from './keep';
import { openDocument, type DocSession } from './session';

const rlog = log.child({ component: 'workspace-rescue' });

/**
 * Where a new document of someone's words goes, for someone who can make one there. `name`: what the copy is named after,
 * read when it's made: what the list calls the document, or last called one that's gone.
 */
export interface CopyTo { workspaceId: string; name: () => string | null; parent: string | null; go: (id: string) => void }

export function Rescue({ session, say, copyTo, onLetGo }: {
  session: DocSession;
  say: (toast: WsToastData) => void;
  copyTo?: CopyTo | undefined;
  /** Once they're let go of: open the document again, from what Alcove has. */
  onLetGo: () => void;
}) {
  const save = useSaveCopy();
  const [asking, setAsking] = useState(false);
  const failed = (e: unknown) => { say(wsToast.failed(errorMessage(e))); };
  const copy = () => { navigator.clipboard.writeText(session.localCopy().text).then(() => say(wsToast.copiedText()), failed); };
  const saveAsNew = copyTo && (() => {
    const { workspaceId, parent, go } = copyTo;
    void (async () => {
      const { retitled, titleIn } = await import('./editor/title');
      const { state } = session.localCopy();
      const name = `${copyTo.name() ?? (titleIn(state) || 'Untitled')} copy`;
      const { id } = await save.mutateAsync({ workspaceId, input: { kind: 'document', name, parent, state: retitled(state, name) } });
      // It's all in the copy now, which Alcove has: this document carries on from what Alcove has of it.
      await session.discardUnsaved();
      rlog.info('saved unsent words as a new document', { workspaceId, copy: id });
      say(wsToast.savedAsNew(name));
      go(id);
    })().catch((e: unknown) => { rlog.warn('couldn’t save unsent words as a new document', { workspaceId, err: e }); failed(e); });
  });
  const discard = () => {
    setAsking(false);
    session.discardUnsaved().then(() => {
      rlog.info('discarded unsent words');
      say(wsToast.discarded());
      onLetGo();
    }, failed);
  };
  return (
    <WsRescue onCopy={copy} onSaveAsNew={saveAsNew} saving={save.isPending}
      discard={{ open: asking, onOpenChange: setAsking, content: <WsDiscardAsk onDiscard={discard} onKeep={() => setAsking(false)} /> }} />
  );
}

/**
 * A document that isn't in the list: deleted, taken away, or never there. If this device holds something written in it that
 * didn't reach Alcove, that's offered here, however long ago it was written.
 */
export function KeptHere({ workspaceId, documentId, owner, pass, say, copyTo, back }: {
  workspaceId: string; documentId: string; owner: string | null; pass: string | undefined;
  say: (toast: WsToastData) => void; copyTo?: CopyTo | undefined;
  /** The way back, when there's nothing kept. */
  back: ReactNode;
}) {
  const [session, setSession] = useState<DocSession | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!owner) return undefined;
    let left = false;
    let held: DocSession | null = null;
    keptDocuments(owner).then(async (kept) => {
      if (left || !kept.some((k) => k.workspace === workspaceId && k.document === documentId)) return;
      const s = await openDocument(workspaceId, documentId, owner, pass);
      if (left) s.close();
      else { held = s; setSession(s); }
    }).catch((e: unknown) => { rlog.warn('couldn’t read what this device kept for a document', { workspaceId, documentId, err: e }); });
    return () => { left = true; held?.close(); setSession(null); };
  }, [workspaceId, documentId, owner, pass, round]);
  if (!session) return <WsCantOpen what="document" action={back} />;
  return <KeptIn session={session} say={say} copyTo={copyTo} back={back} onLetGo={() => setRound((r) => r + 1)} />;
}

function KeptIn({ session, say, copyTo, back, onLetGo }: { session: DocSession; say: (toast: WsToastData) => void; copyTo?: CopyTo | undefined; back: ReactNode; onLetGo: () => void }) {
  const { unsent } = useLive(session);
  return <WsCantOpen what="document" unsent={unsent} action={unsent ? <Rescue session={session} say={say} copyTo={copyTo} onLetGo={onLetGo} /> : back} />;
}
