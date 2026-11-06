/*
 * The sound of a ring: a soft chime, made here, played once per ring and in one tab only. Browsers let a page make sound
 * only once someone has pressed something on it. A tab that can't play stays quiet, which is never a problem to report,
 * and leaves the ring to any tab that can.
 */
import { log } from '~/lib/log';

const slog = log.child({ component: 'rings' });
let audio: AudioContext | null = null;

/** Whether the browser would let this page start sound now, without warning about it. */
const pressed = () => !('userActivation' in navigator) || navigator.userActivation.hasBeenActive;

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined' || !pressed()) return null;
  audio ??= new AudioContext();
  return audio;
}

/** Some browsers open sound only from a press itself: the first one on the page does it, ready for the first ring. */
export function readyRingSound(): () => void {
  const kinds = ['pointerdown', 'keydown'] as const;
  const stop = () => { for (const k of kinds) removeEventListener(k, ready, { capture: true }); };
  const ready = () => { stop(); void context()?.resume().catch(() => undefined); };
  for (const k of kinds) addEventListener(k, ready, { capture: true });
  return stop;
}

/** Two notes rising, twice, 1.2 seconds apart, as the arch ripples. */
function chime(c: AudioContext) {
  const out = c.createGain();
  out.gain.value = 0.14;
  out.connect(c.destination);
  const start = c.currentTime + 0.02;
  for (const [at, hz] of [[0, 659.25], [0.16, 880], [1.2, 659.25], [1.36, 880]] as const) {
    const note = c.createOscillator();
    const level = c.createGain();
    note.frequency.value = hz;
    level.gain.setValueAtTime(0.0001, start + at);
    level.gain.exponentialRampToValueAtTime(1, start + at + 0.02);
    level.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.6);
    note.connect(level);
    level.connect(out);
    note.start(start + at);
    note.stop(start + at + 0.65);
  }
}

/**
 * Plays a ring once across this browser's tabs: the first tab able to play takes the ring's lock, and holds it until the
 * ring runs out. `key` is one ring, `until` when it stops.
 */
export async function playRing(key: string, until: number): Promise<void> {
  try {
    const c = context();
    if (!c) return;
    if (c.state !== 'running') await Promise.race([c.resume(), new Promise((r) => { setTimeout(r, 200); })]);
    if (c.state !== 'running') return;
    if (!('locks' in navigator)) { chime(c); return; }
    await navigator.locks.request(`alcove-ring:${key}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      chime(c);
      await new Promise((r) => { setTimeout(r, Math.max(0, until - Date.now())); });
    });
  } catch (e) {
    slog.debug('a ring made no sound', { err: e });
  }
}
