/*
 * What can show behind someone on camera: Alcove's own pictures, and pictures they add themselves. Those stay in this
 * browser: each is made into a 1920×1080 JPEG here and sealed, as edits and recordings kept on this device are
 * (workspace/offline/keep.ts), with AES-GCM under a key made on this device that can't be exported, a fresh IV each time and
 * whose picture it is bound in. They're never sent anywhere; only the picture with someone in front of it reaches a
 * call. Signing out or deleting the account here deletes them, and the key goes with the last.
 */
import { AlcoveApiError, BACKGROUND_SCENES, DeviceGenerationSchema, KeptBackgroundAccessSchema, KeptBackgroundSchema, type BackgroundScene, type KeptBackground, type Session } from '@alcove/api';
import { SCENE_PICTURES } from '@alcove/ui';
import { useEffect, useState } from 'react';
import { log } from '~/lib/log';
import type { LocalMedia } from '../media';
import { accountGeneration, accountReadFence, activatePictureAccount, onSignedOutElsewhere, signedOut } from '~/lib/signedOut';

const blog = log.child({ component: 'backgrounds' });

/** Alcove's pictures, with what each is called. */
export const SCENES: readonly { id: BackgroundScene; label: string; src: string }[] = BACKGROUND_SCENES.map((id) => ({ id, ...SCENE_PICTURES[id] }));

/** The most pictures someone keeps here, and the biggest file they can add (it's made much smaller before it's kept). */
export const MAX_BACKGROUNDS = 6;
const MAX_FILE = 20 * 1024 * 1024;
export const BACKGROUND_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const W = 1920;
const H = 1080;

/** Whether this browser can keep pictures: IndexedDB and Web Crypto, which need a secure page. */
export const canKeepBackgrounds = (): boolean => typeof indexedDB !== 'undefined' && isSecureContext;

/* ---------- the database ---------- */

const NAME = 'alcove-backgrounds';
const KEYS = 'device';
const PICTURES = 'pictures';
// This opaque revision survives deletion of the last key. No schema upgrade or change to existing sealed records.
const GENERATION = 'generation';
const accountFence = (owner: string) => ['account', owner];

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (opening) return opening;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(KEYS);
      r.result.createObjectStore(PICTURES, { keyPath: ['owner', 'id'] });
    };
    r.onsuccess = () => {
      const d = r.result;
      // Another tab deleting or upgrading it: let go, and open it again when it's next needed.
      d.onversionchange = () => { d.close(); if (opening === p) opening = null; };
      d.onclose = () => { if (opening === p) opening = null; };
      resolve(d);
    };
    r.onerror = () => reject(r.error ?? new Error('This browser’s storage didn’t open.'));
  });
  opening = p;
  p.catch(() => { if (opening === p) opening = null; });
  return p;
}

