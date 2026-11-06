import { z } from '../shared/zod';
export const RecordingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rename'), title: z.string().trim().min(1).max(160) }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') })
]);

export type RecordingAction = z.infer<typeof RecordingActionSchema>;


/**
 * Where audio goes in the recording, in these headers: its segment, a piece's sequence number, where each
 * piece or clip starts in its segment (`at`, in milliseconds with pauses not counted) and its length. A call's
 * speech also says whose it is (`speaker`: a participant ID) and how long before the request it began (`ago`,
 * in ms), so the server can place it where its speaker was when it was said.
 */
export const AUDIO_HEADERS = { segment: 'x-alcove-segment', seq: 'x-alcove-seq', at: 'x-alcove-at-ms', duration: 'x-alcove-duration-ms', speaker: 'x-alcove-speaker', ago: 'x-alcove-ago-ms' } as const;

export const MAX_AUDIO_PIECE_BYTES = 2 * 1024 * 1024;

/** How many of the newest transcript lines a live call or room recording carries. */
export const LIVE_TRANSCRIPT_LINES = 200;

/** A transcript clip: at most 30 seconds of 16 kHz mono 16-bit WAV. */
export const MAX_TRANSCRIPT_CLIP_MS = 30_000;

export const MAX_TRANSCRIPT_CLIP_BYTES = 44 + MAX_TRANSCRIPT_CLIP_MS * 32;

/*
 * Shared screens (docs: Calls and recordings › Shared screens). The presenter's own browser sends a frame of its own
 * share, as JPEG bytes, when the screen has changed: which share it is (`share`, the share's LiveKit track ID) and how
 * long ago it was taken (`age`, in ms), so it's placed where it was on screen even if sending it took a moment.
 */
export const FRAME_HEADERS = { share: 'x-alcove-share', age: 'x-alcove-age-ms' } as const;

/**
 * What comes with a line of a call's recording, beside its audio (`CallSession.hear`): where in the audio the line starts
 * and how long it lasts, in seconds.
 */
export const HEARD_HEADERS = { from: 'x-alcove-heard-from', seconds: 'x-alcove-heard-seconds' } as const;

/** A frame's JPEG, at most this big. Browsers send them at most 1600 pixels across, which is far smaller. */
export const MAX_FRAME_BYTES = 1024 * 1024;

/** How old a frame can say it is when it arrives: older ones are placed as if taken this long ago. */
export const MAX_FRAME_AGE_MS = 30_000;
