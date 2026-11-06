/*
 * Files on their way into documents from this browser (docs: Data and storage › Media). A block holds their space straight
 * away, for everyone, and says how far they've got as they go. Each upload has a token of its own, in its block's `upload`
 * attribute, and follows its block by that, not by the block's ID: a block cut and pasted gets a new ID, and one undone and
 * done again comes back, and the upload goes on into it. Nothing is stored until the block is in the document for everyone,
 * so one Alcove turned away never holds a file.
 *
 * Sending them is this browser's alone: it writes to the block always through one session of its own for the document, so
 * its writes arrive in the order they were made (two sessions writing the same attribute without hearing each other could
 * leave the older one standing), and leaving the document, or the workspace, doesn't stop it. That session closes only once
 * everything it wrote has reached Alcove, however long the connection is away, and until then closing the tab asks first.
 * Everyone else hears that an upload is going on through that session's awareness, so a block that says it's uploading with
 * nobody sending it shows as failed.
 *
 * Nothing about a file is logged but its IDs, sizes and how it went: never its name.
 */
import { errorCode, errorMessage, servedType, type DocSession, type WorkspaceMedia } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { api } from '~/lib/api';
import { smallJpeg } from './thumbs';
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
/** How long an upload waits for its block to reach Alcove before it stores anything. */
const ARRIVE_MS = 60_000;
/** How long a block that left the page, undone or cut, has to come back before its upload is let go of. */
const AWAY_MS = 15_000;
/** A finished upload's own picture stays here this long, so the stored one can come without the picture blinking. */
const AFTER_MS = 60_000;
/** A failed upload can be tried again for this long; then its file is let go of here, and the block offers only Delete. */
const FAILED_MS = 10 * 60_000;
/** A session opened for uploads closes this long after its last one, once what it wrote has reached Alcove. */
const CLOSE_MS = 3_000;
/** What an upload writes on its block, which nobody else does: a stray one on a retired copy of the block comes off again. */
const OWN = ['items', 'up', 'failed', 'media', 'poster', 'upload'] as const;
/** How a video's first frame is named, so nothing offers it as a photo of its own. */
export const FRAME_SUFFIX = ' (first frame).jpg';

type Kind = 'gallery' | 'video' | 'file';

/** One file of a block. */
interface Part { file: File; width: number | null; height: number | null; stored: WorkspaceMedia | null; sent: number }

/** A block and what it's waiting for, before it's on the page. `failed`: a photo this browser can't read. */
export interface Draft { token: string; block: BlockJSON; kind: Kind; parts: Part[]; poster: Part | null; previews: (string | null)[]; failed: boolean }

/** Who's sending, and into what. */
export interface Destination { workspaceId: string; documentId: string; owner: string | null; pass: string | undefined }

interface Job extends Destination {
  /** What its block carries as `upload`, and what it's known by here. */
  token: string;
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
  /** When it failed, for how long it can be tried again. */
  failedAt: number;
  /** Its block has reached the upload's session: until then nothing is stored. */
  arrived: boolean;
  /** Since when its block has been off the page, undone or cut, if it is. */
  awaySince: number | null;
  /** A photo this browser can't read: it can go in as a file instead. */
  unreadable: boolean;
}

/** The block never reached Alcove: nothing was stored. */
class NeverArrived extends Error {}

