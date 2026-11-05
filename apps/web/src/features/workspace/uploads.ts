/*
 * Files on their way into documents from this browser (docs: Data and storage › Media). A block holds their space straight
 * away, for everyone, and says how far they've got as they go. Sending them is this browser's alone: it writes to the block
 * by its stable ID, through the page's own session while the document is open here and through a session of its own once
 * it isn't, so leaving the document, or the workspace, doesn't stop it. Everyone else hears that it's going on through the
 * document's awareness, so a block that says it's uploading with nobody sending it shows as failed.
 *
 * Nothing about a file is logged but its IDs, sizes and how it went: never its name.
 */
import { errorCode, errorMessage, servedType, type DocSession, type WorkspaceMedia } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import type { Awareness } from 'y-protocols/awareness';
import type { Doc } from 'yjs';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import type { BlockJSON } from './editor/types';
import { openDocument } from './session';

const ulog = log.child({ component: 'workspace-uploads' });

/** What writes from here are made by, so nobody's undo takes them. */
const ORIGIN = Symbol('upload');
/** At most this many blocks send at once, so a dozen files don't crowd out the document's own traffic. */
const AT_ONCE = 2;
/** Progress is written at most this often: it's in the document, for everyone. */
const PROGRESS_MS = 250;
/** How long a session opened to finish an upload waits for the block to reach it before giving up on the block. */
const ARRIVE_MS = 60_000;
/** A finished upload's own picture stays here this long, so the stored one can come without the picture blinking. */
const AFTER_MS = 60_000;
/** A session opened for uploads closes this long after its last one, once what it wrote has gone. */
const CLOSE_MS = 3_000;
/** What an upload writes on its block, which nobody else does: a stray one on a retired copy of the block comes off again. */
const OWN = ['items', 'up', 'failed', 'media', 'poster'] as const;

type Kind = 'gallery' | 'video' | 'file';

/** One file of a block. A photo this browser can't read is refused before anything of it is sent. */
interface Part { file: File; readable: boolean; width: number | null; height: number | null; stored: WorkspaceMedia | null; sent: number }

/** A block and what it's waiting for, before it's on the page. `failed`: a photo this browser can't read. */
export interface Draft { block: BlockJSON; kind: Kind; parts: Part[]; poster: Part | null; previews: (string | null)[]; failed: boolean }

/** Who's sending, and into what. */
export interface Destination { workspaceId: string; documentId: string; owner: string | null; pass: string | undefined }

interface Job extends Destination {
  id: string;
  kind: Kind;
  parts: Part[];
  poster: Part | null;
  previews: (string | null)[];
  status: 'waiting' | 'running' | 'failed' | 'done';
  stop: AbortController;
  written: number | null;
  wroteAt: number;
  pending: ReturnType<typeof setTimeout> | null;
  /** Its writes, one after another, so progress never lands after what came next. */
  queue: Promise<unknown>;
}

/** A photo this browser can't read: the block says so, and nothing is sent. */
class Unreadable extends Error {}

/* ---------- reading files ---------- */

/** A file's name without what it's typed as: what a photo's caption and a video's title start as. */
export const stemOf = (name: string): string => name.replace(/\.[^./]{1,8}$/, '').trim() || name;

/** A photo's size in pixels, if it's a picture Alcove shows and this browser can read it. */
async function pictureSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!servedType(file.type).startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/** Waits for an element's event, or gives up. */
function once(el: HTMLMediaElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (ok: boolean) => () => {
      clearTimeout(timer);
      el.removeEventListener(event, yes);
      el.removeEventListener('error', no);
      if (ok) resolve(); else reject(new Error(`no ${event}`));
    };
    const yes = settle(true), no = settle(false);
    const timer = setTimeout(no, ms);
    el.addEventListener(event, yes, { once: true });
    el.addEventListener('error', no, { once: true });
  });
}

