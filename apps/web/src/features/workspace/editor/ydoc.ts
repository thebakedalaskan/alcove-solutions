/*
 * The Yjs side of a document. The blocks live in the root fragment `content`, comments in the root map `comments`.
 * Nothing here needs a view, so it works on a document that isn't open: dropping a block on another document in
 * the list writes straight to that document. A document's first title and line come from the server, which makes every
 * document from the same fixed bytes (`DOC_SEED` in `@alcove/api`), so nothing here or in the editor ever makes them.
 */
import { holdsNothing, newBlockId, retire } from '@alcove/api/retire';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { initProseMirrorDoc, ySyncPluginKey, type ProsemirrorBinding } from 'y-prosemirror';
import * as Y from 'yjs';
import { FRAGMENT } from './names';
import { blockFromJSON, inDocument, schema } from './schema';
import type { BlockJSON } from './types';
import { setAttr, writeDocument, type ProsemirrorMapping } from './write';

export const contentOf = (doc: Y.Doc): Y.XmlFragment => doc.getXmlFragment(FRAGMENT);

type YType = ProsemirrorMapping extends Map<infer K, unknown> ? K : never;

/** The same record, answering with what's in the document for a tag from a newer Alcove (see `BlockSchema`), so y-prosemirror knows it as the same element. */
export class NodeRecord extends Map<YType, PMNode | PMNode[]> {
  override get(key: YType): PMNode | PMNode[] | undefined {
    const node = super.get(key);
    return node === undefined || Array.isArray(node) ? node : inDocument(node);
  }
}

/** How y-prosemirror follows the fragment. */
export type FollowChange = (events: Y.YEvent<Y.XmlFragment>[], tr: Y.Transaction) => void;

/** y-prosemirror's binding. Its version is pinned for this: what's used of it isn't its public surface. */
export type SyncBinding = ProsemirrorBinding;

/** y-prosemirror's plugin state, with the parts used here. */
export interface SyncState {
  type: Y.XmlFragment;
  doc: Y.Doc;
  binding: SyncBinding;
  addToHistory: boolean;
  isChangeOrigin: boolean;
  isUndoRedoOperation: boolean;
}
export const syncOf = (state: EditorState): SyncState | null => ySyncPluginKey.getState(state) ?? null;

/**
 * Adds blocks to the end of a document, open or not, and returns their IDs. A block arriving here is a new block: every
 * document starts with the same first line, so an ID brought from another document can already be taken in this one.
 */
export function appendBlocks(doc: Y.Doc, blocks: readonly BlockJSON[]): string[] {
  const fragment = contentOf(doc);
  if (fragment.length === 0) throw new Error('A document holds its first line from the moment it’s made, so this one hasn’t synced yet.');
  const { doc: current, meta } = initProseMirrorDoc(fragment, schema);
  const ids = blocks.map(() => newBlockId());
  const added = blocks.map((b, i) => { const node = blockFromJSON(b); return node.type.create({ ...node.attrs, id: ids[i] ?? null, gone: null }, node.content, node.marks); });
  writeDocument(doc, fragment, current.copy(current.content.append(Fragment.fromArray(added))), meta);
  return ids;
}

/** Takes a block off the page of a document, open or not, by its stable ID. */
export function removeBlockFrom(doc: Y.Doc, id: string): void {
  const found = elementOf(contentOf(doc), id);
  if (found) doc.transact(() => { retire(found.element, newBlockId(), ''); });
}

/** The blocks on the page carrying an upload's token (`upload`), wherever they've been moved to: not one that has left it. */
export function uploadBlocks(doc: Y.Doc, token: string): Y.XmlElement[] {
  return contentOf(doc).toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement && c.getAttribute('upload') === token && c.getAttribute('gone') === undefined);
}

/**
 * Sets an upload's attributes from outside the page, open or not, on every block on the page carrying its token: what an
 * upload says as it goes. Null takes one away. How many blocks there were: none while the block is off the page. `own` are
 * attributes only the upload puts on its block: one of them on a copy someone retired as they moved the block was written
 * after they took it, so it comes off again, or the old copy would come back holding just that.
 */
export function setUploadAttrs(doc: Y.Doc, token: string, attrs: Readonly<Record<string, unknown>>, own: readonly string[], origin: unknown): number {
  const fragment = contentOf(doc);
  const found = uploadBlocks(doc, token);
  if (found.length === 0) return 0;
  doc.transact(() => {
    for (const element of found) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined) { if (element.getAttribute(key) !== undefined) element.removeAttribute(key); }
        else setAttr(element, key, value);
      }
      const id: unknown = element.getAttribute('id');
      for (const child of fragment.toArray()) {
        if (!(child instanceof Y.XmlElement) || child === element || typeof id !== 'string' || child.getAttribute('gone') !== id) continue;
        for (const key of own) if (child.getAttribute(key) !== undefined) child.removeAttribute(key);
      }
    }
  }, origin);
  return found.length;
}

/** A document's first line, while nobody has written in it, leaves the page: what's put in a new document takes its place. */
export function retireBlankStart(doc: Y.Doc): void {
  const first = contentOf(doc).get(1);
  if (first instanceof Y.XmlElement && first.nodeName === 'line' && first.getAttribute('gone') === undefined && holdsNothing(first)) {
    doc.transact(() => { retire(first, newBlockId(), ''); });
  }
}

/** The element a block is, by its stable ID. */
export function elementOf(fragment: Y.XmlFragment, id: string): { element: Y.XmlElement; index: number } | null {
  let index = 0;
  for (const child of fragment.toArray()) {
    if (child instanceof Y.XmlElement && child.getAttribute('id') === id) return { element: child, index };
    index += 1;
  }
  return null;
}
