/*
 * The workspace: the list and the page beside it, driven by the workspace's live stream. It's a page of the app outside a
 * call and a panel inside one, the same in both: it takes where it is and says where to go, and whatever holds it keeps the
 * address. See WorkspaceProps in context.ts.
 */
import { type WorkspaceLive, type WorkspaceTree } from '@alcove/api';
import { Button, WsCantOpen, WsDoc, WsDocHead, WsDragGhost, WsEmpty, WsOfflineEmpty, WsPane, WsPickDocument, WsToasts, type WsToastData } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '~/lib/api';
import { overlayOpen, typing, withMod } from '~/lib/keys';
import { useLive, useMedia } from '~/lib/live';
import { q } from '~/lib/queries';
import { useTreeActions } from './actions';
import { useLaidOver } from './changes';
import { WsContext, type FolderDraft, type Ws, type WorkspaceProps } from './context';
import { DocumentPane } from './DocumentPane';
import { useRowDrag } from './drag';
import { preloadEditor } from './editor/lazy';
import { Find, useFindKeys } from './Find';
import { Keys } from './Keys';
import { List } from './List';
import { openedIn, placesOf, rememberPlaces } from './places';
import { TrashPage } from './TrashPage';
import { arrivals, documentsIn, foldersAbove, treeOf, type Tree } from './tree';
import { useWordsFollow } from './words';

const GLOW_MS = 1400;

type Shown = Omit<WsToastData, 'ms'> & { id: number };

/** One toast at a time, for as long as it says. Pressing its action takes it away. */
function useToasts() {
  const [toasts, setToasts] = useState<Shown[]>([]);
  const n = useRef(0);
  const say = useCallback(({ ms, ...toast }: WsToastData) => {
    const id = ++n.current;
    const drop = () => setToasts((was) => was.filter((t) => t.id !== id));
    const action = toast.action;
    setToasts([{ ...toast, id, action: action && { ...action, onClick: () => { drop(); action.onClick(); } } }]);
    setTimeout(drop, ms);
  }, []);
  return { toasts, say };
}

/** What just arrived in the list or moved in it, for everyone, glows. */
function useGlow(sent: WorkspaceTree | null): ReadonlySet<string> {
  const [glowing, setGlowing] = useState<ReadonlySet<string>>(new Set());
  const before = useRef<Tree | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => { const t = timers.current; return () => { t.forEach(clearTimeout); }; }, []);
  useEffect(() => {
    if (!sent) return;
    const now = treeOf(sent.items);
    const was = before.current;
    before.current = now;
    if (!was) return;
    const lit = arrivals(was, now);
    if (lit.length === 0) return;
    setGlowing((on) => new Set([...on, ...lit]));
    const t = setTimeout(() => {
      timers.current.delete(t);
      setGlowing((on) => new Set([...on].filter((id) => !lit.includes(id))));
    }, GLOW_MS);
    timers.current.add(t);
  }, [sent]);
  return glowing;
}

/** Which folders are open, remembered in this browser. */
function useFolders(owner: string | null, workspaceId: string) {
  const [open, setOpenSet] = useState<ReadonlySet<string>>(() => new Set(placesOf(owner).folders[workspaceId] ?? []));
  const latest = useRef(open);
  const write = useCallback((next: ReadonlySet<string>) => {
    latest.current = next;
    setOpenSet(next);
    rememberPlaces(owner, (p) => ({ ...p, folders: { ...p.folders, [workspaceId]: [...next] } }));
  }, [owner, workspaceId]);
  const setOpen = useCallback((id: string, to: boolean) => {
    if (latest.current.has(id) === to) return;
    const next = new Set(latest.current);
    if (to) next.add(id); else next.delete(id);
    write(next);
  }, [write]);
  const openAll = useCallback((ids: string[]) => {
    if (ids.every((id) => latest.current.has(id))) return;
    write(new Set([...latest.current, ...ids]));
  }, [write]);
  return { open, setOpen, openAll };
}