function ask(r: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
/** Every operation includes both stores, so deleting rows, revoking old work and deleting the key serialize together across tabs. */
async function transaction<T>(mode: IDBTransactionMode, fill: (tx: IDBTransaction) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const database = await db();
  if (signal?.aborted) throw new DOMException('The picture storage operation was cancelled.', 'AbortError');
  const tx = database.transaction([KEYS, PICTURES], mode);
  let finished = false;
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => { finished = true; resolve(); };
    tx.onabort = () => { finished = true; reject(tx.error ?? new DOMException('The change wasn’t saved.', 'AbortError')); };
  });
  const cancel = () => {
    if (finished) return;
    try { tx.abort(); } catch (e) {
      // Completion may already be queued. In that case its writes finished before cancellation.
      blog.debug('picture transaction could not be cancelled', { err: e });
    }
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    // Observe both rejections even if a request fails before the transaction's abort event.
    const [result] = await Promise.all([fill(tx), committed]);
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

/** Optional picture storage must never hold up authentication. Late work is cancelled as well as stopped waiting for. */
async function sessionPictureStep<T>(event: string, run: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('Picture storage did not respond in time.', 'TimeoutError');
      controller.abort();
      reject(error);
    }, 1000);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => run(controller.signal)), timeout]);
  } catch (e) {
    blog.warn(event, { err: e });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const inAccount = (owner: string) => IDBKeyRange.bound([owner], [owner, []]);

/* ---------- sealing ---------- */

async function generation(tx: IDBTransaction): Promise<string | null> {
  const value = await ask(tx.objectStore(KEYS).get(GENERATION));
  // Previous releases have no revision; their key, rows and authenticated headers stay exactly as they were.
  return value === undefined ? null : DeviceGenerationSchema.parse(value);
}
const placeOf = (owner: string, id: string, at: number) => new TextEncoder().encode(`alcove/kept-background/v1\n${owner}\n${id}\n${at}`);

const mayAccess = (owner: string, account: string | null): boolean => account !== null && !signedOut(owner) && accountGeneration(owner) === account;
function requireAccess(owner: string, account: string | null): void {
  if (signedOut(owner)) throw new AlcoveApiError('unauthenticated', 'This account signed out here, so nothing more is kept for it.');
  if (account === null || accountGeneration(owner) === null) throw new AlcoveApiError('unavailable', 'This browser can’t safely keep pictures right now.');
  if (!mayAccess(owner, account)) throw new AlcoveApiError('unauthenticated', 'This account signed out here, so nothing more is kept for it.');
}
const backgroundsChanged = () => new AlcoveApiError('conflict', 'The pictures kept here changed. Try adding the picture again.');

async function pictureAccess(tx: IDBTransaction, owner: string, account: string | null): Promise<boolean> {
  const fence = await ask(tx.objectStore(KEYS).get(accountFence(owner)));
  // No fence in databases from the previous release. Once revoked, only a fresh authenticated session can reopen it.
  return mayAccess(owner, account) && (fence === undefined || KeptBackgroundAccessSchema.parse(fence) === account);
}

interface PictureSnapshot { generation: string | null; key: CryptoKey | null; rows: unknown[] }
async function pictureSnapshot(owner: string, account: string | null, id?: string): Promise<PictureSnapshot | null> {
  return transaction('readonly', async (tx) => {
    const store = tx.objectStore(PICTURES);
    const [revision, key, rows, allowed] = await Promise.all([
      generation(tx), ask(tx.objectStore(KEYS).get(KEYS)),
      ask(id === undefined ? store.getAll(inAccount(owner)) : store.get([owner, id])), pictureAccess(tx, owner, account)
    ]);
    if (!allowed || !mayAccess(owner, account)) return null;
    return { generation: revision, key: key instanceof CryptoKey ? key : null, rows: id === undefined ? listOf(rows) : rows === undefined ? [] : [rows] };
  });
}

/**
 * All sign-in destinations read the real session through this boundary. Take the deletion revision BEFORE making the
 * HTTP request: a response from before sign-out can never reopen a revoked account after cleanup. Auth still works
 * when browser storage fails; only keeping pictures stays unavailable.
 */
export async function readSessionWithPictureAccess(read: () => Promise<Session | null>): Promise<Session | null> {
  if (!canKeepBackgrounds()) return read();
  const before = await sessionPictureStep('picture access could not be checked before reading the session', (signal) =>
    transaction('readonly', async (tx) => ({ generation: await generation(tx) }), signal));
  // Cleanup may still be working through recordings and edits before it rotates this database's revision.
  const accountUnchanged = accountReadFence();
  const session = await read();
  if (!session || !before) return session;
  const revision = before.generation;
  const activated = await sessionPictureStep('pictures remain closed after reading the session', (signal) =>
    transaction('readwrite', async (tx) => {
      const keys = tx.objectStore(KEYS);
      const [current, fence] = await Promise.all([generation(tx), ask(keys.get(accountFence(session.ownerId)))]);
      if (signal.aborted || current !== revision || !accountUnchanged(session.ownerId)) return false;
      const account = accountGeneration(session.ownerId);
      if (fence !== undefined && KeptBackgroundAccessSchema.parse(fence) === account && account !== null && !signedOut(session.ownerId)) return false;
      // Persist the new synchronous token before reopening the IDB fence, including after a full-page OAuth return.
      activatePictureAccount(session.ownerId);
      const active = accountGeneration(session.ownerId);
      if (active === null) return false;
      keys.put(active, accountFence(session.ownerId));
      closePictures(session.ownerId);
      return true;
    }, signal));
  if (activated) changed();
  return session;
}

/* ---------- pictures ---------- */

/** A picture someone keeps here, ready to show: its ID and the picture as a data: URL (the page's policy allows those for images). */
export interface KeptPicture { id: string; src: string }

/** Pictures opened once in this tab, by account and ID: opening one means reading and unsealing a megabyte or so. */
const opened = new Map<string, { generation: string | null; src: string }>();
const openedKey = (owner: string, id: string) => `${owner}\n${id}`;

function closePictures(owner: string): void {
  for (const k of opened.keys()) if (k.startsWith(`${owner}\n`)) opened.delete(k);
}
onSignedOutElsewhere((owner) => { closePictures(owner); changed(false); });

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === 'string' ? resolve(r.result) : reject(new Error('The picture didn’t read as a URL.')));
    r.onerror = () => reject(r.error ?? new Error('The picture didn’t read.'));
    r.readAsDataURL(blob);
  });
}
async function unseal(owner: string, kept: KeptBackground, key: CryptoKey, revision: string | null): Promise<KeptPicture> {
  const have = opened.get(openedKey(owner, kept.id));
  if (have?.generation === revision) return { id: kept.id, src: have.src };
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: kept.sealed.iv, additionalData: placeOf(owner, kept.id, kept.at) }, key, kept.sealed.data);
  const src = await asDataUrl(new Blob([bytes], { type: 'image/jpeg' }));
  return { id: kept.id, src };
}

