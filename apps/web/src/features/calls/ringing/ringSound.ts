/** Ringing shares the same output scheduler, speaker and preference gates as the call's cues. */
import { playSound, readyAudioOutput, type SoundSettings } from '~/features/notifications/soundCues';

export const readyRingSound = readyAudioOutput;
export function playRing(key: string, until: number, owner: object, current: () => SoundSettings): void {
  playSound({ owner, cue: 'ring', key: `ring:${key}`, until: Math.min(until, Date.now() + 1200), current });
}
