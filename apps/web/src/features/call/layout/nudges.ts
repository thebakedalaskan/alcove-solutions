/*
 * Nudges: a quiet word to one person in your room, which only they see (You're muted, Can't hear you, Slow down a little, A bit
 * louder). What each is called and drawn with, and how a note of them reads to whoever got it: one person's ("Kofi can't hear
 * you"), or however many sent the same within a minute ("3 people can't hear you").
 */
import { CallNudgeKindSchema, type CallNudgeKind, type CallNudgeNote } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import { callName } from '~/lib/people';

export const NUDGES: Readonly<Record<CallNudgeKind, { icon: IconName; label: string; one: (who: string) => string; many: (n: number) => string }>> = {
  muted: { icon: 'micOff', label: 'You’re muted', one: (who) => `${who} says you’re muted`, many: (n) => `${n} people say you’re muted` },
  'cant-hear': { icon: 'hear', label: 'Can’t hear you', one: (who) => `${who} can’t hear you`, many: (n) => `${n} people can’t hear you` },
  'slow-down': { icon: 'pace', label: 'Slow down a little', one: (who) => `${who} asks you to slow down a little`, many: (n) => `${n} people ask you to slow down a little` },
  louder: { icon: 'speaker', label: 'A bit louder', one: (who) => `${who} asks you to speak a bit louder`, many: (n) => `${n} people ask you to speak a bit louder` }
};
export const NUDGE_KINDS: readonly CallNudgeKind[] = CallNudgeKindSchema.options;

/** How a nudge you got reads. */
export const nudgeSaid = (note: CallNudgeNote): string =>
  note.count > 1 ? NUDGES[note.kind].many(note.count) : NUDGES[note.kind].one(note.from ? callName(note.from) : 'Someone');
