/*
 * Trash, beside the list: what's in it, who sent it there and how long it has left, with Restore and Delete forever. It
 * reads the same tree as the list, so what someone else sends there arrives by itself.
 */
import { firstName, type WorkspaceItem } from '@alcove/api';
import { WsDeleteAsk, WsDoc, WsDocHead, WsScroll, WsTrash, type WsTrashItem } from '@alcove/ui';
import { useState } from 'react';
import { useNow } from '~/lib/live';
import { agoLabel } from '~/lib/time';
import { useWs } from './context';
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
  const items = trashIn(ws.items).map((item): WsTrashItem => {
    const name = nameOf(item);
    const can = item.role === 'edit';
    return {
      id: item.id, name, folder: item.kind === 'folder', sub: kept(item, now),
      onOpen: item.kind === 'folder' ? undefined : () => ws.go({ kind: 'document', id: item.id }),
      onRestore: can ? () => ws.actions.restore(item.id) : undefined,
      onDelete: can && ws.canChange ? {
        open: asking === item.id, onOpenChange: (to) => setAsking(to ? item.id : null),
        content: <WsDeleteAsk name={name} onKeep={() => setAsking(null)} onDelete={() => { setAsking(null); ws.actions.deleteForever(item.id); }} />
      } : undefined
    };
  });
  return (
    <WsDoc>
      <WsDocHead crumbs={[ws.spaceName, 'Trash']} save="quiet" onToggleList={ws.toggleList} />
      <WsScroll><WsTrash items={items} /></WsScroll>
    </WsDoc>
  );
}
