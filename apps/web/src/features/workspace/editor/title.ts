/*
 * A document's title, on the Yjs side, for what changes it from outside the page: naming it in the list, or starting it from
 * a template, and for naming a copy of someone's words. It's the first element of the fragment, so an open editor follows like it
 * follows anyone's typing. Only Yjs, no ProseMirror: import it dynamically, so it stays out of the app until a document opens.
 */
import * as Y from 'yjs';
import { FRAGMENT } from './names';

const titleElement = (doc: Y.Doc): Y.XmlElement | null => {
  const first = doc.getXmlFragment(FRAGMENT).get(0);
  return first instanceof Y.XmlElement && first.nodeName === 'title' ? first : null;
};
/** A title's texts. A new title has one, but two people typing in one at once can leave two side by side. */
const textsOf = (title: Y.XmlElement): Y.XmlText[] => title.toArray().flatMap((part) => (part instanceof Y.XmlText ? [part] : []));

/** What the title says. */
export function titleOf(doc: Y.Doc): string {
  const title = titleElement(doc);
  return title ? textsOf(title).map(String).join('') : '';
}

/**
 * Makes the title say `name`, as the API does: its texts stay, emptied, and the first says it, because someone may be typing
 * in any of them, and what lands in a deleted text is lost for everyone. A document that hasn't got its title yet stays as it is.
 */
export function setTitle(doc: Y.Doc, name: string): void {
  const title = titleElement(doc);
  if (!title || titleOf(doc) === name) return;
  doc.transact(() => {
    const texts = textsOf(title);
    for (const text of texts) text.delete(0, text.length);
    const first = texts[0];
    if (first) first.insert(0, name);
    else {
      const text = new Y.XmlText();
      title.insert(0, [text]);
      text.insert(0, name);
    }
  });
}

/** What the title says in a document's state. */
export function titleIn(state: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const title = titleOf(doc);
  doc.destroy();
  return title;
}