/** A random token for an upload: nothing about the file is in it. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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

const partOf = (file: File, width: number | null = null, height: number | null = null): Part => ({ file, width, height, stored: null, sent: 0 });

function fileDraft(f: File): Draft {
  const token = newToken();
  return { token, block: { type: 'file', attrs: { upload: token, name: f.name, size: f.size, up: 0 } }, kind: 'file', parts: [partOf(f)], poster: null, previews: [], failed: false };
}

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
      if (size) photos.push(partOf(f, size.width, size.height));
      else {
        const token = newToken();
        unreadable.push({ token, block: { type: 'gallery', attrs: { upload: token, items: [{ media: null, name: f.name, width: null, height: null }], failed: f.name } }, kind: 'gallery', parts: [partOf(f)], poster: null, previews: [null], failed: true });
      }
    } else if (servedType(f.type).startsWith('video/')) {
      const facts = await videoFacts(f);
      if (!facts) { rest.push(fileDraft(f)); continue; }
      const poster = facts.frame ? partOf(new File([facts.frame], `${stemOf(f.name)}${FRAME_SUFFIX}`, { type: 'image/jpeg' })) : null;
      const token = newToken();
      rest.push({
        token, block: { type: 'video', attrs: { upload: token, title: stemOf(f.name), dur: facts.dur, width: facts.width, height: facts.height, up: 0 } },
        kind: 'video', parts: [partOf(f, facts.width, facts.height)], poster, previews: [facts.frame ? URL.createObjectURL(facts.frame) : null], failed: false
      });
    } else rest.push(fileDraft(f));
  }
  const token = newToken();
  const gallery: Draft[] = photos.length ? [{
    token, block: { type: 'gallery', attrs: { upload: token, items: photos.map((p) => ({ media: null, name: p.file.name, width: p.width, height: p.height })), up: 0 } },
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

/** Jobs by their token. */
const jobs = new Map<string, Job>();
const jobsIn = (workspaceId: string, documentId: string) => [...jobs.values()].filter((j) => j.workspaceId === workspaceId && j.documentId === documentId);
const sending = (j: Job) => j.status === 'waiting' || j.status === 'running';

/* `upload`: a block's `upload` token, which is what an upload is known by here. */
export const isSending = (upload: string): boolean => { const j = jobs.get(upload); return j !== undefined && sending(j); };
export const canRetry = (upload: string): boolean => { const j = jobs.get(upload); return j?.status === 'failed' && !j.unreadable; };
/** A photo this browser can't read, which it still has: it can go in as a file instead. */
export const canAddAsFile = (upload: string): boolean => { const j = jobs.get(upload); return j?.status === 'failed' && j.unreadable; };
/** What this browser is sending into a block, at its place in it: the photo, or a video's first frame. */
export const previewOf = (upload: string, index: number): string | undefined => jobs.get(upload)?.previews[index] ?? undefined;

/* ---------- where writes go ---------- */

interface Keeper { session: DocSession; ready: Promise<boolean>; closing: ReturnType<typeof setTimeout> | null; unheard: () => void }
const docKey = (workspaceId: string, documentId: string) => `${workspaceId}:${documentId}`;

/**
 * Each document's own session for uploads, while anything's going into it or what it wrote hasn't reached Alcove. It's one
 * of the few document streams a person can have open, so a failed upload doesn't keep it: Try again opens it again.
 */
const keepers = new Map<string, Promise<Keeper>>();
const keepersOpen = new Map<string, Keeper>();
/** Documents whose page here was turned away: a block put in there won't reach Alcove, so nothing waits for it. */
const turnedAway = new Set<string>();

/** Something a session wrote hasn't reached Alcove, and it's still trying. */
const holding = (session: DocSession): boolean => {
  const s = session.getSnapshot();
  return s.unsent && s.refused === null && s.closed === null;
};

/** Says in the document's awareness which uploads this browser is sending, finished ones included until Alcove has them. */
function claim(workspaceId: string, documentId: string): void {
  const session = keepersOpen.get(docKey(workspaceId, documentId))?.session;
  if (!session || session.doc.isDestroyed) return;
  const unsent = holding(session);
  const ids = jobsIn(workspaceId, documentId).filter((j) => sending(j) || (unsent && j.status === 'done')).map((j) => j.token);
  const was: unknown = session.awareness.getLocalState()?.['uploading'];
  if (Array.isArray(was) ? was.join() !== ids.join() : ids.length > 0) session.awareness.setLocalStateField('uploading', ids);
}

/** The document's own session for uploads, opened by the first and closed a moment after the last has reached Alcove. */
function keeperFor(j: Destination): Promise<Keeper> {
  const key = docKey(j.workspaceId, j.documentId);
  const had = keepers.get(key);
  if (had) return had;
  const opening = openDocument(j.workspaceId, j.documentId, j.owner, j.pass, false).then((session) => {
    const keeper: Keeper = { session, ready: session.ready.then(() => true, () => false), closing: null, unheard: () => undefined };
    /* As what it wrote reaches Alcove, or stops being able to: who's sending what, the tab's question, and closing. */
    keeper.unheard = session.subscribe(() => { claim(j.workspaceId, j.documentId); guard(); idle(j.workspaceId, j.documentId); });
    keepersOpen.set(key, keeper);
    claim(j.workspaceId, j.documentId);
    return keeper;
  });
  keepers.set(key, opening);
  opening.catch(() => { if (keepers.get(key) === opening) keepers.delete(key); });
  return opening;
}

