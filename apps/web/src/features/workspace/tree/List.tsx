/*
 * The list down the side of a workspace: which workspace it is, what's in it, and everything you can do to it. Nothing
 * opens a window: a new folder is named in its row, a new workspace in the head, and menus sit against what opened them.
 *
 * In a call the frame's bar names the workspace and its name is the workspace's one menu (call/workspace/WorkspacePanel.tsx),
 * so the list's top is Find and New. This call comes first: the call's own pages, then, in its home, what's in the call's own
 * folder (`Ws.callFolder`, which isn't listed again under Documents), then what's been brought to the call.
 */
import { errorMessage, type WorkspaceItem, type WorkspaceSummary } from '@alcove/api';
import { WsDropLine, WsList, WsListTools, WsMovePicker, WsNewMenu, WsRenameRow, WsRow, WsRowMenu, WsSection, WsSpacePicker, WsTrashRow, wsToast, type IconName, type WsMenuRow, type WsNaming, type WsPoint, type WsPop, type WsSpaceChoice } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { shortcut } from '~/lib/keys';
import { useNow } from '~/lib/live';
import { workspaceQueries, useCreateWorkspace, useRenameWorkspace } from '~/features/workspace/queries';
import { hm, hms } from '~/lib/time';
import { focusRow } from './actions';
import { CallPages } from '../live/CallPages';
import { useWs, type WorkspaceArea } from '../context';
import type { RowDrag } from './drag';
import { PersonCard } from '../sharing/People';
import { facesIn } from '../presence';
import { PeopleSheet } from '../sharing/Sheets';
import { saysNew, useSeen } from './seen';
import { foldersFor, isWithin, nameOf, nudged, rowsOf, trashIn, type ListRow } from './tree';

/** Who's in a workspace, in the words under its name. */
export const peopleWords = (n: number | null) => (n === null ? 'Only what’s shared with you' : n === 1 ? 'Just you' : `${n} people`);
/**
 * What each workspace in a list of them is called: its name, and where calls' homes share one (the same call twice in a day),
 * the time its call started too ("Art's call · 5 Nov, 14:30"), to the second if they started in the same minute, so no
 * two rows read the same.
 */
export function namesIn(spaces: readonly WorkspaceSummary[]): (w: WorkspaceSummary) => string {
  const repeats = (label: (w: WorkspaceSummary) => string | null) => {
    const count = new Map<string, number>();
    for (const w of spaces) { const l = label(w); if (l !== null) count.set(l, (count.get(l) ?? 0) + 1); }
    return (l: string) => (count.get(l) ?? 0) > 1;
  };
  const sameName = repeats((w) => w.name);
  const atMinute = (w: WorkspaceSummary) => (w.name !== null && w.call ? `${w.name}, ${hm(w.call.at)}` : null);
  const sameMinute = repeats(atMinute);
  return (w) => {
    if (w.name === null) return 'Shared with you';
    const minute = atMinute(w);
    if (!w.call || minute === null || !sameName(w.name)) return w.name;
    return sameMinute(minute) ? `${w.name}, ${hms(w.call.at)}` : minute;
  };
}
/** A workspace as a row of the menu under the name at the top of the list, as `named` calls it. */
export const spaceChoice = (w: WorkspaceSummary, named: (w: WorkspaceSummary) => string = (x) => x.name ?? 'Shared with you'): WsSpaceChoice =>
  ({ id: w.id, name: named(w), sub: peopleWords(w.people), icon: w.people === 1 ? 'lock' : 'folders' });
/** The same, saying which is the call's home: where its notes and transcript go, whichever everyone views. */
export const homeChoice = (c: WsSpaceChoice, home: string | null): WsSpaceChoice => (c.id === home ? { ...c, sub: `This call’s home · ${c.sub}` } : c);

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

/** The name at the top of the list, in the app: your workspaces, who's in this one, and making a new one. */
function useHead(onNaming: (n: 'new' | 'rename') => void) {
  const ws = useWs();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState(false);
  const spaces = useQuery({ ...workspaceQueries.workspaces(), enabled: ws.owner !== null && ws.mode === 'page' });
  const close = () => { setOpen(false); setPeople(false); };
  const about: WsMenuRow[] = [];
  if (ws.sent.role !== null) about.push({ id: 'people', icon: 'people', label: 'People', sub: ws.sent.teamAccess === 'team' ? 'Whole team' : peopleWords(ws.sent.people), onSelect: () => setPeople(true) });
  if (ws.sent.role === 'admin') about.push({ id: 'rename', icon: 'pen', label: 'Rename', onSelect: () => { close(); onNaming('rename'); } });
  const named = namesIn(spaces.data ?? []);
  const list = (spaces.data ?? []).map((w) => spaceChoice(w, named));
  const choices = list.some((s) => s.id === ws.workspaceId) ? list : [{ id: ws.workspaceId, name: ws.spaceName, sub: peopleWords(ws.sent.people) }, ...list];
  return {
    open, onOpenChange: (to: boolean) => { if (to) { setOpen(true); void spaces.refetch(); } else close(); },
    content: people ? <PeopleSheet /> : (
      <WsSpacePicker spaces={choices} current={ws.workspaceId} heading="Workspaces" about={about}
        onPick={(id) => { close(); if (id !== ws.workspaceId) ws.switchTo(id); }} onNew={() => { close(); onNaming('new'); }} />
    )
  } satisfies WsPop;
}

