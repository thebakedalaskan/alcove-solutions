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
 * What was on a shared screen at a moment of the call: one frame the presenter's own browser kept because the screen
 * changed. `at` to `until` is the stretch of the recording it was on screen, the part of the transcript it belongs
 * to. The reading (title, text, how legible, the parts worth pointing at) is the private notes model's; its
 * `description` ties the frame to what was said. The image is at notes.screenUrl(noteId, id).
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
  regions: z.array(ScreenRegionSchema)
});

export type ScreenMoment = z.infer<typeof ScreenMomentSchema>;


/**
 * Where something in the notes was on a shared screen: the moment (`ScreenMoment.id`), the part of it when one
 * (`region`, an index into its regions), and whether what was said plainly refers to it (`sure`) or the notes only
 * think it does.
 */
export const ScreenRefSchema = z.object({ id: IDSchema, region: z.number().optional(), sure: z.boolean() });

export type ScreenRef = z.infer<typeof ScreenRefSchema>;
