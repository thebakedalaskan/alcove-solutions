/*
 * Room recordings kept on this device until they upload (docs: Calls and recordings › Recording without a
 * connection). While a recording on the stage can't reach Alcove, its audio pieces and speech clips are kept here, in
 * IndexedDB, exactly as they would have been sent; uploads.ts sends them once there's a connection and deletes them
 * here only after the recording has stopped on Alcove.
 *
 * Nothing readable is kept in the clear. The name, the audio and the speech are sealed with AES-GCM under a key made
 * on this device that can't be exported (it never leaves this browser, Alcove included), with a fresh IV for each
 * item and the item's place bound in (which recording, which piece or clip), so nothing can pass for something else.
 * In the clear: opaque IDs, times, lengths, sizes and the codec. Signing out or deleting the account here deletes what
 * was kept for that account; another account's stays sealed until it signs in here again, and the key goes with the last.
 *
 * Whoever records or uploads a kept recording holds its lock (Web Locks) throughout, so two tabs never upload the same
 * one and nothing uploads a recording that's still being recorded. A tab that closes lets go of its locks.
 */
import {
  AlcoveApiError, KeptClipSchema, KeptPieceSchema, KeptRecordingSchema,
  type AudioPiece, type DeviceSealed, type KeptClip, type KeptPiece, type KeptRecording, type KeptState, type TranscriptClip
} from '@alcove/api';
import { log } from '~/lib/log';

const olog = log.child({ component: 'offline' });

const NAME = 'alcove-offline';
const KEY = 'device';
const LOCK = 'alcove-kept:';

/** Whether this browser can keep recordings: IndexedDB, Web Crypto and Web Locks, which need a secure page. */
export const canKeep = (): boolean => typeof indexedDB !== 'undefined' && isSecureContext && 'locks' in navigator;

/** This device has no room left for what the recording needs to keep. */
export class DeviceFull extends Error {
  constructor(cause: unknown) {
    super('There’s no space left on this device to save the recording.', { cause });
    this.name = 'DeviceFull';
  }
}
const isQuota = (e: unknown) => e instanceof DOMException && e.name === 'QuotaExceededError';

/**
 * Something kept won't open on this device: its key is gone, or it was damaged. It's never stopped or deleted by the
 * uploads. With the key gone nothing of it is sent; with one item damaged, what came before it may already be on Alcove.
 */
export class Unreadable extends Error {
  constructor(what: string, cause: unknown) {
    super(`A kept ${what} can’t be opened on this device.`, { cause });
    this.name = 'Unreadable';
  }
}

/** `p`, or a network failure ("Alcove took too long to answer") after `ms`: nothing waits on Alcove for ever. */
export function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new AlcoveApiError('network', 'Alcove took too long to answer.')), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/* ---------- the database ---------- */

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (opening) return opening;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore(KEY);
      d.createObjectStore('recordings', { keyPath: 'id' });
      d.createObjectStore('pieces', { keyPath: ['rec', 'seq'] });
      d.createObjectStore('clips', { keyPath: ['rec', 'atMs'] });
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

/** A request's result, once it succeeds. */
function ask(r: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function keysOf(r: IDBRequest<IDBValidKey[]>): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
/** Resolves once the transaction has committed. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('The change wasn’t saved.', 'AbortError'));
  });
}
/**
 * One change, all or nothing. `fill` may only wait on this transaction's own requests (anything else lets it
 * commit early). A full device is a DeviceFull.
 */
async function change(stores: string[], fill: (tx: IDBTransaction) => Promise<void>): Promise<void> {
  const tx = (await db()).transaction(stores, 'readwrite');
  const committed = done(tx);
  try {
    await fill(tx);
    await committed;
  } catch (e) {
    try { tx.abort(); } catch { /* it had already finished */ }
    committed.catch(() => undefined);
    throw isQuota(e) || isQuota(tx.error) ? new DeviceFull(e) : e;
  }
}
const range = (rec: string) => IDBKeyRange.bound([rec, 0], [rec, Number.MAX_SAFE_INTEGER]);
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* ---------- sealing ---------- */

const text = new TextEncoder();
/** Where an item belongs, bound into its seal. */
const place = (kind: 'title' | 'piece' | 'clip', rec: string, at = '') => text.encode(`alcove/kept/v1\n${kind}\n${rec}\n${at}`);

let keying: Promise<CryptoKey> | null = null;
/** This device's key: made the first time it's needed, kept in IndexedDB, and never exportable. */
function deviceKey(): Promise<CryptoKey> {
  if (keying) return keying;
  const p = (async () => {
    const d = await db();
    const have = await ask(d.transaction(KEY).objectStore(KEY).get(KEY));
    if (have instanceof CryptoKey) return have;
    const made = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    // Another tab may have made one meanwhile: the first one stored is everyone's.
    let key = made;
    await change([KEY], async (tx) => {
      const first = await ask(tx.objectStore(KEY).get(KEY));
      if (first instanceof CryptoKey) key = first;
      else tx.objectStore(KEY).put(made, KEY);
    });
    olog.info('made this device’s key for keeping recordings');
    return key;
  })();
  keying = p;
  p.catch(() => { if (keying === p) keying = null; });
  return p;
}
async function seal(bytes: BufferSource, aad: Uint8Array<ArrayBuffer>): Promise<DeviceSealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await deviceKey(), bytes);
  return { iv: iv.buffer, data };
}
async function unseal(s: DeviceSealed, aad: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv, additionalData: aad }, await deviceKey(), s.data);
}

