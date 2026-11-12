/*
 * Someone else writing in a document as the story opens (`Page.here`): on the document's awareness as the server passes their
 * browser on, each with their own client, their caret just after the words the page says. It steps back a letter and on again
 * every few seconds, as typing moves it, so their name stays beside it as it does while someone writes.
 */
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { contentOf } from '~/features/workspace/editor/ydoc';
import type { PageWriter } from '../world';

/** How often a writer's caret moves. */
const TYPING_MS = 2_400;

/** The plain words of a run of text, without what's inline in it. */
const wordsOf = (text: Y.XmlText): string => text.toDelta().map((d: { insert?: unknown }) => (typeof d.insert === 'string' ? d.insert : '')).join('');

/** Where a caret just after `words` is, `back` letters before their end: in the run of text that has them. Null when nothing has them. */
function after(doc: Y.Doc, words: string, back: number): Y.RelativePosition | null {
  const walk = (node: Y.XmlFragment | Y.XmlElement): Y.RelativePosition | null => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        const at = wordsOf(child).indexOf(words);
        if (at >= 0) return Y.createRelativePositionFromTypeIndex(child, Math.max(at, at + words.length - back));
      } else if (child instanceof Y.XmlElement) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(contentOf(doc));
}

/** Puts these people on a document's awareness, writing, until what this returns is called. */
export function writersIn(doc: Y.Doc, awareness: Awareness, writers: readonly PageWriter[]): () => void {
  if (writers.length === 0) return () => undefined;
  const theirs = writers.map((w) => ({ w, a: new Awareness(new Y.Doc()) }));
  let beat = 0;
  const say = () => {
    for (const { w, a } of theirs) {
      const at = after(doc, w.after, beat % 2);
      if (!at) continue;
      const place = Y.relativePositionToJSON(at);
      a.setLocalState({ cursor: { anchor: place, head: place }, user: { id: w.who.id, name: w.who.name } });
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(a, [a.clientID]), 'standin');
    }
    beat += 1;
  };
  say();
  const again = setInterval(say, TYPING_MS);
  return () => {
    clearInterval(again);
    removeAwarenessStates(awareness, theirs.map(({ a }) => a.clientID), 'standin');
    for (const { a } of theirs) { a.destroy(); a.doc.destroy(); }
  };
}
