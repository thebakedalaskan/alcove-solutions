/*
 * A document beside the list: its head, the bars that say how things stand, and the editor, which loads when a document
 * first opens and mounts once the document's first sync is in. Someone who loses a document mid-sentence is told so in place,
 * and whatever they wrote that didn't reach Alcove stays theirs to copy, save as a new document, or let go.
 */
import { errorMessage, firstName, type DocSession, type DocStatus, type WorkspaceItem } from '@alcove/api';
import { WsCantOpen, WsDoc, WsDocBy, WsDocHead, WsDocMenu, WsFade, WsGoneBar, WsMovePicker, WsOfflineBar, WsOfflineEmpty, WsPage, WsReadOnlyBar, WsScroll, WsTemplates, WsUnavailable, WsUnsavedBar, Button, wsToast, type WsPop, type WsSave, type WsUnsaved } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLive, useNow, useOnline } from '~/lib/live';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { agoLabel, shortDay } from '~/lib/time';
import { focusRow } from './actions';
import { useWs, type Ws } from './context';
import { Editor } from './editor/lazy';
import { TEMPLATES } from './editor/templates';
import type { BlockDropTarget, EditorHandle, EditorProps, EditorToast, MentionItem, MentionSection, MovingBlock, Point } from './editor/types';
import { Rescue, type CopyTo } from './Rescue';
import { openDocument, withDocument } from './session';
import { ShareSheet } from './Sheets';
import { documentsIn, foldersAbove, foldersFor, nameFrom, nameOf } from './tree';

const dlog = log.child({ component: 'workspace' });

/** A session for one document, and whether its first sync is in. Why it ended, if it has, is in its status. */
interface Opened { session: DocSession; ready: boolean; round: number }

/** One session at a time for a document. `reopen`: a fresh one, from what Alcove has and anything kept here. */
function useSession(ws: Ws, documentId: string) {
  const { workspaceId, pass, owner } = ws;
  const [round, setRound] = useState(0);
  const reopen = useCallback(() => setRound((r) => r + 1), []);
  const [opened, setOpened] = useState<Opened | null>(null);
  useEffect(() => {
    let left = false;
    let held: DocSession | null = null;
    const open = () => {
      openDocument(workspaceId, documentId, owner, pass).then((session) => {
        if (left) { session.close(); return; }
        held = session;
        setOpened({ session, ready: false, round });
        // A session that never opens says why in its status.
        session.ready.then(() => { if (!left) setOpened({ session, ready: true, round }); }, () => undefined);
      }, (e: unknown) => {
        dlog.warn('a document didn’t open', { workspaceId, documentId, err: e });
        addEventListener('online', open, { once: true });
      });
    };
    open();
    return () => { left = true; removeEventListener('online', open); held?.close(); };
  }, [workspaceId, documentId, pass, owner, round]);
  return { opened, reopen };
}

/** How long a document that can't be opened right now waits before it's opened again, a little longer each time. */
const UNAVAILABLE_WAITS = [2_000, 5_000, 15_000, 30_000];

/** The dates `@` offers: today, tomorrow and the next Friday. */
function dateChoices(now: number): { label: string; date: string }[] {
  const today = new Date(now);
  const day = (add: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + add);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const friday = day(((12 - today.getDay()) % 7) || 7);
  return [{ label: 'Today', date: iso(day(0)) }, { label: 'Tomorrow', date: iso(day(1)) }, { label: shortDay(friday), date: iso(friday) }];
}

