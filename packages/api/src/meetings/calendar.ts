import { PersonSchema } from '../identity/people';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
/* ---------- calendar ---------- */

/** Result in the browser's return from Google Calendar consent. */
export const CalendarConnectResultSchema = z.enum(['connected', 'denied', 'account', 'failed']);
export type CalendarConnectResult = z.infer<typeof CalendarConnectResultSchema>;

/** One of someone's other calendar events (not an Alcove call), shown beside Alcove's own. */
export const CalendarEventSchema = z.object({
  /** The provider's event ID. */
  id: IDSchema,
  title: z.string(),
  startsAt: ISODateSchema,
  endsAt: ISODateSchema,
  organizer: PersonSchema,
  isOrganizer: z.boolean(),
  /** Everyone else invited. */
  guests: z.array(PersonSchema),
  /** The event's own video link and what it is ("Google Meet", "Zoom", ...), when it has one. */
  join: z.object({ url: z.string().url(), label: z.string() }).optional(),
  /** The event in the calendar it came from. */
  calendarUrl: z.string().url(),
  /** Your series this event continues: it's the next occurrence of a recurring event you've held in Alcove. */
  seriesId: IDSchema.optional(),
  /** The code of the Alcove link on the event: it's someone's Alcove call, which `join` opens. */
  alcoveCode: z.string().optional()
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;


export const CalendarSchema = z.object({
  /** google: connected. sample: a demo account's sample day. none: nothing connected. */
  source: z.enum(['google', 'sample', 'none']),
  /** Signed in with Google without giving calendar access; the app can ask for it. */
  needsAccess: z.boolean(),
  /** The coming week's other events, soonest first. */
  events: z.array(CalendarEventSchema)
});

export type Calendar = z.infer<typeof CalendarSchema>;


/** A stretch of time. */
export const IntervalSchema = z.object({ from: ISODateSchema, to: ISODateSchema });

export type Interval = z.infer<typeof IntervalSchema>;

/**
 * When people are busy. `you` is your own calendar and calls. A person's `busy` is null when their calendar can't be
 * read: it's private, or they're outside the company. Read when it's asked for and stored nowhere.
 */
export const BusySchema = z.object({
  /** google: from a connected calendar. sample: a demo account's made-up week. none: nothing connected. */
  source: z.enum(['google', 'sample', 'none']),
  you: z.array(IntervalSchema),
  people: z.array(z.object({ email: z.string(), busy: z.array(IntervalSchema).nullable() }))
});

export type Busy = z.infer<typeof BusySchema>;
