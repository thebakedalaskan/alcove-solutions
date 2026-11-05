/*
 * SEAM, until feat/ws-docs-2 is on main (see session.ts): `saveCopy` as main can do it. A new document is made, and what's
 * on the copy's page goes into it as new blocks, as its first edit, by whoever's saving it. If that doesn't reach Alcove the
 * new document goes again, so nobody's left with a blank one that looks like the copy they asked for. It holds the editor's
 * schema, so it loads only when someone saves a copy.
 */
import { AlcoveApiError, type DocSession as SessionNow, type ItemInput } from '@alcove/api';
import { newBlockId } from '@alcove/api/retire';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { initProseMirrorDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { api } from '~/lib/api';
import { schema } from './editor/schema';
import { setTitle, titleOf } from './editor/title';
import { writeDocument } from './editor/write';
import { contentOf, removeBlockFrom } from './editor/ydoc';

/** How long the new document gets to reach Alcove. */
const WAIT_MS = 20_000;

/** Resolves once Alcove has everything written in `session`, and fails if it won't take it, or not in time. */
function saved(session: SessionNow): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new AlcoveApiError('unavailable', 'The new document didn’t save in time. Try again.')), WAIT_MS);
    const off = session.subscribe(check);
    function finish(e?: AlcoveApiError) { clearTimeout(timer); off(); if (e) reject(e); else resolve(); }
    function check() {
      const s = session.getSnapshot();
      if (s.status === 'saved') finish();
      else if (s.status === 'failed' || s.closed) finish(s.refused === 'too-large' ? new AlcoveApiError('too-large', 'That’s too much for one document.') : new AlcoveApiError('invalid', 'Alcove couldn’t take that as a new document.'));
    }
    check();
  });
}

/** Everything on a page but its title and what's left it, as new blocks. */
function pageOf(from: Y.Doc): PMNode[] {
  const { doc } = initProseMirrorDoc(contentOf(from), schema);
  const out: PMNode[] = [];
  doc.forEach((node) => {
    const gone = node.attrs['gone'];
    if (node.type === schema.nodes.title || (typeof gone === 'string' && node.textContent === '')) return;
    out.push(node.type.create({ ...node.attrs, id: newBlockId(), gone: null }, node.content, node.marks));
  });
  return out;
}

export async function saveCopy(workspaceId: string, input: ItemInput & { state: Uint8Array }): Promise<{ id: string }> {
  const { state, ...item } = input;
  const made = await api.workspaces.items.create(workspaceId, item);
  try {
    const session = await api.workspaces.document(workspaceId, made.id);
    try {
      await session.ready;
      const from = new Y.Doc();
      Y.applyUpdate(from, state);
      const fragment = contentOf(session.doc);
      const { doc: current, meta } = initProseMirrorDoc(fragment, schema);
      writeDocument(session.doc, fragment, current.copy(current.content.append(Fragment.fromArray(pageOf(from)))), meta);
      // The empty line every document starts with.
      removeBlockFrom(session.doc, 'first');
      setTitle(session.doc, titleOf(from) || item.name || '');
      from.destroy();
      await saved(session);
    } finally {
      session.close();
    }
  } catch (e) {
    await api.workspaces.items.trash(workspaceId, made.id).then(() => api.workspaces.items.deleteForever(workspaceId, made.id)).catch(() => undefined);
    throw e;
  }
  return made;
}
