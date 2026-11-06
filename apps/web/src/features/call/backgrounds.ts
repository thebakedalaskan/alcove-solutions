/*
 * What can show behind someone on camera: Alcove's own pictures, and pictures they add themselves. Those stay in this
 * browser: each is made into a 1920×1080 JPEG here and sealed, as edits and recordings kept on this device are
 * (workspace/keep.ts), with AES-GCM under a key made on this device that can't be exported, a fresh IV each time and
 * whose picture it is bound in. They're never sent anywhere; only the picture with someone in front of it reaches a
 * call. Signing out or deleting the account here deletes them, and the key goes with the last.
 */
import { AlcoveApiError, BACKGROUND_SCENES, KeptBackgroundSchema, type BackgroundScene, type KeptBackground } from '@alcove/api';
import { SCENE_PICTURES } from '@alcove/ui';
import { useCallback, useEffect, useState } from 'react';
import { log } from '~/lib/log';
import { signedOut } from '~/lib/signedOut';

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
/** One change, all or nothing. `fill` may only wait on this transaction's own requests. */
async function change(stores: string[], fill: (tx: IDBTransaction) => Promise<void> | void): Promise<void> {
  const tx = (await db()).transaction(stores, 'readwrite');
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('The change wasn’t saved.', 'AbortError'));
  });
  await fill(tx);
  await committed;
}
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const inAccount = (owner: string) => IDBKeyRange.bound([owner], [owner, []]);

/* ---------- sealing ---------- */

/** This device's key: made the first time it's needed, kept in IndexedDB, and never exportable. Read each time: signing out in another tab may have deleted it. */
async function deviceKey(): Promise<CryptoKey> {
  const have = await ask((await db()).transaction(KEYS).objectStore(KEYS).get(KEYS));
  if (have instanceof CryptoKey) return have;
  const made = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // Another tab may have made one meanwhile: the first one stored is everyone's.
  let key = made;
  await change([KEYS], async (tx) => {
    const first = await ask(tx.objectStore(KEYS).get(KEYS));
    if (first instanceof CryptoKey) key = first;
    else tx.objectStore(KEYS).put(made, KEYS);
  });
  return key;
}
const placeOf = (owner: string, id: string, at: number) => new TextEncoder().encode(`alcove/kept-background/v1\n${owner}\n${id}\n${at}`);

/* ---------- pictures ---------- */

/** A picture someone keeps here, ready to show: its ID and the picture as a data: URL (the page's policy allows those for images). */
export interface KeptPicture { id: string; src: string }

/** Pictures opened once in this tab, by account and ID: opening one means reading and unsealing a megabyte or so. */
const opened = new Map<string, string>();
const openedKey = (owner: string, id: string) => `${owner}\n${id}`;

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === 'string' ? resolve(r.result) : reject(new Error('The picture didn’t read as a URL.')));
    r.onerror = () => reject(r.error ?? new Error('The picture didn’t read.'));
    r.readAsDataURL(blob);
  });
}
async function unseal(owner: string, kept: KeptBackground, key: CryptoKey): Promise<KeptPicture> {
  const have = opened.get(openedKey(owner, kept.id));
  if (have) return { id: kept.id, src: have };
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: kept.sealed.iv, additionalData: placeOf(owner, kept.id, kept.at) }, key, kept.sealed.data);
  const src = await asDataUrl(new Blob([bytes], { type: 'image/jpeg' }));
  opened.set(openedKey(owner, kept.id), src);
  return { id: kept.id, src };
}

/** Every picture `owner` keeps here, the first added first. One that's damaged is left out and logged. */
export async function keptPictures(owner: string): Promise<KeptPicture[]> {
  if (!canKeepBackgrounds() || signedOut(owner)) return [];
  const rows = listOf(await ask((await db()).transaction(PICTURES).objectStore(PICTURES).getAll(inAccount(owner))));
  const kept: KeptBackground[] = [];
  for (const row of rows) {
    const r = KeptBackgroundSchema.safeParse(row);
    if (r.success) kept.push(r.data);
    else blog.error('a kept background is damaged', { err: r.error });
  }
  if (!kept.length) return [];
  const key = await deviceKey();
  const out: KeptPicture[] = [];
  for (const k of kept.sort((a, b) => a.at - b.at)) {
    try { out.push(await unseal(owner, k, key)); } catch (e) { blog.error('a kept background didn’t open', { err: e }); }
  }
  return out;
}