function Page({ ws, item, session, status }: { ws: Ws; item: WorkspaceItem; session: DocSession; status: DocStatus }) {
  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const now = useNow(60_000);
  const inWorkspace = ws.sent.role !== null;
  const people = useQuery({ ...q.workspacePeople(ws.workspaceId), enabled: inWorkspace }).data;
  const persons = useMemo(() => (people ?? []).map((p) => p.person), [people]);
  /* A caret goes by what someone's known by here, which is how they're listed among who's here. */
  const faces = useMemo(() => [...persons, ...ws.here.map((h) => h.person)], [persons, ws.here]);
  // A session that's ended takes nothing more: anything typed there would have nowhere to go.
  const readOnly = item.role !== 'edit' || item.trashedAt !== null || status.trashed || status.role === 'read' || status.refused === 'read-only' || status.refused === 'trashed' || status.closed !== null;
  const madeHere = useRef(ws.justMade.current === item.id);
  useEffect(() => { if (madeHere.current) ws.justMade.current = null; }, [ws.justMade]);

  /* Naming it in the list reaches the title on this page. */
  useEffect(() => {
    ws.openDoc.current = { id: item.id, doc: session.doc };
    return () => { if (ws.openDoc.current?.doc === session.doc) ws.openDoc.current = null; };
  }, [ws.openDoc, item.id, session.doc]);

  /* What the title says is what the list says: a name that didn't get through, offline say, goes when it can. */
  const reachable = status.status !== 'offline';
  useEffect(() => {
    if (readOnly || !reachable) return;
    let left = false;
    void import('./editor/title').then(({ titleOf }) => {
      const title = titleOf(session.doc);
      if (!left && title && nameFrom(title) !== item.name) ws.actions.titled(item.id, title);
    });
    return () => { left = true; };
    /* Only on opening and on coming back: while someone types, the editor says when the title changes. */
  }, [reachable, readOnly, session.doc, item.id]);

  /* A link to a line lands on it, once the page is drawn. */
  const block = ws.at.kind === 'document' ? ws.at.block : undefined;
  useEffect(() => {
    if (!editor || !block) return;
    let tries = 0, frame = 0;
    const land = () => {
      if (editor.blockJSON(block)) { editor.scrollToBlock(block, { flash: true }); return; }
      if (++tries < 60) frame = requestAnimationFrame(land);
    };
    land();
    return () => cancelAnimationFrame(frame);
  }, [editor, block]);

  const others = useMemo(() => documentsIn(ws.tree).filter((d) => d.id !== item.id && d.role === 'edit'), [ws.tree, item.id]);
  const onMention: EditorProps['onMention'] = (query, { docsOnly }) => {
    const words = query.toLowerCase();
    const has = (s: string) => s.toLowerCase().includes(words);
    const documents: MentionItem[] = documentsIn(ws.tree).filter((d) => d.id !== item.id && has(nameOf(d))).slice(0, docsOnly ? 8 : 3).map((d) => ({ kind: 'document', id: d.id, name: nameOf(d) }));
    if (docsOnly) return [{ title: 'Documents', items: documents }];
    const out: MentionSection[] = [
      { title: ws.spaceName, items: persons.filter((p) => p.email !== ws.me?.email && has(p.name)).slice(0, 6).map((person) => ({ kind: 'person', person })) },
      { title: 'Documents', items: documents },
      { title: 'Dates', items: dateChoices(now).filter((d) => has(d.label)).map((d) => ({ kind: 'date', ...d })) }
    ];
    return out;
  };
  const toast = useCallback((t: EditorToast) => {
    const { run, label } = t;
    ws.say({ icon: t.icon, text: t.text, action: run && label ? { label, onClick: run } : undefined, ms: 5200 });
  }, [ws.say]);
  const documentName = useCallback((id: string) => { const d = ws.tree.all.get(id); return d && d.trashedAt === null ? nameOf(d) : undefined; }, [ws.tree]);
  /* A block sent to another document, from its menu or by dropping it on a row. Undo brings it back to where it was. */
  const moveBlock = async (block: MovingBlock, to: string): Promise<boolean> => {
    const target = ws.tree.all.get(to);
    if (!target || !editor) return false;
    /* Another document only opens with a connection, and the block can't wait on this page for that. */
    if (status.status === 'offline' || !navigator.onLine) { ws.say(wsToast.failed('You’re offline, so this can’t go to another document yet.')); return false; }
    const was = editor.placeOf(block.id);
    const { appendBlocks, removeBlockFrom } = await import('./editor/ydoc');
    /* It gets a new ID where it lands, and that's what Undo takes out of there. */
    let landed: string[] = [];
    try {
      await withDocument(ws.workspaceId, to, ws.owner, ws.pass, (doc) => { landed = appendBlocks(doc, [block.block]); });
    } catch (e) {
      ws.say(wsToast.failed(errorMessage(e)));
      return false;
    }
    const takeBack = async () => {
      await withDocument(ws.workspaceId, to, ws.owner, ws.pass, (doc) => { for (const id of landed) removeBlockFrom(doc, id); });
      /* Back where it was while this page is open, and at the end of the document if someone's gone on since. */
      if (ws.openDoc.current?.doc === session.doc) editor.insertBlocks([block.block], was);
      else await withDocument(ws.workspaceId, item.id, ws.owner, ws.pass, (doc) => { appendBlocks(doc, [block.block]); });
    };
    ws.say(wsToast.moved(nameOf(target), () => { takeBack().catch((e: unknown) => { ws.say(wsToast.failed(errorMessage(e))); }); }));
    return true;
  };
  /** The document in the list under the pointer that can take a block. */
  const documentAt = (at: Point): string | null => {
    const row = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-row][data-kind="document"]');
    const id = row?.dataset['row'];
    return id && id !== item.id && others.some((d) => d.id === id) ? id : null;
  };
  const blockDrop: BlockDropTarget = {
    over: (at) => { const id = documentAt(at); ws.setBlockInto(id); return id !== null; },
    drop: (at, block) => { const id = documentAt(at); ws.setBlockInto(null); return id ? moveBlock(block, id) : false; },
    leave: () => ws.setBlockInto(null)
  };
  const pick = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t || !editor) return;
    const made = editor.insertBlocks(t.blocks, 'all', { appear: true });
    const line = made[1] ?? made[0];
    if (line) editor.focusBlock(line, 'end');
    void import('./editor/title').then(({ setTitle, titleOf }) => {
      if (titleOf(session.doc)) return;
      setTitle(session.doc, item.name || t.name);
      if (!item.name) ws.actions.titled(item.id, t.name);
    });
  };

  /*
   * Tab belongs to the page, so Esc is how the keyboard leaves it. The editor's own Esc goes from the text to the block's
   * handles. From there, or with no handles to go to, it goes to the document's row, where the list's keys work again.
   */
  const leave = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !(e.target instanceof HTMLElement)) return;
    /* It's gone from the handles to the row, and that's all it does: in a call, this isn't also the call's Esc. */
    if (!e.target.isContentEditable) { e.stopPropagation(); focusRow(item.id); }
    else requestAnimationFrame(() => { if (document.activeElement === document.body) focusRow(item.id); });
  };

  return (
    <WsFade id={item.id}>
      <WsPage onKeyDown={leave}>
        <Suspense>
          <Editor ref={setEditor} doc={session.doc} awareness={session.awareness} readOnly={readOnly} titleHint={item.name} people={faces}
            autoFocus={madeHere.current && !readOnly ? 'title' : undefined}
            onMention={onMention} documentName={documentName} onOpenDocument={(id) => ws.go({ kind: 'document', id })}
            onTitle={(title) => ws.actions.titled(item.id, title)} onToast={toast}
            onCopyBlockLink={(id) => ws.actions.copyLink(item.id, id)}
            moveTargets={() => others.map((d) => ({ id: d.id, name: nameOf(d) }))} onMoveBlock={moveBlock} blockDrop={blockDrop}
            byline={item.by ? <WsDocBy person={item.by} name={firstName(item.by.name)} edited={`Edited ${agoLabel(item.editedAt, now)}`} /> : undefined}
            whenBlank={readOnly ? undefined : <WsTemplates templates={TEMPLATES} onPick={pick} />} />
        </Suspense>
      </WsPage>
    </WsFade>
  );
}

