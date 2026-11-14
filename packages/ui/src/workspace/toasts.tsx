/* The workspace's toasts, in the canvas's words, and the bar above a phone's keyboard. */
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { Avatar, type AvatarPerson } from '../foundation/people';
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
/** Words with workspaces' names in them, which can be long: two lines at most, and all of them on hover. */
const clamped = (text: string): ReactNode => <span className="ac-clamp-2" title={text}>{text}</span>;

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
  /** The call's workspace changed while you were following someone in it. */
  followingEnded: (first: string) => say('navigate', `Stopped following ${first}. The call’s workspace changed.`),
  cantOpen: (first: string) => say('lock', `${first} is in a document you can’t open`),
  tagged: (person: AvatarPerson, first: string, document: string, onGo: () => void): WsToastData => ({ person, text: `${first} tagged you in ${document}`, action: { label: 'Go there', onClick: onGo }, ms: 9000 }),
  resolved: (onReopen: () => void) => say('check', 'Comment resolved', { label: 'Reopen', onClick: onReopen }),
  addedTo: (document: string, onGo: () => void) => say('check', `Added to ${document}`, { label: 'Go there', onClick: onGo }),
  restoredVersion: (when: string, onUndo: () => void) => say('history', `Restored the version from ${when}`, { label: 'Undo', onClick: onUndo }),
  restoredBy: (first: string, when: string, onHistory: () => void): WsToastData => ({ icon: 'history', text: `${first} restored the version from ${when}`, action: { label: 'History', onClick: onHistory }, ms: 9000 }),
  restored: () => say('history', 'Restored. Everyone sees it again.'),
  deleted: (name: string) => say('trash', `${name} deleted for good`),
  /** `action`: the one thing that helps, such as Get Pro when your storage is full; it stays up longer, so there's time to press it. */
  failed: (text: string, action?: WsToastData['action']): WsToastData => (action ? { icon: 'alert', text, action, ms: 9000 } : say('alert', text)),
  /** `ask`: it's the call's board, and whoever brought it is here to ask, as the board you can't open asks them, in the chat. */
  presentingPrivate: (first: string, ask?: { who: string; onAsk: () => void } | undefined): WsToastData => (ask
    ? { icon: 'lock', text: `${first} is presenting something you can’t open`, action: { label: `Ask ${ask.who} for access`, onClick: ask.onAsk }, ms: 12000 }
    : say('lock', `${first} is presenting something you can’t open`)),
  presenterLeft: (first: string) => say('presentation', `${first} left the call, so the presentation ended`),
  /** Everyone views another workspace, or the call's home again (`home` null): the notes still go home. */
  switched: (name: string, home: string | null, onBack: () => void): WsToastData =>
    ({ ...say('swap', '', { label: 'Back', onClick: onBack }), text: clamped(home ? `Everyone’s in ${name} now. Notes still go to ${home}.` : `Everyone’s back in ${name}, where the notes go.`) }),
  newSpace: (name: string, home: string | null): WsToastData =>
    ({ ...say('folders', ''), text: clamped(home ? `New workspace, ${name}. Everyone invited is in it, and notes still go to ${home}.` : `New workspace, ${name}. Everyone invited is in it now.`) }),
  askedForNotes: (organizer: string) => say('hand', `You asked ${organizer} for notes`),
  notesOn: () => say('check', 'Notes are on for everyone'),
  /** `wasOffline`: the browser itself was; otherwise only Alcove couldn't be reached. */
  backOnline: (wasOffline = true) => say('check', wasOffline ? 'Back online. Your edits are saved.' : 'Reconnected. Your edits are saved.'),
  /** The call's connection is back, with nothing of a document's to say about it. */
  reconnected: () => say('check', 'Back online.'),
  copiedText: () => say('copy', 'Copied. Paste it wherever you like.'),
  savedAsNew: (onOpen: () => void) => say('filePlus', 'Saved as a new document', { label: 'Open', onClick: onOpen }),
  discarded: () => say('trash', 'Discarded. This document is as Alcove has it.'),
  /* Presenting in a call, as the canvas says it (docs/design/canvas/call/nc.js, TOAST). */
  screenOn: (what: 'tab' | 'window' | 'screen') => say('screen', `Everyone sees your ${what}.`),
  screenOff: () => say('screen', 'You stopped sharing.'),
  /** Your own screen, closed for you while it's still shared: its tile is with the people. */
  screenAway: () => say('screen', 'Put away for you. Everyone still sees your screen, and its tile brings it back.'),
  boardOn: (board: string) => say('presentation', `Everyone follows you on ${board}. They can add to it as you go.`),
  workspaceOn: () => say('folderOpen', 'Everyone follows you in the workspace. They can unfollow to work alongside you.'),
  closedForYou: () => say('x', 'You stopped presenting. The others keep it open, on their own.'),
  /** `here`: in a room, where it closed for the room alone. */
  closedForAll: (here = false) => say('x', here ? 'Closed for everyone in this room.' : 'Closed for everyone.'),
  closedWhile: (first: string) => say('x', `Closed for you. While ${first} presents, its tile takes you back.`),
  followingWorkspace: (first: string) => say('folderOpen', `${first} is presenting the workspace, and you’re following.`),
  followingBoard: (first: string, board: string) => say('presentation', `${first} is presenting ${board}, and you’re following.`),
  presentingScreen: (first: string) => say('screen', `${first} is presenting their screen.`),
  /** Someone presents something while you watch something else: it's a tile with the people, and Show it puts it on your stage. */
  presentingToo: (person: AvatarPerson, first: string, what: string, onShow: () => void): WsToastData => ({ person, text: `${first} is presenting ${what}. It’s with the people.`, action: { label: 'Show it', onClick: onShow }, ms: 12000 }),
  stoppedPresentingIt: (icon: IconName, first: string, what: string) => say(icon, `${first} stopped presenting ${what}.`),
  /** What you followed, closed for everyone by whoever presented it, or by the organizer; `here`, for everyone in your room alone. */
  closedEverywhere: (what: string, here = false) => say('x', `${what.charAt(0).toUpperCase()}${what.slice(1)} closed for everyone${here ? ' in this room' : ''}.`),
  /** What you presented, closed for everyone by the organizer: you're told who, as a share they stop is. */
  closedByOrganizer: (organizer: string, what: string) => say('x', `${organizer} closed ${what} for everyone.`),
  stoppedSharing: (first: string) => say('stopShare', `${first} stopped sharing.`),
  stoppedTheirShare: (first: string) => say('screen', `You stopped ${first}’s share for everyone. ${first} is told it was you.`)
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

/**
 * The corner toasts rise into, 10 px over 420 ms. Each needs an `id`. Outside a call, `place` says where the workspace is:
 * `full`, full screen, beside its own side panel; `beside`, a document beside the app's own page, clear of the app's side panel.
 */
export function WsToasts({ toasts, place }: { toasts: (Omit<WsToastData, 'ms'> & { id: string | number })[]; place?: 'full' | 'beside' | undefined }) {
  const move = useMove();
  return (
    <div className={cn('ws-toasts', place && `is-${place}`)} aria-live="polite">
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
export function WsKeyboardBar({ lift = 0, onBlock, onStyle, onTag, onPhoto, onChecklist, onDone }: {
  lift?: number | undefined; onBlock: () => void; onStyle: () => void; onTag: () => void; onPhoto: () => void; onChecklist: () => void; onDone: () => void;
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
    </div>
  );
}