/* ---------- telling every tab ---------- */

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null | undefined;
function bus(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('alcove-kept');
    channel?.addEventListener('message', (e: MessageEvent<unknown>) => {
      // Everything was deleted in another tab, the key too: this tab's copy of the key is no good any more.
      if (e.data === 'forgotten') keying = null;
      for (const l of listeners) l();
    });
  }
  return channel;
}
function changed(what: 'changed' | 'forgotten' = 'changed') {
  for (const l of listeners) l();
  bus()?.postMessage(what);
}
/** Hears every change to the recordings kept here, in this tab or another. */
export function onKeptChange(l: () => void): () => void {
  bus();
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/* ---------- locks ---------- */

export type Release = () => void;
/**
 * Takes the lock on kept recording `id`, which whoever records or uploads it holds throughout: at once or not at all
 * (`wait` false), or waiting up to `wait` ms. Null when someone else has it. Letting go of it tells every tab, since
 * how the recording stands has changed.
 */
export function takeLock(id: string, wait: number | false): Promise<Release | null> {
  return new Promise((resolve, reject) => {
    const options: LockOptions = wait === false ? { ifAvailable: true } : { signal: AbortSignal.timeout(wait) };
    let held = false;
    navigator.locks.request(`${LOCK}${id}`, options, (lock) => {
      if (!lock) { resolve(null); return undefined; }
      held = true;
      return new Promise<void>((release) => { resolve(() => release()); });
    }).then(() => { if (held) changed(); }, (e: unknown) => {
      if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError')) resolve(null);
      else reject(e);
    });
  });
}
/** The kept recordings someone holds now (recording or uploading them), in this tab or another. */
export async function heldNow(): Promise<Set<string>> {
  if (!('locks' in navigator)) return new Set();
  const s = await navigator.locks.query();
  return new Set((s.held ?? []).flatMap((l) => (l.name?.startsWith(LOCK) ? [l.name.slice(LOCK.length)] : [])));
}

/* ---------- keeping ---------- */

let asked = false;
/** Asks once that the browser not clear this site's storage when it's short of space, now that a recording depends on it. */
function stayPut() {
  if (asked) return;
  asked = true;
  navigator.storage.persist().then((granted) => olog.info('asked the browser to keep this site’s storage', { granted }), (e: unknown) => olog.debug('couldn’t ask the browser to keep this site’s storage', { err: e }));
}

/** Starts keeping a recording here: its name and start, before anything of it is kept. `tried`: Alcove is asked to start it now. */
export async function keepRecording(r: { id: string; owner: string; startedAt: string; title: string; tried: boolean }): Promise<void> {
  const k: KeptRecording = {
    id: r.id, owner: r.owner, startedAt: r.startedAt, state: 'recording', seconds: 0, bytes: 0, server: null, tried: r.tried, unreadable: false, problem: null,
    title: await seal(text.encode(r.title), place('title', r.id))
  };
  await change(['recordings'], async (tx) => { tx.objectStore('recordings').put(k); });
  olog.info('keeping a recording on this device', { id: r.id });
  changed();
}

/** Keeps one item in a kept recording, with what it adds. False when the recording isn't kept here any more. */
async function keepItem(rec: string, store: 'pieces' | 'clips', item: KeptPiece | KeptClip, end: number): Promise<boolean> {
  let kept = false;
  await change(['recordings', store], async (tx) => {
    const r = KeptRecordingSchema.safeParse(await ask(tx.objectStore('recordings').get(rec)));
    if (!r.success || r.data.state === 'discarded') return;
    tx.objectStore(store).put(item);
    tx.objectStore('recordings').put({ ...r.data, bytes: r.data.bytes + item.sealed.data.byteLength, seconds: Math.max(r.data.seconds, end) });
    kept = true;
  });
  if (kept) { stayPut(); changed(); }
  return kept;
}

/** Keeps a piece of the recording's audio, as it would have been sent. False when the recording isn't kept here any more. */
export async function keepPiece(rec: string, p: AudioPiece): Promise<boolean> {
  const sealed = await seal(await p.data.arrayBuffer(), place('piece', rec, `${p.segment}:${p.seq}`));
  const ok = await keepItem(rec, 'pieces', { rec, segment: p.segment, seq: p.seq, at: p.at, durationMs: p.durationMs, mimeType: p.mimeType, sealed }, p.at + p.durationMs / 1000);
  olog.debug(ok ? 'audio piece kept on this device' : 'audio piece not kept: the recording isn’t kept here any more', { id: rec, seq: p.seq, bytes: p.data.size });
  return ok;
}

/** Keeps a clip of speech to transcribe later. False when the recording isn't kept here any more. */
export async function keepClip(rec: string, c: TranscriptClip): Promise<boolean> {
  const atMs = Math.round(c.at * 1000);
  const sealed = await seal(await c.data.arrayBuffer(), place('clip', rec, `${c.segment}:${atMs}`));
  const ok = await keepItem(rec, 'clips', { rec, segment: c.segment, atMs, at: c.at, durationMs: c.durationMs, sealed }, c.at + c.durationMs / 1000);
  olog.debug(ok ? 'speech clip kept on this device' : 'speech clip not kept: the recording isn’t kept here any more', { id: rec, atMs, bytes: c.data.size });
  return ok;
}

/**
 * Changes what's known about a kept recording: its name, state, length, its start (Alcove's, once it started there
 * live), its recording on Alcove, that Alcove was asked to start it, that it won't open here, or why Alcove refused it.
 */
export async function updateKept(rec: string, to: {
  title?: string; state?: KeptState; seconds?: number; startedAt?: string; server?: string; tried?: boolean; unreadable?: boolean; problem?: string | null;
}): Promise<void> {
  const title = to.title === undefined ? undefined : await seal(text.encode(to.title), place('title', rec));
  await change(['recordings'], async (tx) => {
    const s = tx.objectStore('recordings');
    const r = KeptRecordingSchema.safeParse(await ask(s.get(rec)));
    if (!r.success) return;
    const next: KeptRecording = {
      ...r.data,
      ...(title ? { title } : {}),
      ...(to.state ? { state: to.state } : {}),
      ...(to.seconds === undefined ? {} : { seconds: Math.max(r.data.seconds, to.seconds) }),
      ...(to.startedAt === undefined ? {} : { startedAt: to.startedAt }),
      ...(to.server === undefined ? {} : { server: to.server }),
      ...(to.tried === undefined ? {} : { tried: to.tried }),
      ...(to.unreadable === undefined ? {} : { unreadable: to.unreadable }),
      ...(to.problem === undefined ? {} : { problem: to.problem?.slice(0, 500) ?? null })
    };
    s.put(next);
  });
  changed();
}

/* ---------- reading ---------- */

/** A kept recording as the app shows it: its name opened (or `unreadable`, when it won't open here). */
export interface KeptSummary {
  id: string; owner: string; startedAt: string; state: KeptState; seconds: number; bytes: number; server: string | null; tried: boolean;
  unreadable: boolean; problem: string | null; title: string;
}

async function opened(k: KeptRecording): Promise<KeptSummary> {
  let title = '';
  let unreadable = k.unreadable;
  try { title = new TextDecoder().decode(await unseal(k.title, place('title', k.id))); } catch (e) {
    unreadable = true;
    olog.error('a kept recording’s name didn’t open', { id: k.id, err: e });
  }
  return {
    id: k.id, owner: k.owner, startedAt: k.startedAt, state: k.state, seconds: k.seconds, bytes: k.bytes, server: k.server, tried: k.tried,
    unreadable, problem: k.problem, title
  };
}

/** `owner`'s recordings kept here, the oldest first. */
export async function keptRecordings(owner: string): Promise<KeptSummary[]> {
  const all = await ask((await db()).transaction('recordings').objectStore('recordings').getAll());
  const mine = listOf(all).flatMap((v) => { const r = KeptRecordingSchema.safeParse(v); return r.success && r.data.owner === owner ? [r.data] : []; });
  mine.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return Promise.all(mine.map(opened));
}

export async function keptRecording(id: string): Promise<KeptSummary | null> {
  const r = KeptRecordingSchema.safeParse(await ask((await db()).transaction('recordings').objectStore('recordings').get(id)));
  return r.success ? opened(r.data) : null;
}

/**
 * A kept recording's audio pieces, in order, opened one at a time. One that's damaged or won't open is an Unreadable,
 * so the recording never stops without it. One deleted meanwhile (only signing out here does that) is passed over.
 */
export async function* keptPieces(rec: string): AsyncGenerator<AudioPiece> {
  const keys = await keysOf((await db()).transaction('pieces').objectStore('pieces').getAllKeys(range(rec)));
  for (const key of keys) {
    const v = await ask((await db()).transaction('pieces').objectStore('pieces').get(key));
    if (v === undefined) continue;
    const r = KeptPieceSchema.safeParse(v);
    if (!r.success) {
      olog.error('a kept audio piece is damaged', { id: rec, err: r.error });
      throw new Unreadable('piece of audio', r.error);
    }
    const p = r.data;
    let bytes: ArrayBuffer;
    try { bytes = await unseal(p.sealed, place('piece', rec, `${p.segment}:${p.seq}`)); } catch (e) {
      olog.error('a kept audio piece didn’t open', { id: rec, seq: p.seq, err: e });
      throw new Unreadable('piece of audio', e);
    }
    yield { data: new Blob([bytes], { type: p.mimeType }), segment: p.segment, seq: p.seq, at: p.at, durationMs: p.durationMs, mimeType: p.mimeType };
  }
}

/** A kept recording's clips of speech, in the order they were said, opened one at a time, as keptPieces does. */
export async function* keptClips(rec: string): AsyncGenerator<TranscriptClip> {
  const keys = await keysOf((await db()).transaction('clips').objectStore('clips').getAllKeys(range(rec)));
  for (const key of keys) {
    const v = await ask((await db()).transaction('clips').objectStore('clips').get(key));
    if (v === undefined) continue;
    const r = KeptClipSchema.safeParse(v);
    if (!r.success) {
      olog.error('a kept speech clip is damaged', { id: rec, err: r.error });
      throw new Unreadable('clip of speech', r.error);
    }
    const c = r.data;
    let bytes: ArrayBuffer;
    try { bytes = await unseal(c.sealed, place('clip', rec, `${c.segment}:${c.atMs}`)); } catch (e) {
      olog.error('a kept speech clip didn’t open', { id: rec, atMs: c.atMs, err: e });
      throw new Unreadable('clip of speech', e);
    }
    yield { data: new Blob([bytes], { type: 'audio/wav' }), segment: c.segment, at: c.at, durationMs: c.durationMs };
  }
}

/* ---------- deleting ---------- */

function deleteItems(tx: IDBTransaction, rec: string) {
  tx.objectStore('pieces').delete(range(rec));
  tx.objectStore('clips').delete(range(rec));
}

/** Deletes a kept recording and everything kept of it: it uploaded, or there's nothing of it to upload. */
export async function forgetKept(rec: string): Promise<void> {
  await change(['recordings', 'pieces', 'clips'], async (tx) => { tx.objectStore('recordings').delete(rec); deleteItems(tx, rec); });
  olog.info('a kept recording is no longer on this device', { id: rec });
  changed();
}

/**
 * Throws a kept recording away: its audio and speech are deleted at once, and what's left says only that whatever
 * reached Alcove of it is deleted there when there's a connection (uploads.ts).
 */
export async function dropKept(rec: string): Promise<void> {
  await change(['recordings', 'pieces', 'clips'], async (tx) => {
    const s = tx.objectStore('recordings');
    const r = KeptRecordingSchema.safeParse(await ask(s.get(rec)));
    if (r.success) s.put({ ...r.data, state: 'discarded', bytes: 0 });
    deleteItems(tx, rec);
  });
  olog.info('a kept recording was discarded; Alcove’s copy goes when there’s a connection', { id: rec });
  changed();
}

/**
 * Signing out or deleting the account here: everything kept for `owner` is deleted, and anything that can't be read as
 * anyone's. Other accounts' recordings stay sealed for when they sign in here again, and the key stays with them;
 * with none left, the key goes too.
 */
export async function forgetAccount(owner: string): Promise<void> {
  if (!canKeep()) return;
  let others = 0;
  await change([KEY, 'recordings', 'pieces', 'clips'], async (tx) => {
    const s = tx.objectStore('recordings');
    const ids = await keysOf(s.getAllKeys());
    const rows = listOf(await ask(s.getAll()));
    ids.forEach((id, i) => {
      const r = KeptRecordingSchema.safeParse(rows[i]);
      if (r.success && r.data.owner !== owner) { others++; return; }
      s.delete(id);
      if (typeof id === 'string') deleteItems(tx, id);
    });
    if (others === 0) for (const name of [KEY, 'pieces', 'clips']) tx.objectStore(name).clear();
  });
  if (others === 0) keying = null;
  olog.info('deleted what this device kept for an account', { others, keyDeleted: others === 0 });
  changed(others === 0 ? 'forgotten' : 'changed');
}
