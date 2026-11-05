/*
 * What opens over the page: the `/` and `@` lists at the caret, a block's menu, the bar over a selection and the link
 * field. They sit outside the scrolling page, so nothing clips them, in a layer that takes the page's theme. Focus
 * stays in the text the whole time: keys reach these first, and pressing one never moves the caret.
 */
import { Avatar, Icon, cn, type IconName } from '@alcove/ui';
import { toggleMark } from 'prosemirror-commands';
import { addColumn, addRow, removeColumn, removeRow, TableMap, type TableRect } from 'prosemirror-tables';
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  applyLink, askAboutSelection, commentOnBlock, deleteFromMenu, duplicateBlock, openLinkField, pickDocument, pickMention, pickMoment, pickSlash, sendBlock, startComment, turnInto
} from '../actions';
import { evenTables, findBlock, kindOf, scrollerOf } from '../commands';
import { clockOf } from '../../live/dates';
import type { EditorRuntime, OpenMenu, Store } from '../runtime';
import { schema } from '../schema';
import type { BlockKind, MentionItem, Rect } from '../types';
import { slashGroups, TURN } from './rows';

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get, store.get);

const EDGE = 8;

type Row =
  | { kind: 'head'; label: string }
  | { kind: 'sep' }
  | { kind: 'text'; label: string }
  | { kind: 'turn'; current: BlockKind | null; pick: (kind: BlockKind) => void }
  | { kind: 'item'; key: string; label: string; icon?: IconName | undefined; face?: { name: string; photoUrl?: string | undefined; portrait?: Parameters<typeof Avatar>[0]['person']['portrait'] } | undefined; sub?: string | undefined; hint?: string | undefined; className?: string | undefined; run: () => void };

type Item = Extract<Row, { kind: 'item' }>;
const isItem = (r: Row): r is Item => r.kind === 'item';

/** Runs again on anything that moves what's anchored: the page scrolling or the window changing size. */
function useMoved(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const moved = () => setTick((t) => t + 1);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, []);
  return tick;
}

