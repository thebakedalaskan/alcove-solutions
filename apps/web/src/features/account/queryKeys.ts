/*
 * The account's query keys: who's signed in here, and their preferences. Keys import nothing, so any feature can name them
 * (a write that touches them, what this device remembers) without depending on how they're read (./queries.ts).
 */
export const accountKeys = {
  session: ['session'] as const,
  prefs: ['prefs'] as const
};
