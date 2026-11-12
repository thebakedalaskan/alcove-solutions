/*
 * A document beside the list: its head, the bars that say how things stand, and the editor, which loads when a document
 * first opens and mounts once the document's first sync is in. Someone who loses a document mid-sentence is told so in place,
 * and whatever they wrote that didn't reach Alcove stays theirs to copy, save as a new document, or let go.
 */
import { errorMessage, firstName, type DocSession, type DocStatus, type Person, type WorkspaceItem } from '@alcove/api';
import { WsCantOpen, WsDoc, WsDocBy, WsDocHead, WsDocMenu, WsFade, WsFollowBar, WsGoneBar, WsMentionPrompt, WsMovePicker, WsOfflineBar, WsOfflineEmpty, WsPage, WsPopover, WsReadOnlyBar, WsScroll, WsTemplates, WsVersionBar, WsUnavailable, WsUnsavedBar, Button, wsToast, type WsFace, type WsPop, type WsSave, type WsUnsaved } from '@alcove/ui';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLive, useNow, useOnline } from '~/lib/live';
import { agoLabel } from '~/lib/time';
import { focusRow } from './actions';
import type { CommentOpen } from './Comments';
import { useAsk } from './Ask';
import { useWs, type Ws } from './context';
import { useDocumentMedia } from './DocumentMedia';
import { Editor } from './editor/lazy';
import { useHistory } from './History';
import { TEMPLATES } from './editor/templates';
import type { BlockDropTarget, EditorHandle, EditorProps, EditorToast, MovingBlock, Point, Rect } from './editor/types';
import { PersonCard } from './People';
import { facesIn } from './presence';
import { KeyboardBar } from './KeyboardBar';
import { HearIt } from './live/HearIt';
import { useEditorCall } from './live/useEditorCall';
import { useVideoHandlers } from './playing';
import { Rescue, type CopyTo } from './Rescue';
import { useBackOnline, useOpensAgain, useSession, useTriesWhenShown, type Opened } from './opened';
import { withDocument } from './session';
import { ShareSheet } from './Sheets';
import { tagRect, useTags } from './tags';
import { documentsIn, folderName, foldersAbove, foldersFor, nameFrom, nameOf } from './tree';

const Comments = lazy(() => import('./Comments'));

/** Lands on a line: it glows, and the caret's there, so what's typed next goes where you are. A touch screen's keyboard stays down. */
export function landOn(editor: EditorHandle, block: string): void {
  if (!matchMedia('(hover: none)').matches) editor.focusBlock(block, 'end');
  editor.scrollToBlock(block, { flash: true });
}

