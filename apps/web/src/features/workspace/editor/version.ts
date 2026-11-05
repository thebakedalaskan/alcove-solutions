/*
 * A version of a document, to look at: a Y.Doc of its own, with nothing connected to it, and which blocks are different from
 * the version before. It loads Yjs, so import it when a version opens.
 */
import { DOC_FRAGMENT } from '@alcove/api';
import { isGone } from '@alcove/api/retire';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

export interface OpenVersion { doc: Y.Doc; awareness: Awareness; changed: ReadonlySet<string>; close: () => void }

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
  const changed = new Set<string>();
  if (before) {
    const earlier = new Y.Doc();
    Y.applyUpdate(earlier, before);
    const was = blocksOf(earlier);
    earlier.destroy();
    for (const [id, block] of blocksOf(doc)) if (typeof id === 'string' && was.get(id) !== block) changed.add(id);
  }
  const awareness = new Awareness(doc);
  return { doc, awareness, changed, close: () => { awareness.destroy(); doc.destroy(); } };
}
