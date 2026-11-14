/*
 * Sharing a screen: whether this browser can, how many people share at once, and what to say when the browser or the
 * computer won't share. The capture itself is LocalMedia's (media.ts), publishing it is the room's (livekit.ts), and
 * the call screen says what happened.
 */
import type { CallState, Person } from '@alcove/api';
import { wsToast, type useToast, type WsToastData } from '@alcove/ui';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { callName } from '~/lib/people';
import type { ShareTrouble } from '../layout/ShareMenu';
import type { CallRoom, RoomView } from '../media/livekit';
import type { LocalMedia, MediaSnapshot, ShareChoice } from '../media/media';
import { SOMEONE } from '../session/participants';
import type { StageParticipant, StageShare } from '../stage/Stage';
import type { ShareMarks } from './marks';
import { useMarksFollow } from './SharePointing';

type Toast = ReturnType<typeof useToast>;

/**
 * At most this many screens shared at once in your part of the call, yours included. Your stage holds one, or two with
 * Show beside, and the rest are tiles with the people; past four, presented things crowd the people out of their own
 * stage, and every browser in the call decrypts and decodes one more stream for each. A browser starts a share only under
 * it, checked as Share › Your screen opens and again at the click that starts sharing. People who are still choosing in
 * their browser's own picker at the same moment can take it over; the stage takes any number.
 */
export const MAX_SHARES = 4;

/** Phones and tablets can watch what's shared but can't share themselves. */
export const canShareScreen = (): boolean => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

/**
 * Chrome and Edge share a tab's sound; Firefox and Safari share none. They're also the only ones that know the
 * `suppressLocalAudioPlayback` constraint, which is how to tell.
 */
export function canShareTabSound(): boolean {
  try {
    return 'suppressLocalAudioPlayback' in navigator.mediaDevices.getSupportedConstraints();
  } catch {
    return false;
  }
}

/**
 * Why a share didn't start. `cancelled`: the picker was closed, which needs no word. `system`: the computer won't let
 * the browser capture the screen (macOS without Screen Recording permission). `blocked`: the browser, a site setting or
 * whoever manages the computer turned sharing off.
 */
export type ShareProblem = 'cancelled' | 'unsupported' | 'blocked' | 'system' | 'nothing' | 'busy' | 'failed';

/** Faster than anyone could answer a picker: the refusal came without asking. */
const UNASKED_MS = 300;

/**
 * Reads getDisplayMedia's refusal and how long it took. Chrome says "Permission denied by system" when the computer
 * refused; a refusal that comes back faster than a picker can be answered was never asked; a slower one is the picker
 * cancelled. Browsers name the rest by kind.
 */
export function shareProblem(e: unknown, ms: number): ShareProblem {
  if (e instanceof TypeError) return 'unsupported';
  if (!(e instanceof DOMException)) return 'failed';
  switch (e.name) {
    case 'NotAllowedError': return /denied by system/i.test(e.message) ? 'system' : ms < UNASKED_MS ? 'blocked' : 'cancelled';
    case 'SecurityError': return 'blocked';
    case 'NotSupportedError': return 'unsupported';
    case 'NotFoundError': return 'nothing';
    case 'NotReadableError': return 'busy';
    default: return 'failed';
  }
}

/** What to say when a share didn't start, and how to get it going. */
export const SHARE_PROBLEMS: Record<Exclude<ShareProblem, 'cancelled'>, string> = {
  unsupported: 'This browser can’t share a screen. Chrome, Edge, Firefox and Safari can, on a computer.',
  blocked: 'Your browser turned screen sharing off for Alcove before asking. Allow it in the browser’s site settings, or ask whoever manages this computer, then try again.',
  system: 'Your computer isn’t letting the browser share its screen. On a Mac, turn your browser on in System Settings › Privacy & Security › Screen & System Audio Recording, then reopen it. A tab can be shared without that.',
  nothing: 'Your browser found nothing to share. Try again.',
  busy: 'Your computer couldn’t capture that. Another app may be holding it. Try again, or pick something else.',
  failed: 'Sharing didn’t start. Try again.'
};

