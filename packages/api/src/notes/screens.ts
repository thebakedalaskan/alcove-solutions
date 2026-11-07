import { IDSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { SpeakerSchema } from './transcript';
/* ---------- shared screens in a note ---------- */

/** A part of a shared screen worth pointing at (a chart, a table, a paragraph): a short label, and where it is as fractions of the frame from its top left. */
export const ScreenRegionSchema = z.object({ label: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export type ScreenRegion = z.infer<typeof ScreenRegionSchema>;


/**
 * How well a frame could be read. clear: all of it. partly: some was too small, blurred or cut off. unreadable: none
 * of it could be made out. unread: the notes model couldn't read it at all, so nothing is said about it.
 */
export const ScreenLegibleSchema = z.enum(['clear', 'partly', 'unreadable', 'unread']);

export type ScreenLegible = z.infer<typeof ScreenLegibleSchema>;


/**
 * How much a frame of a shared screen matters to what was said. key: the talk points at it, or relies on what it shows.
 * supporting: it adds to what was said. unrelated: nothing said is about it, so the notes leave it out.
 */
export const ScreenRelevanceSchema = z.enum(['key', 'supporting', 'unrelated']);

export type ScreenRelevance = z.infer<typeof ScreenRelevanceSchema>;


/**
 * What was on a shared screen at a moment of the call: one frame taken from a share kept for the notes, at a moment
 * picked from what was said (or as its share began). `at` to `until` is the stretch of the recording
 * it stands for, the part of the transcript it belongs to. The reading (title, text, how legible, the parts worth
 * pointing at, how relevant) is the vision model's; its `description` ties the frame to what was said. The image is at
 * notes.screenUrl(noteId, id).
 */
export const ScreenMomentSchema = z.object({
  id: IDSchema,
  /** Seconds into the recording, as transcript lines count them, when it appeared. */
  at: z.number(),
  /** Until when it stayed: the share's next frame, the share or screen notes stopping, a gap, or the end. */
  until: z.number(),
  /** Whose screen it was. Absent when the call can't tell any more. */
  presenter: SpeakerSchema.optional(),
  /** Which share it's from: one person can share more than once, and several people can share at once. */
  share: IDSchema,
  /** The frame's size in pixels. */
  width: z.number(),
  height: z.number(),
  legible: ScreenLegibleSchema,
  /** What it is, in a few words: a slide's heading, a document's name, the app shown. Empty when nothing could be read. */
  title: z.string(),
  /** The words and numbers read on it, line by line: only what could be read. */
  text: z.string(),
  /** What it shows and how it ties in with what was said, once the notes are written. Empty before. */
  description: z.string(),
  /** What it shows beyond its words, as the vision model saw it: people, objects, diagrams, the layout and design. Empty when it said nothing, or before frames were described. */
  shows: z.string().default(''),
  /** What changed on it since a few seconds before, when what was said pointed at a change. Empty otherwise. */
  changed: z.string().default(''),
  regions: z.array(ScreenRegionSchema),
  /** How much it matters to what was said. Notes written before frames were judged take `supporting`. */
  relevance: ScreenRelevanceSchema.default('supporting'),
  /** What was said that pointed at it ("as you can see…"). Empty when it was taken to fill a stretch, or before cues were kept. */
  cue: z.string().default(''),
  /**
   * The transcript line (`TranscriptLine.id`) it's attached to: at most one moment per line. Null on notes written
   * before frames were attached to lines, which place it by time.
   */
  line: IDSchema.nullable().default(null)
});

export type ScreenMoment = z.infer<typeof ScreenMomentSchema>;


/**
 * A share's video in one segment of the recording: from `at` to `until`, in seconds into the recording as transcript
 * lines count them. The video's own time 0 is at `at`.
 */
export const ScreenShareSegmentSchema = z.object({ segment: z.number(), at: z.number(), until: z.number() });

export type ScreenShareSegment = z.infer<typeof ScreenShareSegmentSchema>;


/**
 * A share kept for the notes, which replay shows in step with the audio: whose it was, a label to tell it apart, when
 * it ran (seconds into the recording) and its video by segment, each at notes.screenVideoUrl(noteId, id, segment).
 */
export const ScreenShareSchema = z.object({
  id: IDSchema,
  /** Whose screen it was. Absent when the call can't tell any more. */
  presenter: SpeakerSchema.optional(),
  /** What to call it beside other shares, e.g. "Priya’s screen" or "Priya’s screen (2)". */
  label: z.string(),
  at: z.number(),
  until: z.number(),
  segments: z.array(ScreenShareSegmentSchema)
});

export type ScreenShare = z.infer<typeof ScreenShareSchema>;


/**
 * Where something in the notes was on a shared screen: the moment (`ScreenMoment.id`), the part of it when one
 * (`region`, an index into its regions), and whether what was said plainly refers to it (`sure`) or the notes only
 * think it does.
 */
export const ScreenRefSchema = z.object({ id: IDSchema, region: z.number().optional(), sure: z.boolean() });

export type ScreenRef = z.infer<typeof ScreenRefSchema>;
