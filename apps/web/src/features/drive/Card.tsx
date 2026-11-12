/*
 * A file on the Drive's sheet, as the kit's `FileCard` draws it: a large picture of it, then its name with its kind's icon,
 * then where it is and who touched it last ("From Team standup · Kofi, 10:12"), said once: a card inside a workspace doesn't
 * say which. The picture is the document's first lines as it is now, read for whoever can open it (`q.previews`); a board is
 * drawn as one, a document that's photos shows them, one that's a PDF its page. Pressing the card opens it; its ⋯ has what
 * else can be done, and Rename asks for the name in the same menu. Grid or list, as the sheet's switch says.
 */
import type { DocumentPreview, PreviewLine } from '@alcove/api';
import { FileCard, Icon, IconButton, WsMenu, WsPopover, type IconName, type ThumbKind, type ThumbLine, type ThumbProps, type WsMenuRow } from '@alcove/ui';
import { useRef, useState, type ReactNode } from 'react';
import { KIND_ICON, fileName, type DriveFile } from './places';

/** What can be done with a card, from its ⋯: leave out what this reader can't do. */
export interface CardActions {
  onOpen: () => void;
  onFullScreen: () => void;
  onCopyLink: () => void;
  onRename?: ((name: string) => void) | undefined;
  onTrash?: (() => void) | undefined;
}

/* ---------- what the picture shows ---------- */

const MARK: Partial<Record<PreviewLine['kind'], ThumbLine['mark']>> = { bullet: 'dot', todo: 'todo', done: 'done' };
/**
 * How a file's card draws it, from what its preview says: a board; a document of photos, a PDF, another file or a video when
 * that's all it holds; otherwise its page, with a heading it starts with as the page's title. Before the preview comes, an
 * empty page.
 */
export function pictureOf(file: Pick<DriveFile, 'kind'>, preview: DocumentPreview | undefined): { kind: ThumbKind; icon?: IconName | undefined; thumb?: Omit<ThumbProps, 'kind' | 'size'> | undefined } {
  if (file.kind === 'board') return { kind: 'board' };
  if (preview && preview.lines.length === 0) {
    if (preview.pictures > 0) return { kind: 'photos', thumb: { count: preview.pictures } };
    if (preview.file === 'PDF') return { kind: 'pdf' };
    if (preview.file) return { kind: 'doc', icon: 'clip' };
    if (preview.videos > 0) return { kind: 'share', icon: 'film' };
  }
  const lines = preview?.lines ?? [];
  const [first, ...rest] = lines;
  const title = first?.kind === 'heading' ? first.text : undefined;
  return { kind: 'doc', thumb: { title, lines: (title === undefined ? lines : rest).map((l): ThumbLine => ({ text: l.text, mark: MARK[l.kind] })) } };
}

/* ---------- naming in place ---------- */

/** A name, typed where it's shown: Enter keeps it, Esc puts it back, and leaving it keeps what's there. */
export function NameField({ name, label, onDone }: { name: string; label: string; onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const finish = (to: string | null) => { if (done.current) return; done.current = true; onDone(to); };
  return (
    <input className="dv-name" type="text" aria-label={label} defaultValue={name} maxLength={200} autoFocus autoComplete="off" spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value.trim() || null); }
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim() || null)} />
  );
}

/* ---------- its menu ---------- */

/** A card's ⋯: Open, Open full screen, Copy link, then Rename and Move to Trash for whoever can. Rename asks for the name in the menu's place. */
function More({ name, current, actions }: { name: string; current: string; actions: CardActions }) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [typed, setTyped] = useState(current);
  const close = (then: () => void) => () => { setOpen(false); then(); };
  const rename = actions.onRename;
  const rows: WsMenuRow[] = [
    { id: 'open', icon: 'fileText', label: 'Open', onSelect: close(actions.onOpen) },
    { id: 'full', icon: 'grow', label: 'Open full screen', onSelect: close(actions.onFullScreen) },
    { id: 'link', icon: 'link', label: 'Copy link', onSelect: close(actions.onCopyLink) }
  ];
  if (rename) rows.push({ type: 'sep' }, { id: 'rename', icon: 'pen', label: 'Rename', onSelect: () => { setTyped(current); setNaming(true); } });
  if (actions.onTrash) rows.push({ type: 'sep' }, { id: 'trash', icon: 'trash', label: 'Move to Trash', onSelect: close(actions.onTrash) });
  return (
    <WsPopover open={open} onOpenChange={(to) => { setOpen(to); if (!to) setNaming(false); }} label={`More for ${name}`} align="end"
      anchor={<IconButton icon="more" size={16} label={`More for ${name}`} />}>
      {naming && rename ? (
        <form className="dv-pop-name" onSubmit={(e) => { e.preventDefault(); const to = typed.trim(); setOpen(false); setNaming(false); if (to && to !== current) rename(to); }}>
          <p className="dv-pop-head"><IconButton icon="left" size={15} label="Back" type="button" onClick={() => setNaming(false)} />Rename</p>
          <input type="text" aria-label={`Rename ${name}`} value={typed} maxLength={200} autoFocus autoComplete="off" spellCheck={false} onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNaming(false); } }} />
        </form>
      ) : <WsMenu label={`More for ${name}`} rows={rows} />}
    </WsPopover>
  );
}

/* ---------- the card and its row ---------- */

/** One file, as a large card. `where` is left out inside the place it's in. */
export function DriveCard({ file, preview, where, by, actions }: { file: DriveFile; preview: DocumentPreview | undefined; where: string | null; by: string; actions: CardActions }) {
  const name = fileName(file.kind, file.name);
  const { kind, icon, thumb } = pictureOf(file, preview);
  return (
    <FileCard size="lg" kind={kind} icon={icon} thumb={thumb} name={name} label={`Open ${name}`} where={where ?? undefined} by={by} onOpen={actions.onOpen}
      menu={<More name={name} current={file.name} actions={actions} />} />
  );
}

/** The same file, as a row of the list. */
export function FileRow({ file, where, by, actions }: { file: DriveFile; where: string | null; by: string; actions: CardActions }) {
  const name = fileName(file.kind, file.name);
  return (
    <div className="dv-row" role="listitem">
      <button type="button" className="dv-row-open" aria-label={`Open ${name}`} onClick={actions.onOpen} />
      <span className="dv-k"><Icon name={KIND_ICON[file.kind]} size={17} /></span>
      <span className="dv-row-t"><b className="ac-clamp-1">{name}</b>{where && <small className="ac-clamp-1">{where}</small>}</span>
      <span className="dv-row-by">{by}</span>
      <span className="dv-row-menu"><More name={name} current={file.name} actions={actions} /></span>
    </div>
  );
}

/** Cards in a grid, or rows in a list, with whatever ends the grid after them (the dashed ways to make something). */
export function Files({ list, children, tail }: { list: boolean; children: ReactNode; tail?: ReactNode }) {
  return list ? <div className="dv-rows" role="list">{children}</div> : <div className="dv-grid">{children}{tail}</div>;
}
