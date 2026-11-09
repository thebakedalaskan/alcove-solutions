import { useEffect, useRef, useState } from 'react';
import type { LocalMedia } from './media';

/**
 * How a level (0 to 1) says someone's talking, sampled every `every` ms while `on`. A sample over `loud` counts one and one under
 * it takes back half; `enough` of them says they're talking. Once they are, `quiet` samples under it in a row say they've
 * stopped (never, at `Infinity`, until it's off), and then it rests for `rest` samples before it can say so again. It hears
 * nothing for its first `grace` samples.
 */
export interface Talk { loud: number; every?: number | undefined; enough?: number | undefined; quiet?: number | undefined; rest?: number | undefined; grace?: number | undefined }

/**
 * Whether a level says someone's talking, by the rules in `Talk`, from this device alone: nothing of it leaves. The one detector
 * for talking in a call. Owns its sampling interval while `on`; `level` is read as it samples.
 */
export function useTalking(level: () => number, on: boolean, { loud, every = 200, enough = 1, quiet = 1, rest = 0, grace = 0 }: Talk): boolean {
  const [talking, setTalking] = useState(false);
  const latest = useRef(level);
  latest.current = level;
  useEffect(() => {
    if (!on) { setTalking(false); return; }
    let talk = 0;
    let still = 0;
    let resting = 0;
    let waiting = grace;
    let saying = false;
    const t = setInterval(() => {
      if (waiting > 0) { waiting -= 1; return; }
      const heard = latest.current() > loud;
      if (saying) {
        still = heard ? 0 : still + 1;
        if (still >= quiet) { saying = false; resting = rest; setTalking(false); }
        return;
      }
      if (resting > 0) { resting -= 1; return; }
      talk = heard ? talk + 1 : Math.max(0, talk - 0.5);
      if (talk >= enough) { saying = true; talk = 0; still = 0; setTalking(true); }
    }, every);
    return () => clearInterval(t);
  }, [on, loud, every, enough, quiet, rest, grace]);
  return talking;
}

/** Whether you're talking now, from the real microphone level, sample by sample: for your own tile and row. */
export const useSpeaking = (media: LocalMedia, on: boolean): boolean => useTalking(() => media.level(), on, { loud: 0.09, every: 160 });

/**
 * Whether you're talking with your microphone muted, from its level here alone: a second or two of mostly talking says so, and
 * a few seconds' quiet, or unmuting, takes it back. Once said, it rests for 45 seconds.
 */
export const useTalkingOnMute = (media: LocalMedia, muted: boolean): boolean => useTalking(() => media.mutedLevel(), muted, { loud: 0.12, enough: 8, quiet: 20, rest: 225 });
