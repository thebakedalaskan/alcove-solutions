/*
 * The workspace: the list and the page beside it, driven by the workspace's live stream. It's a page of the app outside a
 * call and a panel inside one, the same in both: it takes where it is and says where to go, and whatever holds it keeps the
 * address. See WorkspaceProps in context.ts.
 */
import { firstName, type WorkspaceLive, type WorkspaceMention, type WorkspaceTree, type WorkspaceWhere } from '@alcove/api';
import { Button, DURATION, EASE, WsCantOpen, WsDoc, WsDocHead, WsDragGhost, WsEmpty, WsOfflineEmpty, WsPane, WsPickDocument, WsToasts, wsToast, type WsToastData } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '~/lib/api';
import { overlayOpen, typing, withMod } from '~/lib/keys';
import { useLive, useMedia } from '~/lib/live';
import { q, qk } from '~/lib/queries';
import { useTreeActions } from './actions';
import { useLaidOver } from './changes';
import { WsContext, type FolderDraft, type OpenPage, type Ws, type WorkspacePlace, type WorkspaceProps } from './context';
import { DocumentPane } from './DocumentPane';
import { KeptHere } from './Rescue';
import { useRowDrag } from './drag';
import { preloadEditor } from './editor/lazy';
import { useFollow } from './follow';
import { List } from './List';
import { placesOf, rememberPlaces } from './places';
import { othersIn } from './presence';
import { Presentation, presentingStrip } from './Presentation';
import { TrashPage } from './TrashPage';
import { arrivals, documentsIn, foldersAbove, nameOf, treeOf, type Tree } from './tree';

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

/** How long a tag's toast stays, and so how long the next one waits. */
const TAG_MS = 9000;

/**
 * Being tagged: a toast says who and where, and nothing moves until you say so. One at a time, the oldest first, and only
 * while someone can see it: what's said in a tab nobody's looking at waits for them.
 */
