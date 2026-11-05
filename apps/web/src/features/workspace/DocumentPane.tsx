/*
 * A document beside the list: its head, the bars that say how things stand, and the editor, which loads when a document
 * first opens and mounts once the document's first sync is in. Someone who loses a document mid-sentence is told so in place.
 */
import { errorMessage, firstName, type DocSession, type DocStatus, type Person, type WorkspaceItem } from '@alcove/api';
import { WsCantOpen, WsDoc, WsDocBy, WsDocHead, WsDocMenu, WsFade, WsFollowBar, WsFullBar, WsGoneBar, WsMentionPrompt, WsMovePicker, WsOfflineBar, WsOfflineEmpty, WsPage, WsPresentPreview, WsPopover, WsReadOnlyBar, WsScroll, WsTemplates, Button, wsToast, type WsFace, type WsPop } from '@alcove/ui';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLive, useNow, useOnline } from '~/lib/live';
import { log } from '~/lib/log';
import { agoLabel } from '~/lib/time';
import { focusRow } from './actions';
import type { CommentOpen } from './Comments';
import { useWs, type Ws } from './context';
import { Editor } from './editor/lazy';
import { TEMPLATES } from './editor/templates';
import type { DocSection } from './editor/sections';
import type { BlockDropTarget, EditorHandle, EditorProps, EditorToast, MovingBlock, Point, Rect } from './editor/types';
import { PersonCard } from './People';
import { facesIn } from './presence';
import { useVideoHandlers } from './playing';
import { presentingStrip } from './Presentation';
import { openDocument, withDocument } from './session';
import { ShareSheet } from './Sheets';
import { tagRect, useTags } from './tags';
import { documentsIn, foldersAbove, foldersFor, nameFrom, nameOf } from './tree';

const Comments = lazy(() => import('./Comments'));

const dlog = log.child({ component: 'workspace' });

/** A session for one document, once its first sync is in. `refused`: it wouldn't open at all. */
function useSession(ws: Ws, documentId: string) {
  const { workspaceId, pass, owner } = ws;
  const [opened, setOpened] = useState<{ session: DocSession; ready: boolean; refused: boolean } | null>(null);
  useEffect(() => {
    let left = false;
    let held: DocSession | null = null;
    const open = () => {
      openDocument(workspaceId, documentId, owner, pass).then((session) => {
        if (left) { session.close(); return; }
        held = session;
        setOpened({ session, ready: false, refused: false });
        session.ready.then(
          () => { if (!left) setOpened({ session, ready: true, refused: false }); },
          () => { if (!left) setOpened({ session, ready: false, refused: true }); }
        );
      }, (e: unknown) => {
        dlog.warn('a document didn’t open', { workspaceId, documentId, err: e });
        addEventListener('online', open, { once: true });
      });
    };
    open();
    return () => { left = true; removeEventListener('online', open); held?.close(); };
  }, [workspaceId, documentId, pass, owner]);
  return opened;
}

