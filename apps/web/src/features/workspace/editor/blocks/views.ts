/*
 * How blocks are drawn: the canvas's markup, around text ProseMirror owns. Everything beside the text (a checkbox, a
 * fold, a comment count) is outside `contentDOM`, so ProseMirror ignores it and the caret never lands in it. Blocks
 * that aren't text are drawn by React into the element here: see Media.tsx.
 */
import { firstName } from '@alcove/api';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import type { Decoration, EditorView, MarkView, MarkViewConstructor, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';
import { createElement } from 'react';
import type { EditorRuntime } from '../runtime';
import { blockIdOf, headingLevel, indentAttr, isGone, lineKind, numberAttr, textAttr, textOf } from '../schema';
import { dateLabel } from './dates';
import { CALLOUT_ICONS, iconNode } from './icons';
import { MediaBlock, PersonFace } from './Media';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const out = document.createElement(tag);
  if (className) out.className = className;
  return out;
}

/** Something drawn into the text that isn't text. */
function solid<T extends HTMLElement>(node: T): T {
  node.contentEditable = 'false';
  return node;
}

const onControl = (e: Event): boolean => e.target instanceof Element && e.target.closest('.wb-box, .wb-fold, .wb-th') !== null;

/** Moves as it arrives, once: left on, the animation would run again each time the page is shown. */
function arrive(el: HTMLElement): void {
  el.classList.add('is-new');
  el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
}

/** Keeps the caret where it is when something beside the text is pressed. */
const keepCaret = (control: HTMLElement) => control.addEventListener('mousedown', (e) => e.preventDefault());

/** What every top-level block has: its ID, its indent and the count of comments in the margin. */
abstract class BlockFrame {
  readonly dom: HTMLElement;
  abstract contentDOM: HTMLElement | null;
  private margin: HTMLButtonElement | null = null;
  private thread: string | null = null;

  protected constructor(protected node: PMNode, protected readonly rt: EditorRuntime, className: string, decorations: readonly Decoration[]) {
    this.dom = el('div', `wb ${className}`);
    this.frame(node, decorations);
  }

  protected frame(node: PMNode, decorations: readonly Decoration[]): void {
    this.node = node;
    const id = blockIdOf(node);
    if (id) this.dom.setAttribute('data-b', id);
    this.dom.style.setProperty('--ind', String(indentAttr(node)));
    const shown = decorations.find((d) => typeof d.spec.threadId === 'string');
    this.showThreads(textOf(shown?.spec.threadId), typeof shown?.spec.threadCount === 'number' ? shown.spec.threadCount : 0);
  }

  private showThreads(thread: string | null, count: number): void {
    this.thread = thread;
    if (thread === null) {
      this.margin?.remove();
      this.margin = null;
      return;
    }
    if (!this.margin) {
      const button = solid(el('button', 'wb-th'));
      button.type = 'button';
      button.setAttribute('aria-label', 'Open the comments');
      button.append(iconNode('comment'), el('span'));
      keepCaret(button);
      button.addEventListener('click', () => { if (this.thread) this.rt.props.onOpenThread?.(this.thread, button.getBoundingClientRect()); });
      this.dom.append(button);
      this.margin = button;
    }
    const label = this.margin.querySelector('span');
    if (label) label.textContent = String(count);
  }

  stopEvent(e: Event): boolean { return onControl(e); }

  /*
   * By default ProseMirror rebuilds a node when anything in it changes, even outside its text. Everything drawn around
   * the text is ours to change: left to the default, ticking a box or renumbering a line rebuilds the block, faces and all.
   */
  ignoreMutation(m: ViewMutationRecord): boolean {
    const text = this.contentDOM;
    if (!text) return m.type !== 'selection';
    return !text.contains(m.target) || (m.type === 'attributes' && m.target === text);
  }
}

/** What's drawn before a line depends on these, so it only changes when they do. */
const leadKey = (node: PMNode): string => `${lineKind(node)}:${textAttr(node, 'icon')}`;

