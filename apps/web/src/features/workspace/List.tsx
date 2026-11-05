/*
 * The list down the side of a workspace: which workspace it is, what's in it, and everything you can do to it. Nothing
 * opens a window: a new folder is named in its row, a new workspace in the head, and menus sit against what opened them.
 */
import { errorMessage, type WorkspaceItem, type WorkspaceSummary } from '@alcove/api';
import { WsDropLine, WsList, WsListHead, WsMovePicker, WsNewMenu, WsRenameRow, WsRow, WsRowMenu, WsSection, WsSpacePicker, WsTrashRow, wsToast, type WsMenuRow, type WsNaming, type WsPoint, type WsPop, type WsSpaceChoice } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { q, useCreateWorkspace, useRenameWorkspace } from '~/lib/queries';
import { focusRow } from './actions';
import { useWs, type WorkspaceArea } from './context';
import type { RowDrag } from './drag';
import { PersonCard } from './People';
import { facesIn } from './presence';
import { PeopleSheet } from './Sheets';
import { foldersFor, nameOf, nudged, rowsOf, trashIn } from './tree';

/** Who's in a workspace, in the words under its name. */
export const peopleWords = (n: number | null) => (n === null ? 'Only what’s shared with you' : n === 1 ? 'Just you' : `${n} people`);
/** A workspace as a row of the menu under the name at the top of the list. */
export const spaceChoice = (w: WorkspaceSummary): WsSpaceChoice => ({ id: w.id, name: w.name ?? 'Shared with you', sub: peopleWords(w.people), icon: w.people === 1 ? 'lock' : 'folders' });

/** A row's menu: which row, in which part of the list, where it opened if someone right-clicked, and whether Move to… has taken its place. */
interface RowMenu { id: string; area: WorkspaceArea; at?: WsPoint | undefined; moving: boolean }

/** What the list needs of a drag in progress. */
export interface ListDrag { drag: RowDrag | null; arm: (e: PointerEvent<HTMLElement>, id: string) => void; ended: () => boolean }

/** A document just brought to the call glows where it landed, for 1.4 s, as anything arriving in the list does. */
function useJustBrought(ids: readonly string[]): ReadonlySet<string> {
  const [lit, setLit] = useState<ReadonlySet<string>>(new Set());
  const was = useRef(ids);
  const key = ids.join(' ');
  useEffect(() => {
    const before = was.current;
    was.current = key ? key.split(' ') : [];
    const fresh = was.current.filter((id) => !before.includes(id));
    if (!fresh.length) return;
    setLit((on) => new Set([...on, ...fresh]));
    setTimeout(() => setLit((on) => new Set([...on].filter((id) => !fresh.includes(id)))), 1400);
  }, [key]);
  return lit;
}

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
  /* In a call whoever chooses the workspace has the call's own picker, and everyone else is told who chooses. */
  const call = ws.call;
  return {
    open, onOpenChange: (to: boolean) => { if (to) { setOpen(true); void spaces.refetch(); } else close(); },
    content: people ? <PeopleSheet /> : call?.picker ? call.picker({ workspaceId: ws.workspaceId, name: ws.spaceName, people: ws.sent.people, about, close }) : call ? (
      <WsSpacePicker spaces={[{ id: ws.workspaceId, name: ws.spaceName, sub: peopleWords(ws.sent.people) }]} current={ws.workspaceId} canChoose={false} organizer={call.chooser} about={about} onPick={close} onNew={close} />
    ) : (
      <WsSpacePicker spaces={choices} current={ws.workspaceId} canChoose heading="Workspaces" about={about}
        onPick={(id) => { close(); if (id !== ws.workspaceId) ws.switchTo(id); }} onNew={() => { close(); onNaming('new'); }} />
    )
  } satisfies WsPop;
}

