/*
 * A document's photos, videos and files. `useMediaView` is what their blocks draw from wherever the document's shown: its
 * page, in the Drive or in a call's workspace, and a version of it in History. The page also adds files by dropping, pasting
 * or choosing them, reuses what's already in the workspace, and deletes one for good (`useDocumentMedia`). Pictures are read
 * through the workspace's `Pictures`, uploads go through `uploads.ts`, the list of what's in the workspace comes from
 * `media.list`, and Play for everyone from the call (`playing.ts`).
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
import { asFile, canAddAsFile, canRetry, discard, FRAME_SUFFIX, isSending, pageTurnedAway, prepare, previewOf, retry, start, stemOf, uploadsStore } from './uploads';

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
/** A video's first frame, stored as a picture of its own: it's the video's, not a photo to offer. */
const isFrame = (m: WorkspaceMedia) => isPicture(m) && m.name.endsWith(FRAME_SUFFIX);
const isVideo = (m: WorkspaceMedia) => m.type.startsWith('video/');
const ACCEPT: Record<MediaPick['kind'], string> = { photo: 'image/*', video: 'video/*', file: '' };

/** What a photo used again here is captioned already: the caption it has elsewhere in this document, and who that tags. */
type CaptionOf = EditorHandle['captionOf'];

/**
 * A block made of files already stored: what reusing them puts on the page. A photo keeps the caption it already has in this
 * document, tags and all, and otherwise starts with none: its file's name isn't a caption.
 */
