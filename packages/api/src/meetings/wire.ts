import { ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { isTimeZone, RsvpSchema } from './schema';
/** Saying whether you're coming to a call you're invited to. */
export const RsvpBodySchema = z.object({ answer: RsvpSchema });

/**
 * When people are busy, between two times. Addresses travel in the body so they never appear in URLs or access logs.
 * `timeZone` is where the person asking is, which is where an all-day event without a zone of its own falls and where a
 * demo account's made-up week keeps working hours: a name this server doesn't know reads as none, and none as UTC.
 */
export const BusyBodySchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().max(254)).max(300), from: ISODateSchema, to: ISODateSchema,
  timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Not a time zone.').optional().catch(undefined)
});

/** Picking one of the times a call offers: anyone with the link can, once. */
export const PickTimeBodySchema = z.object({ at: ISODateSchema });


/** Scheduling the next call in a series: when it starts (the app sends the same clock time a week on). */
export const NextCallBodySchema = z.object({ startsAt: z.string().max(40) });
