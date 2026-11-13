/*
 * Rejoin, from a call's own page once you've left it (CallOver.tsx): straight back in, without the pre-join and its camera. The
 * button brings the microphone and camera back as they were; J brings you back with both off, so a stray key never puts your
 * voice and picture back into a call you chose to leave. It joins with this tab's last pass, so someone the call let in before
 * comes back without asking, and you're in once this browser is in the call's encrypted group and the call names you, waiting
 * to be let in meanwhile if it has to (entering.ts). A join that isn't going in (given up, as Go to Home gives it up, the page
 * gone first, turned away, or without the call's keys) is taken back the way a closing page takes it back, never by leaving:
 * an organizer's new connection hosts at once, and leaving from it would end the call for everyone.
 */
import { errorCode, errorMessage, type CallSession } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { overlayOpen, typing } from '~/lib/keys';
import { log } from '~/lib/log';
import { admissionOf, handOver, joinWithPass, KEYS_FAILED, mediaAsItWas, takeBack, turnedAway, useAsking, type Admission } from './entering';

const rlog = log.child({ component: 'rejoin' });

/** What joining again needs of the call you left. */
export interface RejoinAs {
  code: string;
  /** Your name, when you came in by name only. */
  guestName: string | null;
  /** Whoever lets people in, as someone waiting is told: the organizer's first name, or "the host" while someone stands in. */
  host: string;
}

/** The microphone and camera to come back with. */
export interface RejoinMedia { mic: boolean; cam: boolean }
/** What J comes back with: neither. */
export const QUIETLY: RejoinMedia = { mic: false, cam: false };

/** Waits until `s` is in the call, is turned away, can't get the call's keys, or it's given up or the page goes first (`gone`). */
function settled(s: CallSession, gone: AbortSignal): Promise<Exclude<Admission, 'on-its-way'> | 'gone'> {
  return new Promise((resolve) => {
    const offs: (() => void)[] = [];
    const check = () => {
      const at = gone.aborted ? 'gone' : admissionOf(s.crypto.getSnapshot(), s.getSnapshot());
      if (at === 'on-its-way') return;
      for (const off of offs) off();
      resolve(at);
    };
    gone.addEventListener('abort', check);
    offs.push(() => gone.removeEventListener('abort', check), s.crypto.subscribe(check), s.subscribe(check));
    check();
  });
}

/**
 * Rejoin for a call's page: `busy` while it's on its way (Rejoining…), and `onIn` with the call once you're in it, the call
 * this tab is in from then on. `rejoin` comes back with the microphone and camera it's given. A refusal or a failure is a
 * toast, and the page stays as it was. `cancel` gives up a rejoin on its way, taking it back at once and saying nothing; false
 * when it can't, because a rejoin has brought the call back already.
 */
export function useRejoin(as: RejoinAs, onIn: (s: CallSession) => void): { busy: boolean; rejoin: (media: RejoinMedia) => void; cancel: () => boolean } {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /*
   * The rejoin on its way (aborted to take it back, when it's given up or the page goes first), whether one has brought the call
   * back, and whether the page is still there.
   */
  const attempt = useRef<AbortController | null>(null);
  const handed = useRef(false);
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => { shown.current = false; attempt.current?.abort(); };
  }, []);
  /* Joined and not in yet (asking, or being let in): taken back if the page goes first, and if the tab closes. */
  const [asking, setAsking] = useState<CallSession | null>(null);
  const entered = useRef(false);
  useAsking(asking, entered);
  const latest = useRef({ as, onIn });
  latest.current = { as, onIn };

  const rejoin = useCallback((want: RejoinMedia) => {
    if (attempt.current || handed.current || !shown.current) return;
    const quit = new AbortController();
    attempt.current = quit;
    const given = quit.signal;
    setBusy(true);
    const was = latest.current.as;
    const media = mediaAsItWas(want);
    const over = () => { if (attempt.current === quit) attempt.current = null; if (shown.current) setBusy(false); };
    void joinWithPass(was.code, { mic: want.mic, cam: want.cam, name: was.guestName ?? undefined }).then(async (s) => {
      entered.current = false;
      if (!given.aborted) setAsking(s);
      const settledAs = await settled(s, given);
      const at = given.aborted ? 'gone' : settledAs;
      if (at === 'in') {
        // Handed over from here on: nothing gives it up now.
        handed.current = true;
        attempt.current = null;
        entered.current = true;
        setAsking(null);
        handOver(was.code, s, media);
        rlog.info('rejoined the call', { role: s.ticket.role, devices: want.mic || want.cam ? 'as they were' : 'off' });
        latest.current.onIn(s);
        return;
      }
      // Not going in: taken back, which never ends the call, whoever this connection is.
      takeBack(s);
      media.stop();
      setAsking(null);
      rlog.info('rejoining taken back', { why: at !== 'gone' ? at : shown.current ? 'given up' : 'the page went' });
      if (at !== 'gone') toast(at === 'turned-away' ? turnedAway(was.host) : `${KEYS_FAILED} Try again.`, { icon: 'x', ms: 6000 });
    }, (e: unknown) => {
      media.stop();
      rlog.info('rejoining didn’t work', { code: errorCode(e) });
      if (!given.aborted) toast(errorMessage(e), { icon: 'x', ms: 6000 });
    }).finally(over);
  }, [toast]);

  const cancel = useCallback((): boolean => {
    if (handed.current) return false;
    attempt.current?.abort();
    return true;
  }, []);

  return { busy, rejoin, cancel };
}

/**
 * J rejoins too, from anywhere on the page while `on`, coming back with the microphone and camera off. Not while typing, or with a
 * menu or a dialog open, and only J itself: with Shift, ⌘, Ctrl or Alt it's some other key, as Home's J is.
 */
export function useRejoinKey(on: boolean, rejoin: (media: RejoinMedia) => void): void {
  const press = useRef(rejoin);
  press.current = rejoin;
  useEffect(() => {
    if (!on) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'j' || e.repeat || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || overlayOpen()) return;
      e.preventDefault();
      press.current(QUIETLY);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [on]);
}