/** A frame of a video as a picture, no wider than a page needs. */
function frameOf(video: HTMLVideoElement): Promise<Blob | null> {
  const scale = Math.min(1, 1280 / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const g = canvas.getContext('2d');
  if (!g) return Promise.resolve(null);
  g.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.82); });
}

/** What a video is, if this browser can play it: how big, how long, and a frame from near its start. */
async function videoFacts(file: File): Promise<{ width: number; height: number; dur: number; frame: Blob | null } | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.playsInline = true;
  try {
    const meta = once(video, 'loadedmetadata', 15_000);
    video.src = url;
    await meta;
    if (!video.videoWidth || !video.videoHeight) return null;
    const dur = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
    const seeked = once(video, 'seeked', 8_000);
    video.currentTime = Math.min(1, dur > 0 ? dur / 10 : 0);
    const frame = await seeked.then(() => frameOf(video), () => null);
    return { width: video.videoWidth, height: video.videoHeight, dur, frame };
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

const partOf = (file: File, readable = true, width: number | null = null, height: number | null = null): Part => ({ file, readable, width, height, stored: null, sent: 0 });

const fileDraft = (f: File): Draft => ({ block: { type: 'file', attrs: { name: f.name, size: f.size, up: 0 } }, kind: 'file', parts: [partOf(f)], poster: null, previews: [], failed: false });

/**
 * The blocks files make, each holding their space. Photos this browser can read go in one block: one photo full width,
 * several a gallery. A photo it can't read gets a block of its own that says so. A video it can play is a video, and
 * anything else, a video it can't play included, is a file you can open. With `asFiles`, everything is a file.
 */
export async function prepare(files: readonly File[], asFiles = false): Promise<Draft[]> {
  const photos: Part[] = [];
  const unreadable: Draft[] = [];
  const rest: Draft[] = [];
  for (const f of files) {
    if (asFiles) rest.push(fileDraft(f));
    else if (f.type.startsWith('image/')) {
      const size = await pictureSize(f);
      if (size) photos.push(partOf(f, true, size.width, size.height));
      else unreadable.push({ block: { type: 'gallery', attrs: { items: [{ media: null, name: f.name, width: null, height: null }], failed: f.name } }, kind: 'gallery', parts: [partOf(f, false)], poster: null, previews: [null], failed: true });
    } else if (servedType(f.type).startsWith('video/')) {
      const facts = await videoFacts(f);
      if (!facts) { rest.push(fileDraft(f)); continue; }
      const poster = facts.frame ? partOf(new File([facts.frame], `${stemOf(f.name)}.jpg`, { type: 'image/jpeg' })) : null;
      rest.push({
        block: { type: 'video', attrs: { title: stemOf(f.name), dur: facts.dur, width: facts.width, height: facts.height, up: 0 } },
        kind: 'video', parts: [partOf(f, true, facts.width, facts.height)], poster, previews: [facts.frame ? URL.createObjectURL(facts.frame) : null], failed: false
      });
    } else rest.push(fileDraft(f));
  }
  const gallery: Draft[] = photos.length ? [{
    block: { type: 'gallery', attrs: { items: photos.map((p) => ({ media: null, name: p.file.name, width: p.width, height: p.height })), up: 0 } },
    kind: 'gallery', parts: photos, poster: null, previews: photos.map((p) => URL.createObjectURL(p.file)), failed: false
  }] : [];
  return [...gallery, ...unreadable, ...rest];
}

/** Lets go of what drafts that never reached the page were showing. */
export function discard(drafts: readonly Draft[]): void {
  for (const d of drafts) for (const u of d.previews) if (u) URL.revokeObjectURL(u);
}

/* ---------- what's going on, for whoever's showing it ---------- */

const listeners = new Set<() => void>();
let version = 0;
function changed(): void {
  version += 1;
  for (const l of listeners) l();
}
/** Read with `useSyncExternalStore`: it counts every change to what's being sent from here. */
export const uploadsStore = {
  subscribe: (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: (): number => version
};

/** Where a workspace on screen says things, for an upload's failure: an upload outlives the page that started it. */
const talkers = new Map<string, (toast: WsToastData) => void>();
export function talkThrough(workspaceId: string, say: (toast: WsToastData) => void): () => void {
  talkers.set(workspaceId, say);
  return () => { if (talkers.get(workspaceId) === say) talkers.delete(workspaceId); };
}

/** Told whenever a file is stored, so whatever lists a workspace's files reads it again. */
const stored = new Set<(workspaceId: string) => void>();
export function onStored(run: (workspaceId: string) => void): () => void {
  stored.add(run);
  return () => { stored.delete(run); };
}

const jobs = new Map<string, Job>();
const jobsIn = (workspaceId: string, documentId: string) => [...jobs.values()].filter((j) => j.workspaceId === workspaceId && j.documentId === documentId);
const sending = (j: Job) => j.status === 'waiting' || j.status === 'running';

export const isSending = (block: string): boolean => { const j = jobs.get(block); return j !== undefined && sending(j); };
export const canRetry = (block: string): boolean => jobs.get(block)?.status === 'failed';
/** What this browser is sending into a block, at its place in it: the photo, or a video's first frame. */
export const previewOf = (block: string, index: number): string | undefined => jobs.get(block)?.previews[index] ?? undefined;

/* ---------- where writes go ---------- */

interface Writer { doc: Doc; awareness: Awareness }
interface Keeper { session: DocSession; ready: Promise<boolean>; arrived: Set<string>; closing: ReturnType<typeof setTimeout> | null }
const docKey = (workspaceId: string, documentId: string) => `${workspaceId}:${documentId}`;

/** Documents open on a page in this tab: an upload writes through the page's own session while it's there. */
const pages = new Map<string, Writer>();
/** Sessions opened to finish uploads into documents nobody here has open, until their last upload is done. */
const keepers = new Map<string, Promise<Keeper>>();
const keepersOpen = new Map<string, Keeper>();

/** The document a page has open here, for uploads into it. What this returns is called when it closes. */
export function showing(workspaceId: string, documentId: string, writer: Writer): () => void {
  const key = docKey(workspaceId, documentId);
  pages.set(key, writer);
  claim(workspaceId, documentId);
  return () => { if (pages.get(key) === writer) pages.delete(key); };
}

/** Says in the document's awareness which of its blocks this browser is sending, on every session it writes through. */
function claim(workspaceId: string, documentId: string): void {
  const key = docKey(workspaceId, documentId);
  const ids = jobsIn(workspaceId, documentId).filter(sending).map((j) => j.id);
  for (const w of [pages.get(key), keepersOpen.get(key)?.session]) {
    if (!w || w.doc.isDestroyed) continue;
    const was: unknown = w.awareness.getLocalState()?.['uploading'];
    if (Array.isArray(was) ? was.join() !== ids.join() : ids.length > 0) w.awareness.setLocalStateField('uploading', ids);
  }
}

/** A session of its own for a document, to finish uploads into it once nobody here has it open. */
function keeperFor(j: Destination): Promise<Keeper> {
  const key = docKey(j.workspaceId, j.documentId);
  const had = keepers.get(key);
  if (had) return had;
  const opening = openDocument(j.workspaceId, j.documentId, j.owner, j.pass).then((session) => {
    const keeper: Keeper = { session, ready: session.ready.then(() => true, () => false), arrived: new Set(), closing: null };
    keepersOpen.set(key, keeper);
    claim(j.workspaceId, j.documentId);
    return keeper;
  });
  keepers.set(key, opening);
  opening.catch(() => { if (keepers.get(key) === opening) keepers.delete(key); });
  return opening;
}

/** Closes a document's own session once nothing more is going into it. */
function idle(workspaceId: string, documentId: string): void {
  const key = docKey(workspaceId, documentId);
  const keeper = keepersOpen.get(key);
  if (!keeper || jobsIn(workspaceId, documentId).some(sending)) return;
  if (keeper.closing) clearTimeout(keeper.closing);
  keeper.closing = setTimeout(() => {
    if (jobsIn(workspaceId, documentId).some(sending)) return;
    keepersOpen.delete(key);
    keepers.delete(key);
    keeper.session.close();
  }, CLOSE_MS);
}

const ydoc = () => import('./editor/ydoc');
const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Writes to a block, after whatever it was writing before. False: the block's gone. */
function write(job: Job, attrs: Readonly<Record<string, unknown>>): Promise<boolean> {
  const next = job.queue.then(() => writeNow(job, attrs));
  job.queue = next.catch(() => undefined);
  return next;
}

/** Writes to a block, through the page if the document's open here and through a session of its own if not. */
async function writeNow(job: Job, attrs: Readonly<Record<string, unknown>>): Promise<boolean> {
  const { setBlockAttrsIn, hasBlock } = await ydoc();
  const key = docKey(job.workspaceId, job.documentId);
  const onPage = () => { const p = pages.get(key); return p && !p.doc.isDestroyed ? p : null; };
  const page = onPage();
  if (page) return setBlockAttrsIn(page.doc, job.id, attrs, OWN, ORIGIN);
  const keeper = await keeperFor(job);
  if (keeper.closing) { clearTimeout(keeper.closing); keeper.closing = null; }
  if (!(await keeper.ready)) throw new Error('The document didn’t open to finish the upload.');
  /* The block was put on the page through another session: it has to have reached this one first. */
  if (!keeper.arrived.has(job.id)) {
    const until = Date.now() + ARRIVE_MS;
    while (!hasBlock(keeper.session.doc, job.id) && Date.now() < until && !onPage()) await sleep(500);
    if (!onPage() && !hasBlock(keeper.session.doc, job.id)) return false;
    keeper.arrived.add(job.id);
  }
  return setBlockAttrsIn(onPage()?.doc ?? keeper.session.doc, job.id, attrs, OWN, ORIGIN);
}

/* ---------- sending ---------- */

const total = (job: Job) => job.parts.reduce((n, p) => n + p.file.size, 0);
const percentOf = (job: Job): number => {
  const sent = job.parts.reduce((n, p) => n + (p.stored ? p.file.size : p.sent), 0);
  return Math.min(99, Math.floor((sent / Math.max(1, total(job))) * 100));
};

/** Says how far it's got, a few times a second at most. */
function progress(job: Job): void {
  if (job.pending || percentOf(job) === job.written) return;
  const go = () => {
    job.pending = null;
    const now = percentOf(job);
    if (now === job.written || !sending(job)) return;
    job.written = now;
    job.wroteAt = Date.now();
    write(job, { up: now }).then((ok) => { if (!ok) drop(job); }, (err: unknown) => { ulog.info('progress not written', { workspaceId: job.workspaceId, documentId: job.documentId, block: job.id, err }); });
  };
  const wait = job.wroteAt + PROGRESS_MS - Date.now();
  if (wait <= 0) go();
  else job.pending = setTimeout(go, wait);
}

/** What a block says once a file of it is stored: the gallery's photos so far, with a caption to start from, or the file. */
function storedAttrs(job: Job, part: Part, media: WorkspaceMedia): Record<string, unknown> {
  if (job.kind === 'gallery') {
    return {
      items: job.parts.map((p) => ({ media: p.stored?.id ?? null, name: p.file.name, width: p.width, height: p.height })),
      [`cap:${media.id}`]: stemOf(part.file.name), up: percentOf(job)
    };
  }
  return part === job.poster ? { poster: media.id } : { media: media.id, up: percentOf(job) };
}

function send(job: Job, part: Part, counts: boolean): Promise<WorkspaceMedia> {
  return api.workspaces.media.upload(job.workspaceId, job.documentId, part.file, {
    pass: job.pass, signal: job.stop.signal,
    ...(part.width && part.height ? { width: part.width, height: part.height } : {}),
    onProgress: ({ sent }) => { part.sent = sent; if (counts) progress(job); }
  });
}

/** The block's gone, or its upload was stopped: whatever's on its way is taken back. */
function drop(job: Job): void {
  if (jobs.get(job.id) !== job) return;
  job.stop.abort();
  if (job.pending) clearTimeout(job.pending);
  jobs.delete(job.id);
  for (const u of job.previews) if (u) URL.revokeObjectURL(u);
  /* A video's first frame, stored for everyone to see while the video went, is nothing without it. */
  const frame = job.poster?.stored;
  if (frame && job.parts.some((p) => !p.stored)) {
    api.workspaces.media.remove(job.workspaceId, job.documentId, frame.id, { pass: job.pass }).catch((err: unknown) => {
      ulog.info('a video’s first frame was left for its document', { workspaceId: job.workspaceId, documentId: job.documentId, block: job.id, err });
    });
  }
  ulog.info('upload let go: its block has gone', { workspaceId: job.workspaceId, documentId: job.documentId, block: job.id });
  claim(job.workspaceId, job.documentId);
  idle(job.workspaceId, job.documentId);
  changed();
  guard();
}

async function run(job: Job): Promise<void> {
  job.status = 'running';
  changed();
  let failing: Part | null = null;
  try {
    /* A video's first frame goes first, so everyone sees it while the rest is on its way. It's only a picture of it: if it can't go, the video goes without one. */
    if (job.poster && !job.poster.stored) {
      const poster = job.poster;
      try {
        poster.stored = await send(job, poster, false);
        if (!(await write(job, storedAttrs(job, poster, poster.stored)))) { drop(job); return; }
      } catch (e) {
        if (job.stop.signal.aborted) throw e;
        ulog.info('a video’s first frame wasn’t stored, so it goes without one', { workspaceId: job.workspaceId, documentId: job.documentId, block: job.id, err: e });
        job.poster = null;
      }
    }
    for (const part of job.parts) {
      if (part.stored) continue;
      failing = part;
      if (!part.readable) {
        const size = await pictureSize(part.file);
        if (!size) throw new Unreadable();
        part.readable = true;
        part.width = size.width;
        part.height = size.height;
      }
      const media = await send(job, part, true);
      part.stored = media;
      part.sent = part.file.size;
      for (const tell of stored) tell(job.workspaceId);
      if (!(await write(job, storedAttrs(job, part, media)))) { drop(job); return; }
    }
    failing = null;
    job.status = 'done';
    if (!(await write(job, { up: null, failed: null }))) { drop(job); return; }
    ulog.info('upload finished', { workspaceId: job.workspaceId, documentId: job.documentId, block: job.id, files: job.parts.length, bytes: total(job) });
    /* The stored pictures take a moment to come: until then, the ones sent show. */
    setTimeout(() => { if (jobs.get(job.id) === job && job.status === 'done') drop(job); }, AFTER_MS);
  } catch (e) {
    if (job.stop.signal.aborted) { drop(job); return; }
    job.status = 'failed';
    const name = (failing ?? job.parts.find((p) => !p.stored) ?? job.parts[0])?.file.name ?? '';
    const unreadable = e instanceof Unreadable;
    ulog.warn('upload failed', { workspaceId: job.workspaceId, documentId: job.documentId, block: job.id, code: unreadable ? 'unreadable' : errorCode(e), err: unreadable ? undefined : e });
    await write(job, { up: null, failed: name }).then((ok) => { if (!ok) drop(job); }, (err: unknown) => { ulog.warn('a failed upload couldn’t say so', { workspaceId: job.workspaceId, documentId: job.documentId, block: job.id, err }); });
    /* What the server said is written for the person uploading: the file's too big, the workspace is full, the day's used up. */
    if (!unreadable) talkers.get(job.workspaceId)?.(wsToast.failed(errorMessage(e)));
    sweepSoon();
  } finally {
    claim(job.workspaceId, job.documentId);
    idle(job.workspaceId, job.documentId);
    changed();
    guard();
  }
}

/* A block whose upload failed can be deleted, or its document left: once it's gone from a page here, so is its upload. */
const SWEEP_MS = 15_000;
let sweeping: ReturnType<typeof setInterval> | null = null;
function sweep(): void {
  const waiting = [...jobs.values()].filter((j) => j.status === 'failed');
  if (waiting.length === 0) { if (sweeping) clearInterval(sweeping); sweeping = null; return; }
  void ydoc().then(({ hasBlock }) => {
    for (const job of waiting) {
      const page = pages.get(docKey(job.workspaceId, job.documentId));
      if (page && !page.doc.isDestroyed && !hasBlock(page.doc, job.id)) drop(job);
    }
  });
}
const sweepSoon = () => { sweeping ??= setInterval(sweep, SWEEP_MS); };

let running = 0;
function pump(): void {
  for (const job of jobs.values()) {
    if (running >= AT_ONCE) return;
    if (job.status !== 'waiting') continue;
    running += 1;
    void run(job).finally(() => { running -= 1; pump(); });
  }
}

/* While something's on its way, closing the tab asks first: what's been sent so far would be lost. */
const leaving = (e: BeforeUnloadEvent) => { e.preventDefault(); };
let guarding = false;
function guard(): void {
  const busy = [...jobs.values()].some(sending);
  if (busy === guarding) return;
  guarding = busy;
  if (busy) addEventListener('beforeunload', leaving);
  else removeEventListener('beforeunload', leaving);
}

/** Starts sending drafts, now that their blocks are on the page with these IDs, in order. */
export function start(to: Destination, drafts: readonly Draft[], ids: readonly string[]): void {
  drafts.forEach((d, i) => {
    const id = ids[i];
    if (!id) { discard([d]); return; }
    jobs.set(id, {
      ...to, id, kind: d.kind, parts: d.parts, poster: d.poster, previews: d.previews,
      status: d.failed ? 'failed' : 'waiting', stop: new AbortController(), written: d.failed ? null : 0, wroteAt: 0, pending: null, queue: Promise.resolve()
    });
  });
  claim(to.workspaceId, to.documentId);
  changed();
  guard();
  if (drafts.some((d) => d.failed)) sweepSoon();
  pump();
}

/**
 * Files into a document at its end, open here or not: what Upload files in the list does with the document it makes. Its
 * title is `title`, if it hasn't one yet.
 */
export async function uploadInto(to: Destination, files: readonly File[], title: string | null): Promise<void> {
  const drafts = await prepare(files);
  try {
    const keeper = await keeperFor(to);
    if (!(await keeper.ready)) throw new Error('The new document didn’t open, so nothing was added to it.');
    const [{ appendBlocks }, { setTitle, titleOf }] = await Promise.all([ydoc(), import('./editor/title')]);
    const doc = keeper.session.doc;
    if (title && !titleOf(doc)) setTitle(doc, title);
    const ids = appendBlocks(doc, drafts.map((d) => d.block));
    for (const id of ids) keeper.arrived.add(id);
    start(to, drafts, ids);
  } catch (e) {
    discard(drafts);
    idle(to.workspaceId, to.documentId);
    throw e;
  }
}

/** Try again, on a block whose upload failed here: it starts from what's still to send. */
export function retry(block: string): void {
  const job = jobs.get(block);
  if (!job || job.status !== 'failed') return;
  job.status = 'waiting';
  job.stop = new AbortController();
  job.written = percentOf(job);
  claim(job.workspaceId, job.documentId);
  changed();
  guard();
  write(job, { failed: null, up: percentOf(job) }).then((ok) => { if (ok) pump(); else drop(job); }, (err: unknown) => {
    ulog.warn('an upload couldn’t start again', { workspaceId: job.workspaceId, documentId: job.documentId, block: job.id, err });
    job.status = 'failed';
    changed();
  });
}