export function DocumentPane({ item }: { item: WorkspaceItem }) {
  const ws = useWs();
  const { opened, reopen } = useSession(ws, item.id);
  const online = useOnline();
  if (!opened) return <WsDoc><Blank ws={ws} item={item} />{!online && <WsOfflineEmpty />}</WsDoc>;
  return <OpenedPane ws={ws} item={item} opened={opened} reopen={reopen} />;
}

/** The head with nothing to do yet. */
function Blank({ ws, item }: { ws: Ws; item: WorkspaceItem }) {
  return <WsDocHead crumbs={crumbsOf(ws, item)} save="quiet" onToggleList={ws.toggleList} zen={ws.call?.zen?.on} onZen={ws.call?.zen?.onToggle} />;
}

const crumbsOf = (ws: Ws, item: WorkspaceItem) => [...(ws.sent.name === null ? [] : [ws.spaceName]), ...foldersAbove(ws.tree, item.id).map(nameOf), nameOf(item)];

/** Why what's written here isn't reaching Alcove, as the bar says it, if it says anything. */
function unsavedOf(status: DocStatus, ready: boolean, guest: boolean): WsUnsaved | null {
  if (status.closed === 'unavailable') return ready ? 'unavailable' : null;
  if (status.closed === 'session') return guest ? 'call-ended' : 'signed-out';
  if (status.refused === 'too-large' || status.refused === 'rejected') return status.refused;
  return status.refused === 'read-only' && status.unsent ? 'read-only' : null;
}