/** A line of text, of any kind, or code. A line that changes kind stays the same line: only what's around its text changes. */
class TextBlock extends BlockFrame implements NodeView {
  contentDOM: HTMLElement;
  private text: HTMLElement;
  private box: HTMLButtonElement | null = null;
  private number: HTMLElement | null = null;
  private lead: HTMLElement | null = null;
  private drawnLead: string | null = null;

  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined, rt: EditorRuntime, decorations: readonly Decoration[]) {
    super(node, rt, textClass(node), decorations);
    this.setLead(node);
    const col = el('div', 'wb-col');
    this.text = el('div', 'wb-t');
    this.contentDOM = this.text;
    this.text.setAttribute('data-ph', placeholderOf(node));
    if (node.type.spec.code) this.text.spellcheck = false;
    col.append(this.text);
    this.dom.insertBefore(col, this.dom.querySelector('.wb-th'));
    this.paint(node, decorations);
  }

  private setLead(node: PMNode): void {
    const key = leadKey(node);
    if (key === this.drawnLead) return;
    this.drawnLead = key;
    this.lead?.remove();
    this.box = null;
    this.number = null;
    this.lead = this.leadFor(node);
    if (this.lead) this.dom.prepend(this.lead);
  }

  private leadFor(node: PMNode): HTMLElement | null {
    switch (lineKind(node)) {
      case 'bullet': { const mark = solid(el('span', 'wb-mk')); mark.setAttribute('aria-hidden', 'true'); return mark; }
      case 'numbered': this.number = solid(el('span', 'wb-n')); return this.number;
      case 'callout': {
        const icon = solid(el('span', 'wb-ci'));
        const name = textAttr(node, 'icon');
        icon.append(iconNode(CALLOUT_ICONS.find((i) => i === name) ?? 'bulb'));
        return icon;
      }
      case 'todo': {
        const box = solid(el('button', 'wb-box'));
        box.type = 'button';
        box.setAttribute('role', 'checkbox');
        box.setAttribute('aria-label', 'Done');
        box.append(iconNode('check'));
        if (this.rt.settled) arrive(box);
        keepCaret(box);
        box.addEventListener('click', () => {
          const pos = this.getPos();
          if (pos === undefined || this.rt.readOnly) return;
          this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'done', this.node.attrs['done'] !== true));
        });
        this.box = box;
        return box;
      }
      default: return null;
    }
  }

  private paint(node: PMNode, decorations: readonly Decoration[]): void {
    const done = node.attrs['done'] === true;
    this.dom.classList.toggle('is-done', done);
    this.box?.setAttribute('aria-checked', String(done));
    this.box?.toggleAttribute('disabled', this.rt.readOnly);
    const count: unknown = decorations.find((d) => typeof d.spec.number === 'number')?.spec.number;
    if (this.number && typeof count === 'number') this.number.textContent = `${count}.`;
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type || isGone(node)) return false;
    const was = textClass(this.node), now = textClass(node);
    if (was !== now) {
      this.dom.classList.replace(was, now);
      this.text.setAttribute('data-ph', placeholderOf(node));
    }
    this.setLead(node);
    this.frame(node, decorations);
    this.paint(node, decorations);
    return true;
  }
}

const textClass = (node: PMNode): string => {
  if (node.type.spec.code) return 'is-code';
  switch (lineKind(node)) {
    case 'heading': return `is-h${headingLevel(node)}`;
    case 'bullet': return 'is-ul';
    case 'numbered': return 'is-ol';
    case 'todo': return 'is-todo';
    case 'quote': return 'is-quote';
    case 'callout': return 'is-callout';
    default: return 'is-p';
  }
};

function placeholderOf(node: PMNode): string {
  if (node.type.spec.code) return '';
  switch (lineKind(node)) {
    case null: return 'Press / for blocks, @ to tag someone';
    case 'heading': return `Heading ${headingLevel(node)}`;
    case 'bullet': case 'numbered': return 'List';
    case 'todo': return 'To do';
    default: return '';
  }
}

/** A line and what folds away under it. Someone who can only read can still fold it, on their screen. */
class ToggleBlock extends BlockFrame implements NodeView {
  contentDOM: HTMLElement;
  private fold: HTMLButtonElement;
  private mine: boolean | null = null;

  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined, rt: EditorRuntime, decorations: readonly Decoration[]) {
    super(node, rt, 'is-toggle', decorations);
    this.fold = solid(el('button', 'wb-fold'));
    this.fold.type = 'button';
    this.fold.setAttribute('aria-label', 'Open or close');
    this.fold.append(iconNode('chevron'));
    keepCaret(this.fold);
    this.fold.addEventListener('click', () => this.flip());
    this.contentDOM = el('div', 'wb-col');
    this.dom.prepend(this.fold, this.contentDOM);
    this.paint();
  }

  private get open(): boolean { return this.mine ?? this.node.attrs['open'] === true; }

  private flip(): void {
    const pos = this.getPos();
    if (this.rt.readOnly || pos === undefined) {
      this.mine = !this.open;
      this.paint();
      return;
    }
    /* What's folded isn't an edit, so it isn't undone with one. */
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'open', !this.open).setMeta('addToHistory', false));
  }

  private paint(): void {
    this.dom.classList.toggle('is-open', this.open);
    this.fold.classList.toggle('is-open', this.open);
    this.fold.setAttribute('aria-expanded', String(this.open));
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type || isGone(node)) return false;
    this.frame(node, decorations);
    this.paint();
    return true;
  }
}

