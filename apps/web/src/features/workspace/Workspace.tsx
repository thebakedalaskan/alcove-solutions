/*
 * The workspace: the list and the page beside it, driven by the workspace's live stream. It's a page of the app outside a
 * call and a panel inside one, the same in both: it takes where it is and says where to go, and whatever holds it keeps the
 * address. See WorkspaceProps in context.ts.
 */
import { firstName, type WorkspaceItem, type WorkspaceLive, type WorkspaceMention, type WorkspaceTree } from '@alcove/api';
import { Button, WsCantOpen, WsDoc, WsDragGhost, WsEmpty, WsFrame, WsOfflineEmpty, WsPane, WsPickDocument, WsToasts, useToast, wsToast, type WsToastData } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api } from '~/lib/api';
import { overlayOpen, typing, withMod } from '~/lib/keys';
import { useLive, useMedia, useOnline } from '~/lib/live';
import { log } from '~/lib/log';
import { accountQueries } from '~/features/account/queries';
import { teamQueries } from '~/features/team/queries';
import { workspaceQueries, useWorkspaceName } from './queries';
import { workspaceKeys } from './queryKeys';
import { announceMentionsRead } from '~/features/notifications/attentionChannel';
import { useTreeActions } from './tree/actions';
import { BoardPane } from './document/BoardPane';
import { useLaidOver } from './tree/changes';
import { WsContext, type FolderDraft, type OpenPage, type TreeActions, type Ws, type WorkspacePlace, type WorkspaceProps } from './context';
import { DocumentPane } from './document/DocumentPane';
import { keptDocuments } from './offline/keep';
import { KeptHere } from './offline/Rescue';
import { useRowDrag } from './tree/drag';
import { preloadEditor } from './editor/lazy';
import { useCallTiles, useFollow } from './follow';
import { homeOf, type HomeOf } from './full-screen/calls';
import { Find, useFindKeys } from './find/Find';
import { Frame } from './full-screen/Frame';
import { PaneHead } from './Head';
import { Home } from './full-screen/Home';
import { usePersonIds } from './sharing/ids';
import { Keys } from './Keys';
import { List } from './tree/List';
import { LiveHostContext } from './live/host';
import { LivePage } from './live/LivePage';
import { useSending } from './live/useSending';
import { openedIn, placesOf, rememberPlaces, useOwnListOff } from './tree/places';
import { othersIn, usePresence } from './presence';
import { TrashPage } from './tree/TrashPage';
import { arrivals, documentsIn, foldersAbove, nameOf, treeOf, type Tree } from './tree/tree';
import { useWorkspaceMedia } from './uploads/useWorkspaceMedia';
import { useWordsFollow } from './find/words';

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
    qc.fetchQuery({ ...accountQueries.session(), staleTime: 0 }).then(async (found) => {
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
    const now = treeOf(sent.items, mode !== 'call');
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
      const owner = qc.getQueryData(accountQueries.session().queryKey)?.ownerId;
      if (owner) announceMentionsRead(owner);
      return qc.invalidateQueries({ queryKey: workspaceKeys.mentions });
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

/** What the list last called each document, for a copy of someone's words in one that's gone. */
function useKnownNames(items: readonly WorkspaceItem[]): RefObject<Map<string, { name: string; board: boolean }>> {
  const known = useRef(new Map<string, { name: string; board: boolean }>());
  useEffect(() => { for (const it of items) if (it.kind !== 'folder') known.current.set(it.id, { name: nameOf(it), board: it.kind === 'board' }); }, [items]);
  return known;
}

/**
 * Something outside the workspace wants it shown, such as a board's Saved in when the board is kept here: where you left it,
 * the document you were last in here, or else its list, on a phone too. Only for each want after this opened (`wanted` counts
 * them), and `now` is read as each comes.
 */
function useShownWhenWanted(wanted: number, workspaceId: string, now: { tree: Tree; owner: string | null; go: WorkspaceProps['onGo'] }, showList: () => void): void {
  const seenWant = useRef(wanted);
  const forWant = useRef(now);
  forWant.current = now;
  useEffect(() => {
    if (wanted === seenWant.current) return;
    seenWant.current = wanted;
    const { tree: t, owner: o, go: to } = forWant.current;
    const lastId = placesOf(o).documents[workspaceId];
    const last = lastId === undefined ? undefined : t.all.get(lastId);
    if (last && last.kind === 'document' && last.trashedAt === null) to({ kind: 'document', id: last.id });
    else showList();
  }, [wanted, workspaceId]);
}

/**
 * Where the workspace opens. A phone shows the list until something's open. A screen with room opens what you had open last,
 * once, on arriving: what someone else makes in the meantime doesn't take you anywhere. Someone in a call who was given what
 * they can open here, and is outside the workspace, lands on it on a phone too: it opens by itself, as they were told it would.
 * Full screen, whether this is a call's own workspace, which has no Home, is for the Drive's list of workspaces to say (`home`).
 */
function useLanding({ mode, at, documentId, empty, sent, tree, owner, workspaceId, phone, inCall, member, onGo, setPhoneList }: {
  mode: WorkspaceProps['mode'];
  at: WorkspacePlace;
  documentId: string | null;
  /** Nothing's in the workspace yet. */
  empty: boolean;
  sent: WorkspaceTree | null;
  tree: Tree;
  owner: string | null;
  workspaceId: string;
  phone: boolean;
  inCall: boolean;
  member: boolean;
  onGo: WorkspaceProps['onGo'];
  setPhoneList: (shown: boolean) => void;
}): { home: HomeOf | null; homeKnown: boolean; callHome: boolean } {
  useEffect(() => {
    if (mode !== 'page') setPhoneList(at.kind === 'home' && !empty);
    else if (at.kind !== 'home') setPhoneList(false);
  }, [mode, at.kind, documentId, empty]);
  const spaces = useQuery({ ...workspaceQueries.workspaces(), enabled: owner !== null && mode === 'page' });
  const home = mode === 'page' ? homeOf(spaces.data?.find((w) => w.id === workspaceId), tree) : null;
  const homeKnown = mode !== 'page' || owner === null || !spaces.isPending;

  const arrived = useRef(false);
  const given = inCall && sent?.role === null && !sent.inCall;
  const callHome = home !== null;
  useEffect(() => {
    if (at.kind !== 'home') { arrived.current = false; return; }
    if (!sent || arrived.current || (phone && !given)) return;
    /* Full screen a workspace's Home is a page of its own: only a call's own workspace, which has none, opens on what's in it. */
    if (mode === 'page' && member && (!homeKnown || !callHome)) return;
    arrived.current = true;
    const was = placesOf(owner).documents[workspaceId];
    const docs = documentsIn(tree);
    const next = docs.find((d) => d.id === was) ?? docs[0];
    if (next) onGo({ kind: 'document', id: next.id }, { replace: true });
  }, [sent, at.kind, phone, given, owner, workspaceId, tree, onGo, mode, member, homeKnown, callHome]);
  return { home, homeKnown, callHome };
}

/**
 * What follows the document that's open: a document just made is only opening while it's the one open, and what's open stays
 * remembered, with its folders open around it.
 */
function useOpenDocument({ documentId, item, tree, owner, workspaceId, justMade, openAll }: {
  documentId: string | null;
  item: WorkspaceItem | undefined;
  tree: Tree;
  owner: string | null;
  workspaceId: string;
  justMade: RefObject<string | null>;
  openAll: (ids: string[]) => void;
}): void {
  useEffect(() => { if (justMade.current !== null && justMade.current !== documentId) justMade.current = null; }, [documentId]);
  useEffect(() => {
    if (documentId) rememberPlaces(owner, (p) => openedIn(p, workspaceId, documentId));
  }, [owner, workspaceId, documentId]);
  const inFolders = item ? foldersAbove(tree, item.id).map((f) => f.id).join() : '';
  useEffect(() => { if (inFolders) openAll(inFolders.split(',')); }, [inFolders, openAll]);
}

/**
 * N and ⇧N make something outside any folder, or in a call in its own folder (This call), and sleep while you're typing, and
 * while a new document is opening: what's typed then was meant for its title. On a board, N is the board's: a sticky, as the
 * blank board says. In a call, ⌘\ shows or hides the list; full screen, the side panel stays. `asleep`: beside another page of
 * the app's, or out of sight in a call, where the keys aren't the workspace's.
 */
function useMakeKeys({ asleep, mode, canChange, onBoard, justMade, madeIn, toggleList, newFolder, actions }: {
  asleep: boolean;
  mode: WorkspaceProps['mode'];
  canChange: boolean;
  onBoard: boolean;
  justMade: RefObject<string | null>;
  /** The folder what's made goes in: the call's own, or none. */
  madeIn: string | null;
  toggleList: () => void;
  newFolder: () => void;
  actions: TreeActions;
}): void {
  useEffect(() => {
    if (asleep) return;
    const keys = (e: KeyboardEvent) => {
      if (withMod(e) && e.key === '\\' && mode === 'call') { e.preventDefault(); toggleList(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || overlayOpen() || !canChange || onBoard || justMade.current !== null || e.key.toLowerCase() !== 'n') return;
      e.preventDefault();
      if (e.shiftKey) newFolder();
      else actions.newDocument(madeIn);
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, [actions, canChange, onBoard, newFolder, toggleList, asleep, mode, madeIn]);
}

/** The workspace once its stream is open. */
function Pane({ store, mode, workspaceId, at, onGo, onSwitch, onLeave, onExpand, frame, pass, call }: WorkspaceProps & { store: WorkspaceLive }) {
  const view = useLive(store);
  const online = useOnline();
  useListTriesWhenShown(store, call?.closed ?? false);
  const session = useQuery(accountQueries.session()).data ?? null;
  const owner = session?.ownerId ?? null;
  const me = session?.user ?? null;
  const { items, change } = useLaidOver(store);
  /* Boards are listed wherever the workspace isn't in a call, which shows its boards on the stage. */
  const tree = useMemo(() => treeOf(items, mode !== 'call'), [items, mode]);
  const { toasts, say: sayHere } = useToasts();
  const say = call?.say ?? sayHere;
  const glowing = useGlow(view.tree, mode);
  const { open, setOpen, openAll } = useFolders(owner, workspaceId);
  const [draft, setDraft] = useState<FolderDraft | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const [blockInto, setBlockInto] = useState<string | null>(null);
  /* Full screen the side panel and the page take turns from 860px down, as the app's own frame does; in a call, from 640px. */
  const phone = useMedia(mode === 'page' ? '(max-width: 860px)' : '(max-width: 640px)');
  const [phoneList, setPhoneList] = useState(at.kind === 'home');
  const justMade = useRef<string | null>(null);
  const openDoc = useRef<Ws['openDoc']['current']>(null);
  const page = useRef<OpenPage | null>(null);
  const known = useKnownNames(items);
  /* Its pictures, read for whatever shows them and let go of with it; an upload that outlives the page says how it went here. */
  const pictures = useWorkspaceMedia({ workspaceId, pass, signedIn: owner !== null, from: call ? 'call' : 'page', say });
  const { name: spaceName, state: spaceSave } = useWorkspaceName(workspaceId, view.tree?.name ?? 'Shared with you', owner !== null);
  const others = useMemo(() => othersIn(view.here), [view.here]);
  const goWith = useCallback((to: WorkspacePlace) => { setPhoneList(false); onGo(to, { replace: true }); }, [onGo]);
  const pane = useRef<HTMLElement>(null);
  const { following, follow, stopFollowing } = useFollow({ others, presenter: call?.presenter ?? null, tree, at, goWith, say, pane });
  /*
   * Going anywhere puts a phone's list away, even to what's already open behind it, and going yourself stops following. Full
   * screen, a workspace's Home is a page like any other, so going there puts the list away too.
   */
  const go = useCallback<WorkspaceProps['onGo']>((to, how) => { stopFollowing(); setPhoneList(mode !== 'page' && to.kind === 'home'); onGo(to, how); }, [mode, onGo, stopFollowing]);
  useShownWhenWanted(call?.list.wanted ?? 0, workspaceId, { tree, owner, go }, () => setPhoneList(true));
  useTagToasts(store, view.mentions, tree, at, say, go);
  /* Someone in the workspace who can edit changes what's in it, and so does anyone in a call that uses it. */
  const role = view.tree?.role ?? null;
  const canChange = role === 'admin' || role === 'edit' || view.tree?.inCall === true;
  /* The call's own folder, in its home: the list shows it as This call, and what's made in the call goes in it. */
  const callFolder = call ? items.find((i) => i.kind === 'folder' && i.call?.here === true && i.trashedAt === null)?.id ?? null : null;
  const madeIn = callFolder !== null && canChange && tree.all.get(callFolder)?.role === 'edit' ? callFolder : null;
  const actions = useTreeActions({ workspaceId, pass, owner, tree, at, me, spaceName, callFolder, change, go, say, openFolders: openAll, justMade, openDoc });
  /* Everyone a document here may tag, quote or name for a follow-up, by the ID the workspace knows them by. */
  const member = view.tree?.role != null;
  const team = useQuery({ ...teamQueries.team(), enabled: member }).data;
  const named = useMemo(() => [...(call?.people ?? []).map((p) => p.person.email), ...(call?.invited ?? []).map((p) => p.email), ...(team?.members ?? []).map((m) => m.person.email)], [call?.people, call?.invited, team]);
  const ids = usePersonIds(workspaceId, pass, named, member || call !== undefined);
  const { put, lastDocument } = useSending({
    live: call?.live, workspaceId, pass, owner, tree, at, member, here: view.here, closed: call?.closed ?? false, go, say, openDoc, ids
  });
  const documentId = at.kind === 'document' ? at.id : null;
  const item = documentId === null ? undefined : tree.all.get(documentId);

  const [ownListOff, setListOff] = useOwnListOff(owner);
  /* In a call the list is one of the things that give way, so the call says whether it shows. */
  const listOff = call?.list.off ?? ownListOff;
  const toggleInCall = call?.list.onToggle;
  const toggleList = useCallback(() => {
    if (matchMedia('(max-width: 640px)').matches) setPhoneList((on) => !on);
    else if (toggleInCall) toggleInCall();
    else setListOff((off) => !off);
  }, [toggleInCall]);

  const empty = view.tree !== null && tree.kids.size === 0;
  const { home, homeKnown, callHome } = useLanding({
    mode, at, documentId, empty, sent: view.tree, tree, owner, workspaceId, phone, inCall: call !== undefined, member, onGo, setPhoneList
  });

  /* The call's tiles: who's here, who's writing and who you follow, and what the call asks of the workspace from them (follow.ts). */
  const closed = call?.closed ?? false;
  useCallTiles({ call, others, tree, following, follow, stopFollowing, go, page, closed });

  /* Everyone can see you're in a document from the moment it's open, and that you've left once it's out of sight. The editor says which line. */
  const livePage = at.kind === 'live' ? at.page : null;
  const present = usePresence(store, documentId, livePage, closed);
  useOpenDocument({ documentId, item, tree, owner, workspaceId, justMade, openAll });

  /* A folder is named in the list, so the list has to be showing: in a call, wherever the call shows it, and never hidden. */
  const showInCall = call?.list.onShow;
  const newFolder = useCallback(() => {
    setDraft({ parent: madeIn });
    setPhoneList(true);
    if (showInCall) showInCall();
    else setListOff(false);
  }, [showInCall, madeIn]);

  /* Beside another page of the app's, the keys are that page's: ⌘K is its search, and N doesn't make anything here. */
  const beside = mode === 'beside';
  const asleep = beside || (call?.closed ?? false);
  useMakeKeys({ asleep, mode, canChange, onBoard: item?.kind === 'board', justMade, madeIn, toggleList, newFolder, actions });

  const find = useFindKeys(asleep, call?.finding ?? false, call?.onFinding);
  useWordsFollow(workspaceId, pass, view);

  const { drag, arm, ended } = useRowDrag({
    tree, canDrag: (id) => canChange && tree.all.get(id)?.role === 'edit',
    onOpenFolder: (id) => setOpen(id, true),
    canBring: call !== undefined, callFolder,
    onDrop: (id, spot) => { if (spot.kind === 'trash') actions.trash(id); else if (spot.kind === 'bring') call?.onBring(id, true); else actions.move(id, spot.to); }
  });

  const isPage = mode === 'page';
  /* Full screen, the frame is there from the first moment, its side panel dark until the workspace is in it. */
  const shell = (content?: ReactNode) => (isPage ? <WsFrame>{content}</WsFrame> : <WsPane beside={beside}>{content}</WsPane>);
  const closedFor = useClosedFor(view.status === 'closed', owner, mode !== 'call');
  if (view.status === 'closed') {
    if (closedFor === 'asking') return shell();
    const back = <Button size="sm" onClick={onLeave}>{call ? 'Back to the call' : 'Back to your workspaces'}</Button>;
    return (
      <>
        {shell(<WsDoc>{documentId === null ? <WsCantOpen what="workspace" action={back} /> : <KeptHere workspaceId={workspaceId} documentId={documentId} what={known.current.get(documentId)?.board ? 'board' : 'document'} owner={owner} pass={pass} say={say} back={back} />}</WsDoc>)}
        {!call && <WsToasts toasts={toasts} place={isPage ? 'full' : 'beside'} />}
      </>
    );
  }
  if (!view.tree) return shell(view.status === 'reconnecting' && <WsDoc><WsOfflineEmpty online={online} onTry={store.retry} /></WsDoc>);

  const ws: Ws = {
    mode, workspaceId, pass, call, sent: view.tree, here: view.here, others, present, following, follow, stopFollowing, items, tree, at, go, switchTo: onSwitch, owner, me,
    self: view.here.find((h) => h.isMe)?.person ?? me, actions, say, canChange, callFolder, madeIn, spaceName, spaceSave, listDown: view.status === 'reconnecting' ? { onTry: online ? store.retry : undefined } : null,
    open, setOpen, glowing, blockInto, setBlockInto, draft, setDraft, renaming, setRenaming, listOff, toggleList, expand: onExpand, frame, home, showPages: () => setPhoneList(true), naming, setNaming, justMade, openDoc, page, put, lastDocument, openFind: () => find.setFinding(true), pictures, ids
  };
  const host = call ? { live: call.live, at, go, say, here: view.here, workspaceId, put, lastDocument, closed: call.closed, toggleList, ids, following, stopFollowing: () => stopFollowing() } : null;
  /* Full screen, a workspace's own Home is its page with nothing open; a call's own workspace has none, and opens on what the call made. */
  const onHome = isPage && member && at.kind === 'home' && homeKnown && !callHome;
  const opened = at.kind === 'live' ? <LivePage page={at.page} line={at.line} /> : at.kind === 'trash' ? <TrashPage /> : item?.kind === 'board' ? <BoardPane key={item.id} item={item} /> : item && item.kind !== 'folder' ? <DocumentPane key={item.id} item={item} /> : at.kind === 'document' ? (
    <WsDoc>
      <PaneHead crumbs={view.tree.name === null ? [] : [spaceName]} save="quiet" />
      {/* A board that was open here says it's a board it can't open. A document's words can go into a new one; a board's changes have nowhere else to go. */}
      <KeptHere key={at.id} workspaceId={workspaceId} documentId={at.id} what={known.current.get(at.id)?.board ? 'board' : 'document'} owner={owner} pass={pass} say={say}
        copyTo={canChange && owner !== null && !known.current.get(at.id)?.board ? { workspaceId, name: () => known.current.get(at.id)?.name ?? null, parent: null, go: (id) => go({ kind: 'document', id }) } : undefined}
        back={<Button size="sm" onClick={() => go({ kind: 'home' }, { replace: true })}>Back to {spaceName}</Button>} />
    </WsDoc>
  ) : onHome ? <Home /> : isPage && member && !homeKnown ? null : (
    /* Nothing's open, so the head has nothing to say, unless the list has gone: then it has the way back to it. */
    <WsDoc className={listOff ? undefined : 'is-bare'}>
      <PaneHead crumbs={[spaceName]} save="quiet" />
      {empty
        ? <WsEmpty space={spaceName} page={isPage} onDocument={canChange ? () => actions.newDocument(madeIn) : undefined} onFolder={canChange ? newFolder : undefined} />
        : <WsPickDocument onDocument={canChange ? () => actions.newDocument(madeIn) : undefined} />}
    </WsDoc>
  );
  const followingOn = following !== null && !following.quiet;
  return (
    <WsContext value={ws}>
     <LiveHostContext value={host}>
      {isPage ? (
        <Frame drags={{ drag, arm, ended }} phoneList={phoneList} home={onHome} following={followingOn} pane={pane}>{opened}</Frame>
      ) : (
        <WsPane ref={pane} beside={beside} listOff={listOff} listPeek={call?.list.peek} phoneList={phoneList && !beside} following={followingOn}>
          {!beside && <List drags={{ drag, arm, ended }} />}
          {opened}
        </WsPane>
      )}
      {!call && <WsToasts toasts={toasts} place={isPage ? 'full' : 'beside'} />}
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
  if (store) return <Pane {...props} store={store} />;
  return props.mode === 'page' ? <WsFrame /> : <WsPane beside={props.mode === 'beside'} />;
}

/**
 * Nothing here decides a theme. In a call the `.stage` around it makes the whole document night, menus and sheets included,
 * and as a page it follows the app's theme.
 */
export function Workspace(props: WorkspaceProps) {
  return <Live key={props.workspaceId} {...props} />;
}

