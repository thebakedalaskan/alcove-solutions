/*
 * The call's top bar. On the left, the call: its title and clock, the notes sign everyone sees (which opens what's captured),
 * the confidential-compute shield, Reconnecting while the connection finds its way back, and what's showing when the
 * workspace, the board and the shares have to take turns. On the right, what's only yours: Board and Workspace, which open
 * on your stage, then Notes and Chat, which open in your side, then who's here, which opens People. Each is lit
 * while it's open, and pressed again puts it away. On a phone it's the title, the notes sign, Chat and who's here: the rest is
 * in More.
 */
import { clock, type Person } from '@alcove/api';
import { BoardPicker, CallTopButton, CallTopGroup, CallTopRule, Dots, Faces, Icon, Popover, Tooltip, cn, type BoardPickerProps } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { q, trustLine, unverifiedBecause, verifiedAt } from '~/lib/queries';
import { hm } from '~/lib/time';
import type { SideView } from './side';

/** Board, at the top right. */
export interface TopBoard {
  /** A board is on your stage, or the board picker is open. */
  on: boolean;
  /** The picker, or with a board on your stage, Close. */
  onPress: () => void;
  /** The board picker, opening under it. Pressing Board opens it through `onPress`. */
  menu: { open: boolean; onClose: () => void; content: BoardPickerProps; reach?: (() => void) | undefined };
}
/** Workspace, at the top right: lit while it's on your stage, with how much has been brought to this call. */
export interface TopWorkspace { on: boolean; count: number; onPress: () => void }
/** Notes, Chat and who's here, which open your side: what it shows now, and how much chat you haven't seen. */
export interface TopSide { view: SideView | null; toggle: (v: SideView) => void; unread: number }

const BOARD_TIP = 'Open a board on your screen · O';
const WORKSPACE_TIP = 'Open the workspace on your screen · W';

export function TopBar({ title, elapsed, sign, swap, people, asking, reconnecting, screens, modelPrivate, phone, board, workspace, side, timer }: {
  title: string; elapsed: number;
  /** The notes sign: what the call captures, the same for everyone. */
  sign: ReactNode;
  /** What's showing, when there isn't room for all of it at once. */
  swap: ReactNode;
  people: Person[];
  /** People asking to join (the organizer's to let in). */
  asking: number;
  /** The call's media connection dropped and is coming back. */
  reconnecting: boolean;
  /** Shared screens are read for the notes (or will be once they resume), so frames of them are sealed too. */
  screens: boolean;
  /** The call's AI model runs in a secure enclave. When it doesn't, the shield says the notes and AI answers aren't covered. */
  modelPrivate: boolean;
  phone: boolean;
  board: TopBoard;
  workspace: TopWorkspace;
  side: TopSide;
  timer: ReactNode;
}) {
  const peopleOpen = side.view === 'people';
  const chatOpen = side.view === 'chat';
  const notesOpen = side.view === 'notes';
  const faces = (
    <Tooltip label={asking ? `${asking} asking to join` : peopleOpen ? 'People' : 'People · only you'} side="bottom">
      <button type="button" className={cn('ic-yb is-faces', peopleOpen && 'is-on')} data-side="people" aria-pressed={peopleOpen}
        aria-label={asking ? `People in this call. ${asking} asking to join` : 'People in this call'} onClick={() => side.toggle('people')}>
        <Faces people={people} size={24} max={phone ? 2 : 4} />{!phone && <span className="n">{people.length}</span>}
        {asking > 0 && <span className="ask" aria-hidden="true">{asking}</span>}
      </button>
    </Tooltip>
  );
  const chat = (
    <Tooltip label={chatOpen ? 'Chat' : 'Chat · only you'} side="bottom">
      <CallTopButton icon="chat" word={phone ? undefined : 'Chat'} label={side.unread && !chatOpen ? `Chat, ${side.unread} new` : 'Chat'} on={chatOpen} badge={side.unread}
        data-side="chat" aria-keyshortcuts="C" onClick={() => side.toggle('chat')} />
    </Tooltip>
  );
  if (phone) {
    return (
      <header className="ic-top is-phone">
        <span className="ttl">{title}</span>
        <div className="nz">{sign}</div>
        {/* The dots alone on a phone, where the word would push who's here off the screen; a screen reader still says it. */}
        {reconnecting && <span className="ic-recon" role="status"><Dots /><span className="sr-only">Reconnecting</span></span>}
        <div className="end">{timer}{chat}{faces}</div>
      </header>
    );
  }
  const boardButton = (more: { onClick?: () => void; onPointerEnter?: (() => void) | undefined }) => (
    <CallTopButton icon="presentation" word="Board" label="Board" on={board?.on} aria-keyshortcuts="O" data-open="board" {...more} />
  );
  return (
    <header className="ic-top">
      <span className="ttl">{title}</span>
      <span className="ac-time clock">{clock(elapsed)}</span>
      <span className="vr v1" />
      <div className="nz">{sign}</div>
      <Shield screens={screens} modelPrivate={modelPrivate} />
      {timer}
      {reconnecting && <span className="ic-recon" role="status"><Dots />Reconnecting</span>}
      {swap}
      <div className="end">
        <CallTopGroup label="On your screen">
          <Popover open={board.menu.open} onOpenChange={(o) => { if (o) board.onPress(); else board.menu.onClose(); }} tip={BOARD_TIP} side="bottom" align="end" label="Open a board" className="bl"
            anchor={boardButton({ onPointerEnter: board.menu.reach })}>
            <BoardPicker {...board.menu.content} />
          </Popover>
          <Tooltip label={WORKSPACE_TIP} side="bottom">
            <CallTopButton icon="folderOpen" word="Workspace" label={!workspace.on && workspace.count > 0 ? `Workspace, ${workspace.count} in this call` : 'Workspace'}
              on={workspace.on} badge={workspace.count} aria-keyshortcuts="W" data-open="ws" onClick={workspace.onPress} />
          </Tooltip>
          <CallTopRule />
          <Tooltip label={notesOpen ? 'Notes' : 'Notes · only you'} side="bottom">
            <CallTopButton icon="notesPen" word="Notes" label="Notes" on={notesOpen} data-side="notes" onClick={() => side.toggle('notes')} />
          </Tooltip>
          {chat}
          <CallTopRule />
          {faces}
        </CallTopGroup>
      </div>
    </header>
  );
}

