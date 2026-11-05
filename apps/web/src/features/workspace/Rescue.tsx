/*
 * Words that didn't reach Alcove, and what someone can do with them: copy them, save them as a new document, or let them go.
 * Only their own words, ever (`unsentCopy`): what this browser wrote that Alcove hasn't got, never the rest of the document,
 * which may be restricted from them now, or gone. Someone who can still open the document can select and copy it as usual.
 * They're offered wherever the words may not get there by themselves: a document that refused them, or one that can't be
 * opened any more, including one that's left the list while this device still holds something written in it.
 */
import { errorMessage, type DocSession } from '@alcove/api';
import { WsCantOpen, WsDiscardAsk, WsRescue, wsToast, type WsToastData } from '@alcove/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { useSaveCopy } from '~/lib/queries';
import { keptDocuments } from './keep';
import { openDocument } from './session';

const rlog = log.child({ component: 'workspace-rescue' });

/**
 * Where a new document of someone's words goes, for someone who can make one there. `name`: what the document they came from
 * is called, read when the copy's made: what the list calls it, or last called one that's gone.
 */
export interface CopyTo { workspaceId: string; name: () => string | null; parent: string | null; go: (id: string) => void }

/** What a new document of someone's words is called, after the one they were written in. */
const copyName = (from: string | null) => (from ? `Your words from ${from}` : 'Your words');

export function Rescue({ session, say, copyTo, gone = false, copyOnly = false, onLetGo }: {
  session: DocSession;
  say: (toast: WsToastData) => void;
  copyTo?: CopyTo | undefined;
  /** The document can't be opened any more. */
  gone?: boolean | undefined;
  /**
   * Only Copy text: the session hasn't found out yet that the words can't get there, so nothing would let go of them, and
   * neither Save as new document nor Discard would work.
   */
  copyOnly?: boolean | undefined;
  /** Once what was taken is let go of: open the document again, from what Alcove has. */
  onLetGo: () => void;
}) {
  const save = useSaveCopy();
  const [asking, setAsking] = useState(false);
  const failed = (e: unknown) => { say(wsToast.failed(errorMessage(e))); };
  const copy = () => { navigator.clipboard.writeText(session.unsentCopy().text).then(() => say(wsToast.copiedText()), failed); };
  const saveAsNew = copyTo && !copyOnly ? () => {
    const { workspaceId, parent, go } = copyTo;
    // Taken now: what's typed while it saves isn't in it, and isn't let go of.
    const taken = session.unsentCopy();
    const name = copyName(copyTo.name());
    void (async () => {
      const { stateOf } = await import('./unsentDoc');
      const { id } = await save.mutateAsync({ workspaceId, input: { kind: 'document', name, parent, state: stateOf(taken.text) } });
      await session.discardUnsaved(taken.token);
      rlog.info('saved unsent words as a new document', { workspaceId, copy: id });
      say(wsToast.savedAsNew(() => go(id)));
      onLetGo();
    })().catch((e: unknown) => { rlog.warn('couldn’t save unsent words as a new document', { workspaceId, err: e }); failed(e); });
  } : undefined;
  const discard = () => {
    setAsking(false);
    session.discardUnsaved(session.unsentCopy().token).then(() => {
      rlog.info('discarded unsent words');
      say(wsToast.discarded());
      onLetGo();
    }, failed);
  };
  return (
    <WsRescue onCopy={copy} onSaveAsNew={saveAsNew} saving={save.isPending}
      discard={copyOnly ? undefined : { open: asking, onOpenChange: setAsking, content: <WsDiscardAsk gone={gone} onDiscard={discard} onKeep={() => setAsking(false)} /> }} />
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

/** Until its session closes, having found the document can't be opened, the words may still get there: only Copy text till then. */
function KeptIn({ session, say, copyTo, back, onLetGo }: { session: DocSession; say: (toast: WsToastData) => void; copyTo?: CopyTo | undefined; back: ReactNode; onLetGo: () => void }) {
  const { unsent, closed } = useLive(session);
  return <WsCantOpen what="document" unsent={unsent} action={unsent ? <Rescue session={session} say={say} copyTo={copyTo} gone copyOnly={closed === null} onLetGo={onLetGo} /> : back} />;
}
