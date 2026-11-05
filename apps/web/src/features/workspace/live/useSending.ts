/*
 * Sending something from the call into the document you were last in. On the page it lands where you can see it, and glows;
 * anywhere else it goes in through a session of its own, and a toast says where it went and goes there. Whichever way, it's
 * an edit like anyone's, so everyone with the document open sees it arrive.
 */
import { errorMessage, type WorkspaceHere } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { q } from '~/lib/queries';
import type { Ws, WorkspacePlace } from '../context';
import type { BlockJSON } from '../editor/types';
import { withDocument } from '../session';
import { nameOf, type Tree } from '../tree';
import { decidedBlock, followUpBlock, quoteBlocks } from './blocks';
import { dateOf } from './dates';
import { momentOf, personNamed, sameName } from './lines';
import type { LiveCall, LivePut } from './types';

interface Sending {
  live: LiveCall | undefined;
  workspaceId: string;
  pass: string | undefined;
  owner: string | null;
  tree: Tree;
  at: WorkspacePlace;
  /** Whether you're in the workspace, which is what asking who's in it takes. */
  member: boolean;
  here: readonly WorkspaceHere[];
  closed: boolean;
  go: Ws['go'];
  say: (toast: WsToastData) => void;
  openDoc: Ws['openDoc'];
  /** Where you'd been before this call, for a live page opened first. */
  remembered: string | null;
}

/** The document you were last in, and how to send things to it while you can edit it. */
export function useSending({ live, workspaceId, pass, owner, tree, at, member, here, closed, go, say, openDoc, remembered }: Sending): { put: LivePut | null; lastDocument: string | null } {
  const [last, setLast] = useState<string | null>(remembered);
  const documentId = at.kind === 'document' ? at.id : null;
  useEffect(() => { if (documentId) setLast(documentId); }, [documentId]);
  const item = last === null ? undefined : tree.all.get(last);
  const target = item && item.kind === 'document' && item.role === 'edit' && item.trashedAt === null ? item : null;
  const targetId = target?.id ?? null;
  const targetName = target ? nameOf(target) : null;

  const people = useQuery({ ...q.workspacePeople(workspaceId), enabled: live !== undefined && member }).data;
  /* What sending reads changes all the time, and the arrows' labels shouldn't be drawn again for it. */
  const latest = useRef({ people, here, closed, go, say });
  latest.current = { people, here, closed, go, say };

  const put = useMemo((): LivePut | null => {
    if (!live || targetId === null || targetName === null) return null;
    const failed = (e: unknown) => latest.current.say(wsToast.failed(errorMessage(e)));
    const goTo = (block: string | undefined) => { live.reveal(); latest.current.go({ kind: 'document', id: targetId, block }); };
    const send = async (blocks: BlockJSON[]) => {
      const open = openDoc.current;
      if (open?.id === targetId && open.editor) {
        const [first] = open.editor.insertBlocks(blocks, 'tail');
        if (first === undefined) return;
        if (latest.current.closed) latest.current.say(wsToast.addedTo(targetName, () => goTo(first)));
        else open.editor.scrollToBlock(first, { smooth: true, flash: true });
        return;
      }
      /* The editor's half loads with the first document, and this may be the first thing to need it. */
      const { appendBlocks } = await import('../editor/ydoc');
      let landed: string[] = [];
      await withDocument(workspaceId, targetId, owner, pass, (doc) => { landed = appendBlocks(doc, blocks); });
      latest.current.say(wsToast.addedTo(targetName, () => goTo(landed[0])));
    };
    /** Who a name in the notes tags, as the document knows people: someone in this workspace, then someone in the call. */
    const tagFor = (name: string | undefined) => {
      if (!name) return null;
      const known = [...(latest.current.people ?? []).map((p) => p.person), ...latest.current.here.map((h) => h.person)];
      const found = known.find((p) => p.name === name) ?? known.find((p) => sameName(p.name, name)) ?? personNamed(live.session.getSnapshot(), name);
      return found ? { id: found.id, name: found.name } : null;
    };
    return {
      target: targetName,
      decided: (text) => { send([decidedBlock(text)]).catch(failed); },
      followUp: ({ text, owner: who, due }) => { send([followUpBlock({ text, who: tagFor(who), owner: who, date: due ? dateOf(due, new Date()) : null, due })]).catch(failed); },
      line: (l) => { send(quoteBlocks(momentOf(live.session.getSnapshot(), l))).catch(failed); }
    };
  }, [live, targetId, targetName, workspaceId, owner, pass, openDoc]);

  useEffect(() => { live?.onPut(put); }, [live, put]);
  useEffect(() => () => { live?.onPut(null); }, [live]);
  return { put, lastDocument: last };
}
