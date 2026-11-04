/* The pane and the list of documents down its side. */
import { AnimatePresence, motion } from 'motion/react';
import { Children, useLayoutEffect, useRef, type ComponentProps, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '../../cn';
import { Icon, type IconName } from '../icon';
import { Faces, type AvatarPerson } from '../people';
import { IconButton } from '../primitives';
import { WsPopover, type WsPop } from './popover';
import { useMove } from './shared';

/**
 * The workspace itself: the list and the document side by side, on a card. It fills the box it's given: a panel in a
 * call, or the page in the app. `listOff` tucks the list away and `listPeek` brings it back over the page for a moment;
 * `phoneList` slides it in on a phone. `following` draws the frame that says you're going where someone goes. `reading`
 * is the audience's view of a presentation, `zen` Just the document, and `away` hides the page behind a share on a phone.
 * `page` is outside a call.
 */
export function WsPane({ children, label = 'Workspace', listOff = false, listPeek = false, phoneList = false, following = false, reading = false, zen = false, away = false, page = false, className }: {
  children: ReactNode; label?: string | undefined; listOff?: boolean | undefined; listPeek?: boolean | undefined; phoneList?: boolean | undefined;
  following?: boolean | undefined; reading?: boolean | undefined; zen?: boolean | undefined; away?: boolean | undefined; page?: boolean | undefined; className?: string | undefined;
}) {
  return (
    <section aria-label={label} className={cn('ws-pane', listOff && 'tree-off', listPeek && 'list-peek', phoneList && 'phone-tree', following && 'is-follow', reading && 'is-reading', zen && 'is-zen', away && 'is-away', page && 'in-app', className)}>
      {children}
    </section>
  );
}

/** One row in the tab order, with its faces and actions: the row you're on, the open document, or the first row. */
function keepOneTabStop(list: HTMLElement) {
  const rows = Array.from(list.querySelectorAll<HTMLElement>('.wt-open'));
  const keep = rows.find((el) => el === document.activeElement) ?? rows.find((el) => el.getAttribute('aria-current') === 'page') ?? rows[0];
  for (const row of rows) {
    row.tabIndex = row === keep ? 0 : -1;
    for (const extra of row.parentElement?.querySelectorAll<HTMLElement>('.wt-f, .wt-a') ?? []) extra.tabIndex = row === keep ? 0 : -1;
  }
}

/** Up, Down, Home and End move between rows. */
function moveInList(e: KeyboardEvent<HTMLDivElement>) {
  if (e.target instanceof HTMLInputElement) return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.wt-open'));
  const at = rows.findIndex((el) => el.parentElement?.contains(document.activeElement));
  const to = e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : e.key === 'ArrowUp' ? Math.max(0, at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : null;
  if (to === null) return;
  e.preventDefault();
  rows[to]?.focus();
  keepOneTabStop(e.currentTarget);
}

/**
 * The list: its head (`WsListHead`; someone who isn't a member has none), then `WsSection`s and `WsRow`s as children, and
 * the sealed line at the foot. `empty` says what appears here. Change `listKey` when the workspace changes and the list
 * cross-fades, 240 ms. Rows that leave close up, and ones that arrive open in place, so give each a key. The list is one
 * tab stop: arrow keys move through it, Left and Right close and open a folder.
 */
export function WsList({ head, children, empty = false, listKey, label = 'Documents' }: {
  head?: ReactNode; children?: ReactNode; empty?: boolean | undefined; listKey?: string | undefined; label?: string | undefined;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const move = useMove();
  useLayoutEffect(() => { if (scroll.current) keepOneTabStop(scroll.current); });
  return (
    <aside className="wt" aria-label={label}>
      {head}
      <motion.div key={listKey} ref={scroll} className="wt-scroll" role="tree" aria-label={label} onKeyDown={moveInList} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={move(2)}>
        <AnimatePresence initial={false}>{Children.toArray(children)}</AnimatePresence>
        {empty && <p className="wt-empty">Documents and folders you make show up here.</p>}
      </motion.div>
      <div className="wt-foot"><Icon name="sealed" size={14} /><span>Sealed. Alcove can’t read this.</span></div>
    </aside>
  );
}

/** The top of the list: which workspace (a menu of them in `picker`), find, and what you can make (`create`). */
export function WsListHead({ name, picker, onFind, create }: { name: string; picker: WsPop; onFind: () => void; create: WsPop }) {
  return (
    <div className="wt-head">
      <WsPopover open={picker.open} onOpenChange={picker.onOpenChange} label="This call’s workspace" anchor={
        <button type="button" className="wt-space"><span className="wt-mark"><Icon name="folders" size={15} /></span><span className="n">{name}</span><Icon name="chevronsUpDown" size={14} /></button>
      }>{picker.content}</WsPopover>
      <IconButton icon="search" size={16} className="wt-ib" label="Find in this workspace" title="Find (⌘K)" onClick={onFind} />
      <WsPopover open={create.open} onOpenChange={create.onOpenChange} label="New" anchor={
        <IconButton icon="plus" size={17} className="wt-ib" label="New document or folder" title="New" />
      }>{create.content}</WsPopover>
    </div>
  );
}

/** A heading in the list: This call, Documents. `into`: something's being dragged onto it. */
export function WsSection({ label, area = 'tree', into = false }: { label: ReactNode; area?: 'pins' | 'tree' | undefined; into?: boolean | undefined }) {
  return <div className={cn('wt-sec', into && 'is-into')} data-sec={area} role="presentation">{label}</div>;
}

/** An action that shows when you hover a row. */
function RowAction({ icon, label, ...rest }: { icon: IconName; label: string } & ComponentProps<'button'>) {
  return <button type="button" className="wt-a" aria-label={label} {...rest}><Icon name={icon} size={15} /></button>;
}

/** What a row is. A board slots in here when boards are built. */
export type WsRowKind = 'document' | 'folder' | 'live';

export interface WsRowProps {
  /** The item's ID, on the row as `data-row`, for working out what a drag is over. */
  id: string;
  name: string;
  kind?: WsRowKind | undefined;
  /** A live page's icon: notes, todos, transcript. Documents and folders have their own. */
  icon?: IconName | undefined;
  /** How deep it is in the folders. */
  depth?: number | undefined;
  /** `pins` for what's at the top of the list, `tree` for the folders. It lines names up with the folders' twists. */
  area?: 'pins' | 'tree' | undefined;
  /** A folder that's open. */
  open?: boolean | undefined;
  /** The document that's on the page. */
  current?: boolean | undefined;
  /** A count beside the name, such as open follow-ups. Zero shows nothing. */
  count?: number | undefined;
  /** Who's in it. Pressing them opens `facesCard`. */
  faces?: AvatarPerson[] | undefined;
  facesCard?: WsPop | undefined;
  /** A live page while notes are off. */
  quiet?: boolean | undefined;
  /** It glows, 1.4 s: just made or moved. */
  flash?: boolean | undefined;
  /** Something's being dragged onto it. */
  into?: boolean | undefined;
  /** It's what's being dragged. */
  ghosted?: boolean | undefined;
  onOpen: () => void;
  /** Opens or closes a folder. */
  onTwist?: (() => void) | undefined;
  /** Open beside the document, for a live page. */
  onBeside?: (() => void) | undefined;
  /** ⋯ and right-clicking: `WsRowMenu`, and its `at` is where someone right-clicked. A live page has none. */
  menu?: WsPop | undefined;
  /** Plus on a folder: `WsNewMenu`. */
  add?: WsPop | undefined;
  onRename?: (() => void) | undefined;
  onContextMenu?: ((e: MouseEvent<HTMLDivElement>) => void) | undefined;
  /** Where a drag starts. */
  onPointerDown?: ((e: PointerEvent<HTMLDivElement>) => void) | undefined;
}

/** A document, a folder, or one of the call's live pages. */
export function WsRow({ id, name, kind = 'document', icon, depth = 0, area = 'tree', open = false, current = false, count = 0, faces = [], facesCard, quiet = false, flash = false, into = false, ghosted = false, onOpen, onTwist, onBeside, menu, add, onRename, onContextMenu, onPointerDown }: WsRowProps) {
  const move = useMove();
  const folder = kind === 'folder';
  const glyph = icon ?? (folder ? (open ? 'folderOpen' : 'folder') : 'fileText');
  const keys = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (folder && onTwist && ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open))) { e.preventDefault(); onTwist(); }
  };
  const facesButton = <button type="button" className="wt-f" aria-label={`Who’s in ${name}`}><Faces people={faces} size={16} max={2} /></button>;
  return (
    <motion.div role="treeitem" aria-level={depth + 1} aria-selected={current} aria-expanded={folder ? open : undefined} data-row={id} data-kind={kind} data-area={area}
      className={cn('wt-r', kind === 'live' && 'is-live', quiet && 'is-quiet', current && 'is-cur', flash && 'is-flash', into && 'is-into', ghosted && 'is-ghosted', (menu?.open || add?.open) && 'is-menu')}
      style={{ '--d': depth }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1, transition: move(1) }} exit={{ height: 0, opacity: 0, transition: move(2) }}
      onDoubleClick={onRename ? (e) => { if (e.target instanceof Element && !e.target.closest('.wt-acts')) onRename(); } : undefined} onContextMenu={onContextMenu} onPointerDown={onPointerDown}>
      {folder && <button type="button" tabIndex={-1} className={cn('wt-tw', open && 'is-open')} aria-label={`Open or close ${name}`} onClick={onTwist}><Icon name="chevron" size={13} /></button>}
      <button type="button" className="wt-open" aria-current={current ? 'page' : undefined} onClick={onOpen} onKeyDown={keys}>
        <Icon name={glyph} size={16} /><span className="n">{name}</span>{count > 0 && <span className="wt-c">{count}</span>}
      </button>
      {faces.length > 0 && (facesCard
        ? <WsPopover open={facesCard.open} onOpenChange={facesCard.onOpenChange} label={`Who’s in ${name}`} align="end" anchor={facesButton}>{facesCard.content}</WsPopover>
        : facesButton)}
      <span className="wt-acts">
        {onBeside && <RowAction icon="panelRight" label={`Open ${name} beside the document`} title="Open beside the document" onClick={onBeside} />}
        {menu && <WsPopover open={menu.open} onOpenChange={menu.onOpenChange} at={menu.at} label={`Options for ${name}`} anchor={<RowAction icon="more" label={`Options for ${name}`} />}>{menu.content}</WsPopover>}
        {folder && add && <WsPopover open={add.open} onOpenChange={add.onOpenChange} label={`Add inside ${name}`} anchor={<RowAction icon="plus" label={`Add inside ${name}`} />}>{add.content}</WsPopover>}
      </span>
    </motion.div>
  );
}

