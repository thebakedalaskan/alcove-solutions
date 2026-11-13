/*
 * Recording in the room, as the stand-in answers for it (packages/api-http/src/recordings/api.ts is the real client's): a
 * recording played out from its script (recording.ts), and what's kept on this device that hasn't uploaded (kept.ts).
 */
import type { AlcoveApi, RoomRecording, RoomRecordingInput } from '@alcove/api';
import { answer } from '../answer';
import { ScriptedRecording } from './recording';

const recordings = new Set<ScriptedRecording>();
/** Whatever the last story left recording stops. */
export function stopRecordings(): void {
  for (const r of recordings) r.forget();
  recordings.clear();
}

export const recordingsApi: Pick<AlcoveApi, 'recordings'> = {
  recordings: {
    start: async (input?: RoomRecordingInput): Promise<RoomRecording> => {
      await answer(() => null);
      const recording = new ScriptedRecording(input ?? {});
      recordings.add(recording);
      return recording;
    }
  }
};
