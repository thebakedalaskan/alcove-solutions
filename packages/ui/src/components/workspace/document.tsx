/* A document's frame: its head, the bars that drop in under it, and the page. What's on the page is the editor's. */
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, type HTMLAttributes, type KeyboardEventHandler, type ReactNode } from 'react';
import { cn } from '../../cn';
import { EmptyState } from '../empty';
import { Icon, type IconName } from '../icon';
import { Avatar, Faces, type AvatarPerson } from '../people';
import { Button, IconButton, RecDot } from '../primitives';
import { WsPopover, type WsPop } from './popover';
import { useMove } from './shared';

/** The right of the pane beside the list: the head, the bars, and the page. */
export function WsDoc({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <div className={cn('wd', className)}>{children}</div>;
}

/** `live`: a live page while notes are on. `quiet`: a live page while they're off, which says nothing. */
export type WsSave = 'saved' | 'saving' | 'offline' | 'failed' | 'live' | 'quiet';

const SAVE_WORDS: Record<WsSave, string> = { saved: 'Saved', saving: 'Saving…', offline: 'Reconnecting', failed: 'Couldn’t save', live: 'Live', quiet: '' };

/** The quiet word at the top of every document. */
export function WsSaveState({ state }: { state: WsSave }) {
  return (
    <span role="status" className={cn('wd-save', state === 'quiet' ? 'is-live' : `is-${state}`)}>
      {state === 'live' && <RecDot />}
      {state === 'offline' && <Icon name="wifiOff" size={13} />}
      <span>{SAVE_WORDS[state]}</span>
    </span>
  );
}

/** Someone in this document, and the card that opens when you press their face. */
export interface WsFace { person: AvatarPerson; card: WsPop }

/**
 * The head of a document. `crumbs`: the path, the document last, as much of it as fits, from the end. `faces`: who's in it, up to four. Share, Present and ⋯
 * show when they're given (a live page has none), each a button with its popover. `zen` and `onZen` are for a call: the
 * arrows at the far right.
 */
export function WsDocHead({ crumbs, save, faces = [], onToggleList, share, present, more, zen = false, onZen }: {
  crumbs: string[]; save: WsSave; faces?: WsFace[] | undefined; onToggleList: () => void;
  share?: WsPop | undefined; present?: WsPop | undefined; more?: WsPop | undefined;
  zen?: boolean | undefined; onZen?: (() => void) | undefined;
}) {
  const zenLabel = zen ? 'Show everything' : 'Just the document';
  return (
    <header className="wd-head">
      <IconButton icon="panel" size={17} className="wd-ib" label="Show or hide the document list" title="⌘\" onClick={onToggleList} />
      <nav className="wd-crumbs" aria-label="Where this document is">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return <span key={i} className={cn('cw', last && 'is-last')} style={{ order: crumbs.length - i }}><span className="c" aria-current={last ? 'page' : undefined}>{c}</span>{!last && <Icon name="chevron" size={12} />}</span>;
        })}
      </nav>
      <WsSaveState state={save} />
      {faces.length > 0 && (
        <span className="wd-faces">
          {faces.slice(0, 4).map((f, i) => (
            <WsPopover key={i} open={f.card.open} onOpenChange={f.card.onOpenChange} label={f.person.name} align="end"
              anchor={<button type="button" className="wd-face" aria-label={f.person.name}><Faces people={[f.person]} size={22} /></button>}>{f.card.content}</WsPopover>
          ))}
        </span>
      )}
      {share && <WsPopover open={share.open} onOpenChange={share.onOpenChange} label="Share" align="end" anchor={<Button size="xs">Share</Button>}>{share.content}</WsPopover>}
      {present && <WsPopover open={present.open} onOpenChange={present.onOpenChange} label="Present" align="end" anchor={<Button size="xs" icon="presentation">Present</Button>}>{present.content}</WsPopover>}
      {more && <WsPopover open={more.open} onOpenChange={more.onOpenChange} label="More for this document" align="end" anchor={<IconButton icon="more" size={17} className="wd-ib" label="More for this document" />}>{more.content}</WsPopover>}
      {onZen && <IconButton icon={zen ? 'shrink' : 'grow'} size={16} className="wd-ib" label={zenLabel} title={`${zenLabel} (⌘⇧F)`} onClick={onZen} />}
    </header>
  );
}

