import { IDSchema } from '../shared/ids';
import { z } from '../shared/zod';
/** Encrypted audio stored so far for the call's notes. */
export const RecordingProgressSchema = z.object({
  /** Current segment; a new one starts each time notes are turned on again or resumed. */
  segment: z.number(),
  pieces: z.number(),
  seconds: z.number()
});

export type RecordingProgress = z.infer<typeof RecordingProgressSchema>;


/**
 * A few seconds of speech to transcribe while notes are on: 16 kHz mono 16-bit WAV, which the
 * notes service reads directly. Separate from the encrypted recording, which keeps its own format.
 */
export interface TranscriptClip {
  data: Blob;
  /** Segment the speech belongs to (see RecordingProgress.segment). */
  segment: number;
  /** Where the clip starts, in seconds from the start of its segment, pauses not counted. A room recording is one segment. */
  at: number;
  durationMs: number;
  /**
   * In a call, when the speech began, by this browser's `performance.now()`. The request says how long ago that was
   * (`AUDIO_HEADERS.ago`), and the server places the speech where its speaker was then: a clip still on its way when
   * someone moves stays where it was said. A room recording has none.
   */
  heardAt?: number | undefined;
}


/**
 * A frame of the presenter's own shared screen, kept because the screen changed (docs: Calls and recordings › Shared
 * screens): JPEG bytes, which share it's from (its LiveKit track ID), and when it was taken (`Date.now()` then).
 */
export interface ScreenFrame {
  data: Blob;
  share: string;
  takenAt: number;
}

/** What the call kept of a frame: its ID, or the ID it already had if the same frame came before (a retry). */
export const ScreenFrameReceiptSchema = z.object({ id: IDSchema, duplicate: z.boolean() });

export type ScreenFrameReceipt = z.infer<typeof ScreenFrameReceiptSchema>;


/**
 * A piece of recorded audio, as produced by MediaRecorder every few seconds. Sending a piece that's
 * stored already stores nothing new. A room recording takes such a resend even once it's paused or
 * stopped; a call refuses audio once notes are off or a later segment has begun.
 */
export interface AudioPiece {
  data: Blob;
  /** Segment the piece belongs to (see RecordingProgress.segment). */
  segment: number;
  /** Position within the segment, starting at 0. */
  seq: number;
  /** Where the piece starts, in seconds from the start of its segment, pauses not counted. */
  at: number;
  durationMs: number;
  mimeType: string;
}