/** Sits against `anchor`, below it unless there's no room, always inside the window. */
function Popover({ anchor, className, label, role = 'menu', id, children, onMeasure }: { anchor: Rect; className: string; label?: string | undefined; role?: string | undefined; id?: string | undefined; children: ReactNode; onMeasure?: (() => void) | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const below = anchor.bottom + 6;
    const y = below + h > window.innerHeight - EDGE && anchor.top - h - 6 > EDGE ? anchor.top - h - 6 : below;
    setAt({ left: Math.max(EDGE, Math.min(anchor.left, window.innerWidth - w - EDGE)), top: Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE)) });
    onMeasure?.();
  }, [anchor.left, anchor.top, anchor.bottom, onMeasure, children]);
  return (
    /* Unseen while it's measured, but not `hidden`: what's inside may need focus straight away. */
    <div ref={box} id={id} className={cn('ws-pop', className)} role={role} aria-label={label} style={at ?? { opacity: 0 }} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

function TurnRow({ current, pick }: { current: BlockKind | null; pick: (kind: BlockKind) => void }) {
  return (
    <div className="wm-turn">
      {TURN.map((t) => <button key={t.kind} type="button" aria-label={t.label} title={t.label} aria-pressed={current === t.kind} onClick={() => pick(t.kind)}><Icon name={t.icon} size={16} /></button>)}
    </div>
  );
}

/**
 * A list you can move through with the arrow keys. `reset` starts it over when what it lists changes. A list at the `caret`
 * is one focus never enters, so the text says which row is active, for screen readers, and a live region says what it is.
 */
function ListMenu({ rt, rows, anchor, className, label, start, reset, caret, onClose }: { rt: EditorRuntime; rows: Row[]; anchor: Rect; className: string; label: string; start: number; reset: string; caret: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const list = useRef<HTMLDivElement>(null);
  const items = rows.filter(isItem);
  const name = useId();
  const rowId = (r: Item) => `${name}-${r.key}`;
  useEffect(() => setIndex(start), [reset, start]);

  const active = items[index];
  const activeId = active ? rowId(active) : null;
  useEffect(() => {
    const text = rt.view?.dom;
    if (!caret || !text) return;
    text.setAttribute('aria-controls', name);
    if (activeId) text.setAttribute('aria-activedescendant', activeId);
    else text.removeAttribute('aria-activedescendant');
    return () => { for (const a of ['aria-controls', 'aria-activedescendant']) text.removeAttribute(a); };
  }, [rt, caret, name, activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        stop();
        const down = e.key === 'ArrowDown';
        if (items.length > 0) setIndex((i) => ((i < 0 ? (down ? -1 : 0) : i) + (down ? 1 : -1) + items.length) % items.length);
      } else if (e.key === 'Enter' || (e.key === 'Tab' && caret)) {
        const item = items[Math.max(0, index)];
        if (item) { stop(); item.run(); }
      } else if (e.key === 'Escape') {
        stop();
        onClose();
      }
    };
    /* Before the editor's own keys, and on a press anywhere else the menu goes. */
    const onPress = (e: PointerEvent) => { if (!(e.target instanceof Element && e.target.closest('.ws-pop'))) onClose(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPress, true);
    };
  }, [items, index, caret, onClose]);

  useLayoutEffect(() => {
    const box = list.current, on = box?.querySelector<HTMLElement>('.is-sel');
    if (!box || !on) return;
    if (on.offsetTop < box.scrollTop) box.scrollTop = on.offsetTop - 34;
    else if (on.offsetTop + on.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = on.offsetTop + on.offsetHeight - box.clientHeight + 6;
  }, [index]);

  return (
    <>
      {caret && <span className="sr-only" role="status" aria-live="polite">{active?.label}</span>}
      <Popover anchor={anchor} className={cn('wm', className)} id={name} label={label} role={caret ? 'listbox' : 'menu'}>
        <div ref={list} className="wm-list" role="presentation">
          {rows.map((r, i) => {
            if (r.kind === 'head') return <div key={`head-${i}`} className="wm-h" role="presentation">{r.label}</div>;
            if (r.kind === 'sep') return <div key={`sep-${i}`} className="wm-s" role="presentation" />;
            if (r.kind === 'text') return <p key={`text-${i}`} className="wm-x" role="presentation">{r.label}</p>;
            if (r.kind === 'turn') return <TurnRow key="turn" current={r.current} pick={r.pick} />;
            return (
              <button key={r.key} id={rowId(r)} type="button" role={caret ? 'option' : 'menuitem'} aria-selected={caret ? r === active : undefined} className={cn('wm-r', r === active && 'is-sel', r.className)} onClick={r.run}>
                {r.face && <Avatar person={r.face} size={24} />}
                {r.icon && <Icon name={r.icon} size={16} />}
                <span className="t"><span className="l">{r.label}</span>{r.sub && <small>{r.sub}</small>}</span>
                {r.hint && <kbd className="ac-kbd">{r.hint}</kbd>}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

function slashRows(rt: EditorRuntime, menu: Extract<OpenMenu, { kind: 'slash' }>): Row[] {
  const call = rt.props.call;
  const groups = slashGroups(menu.query, call !== undefined, rt.props.onPick !== undefined);
  if (groups.length === 0) return [{ kind: 'text', label: `Nothing called “${menu.query}”.` }];
  return groups.flatMap((g) => [
    { kind: 'head', label: g.title } satisfies Row,
    ...g.items.map((s): Row => ({
      kind: 'item', key: s.id, label: s.name, icon: s.icon, hint: s.hint, className: s.rec ? 'is-rec' : undefined,
      sub: s.rec && call && !call.notes ? 'Notes are off for this call' : undefined,
      run: () => pickSlash(rt, menu, s.id)
    }))
  ]);
}

function mentionRow(item: MentionItem, pick: (item: MentionItem) => void): Row {
  if (item.kind === 'person') return { kind: 'item', key: `p:${item.person.id}`, label: item.person.name, face: item.person, sub: item.sub, className: 'is-person', run: () => pick(item) };
  if (item.kind === 'document') return { kind: 'item', key: `d:${item.id}`, label: item.name, icon: 'fileText', run: () => pick(item) };
  return { kind: 'item', key: `t:${item.date}`, label: item.label, icon: 'cal', run: () => pick(item) };
}

function mentionRows(rt: EditorRuntime, query: string, docsOnly: boolean, pick: (item: MentionItem) => void): Row[] {
  const sections = (rt.props.onMention?.(query, { docsOnly }) ?? []).filter((s) => s.items.length > 0);
  if (sections.length === 0) return [{ kind: 'text', label: `Nobody called “${query}”.` }];
  return sections.flatMap((s) => [{ kind: 'head', label: s.title } satisfies Row, ...s.items.map((i) => mentionRow(i, pick))]);
}

function momentRows(rt: EditorRuntime, block: string): Row[] {
  const lines = rt.props.call?.recent().slice(0, 4) ?? [];
  if (lines.length === 0) return [{ kind: 'text', label: 'Nothing said yet.' }];
  return [
    { kind: 'head', label: 'Just said' },
    ...lines.map((l): Row => ({ kind: 'item', key: l.id, label: l.text, face: l.person ?? { name: l.name }, sub: `${l.person?.name.split(' ')[0] ?? l.name} · ${clockOf(l.at)}`, className: 'is-line', run: () => pickMoment(rt, block, l) }))
  ];
}

/** The table's edges, for adding and removing at the end of it. */
function tableEnd(rt: EditorRuntime, block: string): { rect: TableRect; pos: number } | null {
  const ref = rt.view ? findBlock(rt.view.state.doc, block) : null;
  if (!ref || ref.node.type !== schema.nodes.table) return null;
  const map = TableMap.get(ref.node);
  return { pos: ref.pos, rect: { left: 0, top: 0, right: map.width, bottom: map.height, map, table: ref.node, tableStart: ref.pos + 1 } };
}

function tableRows(rt: EditorRuntime, block: string): Row[] {
  const change = (edit: (t: { rect: TableRect; pos: number }, tr: NonNullable<typeof rt.view>['state']['tr']) => void) => () => {
    const view = rt.view;
    rt.menu.set(null);
    if (!view) return;
    evenTables(view.state, (tr) => { view.dispatch(tr); }, view);
    const t = tableEnd(rt, block);
    if (!t) return;
    const tr = view.state.tr;
    edit(t, tr);
    view.dispatch(tr);
  };
  const t = tableEnd(rt, block);
  if (!t) return [];
  const { height, width } = t.rect.map;
  return [
    { kind: 'item', key: 'row', icon: 'plus', label: 'Add a row', run: change((x, tr) => addRow(tr, x.rect, height)) },
    { kind: 'item', key: 'col', icon: 'plus', label: 'Add a column', run: change((x, tr) => addColumn(tr, x.rect, width)) },
    ...(height > 1 ? [{ kind: 'item', key: 'rowx', icon: 'minus', label: 'Remove the last row', run: change((x, tr) => removeRow(tr, x.rect, height - 1)) } satisfies Row] : []),
    ...(width > 1 ? [{ kind: 'item', key: 'colx', icon: 'minus', label: 'Remove the last column', run: change((x, tr) => removeColumn(tr, x.rect, width - 1)) } satisfies Row] : []),
    { kind: 'sep' }
  ];
}

function blockRows(rt: EditorRuntime, block: string, rect: Rect, keyboard: boolean): Row[] {
  const ref = rt.view ? findBlock(rt.view.state.doc, block) : null;
  if (!ref) return [];
  const kind = kindOf(ref.node);
  const out: Row[] = [];
  const turn = (next: BlockKind) => { rt.menu.set(null); turnInto(rt, block, next); };
  /* The row of kinds is for a pointer. From the keyboard they're rows like the rest. */
  if (kind && keyboard) out.push(...TURN.filter((t) => t.kind !== kind).map((t): Row => ({ kind: 'item', key: `turn-${t.kind}`, icon: t.icon, label: `Turn into ${t.label.toLowerCase()}`, run: () => turn(t.kind) })), { kind: 'sep' });
  else if (kind) out.push({ kind: 'turn', current: kind, pick: turn }, { kind: 'sep' });
  out.push(...tableRows(rt, block));
  if (rt.props.onComment && kind) out.push({ kind: 'item', key: 'comment', icon: 'comment', label: 'Comment', run: () => commentOnBlock(rt, block) });
  const known = ref.node.type !== schema.nodes.unsupported;
  if (known) out.push({ kind: 'item', key: 'dup', icon: 'copy', label: 'Duplicate', run: () => { rt.menu.set(null); duplicateBlock(rt, block); } });
  const copyLink = rt.props.onCopyBlockLink;
  if (copyLink) out.push({ kind: 'item', key: 'link', icon: 'link', label: 'Copy link', run: () => { rt.menu.set(null); copyLink(block); } });
  if (known && rt.props.moveTargets && rt.props.onMoveBlock) out.push({ kind: 'item', key: 'move', icon: 'folderInput', label: 'Move to…', run: () => rt.menu.set({ kind: 'move', block, rect }) });
  out.push({ kind: 'sep' }, { kind: 'item', key: 'delete', icon: 'trash', label: 'Delete', className: 'is-caution', run: () => deleteFromMenu(rt, block) });
  return out;
}

function moveRows(rt: EditorRuntime, block: string): Row[] {
  const targets = rt.props.moveTargets?.() ?? [];
  return [
    { kind: 'head', label: 'Move this block to' },
    ...targets.map((t): Row => ({ kind: 'item', key: t.id, icon: 'fileText', label: t.name, run: () => { void sendBlock(rt, block, t.id); } }))
  ];
}

/** The caret, as something to sit against. */
function caretRect(rt: EditorRuntime, pos: number): Rect | null {
  const view = rt.view;
  if (!view || pos > view.state.doc.content.size) return null;
  const at = view.coordsAtPos(pos);
  return { left: at.left, right: at.right, top: at.top, bottom: at.bottom, width: at.right - at.left, height: at.bottom - at.top };
}

const blockRect = (rt: EditorRuntime, block: string): Rect | null => {
  const ref = rt.view ? findBlock(rt.view.state.doc, block) : null;
  const dom = ref ? rt.view?.nodeDOM(ref.pos) : null;
  return dom instanceof Element ? dom.getBoundingClientRect() : null;
};

function LinkField({ rt, menu }: { rt: EditorRuntime; menu: Extract<OpenMenu, { kind: 'link' }> }) {
  const [value, setValue] = useState(menu.href);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const close = () => { rt.menu.set(null); rt.view?.focus(); };
  return (
    <Popover anchor={menu.rect} className="wv-cmt wv-link" label="Link">
      <div className="in">
        <input
          ref={input} className="wm-in" type="url" aria-label="Link" placeholder="Paste a link" value={value}
          onChange={(e) => setValue(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); applyLink(rt, menu.words, value); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
          }}
          onBlur={close}
        />
        <button type="button" className="ws-send" aria-label="Add the link" onClick={() => applyLink(rt, menu.words, value)}><Icon name="check" size={15} /></button>
      </div>
    </Popover>
  );
}

function FormatBar({ rt }: { rt: EditorRuntime }) {
  const bar = useStore(rt.bar);
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const rect = bar?.rect;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !rect) { setAt(null); return; }
    const page = rt.view ? scrollerOf(rt.view.dom) : null;
    const most = (page?.getBoundingClientRect().right ?? window.innerWidth) - el.offsetWidth - EDGE;
    setAt({ left: Math.max(EDGE, Math.min(rect.left + (rect.width - el.offsetWidth) / 2, most)), top: Math.max(EDGE, rect.top - el.offsetHeight - 8) });
  }, [rect, rt]);
  if (!bar) return null;
  const mark = (type: Parameters<typeof toggleMark>[0]) => () => { const v = rt.view; if (v) toggleMark(type)(v.state, v.dispatch); };
  const m = schema.marks;
  const button = (label: string, title: string, icon: IconName, on: boolean, run: () => void) => (
    <button type="button" aria-label={label} aria-pressed={on} title={title} onClick={run}><Icon name={icon} size={16} /></button>
  );
  return (
    <div ref={box} className="wv-sel" role="toolbar" aria-label="Format the selection" style={at ?? { visibility: 'hidden' }} onMouseDown={(e) => e.preventDefault()}>
      {button('Bold', 'Bold (⌘B)', 'bold', bar.bold, mark(m.bold))}
      {button('Italic', 'Italic (⌘I)', 'italic', bar.italic, mark(m.italic))}
      {button('Strikethrough', 'Strikethrough', 'strike', bar.strike, mark(m.strike))}
      {button('Link', 'Link (⌘K)', 'link', bar.link, () => openLinkField(rt))}
      {button('Highlight', 'Highlight', 'highlighter', bar.highlight, mark(m.highlight))}
      {(rt.props.onComment || rt.props.onAsk) && <span className="sp" />}
      {rt.props.onComment && <button type="button" className="wide" onClick={() => startComment(rt)}><Icon name="comment" size={16} />Comment</button>}
      {rt.props.onAsk && <button type="button" className="wide" onClick={() => askAboutSelection(rt)}><Icon name="ask" size={16} />Ask</button>}
    </div>
  );
}

function OpenList({ rt, menu }: { rt: EditorRuntime; menu: OpenMenu }) {
  useMoved();
  const close = () => {
    if (menu.kind === 'slash' || menu.kind === 'mention') rt.dismissed = menu.from;
    rt.menu.set(null);
    /* Someone without a pointer goes back to the text, not to a handle that may have gone. */
    if (menu.kind === 'block' && menu.keyboard) rt.view?.focus();
  };
  switch (menu.kind) {
    case 'slash': {
      const anchor = caretRect(rt, menu.to);
      return anchor && <ListMenu rt={rt} rows={slashRows(rt, menu)} anchor={anchor} className="is-slash" label="Blocks" start={0} reset={menu.query} caret onClose={close} />;
    }
    case 'mention': {
      const anchor = caretRect(rt, menu.to);
      return anchor && <ListMenu rt={rt} rows={mentionRows(rt, menu.query, false, (item) => pickMention(rt, menu, item))} anchor={anchor} className="is-mention" label="People, documents and dates" start={0} reset={menu.query} caret onClose={close} />;
    }
    case 'documents': {
      const anchor = blockRect(rt, menu.block);
      const pick = (item: MentionItem) => { if (item.kind === 'document') pickDocument(rt, menu.block, item.id); };
      return anchor && <ListMenu rt={rt} rows={mentionRows(rt, '', true, pick)} anchor={anchor} className="is-mention" label="Documents" start={0} reset="" caret onClose={close} />;
    }
    case 'moment': {
      const anchor = blockRect(rt, menu.block);
      return anchor && <ListMenu rt={rt} rows={momentRows(rt, menu.block)} anchor={anchor} className="is-moment" label="Quote what was said" start={0} reset="" caret={false} onClose={close} />;
    }
    case 'block':
      return <ListMenu rt={rt} rows={blockRows(rt, menu.block, menu.rect, menu.keyboard === true)} anchor={menu.rect} className="is-block" label="Block" start={menu.keyboard ? 0 : -1} reset={menu.block} caret={false} onClose={close} />;
    case 'move':
      return <ListMenu rt={rt} rows={moveRows(rt, menu.block)} anchor={menu.rect} className="is-block" label="Move this block to" start={0} reset={menu.block} caret={false} onClose={close} />;
    case 'link':
      return <LinkField rt={rt} menu={menu} />;
    default:
      return null;
  }
}

/** The layer everything floats in. It wears the theme of the page it belongs to, which may not be the window's. */
export function Menus({ rt, root }: { rt: EditorRuntime; root: HTMLElement | null }) {
  const menu = useStore(rt.menu);
  const drag = useStore(rt.drag);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'ws-float';
    document.body.append(el);
    setLayer(el);
    return () => el.remove();
  }, []);
  const themed = root?.closest('.dark, .light');
  useLayoutEffect(() => {
    if (!layer) return;
    layer.classList.toggle('dark', themed?.classList.contains('dark') === true);
    layer.classList.toggle('light', themed?.classList.contains('light') === true);
  });
  if (!layer) return null;
  return createPortal(
    <>
      <FormatBar rt={rt} />
      {menu && <OpenList key={menu.kind} rt={rt} menu={menu} />}
      {drag && (
        <div className="ws-ghost" style={{ left: drag.at.x + 10, top: drag.at.y + 8 }}>
          <Icon name="grip" size={15} /><span>{drag.block.label}</span>
        </div>
      )}
    </>,
    layer
  );
}