function Page({ ws, item, session, status, onSections }: { ws: Ws; item: WorkspaceItem; session: DocSession; status: DocStatus; onSections: (sections: readonly DocSection[]) => void }) {
  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const now = useNow(60_000);
  const { sections, faces: tagged, tagged: onTagged, ask, answer, notNow } = useTags(ws, item, now);
  /* Whose face goes on a caret, a tag or a comment: people here last, who may know more about themselves than the list does. */
  const faces = useMemo(() => [...tagged, ...ws.here.map((h) => h.person)], [tagged, ws.here]);
  const byId = useMemo(() => new Map(faces.map((p) => [p.id, p])), [faces]);
  const [comment, setComment] = useState<CommentOpen | null>(null);
  const [named, setNamed] = useState<{ person: Person; rect: Rect } | null>(null);
  const readOnly = item.role !== 'edit' || item.trashedAt !== null || status.trashed || status.role === 'read' || status.refused === 'read-only' || status.refused === 'trashed';
  const media = useVideoHandlers(ws, item.id, true);
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
  const openPerson: EditorProps['onOpenPerson'] = (id, rect) => {
    const person = ws.others.find((o) => o.person.id === id)?.person;
    if (person) setNamed({ person, rect });
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
          <Editor ref={setEditor} doc={session.doc} awareness={session.awareness} readOnly={readOnly} titleHint={item.name} people={faces}
            autoFocus={madeHere.current && !readOnly ? 'title' : undefined}
            onMention={sections} documentName={documentName} onOpenDocument={(id) => ws.go({ kind: 'document', id })}
            onOpenPerson={openPerson} onTagged={(person, block, rect) => { void onTagged(person, block, tagRect(person.id, block, rect)); }}
            onComment={readOnly || !ws.self ? undefined : (draft) => setComment({ kind: 'draft', draft })} onOpenThread={(id, rect) => setComment({ kind: 'thread', id, rect })}
            onPresence={(p) => ws.present({ document: item.id, ...p })}
            onTitle={(title) => ws.actions.titled(item.id, title)} onToast={toast} onSections={onSections} media={media}
            onCopyBlockLink={(id) => ws.actions.copyLink(item.id, id)}
            moveTargets={() => others.map((d) => ({ id: d.id, name: nameOf(d) }))} onMoveBlock={moveBlock} blockDrop={blockDrop}
            byline={item.by ? <WsDocBy person={item.by} name={firstName(item.by.name)} edited={`Edited ${agoLabel(item.editedAt, now)}`} /> : undefined}
            whenBlank={readOnly ? undefined : <WsTemplates templates={TEMPLATES} onPick={pick} />} />
        </Suspense>
      </WsPage>
      {comment && (
        <Suspense>
          <Comments doc={session.doc} open={comment} onOpen={openComment} self={ws.self} people={byId} canWrite={!readOnly} hidden={ask !== null}
            sections={sections} onTagged={(person, block, rect) => { void onTagged(person, block, rect); }} say={ws.say} />
        </Suspense>
      )}
      {ask && (
        <WsPopover open at={ask.rect} label={`Share ${nameOf(item)}`} onOpenChange={(to) => { if (!to) notNow(); }}>
          <WsMentionPrompt person={ask.person} document={nameOf(item)} onEdit={() => answer('edit')} onRead={() => answer('read')} onNotNow={notNow} />
        </WsPopover>
      )}
      {named && (
        <WsPopover open at={() => new DOMRect(named.rect.left, named.rect.top, named.rect.width, named.rect.height)} label={named.person.name} onOpenChange={(to) => { if (!to) setNamed(null); }}>
          <PersonCard person={named.person} onDone={() => setNamed(null)} />
        </WsPopover>
      )}
    </WsFade>
  );
}

export function DocumentPane({ item }: { item: WorkspaceItem }) {
  const ws = useWs();
  const opened = useSession(ws, item.id);
  const online = useOnline();
  if (!opened) return <WsDoc><Blank ws={ws} item={item} />{!online && <WsOfflineEmpty />}</WsDoc>;
  return <Opened ws={ws} item={item} opened={opened} />;
}

/** The head with nothing to do yet. */
function Blank({ ws, item }: { ws: Ws; item: WorkspaceItem }) {
  return presentingStrip(ws.call?.presenting) ?? <WsDocHead crumbs={crumbsOf(ws, item)} save="quiet" onToggleList={ws.toggleList} zen={ws.call?.zen?.on} onZen={ws.call?.zen?.onToggle} />;
}

const crumbsOf = (ws: Ws, item: WorkspaceItem) => [...(ws.sent.name === null ? [] : [ws.spaceName]), ...foldersAbove(ws.tree, item.id).map(nameOf), nameOf(item)];

