/*
 * Share, in the dock (docs: Calls and recordings › Presenting): everything you can show everyone, one step at a time in one
 * popover, so no window opens over another. First, what to share, with Stop sharing while you present something. Your screen
 * goes on to its own step (a tab, a window or your whole screen, its sound where this browser can share it, and while notes
 * are on or paused whether it goes in them: No until you say Yes, then your last answer in this call) before the browser's own picker; A board goes on to the board picker, which presents what you pick straight away; the workspace is
 * presented at once. Stop sharing stops your screen at once, and on a board or the workspace asks Close's question as its own
 * step, so it's asked wherever what you present is: on your stage, a tile, or out of sight. On a phone it's a sheet, and a
 * screen can't be shared there.
 */
import { notesAreOn, type CallState, type CaptureMode } from '@alcove/api';
import { BoardPicker, DockButton, Popover, ShareKinds, ShareScreenStep, ShareStopStep, cn, type BoardPickerProps, type ShareKeep } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { loadBoard } from '~/features/call/boards/BoardStage';
import type { ShareChoice, ShareSurface } from '~/features/call/media/media';
import { SHARE_PROBLEMS, canShareScreen, canShareTabSound, type ShareProblem, type ShareScreen } from '~/features/call/screen-sharing/share';
import type { Closing } from '~/features/call/stage/closing';
import { isScreen, type Presented } from '~/features/call/stage/onStage';
import type { Pop } from './pop';

/** Share's steps: what to share, then Your screen or A board, or stopping what you present. */
export type ShareStep = 'share' | 'shareScreen' | 'shareBoard' | 'shareStop';
/** Why the last try at sharing a screen didn't start, as its step says. */
export type ShareTrouble = Exclude<ShareProblem, 'cancelled' | 'unsupported'>;

/** The sound a screen can share, where this browser can share it: a tab's, or the computer's. */
const soundOf = (kind: ShareSurface): string | null =>
  !canShareTabSound() ? null : kind === 'browser' ? 'Also share the tab’s sound' : kind === 'monitor' ? 'Also share your computer’s sound' : null;

