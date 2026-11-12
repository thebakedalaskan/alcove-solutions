/* What Find turns up, worked out from the tree and the words held in this tab. Nothing here talks to anything. */
import type { SearchDoc, WorkspaceItem } from '@alcove/api';
import type { WsFindHit } from '@alcove/ui';
import { shortDay } from '~/lib/time';
import { foldersAbove, nameOf, type Tree } from './tree';

/** A document or a line. `block`: the line to land on. */
export interface FindHit extends WsFindHit { document: string; block?: string | undefined }

/** One block's words as the page has them this moment. */
export interface BlockWords { id: string; text: string }

/** How many documents show with nothing typed, and how many lines at most. */
const RECENT = 5;
const LINES = 8;
/** What a line keeps before what was found, and all it shows. */
const LEAD = 26;
const ROOM = 92;

/** Blocks whose words aren't in the page's text: those stay as Alcove last read them, even in the document that's open. */
const NOT_TEXT: ReadonlySet<string> = new Set(['gallery', 'file', 'video', 'moment', 'live']);

const pathOf = (tree: Tree, item: WorkspaceItem, space: string) => foldersAbove(tree, item.id).map(nameOf).join(' / ') || space;
const documentHit = (tree: Tree, item: WorkspaceItem, space: string): FindHit => ({ id: item.id, document: item.id, name: nameOf(item), sub: pathOf(tree, item, space), icon: 'fileText' });

/** What's ready before anything's typed: what was opened last, leaving what's open now for last, and then the rest of the list. */
export function recentHits(tree: Tree, docs: readonly WorkspaceItem[], recent: readonly string[], open: string | null, space: string): FindHit[] {
  const known = recent.flatMap((id) => docs.filter((d) => d.id === id));
  const rest = docs.filter((d) => !recent.includes(d.id));
  const all = [...known, ...rest];
  const order = [...all.filter((d) => d.id !== open), ...all.filter((d) => d.id === open)];
  return order.slice(0, RECENT).map((d) => documentHit(tree, d, space));
}

/** A date chip's words as it reads on the page: the text holds its date. */
const spelled = (text: string) => text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => shortDay(new Date(`${d}T00:00`)));
const flat = (text: string) => spelled(text).replace(/\s+/g, ' ').trim();

/** Words from around `at`, whole, with room for the row. */
function excerpt(line: string, at: number): string {
  if (line.length <= ROOM) return line;
  const start = at <= LEAD ? 0 : line.indexOf(' ', at - LEAD) + 1;
  const wanted = start + ROOM;
  const stop = wanted >= line.length ? line.length : Math.max(line.lastIndexOf(' ', wanted), at + 1);
  return `${start > 0 ? '…' : ''}${line.slice(start, stop).trim()}${stop < line.length ? '…' : ''}`;
}

/** Where a line has what's looked for, and whether it has it as typed. Words count in any order, as they do in Calls' search. */
function matcher(query: string): (line: string) => { at: number; exact: boolean } | null {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const phrase = terms.join(' ');
  return (line) => {
    const low = line.toLowerCase();
    const at = low.indexOf(phrase);
    if (at >= 0) return { at, exact: true };
    return terms.every((t) => low.includes(t)) ? { at: low.indexOf(terms[0] ?? ''), exact: false } : null;
  };
}

/** What a document says for searching: what's on the page if it's the one that's open, and otherwise what Alcove last read. */
function blocksOf(doc: SearchDoc | undefined, live: readonly BlockWords[] | null): readonly BlockWords[] {
  if (!live) return doc?.blocks ?? [];
  return [...live, ...(doc?.blocks ?? []).filter((b) => NOT_TEXT.has(b.type))];
}

/**
 * Documents by name, then lines, those with the words as typed first. `open` is what's on the page and `live` its words
 * now, which come first: what's there is what someone's most likely after, and it may not have reached Alcove yet.
 */
export function foundHits(query: string, tree: Tree, docs: readonly WorkspaceItem[], words: ReadonlyMap<string, SearchDoc>, open: string | null, live: readonly BlockWords[] | null, space: string): FindHit[] {
  const match = matcher(query);
  const order = [...docs.filter((d) => d.id === open), ...docs.filter((d) => d.id !== open)];
  const named = docs.filter((d) => match(nameOf(d))).map((d) => documentHit(tree, d, space));
  const exact: FindHit[] = [];
  const loose: FindHit[] = [];
  for (const item of order) {
    for (const block of blocksOf(words.get(item.id), item.id === open ? live : null)) {
      const line = flat(block.text);
      const found = match(line);
      if (!found) continue;
      (found.exact ? exact : loose).push({ id: `${item.id}:${block.id}`, document: item.id, block: block.id, name: excerpt(line, found.at), sub: nameOf(item), icon: 'textLines' });
    }
    if (exact.length >= LINES) break;
  }
  return [...named, ...[...exact, ...loose].slice(0, LINES)];
}
