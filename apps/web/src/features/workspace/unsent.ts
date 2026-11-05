/*
 * SEAM, until feat/ws-docs-2 is on main (see session.ts): what that fix round adds to a document's session, worked out here
 * from main's, the same way it does it, and what's kept held through what main's lets go of and it doesn't. It holds Yjs,
 * so it only loads with a document, through `openDocument`.
 *
 * `unsent` is read from main's status, which says `saving`, `offline` or `failed` while something hasn't reached Alcove. It
 * can say so for a document that was offline with nothing written: then what's offered is a copy of what Alcove has, which
 * costs nothing. It never says nothing's waiting when something is, which is the way that would trap someone's words.
 */
import { DOC_FRAGMENT, type DocSession as SessionNow, type DocStatus as StatusNow, type KeptUpdates } from '@alcove/api';
import { TAGS, isGone, newBlockId } from '@alcove/api/retire';
import * as Y from 'yjs';
import type { DocLocalCopy, DocSession, DocStatus } from './session';

/** How many items something is, with what's in it, leaving out what's deleted. Walked with a list: nothing says how deep it goes. */
function liveItems(top: Y.Item): number {
  let count = 0;
  const waiting = [top];
  for (let item = waiting.pop(); item; item = waiting.pop()) {
    if (item.deleted) continue;
    count += 1;
    if (!(item.content instanceof Y.ContentType)) continue;
    const { type } = item.content;
    for (let child = type._start; child; child = child.right) waiting.push(child);
    waiting.push(...type._map.values());
  }
  return count;
}

/** How many items a document's page comes to: everything it holds but what's deleted and what's in a retired block. */
function itemsOnPage(doc: Y.Doc): number {
  let count = 0;
  for (const structs of doc.store.clients.values()) for (const struct of structs) if (struct instanceof Y.Item && !struct.deleted) count += 1;
  for (let item = doc.share.get(DOC_FRAGMENT)?._start ?? null; item; item = item.right) {
    if (item.deleted || !(item.content instanceof Y.ContentType)) continue;
    const { type } = item.content;
    if (type instanceof Y.XmlElement && isGone(type)) count -= liveItems(item);
  }
  return count;
}

/** The words in a line, or anything else that holds them. */
function wordsIn(type: Y.XmlFragment): string {
  return type.toArray().map((child) => {
    if (child instanceof Y.XmlText) {
      let words = '';
      for (let item = child._start; item; item = item.right) if (!item.deleted && item.content instanceof Y.ContentString) words += item.content.str;
      return words;
    }
    if (!(child instanceof Y.XmlElement)) return '';
    if (child.nodeName === 'hardBreak') return '\n';
    if (TAGS.has(child.nodeName)) return String(child.getAttribute('name') ?? child.getAttribute('date') ?? '');
    return `${wordsIn(child)}\n`;
  }).join('');
}
/** What's on a page as plain text, a line to a block. */
const pageText = (doc: Y.Doc): string => doc.getXmlFragment(DOC_FRAGMENT).toArray().flatMap((block) => {
  const words = block instanceof Y.XmlElement && !isGone(block) ? wordsIn(block).trim() : '';
  return words ? [words] : [];
}).join('\n');
/** Words Yjs is holding that it has nowhere to put, because what they were built on isn't here. It holds them as a V2 update. */
function wordsWaiting(doc: Y.Doc): string {
  const pending = doc.store.pendingStructs;
  if (!pending) return '';
  return Y.decodeUpdateV2(pending.update).structs.flatMap((s) => (s instanceof Y.Item && s.content instanceof Y.ContentString ? [s.content.str] : [])).join('');
}

/** Everything here, unsent or not, and whatever has nowhere to go, as a line at the end. A scratch document, so nothing it does touches this one. */
function localCopyOf(doc: Y.Doc): DocLocalCopy {
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
  const waiting = wordsWaiting(scratch);
  scratch.store.pendingStructs = null;
  scratch.store.pendingDs = null;
  if (waiting) {
    const block = new Y.XmlElement('line');
    block.setAttribute('id', newBlockId());
    const page = scratch.getXmlFragment(DOC_FRAGMENT);
    page.insert(page.length, [block]);
    block.insert(0, [new Y.XmlText(waiting)]);
  }
  const copy = { text: pageText(scratch), state: Y.encodeStateAsUpdate(scratch) };
  scratch.destroy();
  return copy;
}

/**
 * What's kept, for main's session to keep things in. Main's lets go of what's kept when a document is deleted or refuses
 * something outright, which feat/ws-docs-2 never does: until then, what it lets go of then stays, for someone to take out.
 */
export function holding(keep: KeptUpdates): { keep: KeptUpdates; watch: (session: SessionNow) => void } {
  let watched: SessionNow | null = null;
  return {
    keep: {
      load: () => keep.load(),
      add: (update, at) => keep.add(update, at),
      remove: (keys) => {
        const s = watched?.getSnapshot();
        return s && (s.closed === 'deleted' || s.refused === 'rejected') ? Promise.resolve() : keep.remove(keys);
      }
    },
    watch: (session) => { watched = session; }
  };
}

/** Main's session, with what feat/ws-docs-2 adds to it. `keep` is what's kept itself: Discard lets go of it there. */
export function withUnsent(session: SessionNow, keep: KeptUpdates | undefined): DocSession {
  let from: StatusNow | null = null;
  let view: DocStatus | null = null;
  // The same object for the same status, as useSyncExternalStore asks.
  const getSnapshot = (): DocStatus => {
    const now = session.getSnapshot();
    if (now !== from || !view) { from = now; view = { ...now, unsent: now.status !== 'saved' }; }
    return view;
  };
  return {
    doc: session.doc, awareness: session.awareness, ready: session.ready,
    subscribe: session.subscribe, close: session.close, getSnapshot,
    localCopy: () => localCopyOf(session.doc),
    size: () => ({ bytes: Y.encodeStateAsUpdate(session.doc).length, items: itemsOnPage(session.doc) }),
    discardUnsaved: async () => {
      session.close();
      if (!keep) return;
      const kept = await keep.load();
      if (kept.length) await keep.remove(kept.map((k) => k.key));
    }
  };
}
