/*
 * The collaborative editor: a document's text, on ProseMirror, kept in a Y.Doc by y-prosemirror. It loads only when a
 * document opens: import it through `lazy.ts`. Everything it needs from outside comes through its props, so it works
 * on any Y.Doc and knows nothing of the API. See types.ts for what's given and what's handed back.
 */
import { newBlockId, undoMayDelete } from '@alcove/api/retire';
import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { inputRules } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, Selection, TextSelection } from 'prosemirror-state';
import { tableEditing } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { log } from '~/lib/log';
import { initProseMirrorDoc, ySyncPlugin, ySyncPluginKey, yUndoPlugin } from 'y-prosemirror';
import * as Y from 'yjs';
import { hasLive, insertBlocks, movingBlock, removeBlock, setBlockAttrs, setLiveLines, tagAtEnd, turnInto } from './actions';
import { Carets, FileLine, Handles, landing } from './blocks/Handles';
import { RuntimeContext } from './blocks/Media';
import { markViews, nodeViews } from './blocks/views';
import { cleanPastedHTML, cleanSerializer, handlePaste, refuseSlice, refuseText, sliceText, textToSlice, transformCopied, transformPasted } from './clipboard';
import { allBlocks, blockWords, caretInto, findBlock, isBlank, scrollerOf, selectedBlock } from './commands';
import { observeThreads, readThreads } from './comments';
import { editorKeys, typedShortcuts } from './keymap';
import { Menus, useStore } from './menus/Menus';
import { blockIds, fromSync } from './plugins/blockIds';
import { caretsPlugin } from './plugins/carets';
import { decorPlugin, flash } from './plugins/decor';
import { keepInStep } from './plugins/inStep';
import { readingPlugin } from './plugins/reading';
import { retirePlugin } from './plugins/retire';
import { watchPlugin } from './plugins/watch';
import { EditorRuntime, type FileDragState, type ThreadView } from './runtime';
import { safeHref, schema, textAttr } from './schema';
import type { EditorHandle, EditorProps } from './types';
import { contentOf, NodeRecord } from './ydoc';

const elog = log.child({ component: 'editor' });

const SCROLL_MARGIN = 110;
const SCROLL_TIME = 420;

/**
 * y-prosemirror's own, with two differences. Undo leaves elements in place, as everything here does. And it may put back an
 * attribute someone else has changed since: without that, undoing the delete of a block someone else moved can't give it
 * its ID back, and the block and its copy can't be told to be the same block.
 */
function undoManagerFor(fragment: Y.XmlFragment): Y.UndoManager {
  return new Y.UndoManager(fragment, {
    trackedOrigins: new Set([ySyncPluginKey]),
    deleteFilter: (item) => undoMayDelete(item, fragment),
    captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
    ignoreRemoteMapChanges: true
  });
}

/** How many cells each row of a table has. */
const shapeOf = (table: PMNode): string => { const rows: number[] = []; table.forEach((row) => rows.push(row.childCount)); return rows.join(); };

/** Whether a change here altered the rows or columns of a table, rather than what's in its cells. */
function reshaped(before: PMNode, after: PMNode): boolean {
  const tables = new Map<unknown, PMNode>();
  before.forEach((node) => { if (node.type === schema.nodes.table) tables.set(node.attrs['id'], node); });
  let changed = false;
  after.forEach((node) => {
    if (node.type !== schema.nodes.table) return;
    const was = tables.get(node.attrs['id']);
    if (was !== node && (!was || shapeOf(was) !== shapeOf(node))) changed = true;
  });
  return changed;
}

/**
 * Tables, kept even as they're edited. Only for what changes a table's shape here: two browsers that each corrected the
 * same table, on arrival or as they typed in it, would each add what's missing, leave it uneven the other way, and go on
 * for ever. A table left uneven by two people's changes is drawn as it is, and evened out by whoever next changes its shape,
 * just before they do (`evenTables`). With the same state twice, this looks at no table and only sees to the selection.
 */
function tables(rt: EditorRuntime): Plugin {
  const editing = tableEditing();
  const { appendTransaction } = editing.spec;
  return new Plugin({
    ...editing.spec,
    appendTransaction: (transactions, before, after) => (rt.readOnly || transactions.some(fromSync) ? null : appendTransaction?.call(editing, transactions, reshaped(before.doc, after.doc) ? before : after, after))
  });
}

