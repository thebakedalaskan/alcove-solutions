/*
 * Breakout rooms a call held: each room's name and the invited people sent to it (by email), and when. A call keeps the times
 * in seconds since it started; its note, in seconds into the recording. `places.ts` and `notes.ts` both build on this shape as
 * they load, and each can reach the other, so it's here, where neither has to have loaded first: nothing here imports them.
 */
import { z } from 'zod';

export const HeldRooms = z.object({ rooms: z.array(z.object({ id: z.string(), name: z.string(), emails: z.array(z.string()) })), from: z.number(), to: z.number() });
export type HeldRooms = z.infer<typeof HeldRooms>;