/** A row's look, where the list draws it as something other than its name: a call's folder, full screen. */
export interface RowAs { label?: string | undefined; place?: boolean | undefined }

/**
 * Everything the rows of a workspace need, wherever they're listed (the call's list here, a full screen's side panel in
 * Side.tsx): the menu under the workspace's name and naming it, each row's menu and +, renaming in place, the keys, a drag's
 * line, Trash, and choosing files to upload.
 */
export function useListParts(drags: ListDrag) {
  const ws = useWs();
  const navigate = useNavigate();
  const now = useNow(60_000);
  /* Full screen, what someone else just made says New until it's opened, here or anywhere else in this browser (seen.ts). */
  const seen = useSeen(ws.mode === 'page' ? ws.owner : null);
  const { tree, sent, actions, canChange } = ws;
  const [menu, setMenu] = useState<RowMenu | null>(null);
  /** Plus: at the top of the list (null), or on a folder. */
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const { naming, setNaming } = ws;
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameTurn = useRef(0);
  /** The row whose faces were pressed. */
  const [card, setCard] = useState<string | null>(null);
  const create = useCreateWorkspace();
  const renameSpace = useRenameWorkspace();
  const picker = useHead(setNaming);
  const { drag, arm, ended } = drags;
  /* Someone it's open to through a call sees it as its people do; anyone else outside it has only what's shared with them. */
  const inside = sent.role !== null || sent.inCall;
  const refused = (e: unknown) => { ws.say(wsToast.failed(errorMessage(e))); };
  const call = ws.call;
  const { callFolder, madeIn } = ws;
  /* What's in the call's own folder is in This call, and only there. */
  const inFolder = (id: string) => callFolder !== null && isWithin(tree, id, callFolder);
  /* What's brought to the call and still here, but for what's in This call already. Someone outside the workspace has it among what's shared with them. */
  const inCall = (call?.documents ?? []).flatMap((id) => { const item = tree.all.get(id); return inside && item && item.kind === 'document' && item.trashedAt === null && !inFolder(id) ? [item] : []; });
  const justBrought = useJustBrought(inCall.map((i) => i.id));

  const canEdit = (item: WorkspaceItem) => item.role === 'edit';
  const twist = (item: WorkspaceItem) => ws.setOpen(item.id, !ws.open.has(item.id));
  /** Full screen, a call's folder is the call: it opens the call's own page, once it has notes, and otherwise opens what's in it. */
  const openCall = (item: WorkspaceItem) => {
    const noteId = item.call?.noteId;
    if (noteId) void navigate({ to: '/calls/$noteId', params: { noteId } });
    else if (tree.kids.get(item.id)?.length) twist(item);
  };
  const openRow = (item: WorkspaceItem, area: WorkspaceArea) => {
    if (ended()) return;
    if (ws.mode === 'page' && item.call) { openCall(item); return; }
    if (item.kind === 'folder') { twist(item); return; }
    ws.go({ kind: 'document', id: item.id, area });
  };
  /**
   * The row that's open is the one it was opened from: a document brought to the call is in Documents too. What's in the call's
   * own folder has one row, in This call.
   */
  const currentIn = (area: WorkspaceArea, id: string) => ws.at.kind === 'document' && ws.at.id === id && (inFolder(id) || (ws.at.area ?? (inCall.some((i) => i.id === id) ? 'pins' : 'tree')) === area);
  /* Upload files: chosen here, they go into a new document in the folder the menu was for. */
  const field = useRef<HTMLInputElement>(null);
  const uploadTo = useRef<string | null>(null);
  const newIn = (parent: string | null) => (
    <WsNewMenu onDocument={() => { setAdding(undefined); actions.newDocument(parent); }} onFolder={() => { setAdding(undefined); if (parent) ws.setOpen(parent, true); ws.setDraft({ parent }); }}
      onBoard={tree.boards ? () => { setAdding(undefined); void actions.newBoard(parent); } : undefined}
      onUpload={() => { setAdding(undefined); uploadTo.current = parent; if (field.current) { field.current.value = ''; field.current.click(); } }} />
  );
  /** + at the top: what can be made outside any folder, or in a call in its own folder (`Ws.madeIn`). */
  const createTop: WsPop | undefined = canChange ? { open: adding === null, onOpenChange: (to) => setAdding(to ? null : undefined), content: adding === null ? newIn(madeIn) : null } : undefined;
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
        <WsMovePicker name={nameOf(item)} space={ws.spaceName} folders={foldersFor(tree, item.id, callFolder)}
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
      /* The rows as the list has them: in a call's home, what's in the call's own folder comes first, as This call. */
      const order = callFolder === null ? rowsOf(tree, ws.open) : [...rowsOf(tree, ws.open, undefined, { top: callFolder }), ...rowsOf(tree, ws.open, undefined, { skip: callFolder })];
      const listed = order.flatMap((r) => (r.draft ? [] : [r.item.id]));
      const at = listed.indexOf(item.id);
      const near = listed[at + 1] ?? listed[at - 1];
      actions.trash(item.id);
      if (near) focusRow(near);
    }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && changing) {
      e.preventDefault();
      e.stopPropagation();
      const to = nudged(tree, item.id, e.key === 'ArrowUp' ? -1 : 1, callFolder);
      if (to) { actions.move(item.id, to); focusRow(item.id); }
    }
  };
  const namingField: WsNaming | null = naming === null ? null : naming === 'new' ? {
    name: '', placeholder: 'Name this workspace', onCancel: () => setNaming(null),
    onCommit: (name) => {
      setNaming(null);
      const to = name.trim();
      // One made in a call is only for the people added, so a call's notes never reach a whole team unasked.
      if (to) create.mutateAsync({ name: to, access: call ? 'added' : undefined }).then(({ id }) => { ws.switchTo(id); }, refused);
    }
  } : {
    name: nameDraft ?? ws.spaceName, placeholder: 'Name this workspace', onCancel: () => { setNaming(null); setNameDraft(null); },
    onCommit: (name) => {
      setNaming(null);
      const to = name.trim();
      if (to && to !== ws.spaceName) {
        const turn = ++nameTurn.current;
        setNameDraft(null);
        renameSpace.mutateAsync({ id: ws.workspaceId, name: to }).catch((e: unknown) => {
          if (nameTurn.current !== turn) return;
          setNameDraft(to);
          ws.say({ ...wsToast.failed(`Couldn’t confirm the workspace name. ${errorMessage(e)}`), action: { label: 'Edit name', onClick: () => setNaming('rename') }, ms: 12000 });
        });
      }
    }
  };

  /** A row of the list. Full screen, a call's folder is drawn as the call (`as`): its label, and the ↗ of what opens elsewhere. */
  const rowOf = (item: WorkspaceItem, area: WorkspaceArea, depth: number, open: boolean, as: RowAs = {}): ReactElement => {
    const folder = item.kind === 'folder';
    const key = `${area}:${item.id}`;
    if (ws.renaming === item.id && area === 'tree') {
      return (
        <WsRenameRow key={key} name={item.name} kind={item.kind} depth={depth} placeholder={`Name this ${item.kind}`}
          onCancel={() => { ws.setRenaming(null); focusRow(item.id); }} onCommit={(name) => { ws.setRenaming(null); actions.rename(item.id, name); focusRow(item.id); }} />
      );
    }
    const faces = folder ? [] : facesIn(ws.here, item.id);
    const first = faces[0];
    const asCall = ws.mode === 'page' && item.call !== null;
    const kids = (tree.kids.get(item.id)?.length ?? 0) > 0;
    /* What's on the page is being opened now, before it's kept as seen. */
    const onPage = ws.at.kind === 'document' && ws.at.id === item.id;
    return (
      <WsRow key={key} id={item.id} name={as.label ?? nameOf(item)} kind={as.place ? 'place' : asCall ? 'call' : item.kind} icon={asCall ? CALL_ICON : undefined} depth={depth} open={open} area={area} faces={faces}
        out={asCall && item.call?.noteId !== null} tag={ws.mode === 'page' && !onPage && saysNew(item, seen, now) ? 'New' : undefined}
        facesCard={first && { open: card === key, onOpenChange: (to) => setCard(to ? key : null), content: card === key ? <PersonCard person={first} onDone={() => setCard(null)} /> : null }}
        current={currentIn(area, item.id)} flash={ws.glowing.has(item.id) || (area === 'pins' && justBrought.has(item.id))}
        into={(drag?.spot?.kind === 'place' && drag.spot.into === item.id) || (area === 'tree' && ws.blockInto === item.id)} ghosted={drag?.id === item.id}
        onOpen={() => openRow(item, area)} onTwist={folder && (!asCall || kids) ? () => twist(item) : undefined}
        menu={menuFor(item, area)} add={folder ? addFor(item) : undefined}
        onRename={canEdit(item) ? () => ws.setRenaming(item.id) : undefined}
        onContextMenu={(e) => { if (folder && !(canChange && canEdit(item))) return; e.preventDefault(); setMenu({ id: item.id, area, at: { x: e.clientX, y: e.clientY }, moving: false }); }}
        onPointerDown={(e) => arm(e, item.id)} />
    );
  };
  /** A folder being named, in place, where it'll go. */
  const draftRow = (depth: number): ReactElement => (
    <WsRenameRow key="draft" name="" kind="folder" depth={depth} onCancel={() => ws.setDraft(null)}
      onCommit={(name) => { const parent = ws.draft?.parent ?? null; ws.setDraft(null); if (name.trim()) actions.newFolder(parent, name.trim()); }} />
  );
  const trash = trashIn(ws.items, ws.tree.boards);
  const trashRow = inside ? <WsTrashRow count={trash.length} current={ws.at.kind === 'trash'} into={drag?.spot?.kind === 'trash'} onOpen={() => ws.go({ kind: 'trash' })} /> : null;
  const dropLine = drag?.spot?.kind === 'place' && drag.spot.line ? <WsDropLine key="line" top={drag.spot.line.top} left={drag.spot.line.left} /> : null;
  const files = (
    <input ref={field} type="file" multiple hidden aria-label="Choose files to upload"
      onChange={(e) => { const chosen = [...(e.currentTarget.files ?? [])]; if (chosen.length) actions.uploadFiles(uploadTo.current, chosen); }} />
  );
  return { inside, picker, namingField, createTop, rowOf, draftRow, rowKeys, trashRow, dropLine, files, inCall, drag };
}