/** Closes a document's own session once nothing more is going into it and everything it wrote has reached Alcove. */
function idle(workspaceId: string, documentId: string): void {
  const key = docKey(workspaceId, documentId);
  const keeper = keepersOpen.get(key);
  if (!keeper || keeper.closing) return;
  const busy = () => jobsIn(workspaceId, documentId).some(sending) || holding(keeper.session);
  if (busy()) return;
  keeper.closing = setTimeout(() => {
    keeper.closing = null;
    if (busy()) return;
    keepersOpen.delete(key);
    keepers.delete(key);
    keeper.unheard();
    keeper.session.close();
    guard();
  }, CLOSE_MS);
}

const ydoc = () => import('./editor/ydoc');
const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Written, or the block is off the page for now, or it's gone for good. */
type Wrote = 'written' | 'away' | 'gone';

/** Writes to a block, after whatever it was writing before. */
function write(job: Job, attrs: Readonly<Record<string, unknown>>, wait: boolean): Promise<Wrote> {
  const next = job.queue.then(() => writeNow(job, attrs, wait));
  job.queue = next.catch(() => undefined);
  return next;
}

/**
 * Writes to the upload's blocks, found by its token, through the document's own session. A block put on the page through
 * the page's session has to reach this one first: until it has, or while it's off the page (undone, or cut and not yet
 * pasted), a write that `wait`s waits for it, and one that doesn't is skipped. Away longer than AWAY_MS, or never arrived in
 * ARRIVE_MS, it's gone.
 */
async function writeNow(job: Job, attrs: Readonly<Record<string, unknown>>, wait: boolean): Promise<Wrote> {
  const { setUploadAttrs } = await ydoc();
  let keeper = await keeperFor(job);
  /* It closed just as this came to it: another opens. */
  if (keepersOpen.get(docKey(job.workspaceId, job.documentId)) !== keeper) keeper = await keeperFor(job);
  if (keeper.closing) { clearTimeout(keeper.closing); keeper.closing = null; }
  if (!(await keeper.ready)) throw new Error('The document didn’t open to finish the upload.');
  const doc = keeper.session.doc;
  const found = (): boolean => {
    if (setUploadAttrs(doc, job.token, attrs, OWN, ORIGIN) === 0) return false;
    job.arrived = true;
    job.awaySince = null;
    return true;
  };
  if (found()) return 'written';
  const now = Date.now();
  if (job.arrived) job.awaySince ??= now;
  const until = job.arrived ? (job.awaySince ?? now) + AWAY_MS : now + ARRIVE_MS;
  if (!wait) return job.arrived && now >= until ? 'gone' : 'away';
  const away = docKey(job.workspaceId, job.documentId);
  while (Date.now() < until && !job.stop.signal.aborted && (job.arrived || !turnedAway.has(away))) {
    await sleep(250);
    if (found()) return 'written';
  }
  return 'gone';
}

/* ---------- sending ---------- */

const total = (job: Job) => job.parts.reduce((n, p) => n + p.file.size, 0);
const percentOf = (job: Job): number => {
  const sent = job.parts.reduce((n, p) => n + (p.stored ? p.file.size : p.sent), 0);
  return Math.min(99, Math.floor((sent / Math.max(1, total(job))) * 100));
};