export function ShareMenu({ step, onStep, phone, presenting, screen, board, workspace }: {
  /** The step showing, or null while Share is closed. */
  step: ShareStep | null;
  onStep: (step: ShareStep | null) => void;
  phone: boolean;
  /**
   * What you present now ("your screen", "the workspace", a board's name), or null. Stopping your screen stops it for
   * everyone (`asks` false); a board or the workspace asks first, for you or for everyone.
   */
  presenting: { what: string; asks: boolean; everyone?: string | undefined; onStop: (everyone: boolean) => void } | null;
  screen: {
    /** Why no more screens can be shared ("4 people are sharing. …"), or null. */
    full: string | null;
    /** Your screen: its step, unless this browser can't share or enough people already are, which a toast says. */
    onPick: () => void;
    /** Notes are on, or paused, so you're asked whether what you share goes in them; null asks nothing (notes off, a breakout room, or the organizer keeps screens out). */
    read: 'on' | 'paused' | null;
    /** Why the last try didn't start, or null. */
    trouble: ShareTrouble | null;
    /** You share a screen already: its step says "Share this instead". */
    changing: boolean;
    onShare: (choice: ShareChoice) => void;
    /** Back to what to share, which forgets why the last try didn't start. */
    onBack: () => void;
  };
  /** A board: the picker, presenting what you pick (`onPick` gets it ready), or why you can't. */
  board: { picker: BoardPickerProps; onPick: () => void } | { why: string };
  /** The workspace, presented straight away, or why not. */
  workspace: { onPress: () => void } | { why: string };
}) {
  const [kind, setKind] = useState<ShareSurface>('browser');
  const [sound, setSound] = useState(true);
  /*
   * Whether a share goes in the notes: No to begin with, so a share is kept only after a deliberate Yes, and then your last
   * answer for as long as you're in the call, so Change and a try after one that didn't start begin from it. Share never waits.
   */
  const [keep, setKeep] = useState<ShareKeep>('no');
  // Your computer wouldn't let the browser share a window or the whole screen: a tab always can, so the choice turns to one.
  const [troubleSeen, setTroubleSeen] = useState(screen.trouble);
  if (screen.trouble !== troubleSeen) {
    setTroubleSeen(screen.trouble);
    if (screen.trouble === 'system') setKind('browser');
  }
  const soundLabel = soundOf(kind);
  /*
   * Going from one step to another inside Share swaps what's in it, so the keys go to the new step's first choice (past its
   * way back), rather than to nothing. Opening it is the popover's, which puts them on its first row.
   */
  const wasStep = useRef(step);
  useEffect(() => {
    const was = wasStep.current;
    wasStep.current = step;
    if (was === null || step === null || was === step) return undefined;
    const raf = requestAnimationFrame(() => {
      const pop = document.querySelector('.ic-sharepop');
      const at = document.activeElement;
      if (!pop || (at !== null && at !== document.body && pop.contains(at))) return;
      const all = [...pop.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      (all.find((el) => !el.classList.contains('ic-sp-back')) ?? all[0])?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [step]);
  const body = step === 'shareScreen' ? (
    <ShareScreenStep surface={kind} onSurface={setKind} sound={soundLabel ? { label: soundLabel, on: sound, onChange: setSound } : null}
      read={screen.read} keep={keep} onKeep={setKeep} trouble={screen.trouble ? SHARE_PROBLEMS[screen.trouble] : null} changing={screen.changing}
      onBack={screen.onBack} onShare={() => screen.onShare({ surface: kind, audio: soundLabel !== null && sound, notes: screen.read !== null && keep === 'yes' })} />
  ) : step === 'shareBoard' && 'picker' in board ? (
    <BoardPicker step={{ onBack: () => onStep('share') }} {...board.picker} />
  ) : step === 'shareStop' && presenting?.asks ? (
    <ShareStopStep what={presenting.what} onBack={() => onStep('share')} onMe={() => presenting.onStop(false)} onEveryone={() => presenting.onStop(true)} everyone={presenting.everyone} />
  ) : (
    <ShareKinds sharing={presenting ? { what: presenting.what, onStop: () => { if (presenting.asks) onStep('shareStop'); else presenting.onStop(true); } } : null}
      screenWhy={phone ? 'Sharing a screen needs a computer' : !canShareScreen() ? SHARE_PROBLEMS.unsupported : screen.full}
      onScreen={screen.onPick}
      board={'picker' in board ? { onPress: () => { board.onPick(); onStep('shareBoard'); } } : board}
      workspace={workspace} />
  );
  const on = presenting !== null;
  return (
    <Popover open={step !== null} onOpenChange={(o) => onStep(o ? 'share' : null)} side="top" align="center" label="Share with everyone"
      tip={phone ? undefined : on ? 'Presenting. Share something else, or stop' : 'Share with everyone: a screen, a board or the workspace'}
      className={cn(step === 'shareBoard' ? 'bl ic-sharepop' : 'ic-sharepop', phone && 'is-sheet')}
      anchor={<DockButton icon="screen" label={on ? 'Presenting' : 'Share'} word={on ? 'Presenting' : 'Share'} title={undefined} on={on || step !== null} data-share="" />}>
      {body}
    </Popover>
  );
}

/** Whether what someone starts sharing is read for the notes: now, once notes resume, or not. */
const screenRead = (mode: CaptureMode): 'on' | 'paused' | undefined => (notesAreOn(mode) ? 'on' : mode === 'paused' ? 'paused' : undefined);

/**
 * Share in the dock, as the call has it: what you present now (Stop stops your screen for everyone, and asks for a board or the
 * workspace, saying what For everyone closes), your screen (read for the notes, if you say so, while they're on, unless you're in
 * a breakout room or whoever hosts keeps screens out), A board, which presents what you pick, and The workspace, each with why not
 * while you can't: a guest starts no board, and while someone else presents here, nobody else does until they stop (`othersWhy`).
 */
export function DockShare({ pop, setPop, phone, presented, closing, sharing, full, changing, capture, sharingInRoom, canStartBoard, canPresentWs, othersWhy, picker, presentWorkspace }: {
  pop: Pop;
  setPop: (pop: Pop) => void;
  phone: boolean;
  /** What's presented here: yours, if anything, is what Stop stops. */
  presented: readonly Presented[];
  closing: Pick<Closing, 'closesFor' | 'closeFor'>;
  sharing: ShareScreen;
  /** As many screens are shared as there can be. */
  full: boolean;
  /** You share a screen already. */
  changing: boolean;
  capture: CallState['capture'];
  /** What you share in a breakout room isn't read for the notes. */
  sharingInRoom: boolean;
  canStartBoard: boolean;
  canPresentWs: boolean;
  othersWhy: string | null;
  picker: BoardPickerProps;
  presentWorkspace: () => void;
}) {
  const step = pop === 'share' || pop === 'shareScreen' || pop === 'shareBoard' || pop === 'shareStop' ? pop : null;
  /** What you present, if anything: Share says so, and its first step offers Stop sharing. */
  const myThing = presented.find((p) => p.mine) ?? null;
  return (
    <ShareMenu step={step} onStep={setPop} phone={phone}
      presenting={myThing ? {
        what: isScreen(myThing.id) ? 'your screen' : myThing.id === 'ws' ? 'the workspace' : myThing.name, asks: !isScreen(myThing.id), everyone: closing.closesFor(myThing.id),
        onStop: (everyone) => { setPop(null); if (isScreen(myThing.id)) sharing.stop(); else closing.closeFor(myThing.id, everyone); }
      } : null}
      screen={{
        full: full ? sharing.fullText : null, onPick: () => sharing.pick(), read: sharingInRoom || !capture.allowScreens ? null : screenRead(capture.mode) ?? null, trouble: sharing.trouble,
        changing, onShare: sharing.share, onBack: () => { sharing.setTrouble(null); setPop('share'); }
      }}
      board={!canStartBoard ? { why: 'Guests can’t start a board here.' } : othersWhy ? { why: othersWhy } : { picker, onPick: loadBoard }}
      workspace={!canPresentWs ? { why: 'You can’t open this call’s workspace.' } : othersWhy ? { why: othersWhy } : { onPress: presentWorkspace }} />
  );
}
