/*
 * Sharing a screen: whether this browser can, how many people share at once, and what to say when the browser or the
 * computer won't share. The capture itself is LocalMedia's (media.ts), publishing it is the room's (livekit.ts), and
 * the call screen says what happened.
 */

/**
 * At most this many screens shared at once in your part of the call, yours included. Two sit side by side and the
 * rest wait as tiles to switch to; past four the stage gives screens more room than people, and every browser in the
 * call decrypts and decodes one more stream for each. A browser starts a share only under it. Two people starting at
 * the same moment can go one over, which the stage takes in its stride.
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