/** The shield: hover or focus says what confidential compute covers here, and why the check didn't pass if it didn't; a click keeps it open. */
function Shield({ screens, modelPrivate }: { screens: boolean; modelPrivate: boolean }) {
  const trust = useQuery(q.trust()).data;
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => { if (later.current) clearTimeout(later.current); setOpen(true); };
  const hide = () => { if (later.current) clearTimeout(later.current); later.current = setTimeout(() => { if (!pinned.current) setOpen(false); }, 160); };
  const verified = verifiedAt(trust);
  const failed = unverifiedBecause(trust);
  return (
    <Popover open={open} onOpenChange={(o) => { pinned.current = o; setOpen(o); }} side="bottom" align="start" label="Confidential compute" className="ic-seal" takeFocus={false}
      anchor={(
        <button type="button" className={cn('ic-sicon', open && 'is-on')} aria-label={verified === null ? 'Confidential compute' : 'Confidential compute, verified'}
          onPointerEnter={(e) => { if (e.pointerType !== 'touch') show(); }} onPointerLeave={hide} onFocus={show} onBlur={hide}>
          <Icon name={failed === null ? 'sealed' : 'shieldOff'} size={19} />
        </button>
      )}>
      <div onPointerEnter={show} onPointerLeave={hide}>
        <div className="hd"><Icon name={failed === null ? 'sealed' : 'shieldOff'} size={17} />{trustLine(trust)}</div>
        <div className="rows">
          {verified !== null && <div><span>Hardware checked</span><b className="ac-time">{hm(new Date(verified))}</b></div>}
          <div><span>Sealed</span>{modelPrivate ? (screens ? 'Audio, transcript, shared screens, notes' : 'Audio, transcript, notes') : (screens ? 'Audio, transcript, shared screens' : 'Audio, transcript')}</div>
        </div>
        {!modelPrivate && <div className="last"><Icon name="shieldOff" size={14} /> The notes and AI answers in this call use an unencrypted AI model, outside a secure enclave. Audio and transcript stay sealed.</div>}
        {failed !== null && <div className="last"><Icon name="shieldOff" size={14} /> {failed}</div>}
        <div className="last">{verified === null ? 'Everything stays sealed.' : 'Alcove can’t read this call.'}</div>
      </div>
    </Popover>
  );
}
