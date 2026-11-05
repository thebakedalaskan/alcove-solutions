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
import { isGone, newBlockId } from '@alcove/api/retire';
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
const todosOf = (doc: Y.Doc): Y.XmlElement[] => blocksOf(doc).filter((el) => el.nodeName === 'line' && textAttr(el, 'kind') === 'todo');
function todoOf(el: Y.XmlElement): DocTodo {
  const inline = elementsIn(el);
  const done: unknown = el.getAttribute('done');
  return {
    block: textAttr(el, 'id'), text: blockWords(el), done: done === true,
    mentions: inline.filter((x) => x.nodeName === 'mention').map((x) => ({ id: textAttr(x, 'id'), name: textAttr(x, 'name') })),
    dates: inline.filter((x) => x.nodeName === 'dateChip').map((x) => textAttr(x, 'date'))
  };
}
/**
 * Every todo in a document, in order. One with a mention and a date joins the follow-ups of a call it was worked on in. A board
 * has none: what's in its frames for actions reaches the note as action items, which the note writer makes of them.
 */
export function documentTodos(doc: Y.Doc, kind: ContentKind): DocTodo[] {
  switch (kind) {
    case 'document': return todosOf(doc).map(todoOf);
    case 'board': return [];
  }
}
/** Whether a todo is one of a call's follow-ups: it says who and when. */
export const isFollowUp = (t: Pick<DocTodo, 'mentions' | 'dates'>): boolean => t.mentions.length > 0 && t.dates.length > 0;
/** How much of a document's follow-ups a call is given: so many, so long, with so many people and dates each. */
export interface FollowUpLimits { max: number; chars: number; tags: number }
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** A document's follow-ups as a call shows them: the first `max`, each cut to size, so a document of thousands gives a page. */
export function followUpsIn(doc: Y.Doc, kind: ContentKind, l: FollowUpLimits): DocTodo[] {
  return documentTodos(doc, kind).filter(isFollowUp).slice(0, l.max).map((t) => ({
    ...t, text: cut(t.text, l.chars), mentions: t.mentions.slice(0, l.tags).map((m) => ({ id: cut(m.id, l.chars), name: cut(m.name, l.chars) })), dates: t.dates.slice(0, l.tags).map((d) => cut(d, l.chars))
  }));
}

/** Attributes as y-prosemirror writes them: of any type, though Yjs's types say strings. */
const setAttr = (el: Y.XmlElement, name: string, value: unknown): void => { Reflect.apply(el.setAttribute, el, [name, value]); };

/** Ticks a follow-up, as ticking it in the editor does, or takes the tick back. False when there's no such follow-up. */
export function tickFollowUp(doc: Y.Doc, kind: ContentKind, block: string, done: boolean): boolean {
  if (kind !== 'document') return false;
  const el = todosOf(doc).find((x) => textAttr(x, 'id') === block);
  if (!el) return false;
  const todo = todoOf(el);
  if (!isFollowUp(todo)) return false;
  if (todo.done !== done) setAttr(el, 'done', done);
  return true;
}

/** Whether a document holds this video. */
export function holdsVideo(doc: Y.Doc, kind: ContentKind, media: string): boolean {
  switch (kind) {
    case 'document': return blocksOf(doc).some((el) => el.nodeName === 'video' && textAttr(el, 'media') === media);
    case 'board': return false;
  }
}

/* ---------- an agenda ---------- */

/** What's in a line that carries on into the next agenda: words, or who and when. */
export type Run = { text: string } | { mention: { id: string; name: string } } | { date: string };
/** A line's words, mentions and dates, without what only made sense where they were. */
const runsOf = (line: Y.XmlElement): Run[] => line.toArray().flatMap((child): Run[] => {
  if (child instanceof Y.XmlText) return [{ text: Delta.parse(child.toDelta()).map((part) => (typeof part.insert === 'string' ? part.insert : '')).join('') }];
  if (!(child instanceof Y.XmlElement)) return [];
  switch (child.nodeName) {
    case 'mention': return [{ mention: { id: textAttr(child, 'id'), name: textAttr(child, 'name') } }];
    case 'dateChip': return [{ date: textAttr(child, 'date') }];
    case 'hardBreak': return [{ text: ' ' }];
    default: return [];
  }
});
/** What's left to do in an agenda: every todo that says something and isn't ticked, in order. */
export function openTodos(doc: Y.Doc, kind: ContentKind): Run[][] {
  switch (kind) {
    case 'document': return todosOf(doc).filter((el) => !todoOf(el).done && blockWords(el).trim() !== '').map(runsOf);
    case 'board': return [];
  }
}
const AGENDA_HEADING = 'From last time';
/** Whether a document is an agenda, going by what the Agenda template starts with. */
export const readsAsAgenda = (doc: Y.Doc, kind: ContentKind): boolean =>
  kind === 'document' && blocksOf(doc).some((el) => el.nodeName === 'line' && textAttr(el, 'kind') === 'heading' && blockWords(el).trim() === AGENDA_HEADING);

const words = (text: string): Y.XmlText => { const t = new Y.XmlText(); t.insert(0, text); return t; };
const inlineOf = (run: Run): Y.XmlText | Y.XmlElement => {
  if ('text' in run) return words(run.text);
  const el = new Y.XmlElement('mention' in run ? 'mention' : 'dateChip');
  if ('mention' in run) { setAttr(el, 'id', run.mention.id); setAttr(el, 'name', run.mention.name); } else setAttr(el, 'date', run.date);
  return el;
};
function lineOf(attrs: Record<string, unknown>, runs: Run[] = []): Y.XmlElement {
  const el = new Y.XmlElement('line');
  for (const [name, value] of Object.entries({ id: newBlockId(), ...attrs })) setAttr(el, name, value);
  if (runs.length) el.insert(0, runs.map(inlineOf));
  return el;
}
const heading = (text: string) => lineOf({ kind: 'heading', level: 2 }, [{ text }]);
/** Writes at the start of the text a block starts with, as anyone typing there does: one made beside it is merged away in the editor. */
function writeAtStart(el: Y.XmlElement, text: string): void {
  const first = el.get(0);
  if (first instanceof Y.XmlText) first.insert(0, text);
  else el.insert(0, [words(text)]);
}

/**
 * Fills in a new document as the next call's agenda: the Agenda template, holding what was left open. Its first line is the
 * one every document starts with, so it's kept and turned into the first heading. One that's filled in already is left as
 * it is, so trying again after a fill that landed and wasn't said to changes nothing.
 */
export function writeAgenda(doc: Y.Doc, title: string, open: Run[][]): void {
  const fragment = doc.getXmlFragment(DOC_FRAGMENT);
  const [head, first] = blocksOf(doc);
  if (head?.nodeName !== 'title' || !first || readsAsAgenda(doc, 'document')) return;
  writeAtStart(head, title);
  setAttr(first, 'kind', 'heading');
  setAttr(first, 'level', 2);
  writeAtStart(first, AGENDA_HEADING);
  const carried = open.length ? open.map((runs) => lineOf({ kind: 'todo' }, runs)) : [lineOf({ kind: 'todo' })];
  fragment.insert(2, [...carried, heading('Today'), lineOf({ kind: 'numbered' }), heading('Notes'), lineOf({})]);
}
