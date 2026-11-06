/* Popovers and menus: what they sit on, one menu for everything, and each menu's rows in the canvas's words. */
import { Popover as RPopover } from 'radix-ui';
import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../cn';
import { Icon, type IconName } from '../icon';
import { Avatar, type AvatarPerson } from '../people';
import { Kbd } from '../primitives';
import { canTakeFocus, focusedNow } from './shared';

/** A place on the screen, in window coordinates: where someone right-clicked. */
export interface WsPoint { x: number; y: number }

/** A popover that belongs to a control: whether it's open, what to do when that changes, and what's in it. */
export interface WsPop {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: ReactNode;
  /** Opens here instead of at the control: where someone right-clicked. */
  at?: WsPoint | undefined;
}

const rectOf = (at: WsPoint | (() => DOMRect)): DOMRect => typeof at === 'function' ? at() : new DOMRect(at.x, at.y, 1, 1);

/**
 * What every menu and sheet in the workspace sits on, against what opened it (`anchor`, which it toggles) or against a
 * place (`at`: a point, or a function that says where a caret or a word is now). It flips to stay on screen, pops in
 * over 140 ms, closes on Esc or a click outside, and puts focus back where it was, or leaves it where someone clicked.
 * On a phone it's a sheet at the bottom of the window. `takeFocus={false}` for one that opens while someone's typing.
 */
