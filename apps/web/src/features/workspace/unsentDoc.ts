/*
 * A new document holding only someone's words that didn't reach Alcove (`DocSession.unsentCopy`): the start every document
 * has (`DOC_SEED`), its first line holding the first paragraph and a line for each after it. Nothing else of the document
 * they were written in comes with them. It holds Yjs, so it loads only when someone saves their words as a new document.
 */
import { DOC_FRAGMENT, DOC_SEED } from '@alcove/api';
import { newBlockId } from '@alcove/api/retire';
import * as Y from 'yjs';

/** A line holding `words`. */
function lineOf(words: string): Y.XmlElement {
  const line = new Y.XmlElement('line');
  line.setAttribute('id', newBlockId());
  line.insert(0, [new Y.XmlText(words)]);
  return line;
}

/** The state of a new document whose page is `text`, a paragraph to a line. */
export function stateOf(text: string): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, DOC_SEED);
  const page = doc.getXmlFragment(DOC_FRAGMENT);
  const [first, ...rest] = text.split('\n').filter((p) => p.trim() !== '');
  doc.transact(() => {
    // The seed's first line, empty, with a text in it: the first paragraph goes there, so the page doesn't start with a gap.
    const seeded = page.get(1);
    const words = seeded instanceof Y.XmlElement ? seeded.get(0) : null;
    if (first !== undefined && words instanceof Y.XmlText) words.insert(0, first);
    else if (first !== undefined) page.insert(page.length, [lineOf(first)]);
    if (rest.length) page.insert(page.length, rest.map(lineOf));
  });
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}