/** A toggle's line, or what's under it. */
const toggleText = (className: string, placeholder: string): NodeViewConstructor => () => {
  const dom = el('div', className);
  if (placeholder) dom.setAttribute('data-ph', placeholder);
  return { dom, contentDOM: dom };
};

class TableBlock extends BlockFrame implements NodeView {
  contentDOM: HTMLElement;

  constructor(node: PMNode, rt: EditorRuntime, decorations: readonly Decoration[]) {
    super(node, rt, 'is-table', decorations);
    const table = el('table', 'wb-tbl');
    this.contentDOM = el('tbody');
    table.append(this.contentDOM);
    this.dom.prepend(table);
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type || isGone(node)) return false;
    this.frame(node, decorations);
    return true;
  }
}

class DividerBlock extends BlockFrame implements NodeView {
  contentDOM = null;

  constructor(node: PMNode, rt: EditorRuntime, decorations: readonly Decoration[]) {
    super(node, rt, 'is-divider', decorations);
    this.dom.prepend(el('hr', 'wb-hr'));
  }
  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type || isGone(node)) return false;
    this.frame(node, decorations);
    return true;
  }
}

/** What a media block's class is: it changes as it fills up. */
function atomClass(node: PMNode): string {
  const items: unknown = node.attrs['items'];
  const uploading = numberAttr(node, 'up') !== null && !textAttr(node, 'failed');
  switch (node.type.name) {
    case 'gallery': {
      const count = Array.isArray(items) ? items.length : 0;
      return `${count === 0 ? 'is-upload' : count === 1 ? 'is-photo' : 'is-gallery'}${uploading ? ' is-uploading' : ''}`;
    }
    case 'unsupported': return 'is-unknown';
    default: return `is-${node.type.name}${uploading ? ' is-uploading' : ''}`;
  }
}

/** A block that isn't text: React draws it from its attributes. */
class AtomBlock extends BlockFrame implements NodeView {
  contentDOM = null;
  private portal: number;
  private classes: string;

  constructor(node: PMNode, rt: EditorRuntime, getPos: () => number | undefined, decorations: readonly Decoration[]) {
    super(node, rt, atomClass(node), decorations);
    this.classes = atomClass(node);
    this.getPos = getPos;
    if (rt.settled) arrive(this.dom);
    this.portal = rt.portals.add(this.dom, () => this.draw());
  }

  private getPos: () => number | undefined;

  private draw() {
    return createElement(MediaBlock, { node: this.node, getPos: this.getPos });
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type || isGone(node)) return false;
    this.frame(node, decorations);
    const next = atomClass(node);
    if (next !== this.classes) {
      for (const c of this.classes.split(' ')) this.dom.classList.remove(c);
      for (const c of next.split(' ')) this.dom.classList.add(c);
      this.classes = next;
    }
    this.rt.portals.update(this.portal, () => this.draw());
    return true;
  }

  /* Its own controls work; a press anywhere else selects the block. */
  override stopEvent(e: Event): boolean {
    return e.target instanceof Element && e.target.closest('button, input, a, video, audio, .wb-hand') !== null;
  }

  /* React draws all of it, and the caption's own selection is the caption's. */
  override ignoreMutation(): boolean { return true; }

  destroy(): void { this.rt.portals.remove(this.portal); }
}

/** A person's name in the text, with their face, which React draws. */
class MentionChip implements NodeView {
  dom: HTMLElement;
  private face: HTMLElement;
  private label: HTMLElement;
  private portal: number;

  constructor(private node: PMNode, private rt: EditorRuntime) {
    this.dom = solid(el('span', 'wn'));
    this.face = el('span', 'wn-f');
    this.label = el('b');
    this.dom.append(this.face, this.label);
    this.portal = rt.portals.add(this.face, () => this.draw());
    this.paint();
  }

  private draw() { return createElement(PersonFace, { id: textAttr(this.node, 'id') ?? '', name: textAttr(this.node, 'name') ?? '', size: 17 }); }

  private paint(): void {
    this.dom.setAttribute('data-p', textAttr(this.node, 'id') ?? '');
    this.label.textContent = firstName(textAttr(this.node, 'name') ?? '');
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.paint();
    this.rt.portals.update(this.portal, () => this.draw());
    return true;
  }

  destroy(): void { this.rt.portals.remove(this.portal); }
}

