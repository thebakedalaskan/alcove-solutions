/*
 * More, in the dock: what isn't a button of its own. On a phone it opens with a grid of what the top bar and the dock hold on a
 * wider screen (Board, Workspace, Notes, Chat, React, People) and Raise your hand; then captions, Mark this moment, catching up,
 * breakout rooms for the organizer, the floating call, Reset layout once your view is your own, moving to another device and
 * Settings. On a phone, Board's picker and React open in More's place.
 */
import type { CallReaction } from '@alcove/api';
import { BoardPicker, CallMoreGrid, CallMoreTile, Icon, ReactPicker, cn, type BoardPickerProps, type IconName } from '@alcove/ui';
import { useId } from 'react';
import type { useFloatingWindow } from '../floating/floatingWindow';
import type { Pop } from './pop';
import type { SidePlace } from './side';

/** What More holds, as its button says. */
export const MORE_SAYS = 'More: captions, catch up, rooms, settings';

export function MoreMenu({ pop, setPop, phone, picker, react, board, workspace, openSide, unread, waiting, hand, captions, mark, catchUp, rooms, floating, live, done, resetView, moveAway, openSettings }: {
  pop: Pop;
  setPop: (pop: Pop) => void;
  phone: boolean;
  /** Board's picker, which opens in More's place on a phone. */
  picker: BoardPickerProps;
  react: (reaction: CallReaction) => void;
  /** Board, with a board on your stage or not. */
  board: { on: boolean; press: () => void };
  /** Workspace, on your stage or not, with how much has been brought to this call. */
  workspace: { on: boolean; brought: number; press: () => void };
  openSide: (place: SidePlace) => void;
  unread: number;
  /** How many are asking to join, for whoever hosts. */
  waiting: number;
  hand: { up: boolean; label: string; set: (up: boolean) => void };
  captions: { on: boolean; flip: () => void };
  /** Mark this moment, for someone keeping their own notes. */
  mark: (() => void) | null;
  catchUp: () => void;
  /** Breakout rooms, for the organizer while there's anyone to send to one: whether your side shows them now. */
  rooms: { shown: boolean } | null;
  floating: ReturnType<typeof useFloatingWindow>;
  live: boolean;
  done: boolean;
  /** Reset layout, while your view is your own. */
  resetView: (() => void) | null;
  moveAway: () => void;
  openSettings: () => void;
}) {
  const floatingHelp = useId();
  if (pop === 'board') return <BoardPicker {...picker} />;
  // A phone's picker is a sheet over the foot of the call, where the burst rises: it goes as you pick, so you see yours.
  if (pop === 'reactMore') return <ReactPicker label="Send a reaction everyone sees" onPick={(r) => { react(r); setPop(null); }} />;
  const moreRow = (icon: IconName, label: string, act: () => void, o: { pressed?: boolean | undefined; quiet?: boolean | undefined } = {}) => (
    <button type="button" className={cn('mi', o.quiet && 'is-quiet')} aria-pressed={o.pressed} onClick={act}>
      <Icon name={icon} size={17} /><span className="t">{label}</span>
    </button>
  );
  /*
   * Open floating call: More stays open while it opens, and says why if it can't, with the same row to try again; it closes once
   * the floating window is there.
   */
  const floatingRow = (
    <div className="ic-mfloat">
      <button type="button" className="mi" disabled={!floating.supported || floating.pending || !live || done} aria-busy={floating.pending}
        aria-describedby={!floating.supported || floating.error ? floatingHelp : undefined}
        onClick={() => { void floating.owner.open().then(() => { if (floating.owner.getSnapshot().target) setPop(null); }); }}>
        <Icon name="pip" size={17} /><span className="t">{floating.pending ? 'Opening floating call…' : floating.target ? 'Return to floating call' : 'Open floating call'}</span>
      </button>
      {!floating.supported ? <p id={floatingHelp}>Floating calls aren’t available in this browser. Keep using the call in this tab.</p>
        : floating.error && <p id={floatingHelp} role="alert">{floating.error}</p>}
    </div>
  );
  return (
    <>
      {phone && (
        <>
          <CallMoreGrid>
            <CallMoreTile icon="presentation" word="Board" aria-pressed={board.on} onClick={board.press} />
            <CallMoreTile icon="folderOpen" word="Workspace" label={!workspace.on && workspace.brought > 0 ? `Workspace, ${workspace.brought} in this call` : 'Workspace'} aria-pressed={workspace.on} badge={workspace.on ? 0 : workspace.brought}
              onClick={workspace.press} />
            <CallMoreTile icon="notesPen" word="Notes" onClick={() => openSide('notes')} />
            <CallMoreTile icon="chat" word="Chat" label={unread ? `Chat, ${unread} new` : 'Chat'} badge={unread} onClick={() => openSide('chat')} />
            <CallMoreTile icon="react" word="React" onClick={() => setPop('reactMore')} />
            <CallMoreTile icon="people" word="People" label={waiting ? `People in this call. ${waiting} asking to join` : 'People in this call'} badge={waiting} onClick={() => openSide('people')} />
          </CallMoreGrid>
          <div className="ic-msep" />
          {moreRow('hand', hand.label, () => { setPop(null); hand.set(!hand.up); }, { pressed: hand.up })}
        </>
      )}
      {moreRow('captions', captions.on ? 'Turn off captions' : 'Turn on captions', () => { setPop(null); captions.flip(); }, { pressed: captions.on })}
      {mark && moreRow('bookmark', 'Mark this moment', () => { setPop(null); mark(); })}
      {moreRow('history', 'Catch up on what you missed', () => { setPop(null); catchUp(); })}
      {rooms && moreRow('door', 'Breakout rooms', () => openSide('rooms'), { pressed: rooms.shown })}
      <div className="ic-msep" />
      {floatingRow}
      {resetView && moreRow('reset', 'Reset layout', () => { setPop(null); resetView(); }, { quiet: true })}
      {moreRow('phone', 'Move to another device', () => { setPop(null); moveAway(); })}
      {moreRow('settings', 'Settings', () => { setPop(null); openSettings(); })}
    </>
  );
}