/** Cache only while a transaction still proves deletion hasn't passed this read. Never repopulate after an async decrypt. */
async function publishPictures(owner: string, account: string | null, revision: string | null, pictures: KeptPicture[]): Promise<KeptPicture[]> {
  const published = await transaction('readonly', async (tx) => {
    const [current, allowed] = await Promise.all([generation(tx), pictureAccess(tx, owner, account)]);
    if (current !== revision || !allowed || !mayAccess(owner, account)) return [];
    for (const picture of pictures) opened.set(openedKey(owner, picture.id), { generation: revision, src: picture.src });
    return pictures;
  });
  if (!mayAccess(owner, account)) { closePictures(owner); return []; }
  return published;
}

/** Every picture `owner` keeps here, the first added first. One that's damaged is left out and logged. */
export async function keptPictures(owner: string): Promise<KeptPicture[]> {
  const account = accountGeneration(owner);
  if (!canKeepBackgrounds() || !mayAccess(owner, account)) { closePictures(owner); return []; }
  const snapshot = await pictureSnapshot(owner, account);
  if (!snapshot?.key) return [];
  const kept: KeptBackground[] = [];
  for (const row of snapshot.rows) {
    const r = KeptBackgroundSchema.safeParse(row);
    if (r.success) kept.push(r.data);
    else blog.error('a kept background is damaged', { err: r.error });
  }
  if (!kept.length) return [];
  const out: KeptPicture[] = [];
  for (const k of kept.sort((a, b) => a.at - b.at)) {
    if (!mayAccess(owner, account)) return [];
    try { out.push(await unseal(owner, k, snapshot.key, snapshot.generation)); } catch (e) { blog.error('a kept background didn’t open', { err: e }); }
  }
  return publishPictures(owner, account, snapshot.generation, out);
}

