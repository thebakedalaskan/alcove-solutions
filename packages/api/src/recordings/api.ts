import { type RoomRecording, type RoomRecordingInput } from './schema';
export interface RecordingsApi {
  /**
   * Starts recording in the room: now, or at `startedAt` for a recording made without a connection
   * and uploaded later. Its pieces and clips say where they fall, so the note keeps the recording's
   * own times. Starting again from the same `startedAt` carries on with that recording.
   */
  start(input?: RoomRecordingInput): Promise<RoomRecording>;
}
