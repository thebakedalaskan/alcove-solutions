/** Ringing shares the same output scheduler, speaker and preference gates as the call's cues. */
import type { SoundPreferences } from '@alcove/api';
import { playSound, readyAudioOutput } from '~/lib/audio-output';

export const readyRingSound = readyAudioOutput;
export function playRing(key: string, until: number, owner: object, current: () => { prefs: SoundPreferences; speakerId: string | null }): void {
  playSound({ owner, cue: 'ring', key: `ring:${key}`, until: Math.min(until, Date.now() + 1200), current });
}