/** The workspace once its stream is open. */
function Pane({ store, mode, workspaceId, at, onGo, onSwitch, onLeave, pass, call }: WorkspaceProps & { store: WorkspaceLive }) {
  const view = useLive(store);
  const session = useQuery(q.session()).data ?? null;
  const owner = session?.ownerId ?? null;
  const me = session?.user ?? null;
  const { items, change } = useLaidOver(view.tree);
  const tree = useMemo(() => treeOf(items), [items]);
  const { toasts, say: sayHere } = useToasts();
  const say = call?.say ?? sayHere;
  const glowing = useGlow(view.tree);
  const { open, setOpen, openAll } = useFolders(owner, workspaceId);
  const [draft, setDraft] = useState<FolderDraft | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [blockInto, setBlockInto] = useState<string | null>(null);
  const [ownListOff, setListOff] = useState(() => placesOf(owner).listOff);
  /* In a call the list is one of the things that give way, so the call says whether it shows. */
  const listOff = call?.list.off ?? ownListOff;
  const phone = useMedia('(max-width: 640px)');
  const [phoneList, setPhoneList] = useState(at.kind === 'home');
  const justMade = useRef<string | null>(null);
  const openDoc = useRef<Ws['openDoc']['current']>(null);
  const spaceName = view.tree?.name ?? 'Shared with you';
  /* Going anywhere puts a phone's list away, even to what's already open behind it. */
  const go = useCallback<WorkspaceProps['onGo']>((to, how) => { setPhoneList(to.kind === 'home'); onGo(to, how); }, [onGo]);
  const actions = useTreeActions({ workspaceId, pass, owner, tree, at, me, spaceName, change, go, say, openFolders: openAll, justMade, openDoc });
  const role = view.tree?.role ?? null;
  const canChange = role === 'admin' || role === 'edit';
  const documentId = at.kind === 'document' ? at.id : null;
  const item = documentId === null ? undefined : tree.all.get(documentId);

  const toggleInCall = call?.list.onToggle;
  const toggleList = useCallback(() => {
    if (matchMedia('(max-width: 640px)').matches) setPhoneList((on) => !on);
    else if (toggleInCall) toggleInCall();
    else setListOff((off) => !off);
  }, [toggleInCall]);
  useEffect(() => { rememberPlaces(owner, (p) => ({ ...p, listOff: ownListOff })); }, [owner, ownListOff]);

  /*
   * A phone shows the list until something's open. A screen with room opens what you had open last, once, on arriving:
   * what someone else makes in the meantime doesn't take you anywhere.
   */
  const empty = view.tree !== null && tree.kids.size === 0;
  useEffect(() => { setPhoneList(at.kind === 'home' && !empty); }, [at.kind, documentId, empty]);
  const arrived = useRef(false);
  useEffect(() => {
    if (at.kind !== 'home') { arrived.current = false; return; }
    if (!view.tree || arrived.current || phone) return;
    arrived.current = true;
    const was = placesOf(owner).documents[workspaceId];
    const docs = documentsIn(tree);
    const next = docs.find((d) => d.id === was) ?? docs[0];
    if (next) onGo({ kind: 'document', id: next.id }, { replace: true });
  }, [view.tree, at.kind, phone, owner, workspaceId, tree, onGo]);

  /* What's open stays remembered, and its folders open around it. */
  useEffect(() => {
    rememberPlaces(owner, (p) => (documentId ? openedIn({ ...p, workspace: workspaceId }, workspaceId, documentId) : { ...p, workspace: workspaceId }));
  }, [owner, workspaceId, documentId]);
  const inFolders = item ? foldersAbove(tree, item.id).map((f) => f.id).join() : '';
  useEffect(() => { if (inFolders) openAll(inFolders.split(',')); }, [inFolders, openAll]);

  /* A folder is named in the list, so the list has to be showing. */
  const newFolder = useCallback(() => {
    setDraft({ parent: null });
    setPhoneList(true);
    if (!toggleInCall) setListOff(false);
    else if (listOff) toggleInCall();
  }, [toggleInCall, listOff]);

  /* N and ⇧N make something outside any folder, and sleep while you're typing. ⌘\ shows or hides the list. */
  const asleep = call?.closed ?? false;
  useEffect(() => {
    if (asleep) return;
    const keys = (e: KeyboardEvent) => {
      if (withMod(e) && e.key === '\\') { e.preventDefault(); toggleList(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || overlayOpen() || !canChange || e.key.toLowerCase() !== 'n') return;
      e.preventDefault();
      if (e.shiftKey) newFolder();
      else actions.newDocument(null);
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, [actions, canChange, newFolder, toggleList, asleep]);

  const find = useFindKeys(asleep, call?.finding ?? 0);
  useWordsFollow(workspaceId, pass, view);

  const { drag, arm, ended } = useRowDrag({
    tree, canDrag: (id) => canChange && tree.all.get(id)?.role === 'edit',
    onOpenFolder: (id) => setOpen(id, true),
    canBring: call !== undefined,
    onDrop: (id, spot) => { if (spot.kind === 'trash') actions.trash(id); else if (spot.kind === 'bring') call?.onBring(id, true); else actions.move(id, spot.to); }
  });

  const page = mode === 'page';
  if (view.status === 'closed') {
    return <WsPane page={page}><WsDoc><WsCantOpen what={at.kind === 'document' ? 'document' : 'workspace'} action={<Button size="sm" onClick={onLeave}>{page ? 'Back to your workspaces' : 'Back to the call'}</Button>} /></WsDoc></WsPane>;
  }
  if (!view.tree) return <WsPane page={page}>{view.status === 'reconnecting' && <WsDoc><WsOfflineEmpty /></WsDoc>}</WsPane>;

  const ws: Ws = {
    mode, workspaceId, pass, call, sent: view.tree, here: view.here, items, tree, at, go, switchTo: onSwitch, owner, me, actions, say, canChange, spaceName,
    open, setOpen, glowing, blockInto, setBlockInto, draft, setDraft, renaming, setRenaming, listOff, toggleList, justMade, openDoc, openFind: () => find.setFinding(true)
  };
  return (
    <WsContext value={ws}>
      <WsPane page={page} listOff={listOff} listPeek={call?.list.peek} phoneList={phoneList} zen={call?.zen?.on}>
        <List drags={{ drag, arm, ended }} />
        {at.kind === 'trash' ? <TrashPage /> : item && item.kind !== 'folder' ? <DocumentPane key={item.id} item={item} /> : at.kind === 'document' ? (
          <WsDoc>
            <WsDocHead crumbs={view.tree.name === null ? [] : [spaceName]} save="quiet" onToggleList={toggleList} zen={call?.zen?.on} onZen={call?.zen?.onToggle} />
            <WsCantOpen what="document" action={<Button size="sm" onClick={() => go({ kind: 'home' }, { replace: true })}>Back to {spaceName}</Button>} />
          </WsDoc>
        ) : (
          <WsDoc className="is-bare">
            <WsDocHead crumbs={[spaceName]} save="quiet" onToggleList={toggleList} zen={call?.zen?.on} onZen={call?.zen?.onToggle} />
            {empty
              ? <WsEmpty space={spaceName} page={page} onDocument={canChange ? () => actions.newDocument(null) : undefined} onFolder={canChange ? newFolder : undefined} />
              : <WsPickDocument onDocument={canChange ? () => actions.newDocument(null) : undefined} />}
          </WsDoc>
        )}
      </WsPane>
      {!call && <WsToasts toasts={toasts} />}
      <Find open={find.finding} onOpenChange={find.setFinding} onKeys={() => find.setListing(true)} />
      <Keys open={find.listing} onOpenChange={find.setListing} />
      {drag && <WsDragGhost x={drag.x + 12} y={drag.y + 10} icon={drag.icon} label={drag.label} />}
    </WsContext>
  );
}

/** One live stream for as long as this workspace is on screen. */
function Live(props: WorkspaceProps) {
  const { workspaceId, pass } = props;
  const [store, setStore] = useState<WorkspaceLive | null>(null);
  useEffect(() => {
    const live = api.workspaces.live(workspaceId, pass ? { pass } : undefined);
    setStore(live);
    return () => { live.close(); };
  }, [workspaceId, pass]);
  useEffect(preloadEditor, []);
  return store ? <Pane {...props} store={store} /> : <WsPane page={props.mode === 'page'} />;
}

/**
 * Nothing here decides a theme. In a call the `.stage` around it makes the whole document night, menus and sheets included,
 * and as a page it follows the app's theme.
 */
export function Workspace(props: WorkspaceProps) {
  return <Live key={props.workspaceId} {...props} />;
}

