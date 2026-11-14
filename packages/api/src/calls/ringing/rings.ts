import { PersonSchema } from '../../identity/people';
import { IDSchema, ISODateSchema } from '../../shared/ids';
import { z } from '../../shared/zod';
import { NotesSettingSchema } from '../notes/settings';
/** How long a ring lasts, in seconds. */
export const RING_SECONDS = 45;


/** A ring on someone's screen: who's ringing, and the call it leads to. */
export const IncomingRingSchema = z.object({
  /** One per person per call: rung again, or coming back after `in-5`, it has this ID and a new `expiresAt`. */
  id: IDSchema,
  code: z.string(),
  title: z.string(),
  from: PersonSchema,
  /** Whether the call was set to have notes: everyone rung is on the invite, so they get them. */
  notes: NotesSettingSchema,
  /** When it stops, by itself. */
  expiresAt: ISODateSchema
});

export type IncomingRing = z.infer<typeof IncomingRingSchema>;


/** What someone rung says back: they're coming, in a little while (they're rung again then), or not this time. */
export const RingReplySchema = z.enum(['join', 'in-5', 'in-15', 'no']);

export type RingReply = z.infer<typeof RingReplySchema>;


/** Someone the organizer rang who isn't in the call, as the organizer sees them. */
export const RungSchema = z.object({
  id: IDSchema,
  person: PersonSchema,
  /** ringing: right now. coming: said Join. later: said in a little while, and is rung again at `until`. declined: not this time. missed: it ran out unanswered. */
  state: z.enum(['ringing', 'coming', 'later', 'declined', 'missed']),
  /** When the ring they're on started. */
  since: ISODateSchema,
  until: ISODateSchema.optional()
});

export type Rung = z.infer<typeof RungSchema>;


/** One line of the rings stream: everything ringing this person now. */
export const RingsSnapshotSchema = z.object({ rings: z.array(IncomingRingSchema) });