/** One picture `owner` keeps here, as a data: URL, or null when it isn't here (deleted, or kept for someone else). */
export async function keptPicture(owner: string, id: string): Promise<string | null> {
  const have = opened.get(openedKey(owner, id));
  if (have) return have;
  if (!canKeepBackgrounds() || signedOut(owner)) return null;
  const row = await ask((await db()).transaction(PICTURES).objectStore(PICTURES).get([owner, id]));
  if (row === undefined) return null;
  const r = KeptBackgroundSchema.safeParse(row);
  if (!r.success) { blog.error('a kept background is damaged', { err: r.error }); return null; }
  return (await unseal(owner, r.data, await deviceKey())).src;
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

/** Keeps the picture in `file` for `owner`, sealed, and gives it back ready to show. */
export async function keepPicture(owner: string, file: File): Promise<KeptPicture> {
  if (!canKeepBackgrounds()) throw new AlcoveApiError('unavailable', 'This browser can’t keep pictures, so you can’t add your own here.');
  if (signedOut(owner)) throw new AlcoveApiError('unauthenticated', 'This account signed out here, so nothing more is kept for it.');
  if (!isAccepted(file.type)) throw new AlcoveApiError('invalid', 'Pick a JPEG, PNG or WebP picture.');
  if (file.size > MAX_FILE) throw new AlcoveApiError('too-large', 'That picture is over 20 MB. Pick a smaller one.');
  const count = Number(await ask((await db()).transaction(PICTURES).objectStore(PICTURES).count(inAccount(owner))));
  if (count >= MAX_BACKGROUNDS) throw new AlcoveApiError('conflict', `You can keep ${MAX_BACKGROUNDS} pictures. Remove one to add another.`);
  const jpeg = await prepare(file);
  const id = crypto.randomUUID();
  const at = Date.now();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: placeOf(owner, id, at) }, await deviceKey(), await jpeg.arrayBuffer());
  const kept: KeptBackground = { owner, id, at, sealed: { iv: iv.buffer, data } };
  await change([PICTURES], (tx) => { tx.objectStore(PICTURES).put(kept); });
  const src = await asDataUrl(jpeg);
  opened.set(openedKey(owner, id), src);
  blog.info('background kept', { bytes: jpeg.size });
  changed();
  return { id, src };
}

/** Deletes one of `owner`'s pictures from this browser. */
export async function removePicture(owner: string, id: string): Promise<void> {
  opened.delete(openedKey(owner, id));
  if (!canKeepBackgrounds()) return;
  await change([PICTURES], (tx) => { tx.objectStore(PICTURES).delete([owner, id]); });
  blog.info('background removed');
  changed();
}

/** Signing out or deleting the account here: every picture kept for `owner` goes, and with nobody's left, the key too. */
export async function forgetPictures(owner: string): Promise<void> {
  for (const k of [...opened.keys()]) if (k.startsWith(`${owner}\n`)) opened.delete(k);
  if (!canKeepBackgrounds()) return;
  let left = 0;
  await change([KEYS, PICTURES], async (tx) => {
    const store = tx.objectStore(PICTURES);
    store.delete(inAccount(owner));
    left = Number(await ask(store.count()));
    if (left === 0) tx.objectStore(KEYS).clear();
  });
  blog.info('deleted the backgrounds this device kept for an account', { others: left, keyDeleted: left === 0 });
  changed();
}

/* ---------- following them on screen ---------- */

const listeners = new Set<() => void>();
function changed() { listeners.forEach((l) => l()); }

/** `owner`'s pictures (null while they're read), kept up to date as they're added and removed in this tab. */
export function useKeptPictures(owner: string | null): KeptPicture[] | null {
  const [pictures, setPictures] = useState<KeptPicture[] | null>(owner ? null : []);
  const read = useCallback(() => {
    if (!owner) { setPictures([]); return; }
    keptPictures(owner).then(setPictures, (e: unknown) => { blog.warn('backgrounds not read', { err: e }); setPictures([]); });
  }, [owner]);
  useEffect(() => {
    read();
    listeners.add(read);
    return () => { listeners.delete(read); };
  }, [read]);
  return pictures;
}