/** A row being named, in place: Enter or leaving the field keeps it, Esc goes back. The name's selected when it opens. */
export function WsRenameRow({ name, kind = 'document', depth = 0, placeholder = 'Name this folder', onCommit, onCancel }: {
  name: string; kind?: 'document' | 'folder' | undefined; depth?: number | undefined; placeholder?: string | undefined; onCommit: (name: string) => void; onCancel: () => void;
}) {
  const cancelled = useRef(false);
  return (
    <div className="wt-r is-edit" style={{ '--d': depth }}>
      <Icon name={kind === 'folder' ? 'folder' : 'fileText'} size={16} />
      <input className="wt-in" type="text" aria-label="Name" placeholder={placeholder} defaultValue={name} autoFocus onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { cancelled.current = true; onCancel(); }
        }}
        onBlur={(e) => { if (!cancelled.current) onCommit(e.currentTarget.value); }} />
    </div>
  );
}

/** Where a row will land between two others. `top` from the top of the list's scroll, `left` from its edge. */
export function WsDropLine({ top, left }: { top: number; left: number }) {
  return <span className="wt-line" style={{ top, left }} />;
}

/** What's being dragged, following the pointer, tilted a degree. `x` and `y` in window coordinates. */
export function WsDragGhost({ x, y, icon, label }: { x: number; y: number; icon: IconName; label: string }) {
  return <div className="ws-ghost" style={{ left: x, top: y }}><Icon name={icon} size={15} /><span>{label}</span></div>;
}
