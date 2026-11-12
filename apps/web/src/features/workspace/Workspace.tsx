/*
 * The workspace: the list and the page beside it, driven by the workspace's live stream. It's a page of the app outside a
 * call and a panel inside one, the same in both: it takes where it is and says where to go, and whatever holds it keeps the
 * address. See WorkspaceProps in context.ts.
 */
import { errorMessage, firstName, type WorkspaceLive, type WorkspaceMention, type WorkspaceTree, type WorkspaceWhere } from '@alcove/api';
import { Button, WsCantOpen, WsDoc, WsDocHead, WsDragGhost, WsEmpty, WsOfflineEmpty, WsPane, WsPickDocument, WsToasts, useToast, wsToast, type WsToastData } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '~/lib/api';
import { overlayOpen, typing, withMod } from '~/lib/keys';
import { useLive, useMedia, useOnline } from '~/lib/live';
import { log } from '~/lib/log';
import { q, qk, useWorkspaceName } from '~/lib/queries';
import { useStorageRefusal } from '~/features/plans/storageFull';
import { announceMentionsRead } from '~/features/shell/attentionChannel';
import { useTreeActions } from './actions';
import { BoardPane } from './BoardPane';
import { useLaidOver } from './changes';
import { WsContext, type FolderDraft, type OpenPage, type Ws, type WorkspacePlace, type WorkspaceProps } from './context';
import { DocumentPane } from './DocumentPane';
import { keptDocuments } from './keep';
import { KeptHere } from './Rescue';
import { useRowDrag } from './drag';
import { preloadEditor } from './editor/lazy';
import { useFollow } from './follow';
import { Find, useFindKeys } from './Find';
import { usePersonIds } from './ids';
import { Keys } from './Keys';
import { List } from './List';
import { LiveHostContext } from './live/host';
import { LivePage } from './live/LivePage';
import { useSending } from './live/useSending';
import { Pictures } from './pictures';
import { openedIn, placesOf, rememberPlaces } from './places';
import { othersIn, pageName } from './presence';
import { TrashPage } from './TrashPage';
import { arrivals, documentsIn, foldersAbove, nameOf, treeOf, type Tree } from './tree';
import { onStored, talkThrough } from './uploads';
import { useWordsFollow } from './words';

const GLOW_MS = 1400;
const wlog = log.child({ component: 'workspace' });

/**
 * A workspace's stream closes for good when you can't open it any more, and also when the session's over (it expired, or
 * Alcove ended it), which says nothing about the workspace. So on the workspace page, someone signed in has the session
 * asked about again before anything's said. Still there: it's the workspace that closed. Over: the app goes to the welcome
 * page to sign in again, as it does whenever it finds the session over, saying that what's kept here is safe, if anything
 * is, since it saves once they sign in again.
 */
