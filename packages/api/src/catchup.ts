/*
 * Catching up during a call (docs: Notes and inference › Catching up during a call): which stretch of the call to
 * read, what a catch-up or an answer says and the moments behind it, and how complete and current it is. For the
 * person asking alone: nothing here goes into the call's state, and nothing is kept. Times are seconds since the
 * call started (stretches with nothing captured are the call's `CaptureGap`s, by time of day); the app shows every
 * time as a time of day.
 */
import { z } from './zod';
import { CaptureGapSchema, IDSchema, TranscriptLineSchema } from './types';

/** A stretch of a call, in seconds since it started. */
export const CallStretchSchema = z.object({ from: z.number(), to: z.number() });
export type CallStretch = z.infer<typeof CallStretchSchema>;

/**
 * What to read. Everything but `before-joined`, `away` and a `between` with an end runs up to now: anything said up
 * to the moment it's read is in. A guest with the link reads only what was said while they were in the call.
 */
export const CatchUpRangeSchema = z.discriminatedUnion('kind', [
  /** The last few minutes. */
  z.object({ kind: z.literal('recent'), minutes: z.number().int().min(1).max(600) }),
  /** From when you first came into the call. */
  z.object({ kind: z.literal('since-joined') }),
  /** From the start of the call until you first came in. */
  z.object({ kind: z.literal('before-joined') }),
  /** Your latest time away: from a little before you dropped out until you were back. */
  z.object({ kind: z.literal('away') }),
  /** A stretch you pick; without an end, up to now. */
  z.object({ kind: z.literal('between'), from: z.number().min(0), to: z.number().min(0).nullable() }),
  /** The whole call so far. */
  z.object({ kind: z.literal('all') })
]);
export type CatchUpRange = z.infer<typeof CatchUpRangeSchema>;

/** A line of the live transcript behind a point: which line, and when it was said. */
export const TranscriptMomentSchema = z.object({ kind: z.literal('transcript'), lineId: IDSchema, said: z.number() });
export type TranscriptMoment = z.infer<typeof TranscriptMomentSchema>;
/**
 * What a point in a catch-up or an answer comes from. Only real moments of what was read are ever given: anything
 * else the model points at is dropped, and a point it can't tie to one is left out. Moments of a shared screen join
 * this union once shared screens are read for the notes.
 */
export const EvidenceSchema = z.discriminatedUnion('kind', [TranscriptMomentSchema]);
export type Evidence = z.infer<typeof EvidenceSchema>;

/** What a catch-up or an answer read, so it can say how complete and how current it is. */
export const CatchUpReadSchema = z.object({
  /** The stretch it read: where the range starts, and where it ends (`asOf` for one that runs to now). */
  from: z.number(), to: z.number(),
  /** How many lines of transcript that was. */
  lines: z.number(),
  /** When the newest of them was said; null when there were none. */
  through: z.number().nullable(),
  /** Stretches with nothing captured that touch it: before notes first came on, and while they were off or paused. */
  gaps: z.array(CaptureGapSchema),
  /**
   * Stretches in it with notes on and nothing transcribed: no hosting browser, which sends what's said to be
   * transcribed, was in the call (it reloaded, or its connection dropped before someone else hosted).
   */
  missed: z.array(CallStretchSchema),
  /**
   * It read only what was said while you were in the call: a guest with the link isn't on the invite, so doesn't get
   * the notes, and reads only what they were there for. True only when that left part of the range out.
   */
  whileHere: z.boolean(),
  /**
   * The middle of a stretch too long to read at once: from and to, and how many lines. The model read the beginning and
   * the end; `lines` counts only those. Null when it read all of it.
   */
  skipped: z.object({ from: z.number(), to: z.number(), lines: z.number() }).nullable(),
  /** When it was put together. */
  asOf: z.number()
});
export type CatchUpRead = z.infer<typeof CatchUpReadSchema>;

/** One thing a catch-up points out, and the moments it comes from. Something to do also says who it's for and when it's due, when that was said. */
export const CatchUpItemSchema = z.object({ text: z.string(), owner: z.string().optional(), due: z.string().optional(), evidence: z.array(EvidenceSchema) });
export type CatchUpItem = z.infer<typeof CatchUpItemSchema>;

/** Where a stretch of a call has got to, from its live transcript, for the person who asked. */
export const CatchUpSchema = z.object({
  /** A sentence or two on where the conversation is; empty when nothing was said in the stretch. */
  summary: z.string(),
  /** Agreed or settled. */
  decided: z.array(CatchUpItemSchema),
  /** Suggested, and not agreed yet. */
  proposed: z.array(CatchUpItemSchema),
  /** Asked, and not answered yet. */
  open: z.array(CatchUpItemSchema),
  /** What someone said they, or someone else, would do. */
  next: z.array(CatchUpItemSchema),
  read: CatchUpReadSchema
});
export type CatchUp = z.infer<typeof CatchUpSchema>;

/** An answer to a question about a call so far, for the person who asked, with the moments it comes from. */
export const CallAnswerSchema = z.object({ text: z.string(), evidence: z.array(EvidenceSchema), read: CatchUpReadSchema });
export type CallAnswer = z.infer<typeof CallAnswerSchema>;

/** What you can catch up on in a call, for choosing what to read. */
export const CatchUpWindowSchema = z.object({
  /** Now. */
  now: z.number(),
  /** When you first came into the call. */
  joined: z.number(),
  /** Your latest time away: when you dropped out, and when you were back. Null if you haven't been. */
  away: CallStretchSchema.nullable(),
  /**
   * What you can read, for a guest with the link: the stretches they were in the call (the last runs to now). Null
   * for the organizer and everyone on the invite, who get the notes and can read the whole call.
   */
  here: z.array(CallStretchSchema).nullable(),
  /** Stretches so far with nothing captured: before notes first came on, and while they were off or paused. */
  gaps: z.array(CaptureGapSchema)
});
export type CatchUpWindow = z.infer<typeof CatchUpWindowSchema>;

/** A moment of the live transcript opened from a catch-up or an answer: the line, and what was said around it. */
export const CallMomentSchema = z.object({
  lineId: IDSchema,
  /** The line and a few either side that you can read, oldest first, each with when it was said. */
  lines: z.array(TranscriptLineSchema.extend({ said: z.number() }))
});
export type CallMoment = z.infer<typeof CallMomentSchema>;