/** A bar under the head. It drops in 6 px, 240 ms, and closes up over the same time. */
function Bar({ show, className, children }: { show: boolean; className: string; children: ReactNode }) {
  const move = useMove();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div className={className} role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={move(2)}
          exit={{ opacity: 0, height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0, overflow: 'hidden' }}>{children}</motion.div>
      )}
    </AnimatePresence>
  );
}

/** Who you're following and where they are. `lost`: they're somewhere you can't open, and the bar doesn't name it. */
export interface WsFollowing { person: AvatarPerson; name: string; where: string; lost?: boolean | undefined }

/** Following someone, until you stop. Pair it with `following` on `WsPane`, which draws the frame. */
export function WsFollowBar({ following, onStop }: { following: WsFollowing | null; onStop: () => void }) {
  return (
    <Bar show={!!following} className="wd-follow">
      {following && <>
        <Avatar person={following.person} size={20} />
        <span className="t">Following <b>{following.name}</b></span>
        <span className="w">{following.lost ? 'In a document you can’t open' : following.where}</span>
        <button type="button" className="wd-stop" onClick={onStop}>Stop following<kbd>Esc</kbd></button>
      </>}
    </Bar>
  );
}

/** The connection dropped, and writing carries on. */
export function WsOfflineBar({ show }: { show: boolean }) {
  return <Bar show={show} className="wd-off"><Icon name="wifiOff" size={14} /><span>You’re offline. Keep writing: your edits are safe in this browser and send when you’re back.</span></Bar>;
}

/**
 * Someone moved the document you're in to Trash. You can keep reading, and anyone who can edit it can bring it back:
 * leave `onRestore` out for someone who can't. `who` is their first name.
 */
export function WsGoneBar({ who, onRestore }: { who: string | null; onRestore?: (() => void) | undefined }) {
  return (
    <Bar show={who !== null} className="wd-gone">
      <Icon name="trash" size={14} /><span>{who} moved this document to Trash. You can keep reading it.</span>
      {onRestore && <Button size="xs" onClick={onRestore}>Restore it</Button>}
    </Bar>
  );
}

/** Alcove won't take what's typed here because the document has grown too big. Nothing typed is lost. */
export function WsFullBar({ show }: { show: boolean }) {
  return <Bar show={show} className="wd-off"><Icon name="alert" size={14} /><span>This document is too big to save. Your edits are safe in this browser: move some of it to another document.</span></Bar>;
}

/** You can read this and not change it. */
export function WsReadOnlyBar({ show, organizer }: { show: boolean; organizer: string }) {
  return <Bar show={show} className="wd-ro"><Icon name="eye" size={14} /><span>You can read this. Ask {organizer} to edit.</span></Bar>;
}

/** What scrolls under the head and the bars. Scrolling stops following, so pass `onWheel`. */
export const WsScroll = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function WsScroll({ className, ...rest }, ref) {
  return <div ref={ref} className={cn('wd-scroll', className)} {...rest} />;
});

/** The page: the editor goes in here, with `WsDocBy`, `WsTemplates` and `WsTail` around it. */
export function WsPage({ children, className, onKeyDown }: { children: ReactNode; className?: string | undefined; onKeyDown?: KeyboardEventHandler<HTMLDivElement> | undefined }) {
  return <div className={cn('wd-page', className)} onKeyDown={onKeyDown}>{children}</div>;
}

/** Whose it is and when it last changed, under the title. `name` is their first name. */
export function WsDocBy({ person, name, edited }: { person: AvatarPerson; name: string; edited: string }) {
  return <p className="wd-by"><Avatar person={person} size={18} /><span>{name}</span><span className="d">{edited}</span></p>;
}

