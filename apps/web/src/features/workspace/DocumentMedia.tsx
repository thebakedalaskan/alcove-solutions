/*
 * A document's photos, videos and files, as its page has them: what their blocks draw from, adding files by dropping,
 * pasting or choosing them, reusing what's already in the workspace, opening and playing them, and deleting one for good.
 * Pictures are read through the workspace's `Pictures`, uploads go through `uploads.ts`, and the list of what's in the
 * workspace comes from `media.list`.
 */
import { DocUploadsStateSchema, FILE_TYPE, errorCode, errorMessage, type DocSession, type WorkspaceMedia } from '@alcove/api';
import { WsDeleteFileAsk, WsPopover, WsUploadPicker, wsToast, type WsPhoto, type WsStoredFile } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react';
import { log } from '~/lib/log';
import { q, qk, useMediaChanges } from '~/lib/queries';
import type { Ws } from './context';
import type { BlockJSON, EditorHandle, EditorProps, InsertAt, MediaDeletion, MediaHandlers, MediaPick, Rect } from './editor/types';
import { fileUrl, type Pictures } from './pictures';
import { canRetry, discard, isSending, prepare, previewOf, retry, showing, start, stemOf, uploadsStore } from './uploads';

const mlog = log.child({ component: 'workspace-media' });

/** How long a block that says it's uploading waits to hear someone's sending it, before it shows as failed. Awareness renews every 15 s. */
const NOBODY_MS = 20_000;
/** About how tall the picker is, with the space around it. */
const PICKER_ROOM = 300;
/** How many photos, videos or files the picker offers to reuse. */
const REUSE = 6;
/** The list of files is read again at most this often to find out whether a file block's file was deleted. */
const RELIST_MS = 10_000;

/** What `/` picked and is choosing for: where it'll go, and what the picker sits against. */
interface Picking { kind: MediaPick['kind']; at: InsertAt; anchor: string | null; rect: Rect | null }

/** The line the caret goes on to, under what the picker adds. */
const LINE: BlockJSON = { type: 'line' };
const sizeLabel = (bytes: number): string => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const isPicture = (m: WorkspaceMedia) => m.type.startsWith('image/');
const isVideo = (m: WorkspaceMedia) => m.type.startsWith('video/');
const ACCEPT: Record<MediaPick['kind'], string> = { photo: 'image/*', video: 'video/*', file: '' };

/** A block made of files already stored: what reusing them puts on the page, with a caption to start from. */
function blockOf(kind: MediaPick['kind'], chosen: readonly WorkspaceMedia[]): BlockJSON | null {
  const first = chosen[0];
  if (!first) return null;
  if (kind === 'photo') {
    const captions = Object.fromEntries(chosen.map((m) => [`cap:${m.id}`, stemOf(m.name)]));
    return { type: 'gallery', attrs: { items: chosen.map((m) => ({ media: m.id, name: m.name, width: m.width, height: m.height })), ...captions } };
  }
  if (kind === 'video') return { type: 'video', attrs: { media: first.id, title: stemOf(first.name), width: first.width, height: first.height } };
  return { type: 'file', attrs: { media: first.id, name: first.name, size: first.size } };
}

