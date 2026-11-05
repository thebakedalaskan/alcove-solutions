/*
 * The Yjs side of a document. The blocks live in the root fragment `content`, comments in the root map `comments`.
 * Nothing here needs a view, so it works on a document that isn't open: dropping a block on another document in
 * the list writes straight to that document. A document's first title and line come from the server, which makes every
 * document from the same fixed bytes (`DOC_SEED` in `@alcove/api`), so nothing here or in the editor ever makes them.
 */
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { initProseMirrorDoc, updateYFragment, ySyncPluginKey, type absolutePositionToRelativePosition } from 'y-prosemirror';
import * as Y from 'yjs';
import { FRAGMENT, newBlockId } from './names';
import { retire } from './retire';
import { blockFromJSON, inDocument, schema } from './schema';
import type { BlockJSON } from './types';

export const contentOf = (doc: Y.Doc): Y.XmlFragment => doc.getXmlFragment(FRAGMENT);

/** y-prosemirror's record of which node each element is. */
type ProsemirrorMapping = Parameters<typeof absolutePositionToRelativePosition>[2];

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

/** The parts of y-prosemirror's binding used here. Its version is pinned for these: they aren't its public surface. */
export interface SyncBinding {
  mapping: ProsemirrorMapping;
  mux: (run: () => void) => void;
  _forceRerender: () => void;
  _observeFunction: FollowChange;
  _prosemirrorChanged: (doc: PMNode) => void;
}

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
  updateYFragment(doc, fragment, current.copy(current.content.append(Fragment.fromArray(added))), meta);
  return ids;
}

/** Takes a block off the page of a document, open or not, by its stable ID. */
export function removeBlockFrom(doc: Y.Doc, id: string): void {
  const found = elementOf(contentOf(doc), id);
  if (found) doc.transact(() => { retire(found.element, newBlockId(), ''); });
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