function OpenedPane({ ws, item, opened, reopen }: { ws: Ws; item: WorkspaceItem; opened: Opened; reopen: () => void }) {
  const { session, ready } = opened;
  const status = useLive(session);
  const [more, setMore] = useState<'menu' | 'move' | null>(null);
  const [share, setShare] = useState(false);
  const member = ws.sent.role !== null;
  const canShare = member && item.role === 'edit';
  const changing = ws.canChange && item.role === 'edit' && item.trashedAt === null;
  const trashed = item.trashedAt !== null || status.trashed || status.refused === 'trashed';
  const gone = status.closed === 'access' || status.closed === 'deleted';
  /* The browser knows before the document's stream does, which only finds out when it next tries to say something. */
  const online = useOnline();
  const offline = status.status === 'offline' || (!online && status.status !== 'failed');
  const unsaved = unsavedOf(status, ready, ws.owner === null);
  /* Where words may not get there by themselves, they're offered. In Trash, Restore it is the way. */
  const stuck = status.unsent && !trashed && (status.refused !== null || status.closed !== null);
  const folder = item.parent === null ? undefined : ws.tree.all.get(item.parent);
  const copyTo: CopyTo | undefined = ws.canChange && ws.owner !== null && status.closed !== 'session' ? {
    workspaceId: ws.workspaceId, name: () => nameOf(item), parent: folder && folder.trashedAt === null ? folder.id : null, go: (id) => ws.go({ kind: 'document', id })
  } : undefined;
  const rescue = stuck ? <Rescue session={session} say={ws.say} copyTo={copyTo} onLetGo={reopen} /> : null;

  /* A document that can't be opened right now opens again by itself, a little later each time. */
  const tries = useRef(0);
  useEffect(() => { if (ready) tries.current = 0; }, [ready]);
  useEffect(() => {
    if (status.closed !== 'unavailable') return undefined;
    const wait = UNAVAILABLE_WAITS[Math.min(tries.current, UNAVAILABLE_WAITS.length - 1)] ?? 30_000;
    tries.current += 1;
    const timer = setTimeout(reopen, wait);
    return () => clearTimeout(timer);
  }, [status.closed, reopen]);

  /* Back from being offline, and everything's in. */
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline) wasOffline.current = true;
    else if (wasOffline.current && status.status === 'saved') { wasOffline.current = false; ws.say(wsToast.backOnline()); }
  }, [offline, status.status, ws.say]);

  if (gone) {
    return (
      <WsDoc>
        <WsDocHead crumbs={ws.sent.name === null ? [] : [ws.spaceName]} save="quiet" onToggleList={ws.toggleList} zen={ws.call?.zen?.on} onZen={ws.call?.zen?.onToggle} />
        <WsCantOpen what="document" unsent={rescue !== null}
          action={rescue ?? <Button size="sm" onClick={() => ws.go({ kind: 'home' }, { replace: true })}>Back to {ws.spaceName}</Button>} />
      </WsDoc>
    );
  }

  const close = () => setMore(null);
  const morePop: WsPop = {
    open: more !== null, onOpenChange: (to) => setMore(to ? 'menu' : null),
    content: more === 'move' ? (
      <WsMovePicker name={nameOf(item)} space={ws.spaceName} folders={foldersFor(ws.tree, item.id)}
        onRoot={() => { close(); ws.actions.move(item.id, { parent: null }); }} onFolder={(id) => { close(); ws.actions.move(item.id, { parent: id }); }} />
    ) : (
      <WsDocMenu onShare={canShare ? () => { close(); setShare(true); } : undefined}
        onDuplicate={changing ? () => { close(); ws.actions.duplicate(item.id); } : undefined}
        onMove={changing ? () => setMore('move') : undefined}
        onCopyLink={() => { close(); ws.actions.copyLink(item.id); }}
        onTrash={changing ? () => { close(); ws.actions.trash(item.id); } : undefined} />
    )
  };
  const who = item.trashedBy ? firstName(item.trashedBy) : 'Someone';
  const save: WsSave = status.closed === 'unavailable' || offline ? 'offline' : status.closed === 'session' ? (status.unsent ? 'failed' : 'quiet') : ready ? status.status : 'quiet';
  return (
    <WsDoc>
      <WsDocHead crumbs={crumbsOf(ws, item)} save={save} onToggleList={ws.toggleList}
        share={canShare ? { open: share, onOpenChange: setShare, content: <ShareSheet item={item} /> } : undefined} more={morePop}
        zen={ws.call?.zen?.on} onZen={ws.call?.zen?.onToggle} />
      <WsOfflineBar show={offline && ready && status.closed === null} />
      <WsUnsavedBar why={unsaved}>{rescue}</WsUnsavedBar>
      <WsGoneBar who={trashed ? who : null} onRestore={item.role === 'edit' ? () => ws.actions.restore(item.id) : undefined} />
      <WsReadOnlyBar show={!trashed && unsaved !== 'read-only' && (item.role !== 'edit' || status.role === 'read' || status.refused === 'read-only')} organizer={item.by ? firstName(item.by.name) : 'whoever shared it'} />
      {ready
        ? <WsScroll><Page key={opened.round} ws={ws} item={item} session={session} status={status} /></WsScroll>
        : status.closed === 'unavailable' ? <WsUnavailable /> : offline && <WsOfflineEmpty />}
    </WsDoc>
  );
}
