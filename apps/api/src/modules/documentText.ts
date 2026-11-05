/*
 * What a document says, read from its Yjs state on the server: the one place that knows the editor's blocks by name, so a
 * change to the editor's schema is a change here and nowhere else. A board says what it says by `kind`, through
 * @alcove/board, which is what knows a board's Y.Doc.
 *
 * Text is one element, `line`, whose `kind` says what it is: none for plain text, or heading, bullet, numbered, todo, quote or
 * callout. Blocks are retired, never deleted, so an edit landing in one is never lost. What's on the page is `isGone`'s to say,
 * for the editor and for this: a retired block that's still holding something reads like any other.
 *
 * Nothing here is taken on trust: other people's browsers wrote it. Blocks are flat, so these readers go a fixed few levels
 * deep however deep someone nests what they send.
 */
import { DOC_FRAGMENT, type DocTextBlock } from '@alcove/api';
import { isGone } from '@alcove/api/retire';
import { boardText } from '@alcove/board';
import * as Y from 'yjs';
import { z } from 'zod';

/** What holds content. */
export type ContentKind = 'document' | 'board';

const Delta = z.array(z.object({ insert: z.unknown() }));
const Items = z.array(z.record(z.string(), z.unknown()));
const textAttr = (el: Y.XmlElement, name: string): string => {
  const v: unknown = el.getAttribute(name);
  return typeof v === 'string' ? v : '';
};
/** The words in a list attribute. */
function listAttr(el: Y.XmlElement, name: string, field: string): string[] {
  const list = Items.safeParse(el.getAttribute(name));
  return list.success ? list.data.flatMap((v) => { const s = v[field]; return typeof s === 'string' && s ? [s] : []; }) : [];
}
/** A gallery's captions: an attribute for each picture, `cap:<media>`, so two people can caption two pictures at once. */
const captionsOf = (el: Y.XmlElement): string[] => Object.entries<unknown>(el.getAttributes()).flatMap(([name, v]) => (name.startsWith('cap:') && typeof v === 'string' && v ? [v] : []));
const elementsIn = (parent: Y.XmlElement | Y.XmlFragment): Y.XmlElement[] => parent.toArray().flatMap((child) => (child instanceof Y.XmlElement ? [child] : []));

/** What's in a line: its words, and what stands for words. A link to another document says only its ID: a reader who can't open it isn't to see its name. */
function wordsIn(line: Y.XmlElement): string {
  return line.toArray().map((child) => {
    if (child instanceof Y.XmlText) return Delta.parse(child.toDelta()).map((part) => (typeof part.insert === 'string' ? part.insert : '')).join('');
    if (!(child instanceof Y.XmlElement)) return '';
    switch (child.nodeName) {
      case 'mention': return textAttr(child, 'name');
      case 'dateChip': return textAttr(child, 'date');
      case 'hardBreak': return '\n';
      default: return '';
    }
  }).join('');
}
function blockWords(el: Y.XmlElement): string {
  switch (el.nodeName) {
    case 'toggle': return elementsIn(el).map(wordsIn).join('\n');
    case 'table': return elementsIn(el).map((row) => elementsIn(row).map(wordsIn).join('\t')).join('\n');
    case 'gallery': return captionsOf(el).join(' ');
    case 'live': return listAttr(el, 'lines', 'text').join('\n');
    case 'file': return textAttr(el, 'name');
    case 'video': return textAttr(el, 'title');
    case 'moment': return textAttr(el, 'text');
    default: return wordsIn(el);
  }
}
const blocksOf = (doc: Y.Doc): Y.XmlElement[] => elementsIn(doc.getXmlFragment(DOC_FRAGMENT)).filter((el) => !isGone(el));

/** What kind of block something is, as search names it. */
const typeOf = (el: Y.XmlElement): string => (el.nodeName === 'line' ? textAttr(el, 'kind') || 'paragraph' : el.nodeName);

/** A board's words come as one block of this id: what search lands on is the board itself. */
const BOARD_BLOCK = 'board';

/**
 * What a document says at the top and in each block on the page, leaving out blocks with no words. A board has nothing at the
 * top, as its name is the tree's, and one block with every word on it: stickies, shapes and text, frames' titles and who was
 * in a room, tables' cells and pictures' captions, frame by frame in reading order. Not a frame's hint, which isn't on the
 * board, nor comments.
 */
export function documentText(doc: Y.Doc, kind: ContentKind): { title: string; blocks: DocTextBlock[] } {
  switch (kind) {
    case 'document': {
      const all = blocksOf(doc);
      const title = all.find((el) => el.nodeName === 'title');
      const blocks = all.filter((el) => el !== title).flatMap((el) => { const text = blockWords(el); const id = textAttr(el, 'id'); return text && id ? [{ id, type: typeOf(el), text }] : []; });
      return { title: title ? wordsIn(title) : '', blocks };
    }
    case 'board': {
      const text = boardText(doc);
      return { title: '', blocks: text ? [{ id: BOARD_BLOCK, type: 'board', text }] : [] };
    }
  }
}

/** A `todo` block: who it tags and when, for the call's follow-ups. */
export interface DocTodo { block: string; text: string; done: boolean; mentions: { id: string; name: string }[]; dates: string[] }
/**
 * Every todo in a document, in order. One with a mention and a date joins the follow-ups of a call it was worked on in. A board
 * has none: what's in its frames for actions reaches the note as action items, which the note writer makes of them.
 */
export function documentTodos(doc: Y.Doc, kind: ContentKind): DocTodo[] {
  switch (kind) {
    case 'document': return blocksOf(doc).filter((el) => el.nodeName === 'line' && textAttr(el, 'kind') === 'todo').map((el) => {
      const inline = elementsIn(el);
      const done: unknown = el.getAttribute('done');
      return {
        block: textAttr(el, 'id'), text: blockWords(el), done: done === true,
        mentions: inline.filter((x) => x.nodeName === 'mention').map((x) => ({ id: textAttr(x, 'id'), name: textAttr(x, 'name') })),
        dates: inline.filter((x) => x.nodeName === 'dateChip').map((x) => textAttr(x, 'date'))
      };
    });
    case 'board': return [];
  }
}
