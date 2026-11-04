/* A document's frame: its head, the bars that drop in under it, and the page. What's on the page is the editor's. */
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, Fragment, type HTMLAttributes, type ReactNode } from 'react';
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
 * The head of a document. `crumbs`: the path, the document last. `faces`: who's in it, up to four. Share, Present and ⋯
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
          return <Fragment key={i}><span className={cn('c', last && 'is-last')} aria-current={last ? 'page' : undefined}>{c}</span>{!last && <Icon name="chevron" size={12} />}</Fragment>;
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

/** Someone moved the document you're in to Trash. You can keep reading, and anyone can bring it back. `who` is their first name. */
export function WsGoneBar({ who, onRestore }: { who: string | null; onRestore: () => void }) {
  return (
    <Bar show={who !== null} className="wd-gone">
      <Icon name="trash" size={14} /><span>{who} moved this document to Trash. You can keep reading it.</span>
      <Button size="xs" onClick={onRestore}>Restore it</Button>
    </Bar>
  );
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
export function WsPage({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <div className={cn('wd-page', className)}>{children}</div>;
}

/** Whose it is and when it last changed, under the title. `name` is their first name. */
export function WsDocBy({ person, name, edited }: { person: AvatarPerson; name: string; edited: string }) {
  return <p className="wd-by"><Avatar person={person} size={18} /><span>{name}</span><span className="d">{edited}</span></p>;
}

/** The space under the last block. Pressing it adds a line at the end. */
export function WsTail({ onClick }: { onClick: () => void }) {
  return <button type="button" className="wd-tail" aria-label="Add a line at the end" onClick={onClick} />;
}

/** Something to start a new document from. */
export interface WsTemplate { id: string; name: string; sub: string; icon: IconName }

/** What a new document can start from. Their blocks are the editor's. */
export const WS_TEMPLATES: WsTemplate[] = [
  { id: 'agenda', name: 'Agenda', sub: 'Topics, owners, what carried over', icon: 'listOrdered' },
  { id: 'decisions', name: 'Decision log', sub: 'What was decided, by whom, and why', icon: 'circleCheck' },
  { id: 'retro', name: 'Retro', sub: 'Went well, could improve, actions', icon: 'history' },
  { id: 'brief', name: 'Project brief', sub: 'Goal, people, dates, risks', icon: 'fileText' }
];

/** Under an empty page: a few ways to start. */
export function WsTemplates({ templates = WS_TEMPLATES, onPick }: { templates?: WsTemplate[] | undefined; onPick: (id: string) => void }) {
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

/** A workspace with nothing in it, the first time anyone opens it. `space` is its name. */
export function WsEmpty({ space, onDocument, onFolder }: { space: string; onDocument: () => void; onFolder: () => void }) {
  return (
    <EmptyState className="wd-none" title="Nothing here yet" art={
      <WsArch><path d="M15 58h36" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M22 58a11 11 0 0 1 22 0" fill="none" stroke="currentColor" strokeWidth="1.6" /></WsArch>
    } action={<>
      <Button variant="primary" size="sm" onClick={onDocument}><Icon name="filePlus" size={16} />New document</Button>
      <Button size="sm" onClick={onFolder}><Icon name="folderPlus" size={16} />New folder</Button>
    </>}>Write something together. It stays in {space} after the call, ready for the next one.</EmptyState>
  );
}

/** The call's workspace, for someone who can't open it: it says it's private and nothing more. `organizer` is their first name. */
export function WsNoAccess({ organizer, asked, onAsk }: { organizer: string; asked: boolean; onAsk: () => void }) {
  return (
    <EmptyState className="wd-none" title={asked ? `You asked ${organizer}` : 'This call’s workspace is private'} art={
      <WsArch><path d="M24 44h18v14H24zM28 44v-5a5 5 0 0 1 10 0v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></WsArch>
    } action={asked ? undefined : <Button variant="primary" size="sm" onClick={onAsk}>Ask {organizer}</Button>}>
      {asked ? 'This opens by itself as soon as they share something with you.' : `Ask ${organizer} and they can share what you need. You stay in the call either way.`}
    </EmptyState>
  );
}