function blockOf(kind: MediaPick['kind'], chosen: readonly WorkspaceMedia[], captionOf: CaptionOf | undefined): BlockJSON | null {
  const first = chosen[0];
  if (!first) return null;
  if (kind === 'photo') {
    const captions = Object.fromEntries(chosen.flatMap((m) => {
      const had = captionOf?.(m.id);
      return had ? [[`cap:${m.id}`, had.cap], ...(had.tags.length ? [[`tags:${m.id}`, had.tags]] : [])] : [];
    }));
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
interface Changes { bump: () => void; subscribe: (listener: () => void) => () => void; getSnapshot: () => number }
function useChanges(): Changes {
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

/**
 * Pictures the picker offers, each by its small picture, read through a document that has it: never the whole photo, which
 * a photo from before previews is read as once, and made small. Each is named by its caption here, if it has one.
 */
function ReusePhotos({ pictures, photos, heading, captionOf, onChoose, onPick }: {
  pictures: Pictures; photos: readonly WorkspaceMedia[]; heading: string; captionOf: EditorHandle['captionOf'] | undefined; onChoose: () => void; onPick: (chosen: WorkspaceMedia[]) => void;
}) {
  useSyncExternalStore(pictures.subscribe, pictures.getSnapshot, pictures.getSnapshot);
  const shown: WsPhoto[] = photos.map((m) => ({ id: m.id, label: captionOf?.(m.id)?.cap ?? stemOf(m.name), src: m.documents[0] ? pictures.small(m.documents[0], m.id, m.width && m.height ? { width: m.width, height: m.height } : null) : undefined }));
  return (
    <WsUploadPicker heading={heading} photos={shown} onChoose={onChoose}
      onPhoto={(id) => { const m = photos.find((p) => p.id === id); if (m) onPick([m]); }} onAll={() => onPick([...photos])} />
  );
}

/** Play for everyone, and what's playing, from the call (`useVideoHandlers`): nothing outside one. */
export type VideoHandlers = Pick<MediaHandlers, 'onPlay' | 'playing'>;

/**
 * What a document's photos, videos and files draw from, for anything that shows the document without adding to it: pictures,
 * whether a file's still there, where a player reads a video, and opening a file. With `video`, Play for everyone too.
 */
export function useMediaView(ws: Ws, documentId: string, video?: VideoHandlers | undefined): { media: MediaHandlers; bumps: Changes; list: WorkspaceMedia[] | undefined } {
  const { workspaceId, pass, pictures } = ws;
  const qc = useQueryClient();
  const listed = useQuery(q.workspaceMedia(workspaceId, pass));
  const bumps = useChanges();
  const now = useRef({ list: listed.data, listedAt: listed.dataUpdatedAt, say: ws.say });
  now.current = { list: listed.data, listedAt: listed.dataUpdatedAt, say: ws.say };
  useEffect(() => pictures.subscribe(bumps.bump), [pictures, bumps]);
  useEffect(() => { bumps.bump(); }, [listed.dataUpdatedAt, bumps]);

  /* When each file block's file was first seen here, so a list read before it can't say it's gone. */
  const noticed = useRef(new Map<string, number>());
  const relisted = useRef(0);
  const relist = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (relist.current) clearTimeout(relist.current); }, []);

  const view = useMemo<MediaHandlers>(() => ({
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
    stream: (media) => fileUrl(workspaceId, documentId, media, pass).catch((e: unknown) => {
      if (errorCode(e) === 'not-found') pictures.goneFrom(documentId, media);
      throw e;
    }),
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
    }
  }), [pictures, documentId, workspaceId, pass, bumps, qc]);
  const onPlay = video?.onPlay, playing = video?.playing;
  const media = useMemo<MediaHandlers>(() => (onPlay || playing ? { ...view, onPlay, playing } : view), [view, onPlay, playing]);
  return { media, bumps, list: listed.data };
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

/** Everything a document's page does with its files. `video`: Play for everyone, in a call. */
export function useDocumentMedia(ws: Ws, documentId: string, { session, editor, readOnly, video }: {
  session: DocSession; editor: EditorHandle | null; readOnly: boolean; video?: VideoHandlers | undefined;
}): DocumentMedia {
  const { workspaceId, pass, pictures } = ws;
  const { media: view, bumps, list: listedNow } = useMediaView(ws, documentId, video);
  const changes = useMediaChanges(workspaceId, pass);
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

  /* Someone here only through a seat in a call works on what's shared with them, and can't delete a file for good: it isn't offered. */
  const seatOnly = pass !== undefined && ws.sent.role === null;
  /* Everything handlers read that changes over time, for handlers that keep one identity. */
  const now = useRef({ editor, readOnly, say: ws.say, owner: ws.owner });
  now.current = { editor, readOnly, say: ws.say, owner: ws.owner };

  useEffect(() => uploadsStore.subscribe(bumps.bump), [bumps]);
  useEffect(() => {
    const heard = () => bumps.bump();
    session.awareness.on('change', heard);
    return () => { session.awareness.off('change', heard); };
  }, [session, bumps]);
  /* A page Alcove turned away can't get a block to it: nothing waits for one put in here meanwhile. */
  useEffect(() => {
    const look = () => pageTurnedAway(workspaceId, documentId, session.getSnapshot().refused !== null);
    look();
    const stop = session.subscribe(look);
    return () => { stop(); pageTurnedAway(workspaceId, documentId, false); };
  }, [session, workspaceId, documentId]);

  /* Blocks that say they're uploading, from when nobody here or anywhere else was heard sending them. */
  const unclaimed = useRef(new Map<string, number>());

  const attach = (media: string, to = documentId): Promise<void> => {
    const done = changes.attach.mutateAsync({ documentId: to, media });
    pictures.attachingTo(to, media, done);
    return done;
  };

  const handlers = useMemo<MediaHandlers>(() => ({
    ...view,
    preview: (key, index) => previewOf(key, index),
    stalled: (key) => {
      if (isSending(key)) { unclaimed.current.delete(key); return false; }
      for (const state of session.awareness.getStates().values()) {
        const said = DocUploadsStateSchema.safeParse(state);
        if (said.success && said.data.uploading?.includes(key)) { unclaimed.current.delete(key); return false; }
      }
      const since = unclaimed.current.get(key);
      if (since === undefined) {
        unclaimed.current.set(key, Date.now());
        setTimeout(bumps.bump, NOBODY_MS + 50);
        return false;
      }
      return Date.now() - since >= NOBODY_MS;
    },
    onRetry: (key) => retry(key),
    canRetry: (key) => canRetry(key),
    canAddAsFile: (key) => canAddAsFile(key),
    onAsFile: (key, block) => {
      const file = now.current.readOnly ? null : asFile(key);
      if (file) sending.current([file], { replace: block }, false, true).catch((err: unknown) => { mlog.warn('a file couldn’t be added', { workspaceId, documentId, err }); });
    },
    onDuration: (block, seconds) => { if (!now.current.readOnly) now.current.editor?.updateBlock(block, { dur: seconds }); },
    onChoose: (block, rect) => { if (!now.current.readOnly) setPicking({ kind: 'photo', at: { replace: block }, anchor: block, rect }); },
    onDeleteFiles: seatOnly ? undefined : (files) => { if (!now.current.readOnly) setDeleting(files); }
  }), [view, session, bumps, seatOnly]);

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
    if (fromPicker) page.insertBlocks([...blocks, LINE], at, { focus: true });
    else page.insertBlocks(blocks, at);
    start({ workspaceId, documentId, owner: now.current.owner, pass }, drafts);
  };
  const sending = useRef(upload);
  sending.current = upload;

  /** Files already in the workspace, put where the picker was: attached to this document first, so nobody here gets `not-found`. */
  const reuse = async (pick: Picking, chosen: readonly WorkspaceMedia[]) => {
    setPicking(null);
    const block = blockOf(pick.kind, chosen, now.current.editor?.captionOf);
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

  const list = listedNow ?? [];
  /* The newest few, in the order they came, so Add all keeps them as they were added. */
  const offered = (kind: MediaPick['kind']) => list.filter((m) => m.documents.length > 0 && !isFrame(m) && (kind === 'photo' ? isPicture(m) : kind === 'video' ? isVideo(m) : !isPicture(m) && !isVideo(m))).slice(0, REUSE).reverse();
  const anchorOf = (p: { anchor: string | null; rect: Rect | null }) => () => blockRect(p.anchor) ?? (p.rect ? toDOMRect(p.rect) : new DOMRect(innerWidth / 2, innerHeight / 3, 1, 1));
  const heading = ws.spaceName;

  const pickerFor = (pick: Picking) => {
    const reusable = offered(pick.kind);
    if (pick.kind === 'photo') return <ReusePhotos pictures={pictures} photos={reusable} heading={heading} captionOf={now.current.editor?.captionOf} onChoose={() => choose(pick)} onPick={(m) => { void reuse(pick, m); }} />;
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
