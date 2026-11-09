import { z } from '../shared/zod';

/** Playback preferences only: independent of microphone capture and browser notifications. */
export const SoundPreferencesSchema = z.object({
  enabled: z.boolean().default(true),
  volume: z.number().min(0).max(1).default(0.55),
  quiet: z.boolean().default(false),
  mic: z.boolean().default(true),
  people: z.boolean().default(true),
  hands: z.boolean().default(true),
  questions: z.boolean().default(true),
  messages: z.boolean().default(true),
  admissions: z.boolean().default(true),
  timers: z.boolean().default(true),
  ringing: z.boolean().default(true)
});
export type SoundPreferences = z.infer<typeof SoundPreferencesSchema>;
export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = SoundPreferencesSchema.parse({});
/** Bounded browser-only receipt timestamps; event keys contain IDs, never content. */
export const SoundReceiptsSchema = z.array(z.object({ key: z.string().max(500), at: z.number(), tab: z.string() })).max(128);
