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
 * Shared screens (docs: Calls and recordings › Shared screens). A presenter's browser says each share is starting, and
 * whether it goes in the notes; the server gives it an ID. While it's kept, the browser records it and sends the video
 * in pieces, raw bytes with the piece's MIME type and, in these headers, where it goes: the recording's segment, the
 * piece's sequence number in that segment for this share, where it starts in the segment (`at`, in milliseconds with
 * pauses not counted) and its length. The share is in the path.
 */
export const VIDEO_HEADERS = { segment: 'x-alcove-segment', seq: 'x-alcove-seq', at: 'x-alcove-at-ms', duration: 'x-alcove-duration-ms' } as const;

/**
 * What comes with a line of a call's recording, beside its audio (`CallSession.hear`): where in the audio the line starts
 * and how long it lasts, in seconds.
 */
export const HEARD_HEADERS = { from: 'x-alcove-heard-from', seconds: 'x-alcove-heard-seconds' } as const;

/** A piece of a shared screen's video, at most this big. Five seconds at the rate browsers record is far smaller. */
export const MAX_VIDEO_PIECE_BYTES = 4 * 1024 * 1024;

/**
 * The most frames of shared screens one call's notes read, however long it shared: picked from what was said (with the
 * frame a few seconds before a change), and each share's start. Fewer for less sharing (SECONDS_PER_SCREEN_FRAME).
 */
export const MAX_SCREEN_FRAMES = 100;

/** On average, at most one frame for this many seconds of sharing. */
export const SECONDS_PER_SCREEN_FRAME = 15;
