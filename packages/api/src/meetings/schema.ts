import { NotesChoicesSchema, NotesSettingSchema } from '../calls/settings';
import { CallDocumentSchema } from '../calls/workspace';
import { PersonSchema } from '../identity/people';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { MAX_CALL_DOCUMENTS } from '../workspaces/library';
/* ---------- meetings ---------- */

export const MeetingStatusSchema = z.enum(['scheduled', 'live', 'ended']);

export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;


/** Whether a time zone's name is one the runtime knows, such as "Europe/London". */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}


/** A day of the week: 0 is Sunday. */
export const WeekdaySchema = z.number().int().min(0).max(6);

/** How a call repeats: on some days every week or two, or on one weekday of each month (`week` -1 is the last one). */
export const RepeatRuleSchema = z.discriminatedUnion('every', [
  z.object({ every: z.literal('week'), weeks: z.union([z.literal(1), z.literal(2)]), days: z.array(WeekdaySchema).min(1).max(7) }),
  z.object({ every: z.literal('month'), week: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]), day: WeekdaySchema })
]);

export type RepeatRule = z.infer<typeof RepeatRuleSchema>;

/** The most calls one repeat can schedule. */
export const MAX_SERIES_CALLS = 60;

export const RepeatSchema = z.object({
  rule: RepeatRuleSchema,
  /** The last day a call can fall on, as `YYYY-MM-DD` where the organizer is. */
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Where the organizer is, as an IANA name: the calls keep their clock time there when the clocks change. */
  timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Not a time zone.')
});

export type Repeat = z.infer<typeof RepeatSchema>;

/**
 * A repeat as the app sends it, with when each call starts, soonest first, worked out where the organizer is. The
 * first is the call's own `startsAt`.
 */
export const RepeatInputSchema = RepeatSchema.extend({ occurrences: z.array(z.string()).min(1).max(MAX_SERIES_CALLS) });

export type RepeatInput = z.infer<typeof RepeatInputSchema>;

/** Changing or cancelling a call in a series: only this call, or this one and every later one. */
export const ChangeScopeSchema = z.enum(['this', 'following']);

export type ChangeScope = z.infer<typeof ChangeScopeSchema>;


/** Someone invited, answering whether they're coming. */
export const RsvpSchema = z.enum(['yes', 'maybe', 'no']);

export type Rsvp = z.infer<typeof RsvpSchema>;

/** How everyone invited has answered, and how many haven't. */
export const RsvpCountsSchema = z.object({ yes: z.number(), maybe: z.number(), no: z.number(), waiting: z.number() });

export type RsvpCounts = z.infer<typeof RsvpCountsSchema>;


export const MeetingSchema = z.object({
  id: IDSchema,
  title: z.string(),
  startsAt: ISODateSchema,
  endsAt: ISODateSchema,
  organizer: PersonSchema,
  isOrganizer: z.boolean(),
  /** Everyone invited besides the organizer. When notes are on, they all get them. Someone invited to a big call sees only `guestCount`. */
  guests: z.array(PersonSchema),
  /** How many people are invited besides the organizer. */
  guestCount: z.number(),
  notes: NotesSettingSchema,
  /** What the notes keep. */
  choices: NotesChoicesSchema,
  /** Short code used in the join link, e.g. `kpw-rnzq-hte`. */
  code: z.string(),
  status: MeetingStatusSchema,
  /** Started now, not scheduled: it's on nobody's calendar, and isn't listed until someone is in it. */
  instant: z.boolean(),
  /** Everyone joins with their microphone and camera off. */
  joinMuted: z.boolean(),
  /** What was brought to the call. */
  documents: z.array(CallDocumentSchema),
  /**
   * The call's home, for its organizer: the workspace its notes and transcript go to, in a folder of its own. Null until
   * there is one, and for everyone else, who find out in the call what they can open.
   */
  workspaceId: IDSchema.nullable(),
  /** How everyone invited has answered. */
  rsvps: RsvpCountsSchema,
  /** Your own answer, when you're invited; null when you haven't answered, and for the organizer. */
  rsvp: RsvpSchema.nullable(),
  /** Times offered to a guest, while they haven't picked one: `startsAt` means nothing until they have. */
  offer: z.object({ times: z.array(ISODateSchema) }).optional(),
  /** Present once the call has happened with notes on. */
  noteId: IDSchema.optional(),
  /** Seconds the call actually lasted, once ended. */
  duration: z.number().optional(),
  /** The call in the organizer's Google Calendar, which sends its invitations. */
  calendarUrl: z.string().url().optional(),
  /** The series it's in: the calls before and after it, whose decisions, open questions and follow-ups carry over. */
  seriesId: IDSchema.optional(),
  /** How the series repeats, when it was scheduled to. */
  repeat: RepeatSchema.optional(),
  /** The series' own link code, when it repeats: it always leads to the call that's on now or next. Its calendar invitation carries this one. */
  seriesCode: z.string().optional()
});

export type Meeting = z.infer<typeof MeetingSchema>;


/** The most people one call can invite, besides its organizer. */
export const MAX_GUESTS = 300;


/*
 * What `.partial()` makes of this is how a call is changed, so nothing here has a default: a default would come back
 * as a change on every update.
 */
export const MeetingInputSchema = z.object({
  title: z.string(),
  startsAt: ISODateSchema,
  durationMinutes: z.number(),
  /** Email addresses. */
  guests: z.array(z.string()),
  notes: NotesSettingSchema,
  /** What the notes keep. Everything, and screens only when turned on, unless it's set. */
  choices: NotesChoicesSchema.optional(),
  /** Everyone joins with their microphone and camera off. */
  joinMuted: z.boolean().optional(),
  /** Documents brought to the call, by the IDs the library gives them. */
  documents: z.array(IDSchema).max(MAX_CALL_DOCUMENTS).optional(),
  /**
   * The call's home: one of the organizer's workspaces they can edit in, where its notes and transcript go. Null: a new
   * workspace made for the call, named after it and its date, when someone first opens it or the call ends with notes.
   */
  workspaceId: IDSchema.nullable().optional(),
  /** Schedules a call for each occurrence, as one series with one link. */
  repeat: RepeatInputSchema.optional(),
  /**
   * Offers these times to a guest instead of settling on one: the call goes on no calendar until someone with its
   * link picks one (see calls.pick). `startsAt` is the first of them. Can't be combined with `repeat`.
   */
  offer: z.array(ISODateSchema).min(2).max(3).optional()
});

export type MeetingInput = z.infer<typeof MeetingInputSchema>;
