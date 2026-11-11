/*
 * What colours code: Lezer's parser for a language, and what its highlighting tags mean here. This loads the first time a
 * block in a language is drawn, and each language's parser only when a block is in it, so a document without code, and a
 * call that never opens one, loads none of it. A block is parsed again from the tree it had, so typing in a long block
 * costs what changed, not the whole block.
 */
import { TreeFragment, type Parser, type Tree } from '@lezer/common';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import type { CodeLang } from '../languages';

/** A run of code to colour, by its place in the block's words, and its class in workspace-editor.css. */
export interface Token { from: number; to: number; cls: string }

/** Words as parsed, to parse from next time. */
export interface Parsed { text: string; tree: Tree }

/** The syntax palette's five kinds of word. What isn't one of them stays the colour of the text. */
const highlighter = tagHighlighter([
  { tag: [t.keyword, t.modifier, t.self, t.processingInstruction, t.standard(t.typeName)], class: 'wb-tk-k' },
  { tag: [t.string, t.character, t.regexp, t.escape], class: 'wb-tk-s' },
  { tag: t.comment, class: 'wb-tk-c' },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal], class: 'wb-tk-n' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName, t.namespace], class: 'wb-tk-f' }
]);

const PARSERS: Record<CodeLang, () => Promise<Parser>> = {
  /* With TypeScript and JSX, which a JavaScript block is as likely to hold. */
  javascript: () => import('@lezer/javascript').then((m) => m.parser.configure({ dialect: 'jsx ts' })),
  python: () => import('@lezer/python').then((m) => m.parser),
  cpp: () => import('@lezer/cpp').then((m) => m.parser)
};

/** What changed between two versions of a block's words: the stretch between what's the same at either end. */
function changeOf(a: string, b: string): { fromA: number; toA: number; fromB: number; toB: number } {
  const most = Math.min(a.length, b.length);
  let start = 0;
  while (start < most && a.charCodeAt(start) === b.charCodeAt(start)) start += 1;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA -= 1; endB -= 1; }
  return { fromA: start, toA: endA, fromB: start, toB: endB };
}

/** Colours a block's words, from what they were (`was`) when there's that to go on. */
export type Tokenize = (text: string, was: Parsed | undefined) => Parsed & { tokens: Token[] };

export async function tokenizer(lang: CodeLang): Promise<Tokenize> {
  const parser = await PARSERS[lang]();
  return (text, was) => {
    const fragments = was ? TreeFragment.applyChanges(TreeFragment.addTree(was.tree), [changeOf(was.text, text)]) : undefined;
    const tree = parser.parse(text, fragments);
    const tokens: Token[] = [];
    highlightTree(tree, highlighter, (from, to, cls) => { tokens.push({ from, to, cls }); });
    return { text, tree, tokens };
  };
}
