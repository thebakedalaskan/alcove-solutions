/*
 * Every block has a stable ID, because links, follow, comments and "you land on the line" all point at one. A split,
 * a paste or a duplicate can leave two blocks with one ID: the block that was there keeps it, the new one gets its own.
 */
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { ySyncPluginKey } from 'y-prosemirror';
import { newBlockId } from '../names';
import { blockIdOf, hasBlockId } from '../schema';

/** A change that came from the shared document, which this browser doesn't get to correct. */
export const fromSync = (tr: Transaction): boolean => tr.getMeta(ySyncPluginKey)?.isChangeOrigin === true;

export const blockIds = new Plugin({
  key: new PluginKey('block-ids'),
  appendTransaction(transactions, before, after) {
    if (!transactions.some((t) => t.docChanged) || transactions.every(fromSync)) return null;

    /* Where each block that was already here has gone. */
    const moved = new Map<string, number>();
    before.doc.forEach((node, pos) => {
      const id = blockIdOf(node);
      if (id) moved.set(id, transactions.reduce((at, t) => t.mapping.map(at), pos));
    });

    const places = new Map<string, number[]>();
    after.doc.forEach((node, pos) => {
      const id = blockIdOf(node);
      if (id) places.set(id, [...(places.get(id) ?? []), pos]);
    });

    const tr = after.tr;
    after.doc.forEach((node, pos) => {
      if (!hasBlockId(node)) return;
      const id = blockIdOf(node);
      const here = id ? places.get(id) ?? [] : [];
      const keeper = id && here.includes(moved.get(id) ?? -1) ? moved.get(id) : here[0];
      if (id === null || pos !== keeper) tr.setNodeAttribute(pos, 'id', newBlockId());
    });
    if (!tr.docChanged) return null;
    return transactions.some((t) => t.getMeta('addToHistory') === false) ? tr.setMeta('addToHistory', false) : tr;
  }
});
