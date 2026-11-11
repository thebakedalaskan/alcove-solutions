/*
 * Code in colour. A code block's words are coloured with decorations, never marks: nothing about the colours is stored or
 * sent, so two people typing in the same block never fight over them, and a block reads the same in a release that doesn't
 * colour it. Each language's tokenizer (`tokens.ts`) loads the first time a block in it shows up. Nodes don't change, so what
 * a block's words came to is kept by its node, and a block is tokenized again only once it's changed, from the tree it had
 * before, by its ID. Remote changes arrive as a whole new document, but y-prosemirror keeps every node nobody touched.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { log } from '~/lib/log';
import { allBlocks } from '../commands';
import { codeLang, type CodeLang } from '../languages';
import type { EditorRuntime } from '../runtime';
import { schema } from '../schema';
import type { Parsed, Token, Tokenize } from './tokens';

const slog = log.child({ component: 'editor-syntax' });

/** Past this many characters a block stays plain: colouring it would hold up typing, and code that long is rare in a document. */
const MOST = 100_000;

/** A tokenizer arrived: draw the code again. */
const key = new PluginKey<DecorationSet>('syntax');

export function syntaxPlugin(rt: EditorRuntime): Plugin<DecorationSet> {
  const ready = new Map<CodeLang, Tokenize>();
  const loading = new Set<CodeLang>();
  /** What each block's words came to, by node: a node that hasn't changed isn't looked at again. */
  const byNode = new WeakMap<PMNode, readonly Token[]>();
  /** What each block was last parsed as, by its ID, to parse a changed one from. */
  const parsed = new Map<string, Parsed & { lang: CodeLang }>();

  const load = (lang: CodeLang) => {
    if (loading.has(lang)) return;
    loading.add(lang);
    import('./tokens').then((m) => m.tokenizer(lang)).then((tokenize) => {
      ready.set(lang, tokenize);
      const view = rt.view;
      if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false));
    }, (err: unknown) => {
      /* Its code stays plain. It's tried again the next time the editor opens. */
      slog.warn('a language’s colours didn’t load', { lang, err });
    });
  };

  const tokensOf = (node: PMNode, id: string | null, lang: CodeLang): readonly Token[] => {
    const known = byNode.get(node);
    if (known) return known;
    const tokenize = ready.get(lang);
    if (!tokenize) { load(lang); return []; }
    if (node.content.size > MOST) return [];
    const was = id ? parsed.get(id) : undefined;
    const now = tokenize(node.textBetween(0, node.content.size, undefined, '￼'), was?.lang === lang ? was : undefined);
    if (id) parsed.set(id, { ...now, lang });
    byNode.set(node, now.tokens);
    return now.tokens;
  };

  const decorate = (doc: PMNode): DecorationSet => {
    const out: Decoration[] = [];
    const here = new Set<string>();
    for (const b of allBlocks(doc)) {
      const lang = b.node.type === schema.nodes.code ? codeLang(b.node) : null;
      if (!lang) continue;
      if (b.id) here.add(b.id);
      const at = b.pos + 1;
      for (const t of tokensOf(b.node, b.id, lang)) out.push(Decoration.inline(at + t.from, at + t.to, { class: t.cls }));
    }
    for (const id of parsed.keys()) if (!here.has(id)) parsed.delete(id);
    return DecorationSet.create(doc, out);
  };

  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => decorate(state.doc),
      apply: (tr, set, _, state) => (tr.docChanged || tr.getMeta(key) === true ? decorate(state.doc) : set)
    },
    props: { decorations: (state) => key.getState(state) ?? null }
  });
}
