/*
 * The list down the side of a workspace: which workspace it is, what's in it, and everything you can do to it. Nothing
 * opens a window: a new folder is named in its row, a new workspace in the head, and menus sit against what opened them.
 */
import { errorMessage, type WorkspaceItem, type WorkspaceSummary } from '@alcove/api';
import { WsDropLine, WsList, WsListHead, WsMovePicker, WsNewMenu, WsRenameRow, WsRow, WsRowMenu, WsSection, WsSpacePicker, WsTrashRow, wsToast, type WsMenuRow, type WsNaming, type WsPoint, type WsPop, type WsSpaceChoice } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { q, useCreateWorkspace, useRenameWorkspace } from '~/lib/queries';
import { focusRow } from './actions';
import { useWs } from './context';
import type { RowDrag } from './drag';
import { PeopleSheet } from './Sheets';
import { foldersFor, nameOf, nudged, rowsOf, trashIn } from './tree';

const peopleWords = (n: number | null) => (n === null ? 'Only what’s shared with you' : n === 1 ? 'Just you' : `${n} people`);
const spaceChoice = (w: WorkspaceSummary): WsSpaceChoice => ({ id: w.id, name: w.name ?? 'Shared with you', sub: peopleWords(w.people), icon: w.people === 1 ? 'lock' : 'folders' });

/** A row's menu: which row, where it opened if someone right-clicked, and whether Move to… has taken its place. */
interface RowMenu { id: string; at?: WsPoint | undefined; moving: boolean }

/** What the list needs of a drag in progress. */
export interface ListDrag { drag: RowDrag | null; arm: (e: PointerEvent<HTMLElement>, id: string) => void; ended: () => boolean }

/** The name at the top of the list: your workspaces, who's in this one, and making a new one. */
function useHead(onNaming: (n: 'new' | 'rename') => void) {
  const ws = useWs();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState(false);
  /* A guest in a call has no account, so no workspaces to ask for. */
  const spaces = useQuery({ ...q.workspaces(), enabled: ws.owner !== null });
  const close = () => { setOpen(false); setPeople(false); };
  const about: WsMenuRow[] = [];
  if (ws.sent.role !== null) about.push({ icon: 'people', label: 'People', sub: peopleWords(ws.sent.people), onSelect: () => setPeople(true) });
  if (ws.sent.role === 'admin') about.push({ icon: 'pen', label: 'Rename', onSelect: () => { close(); onNaming('rename'); } });
  const list = (spaces.data ?? []).map(spaceChoice);
  const choices = list.some((s) => s.id === ws.workspaceId) ? list : [{ id: ws.workspaceId, name: ws.spaceName, sub: peopleWords(ws.sent.people) }, ...list];
  return {
    open, onOpenChange: (to: boolean) => { if (to) { setOpen(true); void spaces.refetch(); } else close(); },
    content: ws.call?.picker ?? (people ? <PeopleSheet /> : (
      <WsSpacePicker spaces={choices} current={ws.workspaceId} canChoose heading="Workspaces" about={about}
        onPick={(id) => { close(); if (id !== ws.workspaceId) ws.switchTo(id); }} onNew={() => { close(); onNaming('new'); }} />
    ))
  } satisfies WsPop;
}