const dateChip = (node: PMNode): NodeView => {
  const dom = solid(el('span', 'wdt'));
  const label = el('b');
  const paint = (n: PMNode) => {
    const date = textAttr(n, 'date') ?? '';
    dom.setAttribute('data-d', date);
    label.textContent = dateLabel(date);
  };
  dom.append(iconNode('cal'), label);
  paint(node);
  return { dom, update: (next) => { if (next.type !== node.type) return false; paint(next); return true; } };
};

/** A document named in the text. Its name is this reader's to know or not: nothing is stored with the tag. */
class DocumentChip implements NodeView {
  dom: HTMLElement;
  private label: HTMLElement;
  private stop: () => void;

  constructor(private node: PMNode, private rt: EditorRuntime) {
    this.dom = solid(el('span', 'wdl'));
    this.label = el('b');
    this.dom.append(iconNode('fileText'), this.label);
    this.paint();
    this.stop = rt.names.subscribe(() => this.paint());
  }

  private paint(): void {
    const doc = textAttr(this.node, 'doc') ?? '';
    this.dom.setAttribute('data-doc', doc);
    this.label.textContent = this.rt.props.documentName?.(doc) ?? 'A document you can’t open';
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.paint();
    return true;
  }

  destroy(): void { this.stop(); }
}

/** The words a comment hangs on. Resolved, the mark fades and stays in the text, so Reopen has nothing to rebuild. */
function commentMark(rt: EditorRuntime): MarkViewConstructor {
  return (mark: Mark): MarkView => {
    const id = textOf(mark.attrs['id']) ?? '';
    const dom = el('mark', 'wc');
    dom.setAttribute('data-c', id);
    if (rt.settled) arrive(dom);
    const paint = () => dom.classList.toggle('is-resolved', rt.threads.get().get(id)?.open === false);
    paint();
    const stop = rt.threads.subscribe(paint);
    return { dom, contentDOM: dom, ignoreMutation: (m) => m.type === 'attributes', destroy: stop };
  };
}

/**
 * A block that has left the page: as little as ProseMirror will take, since a document can gather a lot of these. It's
 * flat rather than `display: none`, which browsers walk through one by one every time a selection is placed beside a run of
 * them. A caret that gets into one doesn't stay (`keepCaretOnPage`). What a table or a toggle is made of isn't drawn at all:
 * it stays editable all the same, because a selection jumps away from a run of blocks that aren't.
 */
function goneBlock(node: PMNode): NodeView {
  const dom = el('div', 'wb is-gone');
  dom.setAttribute('aria-hidden', 'true');
  if (!node.isLeaf && !node.isTextblock) dom.setAttribute('contenteditable', 'true');
  return { dom, contentDOM: node.isTextblock ? dom : null, update: (next) => next.type === node.type && isGone(next), ignoreMutation: () => true };
}

const onPage = (view: NodeViewConstructor): NodeViewConstructor => (node, editor, getPos, decorations, inner) => (isGone(node) ? goneBlock(node) : view(node, editor, getPos, decorations, inner));

export function nodeViews(rt: EditorRuntime): Record<string, NodeViewConstructor> {
  const text = onPage((node, view, getPos, decorations) => new TextBlock(node, view, getPos, rt, decorations));
  const atom = onPage((node, _, getPos, decorations) => new AtomBlock(node, rt, getPos, decorations));
  return {
    title: () => { const dom = el('h1', 'wd-title'); dom.setAttribute('data-ph', 'Untitled'); return { dom, contentDOM: dom }; },
    line: text, code: text,
    toggle: onPage((node, view, getPos, decorations) => new ToggleBlock(node, view, getPos, rt, decorations)),
    toggleSummary: toggleText('wb-t', ''),
    toggleBody: toggleText('wb-t wb-body', 'Write inside this toggle'),
    divider: onPage((node, _, __, decorations) => new DividerBlock(node, rt, decorations)),
    table: onPage((node, _, __, decorations) => new TableBlock(node, rt, decorations)),
    gallery: atom, file: atom, video: atom, doclink: atom, board: atom, live: atom, moment: atom, unsupported: atom,
    unsupportedInline: () => {
      const dom = solid(el('span', 'wdt'));
      dom.title = 'This needs a newer Alcove. Reload to see it.';
      dom.append(iconNode('alert'));
      return { dom };
    },
    mention: (node) => new MentionChip(node, rt),
    dateChip: (node) => dateChip(node),
    docref: (node) => new DocumentChip(node, rt)
  };
}

export const markViews = (rt: EditorRuntime): Record<string, MarkViewConstructor> => ({ comment: commentMark(rt) });