/** The space under the last block. Pressing it adds a line at the end. */
export function WsTail({ onClick }: { onClick: () => void }) {
  return <button type="button" className="wd-tail" aria-label="Add a line at the end" onClick={onClick} />;
}

/** Something to start a new document from. What's in them is the editor's. */
export interface WsTemplate { id: string; name: string; sub: string; icon: IconName }

/** Under an empty page: a few ways to start. */
export function WsTemplates({ templates, onPick }: { templates: readonly WsTemplate[]; onPick: (id: string) => void }) {
  return (
    <div className="wd-start">
      <span className="ac-eyebrow">Start from</span>
      <div className="wd-tpls">
        {templates.map((t) => <button key={t.id} type="button" className="wd-tpl" onClick={() => onPick(t.id)}><Icon name={t.icon} size={17} /><span><b>{t.name}</b><small>{t.sub}</small></span></button>)}
      </div>
    </div>
  );
}

/** The dashed arch the workspace's empty pages share, with what `children` draws inside it. */
export function WsArch({ children }: { children?: ReactNode }) {
  return <svg width="66" height="74" viewBox="0 0 66 74" aria-hidden="true"><path d="M3 71V33a30 30 0 0 1 60 0v38z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="4 5" />{children}</svg>;
}

/**
 * A workspace with nothing in it, the first time anyone opens it. `space` is its name. Someone who can only read gets no
 * buttons: leave the handlers out.
 */
export function WsEmpty({ space, page, onDocument, onFolder }: { space: string; page?: boolean | undefined; onDocument?: (() => void) | undefined; onFolder?: (() => void) | undefined }) {
  return (
    <EmptyState className="wd-none" title="Nothing here yet" art={
      <WsArch><path d="M15 58h36" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M22 58a11 11 0 0 1 22 0" fill="none" stroke="currentColor" strokeWidth="1.6" /></WsArch>
    } action={onDocument && onFolder ? <>
      <Button variant="primary" size="sm" onClick={onDocument}><Icon name="filePlus" size={16} />New document</Button>
      <Button size="sm" onClick={onFolder}><Icon name="folderPlus" size={16} />New folder</Button>
    </> : undefined}>{!onDocument ? 'What people write here shows up in the list.' : page ? `Write something together. It stays in ${space}, ready for your next call.` : `Write something together. It stays in ${space} after the call, ready for the next one.`}</EmptyState>
  );
}

/** The arch with a lock in it, for what you can't open. */
const LockedArch = () => <WsArch><path d="M24 44h18v14H24zM28 44v-5a5 5 0 0 1 10 0v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></WsArch>;

/**
 * A document or workspace that isn't open to you, however that came about: it says the same for something taken from you,
 * something deleted and something that never was. `action` is the way back.
 */
export function WsCantOpen({ what, action }: { what: 'document' | 'workspace'; action?: ReactNode }) {
  return (
    <EmptyState className="wd-none" title={`You can’t open this ${what}`} art={<LockedArch />} action={action}>
      {what === 'document' ? 'It was deleted, or it isn’t shared with you any more. Ask whoever shared it.' : 'It was deleted, or you aren’t in it any more. Ask whoever added you.'}
    </EmptyState>
  );
}