/** One picture `owner` keeps here, as a data: URL, or null when it isn't here (deleted, or kept for someone else). */
export async function keptPicture(owner: string, id: string): Promise<string | null> {
  const account = accountGeneration(owner);
  if (!canKeepBackgrounds() || !mayAccess(owner, account)) { closePictures(owner); return null; }
  // Even a cache hit reads the row and revision: a deletion's broadcast may not have arrived yet.
  const snapshot = await pictureSnapshot(owner, account, id);
  if (!snapshot?.key) return null;
  const row = snapshot.rows[0];
  if (row === undefined) return null;
  const r = KeptBackgroundSchema.safeParse(row);
  if (!r.success) { blog.error('a kept background is damaged', { err: r.error }); return null; }
  const picture = await unseal(owner, r.data, snapshot.key, snapshot.generation);
  return (await publishPictures(owner, account, snapshot.generation, [picture]))[0]?.src ?? null;
}

/** The picture in `file`, filling 1920×1080 the way a background does (cut to fit, never stretched), as a JPEG. */
async function prepare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch((e: unknown) => { throw new AlcoveApiError('invalid', 'That file didn’t open as a picture. Try a JPEG, PNG or WebP.', { cause: e }); });
  try {
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AlcoveApiError('unavailable', 'This browser can’t prepare pictures.');
    const scale = Math.max(W / bitmap.width, H / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (W - w) / 2, (H - h) / 2, w, h);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } finally {
    bitmap.close();
  }
}

const isAccepted = (type: string) => BACKGROUND_TYPES.some((t) => t === type);

/** Keeps a picture, or atomically replaces one after the new picture is prepared and sealed. A failure leaves the old one. */
export async function keepPicture(owner: string, file: File, replace?: string): Promise<KeptPicture> {
  // Capture synchronously: opening IndexedDB itself can outlast sign-out followed by sign-in in another tab.
  const account = accountGeneration(owner);
  if (!canKeepBackgrounds()) throw new AlcoveApiError('unavailable', 'This browser can’t keep pictures, so you can’t add your own here.');
  requireAccess(owner, account);
  if (!isAccepted(file.type)) throw new AlcoveApiError('invalid', 'Pick a JPEG, PNG or WebP picture.');
  if (file.size > MAX_FILE) throw new AlcoveApiError('too-large', 'That picture is over 20 MB. Pick a smaller one.');
  let snapshot = await pictureSnapshot(owner, account);
  requireAccess(owner, account);
  if (!snapshot) throw backgroundsChanged();
  const revision = snapshot.generation;
  if (replace && !snapshot.rows.some((row) => { const r = KeptBackgroundSchema.safeParse(row); return r.success && r.data.id === replace; })) throw backgroundsChanged();
  if (!replace && snapshot.rows.length >= MAX_BACKGROUNDS) throw new AlcoveApiError('conflict', `You can keep ${MAX_BACKGROUNDS} pictures. Remove one to add another.`);
  const jpeg = await prepare(file);
  requireAccess(owner, account);
  const id = replace ?? crypto.randomUUID();
  const nextRevision = replace ? crypto.randomUUID() : revision;
  const at = Date.now();
  const bytes = await jpeg.arrayBuffer();
  const src = await asDataUrl(jpeg);
  requireAccess(owner, account);
  while (true) {
    const key = snapshot.key ?? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    requireAccess(owner, account);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: placeOf(owner, id, at) }, key, bytes);
    requireAccess(owner, account);
    const kept: KeptBackground = { owner, id, at, sealed: { iv: iv.buffer, data } };
    const hadKey = snapshot.key !== null;
    const result = await transaction('readwrite', async (tx) => {
      const store = tx.objectStore(PICTURES);
      const [current, storedKey, count, allowed] = await Promise.all([
        generation(tx), ask(tx.objectStore(KEYS).get(KEYS)), ask(store.count(inAccount(owner))), pictureAccess(tx, owner, account)
      ]);
      if (!allowed || !mayAccess(owner, account)) return 'revoked';
      if (current !== revision) return 'changed';
      if (!replace && Number(count) >= MAX_BACKGROUNDS) return 'full';
      // Another first upload chose the key while this one was being sealed. Re-seal with that key, keeping this revision.
      if (!hadKey && storedKey instanceof CryptoKey) return 'retry';
      if (hadKey && !(storedKey instanceof CryptoKey)) return 'changed';
      // A newly made key and its first image commit together, so failures cannot leave an empty database's key behind.
      if (!hadKey) tx.objectStore(KEYS).put(key, KEYS);
      if (replace) {
        // A different revision revokes in-flight reads of the old picture, including ones in other tabs.
        tx.objectStore(KEYS).put(nextRevision, GENERATION);
        opened.clear();
      }
      store.put(kept);
      opened.set(openedKey(owner, id), { generation: nextRevision, src });
      return 'kept';
    });
    requireAccess(owner, account);
    if (result === 'kept') break;
    if (result === 'full') throw new AlcoveApiError('conflict', `You can keep ${MAX_BACKGROUNDS} pictures. Remove one to add another.`);
    if (result !== 'retry') throw backgroundsChanged();
    snapshot = await pictureSnapshot(owner, account);
    requireAccess(owner, account);
    if (!snapshot || snapshot.generation !== revision) throw backgroundsChanged();
  }
  blog.info('background kept', { bytes: jpeg.size, replaced: replace !== undefined });
  changed();
  return { id, src };
}

