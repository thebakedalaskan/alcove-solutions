/*
 * Breakout rooms a call held: each room's name, the invited people sent to it (by email) and anyone else sent to it, and when.
 * A call keeps the times in seconds since it started; its note, in seconds into the recording. `places.ts` and `notes.ts` both
 * build on this shape as they load, and each can reach the other, so it's here, where neither has to have loaded first: nothing
 * here imports them.
 */
import { z } from 'zod';

export const HeldRooms = z.object({
  rooms: z.array(z.object({
    id: z.string(), name: z.string(), emails: z.array(z.string()),
    /**
     * Anyone sent to the room who isn't on the invite (a guest with the link): by their person in the call (seats are never
     * stored), with the name they were in it under, which the note names them by. None in a call or a note stored before
     * guests could be sent to a room.
     */
    guests: z.array(z.object({ person: z.string(), name: z.string() })).default([])
  })),
  from: z.number(), to: z.number()
});
export type HeldRooms = z.infer<typeof HeldRooms>;