/** The element a block is on the page, to sit something against. */
const blockRect = (id: string | null): DOMRect | null => (id ? document.querySelector(`.wb[data-b="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null : null);
const toDOMRect = (r: Rect) => new DOMRect(r.left, r.top, r.width, r.height);
/** The line something goes in place of, or under. */
const lineOf = (at: InsertAt): string | null => (typeof at === 'string' ? null : 'replace' in at ? at.replace : 'after' in at ? at.after : at.before);

/** Counts changes from everything the media handlers read from, for the blocks to draw again. */
function useChanges() {
  return useMemo(() => {
    let n = 0;
    const listeners = new Set<() => void>();
    return {
      bump: () => { n += 1; for (const l of listeners) l(); },
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
      getSnapshot: () => n
    };
  }, []);
}

/** Pictures the picker offers, read for as long as it's open, through a document that has each. */
function ReusePhotos({ pictures, photos, heading, onChoose, onPick }: {
  pictures: Pictures; photos: readonly WorkspaceMedia[]; heading: string; onChoose: () => void; onPick: (chosen: WorkspaceMedia[]) => void;
}) {
  useSyncExternalStore(pictures.subscribe, pictures.getSnapshot, pictures.getSnapshot);
  useEffect(() => {
    const letGo = photos.flatMap((m) => { const through = m.documents[0]; return through ? [pictures.hold(through, m.id)] : []; });
    return () => { for (const l of letGo) l(); };
  }, [pictures, photos]);
  const shown: WsPhoto[] = photos.map((m) => ({ id: m.id, label: stemOf(m.name), src: m.documents[0] ? pictures.url(m.documents[0], m.id) : undefined }));
  return (
    <WsUploadPicker heading={heading} photos={shown} onChoose={onChoose}
      onPhoto={(id) => { const m = photos.find((p) => p.id === id); if (m) onPick([m]); }} onAll={() => onPick([...photos])} />
  );
}

export interface DocumentMedia {
  media: MediaHandlers;
  onUpload: EditorProps['onUpload'];
  onPick: EditorProps['onPick'];
  onAttachMedia: EditorProps['onAttachMedia'];
  /** The picker, the question Delete for good asks, and the field files are chosen with. */
  popovers: ReactNode;
  /** Attaches files to another document a block is on its way to, before it lands there. */
  attachTo: (documentId: string, media: readonly string[]) => Promise<void>;
}

export function useDocumentMedia(ws: Ws, documentId: string, { session, editor, readOnly }: { session: DocSession; editor: EditorHandle | null; readOnly: boolean }): DocumentMedia {
  const { workspaceId, pass, pictures } = ws;
  const qc = useQueryClient();
  const listed = useQuery(q.workspaceMedia(workspaceId, pass));
  const changes = useMediaChanges(workspaceId, pass);
  const bumps = useChanges();
  const [picking, setPickingNow] = useState<Picking | null>(null);
  /* The picker opens under what it's for: if that's too near the foot of the page, the page brings it up first. */
  const setPicking = (next: Picking | null) => {
    setPickingNow(next);
    const rect = next ? blockRect(next.anchor) : null;
    if (next?.anchor && rect && rect.bottom + PICKER_ROOM > innerHeight) now.current.editor?.scrollToBlock(next.anchor, { smooth: true });
  };
  const [deleting, setDeleting] = useState<MediaDeletion | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const choosingFor = useRef<Picking | null>(null);

  /* Everything handlers read that changes over time, for handlers that keep one identity. */
  const now = useRef({ editor, readOnly, list: listed.data, listedAt: listed.dataUpdatedAt, say: ws.say, owner: ws.owner });
  now.current = { editor, readOnly, list: listed.data, listedAt: listed.dataUpdatedAt, say: ws.say, owner: ws.owner };

  /* The page has this document open here: uploads into it write through its session, and say so in its awareness. */
  useEffect(() => showing(workspaceId, documentId, { doc: session.doc, awareness: session.awareness }), [workspaceId, documentId, session]);
  useEffect(() => pictures.subscribe(bumps.bump), [pictures, bumps]);
  useEffect(() => uploadsStore.subscribe(bumps.bump), [bumps]);
  useEffect(() => {
    const heard = () => bumps.bump();
    session.awareness.on('change', heard);
    return () => { session.awareness.off('change', heard); };
  }, [session, bumps]);
  useEffect(() => { bumps.bump(); }, [listed.dataUpdatedAt, bumps]);

  /* When each file block's file was first seen here, so a list read before it can't say it's gone. */
  const noticed = useRef(new Map<string, number>());
  const relisted = useRef(0);
  const relist = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (relist.current) clearTimeout(relist.current); }, []);
  /* Blocks that say they're uploading, from when nobody here or anywhere else was heard sending them. */
  const unclaimed = useRef(new Map<string, number>());

  const attach = (media: string, to = documentId): Promise<void> => {
    const done = changes.attach.mutateAsync({ documentId: to, media });
    pictures.attachingTo(to, media, done);
    return done;
  };

  const handlers = useMemo<MediaHandlers>(() => ({
    url: (media) => pictures.url(documentId, media),
    state: (media) => pictures.state(documentId, media),
    hold: (media) => pictures.hold(documentId, media),
    changes: { subscribe: bumps.subscribe, getSnapshot: bumps.getSnapshot },
    watch: (media) => {
      if (!noticed.current.has(media)) noticed.current.set(media, Date.now());
      /* The list was read before this file was seen here: read it again, so it can say whether the file's still there. */
      if (now.current.listedAt < (noticed.current.get(media) ?? 0) && !relist.current) {
        const wait = Math.max(500, relisted.current + RELIST_MS - Date.now());
        relist.current = setTimeout(() => {
          relist.current = null;
          relisted.current = Date.now();
          void qc.invalidateQueries({ queryKey: qk.workspaceMedia(workspaceId) });
        }, wait);
      }
      return () => undefined;
    },
    gone: (media) => {
      if (pictures.isGone(documentId, media)) return true;
      const seen = noticed.current.get(media);
      const { list, listedAt } = now.current;
      return list !== undefined && seen !== undefined && listedAt > seen && !list.some((m) => m.id === media && m.documents.includes(documentId));
    },
    preview: (block, index) => previewOf(block, index),
    stalled: (block) => {
      if (isSending(block)) { unclaimed.current.delete(block); return false; }
      for (const state of session.awareness.getStates().values()) {
        const said = DocUploadsStateSchema.safeParse(state);
        if (said.success && said.data.uploading?.includes(block)) { unclaimed.current.delete(block); return false; }
      }
      const since = unclaimed.current.get(block);
      if (since === undefined) {
        unclaimed.current.set(block, Date.now());
        setTimeout(bumps.bump, NOBODY_MS + 50);
        return false;
      }
      return Date.now() - since >= NOBODY_MS;
    },
    onRetry: (block) => retry(block),
    canRetry: (block) => canRetry(block),
    stream: (media) => fileUrl(workspaceId, documentId, media, pass).catch((e: unknown) => {
      if (errorCode(e) === 'not-found') pictures.goneFrom(documentId, media);
      throw e;
    }),
    onDuration: (block, seconds) => { if (!now.current.readOnly) now.current.editor?.updateBlock(block, { dur: seconds }); },
    onOpenFile: ({ media }) => {
      fileUrl(workspaceId, documentId, media, pass).then((url) => {
        const type = now.current.list?.find((m) => m.id === media)?.type;
        /* What's only ever a download downloads, and the page stays. Anything shown in place opens beside it. */
        if (type === FILE_TYPE) {
          const a = document.createElement('a');
          a.href = url;
          a.rel = 'noopener';
          document.body.append(a);
          a.click();
          a.remove();
        } else window.open(url, '_blank', 'noopener');
      }, (e: unknown) => {
        if (errorCode(e) === 'not-found') pictures.goneFrom(documentId, media);
        else now.current.say(wsToast.failed(errorMessage(e)));
      });
    },
    onChoose: (block, rect) => { if (!now.current.readOnly) setPicking({ kind: 'photo', at: { replace: block }, anchor: block, rect }); },
    onDeleteFiles: (files) => { if (!now.current.readOnly) setDeleting(files); }
  }), [pictures, documentId, workspaceId, pass, session, bumps, qc]);

  /**
   * Files from the desktop, the clipboard or the picker: their blocks hold the space at once, and they go. What the picker
   * adds has a line after it with the caret in it, as everything `/` adds that isn't text does.
   */
  const upload = async (files: readonly File[], at: InsertAt, fromPicker = false, asFiles = false) => {
    if (files.length === 0 || now.current.readOnly) return;
    const drafts = await prepare(files, asFiles);
    const page = now.current.editor;
    if (!page || now.current.readOnly) { discard(drafts); return; }
    const blocks = drafts.map((d) => d.block);
    const ids = fromPicker ? page.insertBlocks([...blocks, LINE], at, { focus: true }) : page.insertBlocks(blocks, at);
    start({ workspaceId, documentId, owner: now.current.owner, pass }, drafts, ids);
  };

  /** Files already in the workspace, put where the picker was: attached to this document first, so nobody here gets `not-found`. */
  const reuse = async (pick: Picking, chosen: readonly WorkspaceMedia[]) => {
    setPicking(null);
    const block = blockOf(pick.kind, chosen);
    if (!block) return;
    try {
      await Promise.all(chosen.filter((m) => !m.documents.includes(documentId)).map((m) => attach(m.id)));
    } catch (e) {
      mlog.warn('a file couldn’t be reused here', { workspaceId, documentId, err: e });
      now.current.say(wsToast.failed(errorMessage(e)));
      return;
    }
    now.current.editor?.insertBlocks([block, LINE], pick.at, { focus: true });
  };

  const choose = (pick: Picking) => {
    const input = field.current;
    if (!input) return;
    choosingFor.current = pick;
    input.accept = ACCEPT[pick.kind];
    input.value = '';
    setPicking(null);
    input.click();
  };
  const chosen = (e: ChangeEvent<HTMLInputElement>) => {
    const pick = choosingFor.current;
    const files = [...(e.currentTarget.files ?? [])];
    choosingFor.current = null;
    if (pick) upload(files, pick.at, true, pick.kind === 'file').catch((err: unknown) => { mlog.warn('files couldn’t be added', { workspaceId, documentId, err }); });
  };

  /** Delete for good: every file in the block, from every document that has it, then the block. */
  const deleteForGood = async (d: MediaDeletion) => {
    setDeleting(null);
    try {
      for (const media of d.media) {
        await changes.remove.mutateAsync({ documentId, media });
        pictures.forget(media);
      }
      now.current.editor?.removeBlock(d.block);
      now.current.say(wsToast.deleted(d.what === 'photos' ? `${d.media.length} photos` : d.name));
    } catch (e) {
      /* The server's words: "This file is also in a document you can't edit." */
      mlog.info('a file wasn’t deleted', { workspaceId, documentId, code: errorCode(e) });
      now.current.say(wsToast.failed(errorMessage(e)));
    }
  };

  const list = listed.data ?? [];
  /* The newest few, in the order they came, so Add all keeps them as they were added. */
  const offered = (kind: MediaPick['kind']) => list.filter((m) => m.documents.length > 0 && (kind === 'photo' ? isPicture(m) : kind === 'video' ? isVideo(m) : !isPicture(m) && !isVideo(m))).slice(0, REUSE).reverse();
  const anchorOf = (p: { anchor: string | null; rect: Rect | null }) => () => blockRect(p.anchor) ?? (p.rect ? toDOMRect(p.rect) : new DOMRect(innerWidth / 2, innerHeight / 3, 1, 1));
  const heading = ws.spaceName;

  const pickerFor = (pick: Picking) => {
    const reusable = offered(pick.kind);
    if (pick.kind === 'photo') return <ReusePhotos pictures={pictures} photos={reusable} heading={heading} onChoose={() => choose(pick)} onPick={(m) => { void reuse(pick, m); }} />;
    const files: WsStoredFile[] = reusable.map((m) => ({ id: m.id, name: m.name, sub: sizeLabel(m.size), icon: pick.kind === 'video' ? 'film' : 'clip' }));
    return <WsUploadPicker heading={heading} files={files} onChoose={() => choose(pick)} onFile={(id) => { const m = reusable.find((x) => x.id === id); if (m) void reuse(pick, [m]); }} />;
  };

  const popovers = (
    <>
      <input ref={field} type="file" multiple hidden onChange={chosen} aria-label="Choose files to add" />
      {picking && (
        <WsPopover open onOpenChange={(open) => { if (!open) setPicking(null); }} at={anchorOf(picking)} label={picking.kind === 'photo' ? 'Photos' : picking.kind === 'video' ? 'Video' : 'File'}>
          {pickerFor(picking)}
        </WsPopover>
      )}
      {deleting && (
        <WsPopover open onOpenChange={(open) => { if (!open) setDeleting(null); }} at={anchorOf({ anchor: deleting.block, rect: deleting.rect })} label={`Delete ${deleting.name} for good`}>
          <WsDeleteFileAsk name={deleting.name} onDelete={() => { void deleteForGood(deleting); }} onKeep={() => setDeleting(null)} />
        </WsPopover>
      )}
    </>
  );

  return {
    media: handlers,
    onUpload: readOnly ? undefined : (files, at) => { upload(files, at).catch((err: unknown) => { mlog.warn('files couldn’t be added', { workspaceId, documentId, err }); }); },
    onPick: readOnly ? undefined : (pick) => {
      setPicking({ kind: pick.kind, at: pick.at, anchor: pick.block ?? lineOf(pick.at), rect: pick.rect });
    },
    onAttachMedia: readOnly ? undefined : (media) => {
      attach(media).catch((e: unknown) => { mlog.info('a pasted file couldn’t be attached here', { workspaceId, documentId, code: errorCode(e) }); now.current.say(wsToast.failed(errorMessage(e))); });
    },
    popovers,
    attachTo: async (to, media) => { await Promise.all(media.map((m) => attach(m, to))); }
  };
}
