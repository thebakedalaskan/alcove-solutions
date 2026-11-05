/*
 * A document's title, on the Yjs side, for what changes it from outside the page: naming it in the list, or starting it
 * from a template. It's the first element of the fragment, so an open editor follows like it follows anyone's typing.
 * Only Yjs, no ProseMirror: import it dynamically, so it stays out of the app until a document opens.
 */
import * as Y from 'yjs';
import { FRAGMENT } from './names';

const titleElement = (doc: Y.Doc): Y.XmlElement | null => {
  const first = doc.getXmlFragment(FRAGMENT).get(0);
  return first instanceof Y.XmlElement && first.nodeName === 'title' ? first : null;
};

/** What the title says. */
export function titleOf(doc: Y.Doc): string {
  const text = titleElement(doc)?.get(0);
  return text instanceof Y.XmlText ? text.toString() : '';
}

/** Makes the title say `name`. A document that hasn't got its title yet stays as it is. */
export function setTitle(doc: Y.Doc, name: string): void {
  const title = titleElement(doc);
  if (!title || titleOf(doc) === name) return;
  doc.transact(() => {
    const had = title.get(0);
    if (had instanceof Y.XmlText) {
      had.delete(0, had.length);
      had.insert(0, name);
    } else {
      const text = new Y.XmlText();
      title.insert(0, [text]);
      text.insert(0, name);
    }
  });
}
