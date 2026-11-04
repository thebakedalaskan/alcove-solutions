/* The workspace's toasts, in the canvas's words, and the bar above a phone's keyboard. */
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../cn';
import { Icon, type IconName } from '../icon';
import { Avatar, type AvatarPerson } from '../people';
import { useMove } from './shared';

/** A toast: a face or an icon, the words, and maybe one thing to press. `ms` is how long to leave it up. */
export interface WsToastData {
  person?: AvatarPerson | undefined;
  icon?: IconName | undefined;
  text: ReactNode;
  action?: { label: string; onClick: () => void } | undefined;
  ms: number;
}

const PLAIN = 5200;
const say = (icon: IconName, text: string, action?: WsToastData['action']): WsToastData => ({ icon, text, action, ms: PLAIN });

/** Every toast in the workspace. Each returns what to show; `WsToasts` draws it, and whoever shows it takes it away after `ms`. */
export const wsToast = {
  linkCopied: () => say('link', 'Link copied. It only opens for people with access.'),
  exported: () => say('download', 'Exported as PDF'),
  moved: (where: string, onUndo: () => void) => say('folderInput', `Moved to ${where}`, { label: 'Undo', onClick: onUndo }),
  broughtToCall: (name: string) => say('pin', `${name} is in this call for everyone`),
  trashed: (name: string, onUndo: () => void) => say('trash', `${name} moved to Trash`, { label: 'Undo', onClick: onUndo }),
  blockDeleted: (onUndo: () => void) => say('trash', 'Block deleted', { label: 'Undo', onClick: onUndo }),
  canOpen: (first: string, level: 'read' | 'edit', document: string) => say('check', `${first} can ${level} ${document}`),
  stoppedFollowing: (first: string, onAgain: () => void) => say('navigate', `Stopped following ${first}`, { label: 'Follow again', onClick: onAgain }),
  cantOpen: (first: string) => say('lock', `${first} is in a document you can’t open`),
  tagged: (person: AvatarPerson, first: string, document: string, onGo: () => void): WsToastData => ({ person, text: `${first} tagged you in ${document}`, action: { label: 'Go there', onClick: onGo }, ms: 9000 }),
  resolved: (onReopen: () => void) => say('check', 'Comment resolved', { label: 'Reopen', onClick: onReopen }),
  addedTo: (document: string, onGo: () => void) => say('check', `Added to ${document}`, { label: 'Go there', onClick: onGo }),
  restoredVersion: (when: string, onUndo: () => void) => say('history', `Restored the version from ${when}`, { label: 'Undo', onClick: onUndo }),
  restored: () => say('history', 'Restored. Everyone sees it again.'),
  stoppedPresenting: () => say('presentation', 'You stopped presenting. Everyone’s back where they were.'),
  switched: (name: string, onBack: () => void) => say('swap', `This call now uses ${name}. Nobody was disconnected.`, { label: 'Back', onClick: onBack }),
  newSpace: (name: string) => say('folders', `New workspace, ${name}. This call uses it now.`),
  askedForNotes: (organizer: string) => say('hand', `You asked ${organizer} for notes`),
  notesOn: () => say('check', 'Notes are on for everyone'),
  backOnline: () => say('check', 'Back online. Your edits are saved.'),
  sharing: (person: AvatarPerson, first: string, onShow: () => void): WsToastData => ({ person, text: `${first} started sharing`, action: { label: 'Show it', onClick: onShow }, ms: 12000 })
};

/** One toast, in a call's corner. */
export function WsToast({ toast, className }: { toast: Omit<WsToastData, 'ms'>; className?: string | undefined }) {
  return (
    <div className={cn('ac-toast ws-toast', className)} role="status">
      {toast.person && <Avatar person={toast.person} size={24} />}
      {toast.icon && <Icon name={toast.icon} size={17} />}
      <span>{toast.text}</span>
      {toast.action && <button type="button" onClick={toast.action.onClick}>{toast.action.label}</button>}
    </div>
  );
}

/** The corner toasts rise into, 10 px over 420 ms. Each needs an `id`. */
export function WsToasts({ toasts }: { toasts: (Omit<WsToastData, 'ms'> & { id: string | number })[] }) {
  const move = useMove();
  return (
    <div className="ws-toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: move(3) }} exit={{ opacity: 0, transition: move(2) }}>
            <WsToast toast={t} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** A tool on the keyboard bar. */
function KeyTool({ icon, size = 19, label, onClick }: { icon: IconName; size?: number | undefined; label: string; onClick: () => void }) {
  return <button type="button" aria-label={label} onClick={onClick}><Icon name={icon} size={size} /></button>;
}

/**
 * The bar above a phone's keyboard, for blocks, styles, @, photos and checklists. `lift` is how far the keyboard has
 * pushed it up, in px; the bar rises with it. `onDone` puts the keyboard away.
 */
export function WsKeyboardBar({ lift = 0, onBlock, onStyle, onTag, onPhoto, onChecklist, onDone, children }: {
  lift?: number | undefined; onBlock: () => void; onStyle: () => void; onTag: () => void; onPhoto: () => void; onChecklist: () => void; onDone: () => void;
  /** What the tools open: a sheet of blocks, say. */
  children?: ReactNode;
}) {
  return (
    <div className="ws-kbar" role="toolbar" aria-label="Writing tools" style={{ '--keyboard': `${lift}px` }}>
      <KeyTool icon="plus" size={20} label="Add a block" onClick={onBlock} />
      <KeyTool icon="type" label="Text style" onClick={onStyle} />
      <KeyTool icon="at" label="Tag someone" onClick={onTag} />
      <KeyTool icon="image" label="Add a photo" onClick={onPhoto} />
      <KeyTool icon="todo" label="Checklist" onClick={onChecklist} />
      <span className="sp" />
      <KeyTool icon="down" label="Done" onClick={onDone} />
      {children}
    </div>
  );
}
