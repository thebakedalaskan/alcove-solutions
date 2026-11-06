/*
 * A document being presented, as everyone watching sees it: one section at a time, and nothing else of the page. With
 * `section` set, what's outside that section isn't drawn, the title shows only with the first section, and a line with
 * nothing written in it is left out. Whatever the section, the sections are reported as they change, so whoever presents
 * knows where they are and what's next.
 *
 * How a document splits into sections is one rule, here, and whoever presents and everyone watching read it from the same
 * document, so a section's number means the same blocks on every screen. A heading of the first or second level starts a
 * section, named for what it says. What comes before the first one is a section named for the title. A section with nothing
 * in it isn't one, so a document that opens with a heading starts with that heading's section. Only what's on the page counts.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { allBlocks, isBlank } from '../commands';
import type { EditorRuntime } from '../runtime';
import { headingLevel, lineKind } from '../schema';
import { sameSections, sectionAt, type DocSection } from '../sections';

/** Whether a block starts a section. */
const startsSection = (node: PMNode): boolean => lineKind(node) === 'heading' && headingLevel(node) <= 2;

const known = new WeakMap<PMNode, readonly DocSection[]>();

/** The sections of a document, in order. A document doesn't change, so each is worked out once. */
export function sectionsOf(doc: PMNode): readonly DocSection[] {
  const was = known.get(doc);
  if (was) return was;
  const parts: { name: string; blocks: string[] }[] = [{ name: doc.child(0).textContent.trim(), blocks: [] }];
  for (const b of allBlocks(doc)) {
    if (!b.id) continue;
    if (startsSection(b.node)) parts.push({ name: b.node.textContent.trim(), blocks: [b.id] });
    else parts.at(-1)?.blocks.push(b.id);
  }
  const out = parts.filter((s) => s.blocks.length > 0);
  known.set(doc, out);
  return out;
}

const key = new PluginKey('reading');

const OUT = { class: 'is-out' };

function hidden(rt: EditorRuntime, state: EditorState): DecorationSet | null {
  const asked = rt.props.section;
  if (asked === undefined || asked === null) return null;
  const sections = sectionsOf(state.doc);
  const at = sectionAt(sections, asked);
  const shown = new Set(sections[at]?.blocks ?? []);
  const out: Decoration[] = [];
  const title = state.doc.child(0);
  if (at !== 0) out.push(Decoration.node(0, title.nodeSize, OUT));
  for (const b of allBlocks(state.doc)) {
    if (!b.id || !shown.has(b.id) || isBlank(b.node)) out.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, OUT));
  }
  return DecorationSet.create(state.doc, out);
}

export function readingPlugin(rt: EditorRuntime): Plugin {
  return new Plugin({
    key,
    props: { decorations: (state) => hidden(rt, state) },
    view(view: EditorView) {
      let told: readonly DocSection[] | null = null;
      const tell = (state: EditorState) => {
        const report = rt.props.onSections;
        if (!report) return;
        const now = sectionsOf(state.doc);
        if (told && sameSections(told, now)) return;
        told = now;
        report(now);
      };
      tell(view.state);
      return { update: (v, before) => { if (v.state.doc !== before.doc) tell(v.state); } };
    }
  });
}
