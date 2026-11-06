import { TranscriptLineSchema } from '../notes/transcript';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { type LiveStore } from '../shared/live';
import { z } from '../shared/zod';
import { type AudioPiece, RecordingProgressSchema, type TranscriptClip } from './capture';
/** A recording made without a connection can be uploaded until it's this many days old. */
export const MAX_RECORDING_AGE_DAYS = 14;


/**
 * Starting a recording in the room. `startedAt` is when it really started, for one recorded without
 * a connection and uploaded later: up to MAX_RECORDING_AGE_DAYS back, and not in the future. Starting
 * again from the same `startedAt` carries on with that recording, as it is, so an upload that was cut
 * off resumes instead of making a second note. `owner` is the account it was recorded under (its
 * opaque ID): a session of any other account is refused (`forbidden`) and nothing is made, so a
 * recording kept on a shared device never lands in whoever is signed in there now.
 */
export const RoomRecordingInputSchema = z.object({
  title: z.string().trim().max(160).optional(),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  owner: z.string().min(1).max(100).optional()
});

export type RoomRecordingInput = z.infer<typeof RoomRecordingInputSchema>;


export const RoomRecordingStateSchema = z.object({
  id: IDSchema,
  noteId: IDSchema,
  title: z.string(),
  /** When it started: when it was started here, or its own start for one recorded without a connection. */
  startedAt: ISODateSchema,
  /** Seconds of audio stored so far, excluding pauses. */
  elapsed: z.number(),
  status: z.enum(['recording', 'paused', 'stopped']),
  recording: RecordingProgressSchema,
  /** What's been said so far, transcribed as the recording goes: the latest lines, oldest first. */
  transcript: z.array(TranscriptLineSchema)
});

export type RoomRecordingState = z.infer<typeof RoomRecordingStateSchema>;


/** The note being written, and how long the recording is: its pieces' total, pauses not counted. */
export const RecordingStopResultSchema = z.object({ pendingNoteId: IDSchema, duration: z.number() });

export type RecordingStopResult = z.infer<typeof RecordingStopResultSchema>;


export interface RoomRecording extends LiveStore<RoomRecordingState> {
  /** Renames: the snapshot says so at once. Resolves once the server has the new name, and fails if it couldn't. */
  rename(title: string): Promise<void>;
  /** Pauses: the snapshot says so at once. Resolves once the server has paused it, and fails if it couldn't. */
  pause(): Promise<void>;
  /** Resumes: the snapshot says so at once. Resolves once the server is recording again, and fails if it couldn't. */
  resume(): Promise<void>;
  appendAudio(piece: AudioPiece): Promise<void>;
  /** Transcribes a few seconds of speech into the live transcript. Only while recording. */
  transcribe(clip: TranscriptClip): Promise<void>;
  /** Stops and hands the audio to the notes service. Resolves with the note being written. */
  stop(): Promise<RecordingStopResult>;
  discard(): Promise<void>;
}