/** Says how far it's got, a few times a second at most. A block that's away for now is told when it's back. */
function progress(job: Job): void {
  if (job.pending || percentOf(job) === job.written) return;
  const go = () => {
    job.pending = null;
    const now = percentOf(job);
    if (now === job.written || !sending(job)) return;
    job.wroteAt = Date.now();
    write(job, { up: now }, false).then((w) => {
      if (w === 'written') job.written = now;
      else if (w === 'gone') drop(job);
    }, (err: unknown) => { ulog.info('progress not written', { workspaceId: job.workspaceId, documentId: job.documentId, err }); });
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

/** Sends one file. A photo goes with a small preview of itself, made here, for the picker to show it by. */
async function send(job: Job, part: Part, counts: boolean): Promise<WorkspaceMedia> {
  const preview = job.kind === 'gallery' && part.width && part.height ? await smallJpeg(part.file, { width: part.width, height: part.height }) : null;
  return api.workspaces.media.upload(job.workspaceId, job.documentId, part.file, {
    pass: job.pass, signal: job.stop.signal,
    ...(part.width && part.height ? { width: part.width, height: part.height } : {}),
    ...(preview ? { preview } : {}),
    onProgress: ({ sent }) => { part.sent = sent; if (counts) progress(job); }
  });
}

/** The block's gone for good, or its upload was stopped: whatever's on its way is taken back. */
function drop(job: Job): void {
  if (jobs.get(job.token) !== job) return;
  job.stop.abort();
  if (job.pending) clearTimeout(job.pending);
  jobs.delete(job.token);
  for (const u of job.previews) if (u) URL.revokeObjectURL(u);
  /* A video's first frame, stored for everyone to see while the video went, is nothing without it. */
  const frame = job.poster?.stored;
  if (frame && job.parts.some((p) => !p.stored)) {
    api.workspaces.media.remove(job.workspaceId, job.documentId, frame.id, { pass: job.pass }).catch((err: unknown) => {
      ulog.info('a video’s first frame was left for its document', { workspaceId: job.workspaceId, documentId: job.documentId, err });
    });
  }
  ulog.info('upload let go: its block has gone', { workspaceId: job.workspaceId, documentId: job.documentId });
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
    /* Nothing is stored until the block is in the document for everyone: one Alcove turned away never holds a file. */
    const there = await write(job, { up: percentOf(job), failed: null }, true);
    if (there === 'gone') {
      if (job.arrived) { drop(job); return; }
      throw new NeverArrived();
    }
    /* A video's first frame goes first, so everyone sees it while the rest is on its way. It's only a picture of it: if it can't go, the video goes without one. */
    if (job.poster && !job.poster.stored) {
      const poster = job.poster;
      try {
        poster.stored = await send(job, poster, false);
        if ((await write(job, storedAttrs(job, poster, poster.stored), true)) === 'gone') { drop(job); return; }
      } catch (e) {
        if (job.stop.signal.aborted) throw e;
        ulog.info('a video’s first frame wasn’t stored, so it goes without one', { workspaceId: job.workspaceId, documentId: job.documentId, err: e });
        job.poster = null;
      }
    }
    for (const part of job.parts) {
      if (part.stored) continue;
      failing = part;
      const media = await send(job, part, true);
      part.stored = media;
      part.sent = part.file.size;
      for (const tell of stored) tell(job.workspaceId);
      if ((await write(job, storedAttrs(job, part, media), true)) === 'gone') { drop(job); return; }
    }
    failing = null;
    job.status = 'done';
    if ((await write(job, { up: null, failed: null, upload: null }, true)) === 'gone') { drop(job); return; }
    ulog.info('upload finished', { workspaceId: job.workspaceId, documentId: job.documentId, files: job.parts.length, bytes: total(job) });
    /* The stored pictures take a moment to come: until then, the ones sent show. */
    setTimeout(() => { if (jobs.get(job.token) === job && job.status === 'done') drop(job); }, AFTER_MS);
  } catch (e) {
    if (job.stop.signal.aborted) { drop(job); return; }
    job.status = 'failed';
    job.failedAt = Date.now();
    const name = (failing ?? job.parts.find((p) => !p.stored) ?? job.parts[0])?.file.name ?? '';
    const never = e instanceof NeverArrived;
    ulog.warn('upload failed', { workspaceId: job.workspaceId, documentId: job.documentId, code: never ? 'never-arrived' : errorCode(e), err: never ? undefined : e });
    /* A block that never reached Alcove can't say so: this page shows it couldn't, with Try again. */
    if (!never) {
      await write(job, { up: null, failed: name }, true).then((w) => { if (w === 'gone') drop(job); }, (err: unknown) => { ulog.warn('a failed upload couldn’t say so', { workspaceId: job.workspaceId, documentId: job.documentId, err }); });
    }
    /* What the server said is written for the person uploading: the file's too big, the workspace is full, the day's used up. */
    if (!never) talkers.get(job.workspaceId)?.(wsToast.failed(errorMessage(e)));
    sweepSoon();
  } finally {
    claim(job.workspaceId, job.documentId);
    idle(job.workspaceId, job.documentId);
    changed();
    guard();
  }
}

/*
 * A failed upload waits to be tried again until its block is gone, seen while the document's session is open for another
 * upload, or for FAILED_MS: then it's let go of, and Try again with it.
 */
const SWEEP_MS = 15_000;
let sweeping: ReturnType<typeof setInterval> | null = null;
function sweep(): void {
  const waiting = [...jobs.values()].filter((j) => j.status === 'failed');
  if (waiting.length === 0) { if (sweeping) clearInterval(sweeping); sweeping = null; return; }
  void ydoc().then(({ uploadBlocks }) => {
    for (const job of waiting) {
      const keeper = keepersOpen.get(docKey(job.workspaceId, job.documentId));
      const gone = keeper !== undefined && !keeper.session.doc.isDestroyed && job.arrived && uploadBlocks(keeper.session.doc, job.token).length === 0;
      if (gone || Date.now() - job.failedAt > FAILED_MS) drop(job);
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

/* While something's on its way, or what was written about it hasn't reached Alcove, closing the tab asks first. */
const leaving = (e: BeforeUnloadEvent) => { e.preventDefault(); };
let guarding = false;
function guard(): void {
  const busy = [...jobs.values()].some(sending) || [...keepersOpen.values()].some((k) => !k.session.doc.isDestroyed && holding(k.session));
  if (busy === guarding) return;
  guarding = busy;
  if (busy) addEventListener('beforeunload', leaving);
  else removeEventListener('beforeunload', leaving);
}

/** Starts sending drafts, now that their blocks are on the page. `arrived`: they were put in through the upload's own session. */
export function start(to: Destination, drafts: readonly Draft[], arrived = false): void {
  for (const d of drafts) {
    jobs.set(d.token, {
      ...to, token: d.token, kind: d.kind, parts: d.parts, poster: d.poster, previews: d.previews,
      status: d.failed ? 'failed' : 'waiting', stop: new AbortController(), written: d.failed ? null : 0, wroteAt: 0, pending: null, queue: Promise.resolve(),
      failedAt: Date.now(), arrived, awaySince: null, unreadable: d.failed
    });
  }
  /* Its own session opens now, so it's there by the time there's something to say. A photo this browser can't read says so
     in the block it came in, and sends nothing: that needs no session, and one opened for Upload files closes again. */
  if (drafts.some((d) => !d.failed)) {
    keeperFor(to).catch((err: unknown) => { ulog.warn('a document didn’t open for an upload', { workspaceId: to.workspaceId, documentId: to.documentId, err }); });
  }
  claim(to.workspaceId, to.documentId);
  idle(to.workspaceId, to.documentId);
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
    const [{ appendBlocks, retireBlankStart }, { setTitle, titleOf }] = await Promise.all([ydoc(), import('./editor/title')]);
    const doc = keeper.session.doc;
    if (title && !titleOf(doc)) setTitle(doc, title);
    appendBlocks(doc, drafts.map((d) => d.block));
    retireBlankStart(doc);
    start(to, drafts, true);
  } catch (e) {
    discard(drafts);
    idle(to.workspaceId, to.documentId);
    throw e;
  }
}

/** Try again, on a block whose upload failed here: it starts from what's still to send. */
export function retry(upload: string): void {
  const job = jobs.get(upload);
  if (!job || job.status !== 'failed' || job.unreadable) return;
  job.status = 'waiting';
  job.stop = new AbortController();
  job.written = percentOf(job);
  claim(job.workspaceId, job.documentId);
  changed();
  guard();
  pump();
}

/**
 * A photo this browser couldn't read, to go in as a file instead: its file, and the upload's let go of. Null when this
 * browser hasn't it any more.
 */
export function asFile(upload: string): File | null {
  const job = jobs.get(upload);
  const file = job && job.status === 'failed' && job.unreadable ? job.parts[0]?.file ?? null : null;
  if (job && file) drop(job);
  return file;
}

/** The page of a document here was turned away, or isn't any more: a block put in there won't reach Alcove meanwhile. */
export function pageTurnedAway(workspaceId: string, documentId: string, away: boolean): void {
  const key = docKey(workspaceId, documentId);
  if (away) turnedAway.add(key); else turnedAway.delete(key);
}
