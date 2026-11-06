/*
 * A version of a document, to look at: a Y.Doc of its own, with nothing connected to it, and which blocks are different from
 * the version before. It shows what was stored: a photo, video or file still on its way when the version was kept, or one
 * that never got there, isn't part of what the document said. It loads Yjs, so import it when a version opens.
 */
import { DOC_FRAGMENT } from '@alcove/api';
import { isGone } from '@alcove/api/retire';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

export interface OpenVersion { doc: Y.Doc; awareness: Awareness; changed: ReadonlySet<string>; close: () => void }

/** What a block says while its files are on their way, or once they didn't get there. */
const UPLOADING = ['up', 'failed', 'upload'] as const;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isSet = (v: unknown) => v !== undefined && v !== null;
const isStored = (v: unknown) => typeof v === 'string' && v.length > 0;

/** Takes out what was being uploaded: a block keeps the files it had stored, and one with none goes. */
function withoutUploads(doc: Y.Doc): void {
  const fragment = doc.getXmlFragment(DOC_FRAGMENT);
  doc.transact(() => {
    for (let i = fragment.length - 1; i >= 0; i--) {
      const el = fragment.get(i);
      if (!(el instanceof Y.XmlElement) || !(isSet(el.getAttribute('up')) || isSet(el.getAttribute('failed')))) continue;
      const items: unknown = el.getAttribute('items');
      const kept = el.nodeName === 'gallery' && Array.isArray(items) ? items.filter((item: unknown) => isRecord(item) && isStored(item['media'])) : null;
      if (kept ? kept.length === 0 : !isStored(el.getAttribute('media'))) { fragment.delete(i, 1); continue; }
      if (kept) setItems(el, kept);
      for (const key of UPLOADING) if (el.getAttribute(key) !== undefined) el.removeAttribute(key);
    }
  });
}
/** Attributes hold more than the strings Yjs's types say they do. */
const setItems = (el: { setAttribute(key: string, value: unknown): void }, items: unknown[]) => { el.setAttribute('items', items); };

/** Every block on the page, by ID, as what it says and what it is. */
function blocksOf(doc: Y.Doc): Map<unknown, string> {
  const out = new Map<unknown, string>();
  for (const el of doc.getXmlFragment(DOC_FRAGMENT).toArray()) {
    if (el instanceof Y.XmlElement && el.nodeName !== 'title' && !isGone(el)) out.set(el.getAttribute('id'), el.toString());
  }
  return out;
}

/** Opens `update`. With `before`, what's new or different since then is `changed`. */
export function openVersion(update: Uint8Array, before: Uint8Array | null): OpenVersion {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  withoutUploads(doc);
  const changed = new Set<string>();
  if (before) {
    const earlier = new Y.Doc();
    Y.applyUpdate(earlier, before);
    withoutUploads(earlier);
    const was = blocksOf(earlier);
    earlier.destroy();
    for (const [id, block] of blocksOf(doc)) if (typeof id === 'string' && was.get(id) !== block) changed.add(id);
  }
  const awareness = new Awareness(doc);
  return { doc, awareness, changed, close: () => { awareness.destroy(); doc.destroy(); } };
}
