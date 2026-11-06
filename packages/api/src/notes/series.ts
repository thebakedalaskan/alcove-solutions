import { PersonSchema } from '../identity/people';
import { MeetingSchema, RepeatSchema } from '../meetings/schema';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { NoteActionSchema, NoteDecisionSchema, NoteQuestionSchema } from './entries';
import { NoteStatusSchema, ReceivedSchema } from './schema';
import { ChangerSchema } from './transcript';
/* ---------- series: what carries over from one call to the next ---------- */

/*
 * A series is calls that follow on from each other: the occurrences of one recurring Google
 * Calendar event held in Alcove, or calls scheduled as the next one. What carries over is put
 * together for whoever asks, from the notes they have, each time they ask, and never kept: being
 * invited to one call in a series opens nothing from the others.
 */

/** One call in a series whose notes you have. */
export const SeriesNoteSchema = z.object({
  id: IDSchema, title: z.string(), startedAt: ISODateSchema, duration: z.number(), status: NoteStatusSchema,
  /** For the organizer: the call the note is from, to schedule the next one after it. */
  meetingId: IDSchema.optional(),
  /** How you got the note, when it's someone else's. Absent on your own. */
  received: ReceivedSchema.optional()
});

export type SeriesNote = z.infer<typeof SeriesNoteSchema>;


/** The breakout room something came from: its section of the call's notes. Absent for the main room. */
export const RoomRefSchema = z.object({ id: IDSchema, name: z.string() });

export type RoomRef = z.infer<typeof RoomRefSchema>;


/**
 * Where a later call came back to something, in notes you have too: the notes model thinks it replaced a decision or
 * answered a question. It only suggests: the decision or question stands as it was until someone who has the notes
 * says otherwise, or says the notes got it wrong (notes.updateRevisit, with this `id` on the later call's note).
 * Someone without both notes is never told: what a later call did is that call's.
 */
export const LaterCallSchema = z.object({
  id: IDSchema,
  /** The later call's note: one of `Series.notes`. */
  noteId: IDSchema,
  /** The breakout room of the later call it came up in. */
  room: RoomRefSchema.optional(),
  /** The moment in the later call's recording, in seconds, if the notes could tell. */
  at: z.number().optional(),
  /** Someone said the notes got it wrong: who, and when. It stands as said, for anyone with both notes to see, and whoever may to undo. */
  dismissed: z.object({ by: ChangerSchema, at: ISODateSchema }).optional()
});

export type LaterCall = z.infer<typeof LaterCallSchema>;

/** A later decision that seems to replace an earlier one: where, and what it says. */
export const ReplacedBySchema = LaterCallSchema.extend({ text: z.string() });

export type ReplacedBy = z.infer<typeof ReplacedBySchema>;


/** Where something came from: one of `Series.notes`, and the breakout room whose section of it says so, when one does. */
const CarriedFrom = { noteId: IDSchema, room: RoomRefSchema.optional() };

/** A decision from one of the series' notes, and the later call that seems to replace it. */
export const CarriedDecisionSchema = NoteDecisionSchema.extend({ ...CarriedFrom, replacedBy: ReplacedBySchema.optional() });

export type CarriedDecision = z.infer<typeof CarriedDecisionSchema>;

/** How long something has gone unsettled: the later calls (whose notes you have) it stayed open through. Stale from two. */
const Carried = { ...CarriedFrom, later: z.number(), stale: z.boolean() };

/** A question from one of the series' notes, and the later call that seems to answer it. */
export const CarriedQuestionSchema = NoteQuestionSchema.extend({ ...Carried, answeredIn: LaterCallSchema.optional() });

export type CarriedQuestion = z.infer<typeof CarriedQuestionSchema>;

export const CarriedActionSchema = NoteActionSchema.extend(Carried);

export type CarriedAction = z.infer<typeof CarriedActionSchema>;


export const SeriesSchema = z.object({
  id: IDSchema,
  /** The next call's title, or the latest one's. */
  title: z.string(),
  /** Whose calls they are. */
  organizer: PersonSchema,
  isOrganizer: z.boolean(),
  /** For the organizer: the next call in the series, when one is scheduled in Alcove. */
  next: MeetingSchema.optional(),
  /** For the organizer: the series follows a recurring Google Calendar event, so its next call is the next occurrence there. */
  recurring: z.boolean(),
  /** For the organizer: how the series repeats, when it was scheduled to in Alcove. */
  repeat: RepeatSchema.optional(),
  /** The calls in the series whose notes you have, newest first: the newest 24 of them. Everything below comes from these alone. */
  notes: z.array(SeriesNoteSchema),
  /** How many older calls in it you also have notes from. They aren't shown, and nothing carries over from them. */
  older: z.number(),
  /**
   * Confirmed decisions, ones that no longer hold, and ones nobody has confirmed yet, newest call first, each call's
   * own and then its breakout rooms'. Never ones people said weren't decided.
   */
  decisions: z.array(CarriedDecisionSchema),
  /** Questions nobody has said were answered yet, the call's and its breakout rooms'. */
  questions: z.array(CarriedQuestionSchema),
  /** Questions someone said were answered since the latest call started: said once, like follow-ups just done. */
  answered: z.array(CarriedQuestionSchema),
  /** Follow-ups not done yet, and ones done since the latest call started, the call's and its breakout rooms'. */
  actions: z.array(CarriedActionSchema)
});

export type Series = z.infer<typeof SeriesSchema>;


/** An answer about a series: its text, then the calls it comes from, with the breakout room and the moment in each when it can tell. */
export const SeriesAnswerPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('source'), noteId: IDSchema, title: z.string(), startedAt: ISODateSchema, room: RoomRefSchema.optional(), at: z.number().optional() })
]);

export type SeriesAnswerPart = z.infer<typeof SeriesAnswerPartSchema>;
