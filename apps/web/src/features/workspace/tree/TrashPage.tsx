/*
 * Trash, beside the list: what's in it, who sent it there and how long it has left, with Restore and Delete forever. It
 * reads the same tree as the list, so what someone else sends there arrives by itself. Deleting for good is for people in the
 * workspace who can edit it: someone it's open to through a call brings things back, and that's all.
 */
import { firstName, type WorkspaceItem } from '@alcove/api';
import { WsDeleteAsk, WsDoc, WsScroll, WsTrash, type WsTrashItem } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { useNow } from '~/lib/live';
import { agoLabel } from '~/lib/time';
import { useWs } from '../context';
import { PaneHead, pathTo } from '../Head';
import { nameOf, trashIn } from './tree';

const KEPT_DAYS = 30;

function kept(item: WorkspaceItem, now: number): string {
  const when = item.trashedAt ?? '';
  const left = KEPT_DAYS - (now - new Date(when).getTime()) / 86_400_000;
  const who = item.trashedBy ? firstName(item.trashedBy) : 'Someone';
  return `${who}, ${agoLabel(when, now)} · ${left <= 1 ? 'Goes today' : `${Math.ceil(left)} days left`}`;
}

export function TrashPage() {
  const ws = useWs();
  const now = useNow(60_000);
  const [asking, setAsking] = useState<string | null>(null);
  const trash = trashIn(ws.items, ws.tree.boards);
  const deletes = ws.sent.role === 'admin' || ws.sent.role === 'edit';
  /*
   * Deleted for good, the row and the ask that was open over it go together: the keyboard goes to what took the row's
   * place, or the row before it, or back to Trash in the list once nothing's left.
   */
  const refocusAt = useRef<number | null>(null);
  useEffect(() => {
    const at = refocusAt.current;
    if (at === null) return;
    refocusAt.current = null;
    const rows = [...document.querySelectorAll<HTMLElement>('.wx-r')];
    const row = rows[at] ?? rows[at - 1];
    (row?.querySelector<HTMLElement>('button') ?? document.querySelector<HTMLElement>('.wt-trash'))?.focus();
  }, [trash.length]);
  const items = trash.map((item, index): WsTrashItem => {
    const name = nameOf(item);
    const can = item.role === 'edit';
    return {
      id: item.id, name, kind: item.kind, sub: kept(item, now),
      onOpen: item.kind === 'folder' ? undefined : () => ws.go({ kind: 'document', id: item.id }),
      onRestore: can ? () => ws.actions.restore(item.id) : undefined,
      onDelete: can && deletes ? {
        open: asking === item.id, onOpenChange: (to) => setAsking(to ? item.id : null),
        content: <WsDeleteAsk name={name} onKeep={() => setAsking(null)} onDelete={() => { setAsking(null); refocusAt.current = index; ws.actions.deleteForever(item.id); }} />
      } : undefined
    };
  });
  return (
    <WsDoc>
      <PaneHead crumbs={pathTo(ws, null, 'Trash')} save="quiet" />
      <WsScroll><WsTrash items={items} /></WsScroll>
    </WsDoc>
  );
}