function useClosedFor(closed: boolean, owner: string | null, page: boolean): 'asking' | 'workspace' {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [session, setSession] = useState<'unasked' | 'there' | 'over'>('unasked');
  const asks = closed && owner !== null && page;
  useEffect(() => {
    if (!asks || owner === null || session !== 'unasked') return undefined;
    let left = false;
    qc.fetchQuery({ ...q.session(), staleTime: 0 }).then(async (found) => {
      if (found !== null) { if (!left) setSession('there'); return; }
      // Over, whatever this page does meanwhile (its owner is gone as the answer lands): it goes on to the welcome page.
      setSession('over');
      const kept = await keptDocuments(owner).catch(() => []);
      wlog.info('the session ended while a workspace was open', { kept: kept.length });
      void navigate({ to: '/welcome', replace: true });
      if (kept.length > 0) toast('You’re signed out. Your edits are safe in this browser, and they save when you sign in again.', { icon: 'signOut' });
    }, (e: unknown) => {
      wlog.warn('couldn’t ask whether the session is over', { err: e });
      if (!left) setSession('there');
    });
    return () => { left = true; };
  }, [asks, owner, session, qc, navigate, toast]);
  return session === 'over' || (asks && session === 'unasked') ? 'asking' : 'workspace';
}

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
function useGlow(sent: WorkspaceTree | null, mode: WorkspaceProps['mode']): ReadonlySet<string> {
  const [glowing, setGlowing] = useState<ReadonlySet<string>>(new Set());
  const before = useRef<Tree | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => { const t = timers.current; return () => { t.forEach(clearTimeout); }; }, []);
  useEffect(() => {
    if (!sent) return;
    const now = treeOf(sent.items, mode === 'page');
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
  }, [sent, mode]);
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
    void store.seen(next.id).then(() => {
      const owner = qc.getQueryData(q.session().queryKey)?.ownerId;
      if (owner) announceMentionsRead(owner);
      return qc.invalidateQueries({ queryKey: qk.mentions });
    }).catch((e: unknown) => wlog.warn('mention read state not saved', { err: e }));
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
  const online = useOnline();
  useListTriesWhenShown(store, call?.closed ?? false);
  const session = useQuery(q.session()).data ?? null;
  const owner = session?.ownerId ?? null;
  const me = session?.user ?? null;
  const { items, change } = useLaidOver(store);
  const tree = useMemo(() => treeOf(items, mode === 'page'), [items, mode]);
  const { toasts, say: sayHere } = useToasts();
  const say = call?.say ?? sayHere;
  const glowing = useGlow(view.tree, mode);
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
  const known = useRef(new Map<string, { name: string; board: boolean }>());
  useEffect(() => { for (const it of items) if (it.kind !== 'folder') known.current.set(it.id, { name: nameOf(it), board: it.kind === 'board' }); }, [items]);
  /* Its pictures, read for whatever shows them and let go of with it; an upload that outlives the page says how it went here. */
  const pictures = useMemo(() => new Pictures(workspaceId, pass), [workspaceId, pass]);
  useEffect(() => () => pictures.close(), [pictures]);
  /* Storage full is said as the doors say it, with what helps; anything else in the server's own words. */
  const refused = useStorageRefusal(owner !== null, call ? 'call' : 'page');
  useEffect(() => talkThrough(workspaceId, (e, bytes) => {
    const r = refused(e, bytes);
    say(wsToast.failed(r?.text ?? errorMessage(e), r?.action ?? undefined));
  }), [workspaceId, say, refused]);
  const qc = useQueryClient();
  useEffect(() => onStored((id) => { if (id === workspaceId) void qc.invalidateQueries({ queryKey: qk.workspaceMedia(id) }); }), [qc, workspaceId]);
  const { name: spaceName, state: spaceSave } = useWorkspaceName(workspaceId, view.tree?.name ?? 'Shared with you', owner !== null);
  const others = useMemo(() => othersIn(view.here), [view.here]);
  const goWith = useCallback((to: WorkspacePlace) => { setPhoneList(false); onGo(to, { replace: true }); }, [onGo]);
  const pane = useRef<HTMLElement>(null);
  const { following, follow, stopFollowing } = useFollow({ others, presenter: call?.presenter ?? null, tree, at, goWith, say, pane });
  /* Going anywhere puts a phone's list away, even to what's already open behind it, and going yourself stops following. */
  const go = useCallback<WorkspaceProps['onGo']>((to, how) => { stopFollowing(); setPhoneList(to.kind === 'home'); onGo(to, how); }, [onGo, stopFollowing]);
  /*
   * Something outside the workspace needs a document from it, such as someone asking to see it: the one you were last in here,
   * if you can share it, or else the list to pick one from, on a phone too. Only for each ask after this opened.
   */
  const wanted = call?.list.wanted ?? 0;
  const seenWant = useRef(wanted);
  const forWant = useRef({ tree, owner, go });
  forWant.current = { tree, owner, go };
  useEffect(() => {
    if (wanted === seenWant.current) return;
    seenWant.current = wanted;
    const { tree: t, owner: o, go: to } = forWant.current;
    const lastId = placesOf(o).documents[workspaceId];
    const last = lastId === undefined ? undefined : t.all.get(lastId);
    if (last && last.kind === 'document' && last.role === 'edit' && last.trashedAt === null) to({ kind: 'document', id: last.id });
    else setPhoneList(true);
  }, [wanted, workspaceId]);
  useTagToasts(store, view.mentions, tree, at, say, go);
  const actions = useTreeActions({ workspaceId, pass, owner, tree, at, me, spaceName, change, go, say, openFolders: openAll, justMade, openDoc });
  /* Everyone a document here may tag, quote or name for a follow-up, by the ID the workspace knows them by. */
  const member = view.tree?.role != null;
  const team = useQuery({ ...q.team(), enabled: member }).data;
  const named = useMemo(() => [...(call?.people ?? []).map((p) => p.person.email), ...(call?.invited ?? []).map((p) => p.email), ...(team?.members ?? []).map((m) => m.person.email)], [call?.people, call?.invited, team]);
  const ids = usePersonIds(workspaceId, pass, named, member || call !== undefined);
  const { put, lastDocument } = useSending({
    live: call?.live, workspaceId, pass, owner, tree, at, member, here: view.here, closed: call?.closed ?? false, go, say, openDoc, ids
  });
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
   * what someone else makes in the meantime doesn't take you anywhere. Someone in a call who was given what they can open
   * here, and is outside the workspace, lands on it on a phone too: it opens by itself, as they were told it would.
   */
  const empty = view.tree !== null && tree.kids.size === 0;
  useEffect(() => { setPhoneList(at.kind === 'home' && !empty); }, [at.kind, documentId, empty]);

  const arrived = useRef(false);
  const given = call !== undefined && view.tree?.role === null;
  useEffect(() => {
    if (at.kind !== 'home') { arrived.current = false; return; }
    if (!view.tree || arrived.current || (phone && !given)) return;
    arrived.current = true;
    const was = placesOf(owner).documents[workspaceId];
    const docs = documentsIn(tree);
    const next = docs.find((d) => d.id === was) ?? docs[0];
    if (next) onGo({ kind: 'document', id: next.id }, { replace: true });
  }, [view.tree, at.kind, phone, given, owner, workspaceId, tree, onGo]);

  /*
   * The tiles show who's here, who's writing and who you're following. The call asks to follow from a tile. Where each is is
   * said while it's put away too: a presented workspace's tile says where its presenter is.
   */
  const closed = call?.closed ?? false;
  const followable = closed ? '' : others.flatMap((o) => (o.callIdentity !== null && (o.document !== null || o.page !== null || o.elsewhere) ? [o.callIdentity] : [])).join(' ');
  const writing = others.flatMap((o) => (o.typing && o.callIdentity !== null ? [o.callIdentity] : [])).join(' ');
  const followingIn = following ? others.find((o) => o.person.id === following.person.id)?.callIdentity ?? null : null;
  const placed = others.flatMap((o): [string, string][] => {
    if (o.callIdentity === null) return [];
    const doc = o.document === null ? undefined : tree.all.get(o.document);
    return doc ? [[o.callIdentity, nameOf(doc)]] : o.page ? [[o.callIdentity, pageName(o.page)]] : o.elsewhere ? [[o.callIdentity, 'A document you can’t open']] : [];
  });
  const placedNow = useRef(placed);
  placedNow.current = placed;
  const where = JSON.stringify(placed);
  const reachable = closed ? '' : others.flatMap((o) => (o.callIdentity !== null && o.document !== null && tree.all.has(o.document) ? [o.callIdentity] : [])).join(' ');
  const tellTiles = call?.onTogether;
  useEffect(() => {
    tellTiles?.({ followable: followable ? followable.split(' ') : [], following: followingIn, writing: writing ? writing.split(' ') : [], where: Object.fromEntries(placedNow.current), reachable: reachable ? reachable.split(' ') : [] });
  }, [tellTiles, followable, followingIn, writing, where, reachable]);
  const othersNow = useRef(others);
  othersNow.current = others;
  const treeNow = useRef(tree);
  treeNow.current = tree;
  const togetherRef = call?.together;
  useEffect(() => {
    if (!togetherRef) return;
    const someone = (connection: string) => othersNow.current.find((x) => x.callIdentity === connection);
    togetherRef.current = {
      follow: (connection) => { const o = someone(connection); if (o) follow(o.person.id); },
      stop: (how) => stopFollowing(how),
      /* To the line they're on, as Go there on their card does. */
      go: (connection) => {
        const o = someone(connection);
        if (o?.document && treeNow.current.all.has(o.document)) go({ kind: 'document', id: o.document, block: o.block ?? undefined });
      },
      tag: (connection) => { const o = someone(connection); if (o) page.current?.tag(o.person); },
      canTag: () => page.current?.canTag === true
    };
    return () => { togetherRef.current = null; };
  }, [togetherRef, follow, stopFollowing, go]);
  /* Out of sight, put away or behind what it takes turns with, there's nothing to go with. */
  /* Leaving with the call's workspace, it's said: they'd otherwise just stop going with whoever they followed. */
  const leaving = call?.leaving ?? false;
  useEffect(() => { if (closed) stopFollowing(leaving ? 'moved' : 'quiet'); }, [closed, leaving, stopFollowing]);

  /* Everyone can see you're in a document from the moment it's open, and that you've left once it's out of sight. The editor says which line. */
  const livePage = at.kind === 'live' ? at.page : null;
  useEffect(() => { store.present({ document: closed ? null : documentId, block: null, typing: false, page: closed ? null : livePage }); }, [store, documentId, livePage, closed]);
  const closedNow = useRef(closed);
  closedNow.current = closed;
  const present = useCallback((where: WorkspaceWhere) => { if (!closedNow.current) store.present(where); }, [store]);

  /* A document just made is only opening while it's the one open. */
  useEffect(() => { if (justMade.current !== null && justMade.current !== documentId) justMade.current = null; }, [documentId]);

  /* What's open stays remembered, and its folders open around it. */
  useEffect(() => {
    if (documentId) rememberPlaces(owner, (p) => openedIn(p, workspaceId, documentId));
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
   * typed then was meant for its title. On a board, N is the board's: a sticky, as the blank board says. ⌘\ shows or hides
   * the list.
   */
  const onBoard = item?.kind === 'board';
  const asleep = call?.closed ?? false;
  useEffect(() => {
    if (asleep) return;
    const keys = (e: KeyboardEvent) => {
      if (withMod(e) && e.key === '\\') { e.preventDefault(); toggleList(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || overlayOpen() || !canChange || onBoard || justMade.current !== null || e.key.toLowerCase() !== 'n') return;
      e.preventDefault();
      if (e.shiftKey) newFolder();
      else actions.newDocument(null);
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, [actions, canChange, onBoard, newFolder, toggleList, asleep]);

  const find = useFindKeys(asleep, call?.finding ?? false, call?.onFinding);
  useWordsFollow(workspaceId, pass, view);

  const { drag, arm, ended } = useRowDrag({
    tree, canDrag: (id) => canChange && tree.all.get(id)?.role === 'edit',
    onOpenFolder: (id) => setOpen(id, true),
    canBring: call !== undefined,
    onDrop: (id, spot) => { if (spot.kind === 'trash') actions.trash(id); else if (spot.kind === 'bring') call?.onBring(id, true); else actions.move(id, spot.to); }
  });

  const isPage = mode === 'page';
  const closedFor = useClosedFor(view.status === 'closed', owner, isPage);
  if (view.status === 'closed') {
    if (closedFor === 'asking') return <WsPane page={isPage} />;
    const back = <Button size="sm" onClick={onLeave}>{isPage ? 'Back to your workspaces' : 'Back to the call'}</Button>;
    return (
      <>
        <WsPane page={isPage}>
          <WsDoc>{documentId === null ? <WsCantOpen what="workspace" action={back} /> : <KeptHere workspaceId={workspaceId} documentId={documentId} what={known.current.get(documentId)?.board ? 'board' : 'document'} owner={owner} pass={pass} say={say} back={back} />}</WsDoc>
        </WsPane>
        {!call && <WsToasts toasts={toasts} />}
      </>
    );
  }
  if (!view.tree) return <WsPane page={isPage}>{view.status === 'reconnecting' && <WsDoc><WsOfflineEmpty online={online} onTry={store.retry} /></WsDoc>}</WsPane>;

  const ws: Ws = {
    mode, workspaceId, pass, call, sent: view.tree, here: view.here, others, present, following, follow, stopFollowing, items, tree, at, go, switchTo: onSwitch, leave: onLeave, owner, me,
    self: view.here.find((h) => h.isMe)?.person ?? me, actions, say, canChange, spaceName, spaceSave, listDown: view.status === 'reconnecting' ? { onTry: online ? store.retry : undefined } : null,
    open, setOpen, glowing, blockInto, setBlockInto, draft, setDraft, renaming, setRenaming, listOff, toggleList, justMade, openDoc, page, put, lastDocument, openFind: () => find.setFinding(true), pictures, ids
  };
  const host = call ? { live: call.live, at, go, say, here: view.here, workspaceId, put, lastDocument, closed: call.closed, toggleList, ids, following, stopFollowing: () => stopFollowing() } : null;
  return (
    <WsContext value={ws}>
     <LiveHostContext value={host}>
      <WsPane ref={pane} page={isPage} listOff={listOff} listPeek={call?.list.peek} phoneList={phoneList} following={following !== null && !following.quiet}>
        <List drags={{ drag, arm, ended }} />
        {at.kind === 'live' ? <LivePage page={at.page} line={at.line} /> : at.kind === 'trash' ? <TrashPage /> : item?.kind === 'board' ? <BoardPane key={item.id} item={item} /> : item && item.kind !== 'folder' ? <DocumentPane key={item.id} item={item} /> : at.kind === 'document' ? (
          <WsDoc>
            <WsDocHead crumbs={view.tree.name === null ? [] : [spaceName]} save="quiet" onToggleList={toggleList} />
            {/* A board that was open here says it's a board it can't open. A document's words can go into a new one; a board's changes have nowhere else to go. */}
            <KeptHere key={at.id} workspaceId={workspaceId} documentId={at.id} what={known.current.get(at.id)?.board ? 'board' : 'document'} owner={owner} pass={pass} say={say}
              copyTo={canChange && owner !== null && !known.current.get(at.id)?.board ? { workspaceId, name: () => known.current.get(at.id)?.name ?? null, parent: null, go: (id) => go({ kind: 'document', id }) } : undefined}
              back={<Button size="sm" onClick={() => go({ kind: 'home' }, { replace: true })}>Back to {spaceName}</Button>} />
          </WsDoc>
        ) : (
          /* Nothing's open, so the head has nothing to say, unless the list has gone: then it has the way back to it. */
          <WsDoc className={listOff ? undefined : 'is-bare'}>
            <WsDocHead crumbs={[spaceName]} save="quiet" onToggleList={toggleList} />
            {empty
              ? <WsEmpty space={spaceName} page={isPage} onDocument={canChange ? () => actions.newDocument(null) : undefined} onFolder={canChange ? newFolder : undefined} />
              : <WsPickDocument onDocument={canChange ? () => actions.newDocument(null) : undefined} />}
          </WsDoc>
        )}
      </WsPane>
      {!call && <WsToasts toasts={toasts} />}
      <Find open={find.finding} onOpenChange={find.setFinding} onKeys={() => find.setListing(true)} />
      <Keys open={find.listing} onOpenChange={find.setListing} />
      {drag && <WsDragGhost x={drag.x + 12} y={drag.y + 10} icon={drag.icon} label={drag.label} />}
     </LiveHostContext>
    </WsContext>
  );
}

/**
 * In a call, the workspace is kept as it was while it's out of sight (call/workspace/WorkspacePanel.tsx): opening it again
 * tries its stream at once if it's down, rather than leaving it in the middle of its wait (`WorkspaceLive.wake`). A first
 * connection that's under way carries on.
 */
function useListTriesWhenShown(store: WorkspaceLive, hidden: boolean): void {
  const was = useRef(hidden);
  useEffect(() => {
    const before = was.current;
    was.current = hidden;
    if (before && !hidden) store.wake();
  }, [hidden, store]);
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