/** What a call kept in a workspace looks like in its list, full screen: the app's mark for calls. */
export const CALL_ICON = 'calls' satisfies IconName;

/**
 * The list down the side of a workspace in a call: This call (the call's own pages, what's in its own folder in its home, and
 * what's brought to it), then the documents. Someone outside the workspace, given something in it, sees what's shared with them.
 */
export function List({ drags }: { drags: ListDrag }) {
  const ws = useWs();
  const parts = useListParts(drags);
  const { tree, canChange, callFolder } = ws;
  const { inside, inCall, drag } = parts;
  const call = ws.call;
  /** The rows of the tree, from `top`: the folder a draft is named in shows it last, at its depth. */
  const drawn = (list: readonly ListRow[]) => list.flatMap((row): ReactElement[] => {
    if (row.draft) return [parts.draftRow(row.depth)];
    /* A folder of a call that's over holds its note's pages first, then whatever people put in it. */
    const pages = row.open && row.item.call ? [<CallPages key={`pages:${row.item.id}`} call={row.item.call} depth={row.depth + 1} />] : [];
    return [parts.rowOf(row.item, 'tree', row.depth, row.open), ...pages];
  });
  /* This call's own folder shows as This call, at its top level, and isn't among the rest. */
  const callRows = callFolder === null ? [] : rowsOf(tree, ws.open, ws.draft?.parent, { top: callFolder });
  const rows = rowsOf(tree, ws.open, ws.draft?.parent, { skip: callFolder });
  const intoCall = drag?.spot?.kind === 'bring' || (callFolder !== null && drag?.spot?.kind === 'place' && drag.spot.into === callFolder);
  /* In a call's home, what's made in the call is in This call: Documents shows once there's something else to list. */
  const documents = rows.length > 0 || callFolder === null;

  return (
    <>
    <WsList listKey={ws.workspaceId} onKeyDown={parts.rowKeys} aligned={callFolder !== null} empty={rows.length > 0 || !documents ? false : !inside ? 'shared' : canChange ? 'yours' : 'others'} foot={<>{parts.trashRow}{call?.foot}</>}
      head={<WsListTools onFind={ws.openFind} findKey={shortcut('K')} create={parts.createTop} createLabel={tree.boards ? 'New document, folder or board' : undefined} reconnecting={ws.listDown} />}>
      {(call?.top || callRows.length > 0 || inCall.length > 0) && <WsSection key="call" label="This call" area="pins" into={intoCall} />}
      {call?.top}
      {drawn(callRows)}
      {inCall.map((item) => parts.rowOf(item, 'pins', 0, false))}
      {/* Someone outside the workspace has only what's shared with them. */}
      {documents && <WsSection key="section" label={inside ? 'Documents' : 'Shared with you'} />}
      {drawn(rows)}
      {parts.dropLine}
    </WsList>
    {parts.files}
    </>
  );
}