export function WsPopover({ id, open, onOpenChange, anchor, at, label, side = 'bottom', align = 'start', takeFocus = true, className, children }: {
  /** For what says it controls this, such as a comment's pin, when that isn't `anchor`. */
  id?: string | undefined;
  open: boolean; onOpenChange: (open: boolean) => void;
  anchor?: ReactElement | undefined; at?: WsPoint | (() => DOMRect) | undefined;
  /** Names it for assistive tech. */
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined; align?: 'start' | 'center' | 'end' | undefined;
  takeFocus?: boolean | undefined; className?: string | undefined; children: ReactNode;
}) {
  const place = useMemo(() => at === undefined ? undefined : { current: { getBoundingClientRect: () => rectOf(at) } }, [at]);
  const back = useRef<HTMLElement | null>(null);
  const away = useRef(false);
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      {anchor && <RPopover.Trigger asChild>{anchor}</RPopover.Trigger>}
      {place && <RPopover.Anchor virtualRef={place} />}
      <RPopover.Portal>
        <RPopover.Content id={id} side={side} align={align} sideOffset={side === 'left' || side === 'right' ? 10 : 6} collisionPadding={8} aria-label={label}
          className={cn('ws-pop', className)} onInteractOutside={() => { away.current = true; }}
          onOpenAutoFocus={(e) => {
            back.current = focusedNow();
            away.current = false;
            if (!takeFocus) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            // What opened as this closed, such as a row being named, has focus by now, and keeps it.
            if (focusedNow()) e.preventDefault();
            else if (canTakeFocus(back.current) && !away.current) { e.preventDefault(); back.current.focus({ preventScroll: true }); }
          }}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/** One row of a menu you can press. */
export interface WsMenuItem {
  type?: 'item' | undefined;
  label: ReactNode;
  /** A second line under the label. */
  sub?: ReactNode;
  icon?: IconName | undefined;
  /** Someone's face in place of an icon. */
  person?: AvatarPerson | undefined;
  /** A keyboard hint at the end of the row. */
  hint?: string | undefined;
  /** The chosen one of a list: it gets a tick. */
  ticked?: boolean | undefined;
  /** It's only saying what's chosen, so the tick isn't in the colour of something you can press. */
  fixed?: boolean | undefined;
  tone?: 'caution' | undefined;
  /** Highlighted by what the keyboard's doing somewhere else, such as in a field that keeps focus. */
  selected?: boolean | undefined;
  /** Only on a phone, where the head of a document has no room for its buttons. */
  phoneOnly?: boolean | undefined;
  onSelect: () => void;
}
export type WsMenuRow = WsMenuItem | { type: 'head'; label: ReactNode } | { type: 'sep' } | { type: 'text'; label: ReactNode; icon?: IconName | undefined };

function Item({ row }: { row: WsMenuItem }) {
  return (
    <button type="button" role={row.ticked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={row.ticked} onClick={row.onSelect}
      className={cn('wm-r', row.tone === 'caution' && 'is-caution', row.ticked && !row.fixed && 'is-on', row.selected && 'is-sel', row.phoneOnly && 'is-phone')}>
      {row.person && <Avatar person={row.person} size={24} />}
      {row.icon && <Icon name={row.icon} size={16} />}
      <span className="t"><span className="l">{row.label}</span>{row.sub && <small>{row.sub}</small>}</span>
      {row.ticked && <Icon name="check" size={15} />}
      {row.hint && <Kbd>{row.hint}</Kbd>}
    </button>
  );
}

/** Up, Down, Home and End move through a menu's rows; Enter and Space press the row that has focus; Esc is the popover's. */
function moveInMenu(e: KeyboardEvent<HTMLDivElement>) {
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.wm-r')).filter((el) => el.offsetParent !== null);
  const last = rows.length - 1;
  const at = rows.findIndex((el) => el === document.activeElement);
  const to = e.key === 'ArrowDown' ? (at === last ? 0 : at + 1) : e.key === 'ArrowUp' ? (at <= 0 ? last : at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
  if (to === null) return;
  e.preventDefault();
  e.stopPropagation();
  rows[to]?.focus();
}

/** A menu: rows, headings, separators and lines of text. `className` for a wider one. `swapped`: it took another menu's place in an open popover, so nothing else gives it the keyboard. */
export function WsMenu({ rows, label, className, swapped = false }: { rows: WsMenuRow[]; label: string; className?: string | undefined; swapped?: boolean | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (swapped) box.current?.querySelector<HTMLElement>('.wm-r')?.focus(); }, [swapped]);
  return (
    <div ref={box} className={cn('wm', className)} role="menu" aria-label={label} onKeyDown={moveInMenu}>
      <div className="wm-list">
        {rows.map((row, i) => {
          if (row.type === 'head') return <div key={i} className="wm-h">{row.label}</div>;
          if (row.type === 'sep') return <div key={i} className="wm-s" role="separator" />;
          if (row.type === 'text') return <p key={i} className="wm-x">{row.icon && <Icon name={row.icon} size={13} />}{row.label}</p>;
          return <Item key={i} row={row} />;
        })}
      </div>
    </div>
  );
}

/** Plus at the top of the list, and on a folder: what you can make. */
export function WsNewMenu({ onDocument, onFolder, onBoard, onUpload }: { onDocument: () => void; onFolder: () => void; onBoard?: (() => void) | undefined; onUpload?: (() => void) | undefined }) {
  const rows: WsMenuRow[] = [
    { icon: 'filePlus', label: 'New document', hint: 'N', onSelect: onDocument },
    { icon: 'folderPlus', label: 'New folder', hint: '⇧N', onSelect: onFolder }
  ];
  if (onBoard) rows.push({ icon: 'presentation', label: 'New board', onSelect: onBoard });
  if (onUpload) rows.push({ type: 'sep' }, { icon: 'cloudUpload', label: 'Upload files', onSelect: onUpload });
  return <WsMenu label="New" rows={rows} />;
}

/**
 * ⋯ on a row, or right-clicking it. A folder (`folder`) has no Duplicate, Bring to this call or Copy link.
 * `brought` says whether the document is in this call; leave it out outside a call. What someone can't do isn't offered:
 * leave its handler out.
 */
export function WsRowMenu({ folder = false, brought, onRename, onDuplicate, onMove, onToggleCall, onCopyLink, onTrash }: {
  folder?: boolean | undefined; brought?: boolean | undefined;
  onRename?: (() => void) | undefined; onDuplicate?: (() => void) | undefined; onMove?: (() => void) | undefined; onToggleCall?: (() => void) | undefined; onCopyLink?: (() => void) | undefined; onTrash?: (() => void) | undefined;
}) {
  const rows: WsMenuRow[] = [];
  if (onRename) rows.push({ icon: 'pen', label: 'Rename', onSelect: onRename });
  if (!folder && onDuplicate) rows.push({ icon: 'copy', label: 'Duplicate', onSelect: onDuplicate });
  if (onMove) rows.push({ icon: 'folderInput', label: 'Move to…', onSelect: onMove });
  if (!folder && brought !== undefined && onToggleCall) rows.push({ icon: 'pin', label: brought ? 'Take out of this call' : 'Bring to this call', onSelect: onToggleCall });
  if (!folder && onCopyLink) rows.push({ icon: 'link', label: 'Copy link', onSelect: onCopyLink });
  if (onTrash) { if (rows.length > 0) rows.push({ type: 'sep' }); rows.push({ icon: 'trash', label: 'Move to Trash', tone: 'caution', onSelect: onTrash }); }
  return <WsMenu label="Options" rows={rows} />;
}

/**
 * ⋯ at the top of a document. `onShare` and `onPresent` show on a phone, where the head has no room for those buttons.
 * What someone can't do isn't offered: leave its handler out.
 */
export function WsDocMenu({ onShare, onPresent, onHistory, onDuplicate, onMove, onCopyLink, onExport, onTrash }: {
  onShare?: (() => void) | undefined; onPresent?: (() => void) | undefined;
  onHistory?: (() => void) | undefined; onDuplicate?: (() => void) | undefined; onMove?: (() => void) | undefined; onCopyLink: () => void; onExport?: (() => void) | undefined; onTrash?: (() => void) | undefined;
}) {
  const rows: WsMenuRow[] = [];
  if (onShare) rows.push({ icon: 'addUser', label: 'Share', phoneOnly: true, onSelect: onShare });
  if (onPresent) rows.push({ icon: 'presentation', label: 'Present', phoneOnly: true, onSelect: onPresent });
  if (onHistory) rows.push({ icon: 'history', label: 'History', onSelect: onHistory });
  if (onDuplicate) rows.push({ icon: 'copy', label: 'Duplicate', onSelect: onDuplicate });
  if (onMove) rows.push({ icon: 'folderInput', label: 'Move to…', onSelect: onMove });
  rows.push({ icon: 'link', label: 'Copy link', onSelect: onCopyLink });
  if (onExport) rows.push({ icon: 'download', label: 'Export as PDF', onSelect: onExport });
  if (onTrash) rows.push({ type: 'sep' }, { icon: 'trash', label: 'Move to Trash', tone: 'caution', onSelect: onTrash });
  return <WsMenu label="More for this document" rows={rows} />;
}

/** A folder something can move to: its name, and the folders it's in as `path`. */
export interface WsFolderChoice { id: string; name: string; path?: string | undefined }

/** Move to…, taking the place of the menu that opened it: the top of the workspace, then its folders. */
export function WsMovePicker({ name, space, folders, onRoot, onFolder }: {
  /** What's moving. */ name: string; /** The workspace's own name. */ space: string; folders: WsFolderChoice[]; onRoot: () => void; onFolder: (id: string) => void;
}) {
  return (
    <WsMenu swapped label={`Move ${name} to`} rows={[
      { type: 'head', label: `Move ${name} to` },
      { icon: 'folders', label: space, onSelect: onRoot },
      ...folders.map((f): WsMenuRow => ({ icon: 'folder', label: f.name, sub: f.path, onSelect: () => onFolder(f.id) }))
    ]} />
  );
}

/** One of someone's workspaces. `icon`: lock for a private one, building for the whole company, folders otherwise. */
export interface WsSpaceChoice { id: string; name: string; sub: string; icon?: 'folders' | 'lock' | 'building' | undefined }

/**
 * The name at the top of the list. Who can choose (`canChoose`, the organizer) sees their workspaces and New workspace;
 * everyone else sees which one it is and who chooses (`organizer`). `heading` for outside a call. `about` holds rows for
 * the workspace you're in, such as its people, under the list.
 */
export function WsSpacePicker({ spaces, current, canChoose, organizer, heading = 'This call’s workspace', about = [], onPick, onNew }: {
  spaces: WsSpaceChoice[]; current: string; canChoose: boolean; organizer?: string | undefined; heading?: string | undefined; about?: WsMenuRow[] | undefined;
  onPick: (id: string) => void; onNew: () => void;
}) {
  const shown = canChoose ? spaces : spaces.filter((s) => s.id === current);
  const rows: WsMenuRow[] = [{ type: 'head', label: heading }, ...shown.map((s): WsMenuRow => ({
    icon: canChoose ? s.icon ?? 'folders' : 'folders', label: s.name, sub: s.sub, ticked: s.id === current, fixed: !canChoose, onSelect: () => onPick(s.id)
  }))];
  if (about.length > 0) rows.push({ type: 'sep' }, ...about);
  if (canChoose) rows.push({ type: 'sep' }, { icon: 'plus', label: 'New workspace', onSelect: onNew });
  else if (organizer) rows.push({ type: 'text', label: `${organizer} chooses the workspace for this call.` });
  return <WsMenu label={heading} rows={rows} />;
}

/** Ask, on the bar over a selection. */
export function WsAskMenu({ onShorter, onChecklist, onSaid }: { onShorter: () => void; onChecklist: () => void; onSaid: () => void }) {
  return (
    <WsMenu label="Ask Alcove" rows={[
      { type: 'head', label: 'Ask Alcove' },
      { icon: 'textLines', label: 'Make this shorter', onSelect: onShorter },
      { icon: 'listChecks', label: 'Turn this into a checklist', onSelect: onChecklist },
      { icon: 'ask', label: 'What was said about this?', onSelect: onSaid },
      { type: 'text', icon: 'sealed', label: 'Written in confidential compute.' }
    ]} />
  );
}
