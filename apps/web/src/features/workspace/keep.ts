/*
 * Edits this browser hasn't got to Alcove yet (docs: Data and storage › Documents), so what's written offline survives a
 * reload and sends on return. A document's session keeps each update here until Alcove has it; `keptDocuments` says which
 * documents have something waiting, so it sends even if that document isn't opened again.
 *
 * As with recordings kept on this device (features/record/offline.ts), nothing readable is kept in the clear. An update is
 * sealed with AES-GCM under a key made on this device that can't be exported, with a fresh IV each time and the update's
 * place bound in (which account, workspace and document, and its order), so nothing can pass for something else. In the
 * clear: opaque IDs, the order and sizes. It's its own database and key: an old tab that has the recordings' database open
 * never has to give way to this one. Signing out or deleting the account here deletes what was kept for it; another
 * account's stays sealed until it signs in here again, and the key goes with the last. Once an account signs out here, in
 * this tab or another, nothing more is kept for it: a tab closing afterwards can't bring its words, or the key, back.
 */
import { AlcoveApiError, KeptEditSchema, type KeptEdit, type KeptUpdate, type KeptUpdates } from '@alcove/api';
import { log } from '~/lib/log';
import { signedOut } from '~/lib/signedOut';

const klog = log.child({ component: 'workspace-keep' });

const NAME = 'alcove-edits';
const KEYS = 'device';
const EDITS = 'edits';

/** Whether this browser can keep edits: IndexedDB and Web Crypto, which need a secure page. */
export const canKeepEdits = (): boolean => typeof indexedDB !== 'undefined' && isSecureContext;

/* ---------- the database ---------- */

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (opening) return opening;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(KEYS);
      r.result.createObjectStore(EDITS, { keyPath: ['owner', 'workspace', 'document', 'key'] });
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
/** Every update kept for one document, or for one account. */
const inDocument = (owner: string, workspace: string, document: string) => IDBKeyRange.bound([owner, workspace, document, 0], [owner, workspace, document, Number.MAX_SAFE_INTEGER]);
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
const placeOf = (owner: string, workspace: string, document: string, key: number) => new TextEncoder().encode(`alcove/kept-edit/v1\n${owner}\n${workspace}\n${document}\n${key}`);

/* ---------- keeping ---------- */

let last = 0;
/** Later than anything kept here before: an update's key is also its place in the order. */
const nextKey = (): number => { last = Math.max(last + 1, Date.now() * 1000); return last; };

/** Where a session keeps what Alcove doesn't have yet, for one document in one account. */
export function keptUpdates(owner: string, workspace: string, document: string): KeptUpdates {
  return {
    load: async () => {
      if (signedOut(owner)) return [];
      const rows = listOf(await ask((await db()).transaction(EDITS).objectStore(EDITS).getAll(inDocument(owner, workspace, document))));
      const key = await deviceKey();
      const out: KeptUpdate[] = [];
      for (const row of rows) {
        const edit = KeptEditSchema.safeParse(row);
        if (!edit.success) { klog.error('a kept edit is damaged', { workspace, document, err: edit.error }); continue; }
        const { sealed, key: at } = edit.data;
        try {
          const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: placeOf(owner, workspace, document, at) }, key, sealed.data);
          out.push({ key: at, update: new Uint8Array(bytes) });
        } catch (e) {
          klog.error('a kept edit didn’t open', { workspace, document, err: e });
        }
      }
      return out;
    },
    add: async (update, at) => {
      if (signedOut(owner)) throw new AlcoveApiError('unauthenticated', 'This account signed out here, so nothing more is kept for it.');
      const order = nextKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: placeOf(owner, workspace, document, at) }, await deviceKey(), new Uint8Array(update));
      const edit: KeptEdit = { owner, workspace, document, key: at, sealed: { iv: iv.buffer, data } };
      await change([EDITS], (tx) => { tx.objectStore(EDITS).put(edit); });
      return at;
    },
    remove: async (keys) => {
      await change([EDITS], (tx) => { for (const k of keys) tx.objectStore(EDITS).delete([owner, workspace, document, k]); });
    }
  };
}

/** The documents `owner` has edits waiting in, for sending them. */
export async function keptDocuments(owner: string): Promise<{ workspace: string; document: string }[]> {
  if (!canKeepEdits() || signedOut(owner)) return [];
  const rows = listOf(await ask((await db()).transaction(EDITS).objectStore(EDITS).getAll(inAccount(owner))));
  const found = new Map<string, { workspace: string; document: string }>();
  for (const row of rows) {
    const edit = KeptEditSchema.safeParse(row);
    if (edit.success) found.set(`${edit.data.workspace}/${edit.data.document}`, { workspace: edit.data.workspace, document: edit.data.document });
  }
  return [...found.values()];
}

/** Signing out or deleting the account here: everything kept for `owner` goes, and with nobody's left, the key too. */
export async function forgetEdits(owner: string): Promise<void> {
  if (!canKeepEdits()) return;
  let left = 0;
  await change([KEYS, EDITS], async (tx) => {
    const store = tx.objectStore(EDITS);
    store.delete(inAccount(owner));
    left = Number(await ask(store.count()));
    if (left === 0) tx.objectStore(KEYS).clear();
  });
  klog.info('deleted the edits this device kept for an account', { others: left, keyDeleted: left === 0 });
}