export function List({ drags }: { drags: ListDrag }) {
  const ws = useWs();
  const { tree, sent, actions, canChange } = ws;
  const [menu, setMenu] = useState<RowMenu | null>(null);
  /** Plus: at the top of the list (null), or on a folder. */
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const create = useCreateWorkspace();
  const renameSpace = useRenameWorkspace();
  const picker = useHead(setNaming);
  const { drag, arm, ended } = drags;
  const member = sent.role !== null;
  const refused = (e: unknown) => { ws.say(wsToast.failed(errorMessage(e))); };

  const canEdit = (item: WorkspaceItem) => item.role === 'edit';
  const openRow = (item: WorkspaceItem) => {
    if (ended()) return;
    if (item.kind === 'folder') { ws.setOpen(item.id, !ws.open.has(item.id)); return; }
    ws.go({ kind: 'document', id: item.id });
  };
  const newIn = (parent: string | null) => (
    <WsNewMenu onDocument={() => { setAdding(undefined); actions.newDocument(parent); }} onFolder={() => { setAdding(undefined); if (parent) ws.setOpen(parent, true); ws.setDraft({ parent }); }} />
  );
  const menuFor = (item: WorkspaceItem): WsPop | undefined => {
    const folder = item.kind === 'folder';
    const changing = canChange && canEdit(item);
    if (folder && !changing) return undefined;
    const open = menu?.id === item.id;
    const close = () => setMenu(null);
    const brought = ws.call?.brought?.(item.id);
    return {
      open, at: open ? menu.at : undefined,
      onOpenChange: (to) => setMenu(to ? { id: item.id, moving: false } : null),
      content: !open ? null : menu.moving ? (
        <WsMovePicker name={nameOf(item)} space={ws.spaceName} folders={foldersFor(tree, item.id)}
          onRoot={() => { close(); actions.move(item.id, { parent: null }); }} onFolder={(id) => { close(); actions.move(item.id, { parent: id }); }} />
      ) : (
        <WsRowMenu folder={folder} brought={brought}
          onRename={canEdit(item) ? () => { close(); ws.setRenaming(item.id); } : undefined}
          onDuplicate={changing ? () => { close(); actions.duplicate(item.id); } : undefined}
          onMove={changing ? () => setMenu({ ...menu, moving: true }) : undefined}
          onToggleCall={brought === undefined ? undefined : () => { close(); ws.call?.onBring?.(item.id, !brought); }}
          onCopyLink={folder ? undefined : () => { close(); actions.copyLink(item.id); }}
          onTrash={changing ? () => { close(); actions.trash(item.id); } : undefined} />
      )
    };
  };
  const addFor = (item: WorkspaceItem): WsPop | undefined => (canChange ? {
    open: adding === item.id, onOpenChange: (to) => setAdding(to ? item.id : undefined), content: adding === item.id ? newIn(item.id) : null
  } : undefined);
  const rowKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const id = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-row]')?.dataset['row'] : undefined;
    const item = id === undefined ? undefined : tree.all.get(id);
    if (!item || (e.target instanceof HTMLInputElement)) return;
    const changing = canChange && canEdit(item);
    if (e.key === 'F2' && canEdit(item)) { e.preventDefault(); ws.setRenaming(item.id); }
    else if ((e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) && changing) {
      e.preventDefault();
      const listed = rowsOf(tree, ws.open).flatMap((r) => (r.draft ? [] : [r.item.id]));
      const at = listed.indexOf(item.id);
      const near = listed[at + 1] ?? listed[at - 1];
      actions.trash(item.id);
      if (near) focusRow(near);
    }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && changing) {
      e.preventDefault();
      e.stopPropagation();
      const to = nudged(tree, item.id, e.key === 'ArrowUp' ? -1 : 1);
      if (to) { actions.move(item.id, to); focusRow(item.id); }
    }
  };
  const namingField: WsNaming | null = naming === null ? null : naming === 'new' ? {
    name: '', placeholder: 'Name this workspace', onCancel: () => setNaming(null),
    onCommit: (name) => {
      setNaming(null);
      const to = name.trim();
      if (to) create.mutateAsync(to).then(({ id }) => { ws.switchTo(id); }, refused);
    }
  } : {
    name: ws.spaceName, placeholder: 'Name this workspace', onCancel: () => setNaming(null),
    onCommit: (name) => {
      setNaming(null);
      const to = name.trim();
      if (to && to !== ws.spaceName) renameSpace.mutateAsync({ id: ws.workspaceId, name: to }).catch(refused);
    }
  };

  const rows = rowsOf(tree, ws.open, ws.draft?.parent).map((row): ReactElement => {
    if (row.draft) {
      return (
        <WsRenameRow key="draft" name="" kind="folder" depth={row.depth} onCancel={() => ws.setDraft(null)}
          onCommit={(name) => { const parent = ws.draft?.parent ?? null; ws.setDraft(null); if (name.trim()) actions.newFolder(parent, name.trim()); }} />
      );
    }
    const { item, depth, open } = row;
    const folder = item.kind === 'folder';
    if (ws.renaming === item.id) {
      return (
        <WsRenameRow key={item.id} name={item.name} kind={folder ? 'folder' : 'document'} depth={depth} placeholder={folder ? 'Name this folder' : 'Name this document'}
          onCancel={() => { ws.setRenaming(null); focusRow(item.id); }} onCommit={(name) => { ws.setRenaming(null); actions.rename(item.id, name); focusRow(item.id); }} />
      );
    }
    return (
      <WsRow key={item.id} id={item.id} name={nameOf(item)} kind={folder ? 'folder' : 'document'} depth={depth} open={open}
        current={ws.at.kind === 'document' && ws.at.id === item.id} flash={ws.glowing.has(item.id)}
        into={(drag?.spot?.kind === 'place' && drag.spot.into === item.id) || ws.blockInto === item.id} ghosted={drag?.id === item.id}
        onOpen={() => openRow(item)} onTwist={folder ? () => ws.setOpen(item.id, !open) : undefined}
        menu={menuFor(item)} add={folder ? addFor(item) : undefined}
        onRename={canEdit(item) ? () => ws.setRenaming(item.id) : undefined}
        onContextMenu={(e) => { if (folder && !(canChange && canEdit(item))) return; e.preventDefault(); setMenu({ id: item.id, at: { x: e.clientX, y: e.clientY }, moving: false }); }}
        onPointerDown={(e) => arm(e, item.id)} />
    );
  });
  const trash = trashIn(ws.items);

  return (
    <WsList listKey={ws.workspaceId} onKeyDown={rowKeys} empty={rows.length === 0} foot={member ? <WsTrashRow count={trash.length} current={ws.at.kind === 'trash'} into={drag?.spot?.kind === 'trash'} onOpen={() => ws.go({ kind: 'trash' })} /> : undefined}
      head={member || ws.mode === 'page' ? (
        <WsListHead name={ws.spaceName} pickerLabel={ws.mode === 'page' ? 'Workspaces' : undefined} picker={picker} naming={namingField}
          create={canChange ? { open: adding === null, onOpenChange: (to) => setAdding(to ? null : undefined), content: adding === null ? newIn(null) : null } : undefined} />
      ) : undefined}>
      {ws.call?.top}
      {/* Someone outside the workspace has the head's words for it in the app, and in a call no head at all. */}
      {member ? <WsSection key="section" label="Documents" /> : ws.mode === 'call' ? <WsSection key="section" label="Shared with you" /> : null}
      {rows}
      {drag?.spot?.kind === 'place' && drag.spot.line && <WsDropLine key="line" top={drag.spot.line.top} left={drag.spot.line.left} />}
    </WsList>
  );
}
