import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { MAX_CALL_DOCUMENTS } from '../workspaces/library';
import { isTimeZone, ProposalAnswerSchema, RsvpSchema } from './schema';
/** Saying whether you're coming to a call you're invited to. */
export const RsvpBodySchema = z.object({ answer: RsvpSchema });

/** Asking the organizer to move a call you're invited to: when you'd rather it started. */
export const ProposeBodySchema = z.object({ startsAt: ISODateSchema });

/**
 * The organizer answering someone's request to move a call. Whose request it is travels in the body, as an address, so
 * it never appears in a URL or an access log.
 */
export const ProposalAnswerBodySchema = z.object({ email: z.string().trim().toLowerCase().max(254), answer: ProposalAnswerSchema });

/** A stretch of your own calendar to read, as `GET /v1/calendar?from=…&to=…` asks for it: at most 31 days. */
export const CalendarRangeSchema = z.object({ from: ISODateSchema, to: ISODateSchema });

export type CalendarRange = z.infer<typeof CalendarRangeSchema>;

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

/**
 * Scheduling on the Calls page, as the app's address says it (`/calls?schedule=…`): a new call, moving one (or, for
 * someone invited, asking to), or meeting again after a call. What it starts from: a time (`slot`, and how long, from the
 * week), the call it moves (`meeting`), the call it follows (`note`), and what it brings (`bring`, document IDs). Who it's
 * with never goes in the address, which reaches the web server's logs: it travels in the history entry instead. Anything
 * that doesn't read is left out rather than refused.
 */
export const ScheduleModeSchema = z.enum(['new', 'move', 'again']);

export type ScheduleMode = z.infer<typeof ScheduleModeSchema>;

const validTime = (t: string) => !Number.isNaN(Date.parse(t));
export const ScheduleParamsSchema = z.object({
  schedule: ScheduleModeSchema,
  slot: z.string().max(40).refine(validTime).optional().catch(undefined),
  minutes: z.coerce.number().int().min(5).max(600).optional().catch(undefined),
  meeting: IDSchema.min(1).max(64).optional().catch(undefined),
  note: IDSchema.min(1).max(64).optional().catch(undefined),
  bring: z.array(IDSchema.min(1).max(128)).max(MAX_CALL_DOCUMENTS).optional().catch(undefined)
});

export type ScheduleParams = z.infer<typeof ScheduleParamsSchema>;
