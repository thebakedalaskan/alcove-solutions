/* What to tell someone whose microphone or camera isn't working, and what they can do about it, in plain words. */
import { howToAllow, howToAllowSystem, type Capture } from './devices';
import type { DeviceProblem, MediaSnapshot } from './media';

export interface Trouble {
  kinds: Capture[];
  problem: DeviceProblem;
  title: string;
  /** What to do, where there's something to do. */
  how: string | null;
  /** Trying again could fix it (it can't conjure a device that isn't plugged in). */
  retry: boolean;
}

const named = (kinds: Capture[]) => (kinds.length > 1 ? 'camera and microphone' : kinds[0] === 'cam' ? 'camera' : 'microphone');
const ORDER: DeviceProblem[] = ['blocked', 'system', 'dismissed', 'busy', 'failed', 'missing'];

function describe(problem: DeviceProblem, kinds: Capture[]): Trouble {
  const what = named(kinds);
  switch (problem) {
    case 'blocked': return { kinds, problem, title: `Your browser is blocking the ${what}.`, how: howToAllow(kinds), retry: true };
    case 'system': return { kinds, problem, title: `Your computer isn’t letting the browser use the ${what}.`, how: howToAllowSystem(kinds), retry: true };
    case 'dismissed': return { kinds, problem, title: `Alcove needs your permission to use the ${what}.`, how: 'Your browser asks again when you try again.', retry: true };
    case 'busy': return { kinds, problem, title: `Your ${what} didn’t start.`, how: 'Another app may be using it. Close that app, then try again.', retry: true };
    case 'failed': return { kinds, problem, title: `Your ${what} didn’t start.`, how: null, retry: true };
    case 'missing': return { kinds, problem, title: kinds.length > 1 ? 'No camera or microphone found.' : `No ${what} found.`, how: 'Plug one in and Alcove picks it up.', retry: false };
  }
}

/** What's wrong, worst first, with the microphone and camera together when they share a problem. */
export function troubles(m: MediaSnapshot, kinds: Capture[] = ['mic', 'cam']): Trouble[] {
  const by = new Map<DeviceProblem, Capture[]>();
  for (const k of kinds) {
    const p = m.access[k].problem;
    if (p) by.set(p, [...(by.get(p) ?? []), k]);
  }
  return ORDER.flatMap((p) => { const ks = by.get(p); return ks ? [describe(p, ks)] : []; });
}

/** A device's state in two or three words, for its picker or button. */
export function stateOf(kind: Capture, problem: DeviceProblem): string {
  const name = kind === 'mic' ? 'Microphone' : 'Camera';
  switch (problem) {
    case 'blocked': case 'system': return `${name} blocked`;
    case 'dismissed': return `${name} not allowed yet`;
    case 'busy': case 'failed': return `${name} didn’t start`;
    case 'missing': return `No ${name.toLowerCase()}`;
  }
}