/**
 * Your share, as the call has it. A screen LiveKit wouldn't publish reaches nobody: that capture is stopped (if it's still the one
 * shared) and said, with Try again, which opens Share's picker as it is then (`reopen`). The organizer stopped your share for
 * everyone (`stopped` counts it): this browser lets it go too, and the call's notice says who did it.
 */
export function useShareFollowsCall({ failed, stopped, media, toast, reopen }: { failed: string | null; stopped: number; media: LocalMedia; toast: ReturnType<typeof useToast>; reopen: RefObject<() => void> }): void {
  useEffect(() => {
    if (!failed || media.getSnapshot().screen?.getVideoTracks()[0]?.id !== failed) return;
    media.stopScreen();
    toast('Your screen couldn’t reach the call, so sharing stopped.', { icon: 'stopShare', ms: 8000, action: { label: 'Try again', onClick: () => reopen.current() } });
  }, [failed, media, toast]);
  const stoppedSeen = useRef(stopped);
  useEffect(() => {
    if (stopped <= stoppedSeen.current) return;
    stoppedSeen.current = stopped;
    if (media.getSnapshot().screen) media.stopScreen();
  }, [stopped, media]);
}

/**
 * What's shared here: yours, and everyone else's in your part of the call. Several people share at once (a share starts while fewer
 * than MAX_SHARES are going, yours counted: `full`), each viewer chooses which to see big, and anyone can mute the sound a share
 * carries, for themselves. Pointing at a share is the organizer's switch for the call, and each presenter's own choice for others
 * on theirs. The marks store follows the shares shown here, who's in your part of the call (`people`), which part that is (`part`),
 * and whether pointing is on at all (SharePointing.tsx).
 */
export function useShares({ state, live, meId, me, m, myShare, keptMine, keptOf, others, people, part, roomView, room, marks, toast }: {
  state: CallState;
  live: boolean;
  meId: string;
  me: Person | undefined;
  m: MediaSnapshot;
  /** Your share's picture, by its track sid in the call, once the room has it. */
  myShare: string | null;
  keptMine: boolean;
  keptOf: (id: string) => boolean;
  /** Everyone else on the stage. */
  others: readonly StageParticipant[];
  people: readonly string[];
  part: string;
  roomView: RoomView;
  room: CallRoom;
  marks: ShareMarks | null;
  toast: Toast;
}): { shares: StageShare[]; full: boolean } {
  const othersPointAt = (id: string) => state.participants.find((p) => p.id === id)?.othersPoint ?? true;
  const closedFor = (owner: string, mine: boolean): 'call' | 'presenter' | null => (!state.pointing ? 'call' : mine || othersPointAt(owner) ? null : 'presenter');
  const shares: StageShare[] = [
    ...(m.screen ? [{
      id: meId, feed: { stream: m.screen }, presenter: me ?? SOMEONE, mine: true, label: `You’re sharing ${m.screenLabel ?? 'your screen'}`, name: 'Your screen', sound: null, kept: keptMine,
      point: myShare ? { sid: myShare, closed: closedFor(meId, true) } : null
    }] : []),
    ...others.flatMap((p): StageShare[] => {
      const r = roomView.people[p.id];
      const sid = r?.screenSid;
      if (!r || !sid) return [];
      const who = callName(p.person);
      const on = r.screenSound === 'on';
      const sound = r.screenSound ? {
        muted: !on,
        toggle: () => { room.muteShare(sid, on); toast(on ? `${who}’s share is muted for you` : `${who}’s share plays its sound again`, { icon: on ? 'speakerOff' : 'speaker' }); }
      } : null;
      return [{ id: p.id, feed: { room, sid }, presenter: p.person, mine: false, label: `${who} is sharing`, name: `${who}’s screen`, sound, kept: keptOf(p.id), point: { sid, closed: closedFor(p.id, false) } }];
    })
  ];
  useMarksFollow(marks, {
    on: state.pointing && live && roomView.connection === 'connected',
    shares: shares.flatMap((s) => (s.point ? [{ sid: s.point.sid, owner: s.id, others: othersPointAt(s.id) }] : [])),
    people,
    part
  });
  const sharing = shares.filter((s) => !s.mine);
  // At most MAX_SHARES going at once in your part of the call, yours counted; changing what you share is always fine.
  const full = !m.screen && sharing.length >= MAX_SHARES;
  return { shares, full };
}