function Page({ ws, item, session, status }: { ws: Ws; item: WorkspaceItem; session: DocSession; status: DocStatus }) {
  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const now = useNow(60_000);
  const { sections, faces: tagged, tagged: onTagged, ask, answer, notNow } = useTags(ws, item, now);
  const [comment, setComment] = useState<CommentOpen | null>(null);
  const [named, setNamed] = useState<{ person: Person; rect: Rect; tag: () => Element | null } | null>(null);
  /* A person's card sits against their tag, and the question a tag asks against its line, wherever they are now. */
  const namedAt = useMemo(() => named && { at: () => named.tag()?.getBoundingClientRect() ?? new DOMRect(named.rect.left, named.rect.top, named.rect.width, named.rect.height), within: named.tag }, [named]);
  const askWithin = useCallback(() => (ask ? document.querySelector(`.wb[data-b="${CSS.escape(ask.block)}"]`) : null), [ask]);
  // A session that's ended takes nothing more: anything typed there would have nowhere to go.
  const readOnly = item.role !== 'edit' || item.trashedAt !== null || status.trashed || status.role === 'read' || status.refused === 'read-only' || status.refused === 'trashed' || status.closed !== null;
  const alcove = useAsk(ws, item);
  const video = useVideoHandlers(ws, item.id, true);
  const media = useDocumentMedia(ws, item.id, { session, editor, readOnly, video });
  const madeHere = useRef(ws.justMade.current === item.id);
  useEffect(() => { if (madeHere.current) ws.justMade.current = null; }, [ws.justMade]);

  /* Naming it in the list reaches the title on this page, and what's sent from a call lands on it. */
  useEffect(() => {
    ws.openDoc.current = { id: item.id, doc: session.doc, editor };
    return () => { if (ws.openDoc.current?.doc === session.doc) ws.openDoc.current = null; };
  }, [ws.openDoc, item.id, session.doc, editor]);
  const { call: fromCall, people: inCall } = useEditorCall(ws, editor, session.doc, readOnly);
  /* A caret goes by what someone's known by here, which is how they're listed among who's here. */
  /* Whose face goes on a caret, a tag or a comment: people here last, who may know more about themselves than the list does. */
  const faces = useMemo(() => [...tagged, ...inCall, ...ws.here.map((h) => h.person)], [tagged, inCall, ws.here]);
  const byId = useMemo(() => new Map(faces.map((p) => [p.id, p])), [faces]);
  /* Hearing a quote takes the notes, which take an account, except in the call it's from, which plays it for anyone in it. */
  const signedIn = ws.owner !== null;
  /* In the call, the call says where a line it heard is, before its note can. */
  const callSession = ws.call?.live.session;
  const hear = useCallback<NonNullable<EditorProps['hear']>>((m) => <HearIt note={m.note} line={m.line} call={callSession} notes={signedIn} />, [callSession, signedIn]);

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
      if (editor.blockJSON(block)) { landOn(editor, block); return; }
      if (++tries < 60) frame = requestAnimationFrame(land);
    };
    land();
    return () => cancelAnimationFrame(frame);
  }, [editor, block]);

  /* A block goes to another document, and only a document can be linked with `@`: a board is a `/` Board of its own. */
  const others = useMemo(() => documentsIn(ws.tree).filter((d) => d.kind === 'document' && d.id !== item.id && d.role === 'edit'), [ws.tree, item.id]);

  /* Going where someone goes, to the same line. Nothing glows: it's not somewhere you asked to land. */
  const followed = ws.following?.document === item.id ? ws.following.block : null;
  useEffect(() => {
    if (!editor || !followed) return;
    let tries = 0, frame = 0;
    const land = () => {
      if (editor.blockJSON(followed)) { editor.scrollToBlock(followed, { smooth: true }); return; }
      if (++tries < 60) frame = requestAnimationFrame(land);
    };
    land();
    return () => cancelAnimationFrame(frame);
  }, [editor, followed]);

  /* Done with a comment: the keyboard goes back to the words, unless something else has it by then. */
  const openComment = useCallback((to: CommentOpen | null) => {
    setComment(to);
    if (!to) requestAnimationFrame(() => { if (document.activeElement === document.body) editor?.resume(); });
  }, [editor]);

  /* Tag from a card: only where you can write. */
  useEffect(() => {
    if (!editor) return;
    ws.page.current = { canTag: !readOnly, tag: editor.tag };
    return () => { ws.page.current = null; };
  }, [ws.page, editor, readOnly]);
  const openPerson: EditorProps['onOpenPerson'] = (id, rect, tag) => {
    const person = ws.others.find((o) => o.person.id === id)?.person;
    if (person) setNamed({ person, rect, tag });
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
    if (status.status === 'offline' || !navigator.onLine) { ws.say(wsToast.failed(navigator.onLine ? 'Alcove can’t be reached right now, so this can’t go to another document yet.' : 'You’re offline, so this can’t go to another document yet.')); return false; }
    const was = editor.placeOf(block.id);
    const [{ appendBlocks, removeBlockFrom }, { mediaOfBlock }] = await Promise.all([import('./editor/ydoc'), import('./editor/blocks/attrs')]);
    /* It gets a new ID where it lands, and that's what Undo takes out of there. */
    let landed: string[] = [];
    try {
      /* Its photos, video or file go with it: whoever can open that document can see them once it's there. */
      await media.attachTo(to, mediaOfBlock(block.block));
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
    /* Typing stops following: you stay where you are. */
    if (e.key !== 'Escape' && !['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) ws.stopFollowing();
    if (e.key !== 'Escape' || !(e.target instanceof HTMLElement)) return;
    /* It's gone from the handles to the row, and that's all it does: in a call, this isn't also the call's Esc. */
    if (!e.target.isContentEditable) { e.stopPropagation(); focusRow(item.id); }
    else requestAnimationFrame(() => { if (document.activeElement === document.body) focusRow(item.id); });
  };

  return (
    <WsFade id={item.id}>
      <WsPage onKeyDown={leave}>
        <Suspense>
          <Editor ref={setEditor} doc={session.doc} awareness={session.awareness} readOnly={readOnly} titleHint={item.name} people={faces} call={fromCall} hear={signedIn || callSession ? hear : undefined}
            autoFocus={madeHere.current && !readOnly ? 'title' : undefined}
            onMention={sections} documentName={documentName} onOpenDocument={(id) => ws.go({ kind: 'document', id })}
            onNewBoard={!readOnly && ws.canChange && ws.tree.boards ? () => ws.actions.newBoard(item.parent, { stay: true }) : undefined}
            onOpenPerson={openPerson} onTagged={(person, block, rect) => { void onTagged(person, block, tagRect(person.id, block, rect)); }}
            onComment={readOnly || !ws.self ? undefined : (draft) => setComment({ kind: 'draft', draft })} onOpenThread={(id, rect) => setComment({ kind: 'thread', id, rect })}
            onPresence={(p) => ws.present({ document: item.id, page: null, ...p })}
            media={media.media} onUpload={media.onUpload} onPick={media.onPick} onAttachMedia={media.onAttachMedia}
            onTitle={(title) => ws.actions.titled(item.id, title)} onToast={toast}
            onCopyBlockLink={(id) => ws.actions.copyLink(item.id, id)}
            moveTargets={() => others.map((d) => ({ id: d.id, name: nameOf(d) }))} onMoveBlock={moveBlock} blockDrop={blockDrop} onAsk={readOnly ? undefined : alcove.onAsk}
            byline={item.by ? <WsDocBy person={item.by} name={firstName(item.by.name)} edited={`Edited ${agoLabel(item.editedAt, now)}`} /> : undefined}
            whenBlank={readOnly ? undefined : <WsTemplates templates={TEMPLATES} onPick={pick} />} />
        </Suspense>
        {media.popovers}
        {alcove.menu}
      </WsPage>
      {editor && !readOnly && <KeyboardBar editor={editor} />}
      {comment && (
        <Suspense>
          <Comments doc={session.doc} open={comment} onOpen={openComment} self={ws.self} people={byId} canWrite={!readOnly} hidden={ask !== null}
            sections={sections} onTagged={(person, block, rect) => { void onTagged(person, block, rect); }} say={ws.say} />
        </Suspense>
      )}
      {ask && (
        <WsPopover open at={ask.rect} within={askWithin} label={`Share ${nameOf(item)}`} onOpenChange={(to) => { if (!to) notNow(); }}>
          <WsMentionPrompt person={ask.person} document={nameOf(item)} onEdit={() => answer('edit')} onRead={() => answer('read')} onNotNow={notNow} />
        </WsPopover>
      )}
      {named && namedAt && (
        <WsPopover open at={namedAt.at} within={namedAt.within} label={named.person.name} onOpenChange={(to) => { if (!to) setNamed(null); }}>
          <PersonCard person={named.person} onDone={() => setNamed(null)} />
        </WsPopover>
      )}
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
  return <WsDocHead crumbs={crumbsOf(ws, item)} save="quiet" onToggleList={ws.toggleList} />;
}

const crumbsOf = (ws: Ws, item: WorkspaceItem) => [...(ws.sent.name === null ? [] : [ws.spaceName]), ...foldersAbove(ws.tree, item.id).map((f) => folderName(f, ws.callFolder)), nameOf(item)];

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
  /** Whose face on the head was pressed. */
  const [card, setCard] = useState<string | null>(null);
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
  const rescue = stuck ? <Rescue session={session} say={ws.say} copyTo={copyTo} gone={gone} onLetGo={reopen} /> : null;

  useOpensAgain(status, ready, reopen);
  const history = useHistory(ws, item, session, item.role === 'edit' && !trashed && !offline && status.role !== 'read');

  useBackOnline(ws, session, offline, status, online);
  useTriesWhenShown(ws, session);

  if (gone) {
    return (
      <WsDoc>
        <WsDocHead crumbs={ws.sent.name === null ? [] : [ws.spaceName]} save="quiet" onToggleList={ws.toggleList} />
        <WsCantOpen what="document" unsent={rescue !== null}
          action={rescue ?? <Button size="sm" onClick={() => ws.go({ kind: 'home' }, { replace: true })}>Back to {ws.spaceName}</Button>} />
      </WsDoc>
    );
  }

  const close = () => setMore(null);
  const morePop: WsPop = {
    open: more !== null, onOpenChange: (to) => setMore(to ? 'menu' : null),
    content: more === 'move' ? (
      <WsMovePicker name={nameOf(item)} space={ws.spaceName} folders={foldersFor(ws.tree, item.id, ws.callFolder)}
        onRoot={() => { close(); ws.actions.move(item.id, { parent: null }); }} onFolder={(id) => { close(); ws.actions.move(item.id, { parent: id }); }} />
    ) : (
      <WsDocMenu onShare={canShare ? () => { close(); setShare(true); } : undefined}
        onHistory={() => { close(); history.show(); }}
        onDuplicate={changing ? () => { close(); ws.actions.duplicate(item.id); } : undefined}
        onMove={changing ? () => setMore('move') : undefined}
        onCopyLink={() => { close(); ws.actions.copyLink(item.id); }}
        onTrash={changing ? () => { close(); ws.actions.trash(item.id); } : undefined} />
    )
  };
  const who = item.trashedBy ? firstName(item.trashedBy) : 'Someone';
  const faces = facesIn(ws.here, item.id).map((person): WsFace => ({
    person, card: { open: card === person.id, onOpenChange: (to) => setCard(to ? person.id : null), content: card === person.id ? <PersonCard person={person} onDone={() => setCard(null)} /> : null }
  }));
  /* Scrolling or pressing the page stops following: you stay where you are. */
  const stayHere = () => ws.stopFollowing();
  const save: WsSave = status.closed === 'unavailable' || offline ? 'offline' : status.closed === 'session' ? (status.unsent ? 'failed' : 'quiet') : ready ? status.status : 'quiet';
  /* Who to ask to edit: whoever made it, if anyone's known to have. */
  const askToEdit = item.by ? firstName(item.by.name) : 'whoever shared it';
  return (
    <>
    <WsDoc>
      <WsDocHead crumbs={crumbsOf(ws, item)} save={save} onToggleList={ws.toggleList} faces={faces}
        share={canShare ? { open: share, onOpenChange: setShare, content: <ShareSheet item={item} /> } : undefined} more={morePop} />
      <WsFollowBar following={ws.following?.quiet ? null : ws.following} onStop={() => ws.stopFollowing()} />
      <WsOfflineBar show={offline && ready && status.closed === null} online={online} onTry={session.retry} />
      <WsUnsavedBar why={unsaved} saveable={copyTo !== undefined}>{rescue}</WsUnsavedBar>
      <WsGoneBar who={trashed ? who : null} onRestore={item.role === 'edit' ? () => ws.actions.restore(item.id) : undefined} unsent={status.unsent} />
      <WsReadOnlyBar show={!trashed && unsaved !== 'read-only' && (item.role !== 'edit' || status.role === 'read' || status.refused === 'read-only')} organizer={askToEdit} />
      <WsVersionBar when={history.reading} />
      {/* The page stays open behind a version: nothing's typed into it, and it's as it was on coming back. */}
      {ready
        ? <WsScroll hidden={history.reading !== null} inert={history.reading !== null} onWheel={stayHere} onTouchMove={stayHere} onPointerDown={stayHere}><Page key={opened.round} ws={ws} item={item} session={session} status={status} /></WsScroll>
        : status.closed === 'unavailable' ? <WsUnavailable /> : offline && <WsOfflineEmpty online={online} onTry={session.retry} />}
      {history.page}
    </WsDoc>
    {history.panel}
    </>
  );
}