function createView(rt: EditorRuntime, mount: HTMLElement): EditorView {
  const { doc, awareness } = rt.props;
  const fragment = contentOf(doc);
  /* Every document is made with its title and first line, so nothing was synced here. Writing now would make a second title. */
  if (fragment.length === 0) {
    elog.error('the editor opened on a document with nothing in it, so it won’t write until something arrives');
    rt.halted = true;
  }
  const start = initProseMirrorDoc(fragment, schema);
  /* A document that doesn't fit the schema goes through y-prosemirror's own render, which repairs what it can. */
  let fits = true;
  try { start.doc.check(); } catch (err) {
    elog.warn('a document doesn’t fit the schema, so it’s drawn from what fits', { err, blocks: fragment.length });
    fits = false;
  }
  const plugins: Plugin[] = [
    retirePlugin(rt),
    ySyncPlugin(fragment, { mapping: new NodeRecord(start.mapping) }),
    yUndoPlugin({ undoManager: undoManagerFor(fragment) }),
    caretsPlugin(rt, awareness),
    tables(rt),
    inputRules({ rules: typedShortcuts }),
    keymap(editorKeys(rt)),
    keymap(baseKeymap),
    gapCursor(),
    dropCursor({ class: 'ws-dropcaret', color: false, width: 2 }),
    blockIds,
    decorPlugin(rt),
    readingPlugin(rt),
    watchPlugin(rt)
  ];
  const state = EditorState.create(fits ? { schema, doc: start.doc, plugins } : { schema, plugins });
  const view = new EditorView({ mount }, {
    state,
    editable: () => !rt.readOnly && !rt.halted,
    nodeViews: nodeViews(rt),
    markViews: markViews(rt),
    attributes: { class: 'ws-text', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document', spellcheck: 'true' },
    clipboardSerializer: cleanSerializer(rt),
    transformCopied: (slice) => transformCopied(slice),
    clipboardTextSerializer: (slice) => sliceText(rt, slice),
    clipboardTextParser: (text, $context, plain) => textToSlice(text, $context, plain),
    transformPastedHTML: (html) => cleanPastedHTML(html),
    transformPasted: (slice, view) => transformPasted(rt, slice, view),
    handlePaste: (view, event, slice) => handlePaste(rt, view, event, slice),
    handleDrop: (_, __, slice) => refuseSlice(rt, slice),
    handleClickOn(_, __, node, ___, event, direct) {
      if (!direct || !(event.target instanceof Element)) return false;
      const rect = event.target.getBoundingClientRect();
      if (node.type === schema.nodes.mention) { rt.props.onOpenPerson?.(textAttr(node, 'id') ?? '', rect); return true; }
      if (node.type === schema.nodes.docref) {
        const id = textAttr(node, 'doc') ?? '';
        if (rt.props.documentName?.(id) !== undefined) rt.props.onOpenDocument?.(id);
        return true;
      }
      return false;
    },
    handleDOMEvents: {
      /* A link opens from `handleClick`, once. Left alone, the browser would open it as well for someone who can only read. */
      click: (_, event) => { if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault(); return false; },
      paste: (_, event) => refuseText(rt, event, event.clipboardData),
      drop: (_, event) => refuseText(rt, event, event.dataTransfer),
      /* Blocks move by their handles, through `moveBlock`. Text dragged across blocks would be a rewrite of everything it passes, and whatever anyone was typing there would land in the wrong place. */
      dragstart: (_, event) => { event.preventDefault(); return true; }
    },
    handleClick(_, __, event) {
      if (!(event.target instanceof Element)) return false;
      const link = event.target.closest('a[href]');
      if (link && (rt.readOnly || event.metaKey || event.ctrlKey)) {
        const href = safeHref(link.getAttribute('href'));
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      }
      const words = event.target.closest('.wc:not(.is-resolved)');
      const id = words?.getAttribute('data-c');
      if (words && id) rt.props.onOpenThread?.(id, words.getBoundingClientRect());
      return false;
    }
  });
  const redraw = keepInStep(rt, view);
  if (!fits) redraw();
  return view;
}

/** Brings something into view, in 420 ms if asked and if motion's welcome. */
function scrollTo(scroller: HTMLElement, top: number, smooth: boolean): void {
  if (!smooth || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { scroller.scrollTop = top; return; }
  const from = scroller.scrollTop;
  const began = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - began) / SCROLL_TIME);
    scroller.scrollTop = from + (top - from) * (1 - (1 - t) ** 3);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function makeHandle(rt: EditorRuntime): EditorHandle {
  const put = (run: (view: EditorView) => void) => { const v = rt.view; if (v) run(v); };
  const write = (run: (view: EditorView) => void) => { if (!rt.readOnly) put(run); };
  const focusAt = (view: EditorView, selection: Selection) => {
    view.focus();
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  };
  return {
    focus: (where = 'end') => put((view) => {
      const { doc } = view.state;
      const title = doc.child(0);
      if (where === 'title') focusAt(view, TextSelection.create(doc, title.nodeSize - 1));
      else {
        const blocks = allBlocks(doc);
        const block = where === 'start' ? blocks[0] : blocks.at(-1);
        if (block) focusAt(view, where === 'start' ? Selection.near(doc.resolve(block.pos), 1) : Selection.near(doc.resolve(block.pos + block.node.nodeSize), -1));
      }
    }),
    resume: () => put((view) => {
      view.focus();
      const { selection } = view.state;
      if (!selection.empty) view.dispatch(view.state.tr.setSelection(Selection.near(selection.$to, -1)));
    }),
    focusBlock: (id, at = 'start') => put((view) => {
      const ref = findBlock(view.state.doc, id);
      if (ref) focusAt(view, Selection.near(view.state.doc.resolve(at === 'end' ? ref.pos + ref.node.nodeSize - 1 : ref.pos + 1), at === 'end' ? -1 : 1));
    }),
    scrollToBlock: (id, options = {}) => put((view) => {
      const ref = findBlock(view.state.doc, id);
      const dom = ref ? view.nodeDOM(ref.pos) : null;
      if (!(dom instanceof Element)) return;
      const scroller = scrollerOf(view.dom);
      if (scroller) scrollTo(scroller, dom.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - SCROLL_MARGIN, options.smooth === true);
      else dom.scrollIntoView({ block: 'center' });
      if (options.flash) flash(view, id);
    }),
    flashBlock: (id) => put((view) => flash(view, id)),
    insertBlocks: (blocks, at, options) => insertBlocks(rt, blocks, at, options),
    updateBlock: (id, attrs, options) => put((view) => {
      const ref = findBlock(view.state.doc, id);
      if (ref) setBlockAttrs(rt, ref.pos, attrs, options?.history === true);
    }),
    removeBlock: (id) => removeBlock(rt, id),
    selectionBlock: () => (rt.view ? selectedBlock(rt.view.state)?.id ?? null : null),
    blockJSON: (id) => (rt.view ? movingBlock(rt.view.state, id)?.block ?? null : null),
    placeOf: (id) => {
      const blocks = rt.view ? allBlocks(rt.view.state.doc) : [];
      const before = blocks[blocks.findIndex((b) => b.id === id) - 1]?.id;
      return before ? { after: before } : 'start';
    },
    blockWords: () => (rt.view ? blockWords(rt.view.state.doc) : []),
    setLiveLines: (what, lines) => setLiveLines(rt, what, lines),
    hasLive: () => hasLive(rt),
    openSlash: () => write((view) => { view.focus(); view.dispatch(view.state.tr.insertText('/').scrollIntoView()); }),
    openMention: () => write((view) => { view.focus(); view.dispatch(view.state.tr.insertText('@').scrollIntoView()); }),
    tag: (person) => tagAtEnd(rt, person),
    toggleMark: (mark) => write((view) => {
      const { from, to, empty } = view.state.selection;
      const type = schema.marks[mark];
      if (empty) return;
      const tr = view.state.doc.rangeHasMark(from, to, type) ? view.state.tr.removeMark(from, to, type) : view.state.tr.addMark(from, to, type.create());
      view.dispatch(tr);
    }),
    turnInto: (kind) => write((view) => {
      const id = selectedBlock(view.state)?.id;
      if (id) turnInto(rt, id, kind);
    })
  };
}

/** The empty Photos block files are over, if they're over one. */
const intoOf = (drag: FileDragState | null): string | null => (drag && 'into' in drag ? drag.into : null);

/** The empty space under the last block: a press there is a press on a new last line. */
function goToEnd(rt: EditorRuntime): void {
  const view = rt.view;
  if (!view || rt.readOnly) return;
  const last = allBlocks(view.state.doc).at(-1);
  view.focus();
  if (last && isBlank(last.node)) {
    view.dispatch(caretInto(view.state.tr, last.pos + 1).scrollIntoView());
    return;
  }
  const end = view.state.doc.content.size;
  const tr = view.state.tr.insert(end, schema.nodes.line.create({ id: newBlockId() }));
  view.dispatch(caretInto(tr, end + 1).scrollIntoView());
}

function PortalHost({ rt }: { rt: EditorRuntime }) {
  const entries = useStore(rt.portals);
  return <>{entries.map((e) => createPortal(e.render(), e.dom, String(e.key)))}</>;
}

export default function Editor(props: EditorProps) {
  const [rt] = useState(() => new EditorRuntime(props));
  /* The newest props, for handlers that run outside React. Nothing renders differently for having it early. */
  rt.props = props;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const { doc, awareness, readOnly, people, byline, autoFocus } = props;
  const handle = useMemo(() => makeHandle(rt), [rt]);
  useImperativeHandle(props.ref, () => handle, [handle]);

  rt.people = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);

  useLayoutEffect(() => {
    if (!mount || !root) return;
    rt.root = root;
    const view = createView(rt, mount);
    rt.view = view;
    rt.settled = true;
    rt.layout.set(rt.layout.get() + 1);
    if (autoFocus) handle.focus(autoFocus);
    return () => {
      rt.endDrag?.();
      rt.view = null;
      rt.settled = false;
      rt.menu.set(null);
      rt.bar.set(null);
      rt.hover.set(null);
      view.destroy();
    };
    /* A new document is a new editor. Where the caret starts only counts at the start. */
  }, [rt, mount, root, doc, awareness, handle]);

  useEffect(() => {
    const update = () => {
      const threads = new Map<string, ThreadView>();
      for (const t of readThreads(doc)) threads.set(t.id, { open: !t.resolved, count: t.messages.length });
      rt.threads.set(threads);
      rt.refreshAfterTransaction();
    };
    update();
    return observeThreads(doc, update);
  }, [rt, doc]);

  /* Who can edit decides what the page is, and so does the section being presented. Names change under a tag. */
  useEffect(() => { rt.refresh(); }, [rt, readOnly, props.titleHint, props.section]);
  useEffect(() => { rt.names.set(rt.names.get() + 1); });

  /* Files from the desktop land between blocks, wherever the page is under the pointer. */
  useEffect(() => {
    const view = rt.view;
    const area = view ? scrollerOf(view.dom) ?? root : root;
    if (!area) return;
    const wanted = (e: DragEvent) => !rt.readOnly && rt.props.onUpload !== undefined && (e.dataTransfer?.types ?? []).includes('Files');
    /* An empty Photos block under the pointer is where they go: it says "Drop photos here". */
    const emptyUnder = (e: DragEvent): string | null => {
      const block = e.target instanceof Element ? e.target.closest('.wb.is-upload[data-b]') : null;
      return block && area.contains(block) ? block.getAttribute('data-b') : null;
    };
    const over = (e: DragEvent) => {
      if (!wanted(e)) return;
      e.preventDefault();
      /* Files have their own line: ProseMirror's caret for dropped text would stay behind, since it never hears of the drop. */
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      const into = emptyUnder(e);
      if (into) { rt.fileDrag.set(into === intoOf(rt.fileDrag.get()) ? rt.fileDrag.get() : { into }); return; }
      const spot = landing(rt, e.clientY);
      rt.fileDrag.set(spot ? { line: spot.line, after: spot.id } : null);
    };
    const leave = (e: DragEvent) => { if (!(e.relatedTarget instanceof Node && area.contains(e.relatedTarget))) rt.fileDrag.set(null); };
    const drop = (e: DragEvent) => {
      if (!wanted(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const into = emptyUnder(e);
      const spot = into ? null : landing(rt, e.clientY);
      rt.fileDrag.set(null);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (into) rt.props.onUpload?.(files, { replace: into });
      else rt.props.onUpload?.(files, spot ? (spot.side === 'after' ? { after: spot.id } : { before: spot.id }) : 'end');
    };
    area.addEventListener('dragover', over, true);
    area.addEventListener('dragleave', leave, true);
    area.addEventListener('drop', drop, true);
    return () => {
      area.removeEventListener('dragover', over, true);
      area.removeEventListener('dragleave', leave, true);
      area.removeEventListener('drop', drop, true);
    };
  }, [rt, root, mount]);

  const drag = useStore(rt.drag);
  const blank = useStore(rt.blank);
  const end = useCallback(() => goToEnd(rt), [rt]);

  return (
    <RuntimeContext value={rt}>
      <div ref={setRoot} className={drag ? 'ws-ed is-dragging' : 'ws-ed'}>
        <div ref={setMount} />
        <Carets rt={rt} root={root} />
        <Handles rt={rt} root={root} />
        <FileLine rt={rt} />
        <PortalHost rt={rt} />
        {createPortal(byline, rt.byline)}
        <Menus rt={rt} root={root} />
      </div>
      {blank && props.whenBlank ? props.whenBlank : props.below}
      {!readOnly && <button type="button" className="wd-tail" aria-label="Add a line at the end" onClick={end} />}
    </RuntimeContext>
  );
}