function Opened({ ws, item, opened }: { ws: Ws; item: WorkspaceItem; opened: { session: DocSession; ready: boolean; refused: boolean } }) {
  const { session, ready, refused } = opened;
  const status = useLive(session);
  const [more, setMore] = useState<'menu' | 'move' | null>(null);
  const [share, setShare] = useState(false);
  /** Whose face on the head was pressed. */
  const [card, setCard] = useState<string | null>(null);
  /** Present's preview, and the sections it counts, as the page has them. */
  const [previewing, setPreviewing] = useState(false);
  const [sections, setSections] = useState<readonly DocSection[] | null>(null);
  const member = ws.sent.role !== null;
  const canShare = member && item.role === 'edit';
  const changing = ws.canChange && item.role === 'edit' && item.trashedAt === null;
  const trashed = item.trashedAt !== null || status.trashed || status.refused === 'trashed';
  const closed = status.closed === 'access' || status.closed === 'deleted';
  /* The browser knows before the document's stream does, which only finds out when it next tries to say something. */
  const online = useOnline();
  const offline = status.status === 'offline' || (!online && status.status !== 'failed');

  /* Back from being offline, and everything's in. */
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline) wasOffline.current = true;
    else if (wasOffline.current && status.status === 'saved') { wasOffline.current = false; ws.say(wsToast.backOnline()); }
  }, [offline, status.status, ws.say]);

  if (refused || closed) {
    return (
      <WsDoc>
        {presentingStrip(ws.call?.presenting) ?? <WsDocHead crumbs={ws.sent.name === null ? [] : [ws.spaceName]} save="quiet" onToggleList={ws.toggleList} zen={ws.call?.zen?.on} onZen={ws.call?.zen?.onToggle} />}
        <WsCantOpen what="document" action={<Button size="sm" onClick={() => ws.go({ kind: 'home' }, { replace: true })}>Back to {ws.spaceName}</Button>} />
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
  const faces = facesIn(ws.here, item.id).map((person): WsFace => ({
    person, card: { open: card === person.id, onOpenChange: (to) => setCard(to ? person.id : null), content: card === person.id ? <PersonCard person={person} onDone={() => setCard(null)} /> : null }
  }));
  /* Scrolling or pressing the page stops following: you stay where you are. */
  const stayHere = () => ws.stopFollowing();
  /* Present is at the top of every document in a call, once the page knows its sections. Something in Trash can't be presented. */
  const present = ws.call?.presenting;
  const presentPop: WsPop | undefined = present && sections && ready && !trashed ? {
    open: previewing, onOpenChange: setPreviewing,
    content: <WsPresentPreview name={nameOf(item)} sections={sections.length} onStart={() => { setPreviewing(false); present.start(item.id); }} />
  } : undefined;
  return (
    <WsDoc>
      {presentingStrip(ws.call?.presenting) ?? (
        <WsDocHead crumbs={crumbsOf(ws, item)} save={offline ? 'offline' : ready ? status.status : 'quiet'} onToggleList={ws.toggleList} faces={faces}
          share={canShare ? { open: share, onOpenChange: setShare, content: <ShareSheet item={item} /> } : undefined} present={presentPop} more={morePop}
          zen={ws.call?.zen?.on} onZen={ws.call?.zen?.onToggle} />
      )}
      <WsFollowBar following={ws.following} onStop={() => ws.stopFollowing()} />
      <WsOfflineBar show={offline && ready} />
      <WsFullBar show={status.refused === 'too-large'} />
      <WsGoneBar who={trashed ? who : null} onRestore={item.role === 'edit' ? () => ws.actions.restore(item.id) : undefined} />
      <WsReadOnlyBar show={!trashed && (item.role !== 'edit' || status.role === 'read' || status.refused === 'read-only')} organizer={item.by ? firstName(item.by.name) : 'whoever shared it'} />
      {ready ? <WsScroll onWheel={stayHere} onTouchMove={stayHere} onPointerDown={stayHere}><Page ws={ws} item={item} session={session} status={status} onSections={setSections} /></WsScroll> : offline && <WsOfflineEmpty />}
    </WsDoc>
  );
}