/** A workspace that hasn't opened, and no connection to open it with. It opens by itself. */
export function WsOfflineEmpty() {
  return (
    <EmptyState className="wd-none" title="You’re offline" art={<WsArch><path d="M21 47a17 17 0 0 1 24 0M27 53a9 9 0 0 1 12 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M33 59h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></WsArch>}>
      This opens by itself when you’re back. Anything you wrote offline is safe in this browser.
    </EmptyState>
  );
}

/** A workspace with folders in it and no document open: what to do next. */
export function WsPickDocument({ onDocument }: { onDocument?: (() => void) | undefined }) {
  return (
    <EmptyState className="wd-none" title="Pick a document" art={
      <WsArch><path d="M24 40h18M24 47h18M24 54h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></WsArch>
    } action={onDocument && <Button variant="primary" size="sm" onClick={onDocument}><Icon name="filePlus" size={16} />New document</Button>}>
      Everything in this workspace is in the list. {onDocument ? 'Open something, or start a new one.' : 'Open something to read it.'}
    </EmptyState>
  );
}

/** Something in Trash. `sub`: who sent it there, when, and how long it has left. `onRestore` and `onDelete` for someone who can edit it. */
export interface WsTrashItem { id: string; name: string; sub: string; folder?: boolean | undefined; onOpen?: (() => void) | undefined; onRestore?: (() => void) | undefined; onDelete?: WsPop | undefined }

/** What Delete forever asks, in place of the button. */
export function WsDeleteAsk({ name, onDelete, onKeep }: { name: string; onDelete: () => void; onKeep: () => void }) {
  return (
    <div className="wv-switch">
      <b>Delete {name} for good?</b>
      <p>It goes for everyone, with everything in it. Nobody can bring it back.</p>
      <div className="ac">
        <Button variant="primary" size="sm" onClick={onDelete}>Delete forever</Button>
        <Button variant="quiet" size="sm" onClick={onKeep}>Keep it</Button>
      </div>
    </div>
  );
}

/** Trash, on the page: what's in it, the newest first. */
export function WsTrash({ items }: { items: WsTrashItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState className="wd-none" title="Nothing in Trash" art={<WsArch><path d="M23 42h20M26 42l1.5 16h11L40 42M29 42v-3h8v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></WsArch>}>
        What you move to Trash stays here for 30 days. Anyone in the workspace can bring it back.
      </EmptyState>
    );
  }
  return (
    <div className="wd-page wx">
      <h1 className="wl-t">Trash</h1>
      <p className="wl-s">Kept for 30 days, then deleted for good. Anyone in the workspace can bring it back.</p>
      <ul className="wx-l">
        {items.map((t) => {
          const line = <><Icon name={t.folder ? 'folder' : 'fileText'} size={16} /><span className="m"><b>{t.name}</b><small>{t.sub}</small></span></>;
          return (
            <li key={t.id} className="wx-r">
              {t.onOpen ? <button type="button" className="wx-o" onClick={t.onOpen}>{line}</button> : <span className="wx-o">{line}</span>}
              {t.onRestore && <Button size="xs" onClick={t.onRestore}>Restore</Button>}
              {t.onDelete && (
                <WsPopover open={t.onDelete.open} onOpenChange={t.onDelete.onOpenChange} label={`Delete ${t.name} for good`} align="end"
                  anchor={<IconButton icon="trash" size={15} className="wd-ib" label={`Delete ${t.name} for good`} title="Delete forever" />}>{t.onDelete.content}</WsPopover>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The call's workspace, for someone who can't open it: it says it's private and nothing more. `organizer` is their first name. */
export function WsNoAccess({ organizer, asked, onAsk }: { organizer: string; asked: boolean; onAsk?: (() => void) | undefined }) {
  return (
    <EmptyState className="wd-none" title={asked ? `You asked ${organizer}` : 'This call’s workspace is private'} art={<LockedArch />} action={asked || !onAsk ? undefined : <Button variant="primary" size="sm" onClick={onAsk}>Ask {organizer}</Button>}>
      {asked ? 'This opens by itself as soon as they share something with you.' : onAsk ? `Ask ${organizer} and they can share what you need. You stay in the call either way.` : `${organizer} can share what you need. You stay in the call either way.`}
    </EmptyState>
  );
}

/** The call's organizer, taken out of the workspace it uses: the call keeps it for everyone else until they give it another. */
export function WsLostSpace({ onNew }: { onNew: () => void }) {
  return (
    <EmptyState className="wd-none" title="You’re not in this call’s workspace any more" art={<LockedArch />} action={<Button variant="primary" size="sm" icon="plus" onClick={onNew}>New workspace</Button>}>
      Make a new one and this call uses it. Nobody is disconnected.
    </EmptyState>
  );
}