function useTagToasts(store: WorkspaceLive, waiting: readonly WorkspaceMention[], tree: Tree, at: WorkspacePlace, say: (toast: WsToastData) => void, go: (to: WorkspacePlace) => void) {
  const qc = useQueryClient();
  const [turn, setTurn] = useState(0);
  const busy = useRef(false);
  const wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const look = () => setTurn((n) => n + 1);
    document.addEventListener('visibilitychange', look);
    return () => document.removeEventListener('visibilitychange', look);
  }, []);
  useEffect(() => {
    if (busy.current || document.visibilityState !== 'visible') return;
    /* A document just shared with you can arrive a moment after the tag: until the list has it, it can't be named. */
    const next = waiting.find((m) => tree.all.has(m.document));
    const item = next && tree.all.get(next.document);
    if (!next || !item) return;
    void store.seen(next.id).then(() => qc.invalidateQueries({ queryKey: qk.mentions }));
    /* Already on that line, from a notification say: there's nothing to tell. */
    if (at.kind === 'document' && at.id === next.document && at.block === next.block) { setTurn((n) => n + 1); return; }
    busy.current = true;
    say(wsToast.tagged(next.by, firstName(next.by.name), nameOf(item), () => go({ kind: 'document', id: next.document, block: next.block ?? undefined })));
    wait.current = setTimeout(() => { busy.current = false; setTurn((n) => n + 1); }, TAG_MS);
  }, [store, waiting, tree, at, qc, say, go, turn]);
  useEffect(() => () => clearTimeout(wait.current), []);
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
  const page = useRef<OpenPage | null>(null);
  /* What the list last called each document, for a copy of someone's words in one that's gone. */
  const known = useRef(new Map<string, string>());
  useEffect(() => { for (const it of items) if (it.kind !== 'folder') known.current.set(it.id, nameOf(it)); }, [items]);
  const spaceName = view.tree?.name ?? 'Shared with you';
  const others = useMemo(() => othersIn(view.here), [view.here]);
  const goWith = useCallback((to: WorkspacePlace) => { setPhoneList(false); onGo(to, { replace: true }); }, [onGo]);
  const { following, follow, stopFollowing } = useFollow({ others, tree, at, goWith, say });
  /* Going anywhere puts a phone's list away, even to what's already open behind it, and going yourself stops following. */
  const go = useCallback<WorkspaceProps['onGo']>((to, how) => { stopFollowing(); setPhoneList(to.kind === 'home'); onGo(to, how); }, [onGo, stopFollowing]);
  useTagToasts(store, view.mentions, tree, at, say, go);
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

  /* The tiles show who's here, who's writing and who you're following. The call asks to follow from a tile. */
  const closed = call?.closed ?? false;
  const followable = closed ? '' : others.flatMap((o) => (o.callIdentity !== null && (o.document !== null || o.elsewhere) ? [o.callIdentity] : [])).join(' ');
  const writing = others.flatMap((o) => (o.typing && o.callIdentity !== null ? [o.callIdentity] : [])).join(' ');
  const followingIn = following ? others.find((o) => o.person.id === following.person.id)?.callIdentity ?? null : null;
  const placed = closed ? [] : others.flatMap((o): [string, string][] => {
    if (o.callIdentity === null) return [];
    const doc = o.document === null ? undefined : tree.all.get(o.document);
    return doc ? [[o.callIdentity, nameOf(doc)]] : o.elsewhere ? [[o.callIdentity, 'A document you can’t open']] : [];
  });
  const placedNow = useRef(placed);
  placedNow.current = placed;
  const where = JSON.stringify(placed);
  const tellTiles = call?.onTogether;
  useEffect(() => {
    tellTiles?.({ followable: followable ? followable.split(' ') : [], following: followingIn, writing: writing ? writing.split(' ') : [], where: Object.fromEntries(placedNow.current) });
  }, [tellTiles, followable, followingIn, writing, where]);
  const othersNow = useRef(others);
  othersNow.current = others;
  const togetherRef = call?.together;
  useEffect(() => {
    if (!togetherRef) return;
    togetherRef.current = { follow: (connection) => { const o = othersNow.current.find((x) => x.callIdentity === connection); if (o) follow(o.person.id); }, stop: () => stopFollowing() };
    return () => { togetherRef.current = null; };
  }, [togetherRef, follow, stopFollowing]);
  /* Out of sight, put away or behind what it takes turns with, there's nothing to go with. */
  useEffect(() => { if (closed) stopFollowing('quiet'); }, [closed, stopFollowing]);

  /*
   * Watching a presentation, or giving one, it's drawn over your own page, which waits underneath as you left it. The page
   * counts as out of sight meanwhile (`closed`): you're following nobody, and nothing under it can be reached.
   */
  const watching = call?.presenting.watching ?? false;
  const reduce = useReducedMotion();

  /* Everyone can see you're in a document from the moment it's open, and that you've left once it's out of sight. The editor says which line. */
  useEffect(() => { store.present({ document: closed ? null : documentId, block: null, typing: false }); }, [store, documentId, closed]);
  const closedNow = useRef(closed);
  closedNow.current = closed;
  const present = useCallback((where: WorkspaceWhere) => { if (!closedNow.current) store.present(where); }, [store]);

  /* A document just made is only opening while it's the one open. */
  useEffect(() => { if (justMade.current !== null && justMade.current !== documentId) justMade.current = null; }, [documentId]);

  /* What's open stays remembered, and its folders open around it. */
  useEffect(() => {
    rememberPlaces(owner, (p) => ({ ...p, workspace: workspaceId, documents: documentId ? { ...p.documents, [workspaceId]: documentId } : p.documents }));
  }, [owner, workspaceId, documentId]);
  const inFolders = item ? foldersAbove(tree, item.id).map((f) => f.id).join() : '';
  useEffect(() => { if (inFolders) openAll(inFolders.split(',')); }, [inFolders, openAll]);

  /* A folder is named in the list, so the list has to be showing: in a call, wherever the call shows it, and never hidden. */
  const showInCall = call?.list.onShow;
  const newFolder = useCallback(() => {
    setDraft({ parent: null });
    setPhoneList(true);
    if (showInCall) showInCall();
    else setListOff(false);
  }, [showInCall]);

  /*
   * N and ⇧N make something outside any folder, and sleep while you're typing, and while a new document is opening: what's
   * typed then was meant for its title. ⌘\ shows or hides the list.
   */
  const asleep = call?.closed ?? false;
  useEffect(() => {
    if (asleep) return;
    const keys = (e: KeyboardEvent) => {
      if (withMod(e) && e.key === '\\') { e.preventDefault(); toggleList(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || overlayOpen() || !canChange || justMade.current !== null || e.key.toLowerCase() !== 'n') return;
      e.preventDefault();
      if (e.shiftKey) newFolder();
      else actions.newDocument(null);
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, [actions, canChange, newFolder, toggleList, asleep]);

  const { drag, arm, ended } = useRowDrag({
    tree, canDrag: (id) => canChange && tree.all.get(id)?.role === 'edit',
    onOpenFolder: (id) => setOpen(id, true),
    canBring: call !== undefined,
    onDrop: (id, spot) => { if (spot.kind === 'trash') actions.trash(id); else if (spot.kind === 'bring') call?.onBring(id, true); else actions.move(id, spot.to); }
  });

  const isPage = mode === 'page';
  if (view.status === 'closed') {
    const back = <Button size="sm" onClick={onLeave}>{isPage ? 'Back to your workspaces' : 'Back to the call'}</Button>;
    return (
      <>
        <WsPane page={isPage}>
          <WsDoc>{documentId === null ? <WsCantOpen what="workspace" action={back} /> : <KeptHere workspaceId={workspaceId} documentId={documentId} owner={owner} pass={pass} say={say} back={back} />}</WsDoc>
        </WsPane>
        {!call && <WsToasts toasts={toasts} />}
      </>
    );
  }
  if (!view.tree) return <WsPane page={isPage}>{view.status === 'reconnecting' && <WsDoc><WsOfflineEmpty /></WsDoc>}</WsPane>;

  const ws: Ws = {
    mode, workspaceId, pass, call, sent: view.tree, here: view.here, others, present, following, follow, stopFollowing, items, tree, at, go, switchTo: onSwitch, owner, me,
    self: view.here.find((h) => h.isMe)?.person ?? me, actions, say, canChange, spaceName,
    open, setOpen, glowing, blockInto, setBlockInto, draft, setDraft, renaming, setRenaming, listOff, toggleList, justMade, openDoc, page
  };
  return (
    <WsContext value={ws}>
      <WsPane page={isPage} listOff={listOff} listPeek={call?.list.peek} phoneList={phoneList} zen={call?.zen?.on} following={following !== null} under={watching}>
        <List drags={{ drag, arm, ended }} />
        {at.kind === 'trash' ? <TrashPage /> : item && item.kind !== 'folder' ? <DocumentPane key={item.id} item={item} /> : at.kind === 'document' ? (
          <WsDoc>
            {presentingStrip(call?.presenting) ?? <WsDocHead crumbs={view.tree.name === null ? [] : [spaceName]} save="quiet" onToggleList={toggleList} zen={call?.zen?.on} onZen={call?.zen?.onToggle} />}
            <KeptHere key={at.id} workspaceId={workspaceId} documentId={at.id} owner={owner} pass={pass} say={say}
              copyTo={canChange && owner !== null ? { workspaceId, name: () => known.current.get(at.id) ?? null, parent: null, go: (id) => go({ kind: 'document', id }) } : undefined}
              back={<Button size="sm" onClick={() => go({ kind: 'home' }, { replace: true })}>Back to {spaceName}</Button>} />
          </WsDoc>
        ) : (
          <WsDoc className="is-bare">
            {presentingStrip(call?.presenting) ?? <WsDocHead crumbs={[spaceName]} save="quiet" onToggleList={toggleList} zen={call?.zen?.on} onZen={call?.zen?.onToggle} />}
            {empty
              ? <WsEmpty space={spaceName} page={isPage} onDocument={canChange ? () => actions.newDocument(null) : undefined} onFolder={canChange ? newFolder : undefined} />
              : <WsPickDocument onDocument={canChange ? () => actions.newDocument(null) : undefined} />}
          </WsDoc>
        )}
      </WsPane>
      {/* It comes and goes over 240 ms, and your own page is back underneath as it goes. */}
      <AnimatePresence>
        {watching && call && (
          <motion.div key="presenting" className="ws-over" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : DURATION[2], ease: EASE.out }}>
            <Presentation ws={ws} presenting={call.presenting} />
          </motion.div>
        )}
      </AnimatePresence>
      {!call && <WsToasts toasts={toasts} />}
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
    /* A page going for good says so, so nobody sees someone here who's gone. One put away to come back to carries on. */
    const leaving = (e: PageTransitionEvent) => { if (!e.persisted) live.close(); };
    addEventListener('pagehide', leaving);
    return () => { removeEventListener('pagehide', leaving); live.close(); };
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