/**
 * Share › Your screen. Opening it (`pick`) says when this browser can't share or four already are, and why the last try didn't
 * start, if it didn't (`trouble`). Sharing (`share`) needs this click for the browser's picker, so nothing is awaited before it
 * opens: what you share then is said, and so is sound that was asked for and didn't come. A share that couldn't start opens the
 * picker again, as it is then (who's sharing by then), and so does a toast's Change or Try again. Your share as the call has it
 * follows too: one LiveKit wouldn't publish stops and says so, and one the organizer stopped for everyone stops here too.
 */
export function useShareScreen({ media, full, roomView, toast, say, closeMenus, openPicker, startMine }: {
  media: LocalMedia;
  full: boolean;
  roomView: RoomView;
  toast: Toast;
  say: (toast: WsToastData) => void;
  /** Whatever's open over the call goes as sharing starts. */
  closeMenus: () => void;
  /** Share's own step for your screen opens. */
  openPicker: () => void;
  /** Your share is read for the notes, when you asked for that. */
  startMine: (notes: boolean) => Promise<unknown>;
}) {
  const [trouble, setTrouble] = useState<ShareTrouble | null>(null);
  const fullText = `${MAX_SHARES} people are sharing. You can share once one of them stops.`;
  const share = (c: ShareChoice) => {
    closeMenus();
    setTrouble(null);
    // Others may have started while the picker was open: checked again here, at the click.
    if (full) { toast(fullText, { icon: 'screen' }); return; }
    // The browser's picker needs this click: nothing is awaited before it opens.
    void media.shareScreen(c, () => say(wsToast.screenOff())).then((r) => {
      if (!r.ok) {
        if (r.problem === 'unsupported') toast(SHARE_PROBLEMS.unsupported, { icon: 'screen', ms: 8000 });
        else if (r.problem !== 'cancelled') reopen.current(r.problem);
        return;
      }
      say(wsToast.screenOn(r.surface === 'browser' ? 'tab' : r.surface === 'window' ? 'window' : 'screen'));
      void startMine(c.notes);
      // The sound asked for didn't come (only asked where the browser can share it): its picker's switch was off, or
      // the computer wouldn't share it.
      if (r.sound !== 'left-out') return;
      toast(r.surface === 'browser' ? 'The tab’s sound isn’t shared. Change what you share and turn on Also share tab audio.' : 'Your computer’s sound isn’t shared here. A tab can share its sound.',
        { icon: 'speakerOff', ms: 9000, action: { label: 'Change', onClick: () => reopen.current() } });
    });
  };
  const pick = (why: ShareTrouble | null = null) => {
    if (!canShareScreen()) { toast(SHARE_PROBLEMS.unsupported, { icon: 'screen', ms: 8000 }); return; }
    if (full) { toast(fullText, { icon: 'screen' }); return; }
    setTrouble(why);
    openPicker();
  };
  // Toasts and refusals open the picker later, through what `pick` is then (who's sharing by then).
  const reopen = useRef(pick);
  reopen.current = pick;
  useShareFollowsCall({ failed: roomView.screenFailed, stopped: roomView.shareStopped, media, toast, reopen });
  const stop = () => { media.stopScreen(); say(wsToast.screenOff()); };
  return { trouble, setTrouble, fullText, share, pick, stop };
}
export type ShareScreen = ReturnType<typeof useShareScreen>;
