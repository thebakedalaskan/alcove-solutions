import type { CallSession, CallState } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';
import type { LocalMedia } from '../media/media';
import { ScreenRecorder } from '../screen-sharing/screenRecord';

const clog = log.child({ component: 'call' });

interface ScreenCaptureInput {
  session: CallSession;
  state: CallState;
  media: LocalMedia;
  /** What you share now. */
  screen: MediaStream | null;
  /** You're leaving the call, or it has ended: what was recorded is sent, and nothing more. */
  departing: boolean;
}

/** Your share as the call knows it: its ID, whether you said it goes in the notes, the picture it is, and when that started (performance.now()). */
interface MyShare { share: string; keep: boolean; stream: MediaStream; since: number }

/**
 * When the current segment of the recording began, from performance.now(), for a page that opens part-way through one
 * (a reload): from when the call says recording last changed, which is when the segment began unless the host's browser
 * dropped out meanwhile. Otherwise (and when that's in the future here), now.
 */
function segmentOrigin(state: CallState): number {
  const now = performance.now();
  const { recording, now: serverNow } = state.capture;
  const since = recording.mode === 'on' ? recording.since : null;
  // Both ends are the server's clock, so the presenter's own being off doesn't move a share against the audio. `now` is when
  // this snapshot was built: the little time it took to arrive isn't counted, so the share is placed that much early.
  const ago = since ? Date.parse(serverNow) - Date.parse(since) : 0;
  return Number.isFinite(ago) && ago > 0 ? now - ago : now;
}

/**
 * Your own shared screen, when you said it goes in the notes (features/call/screen-sharing/screenRecord.ts): this
 * browser records it while notes are on, the call is live and you aren't in a breakout room, from ten seconds after it
 * started. Paused or off, it stops at once and drops what wasn't sent; resuming records into the new segment. A share
 * that ends (stopped, or swapped for something else), or you leaving, or the call ending, sends what was recorded: the
 * call keeps taking a share's last pieces for a few seconds after it ends. A share that ends says so after that, so its
 * video stops there in the notes.
 */
export function useScreenCapture({ session, state, media, screen, departing }: ScreenCaptureInput) {
  const toast = useToast();
  const self = session.ticket.identity;
  const live = state.phase === 'in-call';
  const on = state.capture.mode === 'on' || state.capture.mode === 'unavailable';
  const segment = state.notes.recording.segment;
  const [screenProblem, setScreenProblem] = useState<string | null>(null);
  const recorder = useRef<ScreenRecorder | null>(null);
  if (!recorder.current) recorder.current = new ScreenRecorder((p) => session.appendScreen(p), setScreenProblem);
  const sharingInRoom = !!state.breakouts.open?.rooms.some((r) => r.members.includes(self));
  const [mine, setMineNow] = useState<MyShare | null>(null);
  const mineRef = useRef<MyShare | null>(null);
  const setMine = (v: MyShare | null) => { mineRef.current = v; setMineNow(v); };
  /** Your last share's end, on its way: a new share starts once the call knows the last one ended. */
  const ending = useRef<Promise<void>>(Promise.resolve());
  const endMine = () => {
    const was = mineRef.current;
    if (!was) return;
    setMine(null);
    const r = recorder.current;
    ending.current = (r ? r.finish() : Promise.resolve()).then(() => session.shareEnded(was.share))
      .catch((e: unknown) => clog.info('the end of a share wasn’t recorded', { err: e }));
  };
  // The call's word on whether your share is kept: notes going off ends that, and a share it doesn't know isn't.
  const keptMine = mine ? state.shares.find((s) => s.id === mine.share)?.keep ?? mine.keep : false;
  const recordScreen = !!mine && keptMine && on && live && !sharingInRoom && !departing && screen === mine.stream;
  const segmentSeen = useRef<{ segment: number; on: boolean; origin: number } | null>(null);
  useEffect(() => {
    const r = recorder.current;
    if (!r) return;
    const seen = segmentSeen.current;
    // Every segment is placed from when the call says it began, as the server places breakout rooms' speech: this page
    // notices a new segment a second or three late, and the audio is already counted from the server's start. With
    // notes off there is nothing to place yet. The first segment is 0 before notes are ever on too, so notes coming on
    // begins one.
    if (!seen || seen.segment !== segment || (on && !seen.on)) segmentSeen.current = { segment, on, origin: on ? segmentOrigin(state) : performance.now() };
    else if (seen.on !== on) segmentSeen.current = { ...seen, on };
    const origin = segmentSeen.current?.origin ?? performance.now();
    if (recordScreen && mine) r.record({ stream: mine.stream, share: mine.share, since: mine.since, segment, origin });
    else if (!on && !departing) r.discard();
    else void r.finish();
    // `state` is read only as a segment begins or notes come on: its change alone doesn't restart anything.
  }, [recordScreen, mine, segment, on, departing]);
  // What you share stopped, or something else took its place: that share is over.
  useEffect(() => { if (mine && screen !== mine.stream) endMine(); });
  useEffect(() => () => { void recorder.current?.finish(); }, []);

  /**
   * Tells the call about what you just started sharing, once the browser's picker has returned: the share it was in
   * place of ends first. The answer says whether it's kept for the notes (never from a breakout room, nor with notes off).
   */
  const startMine = async (notes: boolean) => {
    const stream = media.getSnapshot().screen;
    if (!stream) return;
    const since = performance.now();
    if (mineRef.current && mineRef.current.stream !== stream) endMine();
    await ending.current;
    try {
      const s = await session.startShare({ notes });
      // Stopped meanwhile, or swapped again: this one is over already.
      if (media.getSnapshot().screen !== stream) {
        session.shareEnded(s.share).catch((e: unknown) => clog.info('the end of a share wasn’t recorded', { err: e }));
        return;
      }
      setMine({ share: s.share, keep: s.keep, stream, since });
      clog.info('share started', { notes, keep: s.keep });
    } catch (e) {
      clog.warn('the call didn’t take your share', { err: e, notes });
      if (notes) toast('Your share couldn’t be added to the notes. Everyone here still sees it.', { icon: 'x', ms: 8000 });
    }
  };

  /** Whether someone else's share goes in the notes, by their participant ID. */
  const keptOf = (participant: string) => state.shares.some((s) => s.participant === participant && s.keep);

  return { screenProblem, sharingInRoom, keptMine: keptMine && !sharingInRoom, keptOf, startMine };
}