export function List({ drags }: { drags: ListDrag }) {
  const ws = useWs();
  const { tree, sent, actions, canChange } = ws;
  const [menu, setMenu] = useState<RowMenu | null>(null);
  /** Plus: at the top of the list (null), or on a folder. */
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  /** The row whose faces were pressed. */
  const [card, setCard] = useState<string | null>(null);
  const create = useCreateWorkspace();
  const renameSpace = useRenameWorkspace();
  const picker = useHead(setNaming);
  const { drag, arm, ended } = drags;
  const member = sent.role !== null;
  const refused = (e: unknown) => { ws.say(wsToast.failed(errorMessage(e))); };
  /* What's brought to the call and still here. Someone outside the workspace has it among what's shared with them. */
  const call = ws.call;
  const inCall = (call?.documents ?? []).flatMap((id) => { const item = tree.all.get(id); return member && item && item.kind === 'document' && item.trashedAt === null ? [item] : []; });
  const justBrought = useJustBrought(inCall.map((i) => i.id));

  const canEdit = (item: WorkspaceItem) => item.role === 'edit';
  const openRow = (item: WorkspaceItem, area: WorkspaceArea) => {
    if (ended()) return;
    if (item.kind === 'folder') { ws.setOpen(item.id, !ws.open.has(item.id)); return; }
    ws.go({ kind: 'document', id: item.id, area });
  };
  /** The row that's open is the one it was opened from: a document in This call is in Documents too. */
  const currentIn = (area: WorkspaceArea, id: string) => ws.at.kind === 'document' && ws.at.id === id && (ws.at.area ?? (inCall.some((i) => i.id === id) ? 'pins' : 'tree')) === area;
  const newIn = (parent: string | null) => (
    <WsNewMenu onDocument={() => { setAdding(undefined); actions.newDocument(parent); }} onFolder={() => { setAdding(undefined); if (parent) ws.setOpen(parent, true); ws.setDraft({ parent }); }} />
  );
  const menuFor = (item: WorkspaceItem, area: WorkspaceArea): WsPop | undefined => {
    const folder = item.kind === 'folder';
    const changing = canChange && canEdit(item);
    if (folder && !changing) return undefined;
    const open = menu?.id === item.id && menu.area === area;
    const close = () => setMenu(null);
    const brought = call && !folder ? call.documents.includes(item.id) : undefined;
    return {
      open, at: open ? menu.at : undefined,
      onOpenChange: (to) => setMenu(to ? { id: item.id, area, moving: false } : null),
      content: !open ? null : menu.moving ? (
        <WsMovePicker name={nameOf(item)} space={ws.spaceName} folders={foldersFor(tree, item.id)}
          onRoot={() => { close(); actions.move(item.id, { parent: null }); }} onFolder={(id) => { close(); actions.move(item.id, { parent: id }); }} />
      ) : (
        <WsRowMenu folder={folder} brought={brought}
          onRename={canEdit(item) ? () => { close(); ws.setRenaming(item.id); } : undefined}
          onDuplicate={changing ? () => { close(); actions.duplicate(item.id); } : undefined}
          onMove={changing ? () => setMenu({ ...menu, moving: true }) : undefined}
          onToggleCall={brought === undefined ? undefined : () => { close(); call?.onBring(item.id, !brought); }}
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

  const rowOf = (item: WorkspaceItem, area: WorkspaceArea, depth: number, open: boolean): ReactElement => {
    const folder = item.kind === 'folder';
    const key = `${area}:${item.id}`;
    if (ws.renaming === item.id && area === 'tree') {
      return (
        <WsRenameRow key={key} name={item.name} kind={folder ? 'folder' : 'document'} depth={depth} placeholder={folder ? 'Name this folder' : 'Name this document'}
          onCancel={() => { ws.setRenaming(null); focusRow(item.id); }} onCommit={(name) => { ws.setRenaming(null); actions.rename(item.id, name); focusRow(item.id); }} />
      );
    }
    const faces = folder ? [] : facesIn(ws.here, item.id);
    const first = faces[0];
    return (
      <WsRow key={key} id={item.id} name={nameOf(item)} kind={folder ? 'folder' : 'document'} depth={depth} open={open} area={area} faces={faces}
        facesCard={first && { open: card === key, onOpenChange: (to) => setCard(to ? key : null), content: card === key ? <PersonCard person={first} onDone={() => setCard(null)} /> : null }}
        current={currentIn(area, item.id)} flash={ws.glowing.has(item.id) || (area === 'pins' && justBrought.has(item.id))}
        into={(drag?.spot?.kind === 'place' && drag.spot.into === item.id) || (area === 'tree' && ws.blockInto === item.id)} ghosted={drag?.id === item.id}
        onOpen={() => openRow(item, area)} onTwist={folder ? () => ws.setOpen(item.id, !open) : undefined}
        menu={menuFor(item, area)} add={folder ? addFor(item) : undefined}
        onRename={canEdit(item) ? () => ws.setRenaming(item.id) : undefined}
        onContextMenu={(e) => { if (folder && !(canChange && canEdit(item))) return; e.preventDefault(); setMenu({ id: item.id, area, at: { x: e.clientX, y: e.clientY }, moving: false }); }}
        onPointerDown={(e) => arm(e, item.id)} />
    );
  };
  const rows = rowsOf(tree, ws.open, ws.draft?.parent).map((row): ReactElement => {
    if (row.draft) {
      return (
        <WsRenameRow key="draft" name="" kind="folder" depth={row.depth} onCancel={() => ws.setDraft(null)}
          onCommit={(name) => { const parent = ws.draft?.parent ?? null; ws.setDraft(null); if (name.trim()) actions.newFolder(parent, name.trim()); }} />
      );
    }
    return rowOf(row.item, 'tree', row.depth, row.open);
  });
  const trash = trashIn(ws.items);

  return (
    <WsList listKey={ws.workspaceId} onKeyDown={rowKeys} empty={rows.length === 0} foot={member ? <WsTrashRow count={trash.length} current={ws.at.kind === 'trash'} into={drag?.spot?.kind === 'trash'} onOpen={() => ws.go({ kind: 'trash' })} /> : undefined}
      head={member || ws.mode === 'page' ? (
        <WsListHead name={ws.spaceName} pickerLabel={ws.mode === 'page' ? 'Workspaces' : undefined} picker={picker} naming={namingField} onFind={ws.openFind}
          create={canChange ? { open: adding === null, onOpenChange: (to) => setAdding(to ? null : undefined), content: adding === null ? newIn(null) : null } : undefined} />
      ) : undefined}>
      {(call?.top || inCall.length > 0) && <WsSection key="call" label="This call" area="pins" into={drag?.spot?.kind === 'bring'} />}
      {call?.top}
      {inCall.map((item) => rowOf(item, 'pins', 0, false))}
      {/* Someone outside the workspace has the head's words for it in the app, and in a call no head at all. */}
      {member ? <WsSection key="section" label="Documents" /> : ws.mode === 'call' ? <WsSection key="section" label="Shared with you" /> : null}
      {rows}
      {drag?.spot?.kind === 'place' && drag.spot.line && <WsDropLine key="line" top={drag.spot.line.top} left={drag.spot.line.left} />}
    </WsList>
  );
}
