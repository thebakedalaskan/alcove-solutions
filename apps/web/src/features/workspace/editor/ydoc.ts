/*
 * The Yjs side of a document. The blocks live in the root fragment `content`, comments in the root map `comments`.
 * Nothing here needs a view, so it works on a document that isn't open: dropping a block on another document in
 * the list writes straight to that document.
 */
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { initProseMirrorDoc, updateYFragment, ySyncPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { schema } from './schema';
import type { BlockJSON } from './types';

export const FRAGMENT = 'content';
export const COMMENTS = 'comments';

export const contentOf = (doc: Y.Doc): Y.XmlFragment => doc.getXmlFragment(FRAGMENT);

/** y-prosemirror's plugin state, with the parts used here. */
export interface SyncState {
  type: Y.XmlFragment;
  doc: Y.Doc;
  binding: { mapping: Map<Y.AbstractType<unknown>, PMNode | PMNode[]> };
  isChangeOrigin: boolean;
  isUndoRedoOperation: boolean;
}
export const syncOf = (state: EditorState): SyncState | null => ySyncPluginKey.getState(state) ?? null;

/**
 * The start of every document, the same bytes in every browser. A document's title is the first element of its
 * fragment, so two browsers each making their own for a new document would merge into two titles. Writing the
 * same structs under one fixed client instead means they merge into one, whoever gets there first and however
 * often: a new document needs no one to create it. No real client gets this ID (they're random 32-bit numbers).
 */
const SEED_CLIENT = 1;
const SEED_BLOCK = 'first';
let seedBytes: Uint8Array | null = null;
function seedUpdate(): Uint8Array {
  if (seedBytes) return seedBytes;
  const doc = new Y.Doc();
  doc.clientID = SEED_CLIENT;
  const first = new Y.XmlElement('paragraph');
  first.setAttribute('id', SEED_BLOCK);
  contentOf(doc).insert(0, [new Y.XmlElement('title'), first]);
  seedBytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return seedBytes;
}

/** Gives a document with nothing in it its title and first line. */
export function seedDocument(doc: Y.Doc): void {
  if (contentOf(doc).length === 0) Y.applyUpdate(doc, seedUpdate());
}

/** Adds blocks to the end of a document, open or not. A block's stable ID goes with it, so it must not stay behind as well. */
export function appendBlocks(doc: Y.Doc, blocks: readonly BlockJSON[]): void {
  seedDocument(doc);
  const fragment = contentOf(doc);
  const { doc: current, meta } = initProseMirrorDoc(fragment, schema);
  const added = blocks.map((b) => schema.nodeFromJSON(b));
  updateYFragment(doc, fragment, current.copy(current.content.append(Fragment.fromArray(added))), meta);
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