/** Deletes one of `owner`'s pictures from this browser. */
export async function removePicture(owner: string, id: string): Promise<void> {
  opened.delete(openedKey(owner, id));
  if (!canKeepBackgrounds()) return;
  await transaction('readwrite', async (tx) => {
    const store = tx.objectStore(PICTURES);
    tx.objectStore(KEYS).put(crypto.randomUUID(), GENERATION);
    store.delete([owner, id]);
    const left = Number(await ask(store.count()));
    if (left === 0) tx.objectStore(KEYS).delete(KEYS);
    opened.clear();
  });
  blog.info('background removed');
  changed();
}

/** Signing out or deleting the account here: every picture kept for `owner` goes, and with nobody's left, the key too. */
export async function forgetPictures(owner: string): Promise<void> {
  closePictures(owner);
  if (!canKeepBackgrounds()) return;
  let left = 0;
  await transaction('readwrite', async (tx) => {
    const store = tx.objectStore(PICTURES);
    tx.objectStore(KEYS).put(crypto.randomUUID(), GENERATION);
    tx.objectStore(KEYS).put(null, accountFence(owner));
    store.delete(inAccount(owner));
    left = Number(await ask(store.count()));
    if (left === 0) tx.objectStore(KEYS).delete(KEYS);
    opened.clear();
  });
  blog.info('deleted the backgrounds this device kept for an account', { others: left, keyDeleted: left === 0 });
  changed();
}

/* ---------- following them on screen ---------- */

const listeners = new Set<() => void>();
const updates = typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NAME);
updates?.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!DeviceGenerationSchema.safeParse(event.data).success) return;
  opened.clear();
  changed(false);
});
function changed(announce = true) {
  listeners.forEach((l) => l());
  if (announce) updates?.postMessage(crypto.randomUUID());
}

/** `owner`'s pictures (null while they're read), kept up to date as they're added and removed in this tab. */
export function useKeptPictures(owner: string | null): KeptPicture[] | null {
  const [snapshot, setSnapshot] = useState<{ owner: string | null; pictures: KeptPicture[] | null }>({ owner, pictures: owner ? null : [] });
  useEffect(() => {
    let active = true;
    let latest = 0;
    const read = () => {
      const current = ++latest;
      if (!owner) { setSnapshot({ owner, pictures: [] }); return; }
      const show = (pictures: KeptPicture[]) => { if (active && current === latest) setSnapshot({ owner, pictures }); };
      keptPictures(owner).then(show, (e: unknown) => { blog.warn('backgrounds not read', { err: e }); show([]); });
    };
    read();
    listeners.add(read);
    return () => { active = false; listeners.delete(read); };
  }, [owner]);
  return snapshot.owner === owner ? snapshot.pictures : owner ? null : [];
}

/** Whose pictures can show behind the camera in a call: the account signed in here, once that's known, or none for a guest (null). */
export function useBackgroundsOf(media: LocalMedia, owner: string | null | undefined): void {
  useEffect(() => { if (owner !== undefined) media.setAccount(owner); }, [media, owner]);
}
